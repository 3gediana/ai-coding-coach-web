/**
 * 浏览器版 AI 客户端：OpenAI 兼容协议 + 流式 + 智能重试。
 *
 * 关键能力：
 * - chat()         非流式，全部等完返回
 * - chatStream()   流式，AsyncIterable<string>，UI 可边收边渲染
 * - chatJson()     等完后做宽松 JSON 解析（剥离 <think> / 代码围栏）
 * - chatJsonStream() 流式 + 累积 + 末尾解 JSON，同时把流暴露出来
 * - 自动 dev proxy：通过 /ai-proxy/<encoded> 绕开 CORS（Vite 配过）
 * - 429 / 5xx / 网络错误 -> 指数退避重试，遵循 Retry-After
 */
import type { AIConfig } from '../types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, reason: string) => void;
  /** 流式收到一段增量文本时回调（仅 chatStream / *Stream 系列触发） */
  onChunk?: (delta: string, accumulated: string) => void;
}

export class AIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryable: boolean = false,
  ) {
    super(message);
    this.name = 'AIError';
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TEMPERATURE = 0.3;

export class AIClient {
  constructor(private cfg: AIConfig) {}

  updateConfig(cfg: AIConfig) {
    this.cfg = cfg;
  }

  /** 非流式 chat，返回完整文本 */
  async chat(req: ChatRequest): Promise<string> {
    const body = this.buildBody(req, false);
    const res = await this.fetchWithRetry(body, req);
    const json = await res.json();
    // ollama 原生 /api/chat: { message: { content }, ... }
    // OpenAI 兼容:           { choices: [{ message: { content } }] }
    const content = this.isOllamaNative()
      ? (json?.message?.content ?? '')
      : (json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? '');
    return typeof content === 'string' ? content : JSON.stringify(content);
  }

  /** 流式 chat，AsyncIterable + onChunk 回调 */
  async *chatStream(req: ChatRequest): AsyncGenerator<string, string, void> {
    const body = this.buildBody(req, true);
    const res = await this.fetchWithRetry(body, req);
    if (!res.body) {
      throw new AIError('Empty response body for stream', res.status, false);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let acc = '';
    const ollamaNative = this.isOllamaNative();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        if (ollamaNative) {
          // ollama 原生：NDJSON，每行一个 JSON
          // { message: { content }, done }
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const j = JSON.parse(trimmed);
              const delta = j?.message?.content ?? '';
              if (typeof delta === 'string' && delta) {
                acc += delta;
                req.onChunk?.(delta, acc);
                yield delta;
              }
            } catch {
              // ignore
            }
          }
        } else {
          // OpenAI 兼容 SSE: 按 \n\n 拆事件
          const events = buf.split('\n\n');
          buf = events.pop() ?? '';
          for (const evt of events) {
            for (const line of evt.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (!data || data === '[DONE]') continue;
              try {
                const j = JSON.parse(data);
                const delta =
                  j?.choices?.[0]?.delta?.content ??
                  j?.choices?.[0]?.message?.content ??
                  '';
                if (typeof delta === 'string' && delta) {
                  acc += delta;
                  req.onChunk?.(delta, acc);
                  yield delta;
                }
              } catch {
                // 容忍非 JSON 行
              }
            }
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
    return acc;
  }

  /** 流式收完 + JSON 宽松解析 */
  async chatJsonStream<T = unknown>(req: ChatRequest): Promise<T> {
    let acc = '';
    for await (const _ of this.chatStream({
      ...req,
      onChunk: (delta, accumulated) => {
        acc = accumulated;
        req.onChunk?.(delta, accumulated);
      },
    })) {
      // 已通过 onChunk 累积
    }
    return parseJsonLoose<T>(acc);
  }

  /** 非流式 + JSON 宽松解析 */
  async chatJson<T = unknown>(req: ChatRequest): Promise<T> {
    const text = await this.chat(req);
    return parseJsonLoose<T>(text);
  }

  // ============ 私有 ============

  /** 是否走 ollama 原生 /api/chat 协议（拥有 num_gpu / num_ctx 等关键参数） */
  private isOllamaNative(): boolean {
    return this.cfg.provider === 'ollama';
  }

  /**
   * 计算实际请求的 endpoint URL：
   * - ollama: 把 baseUrl 中 OpenAI 兼容路径 `/v1/chat/completions` 自动改写为 `/api/chat`
   *   这样用户在设置里仍可填 `http://localhost:11434/v1/chat/completions`（或 `/api/chat`），都正常
   * - 其它：原样返回
   */
  private effectiveBaseUrl(): string {
    if (!this.isOllamaNative()) return this.cfg.baseUrl;
    let u = this.cfg.baseUrl.trim();
    u = u.replace(/\/v1\/chat\/completions\/?$/, '/api/chat');
    if (!/\/api\/chat\/?$/.test(u)) {
      // 容忍用户填了 base 域名（例如 http://localhost:11434）
      u = u.replace(/\/+$/, '') + '/api/chat';
    }
    return u;
  }

  private buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const cfg = this.cfg;
    const messages = [...req.messages];
    // 兜底：Qwen3 识别 /no_think 指令关思考
    if (this.isOllamaNative()) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user' && !messages[i].content.includes('/no_think')) {
          messages[i] = { ...messages[i], content: messages[i].content + ' /no_think' };
          break;
        }
      }
    }

    if (this.isOllamaNative()) {
      // Ollama 原生 /api/chat 格式
      // - options.num_gpu = -1 全部 layer 到 GPU
      // - options.num_ctx：用户在设置里可调，不填默认 20480
      //   ceiling bench 实测 24K 维持 43-44 tok/s，32K 暴跌至 9 tok/s（CPU offload）
      //   小显存机器建议下调到 8192–16384
      // - options.num_predict 限制输出长度
      // - think: false 关闭思考链
      return {
        model: req.model ?? cfg.model,
        messages,
        stream,
        think: false,
        options: {
          temperature: req.temperature ?? cfg.temperature ?? DEFAULT_TEMPERATURE,
          num_gpu: -1,
          num_ctx: cfg.numCtx ?? 20480,
          num_predict: req.maxTokens ?? cfg.maxTokens ?? 2048,
        },
      };
    }

    return {
      model: req.model ?? cfg.model,
      messages,
      max_tokens: req.maxTokens ?? cfg.maxTokens ?? 4096,
      temperature: req.temperature ?? cfg.temperature ?? DEFAULT_TEMPERATURE,
      stream,
    };
  }

  private async fetchWithRetry(body: Record<string, unknown>, req: ChatRequest): Promise<Response> {
    const cfg = this.cfg;
    const maxRetries = req.maxRetries ?? cfg.maxRetries ?? DEFAULT_MAX_RETRIES;
    const timeoutMs = req.timeoutMs ?? cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const linkSig = (s: AbortSignal | undefined) => {
        if (!s) return;
        if (s.aborted) ctrl.abort();
        else s.addEventListener('abort', () => ctrl.abort());
      };
      linkSig(req.signal);

      try {
        const url = buildProxyUrl(this.effectiveBaseUrl());
        const headers: Record<string, string> = {
          'content-type': 'application/json',
        };
        // ollama 等本地服务不需要 apiKey，空时跳过 Authorization
        if (cfg.apiKey?.trim()) {
          headers.authorization = `Bearer ${cfg.apiKey.trim()}`;
        }
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });

        if (res.ok) {
          clearTimeout(timer);
          return res;
        }

        const errText = await safeText(res);
        const retryable = res.status === 429 || res.status >= 500;
        const err = new AIError(
          `AI API ${res.status}: ${errText.slice(0, 240)}`,
          res.status,
          retryable,
        );

        if (!retryable || attempt >= maxRetries) {
          throw err;
        }

        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        const delay =
          retryAfter ?? Math.min(20_000, 800 * Math.pow(2, attempt) + Math.random() * 600);
        req.onRetry?.(attempt + 1, delay, `${res.status} ${errText.slice(0, 80)}`);
        await sleep(delay);
        attempt++;
      } catch (e: any) {
        clearTimeout(timer);
        const isAbort = e?.name === 'AbortError';
        const isTransient = isAbort || /fetch failed|network|ECONN|ETIMED/i.test(e?.message || '');

        if (e instanceof AIError && !e.retryable) {
          throw e;
        }
        if (!isTransient || attempt >= maxRetries) {
          if (e instanceof AIError) throw e;
          throw new AIError(e?.message || 'network error', undefined, false);
        }

        const delay = Math.min(15_000, 600 * Math.pow(2, attempt) + Math.random() * 600);
        req.onRetry?.(
          attempt + 1,
          delay,
          isAbort ? `timeout ${timeoutMs}ms` : e?.message || 'network',
        );
        await sleep(delay);
        attempt++;
        lastError = e;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new AIError(`Failed after ${maxRetries + 1} attempts: ${String(lastError)}`);
  }
}

