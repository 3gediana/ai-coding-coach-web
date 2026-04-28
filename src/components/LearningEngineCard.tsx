/**
 * 学习引擎卡片：Dashboard 顶部
 *   - 上方：进度概览（数字 + 一句话状态）
 *   - 下方：1-4 张行动卡（错题复习 / 新题 / 错点回顾 / 浏览）
 *   - 右上 ✕ 关闭今天
 *
 * 数据来自 store.learningOverview / learningCards
 * mount 时主动刷新一次（捕获最新错题 / 已做题）
 */
import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Target, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import type { LearningCard } from '../core/recommend';

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function LearningEngineCard() {
  const overview = useStore((s) => s.learningOverview);
  const cards = useStore((s) => s.learningCards);
  const dismissedDate = useStore((s) => s.learningCardDismissedDate);
  const refresh = useStore((s) => s.refreshLearningEngine);
  const dismiss = useStore((s) => s.dismissLearningCard);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const setActiveProblem = useStore((s) => s.setActiveProblem);
  const addBankProblem = useStore((s) => s.addBankProblem);
  const mistakes = useStore((s) => s.mistakes);
  const problems = useStore((s) => s.problems);

  // 进入 Dashboard 时刷新一次
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 错题/已做题变化时也重算（节流由 React batching 处理）
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mistakes.length, problems.length]);

  const isDismissedToday = useMemo(
    () => dismissedDate === todayString(),
    [dismissedDate],
  );

  // 隐藏条件：今天关过 / 没数据
  if (isDismissedToday || !overview || cards.length === 0) {
    return null;
  }

  const handleCardClick = async (card: LearningCard) => {
    if (card.action.type === 'open-mistakes') {
      setSidebarTab('mistakes');
      return;
    }
    if (card.action.type === 'open-problem') {
      const pid = card.action.problemId;
      await setActiveProblem(pid);
      // 复习模式联动：如果这题在错题本里有未复习，浮 toast 显示错因 + 提示「AC 即为复习」
      if (card.kind === 'review-mistakes') {
        const m = mistakes.find((x) => x.problemId === pid && !x.reviewedAt);
        if (m) {
          toast.info(`📝 复习模式：${m.problemTitle}`, {
            description: `上次错因：${m.rootCause}\n提交 AC 后会自动标记已复习`,
            duration: 8000,
          });
        }
      }
      return;
    }
    if (card.action.type === 'add-bank') {
      await addBankProblem(card.action.bankId);
      return;
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        className="glass-card p-3 space-y-2.5 relative overflow-hidden"
      >
        {/* 装饰：左上角 accent 渐变 */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-accent/10 rounded-full blur-2xl pointer-events-none" />

        {/* 标题行 */}
        <div className="flex items-center gap-2 relative">
          <Target size={14} className="text-accent" />
          <span className="text-xs font-semibold">今日学习</span>
          <span className="text-[10px] text-ink-mute ml-auto">{todayString()}</span>
          <button
            onClick={() => dismiss()}
            className="btn-ghost p-1"
            title="今天不再显示"
          >
            <X size={11} />
          </button>
        </div>

        {/* 进度数字行 */}
        <div className="flex items-baseline gap-3 text-[11px] text-ink-mute relative flex-wrap">
          <span>
            <span className="text-ink font-mono font-semibold text-sm">
              {overview.problemsTotal}
            </span>{' '}
            题
          </span>
          <span className="opacity-50">·</span>
          <span>
            错题{' '}
            <span className={cn('font-mono font-semibold text-sm', overview.mistakesTotal > 0 ? 'text-bad' : 'text-ink')}>
              {overview.mistakesTotal}
            </span>
          </span>
          {overview.mistakesTotal > 0 && (
            <>
              <span className="opacity-50">·</span>
              <span>
                复习{' '}
                <span className={cn('font-mono font-semibold text-sm', overview.reviewedRate >= 0.6 ? 'text-ok' : 'text-warn')}>
                  {Math.round(overview.reviewedRate * 100)}%
                </span>
              </span>
            </>
          )}
          <span className="opacity-50">·</span>
          <span>
            本周{' '}
            <span className="text-ink font-mono font-semibold text-sm">{overview.weekActivity}</span>
          </span>
        </div>

        {/* 状态文案 */}
        <div className="text-[11px] text-ink-dim relative flex items-center gap-1.5">
          <Sparkles size={10} className="text-accent shrink-0" />
          {overview.hint}
        </div>

        {/* 行动卡 */}
        <div className="grid gap-2 relative" style={{ gridTemplateColumns: `repeat(${Math.min(cards.length, 3)}, minmax(0, 1fr))` }}>
          {cards.map((card, i) => (
            <ActionCard key={card.kind + '-' + i} card={card} onClick={() => handleCardClick(card)} />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function ActionCard({ card, onClick }: { card: LearningCard; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'group relative text-left rounded-lg border transition-all p-2.5 cursor-pointer min-h-[64px]',
        card.primary
          ? 'border-accent/60 bg-accent/10 hover:bg-accent/15 hover:border-accent'
          : 'border-line bg-bg-elev/40 hover:bg-bg-elev hover:border-line/80',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="text-base leading-none mt-0.5">{card.icon}</span>
        <div className="min-w-0 flex-1">
          <div className={cn('text-[11px] font-semibold leading-tight', card.primary && 'text-accent-glow')}>
            {card.title}
          </div>
          <div className="text-[10px] text-ink-mute mt-0.5 truncate">{card.subtitle}</div>
        </div>
      </div>
    </motion.button>
  );
}
