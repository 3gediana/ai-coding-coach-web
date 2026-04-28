/**
 * 主题切换下拉：放在 TopBar 设置按钮旁。
 */
import { useEffect, useRef, useState } from 'react';
import { Palette, Check } from 'lucide-react';
import { applyTheme, getStoredTheme, THEMES, type Theme } from '../lib/theme';
import { cn } from '../lib/cn';

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Theme>(getStoredTheme());
  const ref = useRef<HTMLDivElement | null>(null);

  // 点外面关
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    setTimeout(() => window.addEventListener('mousedown', close), 50);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const onPick = (t: Theme) => {
    applyTheme(t);
    setCurrent(t);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn"
        title="切换主题"
      >
        <Palette size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 glass-card overflow-hidden z-40">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-mute font-semibold border-b border-line">
            主题
          </div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => onPick(t.id)}
              className={cn(
                'w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-bg-elev2 transition-colors',
                current === t.id && 'bg-accent/10',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-ink">{t.label}</div>
                <div className="text-[11px] text-ink-mute mt-0.5">{t.desc}</div>
              </div>
              {current === t.id && <Check size={12} className="text-accent shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
