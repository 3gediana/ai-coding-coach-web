### 14. `App.tsx` onboarding / dailyPlan effect 依赖数组为空但引用了 `aiConfig`

- **确认状态**：代码存在，属于 React hooks 规范问题。
- **位置**：`src/App.tsx:179-199`
- **代码点**：
  ```ts
  useEffect(() => {
    if (!hasUsableAIConfig(aiConfig)) return; // 读取了 aiConfig
    ...
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  ```
- **风险**：
  - 首次渲染时 `aiConfig` 尚未从 localStorage 恢复完成 → effect 可能在配置未就绪时提前退出，之后配置变化也不会重新触发。
  - 用户首次配置 AI 后不会自动触发 onboarding / dailyPlan。
- **建议修复**：
  - 将 `aiConfig` 或 `hasUsableAIConfig(aiConfig)` 加入依赖数组。
  - 或使用 `useStore.getState()` 在 effect 内部实时读取。
