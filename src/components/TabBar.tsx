import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileCode,
  FileText,
  FileType,
  X,
  Plus,
  ChevronDown,
  Copy,
  Edit2,
  Trash2,
  Pin,
  PinOff,
  GitCompare,
  Check,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import type { CodeFile, FileLang, Lang } from '../core/types';

const DRAFT_SCOPE = '__draft__';

export function TabBar() {
  const activeProblemId = useStore((s) => s.activeProblemId);
  const filesByScope = useStore((s) => s.filesByScope);
  const activeFileIdByScope = useStore((s) => s.activeFileIdByScope);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const createFile = useStore((s) => s.createFile);
  const renameFile = useStore((s) => s.renameFile);
  const duplicateFile = useStore((s) => s.duplicateFile);
  const deleteFile = useStore((s) => s.deleteFile);
  const pinFile = useStore((s) => s.pinFile);
  const defaultLang = useStore((s) => s.defaultLang);
  const setDefaultLang = useStore((s) => s.setDefaultLang);
  const diffSelection = useStore((s) => s.diffSelection);
  const toggleDiffSelection = useStore((s) => s.toggleDiffSelection);
  const enqueueDiff = useStore((s) => s.enqueueDiff);
  const clearDiffSelection = useStore((s) => s.clearDiffSelection);

  const scope = activeProblemId ?? DRAFT_SCOPE;
  const files = filesByScope[scope] ?? [];
  const activeId = activeFileIdByScope[scope];

  // 新建下拉
  const [createOpen, setCreateOpen] = useState(false);
  const createBtnRef = useRef<HTMLButtonElement | null>(null);

  // 重命名 modal
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  // 右键菜单
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; fileId: string } | null>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [ctxMenu]);

  const onTabClick = (f: CodeFile) => {
    setActiveFile(scope, f.id);
  };

  const onMiddleClick = (e: React.MouseEvent, f: CodeFile) => {
    if (e.button === 1) {
      e.preventDefault();
      // 中键不删文件，只切到下一个（"关闭 tab"在多文件场景里没单独的概念）
      if (activeId === f.id && files.length > 1) {
        const idx = files.findIndex((x) => x.id === f.id);
        const next = files[idx + 1] ?? files[idx - 1];
        setActiveFile(scope, next?.id ?? null);
      }
    }
  };

  const onContextMenu = (e: React.MouseEvent, f: CodeFile) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, fileId: f.id });
  };

  const onCreateNew = async (lang: FileLang) => {
    setDefaultLang(lang === 'markdown' || lang === 'plaintext' ? defaultLang : (lang as Lang));
    await createFile({ scope, language: lang, activate: true });
    setCreateOpen(false);
  };

  const onDuplicateActive = async () => {
    if (!activeId) return;
    await duplicateFile(activeId);
    setCreateOpen(false);
  };

  const startRename = (f: CodeFile) => {
    setRenamingId(f.id);
    setRenameVal(f.name);
    setCtxMenu(null);
  };

  const submitRename = async () => {
    if (!renamingId || !renameVal.trim()) {
      setRenamingId(null);
      return;
    }
    await renameFile(renamingId, renameVal);
    setRenamingId(null);
  };

  const onDelete = async (f: CodeFile) => {
    setCtxMenu(null);
    if (files.length <= 1) {
      // 最后一个不能删（会自动新建一个，体验奇怪）
      const ok = window.confirm(`"${f.name}" 是最后一个文件，删除后会创建一个新的空白文件。继续？`);
      if (!ok) return;
    } else {
      const ok = window.confirm(`删除 "${f.name}"？这无法撤销。`);
      if (!ok) return;
    }
    await deleteFile(f.id);
  };

  // 对拍按钮（仅当有选择时显示）
  const showDiff = diffSelection.length === 2;

  return (
    <div className="h-9 flex items-stretch bg-bg-elev/50 border-b border-line relative shrink-0">
      <div className="flex-1 flex items-stretch overflow-x-auto scrollbar-thin min-w-0">
        {files.length === 0 && (
          <div className="px-3 py-1.5 text-xs text-ink-mute italic">
            没有文件，点右侧 + 新建
          </div>
        )}
        {files.map((f) => {
          const active = f.id === activeId;
          const inDiff = diffSelection.includes(f.id);
          return (
            <div
              key={f.id}
              role="tab"
              tabIndex={0}
              onClick={() => onTabClick(f)}
              onMouseDown={(e) => onMiddleClick(e, f)}
              onContextMenu={(e) => onContextMenu(e, f)}
              className={cn(
                'group relative px-3 py-1.5 flex items-center gap-1.5 border-r border-line cursor-pointer select-none transition',
                active
                  ? 'bg-bg text-ink'
                  : 'bg-transparent text-ink-dim hover:bg-bg-elev2 hover:text-ink',
                inDiff && 'ring-1 ring-cyan/50',
              )}
              title={`${f.name} · ${f.language}\n右键菜单 · 中键关闭`}
            >
              {f.pinned && <Pin size={9} className="text-accent shrink-0" />}
              <FileIcon language={f.language} className={cn('shrink-0', active && 'text-accent')} />
              {renamingId === f.id ? (
                <input
                  autoFocus
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={submitRename}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename();
                    else if (e.key === 'Escape') setRenamingId(null);
                  }}
                  className="bg-bg-elev2 border border-accent/60 rounded px-1 text-xs font-mono w-32 outline-none"
                />
              ) : (
                <span
                  className="text-[12px] font-medium truncate max-w-[180px]"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(f);
                  }}
                >
                  {f.name}
                </span>
              )}
              {/* 对拍勾选 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleDiffSelection(f.id);
                }}
                className={cn(
                  'ml-1 w-3.5 h-3.5 rounded border flex items-center justify-center transition shrink-0',
                  inDiff
                    ? 'bg-cyan/20 border-cyan text-cyan'
                    : 'border-line opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:border-cyan/60',
                )}
                title="勾选用于对拍（最多 2 个）"
              >
                {inDiff && <Check size={9} strokeWidth={3} />}
              </button>
            </div>
          );
        })}
      </div>

      {/* 对拍按钮 */}
      <AnimatePresence>
        {showDiff && (
          <motion.button
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            onClick={() => {
              enqueueDiff();
            }}
            className="px-3 flex items-center gap-1.5 text-xs font-semibold text-cyan border-l border-cyan/30 bg-cyan/5 hover:bg-cyan/10 shrink-0"
            title="让 AI 对比这两个文件"
          >
            <GitCompare size={13} />
            对拍
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearDiffSelection();
              }}
              className="ml-1 opacity-50 hover:opacity-100"
              title="取消选择"
            >
              <X size={11} />
            </button>
          </motion.button>
        )}
      </AnimatePresence>

      {/* 新建按钮 */}
      <div className="relative shrink-0">
        <button
          ref={createBtnRef}
          onClick={() => setCreateOpen((v) => !v)}
          className="h-full px-2.5 flex items-center gap-1 text-ink-dim hover:text-ink hover:bg-bg-elev2 border-l border-line"
          title="新建文件"
        >
          <Plus size={14} />
          <ChevronDown size={10} />
        </button>
        <AnimatePresence>
          {createOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setCreateOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute right-0 top-full mt-1 w-56 glass-card z-50 py-1"
              >
                <MenuItem
                  icon={<FileCode size={13} className="text-accent" />}
                  label="C++ 文件"
                  hint=".cpp"
                  onClick={() => onCreateNew('cpp')}
                />
                <MenuItem
                  icon={<FileCode size={13} className="text-ok" />}
                  label="Python 文件"
                  hint=".py"
                  onClick={() => onCreateNew('python')}
                />
                <MenuItem
                  icon={<FileCode size={13} className="text-cyan" />}
                  label="C 文件"
                  hint=".c"
                  onClick={() => onCreateNew('c')}
                />
                <div className="my-1 border-t border-line/60" />
                <MenuItem
                  icon={<FileText size={13} className="text-warn" />}
                  label="Markdown 笔记"
                  hint=".md"
                  onClick={() => onCreateNew('markdown')}
                />
                <MenuItem
                  icon={<FileType size={13} className="text-ink-dim" />}
                  label="纯文本"
                  hint=".txt"
                  onClick={() => onCreateNew('plaintext')}
                />
                {activeId && (
                  <>
                    <div className="my-1 border-t border-line/60" />
                    <MenuItem
                      icon={<Copy size={13} className="text-ink-dim" />}
                      label="复制当前文件"
                      hint="自动 +v2"
                      onClick={onDuplicateActive}
                    />
                  </>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* 右键菜单 */}
      <AnimatePresence>
        {ctxMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.08 }}
            className="fixed z-[100] glass-card py-1 w-48"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const f = files.find((x) => x.id === ctxMenu.fileId);
              if (!f) return null;
              return (
                <>
                  <MenuItem
                    icon={<Edit2 size={12} />}
                    label="重命名"
                    hint="F2 / 双击"
                    onClick={() => startRename(f)}
                  />
                  <MenuItem
                    icon={<Copy size={12} />}
                    label="复制"
                    hint="自动 +v2"
                    onClick={async () => {
                      setCtxMenu(null);
                      await duplicateFile(f.id);
                    }}
                  />
                  <MenuItem
                    icon={f.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                    label={f.pinned ? '取消置顶' : '置顶'}
                    onClick={async () => {
                      setCtxMenu(null);
                      await pinFile(f.id, !f.pinned);
                    }}
                  />
                  <MenuItem
                    icon={
                      diffSelection.includes(f.id) ? (
                        <Check size={12} className="text-cyan" />
                      ) : (
                        <GitCompare size={12} />
                      )
                    }
                    label={diffSelection.includes(f.id) ? '取消对拍选择' : '加入对拍'}
                    onClick={() => {
                      toggleDiffSelection(f.id);
                      setCtxMenu(null);
                    }}
                  />
                  <div className="my-1 border-t border-line/60" />
                  <MenuItem
                    icon={<Trash2 size={12} className="text-bad" />}
                    label="删除"
                    danger
                    onClick={() => onDelete(f)}
                  />
                </>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FileIcon({ language, className }: { language: FileLang; className?: string }) {
  if (language === 'markdown') return <FileText size={12} className={className} />;
  if (language === 'plaintext') return <FileType size={12} className={className} />;
  return <FileCode size={12} className={className} />;
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full px-3 py-1.5 flex items-center gap-2 text-xs text-left transition',
        danger ? 'text-bad hover:bg-bad/10' : 'text-ink hover:bg-bg-elev2',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-ink-mute">{hint}</span>}
    </button>
  );
}
