import type { AIClient } from '../ai/client';
import type { CoachContextTemplate, CoachIntent, CoachOutputMode, CoachRoute, CoachRouteInput } from './types';

const intents: CoachIntent[] = [
  'understand_problem',
  'check_idea',
  'debug_runtime_error',
  'review_code',
  'explain_selection',
  'stuck_hint',
  'general_question',
];

const templates: CoachContextTemplate[] = [
  'problem_only',
  'problem_with_code_summary',
  'runtime_debug',
  'selection',
  'full_code_review',
  'general',
];

const modes: CoachOutputMode[] = ['chat', 'chat_with_inline_issues'];

export async function routeCoachRequest(
  input: CoachRouteInput,
  routerClient?: AIClient | null,
): Promise<CoachRoute> {
  const rule = routeByRules(input);
  if (rule.confidence >= 0.8 || !routerClient) return rule;
  try {
    const routed = await routeByModel(input, routerClient);
    if (routed && routed.confidence >= 0.65) return routed;
  } catch {
    return { ...rule, routedBy: 'fallback' };
  }
  return { ...rule, routedBy: 'fallback' };
}

function routeByRules(input: CoachRouteInput): CoachRoute {
  const text = input.text.trim().toLowerCase();
  const hasRunError = typeof input.lastRun?.exitCode === 'number' && input.lastRun.exitCode !== 0;
  if (input.source === 'runtime-error') {
    return route('debug_runtime_error', 'runtime_debug', 'chat_with_inline_issues', 0.98, '来自运行失败入口');
  }
  if (input.source === 'selection' || input.hasSelection) {
    return route('explain_selection', 'selection', 'chat', 0.94, '来自代码选区');
  }
  if (input.source === 'stuck') {
    return route('stuck_hint', 'problem_with_code_summary', 'chat', 0.9, '来自卡住入口');
  }
  if (hasRunError && /咋办|怎么办|报错|错误|失败|为什么|怎么改|看|帮/.test(text)) {
    return route('debug_runtime_error', 'runtime_debug', 'chat_with_inline_issues', 0.94, '最近一次运行失败');
  }
  if (/题意|读题|这题.*(什么意思|意思|理解)|样例|输入输出|约束|要求/.test(text)) {
    return route('understand_problem', 'problem_only', 'chat', 0.9, '用户在问题意');
  }
  if (/思路|想法|做法|方案|这样.*对|复杂度|能不能/.test(text)) {
    return route('check_idea', 'problem_with_code_summary', 'chat', 0.84, '用户在检查思路');
  }
  if (/哪里错|哪错|错了|不对|bug|wa|过不了|检查.*代码|看看.*代码|看.*哪里|分析代码|review/.test(text)) {
    return route('review_code', 'full_code_review', 'chat_with_inline_issues', 0.88, '用户在要求检查代码');
  }
  if (/不会|卡住|没思路|下一步|然后呢|咋办|怎么办/.test(text)) {
    if (hasRunError) {
      return route('debug_runtime_error', 'runtime_debug', 'chat_with_inline_issues', 0.82, '模糊求助且最近运行失败');
    }
    const idle = input.behavior?.idleSeconds ?? 0;
    if (idle >= 90) {
      return route('stuck_hint', 'problem_with_code_summary', 'chat', 0.82, `模糊求助且停手 ${Math.round(idle / 60)} 分钟`);
    }
    return route('stuck_hint', 'problem_with_code_summary', 'chat', 0.7, '模糊卡住求助');
  }
  if (input.behavior?.unresolvedIssueCount && input.behavior.unresolvedIssueCount > 0 && /怎么改|怎么修|这条|批注/.test(text)) {
    return route('review_code', 'full_code_review', 'chat_with_inline_issues', 0.8, '存在未修复批注，倾向继续审查代码');
  }
  return route('general_question', input.hasProblem ? 'problem_with_code_summary' : 'general', 'chat', 0.55, '默认普通问答');
}

async function routeByModel(input: CoachRouteInput, client: AIClient): Promise<CoachRoute | null> {
  const data = await client.chatJson<Partial<CoachRoute>>({
    messages: [
      { role: 'system', content: 'You are a strict JSON classifier. Return compact JSON only.' },
      { role: 'user', content: buildRouterPrompt(input) },
    ],
    maxTokens: 160,
    temperature: 0,
    timeoutMs: 8_000,
    maxRetries: 0,
  });
  const intent = data.intent;
  const contextTemplate = data.contextTemplate;
  const outputMode = data.outputMode;
  if (!intents.includes(intent as CoachIntent)) return null;
  if (!templates.includes(contextTemplate as CoachContextTemplate)) return null;
  if (!modes.includes(outputMode as CoachOutputMode)) return null;
  return {
    intent: intent as CoachIntent,
    contextTemplate: contextTemplate as CoachContextTemplate,
    outputMode: outputMode as CoachOutputMode,
    confidence: clampConfidence(data.confidence),
    reason: typeof data.reason === 'string' ? data.reason.slice(0, 80) : 'AI 路由判断',
    routedBy: 'ai',
  };
}

function route(
  intent: CoachIntent,
  contextTemplate: CoachContextTemplate,
  outputMode: CoachOutputMode,
  confidence: number,
  reason: string,
): CoachRoute {
  return { intent, contextTemplate, outputMode, confidence, reason, routedBy: 'rule' };
}

function buildRouterPrompt(input: CoachRouteInput): string {
  const b = input.behavior;
  const behaviorBits = b
    ? `, idleSeconds=${b.idleSeconds}, acCount=${b.acCount}, wrongCount=${b.wrongCount}, inMistakeBook=${b.inMistakeBook}, unresolvedIssueCount=${b.unresolvedIssueCount}`
    : '';
  return `Classify the student request. Allowed intent: understand_problem, check_idea, debug_runtime_error, review_code, explain_selection, stuck_hint, general_question. Allowed contextTemplate: problem_only, problem_with_code_summary, runtime_debug, selection, full_code_review, general. Allowed outputMode: chat, chat_with_inline_issues. Rules: nonzero lastRunExitCode => debug_runtime_error/runtime_debug/chat_with_inline_issues. selected code => explain_selection/selection/chat. asks code wrong/bug/WA/review => review_code/full_code_review/chat_with_inline_issues. asks problem meaning/sample/input/output => understand_problem/problem_only/chat. idleSeconds>=90 with vague help request => stuck_hint/problem_with_code_summary/chat. Return JSON keys intent, contextTemplate, outputMode, confidence, reason. State: source=${input.source ?? 'manual'}, hasProblem=${input.hasProblem}, hasSelection=${input.hasSelection}, codeLength=${input.codeLength}, codeLineCount=${input.codeLineCount}, lastRunExitCode=${input.lastRun?.exitCode ?? 'null'}, stderrBrief=${JSON.stringify(input.lastRun?.stderrBrief ?? '')}, recentAction=${input.recentAction ?? ''}${behaviorBits}. User: ${input.text} /no_think`;
}

function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0.7;
  return Math.max(0, Math.min(1, n));
}
