import { SYSTEM_CODING_COACH } from '../ai/prompts';
import {
  COACH_SYSTEM_PROMPT_ESTIMATE_TOKENS,
  estimateMessagesTokens,
  mergeAdjacentMessages,
  planCoachHistoryBudget,
  selectRecentHistoryByBudget,
} from './contextBudget';
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
      '学生有运行错误。任务：先提 1 个具体定位问题，引导他观察 stderr、输入和可疑行之间的关系；再给 1-2 条线索。只说“我目前怀疑…”，不要直接宣布最终答案，不要重写代码。200 字以内。',
  },
  review_code: {
    maxTokens: 800,
    instruction:
      '学生在让你检查代码。任务：先问 1 个能暴露 bug 的验证问题；再列 1-3 个最可能的问题，每条带行号和验证方式。少给结论，多让学生用最小样例/不变量自己确认。不要重写整段代码。180 字以内。',
  },
  explain_selection: {
    maxTokens: 600,
    instruction:
      '学生选中了一段代码。任务：先一句话说这段在干什么，再用 1 个具体反问引导他验证潜在风险。不要扩展讲整道题，不要直接给改法，不要说“应该改成/移到/加上”。120 字以内。',
  },
  stuck_hint: {
    maxTokens: 500,
    instruction:
      '学生卡住了。任务：用苏格拉底式提问，提 1-2 个具体的问题引导他自己想下一步，禁止直接给答案、禁止给伪代码。100 字以内。',
  },
  general_question: {
    maxTokens: 700,
    instruction:
      '回答学生具体的问题。若和当前题目/代码有关，先问 1 个澄清或自检问题，再给短线索；若是纯概念问题，可以直接解释。不要给完整 AC 代码。200 字以内。',
  },
};

export function buildCoachPrompt(args: {
  route: CoachRoute;
  context: string;
  userText: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  contextWindowTokens?: number;
}): {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  historyMeta: {
    contextWindowTokens: number;
    selectedMessages: number;
    selectedRounds: number;
    historyTokenBudget: number;
    basePromptTokens: number;
  };
} {
  const profile = INTENT_PROFILES[args.route.intent] ?? INTENT_PROFILES.general_question;
  const system = `${SYSTEM_CODING_COACH}

你在统一 Coach 面板里回答。系统已判断学生意图为「${args.route.intent}」。
${profile.instruction}
通用规则：
- 不要重复学生原话
- 默认采用苏格拉底式：先让学生观察一个具体变量、条件、样例或行号，再给线索
- 除非学生明确要求最终答案，否则不要直接给完整解法、完整代码或一次性修完所有问题
- 结论要用“我目前怀疑 / 先验证”这种措辞，避免替学生完成思考
- markdown 短列表 / 行号引用 / 行内 code 都可用
- 不要写「希望对你有帮助」之类的客套结尾`;
  const baseMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: system },
    { role: 'user', content: `当前上下文：\n${args.context}` },
  ];
  const finalUserMessage = { role: 'user' as const, content: args.userText };
  const contextWindowTokens = args.contextWindowTokens ?? 200_000;
  const basePromptTokens =
    COACH_SYSTEM_PROMPT_ESTIMATE_TOKENS + estimateMessagesTokens([...baseMessages, finalUserMessage]);
  const budget = planCoachHistoryBudget({
    contextWindowTokens,
    basePromptTokens,
    responseTokens: profile.maxTokens,
  });
  const selectedHistory = selectRecentHistoryByBudget(
    args.history,
    budget.maxHistoryMessages,
    budget.historyTokenBudget,
  );
  const messages = [...baseMessages];
  for (const item of selectedHistory) {
    messages.push({ role: item.role, content: item.content });
  }
  messages.push(finalUserMessage);
  return {
    messages: mergeAdjacentMessages(messages),
    maxTokens: profile.maxTokens,
    historyMeta: {
      contextWindowTokens,
      selectedMessages: selectedHistory.length,
      selectedRounds: Math.ceil(selectedHistory.length / 2),
      historyTokenBudget: budget.historyTokenBudget,
      basePromptTokens,
    },
  };
}
