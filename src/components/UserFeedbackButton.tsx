import { FormEvent, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, MessageSquarePlus, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store';

const CATEGORY_LABELS = {
  bug: 'Bug / 异常',
  idea: '功能建议',
  ux: '体验反馈',
  praise: '好用的点',
};

type FeedbackCategory = keyof typeof CATEGORY_LABELS;

export function UserFeedbackButton({ variant = 'floating' }: { variant?: 'floating' | 'rail' }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>('ux');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const activeProblemId = useStore((s) => s.activeProblemId);
  const problems = useStore((s) => s.problems);
  const filesByScope = useStore((s) => s.filesByScope);
  const activeFileIdByScope = useStore((s) => s.activeFileIdByScope);

  const activeProblem = activeProblemId ? problems.find((p) => p.id === activeProblemId) : null;
  const scope = activeProblemId ?? '__draft__';
  const activeFile = (filesByScope[scope] ?? []).find((f) => f.id === activeFileIdByScope[scope]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting]);

  const reset = () => {
    setCategory('ux');
    setContent('');
    setContact('');
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (trimmed.length < 2) {
      toast.error('反馈内容太短');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/__aicc-feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category,
          categoryLabel: CATEGORY_LABELS[category],
          content: trimmed,
          summary: trimmed.split('\n')[0].slice(0, 80),
          contact: contact.trim() || undefined,
          createdAt: Date.now(),
          url: typeof window !== 'undefined' ? window.location.href : undefined,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          viewport: typeof window !== 'undefined'
            ? { width: window.innerWidth, height: window.innerHeight }
            : undefined,
          problem: activeProblem
            ? {
                id: activeProblem.id,
                title: activeProblem.title,
                source: activeProblem.source,
              }
            : null,
          file: activeFile
            ? {
                id: activeFile.id,
                name: activeFile.name,
                language: activeFile.language,
                updatedAt: activeFile.updatedAt,
              }
            : null,
        }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; path?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('反馈已保存到本地文件', {
        description: data.path ? data.path.replace(/^.*dev-workspace[\\/]/, 'dev-workspace/') : undefined,
      });
      reset();
      setOpen(false);
    } catch (err) {
      toast.error('反馈保存失败', {
        description: String((err as Error)?.message ?? err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === 'rail'
            ? 'w-12 py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 relative transition-all text-ink-dim hover:text-ink hover:bg-bg-elev2'
            : 'fixed left-4 bottom-4 z-40 h-9 px-3 rounded-full glass border border-accent/30 shadow-soft text-xs text-ink-dim hover:text-ink hover:border-accent/60 hover:bg-bg-elev2 transition flex items-center gap-2'
        }
        title="提交反馈"
      >
        <MessageSquarePlus size={variant === 'rail' ? 17 : 14} className="text-cyan" />
        <span className={variant === 'rail' ? 'text-[9.5px] leading-none' : undefined}>反馈</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !submitting && setOpen(false)}
            className="fixed inset-0 z-50 modal-overlay flex items-end justify-start p-4 sm:p-6"
          >
            <motion.form
              initial={{ y: 18, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 18, opacity: 0, scale: 0.98 }}
              onSubmit={onSubmit}
              onClick={(e) => e.stopPropagation()}
              className="glass-card w-full max-w-md overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                <MessageSquarePlus size={16} className="text-cyan" />
                <div>
                  <div className="text-sm font-semibold">提交反馈</div>
                  <div className="text-[11px] text-ink-mute">会保存到本地真实文件</div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="btn-ghost p-1.5 ml-auto"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-[11px] text-ink-mute">类型</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
                    disabled={submitting}
                    className="input text-xs w-full"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-[11px] text-ink-mute">反馈内容</span>
                  <textarea
                    autoFocus
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    disabled={submitting}
                    rows={7}
                    className="input w-full resize-none text-xs leading-relaxed"
                    placeholder="哪里不好用？遇到了什么 bug？希望怎么改？"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-[11px] text-ink-mute">联系方式（可选）</span>
                  <input
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    disabled={submitting}
                    className="input w-full text-xs"
                    placeholder="QQ / 微信 / 邮箱，方便追问"
                  />
                </label>

                <div className="rounded-md border border-line bg-bg-elev/40 px-3 py-2 text-[11px] text-ink-mute leading-relaxed">
                  {activeProblem ? `当前题目：${activeProblem.title}` : '当前没有激活题目'}
                  {activeFile ? ` · 文件：${activeFile.name}` : ''}
                </div>
              </div>

              <div className="px-4 py-3 border-t border-line bg-bg-elev/30 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="btn-ghost text-xs"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting || content.trim().length < 2}
                  className="btn-primary text-xs"
                >
                  {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  保存反馈
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
