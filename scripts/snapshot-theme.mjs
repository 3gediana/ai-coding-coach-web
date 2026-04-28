import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
const URL = 'http://127.0.0.1:5173';
const OUT = 'screenshots-theme';
await mkdir(OUT, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'networkidle' });
await p.evaluate(async () => {
  const idb = await import('https://esm.sh/idb@8');
  try {
    const db = await idb.openDB('ai-coding-coach', 2);
    await Promise.all(['problems', 'mistakes', 'sessions', 'events', 'files'].map((s) => db.clear(s)));
  } catch {}
  localStorage.clear();
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
try { await p.locator('[data-sonner-toast] button').first().click({ timeout: 1000 }); } catch {}
await p.waitForTimeout(300);

// 默认（parchment 米黄）
console.log('→ parchment (default)');
await p.screenshot({ path: `${OUT}/01-parchment.png` });

// 切到 vscode-dark
console.log('→ vscode-dark');
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'vscode-dark'));
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/02-dark.png` });

// 切到经典
console.log('→ aicc-classic');
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'aicc-classic'));
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/03-classic.png` });

// 切回默认 + 打开 ThemeSwitcher 看下拉
console.log('→ switcher dropdown');
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'parchment'));
await p.waitForTimeout(500);
await p.locator('button[title="切换主题"]').click();
await p.waitForTimeout(500);
await p.screenshot({ path: `${OUT}/04-switcher.png` });

await b.close();
console.log('✓ done');
