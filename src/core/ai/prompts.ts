/**
 * AI 提示词模板。
 *
 * 这是整个项目最有价值的资产：
 * - 提示词定义了 AI 输出的结构（JSON Schema）
 * - 未来 Web 版直接复用这些函数即可
 * - 调优时主要改这个文件
 */
import type { AnalysisHistoryEntry, Lang, LearnerProfile, Problem } from '../types';
import { serializeForPrompt as serializeTaxonomy } from '../taxonomy';
import { codeHash } from '../utils';

export const SYSTEM_CODING_COACH = `你是一位资深的算法竞赛教练和编程导师，专注于辅导大学生学习 C++ 和 Python。

你的风格：
- 直接、犀利、不说废话
- 优先指出最关键的问题（按严重程度排序）
- 给出可执行的具体修改建议，不空谈
- 复杂度分析必须给出 Big-O 表达式
- 输出严格使用 JSON 格式，不包含 \`\`\`json 标记或任何额外文字`;

interface PromptPair {
  system: string;
  user: string;
}

/**
 * 卡住引导：苏格拉底式提问，**不直接给答案**。
 * 输出 1-2 个引导性问题，帮学生意识到自己的卡点。
 */
export function buildStuckHintPrompt(args: {
  problem: Problem;
  code: string;
  language: Lang;
}): PromptPair {
  return {
    system: `你是耐心的算法教练。学生卡住了。请用**苏格拉底式提问**引导他自己想，不要直接给答案。
要求：
- 输出 1-2 个**问题**，不超过 80 字
- 问题要具体、可操作（"你想想用什么数据结构"比"再想想"好）
- 如果代码完全没动 → 问思路；如果代码写到一半 → 问当前在卡哪步
- 不要废话不要鼓励语
- 直接输出问题文本（不要 JSON、不要 markdown 标题）`,
    user: `题目：${args.problem.title}
${args.problem.statement}

学生当前 ${args.language} 代码：
\`\`\`${args.language}
${args.code || '// （还没动笔）'}
\`\`\`

学生已经停手 2 分钟没改代码了。请用 1-2 个问题引导他。`,
  };
}

/**
 * 解释粘贴段：分析粘贴进来的代码片段
 * - 这段在做什么
 * - 是否有潜在 bug / 不适合本题之处
 * - 建议是否需要修改
 */
export function buildExplainPastePrompt(args: {
  problem?: Problem;
  snippet: string;
  language: Lang;
}): PromptPair {
  const ctx = args.problem
    ? `当前题目：${args.problem.title}\n${args.problem.statement}\n\n`
    : '当前没有激活题目。\n\n';
  return {
    system: SYSTEM_CODING_COACH,
    user: `${ctx}学生粘贴了下面的 ${args.language} 代码片段：

\`\`\`${args.language}
${args.snippet}
\`\`\`

请输出 JSON：
{
  "summary": "这段代码在做什么（1-2 句）",
  "fitsContext": true/false,
  "concerns": ["潜在问题点（最多 3 条）"],
  "suggestion": "针对当前题目，需要改哪些地方（1 段话）"
}

直接输出 JSON。`,
  };
}

/** 各种判题结果对应的关注点提示，喂给 AI 让它针对性分析 */
const verdictHintMap: Record<string, string> = {
  WA: '答案错误，请重点构造能让这份代码出错的最小反例（hack case）',
  TLE: '超时，重点分析时间复杂度并指出哪段循环/递归过慢',
  MLE: '内存超限，重点分析空间使用、是否有大数组/递归过深/无意义复制',
  RE: '运行时错误，重点找崩溃点（数组越界 / 除零 / 栈溢出 / 空指针）',
  CE: '编译错误，重点指出语法/类型/引用错误',
  OTHER: '其他错误，请综合判断最可能的根因',
};

/**
 * 把粘贴的题目原文解析为结构化 JSON。
 */
/**
 * 学生在做题时随手提问 → 结合当前题目 + 代码上下文给出针对性回答。
 * 输出是自然语言 markdown，不需要 JSON。
 *
 * @param question  学生的具体问题
 * @param history   之前的 Q&A（最多带最近 4 轮），让追问能上下文延续
 */
