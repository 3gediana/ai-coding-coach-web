/**
 * 端到端：TM 推送 → vite plugin → SSE → store.handleImportPayload → 入库激活
 *
 * 步骤：
 *   1. 启动 playwright + 打开 AI Coach（订阅 SSE）
 *   2. node fetch POST fixture 到 /__import
 *   3. 等 store.problems 多一道（说明 SSE 收到 + handleImportPayload 处理完）
 *   4. 验证 activeProblemId / title / statement
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const VITE = 'http://127.0.0.1:5173';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => l.split('=').map((s) => s.trim())),
);
const CFG = {
  provider: env.AI_COACH_PROVIDER || 'minimax',
  baseUrl: env.AI_COACH_BASE_URL,
  apiKey: env.AI_COACH_KEY,
  model: env.AI_COACH_MODEL || 'MiniMax-M2',
  maxTokens: 8000, temperature: 0.3, timeoutMs: 180_000, maxRetries: 2,
  fastLane: { enabled: true, baseUrl: 'http://127.0.0.1:11434', model: 'sam:latest', numCtx: 8192 },
};

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on('console', (msg) => {
  const t = msg.text();
  if (t.includes('[import-receiver]') || t.includes('handleImport') || msg.type() === 'error' || msg.type() === 'warning') {
    process.stdout.write(`  📡 [${msg.type()}] ${t}\n`);
  }
});
page.on('pageerror', (e) => process.stdout.write(`  💥 pageerror: ${e.message}\n`));

await page.goto(VITE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(1000);
// 不注入 apiKey → handleImport 走 fallback path (不调云端 AI)，测链路本身
await page.evaluate(() => {
  // 清空 AI config，避免 parseProblem 跑慢/失败影响测试稳定性
  localStorage.removeItem('aicc.aiConfig.v1');
  localStorage.setItem('aicc.onboarding.v1', 'done');
  localStorage.setItem('aicc.learning.dismissed.v1', new Date().toISOString().slice(0, 10));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

console.log('━━━━ 端到端导入链路测试 ━━━━\n');

console.log('1. 等待 SSE 连接稳定...');
await page.waitForTimeout(800);

// 清空 problems 起一个干净基线
await page.evaluate(() => window.__aiccStore.setState({ problems: [], activeProblemId: null, filesByScope: {}, activeFileIdByScope: {} }));
const beforeCount = await page.evaluate(() => window.__aiccStore.getState().problems.length);
console.log(`   problems 基线: ${beforeCount} 道`);

console.log('\n2. POST fixture 到 /__import...');
const fixture = readFileSync('scripts/import-test/fixture-school-oj.json', 'utf8');
const t0 = Date.now();
const resp = await fetch(`${VITE}/__import`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: fixture,
});
const result = await resp.json();
console.log(`   POST 响应: status=${resp.status} body=${JSON.stringify(result)}`);

console.log('\n3. 等待 store 收到 + handleImportPayload 处理...');
let ok = false, problem = null;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({
    problems: window.__aiccStore.getState().problems.map((p) => ({ id: p.id, title: p.title, statementLen: p.statement.length })),
    activeId: window.__aiccStore.getState().activeProblemId,
  }));
  if (st.problems.length > beforeCount) {
    problem = st.problems[0];
    if (st.activeId === problem.id) {
      ok = true;
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`   ${elapsed}s: ✓ problem 已入库 + 激活`);
      console.log(`     id: ${problem.id}`);
      console.log(`     title: ${problem.title}`);
      console.log(`     statement 长度: ${problem.statementLen} 字`);
      break;
    }
  }
}

if (!ok) {
  console.log('   ❌ 30s 内未导入');
  const debug = await page.evaluate(() => ({
    problems: window.__aiccStore.getState().problems.length,
    activeId: window.__aiccStore.getState().activeProblemId,
  }));
  console.log('   debug:', debug);
}

console.log('\n4. 验证文件已创建...');
const file = await page.evaluate(() => {
  const st = window.__aiccStore.getState();
  const pid = st.activeProblemId;
  if (!pid) return null;
  const files = st.filesByScope[pid] || [];
  return files[0] ? { name: files[0].name, lang: files[0].language, contentLen: files[0].content.length } : null;
});
if (file) {
  console.log(`   ✓ 文件已建：${file.name} (${file.lang}) · ${file.contentLen} 字`);
} else {
  console.log('   ⚠ 无关联文件');
}

console.log('\n━━━ 重复推送测试（去重）━━━');
const resp2 = await fetch(`${VITE}/__import`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: fixture,
});
await resp2.json();
await page.waitForTimeout(2000);
const after2 = await page.evaluate(() => window.__aiccStore.getState().problems.length);
console.log(`   重复 POST 后 problems: ${after2} 道（期望 = ${beforeCount + 1}）`);
console.log(`   ${after2 === beforeCount + 1 ? '✅ 去重生效' : '❌ 去重失败'}`);

console.log('\n━━━━ 总结 ━━━━');
console.log(`链路: POST → SSE → handleImport → 入库 + 激活  ${ok ? '✅' : '❌'}`);
console.log(`文件创建  ${file ? '✅' : '⚠'}`);
console.log(`去重  ${after2 === beforeCount + 1 ? '✅' : '❌'}`);

await browser.close();
