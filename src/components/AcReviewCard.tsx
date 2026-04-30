/**
 * P2 AC 后复盘浮卡：用户提交 AC 后云端生成"你的解法 vs 经典最优 + 变种题"。
 *
 * 出现条件：store.pendingAcReview 非空（由 requestAcReview 写入）
 * 操作：
 *  - ✕ 关掉（仅清 pendingAcReview，不删 problem.acReview 缓存）
 *  - 「再练一道」按钮：触发题库浏览（暂不接，留 hook）
 */
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, X, Lightbulb, ListChecks } from 'lucide-react';
import { useStore } from '../lib/store';

export function AcReviewCard() {
  const pending = useStore((s) => s.pendingAcReview);
  const dismiss = useStore((s) => s.dismissAcReview);
  const problems = useStore((s) => s.problems);
  const setProblemBrowserOpen = useStore((s) => s.setProblemBrowserOpen);

  const problemTitle = pending
    ? problems.find((p) => p.id === pending.problemId)?.title
    : '';

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          className="fixed bottom-20 right-4 z-40 w-[400px] glass-card overflow-hidden border-ok/40"
        >
          <div className="px-3 py-2 flex items-center gap-2 bg-ok/10 border-b border-ok/30">
            <Trophy size={14} className="text-ok" />
            <span className="text-xs font-semibold text-ok">AC 复盘</span>
            {problemTitle && (
              <span className="text-[11px] text-ink-mute truncate">· {problemTitle}</span>
            )}
            <button
              onClick={dismiss}
              className="ml-auto shrink-0 -my-1 -mr-1 w-7 h-7 rounded hover:bg-bg-elev2/60 text-ink-mute hover:text-ink flex items-center justify-center transition"
              title="关闭（缓存已保留，下次进同题仍可在题面 Tab 看到）"
              aria-label="关闭"
            >
              <X size={14} />
            </button>
          </div>
          <div className="px-3 py-3 space-y-3">
            {/* 你的路数 */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-mute font-semibold mb-1">
                你的路数
              </div>
              <div className="text-[12px] text-ink leading-relaxed">
                {pending.passingPattern}
              </div>
            </div>

            {/* 更优解法（可选） */}
            {pending.betterApproach ? (
              <div className="rounded-md border border-warn/30 bg-warn/5 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-warn font-semibold mb-1 flex items-center gap-1">
                  <Lightbulb size={10} />
                  存在更优解法
                </div>
                <div className="text-[12px] text-ink font-medium">
                  {pending.betterApproach.name}
                  <span className="text-[10px] text-ink-mute ml-1.5 font-mono">
                    {pending.betterApproach.complexity}
                  </span>
                </div>
                <div className="text-[11px] text-ink-mute leading-relaxed mt-1">
                  {pending.betterApproach.gist}
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-ok flex items-center gap-1.5">
                <Trophy size={11} />
                你这个解法已经是公认最优路数
              </div>
            )}

            {/* 变种题推荐 */}
            {pending.followUps.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-mute font-semibold mb-1 flex items-center gap-1">
                  <ListChecks size={10} />
                  延伸练
                </div>
                <ul className="space-y-0.5">
                  {pending.followUps.map((f, i) => (
                    <li
                      key={i}
                      className="text-[11px] text-ink-dim leading-snug flex items-start gap-1.5"
                    >
                      <span className="text-accent shrink-0 mt-0.5">·</span>
                      <span className="flex-1">{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => {
                    setProblemBrowserOpen(true);
                    dismiss();
                  }}
                  className="mt-2 text-[11px] text-accent-glow hover:underline inline-flex items-center gap-1"
                  type="button"
                >
                  去题库找一道相似的 →
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
