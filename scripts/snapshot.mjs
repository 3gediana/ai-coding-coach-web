/**
 * 用系统 Chrome 跑 Playwright，截屏整个 UI 的各种状态。
 *
 * 用法：node scripts/snapshot.mjs
 * 前置：vite dev server 已在 5173 跑着
 */
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const URL = 'http://127.0.0.1:5173';
const OUT = 'screenshots';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[browser-console-error]', msg.text());
});
page.on('pageerror', (e) => console.log('[page-error]', e.message));

console.log(`→ 打开 ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle' });
// 清掉残留数据，回到全新状态
await page.evaluate(async () => {
  const idb = await import('https://esm.sh/idb@8');
  const db = await idb.openDB('ai-coding-coach', 1);
  await Promise.all([
    db.clear('problems'),
    db.clear('mistakes'),
    db.clear('sessions'),
    db.clear('events'),
  ]);
  localStorage.removeItem('aicc.code.v1');
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 1. 首屏（草稿态）
console.log('→ 截图：首屏');
await page.screenshot({ path: `${OUT}/01-home.png`, fullPage: false });

// 2. 关掉 toast（如果出现欢迎提示）
try {
  await page.locator('[data-sonner-toast] button[aria-label="Close toast"]').first().click({ timeout: 1000 });
} catch {}
await page.waitForTimeout(300);

// 3. 设置面板
console.log('→ 截图：设置面板');
await page.locator('button:has(svg.lucide-settings)').first().click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/02-settings.png`, fullPage: false });

// 关
await page.keyboard.press('Escape').catch(() => {});
await page.locator('.glass-card button:has(svg.lucide-x)').first().click({ timeout: 1500 }).catch(async () => {
  // fallback: 点遮罩
  await page.mouse.click(50, 50);
});
await page.waitForTimeout(400);

// 4. 录入题目弹窗
console.log('→ 截图：录入题目弹窗');
await page.locator('button:has-text("录入题目")').first().click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/03-problem-editor.png`, fullPage: false });

// 关闭
await page.locator('.glass-card button:has(svg.lucide-x)').first().click().catch(() => {});
await page.waitForTimeout(400);

// 5. 题目库侧滑（默认就开着，但点一下确保激活）
console.log('→ 截图：题目库侧滑（空态）');
// 已经是默认 problems tab，截图即可
await page.screenshot({ path: `${OUT}/04-sidebar-problems-empty.png`, fullPage: false });

// 6. 错题本侧滑
console.log('→ 截图：错题本侧滑');
const sidebarButtons = page.locator('.w-14 button[title]');
await sidebarButtons.nth(1).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/05-sidebar-mistakes-empty.png`, fullPage: false });

// 7. 学习记录
console.log('→ 截图：学习记录');
await sidebarButtons.nth(2).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/06-sidebar-sessions-empty.png`, fullPage: false });

// 8. 学习空间（雷达）
console.log('→ 截图：学习空间');
await sidebarButtons.nth(3).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/07-sidebar-dashboard.png`, fullPage: false });

// 9. 关侧边栏（再次点击同一个）
await sidebarButtons.nth(3).click();
await page.waitForTimeout(400);

