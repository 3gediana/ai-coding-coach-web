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

/** 通用风格基线，**不绑定输出格式**（JSON 指令应放在具体任务的 prompt 里） */
export const SYSTEM_CODING_COACH = `你是一位资深的算法竞赛教练和编程导师，专注于辅导大学生学习 C++ 和 Python。

你的风格：
- 直接、犀利、不说废话
- 优先指出最关键的问题（按严重程度排序）
- 给出可执行的具体修改建议，不空谈
- 复杂度分析必须给出 Big-O 表达式`;

/** JSON 输出指令：要 JSON 输出的任务自己拼接到 system 末尾 */
export const SYSTEM_JSON_OUTPUT = `\n\n输出严格使用 JSON 格式，不包含 \`\`\`json 标记或任何额外文字。`;

interface PromptPair {
  system: string;
  user: string;
}

/**
 * 主动出 hack case：学生跑通样例后，由 Coach 自己挑战边界。
 * 让 AI 给一个最有可能让当前代码挂掉的小输入（边界 / 最大值 / 反例 / 退化情况）。
 *
 * 输出 JSON：{ stdin, expectedOutput?, rationale, severity }
 *  - stdin：直接可丢进运行终端的输入（必须满足题目输入格式）
 *  - expectedOutput：能算就给（短样例），不确定就留空
 *  - rationale：为什么这个 case 容易让代码挂（≤ 60 字）
 *  - severity：'edge' | 'large' | 'degenerate' | 'tricky'
 */
