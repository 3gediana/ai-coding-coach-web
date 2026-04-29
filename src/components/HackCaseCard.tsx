/**
 * Hack Case 浮卡：Coach 主动构造的边界 case 提示。
 *
 * 出现条件：store.pendingHackCase 非空（由 enqueueHackCase.onSuccess 写入）。
 * 用户操作：
 *  - 「立即跑这个 case」→ 把 stdin 灌进 RuntimePane，自动展开终端，触发运行
 *  - 「不试了」/ ✕ → 关闭浮卡（dismissHackCase）
 */
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, PlayCircle } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';

const SEVERITY_LABEL: Record<string, string> = {
  edge: '边界值',
  large: '大数据',
  degenerate: '退化结构',
  tricky: '题面陷阱',
};

const SEVERITY_COLOR: Record<string, string> = {
  edge: 'chip-warn',
  large: 'chip-warn',
  degenerate: 'chip-bad',
  tricky: 'chip-bad',
};

export function HackCaseCard() {
  const pending = useStore((s) => s.pendingHackCase);
  const dismiss = useStore((s) => s.dismissHackCase);
  const setRuntimePaneOpen = useStore((s) => s.setRuntimePaneOpen);

  const onRun = () => {
    if (!pending) return;
    setRuntimePaneOpen(true);
    // RuntimePane 内部读取 window.__aiccHackCaseStdin 立即灌 stdin 并触发运行
    (window as any).__aiccHackCaseStdin = pending.stdin;
    window.dispatchEvent(new CustomEvent('aicc:hack-case-run', { detail: pending }));
    dismiss();
  };

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          className="fixed bottom-20 right-4 z-40 w-[360px] glass-card overflow-hidden border-warn/40"
        >
          <div className="px-3 py-2 flex items-center gap-2 bg-warn/10 border-b border-warn/30">
            <Sparkles size={14} className="text-warn" />
            <span className="text-xs font-semibold text-warn">
              Coach 主动出了一个 hack case
            </span>
            <span
              className={cn(
                'ml-auto text-[10px] px-1.5 py-0 rounded',
                SEVERITY_COLOR[pending.severity] ?? 'chip-warn',
              )}
            >
              {SEVERITY_LABEL[pending.severity] ?? pending.severity}
            </span>
            <button
              onClick={dismiss}
              className="btn-ghost p-1"
              title="不试了"
            >
              <X size={12} />
            </button>
          </div>
          <div className="px-3 py-2 space-y-2">
            <div className="text-[11px] text-ink-dim leading-relaxed">
              {pending.rationale}
            </div>
            <pre className="text-[11px] font-mono bg-bg-elev/60 border border-line rounded px-2 py-1.5 whitespace-pre-wrap max-h-28 overflow-y-auto">
              {pending.stdin}
            </pre>
            {pending.expectedOutput && (
              <div className="text-[10px] text-ink-mute">
                期望输出：
                <span className="text-ok font-mono ml-1">
                  {pending.expectedOutput.length > 60
                    ? pending.expectedOutput.slice(0, 60) + '…'
                    : pending.expectedOutput}
                </span>
              </div>
            )}
            <button
              onClick={onRun}
              className="btn-primary w-full justify-center text-xs py-1.5"
            >
              <PlayCircle size={13} />
              立即跑这个 case
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