// 10. 切到 Python 看编辑器
console.log('→ 截图：切到 Python');
await page.locator('button:has-text("Python")').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/08-python-editor.png`, fullPage: false });

// 11. 让我们手动注入一些数据，看完整态界面
console.log('→ 注入示例数据，截图完整状态');
await page.evaluate(async () => {
  const idb = await import('https://esm.sh/idb@8');
  const db = await idb.openDB('ai-coding-coach', 1);
  await db.put('problems', {
    id: 'demo-1',
    title: '两数之和',
    statement: '给定一个整数数组 nums 和一个整数目标值 target，请在该数组中找出和为目标值的那两个整数。',
    constraints: '2 <= nums.length <= 10^4',
    examples: [{ input: 'nums = [2,7,11,15], target = 9', output: '[0,1]' }],
    tags: ['哈希表', '数组'],
    difficulty: 'easy',
    createdAt: Date.now(),
  });
  await db.put('problems', {
    id: 'demo-2',
    title: '盛最多水的容器',
    statement: '给定 n 条垂直线，找两条线和 x 轴构成最大水容器。',
    tags: ['双指针', '贪心'],
    difficulty: 'medium',
    createdAt: Date.now() - 1000,
  });
  await db.put('mistakes', {
    id: 'mistake-1',
    problemId: 'demo-1',
    problemTitle: '两数之和',
    language: 'cpp',
    wrongCode: 'for (int j = 0; j <= i; j++) {...}',
    rootCause: '内层循环 j 从 0 开始且 j <= i，导致同元素自配并重复检查 pair。',
    category: '边界条件',
    knowledgePoints: ['数组遍历', '循环边界'],
    reviewTips: ['内层循环从 i+1 开始', '注意题目"不能重复使用同一元素"约束'],
    createdAt: Date.now(),
    reviewCount: 0,
  });
  await db.put('mistakes', {
    id: 'mistake-2',
    problemId: 'demo-2',
    problemTitle: '盛最多水的容器',
    language: 'cpp',
    wrongCode: '...',
    rootCause: 'O(n²) 暴力枚举，n=10^5 时超时。',
    category: '复杂度不对',
    knowledgePoints: ['双指针', '贪心'],
    reviewTips: ['两端搜索优先双指针', '掌握 O(n) vs O(n²)'],
    createdAt: Date.now() - 1000,
    reviewCount: 0,
  });
  // sessions
  await db.put('sessions', {
    id: 's1', problemId: 'demo-1', problemTitle: '两数之和',
    startedAt: Date.now() - 30 * 60 * 1000,
    endedAt: Date.now() - 15 * 60 * 1000,
    effectiveMs: 15 * 60 * 1000, awayMs: 0,
    stuckCount: 2, analyzeCount: 3, hintCount: 0,
    outcome: 'mistake', language: 'cpp',
  });
  await db.put('sessions', {
    id: 's2', problemId: 'demo-2', problemTitle: '盛最多水的容器',
    startedAt: Date.now() - 14 * 60 * 1000,
    endedAt: Date.now() - 2 * 60 * 1000,
    effectiveMs: 12 * 60 * 1000, awayMs: 30000,
    stuckCount: 1, analyzeCount: 2, hintCount: 1,
    outcome: 'mistake', language: 'cpp',
  });
  await db.put('sessions', {
    id: 's3', problemId: 'p_lcs', problemTitle: '最长公共子序列',
    startedAt: Date.now() - 60 * 60 * 1000,
    endedAt: Date.now() - 45 * 60 * 1000,
    effectiveMs: 15 * 60 * 1000, awayMs: 0,
    stuckCount: 0, analyzeCount: 1, hintCount: 0,
    outcome: 'pass', language: 'cpp',
  });
  await db.put('problems', {
    id: 'p_lcs', title: '最长公共子序列', statement: '...',
    tags: ['dp', '字符串'], createdAt: Date.now() - 86400000,
  });
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
console.log('→ 截图：题目库（有 3 道题）');
await page.screenshot({ path: `${OUT}/09-sidebar-problems-full.png`, fullPage: false });

// 错题本
await sidebarButtons.nth(1).click();
await page.waitForTimeout(500);
console.log('→ 截图：错题本（2 条）');
await page.screenshot({ path: `${OUT}/10-sidebar-mistakes-full.png`, fullPage: false });

// 学习空间
await sidebarButtons.nth(3).click();
await page.waitForTimeout(800);
console.log('→ 截图：学习空间（雷达图）');
await page.screenshot({ path: `${OUT}/11-sidebar-dashboard-full.png`, fullPage: false });

// 激活一道题（li[role=button]，不是 button）
await sidebarButtons.nth(0).click();
await page.waitForTimeout(400);
await page.locator('li[role="button"]:has-text("两数之和")').first().click();
await page.waitForTimeout(600);
console.log('→ 截图：激活题目后整体界面');
await page.screenshot({ path: `${OUT}/12-active-problem.png`, fullPage: false });

await browser.close();
console.log('✓ 截图完毕，输出目录：' + OUT);