export function buildAskQuestionPrompt(args: {
  problem?: Problem;
  code?: string;
  language?: Lang;
  question: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}): { system: string; messages: { role: 'system' | 'user' | 'assistant'; content: string }[] } {
  const ctxLines: string[] = [];
  if (args.problem) {
    ctxLines.push(`# 当前题目：${args.problem.title}`);
    if (args.problem.statement) ctxLines.push(args.problem.statement.slice(0, 2000));
    if (args.problem.constraints) ctxLines.push('## 约束\n' + args.problem.constraints);
    if (args.problem.examples?.length) {
      ctxLines.push('## 示例');
      for (const ex of args.problem.examples.slice(0, 2)) {
        ctxLines.push(`输入：${ex.input}\n输出：${ex.output}`);
      }
    }
  } else {
    ctxLines.push('（学生当前没有激活题目，直接回答其问题即可）');
  }
  if (args.code && args.code.trim().length > 5) {
    ctxLines.push(`## 学生当前代码（${args.language ?? '未知语言'}）`);
    ctxLines.push('```' + (args.language ?? '') + '\n' + args.code.slice(0, 4000) + '\n```');
  }

  const system = `${SYSTEM_CODING_COACH}

学生在做题过程中向你提问。你的任务：
- **结合上面给出的题目和代码**回答学生的具体问题
- 不要直接给出完整 AC 代码（学生在学习），可以给伪代码、片段、或思路引导
- 如果学生卡在某个知识点（什么是单调队列 / DP 怎么转移 / 这种数据范围用什么算法），先讲清楚概念，再点拨如何套用到当前题目
- 用 markdown，可以用 \`code\` / 列表 / **粗体**
- 中文回答，**严格控制在 200 字以内**。先给最关键的 1-2 点，详细展开请学生追问。
- 不要把所有可能的相关知识都列出来。**只针对学生具体的问题**给最直接的回答。`;

  const ctx = ctxLines.join('\n\n');
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: system },
    { role: 'user', content: ctx + '\n\n---\n\n（接下来是历史对话，请在此上下文里回答最后一个问题）' },
  ];
  if (args.history?.length) {
    for (const h of args.history.slice(-8)) {
      messages.push({ role: h.role, content: h.content });
    }
  }
  messages.push({ role: 'user', content: args.question });

  return { system, messages };
}

export function buildParseProblemPrompt(rawText: string): PromptPair {
  return {
    system:
      '你是一个题目结构化解析助手。把用户提供的题目文本解析为 JSON。直接输出 JSON，不要任何代码块标记或解释。',
    user: `把下面的题目解析为如下 JSON 结构：
{
  "title": "题目标题",
  "statement": "题面描述（去除示例和约束）",
  "inputFormat": "输入格式说明",
  "outputFormat": "输出格式说明",
  "constraints": "数据范围 / 时间空间限制",
  "examples": [{"input": "...", "output": "...", "explanation": "..."}],
  "tags": ["可能涉及的算法/数据结构知识点"],
  "difficulty": "easy | medium | hard"
}

如果某字段无法识别，置为空字符串或空数组。直接输出 JSON。

题目原文：
"""
${rawText}
"""`,
  };
}

/**
 * 分析当前代码，找问题、给优化建议、估复杂度。
 *
 * profile 和 history 让 AI 给出"针对性、不重复"的反馈。
 */
/** 字符上限（避免 prompt 爆炸） */
const STATEMENT_MAX = 2000;
const CONSTRAINTS_MAX = 800;
const CODE_MAX = 6000;

/** 给 AI 看带行号前缀的代码：明显降低 AI 数错行的概率
 * 输出形如：
 *   1 | #include <bits/stdc++.h>
 *   2 | using namespace std;
 */
function withLineNumbers(code: string): { numbered: string; totalLines: number; truncated: boolean } {
  let body = code;
  let truncated = false;
  if (body.length > CODE_MAX) {
    // 优先保留头尾，中段截掉（中段往往是工具函数/重复 loop）
    const keepHead = Math.floor(CODE_MAX * 0.6);
    const keepTail = CODE_MAX - keepHead - 100;
    body = body.slice(0, keepHead) + '\n// ... [中段省略] ...\n' + body.slice(-keepTail);
    truncated = true;
  }
  const lines = body.split('\n');
  const width = String(lines.length).length;
  const numbered = lines
    .map((line, i) => `${String(i + 1).padStart(width, ' ')} | ${line}`)
    .join('\n');
  return { numbered, totalLines: lines.length, truncated };
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…[截断]' : s;
}


