# BUGS / 项目问题记录

更新时间：2026-05-05 21:40 UTC+08（第3轮扫描后）

## 已运行检查

- `npm run typecheck`：已通过（修复后复测）
- `npm run test`：失败（Node 版本不兼容）
- `npm run build`：已通过（修复后复测）
- `node -v`：`v18.20.1`
- `npm ls lucide-react vitest vite typescript`：
  - `lucide-react@0.468.0`
  - `typescript@5.9.3`
  - `vite@5.4.21`
  - `vitest@4.1.5`

---

## P0 / 阻塞项

### 1. TypeScript 类型检查失败：`lucide-react` 类型声明缺失（✅ 已修复）

- **位置**：多个组件文件
- **修复记录**：新增 `src/types/lucide-react.d.ts`，为当前项目使用到的图标导出提供最小类型声明。
- **验证**：`npm run typecheck` 与 `npm run build` 均已通过。

### 2. 单元测试无法启动：当前 Node 版本不满足 `vitest@4.1.5` 运行需求

- **确认状态**：已确认，可复现。
- **位置**：测试启动阶段，尚未进入项目测试文件。
- **复现命令**：`npm run test`
- **当前 Node**：`v18.20.1`
- **错误摘要**：
  - `SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'`
  - 来源：`node_modules/rolldown/dist/shared/rolldown-build-*.mjs`
- **影响**：
  - 所有 Vitest 单元测试无法运行。
  - CI 或本地质量门禁失效。
- **建议修复**：
  - 升级 Node 到支持 `node:util.styleText` 的版本，例如 Node 20+ / 22+。
  - 或将 `vitest` 降级到兼容 Node 18 的版本。
  - 修复后重新运行 `npm run test`。

---

## P1 / 高优先级风险

### 3. `.env` 前缀配置可能把云端 API Key 暴露到浏览器包（✅ 已修复）

- **位置**：`vite.config.ts:774`, `src/lib/store.ts:1536-1605`
- **修复记录**：
  - `envPrefix` 从 `['VITE_', 'AI_COACH_', 'DEEPSEEK_']` 改为仅 `['VITE_']`。
  - 所有前端使用的 env 变量重命名为 `VITE_` 前缀：`VITE_DEEPSEEK_KEY`、`VITE_DEEPSEEK_API_KEY`、`VITE_DEEPSEEK_BASE_URL`、`VITE_DEEPSEEK_FLASH_MODEL`、`VITE_DEEPSEEK_PRO_MODEL`、`VITE_AI_COACH_PROVIDER`、`VITE_AI_COACH_BASE_URL`、`VITE_AI_COACH_KEY`、`VITE_AI_COACH_MODEL`。
  - 避免意外把非 `VITE_` 前缀的私密 key 暴露到浏览器 bundle。

### 4. 网络探测使用 Google，国内网络环境容易误判离线（✅ 已修复）

- **位置**：`src/lib/offlineMode.ts:106-153`
- **修复记录**：
  - 改为多端点并发探测：Google 204、Cloudflare、百度 favicon。
  - 任一端点成功即判定在线，避免单一端点不可达导致误判。
  - 使用 `Promise.allSettled` + `AbortSignal.timeout` 替代手动 AbortController。

### 5. `setForcedOffline(false)` 在非浏览器环境可能访问未定义 `navigator`（✅ 已修复）

- **位置**：`src/lib/offlineMode.ts:73`
- **修复记录**：已将状态恢复逻辑改为在 `navigator` 不存在时默认 `online`，避免 Node/SSR 环境 `ReferenceError`。

### 6. `main.tsx` 对 root 节点使用非空断言（✅ 已修复）

- **位置**：`src/main.tsx:47`
- **修复记录**：已移除非空断言，改为显式检查 `#root`，缺失时抛出 `Missing root element: #root`。

### 7. AlgoViz LLM 代码执行安全：黑名单可被绕过

- **确认状态**：代码存在，属于安全风险。
- **位置**：`src/algoviz/runtime.tsx:35-60,128`
- **代码点**：`new Function(...globalNames, transformed)` + `SECURITY_BLACKLIST` 正则扫描
- **风险**：
  - LLM 生成的 TSX 代码通过 `new Function` 在主线程执行，黑名单仅用正则匹配，可被轻松绕过（如 `window['loc'+'ation']`、`this.constructor.constructor('return fetch')()` 等）。
  - 虽然代码注释承认"不是绝对安全"，但当前防护水平极低，任何恶意/幻觉代码都能访问 `window`、`document`、`fetch` 等。
  - 执行在主线程，恶意代码可导致页面崩溃或数据泄露。
