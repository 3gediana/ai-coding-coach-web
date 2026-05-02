/**
 * Agent 协作图 — 可视化项目里所有 Agent 的拓扑 + 实时高亮 active 节点。
 *
 * 这是 Trace Panel 的"图视图"。和"列表视图"互补：
 *   - 列表 = 时间线（看动作顺序）
 *   - 图 = 拓扑（看 11 个 Agent 怎么协作）
 *
 * 设计要点：
 *   - 节点按职能分 5 个集群（被动响应 / 主动嗅探 / 学习反馈 / 编排 / 费曼）
 *   - 集群间用静态指示边（DailyPlan 三步链有显式数据流箭头）
 *   - 节点在最近 6 秒内有 trace → ring + pulse + 把它的 title 显示出来
 *   - Hover 节点 → tooltip 显示该 Agent 最近 1 条 trace
 *
 * 给评委 / 用户一个"AI 真在跑"的视觉证据。
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../lib/store';
import type { AgentName, AgentTraceEvent } from '../lib/store';
import { cn } from '../lib/cn';

interface NodeDef {
  name: AgentName;
  label: string;
  /** 简短副标题，描述该 Agent 干啥 */
  desc: string;
  /** 是否调用 LLM（false 表示本地纯逻辑 Agent） */
  isLLM: boolean;
}

interface ClusterDef {
  id: string;
  title: string;
  hint: string;
  /** Tailwind 颜色风格 */
  accent: string;
  nodes: NodeDef[];
}

const CLUSTERS: ClusterDef[] = [
  {
    id: 'reactive',
    title: '被动响应',
    hint: '用户直接触发',
    accent: 'border-cyan/40 bg-cyan/5',
    nodes: [
      { name: 'AnalyzeCode', label: '代码批注', desc: '看代码 → 出 issue', isLLM: true },
      { name: 'AskCoach', label: '问教练', desc: '自由问答', isLLM: true },
      { name: 'ParseProblem', label: '题面解析', desc: '原文 → 结构化', isLLM: true },
      { name: 'PlainExplanation', label: '题面通读', desc: '题意速读', isLLM: true },
      { name: 'AstDiff', label: 'AST 对比', desc: '语法树节点级 diff', isLLM: false },
    ],
  },
  {
    id: 'proactive',
    title: '主动嗅探',
    hint: '不等问，自己出现',
    accent: 'border-accent/40 bg-accent/5',
    nodes: [
      { name: 'StuckHint', label: '苏格拉底', desc: '60s 没动 → 提问', isLLM: true },
      { name: 'IntentSniffer', label: '意图嗅探', desc: '写偏 → 提示', isLLM: true },
      { name: 'HackCase', label: 'Hack', desc: '过样例 → 出 corner', isLLM: true },
      { name: 'RuntimeDiagnose', label: '运行错误', desc: '跑挂 → 归因', isLLM: true },
      { name: 'ConstraintSanity', label: '数据范围', desc: '过样例 → 扫范围', isLLM: true },
    ],
  },
  {
    id: 'feedback',
    title: '学习反馈',
    hint: '关注长期成长',
    accent: 'border-ok/40 bg-ok/5',
    nodes: [
      { name: 'ProblemOverview', label: '题目概览', desc: '导入 → 出概览', isLLM: true },
      { name: 'AcReview', label: 'AC 复盘', desc: '过题 → 总结', isLLM: true },
      { name: 'DailyReview', label: '每日复习', desc: '推老错题', isLLM: false },
      { name: 'SummarizeMistake', label: '错题总结', desc: '错 → 写错题本', isLLM: true },
    ],
  },
  {
    id: 'orchestrate',
    title: '编排链 (3 子 Agent)',
    hint: '每天 1 次自主编排',
    accent: 'border-warn/40 bg-warn/5',
    nodes: [
      { name: 'DailyPlan/Diagnosis', label: '[1/3] 学情诊断', desc: '错题/会话 → 薄弱点', isLLM: true },
      { name: 'DailyPlan/Selector', label: '[2/3] 题目筛选', desc: '本地纯逻辑评分', isLLM: false },
      { name: 'DailyPlan/Orchestrator', label: '[3/3] 计划编排', desc: '诊断+候选 → 路径', isLLM: true },
    ],
  },
  {
    id: 'feynman',
    title: '费曼反向教学',
    hint: '用户教 AI · 创新模块',
    accent: 'border-purple-500/40 bg-purple-500/5',
    nodes: [
      { name: 'Feynman/Student', label: 'AI 装菜鸟', desc: '听讲 + 提问', isLLM: true },
      { name: 'Feynman/Evaluator', label: 'AI 评委', desc: '清晰度评分', isLLM: true },
    ],
  },
];

