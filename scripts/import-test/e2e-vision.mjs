/**
 * 端到端：带图导入 → sam 多模态识图 → 模型卸载（释放显存）
 *
 * 验证：
 *   1. POST 含图片 fixture
 *   2. /api/ps 看 sam 是否被加载
 *   3. statement 里 [[IMG_1]] placeholder 是否被替换为识别结果
 *   4. 完成后 /api/ps 是否清空（已 unload）
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const VITE = 'http://127.0.0.1:5173';
const OLLAMA = 'http://127.0.0.1:11434';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => l.split('=').map((s) => s.trim())),
);
const CFG = {
  provider: env.AI_COACH_PROVIDER || 'minimax',
  baseUrl: env.AI_COACH_BASE_URL,
  apiKey: '', // 不调云端 AI parseProblem
  model: env.AI_COACH_MODEL || 'MiniMax-M2',
  maxTokens: 8000, temperature: 0.3, timeoutMs: 180_000, maxRetries: 2,
  fastLane: { enabled: true, baseUrl: OLLAMA, model: 'sam:latest', numCtx: 8192 },
};

async function getOllamaPS() {
  try {
    const r = await fetch(`${OLLAMA}/api/ps`);
    const j = await r.json();
    return j.models || [];
  } catch {
    return [];
  }
}

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on('console', (msg) => {
  const t = msg.text();
  if (t.includes('[import-receiver]') || t.includes('[identifyImages]') || msg.type() === 'error') {
    process.stdout.write(`  📡 [${msg.type()}] ${t}\n`);
  }
});
page.on('pageerror', (e) => process.stdout.write(`  💥 ${e.message}\n`));

await page.goto(VITE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(800);
// 注入配置（fastLane 启用，apiKey 留空走 fallback path）
await page.evaluate((cfg) => {
  localStorage.setItem('aicc.aiConfig.v1', JSON.stringify(cfg));
  localStorage.setItem('aicc.onboarding.v1', 'done');
  localStorage.setItem('aicc.learning.dismissed.v1', new Date().toISOString().slice(0, 10));
}, CFG);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

console.log('━━━━ sam 多模态识图 e2e ━━━━\n');

// 0. ollama 起始状态
const beforePS = await getOllamaPS();
console.log(`0. ollama 起始: ${beforePS.length === 0 ? '无模型' : beforePS.map((m) => m.name).join(', ')}`);

// 清空 store + 干净基线
await page.evaluate(() => window.__aiccStore.setState({ problems: [], activeProblemId: null, filesByScope: {}, activeFileIdByScope: {} }));

// 1. POST fixture
console.log('\n1. POST fixture-with-image.json...');
const fixture = readFileSync('scripts/import-test/fixture-with-image.json', 'utf8');
const t0 = Date.now();
const resp = await fetch(`${VITE}/__import`, {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: fixture,
});
console.log(`   POST 响应: ${resp.status} ${await resp.text()}`);

// 2. 等 problem 入库
console.log('\n2. 等 problem 入库...');
let problemId = null;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => window.__aiccStore.getState().problems);
  if (st.length > 0) {
    problemId = st[0].id;
    console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s: ✓ 入库 ${problemId}`);
    console.log(`     初始 statement: "${st[0].statement.slice(0, 100).replace(/\n/g, ' ')}..."`);
    break;
  }
}
if (!problemId) {
  console.log('   ❌ 入库失败');
  await browser.close();
  process.exit(1);
}

// 3. 等 sam 加载到 ollama
console.log('\n3. 等 sam 模型加载...');
let samLoaded = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const ps = await getOllamaPS();
  if (ps.some((m) => m.name.startsWith('sam'))) {
    samLoaded = true;
    console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s: ✓ sam 已加载`);
    break;
  }
  if (i % 5 === 4) console.log(`   ${i + 1}s 仍等待...`);
}
if (!samLoaded) {
  console.log('   ❌ 60s 内 sam 未加载到 ollama');
}

// 4. 等 statement 被替换（placeholder 消失）
console.log('\n4. 等 statement placeholder 被替换...');
let identified = false, finalStatement = '';
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(1000);
  const p = await page.evaluate((id) => {
    const st = window.__aiccStore.getState();
    return st.problems.find((x) => x.id === id);
  }, problemId);
  if (p && !p.statement.includes('等待 sam 多模态识别')) {
    identified = true;
    finalStatement = p.statement;
    console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s: ✓ statement 已更新`);
    console.log(`     更新后: "${finalStatement.slice(0, 200).replace(/\n/g, ' ')}..."`);
    break;
  }
  if (i % 10 === 9) console.log(`   ${i + 1}s: 仍在识图...`);
}
if (!identified) console.log('   ⚠ 120s 内 statement 未更新');

// 5. 等 sam 卸载
console.log('\n5. 等 sam 卸载（keep_alive: 0）...');
let unloaded = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  const ps = await getOllamaPS();
  if (!ps.some((m) => m.name.startsWith('sam'))) {
    unloaded = true;
    console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s: ✓ sam 已卸载`);
    break;
  }
}
if (!unloaded) {
  const ps = await getOllamaPS();
  console.log(`   ⚠ 30s 内 sam 仍在显存: ${ps.map((m) => `${m.name} expires=${m.expires_at}`).join(', ')}`);
}

console.log('\n━━━━ 总结 ━━━━');
console.log(`入库       ${problemId ? '✅' : '❌'}`);
console.log(`sam 加载    ${samLoaded ? '✅' : '❌'}`);
console.log(`statement 替换  ${identified ? '✅' : '⚠'}`);
console.log(`sam 卸载    ${unloaded ? '✅' : '⚠'}`);

await browser.close();
