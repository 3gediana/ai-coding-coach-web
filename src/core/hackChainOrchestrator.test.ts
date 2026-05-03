/**
 * Hack Chain 编排器单元测试。
 *
 * 覆盖 5 个关键分支：
 *  1. 全成功（hack 命中第一个 case）
 *  2. Attacker 失败 → 整链终止，下游全 skipped
 *  3. Attacker 没给候选（空数组）→ 视作失败
 *  4. Executor 全没 hack 成 → Explainer / FixSuggestor skipped
 *  5. Explainer 失败 → FixSuggestor 仍跑，使用 Attacker 假设 fallback
 *  6. 沙箱抛异常 → 包装成 exit=1 + stderr，不影响整链
 */
import { describe, it, expect, vi } from 'vitest';
import { orchestrateHackChain, type HackChainDeps } from './hackChainOrchestrator';
import type {
  AttackerOutput,
  ExplainerOutput,
  FixSuggestorOutput,
  HackChainContext,
} from './hackChain';

// ───────── 测试用 fixtures ─────────

const FAKE_PROBLEM = {
  id: 'p1',
  title: '两数之和',
  statement: '...',
  createdAt: 0,
} as HackChainContext['problem'];

const CTX: HackChainContext = {
  problem: FAKE_PROBLEM,
  code: 'print(1)',
  language: 'python',
  passedSamples: [],
};

const ATTACKER_OK: AttackerOutput = {
  hypothesis: 'O(n²) 在 n=10⁵ 会 TLE',
  candidates: [
    {
      kind: 'large',
      description: 'n=10⁵ 极端规模',
      stdin: '100000\n',
      expectedOutput: undefined,
    },
    {
      kind: 'edge',
      description: 'n=0 边界',
      stdin: '0\n',
    },
  ],
};

const EXPLAINER_OK: ExplainerOutput = {
  diagnosis: '在 n=10⁵ 时 TLE',
  rootCause: '嵌套循环，1 秒内跑不完 5×10⁹ 操作',
};

const FIX_OK: FixSuggestorOutput = {
  direction: '考虑用 HashMap',
  hint: '能不能 O(1) 查找？',
  conceptKeywords: ['HashMap', '空间换时间'],
};

/** 让所有 deps 都成功的"基线"工厂 */
function makeHappyDeps(overrides: Partial<HackChainDeps> = {}): HackChainDeps {
  return {
    generateAttacker: vi.fn(async () => ATTACKER_OK),
    runCode: vi.fn(async (_code, _stdin, _lang) => ({
      stdout: '',
      stderr: 'TLE',
      exitCode: 124, // 默认所有 case 都被 hack
      durationMs: 2000,
    })),
    generateExplanation: vi.fn(async () => EXPLAINER_OK),
    generateFixSuggestion: vi.fn(async () => FIX_OK),
    now: () => 1000,
    ...overrides,
  };
}

// ───────── 测试 ─────────

