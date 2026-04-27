/**
 * Ctrl+P / Cmd+P 全局命令面板：
 * - 搜索任意题目下的任意文件 → 一键跳转
 * - 搜索题目本身（激活）
 * - 模糊匹配（简单的子串大小写不敏感）
 *
 * 键盘：
 *   ↑/↓  选项移动
 *   Enter 跳转
 *   Esc  关闭
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, FileCode, FileText, FileType, ScrollText, ChevronRight, Pin } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import type { CodeFile, FileLang, Problem } from '../core/types';

const DRAFT_SCOPE = '__draft__';

type Item =
  | {
      kind: 'file';
      file: CodeFile;
      problem?: Problem;
      score: number;
      label: string;
      sub: string;
    }
  | {
      kind: 'problem';
      problem: Problem;
      score: number;
      label: string;
      sub: string;
    };

export function CommandPalette() {
  const open = useStore((s) => s.cmdPaletteOpen);
  const setOpen = useStore((s) => s.setCmdPaletteOpen);
  const filesByScope = useStore((s) => s.filesByScope);
  const problems = useStore((s) => s.problems);
  const setActiveProblem = useStore((s) => s.setActiveProblem);
  const setActiveFile = useStore((s) => s.setActiveFile);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmd = e.ctrlKey || e.metaKey;
      if (isCmd && e.key.toLowerCase() === 'p' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo(() => {
    const all: Item[] = [];
    // 题目项
    for (const p of problems) {
      const score = fuzzyScore(query, `${p.title} ${(p.tags ?? []).join(' ')}`);
      if (query && score < 0) continue;
      all.push({
        kind: 'problem',
        problem: p,
        score: query ? score : -p.createdAt, // 无查询按时间倒序（值越小越靠前）
        label: p.title,
        sub: `题目 · ${p.difficulty ?? ''} · ${(p.tags ?? []).slice(0, 3).join(', ')}`,
      });
    }
    // 文件项
    for (const [scope, files] of Object.entries(filesByScope)) {
      const problem =
        scope === DRAFT_SCOPE ? undefined : problems.find((p) => p.id === scope);
      for (const f of files) {
        const tagText = `${f.name} ${f.language} ${problem?.title ?? '草稿'}`;
        const score = fuzzyScore(query, tagText);
        if (query && score < 0) continue;
        all.push({
          kind: 'file',
          file: f,
          problem,
          score: query ? score : -f.updatedAt,
          label: f.name,
          sub: problem ? `${problem.title} · ${f.language}` : `草稿区 · ${f.language}`,
        });
      }
    }
    // 按 score 倒序（query 模式：分数越大越前；无 query：按时间倒序，已经存负数）
    all.sort((a, b) => (query ? b.score - a.score : a.score - b.score));
    return all.slice(0, 30);
  }, [query, filesByScope, problems]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const onSelect = async (it: Item) => {
    if (it.kind === 'problem') {
      await setActiveProblem(it.problem.id);
    } else {
      // 切到该 file 所在的 scope
      const scope = it.file.problemId ?? DRAFT_SCOPE;
      await setActiveProblem(scope === DRAFT_SCOPE ? null : scope);
      setActiveFile(scope, it.file.id);
    }
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) onSelect(items[active]);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: -8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl glass-card overflow-hidden"
          >
            <div className="px-4 py-3 flex items-center gap-3 border-b border-line">
              <Search size={16} className="text-ink-dim shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="搜索题目 / 文件名 / 语言…"
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-ink-mute"
              />
              <kbd className="text-[10px] font-mono bg-bg-elev2 text-ink-mute px-1.5 py-0.5 rounded">
                ESC
              </kbd>
            </div>
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {items.length === 0 && (
                <li className="px-4 py-8 text-center text-xs text-ink-mute">
                  没有匹配项
                </li>
              )}
              {items.map((it, i) => {
                const id = it.kind === 'file' ? it.file.id : it.problem.id;
                return (
                  <li
                    key={`${it.kind}-${id}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => onSelect(it)}
                    className={cn(
                      'px-4 py-2 flex items-center gap-3 cursor-pointer transition',
                      active === i ? 'bg-accent/15' : 'hover:bg-bg-elev2',
                    )}
                  >
                    <ItemIcon item={it} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{it.label}</div>
                      <div className="text-[11px] text-ink-mute truncate">{it.sub}</div>
                    </div>
                    {active === i && (
                      <ChevronRight size={12} className="text-accent shrink-0" />
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="px-3 py-1.5 border-t border-line/60 flex items-center justify-between text-[10px] text-ink-mute">
              <div className="flex items-center gap-3">
                <span><kbd className="font-mono">↑↓</kbd> 选择</span>
                <span><kbd className="font-mono">Enter</kbd> 跳转</span>
                <span><kbd className="font-mono">Esc</kbd> 关闭</span>
              </div>
              <span>{items.length} 项</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ItemIcon({ item }: { item: Item }) {
  if (item.kind === 'problem') {
    return <ScrollText size={14} className="text-cyan shrink-0" />;
  }
  const lang = item.file.language as FileLang;
  if (lang === 'markdown') return <FileText size={14} className="text-warn shrink-0" />;
  if (lang === 'plaintext') return <FileType size={14} className="text-ink-dim shrink-0" />;
  return (
    <span className="relative shrink-0">
      <FileCode size={14} className="text-accent" />
      {item.file.pinned && <Pin size={7} className="absolute -top-1 -right-1 text-accent" />}
    </span>
  );
}

/**
 * 简单模糊匹配。空 query 返回 0（保留所有），有 query 时返回分数（>=0 表示匹配）。
 * 规则：
 *   - 不区分大小写
 *   - 子串匹配 = 越靠前分越高
 *   - 字符按顺序出现（subsequence）也算，分数低于子串
 */
function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  // 子串匹配
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - idx;
  // subsequence
  let qi = 0;
  let lastIdx = -1;
  let gaps = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      if (lastIdx >= 0) gaps += i - lastIdx - 1;
      lastIdx = i;
      qi++;
    }
  }
  if (qi < q.length) return -1; // 没全部匹配
  return 200 - gaps;
}
