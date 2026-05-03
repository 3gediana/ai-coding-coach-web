/**
 * 本地 ollama 模型预热（Warmup）
 * ─────────────────────────────────────────────────────────────
 * 问题：ollama 模型首次调用时要把 GGUF 从磁盘加载到内存（4B 模型 ~3-5s 冷启），
 *       用户首次写代码触发 detect 时会等很久，体感断裂。
 *
 * 方案：app 启动 / 配置变更后立即对所有"会用到的本地 ollama 工位"发一个最小请求
 *       （maxTokens=1, prompt='hi'），把模型预加载进 ollama 的 GPU/RAM。
 *
 * 收集对象（按"会真正用到"原则）：
 *   - cfg.fastLane                       （多个工位都用：plainExpl / overview / detect 兜底等）
 *   - cfg.intentRouter                   （意图路由）
 *   - cfg.algoVizModels.{status,animation,detect}  （仅当本地 baseUrl）
 *
 * 同 baseUrl + model 去重，并行预热。失败静默（不该阻塞用户）。
 */
import { AIClient } from './client';
import type { AIConfig } from '../types';
import {
  resolveAlgoVizOverride,
  resolveFastLaneModel,
  resolveIntentRouterModel,
  resolvePrimaryModel,
  resolveQualityModel,
} from '../../lib/modelRegistry';

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

function localOllamaTargetKey(baseUrl: string, model: string): string {
  try {
    const u = new URL(baseUrl.trim());
    let host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1') host = '127.0.0.1';
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return `${u.protocol}//${host}:${port}|${model.trim()}`;
  } catch {
    return `${baseUrl.trim()}|${model.trim()}`;
  }
}

export interface WarmTarget {
  baseUrl: string;
  model: string;
  label: string;
}

export function collectLocalOllamaTargets(cfg: AIConfig): WarmTarget[] {
  const out: WarmTarget[] = [];
  const seen = new Set<string>();

  const tryAdd = (baseUrl?: string, model?: string, label = '') => {
    const b = baseUrl?.trim();
    const m = model?.trim();
    if (!b || !m) return;
    if (!isLocalOllamaUrl(b)) return;
    const key = localOllamaTargetKey(b, m);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ baseUrl: b, model: m, label });
  };

  const primary = resolvePrimaryModel(cfg);
  if (primary.provider === 'ollama') {
    tryAdd(primary.baseUrl, primary.model, 'primary');
  }

  const quality = resolveQualityModel(cfg);
  if (quality.provider === 'ollama') {
    tryAdd(quality.baseUrl, quality.model, 'quality');
  }

  const fastLane = resolveFastLaneModel(cfg);
  if (fastLane) {
    tryAdd(fastLane.baseUrl, fastLane.model, 'fastLane');
  }

  const intentRouter = resolveIntentRouterModel(cfg);
  if (intentRouter?.provider === 'ollama') {
    tryAdd(intentRouter.baseUrl, intentRouter.model, 'intentRouter');
  }

  const av = cfg.algoVizModels;
  if (av) {
    const status = resolveAlgoVizOverride(cfg, av.status);
    const animation = resolveAlgoVizOverride(cfg, av.animation);
    const detect = resolveAlgoVizOverride(cfg, av.detect);
    if (status?.provider === 'ollama') tryAdd(status.baseUrl, status.model, 'algoViz.status');
    if (animation?.provider === 'ollama') tryAdd(animation.baseUrl, animation.model, 'algoViz.animation');
    if (detect?.provider === 'ollama') tryAdd(detect.baseUrl, detect.model, 'algoViz.detect');
  }

  return out;
}

export function getLocalOllamaTargetConflict(cfg: AIConfig): WarmTarget[] {
  const targets = collectLocalOllamaTargets(cfg);
  return targets.length > 1 ? targets : [];
}

