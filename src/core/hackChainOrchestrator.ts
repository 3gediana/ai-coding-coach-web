/**
 * Hack Chain 编排器（纯函数 + 依赖注入）。
 *
 * 把"4-agent 链式编排"逻辑从 store 里抽出来，便于：
 *   - 单元测试：注入 fake deps 验证 5 大分支（成功 / Attacker 失败 / 未 hack 成 / Explainer 失败 fallback / 沙箱崩溃）
 *   - 复用：未来如果要做 CLI 版批量 hack 也能直接调
 *
 * 设计原则：
 *   - 不引入 store / zustand / toast；所有 side-effect 通过 deps 注入
 *   - 不在内部 throw；任何异常都包装成 step 的 failed 状态
 *   - 调用方拿到完整 HackChainResult 后自己决定怎么呈现
 */
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
} from './hackChain';

/** 沙箱执行结果（最小子集，避免依赖 lib/runtime 的具体类型） */
export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/** 编排器回调：让调用方在每一步开始/结束时同步 UI 状态、记录 trace */
export interface OrchestratorObserver {
  /** 某步进入 running */
  onStepStart?: (step: HackChainStep, ts: number) => void;
  /** 某步成功结束 */
  onStepSuccess?: (step: HackChainStep, ts: number) => void;
  /** 某步失败 */
  onStepFailed?: (step: HackChainStep, ts: number, error: string) => void;
  /** 某步被跳过（前置失败 / 没 hack 成功） */
  onStepSkipped?: (step: HackChainStep) => void;
  /** Attacker 输出已就绪（UI 可以即时展示候选） */
  onAttackerOutput?: (out: AttackerOutput) => void;
  /** Executor 单条 case 跑完 */
  onExecutorProgress?: (result: ExecutorRunResult) => void;
  /** Explainer 输出已就绪 */
  onExplainerOutput?: (out: ExplainerOutput) => void;
  /** FixSuggestor 输出已就绪 */
  onFixSuggestorOutput?: (out: FixSuggestorOutput) => void;
}

/** 编排器依赖（全部由调用方注入） */
export interface HackChainDeps {
  /** Step 1：调 LLM 出候选 */
  generateAttacker: (ctx: HackChainContext) => Promise<AttackerOutput>;
  /** Step 2：调本地沙箱跑用户代码 */
  runCode: (
    code: string,
    stdin: string,
    language: HackChainContext['language'],
  ) => Promise<SandboxRunResult>;
  /** Step 3：调 LLM 解释为啥挂 */
  generateExplanation: (args: {
    ctx: HackChainContext;
    attackerHypothesis: string;
    winningCandidate: AttackerCandidate;
    executorResult: ExecutorRunResult;
  }) => Promise<ExplainerOutput>;
  /** Step 4：调 LLM 给修改方向 */
  generateFixSuggestion: (args: {
    ctx: HackChainContext;
    attackerHypothesis: string;
    diagnosis: string;
    rootCause: string;
  }) => Promise<FixSuggestorOutput>;
  /** 当前时间，方便测试注入确定值 */
  now?: () => number;
  /** UI / trace observer */
  observer?: OrchestratorObserver;
}

/**
 * 跑完整条 Hack Chain。
 * 任何一步失败下游优雅降级，永远返回 HackChainResult；不抛异常。
 */
