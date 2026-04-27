import { motion, AnimatePresence } from 'framer-motion';
import { Library, BookOpen, History, BarChart3, ChevronLeft, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import { Dashboard } from './Dashboard';
import { getArea } from '../core/taxonomy';

export function Sidebar() {
  const tab = useStore((s) => s.sidebarTab);
  const setTab = useStore((s) => s.setSidebarTab);
  const problems = useStore((s) => s.problems);
  const mistakes = useStore((s) => s.mistakes);
  const sessions = useStore((s) => s.sessions);
  const activeProblemId = useStore((s) => s.activeProblemId);
  const setActiveProblem = useStore((s) => s.setActiveProblem);
  const deleteProblem = useStore((s) => s.deleteProblem);
  const deleteMistake = useStore((s) => s.deleteMistake);

  const items = [
    { id: 'problems' as const, icon: Library, label: '题目库', count: problems.length },
    { id: 'mistakes' as const, icon: BookOpen, label: '错题本', count: mistakes.length },
    { id: 'sessions' as const, icon: History, label: '学习记录', count: sessions.length },
    { id: 'dashboard' as const, icon: BarChart3, label: '学习空间', count: undefined },
  ];

  return (
    <div className="flex border-r border-line">
      {/* Rail */}
      <div className="w-14 bg-bg-elev/50 flex flex-col items-center py-3 gap-1.5 border-r border-line">
        {items.map((it) => {
          const active = tab === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setTab(active ? null : it.id)}
              className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center relative transition-all',
                active
                  ? 'bg-accent/20 text-accent-glow shadow-glow'
                  : 'text-ink-dim hover:text-ink hover:bg-bg-elev2',
              )}
              title={it.label}
            >
              <it.icon size={18} />
              {it.count !== undefined && it.count > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-[9px] font-bold text-white flex items-center justify-center">
                  {it.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panel */}
      <AnimatePresence initial={false}>
        {tab && (
          <motion.div
            key={tab}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="bg-bg-elev/40 border-r border-line overflow-hidden"
          >
            <div className="w-[320px] h-full flex flex-col">
              <div className="h-12 flex items-center justify-between px-4 border-b border-line">
                <span className="font-semibold text-sm">
                  {items.find((i) => i.id === tab)?.label}
                </span>
                <button onClick={() => setTab(null)} className="btn-ghost p-1">
                  <ChevronLeft size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {tab === 'problems' && (
                  <ul className="space-y-1">
                    {problems.length === 0 && <Empty text="还没录入题目，点顶部 + 录入" />}
                    {problems.map((p) => (
                      <li
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setActiveProblem(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setActiveProblem(p.id);
                        }}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-lg group transition flex items-start gap-2 cursor-pointer',
                          activeProblemId === p.id
                            ? 'bg-accent/15 border border-accent/40'
                            : 'hover:bg-bg-elev2 border border-transparent',
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{p.title}</div>
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {p.difficulty && (
                              <span
                                className={cn(
                                  'chip text-[9px] px-1.5 py-0',
                                  p.difficulty === 'easy' && 'chip-ok',
                                  p.difficulty === 'medium' && 'chip-warn',
                                  p.difficulty === 'hard' && 'chip-bad',
                                )}
                              >
                                {p.difficulty}
                              </span>
                            )}
                            {p.tags?.slice(0, 3).map((t) => (
                              <span key={t} className="chip text-[9px] px-1.5 py-0">
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`删除题目 "${p.title}"？`)) deleteProblem(p.id);
                          }}
                          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition p-1 shrink-0"
                          title="删除题目"
                        >
                          <Trash2 size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {tab === 'mistakes' && (
                  <ul className="space-y-2">
                    {mistakes.length === 0 && <Empty text="错题本还是空的，提交错误代码会自动加" />}
                    {mistakes.map((m) => (
                      <li
                        key={m.id}
                        className="glass-card p-3 group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              {m.verdict && (
                                <span
                                  className={cn(
                                    'text-[9px] font-mono font-bold px-1.5 py-0.5 rounded',
                                    m.verdict === 'WA' && 'bg-bad/15 text-bad',
                                    m.verdict === 'TLE' && 'bg-warn/15 text-warn',
                                    m.verdict === 'MLE' && 'bg-warn/15 text-warn',
                                    m.verdict === 'RE' && 'bg-bad/15 text-bad',
                                    m.verdict === 'CE' && 'bg-bad/15 text-bad',
                                    m.verdict === 'OTHER' && 'bg-accent/15 text-accent-glow',
                                  )}
                                >
                                  {m.verdict}
                                </span>
                              )}
                              <div className="text-sm font-medium truncate">{m.problemTitle}</div>
                            </div>
                            <div className="text-[11px] text-ink-dim mt-0.5">
                              {new Date(m.createdAt).toLocaleString()}
                            </div>
                          </div>
                          <span className="chip-warn text-[10px]">{m.category}</span>
                        </div>
                        {m.userNote && (
                          <div className="mt-1.5 px-2 py-1 bg-bg-elev/40 rounded text-[11px] text-ink-dim italic">
                            "{m.userNote}"
                          </div>
                        )}
                        <p className="text-xs text-ink-dim mt-2 line-clamp-2">{m.rootCause}</p>
                        {m.areaCodes && m.areaCodes.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {m.areaCodes.map((code) => {
                              const a = getArea(code);
                              if (!a) return null;
                              return (
                                <span
                                  key={code}
                                  className="text-[9px] px-1.5 py-0.5 rounded bg-cyan/15 text-cyan border border-cyan/30 font-mono"
                                  title={`${a.grade} · ${a.cluster} · ${a.description}`}
                                >
                                  {a.grade} · {a.name}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {m.knowledgePoints?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {m.knowledgePoints.slice(0, 4).map((k) => (
                              <span key={k} className="chip text-[9px] px-1.5 py-0">
                                {k}
                              </span>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => {
                            if (confirm('删除这条错题？')) deleteMistake(m.id);
                          }}
                          className="mt-2 text-[11px] text-ink-mute hover:text-bad transition opacity-0 group-hover:opacity-100"
                        >
                          删除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {tab === 'sessions' && (
                  <ul className="space-y-1">
                    {sessions.length === 0 && <Empty text="尚未记录会话" />}
                    {sessions.slice(0, 30).map((s) => (
                      <li key={s.id} className="px-3 py-2 rounded-lg hover:bg-bg-elev2 text-xs">
                        <div className="font-medium truncate">{s.problemTitle ?? '(无题目)'}</div>
                        <div className="text-ink-dim mt-0.5">
                          {new Date(s.startedAt).toLocaleString()} · 分析 {s.analyzeCount} 次
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {tab === 'dashboard' && <Dashboard />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="px-4 py-8 text-center text-xs text-ink-mute">{text}</div>
  );
}
