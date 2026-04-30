/**
 * Smoke E2E：基础渲染 + UI 操作（不依赖任何 LLM 调用）。
 *
 * 跳过 QuickSetupCard / Onboarding（fixture 已注入假 AIConfig），
 * 直接验证：App 加载 / TopBar / 三视图切换 / Modal 打开 / 飞行模式 chip。
 */
import { test, expect } from './fixtures';

test.describe('A. 基础加载 + 没破坏老功能', () => {
  test('A1. App 加载 + 主界面渲染', async ({ page }) => {
    await page.goto('/');
    // TopBar 存在（h-14 header）
    await expect(page.locator('header').first()).toBeVisible();
    // 编辑器面板（FeedbackPanel）存在
    await expect(page.getByText('Agent', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('A2. fixture 注入了 AIConfig，QuickSetupCard 不挡路', async ({ page }) => {
    await page.goto('/');
    // QuickSetupCard 的标题是「30 秒上手」（按 src/components/QuickSetupCard.tsx）
    // 如果出现说明 hasUsableAIConfig 失败了
    await page.waitForLoadState('domcontentloaded');
    // 给 React 时间 mount
    await page.waitForTimeout(1500);
    const quickCard = page.getByText('30 秒上手', { exact: false });
    await expect(quickCard).toHaveCount(0);
  });

  test('A3. TopBar 关键按钮存在', async ({ page }) => {
    await page.goto('/');
    // Settings 按钮存在
    const settingsBtn = page.locator('button[title*="AI 设置"], button[title*="未配置"]');
    await expect(settingsBtn).toBeVisible({ timeout: 10_000 });
    // 主 CTA「问教练」 在中等以上屏存在 (lg+)
    await expect(page.getByText('问教练').first()).toBeVisible();
  });
});

test.describe('B. Agent 三视图切换（新功能）', () => {
  test('B1. 默认 List 视图渲染', async ({ page }) => {
    await page.goto('/');
    // Agent 头部三个 ViewBtn：title="时间线"、"协作拓扑"、"仪表板"
    const listBtn = page.locator('button[title="时间线"]');
    const graphBtn = page.locator('button[title="协作拓扑"]');
    const statsBtn = page.locator('button[title="仪表板"]');
    await expect(listBtn).toBeVisible({ timeout: 10_000 });
    await expect(graphBtn).toBeVisible();
    await expect(statsBtn).toBeVisible();
  });

  test('B2. 切到 Graph 视图，5 个集群标题渲染', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="协作拓扑"]').click();
    // AgentGraph 里 5 个集群标题
    await expect(page.getByText('被动响应', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('主动嗅探', { exact: true })).toBeVisible();
    await expect(page.getByText('学习反馈', { exact: true })).toBeVisible();
    await expect(page.getByText(/编排链/)).toBeVisible();
    await expect(page.getByText(/费曼反向教学/)).toBeVisible();
  });

  test('B3. 切到 Stats 视图，4 个汇总卡 + 空表提示', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="仪表板"]').click();
    // 4 个 SummaryCard：总调用 / 本地 / 云端 / 错误
    await expect(page.getByText('总调用', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('本地', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('云端', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('错误', { exact: true })).toBeVisible();
  });

  test('B4. 切回 List', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="协作拓扑"]').click();
    await page.locator('button[title="时间线"]').click();
    // List 模式下没有"被动响应"集群标题
    await expect(page.getByText('被动响应', { exact: true })).toHaveCount(0);
  });
});

test.describe('C. 飞行模式 / 离线 chip（新功能）', () => {
  test('C1. 在线时 ✈ 按钮存在（半透明）', async ({ page }) => {
    await page.goto('/');
    // OfflineChip 在线模式：button title="模拟拔网线 / 飞行模式 — AI 强制走本地 1B 模型"
    const planeBtn = page.locator('button[title*="飞行模式"]');
    await expect(planeBtn.first()).toBeVisible({ timeout: 10_000 });
  });

  test('C2. 没配 FastLane 点击 → toast 警告', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title*="飞行模式"]').first().click();
    // sonner toast 出现（含"FastLane"字样）
    await expect(page.getByText(/FastLane/)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('D. 费曼模式入口（新功能）', () => {
  test('D1. 没激活题目时 - 费曼按钮不显示', async ({ page }) => {
    await page.goto('/');
    // activeProblemId 默认 null，费曼按钮不应出现
    // 题目级 chip 显示"未激活题目"
    await expect(page.getByText('未激活题目')).toBeVisible({ timeout: 10_000 });
    const feynmanBtn = page.locator('button[title*="费曼模式"]');
    await expect(feynmanBtn).toHaveCount(0);
  });
});

test.describe('E. SettingsModal 打开（回归）', () => {
  test('E1. 点 Settings 按钮 → modal 打开', async ({ page }) => {
    await page.goto('/');
    // 找标 title 含"AI 设置"的按钮
    await page.locator('button[title="AI 设置"]').click();
    // SettingsModal 真实标题是 "AI 服务配置"（见 SettingsModal.tsx）
    await expect(page.getByText('AI 服务配置')).toBeVisible({ timeout: 5000 });
    // 关闭：按 Escape
    await page.keyboard.press('Escape');
  });
});
