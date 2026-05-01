/**
 * DailyPlan 编排器单元测试。
 *
 * 覆盖 6 个分支：
 *  1. 全成功 — Diagnosis → Candidates → Plan
 *  2. Diagnosis 返回 null（云端模型失败）→ failedAt='diagnosis'，下游不调
 *  3. Diagnosis 抛异常 → failedAt='diagnosis'
 *  4. 候选空（新题 + 复习都为 0）→ failedAt='candidates'，Plan 不调
 *  5. Plan 返回 null → failedAt='orchestration'
 *  6. observer 事件流顺序正确
 */
import { describe, it, expect, vi } from 'vitest';
import {
  orchestrateDailyPlan,
  type DailyPlanContext,
  type DailyPlanDeps,
  type DiagnosisOutput,
  type CandidatesOutput,
  type PlanOrchestrationOutput,
} from './dailyPlanOrchestrator';

// ───────── fixtures ─────────

const CTX: DailyPlanContext = {
  diagnosisInput: {
    recentMistakes: [
      { title: '题 A', category: 'DP', daysAgo: 1 },
      { title: '题 B', category: '滑动窗口', daysAgo: 3 },
    ],
    weekStats: {
      totalProblems: 5,
      totalSubmissions: 18,
      acRate: 0.56,
      avgSessionMinutes: 28,
    },
    stuckProblems: [{ title: '题 C', failureCount: 3, verdicts: ['WA', 'WA', 'TLE'] }],
  },
  candidateContext: {
    mistakes: [],
    alreadyAdded: [],
    bank: [],
    now: 1_700_000_000_000,
  },
};

const DIAG_OK: DiagnosisOutput = {
  weakConcepts: ['DP', '滑动窗口'],
  strengths: ['贪心'],
  todayFocus: '今天重点击破滑动窗口',
};

const CANDIDATES_OK: CandidatesOutput = {
  newProblems: [
    { bankId: 'lc-3', title: 'LongestSubstring', reason: '滑动窗口入门' },
  ],
  reviewMistakes: [
    { mistakeId: 'm1', problemTitle: '题 A', category: 'DP', reason: '复习 DP' },
  ],
};

const PLAN_OK: PlanOrchestrationOutput = {
  headline: '今日重点：滑动窗口',
  estimatedMinutes: 60,
  steps: [
    {
      kind: 'review-mistake',
      title: '复习题 A',
      mistakeId: 'm1',
      reason: 'DP 老错',
      estimatedMinutes: 20,
    },
    {
      kind: 'new-problem',
      title: 'LongestSubstring',
      bankId: 'lc-3',
      reason: '滑动窗口入门',
      estimatedMinutes: 30,
    },
  ],
  encouragement: '加油！',
};

function makeHappyDeps(overrides: Partial<DailyPlanDeps> = {}): DailyPlanDeps {
  return {
    generateDiagnosis: vi.fn(async () => DIAG_OK),
    pickCandidates: vi.fn(() => CANDIDATES_OK),
    generatePlan: vi.fn(async () => PLAN_OK),
    ...overrides,
  };
}

// ───────── tests ─────────

