/**
 * 离线模式：监听 navigator.onLine + 强制 fastLane（本地 Ollama）。
 *
 * 这是项目的"剧场感" feature：演示时拔网线，本地 qwen3.5:4b 还能完整批注代码——
 * 直接证明项目不是"GPT 的 web 壳"。
 *
 * 状态判定（按严格度递减）：
 *   - 'forced-offline'  用户在 UI 上手动开启"飞行模式"
 *   - 'offline'         navigator.onLine === false
 *   - 'online-no-fast'  在线但没配 FastLane（等同正常云端）
 *   - 'online'          正常
 */
import { useEffect, useSyncExternalStore } from 'react';

export type OnlineStatus = 'online' | 'offline' | 'forced-offline';

const FORCED_OFFLINE_KEY = 'aicc.forcedOffline.v1';

let listeners = new Set<() => void>();

let state: OnlineStatus = computeInitial();

function computeInitial(): OnlineStatus {
  if (typeof navigator === 'undefined') return 'online';
  if (typeof localStorage !== 'undefined' && localStorage.getItem(FORCED_OFFLINE_KEY) === 'on') {
    return 'forced-offline';
  }
  return navigator.onLine ? 'online' : 'offline';
}

function notify() {
  for (const fn of listeners) fn();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (state === 'forced-offline') return;
    state = 'online';
    notify();
  });
  window.addEventListener('offline', () => {
    if (state === 'forced-offline') return;
    state = 'offline';
    notify();
  });
}

export function getOnlineStatus(): OnlineStatus {
  return state;
}

/** 切换"强制离线"开关（用户手动模拟拔网线，用于演示 / 隐私场景） */
export function setForcedOffline(forced: boolean) {
  if (forced) {
    state = 'forced-offline';
    try {
      localStorage.setItem(FORCED_OFFLINE_KEY, 'on');
    } catch {
      /* ignore */
    }
  } else {
    try {
      localStorage.removeItem(FORCED_OFFLINE_KEY);
    } catch {
      /* ignore */
    }
    state = navigator.onLine ? 'online' : 'offline';
  }
  notify();
}

/** "实际不能联网"的判断（包括 forced 和真离线） */
export function isEffectivelyOffline(): boolean {
  return state === 'offline' || state === 'forced-offline';
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React Hook：在组件里订阅在线状态 */
export function useOnlineStatus(): OnlineStatus {
  return useSyncExternalStore(subscribe, getOnlineStatus, getOnlineStatus);
}

/**
 * 通过 fetch 主动探测真实联网（navigator.onLine 不一定可靠：例如连了但 DNS 挂了）。
 *
 * 调用方：在用户点击"测试网络"或者首次启动时探一下。
 */
export async function probeNetworkOnce(timeoutMs = 3000): Promise<boolean> {
  if (state === 'forced-offline') return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    // 用一个轻量的 endpoint（cf cdn 或 google）；这里用 1x1 gif
    await fetch('https://www.google.com/generate_204', {
      method: 'HEAD',
      cache: 'no-store',
      signal: ctrl.signal,
      mode: 'no-cors',
    });
    clearTimeout(t);
    if (state === 'offline') {
      state = 'online';
      notify();
    }
    return true;
  } catch {
    if (state === 'online') {
      state = 'offline';
      notify();
    }
    return false;
  }
}
