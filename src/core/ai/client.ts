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

/**
 * 鉴别 AbortError：用户主动 abort 或上层 signal.aborted 引起的错误。
 * 浏览器把 fetch/AbortController 的中断包成 DOMException(name='AbortError')。
 * 重试逻辑命中此判断时立刻抛出，不再消耗 attempts、不再做退避。
 */
function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: unknown }).name;
  return name === 'AbortError';
}

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
  /**
   * 强制结构化输出。
   * - 'json'：Ollama 原生走 `format: 'json'`，OpenAI 兼容路径暂不启用以避免误伤不支持 response_format 的云 provider。
   * - 不传或 'text'：保持原 free-form 行为。
   * chatJson / chatJsonStream 会默认设为 'json'，调用方一般不用关心。
   */
  responseFormat?: 'json' | 'text';
  /** 禁用支持该参数的模型的推理/思考模式。 */
  disableThinking?: boolean;
  keepAlive?: string | number;
  /**
   * chatJson / chatJsonStream 的总 attempt 次数（含首次）。默认 3。
   * 当上层有 fallback 链（比如云端→fastLane）时，建议传 1：
   * 让单次失败立即抛给上层、不浪费时间在内层 retry，避免吃光 timeout。
   */
  jsonAttempts?: number;
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

  /**
   * 流式收完 + JSON 宽松解析。
   * 云模型偶发空响应 / 严重截断时自动 retry 1 次（仅 chatJson 层做，不影响 chatStream UX）。
   */
  async chatJsonStream<T = unknown>(req: ChatRequest): Promise<T> {
    // 默认让本地 Ollama 走 format: 'json' 强制结构化（小模型字段漂移率显著下降）
    const reqWithFormat: ChatRequest = { responseFormat: 'json', ...req };
    const runOnce = async (): Promise<{ ok: true; value: T } | { ok: false; acc: string; err: unknown }> => {
      let acc = '';
      try {
        for await (const _ of this.chatStream({
          ...reqWithFormat,
          onChunk: (delta, accumulated) => {
            acc = accumulated;
            req.onChunk?.(delta, accumulated);
          },
        })) {
          // 已通过 onChunk 累积
        }
      } catch (e) {
        return { ok: false, acc, err: e };
      }
      // 空输出：直接 retry（不抛错，让上层决定）
      if (!acc.trim()) {
        return { ok: false, acc, err: new Error('empty stream response') };
      }
      try {
        return { ok: true, value: parseJsonLoose<T>(acc) };
      } catch (e) {
        return { ok: false, acc, err: e };
      }
    };
    // 云端偶发空响应/截断 → 重试至多 (attempts-1) 次与 300/800ms 退避；上层有 fallback 时传 1 节省 timeout
    const attempts = Math.max(1, req.jsonAttempts ?? 3);
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      // 用户已 abort：直接 throw，不再消耗 attempts。否则 abort 后还要等 1-2s 用户才看到"已停止"
      if (req.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const r = await runOnce();
      if (r.ok) return r.value;
      lastErr = r.err;
      // 失败本身就是 abort 引起的 → 立刻向上抛，避免又退避又重试
      if (isAbortError(r.err) || req.signal?.aborted) {
        throw r.err;
      }
      if (typeof console !== 'undefined') {
        console.debug(
          `[AIClient.chatJsonStream] attempt ${i + 1}/${attempts} failed: ${(r.err as any)?.message?.slice?.(0, 80)}; ${i < attempts - 1 ? 'retrying' : 'giving up'}`,
        );
      }
      if (i < attempts - 1) await new Promise((res) => setTimeout(res, 300 * (i + 1) + 200));
    }
    throw lastErr;
  }

  /**
   * 非流式 + JSON 宽松解析。
   * 同样在 JSON 解析失败 / 空响应时自动 retry 1 次。
   */
  async chatJson<T = unknown>(req: ChatRequest): Promise<T> {
    const reqWithFormat: ChatRequest = { responseFormat: 'json', ...req };
    const runOnce = async (): Promise<{ ok: true; value: T } | { ok: false; err: unknown }> => {
      let text: string;
      try {
        text = await this.chat(reqWithFormat);
      } catch (e) {
        return { ok: false, err: e };
      }
      if (!text.trim()) return { ok: false, err: new Error('empty response') };
      try {
        return { ok: true, value: parseJsonLoose<T>(text) };
      } catch (e) {
        return { ok: false, err: e };
      }
    };
    // 同 chatJsonStream：默认 3 attempt，上层 fallback 链场景可传 1 节省 timeout
    const attempts = Math.max(1, req.jsonAttempts ?? 3);
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      if (req.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const r = await runOnce();
      if (r.ok) return r.value;
      lastErr = r.err;
      if (isAbortError(r.err) || req.signal?.aborted) {
        throw r.err;
      }
      if (typeof console !== 'undefined') {
        console.debug(
          `[AIClient.chatJson] attempt ${i + 1}/${attempts} failed: ${(r.err as any)?.message?.slice?.(0, 80)}; ${i < attempts - 1 ? 'retrying' : 'giving up'}`,
        );
      }
      if (i < attempts - 1) await new Promise((res) => setTimeout(res, 300 * (i + 1) + 200));
    }
    throw lastErr;
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
   * - 其它 OpenAI 兼容接口：容忍用户填到 `/v1`，自动补 `/chat/completions`
   */
  private effectiveBaseUrl(): string {
    if (!this.isOllamaNative()) {
      let u = this.cfg.baseUrl.trim().replace(/\/+$/, '');
      if (/\/v1$/i.test(u)) u += '/chat/completions';
      return u;
    }
    let u = this.cfg.baseUrl.trim();
    u = u.replace(/\/v1\/chat\/completions\/?$/, '/api/chat');
    // 容忍用户只填到 /v1（Ollama 自身没有 /v1/api/chat 这种路径，必须先剥）
    u = u.replace(/\/v1\/?$/, '');
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
      // - format: 'json' 强制结构化输出（仅 chatJson/chatJsonStream 默认开启）
      //   小模型（4B 及以下）在 strict schema 下字段漂移率显著下降；free-form chat 不开启
      const body: Record<string, unknown> = {
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
      if (req.responseFormat === 'json') {
        body.format = 'json';
      }
      if (req.keepAlive !== undefined) {
        body.keep_alive = req.keepAlive;
      }
      return body;
    }

    const body: Record<string, unknown> = {
      model: req.model ?? cfg.model,
      messages,
      max_tokens: req.maxTokens ?? cfg.maxTokens ?? 4096,
      temperature: req.temperature ?? cfg.temperature ?? DEFAULT_TEMPERATURE,
      stream,
    };
    if (req.disableThinking) {
      if (cfg.provider === 'deepseek') {
        body.thinking = { type: 'disabled' };
      }
      if (cfg.provider === 'qwen') {
        body.enable_thinking = false;
      }
    }
    return body;
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
 * 同源代理存在时走 /ai-proxy 绕 CORS，并允许服务端自动启动本机 Ollama。
 * 只有外部生产部署才直连真实 URL。
 */
function buildProxyUrl(baseUrl: string): string {
  // baseUrl 形如 https://api.minimaxi.com/v1/chat/completions（用户配置）
  const full = baseUrl.replace(/\/+$/, '');
  if (typeof window === 'undefined') return full;
  const isLocal = (() => {
    try {
      const u = new URL(full);
      const h = u.hostname.toLowerCase();
      return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.startsWith('192.168.') || h.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
    } catch {
      return false;
    }
  })();
  if (!isLocal && !(import.meta as any).env?.DEV) return full;
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

  // 1) 完整闭合的 JSON（最理想）
  const firstClosed = extractFirstJson(candidate);
  if (firstClosed) {
    try {
      return JSON.parse(firstClosed) as T;
    } catch {
      // 落到第三步处理 string 内部 raw newline / 注释 / 末尾逗号
      try {
        return JSON.parse(repairJson(firstClosed)) as T;
      } catch {
        // 继续兜底
      }
    }
  }

  // 2) 截断的 JSON：自动补齐缺失的 } / ]
  const completed = completeTruncatedJson(candidate);
  if (completed) {
    try {
      return JSON.parse(completed) as T;
    } catch {
      try {
        return JSON.parse(repairJson(completed)) as T;
      } catch {
        // 继续兜底
      }
    }
  }

  // 3) 最朴素 fallback
  const raw = candidate.trim();
  try {
    return JSON.parse(raw) as T;
  } catch {
    return JSON.parse(repairJson(raw)) as T;
  }
}

/** 修补 LLM 常见 JSON 不规范：行内注释、末尾逗号、string 内未转义 newline / tab */
function repairJson(s: string): string {
  // 去 // 行注释（仅在非字符串区域略嫌粗暴，但够用）
  let out = s.replace(/\/\/.*$/gm, '');
  // 去末尾逗号
  out = out.replace(/,\s*([}\]])/g, '$1');
  // 把 string 内部 raw \n / \t 替成转义版本
  out = escapeRawNewlinesInStrings(out);
  return out;
}

