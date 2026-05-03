import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import './index.css';
import 'katex/dist/katex.min.css';
import { initTheme } from './lib/theme';
import { useStore } from './lib/store';
import { ErrorBoundary } from './components/ErrorBoundary';

// 启动时应用主题（必须在 render 前，避免闪烁）
initTheme();

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.error('[global-error]', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[global-unhandledrejection]', event.reason);
  });
}

// dev / e2e：把 store 挂到 window 方便 Playwright 直接注入数据，避免 mock LLM
if (import.meta.env.DEV) {
  (window as any).__aiccStore = useStore;
  // e2e：从 init script 注入的 fastLane 配置覆盖默认值（仅 dev，不影响生产）
  const injected = (window as any).__aiccTestEnableFastLane;
  if (injected && injected.enabled && injected.baseUrl && injected.model) {
    queueMicrotask(() => {
      try {
        const cfg = useStore.getState().aiConfig;
        useStore.getState().setAIConfig({
          ...cfg,
          fastLane: {
            enabled: true,
            baseUrl: injected.baseUrl,
            model: injected.model,
          },
        });
      } catch (e) {
        console.debug('[e2e] failed to apply fastLane override', e);
      }
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary title="AI Coding Coach 前端异常">
      <App />
    </ErrorBoundary>
    <Toaster
      position="bottom-right"
      duration={3000}
      richColors
      closeButton
      // 让 sonner 跟随主题
      toastOptions={{
        classNames: {
          toast: 'aicc-toast',
        },
      }}
    />
  </React.StrictMode>,
);
