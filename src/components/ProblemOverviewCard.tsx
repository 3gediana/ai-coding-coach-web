/**
 * P1 题眼速读卡：激活题目时云端生成的「头条 + 注意点」，固定在编辑器顶部。
 *
 * 显示条件：activeProblemId 存在 + 题目有 coachOverview + 没被用户本会话关掉
 * 不挡操作：失败 / 没生成 → 卡片整体不渲染
 *
 * UX 决策：
 * - 折叠式：默认展开 1 行 headline + notes，点 - 收起只剩 headline
 * - ✕ 关闭：只本会话隐藏，不清缓存（下次进 app 还在）
 * - 「重新生成」：用 force 跳过缓存重新调云端（用户觉得 AI 抓得不对时用）
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, X, RefreshCw, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import { useOnlineStatus } from '../lib/offlineMode';

export function ProblemOverviewCard() {
  const activeProblemId = useStore((s) => s.activeProblemId);
  const problems = useStore((s) => s.problems);
  const dismissedIds = useStore((s) => s.overviewDismissedProblemIds);
  const dismiss = useStore((s) => s.dismissProblemOverview);
  const requestOverview = useStore((s) => s.requestProblemOverview);
  const offline = useOnlineStatus() !== 'online';

  // 默认折叠：编辑器顶部只显示 headline 一行；详细 notes 在右栏「题目」Tab 已有，避免重复
  const [collapsed, setCollapsed] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  if (!activeProblemId) return null;
  const problem = problems.find((p) => p.id === activeProblemId);
  if (!problem) return null;
  if (dismissedIds.includes(activeProblemId)) return null;
  const overview = problem.coachOverview;
  if (!overview || !overview.headline) return null;

  const onRegenerate = async () => {
    setRegenerating(true);
    try {
      await requestOverview(activeProblemId, { force: true });
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key={activeProblemId}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18 }}
        className="border-b border-line/60 bg-gradient-to-r from-accent/5 via-bg-elev/40 to-bg-elev/30 backdrop-blur-sm shrink-0"
      >
        <div className="px-3 py-2 flex items-start gap-2">
          <Target size={14} className="text-accent shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            {/* 头条 */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-accent font-semibold">
                题眼
              </span>
              <span className="text-[12px] text-ink font-medium leading-snug flex-1 truncate">
                {overview.headline}
              </span>
            </div>

            {/* 注意点（折叠时隐藏） */}
            {!collapsed && overview.notes.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 pl-1">
                {overview.notes.map((n, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-ink-mute leading-snug flex items-start gap-1.5"
                  >
                    <span className="text-warn shrink-0 mt-0.5">·</span>
                    <span className="flex-1 break-words">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className={cn(
                'p-1 rounded text-ink-mute hover:text-accent hover:bg-bg-elev2',
                regenerating && 'animate-spin text-accent',
              )}
              title={offline ? '重新生成（本地 Ollama 再读一次）' : '重新生成（云端再读一次）'}
              type="button"
            >
              {regenerating ? <Loader2 size={11} /> : <RefreshCw size={11} />}
            </button>
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="p-1 rounded text-ink-mute hover:text-ink hover:bg-bg-elev2"
              title={collapsed ? '展开注意点' : '只看题眼一句'}
              type="button"
            >
              {collapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            </button>
            <button
              onClick={() => dismiss(activeProblemId)}
              className="p-1 rounded text-ink-mute hover:text-bad hover:bg-bg-elev2"
              title="本会话隐藏（不删缓存）"
              type="button"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
