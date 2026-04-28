/**
 * 对拍任务的结果查看器：流式展示 markdown 报告，左右两栏代码 + 顶部任务状态。
 *
 * 触发：用户点了 TabBar 上的"对拍"按钮 → 任务开始跑 → 这个 modal 自动弹出
 *      （订阅 store.tasks 里第一个 compare-files 状态为 running/done 的任务）
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import {
  X,
  GitCompare,
  Loader2,
  Maximize2,
  Minimize2,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/cn';

export function DiffResultViewer() {
  const tasks = useStore((s) => s.tasks);
  const filesByScope = useStore((s) => s.filesByScope);
  const cancelTask = useStore((s) => s.cancelTask);

  const compareTask = useMemo(
    () => tasks.find((t) => t.kind === 'compare-files' && t.status !== 'cancelled'),
    [tasks],
  );

  const [open, setOpen] = useState(false);
  const [maximize, setMaximize] = useState(false);
  const [showCode, setShowCode] = useState(true);

  // 任务出现 / 状态变化 → 自动打开
  useEffect(() => {
    if (compareTask && (compareTask.status === 'running' || compareTask.status === 'done' || compareTask.status === 'failed')) {
      setOpen(true);
    }
  }, [compareTask?.id, compareTask?.status]);

  if (!compareTask) return null;

  const allFiles = Object.values(filesByScope).flat();
  const meta = compareTask.meta as { problemId?: string; fileId?: string } | undefined;
  // 从 label 反向解析两个文件名比较脆，但临时方案：从最近一次 diffSelection 取
  // 更稳：把 fileIds 写进 task.meta（store 里加），但现在 enqueueDiff 没传 meta
  // 简化做法：从 label "对拍：A ↔ B" 解析
  const m = compareTask.label.match(/^对拍：(.+?)\s+↔\s+(.+)$/);
  const aName = m?.[1];
  const bName = m?.[2];
  const fileA = aName ? allFiles.find((f) => f.name === aName) : undefined;
  const fileB = bName ? allFiles.find((f) => f.name === bName) : undefined;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 modal-overlay flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'glass-card flex flex-col overflow-hidden',
              maximize ? 'w-[96vw] h-[94vh]' : 'w-[min(1100px,94vw)] h-[min(800px,90vh)]',
            )}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-line flex items-center gap-2 shrink-0">
              <GitCompare size={16} className="text-cyan" />
              <span className="font-semibold text-sm">{compareTask.label}</span>
              {compareTask.status === 'running' && (
                <span className="ml-2 chip-accent text-[10px] flex items-center gap-1">
                  <Loader2 size={9} className="animate-spin" />
                  对比中…
                </span>
              )}
              {compareTask.status === 'done' && (
                <span className="ml-2 chip-ok text-[10px]">完成</span>
              )}
              {compareTask.status === 'failed' && (
                <span className="ml-2 chip-bad text-[10px]">失败</span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => setShowCode((v) => !v)}
                  className="btn-ghost p-1 text-[11px]"
                  title="切换代码栏"
                >
                  {showCode ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <button onClick={() => setMaximize((v) => !v)} className="btn-ghost p-1">
                  {maximize ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
                {compareTask.status === 'running' && (
                  <button
                    onClick={() => cancelTask(compareTask.id)}
                    className="btn-ghost p-1 text-bad"
                    title="取消"
                  >
                    <X size={14} />
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="btn-ghost p-1">
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Code panes */}
            {showCode && fileA && fileB && (
              <div className="grid grid-cols-2 border-b border-line shrink-0 max-h-[35%]">
                <CodePane title={fileA.name} lang={fileA.language} content={fileA.content} side="A" />
                <div className="border-l border-line">
                  <CodePane title={fileB.name} lang={fileB.language} content={fileB.content} side="B" />
                </div>
              </div>
            )}

            {/* AI Report */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-accent-glow mb-3">
                <Sparkles size={12} />
                AI 对比报告
                {compareTask.status === 'running' && compareTask.progress && (
                  <span className="text-[10px] text-ink-mute font-normal ml-auto">
                    {compareTask.progress.length} 字符 ·{' '}
                    {compareTask.startedAt
                      ? `${((Date.now() - compareTask.startedAt) / 1000).toFixed(1)}s`
                      : ''}
                  </span>
                )}
              </div>
              {compareTask.progress ? (
                <div className="md-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{compareTask.progress}</ReactMarkdown>
                  {compareTask.status === 'running' && (
                    <span className="inline-block w-1.5 h-3 bg-accent ml-0.5 animate-pulse align-baseline" />
                  )}
                </div>
              ) : compareTask.status === 'failed' ? (
                <div className="text-bad text-sm">{compareTask.error}</div>
              ) : (
                <div className="text-ink-mute text-sm">正在思考…</div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CodePane({
  title,
  lang,
  content,
  side,
}: {
  title: string;
  lang: string;
  content: string;
  side: 'A' | 'B';
}) {
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-3 py-1.5 bg-bg-elev/40 border-b border-line/60 flex items-center gap-2 text-xs">
        <span
          className={cn(
            'w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold',
            side === 'A' ? 'bg-cyan/20 text-cyan' : 'bg-accent/20 text-accent-glow',
          )}
        >
          {side}
        </span>
        <span className="font-mono truncate">{title}</span>
        <span className="text-[10px] text-ink-mute ml-auto">{lang}</span>
      </div>
      <pre className="flex-1 overflow-auto p-3 text-[12px] font-mono text-ink-dim leading-relaxed bg-bg/40">
        {content.split('\n').map((line, i) => (
          <div key={i} className="flex gap-3">
            <span className="text-ink-mute select-none w-7 text-right shrink-0">{i + 1}</span>
            <span className="whitespace-pre-wrap flex-1">{line || ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