describe('orchestrateDailyPlan', () => {
  it('1. 全成功 — Diagnosis → Candidates → Plan', async () => {
    const deps = makeHappyDeps();
    const result = await orchestrateDailyPlan(CTX, deps);

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.diagnosis).toEqual(DIAG_OK);
      expect(result.candidates).toEqual(CANDIDATES_OK);
      expect(result.plan).toEqual(PLAN_OK);
    }

    // pickCandidates 应该收到 diagnosis 的 weakConcepts
    const candCall = (deps.pickCandidates as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(candCall.weakConcepts).toEqual(DIAG_OK.weakConcepts);
    expect(candCall.bank).toBe(CTX.candidateContext.bank);
    expect(candCall.now).toBe(CTX.candidateContext.now);

    // generatePlan 应该收到 diagnosis + candidates
    const planCall = (deps.generatePlan as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(planCall.diagnosis).toEqual(DIAG_OK);
    expect(planCall.candidates).toEqual(CANDIDATES_OK);
  });

  it('2. Diagnosis 返回 null — 整链终止 / 下游不调', async () => {
    const observer = {
      onDiagnosisFailed: vi.fn(),
      onCandidatesOutput: vi.fn(),
      onPlanOutput: vi.fn(),
    };
    const deps = makeHappyDeps({
      generateDiagnosis: vi.fn(async () => null),
      observer,
    });
    const result = await orchestrateDailyPlan(CTX, deps);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.failedAt).toBe('diagnosis');
      expect(result.reason).toMatch(/未返回/);
      expect(result.diagnosis).toBeUndefined();
    }

    expect(observer.onDiagnosisFailed).toHaveBeenCalled();
    expect(observer.onCandidatesOutput).not.toHaveBeenCalled();
    expect(observer.onPlanOutput).not.toHaveBeenCalled();
    expect(deps.pickCandidates).not.toHaveBeenCalled();
    expect(deps.generatePlan).not.toHaveBeenCalled();
  });

  it('3. Diagnosis 抛异常 — failedAt=diagnosis', async () => {
    const deps = makeHappyDeps({
      generateDiagnosis: vi.fn(async () => {
        throw new Error('LLM timeout');
      }),
    });
    const result = await orchestrateDailyPlan(CTX, deps);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.failedAt).toBe('diagnosis');
      expect(result.reason).toBe('LLM timeout');
    }
    expect(deps.pickCandidates).not.toHaveBeenCalled();
  });

  it('4. 候选空 — failedAt=candidates / Plan 不调', async () => {
    const observer = {
      onCandidatesOutput: vi.fn(),
      onCandidatesEmpty: vi.fn(),
      onPlanOutput: vi.fn(),
    };
    const deps = makeHappyDeps({
      pickCandidates: vi.fn(() => ({ newProblems: [], reviewMistakes: [] })),
      observer,
    });
    const result = await orchestrateDailyPlan(CTX, deps);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.failedAt).toBe('candidates');
      expect(result.diagnosis).toEqual(DIAG_OK); // diagnosis 已经成功，应该带回来
      expect(result.candidates).toBeUndefined();
    }
    expect(observer.onCandidatesOutput).toHaveBeenCalled();
    expect(observer.onCandidatesEmpty).toHaveBeenCalled();
    expect(deps.generatePlan).not.toHaveBeenCalled();
  });

  it('5. Plan 返回 null — failedAt=orchestration', async () => {
    const deps = makeHappyDeps({
      generatePlan: vi.fn(async () => null),
    });
    const result = await orchestrateDailyPlan(CTX, deps);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.failedAt).toBe('orchestration');
      // 中间产物应该带回（方便 UI 展示部分进度）
      expect(result.diagnosis).toEqual(DIAG_OK);
      expect(result.candidates).toEqual(CANDIDATES_OK);
    }
  });

  it('6. observer 事件流顺序正确', async () => {
    const events: string[] = [];
    const observer = {
      onDiagnosisInput: vi.fn(() => events.push('diag-input')),
      onDiagnosisOutput: vi.fn(() => events.push('diag-output')),
      onDiagnosisFailed: vi.fn(() => events.push('diag-failed')),
      onCandidatesOutput: vi.fn(() => events.push('cand-output')),
      onCandidatesEmpty: vi.fn(() => events.push('cand-empty')),
      onPlanOutput: vi.fn(() => events.push('plan-output')),
      onPlanFailed: vi.fn(() => events.push('plan-failed')),
      onSuccess: vi.fn(() => events.push('success')),
    };
    const deps = makeHappyDeps({ observer });
    await orchestrateDailyPlan(CTX, deps);

    expect(events).toEqual([
      'diag-input',
      'diag-output',
      'cand-output',
      'plan-output',
      'success',
    ]);
  });

  it('7. Plan 抛异常 — failedAt=orchestration / 中间产物带回', async () => {
    const deps = makeHappyDeps({
      generatePlan: vi.fn(async () => {
        throw new Error('rate limit');
      }),
    });
    const result = await orchestrateDailyPlan(CTX, deps);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.failedAt).toBe('orchestration');
      expect(result.reason).toBe('rate limit');
      expect(result.diagnosis).toEqual(DIAG_OK);
      expect(result.candidates).toEqual(CANDIDATES_OK);
    }
  });
});
