import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e 配置
 *
 * 目标：在已经跑着的 dev server (http://127.0.0.1:5173) 上跑 smoke + 关键功能验证。
 * 如果端口未占，会自启动一份 vite dev。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false, // 单 worker，避免端口/状态冲突
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 8000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true, // 如果 user 已经手动开了 dev，直接复用
    timeout: 30_000,
  },
});
