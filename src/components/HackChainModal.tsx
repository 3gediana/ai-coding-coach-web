/**
 * Hack Chain 时间线 Modal：4-agent 严格链式编排的可视化。
 *
 * 关键作用：让评委 / 用户**一眼看到 agent 间真实的数据流**——
 *   - 每一步独立的 idle/running/success/failed/skipped 状态机
 *   - 上一步的输出是下一步的输入（可点开看 JSON）
 *   - 整链结束后挂出 Explainer / FixSuggestor 的教学输出
 *
 * 由 store.runHackChain 驱动；用户点 RuntimePane 上的「Hack Chain」按钮触发。
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import {
  Swords,
  PlayCircle,
  Microscope,
  Compass,
  Loader2,
  Check,
  X,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import type {
  AttackerOutput,
  ExecutorOutput,
  ExplainerOutput,
  FixSuggestorOutput,
  HackChainStep,
  HackChainStepState,
} from '../lib/store';

const STEP_META: Record<
  HackChainStep,
  { idx: number; title: string; subtitle: string; icon: typeof Swords; route: 'cloud' | 'fast' }
> = {
  attacker: {
    idx: 1,
    title: 'Attacker',
    subtitle: '产候选攻击 case',
    icon: Swords,
    route: 'cloud',
  },
  executor: {
    idx: 2,
    title: 'Executor',
    subtitle: '本地沙箱跑用户代码',
    icon: PlayCircle,
    route: 'fast',
  },
  explainer: {
    idx: 3,
    title: 'Explainer',
    subtitle: '解释为啥挂',
    icon: Microscope,
    route: 'cloud',
  },
  fixSuggestor: {
    idx: 4,
    title: 'FixSuggestor',
    subtitle: '给方向不给答案',
    icon: Compass,
    route: 'cloud',
  },
};

export function HackChainModal() {
  const state = useStore((s) => s.hackChainState);
  const dismiss = useStore((s) => s.dismissHackChain);
  const running = !!state?.steps.some((s) => s.status === 'running' || s.status === 'idle');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (state) setNow(Date.now());
  }, [state?.startedAt]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <AnimatePresence>
      {state && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed right-4 bottom-4 z-50 w-[min(42rem,calc(100vw-2rem))] max-h-[70vh]"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-card w-full max-h-[70vh] flex flex-col overflow-hidden shadow-2xl"
          >
            <Header onClose={dismiss} steps={state.steps} startedAt={state.startedAt} now={now} />
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <Timeline steps={state.steps} now={now} />
              <Outputs />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Header({
  onClose,
  steps,
  startedAt,
  now,
}: {
  onClose: () => void;
  steps: HackChainStepState[];
  startedAt: number;
  now: number;
}) {
  const allDone = steps.every((s) => s.status !== 'running' && s.status !== 'idle');
  const successCount = steps.filter((s) => s.status === 'success').length;
  const lastEndedAt = Math.max(0, ...steps.map((s) => s.endedAt ?? 0));
  const elapsedMs = (allDone && lastEndedAt ? lastEndedAt : now) - startedAt;
  const runningStep = steps.find((s) => s.status === 'running');
  return (
    <div className="px-6 py-4 border-b border-line flex items-center gap-3">
      <Swords size={18} className="text-warn" />
      <div className="min-w-0">
        <h2 className="text-lg font-semibold leading-tight">Hack Chain · 4-Agent 链式编排</h2>
        <div className="text-[10px] text-ink-mute">
          {runningStep ? `${STEP_META[runningStep.step].title} 正在运行` : allDone ? '链条已结束' : '等待下一步'}
        </div>
      </div>
      <span className="text-[10px] text-ink-mute font-mono ml-auto">
        {successCount}/4 步 · {(elapsedMs / 1000).toFixed(1)} 秒
        {!allDone && <Loader2 size={10} className="inline animate-spin ml-1" />}
      </span>
      <button onClick={onClose} className="btn-ghost p-1.5" title="关闭">
        <X size={16} />
      </button>
    </div>
  );
}

function Timeline({ steps, now }: { steps: HackChainStepState[]; now: number }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {steps.map((s, i) => (
        <div key={s.step} className="flex items-center">
          <StepCard state={s} now={now} />
          {i < steps.length - 1 && (
            <ArrowRight size={14} className="text-ink-mute shrink-0 -mx-0.5" />
          )}
        </div>
      ))}
    </div>
  );
}

function StepCard({ state, now }: { state: HackChainStepState; now: number }) {
  const meta = STEP_META[state.step];
  const Icon = meta.icon;
  const elapsed =
    state.startedAt ? (state.endedAt ?? now) - state.startedAt : null;
  const statusColor: Record<HackChainStepState['status'], string> = {
    idle: 'border-line/40 text-ink-mute',
    running: 'border-cyan/60 bg-cyan/5 text-cyan animate-pulse',
    success: 'border-ok/60 bg-ok/5 text-ok',
    failed: 'border-bad/60 bg-bad/5 text-bad',
    skipped: 'border-line/40 bg-bg-elev/40 text-ink-mute opacity-60',
  };
  const statusLabel: Record<HackChainStepState['status'], React.ReactNode> = {
    idle: '待开始',
    running: (
      <span className="inline-flex items-center gap-1">
        <Loader2 size={10} className="animate-spin inline" />
        运行中
      </span>
    ),
    success: <Check size={10} className="inline" />,
    failed: <AlertTriangle size={10} className="inline" />,
    skipped: '跳过',
  };
  return (
    <div className={cn('flex-1 rounded-md border px-2 py-2 transition', statusColor[state.status])}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className="shrink-0" />
        <span className="text-[11px] font-semibold truncate">
          {meta.idx}. {meta.title}
        </span>
        <span className="text-[9px] ml-auto">{statusLabel[state.status]}</span>
      </div>
      <p className="text-[9.5px] leading-tight opacity-80">{meta.subtitle}</p>
      <div className="flex items-center gap-1 mt-1 text-[9px] opacity-70">
        <span className="chip text-[9px] px-1 py-0">{meta.route}</span>
        {elapsed !== null && <span className="font-mono">{(elapsed / 1000).toFixed(1)}s</span>}
      </div>
      {state.error && (
        <p className="text-[9.5px] text-bad mt-1 truncate" title={state.error}>
          ⚠ {state.error}
        </p>
      )}
    </div>
  );
}

function Outputs() {
  const result = useStore((s) => s.hackChainState?.result);
  if (!result) return null;
  return (
    <div className="space-y-3">
      {result.attacker && <AttackerSection data={result.attacker} winningIndex={result.executor?.winningIndex ?? null} />}
      {result.executor && <ExecutorSection data={result.executor} />}
      {result.explainer && <ExplainerSection data={result.explainer} />}
      {result.fixSuggestor && <FixSuggestorSection data={result.fixSuggestor} />}
      {!result.attacker && (
        <div className="rounded-md border border-bad/40 bg-bad/5 p-3 text-xs text-bad">
          Attacker 失败：{result.failedSteps.includes('attacker') ? '模型未返回有效候选' : '未知'}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  color,
  children,
  defaultOpen,
}: {
  title: string;
  icon: typeof Swords;
  color: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border border-line/60 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn('w-full px-3 py-1.5 flex items-center gap-2 text-[12px] font-semibold transition', color)}
      >
        <Icon size={13} />
        {title}
        {open ? (
          <ChevronDown size={12} className="ml-auto" />
        ) : (
          <ChevronRight size={12} className="ml-auto" />
        )}
      </button>
      {open && <div className="px-3 py-2 text-[11px] space-y-2">{children}</div>}
    </div>
  );
}

function AttackerSection({
  data,
  winningIndex,
}: {
  data: AttackerOutput | null;
  winningIndex: number | null;
}) {
  if (!data) return null;
  return (
    <Section title="Attacker · 输出" icon={Swords} color="bg-warn/10 text-warn" defaultOpen>
      <div className="text-ink-dim">
        <strong>假设：</strong>
        {data.hypothesis}
      </div>
      <div className="space-y-1">
        {data.candidates.map((c, i) => (
          <div
            key={i}
            className={cn(
              'rounded border px-2 py-1.5',
              i === winningIndex ? 'border-bad/60 bg-bad/5' : 'border-line/40 bg-bg-elev/30',
            )}
          >
            <div className="flex items-center gap-2 text-[10.5px] mb-1">
              <span className="chip text-[9px] px-1 py-0">{c.kind}</span>
              <span className="text-ink">{c.description}</span>
              {i === winningIndex && (
                <span className="ml-auto text-[10px] text-bad font-semibold">✗ 成功 hack</span>
              )}
            </div>
            <pre className="font-mono text-[10px] text-ink-dim bg-bg-base/40 rounded p-1.5 max-h-20 overflow-y-auto whitespace-pre-wrap">
              {c.stdin}
            </pre>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ExecutorSection({
  data,
}: {
  data: ExecutorOutput | null;
}) {
  if (!data) return null;
  return (
    <Section title="Executor · 输出" icon={PlayCircle} color="bg-cyan/10 text-cyan">
      <table className="w-full text-[10.5px] font-mono">
        <thead className="text-ink-mute">
          <tr>
            <th className="text-left py-1">case</th>
            <th className="text-left">exit</th>
            <th className="text-left">耗时</th>
            <th className="text-left">结果</th>
          </tr>
        </thead>
        <tbody>
          {data.results.map((r, i) => (
            <tr key={i} className="border-t border-line/30">
              <td className="py-1">#{i + 1}</td>
              <td>{r.exitCode}</td>
              <td>{r.durationMs}ms</td>
              <td className={r.hacked ? 'text-bad' : 'text-ok'}>
                {r.hacked ? `✗ ${r.reason ?? 'hacked'}` : '✓ ok'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function ExplainerSection({
  data,
}: {
  data: ExplainerOutput | null;
}) {
  if (!data) return null;
  return (
    <Section title="Explainer · 输出" icon={Microscope} color="bg-accent/10 text-accent" defaultOpen>
      <div>
        <strong className="text-ink">{data.diagnosis}</strong>
      </div>
      <p className="text-ink-dim leading-relaxed">{data.rootCause}</p>
    </Section>
  );
}

function FixSuggestorSection({
  data,
}: {
  data: FixSuggestorOutput | null;
}) {
  if (!data) return null;
  return (
    <Section title="FixSuggestor · 输出" icon={Compass} color="bg-ok/10 text-ok" defaultOpen>
      <div>
        <strong>方向：</strong>
        <span className="text-ink">{data.direction}</span>
      </div>
      <p className="text-ink-dim leading-relaxed">{data.hint}</p>
      {data.conceptKeywords.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {data.conceptKeywords.map((k, i) => (
            <span key={i} className="chip text-[10px] px-1.5 py-0">
              {k}
            </span>
          ))}
        </div>
      )}
    </Section>
  );
}
