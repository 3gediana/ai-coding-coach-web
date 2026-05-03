/**
 * Hack Chain：4-agent 严格链式编排，AC 后对学生代码做对抗式挑战。
 *
 *   Attacker     →  Executor    →  Explainer       →  FixSuggestor
 *   (LLM)           (本地沙箱)     (LLM)              (LLM)
 *   产候选 case      跑用户代码     解释为啥挂        引导式提示
 *
 * 设计原则：
 *   - 严格链式：上一步输出是下一步输入；任意一步失败下游优雅降级
 *   - Schema 显式：每一步的 input/output 都有 TS interface，方便 trace 序列化
 *   - 不调用 store：纯数据结构 + 纯函数 prompt 构造器；Coach 类负责 LLM 调用
 *
 * 与现有单步 `Coach.generateHackCase` 的区别：
 *   - 老 API 一次调用产 1 个 case 完事；
 *   - 新链路把"造 case → 验证 → 解释 → 引导"拆成 4 个 agent，每步可见可追溯。
 */
import type { Problem, Lang } from './types';
import {
  STATEMENT_MAX,
  CONSTRAINTS_MAX,
  SYSTEM_CODING_COACH,
  SYSTEM_JSON_OUTPUT,
  clip,
  type PromptPair,
} from './ai/prompts';

// ───────── Schema ─────────

/** Chain 的全局上下文（每个 agent 都能看到） */
export interface HackChainContext {
  problem: Problem;
  code: string;
  language: Lang;
  passedSamples?: Array<{ input: string; output: string }>;
}

/** Step 1: Attacker — 凭题目和代码"猜薄弱点"，给候选 hack 输入 */
export interface AttackerOutput {
  /** 攻击假设：用一句话说"我觉得这份代码会在哪类 case 上挂" */
  hypothesis: string;
  /** 候选攻击 case，按从最有把握到最弱排序 */
  candidates: AttackerCandidate[];
}

export interface AttackerCandidate {
  kind:
    | 'min_boundary'
    | 'max_boundary'
    | 'duplicates'
    | 'monotonic'
    | 'random_stress'
    | 'special_structure'
    | 'anti_greedy'
    | 'overflow'
    | 'edge'
    | 'large'
    | 'degenerate'
    | 'tricky';
  /** 给评委 / 学生看的简短描述（≤ 30 字） */
  description: string;
  /** 直接喂 stdin 的字符串 */
  stdin: string;
  /** Attacker 推测的期望输出；填了 Executor 会用来判 hack 是否成功 */
  expectedOutput?: string;
  expectedRisk?: string;
  targetBugType?: string;
  validationMethod?: 'expected_output' | 'oracle' | 'metamorphic' | 'runtime_only';
  oracle?: {
    language: 'python';
    code: string;
  };
  metamorphic?: {
    transformedStdin: string;
    relation: 'same_output' | 'different_output';
    expectedRelation?: string;
  };
}

/** Step 2: Executor — 把 Attacker 给的候选挨个跑一遍，挑出真能 hack 的 */
export interface ExecutorOutput {
  results: ExecutorRunResult[];
  /** 第一个成功 hack 的下标；都没 hack 成时为 null */
  winningIndex: number | null;
}

export interface ExecutorRunResult {
  candidateIndex: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  validationMethod?: AttackerCandidate['validationMethod'];
  /** 若 candidate.expectedOutput 不为空，则比对 stdout 是否匹配 */
  matchesExpected?: boolean;
  oracleOutput?: string;
  transformedStdout?: string;
  metamorphicPassed?: boolean;
  /** 是否成功 hack（exit ≠ 0 / TLE / 输出与期望不符 / 编译错） */
  hacked: boolean;
  /** 若 hacked=true，给一段简短理由（"TLE 2003ms" / "Wrong: 期望 5 实际 4"） */
  reason?: string;
}

/** Step 3: Explainer — 对成功 hack 的 case 做归因解释，给学生听得懂的话 */
export interface ExplainerOutput {
  /** 一句话定性："你的代码在 n=10⁵ 时 TLE 了" */
  diagnosis: string;
  /** 根因分析（≤ 100 字） */
  rootCause: string;
}

/** Step 4: FixSuggestor — 给修改方向，**不直接给答案**，最大化教学价值 */
export interface FixSuggestorOutput {
  /** 指明的优化方向 */
  direction: string;
  /** 苏格拉底式提示问题 */
  hint: string;
  /** 涉及的关键概念，UI 上做 chip */
  conceptKeywords: string[];
}

