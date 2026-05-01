/**
 * 模型注册表工具函数。
 *
 * 核心职责：从 AIConfig.modelRegistry 中按 id 查找 ModelEntry，
 * 为各 agent slot 提供统一的"引用解析"。
 *
 * 设计原则：
 *   - 纯函数，不引入 store（避免循环依赖）
 *   - 找不到时返回 null → 调用方自行 fallback 旧字段
 */
import type { AIConfig, AIProvider, AlgoVizAgentOverride, ModelEntry } from '../core/types';

/** 从注册表中按 id 查找 */
export function lookupModel(registry: ModelEntry[] | undefined, id: string | undefined): ModelEntry | null {
  if (!registry || !id) return null;
  return registry.find((m) => m.id === id) ?? null;
}

function inheritedApiKey(cfg: AIConfig, entry: ModelEntry): string {
  if (entry.apiKey?.trim()) return entry.apiKey;
  if (entry.provider === cfg.provider && entry.baseUrl === cfg.baseUrl) return cfg.apiKey;
  return '';
}

/**
 * 解析主模型：若 primaryModelId 有效，返回 registry 条目信息覆盖顶层字段；
 * 否则 fallback 到 AIConfig 自身的 provider/baseUrl/apiKey/model。
 */
export function resolvePrimaryModel(cfg: AIConfig): {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  numCtx?: number;
} {
  const entry = lookupModel(cfg.modelRegistry, cfg.primaryModelId);
  if (entry) {
    return {
      provider: entry.provider,
      baseUrl: entry.baseUrl,
      apiKey: inheritedApiKey(cfg, entry),
      model: entry.model,
      numCtx: entry.numCtx,
    };
  }
  return {
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    numCtx: cfg.numCtx,
  };
}

export function resolveQualityModel(cfg: AIConfig): {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  numCtx?: number;
} {
  const entry = lookupModel(cfg.modelRegistry, cfg.qualityModelId);
  if (entry) {
    return {
      provider: entry.provider,
      baseUrl: entry.baseUrl,
      apiKey: inheritedApiKey(cfg, entry),
      model: entry.model,
      numCtx: entry.numCtx,
    };
  }
  return resolvePrimaryModel(cfg);
}

/**
 * 解析 fastLane 模型：优先 fastLane.modelId，fallback 到 fastLane 自身字段。
 * 返回 null 表示 fastLane 不可用（未启用、字段不全等）。
 */
export function resolveFastLaneModel(cfg: AIConfig): {
  baseUrl: string;
  model: string;
  numCtx?: number;
} | null {
  const fl = cfg.fastLane;
  if (!fl?.enabled) return null;
  const entry = lookupModel(cfg.modelRegistry, fl.modelId);
  if (entry) {
    return { baseUrl: entry.baseUrl, model: entry.model, numCtx: entry.numCtx };
  }
  if (!fl.baseUrl?.trim() || !fl.model?.trim()) return null;
  return { baseUrl: fl.baseUrl, model: fl.model, numCtx: fl.numCtx };
}

/**
 * 解析意图路由模型：优先 intentRouter.modelId，fallback 到 intentRouter 自身字段。
 */
export function resolveIntentRouterModel(cfg: AIConfig): {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
} | null {
  const ir = cfg.intentRouter;
  if (!ir?.enabled) return null;
  const entry = lookupModel(cfg.modelRegistry, ir.modelId);
  if (entry) {
    return {
      provider: entry.provider,
      baseUrl: entry.baseUrl,
      apiKey: entry.apiKey,
      model: entry.model,
    };
  }
  if (!ir.baseUrl?.trim() || !ir.model?.trim()) return null;
  return {
    provider: ir.provider ?? cfg.provider,
    baseUrl: ir.baseUrl,
    apiKey: ir.apiKey ?? '',
    model: ir.model,
  };
}

