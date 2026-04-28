/**
 * OJ 题库浏览器（实时抓取）：
 *   - 选 OJ → 自动加载第 1 页（首次抓 OJ；之后用 localStorage 缓存）
 *   - 加载下一页 → 增量 merge 进缓存
 *   - 刷新 → 重抓当前页（覆盖）
 *   - 缓存按 site 独立持久化，下次打开立即显示，后台不阻塞
 *
 * 没有任何"内置题单"，全部数据来自 OJ。
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Loader2, Plus, ExternalLink, CheckCircle2, Library,
  RefreshCw, Trash2, Search, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';
import { useStore } from '../lib/store';
import { storage } from '../lib/storage';
import { fetchAndParseProblem, FetchProblemError, type FetchedProblem } from '../lib/fetchProblem';
import {
  fetchProblemListPage,
  loadListCache,
  mergeListPage,
  clearListCache,
  getCachedItems,
  type ListSite,
  type ListItem,
} from '../lib/fetchProblemList';
import type { Problem } from '../core/types';
import { MathMarkdown } from './MathMarkdown';
import { cn } from '../lib/cn';

const SITES: { site: ListSite; label: string; domain: string; hint: string }[] = [
  { site: 'luogu', label: '洛谷', domain: 'luogu.com.cn', hint: '中文 OJ · 题面带 LaTeX · 适合 OI/CSP' },
  { site: 'atcoder', label: 'AtCoder', domain: 'atcoder.jp', hint: '只列 ABC 比赛 · 难度递增的 A-G 题' },
  { site: 'poj', label: 'POJ', domain: 'poj.org', hint: '老牌经典 OJ · 大学课程指定题' },
  { site: 'hdu', label: 'HDU', domain: 'acm.hdu.edu.cn', hint: '杭电 OJ · 题面简洁' },
];

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function ProblemBrowserModal() {
  const open = useStore((s) => s.problemBrowserOpen);
  const setOpen = useStore((s) => s.setProblemBrowserOpen);
  const problems = useStore((s) => s.problems);
  const refreshProblems = useStore((s) => s.refreshProblems);
  const setActiveProblem = useStore((s) => s.setActiveProblem);

  const [activeSite, setActiveSite] = useState<ListSite>('luogu');
  // 当前 site 的全部缓存项（按 pid 排序）
  const [cachedItems, setCachedItems] = useState<ListItem[]>([]);
  const [meta, setMeta] = useState<{ totalPages?: number; totalCount?: number; lastFetchedAt: number; fetchedPages: number[] } | null>(null);
  const [maxPageLoaded, setMaxPageLoaded] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [search, setSearch] = useState('');

  // 题面预览
  const [selectedItem, setSelectedItem] = useState<ListItem | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, FetchedProblem>>({});
  const [previewFetching, setPreviewFetching] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const preview = selectedItem ? previewCache[selectedItem.url] : null;

  const addedUrls = useMemo(() => {
    const set = new Set<string>();
    for (const p of problems) if (p.source) set.add(p.source);
    return set;
  }, [problems]);

  // 切 site / 打开时加载缓存 + 自动抓第一页（如缓存为空）
  useEffect(() => {
    if (!open) return;
    abortRef.current?.abort();
    setSelectedItem(null);
    setListError(null);
    setSearch('');

    const cached = loadListCache(activeSite);
    const items = getCachedItems(activeSite);
    setCachedItems(items);
    setMeta(
      cached
        ? {
            totalPages: cached.totalPages,
            totalCount: cached.totalCount,
            lastFetchedAt: cached.lastFetchedAt,
            fetchedPages: cached.fetchedPages,
          }
        : null,
    );
    setMaxPageLoaded(cached?.fetchedPages?.length ? Math.max(...cached.fetchedPages) : 0);

    // 缓存为空才自动抓第一页
    if (items.length === 0) {
      void loadPage(activeSite, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeSite]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !previewFetching && !adding) {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen, previewFetching, adding]);

  const loadPage = async (site: ListSite, page: number) => {
    setListLoading(true);
    setListError(null);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const result = await fetchProblemListPage(site, page, abortRef.current.signal);
      mergeListPage(site, result);
      const items = getCachedItems(site);
      const cached = loadListCache(site);
      setCachedItems(items);
      setMeta(
        cached
          ? {
              totalPages: cached.totalPages,
              totalCount: cached.totalCount,
              lastFetchedAt: cached.lastFetchedAt,
              fetchedPages: cached.fetchedPages,
            }
          : null,
      );
      setMaxPageLoaded((p) => Math.max(p, page));
      toast.success(`已加载第 ${page} 页`, {
        description: `${result.items.length} 题，累计缓存 ${items.length} 题`,
        duration: 1500,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      const msg = String(e?.message ?? e);
      setListError(msg);
      toast.error(`加载第 ${page} 页失败`, { description: msg, duration: 4000 });
    } finally {
      setListLoading(false);
    }
  };

  const onClearCache = () => {
    if (!confirm(`清除 ${activeSite.toUpperCase()} 的缓存？\n（不影响已入库的题目）`)) return;
    clearListCache(activeSite);
    setCachedItems([]);
    setMeta(null);
    setMaxPageLoaded(0);
    setSelectedItem(null);
    toast.success('已清除');
  };

  const loadPreview = async (item: ListItem, force = false) => {
    setSelectedItem(item);
    setPreviewError(null);
    if (!force && previewCache[item.url]) return;
    setPreviewFetching(true);
    try {
      const p = await fetchAndParseProblem(item.url);
      setPreviewCache((c) => ({ ...c, [item.url]: p }));
    } catch (e) {
      const msg =
        e instanceof FetchProblemError ? `${e.code}: ${e.message}` : String((e as any)?.message || e);
      setPreviewError(msg);
      toast.error('题面抓取失败', { description: msg });
    } finally {
      setPreviewFetching(false);
    }
  };

  const onAdd = async () => {
    if (!preview || !selectedItem) return;
    if (addedUrls.has(selectedItem.url)) {
      toast.info('该题已在你的题库');
      return;
    }
    setAdding(true);
    try {
      const problem: Problem = {
        id: nanoid(),
        title: preview.title,
        statement: preview.statement,
        constraints: preview.constraints,
        examples: preview.examples,
        tags: selectedItem.tags ?? preview.tags,
        source: preview.source.url,
        difficulty: selectedItem.difficulty,
        createdAt: Date.now(),
      };
      await storage.saveProblem(problem);
      await refreshProblems();
      await setActiveProblem(problem.id);
      toast.success(`已加入题库：${preview.title}`);
      setOpen(false);
    } catch (e) {
      toast.error('入库失败', { description: String((e as any)?.message || e) });
    } finally {
      setAdding(false);
    }
  };

  // 搜索过滤
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cachedItems;
    return cachedItems.filter(
      (it) => it.pid.toLowerCase().includes(q) || it.title.toLowerCase().includes(q),
    );
  }, [cachedItems, search]);

  const currentSiteInfo = SITES.find((s) => s.site === activeSite)!;
  const totalPages = meta?.totalPages;
  const canLoadMore = !listLoading && (totalPages ? maxPageLoaded < totalPages : true);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !previewFetching && !adding && setOpen(false)}
          className="fixed inset-0 z-50 modal-overlay flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-card w-full max-w-[1280px] h-[90vh] flex flex-col"
          >
            {/* Header */}
            <div className="px-5 py-3 border-b border-line flex items-center gap-3">
              <Library size={18} className="text-cyan" />
              <div className="flex-1">
                <div className="text-sm font-semibold">OJ 题库（实时）</div>
                <div className="text-[11px] text-ink-mute">
                  从 OJ 实时拉取题目列表 · 自动缓存 · 增量加载更多
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="btn-ghost p-1.5" title="关闭 (Esc)">
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 flex min-h-0">
              {/* 左：OJ tabs */}
              <div className="w-[170px] border-r border-line bg-bg-elev/40 flex flex-col">
                {SITES.map((s) => {
                  const active = s.site === activeSite;
                  const c = loadListCache(s.site);
                  return (
                    <button
                      key={s.site}
                      onClick={() => setActiveSite(s.site)}
                      className={cn(
                        'text-left px-4 py-3 border-l-2 transition',
                        active
                          ? 'border-accent bg-accent/10 text-accent-glow'
                          : 'border-transparent text-ink-dim hover:text-ink hover:bg-bg-elev2/40',
                      )}
                    >
                      <div className="font-medium text-sm">{s.label}</div>
                      <div className="text-[10px] text-ink-mute mt-0.5">{s.domain}</div>
                      {c && Object.keys(c.items).length > 0 && (
                        <div className="text-[10px] text-ok mt-1">
                          已缓存 {Object.keys(c.items).length} 题
                        </div>
                      )}
                    </button>
                  );
                })}
                <div className="mt-auto px-4 py-3 text-[10px] text-ink-mute leading-relaxed border-t border-line">
                  CF / LeetCode / 牛客反爬严，未支持
                </div>
              </div>

              {/* 中：题目列表 */}
              <div className="w-[340px] border-r border-line flex flex-col min-h-0">
                {/* 搜索框 */}
                <div className="px-3 py-2 border-b border-line">
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-mute" />
                    <input
                      className="input pl-7 pr-2 py-1 text-[12px]"
                      placeholder={`搜索 ${currentSiteInfo.label} 题号或标题…`}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>

                {/* 状态行 */}
                <div className="px-3 py-1.5 text-[10px] text-ink-mute border-b border-line flex items-center gap-2 flex-wrap">
                  {meta ? (
                    <>
                      <span>
                        已缓存 <b className="text-ink-dim">{cachedItems.length}</b>
                        {meta.totalCount && <span> / {meta.totalCount}</span>}
                      </span>
                      <span>·</span>
                      <span title={new Date(meta.lastFetchedAt).toLocaleString()}>
                        {formatRelativeTime(meta.lastFetchedAt)}
                      </span>
                      <button
                        onClick={onClearCache}
                        className="ml-auto hover:text-bad transition"
                        title="清除该 OJ 的缓存"
                      >
                        <Trash2 size={11} />
                      </button>
                    </>
                  ) : (
                    <span>{currentSiteInfo.hint}</span>
                  )}
                </div>

                {/* 列表 */}
                <div className="flex-1 overflow-y-auto py-1">
                  {cachedItems.length === 0 && !listLoading && !listError && (
                    <div className="p-6 text-center text-[12px] text-ink-mute">
                      首次访问，正在加载…
                    </div>
                  )}
                  {listError && cachedItems.length === 0 && (
                    <div className="p-4 text-[12px] text-bad space-y-2">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={12} />
                        <span className="font-semibold">加载失败</span>
                      </div>
                      <div className="font-mono text-[10px] break-all opacity-80">{listError}</div>
                      <button onClick={() => loadPage(activeSite, 1)} className="btn">
                        <RefreshCw size={11} /> 重试
                      </button>
                    </div>
                  )}
                  {filteredItems.map((item) => {
                    const active = selectedItem?.url === item.url;
                    const added = addedUrls.has(item.url);
                    return (
                      <button
                        key={item.url}
                        onClick={() => loadPreview(item)}
                        className={cn(
                          'w-full text-left px-3 py-2 flex items-start gap-2 transition border-l-2',
                          active
                            ? 'bg-accent/10 border-accent'
                            : 'border-transparent hover:bg-bg-elev2/30',
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] text-ink-mute shrink-0">{item.pid}</span>
                            {added && <CheckCircle2 size={11} className="text-ok shrink-0" />}
                          </div>
                          <div className="text-[13px] font-medium truncate mt-0.5">{item.title}</div>
                          {item.difficulty && (
                            <div className="flex items-center gap-1 mt-1">
                              <span
                                className={cn(
                                  'chip text-[9px] px-1.5 py-0',
                                  item.difficulty === 'easy' && 'chip-ok',
                                  item.difficulty === 'medium' && 'chip-warn',
                                  item.difficulty === 'hard' && 'chip-bad',
                                )}
                              >
                                {item.difficulty}
                              </span>
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* 加载更多 / 刷新 */}
                <div className="px-3 py-2 border-t border-line flex gap-2">
                  <button
                    onClick={() => loadPage(activeSite, maxPageLoaded + 1 || 1)}
                    disabled={!canLoadMore}
                    className="btn flex-1"
                    title={
                      totalPages
                        ? `加载下一页（${maxPageLoaded}/${totalPages}）`
                        : '加载下一页'
                    }
                  >
                    {listLoading ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Plus size={12} />
                    )}
                    {listLoading
                      ? '加载中…'
                      : maxPageLoaded === 0
                      ? '加载第 1 页'
                      : `加载第 ${maxPageLoaded + 1} 页${totalPages ? ` / ${totalPages}` : ''}`}
                  </button>
                  <button
                    onClick={() => loadPage(activeSite, 1)}
                    disabled={listLoading}
                    className="btn-ghost"
                    title="重新抓取第 1 页（覆盖缓存）"
                  >
                    <RefreshCw size={12} className={listLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {/* 右：题面预览 */}
              <div className="flex-1 flex flex-col min-h-0">
                {!selectedItem && (
                  <div className="flex-1 flex flex-col items-center justify-center text-ink-mute gap-3 p-12 text-center">
                    <Library size={36} className="opacity-30" />
                    <div className="text-sm">从中间列表选一道题</div>
                    <div className="text-[11px] max-w-sm">
                      第一次点击会从 OJ 抓取题面（约 0.5–2s），抓过的会缓存。
                      预览满意后点「加入题库」即可开始做题。
                    </div>
                  </div>
                )}
                {selectedItem && (
                  <>
                    <div className="px-5 py-3 border-b border-line flex items-center gap-2 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[11px] text-ink-mute">
                          {currentSiteInfo.label} · {selectedItem.pid}
                        </div>
                        <div className="text-sm font-semibold truncate">
                          {preview?.title ?? selectedItem.title}
                        </div>
                      </div>
                      <a
                        href={selectedItem.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost"
                        title={selectedItem.url}
                      >
                        <ExternalLink size={13} />
                        <span className="text-[12px]">原题页</span>
                      </a>
                      <button
                        onClick={() => loadPreview(selectedItem, true)}
                        className="btn-ghost"
                        disabled={previewFetching}
                        title="重新抓取"
                      >
                        <RefreshCw size={13} className={previewFetching ? 'animate-spin' : ''} />
                      </button>
                      <button
                        onClick={onAdd}
                        disabled={!preview || adding || addedUrls.has(selectedItem.url)}
                        className="btn-primary"
                      >
                        {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                        {addedUrls.has(selectedItem.url) ? '已在题库' : '加入题库'}
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5">
                      {previewFetching && !preview && (
                        <div className="flex items-center gap-2 text-ink-mute py-12 justify-center">
                          <Loader2 size={16} className="animate-spin" />
                          <span className="text-sm">正在抓取题面…</span>
                        </div>
                      )}
                      {previewError && !preview && (
                        <div className="rounded-md border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
                          <div className="font-semibold mb-1">抓取失败</div>
                          <div className="text-[12px] font-mono break-all">{previewError}</div>
                          <button onClick={() => loadPreview(selectedItem, true)} className="btn mt-3">
                            <RefreshCw size={12} /> 重试
                          </button>
                        </div>
                      )}
                      {preview && (
                        <div className="space-y-4 text-sm">
                          <MathMarkdown>{preview.statement}</MathMarkdown>

                          {preview.constraints && (
                            <section>
                              <h3 className="text-sm font-semibold mb-1">约束</h3>
                              <div className="bg-bg-elev/40 border border-line rounded p-2.5 text-[12px]">
                                <MathMarkdown compact>{preview.constraints}</MathMarkdown>
                              </div>
                            </section>
                          )}

                          {preview.examples && preview.examples.length > 0 && (
                            <section>
                              <h3 className="text-sm font-semibold mb-1.5">
                                示例 ({preview.examples.length})
                              </h3>
                              <div className="space-y-2">
                                {preview.examples.map(
                                  (ex: { input: string; output: string }, i: number) => (
                                    <div
                                      key={i}
                                      className="grid grid-cols-2 gap-2 bg-bg-elev/40 border border-line rounded p-2.5 font-mono text-[12px]"
                                    >
                                      <div>
                                        <div className="text-cyan text-[10px] mb-1">输入</div>
                                        <div className="whitespace-pre-wrap">{ex.input}</div>
                                      </div>
                                      <div>
                                        <div className="text-ok text-[10px] mb-1">输出</div>
                                        <div className="whitespace-pre-wrap">{ex.output}</div>
                                      </div>
                                    </div>
                                  ),
                                )}
                              </div>
                            </section>
                          )}

                          {preview.tags && preview.tags.length > 0 && (
                            <section>
                              <h3 className="text-sm font-semibold mb-1.5">标签（来自 OJ）</h3>
                              <div className="flex flex-wrap gap-1">
                                {preview.tags.map((t: string) => (
                                  <span key={t} className="chip text-[10px]">{t}</span>
                                ))}
                              </div>
                            </section>
                          )}

                          {preview.meta && (
                            <div className="text-[10px] text-ink-mute font-mono pt-2 border-t border-line">
                              抓取耗时 {preview.meta.ms}ms · HTML {preview.meta.htmlLen?.toLocaleString()} 字节 · 已缓存
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