// ============ 工具 ============

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const sec = Number(h);
  if (!Number.isNaN(sec)) return sec * 1000;
  const date = Date.parse(h);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

/**
 * Dev 模式下走 Vite proxy 绕 CORS。
 * 生产模式下直接打到真实 URL（用户自行处理 CORS）。
 */
function buildProxyUrl(baseUrl: string): string {
  const isDev = typeof window !== 'undefined' && (import.meta as any).env?.DEV;
  // baseUrl 形如 https://api.minimaxi.com/v1/chat/completions（用户配置）
  const full = baseUrl.replace(/\/+$/, '');
  if (!isDev) return full;
  return `/ai-proxy/${encodeURIComponent(full)}`;
}

/** 剥 <think>...</think>，去掉 ```json``` 围栏，提取首个完整 JSON 对象/数组 */
export function stripThinkBlock(text: string): string {
  let s = text;
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<\|[a-z_]+\|>/gi, '');
  s = s.trim();
  return s;
}

export function parseJsonLoose<T = unknown>(text: string): T {
  const stripped = stripThinkBlock(text);
  // 先尝试代码围栏
  const fence = stripped.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : stripped;

  const raw = extractFirstJson(candidate) ?? candidate.trim();

  try {
    return JSON.parse(raw) as T;
  } catch {
    // 容错：去掉行内注释 + 末尾逗号
    const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleaned) as T;
  }
}

/** 从文本中提取第一个完整、配对的 JSON 对象/数组（用栈匹配，处理嵌套和字符串） */
function extractFirstJson(text: string): string | null {
  let start = -1;
  let openChar = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{' || c === '[') {
      start = i;
      openChar = c;
      break;
    }
  }
  if (start === -1) return null;

  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inStr) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}
