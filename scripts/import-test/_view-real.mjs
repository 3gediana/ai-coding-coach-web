/**
 * 用真实 processed 文件喂前端 handleImportPayload，看 minimax 解析真实题目效果
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const VITE = 'http://127.0.0.1:5173';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=').map((s) => s.trim())),
);
const CFG = {
  provider: env.AI_COACH_PROVIDER || 'minimax',
  baseUrl: env.AI_COACH_BASE_URL,
  apiKey: env.AI_COACH_KEY,
  model: env.AI_COACH_MODEL || 'MiniMax-M2',
  maxTokens: 8000, temperature: 0.3, timeoutMs: 180_000, maxRetries: 2,
  fastLane: { enabled: false, baseUrl: 'http://127.0.0.1:11434', model: 'sam:latest', numCtx: 8192 },
};

const realProcessed = JSON.parse(readFileSync('logs/imports/2026-04-28T12-47-25_educoder.processed.json', 'utf8'));

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('console', (msg) => {
  const t = msg.text();
  if (msg.type() === 'error' || t.includes('parseProblem') || t.includes('handleImport')) {
    process.stdout.write(`  📡 [${msg.type()}] ${t}\n`);
  }
});
page.on('pageerror', (e) => process.stdout.write(`  💥 ${e.message}\n`));

await page.goto(VITE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await page.evaluate((cfg) => {
  localStorage.setItem('aicc.aiConfig.v1', JSON.stringify(cfg));
  localStorage.setItem('aicc.onboarding.v1', 'done');
  localStorage.setItem('aicc.learning.dismissed.v1', new Date().toISOString().slice(0, 10));
  indexedDB.deleteDatabase('aicc');
}, CFG);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

console.log('━━━ 真实 educoder Python 分支题 → minimax parseProblem ━━━\n');
console.log(`title: ${realProcessed.title}`);
console.log(`rawText: ${realProcessed.rawText.length} 字`);
console.log(`图片识别: ${realProcessed.imageRecognitions?.filter(r=>r.description).length}/${realProcessed.imageRecognitions?.length}`);
console.log('');

const t0 = Date.now();
console.log('调用 handleImportPayload...');
await page.evaluate((p) => window.__aiccStore.getState().handleImportPayload(p), realProcessed);

console.log('等入库 + parseProblem 完成...');
let problem = null;
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => window.__aiccStore.getState().problems);
  if (st.length > 0) {
    problem = st[0];
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s: ✓ 入库`);
    break;
  }
}

if (problem) {
  console.log('\n━━━ minimax parseProblem 解析后入库的题 ━━━');
  console.log('id:', problem.id);
  console.log('title:', problem.title);
  console.log('difficulty:', problem.difficulty);
  console.log('tags:', JSON.stringify(problem.tags));
  console.log('constraints:', problem.constraints || '(无)');
  console.log('examples:', JSON.stringify(problem.examples, null, 2));
  console.log('\nstatement:');
  console.log(problem.statement);
}

const screenshot = `logs/imports/_real-view-${Date.now()}.png`;
await page.screenshot({ path: screenshot, fullPage: true });
console.log(`\n📸 ${screenshot}`);

await browser.close();
