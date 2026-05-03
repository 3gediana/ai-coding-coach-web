/**
 * Agent 性能仪表板 — 给评委看"工程化"标签。
 *
 * 数据全部从 store.agentTrace 聚合：
 *   - 调用次数 / 最近调用时间 / 错误数
 *   - 路由分布（本地 ⚡ / 云端 ☁ / 未知）
 *   - 平均延迟（如果 trace 里有 latencyMs，否则按相邻 perceive→feedback ts 推算）
 *   - 累计 token（仅 cloud agents 有，靠 trace 里的 tokenIn/tokenOut）
 */
import { useMemo } from 'react';
import { useStore } from '../lib/store';
import type { AgentName, AgentTraceEvent } from '../lib/store';
import { Activity, Zap, Cloud, AlertCircle } from 'lucide-react';
import { cn } from '../lib/cn';

interface AgentStats {
  name: AgentName;
  count: number;
  errors: number;
  fastCount: number;
  cloudCount: number;
  lastTs: number;
  totalLatencyMs: number;
  latencySamples: number;
  tokenIn: number;
  tokenOut: number;
}

function buildStats(trace: AgentTraceEvent[]): AgentStats[] {
  const map = new Map<AgentName, AgentStats>();
  // perceive→feedback 配对推算 latency（同一 agentName 的最近 perceive 时间戳）
  const lastPerceiveTs = new Map<AgentName, number>();

  // trace 是 desc 排序，反转来按时间顺序处理
  for (let i = trace.length - 1; i >= 0; i--) {
    const ev = trace[i];
    const name = ev.agentName ?? ('Other' as AgentName);
    let s = map.get(name);
    if (!s) {
      s = {
        name,
        count: 0,
        errors: 0,
        fastCount: 0,
        cloudCount: 0,
        lastTs: 0,
        totalLatencyMs: 0,
        latencySamples: 0,
        tokenIn: 0,
        tokenOut: 0,
      };
      map.set(name, s);
    }
    s.count++;
    if (ev.level === 'error') s.errors++;
    if (ev.route === 'fast') s.fastCount++;
    if (ev.route === 'cloud') s.cloudCount++;
    if (ev.ts > s.lastTs) s.lastTs = ev.ts;
    if (typeof ev.tokenIn === 'number') s.tokenIn += ev.tokenIn;
    if (typeof ev.tokenOut === 'number') s.tokenOut += ev.tokenOut;
    if (typeof ev.latencyMs === 'number') {
      s.totalLatencyMs += ev.latencyMs;
      s.latencySamples++;
    } else if (ev.kind === 'perceive') {
      lastPerceiveTs.set(name, ev.ts);
    } else if (ev.kind === 'feedback' || ev.kind === 'act') {
      const start = lastPerceiveTs.get(name);
      if (start && ev.ts >= start) {
        s.totalLatencyMs += ev.ts - start;
        s.latencySamples++;
        lastPerceiveTs.delete(name);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelative(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < 1000) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export function AgentDashboard({ trace }: { trace?: AgentTraceEvent[] } = {}) {
  const storeTrace = useStore((s) => s.agentTrace);
  const effectiveTrace = trace ?? storeTrace;
  const ollamaEnabled = useStore((s) => s.aiConfig.ollamaMode !== 'disabled');
  const stats = useMemo(() => buildStats(effectiveTrace), [effectiveTrace]);
  const now = Date.now();

  const totalCalls = stats.reduce((a, b) => a + b.count, 0);
  const totalErrors = stats.reduce((a, b) => a + b.errors, 0);
  const totalFast = stats.reduce((a, b) => a + b.fastCount, 0);
  const totalCloud = stats.reduce((a, b) => a + b.cloudCount, 0);
  const totalAiCalls = totalFast + totalCloud;
  const maxCount = stats[0]?.count ?? 1;

  return (
    <div className="flex-1 overflow-y-auto min-h-0 p-2 text-[10px]">
      {/* 总览 */}
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <SummaryCard
          icon={Activity}
          label="行动"
          value={totalCalls.toString()}
          color="text-accent"
        />
        <SummaryCard
          icon={Activity}
          label="AI调用"
          value={totalAiCalls.toString()}
          color="text-ok"
        />
        {ollamaEnabled && (
          <SummaryCard
            icon={Zap}
            label="本地"
            value={totalFast.toString()}
            color="text-warn"
          />
        )}
        <SummaryCard
          icon={Cloud}
          label="云端"
          value={totalCloud.toString()}
          color="text-cyan"
        />
        <SummaryCard
          icon={AlertCircle}
          label="错误"
          value={totalErrors.toString()}
          color={totalErrors > 0 ? 'text-bad' : 'text-ok'}
        />
      </div>

      {stats.length === 0 ? (
        <div className="py-8 text-center text-ink-mute">
          还没有 Agent 调用 — 跑一次代码批注 / 编排今日计划，这里会出现统计。
        </div>
      ) : (
        <div className="space-y-1">
          {stats.map((s) => (
            <AgentRow
              key={s.name}
              s={s}
              maxCount={maxCount}
              now={now}
            />
          ))}
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-line/40 text-[9px] text-ink-mute leading-relaxed">
        <strong>说明</strong>：行动数从最近 200 条 trace 聚合；AI 调用只统计显式标记了本地/云端路由的 trace；延迟自动按 perceive→feedback
        配对推算（DailyPlan 编排链有最准确的延迟数据）；token 统计仅在 trace 显式带
        tokenIn/Out 时累加。
        {ollamaEnabled && (
          <>
            <strong>本地 Agent (绿色)</strong> 不消耗 token。
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded border border-line/60 bg-bg-elev/40 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] text-ink-mute">
        <Icon size={9} className={color} />
        {label}
      </div>
      <div className="text-[14px] font-mono font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function AgentRow({
  s,
  maxCount,
  now,
}: {
  s: AgentStats;
  maxCount: number;
  now: number;
}) {
  const widthPct = (s.count / maxCount) * 100;
  const avgLatency = s.latencySamples > 0 ? s.totalLatencyMs / s.latencySamples : null;
  const isError = s.errors > 0;
  const isLocal = s.fastCount > s.cloudCount;
  const routedCount = s.fastCount + s.cloudCount;
  return (
    <div
      className={cn(
        'rounded border px-2 py-1 relative overflow-hidden',
        isError ? 'border-bad/40 bg-bad/5' : 'border-line/60 bg-bg-elev/40',
      )}
    >
      <div
        className={cn(
          'absolute left-0 top-0 bottom-0 transition-all opacity-15',
          isLocal ? 'bg-warn' : 'bg-accent',
        )}
        style={{ width: `${widthPct}%` }}
      />
      <div className="relative flex items-center gap-2">
        <span className="font-mono text-[10px] truncate flex-1 min-w-0">{s.name}</span>
        <span className="text-[9px] text-ink-mute font-mono shrink-0">
          事件×{s.count}
        </span>
        {avgLatency !== null && (
          <span className="text-[9px] text-cyan font-mono shrink-0" title="平均延迟">
            {formatDuration(avgLatency)}
          </span>
        )}
        {(s.tokenIn > 0 || s.tokenOut > 0) && (
          <span
            className="text-[9px] text-ink-mute font-mono shrink-0"
            title="输入 / 输出 token"
          >
            {s.tokenIn}↓/{s.tokenOut}↑
          </span>
        )}
        {routedCount > 0 ? (
          <span className="text-[9px] font-mono shrink-0">
            {s.fastCount > 0 && <span className="text-warn">⚡{s.fastCount}</span>}
            {s.cloudCount > 0 && (
              <span className="text-cyan ml-0.5">☁{s.cloudCount}</span>
            )}
          </span>
        ) : (
          <span className="text-[9px] text-ink-mute font-mono shrink-0" title="这类行动日志没有绑定到一次具体 AI 请求">
            仅行动
          </span>
        )}
        <span className="text-[9px] text-ink-mute font-mono shrink-0 w-12 text-right">
          {formatRelative(s.lastTs, now)}
        </span>
      </div>
    </div>
  );
}
