/**
 * 粘贴提示 chip：当用户粘贴 ≥ 30 行代码时，编辑器底部出现一个 chip。
 * - 用户点"理解一下" → 触发 explainPaste（结果在任务托盘可看）
 * - 用户点忽略 → 关闭 chip
 * - 10 秒不操作自动消失
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import { Sparkles, X, ScanSearch } from 'lucide-react';
import { useStore } from '../lib/store';

const AUTO_DISMISS_MS = 10_000;

export function PasteSuggestionChip() {
  const sug = useStore((s) => s.pasteSuggestion);
  const setSug = useStore((s) => s.setPasteSuggestion);
  const enqueue = useStore((s) => s.enqueueExplainPaste);

  // 自动消失
  useEffect(() => {
    if (!sug) return;
    const t = setTimeout(() => setSug(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [sug, setSug]);

  return (
    <AnimatePresence>
      {sug && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-30 glass-card border-l-2 border-l-cyan/80 overflow-hidden"
        >
          <div className="px-4 py-2.5 flex items-center gap-3">
            <Sparkles size={14} className="text-cyan shrink-0" />
            <div className="text-xs">
              <span className="font-semibold">检测到大段粘贴</span>
              <span className="text-ink-mute ml-1.5">
                {sug.lineCount} 行 · 要我帮你审视一下吗？
              </span>
            </div>
            <button
              onClick={() => enqueue()}
              className="btn-primary py-1 text-xs"
              title="AI 解释这段代码"
            >
              <ScanSearch size={12} />
              理解一下
            </button>
            <button
              onClick={() => setSug(null)}
              className="btn-ghost p-1"
              title="忽略"
            >
              <X size={12} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
