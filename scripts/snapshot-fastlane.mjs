import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const URL = 'http://127.0.0.1:5173';
const OUT = 'screenshots-fastlane';
await mkdir(OUT, { recursive: true });

const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();

p.on('response', (r) => {
  if (r.url().includes('11434') || r.url().includes('api/tags') || r.url().includes('api/ps')) {
    console.log(`  [net] ${r.status()} ${r.url().slice(0, 130)}`);
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
try { await p.locator('[data-sonner-toast] button').first().click({ timeout: 800 }); } catch {}

// 打开设置
console.log('→ 打开设置');
await p.locator('button[title*="设置"], button[title*="未配置"]').first().click();
await p.waitForTimeout(400);

// 默认主 provider 是 minimax（云端） → fastLane 区可见且未启用
console.log('→ Cap 1: fastLane 折叠（未启用）');
await p.screenshot({ path: `${OUT}/01-collapsed.png` });

// 启用 fastLane
console.log('→ 启用 fastLane');
await p.locator('input[type="checkbox"]').first().check();
await p.waitForTimeout(2000); // 等 ollama list 拉

console.log('→ Cap 2: fastLane 展开');
const modal = p.locator('.glass-card').first();
const box = await modal.boundingBox();
if (box) {
  await p.screenshot({ path: `${OUT}/02-expanded.png`, clip: box });
}

// 点击一个 ollama 模型 chip
console.log('→ 选 qwen3.5:4b');
const qwen35Chip = p.locator('button.chip:has-text("qwen3.5:4b")').first();
if (await qwen35Chip.count()) {
  await qwen35Chip.click();
  await p.waitForTimeout(300);
  console.log('→ Cap 3: 选中模型');
  const box2 = await modal.boundingBox();
  if (box2) await p.screenshot({ path: `${OUT}/03-model-picked.png`, clip: box2 });
}

// 切到 ollama provider 看 fastLane 是否变成"已是本地"提示
console.log('→ 切到 Ollama provider');
await p.locator('button.chip:has-text("Ollama")').first().click();
await p.waitForTimeout(800);
console.log('→ Cap 4: 主已是本地');
const box3 = await modal.boundingBox();
if (box3) await p.screenshot({ path: `${OUT}/04-main-is-local.png`, clip: box3 });

await b.close();
console.log('✓ done');
