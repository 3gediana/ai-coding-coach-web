/**
 * 题意偏离嗅探器（FastLane 主动嗅探 B 方案）。
 *
 * 触发条件（**全部满足**才唤醒本地模型）：
 *   1. intentSniffEnabled 开（默认 OFF，用户在 Settings 里开）
 *   2. 有激活题目（草稿区不嗅）
 *   3. AI 配置可用
 *   4. 当前 idle ≥ INTENT_IDLE_MS（90s，不是 5s）
 *   5. 自上次 baseline 起代码净增 ≥ INTENT_NET_GROWTH 字（30 字）
 *   6. 当前 codeHash / 全局 5min 节流由 store.requestIntentSniff 内部再 gate 一道
 *
 * 只调 store 的 requestIntentSniff，**不写 UI**。结果通过 agentTrace + 编辑器角标暴露。
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../lib/store';

const INTENT_IDLE_MS = 90_000;
const INTENT_NET_GROWTH = 30;
const TICK_INTERVAL_MS = 15_000;
const DRAFT_SCOPE = '__draft__';

export function IntentSnifferCard() {
  const requestIntentSniff = useStore((s) => s.requestIntentSniff);

  /** 上次嗅探时（或当前 file 切换时）的 baseline：fileId + 代码长度 */
  const baselineRef = useRef<{ fileId: string; length: number } | null>(null);
  const tickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const st = useStore.getState();
      if (!st.intentSniffEnabled) return;
      if (st.aiConfig.ollamaMode === 'disabled') return;
      const scope = st.activeProblemId;
      if (!scope || scope === DRAFT_SCOPE) return;

      const usable =
        !!st.aiConfig.fastLane?.enabled &&
        !!st.aiConfig.fastLane.baseUrl?.trim() &&
        !!st.aiConfig.fastLane.model?.trim();
      if (!usable) return;

      // 有正在跑的 ask / analyze → 让位
      if (st.qaPendingProblemId) return;

      const fileId = st.activeFileIdByScope[scope];
      const file = (st.filesByScope[scope] ?? []).find((f) => f.id === fileId);
      if (!file) return;
      if (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python') return;

      // idle 不够 → 还没停下
      const now = Date.now();
      if (now - st.lastEditAt < INTENT_IDLE_MS) return;

      const len = file.content.length;
      if (len < 50) return; // 代码太少不嗅

      // baseline 校准：第一次见 / 切了 file → 重置 baseline，本轮不触发
      if (!baselineRef.current || baselineRef.current.fileId !== file.id) {
        baselineRef.current = { fileId: file.id, length: len };
        return;
      }

      // 净增量没到阈值 → 还在小改，不嗅
      const grew = len - baselineRef.current.length;
      if (grew < INTENT_NET_GROWTH) return;

      // 通过门禁 → 调 store（store 内部还会做 codeHash + 5min 全局节流）
      baselineRef.current = { fileId: file.id, length: len };
      void requestIntentSniff(scope);
    };
    tickTimerRef.current = window.setInterval(tick, TICK_INTERVAL_MS);
    return () => {
      if (tickTimerRef.current) window.clearInterval(tickTimerRef.current);
    };
  }, [requestIntentSniff]);

  return null;
}
