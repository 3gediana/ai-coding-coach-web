/**
 * 终端 + 运行 + tab 补全 截图测试
 */
import { chromium } from 'playwright';
import { mkdir, readFile } from 'fs/promises';

const URL = 'http://127.0.0.1:5174';
const OUT = 'screenshots-runtime';
await mkdir(OUT, { recursive: true });

// 读 .env.local 注入 AI 配置
const env = {};
try {
  const raw = await readFile('.env.local', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch {}
const AI_CONFIG = {
  provider: env.AI_COACH_PROVIDER || 'minimax',
  baseUrl: env.AI_COACH_BASE_URL || 'https://api.minimaxi.com/v1/text/chatcompletion_v2',
  apiKey: env.AI_COACH_KEY || '',
  model: env.AI_COACH_MODEL || 'MiniMax-M2',
  maxTokens: 8000,
  temperature: 0.3,
  timeoutMs: 180_000,
  maxRetries: 2,
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [page-error]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console-error]', m.text());
});

console.log(`→ ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle' });

// 清业务数据 + 注入 AI 配置
await page.evaluate(async (cfg) => {
  const idb = await import('https://esm.sh/idb@8');
  try {
    const db = await idb.openDB('ai-coding-coach', 2);
    await Promise.all([
      db.clear('problems'),
      db.clear('mistakes'),
      db.clear('sessions'),
      db.clear('events'),
      db.clear('files'),
    ]);
  } catch {}
  localStorage.clear();
  if (cfg && cfg.apiKey) {
    localStorage.setItem('aicc.aiConfig.v1', JSON.stringify(cfg));
  }
}, AI_CONFIG);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
try {
  await page.locator('[data-sonner-toast] button').first().click({ timeout: 1000 });
} catch {}
await page.waitForTimeout(300);

// 1. 首屏 — 终端是否在底部
console.log('→ 01-home');
await page.screenshot({ path: `${OUT}/01-home.png` });

// 2. 展开终端 + 跑 cpp（远程编译）
console.log('→ 02-terminal-open + cpp run');
await page.locator('header button:has-text("运行")').first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/02-terminal-cpp-running.png` });

// 等 cpp 远程编译完成（最多 30s）
let cppDone = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  const text = await page.locator('text=退出码').count();
  if (text > 0) {
    cppDone = true;
    break;
  }
}
await page.screenshot({ path: `${OUT}/03-cpp-result.png` });
console.log(`  cpp result: ${cppDone ? 'done' : 'timeout'}`);

// 3. 切到 Python，写一段，运行
console.log('→ 04-python');
// 折叠终端
await page.locator('button[title="收起"]').click().catch(() => {});
await page.waitForTimeout(300);
// 新建 python 文件
await page.locator('button[title="新建文件"]').click();
await page.waitForTimeout(300);
await page.locator('button:has-text("Python 文件")').click();
await page.waitForTimeout(800);
// 替换内容
await page.evaluate(() => {
  const w = window;
  const s = w.__aicc_useStore__.getState();
  const scope = '__draft__';
  const fid = s.activeFileIdByScope[scope];
  if (fid) s.updateFileContent(fid, 'a, b = map(int, input().split())\nprint(a + b)\n');
});
await page.waitForTimeout(500);
// 跑 python
await page.locator('header button:has-text("运行")').first().click();
await page.waitForTimeout(1000);
// 终端打开，输入 stdin
await page.locator('textarea[placeholder*="每行一个输入"]').fill('3 4');
await page.waitForTimeout(300);
// 再点 RuntimePane 内的运行按钮（不是 header 的）
await page.locator('button[title^="运行"]').last().click();
// 等 python 加载（首次 ~10s）
console.log('  等 pyodide 加载...');
let pyDone = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const text = await page.locator('text=退出码').count();
  if (text > 0) {
    pyDone = true;
    break;
  }
}
await page.screenshot({ path: `${OUT}/04-python-result.png` });
console.log(`  python result: ${pyDone ? 'done' : 'timeout'}`);

// 验证输出包含 7
const allOutput = await page.locator('pre').allInnerTexts();
const ok = allOutput.some((s) => /\b7\b/.test(s));
console.log(`  python 输出含 7: ${ok}`);

// 4. tab 补全（cpp）
console.log('→ 05-tab-completion');
// 切回 main.cpp
await page.evaluate(() => {
  const w = window;
  const s = w.__aicc_useStore__.getState();
  const scope = '__draft__';
  const files = s.filesByScope[scope] ?? [];
  const cppFile = files.find((f) => f.name.endsWith('.cpp'));
  if (cppFile) s.setActiveFile(scope, cppFile.id);
});
await page.waitForTimeout(800);
// 关掉终端
await page.locator('button[title="收起"]').click().catch(() => {});
await page.waitForTimeout(300);
// 在 cpp 文件最后插入 'fori' 然后等 1s 看补全弹出
const editorBox = await page.locator('.monaco-editor').first().boundingBox();
if (editorBox) {
  // 点编辑器底部空白
  await page.mouse.click(editorBox.x + 200, editorBox.y + editorBox.height - 50);
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('fori', { delay: 80 });
  await page.waitForTimeout(800); // 等补全弹出
  await page.screenshot({ path: `${OUT}/05-snippet-fori.png` });
  // 按 Tab/Enter 接受
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/06-snippet-expanded.png` });
}

await browser.close();
console.log('✓ done → ' + OUT);
