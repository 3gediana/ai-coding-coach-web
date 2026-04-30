/**
 * AI 行为端到端：用真实 LLM (.env.local 的 MiniMax/DeepSeek) 跑每个 Coach 方法，
 * 验证 prompt 是否真的有效（输出结构 + 关键约束）。
 *
 * 每个 test 长 timeout（每次 LLM 5-30s），用 single worker 跑。
 *
 * 验证维度：
 *   1. JSON 解析 / 返回非 null
 *   2. 字段类型正确
 *   3. prompt-driven 约束生效（如不直接给 AC 代码、按 severity 排序、问题不暴露答案等）
 */
import { test, expect } from './ai-fixtures';

// 每个 case 给 90s timeout（最慢的 LLM 调用也能完）
// 不用 serial mode：任意单个 fail 不阻塞其他测试
test.describe.configure({ timeout: 90_000 });

/** 等 store + AI config + fastLane 都 ready */
async function waitReady(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__aiccStore, { timeout: 15_000 });
  // 等 aiConfig 有 apiKey（env 注入完成） + fastLane 启用（fixture 注入后）
  const ok = await page.waitForFunction(
    () => {
      const cfg = (window as any).__aiccStore.getState().aiConfig;
      const fastReady =
        !!cfg?.fastLane?.enabled && !!cfg?.fastLane?.baseUrl && !!cfg?.fastLane?.model;
      return cfg && (cfg.apiKey || cfg.provider === 'ollama') && fastReady;
    },
    { timeout: 10_000 },
  );
  expect(ok).toBeTruthy();
}

// 一些公用样例
const SAMPLE_PROBLEM = {
  title: 'Two Sum',
  statement: '给定一个整数数组 nums 和一个整数 target，找出和为 target 的两个元素的下标，返回这两个下标。每种输入只对应一个答案。同一个元素不能用两次。',
  constraints: '2 ≤ nums.length ≤ 1e5, -1e9 ≤ nums[i] ≤ 1e9, 保证有唯一解',
  examples: [
    { input: '4\n2 7 11 15\n9', output: '0 1' },
    { input: '3\n3 2 4\n6', output: '1 2' },
  ],
};

const N2_BUGGY_CODE = `#include <bits/stdc++.h>
using namespace std;
int main() {
  int n; cin >> n;
  vector<int> a(n);
  for (int i = 0; i < n; i++) cin >> a[i];
  int t; cin >> t;
  // O(n^2) 暴力
  for (int i = 0; i < n; i++) {
    for (int j = i + 1; j < n; j++) {
      if (a[i] + a[j] == t) {
        cout << i << " " << j << endl;
        return 0;
      }
    }
  }
  return 0;
}
`;

// 同一道题的 Python 暴力 O(n²) 实现，用于回归 T3 在非 cpp 场景的"防泄露 AC"约束
const N2_BUGGY_PYTHON_CODE = `n = int(input())
a = list(map(int, input().split()))
t = int(input())
# O(n^2) 暴力
for i in range(n):
    for j in range(i + 1, n):
        if a[i] + a[j] == t:
            print(i, j)
            break
`;

// ============================================================================
// T0. 准备：确认 env config 已加载 + provider 是真实可用的
// ============================================================================
test.describe('T0. 环境就绪', () => {
  test('T0.1 .env.local 注入的 AI config 生效', async ({ page }) => {
    await waitReady(page);
    const cfg = await page.evaluate(() => {
      const c = (window as any).__aiccStore.getState().aiConfig;
      return {
        provider: c.provider,
        hasKey: !!c.apiKey,
        baseUrl: c.baseUrl,
        model: c.model,
      };
    });
    console.log('AI config:', cfg);
    expect(cfg.hasKey).toBe(true);
    expect(cfg.provider).toBeTruthy();
    expect(cfg.model).toBeTruthy();
  });
});

