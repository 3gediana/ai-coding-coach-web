/**
 * Demo seed：一键注入 5 道经典题 + 错题本 + 7 天学习记录 + 多版本代码文件。
 *
 * 使用方式：
 *   1. 直接访问 http://localhost:5173/?seed=demo
 *   2. 自动清空 IndexedDB → 写入 seed → reload 进入主界面
 *
 * 设计目标（参赛演示）：
 *   - Dashboard 立刻有数据：连续 7 天 streak、通过率、错题、用时分布、薄弱 tag = DP
 *   - 错题本两道：一道已复习、一道未复习（演示复习闭环）
 *   - 题 2 留一份「跑通样例但有 bug」的代码 → 一进就能演示主动 hack case
 *   - 题 1 / 3 是 AC 完成版 → 可演示 AC 总结链路
 *   - 全部数据本地，不依赖网络，不依赖油猴
 */
import { storage } from './storage';
import type {
  CodeFile,
  Mistake,
  Problem,
  Session,
  CoachEvent,
} from '../core/types';

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(ts: number, offsetDays = 0): number {
  const d = new Date(ts - offsetDays * DAY);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

interface SeedFile {
  id: string;
  name: string;
  language: 'cpp' | 'c' | 'python';
  content: string;
  pinned?: boolean;
}

interface SeedProblem extends Problem {
  files: SeedFile[];
}

function buildSeedProblems(now: number): SeedProblem[] {
  return [
    {
      id: 'demo-two-sum',
      title: '两数之和',
      statement:
        '给定整数数组 `nums` 和目标值 `target`，找出使其相加等于 `target` 的两个不同下标 `i, j`（`i < j`），输出 `i j`。\n\n如果有多组解，输出任意一组即可。',
      inputFormat: '第 1 行 n target；第 2 行 n 个整数 nums[i]',
      outputFormat: '一行两个整数 i j',
      constraints: '2 ≤ n ≤ 10^4\n−10^9 ≤ nums[i] ≤ 10^9\n保证至少有一组解',
      examples: [
        {
          input: '4 9\n2 7 11 15',
          output: '0 1',
          explanation: 'nums[0]+nums[1] = 2+7 = 9',
        },
      ],
      tags: ['数组', '哈希', '入门'],
      difficulty: 'easy',
      createdAt: now - 7 * DAY,
      files: [
        {
          id: 'f-twosum-1',
          name: 'main.cpp',
          language: 'cpp',
          content: `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n, target;
    cin >> n >> target;
    vector<int> a(n);
    unordered_map<int,int> idx;
    for (int i = 0; i < n; i++) cin >> a[i];
    for (int i = 0; i < n; i++) {
        int need = target - a[i];
        if (idx.count(need)) {
            cout << idx[need] << " " << i << "\\n";
            return 0;
        }
        idx[a[i]] = i;
    }
    return 0;
}
`,
          pinned: true,
        },
      ],
    },
    {
      id: 'demo-lis',
      title: '最长上升子序列',
      statement:
        '给定长度为 n 的整数序列，求**严格上升**的最长子序列长度。',
      inputFormat: '第 1 行 n；第 2 行 n 个整数',
      outputFormat: '一行一个整数：最长严格上升子序列的长度',
      constraints: '1 ≤ n ≤ 10^5\n−10^9 ≤ a[i] ≤ 10^9',
      examples: [
        {
          input: '6\n1 7 3 5 9 4',
          output: '4',
          explanation: '1 3 5 9（或 1 3 4 9） 长度为 4',
        },
      ],
      tags: ['DP', '二分'],
      difficulty: 'medium',
      createdAt: now - 5 * DAY,
      files: [
        {
          id: 'f-lis-buggy',
          name: 'main.cpp',
          language: 'cpp',
          content: `#include <bits/stdc++.h>
using namespace std;

// 留一个微妙 bug：用了 lower_bound 但算的是「非严格上升」
// 跑给的 sample 6 1 7 3 5 9 4 时输出 4，看起来对
// 但遇到 [1 1 1 1] 等含重复值的 case 会算成 4，正确答案应是 1
int main() {
    int n;
    cin >> n;
    vector<int> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];
    vector<int> dp;
    for (int x : a) {
        auto it = upper_bound(dp.begin(), dp.end(), x); // ← 应该是 lower_bound
        if (it == dp.end()) dp.push_back(x);
        else *it = x;
    }
    cout << dp.size() << "\\n";
    return 0;
}
`,
          pinned: true,
        },
      ],
    },
    {
      id: 'demo-max-subarray',
      title: '最大子段和',
      statement:
        '给定一个整数序列 a，找出连续子段使和最大，输出该最大和（子段不能为空）。',
      inputFormat: '第 1 行 n；第 2 行 n 个整数',
      outputFormat: '一行一个整数：最大子段和',
      constraints: '1 ≤ n ≤ 2×10^5\n−10^4 ≤ a[i] ≤ 10^4',
      examples: [
        {
          input: '8\n-2 1 -3 4 -1 2 1 -5',
          output: '6',
          explanation: '子段 [4,-1,2,1] 的和为 6',
        },
      ],
      tags: ['DP', '入门'],
      difficulty: 'medium',
      createdAt: now - 4 * DAY,
      files: [
        {
          id: 'f-maxsub-1',
          name: 'main.cpp',
          language: 'cpp',
          content: `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    cin >> n;
    long long ans = LLONG_MIN, cur = 0;
    for (int i = 0; i < n; i++) {
        long long x; cin >> x;
        cur = max(x, cur + x);
        ans = max(ans, cur);
    }
    cout << ans << "\\n";
    return 0;
}
`,
          pinned: true,
        },
      ],
    },
    {
      id: 'demo-sliding-window',
      title: '滑动窗口最大值',
      statement:
        '给定长度为 n 的数组和窗口宽度 k，输出每个长度为 k 的连续窗口的最大值，共 n−k+1 个。',
      inputFormat: '第 1 行 n k；第 2 行 n 个整数',
      outputFormat: '一行 n−k+1 个整数，空格分隔',
      constraints: '1 ≤ k ≤ n ≤ 10^6\n|a[i]| ≤ 10^9',
      examples: [
        {
          input: '8 3\n1 3 -1 -3 5 3 6 7',
          output: '3 3 5 5 6 7',
        },
      ],
      tags: ['单调队列', '数据结构'],
      difficulty: 'medium',
      createdAt: now - 2 * DAY,
      files: [
        {
          id: 'f-window-1',
          name: 'main.cpp',
          language: 'cpp',
          content: `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n, k;
    cin >> n >> k;
    vector<int> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];
    deque<int> dq;
    for (int i = 0; i < n; i++) {
        while (!dq.empty() && a[dq.back()] <= a[i]) dq.pop_back();
        dq.push_back(i);
        if (dq.front() <= i - k) dq.pop_front();
        if (i >= k - 1) cout << a[dq.front()] << " \\n"[i == n - 1];
    }
    return 0;
}
`,
          pinned: true,
        },
      ],
    },
    {
      id: 'demo-knapsack',
      title: '0/1 背包',
      statement:
        '有 n 件物品和容量为 W 的背包，第 i 件物品体积为 w[i]，价值为 v[i]，每件最多取 1 次。求能装入背包的最大总价值。',
      inputFormat: '第 1 行 n W；接下来 n 行，每行两个整数 w[i] v[i]',
      outputFormat: '一行一个整数：最大价值',
      constraints: '1 ≤ n ≤ 10^3\n1 ≤ W ≤ 10^4\n1 ≤ w[i], v[i] ≤ 10^4',
      examples: [
        {
          input: '4 5\n2 3\n3 4\n4 5\n5 6',
          output: '7',
          explanation: '取前两件，体积 2+3=5，价值 3+4=7',
        },
      ],
      tags: ['DP', '背包'],
      difficulty: 'hard',
      createdAt: now - 2 * DAY,
      files: [
        {
          id: 'f-knapsack-buggy',
          name: 'main.cpp',
          language: 'cpp',
          content: `#include <bits/stdc++.h>
using namespace std;

// bug：内层循环写成正向了 → 每个物品被多次选中 → 实质变成完全背包
// sample 输入下答案恰好也是 7（巧合），但 [2,3] 这种容量稍大就会爆
int main() {
    int n, W;
    cin >> n >> W;
    vector<int> dp(W + 1, 0);
    for (int i = 0; i < n; i++) {
        int w, v;
        cin >> w >> v;
        for (int j = w; j <= W; j++) { // ← 应该 j 从 W 倒序到 w
            dp[j] = max(dp[j], dp[j - w] + v);
        }
    }
    cout << dp[W] << "\\n";
    return 0;
}
`,
          pinned: true,
        },
      ],
    },
  ];
}

function buildSeedSessions(now: number, problems: SeedProblem[]): Session[] {
  // 最近 7 天，每天一个 session，构造 streak=7 + 通过率约 71%（5/7）
  const map = Object.fromEntries(problems.map((p) => [p.id, p]));
  const plan: Array<{
    days: number;
    pid: string;
    outcome: 'pass' | 'mistake';
    minutes: number;
    analyze: number;
    hint: number;
  }> = [
    { days: 6, pid: 'demo-two-sum', outcome: 'pass', minutes: 8, analyze: 1, hint: 0 },
    { days: 5, pid: 'demo-max-subarray', outcome: 'pass', minutes: 12, analyze: 1, hint: 0 },
    { days: 4, pid: 'demo-lis', outcome: 'mistake', minutes: 18, analyze: 2, hint: 1 },
    { days: 3, pid: 'demo-lis', outcome: 'pass', minutes: 9, analyze: 1, hint: 0 },
    { days: 2, pid: 'demo-knapsack', outcome: 'mistake', minutes: 22, analyze: 2, hint: 2 },
    { days: 1, pid: 'demo-sliding-window', outcome: 'pass', minutes: 14, analyze: 1, hint: 0 },
    { days: 0, pid: 'demo-two-sum', outcome: 'pass', minutes: 6, analyze: 0, hint: 0 },
  ];
  return plan.map((row, i) => {
    const startedAt = startOfDay(now, row.days);
    const effectiveMs = row.minutes * 60_000;
    const p = map[row.pid];
    const file = p?.files[0];
    return {
      id: `demo-session-${i}-${row.pid}`,
      problemId: row.pid,
      problemTitle: p?.title,
      startedAt,
      endedAt: startedAt + effectiveMs,
      effectiveMs,
      awayMs: 0,
      stuckCount: row.hint,
      analyzeCount: row.analyze,
      hintCount: row.hint,
      outcome: row.outcome,
      language: file?.language,
      finalCode: file?.content,
    };
  });
}

function buildSeedMistakes(now: number): Mistake[] {
  return [
    {
      id: 'demo-mistake-lis',
      problemId: 'demo-lis',
      problemTitle: '最长上升子序列',
      language: 'cpp',
      wrongCode: `// 用了 upper_bound 而非 lower_bound\nfor (int x : a) {\n    auto it = upper_bound(dp.begin(), dp.end(), x);\n    if (it == dp.end()) dp.push_back(x);\n    else *it = x;\n}\n`,
      rootCause:
        '把「严格上升」误算为「非严格上升」：对相同元素 1 1 1 1，upper_bound 会让长度变成 4，正确应为 1。',
      category: '边界处理',
      knowledgePoints: ['DP', '最长上升子序列', '二分'],
      reviewTips: [
        'Hack case：1 1 1 1（输出应为 1，不是 4）',
        '记忆口诀：严格上升 → lower_bound；非严格上升 → upper_bound',
      ],
      correctSketch:
        '保持 dp 单调严格上升：用 lower_bound 找 ≥ x 的第一个位置覆盖。',
      verdict: 'WA',
      areaCodes: ['Y2.dp.lis'],
      createdAt: now - 4 * DAY + 30 * 60_000,
      reviewedAt: now - 3 * DAY + 30 * 60_000, // 第二天 AC 后已自动复习
      reviewCount: 1,
    },
    {
      id: 'demo-mistake-knapsack',
      problemId: 'demo-knapsack',
      problemTitle: '0/1 背包',
      language: 'cpp',
      wrongCode: `for (int j = w; j <= W; j++) {\n    dp[j] = max(dp[j], dp[j - w] + v);\n}\n`,
      rootCause:
        '内层循环正向写法相当于完全背包：同一物品被选多次，与 0/1 背包语义冲突。',
      category: 'DP 状态转移',
      knowledgePoints: ['DP', '背包', '滚动数组'],
      reviewTips: [
        'Hack case：1 件物品，W 大于 w 时多次叠加。',
        '0/1 背包：j 必须**倒序**枚举；完全背包才正向。',
      ],
      correctSketch: '把内层 `for (int j = w; j <= W; j++)` 改为 `for (int j = W; j >= w; j--)`。',
      verdict: 'WA',
      areaCodes: ['Y2.dp.knapsack'],
      createdAt: now - 2 * DAY + 45 * 60_000,
      reviewCount: 0,
    },
  ];
}

function buildSeedEvents(now: number): CoachEvent[] {
  // 给每个 session 配套两条 event：session_start + analysis（让 profile 算 analyzeCount 也合理）
  // 这里只塞最少必要事件，避免与 store 启动后的真实事件混杂太多
  const events: CoachEvent[] = [];
  const stamps = [6, 5, 4, 3, 2, 1, 0];
  for (let i = 0; i < stamps.length; i++) {
    const ts = startOfDay(now, stamps[i]);
    events.push({
      ts,
      sessionId: 'demo-seed-session',
      problemId: ['demo-two-sum', 'demo-max-subarray', 'demo-lis', 'demo-lis', 'demo-knapsack', 'demo-sliding-window', 'demo-two-sum'][i],
      type: 'session_start',
    });
  }
  return events;
}

export async function loadDemoSeed(): Promise<void> {
  const now = Date.now();
  await storage.wipeAll();
  const seeded = buildSeedProblems(now);
  for (const p of seeded) {
    const { files, ...problem } = p;
    await storage.saveProblem(problem);
    for (const sf of files) {
      const file: CodeFile = {
        id: sf.id,
        problemId: p.id,
        name: sf.name,
        language: sf.language,
        content: sf.content,
        pinned: sf.pinned,
        createdAt: p.createdAt,
        updatedAt: p.createdAt,
      };
      await storage.saveFile(file);
    }
  }
  for (const s of buildSeedSessions(now, seeded)) {
    await storage.saveSession(s);
  }
  for (const m of buildSeedMistakes(now)) {
    await storage.saveMistake(m);
  }
  for (const e of buildSeedEvents(now)) {
    await storage.appendEvent(e);
  }
  // 标记 onboarding 已完成，避免覆盖 demo 数据
  localStorage.setItem('aicc.onboarding.v1', 'done');
}
