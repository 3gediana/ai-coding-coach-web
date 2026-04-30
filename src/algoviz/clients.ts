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
 *   3. role === 'status' / 'animation'：fall back 主 cfg（云端）
 *   4. 主 cfg 也不可用 → 返回 null（上层兜底报错）
 *
 * 不引入 store，纯函数；caller 注入 cfg 即可。
 */
import { AIClient } from '../core/ai/client';
import type { AIConfig, AIProvider, AlgoVizAgentOverride } from '../core/types';

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

function overrideUsable(ov: AlgoVizAgentOverride | undefined): ov is AlgoVizAgentOverride {
  if (!ov?.enabled) return false;
  if (!ov.baseUrl?.trim() || !ov.model?.trim()) return false;
  // 本地 ollama 不需要 apiKey；云端必须有
  if (isLocalOllamaUrl(ov.baseUrl)) return true;
  return !!ov.apiKey?.trim();
}

function buildOverrideClient(ov: AlgoVizAgentOverride, role: AlgoVizRole): AIClient {
  const provider: AIProvider =
    ov.provider ?? (isLocalOllamaUrl(ov.baseUrl) ? 'ollama' : 'custom');
  // 重活给充裕 token + 长 timeout；轻活极短 + 短 timeout
  const isHeavy = role === 'status' || role === 'animation';
  return new AIClient({
    provider,
    baseUrl: ov.baseUrl.trim(),
    apiKey: ov.apiKey.trim(),
    model: ov.model.trim(),
    maxTokens: isHeavy ? 8000 : 32,
    temperature: isHeavy ? 0.3 : 0,
    timeoutMs: isHeavy ? 180_000 : 8_000,
    maxRetries: isHeavy ? 1 : 0,
  });
}

function buildFastLaneClient(cfg: AIConfig, role: AlgoVizRole): AIClient | null {
  const fl = cfg.fastLane;
  if (!fl?.enabled || !fl.baseUrl?.trim() || !fl.model?.trim()) return null;
  if (!isLocalOllamaUrl(fl.baseUrl)) return null;
  const isHeavy = role === 'status' || role === 'animation';
  return new AIClient({
    provider: 'ollama',
    baseUrl: fl.baseUrl.trim(),
    apiKey: '',
    model: fl.model.trim(),
    maxTokens: isHeavy ? 4096 : 32,
    temperature: isHeavy ? 0.3 : 0,
    timeoutMs: isHeavy ? 120_000 : 8_000,
    maxRetries: 0,
    numCtx: fl.numCtx,
  });
}

function buildMainClient(cfg: AIConfig, role: AlgoVizRole): AIClient | null {
  const usable = cfg.provider === 'ollama' ? !!cfg.baseUrl.trim() : !!cfg.apiKey.trim();
  if (!usable) return null;
  const isHeavy = role === 'status' || role === 'animation';
  return new AIClient({
    ...cfg,
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
  // 1. override 优先
  const ov = cfg.algoVizModels?.[role];
  if (overrideUsable(ov)) {
    return buildOverrideClient(ov, role);
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
  if (overrideUsable(ov)) {
    return `override · ${ov.model}`;
  }
  if (role === 'detect') {
    const fl = cfg.fastLane;
    if (fl?.enabled && fl.baseUrl && fl.model) return `fastLane · ${fl.model}`;
    return '不可用（需 fastLane 或 override）';
  }
  return `主云端 · ${cfg.model || '未配'}`;
}
