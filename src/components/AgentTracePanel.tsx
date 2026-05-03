/**
 * Agent 行动面板 — 让评委/学生一眼看到 Coach 在「自己做事」。
 *
 * 三个视图切换：
 *   - List   时间线（看动作顺序）
 *   - Graph  拓扑（看 Agent 怎么协作 + 实时高亮 active 节点）
 *   - Stats  仪表板（看每个 Agent 的调用次数 / 延迟 / token / 错误数）
 */
import {
  Activity,
  Eye,
  Lightbulb,
  Hand,
  CheckCircle2,
  Trash2,
  List,
  Network,
  BarChart3,
  Minimize2,
} from 'lucide-react';
import { lazy, Suspense, startTransition, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { AgentTraceEvent, AgentTraceKind, AgentTraceLevel } from '../lib/store';
import { cn } from '../lib/cn';
import { ErrorBoundary } from './ErrorBoundary';

const AgentGraph = lazy(() => import('./AgentGraph').then((m) => ({ default: m.AgentGraph })));
const AgentDashboard = lazy(() => import('./AgentDashboard').then((m) => ({ default: m.AgentDashboard })));

type View = 'list' | 'graph' | 'stats';

const KIND_META: Record<
  AgentTraceKind,
  { label: string; icon: typeof Eye; color: string }
> = {
  perceive: { label: '感知', icon: Eye, color: 'text-cyan' },
  decide: { label: '决策', icon: Lightbulb, color: 'text-accent' },
  act: { label: '行动', icon: Hand, color: 'text-warn' },
  feedback: { label: '反馈', icon: CheckCircle2, color: 'text-ok' },
};

const LEVEL_BORDER: Record<AgentTraceLevel, string> = {
  info: 'border-line/60',
  success: 'border-ok/40',
  warn: 'border-warn/40',
  error: 'border-bad/60',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function filterTraceForProblem(trace: AgentTraceEvent[], activeProblemId: string | null): AgentTraceEvent[] {
  if (!activeProblemId) {
    return trace.filter((ev) => !ev.problemId);
  }
  return trace.filter((ev) => !ev.problemId || ev.problemId === activeProblemId);
}

export function AgentTracePanel({
  onToggleCollapsed,
  defaultView = 'list',
}: {
  onToggleCollapsed?: () => void;
  defaultView?: View;
}) {
  const trace = useStore((s) => s.agentTrace);
  const activeProblemId = useStore((s) => s.activeProblemId);
  const clear = useStore((s) => s.clearAgentTrace);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useState<View>(defaultView);
  const visibleTrace = useMemo(
    () => filterTraceForProblem(trace, activeProblemId),
    [trace, activeProblemId],
  );

  return (
    <div className="flex flex-col min-h-0 h-full bg-bg-elev/40">
      {/* Header */}
      <div className="h-7 px-2 flex items-center gap-1.5 border-b border-line/60 shrink-0 bg-bg-elev">
        <Activity size={11} className="text-accent" />
        <span className="text-[11px] font-semibold text-accent-glow">Agent</span>
        <span
          className="text-[10px] text-ink-mute"
          title={activeProblemId ? `当前题目事件 ${visibleTrace.length} / 全局 ${trace.length}` : `全局事件 ${visibleTrace.length} / 全部 ${trace.length}`}
        >
          {visibleTrace.length}
        </span>
        {/* 视图切换 */}
        <div className="ml-auto flex items-center bg-bg-elev2 rounded border border-line/60 p-0.5">
          <ViewBtn icon={List} active={view === 'list'} onClick={() => startTransition(() => setView('list'))} title="时间线" />
          <ViewBtn icon={Network} active={view === 'graph'} onClick={() => startTransition(() => setView('graph'))} title="协作拓扑" />
          <ViewBtn icon={BarChart3} active={view === 'stats'} onClick={() => startTransition(() => setView('stats'))} title="仪表板" />
        </div>
        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            className="text-ink-mute hover:text-ink transition flex items-center text-[10px] ml-1"
            title="折叠 Agent 面板"
          >
            <Minimize2 size={10} />
          </button>
        )}
        {trace.length > 0 && (
          <button
            onClick={clear}
            className="text-ink-mute hover:text-bad transition flex items-center text-[10px] ml-1"
            title="清空 Agent 日志"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
      {/* Body */}
      {view === 'list' && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {visibleTrace.length === 0 ? (
            // 空状态紧凑化：避免占据右下大片屏幕。提示一行就够，详细解释挪到 title。
            <div
              className="text-[10.5px] text-ink-mute px-3 py-2 italic"
              title="激活一道题、点「问教练」或跑一次代码，Coach 的每一步决策（哪个 agent / 走云端还是本地 / 耗时多少）都会出现在这里。"
            >
              暂无当前题目行动 · 跑一次代码或问一次教练即可激活
            </div>
          ) : (
            visibleTrace.map((ev) => (
              <TraceItem
                key={ev.id}
                ev={ev}
                expanded={expandedId === ev.id}
                onToggle={() =>
                  setExpandedId((id) => (id === ev.id ? null : ev.id))
                }
              />
            ))
          )}
        </div>
      )}
      {view === 'graph' && (
        <ErrorBoundary title="Agent 拓扑异常" compact>
          <Suspense fallback={<div className="p-2 text-[10px] text-ink-mute">加载拓扑…</div>}>
            <AgentGraph trace={visibleTrace} />
          </Suspense>
        </ErrorBoundary>
      )}
      {view === 'stats' && (
        <ErrorBoundary title="Agent 统计异常" compact>
          <Suspense fallback={<div className="p-2 text-[10px] text-ink-mute">加载统计…</div>}>
            <AgentDashboard trace={visibleTrace} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}

function ViewBtn({
  icon: Icon,
  active,
  onClick,
  title,
}: {
  icon: typeof List;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'px-1.5 py-0.5 rounded transition flex items-center',
        active
          ? 'bg-accent/20 text-accent-glow'
          : 'text-ink-mute hover:text-ink',
      )}
    >
      <Icon size={10} />
    </button>
  );
}

function TraceItem({
  ev,
  expanded,
  onToggle,
}: {
  ev: AgentTraceEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = KIND_META[ev.kind];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full text-left px-3 py-1.5 border-b border-l-2 transition hover:bg-bg-elev2',
        LEVEL_BORDER[ev.level],
        'border-b-line/30',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon size={11} className={cn('mt-0.5 shrink-0', meta.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px]">
            <span className={cn('uppercase tracking-wider font-semibold', meta.color)}>
              {meta.label}
            </span>
            <span className="text-[10px] text-ink-mute font-mono">
              {formatTime(ev.ts)}
            </span>
          </div>
          <div className="text-[11px] text-ink mt-0.5 leading-snug break-words">
            {ev.title}
          </div>
          {expanded && ev.detail && (
            <pre className="mt-1 text-[10px] text-ink-dim font-mono whitespace-pre-wrap leading-relaxed bg-bg-elev/40 border border-line/40 rounded px-2 py-1 max-h-32 overflow-y-auto">
              {ev.detail}
            </pre>
          )}
        </div>
      </div>
    </button>
  );
}
