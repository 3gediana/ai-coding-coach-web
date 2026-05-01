/**
 * DailyPlan 编排器（纯函数 + 依赖注入）。
 *
 * 把 3 件套编排（学情诊断 → 题目筛选 → 计划编排）从 store 里抽出来，
 * 与 Hack Chain orchestrator 风格一致：
 *   - 依赖通过 deps 注入；不引入 store / zustand / toast
 *   - 任意一步失败下游优雅降级，永远返回 DailyPlanResult，不 throw
 *   - 调用方拿结果后自己决定 trace / state / persist
 */

// ───────── Schema ─────────

/** 学情诊断 Agent 的输入 */
export interface DiagnosisInput {
  recentMistakes: Array<{
    title: string;
    category: string;
    rootCause?: string;
    verdict?: string;
    daysAgo: number;
  }>;
  weekStats: {
    totalProblems: number;
    totalSubmissions: number;
    acRate: number;
    avgSessionMinutes: number;
  };
  stuckProblems: Array<{ title: string; failureCount: number; verdicts: string[] }>;
}

/** 学情诊断 Agent 的输出 */
export interface DiagnosisOutput {
  weakConcepts: string[];
  strengths: string[];
  todayFocus: string;
}

/** 题目筛选 Agent 的输入（本地，不调 LLM） */
export interface CandidatesInput {
  weakConcepts: string[];
  // 这些字段调用方原样传入；orchestrator 不解析具体业务结构
  mistakes: unknown;
  alreadyAdded: unknown;
  bank: unknown;
  now: number;
}

/** 题目筛选 Agent 的输出 */
export interface CandidatesOutput {
  newProblems: Array<{
    bankId: string;
    title: string;
    difficulty?: string;
    tags?: string[];
    reason: string;
  }>;
  reviewMistakes: Array<{
    mistakeId: string;
    problemTitle: string;
    category: string;
    reason: string;
  }>;
}

/** 计划编排 Agent 的输出 */
export interface PlanOrchestrationOutput {
  headline: string;
  estimatedMinutes: number;
  steps: Array<{
    kind: 'new-problem' | 'review-mistake' | 'concept-recall';
    title: string;
    bankId?: string;
    mistakeId?: string;
    problemId?: string;
    reason: string;
    estimatedMinutes: number;
  }>;
  encouragement: string;
}

/** 编排器最终结果（成功 / 各类失败原因） */
export type DailyPlanResult =
  | {
      status: 'success';
      diagnosis: DiagnosisOutput;
      candidates: CandidatesOutput;
      plan: PlanOrchestrationOutput;
    }
  | {
      status: 'failed';
      /** 终止时所处步骤 */
      failedAt: 'diagnosis' | 'candidates' | 'orchestration';
      /** 简短原因（UI / trace 显示） */
      reason: string;
      /** 已经成功的中间产物（如果有），方便 UI 展示部分进度 */
      diagnosis?: DiagnosisOutput;
      candidates?: CandidatesOutput;
    };

/** UI / trace observer */
export interface DailyPlanObserver {
  onDiagnosisInput?: (input: DiagnosisInput) => void;
  onDiagnosisOutput?: (out: DiagnosisOutput) => void;
  onDiagnosisFailed?: (reason: string) => void;
  onCandidatesOutput?: (out: CandidatesOutput) => void;
  onCandidatesEmpty?: () => void;
  onPlanOutput?: (out: PlanOrchestrationOutput) => void;
  onPlanFailed?: (reason: string) => void;
  onSuccess?: () => void;
}

/** 编排器依赖 */
export interface DailyPlanDeps {
  generateDiagnosis: (input: DiagnosisInput) => Promise<DiagnosisOutput | null>;
  pickCandidates: (input: CandidatesInput) => CandidatesOutput;
  generatePlan: (args: {
    diagnosis: DiagnosisOutput;
    candidates: CandidatesOutput;
  }) => Promise<PlanOrchestrationOutput | null>;
  observer?: DailyPlanObserver;
}

/** 编排上下文：调用方收集好的所有输入 */
export interface DailyPlanContext {
  diagnosisInput: DiagnosisInput;
  /** pickCandidates 的额外上下文（mistakes / alreadyAdded / bank / now） */
  candidateContext: Omit<CandidatesInput, 'weakConcepts'>;
}

/**
 * 跑完整条 DailyPlan 编排。
 * 任何一步失败都返回 status='failed'，不抛异常。
 */
export async function orchestrateDailyPlan(
  ctx: DailyPlanContext,
  deps: DailyPlanDeps,
): Promise<DailyPlanResult> {
  const obs = deps.observer ?? {};

  // ── [1/3] 学情诊断 Agent ──
  obs.onDiagnosisInput?.(ctx.diagnosisInput);
  let diagnosis: DiagnosisOutput | null;
  try {
    diagnosis = await deps.generateDiagnosis(ctx.diagnosisInput);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    obs.onDiagnosisFailed?.(msg);
    return {
      status: 'failed',
      failedAt: 'diagnosis',
      reason: msg,
    };
  }
  if (!diagnosis) {
    const reason = '云端模型未返回有效诊断';
    obs.onDiagnosisFailed?.(reason);
    return {
      status: 'failed',
      failedAt: 'diagnosis',
      reason,
    };
  }
  obs.onDiagnosisOutput?.(diagnosis);

  // ── [2/3] 题目筛选 Agent（本地纯逻辑） ──
  const candidates = deps.pickCandidates({
    weakConcepts: diagnosis.weakConcepts,
    ...ctx.candidateContext,
  });
  obs.onCandidatesOutput?.(candidates);
  if (candidates.newProblems.length === 0 && candidates.reviewMistakes.length === 0) {
    obs.onCandidatesEmpty?.();
    return {
      status: 'failed',
      failedAt: 'candidates',
      reason: '题库 + 错题本里没有匹配薄弱点的候选',
      diagnosis,
    };
  }

  // ── [3/3] 计划编排 Agent ──
  let plan: PlanOrchestrationOutput | null;
  try {
    plan = await deps.generatePlan({ diagnosis, candidates });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    obs.onPlanFailed?.(msg);
    return {
      status: 'failed',
      failedAt: 'orchestration',
      reason: msg,
      diagnosis,
      candidates,
    };
  }
  if (!plan) {
    const reason = '云端模型未返回有效计划';
    obs.onPlanFailed?.(reason);
    return {
      status: 'failed',
      failedAt: 'orchestration',
      reason,
      diagnosis,
      candidates,
    };
  }
  obs.onPlanOutput?.(plan);
  obs.onSuccess?.();

  return {
    status: 'success',
    diagnosis,
    candidates,
    plan,
  };
}
