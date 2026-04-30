import { motion, AnimatePresence } from 'framer-motion';
import { Library, BookOpen, History, BarChart3, ChevronLeft, Trash2, Download, CheckCircle2, Clock, Plus, Search, Archive, ArchiveRestore } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import { Dashboard } from './Dashboard';
import { getArea } from '../core/taxonomy';
import { useMemo, useState } from 'react';
import { ResizeHandle } from './ResizeHandle';
import { usePersistedWidth } from '../lib/usePersistedWidth';

type MistakeSort = 'recent' | 'review-due' | 'unreviewed';

const REVIEW_DAYS_THRESHOLD = 3;

export function Sidebar() {
  const tab = useStore((s) => s.sidebarTab);
  const setTab = useStore((s) => s.setSidebarTab);
  const problems = useStore((s) => s.problems);
  const mistakes = useStore((s) => s.mistakes);
  const sessions = useStore((s) => s.sessions);
  const activeProblemId = useStore((s) => s.activeProblemId);
  const setActiveProblem = useStore((s) => s.setActiveProblem);
  const deleteProblem = useStore((s) => s.deleteProblem);
  const toggleArchiveProblem = useStore((s) => s.toggleArchiveProblem);
  const deleteMistake = useStore((s) => s.deleteMistake);
  const markMistakeReviewed = useStore((s) => s.markMistakeReviewed);
  const setProblemEditorOpen = useStore((s) => s.setProblemEditorOpen);
  const setProblemBrowserOpen = useStore((s) => s.setProblemBrowserOpen);

  const [mistakeSort, setMistakeSort] = useState<MistakeSort>('recent');
  const [showArchived, setShowArchived] = useState(false);
  const [panelWidth, setPanelWidth] = usePersistedWidth('aicc.layout.sidebarWidth', 320, 240, 700);

  // 题目分两组：未归档 / 已归档；归档列表按 archivedAt 倒序（最近归档在最前）
  const { activeProblems, archivedProblems } = useMemo(() => {
    const active: typeof problems = [];
    const archived: typeof problems = [];
    for (const p of problems) {
      if (p.archivedAt) archived.push(p);
      else active.push(p);
    }
    archived.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
    return { activeProblems: active, archivedProblems: archived };
  }, [problems]);
  const displayedProblems = showArchived ? archivedProblems : activeProblems;

  // 错题 stats + 排序
  const mistakeStats = useMemo(() => {
    const now = Date.now();
    let reviewed = 0;
    let pending = 0;
    for (const m of mistakes) {
      if (m.reviewedAt) reviewed++;
      else if (now - m.createdAt > REVIEW_DAYS_THRESHOLD * 86_400_000) pending++;
    }
    return {
      total: mistakes.length,
      reviewed,
      pending,
      reviewRate: mistakes.length > 0 ? reviewed / mistakes.length : 0,
    };
  }, [mistakes]);

  const sortedMistakes = useMemo(() => {
    const arr = mistakes.slice();
    const now = Date.now();
    if (mistakeSort === 'review-due') {
      // 待复习优先：未复习且创建越久越靠前
      arr.sort((a, b) => {
        const aDays = a.reviewedAt ? -Infinity : (now - a.createdAt) / 86_400_000;
        const bDays = b.reviewedAt ? -Infinity : (now - b.createdAt) / 86_400_000;
        return bDays - aDays;
      });
    } else if (mistakeSort === 'unreviewed') {
      arr.sort((a, b) => {
        const aR = a.reviewedAt ? 1 : 0;
        const bR = b.reviewedAt ? 1 : 0;
        if (aR !== bR) return aR - bR; // 未复习在前
        return b.createdAt - a.createdAt;
      });
    } else {
      arr.sort((a, b) => b.createdAt - a.createdAt);
    }
    return arr;
  }, [mistakes, mistakeSort]);

  const items = [
    { id: 'problems' as const, icon: Library, label: '题目库', count: activeProblems.length },
    { id: 'mistakes' as const, icon: BookOpen, label: '错题本', count: mistakes.length },
    { id: 'sessions' as const, icon: History, label: '学习记录', count: sessions.length },
    { id: 'dashboard' as const, icon: BarChart3, label: '学习空间', count: undefined },
  ];

  return (
    <div className="flex border-r border-line">
      {/* Rail */}
      <div className="w-14 bg-bg-elev flex flex-col items-center py-3 gap-1.5 border-r border-line">
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
                // 用 bad/warn 色（高饱和），保证米黄 rail 上一眼可见
                <span
                  className={cn(
                    'absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center shadow-sm',
                    it.id === 'mistakes' ? 'bg-bad' : 'bg-cyan',
                  )}
                  style={{ boxShadow: '0 0 0 1.5px rgb(var(--c-bg-elev))' }}
                >
                  {it.count > 99 ? '99+' : it.count}
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
            animate={{ width: panelWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="bg-bg border-r border-line overflow-hidden flex-shrink-0"
          >
            <div style={{ width: `${panelWidth}px` }} className="h-full flex flex-col">
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
                    {/* 顶部：在「日常题目」与「历史记录（已归档）」之间切换 */}
                    {problems.length > 0 && (
                      <li className="flex items-center gap-1 mb-2 px-1">
                        <button
                          onClick={() => setShowArchived(false)}
                          className={cn(
                            'flex-1 px-2 py-1.5 text-[11px] rounded transition flex items-center justify-center gap-1.5',
                            !showArchived
                              ? 'bg-accent/15 text-accent border border-accent/40 font-medium'
                              : 'text-ink-mute hover:bg-bg-elev2 border border-transparent',
                          )}
                          title="日常做的题"
                        >
                          <Library size={12} />
                          日常 ({activeProblems.length})
                        </button>
                        <button
                          onClick={() => setShowArchived(true)}
                          className={cn(
                            'flex-1 px-2 py-1.5 text-[11px] rounded transition flex items-center justify-center gap-1.5',
                            showArchived
                              ? 'bg-accent/15 text-accent border border-accent/40 font-medium'
                              : 'text-ink-mute hover:bg-bg-elev2 border border-transparent',
                          )}
                          title="已归档的题——点击仍可激活，代码/动画/错题史完整保留"
                        >
                          <Archive size={12} />
                          历史 ({archivedProblems.length})
                        </button>
                      </li>
                    )}
                    {problems.length === 0 && (
                      <li className="px-3 py-8 text-center">
                        <div className="text-sm font-semibold text-ink mb-1">还没有题目</div>
                        <div className="text-xs text-ink-mute mb-4 leading-relaxed">
                          先录入一道题，AI 才能结合题面分析代码和错误。
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => setProblemEditorOpen(true)}
                            className="btn-primary justify-center text-xs py-2"
                          >
                            <Plus size={13} />
                            手动录入题面
                          </button>
                          <button
                            onClick={() => setProblemBrowserOpen(true)}
                            className="btn justify-center text-xs py-2"
                          >
                            <Search size={13} />
                            打开 OJ 题库
                          </button>
                        </div>
                      </li>
                    )}
                    {problems.length > 0 && displayedProblems.length === 0 && (
                      <li className="px-3 py-8 text-center text-xs text-ink-mute leading-relaxed">
                        {showArchived ? '还没有归档的题' : '日常列表已清空'}
                        <br />
                        <span className="text-[10.5px]">
                          {showArchived ? '把不再常做的题归档到这里' : '点上方"历史"看归档记录'}
                        </span>
                      </li>
                    )}
                    {displayedProblems.map((p) => {
                      const isArchived = !!p.archivedAt;
                      return (
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
                            isArchived && activeProblemId !== p.id && 'opacity-65',
                          )}
                          title={
                            isArchived
                              ? `已归档于 ${new Date(p.archivedAt!).toLocaleDateString()}\n点击重新激活：代码/动画/错题史完整恢复`
                              : undefined
                          }
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate flex items-center gap-1">
                              {isArchived && (
                                <Archive size={11} className="text-ink-mute shrink-0" aria-label="已归档" />
                              )}
                              <span className="truncate">{p.title}</span>
                            </div>
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
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void toggleArchiveProblem(p.id);
                              }}
                              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition p-1"
                              title={isArchived ? '取消归档（移回日常）' : '归档（移到历史记录）'}
                            >
                              {isArchived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`删除题目 "${p.title}"？\n\n这会同时清空该题的代码、algoViz、错题历史等所有数据。如果只想暂时收起，请用归档。`))
                                  deleteProblem(p.id);
                              }}
                              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition p-1"
                              title="删除题目（不可恢复）"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {tab === 'mistakes' && (
                  <ul className="space-y-2">
                    {mistakes.length === 0 && <Empty text="错题本还是空的，提交错误代码会自动加" />}
                    {mistakes.length > 0 && (
                      <>
                        {/* 复习状态总览 */}
                        <li className="glass-card p-2.5 mb-2">
                          <div className="flex items-center gap-2 text-[10px] mb-1.5">
                            <span className="text-ink-mute">复习进度</span>
                            <span className="font-mono font-bold text-ink">
                              {mistakeStats.reviewed} / {mistakeStats.total}
                            </span>
                            <span className="ml-auto text-ink-mute">
                              {Math.round(mistakeStats.reviewRate * 100)}%
                            </span>
                          </div>
                          <div className="h-1.5 bg-bg-elev2/50 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-ok/60 rounded-full transition-all"
                              style={{ width: `${mistakeStats.reviewRate * 100}%` }}
                            />
                          </div>
                          {mistakeStats.pending > 0 && (
                            <div className="flex items-center gap-1 mt-1.5 text-[10px] text-warn">
                              <Clock size={10} />
                              <span>{mistakeStats.pending} 道错题超过 {REVIEW_DAYS_THRESHOLD} 天未复习</span>
                            </div>
                          )}
                        </li>
                        {/* 排序 + 导出 */}
                        <li className="flex items-center gap-1 text-[10px] -mb-1 flex-wrap">
                          <span className="text-ink-mute">排序</span>
                          {(['recent', 'review-due', 'unreviewed'] as const).map((s) => (
                            <button
                              key={s}
                              onClick={() => setMistakeSort(s)}
                              className={cn(
                                'chip text-[9px] px-1.5 py-0 cursor-pointer transition',
                                mistakeSort === s
                                  ? 'border-accent/60 bg-accent/15 text-accent-glow'
                                  : 'hover:border-accent/40',
                              )}
                            >
                              {s === 'recent' ? '最新' : s === 'review-due' ? '待复习' : '未复习'}
                            </button>
                          ))}
                          <button
                            className="chip ml-auto hover:border-accent/40 cursor-pointer flex items-center gap-1"
                            title="导出为单文件 Markdown。可发到 Notion / 飞书 / GitHub"
                            onClick={async () => {
                              const { exportMistakesToMarkdown } = await import('../lib/exportMistakes');
                              exportMistakesToMarkdown(mistakes);
                            }}
                          >
                            <Download size={10} /> MD
                          </button>
                          <button
                            className="chip hover:border-accent/40 cursor-pointer flex items-center gap-1"
                            title="导出为 Anki .csv（Tab 分隔）"
                            onClick={async () => {
                              const { exportMistakesToAnki } = await import('../lib/exportMistakes');
                              exportMistakesToAnki(mistakes);
                            }}
                          >
                            <Download size={10} /> Anki
                          </button>
                        </li>
                      </>
                    )}
                    {sortedMistakes.map((m) => (
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
                          <div className="mt-1.5 px-2 py-1 bg-bg-elev rounded text-[11px] text-ink-dim italic">
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
                        {/* 复习状态 + 操作 */}
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-line/40 text-[10px]">
                          {m.reviewedAt ? (
                            <span className="flex items-center gap-1 text-ok">
                              <CheckCircle2 size={10} />
                              已复习 {m.reviewCount > 1 ? `×${m.reviewCount}` : ''}
                              <span className="text-ink-mute ml-1">
                                {new Date(m.reviewedAt).toLocaleDateString()}
                              </span>
                            </span>
                          ) : (
                            (() => {
                              const days = (Date.now() - m.createdAt) / 86_400_000;
                              return (
                                <span className={cn(
                                  'flex items-center gap-1',
                                  days > REVIEW_DAYS_THRESHOLD ? 'text-warn' : 'text-ink-mute',
                                )}>
                                  <Clock size={10} />
                                  {days < 1
                                    ? '今天创建'
                                    : `${Math.floor(days)} 天前创建`}
                                  {days > REVIEW_DAYS_THRESHOLD && '（待复习）'}
                                </span>
                              );
                            })()
                          )}
                          <button
                            onClick={() => markMistakeReviewed(m.id)}
                            className="ml-auto chip text-[9px] px-1.5 py-0 hover:border-ok/60 cursor-pointer"
                            title={m.reviewedAt ? '再复习一次' : '标记为已复习'}
                          >
                            <CheckCircle2 size={9} /> 复习
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('删除这条错题？')) deleteMistake(m.id);
                            }}
                            className="text-ink-mute hover:text-bad transition opacity-0 group-hover:opacity-100"
                            title="删除"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
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
      {/* 分隔条：仅在 panel 展开时显示，VSCode 风格可拖拽 */}
      {tab && (
        <ResizeHandle
          direction="right"
          currentWidth={panelWidth}
          onResize={setPanelWidth}
          min={240}
          max={700}
        />
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="px-4 py-8 text-center text-xs text-ink-mute">{text}</div>
  );
}
