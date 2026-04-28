/**
 * 主题管理：把 data-theme 挂到 <html> 上，CSS 变量自动生效。
 * 持久化到 localStorage。
 */

export type Theme = 'parchment' | 'vscode-dark' | 'aicc-classic';

export const THEMES: Array<{ id: Theme; label: string; desc: string }> = [
  { id: 'parchment', label: '羊皮卷', desc: '米黄/卡其暖色系（默认）' },
  { id: 'vscode-dark', label: '深色', desc: '低反光，模仿 VS Code Dark Modern' },
  { id: 'aicc-classic', label: '经典', desc: '紫色 + 玻璃质感（v0.x）' },
];

const KEY = 'aicc.theme.v1';

export function getStoredTheme(): Theme {
  const t = localStorage.getItem(KEY);
  if (t === 'parchment' || t === 'vscode-dark' || t === 'aicc-classic') return t;
  return 'parchment';
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(KEY, t);
}

/** 启动时调用，把存的主题应用到 <html> */
export function initTheme() {
  applyTheme(getStoredTheme());
}
