/**
 * 多文件特性截图：TabBar / 新建下拉 / 右键菜单 / Markdown 预览 / 对拍 / Ctrl+P
 */
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const URL = 'http://127.0.0.1:5173';
const OUT = 'screenshots-multifile';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

page.on('pageerror', (e) => console.log('[page-error]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console-error]', m.text());
});

console.log(`→ ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle' });
// 清空数据
await page.evaluate(async () => {
  const idb = await import('https://esm.sh/idb@8');
  // 兼容 v1 和 v2
  try {
    const db = await idb.openDB('ai-coding-coach', 2);
    await Promise.all([
      db.clear('problems'),
      db.clear('mistakes'),
      db.clear('sessions'),
      db.clear('events'),
      db.clear('files'),
    ]);
  } catch {
    /* ignore */
  }
  localStorage.clear();
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 关 toast
try {
  await page.locator('[data-sonner-toast] button').first().click({ timeout: 1000 });
} catch {}
await page.waitForTimeout(300);

// 1. 首屏（草稿区，自动有 main.cpp）
console.log('→ 01-home (默认 main.cpp)');
await page.screenshot({ path: `${OUT}/01-home.png` });

// 2. 点 + 看新建下拉
console.log('→ 02-create-dropdown');
await page.locator('button[title="新建文件"]').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/02-create-dropdown.png` });

// 3. 创建 Markdown 笔记
console.log('→ 03-create-markdown → 04-md-edit');
await page.locator('button:has-text("Markdown 笔记")').click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/03-md-default.png` });
// 切到预览
await page.locator('button:has-text("预览")').first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/04-md-preview.png` });

// 4. 创建 v2 cpp 文件 → 看 TabBar 多 tab
console.log('→ 05-multi-tabs');
await page.locator('button[title="新建文件"]').click();
await page.waitForTimeout(300);
await page.locator('button:has-text("复制当前文件")').click().catch(async () => {
  // 如果没有当前文件就按 cpp
  await page.locator('button:has-text("C++ 文件")').click();
});
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/05-three-tabs.png` });

// 5. 对拍：勾选 main.cpp 和 main-v2.cpp
console.log('→ 06-diff-selection');
// hover 第一个 tab 让对拍勾选框显示，点击勾选
const tabs = page.locator('div[role="tab"]');
const count = await tabs.count();
console.log(`tabs count = ${count}`);
// 通过 evaluate 直接找到含 .cpp 的 tab 上的勾选按钮
await page.evaluate(() => {
  const tabs = document.querySelectorAll('div[role="tab"]');
  let i = 0;
  for (const t of tabs) {
    const name = t.textContent || '';
    if (name.includes('.cpp')) {
      const checkBtn = t.querySelector('button[title*="对拍"]');
      if (checkBtn) checkBtn.click();
      i++;
      if (i >= 2) break;
    }
  }
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/06-diff-selection.png` });

// 6. 右键菜单
console.log('→ 07-context-menu');
const firstTab = tabs.first();
const box = await firstTab.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/07-context-menu.png` });
  // 关闭右键菜单
  await page.mouse.click(50, 50);
  await page.waitForTimeout(200);
}

// 7. Ctrl+P
console.log('→ 08-cmd-palette');
await page.keyboard.press('Control+P');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/08-cmd-palette-empty.png` });
// 输入搜索
await page.keyboard.type('main');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/09-cmd-palette-search.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 8. 录入题目模拟（不调真实 AI，只是 UI 截图）
console.log('→ 10-problem-editor');
await page.locator('button:has-text("录入题目")').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/10-problem-editor.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 9. 注入一道假题目，激活，看 active file badge
console.log('→ 11-active-problem');
await page.evaluate(async () => {
  const idb = await import('https://esm.sh/idb@8');
  const db = await idb.openDB('ai-coding-coach', 2);
  const id = 'fake-p1';
  await db.put('problems', {
    id,
    title: '两数之和',
    statement: '给定一个整数数组 nums 和一个整数目标值 target，请在该数组中找出和为目标值的两个整数。',
    constraints: '2 <= nums.length <= 10^4',
    examples: [{ input: 'nums=[2,7,11,15],target=9', output: '[0,1]' }],
    tags: ['哈希表', '数组'],
    difficulty: 'easy',
    createdAt: Date.now(),
  });
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
// 切 sidebar 题目库
await page.locator('.w-14 button[title]').nth(0).click();
await page.waitForTimeout(400);
// 点击题目
await page.locator('li[role="button"]:has-text("两数之和")').click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/11-active-problem.png` });

await browser.close();
console.log('✓ 截图完成 → ' + OUT);
