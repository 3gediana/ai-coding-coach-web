/**
 * 卡住引导探测器：监听 lastEditAt。
 *
 * 触发：连续 STUCK_THRESHOLD_MS 没编辑 → 调 askCoach（source='stuck'），
 * 由 Coach 时间线统一展示 AI 苏格拉底式提问，不再用浮卡片。
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../lib/store';

const STUCK_THRESHOLD_MS = 120_000;
const HINT_COOLDOWN_MS = 5 * 60_000;
const TICK_INTERVAL_MS = 10_000;

export function StuckHintCard() {
  const enqueueStuckHint = useStore((s) => s.enqueueStuckHint);

  const tickRef = useRef<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const st = useStore.getState();
      if (!st.stuckHintEnabled) return;
      if (!st.activeProblemId) return;
      const usable =
        st.aiConfig.provider === 'ollama'
          ? !!st.aiConfig.baseUrl.trim()
          : !!st.aiConfig.apiKey.trim();
      if (!usable) return;
      if (st.qaPendingProblemId) return;
      const now = Date.now();
      if (now - st.lastEditAt < STUCK_THRESHOLD_MS) return;
      if (now - st.lastHintAt < HINT_COOLDOWN_MS) return;
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

  return null;
}
