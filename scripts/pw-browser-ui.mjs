/**
 * 截 ProblemBrowserModal 的截图：4 个 OJ 各选一道题，看预览和列表的视觉效果。
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'logs/screenshots';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForTimeout(800);

// 点击「OJ 题库」按钮
const browserBtn = page.locator('button:has-text("OJ 题库")').first();
await browserBtn.click();
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'browser-01-open-luogu.png') });
console.log('✓ browser-01-open-luogu');

// 点列表里第一道题（P1001 A+B）
const firstItem = page.locator('button:has-text("P1001")').first();
await firstItem.click();
await page.waitForTimeout(3500); // 等抓取
await page.screenshot({ path: join(OUT, 'browser-02-luogu-preview.png') });
console.log('✓ browser-02-luogu-preview');

// 切到 AtCoder
await page.locator('button:has-text("AtCoder")').first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, 'browser-03-atcoder-list.png') });
console.log('✓ browser-03-atcoder-list');

// 点 abc100_a
const acItem = page.locator('button:has-text("Happy Birthday")').first();
await acItem.click();
await page.waitForTimeout(2500);
await page.screenshot({ path: join(OUT, 'browser-04-atcoder-preview.png') });
console.log('✓ browser-04-atcoder-preview');

// 切到 POJ
await page.locator('button:has-text("POJ")').first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, 'browser-05-poj-list.png') });
console.log('✓ browser-05-poj-list');

// 切到 HDU
await page.locator('button:has-text("HDU")').first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, 'browser-06-hdu-list.png') });
console.log('✓ browser-06-hdu-list');

await browser.close();
console.log('\nDONE');
