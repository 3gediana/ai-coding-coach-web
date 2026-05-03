/**
 * AI 服务预设：仅作为快速填充模板，用户可任意改 baseUrl / model / apiKey。
 *
 * baseUrl 必须是完整的 chat-completions endpoint：
 *   - 大部分 OpenAI 兼容服务：https://.../v1/chat/completions
 *   - MiniMax 原生：https://api.minimaxi.com/v1/text/chatcompletion_v2（也兼容）
 */
import type { AIConfig, AIProvider } from '../core/types';
import { DEFAULT_CLOUD_CONTEXT_TOKENS, DEFAULT_OLLAMA_CONTEXT_TOKENS } from '../core/coach/contextBudget';

export interface AIPreset {
  id: AIProvider;
  label: string;
  hint: string;
  baseUrl: string;
  defaultModel: string;
  modelExamples: string[];
  apiKeyPage?: string;
  defaultContextWindowTokens?: number;
  modelContextTokens?: Record<string, number>;
}

/**
 * 模型预设（更新于 2026.05）：
 *   - DeepSeek 官方 list models: deepseek-v4-flash / deepseek-v4-pro
 *   - MiniMax 官方 M2.7 / M2.7-highspeed
 *   - OpenAI 官方 Models: GPT-5.5 / GPT-5.4-mini / GPT-5.4-nano / GPT-5.1 Codex
 *   - DashScope OpenAI-compatible: qwen3.5-plus / qwen3.5-flash / qwen-plus-latest
 *   - 智谱 Z.AI release notes: GLM-5.1 / GLM-5 / GLM-4.7-Flash
 *   - Kimi 官方 Model List: kimi-k2.6（旧 K2 系列 2026-05-25 停止维护）
 *   - Anthropic Claude Models: Opus 4.7 / Opus 4.6 / Sonnet 4.6 / Haiku 4.5
 *   - Gemini API Models: Gemini 3.1 Pro / 3.1 Flash / 3.1 Flash-Lite
 *
 * 顺序就是 SettingsModal 里 chip 的展示顺序；DeepSeek 排首位是因为对中文用户最友好、最便宜。
 */
