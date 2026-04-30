/**
 * AI 行为 fixture：和 fixtures.ts 不同——
 *   - **不**注入 fake API key（让 .env.local 的真实 AI_COACH_* 自然生效）
 *   - 仅跳 onboarding / dailyPlan 缓存
 *   - 测试可通过 window.__aiccStore.getState().coach.* 直接调真实 LLM
 *
 * 用法：`import { test, expect } from './ai-fixtures'`
 */
import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      // 跳过 onboarding 但不动 AI config（让 env 兜底生效）
      localStorage.setItem('aicc.onboarding.v1', 'done');
      localStorage.removeItem('aicc.dailyPlan.v1');
      localStorage.removeItem('aicc.forcedOffline.v1');
      // 关掉所有主动嗅探，避免后台请求干扰测试
      localStorage.setItem('aicc.coach.diagnoseOnFail.v1', 'off');
      localStorage.setItem('aicc.coach.constraintSanity.v1', 'off');
      localStorage.setItem('aicc.coach.intentSniff.v1', 'off');
      // 启用 FastLane（指向本地 Ollama），让 T19/T20/T21 真跑本地模型
      // 选用机器上已有的 qwen3.5:4b（≈4GB Q4_K_M），TTFT < 500ms
      (window as any).__aiccTestEnableFastLane = {
        enabled: true,
        baseUrl: 'http://localhost:11434',
        model: 'qwen3.5:4b',
      };
    });
    // 把页面里 console.error / debug 转发到 Playwright stdout，便于定位真实 LLM 错误
    page.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error' || t === 'warning' || t === 'debug') {
        // 只过滤太长的 hot-reload / dev 日志
        const text = msg.text();
        if (
          text.includes('vite') ||
          text.includes('hmr') ||
          text.includes('Download the React DevTools')
        ) return;
        // eslint-disable-next-line no-console
        console.log(`  [page:${t}] ${text}`);
      }
    });
    page.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.log(`  [page:exception] ${err.message}`);
    });
    await use(page);
  },
});

export { expect };
