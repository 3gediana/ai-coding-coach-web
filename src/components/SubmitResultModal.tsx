/**
 * 提交结果 Modal：用户告诉系统这次提交结果是什么（AC/WA/TLE/...）
 * - AC：仅 summarize 知识点（不入错题本）
 * - 非 AC：入错题本 + AI 针对 verdict 类型给针对性分析（含 hack case 等）
 *
 * 可选填错误现象，让 AI 更有针对性
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { CheckCircle2, X, Send } from 'lucide-react';
import { useStore } from '../lib/store';
import type { SubmissionVerdict } from '../core/types';
import { cn } from '../lib/cn';

const VERDICTS: Array<{
  id: SubmissionVerdict;
  label: string;
  color: string;
  hint: string;
}> = [
  { id: 'AC', label: 'AC', color: 'ok', hint: '通过！只总结知识点，不入错题本' },
  { id: 'WA', label: 'WA', color: 'bad', hint: '答案错误，AI 会构造 hack 反例' },
  { id: 'TLE', label: 'TLE', color: 'warn', hint: '超时，AI 重点分析复杂度' },
  { id: 'MLE', label: 'MLE', color: 'warn', hint: '内存超限，AI 分析空间使用' },
  { id: 'RE', label: 'RE', color: 'bad', hint: '运行时错误（越界 / 除零 / 栈溢出）' },
  { id: 'CE', label: 'CE', color: 'bad', hint: '编译错误' },
  { id: 'OTHER', label: '其他', color: 'ink', hint: '其他错误，AI 综合分析' },
];

export function SubmitResultModal() {
  const open = useStore((s) => s.submitModalOpen);
  const setOpen = useStore((s) => s.setSubmitModalOpen);
  const enqueueSummarize = useStore((s) => s.enqueueSummarize);
  const enqueueAnalyze = useStore((s) => s.enqueueAnalyze);
  const activeProblem = useStore((s) => {
    const id = s.activeProblemId;
    return id ? s.problems.find((p) => p.id === id) ?? null : null;
  });

  const [verdict, setVerdict] = useState<SubmissionVerdict | null>(null);
  const [userNote, setUserNote] = useState('');
  const [alsoAnalyze, setAlsoAnalyze] = useState(true);

  // 重置
  useEffect(() => {
    if (open) {
      setVerdict(null);
      setUserNote('');
      setAlsoAnalyze(true);
    }
  }, [open]);

  // Esc 关
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const onSubmit = () => {
    if (!verdict) return;
    const isMistake = verdict !== 'AC';
    enqueueSummarize({
      isMistake,
      verdict,
      userNote: userNote.trim() || undefined,
    });
    // 非 AC + 用户勾选时一并触发深度分析
    if (isMistake && alsoAnalyze) {
      enqueueAnalyze({ reason: `submit-${verdict}` });
    }
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-card w-full max-w-md flex flex-col overflow-hidden"
          >
            <div className="px-5 py-3 border-b border-line flex items-center gap-2">
              <CheckCircle2 size={16} className="text-cyan" />
              <div className="text-sm font-semibold">
                提交结果
                {activeProblem && (
                  <span className="text-ink-mute font-normal ml-1.5">
                    · {activeProblem.title}
                  </span>
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="btn-ghost ml-auto p-1.5"
                aria-label="关闭"
              >
                <X size={14} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-dim font-semibold mb-2">
                  这次提交是？
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {VERDICTS.map((v) => {
                    const active = verdict === v.id;
                    return (
                      <button
                        key={v.id}
                        onClick={() => setVerdict(v.id)}
                        className={cn(
                          'px-2 py-2 rounded-lg border text-xs font-mono font-bold transition',
                          active
                            ? `bg-${v.color}/20 border-${v.color}/60 text-${v.color}`
                            : 'border-line text-ink-dim hover:border-line-strong hover:text-ink',
                          // tailwind purge 兜底
                          v.id === 'AC' && active && 'bg-ok/20 border-ok/60 text-ok',
                          v.id === 'WA' && active && 'bg-bad/20 border-bad/60 text-bad',
                          v.id === 'TLE' && active && 'bg-warn/20 border-warn/60 text-warn',
                          v.id === 'MLE' && active && 'bg-warn/20 border-warn/60 text-warn',
                          v.id === 'RE' && active && 'bg-bad/20 border-bad/60 text-bad',
                          v.id === 'CE' && active && 'bg-bad/20 border-bad/60 text-bad',
                          v.id === 'OTHER' && active && 'bg-accent/20 border-accent/60 text-accent-glow',
                        )}
                      >
                        {v.label}
                      </button>
                    );
                  })}
                </div>
                {verdict && (
                  <div className="text-[11px] text-ink-mute mt-2">
                    {VERDICTS.find((v) => v.id === verdict)?.hint}
                  </div>
                )}
              </div>

              {verdict && verdict !== 'AC' && (
                <>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-dim font-semibold mb-2">
                      你看到了什么错？<span className="text-ink-mute normal-case font-normal">（可选 · AI 会更精准）</span>
                    </div>
                    <textarea
                      value={userNote}
                      onChange={(e) => setUserNote(e.target.value)}
                      rows={3}
                      placeholder={
                        verdict === 'WA'
                          ? '示例：n=5 时输出 8，但答案是 9'
                          : verdict === 'TLE'
                            ? '示例：第 3 个测试点超时'
                            : verdict === 'RE'
                              ? '示例：runtime error: signal 11'
                              : ''
                      }
                      className="input font-mono text-xs resize-none"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-ink-dim cursor-pointer hover:text-ink">
                    <input
                      type="checkbox"
                      checked={alsoAnalyze}
                      onChange={(e) => setAlsoAnalyze(e.target.checked)}
                      className="accent-accent"
                    />
                    顺便对当前代码做一次深度分析（找具体问题行）
                  </label>
                </>
              )}
            </div>

            <div className="px-5 py-3 border-t border-line flex items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} className="btn">
                取消
              </button>
              <button
                onClick={onSubmit}
                disabled={!verdict}
                className="btn-primary"
              >
                <Send size={13} />
                {verdict === 'AC' ? '总结知识点' : '入错题本 · AI 分析'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
