/**
 * 右侧栏：题目 & 分析 / 问教练 双 tab + 底部嵌入 Agent 行动日志（可拖动调高度）。
 *
 * 布局（自上而下）：
 *  - h-9 标题行：Coach 状态 + 进度
 *  - h-9 Tab 行：题目 / 问教练
 *  - flex-1：tab 内容（题目 → ProblemSummary + 实时流 + ResultView；问教练 → QAPanel）
 *  - 1px row resize handle（拖动改变下方 trace 区高度）
 *  - 固定 height：AgentTracePanel
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import {
  Activity,
  Sparkles,
  Loader2,
  ScrollText,
  ExternalLink,
  MessageCircle,
  ChevronDown,
  AlertTriangle,
  Wand2,
} from 'lucide-react';
import { MathMarkdown } from './MathMarkdown';
import { QAPanel } from './QAPanel';
import { ResizeHandle } from './ResizeHandle';
import { AgentTracePanel } from './AgentTracePanel';
import { usePersistedWidth } from '../lib/usePersistedWidth';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { safeGetItem, safeSetItem } from '../lib/safeLocalStorage';

import { codeHash } from '../core/utils';

const AlgoVizPanel = lazy(() => import('./AlgoVizPanel').then((m) => ({ default: m.AlgoVizPanel })));
const TRACE_COLLAPSED_KEY = 'aicc.layout.traceCollapsed';

export function FeedbackPanel() {
  const [width, setWidth] = usePersistedWidth('aicc.layout.feedbackWidth', 420, 280, 900);
  const [traceH, setTraceH] = usePersistedWidth(
    'aicc.layout.traceHeight',
    112, // 96 太挤，空状态文字几乎贴底；112 给 header(28) + 一两行内容 + 呼吸
    32,
    640,
  );
  const [traceCollapsed, setTraceCollapsed] = useState(() =>
    safeGetItem(TRACE_COLLAPSED_KEY) !== '0',
  );
  const toggleTraceCollapsed = () => {
    setTraceCollapsed((v) => {
      safeSetItem(TRACE_COLLAPSED_KEY, v ? '0' : '1');
      return !v;
    });
  };
  const activeProblemId = useStore((s) => s.activeProblemId);
  const analysisByProblem = useStore((s) => s.analysisByProblem);
  const tasks = useStore((s) => s.tasks);
  const streamPreview = useStore((s) => s.streamPreviewById);
  const problems = useStore((s) => s.problems);
  const filesByScope = useStore((s) => s.filesByScope);
  const activeFileIdByScope = useStore((s) => s.activeFileIdByScope);
  const qaByProblem = useStore((s) => s.qaByProblem);
  const qaPendingProblemId = useStore((s) => s.qaPendingProblemId);
  const tab = useStore((s) => s.feedbackTab);
  const setTab = useStore((s) => s.setFeedbackTab);
  const ollamaMode = useStore((s) => s.aiConfig.ollamaMode);
  const agentTraceCount = useStore((s) => s.agentTrace.length);

  const key = activeProblemId ?? '__draft__';
  const result = analysisByProblem[key];
  const problem = activeProblemId
    ? problems.find((p) => p.id === activeProblemId) ?? null
    : null;
  const activeFile = (filesByScope[key] ?? []).find((f) => f.id === activeFileIdByScope[key]);
  const resultFresh =
    !!result &&
    !!activeFile &&
    (!result.fileId || result.fileId === activeFile.id) &&
    (!result.codeHash || result.codeHash === codeHash(activeFile.content));
  const qaCount = (qaByProblem[key] ?? []).filter((m) => m.role === 'user').length;
  const qaActive = qaPendingProblemId === key;

  const runningAnalysis = tasks.find(
    (t) => t.kind === 'analyze-code' && t.status === 'running',
  );

  // algoViz 已亮起的模块数 — 在 Tab 上做 badge 提示，让用户在「题目」Tab 也能看到进度
  const moduleStatus = useStore((s) =>
    activeProblemId ? s.moduleStatusByProblem[activeProblemId] : undefined,
  );
  const algoVizStatusReady = !!problem?.algoViz?.statusCode && !!problem.algoViz.detectionSchema;
  const algoVizActiveCount = algoVizStatusReady
    ? problem.algoViz!.detectionSchema!.modules.filter((m) => !!moduleStatus?.[m.id]).length
    : 0;
  const algoVizTotalCount = algoVizStatusReady ? problem.algoViz!.detectionSchema!.modules.length : 0;
  const algoVizDetecting = useStore((s) =>
    activeProblemId ? !!s.algoVizDetectingByProblem[activeProblemId] : false,
  );
  const showAlgoVizProgress = ollamaMode !== 'disabled' && algoVizStatusReady;

  return (
    <>
      <ResizeHandle direction="left" currentWidth={width} onResize={setWidth} min={280} max={900} />
      <aside
        className="border-l border-line bg-bg flex flex-col min-h-0 flex-shrink-0"
        style={{ width: `${width}px` }}
      >
        {/* 顶部 Tab bar — Coach 标识合并到此处省一行 36px；spinner 浮在最右 */}
        <div className="h-9 border-b border-line bg-bg-elev/60 flex items-stretch shrink-0 relative">
          <div className="px-2 flex items-center gap-1 text-accent-glow shrink-0">
            <Sparkles size={12} />
          </div>
          <TabButton
            active={tab === 'analyze'}
            onClick={() => setTab('analyze')}
            icon={<ScrollText size={12} />}
            label={resultFresh && result && result.issues.length > 0 ? '题目 · 分析' : '题目'}
            badge={resultFresh && result && result.issues.length > 0 ? result.issues.length : undefined}
          />
          <TabButton
            active={tab === 'ask'}
            onClick={() => setTab('ask')}
            icon={<MessageCircle size={12} />}
            label="问教练"
            badge={qaCount > 0 ? qaCount : undefined}
            pulsing={qaActive}
          />
          <TabButton
            active={tab === 'algoviz'}
            onClick={() => setTab('algoviz')}
            icon={<Wand2 size={12} />}
            label={
              showAlgoVizProgress && algoVizTotalCount > 0
                ? `算法 ${algoVizActiveCount}/${algoVizTotalCount}`
                : '算法动画'
            }
            pulsing={showAlgoVizProgress && algoVizDetecting}
          />
          {/* spinner 浮在 Tab bar 最右，indicate 后台 LLM 在跑 */}
          {(qaActive || runningAnalysis) && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
              <Loader2 size={12} className="animate-spin text-accent" />
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          {tab === 'analyze' ? (
            <AnalyzeTabContent
              problem={problem}
              result={result}
              resultFresh={resultFresh}
              runningAnalysis={runningAnalysis}
              streamPreview={streamPreview}
            />
          ) : tab === 'ask' ? (
            <QAPanel />
          ) : (
            <ErrorBoundary title="算法可视化面板异常" compact>
              <Suspense fallback={<div className="p-3 text-xs text-ink-mute">加载可视化面板…</div>}>
                <AlgoVizPanel />
              </Suspense>
            </ErrorBoundary>
          )}
        </div>

        {traceCollapsed ? (
          <button
            onClick={toggleTraceCollapsed}
            className="h-7 w-full flex items-center px-2 border-t border-line bg-bg-elev/40 text-[11px] text-ink-mute hover:text-ink hover:bg-bg-elev2 transition shrink-0"
          >
            <Activity size={11} className="text-accent mr-1.5" />
            Agent · {agentTraceCount} 条行动 · 点击展开
          </button>
        ) : (
          <>
            <RowResizeHandle currentHeight={traceH} onResize={setTraceH} min={32} max={640} />
            <div
              className="border-t border-line shrink-0 overflow-hidden"
              style={{ height: `${traceH}px` }}
            >
              <AgentTracePanel onToggleCollapsed={toggleTraceCollapsed} />
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
  pulsing,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  pulsing?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 text-xs font-medium border-b-2 transition',
        active
          ? 'border-accent text-accent-glow bg-accent/5'
          : 'border-transparent text-ink-dim hover:text-ink hover:bg-bg-elev2',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
      {pulsing && (
        <Loader2 size={10} className="animate-spin text-accent shrink-0" />
      )}
      {!pulsing && badge !== undefined && (
        <span
          className={cn(
            'chip text-[9px] px-1.5 py-0',
            active ? 'border-accent/60 text-accent' : '',
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function AnalyzeTabContent({
  problem,
  result,
  resultFresh,
  runningAnalysis,
  streamPreview,
}: {
  problem: import('../core/types').Problem | null;
  result?: import('../core/types').AnalysisResult;
  resultFresh: boolean;
  runningAnalysis: import('../lib/store').Task | undefined;
  streamPreview: Record<string, string>;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {problem && <ProblemSummary problem={problem} />}
      <AnimatePresence>
        {runningAnalysis && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-b border-line/60 bg-accent/5"
          >
            <div className="px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-accent-glow font-semibold mb-2">
                <Activity size={12} className="animate-pulse" />
                实时流式输出
              </div>
              <pre className="text-[11px] text-ink-dim font-mono leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap">
                {streamPreview[runningAnalysis.id] || '正在思考…'}
                <span className="inline-block w-1.5 h-3 bg-accent ml-0.5 animate-pulse" />
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {result ? (
        <ResultView result={result} stale={!resultFresh} />
      ) : !runningAnalysis ? (
        <EmptyState problemActive={!!problem} />
      ) : null}
    </div>
  );
}

/** 题目摘要：去嵌套卡片，靠标题 + 字距分隔 */
function ProblemSummary({ problem }: { problem: import('../core/types').Problem }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-line/60 bg-bg">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full sticky top-0 z-10 bg-bg cursor-pointer px-4 py-2.5 hover:bg-bg-elev2/50 text-sm font-medium flex items-center gap-2 border-b border-line/40"
        aria-expanded={open}
      >
        <ChevronDown
          size={14}
          className={cn(
            'text-ink-mute transition-transform duration-150 shrink-0',
            open ? 'rotate-0' : '-rotate-90',
          )}
        />
        <ScrollText size={14} className="text-ink-dim shrink-0" />
        <span className="truncate flex-1 text-left">{problem.title}</span>
        {problem.tags && problem.tags.length > 0 && (
          <span className="flex gap-1 shrink-0">
            {problem.tags.slice(0, 2).map((t) => (
              <span key={t} className="chip text-[9px] px-1.5 py-0">
                {t}
              </span>
            ))}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 py-3 text-xs text-ink-dim space-y-3">
          <MathMarkdown compact className="leading-relaxed">
            {problem.statement}
          </MathMarkdown>

          {problem.constraints && (
            <div>
              <SectionHeader>约束</SectionHeader>
              <div className="text-[11px] mt-1">
                <MathMarkdown compact>{problem.constraints}</MathMarkdown>
              </div>
            </div>
          )}

          {problem.examples && problem.examples.length > 0 && (
            <div>
              <SectionHeader>示例</SectionHeader>
              <div className="space-y-2 mt-1">
                {problem.examples.slice(0, 2).map((ex, i) => (
                  <div key={i} className="font-mono text-[11px] border-l-2 border-line pl-2.5">
                    <div className="text-cyan/80 text-[10px] mb-0.5">输入</div>
                    <div className="whitespace-pre-wrap">{ex.input}</div>
                    <div className="text-ok/80 text-[10px] mt-1.5 mb-0.5">输出</div>
                    <div className="whitespace-pre-wrap">{ex.output}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {problem.plainExplanation && (
            <div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
              <SectionHeader>白话</SectionHeader>
              <div className="text-[12px] text-ink-dim leading-relaxed mt-1">
                <MathMarkdown compact>{problem.plainExplanation}</MathMarkdown>
              </div>
            </div>
          )}

          {problem.source && /^https?:\/\//.test(problem.source) && (
            <a
              href={problem.source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent-glow transition"
              title={problem.source}
            >
              <ExternalLink size={11} />
              打开原题页
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
      {children}
    </div>
  );
}

function ResultView({
  result,
  stale,
}: {
  result: import('../core/types').AnalysisResult;
  stale: boolean;
}) {
  const issues = result.issues;
  const route = result.routeInfo;
  if (stale) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-warn/35 bg-warn/10 px-3 py-2 text-xs text-warn flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">这份分析来自旧代码</div>
            <div className="text-[11px] opacity-85 mt-0.5">
              旧问题计数和行内批注已隐藏。可以直接问 Coach「帮我看看哪里错了」获取当前版本反馈。
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="p-4 space-y-3">
      {route && (
        <div
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] border',
            route.useFast
              ? 'bg-ok/10 border-ok/30 text-ok'
              : 'bg-cyan/10 border-cyan/30 text-cyan',
          )}
          title={route.reason}
        >
          {route.label}
          <span className="opacity-60">·</span>
          <span className="opacity-70">{route.reason}</span>
        </div>
      )}

      {result.overallComment && (
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-accent-glow">
            <Sparkles size={12} />
            总评
          </div>
          <p className="text-sm text-ink leading-relaxed">{result.overallComment}</p>
        </div>
      )}

      {result.complexitySummary && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan/5 border border-cyan/20">
          <Activity size={14} className="text-cyan" />
          <span className="text-xs font-mono text-cyan">{result.complexitySummary}</span>
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px] text-ink-mute flex-wrap">
        <span className="label">本次发现</span>
        {issues.length === 0 ? (
          <span className="text-ok">没明显问题 ✓</span>
        ) : (
          <>
            {(['error', 'warning', 'info', 'hint'] as const).map((sev) => {
              const n = issues.filter((i) => i.severity === sev).length;
              if (n === 0) return null;
              return (
                <span
                  key={sev}
                  className={cn(
                    'chip text-[10px] px-1.5 py-0',
                    sev === 'error' && 'chip-bad',
                    sev === 'warning' && 'chip-warn',
                    sev === 'info' && 'border-cyan/40 text-cyan bg-cyan/15',
                    sev === 'hint' && 'border-line text-ink-mute',
                  )}
                  title={`${n} 个 ${sev}`}
                >
                  {SEV_LABEL[sev]} {n}
                </span>
              );
            })}
            <span className="text-ink-mute italic ml-1">（详情见代码行末批注）</span>
          </>
        )}
      </div>
    </div>
  );
}

const SEV_LABEL: Record<string, string> = {
  error: '错误',
  warning: '警告',
  info: '提示',
  hint: '风格',
};

function EmptyState({ problemActive }: { problemActive: boolean }) {
  return (
    <div className="px-4 py-6 text-center text-[11px] text-ink-mute leading-relaxed">
      {problemActive ? (
        <>
          写完代码可以直接问 Coach「帮我看看哪里错了」，问题会以
          <span className="text-accent"> // 批注 </span>
          形式直接出现在代码行末。
        </>
      ) : (
        <span>
          还没激活题目。<br />
          去右上角 <span className="px-1 py-0.5 rounded bg-bg-elev2 border border-line text-[11px] text-ink mx-0.5">题目 ▾</span>选「题库」或「录入题目」。<br />
          也可以点上面「问教练」直接聊学习方向 / 算法概念。
        </span>
      )}
    </div>
  );
}

// ───────── 行 resize handle（顶边拖动改下方区高度） ─────────

function RowResizeHandle({
  currentHeight,
  onResize,
  min,
  max,
}: {
  currentHeight: number;
  onResize: (h: number) => void;
  min: number;
  max: number;
}) {
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startY: e.clientY, startH: currentHeight };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      const next = Math.max(min, Math.min(max, dragRef.current.startH + delta));
      onResize(next);
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      cleanupRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    cleanupRef.current = onUp;
  };

  return (
    <div
      onMouseDown={onMouseDown}
      className="group relative h-1 cursor-row-resize shrink-0 hover:bg-accent/30 active:bg-accent/50 transition-colors"
      title="拖动调整 Agent 行动区高度"
    >
      <div className="absolute inset-x-0 -inset-y-px group-hover:bg-accent/30 group-active:bg-accent/50 transition-colors" />
    </div>
  );
}
