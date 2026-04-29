/**
 * 卡住引导浮卡片：右下角显示 AI 苏格拉底式提问。
 *
 * 触发：StuckDetector 监听 lastEditAt，120s 不动 → enqueueStuckHint → 写到 currentHint
 * 关闭：用户点 X / 按 Esc / 用户重新开始改代码（store 监听 lastEditAt）
 *
 * 也包含 idle detector 主逻辑：定时器 + 触发条件
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { Lightbulb, X, RefreshCw, BellOff } from 'lucide-react';
import { useStore } from '../lib/store';
import { toast } from 'sonner';

const STUCK_THRESHOLD_MS = 120_000; // 2 分钟没动
const HINT_COOLDOWN_MS = 5 * 60_000; // 同一窗口 5 分钟内只触发一次
const TICK_INTERVAL_MS = 10_000; // 10 秒扫一次

export function StuckHintCard() {
  const currentHint = useStore((s) => s.currentHint);
  const dismissHint = useStore((s) => s.dismissHint);
  const enqueueStuckHint = useStore((s) => s.enqueueStuckHint);
  const setStuckHintEnabled = useStore((s) => s.setStuckHintEnabled);

  // 卡住检测定时器
  const tickRef = useRef<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const st = useStore.getState();
      if (!st.stuckHintEnabled) return;
      if (!st.activeProblemId) return;
      if (st.aiConfig.provider === 'ollama' ? !st.aiConfig.baseUrl : !st.aiConfig.apiKey) return;
      if (st.currentHint) return; // 已经有 hint 在显示
      // 已经有正在跑的 stuck-hint task → 不重复
      const running = st.tasks.some(
        (t) => t.kind === 'stuck-hint' && (t.status === 'queued' || t.status === 'running'),
      );
      if (running) return;
      const now = Date.now();
      if (now - st.lastEditAt < STUCK_THRESHOLD_MS) return;
      if (now - st.lastHintAt < HINT_COOLDOWN_MS) return;
      // 代码有内容才提示（空代码就不打扰）
      const fileId = st.activeFileIdByScope[st.activeProblemId];
      const file = (st.filesByScope[st.activeProblemId] ?? []).find((f) => f.id === fileId);
      if (!file || file.content.trim().length < 5) return;
      enqueueStuckHint();
    };
    tickRef.current = window.setInterval(tick, TICK_INTERVAL_MS);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [enqueueStuckHint]);

  // Esc 关
  useEffect(() => {
    if (!currentHint) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismissHint();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentHint, dismissHint]);

  return (
    <AnimatePresence>
      {currentHint && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: 'spring', damping: 22, stiffness: 280 }}
          className="fixed bottom-20 right-6 z-40 w-[min(380px,90vw)] glass-card border-l-2 border-l-warn/80 overflow-hidden"
        >
          <div className="px-4 py-2.5 flex items-center gap-2 border-b border-line/60 bg-warn/5">
            <Lightbulb size={14} className="text-warn shrink-0" />
            <span className="text-xs font-semibold text-warn">教练想问你两个问题</span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                onClick={() => {
                  dismissHint();
                  enqueueStuckHint();
                }}
                className="btn-ghost p-1"
                title="换一个问题"
              >
                <RefreshCw size={12} />
              </button>
              <button
                onClick={() => {
                  setStuckHintEnabled(false);
                  dismissHint();
                  toast('已关闭卡住引导，可在设置里开回', { duration: 3000 });
                }}
                className="btn-ghost p-1"
                title="关闭卡住引导"
              >
                <BellOff size={12} />
              </button>
              <button
                onClick={dismissHint}
                className="btn-ghost p-1"
                title="关闭"
              >
                <X size={12} />
              </button>
            </div>
          </div>
          <div className="px-4 py-3 text-sm text-ink leading-relaxed whitespace-pre-wrap">
            {currentHint}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
