import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import {
  AlertTriangle,
  Bug,
  Info,
  Lightbulb,
  Activity,
  Sparkles,
  Loader2,
  ScrollText,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo } from 'react';
import type { Severity } from '../core/types';

export function FeedbackPanel() {
  const activeProblemId = useStore((s) => s.activeProblemId);
  const analysisByProblem = useStore((s) => s.analysisByProblem);
  const tasks = useStore((s) => s.tasks);
  const streamPreview = useStore((s) => s.streamPreviewById);
  const problems = useStore((s) => s.problems);

  const key = activeProblemId ?? '__draft__';
  const result = analysisByProblem[key];
  const problem = activeProblemId ? problems.find((p) => p.id === activeProblemId) : null;

  // 找到正在跑的相关任务
  const runningAnalysis = tasks.find(
    (t) => t.kind === 'analyze-code' && t.status === 'running',
  );

  return (
    <aside className="w-[400px] border-l border-line bg-bg-elev/30 flex flex-col min-h-0">
      <div className="h-9 px-4 border-b border-line bg-bg-elev/40 flex items-center gap-2 text-xs">
        <Sparkles size={14} className="text-accent" />
        <span className="font-semibold">AI 反馈</span>
        {runningAnalysis && (
          <span className="ml-auto flex items-center gap-1.5 text-accent-glow text-[11px]">
            <Loader2 size={12} className="animate-spin" />
            分析中…
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 题目摘要 */}
        {problem && (
          <details className="border-b border-line/60" open>
            <summary className="cursor-pointer px-4 py-2.5 hover:bg-bg-elev2 text-sm font-medium flex items-center gap-2">
              <ScrollText size={14} className="text-ink-dim" />
              题目：{problem.title}
              {problem.tags && problem.tags.length > 0 && (
                <span className="ml-auto flex gap-1">
                  {problem.tags.slice(0, 2).map((t) => (
                    <span key={t} className="chip text-[9px] px-1.5 py-0">
                      {t}
                    </span>
                  ))}
                </span>
              )}
            </summary>
            <div className="px-4 pb-3 text-xs text-ink-dim space-y-2">
              <p className="whitespace-pre-wrap leading-relaxed">{problem.statement}</p>
              {problem.constraints && (
                <div>
                  <div className="font-semibold text-ink mb-0.5">约束</div>
                  <pre className="font-mono text-[11px] bg-bg/60 border border-line/60 rounded p-2 whitespace-pre-wrap">
                    {problem.constraints}
                  </pre>
                </div>
              )}
              {problem.examples && problem.examples.length > 0 && (
                <div>
                  <div className="font-semibold text-ink mb-1">示例</div>
                  {problem.examples.slice(0, 2).map((ex, i) => (
                    <div key={i} className="bg-bg/60 border border-line/60 rounded p-2 mb-1 font-mono text-[11px]">
                      <div className="text-cyan">输入：</div>
                      <div className="whitespace-pre-wrap">{ex.input}</div>
                      <div className="text-ok mt-1">输出：</div>
                      <div className="whitespace-pre-wrap">{ex.output}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        )}

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
    </aside>
  );
}

function ResultView({ result }: { result: import('../core/types').AnalysisResult }) {
  const issues = result.issues;
  return (
    <div className="p-4 space-y-3">
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

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="label">{issues.length === 0 ? '没发现明显问题' : `发现 ${issues.length} 个问题`}</span>
        </div>
        {issues.map((iss, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className={cn(
              'rounded-xl border p-3 transition',
              iss.severity === 'error' && 'border-bad/40 bg-bad/5 hover:border-bad/60',
              iss.severity === 'warning' && 'border-warn/40 bg-warn/5 hover:border-warn/60',
              iss.severity === 'info' && 'border-cyan/30 bg-cyan/5 hover:border-cyan/50',
              iss.severity === 'hint' && 'border-line bg-bg-elev2 hover:border-ink-mute',
            )}
          >
            <div className="flex items-start gap-2">
              <SeverityIcon sev={iss.severity} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[11px] mb-1">
                  <span className={cn('font-mono font-semibold', `severity-${iss.severity}`)}>
                    L{iss.line}
                  </span>
                  <span className="chip text-[9px] px-1.5 py-0">{iss.category}</span>
                  <span className={cn('text-[10px] uppercase tracking-wider font-bold', `severity-${iss.severity}`)}>
                    {iss.severity}
                  </span>
                </div>
                <p className="text-sm text-ink leading-relaxed">{iss.message}</p>
                {iss.suggestion && (
                  <div className="mt-2 pl-3 border-l-2 border-accent/40">
                    <div className="text-[10px] uppercase tracking-wider text-accent-glow font-semibold mb-1">
                      建议
                    </div>
                    <div className="text-xs text-ink-dim md-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{iss.suggestion}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SeverityIcon({ sev }: { sev: Severity }) {
  const Icon = useMemo(() => {
    if (sev === 'error') return Bug;
    if (sev === 'warning') return AlertTriangle;
    if (sev === 'info') return Info;
    return Lightbulb;
  }, [sev]);
  return <Icon size={16} className={cn('mt-0.5 shrink-0', `severity-${sev}`)} />;
}

function EmptyState() {
  return (
    <div className="p-8 text-center">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-accent/20 to-cyan/10 border border-accent/30 flex items-center justify-center mb-3">
        <Sparkles size={28} className="text-accent" />
      </div>
      <h3 className="text-sm font-semibold mb-1">还没有 AI 反馈</h3>
      <p className="text-xs text-ink-mute leading-relaxed">
        写完一段代码后，点顶部 <span className="chip-accent mx-1">分析代码</span> 即可。
        <br />
        分析在后台跑，<strong>不会卡住编辑器</strong>。
      </p>
    </div>
  );
}