export async function orchestrateHackChain(
  ctx: HackChainContext,
  deps: HackChainDeps,
): Promise<HackChainResult> {
  const now = deps.now ?? (() => Date.now());
  const obs = deps.observer ?? {};
  const startedAt = now();
  const failedSteps: HackChainStep[] = [];

  // ── [1/4] Attacker ──
  obs.onStepStart?.('attacker', now());
  let attacker: AttackerOutput | null = null;
  try {
    attacker = await deps.generateAttacker(ctx);
    if (!attacker.candidates.length) throw new Error('attacker 未给出有效候选');
    obs.onStepSuccess?.('attacker', now());
    obs.onAttackerOutput?.(attacker);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    obs.onStepFailed?.('attacker', now(), msg);
    failedSteps.push('attacker');
    obs.onStepSkipped?.('executor');
    obs.onStepSkipped?.('explainer');
    obs.onStepSkipped?.('fixSuggestor');
    return {
      attacker: null,
      executor: null,
      explainer: null,
      fixSuggestor: null,
      startedAt,
      endedAt: now(),
      failedSteps,
    };
  }

  // ── [2/4] Executor ──
  obs.onStepStart?.('executor', now());
  const executor: ExecutorOutput = { results: [], winningIndex: null };
  for (let i = 0; i < attacker.candidates.length; i++) {
    const cand = attacker.candidates[i];
    const t0 = now();
    let runRes: SandboxRunResult;
    try {
      runRes = await deps.runCode(ctx.code, cand.stdin, ctx.language);
    } catch (e: unknown) {
      runRes = {
        stdout: '',
        stderr: e instanceof Error ? e.message : String(e),
        exitCode: 1,
        durationMs: now() - t0,
      };
    }
    const expected = (cand.expectedOutput ?? '').trim();
    const actual = (runRes.stdout ?? '').trim();
    const matchesExpected = expected ? expected === actual : undefined;
    let hacked = false;
    let reason: string | undefined;
    if (runRes.exitCode !== 0) {
      hacked = true;
      reason =
        `exit ${runRes.exitCode}` +
        (runRes.stderr ? ` · ${runRes.stderr.slice(0, 80)}` : '');
    } else if (matchesExpected === false) {
      hacked = true;
      reason = `期望 ${expected.slice(0, 30)} 实际 ${actual.slice(0, 30)}`;
    }
    const result: ExecutorRunResult = {
      candidateIndex: i,
      exitCode: runRes.exitCode,
      stdout: runRes.stdout.slice(0, 600),
      stderr: runRes.stderr.slice(0, 600),
      durationMs: runRes.durationMs,
      matchesExpected,
      hacked,
      reason,
    };
    executor.results.push(result);
    obs.onExecutorProgress?.(result);
    if (hacked && executor.winningIndex === null) {
      executor.winningIndex = i;
    }
  }
  obs.onStepSuccess?.('executor', now());

  // 没 hack 成功 → 后续两步 skipped
  if (executor.winningIndex === null) {
    obs.onStepSkipped?.('explainer');
    obs.onStepSkipped?.('fixSuggestor');
    return {
      attacker,
      executor,
      explainer: null,
      fixSuggestor: null,
      startedAt,
      endedAt: now(),
      failedSteps,
    };
  }

  // ── [3/4] Explainer ──
  const winningCandidate = attacker.candidates[executor.winningIndex];
  const winningResult = executor.results[executor.winningIndex];
  obs.onStepStart?.('explainer', now());
  let explainer: ExplainerOutput | null = null;
  try {
    explainer = await deps.generateExplanation({
      ctx,
      attackerHypothesis: attacker.hypothesis,
      winningCandidate,
      executorResult: winningResult,
    });
    obs.onStepSuccess?.('explainer', now());
    obs.onExplainerOutput?.(explainer);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    obs.onStepFailed?.('explainer', now(), msg);
    failedSteps.push('explainer');
  }

  // ── [4/4] FixSuggestor（即使 Explainer 失败也跑：用 Attacker 假设 fallback） ──
  obs.onStepStart?.('fixSuggestor', now());
  let fixSuggestor: FixSuggestorOutput | null = null;
  try {
    fixSuggestor = await deps.generateFixSuggestion({
      ctx,
      attackerHypothesis: attacker.hypothesis,
      diagnosis: explainer?.diagnosis ?? attacker.hypothesis,
      rootCause: explainer?.rootCause ?? '（Explainer 失败，仅依据 Attacker 假设）',
    });
    obs.onStepSuccess?.('fixSuggestor', now());
    obs.onFixSuggestorOutput?.(fixSuggestor);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    obs.onStepFailed?.('fixSuggestor', now(), msg);
    failedSteps.push('fixSuggestor');
  }

  return {
    attacker,
    executor,
    explainer,
    fixSuggestor,
    startedAt,
    endedAt: now(),
    failedSteps,
  };
}