export function buildAnalyzeCodePrompt(args: {
  problem?: Problem;
  code: string;
  language: Lang;
  profile?: LearnerProfile;
  history?: AnalysisHistoryEntry[];
  siblings?: Array<{ name: string; language: string; content: string }>;
}): PromptPair {
  const problemContext = args.problem
    ? `【当前题目】
标题：${args.problem.title}
题面：${clip(args.problem.statement, STATEMENT_MAX)}
${args.problem.constraints ? '约束：' + clip(args.problem.constraints, CONSTRAINTS_MAX) : ''}`
    : '（用户未录入题目，仅就代码本身进行分析）';

  const profileBlock = renderProfile(args.profile);
  const historyBlock = renderHistory(args.history);
  const siblingBlock = renderSiblings(args.siblings);

  const { numbered, totalLines, truncated } = withLineNumbers(args.code);
  // 当前代码哈希（前 6 字符），AI 通过对照 history 里的 codeHash 判断"代码是否改了"
  const currentHash = codeHash(args.code).slice(0, 6);

  return {
    system: SYSTEM_CODING_COACH,
    user: `${problemContext}
${profileBlock}
${historyBlock}
${siblingBlock}
【学生当前正在分析的 ${args.language} 代码（哈希=${currentHash}, ${totalLines} 行${truncated ? '，已截断' : ''}，每行带 "行号 | " 前缀）】
\`\`\`
${numbered}
\`\`\`

输出 JSON（严格遵守，不要任何 markdown 标记或前后多余文字）：
{
  "issues": [
    {
      "line": 整数行号 (1..${totalLines}, 必须严格在范围内),
      "severity": "error" | "warning" | "info" | "hint",
      "category": "correctness" | "performance" | "robustness" | "readability" | "intent",
      "message": "问题一句话讲清（≤40 字）",
      "suggestion": "怎么改（≤80 字，可含极短代码片段，不要给完整解法）"
    }
  ],
  "complexitySummary": "时间 O(...)，空间 O(...)，1 句话说明（≤40 字）",
  "overallComment": "整体评价（2-3 句：能否 AC？最大瓶颈？≤120 字）"
}

📐 issue 维度（category）：
- **correctness** 正确性：边界 / 越界 / 整数溢出 / 算法逻辑错
- **performance** 性能：复杂度风险 / TLE / 不必要的拷贝 / cin 慢
- **robustness** 健壮性：未初始化 / 异常输入 / 空指针 / 递归过深
- **readability** 可读性：命名 / 缩进 / 死代码 / 魔数
- **intent** 题意符合：跑出来对但没解对该题（如把 "最长" 解成 "最大"）

🎯 严重程度（severity）：
- **error** 必 WA / RE 的硬错误
- **warning** 大概率 TLE / MLE / 边界出错
- **info** 写法不优 / 复杂度可优化
- **hint** 风格 / 微优化

⚠ 教学约束（重要）：
1. **不要给完整 AC 代码**：suggestion 里最多写关键 2-3 行片段或思路，让学生自己写出来
2. 不要为没问题的代码硬找问题，issues 可以为空数组
3. 按严重程度排序，error/warning 在前
4. 同一个问题不要在多行都标注，只标注最相关那一行
5. C++ 重点关注：int vs long long、数组越界、未初始化、cin 同步关闭、vector 大量拷贝
6. Python 重点关注：默认参数陷阱、list 大数据、递归深度、is vs ==

📊 上下文使用：
- 如有"学习画像"：薄弱知识点在 message 里点明（即使代码当前没暴露相关风险）
- 如有"反馈历史"：已修复的不再提；仍存在的提一句"上次说过"；重点说新出现的
- 如有"其它文件"：只在必要时引用，主体仍是当前分析的代码

直接输出 JSON。`,
  };
}

