import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import './index.css';
import 'katex/dist/katex.min.css';
import { initTheme } from './lib/theme';
import { ErrorBoundary } from './components/ErrorBoundary';
import { bootstrapFileBackedLocalStorage } from './lib/fileBackedSettings';

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.error('[global-error]', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[global-unhandledrejection]', event.reason);
  });
}

async function boot() {
  await bootstrapFileBackedLocalStorage();
  initTheme();
  const { default: App } = await import('./App');
  const { useStore } = await import('./lib/store');

  if (import.meta.env.DEV) {
    (window as any).__aiccStore = useStore;
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
}

void boot();
