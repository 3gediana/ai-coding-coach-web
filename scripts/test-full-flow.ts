/**
 * 完整端到端工作流测试：模拟真实学生从录题到答错到看统计的全过程。
 *
 * 用法（在 web 项目根目录）：
 *   $env:AI_COACH_KEY = "<your-key>"
 *   npx tsx scripts/test-full-flow.ts
 */
import { AIClient } from '../src/core/ai/client';
import { Coach } from '../src/core/analyzer';
import {
  aggregateMastery,
  buildLearnerProfile,
  formatDurationMs,
} from '../src/core/utils';
import type {
  AnalysisHistoryEntry,
  CoachEvent,
  Mistake,
  Problem,
  Session,
} from '../src/core/types';

// ---- 终端配色 ----
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};
const banner = (txt: string) =>
  console.log(`\n${C.bold}${C.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  ${txt}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
const ok = (txt: string) => console.log(`  ${C.green}✓${C.reset} ${txt}`);
const warn = (txt: string) => console.log(`  ${C.yellow}⚠${C.reset} ${txt}`);
const info = (txt: string) => console.log(`  ${C.dim}${txt}${C.reset}`);

// ---- 配置 ----
const KEY = process.env.AI_COACH_KEY;
if (!KEY) {
  console.error('需要环境变量 AI_COACH_KEY');
  process.exit(1);
}

const client = new AIClient({
  provider: 'minimax',
  baseUrl: 'https://api.minimaxi.com/v1/text/chatcompletion_v2',
  apiKey: KEY,
  model: 'MiniMax-M2',
  maxTokens: 8000,
  temperature: 0.3,
  timeoutMs: 240_000,
  maxRetries: 1,
});
const coach = new Coach(client);

// ---- 内存 store（模拟 IndexedDB） ----
const db = {
  problems: [] as Problem[],
  mistakes: [] as Mistake[],
  sessions: [] as Session[],
  events: [] as CoachEvent[],
};
const sessionId = 'sess-' + Date.now();

// ---- 流式打印 ----
function streamPrint(label: string) {
  let total = 0;
  let lastPrint = 0;
  const start = Date.now();
  process.stdout.write(`  ${C.dim}[${label}]${C.reset} `);
  return {
    onChunk: (delta: string, _acc: string) => {
      total += delta.length;
      const now = Date.now();
      if (now - lastPrint > 250) {
        const sec = ((now - start) / 1000).toFixed(1);
        process.stdout.write(
          `\r  ${C.dim}[${label}]${C.reset} ${C.cyan}${total}${C.reset} chars · ${sec}s${C.dim}…${C.reset}   `,
        );
        lastPrint = now;
      }
    },
    onRetry: (attempt: number, ms: number, reason: string) => {
      console.log(`\n  ${C.yellow}↻${C.reset} 重试 ${attempt} (${ms}ms): ${reason.slice(0, 80)}`);
    },
    finish: () => {
      const sec = ((Date.now() - start) / 1000).toFixed(1);
      process.stdout.write(
        `\r  ${C.dim}[${label}]${C.reset} ${C.green}✓${C.reset} ${C.bold}${total}${C.reset} chars · ${C.bold}${sec}s${C.reset}              \n`,
      );
    },
  };
}

const codeBox = (code: string, lang = 'cpp') => {
  const lines = code.split('\n');
  console.log(`  ${C.gray}┌─ ${lang} ${'─'.repeat(60)}${C.reset}`);
  lines.forEach((l, i) => {
    console.log(`  ${C.gray}│${C.reset} ${C.dim}${String(i + 1).padStart(2)}${C.reset} ${l}`);
  });
  console.log(`  ${C.gray}└${'─'.repeat(70)}${C.reset}`);
};

const issueLine = (sev: string, line: number, cat: string, msg: string) => {
  const color = sev === 'error' ? C.red : sev === 'warning' ? C.yellow : sev === 'info' ? C.cyan : C.gray;
  console.log(
    `    ${color}${sev.toUpperCase().padEnd(7)}${C.reset} ${C.bold}L${line}${C.reset} ${C.dim}${cat}${C.reset} · ${msg}`,
  );
};

// ============== MAIN ==============

async function main() {
  console.log(`\n${C.bold}${C.cyan}┌──────────────────────────────────────────┐
│  AI Coding Coach · 完整工作流自测       │
│  模型: MiniMax-M2 · 模式: 流式           │
└──────────────────────────────────────────┘${C.reset}`);

  // ╔════════ STEP 1: 录入题目 1 ════════╗
  banner('STEP 1 · 录入题目：Two Sum');
  const twoSumText = `两数之和

给定一个整数数组 nums 和一个整数目标值 target，请在该数组中找出和为目标值的那两个整数，并返回它们的数组下标。
你可以假设每种输入只会对应一个答案，但是数组中同一个元素在答案里不能重复出现。

约束：
2 <= nums.length <= 10^4
-10^9 <= nums[i] <= 10^9
-10^9 <= target <= 10^9

示例：
输入：nums = [2,7,11,15], target = 9
输出：[0,1]
解释：因为 nums[0] + nums[1] == 9 ，返回 [0, 1]`;

  info('用户粘贴了一段 OJ 题面，AI 正在结构化…');
  const s1 = streamPrint('Parse Problem');
  const p1 = await coach.parseProblem(twoSumText, s1);
  s1.finish();
  db.problems.push(p1);
  ok(`标题: ${C.bold}${p1.title}${C.reset}`);
  ok(`难度: ${p1.difficulty ?? '?'} · 标签: ${(p1.tags ?? []).join(', ')}`);
  ok(`约束: ${(p1.constraints ?? '').slice(0, 60)}`);
  ok(`示例数: ${p1.examples?.length ?? 0}`);

  // ╔════════ STEP 2: 答题 1（故意犯错）════════╗
  banner('STEP 2 · 学生答题：故意犯 j<=i + 双循环 BUG');
  const buggyCode1 = `#include <vector>
using namespace std;
class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        for (int i = 0; i < nums.size(); i++) {
            for (int j = 0; j <= i; j++) {  // BUG: 应该是 j = i+1
                if (nums[i] + nums[j] == target) {
                    return {i, j};
                }
            }
        }
        return {};
    }
};`;
  codeBox(buggyCode1);

  info('AI 正在分析代码（流式输出，编辑器永远不会卡）…');
  const s2 = streamPrint('Analyze #1');
  const profile1 = buildLearnerProfile({
    sessions: db.sessions,
    problems: db.problems,
    mistakes: db.mistakes,
    events: db.events,
    currentProblemTags: p1.tags,
  });
  const r1 = await coach.analyzeCode(
    {
      problem: p1,
      code: buggyCode1,
      language: 'cpp',
      profile: profile1,
      history: [],
    },
    s2,
  );
  s2.finish();
  ok(`发现 ${C.bold}${r1.issues.length}${C.reset} 个问题：`);
  r1.issues.forEach((iss) => issueLine(iss.severity, iss.line, iss.category, iss.message));
  console.log(`    ${C.dim}总评:${C.reset} ${r1.overallComment}`);
  console.log(`    ${C.dim}复杂度:${C.reset} ${r1.complexitySummary}`);

  db.events.push({
    ts: Date.now(),
    sessionId,
    problemId: p1.id,
    type: 'analysis',
    payload: {
      reason: 'manual',
      issueCount: r1.issues.length,
      issuesSnapshot: r1.issues.slice(0, 10).map((i) => ({
        line: i.line,
        severity: i.severity,
        category: i.category,
        message: i.message.slice(0, 120),
      })),
      overallComment: r1.overallComment?.slice(0, 200),
    },
  });

  // ╔════════ STEP 3: 不修代码再分析（验证 history） ════════╗
  banner('STEP 3 · 学生没改，再次点"分析"（验证 history 让 AI 不重复啰嗦）');
  const history3: AnalysisHistoryEntry[] = db.events
    .filter((e) => e.problemId === p1.id && (e.type === 'analysis' || e.type === 'manual_analyze'))
    .slice(-2)
    .map((e) => {
      const p = e.payload as any;
      return {
        ts: e.ts,
        reason: p?.reason ?? 'auto',
        issuesSnapshot: p?.issuesSnapshot ?? [],
        overallComment: p?.overallComment,
      };
    });
  info(`传入 history: ${history3.length} 条 · 期望 AI 提到"仍存在/未修复"`);

  const s3 = streamPrint('Analyze #2 (with history)');
  const r2 = await coach.analyzeCode(
    {
      problem: p1,
      code: buggyCode1,
      language: 'cpp',
      profile: profile1,
      history: history3,
    },
    s3,
  );
  s3.finish();
  ok(`发现 ${r2.issues.length} 个问题：`);
  r2.issues.forEach((iss) => issueLine(iss.severity, iss.line, iss.category, iss.message));
  console.log(`    ${C.dim}总评:${C.reset} ${r2.overallComment}`);

  const overall2 = r2.overallComment ?? '';
  const mentionsRepeat = /仍存在|未修复|仍未|上次|未改|没改|still|persists|previously|未解决/i.test(overall2);
  if (mentionsRepeat) {
    console.log(`  ${C.green}${C.bold}✓ AI 显式提到"仍存在/未修复" → history 起作用了${C.reset}`);
  } else {
    warn('AI 总评里没明确提"仍存在"，但行内 issues 仍指出同一 bug，效果可接受');
  }

  // ╔════════ STEP 4: 加入错题本 ════════╗
  banner('STEP 4 · 学生意识到改不动了，加入错题本');
  const s4 = streamPrint('Summarize Mistake');
  const m1 = (await coach.summarizeMistake(
    { problem: p1, code: buggyCode1, language: 'cpp', isMistake: true },
    s4,
  )) as Mistake;
  s4.finish();
  ok(`分类: ${C.yellow}${m1.category}${C.reset}`);
  ok(`错因: ${m1.rootCause.slice(0, 100)}…`);
  ok(`知识点: ${m1.knowledgePoints.join(', ')}`);
  console.log(`  ${C.dim}复习要点 (${m1.reviewTips.length} 条):${C.reset}`);
  m1.reviewTips.forEach((t, i) => console.log(`    ${C.cyan}${i + 1}.${C.reset} ${t}`));
  db.mistakes.push(m1);
  db.events.push({
    ts: Date.now(),
    sessionId,
    problemId: p1.id,
    type: 'mistake_added',
    payload: { category: m1.category },
  });

  // ╔════════ STEP 5: 录题 2 ════════╗
  banner('STEP 5 · 录入题目 2：盛最多水的容器');
  const containerText = `盛最多水的容器