/** 整个 chain 的可序列化结果 */
export interface HackChainResult {
  attacker: AttackerOutput | null;
  executor: ExecutorOutput | null;
  explainer: ExplainerOutput | null;
  fixSuggestor: FixSuggestorOutput | null;
  startedAt: number;
  endedAt: number;
  /** 流转过程中的失败步骤名，方便 UI 标红；空数组表示全部成功 */
  failedSteps: HackChainStep[];
}

export type HackChainStep = 'attacker' | 'executor' | 'explainer' | 'fixSuggestor';

// ───────── Prompts ─────────

/** Step 1 prompt：攻击者 — 产候选 hack case */
export function buildAttackerPrompt(ctx: HackChainContext): PromptPair {
  const samplesBlock = ctx.passedSamples && ctx.passedSamples.length > 0
    ? `\n【已经通过的样例（不要重复，要给不同维度的挑战）】\n` +
      ctx.passedSamples
        .slice(0, 2)
        .map((s, i) => `样例 ${i + 1}\n输入：\n${s.input}\n输出：\n${s.output}`)
        .join('\n\n') +
      '\n'
    : '';
  return {
    system:
      `${SYSTEM_CODING_COACH}\n\n你是【攻击者 Agent】，多 agent 协作的第一步。学生刚跑通了样例，但样例往往覆盖不到边界。请基于题目和代码**主动**构造若干 hack 候选，不要只给一个，要给一个排序后的列表（最强的攻击放第一）。${SYSTEM_JSON_OUTPUT}`,
    user: `【题目】${ctx.problem.title}
${clip(ctx.problem.statement, STATEMENT_MAX)}
${ctx.problem.constraints ? '【约束】' + clip(ctx.problem.constraints, CONSTRAINTS_MAX) : ''}
${samplesBlock}
【学生当前 ${ctx.language} 代码】
\`\`\`${ctx.language}
${ctx.code.slice(0, 4500)}
\`\`\`

请按"最有可能让代码挂掉"的顺序产出 **3-5 个候选验证任务**。每个任务都要说明攻击意图，并尽量覆盖不同类型：
- 最小边界 / 最大边界
- 重复元素 / 全相同元素
- 单调序列（升序、降序、链式结构）
- 随机压力（小规模但结构复杂）
- 特殊结构（空、孤立点、多个连通块、极不平衡）
- 反贪心样例
- 整数溢出 / 越界 / 浮点精度

验证方法优先级：
1. 能心算正确答案时，用 expected_output。
2. 小规模可暴力求解时，用 oracle，并给一段 Python3 朴素解代码。该 oracle 只需要适用于你给的 stdin 或小规模随机/边界输入，不要写优化算法。
3. 难以直接算答案时，用 metamorphic，给 transformedStdin 和 relation：
   - same_output：原输入与变形输入正确输出应完全一致
   - different_output：原输入与变形输入正确输出应不同
4. 只能验证 RE/TLE/崩溃时，用 runtime_only。

输出严格 JSON：
{
  "hypothesis": "一句话：你认为这份代码会在哪类 case 上挂（≤ 60 字）",
  "candidates": [
    {
      "kind": "min_boundary | max_boundary | duplicates | monotonic | random_stress | special_structure | anti_greedy | overflow | edge | large | degenerate | tricky",
      "description": "≤ 30 字简短描述",
      "expectedRisk": "为什么这个 case 可能触发错误（≤ 80 字）",
      "targetBugType": "边界条件 | 复杂度 | 溢出 | 贪心反例 | 状态转移 | 数据结构不变量 | 输入解析 | 其他",
      "validationMethod": "expected_output | oracle | metamorphic | runtime_only",
      "stdin": "可粘贴的 stdin 字符串（≤ 20 行）",
      "expectedOutput": "validationMethod=expected_output 时填写；否则置空字符串",
      "oracle": {
        "language": "python",
        "code": "validationMethod=oracle 时填写 Python3 朴素解；否则置空字符串"
      },
      "metamorphic": {
        "transformedStdin": "validationMethod=metamorphic 时填写变形后的 stdin；否则置空字符串",
        "relation": "same_output | different_output",
        "expectedRelation": "这个变形关系为什么成立（≤ 80 字）"
      }
    }
  ]
}

⚠ candidates 至少 1 个、最多 5 个；按攻击力和可验证性排序（最强且最可靠放第一）。
直接输出 JSON。`,
  };
}

