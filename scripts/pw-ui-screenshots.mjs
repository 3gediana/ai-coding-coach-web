/**
 * UI 截图巡检：访问每个主要界面，存到 logs/screenshots/。
 *
 * 跑：node scripts/pw-ui-screenshots.mjs
 * 前提：vite dev 已在 127.0.0.1:5173 跑
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'logs/screenshots';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const log = (m) => console.log('  ' + m);

async function shot(name, locator) {
  const path = join(OUT, name + '.png');
  if (locator) await locator.screenshot({ path });
  else await page.screenshot({ path, fullPage: false });
  log(`✓ ${name}`);
}

console.log('━━━ 1. 主界面');
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForTimeout(800);
await shot('01-main-empty');

console.log('\n━━━ 2. 设置弹窗');
const settingsBtn = page.locator('button:has(svg.lucide-settings), [aria-label*="设置"], [title*="设置"]').first();
if (await settingsBtn.count() > 0) {
  await settingsBtn.click();
  await page.waitForTimeout(500);
  await shot('02-settings-default');

  const ollamaTab = page.locator('button:has-text("Ollama")').first();
  if (await ollamaTab.count() > 0) {
    await ollamaTab.click();
    await page.waitForTimeout(400);
    await shot('03-settings-ollama');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
} else log('未找到设置按钮');

console.log('\n━━━ 3. 题目录入弹窗');
const addProblemBtn = page.locator('button:has-text("录入题目"), button:has-text("录入")').first();
if (await addProblemBtn.count() > 0) {
  await addProblemBtn.click();
  await page.waitForTimeout(400);
  await shot('04-problem-editor-empty');

  const urlInput = page.locator('input[placeholder*="luogu"], input[placeholder*="atcoder"]').first();
  if (await urlInput.count() > 0) {
    await urlInput.fill('https://www.luogu.com.cn/problem/P1001');
    await page.waitForTimeout(300);
    await shot('05-problem-editor-luogu-url');

    await urlInput.fill('https://leetcode.cn/problems/two-sum/');
    await page.waitForTimeout(300);
    await shot('06-problem-editor-leetcode-unsupported');

    await urlInput.fill('https://codeforces.com/problemset/problem/1/A');
    await page.waitForTimeout(300);
    await shot('07-problem-editor-cf-unsupported');

    await urlInput.fill('https://www.luogu.com.cn/problem/P1428');
    await page.waitForTimeout(300);
    const fetchBtn = page.locator('button:has-text("抓取")').first();
    if (await fetchBtn.count() > 0) {
      await fetchBtn.click();
      log('点击抓取，等待 toast …');
      await page.waitForTimeout(4000);
    }
  }
} else log('未找到录入题目按钮');

await page.waitForTimeout(800);
console.log('\n━━━ 4. 主界面（带题目 + LaTeX）');
await shot('08-main-with-problem');

console.log('\n━━━ 5. 学习空间（heatmap + 雷达图）');
const dashTab = page.locator('button:has-text("学习空间")').first();
if (await dashTab.count() > 0) {
  await dashTab.click();
  await page.waitForTimeout(500);
  await shot('09-dashboard');
}

console.log('\n━━━ 6. 错题本');
const mistakesTab = page.locator('button:has-text("错题本")').first();
if (await mistakesTab.count() > 0) {
  await mistakesTab.click();
  await page.waitForTimeout(400);
  await shot('10-mistakes-empty');
}

console.log('\n━━━ 7. 题目库');
const problemsTab = page.locator('button:has-text("题目库")').first();
if (await problemsTab.count() > 0) {
  await problemsTab.click();
  await page.waitForTimeout(400);
  await shot('11-problems-list');
}

console.log('\n━━━ 8. 提交结果弹窗（AC + 分享卡）');
// 先点编辑器输入代码，让"提交"按钮 enabled
try {
  await page.locator('.monaco-editor').first().click({ timeout: 3000 });
  await page.keyboard.type('int main() { return 0; }');
  await page.waitForTimeout(500);
} catch { log('编辑器不可见，跳过输入'); }

const submitBtn = page.locator('button:has-text("提交")').first();
if (await submitBtn.count() > 0 && await submitBtn.isEnabled().catch(() => false)) {
  await submitBtn.click({ timeout: 5000 }).catch(() => log('submit click failed'));
  await page.waitForTimeout(500);
  await shot('12-submit-modal-empty');

  const acBtn = page.locator('button:has-text("AC")').first();
  if (await acBtn.count() > 0) {
    await acBtn.click();
    await page.waitForTimeout(500);
    await shot('13-submit-modal-ac');
  }
  await page.keyboard.press('Escape');
} else log('提交按钮 disabled，跳过');

await browser.close();

console.log('\n=== 截图汇总 ===');
console.log(`目录：${OUT}`);
