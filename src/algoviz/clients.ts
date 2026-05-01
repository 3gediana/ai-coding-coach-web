/**
 * algoViz 三个工位的 AIClient 工厂。
 *
 * 工位说明：
 *   - status     ：DeepSeek 第 1 次调用，生成 Status.tsx + detectionSchema（重活，~20s）
 *   - animation  ：DeepSeek 第 2 次调用，生成 Animation.tsx（重活，~60-100s）
 *   - detect     ：实时检测，每 15s 一次（轻活，要求极短输出）
 *
 * 选取顺序：
 *   1. algoVizModels[role].enabled 且字段齐 → 用 override
 *   2. role === 'detect'：fastLane 启用 → 用 fastLane（本地）
 *   3. role === 'status' / 'animation'：fall back qualityModel（pro / 高质量模型）
 *   4. qualityModel 也不可用 → 返回 null（上层兜底报错）
 *
 * 不引入 store，纯函数；caller 注入 cfg 即可。
 */
import { AIClient } from '../core/ai/client';
import type { AIConfig, AIProvider, AlgoVizAgentOverride } from '../core/types';
import {
  resolvePrimaryModel,
  resolveQualityModel,
  resolveFastLaneModel,
  resolveAlgoVizOverride,
} from '../lib/modelRegistry';

export type AlgoVizRole = 'status' | 'animation' | 'detect';

/** baseUrl 是否本地 ollama；与 store.ts 同名 helper 同义，独立一份避免循环依赖 */
function isLocalOllamaUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const h = u.hostname;
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '::1' ||
      h.startsWith('192.168.') ||
      h.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    );
  } catch {
    return false;
  }
}

function overrideUsable(
  ov: AlgoVizAgentOverride | undefined,
  cfg?: AIConfig,
): boolean {
  if (!ov?.enabled) return false;
  const resolved = resolveAlgoVizOverride(cfg!, ov);
  if (!resolved) return false;
  // 本地 ollama 不需要 apiKey；云端必须有
  if (isLocalOllamaUrl(resolved.baseUrl)) {
    // 本地 override 也受 ollamaMode 总开关控制：disabled 时一律不接受
    if (cfg?.ollamaMode === 'disabled') return false;
    return true;
  }
  return !!resolved.apiKey?.trim();
}

function buildOverrideClient(ov: AlgoVizAgentOverride, role: AlgoVizRole, cfg: AIConfig): AIClient {
  const resolved = resolveAlgoVizOverride(cfg, ov)!;
  const provider: AIProvider =
    resolved.provider ?? (isLocalOllamaUrl(resolved.baseUrl) ? 'ollama' : 'custom');
  // 重活给充裕 token + 长 timeout；轻活极短 + 短 timeout
  const isHeavy = role === 'status' || role === 'animation';
  return new AIClient({
    provider,
    baseUrl: resolved.baseUrl.trim(),
    apiKey: resolved.apiKey.trim(),
    model: resolved.model.trim(),
    maxTokens: isHeavy ? 8000 : 32,
    temperature: isHeavy ? 0.3 : 0,
    timeoutMs: isHeavy ? 180_000 : 8_000,
    maxRetries: isHeavy ? 1 : 0,
  });
}

function buildFastLaneClient(cfg: AIConfig, role: AlgoVizRole): AIClient | null {
  // ollamaMode='disabled' 直接拒绝（用户明确说"我没装 Ollama"）
  if (cfg.ollamaMode === 'disabled') return null;
  const resolved = resolveFastLaneModel(cfg);
  if (!resolved) return null;
  if (!isLocalOllamaUrl(resolved.baseUrl)) return null;
  const isHeavy = role === 'status' || role === 'animation';
  return new AIClient({
    provider: 'ollama',
    baseUrl: resolved.baseUrl.trim(),
    apiKey: '',
    model: resolved.model.trim(),
    maxTokens: isHeavy ? 4096 : 32,
    temperature: isHeavy ? 0.3 : 0,
    timeoutMs: isHeavy ? 120_000 : 8_000,
    maxRetries: 0,
    numCtx: resolved.numCtx,
  });
}

function buildMainClient(cfg: AIConfig, role: AlgoVizRole): AIClient | null {
  const primary =
    role === 'status' || role === 'animation'
      ? resolveQualityModel(cfg)
      : resolvePrimaryModel(cfg);
  const usable = primary.provider === 'ollama' ? !!primary.baseUrl.trim() : !!primary.apiKey.trim();
  if (!usable) return null;
  const isHeavy = role === 'status' || role === 'animation';
  return new AIClient({
    provider: primary.provider,
    baseUrl: primary.baseUrl,
    apiKey: primary.apiKey,
    model: primary.model,
    numCtx: primary.numCtx,
    maxTokens: isHeavy ? Math.max(cfg.maxTokens, 8000) : 32,
    temperature: isHeavy ? 0.3 : 0,
    timeoutMs: isHeavy ? 180_000 : 8_000,
    maxRetries: isHeavy ? 1 : 0,
  });
}

/**
 * 选取最合适的 client。
 * @returns null 表示当前配置下该工位不可用（上层应优雅 fallback / 报错）
 */
export function pickAlgoVizClient(cfg: AIConfig, role: AlgoVizRole): AIClient | null {
  // 1. override 优先（本地 override 也受 ollamaMode 总开关约束）
  const ov = cfg.algoVizModels?.[role];
  if (overrideUsable(ov, cfg)) {
    return buildOverrideClient(ov!, role, cfg);
  }
  // 2. detect 走 fastLane（本地）
  if (role === 'detect') {
    const fast = buildFastLaneClient(cfg, role);
    if (fast) return fast;
    // detect 没 fastLane 就拒绝跑（避免高频烧云端 token）
    return null;
  }
  // 3. status / animation 走主 cfg
  return buildMainClient(cfg, role);
}

/**
 * 调试用：返回当前 role 的"实际路由路径"标签——方便 UI 显示给用户看。
 */
export function describeRoute(cfg: AIConfig, role: AlgoVizRole): string {
  const ov = cfg.algoVizModels?.[role];
  if (overrideUsable(ov, cfg)) {
    const resolved = resolveAlgoVizOverride(cfg, ov!);
    return `override · ${resolved?.model ?? '未配'}`;
  }
  if (role === 'detect') {
    if (cfg.ollamaMode === 'disabled') return '已关闭（无 Ollama 模式）';
    const fl = resolveFastLaneModel(cfg);
    if (fl) return `fastLane · ${fl.model}`;
    return '不可用（需 fastLane 或 override）';
  }
  const primary =
    role === 'status' || role === 'animation'
      ? resolveQualityModel(cfg)
      : resolvePrimaryModel(cfg);
  return `${role === 'status' || role === 'animation' ? '高质量模型' : '主云端'} · ${primary.model || '未配'}`;
}