function renderSiblings(
  siblings?: Array<{ name: string; language: string; content: string }>,
): string {
  if (!siblings || siblings.length === 0) return '';
  // 单文件总长度限制，避免 prompt 爆炸
  const MAX_PER_FILE = 1500; // 字符
  const MAX_TOTAL = 6000;
  let total = 0;
  const parts: string[] = ['', '【同题/同会话下的其它文件（参考上下文）】'];
  for (const s of siblings) {
    if (total >= MAX_TOTAL) {
      parts.push(`...还有 ${siblings.length - parts.length + 2} 个文件略`);
      break;
    }
    let body = s.content;
    let truncated = false;
    if (body.length > MAX_PER_FILE) {
      body = body.slice(0, MAX_PER_FILE);
      truncated = true;
    }
    parts.push(`--- ${s.name} (${s.language})${truncated ? ' [截断]' : ''} ---`);
    parts.push('```' + s.language);
    parts.push(body);
    parts.push('```');
    total += body.length;
  }
  parts.push(
    '⚠ 这些文件**只是上下文**：可以是另一份解法（暴力对照）/ 笔记 / 其它语言版本。请优先分析"当前正在分析的代码"，仅在必要时引用其它文件。',
  );
  return parts.join('\n');
}

function renderProfile(p?: LearnerProfile): string {
  if (!p || p.totalProblems === 0) {
    return '';
  }
  const lines: string[] = ['', '【学生学习画像（用于针对性反馈）】'];
  lines.push(`已练 ${p.totalProblems} 道题，错题 ${p.totalMistakes} 道`);
  // 学习强度 + 节奏
  const intensityParts: string[] = [];
  if (p.streakDays !== undefined && p.streakDays > 0) {
    intensityParts.push(`连续学习 ${p.streakDays} 天`);
  }
  if (p.last7DaysProblems !== undefined && p.last7DaysProblems > 0) {
    intensityParts.push(`本周练 ${p.last7DaysProblems} 道`);
  }
  if (intensityParts.length > 0) lines.push('节奏：' + intensityParts.join('，'));
  // 独立程度
  if (p.independentRate !== undefined && p.totalProblems >= 3) {
    const pct = Math.round(p.independentRate * 100);
    if (pct < 40) {
      lines.push(`【提示：学生 AI 依赖度高（独立解题率仅 ${pct}%）—— 多用引导性提问，少给完整答案】`);
    } else if (pct > 75) {
      lines.push(`独立解题率 ${pct}%（较强自学能力）`);
    }
  }
  // 复习状态
  if (p.pendingReviewCount !== undefined && p.pendingReviewCount >= 3) {
    lines.push(`【提示：该学生有 ${p.pendingReviewCount} 道错题超 3 天没复习，可适当提及】`);
  }
  // 薄弱
  if (p.weakestTags.length > 0) {
    const w = p.weakestTags
      .map((t) => `${t.tag} ${(t.mastery * 100).toFixed(0)}%(${t.count}题)`)
      .join('、');
    lines.push(`薄弱知识点：${w}`);
  }
  if (p.topMistakeCategories.length > 0) {
    const c = p.topMistakeCategories.map((c) => `${c.category}×${c.count}`).join('、');
    lines.push(`常见错误类型（最近10错题）：${c}`);
  }
  // 错误类型偏好
  if (p.topVerdict && p.totalMistakes >= 3) {
    const hint: Record<string, string> = {
      WA: '该学生 WA 偏多 → 重点关注边界/反例构造',
      TLE: '该学生 TLE 偏多 → 重点关注算法复杂度',
      MLE: '该学生 MLE 偏多 → 关注空间使用 / 大数组',
      RE: '该学生 RE 偏多 → 关注越界/除零等运行时错误',
      CE: '该学生 CE 偏多 → 关注语法/类型',
    };
    if (hint[p.topVerdict]) lines.push(`【${hint[p.topVerdict]}】`);
  }
  if (p.currentTagsHitWeak.length > 0) {
    lines.push(
      `*** 当前题命中该学生的薄弱项：${p.currentTagsHitWeak.join('、')} —— 请重点提醒相关风险 ***`,
    );
  }
  return lines.join('\n');
}