export const PRESETS: AIPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    hint: 'V4 旗舰（1M 上下文，2026.04 开源）；价格屠夫，百万上下文 ≈ 2 毛 · 中文用户首选',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-v4-flash',
    modelExamples: [
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner',
    ],
    apiKeyPage: 'https://platform.deepseek.com/api_keys',
    defaultContextWindowTokens: 1_000_000,
    modelContextTokens: {
      'deepseek-v4-flash': 1_000_000,
      'deepseek-v4-pro': 1_000_000,
      'deepseek-chat': 64_000,
      'deepseek-reasoner': 64_000,
    },
  },
  {
    id: 'minimax',
    label: 'MiniMax (海螺)',
    hint: 'M2.7 / M2.7-highspeed；长上下文 + 强 Agent，适合代码工具',
    baseUrl: 'https://api.minimaxi.com/v1/text/chatcompletion_v2',
    defaultModel: 'MiniMax-M2.7',
    modelExamples: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2'],
    apiKeyPage: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    defaultContextWindowTokens: 196_000,
    modelContextTokens: {
      'MiniMax-M2.7': 196_000,
      'MiniMax-M2.7-highspeed': 196_000,
      'MiniMax-M2.5': 196_000,
      'MiniMax-M2.5-highspeed': 196_000,
      'MiniMax-M2': 196_000,
    },
  },
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'GPT-5.5 旗舰；GPT-5.4 mini/nano 适合低延迟低成本；Codex 适合代码任务',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-5.5',
    modelExamples: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.1-codex'],
    apiKeyPage: 'https://platform.openai.com/api-keys',
    defaultContextWindowTokens: 1_050_000,
    modelContextTokens: {
      'gpt-5.5': 1_050_000,
      'gpt-5.4': 400_000,
      'gpt-5.4-mini': 400_000,
      'gpt-5.4-nano': 400_000,
      'gpt-5.1-codex': 400_000,
    },
  },
  {
    id: 'qwen',
    label: '通义千问 (DashScope)',
    hint: 'Qwen 3.5 Plus/Flash；阿里云 OpenAI 兼容接口；coder 系列代码强',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen3.5-plus',
    modelExamples: ['qwen3.5-plus', 'qwen3.5-flash', 'qwen-plus-latest', 'qwen-flash', 'qwen3-coder-32b-instruct'],
    apiKeyPage: 'https://dashscope.console.aliyun.com/apiKey',
    defaultContextWindowTokens: DEFAULT_CLOUD_CONTEXT_TOKENS,
    modelContextTokens: {
      'qwen3.5-plus': DEFAULT_CLOUD_CONTEXT_TOKENS,
      'qwen3.5-flash': DEFAULT_CLOUD_CONTEXT_TOKENS,
      'qwen-plus-latest': DEFAULT_CLOUD_CONTEXT_TOKENS,
      'qwen-flash': DEFAULT_CLOUD_CONTEXT_TOKENS,
      'qwen3-coder-32b-instruct': 128_000,
    },
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    hint: 'GLM-5.1 旗舰；GLM-4.7-Flash 适合低成本快速任务',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-5.1',
    modelExamples: ['glm-5.1', 'glm-5', 'glm-5-flash', 'glm-4.7-flash', 'glm-4.5-flash'],
    apiKeyPage: 'https://bigmodel.cn/usercenter/apikeys',
    defaultContextWindowTokens: 200_000,
    modelContextTokens: {
      'glm-5.1': 200_000,
      'glm-5': 200_000,
      'glm-5-flash': 200_000,
      'glm-4.7-flash': 128_000,
      'glm-4.5-flash': 128_000,
    },
  },
  {
    id: 'moonshot',
    label: 'Kimi (Moonshot)',
    hint: 'K2.6 长上下文 + 代码 Agent；旧 K2 系列即将停止维护',
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'kimi-k2.6',
    modelExamples: ['kimi-k2.6', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
    apiKeyPage: 'https://platform.moonshot.cn/console/api-keys',
    defaultContextWindowTokens: 256_000,
    modelContextTokens: {
      'kimi-k2.6': 256_000,
      'moonshot-v1-128k': 128_000,
      'moonshot-v1-32k': 32_000,
      'moonshot-v1-8k': 8_000,
    },
  },
  {
    id: 'mimo',
    label: 'Mimo Token Plan',
    hint: '小米 Mimo Token Plan OpenAI 兼容接口；V2.5 Pro 强模型，注意实际模型名为 mimo-v2.5-pro',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
    defaultModel: 'mimo-v2.5-pro',
    modelExamples: ['mimo-v2.5-pro', 'mimo-v2.5'],
    defaultContextWindowTokens: DEFAULT_CLOUD_CONTEXT_TOKENS,
    modelContextTokens: {
      'mimo-v2.5-pro': DEFAULT_CLOUD_CONTEXT_TOKENS,
      'mimo-v2.5': DEFAULT_CLOUD_CONTEXT_TOKENS,
    },
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    hint: 'Opus 4.7 / Sonnet 4.6 / Haiku 4.5；长推理 + 代码',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4.6',
    modelExamples: ['claude-opus-4.7', 'claude-opus-4.6', 'claude-sonnet-4.6', 'claude-haiku-4.5'],
    apiKeyPage: 'https://console.anthropic.com/settings/keys',
    defaultContextWindowTokens: 200_000,
    modelContextTokens: {
      'claude-opus-4.7': 1_000_000,
      'claude-opus-4.6': 1_000_000,
      'claude-sonnet-4.6': 200_000,
      'claude-haiku-4.5': 200_000,
    },
  },
  {
    id: 'google',
    label: 'Google Gemini',
    hint: 'Gemini 3.1 Pro / Flash / Flash-Lite；多模态 + 长上下文',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-3.1-pro',
    modelExamples: ['gemini-3.1-pro', 'gemini-3.1-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview-customtools'],
    apiKeyPage: 'https://aistudio.google.com/apikey',
    defaultContextWindowTokens: 1_000_000,
    modelContextTokens: {
      'gemini-3.1-pro': 1_000_000,
      'gemini-3.1-flash': 1_000_000,
      'gemini-3.1-flash-lite': 1_000_000,
      'gemini-3.1-pro-preview-customtools': 1_000_000,
    },
  },
  {
    id: 'ollama',
    label: 'Ollama (本地)',
    hint: '本地模型；注册时优先自动读取本机 ollama list，下面只是未探测到时的备选',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'qwen3.5:4b',
    modelExamples: ['qwen3.5:4b', 'qwen3-coder:7b', 'qwen2.5-coder:7b', 'deepseek-r1:7b', 'deepseek-coder:6.7b', 'llama3.2:3b', 'gemma3:4b'],
    defaultContextWindowTokens: DEFAULT_OLLAMA_CONTEXT_TOKENS,
    modelContextTokens: {
      'qwen3.5:4b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
      'qwen3-coder:7b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
      'qwen2.5-coder:7b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
      'deepseek-r1:7b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
      'deepseek-coder:6.7b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
      'llama3.2:3b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
      'gemma3:4b': DEFAULT_OLLAMA_CONTEXT_TOKENS,
    },
  },
  {
    id: 'custom',
    label: '自定义',
    hint: '任意 OpenAI 兼容 endpoint',
    baseUrl: 'https://your-endpoint.com/v1/chat/completions',
    defaultModel: '',
    modelExamples: [],
    defaultContextWindowTokens: DEFAULT_CLOUD_CONTEXT_TOKENS,
  },
];

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'deepseek',
  baseUrl: PRESETS[0].baseUrl,
  apiKey: '',
  model: PRESETS[0].defaultModel,
  contextWindowTokens: 1_000_000,
  qualityModelId: 'deepseek-v4-pro',
  modelRegistry: [
    {
      id: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash（默认）',
      provider: 'deepseek',
      baseUrl: PRESETS[0].baseUrl,
      apiKey: '',
      model: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
    },
    {
      id: 'deepseek-v4-pro',
      label: 'DeepSeek V4 Pro（高质量）',
      provider: 'deepseek',
      baseUrl: PRESETS[0].baseUrl,
      apiKey: '',
      model: 'deepseek-v4-pro',
      contextWindowTokens: 1_000_000,
    },
  ],
  maxTokens: 8000,
  ollamaMode: 'enabled',
  temperature: 0.3,
  timeoutMs: 180_000,
  maxRetries: 2,
  // FastLane 默认值（用户在 Settings 勾选 enabled 即可启用）
  // model 用项目统一本地模型 qwen3.5:4b（≈4GB 显存，TTFT < 500ms）
  // 用户也可换同系列更大上下文/更高质量模型
  fastLane: {
    enabled: false,
    baseUrl: 'http://localhost:11434',
    model: 'qwen3.5:4b',
  },
  // Coach 意图路由（兜底用的小模型）。默认关闭，开启后用本地 ollama 上的小模型判断意图。
  // 复用 fastLane 同款 qwen3.5:4b 避免用户多 pull 一个模型
  intentRouter: {
    enabled: false,
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    model: 'qwen3.5:4b',
  },
  algoVizModels: {
    status: {
      enabled: true,
      modelId: 'deepseek-v4-pro',
      provider: 'deepseek',
      baseUrl: PRESETS[0].baseUrl,
      apiKey: '',
      model: 'deepseek-v4-pro',
    },
    animation: {
      enabled: true,
      modelId: 'deepseek-v4-pro',
      provider: 'deepseek',
      baseUrl: PRESETS[0].baseUrl,
      apiKey: '',
      model: 'deepseek-v4-pro',
    },
  },
};

