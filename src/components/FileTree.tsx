import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileCode,
  FileText,
  FileType,
  X,
  Plus,
  ChevronRight,
  ChevronLeft,
  Copy,
  Edit2,
  Trash2,
  Pin,
  PinOff,
  GitCompare,
  Check,
  FolderOpen,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import type { CodeFile, FileLang } from '../core/types';
import { ResizeHandle } from './ResizeHandle';
import { usePersistedWidth } from '../lib/usePersistedWidth';

const DRAFT_SCOPE = '__draft__';

/**
 * 左侧纵向文件树。VSCode 风格，替代 TabBar 的横向布局。
 *
 * 功能与 TabBar 完全对齐：
 * - 新建 / 重命名 / 复制 / 删除 / 置顶 / 对拍勾选
 * - 右键菜单
 * - 中键关闭（仅切到下一个，不删除）
 * - 双击重命名
 *
 * 视觉：
 * - 顶部 toolbar：文件数 + 新建下拉 + 折叠按钮
 * - 文件列表：图标 + 文件名 + hover 勾选框
 * - 折叠态：仅一根 28px 窄条，避免占空间
 */
export function FileTree() {
  const [width, setWidth] = usePersistedWidth('aicc.layout.fileTreeWidth', 220, 160, 480);
  const [collapsed, setCollapsed] = useState(false);

  const activeProblemId = useStore((s) => s.activeProblemId);
  const filesByScope = useStore((s) => s.filesByScope);
  const activeFileIdByScope = useStore((s) => s.activeFileIdByScope);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const createFile = useStore((s) => s.createFile);
  const renameFile = useStore((s) => s.renameFile);
  const duplicateFile = useStore((s) => s.duplicateFile);
  const deleteFile = useStore((s) => s.deleteFile);
  const pinFile = useStore((s) => s.pinFile);
  const diffSelection = useStore((s) => s.diffSelection);
  const toggleDiffSelection = useStore((s) => s.toggleDiffSelection);
  const enqueueDiff = useStore((s) => s.enqueueDiff);
  const clearDiffSelection = useStore((s) => s.clearDiffSelection);

  const scope = activeProblemId ?? DRAFT_SCOPE;
  const files = filesByScope[scope] ?? [];
  const activeId = activeFileIdByScope[scope];

  const [createOpen, setCreateOpen] = useState(false);
  const createBtnRef = useRef<HTMLButtonElement | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; fileId: string } | null>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    let active = false;
    const close = () => {
      if (active) setCtxMenu(null);
    };
    const t = setTimeout(() => {
      active = true;
      // 用 click 而非 mousedown：菜单按钮的 onClick 先于 click 冒泡到 window，
      // 菜单容器的 onClick stopPropagation 能阻止关闭。
      window.addEventListener('click', close);
      window.addEventListener('contextmenu', close);
    }, 100);
    return () => {
      clearTimeout(t);
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [ctxMenu]);

  // 折叠态：一根 32px 窄条，点击展开
  if (collapsed) {
    return (
      <div className="w-8 border-r border-line bg-bg-elev flex flex-col items-center pt-2 shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="w-7 h-7 rounded flex items-center justify-center text-ink-dim hover:text-ink hover:bg-bg-elev2"
          title="展开文件树"
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={() => {
            setCollapsed(false);
            setCreateOpen(true);
          }}
          className="mt-1 w-7 h-7 rounded flex items-center justify-center text-ink-dim hover:text-ink hover:bg-bg-elev2"
          title="新建文件"
        >
          <Plus size={14} />
        </button>
        <div className="mt-2 text-[10px] text-ink-mute font-mono" title={`${files.length} 个文件`}>
          {files.length}
        </div>
      </div>
    );
  }

  const onClickFile = (f: CodeFile) => {
    setActiveFile(scope, f.id);
  };

  const onMiddleClick = (e: React.MouseEvent, f: CodeFile) => {
    if (e.button === 1) {
      e.preventDefault();
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
      const ok = window.confirm(
        `"${f.name}" 是最后一个文件，删除后会创建一个新的空白文件。继续？`,
      );
      if (!ok) return;
    } else {
      const ok = window.confirm(`删除 "${f.name}"？这无法撤销。`);
      if (!ok) return;
    }
    await deleteFile(f.id);
  };

  const showDiff = diffSelection.length === 2;

  return (
    <>
      <div
        className="border-r border-line bg-bg-elev/40 flex flex-col shrink-0 min-h-0"
        style={{ width: `${width}px` }}
      >
        {/* Toolbar */}
        <div className="h-9 px-2 flex items-center gap-1 border-b border-line shrink-0 bg-bg-elev">
          <FolderOpen size={13} className="text-ink-dim shrink-0 ml-1" />
          <span className="text-[11px] font-semibold text-ink-dim flex-1 truncate">
            文件 <span className="text-ink-mute font-normal">({files.length})</span>
          </span>
          {/* 新建 */}
          <div className="relative">
            <button
              ref={createBtnRef}
              onClick={() => setCreateOpen((v) => !v)}
              className="w-6 h-6 rounded flex items-center justify-center text-ink-dim hover:text-ink hover:bg-bg-elev2"
              title="新建文件"
            >
              <Plus size={13} />
            </button>
            <AnimatePresence>
              {createOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setCreateOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute left-0 top-full mt-1 w-56 glass-card z-50 py-1"
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
          {/* 折叠 */}
          <button
            onClick={() => setCollapsed(true)}
            className="w-6 h-6 rounded flex items-center justify-center text-ink-dim hover:text-ink hover:bg-bg-elev2"
            title="折叠文件树"
          >
            <ChevronLeft size={13} />
          </button>
        </div>

        {/* 对拍按钮（顶部固定，仅当选了 2 个） */}
        <AnimatePresence>
          {showDiff && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-cyan/5 border-b border-cyan/30 overflow-hidden shrink-0"
            >
              <div className="px-2 py-1.5 flex items-center gap-2 text-[11px] text-cyan font-semibold">
                <GitCompare size={12} />
                <span className="flex-1">已选 2 个文件</span>
                <button
                  onClick={() => enqueueDiff()}
                  className="px-2 py-0.5 rounded bg-cyan/20 hover:bg-cyan/30 transition"
                  title="让 AI 对比这两个文件"
                >
                  对拍
                </button>
                <button
                  onClick={() => clearDiffSelection()}
                  className="opacity-60 hover:opacity-100"
                  title="取消选择"
                >
                  <X size={11} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 文件列表 */}
        <div className="flex-1 overflow-y-auto py-1">
          {files.length === 0 && (
            <div className="px-3 py-4 text-[11px] text-ink-mute italic">
              没有文件，点 + 新建
            </div>
          )}
          {files.map((f) => {
            const active = f.id === activeId;
            const inDiff = diffSelection.includes(f.id);
            return (
              <div
                key={f.id}
                role="button"
                tabIndex={0}
                onClick={() => onClickFile(f)}
                onMouseDown={(e) => onMiddleClick(e, f)}
                onContextMenu={(e) => onContextMenu(e, f)}
                className={cn(
                  'group relative pl-3 pr-2 py-1 flex items-center gap-1.5 cursor-pointer select-none transition border-l-2',
                  active
                    ? 'bg-bg border-accent text-ink'
                    : 'border-transparent text-ink-dim hover:bg-bg-elev2 hover:text-ink',
                  inDiff && 'ring-1 ring-cyan/40 ring-inset',
                )}
                title={`${f.name} · ${f.language}\n右键菜单 · 双击重命名`}
              >
                {f.pinned && <Pin size={9} className="text-accent shrink-0" />}
                <FileIcon
                  language={f.language}
                  className={cn('shrink-0', active && 'text-accent')}
                />
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
                    className="bg-bg-elev2 border border-accent/60 rounded px-1 text-xs font-mono flex-1 min-w-0 outline-none"
                  />
                ) : (
                  <span
                    className="text-[12px] font-medium truncate flex-1 min-w-0"
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
                    'w-3.5 h-3.5 rounded border flex items-center justify-center transition shrink-0',
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
              onMouseDown={(e) => e.stopPropagation()}
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
      <ResizeHandle
        direction="right"
        currentWidth={width}
        onResize={setWidth}
        min={160}
        max={480}
      />
    </>
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