- **建议修复**：
  - 短期：增加更多绕过模式检测（字符串拼接、`constructor` 链、`globalThis` 等）。
  - 中期：改用 iframe sandbox 执行，通过 postMessage 通信（注释中提到的方案）。
  - 长期：使用 Web Worker + 严格 CSP 隔离。

### 8. ThemeSwitcher `setTimeout` 添加 listener 但 cleanup 可能遗漏（✅ 已修复）

- **位置**：`src/components/ThemeSwitcher.tsx:20`
- **修复记录**：
  - 使用 `let added = false` 标记 listener 是否已添加。
  - cleanup 中先 `clearTimeout(timer)` 阻止延迟添加，再按 `added` 标记决定是否 `removeEventListener`。
  - 彻底消除组件卸载后 listener 泄漏。

### 9. `OllamaIntroModal` / `QuickSetupCard` 等组件硬编码内网 IP（✅ 已修复）

- **位置**：`src/lib/store.ts:5708-5719`
- **修复记录**：
  - 将硬编码 `10.11.219.21` 改为从环境变量 `VITE_SCHOOL_OJ_HOST` 读取。
  - 未配置时不再匹配任何内网 IP，避免暴露内网拓扑信息。

---

## P2 / 中优先级维护问题

### 10. `src/lib/store.ts` 单文件过大，核心状态逻辑耦合严重

- **确认状态**：已确认，`src/lib/store.ts` 当前约 5740 行。
- **位置**：`src/lib/store.ts`
- **现象**：文件约 5740 行，混合状态管理、AI 调用、运行任务、OJ、AlgoViz、题库、学习计划等逻辑。
- **风险**：
  - 维护成本高。
  - 回归风险高。
  - 单元测试难以隔离。
- **建议修复**：
  - 拆分 Zustand slices 或领域模块。
  - 优先拆出 `taskSlice`、`runtimeSlice`、`algoVizSlice`、`ojSlice`。

### 11. `vite.config.ts` 承载过多服务端业务逻辑

- **确认状态**：已确认，`vite.config.ts` 当前约 1346 行，且包含多个自定义 middleware / dev server 业务入口。
- **位置**：`vite.config.ts`
- **现象**：包含 AI proxy、Ollama 生命周期、本地题库、反馈写入、题目抓取、导入接收、OJ bridge 等逻辑。
- **风险**：
  - Vite 配置变成业务服务入口，维护和测试困难。
  - 任一中间件问题可能影响 dev/preview 启动。
- **建议修复**：
  - 拆到 `scripts/server/*` 或 `dev-server/*`。
  - `vite.config.ts` 只保留插件注册。

### 12. Playwright 脚本命名与实际测试文件重复（✅ 已部分修复）

- **位置**：`package.json`
- **修复记录**：误导性的 `test:e2e:features` 已改名为 `test:e2e:no-ollama`。

### 13. `RuntimePane` Ctrl+Enter 快捷键 effect 闭包引用 `onRun` 但未列入依赖（✅ 已修复）

- **位置**：`src/components/RuntimePane.tsx:380-391`
- **修复记录**：
  - 将 keydown handler 中的 `onRun()` 改为 `runRef.current()`，利用已有的 ref 避免 stale closure。
  - 在 `onRun` 定义后立即赋值 `runRef.current = onRun`，确保 ref 始终持有最新闭包。
  - 移除 `stdin` 依赖（通过 ref 间接读取），减少不必要的 effect 重绑定。

### 14. `App.tsx` onboarding / dailyPlan effect 依赖数组为空但引用了 `aiConfig`（✅ 已修复）

- **位置**：`src/App.tsx:179-199`
- **修复记录**：
  - onboarding effect：依赖数组从 `[]` 改为 `[aiConfig, startOnboarding]`，用户首次配置 AI 后自动触发引导。
  - dailyPlan effect：依赖数组从 `[]` 改为 `[aiConfig]`，配置变更后重新触发。

