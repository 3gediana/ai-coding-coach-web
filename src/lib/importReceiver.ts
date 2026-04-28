/**
 * 题目导入接收器：订阅 vite middleware 的 SSE 流，把外部抓到的题目灌进项目
 *
 * 数据流：
 *   TM 脚本（educoder/校内 OJ）→ POST /__import
 *     → vite plugin 写入 SSE 流
 *     → 此模块订阅 → 调 store.handleImportPayload
 *     → store 处理（去重 / 多模态识图 / parseProblem / 入库 / 激活）
 *
 * 仅在 dev 环境（import.meta.env.DEV）启用。production 不暴露 /__import 端点。
 */
import { toast } from 'sonner';
import { useStore } from './store';

export interface ImportPayload {
  /** 来源标识，用于 url 去重和 UI 显示徽章 */
  source: 'school-oj' | 'educoder' | string;
  /** 题目唯一 URL（含 hash 路由）—— 去重 key */
  url: string;
  /** 题目标题，可选（store 会再次从 rawText 抽） */
  title?: string;
  /** 题面纯文本 / markdown，未结构化 */
  rawText?: string;
  /** 图片：base64（推荐）或 URL（公网图） */
  images?: Array<{
    src: string;
    base64?: string;
    alt?: string;
  }>;
  /** 编辑器里现有的代码（如有 starter code） */
  initialCode?: string;
  /** 编程语言提示 */
  language?: 'cpp' | 'python' | 'java' | string;
  /** 任意元数据（题号、分值、时间限制等） */
  meta?: Record<string, unknown>;
}

let eventSource: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

/** 启动 SSE 订阅。会自动重连 */
export function startImportReceiver(): void {
  if (!import.meta.env.DEV) return;
  if (eventSource) return; // 已启动
  stopped = false;
  connect();
}

/** 停止订阅（用于热更新清理） */
export function stopImportReceiver(): void {
  stopped = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function connect(): void {
  if (stopped) return;
  try {
    eventSource = new EventSource('/__import-sse');
  } catch (e) {
    console.warn('[import-receiver] EventSource 创建失败', e);
    scheduleReconnect();
    return;
  }

  eventSource.addEventListener('open', () => {
    console.log('%c[import-receiver]%c SSE 已连接', 'color:#36c', 'color:inherit');
  });

  eventSource.addEventListener('message', (ev) => {
    try {
      const payload = JSON.parse(ev.data) as ImportPayload;
      onPayload(payload);
    } catch (err) {
      console.warn('[import-receiver] payload 解析失败', err, ev.data);
    }
  });

  eventSource.addEventListener('error', () => {
    console.warn('[import-receiver] SSE 断开，5s 后重连');
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (stopped || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, 5_000);
}

function onPayload(payload: ImportPayload): void {
  // 数据校验
  if (!payload?.url || !payload?.source) {
    console.warn('[import-receiver] 无效 payload', payload);
    return;
  }
  console.log(
    `%c[import-receiver]%c 收到来自 ${payload.source} 的题目: ${payload.title || '(无标题)'} | ${payload.images?.length ?? 0} 图`,
    'color:#36c', 'color:inherit',
  );
  toast.info(`📥 收到 ${sourceLabel(payload.source)} 题目`, {
    description: payload.title || payload.url,
    duration: 3000,
  });
  // 委托给 store 异步处理（图片识别 / parseProblem / 入库）
  void useStore.getState().handleImportPayload(payload);
}

function sourceLabel(source: string): string {
  if (source === 'school-oj') return '校内 OJ';
  if (source === 'educoder') return '头歌';
  return source;
}