export function buildHackCasePrompt(args: {
  problem: Problem;
  code: string;
  language: Lang;
  passedSamples?: Array<{ input: string; output: string }>;
}): PromptPair {
  const samplesBlock = args.passedSamples && args.passedSamples.length > 0
    ? `\n【已经通过的样例（不要重复，要给一个不同维度的挑战）】\n` +
      args.passedSamples
        .slice(0, 2)
        .map((s, i) => `样例 ${i + 1}\n输入：\n${s.input}\n输出：\n${s.output}`)
        .join('\n\n') +
      '\n'
    : '';
  return {
    system:
      `${SYSTEM_CODING_COACH}\n\n你的任务：学生刚跑通了样例，但样例往往覆盖不到边界。请你**主动**构造一个 hack case 挑战这份代码。${SYSTEM_JSON_OUTPUT}`,
    user: `【题目】${args.problem.title}
${clip(args.problem.statement, STATEMENT_MAX)}
${args.problem.constraints ? '【约束】' + clip(args.problem.constraints, CONSTRAINTS_MAX) : ''}
${samplesBlock}
【学生当前 ${args.language} 代码】
\`\`\`${args.language}
${args.code.slice(0, 4500)}
\`\`\`

请构造 1 个最有可能让这份代码挂掉的输入。重点考虑：
- 边界值（最小 / 最大 / 0 / 1 / 题目允许的极端规模）
- 退化结构（已排序 / 全相同 / 一条链 / 极不平衡）
- 整数溢出 / 越界 / 浮点精度
- 题面里容易忽略的特殊情况

输出严格 JSON：
{
  "stdin": "直接可粘进 stdin 的字符串（必须符合输入格式）",
  "expectedOutput": "如果你能心算出正确答案就给，不确定置空字符串",
  "rationale": "为什么这个 case 容易挂（≤ 60 字，**不要泄露最终答案**）",
  "severity": "edge | large | degenerate | tricky"
}

⚠ 输入要简短可读（最好 ≤ 20 行），让学生能直接粘进终端跑。
直接输出 JSON。`,
  };
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
    system: SYSTEM_CODING_COACH + SYSTEM_JSON_OUTPUT,
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
 * Coach 主动嗅探系列（FastLane 专属）。
 *
 * 这三个 prompt 不是给"用户主动点分析"用的，是 Coach **自己想出来的**——
 *   - 学生跑代码失败 → 本地秒级归因（A）
 *   - 学生首次跑通样例 → 一次性数据范围审计（C）
 *   - 学生停下来 90s 但代码还在写 → 题意偏离嗅探（B，最慎重，默认关）
 *
 * 输出尽量短（≤80 字一句话），只写一条 trace + 编辑器角标，**不弹窗不打扰**。
 */

/** A. 编译/运行错误归因：本地秒级，写一条 trace + 角标 */
export function buildDiagnoseRuntimeErrorPrompt(args: {
  problem?: Problem;
  language: Lang;
  code: string;
  exitCode: number;
  stderrTail: string;
  stdinHead?: string;
}): PromptPair {
  const problemBlock = args.problem
    ? `题目：${args.problem.title}\n题面摘要：${clip(args.problem.statement, 600)}\n`
    : '（无激活题目）\n';
  const stdinBlock = args.stdinHead && args.stdinHead.trim()
    ? `\nstdin（首 200 字）：\n${args.stdinHead.slice(0, 200)}\n`
    : '';
  const { numbered, totalLines } = withLineNumbers(args.code);
  return {
    system:
      '你是静默的代码错误归因器。学生刚跑代码失败了，给一句话告诉他大概在哪。' +
      '只看 stderr 和代码做最直接的判断，不要展开讲。' +
      SYSTEM_JSON_OUTPUT,
    user: `${problemBlock}
退出码：${args.exitCode}
stderr（末尾 ≤500 字）：
${clip(args.stderrTail, 500)}
${stdinBlock}
学生当前 ${args.language} 代码（${totalLines} 行，每行带行号）：
\`\`\`
${numbered}
\`\`\`

输出 JSON：
{
  "errorClass": "数组越界 | 段错误 | TLE | RuntimeError | NameError | 编译错误 | 死循环 | 其他",
  "likelyLine": 整数行号(必须 1..${totalLines}) 或 null（实在判断不出来）,
  "oneLineHint": "一句话告诉学生在哪查（≤60 字，要具体到变量名/数组名/函数名，**不要泛泛说"检查边界"**）"
}

直接输出 JSON。`,
  };
}

/** C. 数据范围 sanity check：题目首次跑通样例后一次性扫一眼 */
export function buildSanityCheckConstraintsPrompt(args: {
  problem: Problem;
  language: Lang;
  code: string;
}): PromptPair {
  return {
    system:
      '你是数据范围审计员。学生刚跑通样例，请扫一眼有没有数据范围爆掉的隐患。' +
      '保守一点：看不到明显风险就返回空数组。' +
      SYSTEM_JSON_OUTPUT,
    user: `题目：${args.problem.title}
${args.problem.constraints ? '约束：' + clip(args.problem.constraints, CONSTRAINTS_MAX) : '（题目没给明确约束）'}

学生 ${args.language} 代码：
\`\`\`${args.language}
${args.code.slice(0, 4000)}
\`\`\`

只关注以下风险：
- 整数类型不够（如 n*m 可能超 int 但用了 int）
- 数组/容器开小了（栈数组维度小于约束最大值）
- 复杂度跟约束明显不符（如 N=1e6 但用 O(N²)）
- 容器选择影响显著（vector<vector> 超大、map 当 hash）
- C++ 的 cin/cout 没关同步在大数据下慢

不要重复 issues 里已经会说的语法/逻辑问题，**只看数据范围**。

输出 JSON：
{ "risks": ["≤30 字一条，最多 3 条；没风险返回空数组"] }

直接输出 JSON。`,
  };
}

/** B. 题意偏离嗅探：90s 停顿且代码净增 ≥30 字时，判断方向对不对 */
export function buildSniffIntentPrompt(args: {
  problem: Problem;
  language: Lang;
  code: string;
}): PromptPair {
  const exampleBlock = args.problem.examples?.[0]
    ? `\n样例输入：\n${args.problem.examples[0].input}\n样例输出：\n${args.problem.examples[0].output}\n`
    : '';
  return {
    system:
      '你是题意校对员。学生写了一段代码停下来 90 秒了。判断他的方向对不对。' +
      '**保守判断**：只要思路看起来在轨就说在轨。只有看到明显偏题（算了不该算的指标 / 用错了数据结构 / 漏了关键约束）才报偏离。' +
      SYSTEM_JSON_OUTPUT,
    user: `题目：${args.problem.title}
题面（前 800 字）：
${clip(args.problem.statement, 800)}
${args.problem.constraints ? '约束：' + clip(args.problem.constraints, 400) : ''}
${exampleBlock}
学生当前 ${args.language} 代码：
\`\`\`${args.language}
${args.code.slice(0, 2500)}
\`\`\`

请判断方向：
- onTrack=true：思路在轨。**只要看不到明显偏题就给 true**。
- onTrack=false：明显偏题，evidence 一句话说"你在算 X 但题目要的是 Y"或"用 X 数据结构会导致 Y"。

⚠ 不要把"代码不完整""还没实现完"判成偏题。学生在写一半，方向不错就够。
⚠ 不要给完整解法、不要给伪代码，evidence 只指出方向问题。

输出 JSON：
{ "onTrack": true | false, "evidence": "仅 onTrack=false 时填，≤50 字" }

直接输出 JSON。`,
  };
}

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
/**
 * 把学生问题分成 3 类，不同类型不同长度策略：
 *   - concept    "什么是 X" / 介绍概念    → 篇幅长，要解释 + 举例
 *   - reasoning  "为什么 X" / 对比 / 推理 → 中等，逐步推理
 *   - operation  "怎么写 / 找 bug / 修"   → 极短，1-2 点直击
 */
export type AskQuestionKind = 'concept' | 'reasoning' | 'operation';

export function classifyAskQuestion(q: string): AskQuestionKind {
  // 概念问题：什么是 / 什么叫 / 介绍 / 定义 / 区别 / 含义
  if (/什么是|什么叫|介绍.*?概念|.*?定义|.*?含义|什么意思|怎么理解/.test(q)) {
    return 'concept';
  }
  // 推理问题：为什么 / 为啥 / 比较 / 优劣 / 区别 / 何时
  if (/为什么|为啥|比较|区别|对比|优劣|哪种|什么时候|何时|为何/.test(q)) {
    return 'reasoning';
  }
  // 默认操作类：怎么写 / 怎么改 / 找 bug / 解释这段 / 修复
  return 'operation';
}

/** 每类的 maxTokens 和 system 指令 */
const ASK_PROFILES: Record<
  AskQuestionKind,
  { maxTokens: number; lengthInstruction: string }
> = {
  concept: {
    maxTokens: 1500,
    lengthInstruction:
      '这是概念解释题，可以详细讲：先给定义（1 句），再举例 1-2 个，再点拨如何用到当前题目。**400 字以内**。',
  },
  reasoning: {
    maxTokens: 1000,
    lengthInstruction:
      '这是推理 / 对比题，逐步分析关键差异。**300 字以内**，重点突出。',
  },
  operation: {
    maxTokens: 600,
    lengthInstruction:
      '这是具体操作题（怎么改 / 找 bug / 修），**150 字以内**，直接给 1-2 个最关键的点。',
  },
};

export function buildAskQuestionPrompt(args: {
  problem?: Problem;
  code?: string;
  language?: Lang;
  question: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}): {
  system: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  kind: AskQuestionKind;
  maxTokens: number;
} {
  const kind = classifyAskQuestion(args.question);
  const profile = ASK_PROFILES[kind];

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
- 用 markdown，可以用 \`code\` / 列表 / **粗体**
- ${profile.lengthInstruction}
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

  return { system, messages, kind, maxTokens: profile.maxTokens };
}

/**
 * 仅生成「白话解释」，用于已经从 OJ 抓回结构化题目但缺 plainExplanation 的情况。
 * 比 buildParseProblemPrompt 轻得多：只让模型读一段题面、出 ≤150 字白话。
 */
export function buildPlainExplanationPrompt(args: {
  title: string;
  statement: string;
  examples?: Array<{ input: string; output: string }>;
}): PromptPair {
  const exampleText =
    args.examples && args.examples[0]
      ? `\n样例输入：\n${args.examples[0].input}\n样例输出：\n${args.examples[0].output}`
      : '';
  return {
    system:
      '你是讲题助教，用大学新生听得懂的话解释题目要干什么。' +
      '不要复述原题长句，不要给算法/解法/思路，不要泄露答案。150 字以内，纯文本不带 Markdown。',
    user: `题目：${args.title}

题面：
${args.statement.slice(0, 1500)}
${exampleText}

请用白话告诉我这题到底要做什么、输入给了什么、输出要算什么、样例为什么是这个值。150 字以内，不要谈解法。`,
  };
}

export function buildParseProblemPrompt(rawText: string): PromptPair {
  return {
    system:
      '你是题目结构化解析助手。直接输出 JSON 对象（不要代码块包裹、不要解释）。statement 字段必须是 Markdown 格式：要求/规则用列表项分行、段落用空行分隔、不要写成连续大段文字。',
    user: `解析为 JSON：
{
  "title": "题目标题",
  "statement": "Markdown 格式的题面（去除示例/约束/UI杂讯）",
  "inputFormat": "输入格式",
  "outputFormat": "输出格式",
  "constraints": "数据范围/时空限制",
  "plainExplanation": "白话解释：用大学新生也能听懂的话说明这题到底要做什么、输入给了什么、输出要算什么、样例为什么这样，不要给算法答案，150 字以内",
  "examples": [{"input": "...", "output": "...", "explanation": "..."}],
  "tags": ["算法/数据结构知识点"],
  "difficulty": "easy | medium | hard"
}

statement 关键要求：
- 多条要求一定分行写成列表，例如：
  - 时分秒固定 2 位，不足补 0
  - 年份固定 4 位
- 不要保留「1、」「2、」中文编号
- 不要保留 UI 文字（"样例查看模式"/"正常显示"/"复制"等）
- 段落之间空一行
- plainExplanation 要放在题目解析底部展示，必须是白话，不要复述原题长句，不要提前泄露完整解法

字段缺失置空字符串或空数组。

原文：
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
  /** 最近一次本地运行的快照：让 AI 能看到 stderr / exitCode / stdin，给出对症建议 */
  runtimeContext?: {
    exitCode: number;
    stdin?: string;
    stdout?: string;
    stderr?: string;
    durationMs?: number;
    timestamp?: number;
  };
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
  const runtimeBlock = renderRuntimeContext(args.runtimeContext);

  const { numbered, totalLines, truncated } = withLineNumbers(args.code);
  // 当前代码哈希（前 6 字符），AI 通过对照 history 里的 codeHash 判断"代码是否改了"
  const currentHash = codeHash(args.code).slice(0, 6);

  return {
    system: SYSTEM_CODING_COACH + SYSTEM_JSON_OUTPUT,
    user: `${problemContext}
${profileBlock}
${historyBlock}
${siblingBlock}
${runtimeBlock}
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

/** 渲染最近一次运行的快照：exitCode + stderr + stdin + stdout 给 AI 看 */
function renderRuntimeContext(rc?: {
  exitCode: number;
  stdin?: string;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  timestamp?: number;
}): string {
  if (!rc) return '';
  const failed = rc.exitCode !== 0;
  const ageSec = rc.timestamp ? Math.round((Date.now() - rc.timestamp) / 1000) : 0;
  const banner = failed
    ? '【🔥 上次运行失败 — 优先解释这个错误】'
    : '【上次运行 — 已通过，可作为参考】';
  const lines: string[] = [banner];
  lines.push(`退出码：${rc.exitCode}${failed ? '（失败！）' : '（正常）'}` +
    (rc.durationMs !== undefined ? ` · 耗时 ${rc.durationMs.toFixed(0)}ms` : '') +
    (ageSec ? ` · ${ageSec}s 前` : ''));
  if (rc.stdin && rc.stdin.trim()) {
    lines.push(`stdin（用户实际输入）:\n${clip(rc.stdin, 500)}`);
  }
  if (rc.stderr && rc.stderr.trim()) {
    lines.push(`stderr（错误输出）:\n${clip(rc.stderr, 1500)}`);
  }
  if (rc.stdout && rc.stdout.trim()) {
    lines.push(`stdout（标准输出）:\n${clip(rc.stdout, 500)}`);
  }
  if (failed) {
    lines.push(
      '⚠ 重要：这次运行失败了！issues 数组里**必须至少一条 error**指出失败的根本原因，' +
      '直接对应 stderr 里的具体错误（如越界 / bad_alloc / segfault / TLE / RuntimeError 等），' +
      '并给出具体到哪一行的修改建议。**不要泛泛说"检查边界"**，要指出哪个变量哪个下标越界了。',
    );
  }
  return lines.join('\n') + '\n';
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
      system: SYSTEM_CODING_COACH + SYSTEM_JSON_OUTPUT,
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
    system: SYSTEM_CODING_COACH + SYSTEM_JSON_OUTPUT,
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
