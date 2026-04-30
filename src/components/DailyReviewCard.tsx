/**
 * P4 每日复习推送：每天首次开 app 时，从错题本按间隔重复挑一道值得今天复习的，主动浮现。
 *
 * 触发条件：
 *   - dailyReviewDismissedDate !== today（今天还没关过）
 *   - QuickSetupCard 不在显示（用户已配置 AI）
 *   - pickDailyReview(mistakes) 返回非空（有合适候选）
 *
 * UX：右下角浮卡（和 HackCaseCard / AcReviewCard 同一区域，但 z-index 更低，避免抢主流程）。
 *   - 点 ✕ → 今天不再弹（持久化）
 *   - 点「去复习」→ 激活该题（如果原题还在 problems 里）；不在则提示
 */
import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarCheck, X, ArrowRight, Clock } from 'lucide-react';
import { useStore } from '../lib/store';
import { pickDailyReview } from '../core/recommend';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DailyReviewCard() {
  const mistakes = useStore((s) => s.mistakes);
  const problems = useStore((s) => s.problems);
  const dismissedDate = useStore((s) => s.dailyReviewDismissedDate);
  const dismiss = useStore((s) => s.dismissDailyReview);
  const setActiveProblem = useStore((s) => s.setActiveProblem);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const aiConfig = useStore((s) => s.aiConfig);

  // 没配 AI 别打扰（QuickSetupCard 优先）
  const aiUsable =
    aiConfig.provider === 'ollama'
      ? !!aiConfig.baseUrl?.trim()
      : !!aiConfig.apiKey?.trim();

  // 今天已关过 → 不显示
  const today = todayStr();
  const dismissedToday = dismissedDate === today;

  // 选错题
  const pick = useMemo(() => pickDailyReview(mistakes), [mistakes]);

  if (!aiUsable || dismissedToday || !pick) return null;

  const { mistake, reason } = pick;
  // 该错题的原题是否还在 problems 里？决定「去复习」按钮是激活题还是只跳错题本
  const originalProblem = mistake.problemId
    ? problems.find((p) => p.id === mistake.problemId)
    : null;

  const onGoReview = async () => {
    if (originalProblem) {
      await setActiveProblem(originalProblem.id);
    } else {
      setSidebarTab('mistakes');
    }
    dismiss();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        className="fixed bottom-20 left-4 z-30 w-[340px] glass-card overflow-hidden border-cyan/40"
      >
        <div className="px-3 py-2 flex items-center gap-2 bg-cyan/10 border-b border-cyan/30">
          <CalendarCheck size={14} className="text-cyan" />
          <span className="text-xs font-semibold text-cyan-glow">今日复习</span>
          <button
            onClick={dismiss}
            className="btn-ghost p-1 ml-auto shrink-0"
            title="今天不再提（明天再见）"
          >
            <X size={12} />
          </button>
        </div>
        <div className="px-3 py-3 space-y-2.5">
          <div className="text-[12px] text-ink leading-snug">
            <strong className="text-ink">{mistake.problemTitle}</strong>
            <span className="text-ink-mute ml-1.5 text-[11px]">
              · {mistake.category}
            </span>
          </div>

          <div className="text-[11px] text-ink-mute flex items-center gap-1.5">
            <Clock size={10} />
            {reason}
          </div>

          {mistake.rootCause && (
            <div className="text-[11px] text-ink-dim leading-relaxed line-clamp-3 border-l-2 border-line pl-2 italic">
              {mistake.rootCause}
            </div>
          )}

          {mistake.reviewTips.length > 0 && (
            <div className="text-[11px] text-ink-mute leading-snug">
              <span className="text-warn">提示：</span>
              {mistake.reviewTips[0]}
            </div>
          )}

          <button
            onClick={onGoReview}
            className="btn-primary w-full justify-center text-[12px]"
            type="button"
          >
            {originalProblem ? '激活原题再练一遍' : '去错题本看详情'}
            <ArrowRight size={12} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