### 15. `storage.ts` `listEvents` 全表扫描性能问题

- **确认状态**：代码存在，属于性能风险。
- **位置**：`src/lib/storage.ts:208-224`
- **代码点**：`events = await db.getAll('events')` + `events.filter(...)` + `events.slice(...)`
- **风险**：
  - 每次调用 `listEvents` 都会从 IndexedDB 读取全部事件，然后在 JS 中过滤/排序/截断。
  - 事件量增长后（5000+），`buildProblemStateBundle` 和 `importProblemBundlesFromLocalBank` 中的 `listEvents({ limit: 5000 })` 会导致明显延迟。
- **建议修复**：
  - 利用 IndexedDB 索引（已有 `sessionId` 和 `ts` 索引）做范围查询。
  - 为 `problemId` 添加索引以支持按题目过滤。

### 16. `storage.ts` `deleteEventsByProblem` 全表扫描 + 逐条删除

- **确认状态**：代码存在，属于性能风险。
- **位置**：`src/lib/storage.ts:225-236`
- **代码点**：`store.getAllKeys()` + `store.getAll()` + `events.map(...)` 逐条 `store.delete()`
- **风险**：
  - 删除某个题目的所有事件需要先读取全表，再逐条删除。
  - 事件量大时性能极差。
- **建议修复**：
  - 为 events store 添加 `problemId` 索引，使用 `IDBKeyRange` 批量删除。

### 17. `isProblemDeletedLocally` 每次调用都重新解析 localStorage JSON（✅ 已修复）

- **位置**：`src/lib/storage.ts:41-43`
- **修复记录**：
  - 新增模块级缓存 `deletedIdsCache: Set<string> | null`，首次解析后缓存结果。
  - `markProblemDeletedLocally` / `clearProblemDeletedLocally` 直接修改缓存 Set，无需重新解析。
  - `wipeAll` 时调用 `invalidateDeletedIdsCache()` 清空缓存。

### 18. `writeLocalProblemBankBundle` 每次写入都先全量读取已有数据

- **确认状态**：代码存在，属于性能风险。
- **位置**：`vite.config.ts:154-178`
- **代码点**：`const existing = (await readLocalProblemBank()).find(...)` 在每次写入前读取所有题目文件
- **风险**：
  - 题目数量增长后，每次保存一个题目都要先读取所有 JSON 文件。
  - 与 `queueProblemBankWrite` 串行队列叠加，延迟会累积。
- **建议修复**：
  - 维护内存中的题目索引 Map，避免每次全量磁盘读取。

---

## P3 / 低优先级 / 代码风格

### 19. 多处 `catch {}` / `catch { /* ignore */ }` 静默吞掉异常

- **确认状态**：代码存在，属于可维护性风险。
- **位置**：遍布 `src/lib/store.ts`、`src/lib/storage.ts`、`src/lib/ollama.ts`、`src/core/ai/client.ts` 等。
- **现象**：大量 `catch` 块完全吞掉异常，无日志、无计数、无上报。
- **风险**：
  - 生产环境异常被静默吞掉，无法排查。
  - 部分关键路径（如 AI 配置保存、dailyPlan 持久化）失败时用户无感知。
- **建议修复**：
  - 至少在 `catch` 中加 `console.warn` / `console.debug`。
  - 关键路径（配置保存、数据持久化）应向用户展示失败提示。

### 20. `MathMarkdown` 未对用户输入做 HTML 消毒（✅ 已修复）

- **位置**：`src/components/MathMarkdown.tsx:126-129`
- **修复记录**：
  - 安装 `rehype-sanitize` 并添加到 `rehypePlugins` 链。
  - 默认 schema 会过滤危险 HTML 标签和属性（script、onclick 等）。

### 21. `offlineMode.ts` 模块级副作用：在 import 时立即注册 `online`/`offline` 事件监听（✅ 已修复）

- **位置**：`src/lib/offlineMode.ts:36-47`
- **修复记录**：
  - 移除模块顶层 `if (typeof window !== 'undefined') { window.addEventListener(...) }` 副作用。
  - 改为惰性注册：`subscribe()` 函数在首次被 React `useSyncExternalStore` 调用时触发 `registerBrowserListeners()`。
  - 新增 `teardownBrowserListeners()` 导出函数，用于测试/HMR 清理。

