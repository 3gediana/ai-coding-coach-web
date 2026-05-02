/**
 * 端到端（新架构）：
 *   POST → vite 落盘 raw → 调 importProcessor (Node 端 qwen3.5 识图)
 *        → 落盘 processed → SSE 推 processed payload → 前端入库
 *
 * 验证：
 *   1. POST 立即响应 200 (rawPath)
 *   2. raw 文件落盘
 *   3. processed 文件落盘（含 imageRecognitions）
 *   4. 前端 problems 多一道（statement 含识别结果）
 *   5. ollama /api/ps 已无 qwen3.5（finally 卸载生效）
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';

const VITE = 'http://127.0.0.1:5173';
const OLLAMA = 'http://127.0.0.1:11434';

async function getOllamaPS() {
  try {
    const r = await fetch(`${OLLAMA}/api/ps`);
    return (await r.json()).models || [];
  } catch { return []; }
}

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on('console', (msg) => {
  const t = msg.text();
  if (t.includes('[import-receiver]') || t.includes('handleImport') || msg.type() === 'error') {
    process.stdout.write(`  📡 [${msg.type()}] ${t}\n`);
  }
});
page.on('pageerror', (e) => process.stdout.write(`  💥 ${e.message}\n`));

await page.goto(VITE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(800);
await page.evaluate(() => {
  // 不注 apiKey → 走 fallback path（不调 cloud parseProblem）
  localStorage.removeItem('aicc.aiConfig.v1');
  localStorage.setItem('aicc.onboarding.v1', 'done');
  localStorage.setItem('aicc.learning.dismissed.v1', new Date().toISOString().slice(0, 10));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

console.log('━━━━ 新架构 e2e（后端 qwen3.5 处理）━━━━\n');

await page.evaluate(() => window.__aiccStore.setState({ problems: [], activeProblemId: null, filesByScope: {}, activeFileIdByScope: {} }));
const beforePS = await getOllamaPS();
console.log(`0. ollama 起始: ${beforePS.length === 0 ? '无模型' : beforePS.map((m) => m.name).join(', ')}`);

// 1. POST
console.log('\n1. POST fixture (1 张真实图)...');
const fixture = readFileSync('scripts/import-test/fixture-with-image.json', 'utf8');
const t0 = Date.now();
const resp = await fetch(`${VITE}/__import`, {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: fixture,
});
const respBody = await resp.json();
console.log(`   响应 ${resp.status}: ${JSON.stringify(respBody)}`);
const rawPath = `logs/imports/${respBody.rawPath}`;
console.log(`   raw 落盘: ${existsSync(rawPath) ? '✅' : '❌'} ${rawPath}`);

// 2. 等 processed 文件出现
const processedPath = rawPath.replace(/\.raw\.json$/, '.processed.json');
console.log('\n2. 等 processed 文件落盘...');
let processedTime = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  if (existsSync(processedPath)) {
    processedTime = Date.now();
    console.log(`   ${((processedTime - t0) / 1000).toFixed(1)}s: ✅ ${processedPath}`);
    break;
  }
}
if (!processedTime) {
  console.log('   ❌ 60s 内 processed 未落盘');
  await browser.close();
  process.exit(1);
}

// 3. 验证 processed 内容
const processed = JSON.parse(readFileSync(processedPath, 'utf8'));
console.log(`   imageRecognitions: ${processed.imageRecognitions?.length || 0} 条`);
console.log(`   识别成功: ${processed.imageRecognitions?.filter((r) => r.description).length || 0}`);
if (processed.imageRecognitions?.[0]?.description) {
  console.log(`   图 1 描述: "${processed.imageRecognitions[0].description.slice(0, 80)}..."`);
}

// 4. 等前端入库
console.log('\n3. 等前端 SSE 收到 + 入库...');
let problemFromStore = null;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => window.__aiccStore.getState().problems);
  if (st.length > 0) {
    problemFromStore = st[0];
    console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s: ✅ 前端入库`);
    console.log(`     id: ${problemFromStore.id}`);
    console.log(`     title: ${problemFromStore.title}`);
    console.log(`     statement 长度: ${problemFromStore.statement.length}`);
    console.log(`     含「图 1 识别」标记: ${problemFromStore.statement.includes('图 1 识别') ? '✅' : '❌'}`);
    break;
  }
}
if (!problemFromStore) console.log('   ❌ 30s 内前端未收到入库');

// 5. ollama 卸载验证
console.log('\n4. 验证 qwen3.5 已卸载...');
const finalPS = await getOllamaPS();
const qwen35StillThere = finalPS.some((m) => m.name.startsWith('qwen3.5'));
console.log(`   ollama 当前模型: ${finalPS.length === 0 ? '空' : finalPS.map((m) => m.name).join(',')}`);
console.log(`   qwen3.5 已卸载: ${qwen35StillThere ? '❌ 仍在显存' : '✅'}`);

console.log('\n━━━━ 总结 ━━━━');
console.log(`POST → raw 落盘     ${existsSync(rawPath) ? '✅' : '❌'}`);
console.log(`后端 processor       ${processedTime ? '✅ ' + ((processedTime - t0) / 1000).toFixed(1) + 's' : '❌'}`);
console.log(`SSE → 前端入库       ${problemFromStore ? '✅' : '❌'}`);
console.log(`statement 含识别     ${problemFromStore?.statement?.includes('图 1 识别') ? '✅' : '❌'}`);
console.log(`qwen3.5 卸载             ${!qwen35StillThere ? '✅' : '❌'}`);

await browser.close();
