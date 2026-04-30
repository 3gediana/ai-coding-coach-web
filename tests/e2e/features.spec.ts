/**
 * 通过暴露的 window.__aiccStore 直接注入数据，验证 UI 反应（不依赖 LLM）。
 *
 * 这一组测试覆盖：
 *   - 注入 trace events → Graph 节点高亮
 *   - 注入 trace events → Stats 仪表板表格行
 *   - 注入 dailyPlan → DailyPlanCard 显示
 *   - openFeynman → FeynmanModal 打开
 *   - setForcedOffline → 飞行模式 chip 出现
 */
import { test, expect } from './fixtures';

test.describe('F. Trace 注入 → Graph 视图', () => {
  test('F1. 注入 5 条 trace（含 DailyPlan 编排链）→ Graph 节点 active', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__aiccStore, { timeout: 10_000 });

    // 注入 5 条 trace 模拟 DailyPlan 编排链
    await page.evaluate(() => {
      const store: any = (window as any).__aiccStore;
      const rec = store.getState().recordAgentTrace;
      const ids = [
        ['decide', 'info', '🤖 学习规划 Agent 启动（3 步编排）'],
        ['perceive', 'info', '[1/3] 学情诊断 Agent · 输入'],
        ['feedback', 'success', '[1/3] 学情诊断 Agent · 输出'],
        ['decide', 'info', '[2/3] 题目筛选 Agent (本地) · 输出'],
        ['feedback', 'success', '[3/3] 计划编排 Agent · 输出'],
      ];
      for (const [kind, level, title] of ids) {
        rec({ kind, level, title });
      }
    });

    // 切 Graph
    await page.locator('button[title="协作拓扑"]').click();

    // 5 个集群可见
    await expect(page.getByText(/编排链/)).toBeVisible();
    // DailyPlan 编排链节点都被推断到了：[1/3] 学情诊断 / [2/3] 题目筛选 / [3/3] 计划编排
    await expect(page.getByText('[1/3] 学情诊断', { exact: true })).toBeVisible();
    await expect(page.getByText('[2/3] 题目筛选', { exact: true })).toBeVisible();
    await expect(page.getByText('[3/3] 计划编排', { exact: true })).toBeVisible();
  });

  test('F2. 注入费曼 trace → Feynman 集群有内容', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__aiccStore, { timeout: 10_000 });

    await page.evaluate(() => {
      const rec = (window as any).__aiccStore.getState().recordAgentTrace;
      rec({
        kind: 'perceive',
        level: 'info',
        title: '费曼/学生 Agent · 听讲（第 1 轮）',
        agentName: 'Feynman/Student',
      });
      rec({
        kind: 'feedback',
        level: 'success',
        title: 'Feynman/Student · 提了 2 个问题',
        agentName: 'Feynman/Student',
      });
      rec({
        kind: 'feedback',
        level: 'success',
        title: 'Feynman/Evaluator · 完成（partial）',
        agentName: 'Feynman/Evaluator',
      });
    });

    await page.locator('button[title="协作拓扑"]').click();
    // Feynman 集群标题里包含"费曼反向教学"
    await expect(page.getByText(/费曼反向教学/)).toBeVisible();
    // AI 学生 / AI 评委 节点出现
    await expect(page.getByText('AI 装菜鸟', { exact: true })).toBeVisible();
    await expect(page.getByText('AI 评委', { exact: true })).toBeVisible();
  });
});

test.describe('G. Stats 视图聚合', () => {
  test('G1. 注入 7 条 trace → Stats 表格按 agentName 聚合', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__aiccStore, { timeout: 10_000 });

    await page.evaluate(() => {
      const rec = (window as any).__aiccStore.getState().recordAgentTrace;
      // AnalyzeCode 3 次（cloud）
      for (let i = 0; i < 3; i++) {
        rec({
          kind: 'perceive',
          level: 'info',
          title: 'AnalyzeCode 启动',
          agentName: 'AnalyzeCode',
          route: 'cloud',
        });
        rec({
          kind: 'feedback',
          level: 'success',
          title: 'AnalyzeCode 完成',
          agentName: 'AnalyzeCode',
          route: 'cloud',
          latencyMs: 5500,
          tokenIn: 800,
          tokenOut: 400,
        });
      }
      // AstDiff 3 次（local）
      for (let i = 0; i < 3; i++) {
        rec({
          kind: 'perceive',
          level: 'info',
          title: 'AST-Light · 结构信号（本地）',
          agentName: 'AstDiff',
        });
      }
      // DailyPlan/Selector 1 次（local）
      rec({
        kind: 'decide',
        level: 'info',
        title: '[2/3] 题目筛选 Agent (本地) · 输出',
        agentName: 'DailyPlan/Selector',
      });
    });

    await page.locator('button[title="仪表板"]').click();

    // 总调用数 = 7 (3 perceive + 3 feedback for analyze + 3 ast + 1 selector + 0 perceive for analyze... wait let me recount)
    // AnalyzeCode: 3 perceive + 3 feedback = 6
    // AstDiff: 3 perceive = 3
    // DailyPlan/Selector: 1 = 1
    // Total = 10
    // 但本地/云端：cloud=6 (analyze 路由有 route='cloud'); local=0 (没人填 route='fast'); errors=0
    // 总调用必须显示 10
    await expect(page.locator('text=总调用').locator('..').locator('text=10')).toBeVisible({ timeout: 5000 });
    // AnalyzeCode 行（×6）出现
    await expect(page.getByText('AnalyzeCode', { exact: true })).toBeVisible();
    // AstDiff 行（×3）出现
    await expect(page.getByText('AstDiff', { exact: true })).toBeVisible();
  });
});

