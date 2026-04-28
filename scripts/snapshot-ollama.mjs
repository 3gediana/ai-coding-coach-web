import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const URL = 'http://127.0.0.1:5173';
const OUT = 'screenshots-ollama';
await mkdir(OUT, { recursive: true });

const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();

// 控制台 / 网络日志
p.on('console', (m) => console.log('  [page]', m.type(), m.text().slice(0, 200)));
p.on('pageerror', (e) => console.log('  [pageerr]', e.message));
p.on('response', (r) => {
  if (r.url().includes('ollama') || r.url().includes('11434') || r.url().includes('api/tags')) {
    console.log(`  [net] ${r.status()} ${r.url()}`);
  }
});

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
await p.waitForTimeout(800);

// 关 toast
try {
  await p.locator('[data-sonner-toast] button').first().click({ timeout: 1000 });
} catch {}

// 打开设置
console.log('→ 打开设置');
await p.locator('button[title*="设置"], button[title*="未配置"]').first().click();
await p.waitForTimeout(500);
await p.screenshot({ path: `${OUT}/01-settings-open.png` });

// 点 ollama preset
console.log('→ 点 Ollama preset');
await p.locator('button.chip:has-text("Ollama")').first().click();
await p.waitForTimeout(2000); // 等 fetch
await p.screenshot({ path: `${OUT}/02-ollama-list.png` });

// 滚动到 model 区
console.log('→ 滚动到 Model 区');
await p.locator('text=Model').first().scrollIntoViewIfNeeded();
await p.waitForTimeout(300);
await p.screenshot({ path: `${OUT}/03-ollama-models.png` });

// 截 modal 全貌
const modal = p.locator('.glass-card').first();
const bbox = await modal.boundingBox();
if (bbox) {
  await p.screenshot({
    path: `${OUT}/04-modal-fullshot.png`,
    clip: bbox,
  });
}

await b.close();
console.log('✓ done');