/** 把双引号字符串里的真换行 / tab 替为 \n / \t */
function escapeRawNewlinesInStrings(s: string): string {
  let result = '';
  let inStr = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      result += c;
      escape = false;
      continue;
    }
    if (c === '\\') {
      result += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      result += c;
      continue;
    }
    if (inStr) {
      if (c === '\n') {
        result += '\\n';
        continue;
      }
      if (c === '\r') {
        result += '\\r';
        continue;
      }
      if (c === '\t') {
        result += '\\t';
        continue;
      }
    }
    result += c;
  }
  return result;
}

/**
 * 流被截断 → 用栈跟踪未闭合的 { / [ / "，自动补齐。
 * 返回 null 表示根本找不到起始 { / [。
 */
function completeTruncatedJson(text: string): string | null {
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{' || c === '[') {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  const stack: string[] = [];
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
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }

  let body = text.slice(start);
  // 如果在字符串中被截断 → 补一个 "
  if (inStr) body += '"';
  // 截断末尾常见残留：trailing comma / colon / 不完整的 key
  body = body.replace(/[,:]\s*$/g, '');
  body = body.replace(/"\s*[A-Za-z0-9_]*$/g, '""');
  // 按栈顺序反向补 close 字符
  while (stack.length > 0) {
    const open = stack.pop()!;
    body += open === '{' ? '}' : ']';
  }
  return body;
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