### 22. `CodeEditor` MutationObserver 仅在下次 onMount 时才清理（✅ 已修复）

- **位置**：`src/components/CodeEditor.tsx:298-302`
- **修复记录**：
  - 旧代码在 `onMount` 中 `disconnect()` 上一个 observer 并赋新值，但编辑器 unmount 时无清理。
  - 新代码包装 `editor.dispose()`，在 dispose 时自动 `obs.disconnect()`。
  - 确保 MutationObserver 在编辑器销毁时被正确清理。

---

## 第2轮扫描发现（边界条件、类型安全、状态一致性）

### 23. `OllamaIntroModal` useEffect 依赖数组缺失 `settingsOpen` / `onboardingStep`（✅ 已修复）

- **位置**：`src/components/OllamaIntroModal.tsx:50-59`
- **修复记录**：
  - 依赖数组从 `[]` 改为 `[settingsOpen, onboardingStep]`。
  - 修复后：当用户打开 Settings 或进入 Onboarding 时，timer 会被正确取消/重建。

### 24. `SettingsModal` OllamaModelPicker `setInterval` 捕获 stale `probe` 回调（✅ 已修复）

- **位置**：`src/components/SettingsModal.tsx:1714-1724`
- **修复记录**：
  - `probe` 是 `useCallback([baseUrl, onChange, value])`，但 `setInterval` effect 只依赖 `[baseUrl]`。
  - 当 `value` 或 `onChange` 变化时，interval 仍调用旧 `probe`，导致 autoPick 使用过时的 `value`。
  - 将 `probe` 加入 effect 依赖数组 `[baseUrl, probe]`，interval 重建时获取最新 `probe`。

### 25. `App.tsx` unload effect 在 React cleanup 中调用 `unloadCurrentTargets()` 导致 HMR 误卸模型（✅ 已修复）

- **位置**：`src/App.tsx:131-145`
- **修复记录**：
  - 旧代码在 cleanup 中同时移除 listener 和调用 `unloadCurrentTargets()`。
  - React effect cleanup 在每次 effect 重跑时执行（包括 HMR），导致开发中模型被误卸。
  - 移除 cleanup 中的 `unloadCurrentTargets()` 调用，仅在 `pagehide`/`beforeunload` 事件中卸载。

### 26. `HackCaseCard` 设置 `window.__aiccHackCaseStdin` 但从未被读取（✅ 已修复）

- **位置**：`src/components/HackCaseCard.tsx:39`
- **修复记录**：
  - `(window as any).__aiccHackCaseStdin = pending.stdin` 是死代码，RuntimePane 通过 `CustomEvent.detail.stdin` 读取。
  - 移除该全局变量赋值，避免 window 污染和混淆。

### 27. `ojBridge.ts` 超时路径未清理 abort signal listener（✅ 已修复）

- **位置**：`src/lib/ojBridge.ts:79-102`
- **修复记录**：
  - 旧代码：timeout 触发时只 `pending.delete(id)` + `reject()`，未从 signal 移除 `onAbort` listener。
  - 新代码：timeout 和 onAbort 都先 `removeEventListener('abort', onAbort)`，再 reject，避免 listener 泄漏。
  - 同时调整声明顺序：`onAbort` 先于 `timer` 声明，因为 `onAbort` 内引用 `timer`（`clearTimeout(timer)`），而 `timer` 回调内引用 `onAbort`（`removeEventListener`），两者互相引用但都在闭包中使用，无 TDZ 问题。

---

## 第3轮扫描发现（遗漏、回归、交叉引用）

### 28. AI Proxy 中间件无目标 URL 限制 — SSRF 风险（✅ 已修复）

- **位置**：`vite.config.ts:681-716`
- **修复记录**：
  - 新增 `isAllowedProxyTarget()` 白名单检查：localhost/RFC1918 + 已知云端 AI API 域名（deepseek/openai/anthropic）。
  - 代理请求前先检查目标 URL，不在白名单内返回 403。

### 29. `ProblemEditorModal.onFetch` 不支持取消 — 关闭弹窗后 fetch 仍继续（✅ 已修复）