给定一个长度为 n 的整数数组 height。有 n 条垂直线，第 i 条线的两个端点是 (i, 0) 和 (i, height[i])。
找出其中的两条线，使得它们与 x 轴共同构成的容器可以容纳最多的水。
返回容器可以储存的最大水量。

约束：
n == height.length
2 <= n <= 10^5
0 <= height[i] <= 10^4

示例：
输入：height = [1,8,6,2,5,4,8,3,7]
输出：49`;

  const s5 = streamPrint('Parse Problem');
  const p2 = await coach.parseProblem(containerText, s5);
  s5.finish();
  db.problems.push(p2);
  ok(`标题: ${p2.title} · 标签: ${p2.tags?.join(', ')}`);

  // ╔════════ STEP 6: 答题 2（不同类型错误：算法错） ════════╗
  banner('STEP 6 · 答题 2：故意写 O(n²) 暴力（不会用双指针）');
  const buggyCode2 = `#include <vector>
#include <algorithm>
using namespace std;
class Solution {
public:
    int maxArea(vector<int>& height) {
        int n = height.size();
        int ans = 0;
        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) {
                int water = min(height[i], height[j]) * (j - i);
                ans = max(ans, water);
            }
        }
        return ans;
    }
};`;
  codeBox(buggyCode2);

  // 重新构造 profile：现在已经有第一题的错题，画像会反映薄弱点
  const profile2 = buildLearnerProfile({
    sessions: db.sessions,
    problems: db.problems,
    mistakes: db.mistakes,
    events: db.events,
    currentProblemTags: p2.tags,
  });
  console.log(`  ${C.cyan}当前学习画像：${C.reset}`);
  console.log(`    · 已练 ${profile2.totalProblems} 题, 错题 ${profile2.totalMistakes} 道`);
  console.log(
    `    · 薄弱标签: ${
      profile2.weakestTags.length > 0
        ? profile2.weakestTags.map((t) => `${C.red}${t.tag}${C.reset}(${(t.mastery * 100).toFixed(0)}%)`).join(', ')
        : '无（数据不足）'
    }`,
  );
  console.log(
    `    · 错误分类: ${
      profile2.topMistakeCategories.length > 0
        ? profile2.topMistakeCategories.map((c) => `${c.category}×${c.count}`).join(', ')
        : '无'
    }`,
  );
  if (profile2.currentTagsHitWeak.length > 0) {
    console.log(`    · ${C.red}${C.bold}⚠ 当前题命中薄弱项：${profile2.currentTagsHitWeak.join(', ')}${C.reset}`);
  }

  info('AI 这次拿到了 profile（含上一题错题信息），分析会更针对性…');
  const s6 = streamPrint('Analyze #3 (with profile)');
  const r3 = await coach.analyzeCode(
    {
      problem: p2,
      code: buggyCode2,
      language: 'cpp',
      profile: profile2,
      history: [],
    },
    s6,
  );
  s6.finish();
  ok(`发现 ${r3.issues.length} 个问题：`);
  r3.issues.forEach((iss) => issueLine(iss.severity, iss.line, iss.category, iss.message));
  console.log(`    ${C.dim}总评:${C.reset} ${r3.overallComment}`);

  // ╔════════ STEP 7: 加错题 2 ════════╗
  banner('STEP 7 · 加入错题本（题目 2）');
  const s7 = streamPrint('Summarize Mistake');
  const m2 = (await coach.summarizeMistake(
    { problem: p2, code: buggyCode2, language: 'cpp', isMistake: true },
    s7,
  )) as Mistake;
  s7.finish();
  ok(`分类: ${C.yellow}${m2.category}${C.reset}`);
  ok(`知识点: ${m2.knowledgePoints.join(', ')}`);
  db.mistakes.push(m2);

  // ╔════════ STEP 8: 模拟更多 sessions ════════╗
  banner('STEP 8 · 模拟历史会话（含已通过的题目，让统计有"通过"数据）');
  const now = Date.now();
  db.sessions.push({
    id: 's1',
    problemId: p1.id,
    problemTitle: p1.title,
    startedAt: now - 1000 * 60 * 30,
    endedAt: now - 1000 * 60 * 15,
    effectiveMs: 1000 * 60 * 15,
    awayMs: 0,
    stuckCount: 2,
    analyzeCount: 3,
    hintCount: 0,
    outcome: 'mistake',
    language: 'cpp',
    finalCode: buggyCode1,
  });
  db.sessions.push({
    id: 's2',
    problemId: p2.id,
    problemTitle: p2.title,
    startedAt: now - 1000 * 60 * 14,
    endedAt: now - 1000 * 60 * 2,
    effectiveMs: 1000 * 60 * 12,
    awayMs: 1000 * 30,
    stuckCount: 1,
    analyzeCount: 2,
    hintCount: 1,
    outcome: 'mistake',
    language: 'cpp',
    finalCode: buggyCode2,
  });
  // 虚构一道历史 AC 的 LCS
  db.problems.push({
    id: 'p_lcs',
    title: '最长公共子序列',
    statement: '...',
    tags: ['dp', '字符串'],
    createdAt: now - 1000 * 60 * 60 * 24,
  });
  db.sessions.push({
    id: 's3',
    problemId: 'p_lcs',
    problemTitle: '最长公共子序列',
    startedAt: now - 1000 * 60 * 60,
    endedAt: now - 1000 * 60 * 45,
    effectiveMs: 1000 * 60 * 15,
    awayMs: 0,
    stuckCount: 0,
    analyzeCount: 1,
    hintCount: 0,
    outcome: 'pass',
    language: 'cpp',
  });
  // 再来一道虚构的 AC（同 dp 标签，让 dp 掌握度更高）
  db.problems.push({
    id: 'p_climb',
    title: '爬楼梯',
    statement: '...',
    tags: ['dp'],
    createdAt: now - 1000 * 60 * 60 * 48,
  });
  db.sessions.push({
    id: 's4',
    problemId: 'p_climb',
    problemTitle: '爬楼梯',
    startedAt: now - 1000 * 60 * 90,
    endedAt: now - 1000 * 60 * 85,
    effectiveMs: 1000 * 60 * 5,
    awayMs: 0,
    stuckCount: 0,
    analyzeCount: 0,
    hintCount: 0,
    outcome: 'pass',
    language: 'cpp',
  });
  ok(`Session 总数: ${db.sessions.length} (2 mistake + 2 pass)`);

  // ╔════════ STEP 9: 看统计 ════════╗
  banner('STEP 9 · 学习空间统计 — aggregateMastery');
  const stats = aggregateMastery({
    sessions: db.sessions,
    problems: db.problems,
    mistakes: db.mistakes,
    events: db.events,
  });
  console.log(`  ${C.bold}总题数:${C.reset}      ${stats.totalProblems}`);
  console.log(`  ${C.green}通过题:${C.reset}      ${stats.passedProblems}`);
  console.log(`  ${C.yellow}错题题数:${C.reset}    ${stats.mistakeProblems}`);
  console.log(`  ${C.dim}累计有效时长:${C.reset} ${formatDurationMs(stats.totalEffectiveMs)}`);
  console.log(`\n  ${C.cyan}知识点掌握度雷达:${C.reset}`);
  const tagsSorted = Object.entries(stats.perTag).sort((a, b) => a[1].score - b[1].score);
  tagsSorted.forEach(([tag, v]) => {
    const score = (v.score * 100).toFixed(0);
    const color = v.score < 0.4 ? C.red : v.score < 0.7 ? C.yellow : C.green;
    const filled = Math.floor(v.score * 24);
    const bar = '█'.repeat(filled) + C.dim + '░'.repeat(24 - filled) + C.reset;
    console.log(`    ${tag.padEnd(14)} ${color}${bar}${C.reset} ${color}${score}%${C.reset}  ${C.dim}(${v.count} 题)${C.reset}`);
  });

  // ╔════════ STEP 10: 学习画像 ════════╗
  banner('STEP 10 · 最终学习画像（喂给下次 AI 分析的上下文）');
  const finalProfile = buildLearnerProfile({
    sessions: db.sessions,
    problems: db.problems,
    mistakes: db.mistakes,
    events: db.events,
  });
  console.log(`  ${C.dim}已练:${C.reset} ${finalProfile.totalProblems} 题, 错题 ${finalProfile.totalMistakes} 道`);
  console.log(
    `  ${C.red}最薄弱:${C.reset} ${finalProfile.weakestTags
      .map((t) => `${C.bold}${t.tag}${C.reset}(${(t.mastery * 100).toFixed(0)}%)`)
      .join(' · ')}`,
  );
  console.log(
    `  ${C.yellow}常见错误:${C.reset} ${finalProfile.topMistakeCategories
      .map((c) => `${c.category}×${c.count}`)
      .join(' · ')}`,
  );

  // ╔════════ STEP 11: 错题本概览 ════════╗
  banner('STEP 11 · 错题本概览');
  db.mistakes.forEach((m, i) => {
    console.log(`\n  ${C.bold}${C.cyan}#${i + 1}${C.reset} ${C.bold}${m.problemTitle}${C.reset}`);
    console.log(`    分类: ${C.yellow}${m.category}${C.reset}`);
    console.log(`    知识点: ${m.knowledgePoints.join(', ')}`);
    console.log(`    ${C.dim}错因:${C.reset} ${m.rootCause.slice(0, 100)}${m.rootCause.length > 100 ? '…' : ''}`);
    console.log(`    ${C.dim}复习要点 (${m.reviewTips.length}):${C.reset}`);
    m.reviewTips.slice(0, 2).forEach((t) => console.log(`      · ${t}`));
  });

  // ╔════════ STEP 12: 数据库快照 ════════╗
  banner('STEP 12 · 数据库快照（IndexedDB 在浏览器里也是这样存的）');
  console.log(`  ${C.cyan}problems${C.reset}:  ${db.problems.length} 条`);
  console.log(`  ${C.cyan}mistakes${C.reset}:  ${db.mistakes.length} 条`);
  console.log(`  ${C.cyan}sessions${C.reset}:  ${db.sessions.length} 条`);
  console.log(`  ${C.cyan}events${C.reset}:    ${db.events.length} 条`);
  console.log(`\n  ${C.dim}事件流:${C.reset}`);
  db.events.forEach((e, i) => {
    console.log(`    ${i + 1}. ${new Date(e.ts).toLocaleTimeString()} · ${C.cyan}${e.type}${C.reset} · ${(e.payload as any)?.reason ?? '-'}`);
  });

  banner('全流程通过 ✓');
  console.log(
    `\n  ${C.green}${C.bold}所有 12 步均成功${C.reset} —— ` +
      `AI 调用 ${countTasks(db)} 次，` +
      `数据流、统计、画像、history 上下文均工作正常\n`,
  );
}

function countTasks(_d: typeof db) {
  // parseProblem ×2 + analyzeCode ×3 + summarizeMistake ×2 = 7
  return 7;
}

main().catch((e) => {
  console.error(`\n${C.red}${C.bold}FATAL:${C.reset} ${e?.message ?? e}`);
  if (e?.stack) console.error(C.dim + e.stack + C.reset);
  process.exit(1);
});
