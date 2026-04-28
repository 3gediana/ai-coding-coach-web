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
} from 'lucide-react';
import { MathMarkdown } from './MathMarkdown';
import { QAPanel } from './QAPanel';

export function FeedbackPanel() {
  const activeProblemId = useStore((s) => s.activeProblemId);
  const analysisByProblem = useStore((s) => s.analysisByProblem);
  const tasks = useStore((s) => s.tasks);
  const streamPreview = useStore((s) => s.streamPreviewById);
  const problems = useStore((s) => s.problems);
  const qaByProblem = useStore((s) => s.qaByProblem);
  const qaPendingProblemId = useStore((s) => s.qaPendingProblemId);
  // tab 状态升到 store：CodeEditor 框选「问 AI」时能从外面切到 ask
  const tab = useStore((s) => s.feedbackTab);
  const setTab = useStore((s) => s.setFeedbackTab);

  const key = activeProblemId ?? '__draft__';
  const result = analysisByProblem[key];
  const problem = activeProblemId ? problems.find((p) => p.id === activeProblemId) : null;
  const qaCount = (qaByProblem[key] ?? []).filter((m) => m.role === 'user').length;
  const qaActive = qaPendingProblemId === key;

  // 找到正在跑的相关任务
  const runningAnalysis = tasks.find(
    (t) => t.kind === 'analyze-code' && t.status === 'running',
  );

  return (
    <aside className="w-[400px] border-l border-line bg-bg flex flex-col min-h-0">
      {/* Tab toolbar */}
      <div className="h-9 border-b border-line bg-bg-elev flex items-stretch text-xs">
        <button
          onClick={() => setTab('analyze')}
          className={cn(
            'px-3 flex items-center gap-1.5 border-b-2 transition',
            tab === 'analyze'
              ? 'border-accent text-accent-glow font-semibold'
              : 'border-transparent text-ink-dim hover:text-ink',
          )}
        >
          <Sparkles size={13} />
          分析
          {runningAnalysis && (
            <Loader2 size={11} className="animate-spin text-accent" />
          )}
        </button>
        <button
          onClick={() => setTab('ask')}
          className={cn(
            'px-3 flex items-center gap-1.5 border-b-2 transition',
            tab === 'ask'
              ? 'border-accent text-accent-glow font-semibold'
              : 'border-transparent text-ink-dim hover:text-ink',
          )}
        >
          <MessageCircle size={13} />
          问 AI
          {qaCount > 0 && (
            <span className="chip text-[9px] px-1.5 py-0">{qaCount}</span>
          )}
          {qaActive && (
            <Loader2 size={11} className="animate-spin text-accent" />
          )}
        </button>
        <div className="flex-1" />
      </div>

      {/* 题目摘要：永久顶部显示，两个 tab 都能参考 */}
      {problem && tab === 'analyze' && (
        <ProblemSummary problem={problem} />
      )}

      {/* Tab 内容 */}
      {tab === 'ask' ? (
        <QAPanel />
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* 实时流（如果在跑） */}
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
                  <pre className="text-[11px] text-ink-dim font-mono leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {streamPreview[runningAnalysis.id] || '正在思考…'}
                    <span className="inline-block w-1.5 h-3 bg-accent ml-0.5 animate-pulse" />
                  </pre>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 历史结果 */}
          {result ? (
            <ResultView result={result} />
          ) : !runningAnalysis ? (
            <EmptyState />
          ) : null}
        </div>
      )}
    </aside>
  );
}

/** 题目摘要：去嵌套卡片，靠标题 + 字距分隔。学生主要时间看代码不看摘要，紧凑优先 */
function ProblemSummary({ problem }: { problem: import('../core/types').Problem }) {
  return (
    <details className="border-b border-line/60" open>
      <summary className="cursor-pointer px-4 py-2.5 hover:bg-bg-elev2/50 text-sm font-medium flex items-center gap-2">
        <ScrollText size={14} className="text-ink-dim" />
        <span className="truncate">{problem.title}</span>
        {problem.tags && problem.tags.length > 0 && (
          <span className="ml-auto flex gap-1 shrink-0">
            {problem.tags.slice(0, 2).map((t) => (
              <span key={t} className="chip text-[9px] px-1.5 py-0">{t}</span>
            ))}
          </span>
        )}
      </summary>
      <div className="px-4 pb-3 text-xs text-ink-dim space-y-3">
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
    </details>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
      {children}
    </div>
  );
}

function ResultView({ result }: { result: import('../core/types').AnalysisResult }) {
  const issues = result.issues;
  const route = result.routeInfo;
  return (
    <div className="p-4 space-y-3">
      {/* 路由标签：让用户一眼看到这次反馈是本地还是云端 */}
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

      {/* 按 severity 分类的小计（不再展开列表，详细 issue 已 inline 显示在代码里） */}
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
            <span className="text-ink-mute italic ml-1">
              （详情见代码行末批注）
            </span>
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


function EmptyState() {
  return (
    <div className="px-4 py-6 text-center text-[11px] text-ink-mute leading-relaxed">
      写完代码点顶部「分析代码」即可，问题会以
      <span className="text-accent"> // 批注 </span>
      形式直接出现在代码行末。
    </div>
  );
}