test.describe('H. DailyPlanCard 渲染', () => {
  test('H1. 注入 dailyPlan → 顶部居中浮起 pending 卡', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__aiccStore, { timeout: 10_000 });

    await page.evaluate(() => {
      const set = (window as any).__aiccStore.setState;
      const today = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();
      set({
        dailyPlan: {
          id: 'test-plan',
          date: today,
          generatedAt: Date.now(),
          status: 'pending',
          completedStepIndices: [],
          diagnosis: {
            weakConcepts: ['DP', '滑动窗口'],
            strengths: ['贪心'],
            todayFocus: '今天主攻动态规划',
          },
          candidates: { newProblems: [], reviewMistakes: [] },
          plan: {
            headline: '今日主攻 DP 入门',
            estimatedMinutes: 45,
            encouragement: '稳一点，把昨天没解决的搞通',
            steps: [
              {
                kind: 'concept-recall',
                title: '复习 dp 状态定义',
                reason: '基础概念回顾',
                estimatedMinutes: 15,
              },
              {
                kind: 'new-problem',
                title: '爬楼梯（leetcode 70）',
                bankId: 'leetcode-70',
                reason: '入门 dp',
                estimatedMinutes: 30,
              },
            ],
          },
        },
      });
    });

    // 卡片应该显示 headline 和按钮
    await expect(page.getByText('今日学习计划')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('今日主攻 DP 入门')).toBeVisible();
    await expect(page.getByRole('button', { name: /接受并开始/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /重新规划/ })).toBeVisible();
  });

  test('H2. 接受 → 折叠为进度条', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__aiccStore, { timeout: 10_000 });

    await page.evaluate(() => {
      const set = (window as any).__aiccStore.setState;
      const today = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();
      set({
        dailyPlan: {
          id: 'test-plan-2',
          date: today,
          generatedAt: Date.now(),
          status: 'accepted',
          acceptedAt: Date.now(),
          completedStepIndices: [],
          diagnosis: { weakConcepts: ['DP'], strengths: [], todayFocus: '' },
          candidates: { newProblems: [], reviewMistakes: [] },
          plan: {
            headline: '今日主攻 DP',
            estimatedMinutes: 30,
            encouragement: '加油',
            steps: [
              {
                kind: 'concept-recall',
                title: '复习 dp',
                reason: 'basics',
                estimatedMinutes: 15,
              },
            ],
          },
        },
      });
    });

    // accepted 状态显示紧凑式进度条
    await expect(page.getByText(/今日计划/)).toBeVisible({ timeout: 5000 });
    // 进度数 0/1 出现
    await expect(page.getByText('0/1')).toBeVisible();
  });
});

test.describe('I. Feynman Modal 打开', () => {
  test('I1. openFeynman 直接调用 → modal 渲染', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__aiccStore, { timeout: 10_000 });

    // 没激活 problem，调 openFeynman 应弹"先激活一道题"提示
    await page.evaluate(() => {
      (window as any).__aiccStore.getState().openFeynman();
    });
    await expect(page.getByText('先激活一道题')).toBeVisible({ timeout: 5000 });
  });

  test('I2. 注入 activeProblem → 费曼 modal 显示对话区', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__aiccStore, { timeout: 10_000 });

    // 直接 setState 注入一道 problem 并激活
    await page.evaluate(() => {
      const store = (window as any).__aiccStore;
      const fakeProblem = {
        id: 'p1',
        title: 'Two Sum 测试题',
        statement: '给定数组 nums 和目标 target，返回两数之和等于 target 的索引。',
        examples: [],
        createdAt: Date.now(),
      };
      store.setState({
        problems: [fakeProblem],
        activeProblemId: 'p1',
      });
      store.getState().openFeynman();
    });

    // FeynmanModal 标题（modal 里）
    await expect(page.getByText(/费曼模式：你来教 AI/)).toBeVisible({ timeout: 5000 });
    // 题目名在 modal 副标题里出现（也有 sidebar/topbar 重复，用 last 拿 modal 那个）
    await expect(page.getByText('Two Sum 测试题').last()).toBeVisible();
    // 中央占位说明
    await expect(page.getByText(/用你自己的话讲解/)).toBeVisible();
  });
});

test.describe('J. AST-Light 提取（store-level）', () => {
  test('J1. extractFeatures 对 n² 代码识别红旗', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__aiccStore, { timeout: 10_000 });

    // 通过 dynamic import 调 extractFeatures（dev 模式可用）
    const result = await page.evaluate(async () => {
      // @ts-ignore
      const mod = await import('/src/core/astLite.ts');
      const code = `#include <bits/stdc++.h>
using namespace std;
int main() {
  int n; cin >> n;
  vector<int> a(n);
  for (int i = 0; i < n; i++) cin >> a[i];
  int target; cin >> target;
  for (int i = 0; i < n; i++) {
    for (int j = i + 1; j < n; j++) {
      if (a[i] + a[j] == target) {
        cout << i << ' ' << j << endl;
        return 0;
      }
    }
  }
}
`;
      return mod.extractFeatures(code, 'cpp');
    });

    expect(result.loops).toBeGreaterThanOrEqual(2);
    expect(result.maxNestingDepth).toBeGreaterThanOrEqual(2);
    expect(result.complexityHint).toContain('O(n');
    // 至少有一条 redFlag（cin 未解绑 / 嵌套循环 / endl）
    expect(result.redFlags.length).toBeGreaterThan(0);
  });
});