- **位置**：`src/components/ProblemEditorModal.tsx:51-69`
- **修复记录**：
  - 添加 `abortRef = useRef<AbortController>()`，每次 `onFetch` 创建新 AbortController。
  - `fetchAndParseProblem(u, { signal: ac.signal })` 传入 signal。
  - effect cleanup 中 `abortRef.current?.abort()`，modal 关闭时取消进行中的请求。

### 30. `SettingsModal` 中 `setTimeout(() => setOpen(false), 600)` 不可取消（✅ 已修复）

- **位置**：`src/components/SettingsModal.tsx:70-76,283-284,294-295,324-325`
- **修复记录**：
  - 添加 `closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)`。
  - 3 处 `setTimeout` 改为先 `clearTimeout(closeTimerRef.current)` 再赋值 ref。
  - effect cleanup 中 `clearTimeout(closeTimerRef.current)`，组件卸载时取消延迟关闭。

---

## 回归验证

- `npm run typecheck`：✅ 通过（0 errors）
- `npm run build`：✅ 通过（18.78s，chunk size warnings 为已知问题）
- `npm run test`：❌ 失败（Node v18.20.1 与 vitest@4.1.5 不兼容，`node:util.styleText` 缺失）

---

## 后续验证清单

修复上述阻塞项后建议依次运行：

1. `npm run typecheck`
2. `npm run test`
3. `npm run build`
4. `npm run test:e2e:smoke`

每次失败都应继续追加到本文件。

---

## UI 第1轮扫描发现（重叠/覆盖/z-index/定位问题）

### 31. `AcReviewCard` 与 `HackCaseCard` 同位置重叠 — 右下角两浮卡互相遮挡（✅ 已修复）

- **位置**：`src/components/AcReviewCard.tsx:30`, `src/components/HackCaseCard.tsx:50`
- **修复记录**：
  - 两卡均 `fixed bottom-20 right-4 z-40`，若同时出现则完全重叠。
  - AcReviewCard 新增 `pendingHackCase` + `ollamaMode` 检测，HackCaseCard 显示时自动隐藏 AcReviewCard（让位逻辑）。

### 32. `DailyPlanCard` 生成中 chip 与 `TaskTray` 最小化按钮重叠（✅ 已修复）

- **位置**：`src/components/DailyPlanCard.tsx:68`
- **修复记录**：
  - 生成中 chip 原 `fixed bottom-3 right-3 z-30`，与 TaskTray 最小化圆钮 `fixed bottom-3 right-3 z-40` 完全重叠。
  - 将 chip 上移至 `bottom-12`，避开 TaskTray 按钮。

### 33. `TabBar` 右键菜单无边界检查 — 靠屏幕边缘右键时菜单超出视口（✅ 已修复）

- **位置**：`src/components/TabBar.tsx:92-99`
- **修复记录**：
  - 原 `setCtxMenu({ x: e.clientX, y: e.clientY })`，菜单可能超出右/下边界。
  - 新增 viewport 边界 clamp：`x = clamp(8, clientX, innerWidth - 200)`, `y = clamp(8, clientY, innerHeight - 248)`。

### 34. `FileTree` 右键菜单无边界检查 — 同 TabBar 问题（✅ 已修复）

- **位置**：`src/components/FileTree.tsx:136-142`
- **修复记录**：
  - 与 TabBar 同样的边界 clamp 逻辑。

### 35. `OnboardingOverlay` tooltip 无边界检查 — 可能超出视口底部/左右（✅ 已修复）

- **位置**：`src/components/OnboardingOverlay.tsx:140-179`
- **修复记录**：
  - 原 tooltip 固定在按钮下方 `top: analyzeRect.bottom + 12`，不检查视口边界。
  - 新增：left 方向 clamp 到 `[8, innerWidth - 208]`；下方空间不足时翻到按钮上方显示。

---

## UI 第2轮扫描发现（响应式、动画、边界场景）

### 36. `QAPanel` 流式输出自动滚用 `smooth` — 频繁触发造成卡顿（✅ 已修复）

- **位置**：`src/components/QAPanel.tsx:128-137`
- **修复记录**：
  - 流式输出时 `messages[last].content` 每个 token 都变，`smooth` 动画叠加导致滚动卡顿。
  - 改为 `behavior: 'auto'`（即时跳转），流式场景下体验更流畅。

