/**
 * Ollama 本地模型列表抓取。
 *
 * 设计：
 * - 复用 vite 的 /ai-proxy/<encoded-url> 中间件绕 CORS（dev）
 * - prod 直接打 ollama（同源/CORS 由用户自己处理）
 * - 5s 超时，避免 ollama 没启动时卡住 UI
 *
 * Ollama API: GET /api/tags 返回 { models: OllamaModel[] }
 *   响应字段参考 https://github.com/ollama/ollama/blob/main/docs/api.md#list-local-models
 */

export interface OllamaModel {
  /** 形如 'qwen2.5-coder:7b' */
  name: string;
  /** 字节数 */
  size: number;
  /** ISO 时间 */
  modified_at: string;
  /** sha256 摘要前几位 */
  digest?: string;
  details?: {
    parameter_size?: string;   // '7B'
    quantization_level?: string; // 'Q4_K_M'
    family?: string;             // 'qwen2'
  };
}

/** 从 chat-completions baseUrl 推导 /api/tags 的完整 URL */
export function ollamaTagsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.host}/api/tags`;
}

export async function fetchOllamaModels(baseUrl: string): Promise<OllamaModel[]> {
  const tagsUrl = ollamaTagsUrl(baseUrl);
  const isDev = (import.meta as any).env?.DEV;
  // dev：走 vite middleware（绕 CORS）；prod：直连
  const url = isDev ? `/ai-proxy/${encodeURIComponent(tagsUrl)}` : tagsUrl;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!Array.isArray(data?.models)) {
    throw new Error('返回格式异常：缺 models 数组');
  }
  return data.models as OllamaModel[];
}

/** 'qwen2.5-coder:7b' → 'qwen2.5-coder' */
export function modelFamily(name: string) {
  return name.split(':')[0] ?? name;
}

/**
 * 判断 baseUrl 是否指向本地 Ollama（localhost / 127.* / ::1 / 私有局域网）。
 * 用于 fastLane：只有本地 ollama 才适合做高频实时调用（免费 + 低延迟）。
 */
export function isLocalOllamaUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || host === '127.0.0.1') return true;
    // RFC1918 私有地址
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

export function formatModelSize(bytes: number) {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(0)} MB`;
}

/** 列出当前已加载到内存的模型（GET /api/ps） */
export async function fetchRunningOllamaModels(baseUrl: string): Promise<string[]> {
  const u = new URL(baseUrl);
  const psUrl = `${u.protocol}//${u.host}/api/ps`;
  const isDev = (import.meta as any).env?.DEV;
  const url = isDev ? `/ai-proxy/${encodeURIComponent(psUrl)}` : psUrl;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.models ?? []).map((m: any) => String(m.name));
  } catch {
    return [];
  }
}

/**
 * 立即把指定模型从内存中卸载（释放 VRAM/RAM）。
 * 实现：POST /api/chat with keep_alive=0，无论该模型当前是否在内存里都安全。
 */
export async function unloadOllamaModel(baseUrl: string, modelName: string): Promise<void> {
  const u = new URL(baseUrl);
  const chatUrl = `${u.protocol}//${u.host}/api/chat`;
  const isDev = (import.meta as any).env?.DEV;
  const url = isDev ? `/ai-proxy/${encodeURIComponent(chatUrl)}` : chatUrl;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelName, messages: [], keep_alive: 0 }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  }
}

export function formatModified(iso: string) {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 30 * 86400) return `${Math.floor(diff / 86400)} 天前`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
