import { useState, useEffect, useCallback } from 'react';

/**
 * 把宽度（或任意 number）持久化到 localStorage 的 hook。
 *
 * - 初始读取：localStorage 有值且在 [min, max] 内就用，否则用 defaultValue
 * - 更新时：自动写回 localStorage（去抖 200ms 避免频繁写）
 */
export function usePersistedWidth(
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): [number, (next: number) => void] {
  const [value, setValueRaw] = useState<number>(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return defaultValue;
      const n = Number(raw);
      if (!Number.isFinite(n)) return defaultValue;
      return Math.max(min, Math.min(max, n));
    } catch {
      return defaultValue;
    }
  });

  // 去抖写盘：拖拽时每像素都更新 state，但 200ms 才写一次 localStorage
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(key, String(value));
      } catch {
        /* quota / disabled */
      }
    }, 200);
    return () => clearTimeout(id);
  }, [key, value]);

  const setValue = useCallback(
    (next: number) => {
      setValueRaw(Math.max(min, Math.min(max, next)));
    },
    [min, max],
  );

  return [value, setValue];
}