### 37. `DailyReviewCard` 无高度限制 — 内容过长时遮挡 `UserFeedbackButton`（✅ 已修复）

- **位置**：`src/components/DailyReviewCard.tsx:86`
- **修复记录**：
  - 卡片 `fixed bottom-20`，内容可无限增长，向下延伸会遮挡 `fixed bottom-4` 的反馈按钮。
  - 新增 `max-h-[calc(100vh-8rem)] overflow-y-auto overflow-x-hidden`。

### 38. `HackCaseCard` 无高度限制 — 同 DailyReviewCard 问题（✅ 已修复）

- **位置**：`src/components/HackCaseCard.tsx:50`
- **修复记录**：
  - 同上，新增 `max-h-[calc(100vh-8rem)] overflow-y-auto overflow-x-hidden`。

### 39. `AcReviewCard` 无高度限制 — 同 DailyReviewCard 问题（✅ 已修复）

- **位置**：`src/components/AcReviewCard.tsx:35`
- **修复记录**：
  - 同上，新增 `max-h-[calc(100vh-8rem)] overflow-y-auto overflow-x-hidden`。

---

## UI 第3轮扫描（回归 + 遗漏 + 极端窗口尺寸）

### 回归验证

- `npm run typecheck`：✅ 0 errors
- `npm run build`：✅ 通过（14.13s，chunk size warnings 为已知问题）
- 所有第1/2轮修复已确认无回归

### 遗漏检查

- `DailyPlanCard`（accepted/pending）`fixed top-14` 与 `OfflineBanner` 可能视觉重叠：`DailyPlanCard` 是 fixed 浮层，`OfflineBanner` 在文档流中。两者不互相遮挡，但 `DailyPlanCard` 会覆盖 `OfflineBanner` 的一部分。因 `DailyPlanCard` z-30 高于正常流，功能不受影响，视觉上可接受，不修复。
- `CodeEditor` 的 Coach hint popover `absolute right-2 top-full z-30`：在 `relative` 父容器内，不会与 TopBar/Sidebar 的 z-index 冲突。确认无问题。
- `ModelRegistry` 使用原生 `<select>`：浏览器原生下拉不受 CSS overflow/z-index 影响。确认无问题。
- `ResizeHandle` / `RowResizeHandle`：mousemove/mouseup 监听器在 useEffect cleanup 和 onUp 中均正确移除。确认无问题。
- `AlgoVizPanel` 模态框 `createPortal(document.body)` z-50：正确脱离父容器 stacking context。确认无问题。

### 40. `DailyPlanCard` 生成中 chip `bottom-12` 仍可能与 `HackCaseCard`/`AcReviewCard` 重叠

- **位置**：`src/components/DailyPlanCard.tsx:68`
- **风险**：
  - chip 在 `bottom-12 right-3`，HackCaseCard/AcReviewCard 在 `bottom-20 right-4`。
  - 当 chip 和卡片同时出现时，chip 在卡片下方，视觉上不重叠（chip 更靠近底部，卡片更高）。
  - 但 chip 宽度 `max-w-[260px]` 与卡片宽度 `360-400px` 在 right-3/right-4 位置有少量水平重叠。
  - 实际场景中 chip 仅在 `dailyPlanGenerating && !dailyPlan` 时出现，此时 `dailyPlanBlocksOverlay=true`，HackCaseCard 被 App.tsx 条件隐藏，AcReviewCard 也因 hackCaseVisible 让位。**实际不会同时出现**。
- **结论**：无需修复，条件互斥已保证。

---

## UI 扫描总结

3 轮 UI 扫描共发现并修复 **9 个 bug**：

| # | Bug | 修复 |
|---|-----|------|
| 31 | AcReviewCard + HackCaseCard 同位置重叠 | AcReviewCard 添加 hackCaseVisible 让位 |
| 32 | DailyPlanCard chip + TaskTray 重叠 | chip 上移至 bottom-12 |
| 33 | TabBar 右键菜单无边界 clamp | 添加 viewport 边界 clamp |
| 34 | FileTree 右键菜单无边界 clamp | 同上 |
| 35 | OnboardingOverlay tooltip 无边界 clamp | 添加 left clamp + 下方空间不足翻上 |
| 36 | QAPanel smooth 滚动卡顿 | 改为 auto behavior |
| 37 | DailyReviewCard 无高度限制 | 添加 max-h + overflow-y-auto |
| 38 | HackCaseCard 无高度限制 | 同上 |
| 39 | AcReviewCard 无高度限制 | 同上 |

