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
export function buildAnalyzeCodePrompt(args: {
  problem?: Problem;
  code: string;
  language: Lang;
  profile?: LearnerProfile;
  history?: AnalysisHistoryEntry[];
}): PromptPair {
  const problemContext = args.problem
    ? `【当前题目】
标题：${args.problem.title}
题面：${args.problem.statement}
${args.problem.constraints ? '约束：' + args.problem.constraints : ''}`
    : '（用户未录入题目，仅就代码本身进行分析）';

  const profileBlock = renderProfile(args.profile);
  const historyBlock = renderHistory(args.history);

  return {
    system: SYSTEM_CODING_COACH,
    user: `${problemContext}
${profileBlock}
${historyBlock}
【学生提交的 ${args.language} 代码】
\`\`\`${args.language}
${args.code}
\`\`\`

输出 JSON：
{
  "issues": [
    {
      "line": 行号(1-indexed, 整数),
      "severity": "error" | "warning" | "info" | "hint",
      "category": "bug" | "optimization" | "style" | "algorithm",
      "message": "问题描述（一句话）",
      "suggestion": "具体怎么改（一两句话）"
    }
  ],
  "complexitySummary": "时间 O(...)，空间 O(...)，简短说明",
  "overallComment": "整体评价（2-3 句话：能否 AC，关键瓶颈在哪）"
}

要求：
1. 按严重程度排序，最关键的问题排第一
2. 不要为没问题的代码硬找问题，issues 可以为空数组
3. 重点关注：边界条件、TLE/MLE 风险、算法选择、语言特性陷阱
   - C++：数组越界、未初始化、整数溢出 (int vs long long)、cin/cout 同步、vector 拷贝
   - Python：默认参数陷阱、大数据下的 list 操作、递归深度、is vs ==
4. 如果上方提供了"学生学习画像"，请重点针对其薄弱知识点给出提醒（即使代码当前没暴露，也要预警相关风险）
5. 如果上方提供了"本题反馈历史"：
   - 已被指出且学生已修复的问题：不要再说
   - 已被指出但仍存在的问题：简短复盘一句，不展开
   - 重点说"新出现"的问题
6. 直接输出 JSON`,
  };
}

function renderProfile(p?: LearnerProfile): string {
  if (!p || p.totalProblems === 0) {
    return '';
  }
  const lines: string[] = ['', '【学生学习画像（用于针对性反馈）】'];
  lines.push(`已练 ${p.totalProblems} 道题，错题 ${p.totalMistakes} 道`);
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
  h.forEach((e, i) => {
    const t = new Date(e.ts).toLocaleTimeString();
    if (e.issuesSnapshot.length === 0) {
      lines.push(`第 ${i + 1} 次（${t}, ${e.reason}）：未发现问题`);
    } else {
      lines.push(`第 ${i + 1} 次（${t}, ${e.reason}）：`);
      e.issuesSnapshot.forEach((s) => {
        lines.push(`  · L${s.line} ${s.severity}/${s.category}: ${s.message}`);
      });
    }
  });
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
