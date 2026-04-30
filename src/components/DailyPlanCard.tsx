/**
 * B 路线 — 学习规划 Agent 浮卡（multi-agent 编排成果展示）。
 *
 * 这是项目"创新性 20%"的主打 UI：每天首次开 app 时，3 个子 Agent 协作生成今日计划，
 * 卡片顶部居中浮起，让评委一眼看到"AI 自主规划学习路径"。
 *
 * 状态：
 *   - generating：spinner + "学习规划 Agent 正在分析你的学习历史…"（含子 Agent 进度）
 *   - pending：完整计划 + 接受/拒绝/重新规划
 *   - accepted：紧凑式进度条 + 步骤勾选
 *   - declined：隐藏（用户可在 TopBar 通过 "重置今日计划" 重新唤起）
 */
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  X,
  RefreshCw,
  Check,
  Loader2,
  ChevronDown,
  ChevronUp,
  Target,
  BookOpen,
  RotateCcw,
  Lightbulb,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import { toast } from 'sonner';

const KIND_META: Record<
  'new-problem' | 'review-mistake' | 'concept-recall',
  { icon: typeof Target; label: string; color: string }
> = {
  'new-problem': { icon: Target, label: '新题', color: 'text-accent' },
  'review-mistake': { icon: RotateCcw, label: '复习', color: 'text-warn' },
  'concept-recall': { icon: BookOpen, label: '概念', color: 'text-cyan' },
};