/**
 * Ollama library 上公共可 pull 的推荐模型（FastLane / intentRouter 用）。
 * 全部为 ollama 官方仓库已发布的纯文本对话模型；用户在 SettingsModal 里能直接复制 pull 命令。
 */
export const RECOMMENDED_OLLAMA_MODELS: Array<{
  name: string;
  size: string;
  vramHint: string;
  desc: string;
}> = [
  { name: 'qwen3.5:4b', size: '~2.6 GB', vramHint: '4 GB+', desc: '默认推荐：速度/质量平衡，TTFT < 500ms' },
  { name: 'qwen3-coder:7b', size: '~4.5 GB', vramHint: '6 GB+', desc: '代码任务优先；适合解释/批注/小型改错' },
  { name: 'qwen2.5-coder:7b', size: '~4.7 GB', vramHint: '6 GB+', desc: '成熟稳定的本地代码模型；Ollama library 常用' },
  { name: 'deepseek-r1:7b', size: '~4.7 GB', vramHint: '6 GB+', desc: '本地推理模型；适合复杂逻辑但延迟更高' },
  { name: 'qwen3:8b', size: '~5.2 GB', vramHint: '6 GB+', desc: '更强推理；适合复杂题分析' },
  { name: 'qwen2.5:7b', size: '~4.7 GB', vramHint: '6 GB+', desc: '稳定老牌，对中文友好' },
  { name: 'deepseek-coder:6.7b', size: '~3.8 GB', vramHint: '5 GB+', desc: '代码任务专长；批注更精准' },
  { name: 'qwen3:1.7b', size: '~1.1 GB', vramHint: '2 GB+', desc: '极低显存可用；质量略弱' },
  { name: 'llama3.2:3b', size: '~2.0 GB', vramHint: '3 GB+', desc: '轻量通用模型；英文任务稳定' },
  { name: 'gemma3:4b', size: '~3.0 GB', vramHint: '4 GB+', desc: '轻量通用备选；适合低显存机器' },
];

/**
 * 视觉模型（importProcessor 给 OJ 题面图片识别用）。仅在启用 OJ 桥接 + 配置后端时需要。
 */
export const RECOMMENDED_VISION_MODELS: Array<{
  name: string;
  size: string;
  desc: string;
}> = [
  { name: 'qwen3.5:4b', size: '~2.6 GB', desc: '项目统一本地模型：实时批注 + OJ 题图识别' },
];
