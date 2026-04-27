/**
 * AI 服务预设：仅作为快速填充模板，用户可任意改 baseUrl / model / apiKey。
 *
 * baseUrl 必须是完整的 chat-completions endpoint：
 *   - 大部分 OpenAI 兼容服务：https://.../v1/chat/completions
 *   - MiniMax 原生：https://api.minimaxi.com/v1/text/chatcompletion_v2（也兼容）
 */
import type { AIConfig, AIProvider } from '../core/types';

export interface AIPreset {
  id: AIProvider;
  label: string;
  hint: string;
  baseUrl: string;
  defaultModel: string;
  modelExamples: string[];
  apiKeyPage?: string;
}

export const PRESETS: AIPreset[] = [
  {
    id: 'minimax',
    label: 'MiniMax (海螺)',
    hint: 'M2 推理模型，质量高但延迟大；建议开流式',
    baseUrl: 'https://api.minimaxi.com/v1/text/chatcompletion_v2',
    defaultModel: 'MiniMax-M2',
    modelExamples: ['MiniMax-M2', 'MiniMax-M1', 'abab6.5s-chat'],
    apiKeyPage: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    hint: '便宜、快、推理能力强；推荐 deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    modelExamples: ['deepseek-chat', 'deepseek-reasoner'],
    apiKeyPage: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    hint: '官方接口；需要外网访问',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    modelExamples: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    apiKeyPage: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'qwen',
    label: '通义千问 (DashScope)',
    hint: '阿里云；模型多',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-plus',
    modelExamples: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen2.5-coder-32b-instruct'],
    apiKeyPage: 'https://dashscope.console.aliyun.com/apiKey',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    hint: 'GLM-4 系列；新手友好',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-4-plus',
    modelExamples: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'],
    apiKeyPage: 'https://bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'moonshot',
    label: 'Kimi (Moonshot)',
    hint: '长上下文友好',
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'moonshot-v1-32k',
    modelExamples: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    apiKeyPage: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'ollama',
    label: 'Ollama (本地)',
    hint: '本地模型；零成本但靠机器性能',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'qwen2.5-coder:7b',
    modelExamples: ['qwen2.5-coder:7b', 'deepseek-coder:6.7b', 'llama3.1:8b'],
  },
  {
    id: 'custom',
    label: '自定义',
    hint: '任意 OpenAI 兼容 endpoint',
    baseUrl: 'https://your-endpoint.com/v1/chat/completions',
    defaultModel: '',
    modelExamples: [],
  },
];

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'minimax',
  baseUrl: PRESETS[0].baseUrl,
  apiKey: '',
  model: PRESETS[0].defaultModel,
  maxTokens: 8000,
  temperature: 0.3,
  timeoutMs: 180_000,
  maxRetries: 2,
};
