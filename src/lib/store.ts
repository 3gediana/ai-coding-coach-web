/**
 * 全局状态 v2：多文件版本。
 *
 * 关键概念：
 * - "scope" = 题目作用域 ID。problemId 或 '__draft__'（未关联题目时的草稿区）
 * - 每个 scope 下挂 N 个 CodeFile
 * - activeFileIdByScope[scope] = 当前编辑器在编辑哪个 file
 *
 * 旧数据自动迁移：localStorage.aicc.code.v1 → IndexedDB files
 */
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';

import type {
  AIConfig,
  AIProvider,
  AlgoVizDetectionSchema,
  AnalysisHistoryEntry,
  AnalysisResult,
  CodeFile,
  DailyPlan,
  FileLang,
  Lang,
  LearnerProfile,
  Mistake,
  ModelEntry,
  OnboardingStep,
  Problem,
  Session,
  SubmissionVerdict,
} from '../core/types';
import { AIClient } from '../core/ai/client';
import { Coach } from '../core/analyzer';
import { storage } from './storage';
import { DEFAULT_AI_CONFIG } from './presets';
import { isLocalOllamaUrl } from './ollama';
import { AlgoVizService, type AlgoVizClients } from '../algoviz/service';
import { pickAlgoVizClient } from '../algoviz/clients';
import { buildLearnerProfile, codeHash } from '../core/utils';
import { buildCoachContext, formatAnalysisAsCoachMessage, formatInlineCoachPrelude } from '../core/coach/context';
import { routeCoachRequest } from '../core/coach/router';
import type { CoachAskInput, CoachDraft, CoachRoute } from '../core/coach/types';
import { submitToOj, type OjSubmitResult } from './ojBridge';
import {
  buildLearningEngine,
  pickPlanCandidates,
  type BankProblem,
  type LearningCard,
  type ProgressOverview,
} from '../core/recommend';
import { extractFeatures, type CodeStructFeatures } from '../core/astLite';
import { runPython, runCpp } from './runtime';
import { orchestrateHackChain, type SandboxRunResult } from '../core/hackChainOrchestrator';
import { orchestrateDailyPlan } from '../core/dailyPlanOrchestrator';
import type {
  AttackerCandidate,
  AttackerOutput,
  ExecutorOutput,
  ExecutorRunResult,
  ExplainerOutput,
  FixSuggestorOutput,
  HackChainContext,
  HackChainResult,
  HackChainStep,
} from '../core/hackChain';
export type {
  AttackerOutput,
  ExecutorOutput,
  ExplainerOutput,
  FixSuggestorOutput,
  HackChainResult,
  HackChainStep,
} from '../core/hackChain';
import {
  migrateConfigToRegistry,
  resolveFastLaneModel,
  resolveIntentRouterModel,
  resolvePrimaryModel,
  resolveQualityModel,
} from './modelRegistry';
import bankData from '../data/problemBank.json';
import { safeGetItem, safeJsonParse, safeRemoveItem, safeSetItem } from './safeLocalStorage';

const PROBLEM_BANK = bankData as BankProblem[];

/** 今天日期 YYYY-MM-DD（本地时区） */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** P3 escalation 滑窗：仅保留 7 天内的失败记录 */
const FAILURE_STATS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** P3 escalation 触发阈值（之前是 3 单题终身累计——几乎从不触发；现在 2 次 7 天内即可）*/
export const FAILURE_STATS_ESCALATE_THRESHOLD = 2;

interface FailureStats {
  count: number;
  recentVerdicts: SubmissionVerdict[];
  recentTimestamps: number[];
}

/**
 * 从 stats 里剔除超过 7 天的失败记录，返回新对象（不修改原对象）。
 * 注意：count 同步缩减，与 recentVerdicts/recentTimestamps 长度保持一致。
 */
function pruneFailureStats(stats: FailureStats, now = Date.now()): FailureStats {
  const cutoff = now - FAILURE_STATS_WINDOW_MS;
  const ts = stats.recentTimestamps ?? [];
  const verdicts = stats.recentVerdicts ?? [];
  // 旧数据可能没有 recentTimestamps（migration 兜底）：当作全过期，count=0 重新累积
  if (ts.length === 0 || ts.length !== verdicts.length) {
    return { count: 0, recentVerdicts: [], recentTimestamps: [] };
  }
  const keepFromIdx = ts.findIndex((t) => t >= cutoff);
  if (keepFromIdx === -1) {
    return { count: 0, recentVerdicts: [], recentTimestamps: [] };
  }
  if (keepFromIdx === 0) return stats;
  return {
    count: stats.count - keepFromIdx,
    recentVerdicts: verdicts.slice(keepFromIdx),
    recentTimestamps: ts.slice(keepFromIdx),
  };
}

/**
 * 从主 cfg 派生 fastLane 的 AIConfig：
 *   - fastLane 必须 enabled
 *   - baseUrl 必须是本地（localhost / 127.* / RFC1918）
 *   - 否则返回 null（Coach 会回落到主 client）
 */
function deriveFastConfig(cfg: AIConfig): AIConfig | null {
  // ollamaMode='disabled' 直接拒绝（用户明确说"我没装 Ollama"）：
  // - fastLane 不会被构建出来 → Coach.aiFast=undefined → 所有路由强制走主云端
  // - 3 个嗅探函数 (diagnoseRuntimeError / sanityCheckConstraints / sniffIntent) 自动 noop
  if (cfg.ollamaMode === 'disabled') return null;
  const resolved = resolveFastLaneModel(cfg);
  if (!resolved) return null;
  if (!isLocalOllamaUrl(resolved.baseUrl)) return null;
  return {
    provider: 'ollama',
    baseUrl: resolved.baseUrl.trim(),
    apiKey: '',
    model: resolved.model.trim(),
    // 兜底默认值。注意：analyzer.ts 的每个任务（analyzeCode / stuckHint / explainPaste）
    // 都会显式传 maxTokens 覆盖此值，所以这里只在调用方未传时生效。
    maxTokens: 2048,
    temperature: 0.3,
    timeoutMs: 60_000,
    maxRetries: 1,
    // 用户在 fastLane 区域配置的 num_ctx；不填走 client.ts 默认 20480
    numCtx: resolved.numCtx,
  };
}

export function hasUsableAIConfig(cfg: AIConfig): boolean {
  const resolved = resolvePrimaryModel(cfg);
  if (cfg.ollamaMode === 'disabled' && resolved.provider === 'ollama') return false;
  return resolved.provider === 'ollama' ? !!resolved.baseUrl.trim() : !!resolved.apiKey.trim();
}

function emptyAlgoVizModuleStatus(schema: AlgoVizDetectionSchema): Record<string, boolean> {
  return Object.fromEntries(schema.modules.map((m) => [m.id, false]));
}

/**
 * 给 AIClient 用的"已解析主模型"AIConfig：
 * 把 registry 中 primaryModelId 指向的连接信息覆盖到顶层字段上，
 * 其他可选字段（maxTokens / temperature / timeoutMs / numCtx 等）保持不变。
 */
function resolveAIClientConfig(cfg: AIConfig): AIConfig {
  const p = resolvePrimaryModel(cfg);
  return {
    ...cfg,
    provider: p.provider,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    model: p.model,
    numCtx: p.numCtx ?? cfg.numCtx,
  };
}

function createIntentRouterClient(cfg: AIConfig): AIClient | null {
  const resolved = resolveIntentRouterModel(cfg);
  if (!resolved) return null;
  // ollamaMode='disabled' 时，意图路由器只允许走云端；本地 ollama 触点全部 noop
  if (cfg.ollamaMode === 'disabled' && isLocalOllamaUrl(resolved.baseUrl)) return null;
  const provider: AIProvider = resolved.provider ?? (isLocalOllamaUrl(resolved.baseUrl) ? 'ollama' : cfg.provider);
  return new AIClient({
    provider,
    baseUrl: resolved.baseUrl.trim(),
    apiKey: resolved.apiKey?.trim() ?? '',
    model: resolved.model.trim(),
    maxTokens: 256,
    temperature: 0,
    timeoutMs: 8_000,
    maxRetries: 0,
    numCtx: 4096,
  });
}

/** 提交结果选项（错题或 AC 总结） */
/** 学生提问历史一条消息：用户问 / AI 答（流式时 streaming=true） */
export interface QAMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  route?: CoachRoute;
  /** assistant 消息流式中标记，结束后置 false。用户消息无此字段 */
  streaming?: boolean;
  /** 失败时的错误（仅 assistant 消息可能有） */
  error?: string;
}

export interface SubmitOpts {
  /** true 入错题本（非 AC），false 仅做通过总结 */
  isMistake: boolean;
  verdict?: SubmissionVerdict;
  /** 用户自述错误现象，可选 */
  userNote?: string;
}

const LS_AI_CFG = 'aicc.aiConfig.v1';
const LS_DEFAULT_LANG = 'aicc.defaultLang.v1';

const DEEPSEEK_FLASH_MODEL_ID = 'deepseek-v4-flash';
const DEEPSEEK_PRO_MODEL_ID = 'deepseek-v4-pro';
const LS_OLD_CODE = 'aicc.code.v1'; // 旧数据迁移用

const DRAFT_SCOPE = '__draft__';

// ============== Tasks ==============

export type TaskKind =
  | 'parse-problem'
  | 'analyze-code'
  | 'summarize-mistake'
  | 'oj-submit'
  | 'compare-files'
  | 'stuck-hint'
  | 'explain-paste'
  | 'hack-case';

// ============== Agent Trace ==============

/**
 * Agent 行动日志：让评委/学生一眼看到 Coach 在「自己做事」。
 * 关键瞬间（感知 / 决策 / 行动 / 反馈）按时间线追加，UI 实时渲染。
 * 仅保留最近 80 条，避免内存膨胀。
 */
export type AgentTraceKind = 'perceive' | 'decide' | 'act' | 'feedback';
export type AgentTraceLevel = 'info' | 'success' | 'warn' | 'error';

export interface AgentTraceEvent {
  id: string;
  ts: number;
  kind: AgentTraceKind;
  level: AgentTraceLevel;
  /** 一句话标题，UI 主显示 */
  title: string;
  /** 可选展开详情（命令体 / 提示词摘要 / 结果片段） */
  detail?: string;
  problemId?: string;
  taskId?: string;
  /** Agent 名字（用于 graph/dashboard 聚合）。不传时会从 title 推断 */
  agentName?: AgentName;
  /** 这条 trace 对应动作的耗时（ms），用于 dashboard */
  latencyMs?: number;
  /** 这条 trace 对应动作的 token 输入数，用于 dashboard 的成本统计 */
  tokenIn?: number;
  tokenOut?: number;
  /** 路由：本地 fastLane 还是云端 LLM；未知/无关时不填 */
  route?: 'fast' | 'cloud';
}

/**
 * 项目里所有"独立 Agent"的标准名字。**这是 Agent Graph / Dashboard 的节点 id**。
 *
 * 命名规则：
 *   - PascalCase
 *   - 主 Agent 顶部，子 Agent 用 "/" 表示父子（DailyPlan/Diagnosis 等）
 */
export type AgentName =
  | 'AnalyzeCode'
  | 'AskCoach'
  | 'ParseProblem'
  | 'PlainExplanation'
  | 'ProblemOverview'
  | 'AcReview'
  | 'DailyReview'
  | 'HackCase'
  | 'HackChain/Attacker'
  | 'HackChain/Executor'
  | 'HackChain/Explainer'
  | 'HackChain/FixSuggestor'
  | 'StuckHint'
  | 'IntentSniffer'
  | 'RuntimeDiagnose'
  | 'ConstraintSanity'
  | 'SummarizeMistake'
  | 'DailyPlan'
  | 'DailyPlan/Diagnosis'
  | 'DailyPlan/Selector'
  | 'DailyPlan/Orchestrator'
  | 'Feynman/Student'
  | 'Feynman/Evaluator'
  | 'AstDiff'
  | 'Router'
  | 'AlgoViz'
  | 'AlgoViz/Detect'
  | 'Other';

/**
 * 从 title 字符串推断 agentName 兜底（兼容老的 recordAgentTrace 调用点，避免一次性改 30 处）。
 *
 * 命中规则按优先级排序，第一个匹配为准。
 */
export function inferAgentName(title: string): AgentName {
  const t = title;
  if (t.includes('学情诊断 Agent')) return 'DailyPlan/Diagnosis';
  if (t.includes('题目筛选 Agent')) return 'DailyPlan/Selector';
  if (t.includes('计划编排 Agent')) return 'DailyPlan/Orchestrator';
  if (t.includes('学习规划 Agent')) return 'DailyPlan';
  if (t.includes('费曼') && t.includes('学生')) return 'Feynman/Student';
  if (t.includes('费曼') && t.includes('评委')) return 'Feynman/Evaluator';
  if (t.includes('AST')) return 'AstDiff';
  if (t.includes('AnalyzeCode') || t.includes('代码批注') || t.includes('escalat')) return 'AnalyzeCode';
  if (t.includes('AcReview') || t.includes('AC 复盘')) return 'AcReview';
  if (t.includes('ProblemOverview') || t.includes('题目概览')) return 'ProblemOverview';
  if (t.includes('PlainExplanation') || t.includes('题面通读')) return 'PlainExplanation';
  if (t.includes('AskCoach') || t.includes('问教练')) return 'AskCoach';
  if (t.includes('ParseProblem') || t.includes('题面解析')) return 'ParseProblem';
  if (t.includes('Hack Chain · Attacker') || t.includes('HackChain/Attacker')) return 'HackChain/Attacker';
  if (t.includes('Hack Chain · Executor') || t.includes('HackChain/Executor')) return 'HackChain/Executor';
  if (t.includes('Hack Chain · Explainer') || t.includes('HackChain/Explainer')) return 'HackChain/Explainer';
  if (t.includes('Hack Chain · FixSuggestor') || t.includes('HackChain/FixSuggestor')) return 'HackChain/FixSuggestor';
  if (t.includes('HackCase') || t.includes('Hack')) return 'HackCase';
  if (t.includes('StuckHint') || t.includes('卡住') || t.includes('苏格拉底')) return 'StuckHint';
  if (t.includes('IntentSniff') || t.includes('意图嗅探')) return 'IntentSniffer';
  if (t.includes('RuntimeDiagnose') || t.includes('运行错误')) return 'RuntimeDiagnose';
  if (t.includes('ConstraintSanity') || t.includes('数据范围')) return 'ConstraintSanity';
  if (t.includes('Summarize') || t.includes('错题总结')) return 'SummarizeMistake';
  if (t.includes('DailyReview') || t.includes('每日复习')) return 'DailyReview';
  if (t.includes('路由') || t.includes('Router')) return 'Router';
  return 'Other';
}

const AGENT_TRACE_LIMIT = 200;

// ============== Hack Chain 状态机（UI 用） ==============

/** UI 渲染 timeline 时用的步骤状态 */
export interface HackChainStepState {
  step: HackChainStep;
  status: 'idle' | 'running' | 'success' | 'failed' | 'skipped';
  /** 步骤起止时间，UI 显示耗时 */
  startedAt?: number;
  endedAt?: number;
  /** 失败时的简短错因 */
  error?: string;
}

// ============== Coach Hint（FastLane 主动嗅探的产物） ==============

/**
 * Coach 主动嗅探得到的一条**静默**提示。
 * UI 只通过编辑器右上角小角标 + Agent 行动面板暴露，**不弹 toast 不抢焦点**。
 *
 *  - runtime-error：跑代码失败时本地秒级出归因（A）
 *  - constraint-risk：题目首次跑通样例后扫一眼数据范围（C）
 *  - intent-drift：90s 停顿 + 代码净增 ≥30 字时判方向是否对（B，默认关）
 */
export type CoachHintKind = 'runtime-error' | 'intent-drift' | 'constraint-risk';

export interface CoachHint {
  id: string;
  kind: CoachHintKind;
  scope: string;
  problemId?: string;
  fileId?: string;
  /** 涉及的代码行（runtime-error 才有；UI 角标点开后跳转到该行） */
  line?: number;
  /** 一句话提示（≤120 字） */
  message: string;
  level: 'info' | 'warn' | 'error';
  ts: number;
}

const COACH_HINT_LIMIT_PER_SCOPE = 6;

/**
 * Coach 嗅探的去重 / 节流状态（模块级，不进 React 状态避免无谓重渲染）：
 *   - lastDiagByStderrHash：同一份 stderr 60s 内不重复归因
 *   - sanityCheckedProblems：每个 problemId 只 sanity check 一次（终生去重）
 *   - lastSniffByCodeHash：同一份代码不重复 sniff
 *   - lastIntentSniffAt：5 分钟全局节流，避免本地模型被反复唤醒
 */
const lastDiagByStderrHash = new Map<string, number>();
const sanityCheckedProblems = new Set<string>();
const lastSniffByCodeHash = new Map<string, number>();
const lastIntentSniffAt = { ts: 0 };

const DIAG_DEDUP_MS = 60_000;
const INTENT_SNIFF_GLOBAL_MS = 5 * 60_000;

/** 跑代码输入/输出比较的归一化（与 RuntimePane.normalizeSampleText 同语义） */
function normalizeRunIO(s: string | undefined): string {
  if (!s) return '';
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, '').replace(/^\s+/, ''))
    .join('\n')
    .trim();
}

/** 把一条 hint 推入 coachHintsByScope[scope]，按 scope 限 6 条 */
function appendCoachHint(
  set: (fn: (s: any) => any) => void,
  scope: string,
  hint: CoachHint,
): void {
  set((s: any) => {
    const cur: CoachHint[] = s.coachHintsByScope[scope] ?? [];
    const next = [hint, ...cur].slice(0, COACH_HINT_LIMIT_PER_SCOPE);
    return {
      coachHintsByScope: { ...s.coachHintsByScope, [scope]: next },
    };
  });
}

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  kind: TaskKind;
  label: string;
  status: TaskStatus;
  progress: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  error?: string;
  retryAttempt?: number;
  retryReason?: string;
  meta?: Record<string, unknown>;
}

interface TaskHandler {
  run: (
    onChunk: (delta: string, accumulated: string) => void,
    onRetry: (attempt: number, delayMs: number, reason: string) => void,
    signal: AbortSignal,
  ) => Promise<unknown>;
  onSuccess?: (result: unknown) => void | Promise<void>;
  onFailure?: (err: Error) => void;
}

/** 一次代码运行的快照（用于 analyzeCode 喂给 AI 看 stderr/exitCode） */
export interface RunSnapshot {
  fileId: string;
  fileName: string;
  language: string;
  fileContent?: string;
  exitCode: number;
  stdin: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  timestamp: number;
}