---

## Ollama 第1轮扫描发现（拉起/预热/重复拉取/重复serve）

### 41. `ensureOllamaRunning` 竞态：提前 `ensuringPromise = null` 可导致重复 spawn（✅ 已修复）

- **位置**：`vite.config.ts:470,496`（修复前）
- **问题**：
  - IIFE 内部在端口占用但不可用（line 470）和 spawn 失败（line 496）时提前设置 `ensuringPromise = null`。
  - `.finally()` 也会设置 `ensuringPromise = null`。
  - 竞态窗口：Call A 提前清 null → Call B 看到 `ensuringPromise === null` → B 也 spawn `ollama serve` → A 的 `.finally()` 把 B 的 promise 引用覆盖为 null → Call C 又 spawn 一次。
  - 结果：多个 `ollama serve` 进程同时运行。
- **修复**：删除 IIFE 内部的 `ensuringPromise = null`，仅保留 `.finally()` 统一清理。

### 42. `warmupOllamaTargets` 60s 冷却期返回伪造 `ok: true`（✅ 已修复）

- **位置**：`vite.config.ts:579-588`（修复前）
- **问题**：
  - 60s 内重复预热请求直接返回 `{ ok: true, latencyMs: 0 }`，不实际发请求。
  - Ollama 的 `keep_alive` 默认 5m，如果模型在冷却期被卸载（用户手动 unload / Ollama 自身回收），返回 `ok: true` 是误导。
  - 客户端 App.tsx 会弹 toast "本地模型已预热"，但模型实际可能已不在内存。
- **修复**：
  - 服务端：冷却期返回加 `skipped: true` 标记。
  - 客户端：过滤 `skipped` 结果，不弹 toast（与已有注释逻辑一致）。

### 43. `rememberOllamaTargets` 仅按 model 去重，忽略 baseUrl（✅ 已修复）

- **位置**：`vite.config.ts:521-533`（修复前）
- **问题**：
  - 去重 key 只用 `model`，不同 Ollama 实例（不同 baseUrl）上的同名模型只记住第一个。
  - 页面关闭时 `unloadOllamaTargets(knownOllamaTargets)` 只卸载第一个实例的模型，第二个实例的模型继续占用显存。
- **修复**：去重 key 改为 `baseUrl|model`，与 `warmupOllamaTargets` 的去重逻辑一致。

### 44. `unloadOllamaTargets` 硬编码 `127.0.0.1:11434`，不按 baseUrl 卸载（✅ 已修复）

- **位置**：`vite.config.ts:535-560`（修复前）
- **问题**：
  - 卸载请求固定发到 `http://127.0.0.1:11434/api/chat`，忽略 target 的 `baseUrl`。
  - 如果模型在非默认端口的 Ollama 实例上（如 `http://127.0.0.1:11435`），卸载请求发错地址，模型不会被卸载。
  - 去重也只按 model，与 `rememberOllamaTargets` 同样的 bug。
- **修复**：
  - 按 `baseUrl|model` 去重。
  - 从 `baseUrl` 推导 `/api/chat` URL（兼容 `/v1/chat/completions` 后缀），发到正确的地址。

### 45. `shutdownOllamaLifecycle` 重置 `shuttingDownOllama = false`，关机期间可重启（✅ 已修复）

- **位置**：`vite.config.ts:562-571`（修复前）
- **问题**：
  - `finally` 块重置 `shuttingDownOllama = false`。
  - `await unloadOllamaTargets()` 期间如有新 warmup 请求进来，`ensureOllamaRunning()` 不检查 `shuttingDownOllama`，可能重新 spawn `ollama serve`。
  - 关机（SIGINT/SIGTERM）是终端操作，不应允许重启。
- **修复**：
  - `ensureOllamaRunning()` 开头检查 `shuttingDownOllama`，IIFE 内也检查。
  - `shutdownOllamaLifecycle()` 不再重置 `shuttingDownOllama = false`。

---

## Ollama 第2轮扫描发现（边界场景、竞态、回归）

