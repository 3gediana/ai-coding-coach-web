import type { FileLang, SubmissionVerdict } from '../core/types';

export interface OjSubmitCommandInput {
  source: string;
  targetUrl: string;
  problemId: string;
  problemTitle: string;
  fileName: string;
  language: FileLang;
  code: string;
  autoSubmit: boolean;
}

export interface OjSubmitResult {
  id: string;
  source: string;
  url: string;
  status: 'filled' | 'done' | 'failed' | 'timeout';
  verdict?: SubmissionVerdict;
  rawText?: string;
  message?: string;
  finishedAt?: number;
}

interface PendingWaiter {
  resolve: (result: OjSubmitResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingWaiter>();
let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

export function startOjBridgeReceiver(): void {
  if (!import.meta.env.DEV) return;
  if (eventSource) return;
  stopped = false;
  connect();
}

export function stopOjBridgeReceiver(): void {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  for (const [id, waiter] of pending) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(`OJ 提交监听已停止：${id}`));
  }
  pending.clear();
}

export async function submitToOj(
  input: OjSubmitCommandInput,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<OjSubmitResult> {
  startOjBridgeReceiver();
  const resp = await fetch('/__oj-submit-command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: opts.signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`下发 OJ 提交命令失败：${resp.status} ${text.slice(0, 120)}`);
  }
  const data = (await resp.json()) as { id?: string };
  if (!data.id) throw new Error('本地桥接未返回提交命令 id');
  const id = data.id;

  return new Promise<OjSubmitResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('等待 OJ 判题结果超时，请确认油猴脚本仍在题目页运行'));
    }, opts.timeoutMs ?? 8 * 60_000);
    const onAbort = () => {
      clearTimeout(timer);
      pending.delete(id);
      void cancelOjCommand(id);
      reject(new DOMException('已取消 OJ 提交', 'AbortError') as any);
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      resolve: (result) => {
        opts.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      },
      reject: (err) => {
        opts.signal?.removeEventListener('abort', onAbort);
        reject(err);
      },
      timer,
    });
  });
}

async function cancelOjCommand(id: string): Promise<void> {
  try {
    await fetch('/__oj-cancel-command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  } catch {
    /* ignore */
  }
}

function connect(): void {
  if (stopped) return;
  try {
    eventSource = new EventSource('/__oj-result-sse');
  } catch (err) {
    console.warn('[oj-bridge] EventSource 创建失败', err);
    scheduleReconnect();
    return;
  }

  eventSource.addEventListener('open', () => {
    console.log('%c[oj-bridge]%c SSE 已连接', 'color:#0a8', 'color:inherit');
  });

  eventSource.addEventListener('message', (ev) => {
    try {
      const result = JSON.parse(ev.data) as OjSubmitResult;
      const waiter = pending.get(result.id);
      if (!waiter) return;
      pending.delete(result.id);
      clearTimeout(waiter.timer);
      waiter.resolve(result);
    } catch (err) {
      console.warn('[oj-bridge] result 解析失败', err, ev.data);
    }
  });

  eventSource.addEventListener('error', () => {
    console.warn('[oj-bridge] SSE 断开，5s 后重连');
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 5_000);
}