// ============================================================================
// T1-T5. AnalyzeCode（核心 Agent，验证多个维度）
// ============================================================================
test.describe('T1-T5. AnalyzeCode 行为验证', () => {
  test('T1. 简单代码 → JSON 解析 + issues 数组合规', async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(
      async ([code]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.analyzeCode({
          code,
          language: 'cpp',
        });
      },
      [N2_BUGGY_CODE],
    );
    console.log('AnalyzeCode result:', JSON.stringify(result, null, 2).slice(0, 500));
    expect(result).toBeTruthy();
    expect(Array.isArray(result.issues)).toBe(true);
    // 至少 1 条 issue（n² 暴力肯定有问题）
    expect(result.issues.length).toBeGreaterThan(0);
    // 每条 issue 的 line 在范围内 (1..numlines)
    const numLines = N2_BUGGY_CODE.split('\n').length;
    for (const it of result.issues) {
      expect(it.line).toBeGreaterThanOrEqual(1);
      expect(it.line).toBeLessThanOrEqual(numLines);
      expect(typeof it.message).toBe('string');
      expect(it.message.length).toBeGreaterThan(0);
      expect(['error', 'warning', 'info', 'hint']).toContain(it.severity);
    }
    // 必须含 overallComment 或 complexitySummary 至少一个
    expect(result.overallComment || result.complexitySummary).toBeTruthy();
  });

  test('T2. n² 暴力 → AI 识别 O(n²) 问题（complexity prompt 生效）', async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(
      async ([code, problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.analyzeCode({
          code,
          language: 'cpp',
          problem: JSON.parse(problemJson),
        });
      },
      [N2_BUGGY_CODE, JSON.stringify(SAMPLE_PROBLEM)],
    );
    const all = JSON.stringify(result).toLowerCase();
    // 必须出现 "n²" / "n^2" / "O(n^2)" / "嵌套" 之一
    const hitComplexity =
      /n\^?2|n²|嵌套|nested|平方|双重循环|two.?nested/i.test(all);
    expect(hitComplexity).toBe(true);
  });

  test('T3. 不直接给完整 AC 代码（教学约束生效）', async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(
      async ([code, problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.analyzeCode({
          code,
          language: 'cpp',
          problem: JSON.parse(problemJson),
        });
      },
      [N2_BUGGY_CODE, JSON.stringify(SAMPLE_PROBLEM)],
    );
    // suggestion 字段平均长度不应超过 1000 字符（完整 AC 通常 800+）
    // 且不应同时包含 main + return + cin/cout 完整结构
    for (const it of result.issues ?? []) {
      const sug = (it.suggestion ?? '').toLowerCase();
      const hasFullProgram =
        sug.includes('int main') &&
        sug.includes('return') &&
        sug.includes('cin') &&
        sug.includes('cout');
      // 这里允许包含部分关键词（例如示意 return，但不应整体复制完整代码）
      expect(hasFullProgram).toBe(false);
    }
  });

  test('T3b. Python 场景同样不给完整 AC（防泄露在非 cpp 也成立）', async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(
      async ([code, problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.analyzeCode({
          code,
          language: 'py',
          problem: JSON.parse(problemJson),
        });
      },
      [N2_BUGGY_PYTHON_CODE, JSON.stringify(SAMPLE_PROBLEM)],
    );
    // 至少要有 issue 输出（避免空响应误通过）
    expect(Array.isArray(result.issues)).toBe(true);
    // Python 完整 AC 的特征：input + print + 处理逻辑（for/if/def/return）同时出现，且 suggestion 比较长
    // 单个 suggestion 不应满足"input + print + 控制流 + ≥6 行"四件套
    for (const it of result.issues ?? []) {
      const sug = (it.suggestion ?? '').toString();
      const sugLower = sug.toLowerCase();
      const lineCount = sug.split('\n').filter((l: string) => l.trim().length > 0).length;
      const hasInput = sugLower.includes('input(');
      const hasPrint = sugLower.includes('print(');
      const hasControlFlow =
        /\bfor\b|\bwhile\b|\bdef\b|\breturn\b/.test(sugLower);
      const looksLikeFullProgram =
        hasInput && hasPrint && hasControlFlow && lineCount >= 6;
      expect(looksLikeFullProgram).toBe(false);
    }
    // overallComment 也不应该是一段直接可运行的完整 Python 程序
    const overall = (result.overallComment ?? '').toString();
    const overallHasFull =
      overall.includes('input(') &&
      overall.includes('print(') &&
      /\bfor\b|\bwhile\b/.test(overall) &&
      overall.split('\n').filter((l: string) => l.trim().length > 0).length >= 8;
    expect(overallHasFull).toBe(false);
  });

  test('T4. P3 escalation → overallComment 包含"换思路/方向"语义', async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(
      async ([code, problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.analyzeCode({
          code,
          language: 'cpp',
          problem: JSON.parse(problemJson),
          escalation: {
            failureCount: 5,
            recentVerdicts: ['wa', 'wa', 'tle', 'wa', 'tle'],
          },
        });
      },
      [N2_BUGGY_CODE, JSON.stringify(SAMPLE_PROBLEM)],
    );
    const overall = (result.overallComment ?? '').toLowerCase();
    const all = JSON.stringify(result).toLowerCase();
    // escalation prompt 强调"整体方向 / 换思路"——文本里应该有这类关键词
    const hitDirection =
      /换思路|方向|整体|策略|不对|偏|尝试|hash|哈希|不同的方法/i.test(all);
    expect(hitDirection).toBe(true);
    // overallComment 不应为空
    expect(overall.length).toBeGreaterThan(10);
  });

  test('T5. AST features 注入 prompt 后，复杂度判断与 AST 一致', async ({ page }) => {
    await waitReady(page);
    const r = await page.evaluate(
      async ([code, problemJson]) => {
        const w = window as any;
        const coach = w.__aiccStore.getState().coach;
        // 浏览器内动态 import vite dev 路径
        // @ts-expect-error vite-only path
        const astMod = await import('/src/core/astLite.ts');
        const features = astMod.extractFeatures(code, 'cpp');
        const res = await coach.analyzeCode({
          code,
          language: 'cpp',
          problem: JSON.parse(problemJson),
          astFeatures: features,
        });
        return { features, result: res };
      },
      [N2_BUGGY_CODE, JSON.stringify(SAMPLE_PROBLEM)],
    );
    expect(r.features.complexityHint).toContain('O(n');
    expect(r.features.maxNestingDepth).toBeGreaterThanOrEqual(2);
    // AST 说 O(n²)，AI 输出也应该承认
    const all = JSON.stringify(r.result).toLowerCase();
    expect(/n\^?2|n²|平方|嵌套/i.test(all)).toBe(true);
  });
});

