import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import './index.css';
import 'katex/dist/katex.min.css';
import { initTheme } from './lib/theme';

// 启动时应用主题（必须在 render 前，避免闪烁）
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="bottom-right"
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