/** Step 3 prompt：解释者 — 用学生听得懂的话做归因 */
export function buildExplainerPrompt(args: {
  ctx: HackChainContext;
  attackerHypothesis: string;
  winningCandidate: AttackerCandidate;
  executorResult: ExecutorRunResult;
}): PromptPair {
  const stderrBlock = args.executorResult.stderr.trim()
    ? `\n【实际 stderr】\n${args.executorResult.stderr.slice(0, 600)}`
    : '';
  const stdoutBlock = args.executorResult.stdout.trim()
    ? `\n【实际 stdout】\n${args.executorResult.stdout.slice(0, 200)}`
    : '';
  return {
    system:
      `${SYSTEM_CODING_COACH}\n\n你是【解释者 Agent】，多 agent 协作的第三步。前面两个 agent 已经构造并验证了一个能挂掉学生代码的 case，现在你要用学生听得懂的话解释**为什么挂**——目的是教学，不是炫技。${SYSTEM_JSON_OUTPUT}`,
    user: `【题目】${args.ctx.problem.title}
${clip(args.ctx.problem.statement, STATEMENT_MAX)}
${args.ctx.problem.constraints ? '【约束】' + clip(args.ctx.problem.constraints, CONSTRAINTS_MAX) : ''}

【学生 ${args.ctx.language} 代码】
\`\`\`${args.ctx.language}
${args.ctx.code.slice(0, 3500)}
\`\`\`

【攻击者的假设】
${args.attackerHypothesis}

【成功 hack 的 case】
描述：${args.winningCandidate.description}
攻击意图：${args.winningCandidate.expectedRisk ?? '未提供'}
目标 bug 类型：${args.winningCandidate.targetBugType ?? '未提供'}
验证方法：${args.winningCandidate.validationMethod ?? 'runtime_only'}
stdin（前 200 字）：
${args.winningCandidate.stdin.slice(0, 200)}
${args.winningCandidate.expectedOutput ? `期望输出：${args.winningCandidate.expectedOutput.slice(0, 80)}` : ''}

【执行结果】
exitCode = ${args.executorResult.exitCode}, durationMs = ${args.executorResult.durationMs}
hack 原因：${args.executorResult.reason ?? '未知'}${stderrBlock}${stdoutBlock}

输出严格 JSON：
{
  "diagnosis": "一句话定性结论（≤ 50 字，例：'你的代码在 n=10⁵ 时 TLE'）",
  "rootCause": "根因分析（≤ 100 字，**不要直接给修复代码**，只解释为什么会挂）"
}

直接输出 JSON。`,
  };
}

/** Step 4 prompt：引导者 — 给方向不给答案 */
export function buildFixSuggestorPrompt(args: {
  ctx: HackChainContext;
  attackerHypothesis: string;
  diagnosis: string;
  rootCause: string;
}): PromptPair {
  return {
    system:
      `${SYSTEM_CODING_COACH}\n\n你是【引导者 Agent】，多 agent 协作的最后一步。前三个 agent 已经做了攻击 / 验证 / 解释，现在轮到你引导学生**自己想出修复方向**。绝对不要直接写完整解法代码；用方向提示和苏格拉底式问题。${SYSTEM_JSON_OUTPUT}`,
    user: `【题目】${args.ctx.problem.title}
${clip(args.ctx.problem.statement, STATEMENT_MAX)}

【学生当前 ${args.ctx.language} 代码】
\`\`\`${args.ctx.language}
${args.ctx.code.slice(0, 3500)}
\`\`\`

【攻击者的假设】${args.attackerHypothesis}
【解释者的定性】${args.diagnosis}
【根因】${args.rootCause}

输出严格 JSON：
{
  "direction": "一句话指方向（≤ 60 字，例：'考虑用 HashMap 把查找降到 O(1)'）",
  "hint": "苏格拉底式提示（1-2 个问题，≤ 100 字，引导学生自己想）",
  "conceptKeywords": ["≤ 4 个关键概念，便于 UI 做 chip"]
}

⚠ 不要给完整代码；不要泄露具体写法；只给方向和概念。
直接输出 JSON。`,
  };
}
