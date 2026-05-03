/**
 * Vitest 配置：只跑 src/ 下的 *.test.ts；
 * dev-workspace/tests/e2e 是 Playwright 专用，跳过。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // 编排器是纯函数无 DOM，node 环境足够；要测组件再切 jsdom
  },
});