export interface WarmupResult {
  label: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * 预热所有本地 ollama 工位。并行 + 单工位 30s timeout + 失败静默。
 * 返回每个目标的成功/失败 + 延迟，方便 UI 上报。
 */
export async function warmupLocalModels(cfg: AIConfig): Promise<WarmupResult[]> {
  // ollamaMode='disabled' 完全跳过预热（避免 console 噪音 + 防止误唤起 ollama 进程）
  if (cfg.ollamaMode === 'disabled') return [];
  const targets = collectLocalOllamaTargets(cfg);
  if (targets.length === 0) return [];
  if (targets.length > 1) {
    return targets.map((t) => ({
      label: t.label,
      model: t.model,
      ok: false,
      latencyMs: 0,
      error: '本地 Ollama 只能配置一个模型；请让所有本地工位使用同一个模型。',
    }));
  }
  if (typeof window !== 'undefined' && (import.meta as any).env?.DEV) {
    try {
      const res = await fetch('/__aicc-ollama-warmup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targets }),
        signal: AbortSignal.timeout(35_000),
      });
      if (res.ok) {
        const data = await res.json() as { results?: WarmupResult[] };
        return Array.isArray(data.results) ? data.results : [];
      }
      const text = await res.text().catch(() => '');
      return targets.map((t) => ({
        label: t.label,
        model: t.model,
        ok: false,
        latencyMs: 0,
        error: `warmup HTTP ${res.status}: ${text.slice(0, 120)}`,
      }));
    } catch (e: any) {
      return targets.map((t) => ({
        label: t.label,
        model: t.model,
        ok: false,
        latencyMs: 0,
        error: e?.message?.slice(0, 160) ?? String(e).slice(0, 160),
      }));
    }
  }

  const results: WarmupResult[] = await Promise.all(
    targets.map(async (t) => {
      const t0 = performance.now();
      try {
        const client = new AIClient({
          provider: 'ollama',
          baseUrl: t.baseUrl,
          apiKey: '',
          model: t.model,
          maxTokens: 1,
          temperature: 0,
          timeoutMs: 30_000,
          maxRetries: 0,
        });
        await client.chat({
          messages: [{ role: 'user', content: 'hi' }],
          maxTokens: 1,
          temperature: 0,
          timeoutMs: 30_000,
          keepAlive: '10m',
        });
        const dt = Math.round(performance.now() - t0);
        return { label: t.label, model: t.model, ok: true, latencyMs: dt };
      } catch (e: any) {
        const dt = Math.round(performance.now() - t0);
        return {
          label: t.label,
          model: t.model,
          ok: false,
          latencyMs: dt,
          error: e?.message?.slice(0, 200) ?? String(e).slice(0, 200),
        };
      }
    }),
  );

  if (typeof console !== 'undefined' && console.debug) {
    for (const r of results) {
      console.debug(
        `[warmup] ${r.label}/${r.model} ${r.ok ? '✓' : '✗'} ${r.latencyMs}ms${r.error ? ' — ' + r.error : ''}`,
      );
    }
  }
  return results;
}

function ollamaChatUrl(baseUrl: string): string {
  let u = baseUrl.trim();
  u = u.replace(/\/v1\/chat\/completions\/?$/, '/api/chat');
  if (!/\/api\/chat\/?$/.test(u)) {
    u = u.replace(/\/+$/, '') + '/api/chat';
  }
  return u;
}

function buildUnloadUrl(baseUrl: string): string {
  const url = ollamaChatUrl(baseUrl);
  const shouldProxy =
    typeof window !== 'undefined' &&
    ((import.meta as any).env?.DEV || isLocalOllamaUrl(url));
  return shouldProxy ? `/ai-proxy/${encodeURIComponent(url)}` : url;
}

export async function unloadLocalModels(targets: WarmTarget[]): Promise<void> {
  const unique = collectUniqueTargets(targets);
  if (unique.length === 0) return;
  const isDev = typeof window !== 'undefined' && (import.meta as any).env?.DEV;
  if (isDev) {
    await fetch('/__aicc-ollama-unload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targets: unique }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => undefined);
    return;
  }
  await Promise.all(
    unique.map((t) =>
      fetch(buildUnloadUrl(t.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: t.model, messages: [], keep_alive: 0 }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => undefined),
    ),
  );
}

export function requestUnloadLocalModels(targets: WarmTarget[]): void {
  const unique = collectUniqueTargets(targets);
  if (unique.length === 0 || typeof window === 'undefined') return;
  const isDev = (import.meta as any).env?.DEV;
  if (isDev && navigator.sendBeacon) {
    const blob = new Blob([JSON.stringify({ targets: unique })], { type: 'application/json' });
    navigator.sendBeacon('/__aicc-ollama-unload', blob);
    return;
  }
  for (const t of unique) {
    fetch(buildUnloadUrl(t.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: t.model, messages: [], keep_alive: 0 }),
      keepalive: true,
    }).catch(() => undefined);
  }
}

function collectUniqueTargets(targets: WarmTarget[]): WarmTarget[] {
  const seen = new Set<string>();
  const out: WarmTarget[] = [];
  for (const t of targets) {
    const baseUrl = t.baseUrl.trim();
    const model = t.model.trim();
    if (!baseUrl || !model || !isLocalOllamaUrl(baseUrl)) continue;
    const key = localOllamaTargetKey(baseUrl, model);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...t, baseUrl, model });
  }
  return out;
}
