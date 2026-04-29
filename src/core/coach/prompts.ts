import { SYSTEM_CODING_COACH } from '../ai/prompts';
import type { CoachIntent, CoachRoute } from './types';

interface IntentProfile {
  maxTokens: number;
  instruction: string;
}

const INTENT_PROFILES: Record<CoachIntent, IntentProfile> = {
  understand_problem: {
    maxTokens: 1200,
    instruction:
      '学生在问题意。任务：用 3-5 句白话讲清楚题目要做什么、输入是什么、输出是什么，再用 1-2 行解释样例为什么是这样。不给算法、不给完整代码、不要复述原题长句。300 字以内。',
  },
  check_idea: {
    maxTokens: 800,
    instruction:
      '学生在描述自己的思路。任务：先用 1 句复述他的思路确认理解，再点出 1-2 处可能漏掉的边界或复杂度问题。不要直接告诉他正确算法，多用反问让他自己改。200 字以内。',
  },
  debug_runtime_error: {
    maxTokens: 800,
    instruction:
      '学生有运行错误。任务：第 1 段先告诉他这次报错的根本原因（指出 stderr 的关键信息）；第 2 段给可疑行号和最小修改建议；不要重写整段代码。200 字以内。',
  },
  review_code: {
    maxTokens: 800,
    instruction:
      '学生在让你检查代码。任务：列 1-3 个最可能的问题，每条必须带行号，并给出最小改动建议。不要重写整段代码。150 字以内。',
  },
  explain_selection: {
    maxTokens: 600,
    instruction:
      '学生选中了一段代码。任务：先一句话说这段在干什么，再指出 1 处潜在风险或可读性问题（如果有）。不要扩展讲整道题。120 字以内。',
  },
  stuck_hint: {
    maxTokens: 500,
    instruction:
      '学生卡住了。任务：用苏格拉底式提问，提 1-2 个具体的问题引导他自己想下一步，禁止直接给答案、禁止给伪代码。100 字以内。',
  },
  general_question: {
    maxTokens: 700,
    instruction:
      '回答学生具体的问题。要简短、直接，可以给伪代码或思路片段，但不要给完整 AC 代码。200 字以内。',
  },
};

export function buildCoachPrompt(args: {
  route: CoachRoute;
  context: string;
  userText: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}): {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  maxTokens: number;
} {
  const profile = INTENT_PROFILES[args.route.intent] ?? INTENT_PROFILES.general_question;
  const system = `${SYSTEM_CODING_COACH}

你在统一 Coach 面板里回答。系统已判断学生意图为「${args.route.intent}」。
${profile.instruction}
通用规则：
- 不要重复学生原话
- markdown 短列表 / 行号引用 / 行内 code 都可用
- 不要写「希望对你有帮助」之类的客套结尾`;
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: system },
    { role: 'user', content: `当前上下文：\n${args.context}` },
  ];
  for (const item of args.history?.slice(-6) ?? []) {
    messages.push({ role: item.role, content: item.content });
  }
  messages.push({ role: 'user', content: args.userText });
  return { messages, maxTokens: profile.maxTokens };
}