/**
 * 旧存档迁移：把现有的 fastLane / intentRouter / algoVizModels.* / 顶层 provider+baseUrl
 * 自动注册为 ModelEntry，并把对应 slot 的 modelId 设上。
 *
 * 设计原则：
 *   - 幂等：已经有 modelRegistry 时不重复注册
 *   - 不破坏：保留旧字段，新增 modelId 引用，runtime 优先用 modelId
 *   - 去重：相同 baseUrl + model + apiKey 复用同一条 entry
 */
export function migrateConfigToRegistry(cfg: AIConfig): AIConfig {
  // 已有 registry → 视为已迁移，不再重复
  if (cfg.modelRegistry && cfg.modelRegistry.length > 0) return cfg;

  const registry: ModelEntry[] = [];
  let nextId = 1;

  /** 找现有条目，找到返回 id；找不到则注册新条目 */
  function ensure(label: string, e: Omit<ModelEntry, 'id' | 'label'>): string {
    const dup = registry.find(
      (m) =>
        m.baseUrl === e.baseUrl &&
        m.model === e.model &&
        m.apiKey === e.apiKey &&
        m.provider === e.provider,
    );
    if (dup) return dup.id;
    const id = `m${nextId++}`;
    registry.push({ id, label, ...e });
    return id;
  }

  const out: AIConfig = { ...cfg };

  // 1. 主模型
  if (cfg.baseUrl?.trim() && cfg.model?.trim()) {
    out.primaryModelId = ensure(`${cfg.provider} 主力`, {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      numCtx: cfg.numCtx,
    });
  }

  // 2. fastLane
  const fl = cfg.fastLane;
  if (fl?.baseUrl?.trim() && fl.model?.trim()) {
    const id = ensure('本地 FastLane', {
      provider: 'ollama',
      baseUrl: fl.baseUrl,
      apiKey: '',
      model: fl.model,
      numCtx: fl.numCtx,
    });
    out.fastLane = { ...fl, modelId: id };
  }

  // 3. intentRouter
  const ir = cfg.intentRouter;
  if (ir?.baseUrl?.trim() && ir.model?.trim()) {
    const id = ensure('Coach 意图路由', {
      provider: ir.provider ?? cfg.provider,
      baseUrl: ir.baseUrl,
      apiKey: ir.apiKey ?? '',
      model: ir.model,
    });
    out.intentRouter = { ...ir, modelId: id };
  }

  // 4. algoVizModels 三个工位
  const av = cfg.algoVizModels;
  if (av) {
    const newAv: NonNullable<AIConfig['algoVizModels']> = { ...av };
    for (const role of ['status', 'animation', 'detect'] as const) {
      const ov = av[role];
      if (ov?.baseUrl?.trim() && ov.model?.trim()) {
        const id = ensure(`AlgoViz · ${role}`, {
          provider: ov.provider ?? 'custom',
          baseUrl: ov.baseUrl,
          apiKey: ov.apiKey,
          model: ov.model,
        });
        newAv[role] = { ...ov, modelId: id };
      }
    }
    out.algoVizModels = newAv;
  }

  out.modelRegistry = registry;
  return out;
}

/**
 * 解析 algoViz 工位模型：优先 override.modelId，fallback 到 override 自身字段。
 */
export function resolveAlgoVizOverride(
  cfg: AIConfig,
  override: AlgoVizAgentOverride | undefined,
): { provider: AIProvider; baseUrl: string; apiKey: string; model: string } | null {
  if (!override?.enabled) return null;
  const entry = lookupModel(cfg.modelRegistry, override.modelId);
  if (entry) {
    return {
      provider: entry.provider,
      baseUrl: entry.baseUrl,
      apiKey: inheritedApiKey(cfg, entry),
      model: entry.model,
    };
  }
  if (!override.baseUrl?.trim() || !override.model?.trim()) return null;
  const primary = resolvePrimaryModel(cfg);
  return {
    provider: override.provider ?? 'custom',
    baseUrl: override.baseUrl,
    apiKey:
      override.apiKey ||
      (override.provider === primary.provider && override.baseUrl === primary.baseUrl
        ? primary.apiKey
        : ''),
    model: override.model,
  };
}
