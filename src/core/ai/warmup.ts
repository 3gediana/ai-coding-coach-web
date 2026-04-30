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

interface WarmTarget {
  baseUrl: string;
  model: string;
  label: string;
}

function collectTargets(cfg: AIConfig): WarmTarget[] {
  const out: WarmTarget[] = [];
  const seen = new Set<string>();

  const tryAdd = (baseUrl?: string, model?: string, label = '') => {
    const b = baseUrl?.trim();
    const m = model?.trim();
    if (!b || !m) return;
    if (!isLocalOllamaUrl(b)) return;
    const key = `${b}|${m}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ baseUrl: b, model: m, label });
  };

  // fastLane：多个工位的"本地默认"
  if (cfg.fastLane?.enabled) {
    tryAdd(cfg.fastLane.baseUrl, cfg.fastLane.model, 'fastLane');
  }
  // intentRouter：本地路由意图分类
  if (cfg.intentRouter?.enabled) {
    tryAdd(cfg.intentRouter.baseUrl, cfg.intentRouter.model, 'intentRouter');
  }
  // algoViz 三个工位（如果用户配的是本地）
  const av = cfg.algoVizModels;
  if (av) {
    if (av.status?.enabled) tryAdd(av.status.baseUrl, av.status.model, 'algoViz.status');
    if (av.animation?.enabled) tryAdd(av.animation.baseUrl, av.animation.model, 'algoViz.animation');
    if (av.detect?.enabled) tryAdd(av.detect.baseUrl, av.detect.model, 'algoViz.detect');
  }

  return out;
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
  const targets = collectTargets(cfg);
  if (targets.length === 0) return [];

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
