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

/**
 * 模型预设（更新于 2026.04）：
 *   - DeepSeek V4 / R1（默认，价格屠夫）
 *   - MiniMax M2.7（2026.04 开源，OpenRouter 调用量第一）
 *   - OpenAI GPT-5.2 / GPT-5
 *   - 通义 Qwen 3.6 Plus
 *   - 智谱 GLM-5.1
 *   - Kimi K2.6
 *   - Anthropic Claude 4.6 Sonnet
 *   - Google Gemini 3.1 Pro
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
  },
  {
    id: 'minimax',
    label: 'MiniMax (海螺)',
    hint: 'M2.7 自我进化推理模型，长上下文 + 强 Agent，OpenRouter 调用量 #1',
    baseUrl: 'https://api.minimaxi.com/v1/text/chatcompletion_v2',
    defaultModel: 'MiniMax-M2.7',
    modelExamples: ['MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2'],
    apiKeyPage: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'GPT-5.2 / GPT-5 旗舰；需要外网访问',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-5.2',
    modelExamples: ['gpt-5.2', 'gpt-5', 'gpt-5-mini', 'gpt-5-ultra'],
    apiKeyPage: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'qwen',
    label: '通义千问 (DashScope)',
    hint: 'Qwen 3.6 Plus；阿里云；coder 系列代码强',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-3.6-plus',
    modelExamples: ['qwen-3.6-plus', 'qwen-3.6-max', 'qwen3-coder-32b-instruct'],
    apiKeyPage: 'https://dashscope.console.aliyun.com/apiKey',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    hint: 'GLM-5.1 旗舰；学习曲线友好',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-5.1',
    modelExamples: ['glm-5.1', 'glm-5', 'glm-5-flash', 'glm-5-air'],
    apiKeyPage: 'https://bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'moonshot',
    label: 'Kimi (Moonshot)',
    hint: 'K2.6 长上下文 + 强工具调用',
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'kimi-k2.6',
    modelExamples: ['kimi-k2.6', 'kimi-k2.5', 'moonshot-v1-128k'],
    apiKeyPage: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    hint: 'Claude 4.6 Sonnet；长推理 + 代码',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-4.6-sonnet',
    modelExamples: ['claude-4.6-sonnet', 'claude-4.6-opus', 'claude-4-haiku'],
    apiKeyPage: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    hint: 'Gemini 3.1 Pro / 3 Deep Think；多模态 + 无限上下文',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-3.1-pro',
    modelExamples: ['gemini-3.1-pro', 'gemini-3-deep-think', 'gemini-3-flash'],
    apiKeyPage: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'ollama',
    label: 'Ollama (本地)',
    hint: '本地模型；零成本但靠机器性能',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'qwen3-coder:7b',
    modelExamples: ['qwen3-coder:7b', 'deepseek-v4-coder:6.7b', 'llama4:8b'],
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
  provider: 'deepseek',
  baseUrl: PRESETS[0].baseUrl,
  apiKey: '',
  model: PRESETS[0].defaultModel,
  qualityModelId: 'deepseek-v4-pro',
  modelRegistry: [
    {
      id: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash（默认）',
      provider: 'deepseek',
      baseUrl: PRESETS[0].baseUrl,
      apiKey: '',
      model: 'deepseek-v4-flash',
    },
    {
      id: 'deepseek-v4-pro',
      label: 'DeepSeek V4 Pro（高质量）',
      provider: 'deepseek',
      baseUrl: PRESETS[0].baseUrl,
      apiKey: '',
      model: 'deepseek-v4-pro',
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
  { name: 'qwen3:8b', size: '~5.2 GB', vramHint: '6 GB+', desc: '更强推理；适合复杂题分析' },
  { name: 'qwen2.5:7b', size: '~4.7 GB', vramHint: '6 GB+', desc: '稳定老牌，对中文友好' },
  { name: 'deepseek-coder:6.7b', size: '~3.8 GB', vramHint: '5 GB+', desc: '代码任务专长；批注更精准' },
  { name: 'qwen3:1.7b', size: '~1.1 GB', vramHint: '2 GB+', desc: '极低显存可用；质量略弱' },
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