describe('orchestrateHackChain', () => {
  it('1. 全成功 — Attacker → Executor 第一个 case 命中 → Explainer → FixSuggestor', async () => {
    const deps = makeHappyDeps();
    const result = await orchestrateHackChain(CTX, deps);

    expect(result.attacker).toEqual(ATTACKER_OK);
    expect(result.executor).not.toBeNull();
    expect(result.executor!.winningIndex).toBe(0);
    expect(result.executor!.results).toHaveLength(2);
    expect(result.executor!.results[0].hacked).toBe(true);
    expect(result.executor!.results[0].reason).toMatch(/exit 124/);
    expect(result.explainer).toEqual(EXPLAINER_OK);
    expect(result.fixSuggestor).toEqual(FIX_OK);
    expect(result.failedSteps).toEqual([]);

    // FixSuggestor 应该收到完整的 explainer 结论
    const fixCall = (deps.generateFixSuggestion as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(fixCall.diagnosis).toBe(EXPLAINER_OK.diagnosis);
    expect(fixCall.rootCause).toBe(EXPLAINER_OK.rootCause);
  });

  it('2. Attacker 抛异常 — 整链终止，下游全 skipped', async () => {
    const observer = {
      onStepSkipped: vi.fn(),
      onStepFailed: vi.fn(),
    };
    const deps = makeHappyDeps({
      generateAttacker: vi.fn(async () => {
        throw new Error('LLM timeout');
      }),
      observer,
    });
    const result = await orchestrateHackChain(CTX, deps);

    expect(result.attacker).toBeNull();
    expect(result.executor).toBeNull();
    expect(result.explainer).toBeNull();
    expect(result.fixSuggestor).toBeNull();
    expect(result.failedSteps).toEqual(['attacker']);

    // 下游三步都触发 skipped 回调
    expect(observer.onStepSkipped).toHaveBeenCalledWith('executor');
    expect(observer.onStepSkipped).toHaveBeenCalledWith('explainer');
    expect(observer.onStepSkipped).toHaveBeenCalledWith('fixSuggestor');
    expect(observer.onStepFailed).toHaveBeenCalledWith(
      'attacker',
      expect.any(Number),
      'LLM timeout',
    );

    // 下游 deps 都没被调
    expect(deps.runCode).not.toHaveBeenCalled();
    expect(deps.generateExplanation).not.toHaveBeenCalled();
    expect(deps.generateFixSuggestion).not.toHaveBeenCalled();
  });

  it('3. Attacker 返回空 candidates — 视作失败', async () => {
    const deps = makeHappyDeps({
      generateAttacker: vi.fn(async () => ({ hypothesis: 'no idea', candidates: [] })),
    });
    const result = await orchestrateHackChain(CTX, deps);

    expect(result.attacker).toBeNull();
    expect(result.failedSteps).toEqual(['attacker']);
    expect(deps.runCode).not.toHaveBeenCalled();
  });

  it('4. Executor 全没 hack 成 — Explainer / FixSuggestor 跳过', async () => {
    const deps = makeHappyDeps({
      runCode: vi.fn(async () => ({
        stdout: '0',
        stderr: '',
        exitCode: 0,
        durationMs: 100,
      })),
    });
    const result = await orchestrateHackChain(CTX, deps);

    expect(result.attacker).toEqual(ATTACKER_OK);
    expect(result.executor!.winningIndex).toBeNull();
    expect(result.executor!.results.every((r) => !r.hacked)).toBe(true);
    expect(result.explainer).toBeNull();
    expect(result.fixSuggestor).toBeNull();
    expect(result.failedSteps).toEqual([]);

    expect(deps.generateExplanation).not.toHaveBeenCalled();
    expect(deps.generateFixSuggestion).not.toHaveBeenCalled();
  });

  it('5. Explainer 失败 — FixSuggestor 仍跑，使用 Attacker hypothesis fallback', async () => {
    const deps = makeHappyDeps({
      generateExplanation: vi.fn(async () => {
        throw new Error('JSON parse error');
      }),
    });
    const result = await orchestrateHackChain(CTX, deps);

    expect(result.attacker).toEqual(ATTACKER_OK);
    expect(result.explainer).toBeNull();
    expect(result.fixSuggestor).toEqual(FIX_OK);
    expect(result.failedSteps).toEqual(['explainer']);

    // FixSuggestor 应该用 attacker.hypothesis 作 diagnosis fallback
    const fixCall = (deps.generateFixSuggestion as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(fixCall.diagnosis).toBe(ATTACKER_OK.hypothesis);
    expect(fixCall.rootCause).toMatch(/Explainer 失败/);
  });

  it('6. 沙箱抛异常 — 包装成 exit=1 + stderr，整链不挂', async () => {
    const deps = makeHappyDeps({
      runCode: vi.fn(async () => {
        throw new Error('pyodide crash');
      }),
    });
    const result = await orchestrateHackChain(CTX, deps);

    expect(result.executor!.results).toHaveLength(2);
    // 异常被包装成 exit=1 / stderr=错误信息
    expect(result.executor!.results[0].exitCode).toBe(1);
    expect(result.executor!.results[0].stderr).toMatch(/pyodide crash/);
    expect(result.executor!.results[0].hacked).toBe(true);
    // 后续步骤照常跑
    expect(result.explainer).toEqual(EXPLAINER_OK);
    expect(result.fixSuggestor).toEqual(FIX_OK);
    expect(result.failedSteps).toEqual([]);
  });

  it('7. expectedOutput 不匹配 — 视为 hack 成功', async () => {
    const deps = makeHappyDeps({
      generateAttacker: vi.fn(async () => ({
        hypothesis: 'Wrong output 测试',
        candidates: [
          {
            kind: 'edge' as const,
            description: '验证输出',
            stdin: '5\n',
            expectedOutput: '120',
          },
        ],
      })),
      runCode: vi.fn(async () => ({
        stdout: '0',
        stderr: '',
        exitCode: 0, // 程序正常退出
        durationMs: 50,
      })),
    });
    const result = await orchestrateHackChain(CTX, deps);

    expect(result.executor!.winningIndex).toBe(0);
    expect(result.executor!.results[0].hacked).toBe(true);
    expect(result.executor!.results[0].matchesExpected).toBe(false);
    expect(result.executor!.results[0].reason).toMatch(/期望 120 实际 0/);
  });

  it('8. observer 接到完整事件流', async () => {
    const events: string[] = [];
    const observer = {
      onStepStart: vi.fn((step: string) => events.push(`start:${step}`)),
      onStepSuccess: vi.fn((step: string) => events.push(`success:${step}`)),
      onStepFailed: vi.fn((step: string) => events.push(`failed:${step}`)),
      onStepSkipped: vi.fn((step: string) => events.push(`skipped:${step}`)),
      onAttackerOutput: vi.fn(() => events.push('attacker-out')),
      onExplainerOutput: vi.fn(() => events.push('explainer-out')),
      onFixSuggestorOutput: vi.fn(() => events.push('fix-out')),
    };
    const deps = makeHappyDeps({ observer });
    await orchestrateHackChain(CTX, deps);

    // 顺序应该是：每步 start → 输出回调 → success
    expect(events).toEqual([
      'start:attacker',
      'success:attacker',
      'attacker-out',
      'start:executor',
      'success:executor',
      'start:explainer',
      'success:explainer',
      'explainer-out',
      'start:fixSuggestor',
      'success:fixSuggestor',
      'fix-out',
    ]);
  });

  it('9. oracle 对拍不一致 — 视为 hack 成功', async () => {
    const deps = makeHappyDeps({
      generateAttacker: vi.fn(async () => ({
        hypothesis: '小规模可用朴素解对拍',
        candidates: [
          {
            kind: 'random_stress' as const,
            description: '小规模随机压力',
            stdin: '3\n1 2 3\n',
            validationMethod: 'oracle' as const,
            oracle: {
              language: 'python' as const,
              code: 'print(6)',
            },
          },
        ],
      })),
      runCode: vi.fn(async () => ({
        stdout: '5\n',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
      })),
      runOracle: vi.fn(async () => ({
        stdout: '6\n',
        stderr: '',
        exitCode: 0,
        durationMs: 20,
      })),
    });
    const result = await orchestrateHackChain(CTX, deps);

    expect(result.executor!.winningIndex).toBe(0);
    expect(result.executor!.results[0].validationMethod).toBe('oracle');
    expect(result.executor!.results[0].oracleOutput).toBe('6\n');
    expect(result.executor!.results[0].matchesExpected).toBe(false);
    expect(result.executor!.results[0].reason).toMatch(/oracle 对拍不一致/);
  });

  it('10. metamorphic 关系失败 — 视为 hack 成功', async () => {
    const deps = makeHappyDeps({
      generateAttacker: vi.fn(async () => ({
        hypothesis: '排序类输入打乱后答案应一致',
        candidates: [
          {
            kind: 'special_structure' as const,
            description: '打乱输入顺序',
            stdin: '3\n1 2 3\n',
            validationMethod: 'metamorphic' as const,
            metamorphic: {
              transformedStdin: '3\n3 2 1\n',
              relation: 'same_output' as const,
              expectedRelation: '输入顺序不影响答案',
            },
          },
        ],
      })),
      runCode: vi.fn(async (_code, stdin) => ({
        stdout: stdin.includes('1 2 3') ? '6\n' : '5\n',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
      })),
    });
    const result = await orchestrateHackChain(CTX, deps);

    expect(result.executor!.winningIndex).toBe(0);
    expect(result.executor!.results[0].validationMethod).toBe('metamorphic');
    expect(result.executor!.results[0].metamorphicPassed).toBe(false);
    expect(result.executor!.results[0].reason).toMatch(/变形关系失败/);
  });

  it('11. oracle 缺少朴素解代码 — 降级为 runtime_only', async () => {
    const deps = makeHappyDeps({
      generateAttacker: vi.fn(async () => ({
        hypothesis: '模型返回了不完整 oracle 任务',
        candidates: [
          {
            kind: 'random_stress' as const,
            description: '缺少 oracle code',
            stdin: '3\n1 2 3\n',
            validationMethod: 'oracle' as const,
          },
        ],
      })),
      runCode: vi.fn(async () => ({
        stdout: '6\n',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
      })),
    });
    const result = await orchestrateHackChain(CTX, deps);

    expect(result.executor!.winningIndex).toBeNull();
    expect(result.executor!.results[0].validationMethod).toBe('runtime_only');
    expect(result.executor!.results[0].hacked).toBe(false);
  });
});