function renderHistory(h?: AnalysisHistoryEntry[]): string {
  if (!h || h.length === 0) {
    return '';
  }
  const lines: string[] = ['', '【本题之前的反馈历史（避免重复说同样的话）】'];
  // 取最后一次的 codeHash 作为对比基准
  const lastHash = h[h.length - 1]?.codeHash;
  h.forEach((e, i) => {
    const t = new Date(e.ts).toLocaleTimeString();
    const codeMark = e.codeHash ? ` (代码=${e.codeHash.slice(0, 6)}, ${e.codeLineCount ?? '?'}行)` : '';
    if (e.issuesSnapshot.length === 0) {
      lines.push(`第 ${i + 1} 次（${t}, ${e.reason}${codeMark}）：未发现问题`);
    } else {
      lines.push(`第 ${i + 1} 次（${t}, ${e.reason}${codeMark}）：`);
      e.issuesSnapshot.forEach((s) => {
        lines.push(`  · L${s.line} ${s.severity}/${s.category}: ${s.message}`);
      });
    }
  });
  // 提示 AI 当前代码 vs 上次的关系（学生改了 / 没改 / 改了多少）
  if (lastHash) {
    lines.push(
      `\n💡 提示：上面历史括号里"代码=xxxxxx"是当时的代码哈希。如果当前分析的代码哈希跟最后一次相同 → 学生没改任何代码（不要重复说同样的问题，可换角度或追加新观察）；不同 → 学生改了代码，重点说"新出现的"和"上次说过但仍存在的"。`,
    );
  }
  return lines.join('\n');
}

/**
 * 题目通过/失败后的总结提炼。
 */
export function buildSummarizePrompt(args: {
  problem: Problem;
  code: string;
  language: Lang;
  isMistake: boolean;
  /** 评判结果：WA / TLE / RE / MLE / CE / OTHER */
  verdict?: string;
  /** 用户自己描述的错误现象 */
  userNote?: string;
  errorContext?: string;
}): PromptPair {
  if (args.isMistake) {
    const verdictHint = args.verdict
      ? verdictHintMap[args.verdict] ?? `提交结果：${args.verdict}`
      : '';
    return {
      system: SYSTEM_CODING_COACH,
      user: `学生在以下题目上出错了，请输出错题分析。

题目：${args.problem.title}
题面：${args.problem.statement}

学生的错误 ${args.language} 代码：
\`\`\`${args.language}
${args.code}
\`\`\`
${args.verdict ? `\n判题结果：**${args.verdict}**${verdictHint ? ' — ' + verdictHint : ''}` : ''}
${args.userNote ? `\n学生自述错误现象：${args.userNote}` : ''}
${args.errorContext ? `\n错误信息：\n${args.errorContext}` : ''}

请**针对判题结果**给出有针对性的分析（例如 TLE 必须分析复杂度，WA 必须构造 hack 样例，RE 必须找到崩溃点）。

参考下面的知识点分类体系（按年级组织），从中选 1-2 个最贴合的 code 填到 areaCodes：

${serializeTaxonomy()}

输出 JSON：
{
  "rootCause": "错因分析（一段话，说清楚学生在哪一步想错或写错）",
  "category": "错误分类（短标签，如：边界条件 / 贪心思路错 / 复杂度不对 / 语言陷阱 / 数组越界 / 整数溢出）",
  "areaCodes": ["从上述体系中选 1-2 个最贴合的 code，例如 Y2.ds.tree"],
  "knowledgePoints": ["涉及的知识点（具体短词）"],
  "reviewTips": ["复习要点（最多 3 条）"],
  "correctSketch": "正确思路的简要描述（关键步骤，不写完整代码）",
  "hackCase": "（仅 WA 时填）能让这份代码 WA 的最小反例，越短越好；其他情况留空字符串"
}

直接输出 JSON。`,
    };
  }

  return {
    system: SYSTEM_CODING_COACH,
    user: `学生通过了以下题目，请输出知识点总结。

题目：${args.problem.title}
题面：${args.problem.statement}

学生的通过 ${args.language} 代码：
\`\`\`${args.language}
${args.code}
\`\`\`

输出 JSON：
{
  "knowledgePoints": ["核心知识点"],
  "techniques": ["用到的技巧"],
  "complexity": "时间 O(...)，空间 O(...)",
  "extensions": ["可能的拓展题或变种"],
  "summary": "一句话总结这道题的核心"
}

直接输出 JSON。`,
  };
}
