import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  X,
  Trash2,
  Sparkles,
  Minus,
  ListChecks,
} from 'lucide-react';
import type { Task } from '../lib/store';

export function TaskTray() {
  const tasks = useStore((s) => s.tasks);
  const cancelTask = useStore((s) => s.cancelTask);
  const retryTask = useStore((s) => s.retryTask);
  const clearFinishedTasks = useStore((s) => s.clearFinishedTasks);

  const [expanded, setExpanded] = useState(false);
  // 最小化：只显示右下角一个圆形小图标，避免遮挡 FeedbackPanel/编辑器
  const [minimized, setMinimized] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);

  if (tasks.length === 0) return null;

  const running = tasks.filter((t) => t.status === 'running' || t.status === 'queued').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const done = tasks.filter((t) => t.status === 'done').length;

  const previewTask = previewId ? tasks.find((t) => t.id === previewId) : null;

  // 最小化模式：只显示一个 36x36 的浮动小图标
  if (minimized) {
    return (
      <motion.button
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={() => setMinimized(false)}
        className="fixed bottom-3 right-3 z-40 w-8 h-8 rounded-full glass-card flex items-center justify-center hover:scale-110 transition shadow-lg opacity-85 hover:opacity-100"
        title={`任务队列 (${tasks.length}) — 点击展开`}
      >
        {running > 0 ? (
          <Loader2 size={16} className="text-accent animate-spin" />
        ) : failed > 0 ? (
          <XCircle size={16} className="text-bad" />
        ) : (
          <ListChecks size={16} className="text-ink-dim" />
        )}
        {(running > 0 || failed > 0) && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-bold text-white bg-accent flex items-center justify-center">
            {running + failed}
          </span>
        )}
      </motion.button>
    );
  }

  return (
    <>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="fixed bottom-3 right-3 z-40 w-[320px] glass-card overflow-hidden"
      >
        <div className="w-full flex items-stretch hover:bg-bg-elev2 transition">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex-1 px-4 py-2.5 flex items-center gap-3"
          >
            <div className="relative">
              {running > 0 ? (
                <Loader2 size={18} className="text-accent animate-spin" />
              ) : failed > 0 ? (
                <XCircle size={18} className="text-bad" />
              ) : (
                <CheckCircle2 size={18} className="text-ok" />
              )}
            </div>
            <div className="flex-1 text-left text-sm">
              <div className="font-semibold flex items-center gap-2">
                任务队列
                {running > 0 && (
                  <span className="chip-accent text-[10px]">{running} 进行中</span>
                )}
                {failed > 0 && <span className="chip-bad text-[10px]">{failed} 失败</span>}
                {done > 0 && expanded === false && (
                  <span className="text-[10px] text-ink-mute">{done} 完成</span>
                )}
              </div>
            </div>
            {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {/* 最小化按钮（独立 button，不触发 expanded 切换） */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMinimized(true);
            }}
            className="px-2.5 flex items-center text-ink-mute hover:text-ink hover:bg-bg-elev2 border-l border-line/40 transition"
            title="最小化（避免遮挡）"
          >
            <Minus size={14} />
          </button>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="border-t border-line overflow-hidden"
            >
              <div className="max-h-[360px] overflow-y-auto">
                {tasks.map((t) => (
                  <TaskItem
                    key={t.id}
                    task={t}
                    onCancel={() => cancelTask(t.id)}
                    onRetry={() => retryTask(t.id)}
                    onPreview={() => setPreviewId(t.id)}
                  />
                ))}
              </div>
              {(failed > 0 || done > 0) && (
                <div className="px-3 py-1.5 border-t border-line/60 flex justify-end">
                  <button
                    onClick={clearFinishedTasks}
                    className="text-[11px] text-ink-mute hover:text-ink flex items-center gap-1"
                  >
                    <Trash2 size={10} />
                    清除已完成
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Stream preview drawer */}
      <AnimatePresence>
        {previewTask && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewId(null)}
            className="fixed inset-0 z-50 modal-overlay flex items-center justify-center p-8"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card w-full max-w-3xl max-h-[80vh] flex flex-col"
            >
              <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                <Sparkles size={14} className="text-accent" />
                <span className="font-semibold text-sm">{previewTask.label}</span>
                <span className="chip text-[10px] ml-2">{previewTask.status}</span>
                <button onClick={() => setPreviewId(null)} className="btn-ghost ml-auto p-1">
                  <X size={14} />
                </button>
              </div>
              <pre className="flex-1 overflow-y-auto p-4 font-mono text-[12px] text-ink-dim whitespace-pre-wrap leading-relaxed">
                {previewTask.progress || previewTask.error || '（无输出）'}
              </pre>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function TaskItem({
  task,
  onCancel,
  onRetry,
  onPreview,
}: {
  task: Task;
  onCancel: () => void;
  onRetry: () => void;
  onPreview: () => void;
}) {
  return (
    <div
      className={cn(
        'px-3 py-2.5 border-b border-line/40 hover:bg-bg-elev2 transition group cursor-pointer',
        task.status === 'failed' && 'bg-bad/5',
      )}
      onClick={onPreview}
    >
      <div className="flex items-center gap-2">
        <StatusBadge status={task.status} />
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">{task.label}</div>
          <div className="text-[10px] text-ink-mute mt-0.5 flex items-center gap-2">
            {task.status === 'running' && task.progress && (
              <span>{task.progress.length} 字符已输出</span>
            )}
            {task.status === 'running' && !task.progress && <span>等待响应…</span>}
            {task.status === 'queued' && <span>排队中</span>}
            {task.status === 'done' && task.durationMs !== undefined && (
              <span>用时 {(task.durationMs / 1000).toFixed(1)}s</span>
            )}
            {task.status === 'failed' && (
              <span className="text-bad truncate">{task.error?.slice(0, 60)}</span>
            )}
            {task.status === 'cancelled' && <span>已取消</span>}
            {task.retryAttempt && task.status === 'running' && (
              <span className="chip-warn text-[9px]">重试 {task.retryAttempt}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition" onClick={(e) => e.stopPropagation()}>
          {task.status === 'running' && (
            <button onClick={onCancel} className="btn-ghost p-1" title="取消">
              <X size={12} />
            </button>
          )}
          {task.status === 'failed' && (
            <button onClick={onRetry} className="btn-ghost p-1 text-accent-glow" title="重试">
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Task['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 size={14} className="text-accent animate-spin shrink-0" />;
    case 'queued':
      return <Clock size={14} className="text-ink-mute shrink-0" />;
    case 'done':
      return <CheckCircle2 size={14} className="text-ok shrink-0" />;
    case 'failed':
      return <XCircle size={14} className="text-bad shrink-0" />;
    case 'cancelled':
      return <X size={14} className="text-ink-mute shrink-0" />;
  }
}