export function getHackChainBlockReason(
  problem: Problem | null | undefined,
  file: CodeFile | null | undefined,
  snap: RunSnapshot | undefined,
): string | null {
  if (!problem) return '请先激活一道题目';
  if (!file || (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python')) {
    return '当前活跃文件不是可执行代码';
  }
  if (!file.content.trim()) return '请先写代码，并运行题目样例到 AC';
  if (!snap || snap.fileId !== file.id) return '请先运行当前代码，并通过题目样例';
  if (snap.fileContent === undefined || snap.fileContent !== file.content) {
    return '代码已修改，请重新运行当前代码并通过样例';
  }
  if (Date.now() - snap.timestamp > 30 * 60 * 1000) {
    return '样例 AC 记录已过期，请重新运行当前代码';
  }
  if (snap.exitCode !== 0) return '最近一次运行还没 AC，请先修到样例通过';
  const passedSample = (problem.examples ?? []).some(
    (ex) =>
      ex.input.trim() &&
      normalizeRunIO(snap.stdin) === normalizeRunIO(ex.input) &&
      normalizeRunIO(snap.stdout) === normalizeRunIO(ex.output),
  );
  return passedSample ? null : '请先用题目样例运行到 AC，再启动 Hack Chain';
}

const handlersById = new Map<string, TaskHandler>();
const abortersById = new Map<string, AbortController>();
const MAX_CONCURRENT = 3;

/**
 * 当前正在跑的 askCoach 流式 AbortController（ref 形式避开 TS narrow 误报为 never）。
 * - askCoach 启动时 new 一个赋给 .current，把 signal 传给 coach.askCoach
 * - 用户点 UI 上的"停止"按钮 → abortCoach action → .current?.abort()
 * - askCoach 的 finally 里清回 null，避免悬挂引用
 * 同一时刻只允许一个 askCoach 在跑（qaPendingProblemId 已经做了门禁），所以单 ref 足够。
 */
const coachAbortRef: { current: AbortController | null } = { current: null };

/** algoViz 实时检测的 debounce timer：每个 problemId 一个 */
const algoVizDetectTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** 用户停止打字后多久跑一次模块检测（trailing-edge debounce）。15s = 跟用户约定的频率 */
const ALGOVIZ_DETECT_DEBOUNCE_MS = 15_000;
const IMPORT_PLACEHOLDER_ANALYZING =
  '题目已收到，AI 正在整理题面结构、样例和约束。你可以先在编辑器中准备代码，整理完成后这里会自动刷新。';
const IMPORT_PLACEHOLDER_WAITING = '题目已收到，正在等待题面文本或图片识别结果。';

function isImportedProblemPlaceholder(problem: Problem | null | undefined): boolean {
  return problem?.statement === IMPORT_PLACEHOLDER_ANALYZING || problem?.statement === IMPORT_PLACEHOLDER_WAITING;
}

function scheduleImportedProblemParsing(
  get: () => State,
  set: (fn: (s: State) => Partial<State> | State) => void,
  id: string,
  payload: import('./importReceiver').ImportPayload,
  statement: string,
  fallbackTitle: string,
  opts: { autoAnalyzeCode?: boolean } = {},
): void {
  if (!statement) return;
  if (!hasUsableAIConfig(get().aiConfig)) return;
  void (async () => {
    const startedAt = Date.now();
    const route = resolvePrimaryModel(get().aiConfig).provider === 'ollama' ? 'fast' : 'cloud';
    get().recordAgentTrace({
      kind: 'act',
      level: 'info',
      title: `题面解析：后台结构化 ${fallbackTitle}`,
      problemId: id,
      agentName: 'ParseProblem',
      route,
    });
    try {
      const parsed = await get().coach.parseProblem(statement);
      const latest = get().problems.find((p) => p.id === id);
      if (!latest) return;
      const updated: Problem = {
        ...latest,
        ...parsed,
        id,
        title: payload.title || parsed.title || latest.title,
        statement: parsed.statement || latest.statement,
        plainExplanation: parsed.plainExplanation?.trim() || latest.plainExplanation,
        source: payload.url || latest.source,
        createdAt: latest.createdAt,
      };
      await storage.saveProblem(updated);
      set((s) => ({
        problems: s.problems.map((p) => (p.id === id ? updated : p)),
      }));
      get().recordAgentTrace({
        kind: 'feedback',
        level: 'success',
        title: `题面解析完成：${updated.title}`,
        detail: `结构化字段已回填，不影响你继续做题`,
        problemId: updated.id,
        agentName: 'ParseProblem',
        latencyMs: Date.now() - startedAt,
        route,
      });
      if (get().activeProblemId === id) {
        if (!updated.plainExplanation?.trim()) {
          void get().requestPlainExplanation(id);
        }
        if (!updated.coachOverview?.headline) {
          void get().requestProblemOverview(id);
        }
        if (!updated.algoViz) {
          void get().requestAlgoVizGeneration(id);
        }
        if (opts.autoAnalyzeCode) {
          window.setTimeout(() => {
            const latest = get();
            if (latest.activeProblemId === id) {
              latest.enqueueAnalyze({ reason: 'oj-import' });
            }
          }, 250);
        }
      }
    } catch (err: any) {
      console.warn('[handleImportPayload] parseProblem 失败，保留占位题面', err?.message || err);
      get().recordAgentTrace({
        kind: 'feedback',
        level: 'warn',
        title: `题面解析失败：保留占位题面`,
        detail: String(err?.message || err).slice(0, 240),
        problemId: id,
        agentName: 'ParseProblem',
        latencyMs: Date.now() - startedAt,
        route,
      });
    }
  })();
}

// ============== Store ==============

interface State {
  aiConfig: AIConfig;
  ai: AIClient;
  coach: Coach;
  /** 算法可视化服务（每次 setAIConfig 时重建——algoVizModels 改变要换 client） */
  algoVizService: AlgoVizService;
  /** 实时检测的"模块亮灯"状态（按 problemId 隔离，不持久化） */
  moduleStatusByProblem: Record<string, Record<string, boolean>>;
  /** 标记某题是否正有 detect 调用 in-flight，避免 15s 节流外又叠新调用 */
  algoVizDetectingByProblem: Record<string, boolean>;
  /** 入库流水线：完整两阶段（录题 / 题目激活时按需自动调用） */
  requestAlgoVizGeneration: (problemId: string, opts?: { force?: boolean }) => Promise<void>;
  /** 老题模式：仅生成 Animation；缺 schema 时自动 fallback 到完整 pipeline */
  requestAlgoVizAnimationOnly: (problemId: string) => Promise<void>;
  /** 实时检测：caller 应自己 debounce ~15s（store 内部只做 in-flight 防抖） */
  detectAlgoVizModules: (problemId: string, code: string) => Promise<void>;
  /** 直接覆盖某题 module status（test / 手动调试用） */
  setAlgoVizModuleStatus: (problemId: string, status: Record<string, boolean>) => void;

  // 数据
  problems: Problem[];
  mistakes: Mistake[];
  sessions: Session[];
  activeProblemId: string | null;

  // 文件 — 多文件核心
  /** 默认新建文件的语言（C++/Python/C） */
  defaultLang: Lang;
  /** scope ('__draft__' 或 problemId) → 该 scope 下所有 file */
  filesByScope: Record<string, CodeFile[]>;
  /** 每个 scope 当前活跃的 file id */
  activeFileIdByScope: Record<string, string | null>;

  // 分析结果（按 problemId 缓存最新一次）
  analysisByProblem: Record<string, AnalysisResult>;
  streamPreviewById: Record<string, string>;

  // 学生提问历史（按 problemId 隔离），实时流式更新
  qaByProblem: Record<string, QAMessage[]>;
  /** 当前正在流式回答的 problemId（同一时间只有一个 ask in flight） */
  qaPendingProblemId: string | null;

  tasks: Task[];

  // UI
  sidebarTab: 'problems' | 'mistakes' | 'sessions' | 'dashboard' | null;
  /** 单文件 / 多文件模式：默认 false（单文件，FileTree 不渲染）。多文件场景才打开。 */
  multiFileMode: boolean;
  setMultiFileMode: (v: boolean) => void;
  settingsOpen: boolean;
  problemEditorOpen: boolean;
  problemBrowserOpen: boolean;
  cmdPaletteOpen: boolean;
  submitModalOpen: boolean;
  /** 底部运行时面板是否展开 */
  runtimePaneOpen: boolean;
  /** 费曼反向教学 modal 开关 */
  feynmanOpen: boolean;
  openFeynman: () => void;
  closeFeynman: () => void;

  // 卡住检测 / 粘贴提示 / 默认开关
  lastEditAt: number;
  lastHintAt: number;
  currentHint: string | null;
  stuckHintEnabled: boolean;
  /** QA 输入框预填字符串（CodeEditor 框选 "问 AI" 时把代码 prefill 到 QAPanel） */
  askPrefill: string | null;
  coachDraft: CoachDraft | null;
  /** FeedbackPanel 当前 tab（'analyze' / 'ask'），升到 store 让外部能切 */
  feedbackTab: 'analyze' | 'ask' | 'algoviz';
  /** Onboarding 当前步骤 */
  onboardingStep: OnboardingStep;
  /** Learning engine（学习引擎）输出：进度 + 行动卡 */
  learningOverview: ProgressOverview | null;
  learningCards: LearningCard[];
  /** 学习卡片今天是否被关闭过 */
  learningCardDismissedDate: string | null;
  /** 对拍：选中的两个 fileId */
  diffSelection: string[];
  /** 最近一次运行结果（按 scope）— 让 analyzeCode 能拿到 stderr/exitCode 给出对症建议 */
  lastRunByScope: Record<string, RunSnapshot>;

  /** Coach 主动嗅探得到的静默提示（按 scope）；UI 只通过角标 + 行动面板暴露 */
  coachHintsByScope: Record<string, CoachHint[]>;
  /** A. 跑失败 → 本地秒级归因（默认 ON） */
  diagnoseOnFailEnabled: boolean;
  /** C. 首次跑通样例 → 数据范围 sanity（默认 ON，每题一次） */
  constraintSanityEnabled: boolean;
  /** B. 90s 停顿 + 代码净增 ≥30 字 → 题意偏离嗅探（默认 OFF，谨慎） */
  intentSniffEnabled: boolean;

  // ===== actions =====
  setAIConfig: (cfg: AIConfig) => void;
  /** 模型注册表 CRUD（返回更新后的 cfg，方便 SettingsModal 即时联动） */
  registerModel: (entry: Omit<ModelEntry, 'id'> & { id?: string }) => string;
  updateModel: (id: string, patch: Partial<Omit<ModelEntry, 'id'>>) => void;
  removeModel: (id: string) => void;
  setDefaultLang: (l: Lang) => void;
  setActiveProblem: (id: string | null) => Promise<void>;

  // 文件 CRUD
  createFile: (opts: {
    scope?: string;
    name?: string;
    language?: FileLang;
    content?: string;
    activate?: boolean;
  }) => Promise<CodeFile>;
  renameFile: (fileId: string, newName: string) => Promise<void>;
  duplicateFile: (fileId: string, newName?: string) => Promise<CodeFile>;
  deleteFile: (fileId: string) => Promise<void>;
  pinFile: (fileId: string, pinned: boolean) => Promise<void>;
  setActiveFile: (scope: string, fileId: string | null) => void;
  updateFileContent: (fileId: string, content: string) => void;
  changeFileLanguage: (fileId: string, language: FileLang) => Promise<void>;

  // 对拍选择
  toggleDiffSelection: (fileId: string) => void;
  clearDiffSelection: () => void;
  /** RuntimePane 运行结束后写入；analyzeCode 之前会读取作为上下文 */
  setLastRun: (scope: string, snap: RunSnapshot) => void;
  clearLastRun: (scope: string) => void;

  refreshProblems: () => Promise<void>;
  refreshMistakes: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  refreshAll: () => Promise<void>;

  enqueueParseProblem: (rawText: string) => string;
  enqueueAnalyze: (opts?: { reason?: string }) => string | null;
  /** 后台静默补齐题目的「白话解释」字段（已有则跳过；失败静默） */
  requestPlainExplanation: (problemId: string) => Promise<void>;
  /** P1 题眼速读：激活新题时云端读一遍生成 coachOverview 缓存到 problem 上 */
  requestProblemOverview: (problemId: string, opts?: { force?: boolean }) => Promise<void>;
  /** 用户点 ✕ 关掉题眼速读卡（仅本会话内隐藏，不删 coachOverview 缓存） */
  dismissProblemOverview: (problemId: string) => void;
  /** 当前会话被关掉的题眼卡 problemId 集合（用 Set 维护） */
  overviewDismissedProblemIds: string[];
  /**
   * P2 AC 后复盘：用户提交 AC 后云端生成"你的解法 vs 经典最优 + 变种题"。
   * 写入 problem.acReview 持久化；同时设 pendingAcReview 让 AcReviewCard 浮现。
   */
  requestAcReview: (problemId: string, fileId: string) => Promise<void>;
  /** 待用户处理的 AC 复盘（生成成功后写入，UI 浮卡读取，关闭后清掉） */
  pendingAcReview:
    | {
        problemId: string;
        passingPattern: string;
        betterApproach?: { name: string; complexity: string; gist: string };
        followUps: string[];
      }
    | null;
  dismissAcReview: () => void;
  /**
   * P3 屡败 escalation：每个题目的非-AC 失败记录（7 天滑窗）。
   *
   * 设计变更（2025-04 之前是单题终身累计，几乎不触发）：
   * - 仅保留 7 天内的失败 → 触发条件用"近期失败"，避免学生 1 个月前的失败拖累
   * - 阈值从 ≥3 调到 ≥2 → 同题第 2 次还在错就升级（更早干预）
   * - recentTimestamps 与 recentVerdicts 同步、同长度
   * AC 时清零本题记录。analyzeCode 路径同时使用 count（滑窗后） + recentVerdicts。
   */
  failureStatsByProblem: Record<
    string,
    {
      count: number;
      recentVerdicts: SubmissionVerdict[];
      recentTimestamps: number[];
    }
  >;
  /** P4 每日复习推送：今天是否已被用户关掉（YYYY-MM-DD 字符串） */
  dailyReviewDismissedDate: string | null;
  /** 用户点 ✕ 关掉今日复习推送（持久化到 localStorage，跨天会重置） */
  dismissDailyReview: () => void;
  /**
   * B 路线 — 学习规划 Agent：当前生效的今日学习计划。
   *
   * 由 3 个子 Agent 协作生成：学情诊断 → 题目筛选 → 计划编排。
   * 每天首次开 app 自动触发；成功后 sidebar 顶部浮起 DailyPlanCard。
   * persisted 在 localStorage（按 date 缓存，跨天会重新生成）。
   */
  dailyPlan: DailyPlan | null;
  dailyPlanGenerating: boolean;
  /**
   * 触发学习规划 Agent 编排（3 步链式调用）。
   *   - 默认：缓存 hit（同日内）则直接返回，不重复烧 token
   *   - opts.force：用户在 UI 上点「重新规划」时跳过缓存
   */
  requestDailyPlan: (opts?: { force?: boolean }) => Promise<void>;
  /** 用户点「接受并开始」 */
  acceptDailyPlan: () => void;
  /** 用户点 ✕ 拒绝（今天不再弹） */
  declineDailyPlan: () => void;
  /** 用户在 sidebar 勾选某一步完成 */
  toggleDailyPlanStep: (stepIndex: number) => void;
  enqueueSummarize: (arg: boolean | SubmitOpts) => string | null;
  enqueueDiff: () => string | null;
  /** 主动出 hack case：检测样例已通过后由 Coach 自己挑战边界 */
  enqueueHackCase: (opts?: { reason?: string }) => string | null;
  /** 待用户处理的 hack case（生成成功后写入，UI 浮卡读取） */
  pendingHackCase:
    | {
        problemId: string;
        fileId: string;
        stdin: string;
        expectedOutput?: string;
        rationale: string;
        severity: 'edge' | 'large' | 'degenerate' | 'tricky';
        createdAt: number;
      }
    | null;
  dismissHackCase: () => void;

  /**
   * Hack Chain：4-agent 严格链式编排（Attacker → Executor → Explainer → FixSuggestor）。
   * 与单步 enqueueHackCase 共存：用户可以选老的"快出 1 个 case"或新的"完整链路"。
   */
  runHackChain: (opts?: { reason?: string }) => Promise<void>;
  /** runHackChain 在跑吗（防重） */
  /** Chain 当前运行状态；UI 用来渲染时间线 */
  hackChainState:
    | {
        problemId: string;
        fileId: string;
        startedAt: number;
        /** 各步状态机；每完成一步追加 */
        steps: HackChainStepState[];
        /** 全链结束后挂的最终 result（含整段 trace） */
        result: HackChainResult | null;
      }
    | null;
  dismissHackChain: () => void;

  // Agent 行动日志
  agentTrace: AgentTraceEvent[];
  recordAgentTrace: (
    e: Omit<AgentTraceEvent, 'id' | 'ts'> & { id?: string; ts?: number },
  ) => void;
  clearAgentTrace: () => void;

  // ===== Coach 主动嗅探（FastLane 专属，全部静默） =====
  /** A. 跑代码失败时本地秒级归因（由 setLastRun 内部触发，外部一般不直接调） */
  requestRuntimeDiagnosis: (scope: string) => Promise<void>;
  /** C. 题目首次跑通样例时数据范围审计（由 setLastRun 内部触发） */
  requestConstraintSanity: (problemId: string) => Promise<void>;
  /** B. 90s 停顿 + 代码净增触发；由 IntentSnifferCard 轮询调，全局 5min 节流 */
  requestIntentSniff: (scope: string) => Promise<void>;
  /** 用户在角标里点 X 关掉一条 hint */
  dismissCoachHint: (id: string) => void;
  /** 切题 / 切文件时清空角标 */
  clearCoachHints: (scope: string) => void;
  setDiagnoseOnFailEnabled: (v: boolean) => void;
  setConstraintSanityEnabled: (v: boolean) => void;
  setIntentSniffEnabled: (v: boolean) => void;

  cancelTask: (id: string) => void;
  retryTask: (id: string) => void;
  clearFinishedTasks: () => void;

  deleteProblem: (id: string) => Promise<void>;
  /**
   * 归档 / 取消归档一道题。归档后：
   *   - Sidebar「题目」Tab 默认列表不显示（避免越拖越长）
   *   - 进入「历史记录」Tab 仍可见 + 点击重新激活：代码 / algoViz / 错题史完整保留
   *   - 不删数据；再次调用即可取消归档
   */
  toggleArchiveProblem: (id: string) => Promise<void>;
  deleteMistake: (id: string) => Promise<void>;
  /** 标记错题已复习（更新 reviewedAt + reviewCount++） */
  markMistakeReviewed: (id: string) => Promise<void>;

  setSidebarTab: (t: State['sidebarTab']) => void;
  setSettingsOpen: (v: boolean) => void;
  setProblemEditorOpen: (v: boolean) => void;
  setProblemBrowserOpen: (v: boolean) => void;

  /** 学生在做题时问问题：流式回答到 qaByProblem[scope] */
  askQuestion: (question: string) => Promise<void>;
  askCoach: (input: CoachAskInput) => Promise<void>;
  /** 取消当前流式中的 askCoach（如果在跑）；不在跑就 noop */
  abortCoach: () => void;
  /** 重答：复用上一条 user message 重新跑一遍（删掉旧 assistant 后追加新的） */
  retryLastCoach: (scope: string) => Promise<void>;
  /** 清空当前 scope 的提问历史 */
  clearQA: (scope: string) => void;
  setCmdPaletteOpen: (v: boolean) => void;
  setSubmitModalOpen: (v: boolean) => void;
  setRuntimePaneOpen: (v: boolean) => void;

  // 卡住检测 / 粘贴
  markEdit: () => void;
  setStuckHintEnabled: (v: boolean) => void;
  dismissHint: () => void;
  enqueueStuckHint: () => string | null;
  setAskPrefill: (v: string | null) => void;
  setCoachDraft: (v: CoachDraft | null) => void;
  setFeedbackTab: (t: 'analyze' | 'ask' | 'algoviz') => void;

  // Onboarding actions
  /** 启动 onboarding：注入 demo 题 + bug 代码 → 切到 wait-analyze */
  startOnboarding: () => Promise<void>;
  /** 推进到下一步（参数指定到哪步） */
  advanceOnboarding: (to: OnboardingStep) => void;
  /** 用户跳过 / 完成 → idle 并标记 done 到 localStorage */
  finishOnboarding: () => void;

  // Learning engine actions
  /** 重新计算学习概览 + 行动卡（错题 / 已做题变化时调用） */
  refreshLearningEngine: () => void;
  /** 用户关闭今天的学习卡片（跨天会重新出现） */
  dismissLearningCard: () => void;
  /** 把内置题库的题加到 problems（学生点 "新题" 行动卡时调用） */
  addBankProblem: (bankId: string) => Promise<string | null>;

  // 外部导入（Tampermonkey 推送）
  /** 接收 TM 推送的 payload，去重 / 接收 qwen3.5 识图结果 / parseProblem / 入库 / 激活 */
  handleImportPayload: (payload: import('./importReceiver').ImportPayload) => Promise<void>;
  /** 推送当前代码到原 OJ，由 Tampermonkey 清空编辑器并粘贴；可选自动提交并回传 verdict */
  enqueueOjSubmit: (opts?: { autoSubmit?: boolean }) => string | null;
}

// ============== 初始化 ==============

/**
 * 从 .env.local 读取项目级默认 AI 配置（vite envPrefix 已开放 AI_COACH_* / DEEPSEEK_*）。
 * 用于：localStorage 还没保存过用户改动时，避免每次部署/换浏览器都得重新填密钥。
 * 用户在 SettingsModal 修改后，仍以 localStorage 为准。
 */
function readEnvAIConfig(): Partial<AIConfig> {
  const env = (import.meta as any).env ?? {};
  const out: Partial<AIConfig> = {};
  const deepseekKey = ((env.DEEPSEEK_KEY || env.DEEPSEEK_API_KEY) as string | undefined)?.trim();
  const deepseekBaseUrl =
    ((env.DEEPSEEK_BASE_URL || DEFAULT_AI_CONFIG.baseUrl) as string | undefined)?.trim() ||
    DEFAULT_AI_CONFIG.baseUrl;
  const deepseekFlashModel =
    ((env.DEEPSEEK_FLASH_MODEL || DEEPSEEK_FLASH_MODEL_ID) as string | undefined)?.trim() ||
    DEEPSEEK_FLASH_MODEL_ID;
  const deepseekProModel =
    ((env.DEEPSEEK_PRO_MODEL || DEEPSEEK_PRO_MODEL_ID) as string | undefined)?.trim() ||
    DEEPSEEK_PRO_MODEL_ID;
  if (deepseekKey) {
    const deepseekRegistry: ModelEntry[] = [
      {
        id: DEEPSEEK_FLASH_MODEL_ID,
        label: 'DeepSeek V4 Flash（轻量主力）',
        provider: 'deepseek',
        baseUrl: deepseekBaseUrl,
        apiKey: deepseekKey,
        model: deepseekFlashModel,
      },
      {
        id: DEEPSEEK_PRO_MODEL_ID,
        label: 'DeepSeek V4 Pro（重活/动画）',
        provider: 'deepseek',
        baseUrl: deepseekBaseUrl,
        apiKey: deepseekKey,
        model: deepseekProModel,
      },
    ];
    out.provider = 'deepseek';
    out.baseUrl = deepseekBaseUrl;
    out.apiKey = deepseekKey;
    out.model = deepseekFlashModel;
    out.primaryModelId = DEEPSEEK_FLASH_MODEL_ID;
    out.qualityModelId = DEEPSEEK_PRO_MODEL_ID;
    out.modelRegistry = deepseekRegistry;
    out.algoVizModels = {
      status: {
        enabled: true,
        modelId: DEEPSEEK_PRO_MODEL_ID,
        provider: 'deepseek',
        baseUrl: deepseekBaseUrl,
        apiKey: deepseekKey,
        model: deepseekProModel,
      },
      animation: {
        enabled: true,
        modelId: DEEPSEEK_PRO_MODEL_ID,
        provider: 'deepseek',
        baseUrl: deepseekBaseUrl,
        apiKey: deepseekKey,
        model: deepseekProModel,
      },
    };
    return out;
  }
  const provider = env.AI_COACH_PROVIDER as AIProvider | undefined;
  const baseUrl = env.AI_COACH_BASE_URL as string | undefined;
  const apiKey = env.AI_COACH_KEY as string | undefined;
  const model = env.AI_COACH_MODEL as string | undefined;
  if (provider) out.provider = provider;
  if (baseUrl) out.baseUrl = baseUrl;
  if (apiKey) out.apiKey = apiKey;
  if (model) out.model = model;
  return out;
}

function withDefaultCloudModels(cfg: AIConfig): AIConfig {
  const defaults = DEFAULT_AI_CONFIG.modelRegistry ?? [];
  const byId = new Map((cfg.modelRegistry ?? []).map((m) => [m.id, m]));
  const inheritedKey =
    cfg.provider === 'deepseek' && cfg.baseUrl === DEFAULT_AI_CONFIG.baseUrl ? cfg.apiKey : '';
  for (const m of defaults) {
    const existing = byId.get(m.id);
    byId.set(m.id, { ...m, ...(existing ?? {}), apiKey: existing?.apiKey || inheritedKey || m.apiKey });
  }
  if (cfg.provider !== 'deepseek' || cfg.baseUrl !== DEFAULT_AI_CONFIG.baseUrl) {
    return { ...cfg, modelRegistry: [...byId.values()] };
  }
  return {
    ...cfg,
    model: cfg.model || DEEPSEEK_FLASH_MODEL_ID,
    primaryModelId: cfg.primaryModelId ?? DEEPSEEK_FLASH_MODEL_ID,
    qualityModelId: cfg.qualityModelId ?? DEEPSEEK_PRO_MODEL_ID,
    modelRegistry: [...byId.values()],
    algoVizModels: {
      ...cfg.algoVizModels,
      status: cfg.algoVizModels?.status ?? DEFAULT_AI_CONFIG.algoVizModels?.status,
      animation: cfg.algoVizModels?.animation ?? DEFAULT_AI_CONFIG.algoVizModels?.animation,
    },
  };
}

function mergeModelRegistries(...registries: Array<ModelEntry[] | undefined>): ModelEntry[] {
  const byId = new Map<string, ModelEntry>();
  for (const registry of registries) {
    for (const entry of registry ?? []) {
      byId.set(entry.id, { ...(byId.get(entry.id) ?? {}), ...entry });
    }
  }
  return [...byId.values()];
}

function hasDeepSeekEnv(cfg: Partial<AIConfig>): boolean {
  return !!cfg.modelRegistry?.some((m) => m.id === DEEPSEEK_FLASH_MODEL_ID && !!m.apiKey.trim());
}

const initialAIConfig: AIConfig = (() => {
  const envCfg = readEnvAIConfig();
  try {
    const raw = safeGetItem(LS_AI_CFG);
    if (raw) {
      const parsed = JSON.parse(raw);
      const forceDeepSeek = hasDeepSeekEnv(envCfg);
      // 浅合并：默认 → .env → localStorage；如果显式配置 DEEPSEEK_KEY，则以 DeepSeek 双模型为当前运行路由
      // fastLane / intentRouter 做嵌套兜底
      const mergedBase: AIConfig = forceDeepSeek
        ? { ...DEFAULT_AI_CONFIG, ...parsed, ...envCfg }
        : { ...DEFAULT_AI_CONFIG, ...envCfg, ...parsed };
      const merged: AIConfig = {
        ...mergedBase,
        modelRegistry: forceDeepSeek
          ? mergeModelRegistries(parsed.modelRegistry, envCfg.modelRegistry)
          : mergeModelRegistries(envCfg.modelRegistry, parsed.modelRegistry),
        fastLane: { ...DEFAULT_AI_CONFIG.fastLane!, ...(parsed.fastLane ?? {}) },
        intentRouter: {
          ...DEFAULT_AI_CONFIG.intentRouter!,
          ...(parsed.intentRouter ?? {}),
        },
      };
      // 旧存档没有 modelRegistry → 自动把现有连接信息注册成 ModelEntry
      return withDefaultCloudModels(migrateConfigToRegistry(merged));
    }
  } catch {
    /* ignore */
  }
  // 没有 localStorage 存档：用默认 + .env，并立刻写回（让设置面板里 hint「保存在浏览器」是真的）
  const merged: AIConfig = withDefaultCloudModels({ ...DEFAULT_AI_CONFIG, ...envCfg });
  try {
    if (envCfg.apiKey) {
      safeSetItem(LS_AI_CFG, JSON.stringify(merged));
    }
  } catch {
    /* ignore */
  }
  return merged;
})();

const initialDefaultLang: Lang = ((): Lang => {
  const v = safeGetItem(LS_DEFAULT_LANG) as Lang | null;
  if (v === 'cpp' || v === 'c' || v === 'python') return v;
  return 'cpp';
})();

const sessionId = nanoid();
const problemStartedAtById = new Map<string, number>();
const fileSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const FILE_SAVE_DEBOUNCE_MS = 600;

// ============== 默认模板 ==============

export function defaultCode(lang: FileLang): string {
  if (lang === 'python') {
    return `# 在这里写你的解法\n\ndef solve():\n    pass\n\nif __name__ == "__main__":\n    solve()\n`;
  }
  if (lang === 'markdown') {
    return `# 解题思路\n\n## 思路\n\n## 复杂度\n\n- 时间：O(?)\n- 空间：O(?)\n\n## 参考\n\n`;
  }
  if (lang === 'plaintext') {
    return '';
  }
  if (lang === 'c') {
    // C 标准头文件，覆盖最常用的：IO / 内存 / 字符串 / 数学
    return `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <math.h>\n\nint main() {\n    \n    return 0;\n}\n`;
  }
  // cpp / 默认：显式列出常用 header（让学生看到具体用了什么）
  return `#include <iostream>\n#include <vector>\n#include <string>\n#include <algorithm>\n#include <cmath>\n#include <cstring>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n`;
}

export function defaultFileName(lang: FileLang, existing: string[]): string {
  const ext =
    lang === 'python'
      ? 'py'
      : lang === 'markdown'
        ? 'md'
        : lang === 'plaintext'
          ? 'txt'
          : lang === 'c'
            ? 'c'
            : 'cpp';
  const base = lang === 'markdown' ? 'notes' : 'main';
  let name = `${base}.${ext}`;
  if (!existing.includes(name)) return name;
  let i = 2;
  while (existing.includes(`${base}-v${i}.${ext}`)) i++;
  return `${base}-v${i}.${ext}`;
}

// ============== Store 创建 ==============

/** algoViz：从 cfg 派生 3 个工位 client，包成 AlgoVizClients 给 Service 用 */
function buildAlgoVizClients(cfg: AIConfig): AlgoVizClients {
  return {
    status: pickAlgoVizClient(cfg, 'status'),
    animation: pickAlgoVizClient(cfg, 'animation'),
    detect: pickAlgoVizClient(cfg, 'detect'),
  };
}

export const useStore = create<State>((set, get) => {
  const ai = new AIClient(resolveAIClientConfig(initialAIConfig));
  const aiQuality = new AIClient({ ...initialAIConfig, ...resolveQualityModel(initialAIConfig) });
  // fastLane: 本地 ollama 客户端，专做实时前台任务
  const fastCfg = deriveFastConfig(initialAIConfig);
  const aiFast = fastCfg ? new AIClient(fastCfg) : undefined;
  const coach = new Coach(ai, aiFast, initialAIConfig.routerHints, aiQuality);
  // algoViz Service：3 个工位 client，按 cfg 实时派生
  const algoVizService = new AlgoVizService(buildAlgoVizClients(initialAIConfig));

  /**
   * 把 algoViz patch 写回 IndexedDB + refresh，让所有订阅了 problems 的 UI 立即收到。
   * 单写入点：方便维护 + 保证三件套字段不会被部分丢失。
   */
  const algoVizPatchQueues = new Map<string, Promise<void>>();

  async function persistAlgoVizPatch(
    pid: string,
    patch: Partial<NonNullable<Problem['algoViz']>>,
  ): Promise<void> {
    const previous = algoVizPatchQueues.get(pid) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const cur = get().problems.find((p) => p.id === pid);
        if (!cur) return;
        const merged: NonNullable<Problem['algoViz']> = {
          status: 'idle',
          statusCode: null,
          animationCode: null,
          detectionSchema: null,
          ...(cur.algoViz ?? {}),
          ...patch,
        };
        const updated: Problem = { ...cur, algoViz: merged };
        await storage.saveProblem(updated);
        await get().refreshProblems();
      });
    algoVizPatchQueues.set(pid, next);
    try {
      await next;
    } finally {
      if (algoVizPatchQueues.get(pid) === next) {
        algoVizPatchQueues.delete(pid);
      }
    }
  }

  // ---- 任务队列 ----

  const tick = () => {
    const tasks = get().tasks;
    const running = tasks.filter((t) => t.status === 'running').length;
    if (running >= MAX_CONCURRENT) return;
    const next = tasks.find((t) => t.status === 'queued');
    if (!next) return;
    void runTask(next.id);
  };

  const runTask = async (taskId: string) => {
    const handler = handlersById.get(taskId);
    if (!handler) return;
    const ctrl = new AbortController();
    abortersById.set(taskId, ctrl);

    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, status: 'running', startedAt: Date.now() } : t,
      ),
    }));

    try {
      const result = await handler.run(
        (_d, accumulated) => {
          set((s) => ({
            streamPreviewById: { ...s.streamPreviewById, [taskId]: accumulated },
            tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, progress: accumulated } : t)),
          }));
        },
        (attempt, _delayMs, reason) => {
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === taskId
                ? { ...t, retryAttempt: attempt, retryReason: reason }
                : t,
            ),
          }));
        },
        ctrl.signal,
      );

      const now = Date.now();
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'done',
                finishedAt: now,
                durationMs: t.startedAt ? now - t.startedAt : undefined,
              }
            : t,
        ),
      }));
      await handler.onSuccess?.(result);
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError' || ctrl.signal.aborted;
      const now = Date.now();
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: isAbort ? 'cancelled' : 'failed',
                finishedAt: now,
                durationMs: t.startedAt ? now - t.startedAt : undefined,
                error: isAbort ? '已取消' : String(e?.message || e),
              }
            : t,
        ),
      }));
      if (!isAbort) {
        handler.onFailure?.(e);
        const lbl = get().tasks.find((t) => t.id === taskId)?.label ?? '任务';
        toast.error(`${lbl} 失败：${String(e?.message || e).slice(0, 80)}`);
      }
    } finally {
      abortersById.delete(taskId);
      tick();
    }
  };

  const enqueue = (
    kind: TaskKind,
    label: string,
    handler: TaskHandler,
    meta?: Record<string, unknown>,
  ): string => {
    const id = nanoid();
    handlersById.set(id, handler);
    set((s) => ({
      tasks: [{ id, kind, label, status: 'queued', progress: '', meta }, ...s.tasks],
    }));
    setTimeout(tick, 0);
    return id;
  };

  // ---- helpers ----

  const langOfFile = (lang: FileLang): Lang => {
    if (lang === 'cpp' || lang === 'c' || lang === 'python') return lang;
    return 'cpp'; // markdown/plaintext 文件分析时按 cpp 走（应该不会触发）
  };

  const recordSubmissionSession = async (
    problem: Problem,
    file: CodeFile,
    outcome: 'pass' | 'mistake',
  ) => {
    const now = Date.now();
    // 兜底：onboarding 等绕过 setActiveProblem 的入口也能拿到合理 startedAt
    const startedAt =
      problemStartedAtById.get(problem.id) ??
      (problem.createdAt && problem.createdAt < now ? problem.createdAt : now);
    problemStartedAtById.set(problem.id, startedAt);
    const events = await storage.listEvents({ sessionId, sinceTs: startedAt });
    const relatedEvents = events.filter((e) => e.problemId === problem.id);
    const session: Session = {
      id: `${sessionId}:${problem.id}`,
      problemId: problem.id,
      problemTitle: problem.title,
      startedAt,
      endedAt: now,
      effectiveMs: Math.max(0, now - startedAt),
      awayMs: 0,
      stuckCount: relatedEvents.filter((e) => e.type === 'hint_pushed').length,
      analyzeCount: relatedEvents.filter((e) => e.type === 'analysis' || e.type === 'manual_analyze').length,
      hintCount: relatedEvents.filter((e) => e.type === 'hint_pushed' || e.type === 'hint_taken').length,
      outcome,
      language: langOfFile(file.language),
      finalCode: file.content,
    };
    await storage.saveSession(session);
    await storage.appendEvent({
      ts: now,
      sessionId,
      problemId: problem.id,
      type: 'session_end',
      payload: { outcome, sessionId: session.id },
    });
    await get().refreshSessions();
    get().refreshLearningEngine();
  };

  return {
    aiConfig: initialAIConfig,
    ai,
    coach,
    algoVizService,
    moduleStatusByProblem: {},
    algoVizDetectingByProblem: {},

    problems: [],
    mistakes: [],
    sessions: [],
    activeProblemId: null,

    defaultLang: initialDefaultLang,
    filesByScope: {},
    activeFileIdByScope: {},

    analysisByProblem: {},
    streamPreviewById: {},

    qaByProblem: {},
    qaPendingProblemId: null,

    tasks: [],
    agentTrace: [],
    pendingHackCase: null,
    dismissHackCase: () => set({ pendingHackCase: null }),
    hackChainState: null,
    dismissHackChain: () => set({ hackChainState: null }),

    recordAgentTrace: (e) => {
      const event: AgentTraceEvent = {
        id: e.id ?? nanoid(),
        ts: e.ts ?? Date.now(),
        kind: e.kind,
        level: e.level,
        title: e.title,
        detail: e.detail,
        problemId: e.problemId,
        taskId: e.taskId,
        agentName: e.agentName ?? inferAgentName(e.title),
        latencyMs: e.latencyMs,
        tokenIn: e.tokenIn,
        tokenOut: e.tokenOut,
        route: e.route,
      };
      set((s) => ({
        agentTrace: [event, ...s.agentTrace].slice(0, AGENT_TRACE_LIMIT),
      }));
    },
    clearAgentTrace: () => set({ agentTrace: [] }),

    sidebarTab: null,
    multiFileMode: safeGetItem('aicc.multiFile.v1') === 'on',
    setMultiFileMode: (v: boolean) => {
      safeSetItem('aicc.multiFile.v1', v ? 'on' : 'off');
      set({ multiFileMode: v });
    },
    settingsOpen: false,
    feynmanOpen: false,
    openFeynman: () => set({ feynmanOpen: true }),
    closeFeynman: () => set({ feynmanOpen: false }),
    problemEditorOpen: false,
    problemBrowserOpen: false,
    cmdPaletteOpen: false,
    submitModalOpen: false,
    runtimePaneOpen: safeGetItem('aicc.runtimePane.v1') === 'on',

    lastEditAt: Date.now(),
    lastHintAt: 0,
    currentHint: null,
    // 卡住引导默认 OFF（学生想认真思考时不被打扰；用 TopBar 的「求助」按钮主动召唤）
    stuckHintEnabled: safeGetItem('aicc.stuckHint.v1') === 'on',
    askPrefill: null,
    coachDraft: null,
    feedbackTab: 'analyze',
    // Onboarding：localStorage 已标记完成 → idle；否则 wait-analyze 状态会在 App 启动时由触发器决定是否进 inject
    onboardingStep: safeGetItem('aicc.onboarding.v1') === 'done' ? 'idle' : 'idle',
    learningOverview: null,
    learningCards: [],
    learningCardDismissedDate: safeGetItem('aicc.learning.dismissed.v1'),
    diffSelection: [],
    lastRunByScope: {},
    overviewDismissedProblemIds: [],
    pendingAcReview: null,
    failureStatsByProblem: {},
    dailyReviewDismissedDate: safeGetItem('aicc.dailyReview.dismissed.v1'),
    dailyPlan: ((): DailyPlan | null => {
      // 启动时从 localStorage 恢复今日 plan（只恢复同日的，跨天作废）
      try {
        const raw = safeGetItem('aicc.dailyPlan.v1');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as DailyPlan;
        if (parsed?.date !== today()) return null;
        return parsed;
      } catch {
        return null;
      }
    })(),
    dailyPlanGenerating: false,

    // Coach 主动嗅探：A 默认 ON / C 默认 ON / B 默认 OFF（最慎重）
    coachHintsByScope: {},
    diagnoseOnFailEnabled: safeGetItem('aicc.coach.diagnoseOnFail.v1') !== 'off',
    constraintSanityEnabled: safeGetItem('aicc.coach.constraintSanity.v1') !== 'off',
    intentSniffEnabled: safeGetItem('aicc.coach.intentSniff.v1') === 'on',

    setAIConfig: (cfg) => {
      cfg = withDefaultCloudModels(cfg);
      try {
        safeSetItem(LS_AI_CFG, JSON.stringify(cfg));
      } catch {
        /* ignore */
      }
      // 注意：之前这里还会 POST /__aicc-ollama-mode 通知服务端切换 auto-start。
      // App.tsx 的 warmup effect 已经会在 aiConfig 变化时统一发一次（dev/preview 都发），
      // 所以这里去掉重复 POST，避免每次保存配置产生 2 次相同请求。
      // 主 client 用解析后的 primary（registry 优先 → fallback 顶层字段）
      get().ai.updateConfig(resolveAIClientConfig(cfg));
      get().coach.updateQualityClient(new AIClient({ ...cfg, ...resolveQualityModel(cfg) }));
      // 同步 fastLane：根据新 cfg 派生本地 client
      const newFastCfg = deriveFastConfig(cfg);
      if (newFastCfg) {
        // 已有 fast client → updateConfig；没有 → 新建并塞给 coach
        const existing: AIClient | undefined = (get().coach as any).aiFast;
        if (existing) {
          existing.updateConfig(newFastCfg);
        } else {
          get().coach.updateFastClient(new AIClient(newFastCfg));
        }
      } else {
        get().coach.updateFastClient(undefined);
      }
      // 同步路由阈值
      get().coach.updateRouterHints(cfg.routerHints);
      // 重建 algoVizService：3 个工位 client 都得跟着 cfg 重新挑（override / fastLane / 主 cfg）
      const newAlgoVizService = new AlgoVizService(buildAlgoVizClients(cfg));
      set({ aiConfig: cfg, algoVizService: newAlgoVizService });
    },

    /**
     * 注册一个新模型到 registry。返回新条目的 id（或传入的 id）。
     * 重名 label 不报错，由调用方自行去重；id 冲突时覆盖原条目。
     */
    registerModel: (entry) => {
      const cfg = get().aiConfig;
      const id = entry.id ?? `m${nanoid(6)}`;
      const newEntry: ModelEntry = {
        id,
        label: entry.label,
        provider: entry.provider,
        baseUrl: entry.baseUrl,
        apiKey: entry.apiKey,
        model: entry.model,
        numCtx: entry.numCtx,
      };
      const existing = cfg.modelRegistry ?? [];
      const next = existing.some((m) => m.id === id)
        ? existing.map((m) => (m.id === id ? newEntry : m))
        : [...existing, newEntry];
      get().setAIConfig({ ...cfg, modelRegistry: next });
      return id;
    },

    /** 更新指定 id 的注册条目；找不到则 noop */
    updateModel: (id, patch) => {
      const cfg = get().aiConfig;
      const existing = cfg.modelRegistry ?? [];
      if (!existing.some((m) => m.id === id)) return;
      const next = existing.map((m) => (m.id === id ? { ...m, ...patch, id } : m));
      get().setAIConfig({ ...cfg, modelRegistry: next });
    },

    /**
     * 从 registry 删除指定 id 的条目。
     * 若该 id 仍被某个 slot 引用，相应 slot 的 modelId 一并清空，避免悬挂引用。
     */
    removeModel: (id) => {
      const cfg = get().aiConfig;
      const existing = cfg.modelRegistry ?? [];
      const next = existing.filter((m) => m.id !== id);
      const cleaned: AIConfig = { ...cfg, modelRegistry: next };
      if (cfg.primaryModelId === id) cleaned.primaryModelId = undefined;
      if (cfg.fastLane?.modelId === id) {
        cleaned.fastLane = { ...cfg.fastLane, modelId: undefined };
      }
      if (cfg.intentRouter?.modelId === id) {
        cleaned.intentRouter = { ...cfg.intentRouter, modelId: undefined };
      }
      if (cfg.algoVizModels) {
        const av = { ...cfg.algoVizModels };
        for (const role of ['status', 'animation', 'detect'] as const) {
          if (av[role]?.modelId === id) {
            av[role] = { ...av[role]!, modelId: undefined };
          }
        }
        cleaned.algoVizModels = av;
      }
      get().setAIConfig(cleaned);
    },

    /**
     * 算法可视化：完整入库流水线（Trace → Status/VisualPlan 并行 → Animation）。
     *
     * - 已 ready / 正在跑 → skip（除非 force）
     * - Status 完成立即推送（status='status-ready'），UI 即时显示模块卡片
     * - Animation 在背景续写，完成后 status='ready'
     * - 失败任意阶段 → status='failed' + errorMessage（不阻塞用户继续做题）
     */
    requestAlgoVizGeneration: async (problemId, opts = {}) => {
      const st = get();
      const problem = st.problems.find((p) => p.id === problemId);
      if (!problem) return;
      const cur = problem.algoViz?.status;
      if (
        !opts.force &&
        (cur === 'ready' ||
          cur === 'generating-status' ||
          cur === 'status-ready' ||
          cur === 'generating-anim')
      ) {
        return;
      }
      st.recordAgentTrace({
        kind: 'decide',
        level: 'info',
        title: `算法可视化 · 开始生成：${problem.title}`,
        problemId: problem.id,
        agentName: 'AlgoViz',
      });
      // 进入 generating-status；★ 保留旧的 statusCode/animationCode/schema，
      // 新结果到位时由 onStatusReady / onAnimationReady 覆盖；失败保留旧的不丢失。
      // 用户重生时仍能看到/播放上一次的可用版本，不会"重生中啥都看不到"。
      await persistAlgoVizPatch(problem.id, {
        status: 'generating-status',
        errorMessage: undefined,
      });
      await st.algoVizService.generate(problem, {
        onTraceReady: async (trace) => {
          await persistAlgoVizPatch(problem.id, {
            trace,
            traceGeneratedAt: Date.now(),
          });
          get().recordAgentTrace({
            kind: 'feedback',
            level: 'success',
            title: '算法可视化 · Trace 完成：' + problem.title,
            detail: trace.algoName + ' · ' + trace.family + ' · ' + trace.states.length + ' states',
            problemId: problem.id,
            agentName: 'AlgoViz',
          });
        },
        onVisualPlanReady: async (visualPlan) => {
          await persistAlgoVizPatch(problem.id, {
            visualPlan,
            visualPlanGeneratedAt: Date.now(),
          });
          get().recordAgentTrace({
            kind: 'feedback',
            level: 'success',
            title: '算法可视化 · VisualPlan 完成：' + problem.title,
            detail: visualPlan.layout + ' · ' + visualPlan.components.length + ' components · ' + visualPlan.beats.length + ' beats',
            problemId: problem.id,
            agentName: 'AlgoViz',
          });
        },
        onStatusReady: async (statusCode, schema) => {
          await persistAlgoVizPatch(problem.id, {
            status: 'status-ready',
            statusCode,
            detectionSchema: schema,
            statusGeneratedAt: Date.now(),
          });
          get().setAlgoVizModuleStatus(
            problem.id,
            emptyAlgoVizModuleStatus(schema),
          );
          get().recordAgentTrace({
            kind: 'feedback',
            level: 'success',
            title: `算法可视化 · Status 完成：${problem.title}`,
            detail: `${schema.algoName} · ${schema.modules.length} 模块`,
            problemId: problem.id,
            agentName: 'AlgoViz',
          });
        },
        onAnimationStart: async () => {
          await persistAlgoVizPatch(problem.id, {
            status: 'generating-anim',
          });
        },
        onAnimationReady: async (animationCode) => {
          await persistAlgoVizPatch(problem.id, {
            status: 'ready',
            animationCode,
            animationGeneratedAt: Date.now(),
          });
          get().recordAgentTrace({
            kind: 'feedback',
            level: 'success',
            title: `算法可视化 · Animation 完成：${problem.title}`,
            problemId: problem.id,
            agentName: 'AlgoViz',
          });
        },
        onError: (stage, err) => {
          void persistAlgoVizPatch(problem.id, {
            status: 'failed',
            errorMessage: `${stage}: ${err.message.slice(0, 200)}`,
          });
          get().recordAgentTrace({
            kind: 'feedback',
            level: 'warn',
            title: `算法可视化 · ${stage} 失败：${problem.title}`,
            detail: err.message.slice(0, 240),
            problemId: problem.id,
            agentName: 'AlgoViz',
          });
        },
      });
    },

    /**
     * 老题模式：仅生成 Animation。
     * - 已有 schema → 直接走第 2 阶段
     * - 没 schema  → 自动 fallback 到完整 pipeline（避免 caller 自己判断）
     */
    requestAlgoVizAnimationOnly: async (problemId) => {
      const st = get();
      const problem = st.problems.find((p) => p.id === problemId);
      if (!problem) return;
      const cur = problem.algoViz;
      if (cur?.status === 'ready' || cur?.status === 'generating-anim') return;
      if (!cur?.detectionSchema) {
        await get().requestAlgoVizGeneration(problemId);
        return;
      }
      // 同 generate：保留旧 animationCode，新成功才覆盖；失败保留旧的可继续看
      await persistAlgoVizPatch(problem.id, {
        status: 'generating-anim',
        errorMessage: undefined,
      });
      await st.algoVizService.generateAnimationOnly(
        problem,
        cur.detectionSchema,
        cur.statusCode ?? '',
        {
          onReady: async (animationCode) => {
            await persistAlgoVizPatch(problem.id, {
              status: 'ready',
              animationCode,
              animationGeneratedAt: Date.now(),
            });
          },
          onError: (err) => {
            void persistAlgoVizPatch(problem.id, {
              status: 'failed',
              errorMessage: err.message.slice(0, 200),
            });
          },
        },
      );
    },

    /**
     * 实时检测：caller 应在外层 debounce 15s。
     * 内层只做 in-flight 锁（同一 problemId 上一轮没完成就 skip 这轮）。
     */
    detectAlgoVizModules: async (problemId, code) => {
      const st = get();
      const problem = st.problems.find((p) => p.id === problemId);
      const schema = problem?.algoViz?.detectionSchema;
      if (!schema) return;
      if (!code.trim()) {
        const existing = algoVizDetectTimers.get(problemId);
        if (existing) clearTimeout(existing);
        algoVizDetectTimers.delete(problemId);
        set((s) => ({
          moduleStatusByProblem: {
            ...s.moduleStatusByProblem,
            [problemId]: emptyAlgoVizModuleStatus(schema),
          },
          algoVizDetectingByProblem: {
            ...s.algoVizDetectingByProblem,
            [problemId]: false,
          },
        }));
        return;
      }
      if (st.algoVizDetectingByProblem[problemId]) return;
      set((s) => ({
        algoVizDetectingByProblem: {
          ...s.algoVizDetectingByProblem,
          [problemId]: true,
        },
      }));
      try {
        const result = await st.algoVizService.detect(code, schema);
        if (result) {
          set((s) => ({
            moduleStatusByProblem: {
              ...s.moduleStatusByProblem,
              [problemId]: result,
            },
          }));
        }
      } finally {
        set((s) => ({
          algoVizDetectingByProblem: {
            ...s.algoVizDetectingByProblem,
            [problemId]: false,
          },
        }));
      }
    },

    setAlgoVizModuleStatus: (problemId, status) => {
      set((s) => ({
        moduleStatusByProblem: {
          ...s.moduleStatusByProblem,
          [problemId]: status,
        },
      }));
    },

    setDefaultLang: (l) => {
      safeSetItem(LS_DEFAULT_LANG, l);
      set({ defaultLang: l });
    },

    setActiveProblem: async (id) => {
      const st = get();
      if (id && !problemStartedAtById.has(id)) {
        problemStartedAtById.set(id, Date.now());
      }
      set({ activeProblemId: id, diffSelection: [] });
      const scope = id ?? DRAFT_SCOPE;
      const list = st.filesByScope[scope] ?? [];
      // 该 scope 没有文件 → 自动创建一个默认文件
      if (list.length === 0) {
        await get().createFile({ scope, activate: true });
      } else if (!st.activeFileIdByScope[scope]) {
        // 有文件但没活跃，激活第一个
        set((s) => ({
          activeFileIdByScope: { ...s.activeFileIdByScope, [scope]: list[0].id },
        }));
      }
      // 懒补齐：如果该题缺白话解释，后台静默调 AI 生成（成功后右侧栏会自动出现）
      if (id) {
        const target = get().problems.find((p) => p.id === id);
        if (isImportedProblemPlaceholder(target)) return;
        if (target && (!target.plainExplanation || !target.plainExplanation.trim())) {
          void get().requestPlainExplanation(id);
        }
        // P1 题眼速读：缺缓存就生成（已缓存就跳过；ProblemOverviewCard 读 problem.coachOverview）
        if (target && (!target.coachOverview || !target.coachOverview.headline)) {
          void get().requestProblemOverview(id);
        }
        // 算法可视化：跟题眼速读同一触发点 — 完全没数据时后台自动跑 Status + Animation
        // （在 generating-* / ready / failed 时 requestAlgoVizGeneration 自己会 skip，无需这里判断）
        if (target && !target.algoViz) {
          void get().requestAlgoVizGeneration(id);
        }
      }
    },

    // ===== 文件 CRUD =====

    createFile: async ({ scope, name, language, content, activate = true }) => {
      const st = get();
      const scopeKey = scope ?? st.activeProblemId ?? DRAFT_SCOPE;
      const lang: FileLang = language ?? st.defaultLang;
      const existing = st.filesByScope[scopeKey] ?? [];
      const finalName = name?.trim() || defaultFileName(lang, existing.map((f) => f.name));
      const file: CodeFile = {
        id: nanoid(),
        problemId: scopeKey === DRAFT_SCOPE ? null : scopeKey,
        name: finalName,
        language: lang,
        content: content ?? defaultCode(lang),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await storage.saveFile(file);
      set((s) => ({
        filesByScope: {
          ...s.filesByScope,
          [scopeKey]: [...(s.filesByScope[scopeKey] ?? []), file],
        },
        activeFileIdByScope: activate
          ? { ...s.activeFileIdByScope, [scopeKey]: file.id }
          : s.activeFileIdByScope,
      }));
      return file;
    },

    renameFile: async (fileId, newName) => {
      const st = get();
      const scopeKey = findScopeOfFile(st, fileId);
      if (!scopeKey) return;
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file) return;
      const updated = { ...file, name: newName.trim(), updatedAt: Date.now() };
      await storage.saveFile(updated);
      set((s) => ({
        filesByScope: {
          ...s.filesByScope,
          [scopeKey]: (s.filesByScope[scopeKey] ?? []).map((f) =>
            f.id === fileId ? updated : f,
          ),
        },
      }));
    },

    duplicateFile: async (fileId, newName) => {
      const st = get();
      const scopeKey = findScopeOfFile(st, fileId);
      if (!scopeKey) throw new Error('file not found');
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file) throw new Error('file not found');
      const existing = st.filesByScope[scopeKey] ?? [];
      const fname =
        newName ?? smartDupName(file.name, existing.map((f) => f.name));
      const dup: CodeFile = {
        ...file,
        id: nanoid(),
        name: fname,
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await storage.saveFile(dup);
      set((s) => ({
        filesByScope: {
          ...s.filesByScope,
          [scopeKey]: [...(s.filesByScope[scopeKey] ?? []), dup],
        },
        activeFileIdByScope: { ...s.activeFileIdByScope, [scopeKey]: dup.id },
      }));
      return dup;
    },

    deleteFile: async (fileId) => {
      const st = get();
      const scopeKey = findScopeOfFile(st, fileId);
      if (!scopeKey) return;
      await storage.deleteFile(fileId);
      const remaining = (st.filesByScope[scopeKey] ?? []).filter((f) => f.id !== fileId);
      const wasActive = st.activeFileIdByScope[scopeKey] === fileId;
      set((s) => ({
        filesByScope: { ...s.filesByScope, [scopeKey]: remaining },
        activeFileIdByScope: {
          ...s.activeFileIdByScope,
          [scopeKey]: wasActive ? remaining[0]?.id ?? null : s.activeFileIdByScope[scopeKey],
        },
        diffSelection: s.diffSelection.filter((id) => id !== fileId),
      }));
      // 删完了 → 自动建一个新的，避免空白
      if (remaining.length === 0) {
        await get().createFile({ scope: scopeKey, activate: true });
      }
    },

    pinFile: async (fileId, pinned) => {
      const st = get();
      const scopeKey = findScopeOfFile(st, fileId);
      if (!scopeKey) return;
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file) return;
      const updated = { ...file, pinned, updatedAt: Date.now() };
      await storage.saveFile(updated);
      set((s) => ({
        filesByScope: {
          ...s.filesByScope,
          [scopeKey]: (s.filesByScope[scopeKey] ?? []).map((f) =>
            f.id === fileId ? updated : f,
          ),
        },
      }));
    },

    setActiveFile: (scope, fileId) => {
      set((s) => ({
        activeFileIdByScope: { ...s.activeFileIdByScope, [scope]: fileId },
      }));
    },

    updateFileContent: (fileId, content) => {
      const st = get();
      const scopeKey = findScopeOfFile(st, fileId);
      if (!scopeKey) return;
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file) return;
      const updated = { ...file, content, updatedAt: Date.now() };
      const previousSaveTimer = fileSaveTimers.get(fileId);
      if (previousSaveTimer) clearTimeout(previousSaveTimer);
      fileSaveTimers.set(
        fileId,
        setTimeout(() => {
          fileSaveTimers.delete(fileId);
          const latest = get();
          const latestScope = findScopeOfFile(latest, fileId);
          const latestFile = latestScope
            ? (latest.filesByScope[latestScope] ?? []).find((f) => f.id === fileId)
            : null;
          if (latestFile) {
            void storage.saveFile(latestFile);
          }
        }, FILE_SAVE_DEBOUNCE_MS),
      );
      set((s) => ({
        filesByScope: {
          ...s.filesByScope,
          [scopeKey]: (s.filesByScope[scopeKey] ?? []).map((f) =>
            f.id === fileId ? updated : f,
          ),
        },
        coachHintsByScope: s.coachHintsByScope[scopeKey]
          ? {
              ...s.coachHintsByScope,
              [scopeKey]: s.coachHintsByScope[scopeKey].filter((h) => h.fileId && h.fileId !== fileId),
            }
          : s.coachHintsByScope,
      }));
      // algoViz 实时检测：trailing-edge debounce 15s。
      // 仅当 scope 是真正的题目（非 __draft__）且该题已有 detectionSchema 时触发。
      if (scopeKey !== DRAFT_SCOPE) {
        const pid = scopeKey;
        const schema = st.problems.find((p) => p.id === pid)?.algoViz?.detectionSchema;
        if (schema) {
          const existing = algoVizDetectTimers.get(pid);
          if (existing) clearTimeout(existing);
          if (!content.trim()) {
            algoVizDetectTimers.delete(pid);
            set((s) => ({
              moduleStatusByProblem: {
                ...s.moduleStatusByProblem,
                [pid]: emptyAlgoVizModuleStatus(schema),
              },
              algoVizDetectingByProblem: {
                ...s.algoVizDetectingByProblem,
                [pid]: false,
              },
            }));
            return;
          }
          const timer = setTimeout(() => {
            algoVizDetectTimers.delete(pid);
            // 用最新内容（避免 closure 里的旧 content）
            const latest = get();
            const latestFile = (latest.filesByScope[pid] ?? []).find((f) => f.id === fileId);
            if (latestFile) {
              void latest.detectAlgoVizModules(pid, latestFile.content);
            }
          }, ALGOVIZ_DETECT_DEBOUNCE_MS);
          algoVizDetectTimers.set(pid, timer);
        }
      }
    },

    changeFileLanguage: async (fileId, language) => {
      const st = get();
      const scopeKey = findScopeOfFile(st, fileId);
      if (!scopeKey) return;
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file) return;
      const updated = { ...file, language, updatedAt: Date.now() };
      await storage.saveFile(updated);
      set((s) => ({
        filesByScope: {
          ...s.filesByScope,
          [scopeKey]: (s.filesByScope[scopeKey] ?? []).map((f) =>
            f.id === fileId ? updated : f,
          ),
        },
      }));
    },

    // ===== 对拍选择 =====

    toggleDiffSelection: (fileId) => {
      set((s) => {
        const next = s.diffSelection.includes(fileId)
          ? s.diffSelection.filter((x) => x !== fileId)
          : [...s.diffSelection, fileId].slice(-2); // 最多保留最近选的 2 个
        return { diffSelection: next };
      });
    },

    clearDiffSelection: () => set({ diffSelection: [] }),

    setLastRun: (scope, snap) => {
      set((s) => ({
        lastRunByScope: { ...s.lastRunByScope, [scope]: snap },
      }));
      // Coach 主动嗅探挂钩（全部静默，失败/超时也不打扰）
      const st = get();
      if (snap.exitCode !== 0 && st.diagnoseOnFailEnabled) {
        // A. 跑失败 → 800ms 后归因（让 stderr / 日志完全 flush）
        setTimeout(() => {
          void get().requestRuntimeDiagnosis(scope);
        }, 800);
      }
      if (
        snap.exitCode === 0 &&
        st.constraintSanityEnabled &&
        scope !== DRAFT_SCOPE &&
        !sanityCheckedProblems.has(scope)
      ) {
        // C. 题目首次跑通样例 → 数据范围 sanity（每题终生一次）
        // 用样例输入对比：只在用户跑的 stdin 与首样例 input 相符时算"跑通样例"
        const problem = st.problems.find((p) => p.id === scope);
        const sample = problem?.examples?.[0];
        if (sample && normalizeRunIO(snap.stdin) === normalizeRunIO(sample.input)) {
          // 立刻标记，避免并发重入；失败时下面 catch 里再 delete
          sanityCheckedProblems.add(scope);
          void get().requestConstraintSanity(scope);
        }
      }
    },
    clearLastRun: (scope) =>
      set((s) => {
        const next = { ...s.lastRunByScope };
        delete next[scope];
        return { lastRunByScope: next };
      }),

    // ===== Coach 主动嗅探（A / B / C） =====

    requestRuntimeDiagnosis: async (scope) => {
      const st = get();
      if (!st.diagnoseOnFailEnabled) return;
      // 与主体隔离：fastLane 没配好就不嗅，绝不偷偷蹭云端 token
      if (!deriveFastConfig(st.aiConfig)) return;
      const snap = st.lastRunByScope[scope];
      if (!snap || snap.exitCode === 0) return;
      const stderrTail = (snap.stderr ?? '').slice(-500).trim();
      if (!stderrTail) return; // stderr 空就别费事
      // 同 stderr 60s 内不重复（节流）
      const stderrKey = codeHash(stderrTail.slice(-200));
      const last = lastDiagByStderrHash.get(stderrKey) ?? 0;
      if (Date.now() - last < DIAG_DEDUP_MS) return;
      lastDiagByStderrHash.set(stderrKey, Date.now());
      const file = (st.filesByScope[scope] ?? []).find((f) => f.id === snap.fileId);
      if (!file) return;
      const problem = scope !== DRAFT_SCOPE ? st.problems.find((p) => p.id === scope) : undefined;
      const lang = langOfFile(file.language);
      // 调用本地模型（fastLane）；client 内部自带超时和重试，外部不再额外裹
      try {
        const result = await get().coach.diagnoseRuntimeError({
          problem,
          language: lang,
          code: file.content,
          exitCode: snap.exitCode,
          stderrTail,
          stdinHead: snap.stdin?.slice(0, 200),
        });
        if (!result) return; // 模型解析失败 → 静默
        const hint: CoachHint = {
          id: nanoid(),
          kind: 'runtime-error',
          scope,
          problemId: problem?.id,
          fileId: file.id,
          line: result.likelyLine ?? undefined,
          message: result.oneLineHint,
          level: 'warn',
          ts: Date.now(),
        };
        appendCoachHint(set, scope, hint);
        get().recordAgentTrace({
          kind: 'perceive',
          level: 'warn',
          title: `跑失败归因：${result.errorClass}`,
          detail:
            (result.likelyLine ? `可能在第 ${result.likelyLine} 行：` : '') +
            result.oneLineHint,
          problemId: problem?.id,
        });
      } catch (e) {
        // 节流计数已经记了，本次失败别消耗下次机会 → 撤销
        lastDiagByStderrHash.delete(stderrKey);
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[Coach] requestRuntimeDiagnosis failed', e);
        }
      }
    },

    requestConstraintSanity: async (problemId) => {
      const st = get();
      if (!st.constraintSanityEnabled) return;
      // 与主体隔离：fastLane 没配好就不嗅
      if (!deriveFastConfig(st.aiConfig)) return;
      const problem = st.problems.find((p) => p.id === problemId);
      if (!problem) return;
      const fileId = st.activeFileIdByScope[problemId];
      const file = (st.filesByScope[problemId] ?? []).find((f) => f.id === fileId);
      if (!file) return;
      if (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python') return;
      const lang = langOfFile(file.language);
      try {
        const risks = await get().coach.sanityCheckConstraints({
          problem,
          language: lang,
          code: file.content,
        });
        if (risks.length === 0) {
          // 没风险 → 仅写一条 trace（info，可折叠），不出角标
          get().recordAgentTrace({
            kind: 'perceive',
            level: 'info',
            title: '数据范围审计：未发现风险',
            problemId,
          });
          return;
        }
        // 有风险 → 一条 hint（合并所有 risks）
        const message = risks.length === 1 ? risks[0] : `${risks.length} 项风险：${risks.join('；')}`;
        const hint: CoachHint = {
          id: nanoid(),
          kind: 'constraint-risk',
          scope: problemId,
          problemId,
          fileId: file.id,
          message: message.slice(0, 200),
          level: 'warn',
          ts: Date.now(),
        };
        appendCoachHint(set, problemId, hint);
        get().recordAgentTrace({
          kind: 'perceive',
          level: 'warn',
          title: `数据范围审计：${risks.length} 项风险`,
          detail: risks.join('\n'),
          problemId,
        });
      } catch (e) {
        // 失败 → 撤销终生标记，让下一次跑通时还能再试
        sanityCheckedProblems.delete(problemId);
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[Coach] requestConstraintSanity failed', e);
        }
      }
    },

    requestIntentSniff: async (scope) => {
      const st = get();
      if (!st.intentSniffEnabled) return;
      // 与主体隔离：fastLane 没配好就不嗅
      if (!deriveFastConfig(st.aiConfig)) return;
      if (scope === DRAFT_SCOPE) return; // 草稿无题目，没法嗅
      const problem = st.problems.find((p) => p.id === scope);
      if (!problem) return;
      const fileId = st.activeFileIdByScope[scope];
      const file = (st.filesByScope[scope] ?? []).find((f) => f.id === fileId);
      if (!file) return;
      if (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python') return;
      // 同 codeHash 不重复 sniff
      const ch = codeHash(file.content);
      if (lastSniffByCodeHash.has(ch)) return;
      // 全局节流：5 分钟内最多一次
      const now = Date.now();
      if (now - lastIntentSniffAt.ts < INTENT_SNIFF_GLOBAL_MS) return;
      lastSniffByCodeHash.set(ch, now);
      lastIntentSniffAt.ts = now;
      const lang = langOfFile(file.language);
      try {
        const { onTrack, evidence } = await get().coach.sniffIntent({
          problem,
          language: lang,
          code: file.content,
        });
        if (onTrack) {
          // 在轨 → 完全静默，只一条 trace 记录"我看过了"
          get().recordAgentTrace({
            kind: 'perceive',
            level: 'info',
            title: '题意校对：方向在轨',
            problemId: problem.id,
          });
          return;
        }
        if (!evidence) return; // 失败保护：onTrack=false 但没 evidence 就忽略
        const hint: CoachHint = {
          id: nanoid(),
          kind: 'intent-drift',
          scope,
          problemId: problem.id,
          fileId: file.id,
          message: evidence.slice(0, 120),
          level: 'warn',
          ts: Date.now(),
        };
        appendCoachHint(set, scope, hint);
        get().recordAgentTrace({
          kind: 'perceive',
          level: 'warn',
          title: '题意校对：方向可能偏了',
          detail: evidence,
          problemId: problem.id,
        });
      } catch (e) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[Coach] requestIntentSniff failed', e);
        }
      }
    },

    dismissCoachHint: (id) =>
      set((s) => {
        const next: Record<string, CoachHint[]> = {};
        let changed = false;
        for (const [k, list] of Object.entries(s.coachHintsByScope)) {
          const filtered = list.filter((h) => h.id !== id);
          if (filtered.length !== list.length) changed = true;
          next[k] = filtered;
        }
        return changed ? { coachHintsByScope: next } : s;
      }),

    clearCoachHints: (scope) =>
      set((s) => {
        if (!s.coachHintsByScope[scope]) return s;
        const next = { ...s.coachHintsByScope };
        delete next[scope];
        return { coachHintsByScope: next };
      }),

    setDiagnoseOnFailEnabled: (v) => {
      safeSetItem('aicc.coach.diagnoseOnFail.v1', v ? 'on' : 'off');
      set({ diagnoseOnFailEnabled: v });
    },
    setConstraintSanityEnabled: (v) => {
      safeSetItem('aicc.coach.constraintSanity.v1', v ? 'on' : 'off');
      set({ constraintSanityEnabled: v });
    },
    setIntentSniffEnabled: (v) => {
      safeSetItem('aicc.coach.intentSniff.v1', v ? 'on' : 'off');
      set({ intentSniffEnabled: v });
    },

    // ===== 数据加载 =====

    refreshProblems: async () => {
      const list = await storage.listProblems();
      set({ problems: list });
    },
    refreshMistakes: async () => {
      const list = await storage.listMistakes();
      set({ mistakes: list });
    },
    refreshSessions: async () => {
      const list = await storage.listSessions();
      set({ sessions: list });
    },

    refreshFiles: async () => {
      const all = await storage.listFiles();
      const grouped: Record<string, CodeFile[]> = {};
      for (const f of all) {
        const k = f.problemId ?? DRAFT_SCOPE;
        (grouped[k] ??= []).push(f);
      }
      // 每组按 pinned + updatedAt 排序
      for (const k of Object.keys(grouped)) {
        grouped[k].sort((a, b) => {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return a.createdAt - b.createdAt;
        });
      }
      set({ filesByScope: grouped });

      // 给每个 scope 选 active：保留之前的，如果之前的不存在了选第一个
      const st = get();
      const nextActive: Record<string, string | null> = {};
      for (const [k, fs] of Object.entries(grouped)) {
        const prev = st.activeFileIdByScope[k];
        const stillExists = prev && fs.some((f) => f.id === prev);
        nextActive[k] = stillExists ? prev! : fs[0]?.id ?? null;
      }
      set({ activeFileIdByScope: nextActive });
    },

    refreshAll: async () => {
      await Promise.all([
        get().refreshProblems(),
        get().refreshMistakes(),
        get().refreshSessions(),
        get().refreshFiles(),
      ]);
      // 旧数据迁移
      await migrateLegacyCode(get);
      // 草稿 scope 没有文件 → 创建默认
      const st = get();
      const draftFiles = st.filesByScope[DRAFT_SCOPE] ?? [];
      if (draftFiles.length === 0) {
        await get().createFile({ scope: DRAFT_SCOPE, activate: true });
      }
    },

    // ===== AI 任务 =====

    enqueueParseProblem: (rawText) => {
      const label = `解析题目：${rawText.split('\n')[0].slice(0, 24) || '未命名'}`;
      return enqueue('parse-problem', label, {
        run: (onChunk, onRetry, signal) =>
          get().coach.parseProblem(rawText, { onChunk, onRetry, signal }),
        onSuccess: async (result) => {
          const p = result as Problem;
          await storage.saveProblem(p);
          await get().refreshProblems();
          await get().setActiveProblem(p.id);
          toast.success(`已录入：${p.title}`);
        },
      });
    },

    requestPlainExplanation: async (problemId) => {
      const st = get();
      const problem = st.problems.find((p) => p.id === problemId);
      if (!problem) return;
      if (problem.plainExplanation && problem.plainExplanation.trim().length > 0) return;
      const needsKey = st.aiConfig.provider !== 'ollama';
      if (needsKey && !st.aiConfig.apiKey) return; // 没配 AI 就不打扰
      get().recordAgentTrace({
        kind: 'decide',
        level: 'info',
        title: `补齐白话解释：${problem.title}`,
        problemId: problem.id,
      });
      try {
        const text = await st.coach.generatePlainExplanation({
          title: problem.title,
          statement: problem.statement,
          examples: problem.examples?.map((e) => ({ input: e.input, output: e.output })),
        });
        if (!text) return;
        // 从 store 重拿最新版本（避免 stale snapshot 覆盖其它并发 LLM 任务写入的字段，如 algoViz / coachOverview）
        const latest = get().problems.find((p) => p.id === problemId) ?? problem;
        const updated = { ...latest, plainExplanation: text };
        await storage.saveProblem(updated);
        await get().refreshProblems();
        get().recordAgentTrace({
          kind: 'feedback',
          level: 'success',
          title: `白话解释已补齐：${problem.title}`,
          detail: text.slice(0, 240),
          problemId: problem.id,
        });
      } catch (e: any) {
        get().recordAgentTrace({
          kind: 'feedback',
          level: 'warn',
          title: `白话生成失败：${problem.title}`,
          detail: String(e?.message ?? e).slice(0, 240),
          problemId: problem.id,
        });
      }
    },

    /**
     * P1 题眼速读：激活新题时云端读一遍生成 coachOverview，缓存到 problem 上。
     *
     * - 默认行为：已缓存则跳过、未配 AI 则跳过、失败静默记 trace
     * - opts.force：用户在 UI 上点「重新生成」时跳过缓存检查
     * - 始终走主云端（cloud），因为大模型抓抽象能力强且一题只跑一次
     */
    requestProblemOverview: async (problemId, opts = {}) => {
      const st = get();
      const problem = st.problems.find((p) => p.id === problemId);
      if (!problem) return;
      // 已缓存 + 不强制 → 跳过
      if (!opts.force && problem.coachOverview && problem.coachOverview.headline) return;
      // 没配 AI 不打扰
      const needsKey = st.aiConfig.provider !== 'ollama';
      if (needsKey && !st.aiConfig.apiKey) return;
      get().recordAgentTrace({
        kind: 'decide',
        level: 'info',
        title: `题眼速读：${problem.title}`,
        problemId: problem.id,
      });
      try {
        const overview = await st.coach.generateProblemOverview({
          title: problem.title,
          statement: problem.statement,
          constraints: problem.constraints,
          examples: problem.examples?.map((e) => ({ input: e.input, output: e.output })),
          difficulty: problem.difficulty,
          tags: problem.tags,
        });
        if (!overview) return;
        // 从 store 重拿最新版本（避免 stale snapshot 覆盖并发任务的写入）
        const latest = get().problems.find((p) => p.id === problemId) ?? problem;
        const updated: Problem = {
          ...latest,
          coachOverview: {
            headline: overview.headline,
            notes: overview.notes,
            generatedAt: Date.now(),
          },
        };
        await storage.saveProblem(updated);
        await get().refreshProblems();
        get().recordAgentTrace({
          kind: 'feedback',
          level: 'success',
          title: `题眼速读已生成：${problem.title}`,
          detail: `${overview.headline}\n${overview.notes.map((n) => '• ' + n).join('\n')}`,
          problemId: problem.id,
        });
      } catch (e: any) {
        get().recordAgentTrace({
          kind: 'feedback',
          level: 'warn',
          title: `题眼速读失败：${problem.title}`,
          detail: String(e?.message ?? e).slice(0, 240),
          problemId: problem.id,
        });
      }
    },

    dismissProblemOverview: (problemId) =>
      set((s) => {
        if (s.overviewDismissedProblemIds.includes(problemId)) return s;
        return {
          overviewDismissedProblemIds: [...s.overviewDismissedProblemIds, problemId],
        };
      }),

    /**
     * P2 AC 复盘：提交 AC 后由 enqueueSummarize 的 onSuccess 钩子触发。
     *
     * 流程：调云端 → 写入 problem.acReview → 设 pendingAcReview 让浮卡显示。
     * 失败静默记 trace；不抢 toast，不挡用户继续看 AC 总结结果。
     */
    requestAcReview: async (problemId, fileId) => {
      const st = get();
      const problem = st.problems.find((p) => p.id === problemId);
      if (!problem) return;
      const file = (st.filesByScope[problemId] ?? []).find((f) => f.id === fileId);
      if (!file) return;
      if (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python') return;
      const needsKey = st.aiConfig.provider !== 'ollama';
      if (needsKey && !st.aiConfig.apiKey) return;
      get().recordAgentTrace({
        kind: 'decide',
        level: 'info',
        title: `AC 复盘：${problem.title}`,
        problemId: problem.id,
      });
      try {
        const review = await st.coach.generateAcReview({
          problem,
          language: langOfFile(file.language),
          code: file.content,
        });
        if (!review) return;
        // 从 store 重拿最新版本（避免 stale snapshot 覆盖并发任务的写入）
        const latest = get().problems.find((p) => p.id === problemId) ?? problem;
        const updated: Problem = {
          ...latest,
          acReview: {
            passingPattern: review.passingPattern,
            betterApproach: review.betterApproach,
            followUps: review.followUps,
            generatedAt: Date.now(),
          },
        };
        await storage.saveProblem(updated);
        await get().refreshProblems();
        // 浮卡：提示用户去看复盘
        set({
          pendingAcReview: {
            problemId,
            passingPattern: review.passingPattern,
            betterApproach: review.betterApproach,
            followUps: review.followUps,
          },
        });
        const detailLines = [
          `路数：${review.passingPattern}`,
          review.betterApproach
            ? `更优：${review.betterApproach.name}（${review.betterApproach.complexity}）`
            : '已是最优解法',
          ...(review.followUps.length > 0
            ? ['延伸：' + review.followUps.join(' / ')]
            : []),
        ];
        get().recordAgentTrace({
          kind: 'feedback',
          level: 'success',
          title: `AC 复盘已生成：${problem.title}`,
          detail: detailLines.join('\n'),
          problemId: problem.id,
        });
      } catch (e: any) {
        get().recordAgentTrace({
          kind: 'feedback',
          level: 'warn',
          title: `AC 复盘失败：${problem.title}`,
          detail: String(e?.message ?? e).slice(0, 240),
          problemId: problem.id,
        });
      }
    },

    dismissAcReview: () => set({ pendingAcReview: null }),

    enqueueAnalyze: (opts) => {
      const st = get();
      // ollama 等本地服务不需要 apiKey
      const needsKey = st.aiConfig.provider !== 'ollama';
      if (needsKey && !st.aiConfig.apiKey) {
        toast.error('请先在设置里填 API Key');
        set({ settingsOpen: true });
        return null;
      }
      if (!st.aiConfig.baseUrl) {
        toast.error('请先在设置里配 Base URL');
        set({ settingsOpen: true });
        return null;
      }
      const scopeKey = st.activeProblemId ?? DRAFT_SCOPE;
      const activeFileId = st.activeFileIdByScope[scopeKey];
      const files = st.filesByScope[scopeKey] ?? [];
      const file = files.find((f) => f.id === activeFileId);
      if (!file) {
        toast.error('当前没有活跃文件');
        return null;
      }
      if (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python') {
        toast.error(`${file.language} 文件不能直接分析（请切到代码文件）`);
        return null;
      }
      // 阈值：少于 3 行非空代码或 < 30 字符 → 没什么可分析
      const nonEmptyLines = file.content.split('\n').filter((l) => l.trim().length > 0).length;
      if (file.content.trim().length < 30 || nonEmptyLines < 3) {
        toast.warning('代码太短了', { description: '至少写 3 行实质代码再触发分析（节省 AI 调用）' });
        return null;
      }
      // 重复触发防护：同一文件已有未完成的分析任务在跑/排队 → 复用旧 task，不创建新的
      const existing = st.tasks.find(
        (t) =>
          t.kind === 'analyze-code' &&
          (t.status === 'running' || t.status === 'queued') &&
          // task label 含文件名（"分析：xxx · main.cpp"），用 endsWith 匹配文件名
          t.label.endsWith(`· ${file.name}`),
      );
      if (existing) {
        toast.info('已有分析在跑，请等当前结果', { duration: 1500 });
        return existing.id;
      }
      const problem = st.activeProblemId
        ? st.problems.find((p) => p.id === st.activeProblemId)
        : undefined;

      const label = problem
        ? `分析：${problem.title} · ${file.name}`
        : `分析：${file.name}`;

      get().recordAgentTrace({
        kind: 'decide',
        level: 'info',
        title: '调用代码审查',
        detail: `原因：${opts?.reason ?? 'manual'}\n文件：${file.name}（${file.language}, ${file.content.split('\n').length} 行）${problem ? `\n题目：${problem.title}` : ''}`,
        problemId: problem?.id,
      });

      return enqueue(
        'analyze-code',
        label,
        {
          run: async (onChunk, onRetry, signal) => {
            const events = await storage.listEvents({ sessionId, limit: 200 });
            const profile: LearnerProfile = buildLearnerProfile({
              sessions: st.sessions,
              problems: st.problems,
              mistakes: st.mistakes,
              events,
              currentProblemTags: problem?.tags,
            });
            const history: AnalysisHistoryEntry[] = events
              .filter(
                (e) =>
                  e.problemId === problem?.id &&
                  (e.type === 'analysis' || e.type === 'manual_analyze'),
              )
              .slice(-2)
              .map((e) => {
                const p = e.payload as any;
                return {
                  ts: e.ts,
                  reason: p?.reason ?? 'auto',
                  issuesSnapshot: p?.issuesSnapshot ?? [],
                  overallComment: p?.overallComment,
                  codeHash: p?.codeHash,
                  codeLineCount: p?.codeLineCount,
                };
              })
              .filter((h) => h.issuesSnapshot.length > 0 || h.overallComment);

            // 收集同 scope 其它文件作为上下文（除当前文件外，最多 5 个）
            const siblings = files
              .filter((f) => f.id !== file.id && f.content.trim().length > 0)
              .slice(0, 5)
              .map((f) => ({ name: f.name, language: f.language, content: f.content }));

            // 取最近一次运行快照（让 AI 看到 stderr / exitCode）
            // 仅当快照对应当前 file 且 30 分钟内才用，避免给 AI 过期上下文
            const runSnap = get().lastRunByScope[problem?.id ?? DRAFT_SCOPE];
            const runtimeContext =
              runSnap &&
              runSnap.fileId === file.id &&
              Date.now() - runSnap.timestamp < 30 * 60 * 1000
                ? {
                    exitCode: runSnap.exitCode,
                    stdin: runSnap.stdin,
                    stdout: runSnap.stdout,
                    stderr: runSnap.stderr,
                    durationMs: runSnap.durationMs,
                    timestamp: runSnap.timestamp,
                  }
                : undefined;

            // P3 escalation：同题近 7 天 ≥ THRESHOLD 次失败时升级 prompt
            const rawStats = problem
              ? get().failureStatsByProblem[problem.id]
              : undefined;
            const failureStats = rawStats ? pruneFailureStats(rawStats) : undefined;
            const escalation =
              failureStats && failureStats.count >= FAILURE_STATS_ESCALATE_THRESHOLD
                ? {
                    failureCount: failureStats.count,
                    recentVerdicts: failureStats.recentVerdicts,
                  }
                : undefined;
            if (escalation) {
              get().recordAgentTrace({
                kind: 'decide',
                level: 'warn',
                title: `屡败升级：${problem?.title ?? '(无题)'}`,
                detail: `已失败 ${escalation.failureCount} 次（${escalation.recentVerdicts.join(',')}），分析切到「换思路」模式`,
                problemId: problem?.id,
              });
            }
            // AST-Light 结构特征（本地纯逻辑 Agent，喂给后续 LLM）
            let astFeatures: CodeStructFeatures | undefined;
            try {
              astFeatures = extractFeatures(file.content, langOfFile(file.language));
            } catch {
              astFeatures = undefined;
            }
            if (astFeatures && (astFeatures.redFlags.length > 0 || astFeatures.loops > 0)) {
              const redFlagDetail =
                astFeatures.redFlags.length > 0
                  ? '\n- ' + astFeatures.redFlags.map((r) => r.hint).join('\n- ')
                  : '';
              get().recordAgentTrace({
                kind: 'perceive',
                level: astFeatures.redFlags.length > 0 ? 'warn' : 'info',
                title: `AST-Light · 结构信号（本地）`,
                detail: `复杂度估计：${astFeatures.complexityHint}\n循环 ${astFeatures.loops} · 嵌套 ${astFeatures.maxNestingDepth} · 红旗 ${astFeatures.redFlags.length}${redFlagDetail}`,
                problemId: problem?.id,
                agentName: 'AstDiff',
              });
            }
            return get().coach.analyzeCode(
              {
                problem,
                code: file.content,
                language: langOfFile(file.language),
                profile,
                history,
                siblings,
                runtimeContext,
                escalation,
                astFeatures,
              },
              { onChunk, onRetry, signal },
            );
          },
          onSuccess: async (result) => {
            const r = result as AnalysisResult;
            const pid = problem?.id ?? DRAFT_SCOPE;
            const stamped: AnalysisResult = {
              ...r,
              fileId: file.id,
              codeHash: codeHash(file.content),
              analyzedAt: Date.now(),
            };
            set((s) => ({
              analysisByProblem: { ...s.analysisByProblem, [pid]: stamped },
            }));
            await storage.appendEvent({
              ts: Date.now(),
              sessionId,
              problemId: problem?.id,
              type: opts?.reason === 'manual' ? 'manual_analyze' : 'analysis',
              payload: {
                reason: opts?.reason ?? 'manual',
                fileId: file.id,
                fileName: file.name,
                issueCount: stamped.issues.length,
                issuesSnapshot: stamped.issues.map((i) => ({
                  line: i.line,
                  severity: i.severity,
                  category: i.category,
                  message: i.message,
                })),
                overallComment: stamped.overallComment,
                codeHash: codeHash(file.content),
                codeLineCount: file.content.split('\n').length,
              },
            });
            const errCount = stamped.issues.filter((i) => i.severity === 'error').length;
            const warnCount = stamped.issues.filter((i) => i.severity === 'warning').length;
            get().recordAgentTrace({
              kind: 'feedback',
              level: errCount > 0 ? 'warn' : warnCount > 0 ? 'info' : 'success',
              title: stamped.issues.length === 0 ? '审查完成：未发现明显问题' : `审查完成：${stamped.issues.length} 处批注`,
              detail: stamped.overallComment ? stamped.overallComment.slice(0, 240) : undefined,
              problemId: problem?.id,
            });
            toast.success(
              `分析完成：${stamped.issues.length === 0 ? '没发现明显问题' : `${stamped.issues.length} 个问题`}`,
            );
          },
        },
        { problemId: problem?.id, fileId: file.id },
      );
    },

    enqueueSummarize: (arg) => {
      // 兼容旧 boolean 接口：true=入错题本，false=AC 总结
      const opts: SubmitOpts =
        typeof arg === 'boolean' ? { isMistake: arg } : arg;
      const st = get();
      if (!st.activeProblemId) {
        toast.error('请先激活一道题目');
        return null;
      }
      if (!hasUsableAIConfig(st.aiConfig)) {
        toast.error('请先配置 AI 服务');
        set({ settingsOpen: true });
        return null;
      }
      const problem = st.problems.find((p) => p.id === st.activeProblemId);
      if (!problem) return null;
      const scopeKey = problem.id;
      const fileId = st.activeFileIdByScope[scopeKey];
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file || (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python')) {
        toast.error('当前活跃文件不是代码文件');
        return null;
      }

      const verdictTag = opts.verdict ? `[${opts.verdict}] ` : '';
      const label = opts.isMistake
        ? `${verdictTag}入错题：${problem.title}`
        : `通过总结：${problem.title}`;
      get().recordAgentTrace({
        kind: 'decide',
        level: opts.isMistake ? 'warn' : 'success',
        title: opts.isMistake ? `判定：${opts.verdict ?? 'WA'} → 入错题流程` : `判定：AC → 总结知识点`,
        detail: opts.userNote ? `用户备注：${opts.userNote.slice(0, 120)}` : undefined,
        problemId: problem.id,
      });
      return enqueue('summarize-mistake', label, {
        run: (onChunk, onRetry, signal) =>
          get().coach.summarizeMistake(
            {
              problem,
              code: file.content,
              language: langOfFile(file.language),
              isMistake: opts.isMistake,
              verdict: opts.verdict,
              userNote: opts.userNote,
            },
            { onChunk, onRetry, signal },
          ),
        onSuccess: async (result) => {
          await recordSubmissionSession(problem, file, opts.isMistake ? 'mistake' : 'pass');
          if (opts.isMistake) {
            const m = result as Mistake;
            await storage.saveMistake(m);
            await get().refreshMistakes();
            // P3 屡败 escalation：累计该题失败次数 + 最近 5 个 verdict（7 天滑窗）
            set((s) => {
              const raw = s.failureStatsByProblem[problem.id] ?? {
                count: 0,
                recentVerdicts: [],
                recentTimestamps: [],
              };
              const prev = pruneFailureStats(raw);
              const v = opts.verdict ?? 'OTHER';
              const now = Date.now();
              return {
                failureStatsByProblem: {
                  ...s.failureStatsByProblem,
                  [problem.id]: {
                    count: prev.count + 1,
                    recentVerdicts: [...prev.recentVerdicts, v].slice(-5),
                    recentTimestamps: [...prev.recentTimestamps, now].slice(-5),
                  },
                },
              };
            });
            get().recordAgentTrace({
              kind: 'feedback',
              level: 'warn',
              title: `已写入错题本：${m.category}`,
              detail: m.rootCause?.slice(0, 240),
              problemId: problem.id,
            });
            toast.success(`已加入错题本：${m.category}`);
          } else {
            // P3 屡败计数器：AC 后清零
            set((s) => {
              if (!s.failureStatsByProblem[problem.id]) return s;
              const next = { ...s.failureStatsByProblem };
              delete next[problem.id];
              return { failureStatsByProblem: next };
            });
            get().recordAgentTrace({
              kind: 'feedback',
              level: 'success',
              title: 'AC 总结：已沉淀知识点',
              problemId: problem.id,
            });
            toast.success(`已总结知识点`);
            // 错题本联动：这题之前如果在错题本里且未复习 → 自动标记
            // 真正的"复习"不是手动按按钮，是 AC 通过
            const related = get().mistakes.filter(
              (m) => m.problemId === problem.id && !m.reviewedAt,
            );
            for (const m of related) {
              await get().markMistakeReviewed(m.id);
            }
            if (related.length > 0) {
              toast.success(`✨ 自动标记 ${related.length} 条错题已复习`, {
                description: 'AC 即为有效复习',
                duration: 4000,
              });
              // 同步刷新学习引擎（复习率会改变）
              get().refreshLearningEngine();
            }
            // P2 AC 复盘：异步触发，让 AcReviewCard 浮起 + 缓存到 problem 上
            void get().requestAcReview(problem.id, file.id);
          }
        },
      });
    },

    enqueueDiff: () => {
      const st = get();
      if (!hasUsableAIConfig(st.aiConfig)) {
        toast.error('请先配置 AI');
        set({ settingsOpen: true });
        return null;
      }
      if (st.diffSelection.length !== 2) {
        toast.error('请勾选两个文件');
        return null;
      }
      const all = Object.values(st.filesByScope).flat();
      const f1 = all.find((f) => f.id === st.diffSelection[0]);
      const f2 = all.find((f) => f.id === st.diffSelection[1]);
      if (!f1 || !f2) return null;
      const problem = st.activeProblemId
        ? st.problems.find((p) => p.id === st.activeProblemId)
        : undefined;

      return enqueue('compare-files', `对拍：${f1.name} ↔ ${f2.name}`, {
        run: async (onChunk, onRetry, signal) => {
          // 复用 chat 直接走 AI（自定义 prompt 简单做）
          const sys = '你是资深算法竞赛教练，对比两份解法的差异、正确性、复杂度，给出谁更优、各自适用场景，并指出潜在 bug。直接输出 markdown，不要任何前置说明。';
          const user = `${problem ? `题目：${problem.title}\n${problem.statement}\n\n` : ''}解法 A（${f1.name}，${f1.language}）：\n\`\`\`${f1.language}\n${f1.content}\n\`\`\`\n\n解法 B（${f2.name}，${f2.language}）：\n\`\`\`${f2.language}\n${f2.content}\n\`\`\`\n\n请用 markdown 给出对比报告。`;
          const stream = get().coach['ai'].chatStream({
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: user },
            ],
            maxTokens: 6000,
            onChunk,
            onRetry,
            signal,
          });
          let acc = '';
          for await (const _ of stream) {
            // 已通过 onChunk 累积到 task.progress
          }
          // 取最终 progress 作 result
          const finalTask = get().tasks.find((t) => t.label.includes(`${f1.name} ↔ ${f2.name}`));
          acc = finalTask?.progress ?? '';
          return acc;
        },
        onSuccess: async () => {
          toast.success(`对拍完成：${f1.name} ↔ ${f2.name}`);
        },
      });
    },

    enqueueHackCase: (opts) => {
      const st = get();
      if (st.aiConfig.ollamaMode === 'disabled') {
        toast.warning('Hack Case 需要 Ollama 模式', {
          description: '这是 AC 后本地挑战功能；可在「设置」顶部开启 Ollama 模式后使用',
        });
        return null;
      }
      if (!st.activeProblemId) {
        toast.error('请先激活一道题目');
        return null;
      }
      if (!hasUsableAIConfig(st.aiConfig)) {
        toast.error('请先配置 AI 服务');
        set({ settingsOpen: true });
        return null;
      }
      const problem = st.problems.find((p) => p.id === st.activeProblemId);
      if (!problem) return null;
      const scopeKey = problem.id;
      const fileId = st.activeFileIdByScope[scopeKey];
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file || (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python')) {
        toast.error('当前活跃文件不是代码文件');
        return null;
      }
      // 防重：同题已有 in-flight 的 hack-case 任务则不再排队
      const existing = st.tasks.find(
        (t) =>
          t.kind === 'hack-case' &&
          (t.status === 'queued' || t.status === 'running') &&
          t.label.endsWith(`· ${problem.title}`),
      );
      if (existing) return existing.id;

      const samples = (problem.examples ?? [])
        .filter((ex) => ex.input && ex.output)
        .map((ex) => ({ input: ex.input, output: ex.output }));

      get().recordAgentTrace({
        kind: 'decide',
        level: 'info',
        title: '主动出 hack case',
        detail: `检测样例已通过 / 学生触发：${opts?.reason ?? 'manual'}\n题目：${problem.title}`,
        problemId: problem.id,
      });

      return enqueue(
        'hack-case',
        `主动出 hack case · ${problem.title}`,
        {
          run: (onChunk, onRetry, signal) =>
            get().coach.generateHackCase(
              {
                problem,
                code: file.content,
                language: langOfFile(file.language),
                passedSamples: samples,
              },
              { onChunk, onRetry, signal },
            ),
          onSuccess: async (result) => {
            const r = result as {
              stdin: string;
              expectedOutput?: string;
              rationale: string;
              severity: 'edge' | 'large' | 'degenerate' | 'tricky';
            };
            if (!r.stdin?.trim()) {
              toast.warning('Coach 没生成有效 hack case，可以再试一次');
              return;
            }
            set({
              pendingHackCase: {
                problemId: problem.id,
                fileId: file.id,
                stdin: r.stdin,
                expectedOutput: r.expectedOutput,
                rationale: r.rationale,
                severity: r.severity,
                createdAt: Date.now(),
              },
            });
            get().recordAgentTrace({
              kind: 'act',
              level: 'success',
              title: `已生成 hack case（${r.severity}）`,
              detail: `理由：${r.rationale}\nstdin:\n${r.stdin.slice(0, 240)}`,
              problemId: problem.id,
            });
            toast.message('Coach 给你出了一个 hack case', {
              description: r.rationale.slice(0, 60),
              duration: 5000,
            });
          },
          onFailure: (err) => {
            get().recordAgentTrace({
              kind: 'act',
              level: 'error',
              title: 'hack case 生成失败',
              detail: err.message,
              problemId: problem.id,
            });
          },
        },
        { problemId: problem.id, fileId: file.id, reason: opts?.reason },
      );
    },

    /**
     * Hack Chain：4-agent 严格链式编排。
     *
     * 流程：
     *   1. Attacker(LLM)：分析代码 + 题目约束 → 给 1-3 个候选攻击 case
     *   2. Executor(本地沙箱)：挨个跑用户代码 → 找出第一个能 hack 成功的
     *   3. Explainer(LLM)：基于 1+2 的输出 → 给学生听得懂的归因
     *   4. FixSuggestor(LLM)：基于 1+2+3 → 给方向（不直接给答案）
     *
     * 关键设计：
     *   - 每一步进 agentTrace（perceive/decide/act/feedback），UI 可重放
     *   - 任意一步失败后续 skip，不破坏整链
     *   - Executor 没 hack 成功（用户代码都过了）→ 后续 skip，照样上报"无法 hack"
     *   - 与 enqueueHackCase 共存：用户可选老的"快出 1 个"或新的"完整链路"
     */
    runHackChain: async (opts) => {
      const st = get();
      // Hack Chain 与无 Ollama 模式兼容：Attacker/Explainer/FixSuggestor 走主云端，
      // Executor 是本地沙箱（pyodide / Wandbox），与 Ollama 无关。
      if (!st.activeProblemId) {
        toast.error('请先激活一道题目');
        return;
      }
      const problem = st.problems.find((p) => p.id === st.activeProblemId);
      if (!problem) return;
      const scopeKey = problem.id;
      const fileId = st.activeFileIdByScope[scopeKey];
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file || (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python')) {
        toast.error('当前活跃文件不是可执行代码');
        return;
      }
      const blockReason = getHackChainBlockReason(problem, file, st.lastRunByScope[scopeKey]);
      if (blockReason) {
        toast.error(blockReason);
        return;
      }
      if (!hasUsableAIConfig(st.aiConfig)) {
        toast.error('请先配置 AI 服务');
        set({ settingsOpen: true });
        return;
      }
      // 防重：已有 chain 在跑则不再启动
      if (st.hackChainState && !st.hackChainState.result) {
        toast.message('Hack Chain 正在跑，请等本次结束');
        return;
      }

      const startedAt = Date.now();
      const ctx: HackChainContext = {
        problem,
        code: file.content,
        language: langOfFile(file.language),
        passedSamples: (problem.examples ?? [])
          .filter((ex) => ex.input && ex.output)
          .map((ex) => ({ input: ex.input, output: ex.output })),
      };
      const initialSteps: HackChainStepState[] = [
        { step: 'attacker', status: 'idle' },
        { step: 'executor', status: 'idle' },
        { step: 'explainer', status: 'idle' },
        { step: 'fixSuggestor', status: 'idle' },
      ];
      set({
        hackChainState: {
          problemId: problem.id,
          fileId: file.id,
          startedAt,
          steps: initialSteps,
          result: null,
        },
      });

      /** 改某个 step 状态的 helper（不可变更新） */
      const patchStep = (
        step: HackChainStep,
        patch: Partial<HackChainStepState>,
      ) => {
        const cur = get().hackChainState;
        if (!cur) return;
        set({
          hackChainState: {
            ...cur,
            steps: cur.steps.map((s) => (s.step === step ? { ...s, ...patch } : s)),
          },
        });
      };

      // 步骤标题映射，让 trace 标题和 agentName 对得上 inferAgentName 的关键字
      const stepTitle: Record<HackChainStep, string> = {
        attacker: '[1/4] Hack Chain · Attacker',
        executor: '[2/4] Hack Chain · Executor',
        explainer: '[3/4] Hack Chain · Explainer',
        fixSuggestor: '[4/4] Hack Chain · FixSuggestor',
      };
      const stepAgent: Record<HackChainStep, AgentName> = {
        attacker: 'HackChain/Attacker',
        executor: 'HackChain/Executor',
        explainer: 'HackChain/Explainer',
        fixSuggestor: 'HackChain/FixSuggestor',
      };

      // 执行编排（纯函数），副作用通过 observer 注入回 store
      const result = await orchestrateHackChain(ctx, {
        generateAttacker: (c) => get().coach.generateHackAttacker(c),
        generateExplanation: (a) => get().coach.generateHackExplanation(a),
        generateFixSuggestion: (a) => get().coach.generateHackFixSuggestion(a),
        runCode: async (code, stdin, language): Promise<SandboxRunResult> => {
          if (language === 'python') {
            return runPython(code, stdin, { timeoutMs: 5000 });
          }
          return runCpp(code, stdin, {
            timeoutMs: 8000,
            language: language === 'c' ? 'c' : 'cpp',
          });
        },
        observer: {
          onStepStart: (step, ts) => {
            patchStep(step, { status: 'running', startedAt: ts });
            get().recordAgentTrace({
              kind: 'perceive',
              level: 'info',
              title: `${stepTitle[step]} · 输入`,
              detail:
                step === 'attacker'
                  ? `题目：${problem.title}\n代码 ${ctx.code.length} 字 · ${ctx.language}\n样例：${ctx.passedSamples?.length ?? 0} 个`
                  : step === 'executor'
                    ? '挨个跑 Attacker 给的候选 case'
                    : `基于上一步输出（含 winning case）`,
              problemId: problem.id,
              agentName: stepAgent[step],
              route: step === 'executor' ? 'fast' : 'cloud',
            });
          },
          onStepSuccess: (step, ts) => {
            patchStep(step, { status: 'success', endedAt: ts });
          },
          onStepFailed: (step, ts, error) => {
            patchStep(step, { status: 'failed', endedAt: ts, error });
            get().recordAgentTrace({
              kind: 'feedback',
              level: 'error',
              title: `${stepTitle[step]} · 失败`,
              detail: error,
              problemId: problem.id,
              agentName: stepAgent[step],
            });
          },
          onStepSkipped: (step) => patchStep(step, { status: 'skipped' }),
          onAttackerOutput: (out) => {
            get().recordAgentTrace({
              kind: 'feedback',
              level: 'success',
              title: `${stepTitle.attacker} · 输出 ${out.candidates.length} 个候选`,
              detail: `假设：${out.hypothesis}\n${out.candidates
                .map((c, i) => `${i + 1}. [${c.kind}] ${c.description}`)
                .join('\n')}`,
              problemId: problem.id,
              agentName: stepAgent.attacker,
            });
          },
          onExecutorProgress: () => {
            // 暂不每条上 trace（避免噪音）；最后总结一条
          },
          onExplainerOutput: (out) => {
            get().recordAgentTrace({
              kind: 'feedback',
              level: 'success',
              title: `${stepTitle.explainer} · 输出`,
              detail: `${out.diagnosis}\n根因：${out.rootCause}`,
              problemId: problem.id,
              agentName: stepAgent.explainer,
            });
          },
          onFixSuggestorOutput: (out) => {
            get().recordAgentTrace({
              kind: 'act',
              level: 'success',
              title: `${stepTitle.fixSuggestor} · 输出`,
              detail: `方向：${out.direction}\n提示：${out.hint}\n概念：${out.conceptKeywords.join(' / ')}`,
              problemId: problem.id,
              agentName: stepAgent.fixSuggestor,
            });
          },
        },
      });

      // Executor 整体反馈条（一次性总结所有 case 结果）
      if (result.executor) {
        const winFound = result.executor.winningIndex !== null;
        get().recordAgentTrace({
          kind: 'feedback',
          level: winFound ? 'success' : 'warn',
          title: winFound
            ? `${stepTitle.executor} · hack 成功 (case #${(result.executor.winningIndex ?? 0) + 1})`
            : `${stepTitle.executor} · 未能 hack（用户代码全过）`,
          detail: result.executor.results
            .map(
              (r, i) =>
                `${i + 1}. exit ${r.exitCode} · ${r.durationMs}ms · ${
                  r.hacked ? '✗ hacked' : '✓ ok'
                }${r.reason ? ` (${r.reason})` : ''}`,
            )
            .join('\n'),
          problemId: problem.id,
          agentName: stepAgent.executor,
          route: 'fast',
        });
      }

      // 合并最终结果到 store
      const cur = get().hackChainState;
      set({
        hackChainState: cur && {
          ...cur,
          result,
        },
      });

      // toast 友好反馈
      const noHack = result.executor && result.executor.winningIndex === null;
      toast.message('Hack Chain 完成', {
        description: result.attacker
          ? noHack
            ? `Attacker 提了 ${result.attacker.candidates.length} 个候选 case，全被挡掉 — 鲁棒性不错！`
            : (result.explainer?.diagnosis ?? '攻击成功；查看时间线')
          : 'Attacker 失败，查看时间线了解原因',
        duration: 6000,
      });
      void opts;
    },

    cancelTask: (id) => {
      // 已 running → 走 AbortController；catch 分支会把 task 状态打成 'cancelled'
      const ctrl = abortersById.get(id);
      if (ctrl) {
        ctrl.abort();
        return;
      }
      // queued（还没轮到执行）→ 直接打成 cancelled，并丢弃 handler 引用
      // 之前这里只 abort 不处理 queued，用户点"取消"后任务会一直挂在 queued。
      const t = get().tasks.find((x) => x.id === id);
      if (!t || (t.status !== 'queued' && t.status !== 'running')) return;
      handlersById.delete(id);
      const now = Date.now();
      set((s) => ({
        tasks: s.tasks.map((x) =>
          x.id === id
            ? { ...x, status: 'cancelled', finishedAt: now, error: '已取消' }
            : x,
        ),
      }));
    },

    retryTask: (id) => {
      const handler = handlersById.get(id);
      if (!handler) {
        toast.error('任务已被清除，无法重试');
        return;
      }
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                status: 'queued',
                progress: '',
                error: undefined,
                retryAttempt: undefined,
                retryReason: undefined,
                startedAt: undefined,
                finishedAt: undefined,
                durationMs: undefined,
              }
            : t,
        ),
      }));
      setTimeout(tick, 0);
    },

    clearFinishedTasks: () => {
      // 同步清掉 closure map 里的 handler 和流式预览，避免内存泄漏。
      // 之前这里只过滤 tasks 数组，handlersById / streamPreviewById 永远累积。
      const tasks = get().tasks;
      const removedIds = tasks
        .filter((t) => t.status !== 'queued' && t.status !== 'running')
        .map((t) => t.id);
      for (const id of removedIds) {
        handlersById.delete(id);
        // abortersById 在 runTask finally 里已经 delete，这里兜底
        abortersById.delete(id);
      }
      set((s) => {
        const nextPreview = { ...s.streamPreviewById };
        for (const id of removedIds) delete nextPreview[id];
        return {
          tasks: s.tasks.filter((t) => t.status === 'queued' || t.status === 'running'),
          streamPreviewById: nextPreview,
        };
      });
    },

    deleteProblem: async (id) => {
      // 删题目时同步把它的所有 file 也删了
      const st = get();
      const files = st.filesByScope[id] ?? [];
      await Promise.all(files.map((f) => storage.deleteFile(f.id)));
      await storage.deleteProblem(id);
      set((s) => {
        const nextFiles = { ...s.filesByScope };
        delete nextFiles[id];
        const nextActive = { ...s.activeFileIdByScope };
        delete nextActive[id];
        return {
          activeProblemId: s.activeProblemId === id ? null : s.activeProblemId,
          filesByScope: nextFiles,
          activeFileIdByScope: nextActive,
        };
      });
      await get().refreshProblems();
    },
    toggleArchiveProblem: async (id) => {
      const st = get();
      const p = st.problems.find((x) => x.id === id);
      if (!p) return;
      const updated = { ...p, archivedAt: p.archivedAt ? undefined : Date.now() };
      await storage.saveProblem(updated);
      // 直接 patch store；归档/取消归档不影响 activeProblemId（用户即使在编辑某题归档它，仍可继续编辑）
      set((s) => ({
        problems: s.problems.map((x) => (x.id === id ? updated : x)),
      }));
    },
    deleteMistake: async (id) => {
      await storage.deleteMistake(id);
      await get().refreshMistakes();
    },
    markMistakeReviewed: async (id) => {
      // 先从 store 取（避免 storage 异步不一致 + 测试场景兼容）
      let m = get().mistakes.find((x) => x.id === id);
      if (!m) m = await storage.getMistake(id);
      if (!m) return;
      const updated: Mistake = {
        ...m,
        reviewedAt: Date.now(),
        reviewCount: (m.reviewCount ?? 0) + 1,
      };
      await storage.saveMistake(updated);
      // 直接 patch store 立刻反映（不靠 refreshMistakes 重新拉一遍）
      set((s) => ({
        mistakes: s.mistakes.map((x) => (x.id === id ? updated : x)),
      }));
    },

    setSidebarTab: (t) => set({ sidebarTab: t }),
    setSettingsOpen: (v) => set({ settingsOpen: v }),
    setProblemEditorOpen: (v) => set({ problemEditorOpen: v }),
    setProblemBrowserOpen: (v) => set({ problemBrowserOpen: v }),

    askQuestion: async (question) => get().askCoach({ text: question, source: 'manual' }),

    abortCoach: () => {
      // 直接 try abort；非 null 才生效。
      // ref 在 askCoach 的 finally 里会被清回 null，这里不动。
      coachAbortRef.current?.abort();
    },

    retryLastCoach: async (scope) => {
      const st = get();
      if (st.qaPendingProblemId === scope) return; // 还在流式中，先停再重答
      const list = st.qaByProblem[scope] ?? [];
      // 从后往前找最近一条 user，然后把它之后的 assistant message（最多 1 条）丢掉
      let lastUserIdx = -1;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].role === 'user') {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx < 0) return;
      const lastUser = list[lastUserIdx];
      const trimmed = list.slice(0, lastUserIdx); // 不含旧 user / 旧 assistant
      set((s) => ({
        qaByProblem: { ...s.qaByProblem, [scope]: trimmed },
      }));
      // 复用 askCoach 主路径；source 用 'manual' 即可（重答场景不需要原 source 信号）
      await get().askCoach({ text: lastUser.content, source: 'manual' });
    },

    askCoach: async (input) => {
      const trimmed = input.text.trim();
      if (!trimmed) return;
      const s = get();
      if (!hasUsableAIConfig(s.aiConfig)) {
        toast.error('请先配置 AI 服务（baseUrl + apiKey + model）');
        s.setSettingsOpen(true);
        return;
      }
      // scope: 当前激活题目 id，否则用 DRAFT_SCOPE
      const scope = s.activeProblemId ?? DRAFT_SCOPE;
      const problem = s.activeProblemId
        ? s.problems.find((p) => p.id === s.activeProblemId)
        : undefined;
      const files = s.filesByScope[scope] ?? [];
      const activeFileId = s.activeFileIdByScope[scope];
      const file = files.find((f) => f.id === activeFileId) ?? files[0];
      const code = file?.content ?? '';
      const language: Lang = langOfFile(file?.language ?? 'cpp');
      const runSnap = get().lastRunByScope[scope];
      const runtimeContext =
        runSnap &&
        file &&
        runSnap.fileId === file.id &&
        Date.now() - runSnap.timestamp < 30 * 60 * 1000
          ? {
              exitCode: runSnap.exitCode,
              stdin: runSnap.stdin,
              stdout: runSnap.stdout,
              stderr: runSnap.stderr,
              durationMs: runSnap.durationMs,
              timestamp: runSnap.timestamp,
            }
          : undefined;
      const idleSeconds = Math.max(0, Math.round((Date.now() - s.lastEditAt) / 1000));
      const sessionsForProblem = problem
        ? s.sessions.filter((sn) => sn.problemId === problem.id)
        : [];
      const acCount = sessionsForProblem.filter((sn) => sn.outcome === 'pass').length;
      const sessionWrongCount = sessionsForProblem.filter((sn) => sn.outcome === 'mistake').length;
      const mistakesForProblem = problem
        ? s.mistakes.filter((m) => m.problemId === problem.id)
        : [];
      const wrongCount = sessionWrongCount + mistakesForProblem.length;
      const inMistakeBook = mistakesForProblem.some((m) => !m.reviewedAt);
      const cachedAnalysis = s.analysisByProblem[scope];
      const unresolvedIssueCount =
        cachedAnalysis &&
        file &&
        (!cachedAnalysis.fileId || cachedAnalysis.fileId === file.id) &&
        (!cachedAnalysis.codeHash || cachedAnalysis.codeHash === codeHash(file.content))
          ? cachedAnalysis.issues.length
          : 0;
      const behavior = {
        idleSeconds,
        acCount,
        wrongCount,
        inMistakeBook,
        unresolvedIssueCount,
      };
      const route = await routeCoachRequest(
        {
          text: trimmed,
          source: input.source,
          hasProblem: !!problem,
          hasSelection: !!input.selection?.text.trim(),
          codeLength: code.length,
          codeLineCount: code ? code.split('\n').length : 0,
          lastRun: runtimeContext
            ? { exitCode: runtimeContext.exitCode, stderrBrief: runtimeContext.stderr?.slice(-500) }
            : undefined,
          recentAction: runtimeContext ? (runtimeContext.exitCode === 0 ? 'run_ok' : 'run_failed') : undefined,
          behavior,
        },
        createIntentRouterClient(s.aiConfig),
      );

      const userMsg: QAMessage = {
        id: nanoid(),
        role: 'user',
        content: trimmed,
        ts: Date.now(),
      };
      const assistMsg: QAMessage = {
        id: nanoid(),
        role: 'assistant',
        content: '',
        ts: Date.now(),
        streaming: true,
        route,
      };

      set((st) => ({
        qaByProblem: {
          ...st.qaByProblem,
          [scope]: [...(st.qaByProblem[scope] ?? []), userMsg, assistMsg],
        },
        qaPendingProblemId: scope,
        feedbackTab: 'ask',
        coachDraft: null,
      }));

      const history = (get().qaByProblem[scope] ?? [])
        .slice(0, -2)
        .map((m) => ({ role: m.role, content: m.content }));

      // 流式可中断：每次 askCoach 启动时新建一个 AbortController；
      // 用户在 UI 点"停止"会调 abortCoach() → ctrl.abort() → fetch 中断 → catch 走 abort 分支。
      const ctrl = new AbortController();
      coachAbortRef.current = ctrl;

      try {
        if (
          route.outputMode === 'chat_with_inline_issues' &&
          file &&
          (file.language === 'cpp' || file.language === 'c' || file.language === 'python')
        ) {
          const quickPrelude = formatInlineCoachPrelude(route);
          set((st) => {
            const list = st.qaByProblem[scope] ?? [];
            const idx = list.findIndex((m) => m.id === assistMsg.id);
            if (idx < 0) return st;
            const next = list.slice();
            next[idx] = {
              ...next[idx],
              content: `${quickPrelude}\n\n_已开始后台代码审查…_`,
            };
            return { qaByProblem: { ...st.qaByProblem, [scope]: next } };
          });
          const events = await storage.listEvents({ sessionId, limit: 200 });
          const profile: LearnerProfile = buildLearnerProfile({
            sessions: get().sessions,
            problems: get().problems,
            mistakes: get().mistakes,
            events,
            currentProblemTags: problem?.tags,
          });
          const analysisHistory: AnalysisHistoryEntry[] = events
            .filter(
              (e) =>
                e.problemId === problem?.id &&
                (e.type === 'analysis' || e.type === 'manual_analyze'),
            )
            .slice(-2)
            .map((e) => {
              const p = e.payload as any;
              return {
                ts: e.ts,
                reason: p?.reason ?? 'coach',
                issuesSnapshot: p?.issuesSnapshot ?? [],
                overallComment: p?.overallComment,
                codeHash: p?.codeHash,
                codeLineCount: p?.codeLineCount,
              };
            });
          const siblings = files
            .filter((f) => f.id !== file.id && f.content.trim().length > 0)
            .slice(0, 5)
            .map((f) => ({ name: f.name, language: f.language, content: f.content }));
          // P3 escalation：同 analyze 入口共用屡败逻辑（7 天滑窗 + 阈值常量）
          const rawStats2 = problem
            ? get().failureStatsByProblem[problem.id]
            : undefined;
          const failureStats = rawStats2 ? pruneFailureStats(rawStats2) : undefined;
          const escalation =
            failureStats && failureStats.count >= FAILURE_STATS_ESCALATE_THRESHOLD
              ? {
                  failureCount: failureStats.count,
                  recentVerdicts: failureStats.recentVerdicts,
                }
              : undefined;
          // AST-Light 结构特征（本地纯逻辑 Agent）
          let astFeatures2: CodeStructFeatures | undefined;
          try {
            astFeatures2 = extractFeatures(file.content, language);
          } catch {
            astFeatures2 = undefined;
          }
          if (astFeatures2 && (astFeatures2.redFlags.length > 0 || astFeatures2.loops > 0)) {
            const redFlagDetail =
              astFeatures2.redFlags.length > 0
                ? '\n- ' + astFeatures2.redFlags.map((r) => r.hint).join('\n- ')
                : '';
            get().recordAgentTrace({
              kind: 'perceive',
              level: astFeatures2.redFlags.length > 0 ? 'warn' : 'info',
              title: `AST-Light · 结构信号（本地）`,
              detail: `复杂度估计：${astFeatures2.complexityHint}\n循环 ${astFeatures2.loops} · 嵌套 ${astFeatures2.maxNestingDepth} · 红旗 ${astFeatures2.redFlags.length}${redFlagDetail}`,
              problemId: problem?.id,
              agentName: 'AstDiff',
            });
          }
          const result = await get().coach.analyzeCode(
            {
              problem,
              code: file.content,
              language,
              profile,
              history: analysisHistory,
              siblings,
              runtimeContext,
              escalation,
              astFeatures: astFeatures2,
            },
            {
              onChunk: (_delta, accumulated) => {
                const tokens = accumulated.length;
                const phase =
                  tokens < 200
                    ? '正在读题…'
                    : tokens < 800
                      ? '正在比对样例与代码…'
                      : tokens < 2000
                        ? '正在生成行内批注…'
                        : '正在收尾…';
                set((st) => {
                  const list = st.qaByProblem[scope] ?? [];
                  const idx = list.findIndex((m) => m.id === assistMsg.id);
                  if (idx < 0) return st;
                  const next = list.slice();
                  next[idx] = {
                    ...next[idx],
                    content: `${quickPrelude}\n\n---\n\n${phase}\n\n_行内批注生成中 · 已生成 ${tokens} 字_`,
                  };
                  return { qaByProblem: { ...st.qaByProblem, [scope]: next } };
                });
              },
            },
          );
          const stamped: AnalysisResult = {
            ...result,
            fileId: file.id,
            codeHash: codeHash(file.content),
            analyzedAt: Date.now(),
          };
          set((st) => ({
            analysisByProblem: { ...st.analysisByProblem, [scope]: stamped },
          }));
          await storage.appendEvent({
            ts: Date.now(),
            sessionId,
            problemId: problem?.id,
            type: 'manual_analyze',
            payload: {
              reason: 'coach',
              fileId: file.id,
              fileName: file.name,
              issueCount: stamped.issues.length,
              issuesSnapshot: stamped.issues.map((i) => ({
                line: i.line,
                severity: i.severity,
                category: i.category,
                message: i.message,
              })),
              overallComment: stamped.overallComment,
              codeHash: codeHash(file.content),
              codeLineCount: file.content.split('\n').length,
            },
          });
          set((st) => {
            const list = st.qaByProblem[scope] ?? [];
            const idx = list.findIndex((m) => m.id === assistMsg.id);
            if (idx < 0) return st;
            const next = list.slice();
            next[idx] = {
              ...next[idx],
              content: `${quickPrelude}\n\n---\n\n${formatAnalysisAsCoachMessage(stamped)}`,
              streaming: false,
            };
            return {
              qaByProblem: { ...st.qaByProblem, [scope]: next },
              qaPendingProblemId: null,
            };
          });
          return;
        }
        const context = buildCoachContext({
          route,
          userText: trimmed,
          problem,
          code,
          language,
          fileName: file?.name,
          selection: input.selection,
          lastRun: runtimeContext,
          behavior,
        });
        await get().coach.askCoach(
          {
            problem,
            code,
            route,
            context,
            userText: trimmed,
            history,
          },
          {
            signal: ctrl.signal,
            onChunk: (_delta, accumulated) => {
              set((st) => {
                const list = st.qaByProblem[scope] ?? [];
                const idx = list.findIndex((m) => m.id === assistMsg.id);
                if (idx < 0) return st;
                const next = list.slice();
                next[idx] = { ...next[idx], content: accumulated };
                return { qaByProblem: { ...st.qaByProblem, [scope]: next } };
              });
            },
          },
        );
        set((st) => {
          const list = st.qaByProblem[scope] ?? [];
          const idx = list.findIndex((m) => m.id === assistMsg.id);
          if (idx < 0) return st;
          const next = list.slice();
          next[idx] = { ...next[idx], streaming: false };
          return {
            qaByProblem: { ...st.qaByProblem, [scope]: next },
            qaPendingProblemId: null,
          };
        });
      } catch (e: any) {
        const isAbort = e?.name === 'AbortError' || ctrl.signal.aborted;
        const msg = String(e?.message ?? e);
        set((st) => {
          const list = st.qaByProblem[scope] ?? [];
          const idx = list.findIndex((m) => m.id === assistMsg.id);
          if (idx < 0) return st;
          const next = list.slice();
          // abort 分支：保留已收到的部分内容，标记成"已停止"，不视为错误
          // 普通失败：保留 error 字段供 UI 展示
          next[idx] = isAbort
            ? {
                ...next[idx],
                streaming: false,
                content:
                  (next[idx].content ? next[idx].content + '\n\n' : '') + '_（已停止生成）_',
              }
            : {
                ...next[idx],
                streaming: false,
                error: msg,
                content: next[idx].content || '（AI 调用失败）',
              };
          return {
            qaByProblem: { ...st.qaByProblem, [scope]: next },
            qaPendingProblemId: null,
          };
        });
        if (!isAbort) toast.error('AI 提问失败', { description: msg });
      } finally {
        // 清 ref，避免悬挂引用让下次的 abortCoach 误中已经结束的 controller
        if (coachAbortRef.current === ctrl) coachAbortRef.current = null;
      }
    },

    clearQA: (scope) => {
      set((st) => {
        const next = { ...st.qaByProblem };
        delete next[scope];
        return { qaByProblem: next };
      });
    },
    setCmdPaletteOpen: (v) => set({ cmdPaletteOpen: v }),
    setSubmitModalOpen: (v) => set({ submitModalOpen: v }),
    setRuntimePaneOpen: (v) => {
      safeSetItem('aicc.runtimePane.v1', v ? 'on' : 'off');
      set({ runtimePaneOpen: v });
    },

    // ───── 卡住检测 ─────
    markEdit: () => set({ lastEditAt: Date.now() }),
    setStuckHintEnabled: (v) => {
      safeSetItem('aicc.stuckHint.v1', v ? 'on' : 'off');
      set({ stuckHintEnabled: v });
    },
    dismissHint: () => set({ currentHint: null }),
    enqueueStuckHint: () => {
      const st = get();
      if (!hasUsableAIConfig(st.aiConfig) || !st.activeProblemId) return null;
      const problem = st.problems.find((p) => p.id === st.activeProblemId);
      if (!problem) return null;
      const fileId = st.activeFileIdByScope[st.activeProblemId];
      const file = (st.filesByScope[st.activeProblemId] ?? []).find((f) => f.id === fileId);
      if (!file) return null;
      if (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python') return null;
      // 已有 Coach 流式回答时不打扰
      if (st.qaPendingProblemId) return null;
      set({ lastHintAt: Date.now() });
      void get().askCoach({
        text: '我有点卡住了，帮我点拨一下下一步该想什么',
        source: 'stuck',
      });
      return null;
    },

    // ───── 框选问 AI / FeedbackPanel tab ─────
    setAskPrefill: (s) => set({ askPrefill: s }),
    setCoachDraft: (s) => set({ coachDraft: s }),
    setFeedbackTab: (t) => set({ feedbackTab: t }),

    // ───── Onboarding ─────
    startOnboarding: async () => {
      // 注入 Two Sum demo 题 + 故意 bug 代码
      const problemId = '__onboarding_two_sum__';
      const fileId = '__onboarding_main__';
      const now = Date.now();
      const demoProblem: Problem = {
        id: problemId,
        title: '两数之和（入门）',
        statement:
          '给定整数数组 nums 和目标 target，找出使得它们之和等于 target 的两个不同下标 i, j（i < j），输出 i 和 j。\n如果有多组解，输出任意一组即可。',
        constraints: '2 ≤ n ≤ 1000\n-10⁹ ≤ nums[i] ≤ 10⁹\n保证至少有一组解',
        examples: [
          { input: '4 9\n2 7 11 15', output: '0 1', explanation: 'nums[0]+nums[1] = 2+7 = 9' },
        ],
        tags: ['数组', '入门'],
        difficulty: 'easy',
        createdAt: now,
      };
      // 故意有 bug 的初始代码：j <= n 越界
      const buggyCode = `#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n, target;
    cin >> n >> target;
    vector<int> nums(n);
    for (int i = 0; i < n; i++) cin >> nums[i];

    // 暴力枚举所有 (i, j) 对
    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j <= n; j++) {  // ← bug 在这里
            if (nums[i] + nums[j] == target) {
                cout << i << " " << j << endl;
                return 0;
            }
        }
    }
    return 0;
}
`;
      await storage.saveProblem(demoProblem);
      set((st) => ({
        problems: [demoProblem, ...st.problems.filter((p) => p.id !== problemId)],
        activeProblemId: problemId,
        filesByScope: {
          ...st.filesByScope,
          [problemId]: [
            {
              id: fileId,
              problemId,
              name: 'main.cpp',
              language: 'cpp',
              content: buggyCode,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        activeFileIdByScope: { ...st.activeFileIdByScope, [problemId]: fileId },
        sidebarTab: null,
        feedbackTab: 'analyze',
        onboardingStep: 'wait-analyze',
      }));
      toast.info('👋 跟我做一遍 Two Sum，3 步看完核心流程', {
        description: '点高亮的「问教练」按钮，AI 会自动检查这段代码',
        duration: 5000,
      });
    },

    advanceOnboarding: (to) => set({ onboardingStep: to }),

    finishOnboarding: () => {
      safeSetItem('aicc.onboarding.v1', 'done');
      set({ onboardingStep: 'idle' });
    },

    // ───── Learning Engine ─────
    refreshLearningEngine: () => {
      const st = get();
      const { overview, cards } = buildLearningEngine({
        mistakes: st.mistakes,
        problems: st.problems,
        sessions: st.sessions,
        bank: PROBLEM_BANK,
      });
      set({ learningOverview: overview, learningCards: cards });
    },

    dismissLearningCard: () => {
      const t = today();
      safeSetItem('aicc.learning.dismissed.v1', t);
      set({ learningCardDismissedDate: t });
    },

    dismissDailyReview: () => {
      const t = today();
      safeSetItem('aicc.dailyReview.dismissed.v1', t);
      set({ dailyReviewDismissedDate: t });
    },

    /**
     * B 路线核心：学习规划 Agent 的 3 步编排器。
     *
     * 这是项目的"创新性 20%"主打：真正的 multi-agent 协作（不是单 LLM 多张脸）。
     *
     * 流程：
     *   [1/3] 学情诊断 Agent (cloud)：分析数据 → 薄弱点
     *   [2/3] 题目筛选 Agent (本地纯逻辑)：薄弱点 + 题库/错题 → 候选
     *   [3/3] 计划编排 Agent (cloud)：诊断 + 候选 → 最终今日学习路径
     *
     * 每一步都进 AgentTracePanel，让评委能看到"AI 内部协作流程"。
     */
    requestDailyPlan: async (opts = {}) => {
      const st = get();
      const dateStr = today();
      // 缓存 hit
      if (!opts.force && st.dailyPlan?.date === dateStr) return;
      // 没配 AI 不打扰
      const needsKey = st.aiConfig.provider !== 'ollama';
      if (needsKey && !st.aiConfig.apiKey) return;
      if (st.dailyPlanGenerating) return; // 已经在生成
      set({ dailyPlanGenerating: true });

      get().recordAgentTrace({
        kind: 'decide',
        level: 'info',
        title: '🤖 学习规划 Agent 启动（3 步编排）',
        detail: '将依次调用：学情诊断 Agent → 题目筛选 Agent → 计划编排 Agent',
      });

      try {
        // 收集 stats
        const now = Date.now();
        const DAY = 24 * 60 * 60 * 1000;
        const recentMistakes = st.mistakes
          .slice(0, 8)
          .map((m) => ({
            title: m.problemTitle,
            category: m.category,
            rootCause: m.rootCause,
            verdict: m.verdict,
            daysAgo: Math.max(0, Math.floor((now - m.createdAt) / DAY)),
          }));
        const weekSessions = st.sessions.filter((s) => now - s.startedAt < 7 * DAY);
        const totalSubmissions = weekSessions.length;
        const acRate =
          totalSubmissions === 0
            ? 0
            : weekSessions.filter((s) => s.outcome === 'pass').length / totalSubmissions;
        const avgSessionMinutes =
          totalSubmissions === 0
            ? 0
            : weekSessions
                .map((s) => ((s.endedAt ?? s.startedAt) - s.startedAt) / 60000)
                .reduce((a, b) => a + b, 0) / totalSubmissions;
        const stuckProblems = Object.entries(st.failureStatsByProblem)
          .map(([pid, v]) => [pid, pruneFailureStats(v)] as const)
          .filter(([, v]) => v.count >= FAILURE_STATS_ESCALATE_THRESHOLD)
          .map(([pid, v]) => ({
            title: st.problems.find((p) => p.id === pid)?.title ?? '(未知题)',
            failureCount: v.count,
            verdicts: v.recentVerdicts.slice(),
          }));

        // 跑编排（纯函数），副作用通过 observer 注入回 store
        const result = await orchestrateDailyPlan(
          {
            diagnosisInput: {
              recentMistakes,
              weekStats: {
                totalProblems: weekSessions.filter((s) => !!s.problemId).length,
                totalSubmissions,
                acRate,
                avgSessionMinutes,
              },
              stuckProblems,
            },
            candidateContext: {
              mistakes: st.mistakes,
              alreadyAdded: st.problems,
              bank: PROBLEM_BANK,
              now,
            },
          },
          {
            generateDiagnosis: (input) => st.coach.generateLearningDiagnosis(input),
            pickCandidates: (input) =>
              pickPlanCandidates(input as Parameters<typeof pickPlanCandidates>[0]),
            generatePlan: (args) => st.coach.generatePlanOrchestration(args),
            observer: {
              onDiagnosisInput: (input) => {
                get().recordAgentTrace({
                  kind: 'perceive',
                  level: 'info',
                  title: '[1/3] 学情诊断 Agent · 输入',
                  detail: `近期错题 ${input.recentMistakes.length} 条 · 7 天 ${input.weekStats.totalSubmissions} 次提交（AC率 ${(input.weekStats.acRate * 100).toFixed(0)}%）· 屡败题目 ${input.stuckProblems.length} 条`,
                });
              },
              onDiagnosisOutput: (out) => {
                get().recordAgentTrace({
                  kind: 'feedback',
                  level: 'success',
                  title: `[1/3] 学情诊断 Agent · 输出`,
                  detail: `薄弱：${out.weakConcepts.join(' / ')}\n强项：${out.strengths.join(' / ') || '（无）'}\n${out.todayFocus}`,
                });
              },
              onDiagnosisFailed: (reason) => {
                get().recordAgentTrace({
                  kind: 'feedback',
                  level: 'warn',
                  title: '[1/3] 学情诊断 Agent · 失败',
                  detail: `${reason}；编排终止。`,
                });
              },
              onCandidatesOutput: (out) => {
                get().recordAgentTrace({
                  kind: 'decide',
                  level: 'info',
                  title: `[2/3] 题目筛选 Agent (本地) · 输出`,
                  detail: `新题候选 ${out.newProblems.length} 道 · 复习候选 ${out.reviewMistakes.length} 道`,
                });
              },
              onCandidatesEmpty: () => {
                get().recordAgentTrace({
                  kind: 'feedback',
                  level: 'warn',
                  title: '[2/3] 题目筛选 Agent · 候选为空',
                  detail: '题库 + 错题本里没有匹配薄弱点的候选；规划终止。',
                });
              },
              onPlanOutput: (out) => {
                get().recordAgentTrace({
                  kind: 'feedback',
                  level: 'success',
                  title: `[3/3] 计划编排 Agent · 输出`,
                  detail: `${out.headline}\n共 ${out.steps.length} 步 / 估时 ${out.estimatedMinutes} 分钟`,
                });
              },
              onPlanFailed: (reason) => {
                get().recordAgentTrace({
                  kind: 'feedback',
                  level: 'warn',
                  title: '[3/3] 计划编排 Agent · 失败',
                  detail: `${reason}；编排终止。`,
                });
              },
            },
          },
        );

        if (result.status === 'failed') {
          set({ dailyPlanGenerating: false });
          return;
        }

        const plan: DailyPlan = {
          id: nanoid(),
          date: dateStr,
          generatedAt: now,
          diagnosis: result.diagnosis,
          candidates: result.candidates,
          plan: result.plan,
          status: 'pending',
          completedStepIndices: [],
        };
        try {
          safeSetItem('aicc.dailyPlan.v1', JSON.stringify(plan));
        } catch {
          /* ignore quota */
        }
        set({ dailyPlan: plan, dailyPlanGenerating: false });
        get().recordAgentTrace({
          kind: 'act',
          level: 'success',
          title: '🤖 学习规划 Agent 编排完成',
          detail: `今日计划已生成，等待用户决策（接受 / 拒绝 / 重新规划）`,
        });
      } catch (e: any) {
        set({ dailyPlanGenerating: false });
        get().recordAgentTrace({
          kind: 'feedback',
          level: 'error',
          title: '学习规划 Agent · 异常',
          detail: String(e?.message ?? e).slice(0, 240),
        });
      }
    },

    acceptDailyPlan: () =>
      set((s) => {
        if (!s.dailyPlan) return s;
        const next: DailyPlan = {
          ...s.dailyPlan,
          status: 'accepted',
          acceptedAt: Date.now(),
        };
        try {
          safeSetItem('aicc.dailyPlan.v1', JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return { dailyPlan: next };
      }),

    declineDailyPlan: () =>
      set((s) => {
        if (!s.dailyPlan) return s;
        const next: DailyPlan = { ...s.dailyPlan, status: 'declined' };
        try {
          safeSetItem('aicc.dailyPlan.v1', JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return { dailyPlan: next };
      }),

    toggleDailyPlanStep: (stepIndex) =>
      set((s) => {
        if (!s.dailyPlan) return s;
        const cur = s.dailyPlan.completedStepIndices;
        const has = cur.includes(stepIndex);
        const nextIdx = has ? cur.filter((i) => i !== stepIndex) : [...cur, stepIndex];
        const next: DailyPlan = {
          ...s.dailyPlan,
          completedStepIndices: nextIdx,
        };
        try {
          safeSetItem('aicc.dailyPlan.v1', JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return { dailyPlan: next };
      }),

    enqueueOjSubmit: (opts = {}) => {
      const st = get();
      if (!st.activeProblemId) {
        toast.error('请先激活一道从 OJ 导入的题目');
        return null;
      }
      const problem = st.problems.find((p) => p.id === st.activeProblemId);
      if (!problem) return null;
      if (!problem.source || !/^https?:\/\//.test(problem.source)) {
        toast.error('这道题没有原 OJ 链接，请先从油猴脚本推送导入');
        return null;
      }
      const scopeKey = problem.id;
      const fileId = st.activeFileIdByScope[scopeKey];
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file || (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python')) {
        toast.error('当前活跃文件不是可提交代码文件');
        return null;
      }
      const source = inferOjSource(problem.source);
      if (source === 'unknown') {
        toast.error('暂不支持把这道题自动提交回原 OJ');
        return null;
      }
      get().recordAgentTrace({
        kind: 'decide',
        level: 'info',
        title: `下发 OJ 提交命令（${source}）`,
        detail: `目标：${problem.source}\n文件：${file.name}（${file.content.length} 字符）`,
        problemId: problem.id,
      });
      const autoSubmit = opts.autoSubmit === true;
      return enqueue('oj-submit', `${autoSubmit ? 'OJ 提交' : 'OJ 回填'}：${problem.title}`, {
        run: async (onChunk, _onRetry, signal) => {
          onChunk('', `等待油猴脚本接收命令，请保持原 OJ 题目页打开…${autoSubmit ? '' : '（只回填，不自动提交）'}`);
          get().recordAgentTrace({
            kind: 'act',
            level: 'info',
            title: '等待油猴脚本拾取命令',
            problemId: problem.id,
          });
          const result = await submitToOj(
            {
              source,
              targetUrl: problem.source!,
              problemId: problem.id,
              problemTitle: problem.title,
              fileName: file.name,
              language: file.language,
              code: file.content,
              autoSubmit,
            },
            { signal, timeoutMs: 8 * 60_000 },
          );
          if (result.status === 'filled') {
            onChunk('', '代码已回填到原 OJ 编辑器，未自动提交');
            return result;
          }
          if (result.status !== 'done') {
            throw new Error(result.message || 'OJ 自动提交失败');
          }
          onChunk('', `OJ 返回结果：${result.verdict ?? 'OTHER'}`);
          return result;
        },
        onSuccess: async (result) => {
          const r = result as OjSubmitResult;
          if (r.status === 'filled') {
            get().recordAgentTrace({
              kind: 'feedback',
              level: 'success',
              title: 'OJ 代码回填完成',
              detail: r.message ?? '代码已写入原 OJ 编辑器，等待用户自行检查/提交',
              problemId: problem.id,
            });
            toast.success('已回填到原 OJ', { description: '代码已写入编辑器，未自动提交' });
            return;
          }
          const verdict: SubmissionVerdict = r.verdict ?? 'OTHER';
          const isMistake = verdict !== 'AC';
          get().recordAgentTrace({
            kind: 'feedback',
            level: verdict === 'AC' ? 'success' : 'warn',
            title: `OJ verdict：${verdict}`,
            detail: r.rawText ? r.rawText.slice(0, 240) : undefined,
            problemId: problem.id,
          });
          await storage.appendEvent({
            ts: Date.now(),
            sessionId,
            problemId: problem.id,
            type: 'submit',
            payload: {
              source: 'oj-bridge',
              ojSource: source,
              url: r.url,
              verdict,
              status: r.status,
              rawText: r.rawText,
            },
          });
          toast.success(`OJ 判题返回：${verdict}`, {
            description: isMistake ? '已自动进入错题流程' : '已自动进入通过总结',
          });
          get().enqueueSummarize({
            isMistake,
            verdict,
            userNote: r.rawText || r.message,
          });
          if (isMistake) {
            get().enqueueAnalyze({ reason: `oj-${verdict}` });
          }
        },
      }, { problemId: problem.id, fileId: file.id, source });
    },

    handleImportPayload: async (payload) => {
      // payload 是 Node 端 importProcessor 处理后的 processed payload
      // - rawText 已含 qwen3.5 识别结果（[图 N 识别] xxx）
      // - imageRecognitions 字段记录每张图的识别详情
      // 前端职责：去重、调 cloud AI parseProblem（可选）、入库、激活
      const st = get();
      get().recordAgentTrace({
        kind: 'perceive',
        level: 'info',
        title: `收到 OJ 推送：${payload.title || payload.url}`,
        detail: `来源：${payload.source}\n图片：${payload.images?.length ?? 0} 张`,
      });
      const id = 'import-' + payload.url.replace(/[^a-zA-Z0-9]/g, '_').slice(-50);
      const existing = st.problems.find((p) => p.id === id);
      const hasRecognition = !!(payload as any).imageRecognitions?.length;

      if (existing) {
        const incomingStatement = payload.rawText || '';
        if ((payload.title && payload.title !== existing.title) || existing.source !== payload.url) {
          const updated = {
            ...existing,
            title: payload.title || existing.title,
            source: payload.url || existing.source,
          };
          await storage.saveProblem(updated);
          set((s) => ({
            problems: s.problems.map((p) => (p.id === id ? updated : p)),
          }));
          toast.info(`🔄 已接收更新：${updated.title}`, {
            description: hasRecognition ? 'AI 正在整理最新识别结果' : 'AI 正在后台重新整理题面',
          });
        } else {
          toast.info(`已存在：${existing.title}`);
        }
        const incomingCode = payload.initialCode ?? '';
        if (incomingCode.trim()) {
          const lang = inferImportedFileLang(payload);
          const latest = get();
          const files = latest.filesByScope[existing.id] ?? [];
          const activeFileId = latest.activeFileIdByScope[existing.id];
          const target = files.find((f) => f.id === activeFileId) ?? files[0];
          if (target) {
            const updatedFile: CodeFile = {
              ...target,
              language: lang,
              content: incomingCode,
              updatedAt: Date.now(),
            };
            await storage.saveFile(updatedFile);
            set((s) => ({
              filesByScope: {
                ...s.filesByScope,
                [existing.id]: (s.filesByScope[existing.id] ?? []).map((f) =>
                  f.id === updatedFile.id ? updatedFile : f,
                ),
              },
              activeFileIdByScope: { ...s.activeFileIdByScope, [existing.id]: updatedFile.id },
            }));
          } else {
            const fileId = 'file-' + Date.now();
            const file: CodeFile = {
              id: fileId,
              problemId: existing.id,
              name: defaultFileName(lang, []),
              language: lang,
              content: incomingCode,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            await storage.saveFile(file);
            set((s) => ({
              filesByScope: { ...s.filesByScope, [existing.id]: [file] },
              activeFileIdByScope: { ...s.activeFileIdByScope, [existing.id]: fileId },
            }));
          }
        }
        await get().setActiveProblem(existing.id);
        const nonEmptyLines = incomingCode.split('\n').filter((line) => line.trim().length > 0).length;
        scheduleImportedProblemParsing(get, set, id, payload, incomingStatement, payload.title || existing.title, {
          autoAnalyzeCode: incomingCode.trim().length >= 30 && nonEmptyLines >= 3,
        });
        return;
      }

      const statement = payload.rawText || '';
      const now = Date.now();
      const problem: Problem = {
        id,
        title: payload.title || '导入的题目',
        statement: statement ? IMPORT_PLACEHOLDER_ANALYZING : IMPORT_PLACEHOLDER_WAITING,
        source: payload.url,
        tags: [],
        createdAt: now,
      };

      // 入库 + 编辑文件
      await storage.saveProblem(problem);
      const lang = inferImportedFileLang(payload);
      const fileId = 'file-' + now;
      const fileName = lang === 'cpp' ? 'main.cpp' : lang === 'c' ? 'main.c' : 'main.py';
      const incomingCode = payload.initialCode || '';
      const file: CodeFile = {
        id: fileId,
        problemId: problem.id,
        name: fileName,
        language: lang,
        content: incomingCode,
        createdAt: now,
        updatedAt: now,
      };
      await storage.saveFile(file);

      set((s) => ({
        problems: [problem, ...s.problems],
        filesByScope: { ...s.filesByScope, [problem.id]: [file] },
        activeFileIdByScope: { ...s.activeFileIdByScope, [problem.id]: fileId },
      }));

      await get().setActiveProblem(problem.id);
      const imgCount = payload.images?.length ?? 0;
      const recogCount = (payload as any).imageRecognitions?.filter((r: any) => r.description)?.length ?? 0;
      get().recordAgentTrace({
        kind: 'feedback',
        level: 'success',
        title: `已导入并激活：${problem.title}`,
        detail: imgCount > 0 ? `识别 ${recogCount}/${imgCount} 张题面图` : undefined,
        problemId: problem.id,
      });
      toast.success(`📥 已导入：${problem.title}`, {
        description: `来自 ${payload.source}${imgCount > 0 ? ` · ${recogCount}/${imgCount} 张图已识别` : ''}`,
      });
      const nonEmptyLines = incomingCode.split('\n').filter((line) => line.trim().length > 0).length;
      scheduleImportedProblemParsing(get, set, id, payload, statement, problem.title, {
        autoAnalyzeCode: incomingCode.trim().length >= 30 && nonEmptyLines >= 3,
      });
    },

    addBankProblem: async (bankId) => {
      const bank = PROBLEM_BANK.find((b) => b.id === bankId);
      if (!bank) return null;
      // 已添加过则直接激活
      const existing = get().problems.find((p) => p.id === bankId);
      if (existing) {
        await get().setActiveProblem(bankId);
        return bankId;
      }
      const newProblem: Problem = {
        id: bank.id,
        title: bank.title,
        statement: bank.statement,
        constraints: bank.constraints,
        examples: bank.examples,
        tags: bank.tags,
        difficulty: bank.difficulty,
        createdAt: Date.now(),
      };
      await storage.saveProblem(newProblem);
      set((s) => ({ problems: [newProblem, ...s.problems] }));
      await get().setActiveProblem(bankId);
      // 同时刷新引擎（避免反复推荐已添加的）
      get().refreshLearningEngine();
      return bankId;
    },
  };
});

// ============== helpers ==============

function findScopeOfFile(st: State, fileId: string): string | null {
  for (const [scope, files] of Object.entries(st.filesByScope)) {
    if (files.some((f) => f.id === fileId)) return scope;
  }
  return null;
}

function inferImportedFileLang(payload: import('./importReceiver').ImportPayload): FileLang {
  const explicit = (payload.language ?? '').toLowerCase();
  const text = `${payload.title ?? ''}\n${payload.rawText ?? ''}\n${payload.initialCode ?? ''}`.toLowerCase();
  if (
    explicit === 'python' ||
    /\bpython\b/.test(text) ||
    text.includes('input 函数') ||
    /(^|\n)\s*(def|print|with\s+open|import\s+)\b/.test(payload.initialCode ?? '')
  ) {
    return 'python';
  }
  if (explicit === 'c') return 'c';
  return 'cpp';
}

function smartDupName(orig: string, existing: string[]): string {
  const dotIdx = orig.lastIndexOf('.');
  const base = dotIdx > 0 ? orig.slice(0, dotIdx) : orig;
  const ext = dotIdx > 0 ? orig.slice(dotIdx) : '';
  // 如果 base 已经是 v\d+，bump number
  const m = base.match(/^(.+)-v(\d+)$/);
  let prefix = base;
  let n = 2;
  if (m) {
    prefix = m[1];
    n = parseInt(m[2], 10) + 1;
  }
  while (existing.includes(`${prefix}-v${n}${ext}`)) n++;
  return `${prefix}-v${n}${ext}`;
}

/** 把旧 codeByProblem (LS_OLD_CODE) 迁移成 files store */
async function migrateLegacyCode(get: () => State) {
  const raw = safeGetItem(LS_OLD_CODE);
  if (!raw) return;
  try {
    const old = JSON.parse(raw) as Record<string, string>;
    const st = get();
    let migrated = 0;
    for (const [scope, code] of Object.entries(old)) {
      if (!code || code.trim().length === 0) continue;
      // 已有 file 的 scope 不迁移（避免重复）
      if ((st.filesByScope[scope] ?? []).length > 0) continue;
      const lang = guessLang(code);
      await get().createFile({
        scope,
        name: defaultFileName(lang, []),
        language: lang,
        content: code,
        activate: false,
      });
      migrated++;
    }
    if (migrated > 0) {
      console.log(`[migrate] 已从旧 codeByProblem 迁移 ${migrated} 个文件`);
    }
    safeRemoveItem(LS_OLD_CODE);
  } catch (e) {
    console.warn('[migrate] 旧数据解析失败', e);
  }
}

function guessLang(code: string): FileLang {
  if (/^\s*#include/.test(code) || /\bint\s+main\s*\(/.test(code)) return 'cpp';
  if (/^\s*def\s+|^\s*import\s+|if __name__/.test(code)) return 'python';
  return 'cpp';
}

function inferOjSource(url: string): 'educoder' | 'school-oj' | 'unknown' {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.educoder.net') return 'educoder';
    if (u.hostname === '10.11.219.21') return 'school-oj';
  } catch {
    /* ignore */
  }
  return 'unknown';
}

// 启动时拉取数据 + 迁移
useStore.getState().refreshAll();

// 测试用：暴露 store + 强关所有 modal 的 helper（仅用于 e2e）
if (typeof window !== 'undefined') {
  (window as any).__aicc_useStore__ = useStore;
  (window as any).__aicc_clear__ = () => {
    const s = useStore.getState();
    s.setSettingsOpen(false);
    s.setProblemEditorOpen(false);
    s.setCmdPaletteOpen(false);
    s.setSubmitModalOpen(false);
    s.dismissHint();
    s.setAskPrefill(null);
    // 不清 diffSelection，避免 e2e 测试连锁失败
  };
}

// dev 模式：把 store 暴露到 window 便于 e2e 测试 / debugging
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as any).__aiccStore = useStore;
}
