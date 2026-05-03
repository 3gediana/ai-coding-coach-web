import type { AIConfig, AIProvider } from '../types';

export const DEFAULT_CLOUD_CONTEXT_TOKENS = 200_000;
export const DEFAULT_OLLAMA_CONTEXT_TOKENS = 20_480;
export const COACH_SYSTEM_PROMPT_ESTIMATE_TOKENS = 520;

const MIN_CONTEXT_TOKENS = 8_192;
const MAX_HISTORY_ROUNDS = 80;
const MIN_HISTORY_ROUNDS = 3;
const AVG_COACH_ROUND_TOKENS = 1_200;

const MODEL_CONTEXT_TOKENS: Record<string, number> = {
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,

  'MiniMax-M2.7': 196_000,
  'MiniMax-M2.7-highspeed': 196_000,
  'MiniMax-M2.5': 196_000,
  'MiniMax-M2.5-highspeed': 196_000,
  'MiniMax-M2': 196_000,

  'gpt-5.5': 1_050_000,
  'gpt-5.4': 400_000,
  'gpt-5.4-mini': 400_000,
  'gpt-5.4-nano': 400_000,
  'gpt-5.1-codex': 400_000,

  'qwen3.5-plus': DEFAULT_CLOUD_CONTEXT_TOKENS,
  'qwen3.5-flash': DEFAULT_CLOUD_CONTEXT_TOKENS,
  'qwen-plus-latest': DEFAULT_CLOUD_CONTEXT_TOKENS,
  'qwen-flash': DEFAULT_CLOUD_CONTEXT_TOKENS,
  'qwen3-coder-32b-instruct': 128_000,

  'glm-5.1': 200_000,
  'glm-5': 200_000,
  'glm-5-flash': 200_000,
  'glm-4.7-flash': 128_000,
  'glm-4.5-flash': 128_000,

  'kimi-k2.6': 256_000,
  'moonshot-v1-128k': 128_000,
  'moonshot-v1-32k': 32_000,
  'moonshot-v1-8k': 8_000,

  'claude-opus-4.7': 1_000_000,
  'claude-opus-4.6': 1_000_000,
  'claude-sonnet-4.6': 200_000,
  'claude-haiku-4.5': 200_000,

  'gemini-3.1-pro': 1_000_000,
  'gemini-3.1-flash': 1_000_000,
  'gemini-3.1-flash-lite': 1_000_000,
  'gemini-3.1-pro-preview-customtools': 1_000_000,

  'qwen3.5:4b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
  'qwen3-coder:7b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
  'qwen2.5-coder:7b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
  'deepseek-r1:7b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
  'deepseek-coder:6.7b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
  'llama3.2:3b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
  'gemma3:4b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
};

function isCloudProvider(provider: AIProvider): boolean {
  return provider !== 'ollama';
}

export function estimateTextTokens(text: string | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 2.4);
}

export function estimateMessagesTokens(messages: Array<{ content: string }>): number {
  return messages.reduce((sum, m) => sum + estimateTextTokens(m.content) + 4, 0);
}

export function formatTokenWindow(tokens: number | undefined): string {
  if (!tokens) return '未设置';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 2)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

export function inferModelContextWindowTokens(
  provider: AIProvider,
  model: string | undefined,
  fallback?: number,
): number {
  const trimmed = model?.trim();
  if (trimmed && MODEL_CONTEXT_TOKENS[trimmed]) return MODEL_CONTEXT_TOKENS[trimmed];
  if (fallback && fallback > 0) return fallback;
  return isCloudProvider(provider) ? DEFAULT_CLOUD_CONTEXT_TOKENS : DEFAULT_OLLAMA_CONTEXT_TOKENS;
}

export function effectiveContextWindowTokens(cfg: Pick<AIConfig, 'provider' | 'model' | 'numCtx' | 'contextWindowTokens'>): number {
  if (cfg.contextWindowTokens && cfg.contextWindowTokens > 0) return cfg.contextWindowTokens;
  if (cfg.provider === 'ollama' && cfg.numCtx && cfg.numCtx > 0) return cfg.numCtx;
  return inferModelContextWindowTokens(cfg.provider, cfg.model);
}

export function estimateCoachHistoryRounds(contextWindowTokens: number | undefined): number {
  const windowTokens = Math.max(MIN_CONTEXT_TOKENS, contextWindowTokens || DEFAULT_CLOUD_CONTEXT_TOKENS);
  return Math.max(
    MIN_HISTORY_ROUNDS,
    Math.min(MAX_HISTORY_ROUNDS, Math.floor(windowTokens / (AVG_COACH_ROUND_TOKENS * 6))),
  );
}

export function planCoachHistoryBudget(args: {
  contextWindowTokens: number;
  basePromptTokens: number;
  responseTokens: number;
}): {
  maxHistoryRounds: number;
  maxHistoryMessages: number;
  historyTokenBudget: number;
  availableInputTokens: number;
} {
  const safetyTokens = Math.max(1_000, Math.floor(args.contextWindowTokens * 0.08));
  const availableInputTokens = Math.max(
    0,
    args.contextWindowTokens - args.basePromptTokens - args.responseTokens - safetyTokens,
  );
  const maxHistoryRounds = estimateCoachHistoryRounds(args.contextWindowTokens);
  const historyTokenBudget = Math.max(0, Math.min(availableInputTokens, Math.floor(args.contextWindowTokens * 0.45)));
  return {
    maxHistoryRounds,
    maxHistoryMessages: maxHistoryRounds * 2,
    historyTokenBudget,
    availableInputTokens,
  };
}

export function selectRecentHistoryByBudget<T extends { role: 'user' | 'assistant'; content: string }>(
  history: T[] | undefined,
  maxMessages: number,
  tokenBudget: number,
): T[] {
  const items = (history ?? []).filter((m) => m.content.trim());
  const selected: T[] = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0 && selected.length < maxMessages; i--) {
    const item = items[i];
    const cost = estimateTextTokens(item.content) + 4;
    if (selected.length > 0 && used + cost > tokenBudget) break;
    selected.unshift(item);
    used += cost;
  }
  return selected;
}

export function mergeAdjacentMessages<T extends { role: 'system' | 'user' | 'assistant'; content: string }>(messages: T[]): T[] {
  const merged: T[] = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      merged.push({ ...m });
    }
  }
  return merged;
}