export function DailyPlanCard() {
  const dailyPlan = useStore((s) => s.dailyPlan);
  const dailyPlanGenerating = useStore((s) => s.dailyPlanGenerating);
  const requestDailyPlan = useStore((s) => s.requestDailyPlan);
  const acceptDailyPlan = useStore((s) => s.acceptDailyPlan);
  const declineDailyPlan = useStore((s) => s.declineDailyPlan);
  const toggleDailyPlanStep = useStore((s) => s.toggleDailyPlanStep);
  const addBankProblem = useStore((s) => s.addBankProblem);
  const setActiveProblem = useStore((s) => s.setActiveProblem);
  const mistakes = useStore((s) => s.mistakes);
  const setSidebarTab = useStore((s) => s.setSidebarTab);

  const [collapsed, setCollapsed] = useState(false);

  const completionRatio = useMemo(() => {
    if (!dailyPlan || dailyPlan.plan.steps.length === 0) return 0;
    return dailyPlan.completedStepIndices.length / dailyPlan.plan.steps.length;
  }, [dailyPlan]);

  // 生成中：右下角紧凑 chip（不再顶部居中大卡，避免抢用户视线）
  if (dailyPlanGenerating && !dailyPlan) {
    return (
      <motion.div
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="fixed bottom-3 right-3 z-30 glass-card px-2.5 py-1.5 flex items-center gap-2 border-accent/30 max-w-[260px]"
        title="学情诊断 → 题目筛选 → 计划编排（详情见 Agent 行动面板）"
      >
        <Loader2 size={12} className="text-accent animate-spin shrink-0" />
        <span className="text-[11px] text-ink-dim truncate">
          学习规划 Agent 编排中…
        </span>
      </motion.div>
    );
  }

  if (!dailyPlan || dailyPlan.status === 'declined') return null;

  // accepted 状态：紧凑式进度条
  if (dailyPlan.status === 'accepted') {
    const completedCount = dailyPlan.completedStepIndices.length;
    const totalCount = dailyPlan.plan.steps.length;
    const allDone = completedCount === totalCount;
    return (
      <motion.div
        initial={{ y: -8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="fixed top-14 left-1/2 -translate-x-1/2 z-30 glass-card border-accent/30 max-w-lg w-[min(560px,calc(100vw-32px))]"
      >
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="w-full px-3 py-2 flex items-center gap-2 hover:bg-bg-elev2/40"
        >
          <Sparkles size={13} className={cn(allDone ? 'text-ok' : 'text-accent')} />
          <span className="text-[12px] font-semibold flex-1 text-left truncate">
            {allDone ? '✅ 今日计划已完成' : `今日计划：${dailyPlan.plan.headline}`}
          </span>
          <span className="text-[11px] text-ink-mute shrink-0 font-mono">
            {completedCount}/{totalCount}
          </span>
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
        {/* 进度条 */}
        <div className="h-0.5 bg-bg-elev2 relative">
          <div
            className={cn(
              'absolute left-0 top-0 h-full transition-all',
              allDone ? 'bg-ok' : 'bg-accent',
            )}
            style={{ width: `${completionRatio * 100}%` }}
          />
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <ul className="px-3 py-2 space-y-1.5 border-t border-line/40">
                {dailyPlan.plan.steps.map((step, idx) => {
                  const done = dailyPlan.completedStepIndices.includes(idx);
                  const meta = KIND_META[step.kind];
                  const Icon = meta.icon;
                  return (
                    <li
                      key={idx}
                      className={cn(
                        'flex items-start gap-2 text-[11px] py-1 px-1.5 rounded hover:bg-bg-elev2/40 cursor-pointer transition',
                        done && 'opacity-60',
                      )}
                      onClick={async () => {
                        toggleDailyPlanStep(idx);
                        // 顺手激活该题（如果还没添加）
                        if (step.bankId) {
                          await addBankProblem(step.bankId);
                        } else if (step.mistakeId) {
                          const m = mistakes.find((x) => x.id === step.mistakeId);
                          if (m?.problemId) {
                            await setActiveProblem(m.problemId);
                          } else {
                            setSidebarTab('mistakes');
                          }
                        }
                      }}
                    >
                      <div
                        className={cn(
                          'w-3.5 h-3.5 rounded border shrink-0 mt-0.5 flex items-center justify-center transition',
                          done
                            ? 'bg-ok border-ok'
                            : 'border-line hover:border-accent',
                        )}
                      >
                        {done && <Check size={9} className="text-bg" strokeWidth={3} />}
                      </div>
                      <Icon size={11} className={cn('shrink-0 mt-0.5', meta.color)} />
                      <div className="flex-1 min-w-0">
                        <div
                          className={cn(
                            'font-medium truncate',
                            done && 'line-through text-ink-mute',
                          )}
                        >
                          {step.title}
                        </div>
                        <div className="text-[10px] text-ink-mute truncate">
                          {step.reason} · {step.estimatedMinutes} 分钟
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {dailyPlan.plan.encouragement && (
                <div className="px-3 py-1.5 text-[11px] text-ink-mute italic border-t border-line/30">
                  💪 {dailyPlan.plan.encouragement}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  // pending 状态：完整卡片 + 决策按钮
  return (
    <motion.div
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed top-14 left-1/2 -translate-x-1/2 z-30 glass-card border-accent/40 max-w-lg w-[min(560px,calc(100vw-32px))] overflow-hidden"
    >
      <div className="px-4 py-2.5 bg-accent/10 border-b border-accent/30 flex items-center gap-2">
        <Sparkles size={14} className="text-accent" />
        <span className="text-xs font-semibold text-accent-glow">
          🤖 今日学习计划（multi-Agent 编排）
        </span>
        <span className="text-[10px] text-ink-mute ml-auto">
          {dailyPlan.plan.estimatedMinutes} 分钟 · {dailyPlan.plan.steps.length} 步
        </span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {/* 头条 */}
        <div className="flex items-start gap-2">
          <Target size={14} className="text-accent shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-ink leading-snug">
              {dailyPlan.plan.headline}
            </div>
            <div className="text-[10px] text-ink-mute mt-0.5">
              基于薄弱点：{dailyPlan.diagnosis.weakConcepts.join(' / ') || '（暂无）'}
            </div>
          </div>
        </div>

        {/* 学习路径 */}
        <ol className="space-y-1.5">
          {dailyPlan.plan.steps.map((step, idx) => {
            const meta = KIND_META[step.kind];
            const Icon = meta.icon;
            return (
              <li
                key={idx}
                className="flex items-start gap-2 text-[12px] py-1.5 px-2 rounded bg-bg-elev2/30"
              >
                <span className="text-[10px] font-mono text-ink-mute shrink-0 mt-0.5">
                  {idx + 1}.
                </span>
                <Icon size={11} className={cn('shrink-0 mt-0.5', meta.color)} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium leading-snug">
                    <span className={cn('text-[10px] mr-1.5', meta.color)}>
                      [{meta.label}]
                    </span>
                    {step.title}
                  </div>
                  <div className="text-[10px] text-ink-mute leading-snug mt-0.5">
                    {step.reason} · 估时 {step.estimatedMinutes} 分钟
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {/* 鼓励 */}
        {dailyPlan.plan.encouragement && (
          <div className="text-[11px] text-ink-mute italic border-l-2 border-accent/40 pl-2 py-0.5">
            <Lightbulb size={10} className="inline-block text-warn mr-1 mb-0.5" />
            {dailyPlan.plan.encouragement}
          </div>
        )}
      </div>

      {/* 操作 */}
      <div className="px-4 py-2.5 border-t border-line flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            declineDailyPlan();
            toast.message('今日计划已隐藏');
          }}
          className="btn text-[11px]"
        >
          <X size={11} /> 不用
        </button>
        <button
          type="button"
          onClick={async () => {
            const ok = window.confirm('重新规划会再调一次 3 个 Agent，会消耗 token，确定？');
            if (!ok) return;
            await requestDailyPlan({ force: true });
          }}
          className="btn text-[11px]"
          disabled={dailyPlanGenerating}
        >
          <RefreshCw size={11} /> 重新规划
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            acceptDailyPlan();
            toast.success('今日计划已接受', {
              description: '在卡片里勾选完成项即可',
            });
          }}
          className="btn-primary text-[11px]"
        >
          <Check size={11} /> 接受并开始
        </button>
      </div>
    </motion.div>
  );
}