/** 把 trace 按 agentName 聚合，找出每个 agent 最近的事件 */
function computeAgentState(trace: AgentTraceEvent[]) {
  const now = Date.now();
  const ACTIVE_WINDOW_MS = 6000;
  const result: Record<
    string,
    { count: number; lastEvent: AgentTraceEvent | null; isActive: boolean }
  > = {};
  for (const ev of trace) {
    const name = ev.agentName ?? 'Other';
    if (!result[name]) {
      result[name] = { count: 0, lastEvent: null, isActive: false };
    }
    result[name].count++;
    // trace 数组本身按 ts desc 排，先遇到的更新
    if (!result[name].lastEvent) {
      result[name].lastEvent = ev;
      result[name].isActive = now - ev.ts < ACTIVE_WINDOW_MS;
    }
  }
  return result;
}

export function AgentGraph() {
  const trace = useStore((s) => s.agentTrace);
  const ollamaEnabled = useStore((s) => s.aiConfig.ollamaMode !== 'disabled');
  const state = useMemo(() => computeAgentState(trace), [trace]);
  const clusters = ollamaEnabled ? CLUSTERS : CLUSTERS.filter((cluster) => cluster.id !== 'proactive');

  return (
    <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-2 text-[10px]">
      {clusters.map((cluster) => (
        <ClusterBlock key={cluster.id} cluster={cluster} state={state} />
      ))}
      <div className="px-1 pt-1 pb-2 text-[9px] text-ink-mute leading-relaxed">
        <span className="inline-block w-2 h-2 rounded-full bg-ok mr-1 align-middle" /> 6
        秒内有动作 ·
        <span className="inline-block w-2 h-2 rounded border border-line ml-2 mr-1 align-middle" /> 待命 ·
        <span className="inline-block w-2 h-2 rounded-full border border-warn/60 bg-warn/10 ml-2 mr-1 align-middle" /> 本地（无 LLM）
      </div>
    </div>
  );
}

function ClusterBlock({
  cluster,
  state,
}: {
  cluster: ClusterDef;
  state: Record<string, { count: number; lastEvent: AgentTraceEvent | null; isActive: boolean }>;
}) {
  const anyActive = cluster.nodes.some((n) => state[n.name]?.isActive);
  return (
    <div
      className={cn(
        'rounded border p-1.5 transition',
        cluster.accent,
        anyActive && 'shadow-[0_0_0_1px_rgb(var(--c-ok)_/_0.45)]',
      )}
    >
      <div className="flex items-baseline gap-2 px-1 mb-1">
        <span className="text-[10px] font-semibold text-ink">{cluster.title}</span>
        <span className="text-[9px] text-ink-mute">{cluster.hint}</span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {cluster.nodes.map((node) => (
          <AgentNode key={node.name} node={node} state={state[node.name]} />
        ))}
      </div>
    </div>
  );
}

function AgentNode({
  node,
  state,
}: {
  node: NodeDef;
  state?: { count: number; lastEvent: AgentTraceEvent | null; isActive: boolean };
}) {
  const count = state?.count ?? 0;
  const isActive = state?.isActive ?? false;
  const last = state?.lastEvent;
  return (
    <div
      title={last ? `${last.title}\n${last.detail ?? ''}` : `${node.desc}（待命）`}
      className={cn(
        'relative rounded px-1.5 py-1 border text-[10px] transition cursor-default group',
        isActive
          ? 'bg-ok/15 border-ok ring-1 ring-ok/50'
          : 'bg-bg-elev border-line/60 hover:border-line',
        !node.isLLM && !isActive && 'border-warn/40 bg-warn/5',
      )}
    >
      {isActive && (
        <motion.div
          className="absolute inset-0 rounded bg-ok/30 pointer-events-none"
          initial={{ opacity: 0.7 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
      )}
      <div className="flex items-center gap-1 relative">
        <div
          className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0',
            isActive ? 'bg-ok' : count > 0 ? 'bg-cyan/60' : 'bg-line',
          )}
        />
        <span className="font-semibold truncate">{node.label}</span>
        {!node.isLLM && (
          <span
            className="text-[8px] text-warn ml-auto shrink-0"
            title="本地纯逻辑 Agent，不调用 LLM"
          >
            local
          </span>
        )}
        {count > 0 && (
          <span className="text-[8px] text-ink-mute font-mono ml-auto shrink-0">
            ×{count}
          </span>
        )}
      </div>
      <div className="text-[9px] text-ink-mute truncate mt-0.5 relative">
        {node.desc}
      </div>
      {last && (
        <div className="text-[9px] text-ink-dim truncate mt-0.5 relative italic">
          {last.title}
        </div>
      )}
    </div>
  );
}
