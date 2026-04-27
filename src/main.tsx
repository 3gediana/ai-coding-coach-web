import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="bottom-right"
      theme="dark"
      richColors
      closeButton
      toastOptions={{
        style: {
          background: '#161a28',
          border: '1px solid #262b3d',
          color: '#e7eaf3',
        },
      }}
    />
  </React.StrictMode>,
);