### 46. `OllamaIntroModal` 不检查 `ollamaMode` — 用户已禁用仍弹引导（✅ 已修复）

- **位置**：`src/components/OllamaIntroModal.tsx:50-59`
- **问题**：
  - `useEffect` 只检查 `LS_KEY` 和 `settingsOpen`/`onboardingStep`，不检查 `aiConfig.ollamaMode`。
  - 用户在设置中已关闭 Ollama → 刷新页面 → 仍弹出"装上 Ollama 立即解锁 8 项"引导。
  - 体验矛盾：用户明确选了"暂不装"，下次启动还推。
- **修复**：`ollamaMode === 'disabled'` 时跳过弹窗，加入 dep array。

### 47. `warmupOllamaTargets` 硬编码 `127.0.0.1:11434` — 非默认端口无法预热（✅ 已修复）

- **位置**：`vite.config.ts:616`（修复前）
- **问题**：
  - warmup fetch 固定发到 `http://127.0.0.1:11434/api/chat`，忽略 target 的 `baseUrl`。
  - 用户配置 Ollama 在 `http://127.0.0.1:11435` → warmup 请求发到 11434（无服务）→ 预热失败。
  - `ensureOllamaRunning()` 也只探测 11434，对非默认端口会误判为"未就绪"并尝试 spawn 新实例。
- **修复**：
  - 先探测 target 的 `baseUrl` 是否可达（`/api/version`）。
  - 仅对默认 11434 端口回退到 `ensureOllamaRunning()`（含自动 spawn）。
  - warmup fetch 从 `baseUrl` 推导 `/api/chat` URL。

---

## Ollama 第3轮扫描（遗漏、极端场景、回归）

### 回归验证

- `npm run typecheck`：✅ 0 errors
- `npm run build`：✅ 通过（16.18s）
- 所有第1/2轮修复已确认无回归

### 遗漏检查

- `waitOllamaReady` 轮询 + 超时：如果 `managedOllama` 崩溃，轮询会超时返回 false，预热失败。正确。
- `warmupPromise` 去重：仅在 `.finally()` 中清 null，无提前重置。正确。
- 客户端 `warmupLocalModels` 的 `targets.length > 1` 提前返回错误：与服务端一致。正确。
- `ai-proxy` SSRF 风险：仅 dev server 可访问，不修复。

### 48. `/__aicc-ollama-mode` 切到 `disabled` 时不卸载模型/不关 ollama serve（✅ 已修复）

- **位置**：`vite.config.ts:1036-1046`（修复前）
- **问题**：
  - 端点只更新 `serverOllamaMode` 和 `process.env.AICC_OLLAMA`，不卸载模型也不关闭 managed ollama。
  - 用户在设置中关闭 Ollama → 客户端通知服务端 → 服务端仅改 flag → 模型仍在显存中 → ollama serve 仍在跑。
  - 显存浪费直到页面关闭（`pagehide`/`beforeunload`）才会释放。
- **修复**：切到 `disabled` 时立即 `unloadOllamaTargets(knownOllamaTargets)` + `killManagedOllama()`。

---

## Ollama 扫描总结

3 轮扫描共发现并修复 **8 个 bug**：

| # | Bug | 修复 |
|---|-----|------|
| 41 | ensureOllamaRunning 竞态：提前清 ensuringPromise 导致重复 spawn | 删除 IIFE 内提前清 null，仅 .finally() 统一清理 |
| 42 | warmupOllamaTargets 60s 冷却期返回伪造 ok:true | 加 skipped 标记 + 客户端过滤 |
| 43 | rememberOllamaTargets 仅按 model 去重 | 改为 baseUrl\|model 去重 |
| 44 | unloadOllamaTargets 硬编码 127.0.0.1:11434 | 按 baseUrl 推导 /api/chat URL |
| 45 | shutdownOllamaLifecycle 重置 shuttingDownOllama=false | 不重置 + ensureOllamaRunning 检查 flag |
| 46 | OllamaIntroModal 不检查 ollamaMode | disabled 时跳过弹窗 |
| 47 | warmupOllamaTargets 硬编码 11434 端口 | 先探测 baseUrl，仅默认端口走 ensure |
| 48 | __aicc-ollama-mode 切 disabled 不释放资源 | 立即 unload + killManagedOllama |