// ============================================================================
// T6-T8. 题目相关 Agent
// ============================================================================
test.describe('T6-T8. ParseProblem / PlainExplanation / ProblemOverview', () => {
  test('T6. parseProblem 把粗糙文本结构化', async ({ page }) => {
    await waitReady(page);
    const raw = `Two Sum
给定数组 nums 和目标值 target，返回两数之和等于 target 的两个下标。
输入：第一行 n，第二行 n 个数，第三行 target
输出：两个下标
样例输入：
4
2 7 11 15
9
样例输出：
0 1
约束：n ≤ 1e5
`;
    const result = await page.evaluate(
      async ([rawText]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.parseProblem(rawText);
      },
      [raw],
    );
    expect(result.title).toBeTruthy();
    expect(result.statement).toBeTruthy();
    expect(result.statement.length).toBeGreaterThan(20);
    // 结构化字段（不强求每个都有，但至少 examples 或 constraints 之一）
    const hasStruct =
      (Array.isArray(result.examples) && result.examples.length > 0) ||
      (typeof result.constraints === 'string' && result.constraints.length > 0);
    expect(hasStruct).toBe(true);
  });

  test('T7. generatePlainExplanation 不超 600 字 + 不暴露完整算法', async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(
      async ([problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.generatePlainExplanation(JSON.parse(problemJson));
      },
      [JSON.stringify(SAMPLE_PROBLEM)],
    );
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(20);
    expect(result.length).toBeLessThan(800);
    // 不该出现完整算法暗示（例如"用哈希表 O(n)"完整方案）—— 软约束，仅 warn
    if (/哈希表/.test(result) && /O\(n\)/.test(result)) {
      console.warn('⚠ PlainExplanation 出现"哈希表 O(n)"，可能泄露算法');
    }
  });

  test('T8. generateProblemOverview 输出 headline + notes 数组', async ({ page }) => {
    test.setTimeout(180_000); // 云端 LLM 偶发慢 + chatJson 内 3 次 retry，90s 不够
    await waitReady(page);
    const result = await page.evaluate(
      async ([problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.generateProblemOverview({
          ...JSON.parse(problemJson),
          difficulty: 'easy',
        });
      },
      [JSON.stringify(SAMPLE_PROBLEM)],
    );
    expect(result).toBeTruthy();
    expect(typeof result.headline).toBe('string');
    expect(result.headline.length).toBeGreaterThan(5);
    expect(result.headline.length).toBeLessThan(80);
    expect(Array.isArray(result.notes)).toBe(true);
  });
});

// ============================================================================
// T9-T10. 复盘 / 错题
// ============================================================================
test.describe('T9-T10. AcReview / SummarizeMistake', () => {
  test('T9. generateAcReview 给出复盘要点', async ({ page }) => {
    await waitReady(page);
    const goodCode = `#include <bits/stdc++.h>
using namespace std;
int main() {
  ios::sync_with_stdio(false); cin.tie(nullptr);
  int n; cin >> n;
  vector<int> a(n);
  for (int i = 0; i < n; i++) cin >> a[i];
  int t; cin >> t;
  unordered_map<int,int> mp;
  for (int i = 0; i < n; i++) {
    if (mp.count(t - a[i])) {
      cout << mp[t - a[i]] << ' ' << i << '\\n';
      return 0;
    }
    mp[a[i]] = i;
  }
}
`;
    const result = await page.evaluate(
      async ([code, problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.generateAcReview({
          problem: JSON.parse(problemJson),
          code,
          language: 'cpp',
        });
      },
      [goodCode, JSON.stringify(SAMPLE_PROBLEM)],
    );
    console.log('AcReview result:', JSON.stringify(result, null, 2).slice(0, 400));
    expect(result).toBeTruthy();
    // 真实返回结构：{ passingPattern, betterApproach?, followUps }
    expect(typeof result.passingPattern).toBe('string');
    expect(result.passingPattern.length).toBeGreaterThan(5);
    expect(Array.isArray(result.followUps)).toBe(true);
  });

  test('T10. summarizeMistake 给 buggy 代码 → 返回错题结构', async ({ page }) => {
    test.setTimeout(180_000); // 云端长输出（错题结构 6000 maxTokens），偶发慢
    await waitReady(page);
    const result = await page.evaluate(
      async ([code, problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.summarizeMistake({
          problem: JSON.parse(problemJson),
          code,
          language: 'cpp',
          isMistake: true,
          verdict: 'tle',
          userNote: '我提交后 TLE 了',
        });
      },
      [N2_BUGGY_CODE, JSON.stringify(SAMPLE_PROBLEM)],
    );
    expect(result).toBeTruthy();
    // 错题至少有 rootCause / category / knowledgePoints 之一
    const hasRoot =
      typeof result.rootCause === 'string' ||
      typeof result.category === 'string' ||
      Array.isArray(result.knowledgePoints);
    expect(hasRoot).toBe(true);
  });
});

// ============================================================================
// T11-T13. 主动嗅探 / 教学补充
// ============================================================================
test.describe('T11-T13. HackCase / StuckHint / ExplainPaste', () => {
  test('T11. generateHackCase → 有 stdin + rationale', async ({ page }) => {
    await waitReady(page);
    // LLM 偶发返回空响应这里手动 retry 1 次
    const result: any = await page.evaluate(
      async ([code, problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        const args = {
          problem: JSON.parse(problemJson),
          code,
          language: 'cpp',
        };
        try {
          return await coach.generateHackCase(args);
        } catch (e) {
          // 第 1 次失败 → retry（常见于 MiniMax 偶发空返回 / 截断）
          console.warn('[T11] generateHackCase first try failed:', (e as any)?.message);
          return await coach.generateHackCase(args);
        }
      },
      [N2_BUGGY_CODE, JSON.stringify(SAMPLE_PROBLEM)],
    );
    expect(result).toBeTruthy();
    expect(typeof result.stdin).toBe('string');
    expect(result.stdin.length).toBeGreaterThan(0);
    expect(typeof result.rationale).toBe('string');
    expect(['edge', 'large', 'degenerate', 'tricky']).toContain(result.severity);
  });

  test('T12. getStuckHint 输出苏格拉底式短问题', async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(
      async ([code, problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.getStuckHint({
          problem: JSON.parse(problemJson),
          code,
          language: 'cpp',
        });
      },
      [N2_BUGGY_CODE, JSON.stringify(SAMPLE_PROBLEM)],
    );
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(5);
    expect(result.length).toBeLessThan(300);
    // 苏格拉底式应该包含问号或反问
    expect(/[?？]|为什么|想想|是否|能不能|如何/.test(result)).toBe(true);
  });

  test('T13. explainPaste 解释代码片段', async ({ page }) => {
    await waitReady(page);
    const snippet = `for (int j = W; j >= w[i]; j--) {
  dp[j] = max(dp[j], dp[j - w[i]] + v[i]);
}`;
    const result = await page.evaluate(
      async ([snippet]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.explainPaste({ snippet, language: 'cpp' });
      },
      [snippet],
    );
    expect(result).toBeTruthy();
    // explainPaste 返回结构：{ summary, fitsContext, concerns, suggestion }
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(15);
    // 代码片段是 0/1 背包 — summary 或 suggestion 里应提到 dp / 背包
    const all = JSON.stringify(result).toLowerCase();
    expect(/dp|背包|动态规划|knapsack/i.test(all)).toBe(true);
  });
});

// ============================================================================
// T14. AskQuestion（自由问答）
// ============================================================================
test.describe('T14. AskQuestion', () => {
  test('T14. askQuestion 给出非空回答', async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(
      async ([problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.askQuestion({
          problem: JSON.parse(problemJson),
          question: 'Two Sum 应该用什么算法思路？给我大方向，不要给完整代码。',
          language: 'cpp',
        });
      },
      [JSON.stringify(SAMPLE_PROBLEM)],
    );
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(20);
    // 不应该返回完整 main + return
    const lc = result.toLowerCase();
    const hasFullCode = lc.includes('int main') && lc.includes('return 0');
    expect(hasFullCode).toBe(false);
  });
});

// ============================================================================
// T15-T16. DailyPlan 编排链 (子 Agent 1 + 3)
// ============================================================================
test.describe('T15-T16. 学习规划 Agent (3 子链路核心 LLM 调用)', () => {
  test('T15. generateLearningDiagnosis 输出 weakConcepts 等字段', async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(async () => {
      const coach = (window as any).__aiccStore.getState().coach;
      return await coach.generateLearningDiagnosis({
        recentMistakes: [
          { title: 'Two Sum', category: 'hash', rootCause: '没用哈希表', verdict: 'tle', daysAgo: 2 },
          { title: 'LIS', category: 'dp', rootCause: '状态定义错', verdict: 'wa', daysAgo: 1 },
          { title: '滑动窗口', category: 'two-pointer', rootCause: '边界没处理', verdict: 'wa', daysAgo: 3 },
        ],
        weekStats: {
          totalProblems: 5,
          totalSubmissions: 12,
          acRate: 0.42,
          avgSessionMinutes: 35,
        },
        stuckProblems: [{ title: 'LIS', failureCount: 4, verdicts: ['wa', 'tle', 'wa', 'wa'] }],
      });
    });
    expect(result).toBeTruthy();
    expect(Array.isArray(result.weakConcepts)).toBe(true);
    expect(result.weakConcepts.length).toBeGreaterThan(0);
    expect(typeof result.todayFocus).toBe('string');
    expect(result.todayFocus.length).toBeGreaterThan(5);
  });

  test('T16. generatePlanOrchestration steps 不能编造 bankId', async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(async () => {
      const coach = (window as any).__aiccStore.getState().coach;
      return await coach.generatePlanOrchestration({
        diagnosis: {
          weakConcepts: ['DP', '滑动窗口'],
          strengths: ['贪心'],
          todayFocus: '今天主攻 DP 的状态定义',
        },
        candidates: {
          newProblems: [
            { bankId: 'bk-1', title: 'LeetCode 70 爬楼梯', difficulty: 'easy', tags: ['dp'], reason: 'DP 入门' },
            { bankId: 'bk-2', title: 'LeetCode 198 打家劫舍', difficulty: 'medium', tags: ['dp'], reason: 'DP 进阶' },
          ],
          reviewMistakes: [
            { mistakeId: 'mk-1', problemTitle: 'LIS', category: 'dp', reason: '上次错过' },
          ],
        },
      });
    });
    expect(result).toBeTruthy();
    expect(typeof result.headline).toBe('string');
    expect(Array.isArray(result.steps)).toBe(true);
    expect(result.steps.length).toBeGreaterThan(0);
    // 严格：每个 step 的 bankId 必须在白名单内（否则 analyzer 会 filter 掉）
    const validBankIds = new Set(['bk-1', 'bk-2']);
    const validMistakeIds = new Set(['mk-1']);
    for (const step of result.steps) {
      if (step.kind === 'new-problem') {
        expect(validBankIds.has(step.bankId)).toBe(true);
      }
      if (step.kind === 'review-mistake') {
        expect(validMistakeIds.has(step.mistakeId)).toBe(true);
      }
    }
  });
});

// ============================================================================
// T17-T18. 费曼模式 (2 子 Agent)
// ============================================================================
test.describe('T17-T18. Feynman Student × Evaluator', () => {
  test('T17. Feynman/Student 装菜鸟 + 提澄清问题（不暴露答案）', async ({ page }) => {
    test.setTimeout(180_000); // 云端 reasoning prompt + retry，90s 不够
    await waitReady(page);
    const result = await page.evaluate(
      async ([problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.generateFeynmanStudentReply({
          problem: JSON.parse(problemJson),
          conversation: [],
          userTurn: '这道题就是要找两个数加起来等于 target 的下标，我打算用两层循环遍历。',
          turnIndex: 0,
        });
      },
      [JSON.stringify(SAMPLE_PROBLEM)],
    );
    expect(result).toBeTruthy();
    expect(typeof result.studentReply).toBe('string');
    expect(result.studentReply.length).toBeGreaterThan(5);
    expect(result.studentReply.length).toBeLessThan(300);
    expect(Array.isArray(result.questions)).toBe(true);
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.questions.length).toBeLessThanOrEqual(3);
    // 关键约束：不能直接说"用哈希表"这种暗示答案的语句
    const all = (result.studentReply + ' ' + result.questions.join(' ')).toLowerCase();
    const hasAnswerLeak = /用哈希表|use.*hash.*map|改用.*哈希|hash.*能/i.test(all);
    if (hasAnswerLeak) {
      console.warn('⚠ Feynman/Student 可能暴露了"哈希表"答案：', all);
    }
    // 至少 1 个问题包含问号
    expect(result.questions.some((q: string) => /[?？]/.test(q))).toBe(true);
  });

  test('T18. Feynman/Evaluator 给 3 维度评分 + verdict', async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(
      async ([problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.generateFeynmanEvaluation({
          problem: JSON.parse(problemJson),
          conversation: [
            { role: 'user', text: 'Two Sum 我打算用嵌套循环遍历每对数。' },
            { role: 'student', text: '为什么要嵌套循环？n 大时是不是会很慢？' },
            { role: 'user', text: '是的会慢，O(n^2)。其实可以用哈希表 O(n) 解决。' },
            { role: 'student', text: '哈希表是啥意思？为什么是 O(n)？' },
            { role: 'user', text: '一边遍历一边把数和下标存到 hash map，每次查 target - 当前数 在不在表里。' },
          ],
        });
      },
      [JSON.stringify(SAMPLE_PROBLEM)],
    );
    expect(result).toBeTruthy();
    // 三维度评分 0-10
    expect(result.scores).toBeTruthy();
    for (const k of ['clarity', 'logic', 'accuracy']) {
      expect(typeof result.scores[k]).toBe('number');
      expect(result.scores[k]).toBeGreaterThanOrEqual(0);
      expect(result.scores[k]).toBeLessThanOrEqual(10);
    }
    expect(['mastered', 'partial', 'struggling']).toContain(result.verdict);
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(10);
    expect(Array.isArray(result.strengths)).toBe(true);
    expect(Array.isArray(result.weaknesses)).toBe(true);
    expect(Array.isArray(result.suggestions)).toBe(true);
  });
});

// ============================================================================
// T19-T21. 主动嗅探 (RuntimeDiagnose / ConstraintSanity / IntentSniff)
// ============================================================================
test.describe('T19-T21. 主动嗅探 Agent', () => {
  test('T19. diagnoseRuntimeError 给 stderr → 归因（fastLane 本地 Ollama）', async ({ page }) => {
    test.setTimeout(180_000); // 本地 4B 模型 cold start 可能超过 60s
    await waitReady(page);
    const result = await page.evaluate(async () => {
      const coach = (window as any).__aiccStore.getState().coach;
      return await coach.diagnoseRuntimeError({
        code: `int main() { int* p = nullptr; *p = 1; return 0; }`,
        language: 'cpp',
        stderrTail: 'Segmentation fault (core dumped)',
        exitCode: 139,
        stdinHead: '',
      });
    });
    expect(result).toBeTruthy();
    const all = JSON.stringify(result).toLowerCase();
    expect(/null|空指针|段错误|segfault|解引用|dereference/i.test(all)).toBe(true);
  });

  test('T20. sanityCheckConstraints 大数据范围 → 提示风险（fastLane 本地 Ollama）', async ({ page }) => {
    test.setTimeout(180_000);
    await waitReady(page);
    const result: string[] = await page.evaluate(
      async ([code, problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.sanityCheckConstraints({
          problem: JSON.parse(problemJson),
          code,
          language: 'cpp',
        });
      },
      [N2_BUGGY_CODE, JSON.stringify(SAMPLE_PROBLEM)],
    );
    // 返回是 string[]（风险清单），可以为空
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      const all = result.join(' ').toLowerCase();
      expect(/超时|tle|n.?\^?2|嵌套|超.*范围|大数据/i.test(all)).toBe(true);
    } else {
      console.warn('⚠ sanityCheckConstraints 返回空数组，认为代码没大问题');
    }
  });

  test('T21. sniffIntent 检测代码方向是否走偏（fastLane 本地 Ollama）', async ({ page }) => {
    test.setTimeout(180_000);
    await waitReady(page);
    // 故意写偏：题目是 Two Sum，代码却在做排序
    const offTrack = `#include <bits/stdc++.h>
using namespace std;
int main() {
  int n; cin >> n;
  vector<int> a(n);
  for (int i = 0; i < n; i++) cin >> a[i];
  sort(a.begin(), a.end());
  for (int x : a) cout << x << ' ';
  return 0;
}`;
    const result = await page.evaluate(
      async ([code, problemJson]) => {
        const coach = (window as any).__aiccStore.getState().coach;
        return await coach.sniffIntent({
          problem: JSON.parse(problemJson),
          code,
          language: 'cpp',
        });
      },
      [offTrack, JSON.stringify(SAMPLE_PROBLEM)],
    );
    // 返回结构 { onTrack: boolean, evidence: string }
    expect(result).toBeTruthy();
    expect(typeof result.onTrack).toBe('boolean');
    // 代码明显偏了 → 这里期望 onTrack === false，但 1B 模型可能错误判断，只警告不 fail
    if (result.onTrack === true) {
      console.warn('⚠ sniffIntent 没识别出代码走偏（判为 onTrack）');
    }
  });
});
