/**
 * 共享 fixture：在 page 启动前把 AI config + 关掉 onboarding 写到 localStorage，
 * 跳过 QuickSetupCard / Onboarding，避免遮挡断言。
 *
 * 测试**不会**真的发 LLM 请求（DeepSeek key 是假的）；如果某个测试需要真 AI，
 * 它必须自己 mock window.fetch 或者直接 setState 注入数据。
 */
import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      // 假的 AI config：让 hasUsableAIConfig=true，QuickSetupCard 不出现
      const fakeAI = {
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-fake-key-for-e2e-testing-only',
        model: 'deepseek-chat',
        temperature: 0.3,
        maxTokens: 4000,
        intentRouterEnabled: false,
      };
      localStorage.setItem('aicc.aiConfig.v1', JSON.stringify(fakeAI));
      // 跳过 onboarding（避免 OnboardingOverlay 挡路）
      localStorage.setItem('aicc.onboarding.v1', 'done');
      // 干掉 dailyPlan 缓存（让 e2e 的 DailyPlan 测试能可控触发）
      localStorage.removeItem('aicc.dailyPlan.v1');
      localStorage.removeItem('aicc.forcedOffline.v1');
    });
    await use(page);
  },
});

export { expect };
