import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

/**
 * Dev 时通过自定义中间件转发到真实 AI endpoint，绕开 CORS。
 *
 * 客户端调用：fetch('/ai-proxy/' + encodeURIComponent('https://.../v1/chat/completions'), ...)
 */

// ============== Ollama 自动起服务 ==============

let managedOllama: ChildProcess | null = null;
let ensuringPromise: Promise<boolean> | null = null;

function probePort(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

async function waitOllamaReady(maxMs = 20_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await probePort('127.0.0.1', 11434, 300)) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        const r = await fetch('http://127.0.0.1:11434/api/version', { signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok) return true;
      } catch {
        /* not yet */
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * 探测 11434 端口；若不通则 spawn `ollama serve`，并轮询到就绪。
 * 重复并发调用复用同一个 promise。
 *
 * **默认 opt-in**：仅当环境变量 `AICC_AUTO_OLLAMA=1` 时才自动 spawn；
 * 没装 ollama 的二次开发者就不会被强行拉起一个不存在的进程。
 */
async function ensureOllamaRunning(): Promise<boolean> {
  if (await probePort('127.0.0.1', 11434, 300)) return true;
  if (process.env.AICC_AUTO_OLLAMA !== '1') {
    return false; // 用户没显式 opt-in，不做事
  }
  if (ensuringPromise) return ensuringPromise;
  ensuringPromise = (async () => {
    console.log('\x1b[33m[aicc-ollama]\x1b[0m 端口 11434 未在监听，自动启动 `ollama serve` ...');
    try {
      managedOllama = spawn(
        process.platform === 'win32' ? 'ollama.exe' : 'ollama',
        ['serve'],
        {
          detached: false,
          stdio: 'ignore',
          windowsHide: true,
        },
      );
      managedOllama.on('exit', (code) => {
        console.log(`\x1b[33m[aicc-ollama]\x1b[0m ollama serve 退出 code=${code}`);
        managedOllama = null;
      });
      managedOllama.on('error', (err) => {
        console.warn(`\x1b[31m[aicc-ollama]\x1b[0m spawn 失败: ${err.message}（请确认 PATH 中有 ollama）`);
      });
    } catch (e: any) {
      console.warn(`\x1b[31m[aicc-ollama]\x1b[0m spawn 失败: ${e?.message}`);
      ensuringPromise = null;
      return false;
    }
    const ready = await waitOllamaReady(20_000);
    if (ready) console.log('\x1b[32m[aicc-ollama]\x1b[0m ✓ ollama 已就绪 (auto-managed)');
    else console.warn('\x1b[31m[aicc-ollama]\x1b[0m ⚠ 20s 内 ollama 未就绪，跳过');
    // ensuringPromise 保持已 resolve，下次直接复用结果（避免重复 spawn）
    return ready;
  })();
  return ensuringPromise;
}

function killManagedOllama() {
  if (managedOllama && !managedOllama.killed) {
    console.log('\x1b[33m[aicc-ollama]\x1b[0m 关闭 auto-managed ollama serve');
    try {
      managedOllama.kill();
    } catch {
      /* ignore */
    }
    managedOllama = null;
  }
}
process.on('exit', killManagedOllama);
process.on('SIGINT', () => { killManagedOllama(); process.exit(0); });
process.on('SIGTERM', () => { killManagedOllama(); process.exit(0); });

/** 判断 url 是否指向本地 ollama（11434） */
function isLocalOllamaTarget(target: URL): boolean {
  if (target.port !== '11434') return false;
  const h = target.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

const ollamaAutostartPlugin: Plugin = {
  name: 'aicc-ollama-autostart',
  configureServer(server) {
    // 启动 vite 时不立即拉起 ollama（lazy）：第一次有 ollama 请求才 spawn
    // 这样不依赖 ollama 的项目 / 用户也不会被影响
    server.httpServer?.on('close', killManagedOllama);
  },
};

export default defineConfig({
  // 让 .env.local 里 AI_COACH_* 也能在前端访问（保持与已有变量命名一致）
  envPrefix: ['VITE_', 'AI_COACH_'],
  plugins: [
    react(),
    ollamaAutostartPlugin,
    {
      name: 'aicc-ai-proxy',
      configureServer(server) {
        server.middlewares.use('/ai-proxy', async (req, res) => {
          const encoded = (req.url || '').replace(/^\//, '');
          if (!encoded) {
            res.statusCode = 400;
            res.end('missing target');
            return;
          }
          let target: URL;
          try {
            target = new URL(decodeURIComponent(encoded));
          } catch {
            res.statusCode = 400;
            res.end('invalid target');
            return;
          }

          // 目标是本地 ollama → 自动确保 ollama serve 在跑
          if (isLocalOllamaTarget(target)) {
            const ok = await ensureOllamaRunning();
            if (!ok) {
              res.statusCode = 503;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({
                error: 'ollama 未就绪：请检查 PATH 中是否有 `ollama` 命令，或手动 `ollama serve`',
              }));
              return;
            }
          }

          // 收集 body（本地不流式接收，但发到 AI 后保持流式响应）
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', async () => {
            const body = Buffer.concat(chunks);
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(req.headers)) {
              if (typeof v === 'string') {
                if (k === 'host' || k === 'connection' || k === 'content-length') continue;
                headers[k] = v;
              }
            }
            try {
              const upstream = await fetch(target.toString(), {
                method: req.method ?? 'POST',
                headers,
                body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
              });
              res.statusCode = upstream.status;
              upstream.headers.forEach((v, k) => {
                // 跳过会冲突的 header
                if (
                  k === 'content-encoding' ||
                  k === 'content-length' ||
                  k === 'transfer-encoding'
                ) {
                  return;
                }
                res.setHeader(k, v);
              });
              if (!upstream.body) {
                res.end();
                return;
              }
              const reader = upstream.body.getReader();
              const pump = async () => {
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(Buffer.from(value));
                  }
                } finally {
                  res.end();
                }
              };
              await pump();
            } catch (e: any) {
              res.statusCode = 502;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: String(e?.message || e) }));
            }
          });
        });
      },
    },
    {
      // ========== 题面抓取代理 ==========
      // 客户端侧 fetch('/problem-fetch?url=<encoded>&ua=node')
      // - 绕浏览器 CORS
      // - 透传可定制 User-Agent（洛谷必须用非浏览器 UA，否则陷 cookie redirect 死循环）
      // - 限制目标域名白名单，避免被滥用为通用代理
      // 生产部署时需对应一个 Edge Function（同等逻辑）。
      name: 'aicc-problem-fetch',
      configureServer(server) {
        const ALLOWED_HOSTS = new Set([
          'www.luogu.com.cn',
          'luogu.com.cn',
          'atcoder.jp',
          'poj.org',
          'acm.hdu.edu.cn',
        ]);
        server.middlewares.use('/problem-fetch', async (req, res) => {
          try {
            const url = new URL('http://x' + (req.url || ''));
            const target = url.searchParams.get('url');
            const ua = url.searchParams.get('ua') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
            if (!target) {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: 'missing url' }));
              return;
            }
            let t: URL;
            try { t = new URL(target); } catch {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid url' }));
              return;
            }
            if (!ALLOWED_HOSTS.has(t.host.toLowerCase())) {
              res.statusCode = 403;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: `host not allowed: ${t.host}` }));
              return;
            }

            const upstream = await fetch(t.toString(), {
              headers: {
                'user-agent': ua,
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
              },
              redirect: 'follow',
            });
            const html = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.end(html);
          } catch (e: any) {
            res.statusCode = 502;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: String(e?.message || e) }));
          }
        });
      },
    },
    {
      // ========== Tampermonkey 题目导入接收端 + Node 端 sam 处理 ==========
      // 流程：
      //   1. TM POST /__import → 落盘 logs/imports/<ts>.raw.json
      //   2. 立即响应 200（TM 早返回，不等处理）
      //   3. 异步调 importProcessor.processImportFile（Node 端调 ollama sam）
      //   4. 处理完写 logs/imports/<ts>.processed.json
      //   5. SSE 推 processed payload 给前端 → 前端入库（不再调 AI）
      //
      // 这样：
      //   - 处理逻辑在 Node 端，稳定可观测（log + 落盘文件可重放）
      //   - 浏览器没刷新也能调试（看 .processed.json 文件即可）
      //   - sam keep_alive=0 由 Node 端 finally 块统一管理
      //
      // 跨域：CORS 全开（仅 dev 环境）。SSE 未连时入队避免数据丢失
      name: 'aicc-import-receiver',
      async configureServer(server) {
        // 动态 import Node 端 processor（避免 vite 试图把它当 client 模块打包）
        // @ts-expect-error - .mjs 没 d.ts，运行时 ESM 加载
        const { processImportFile } = await import('./scripts/server/importProcessor.mjs');
        type ImportPayload = {
          source: string;
          url: string;
          title?: string;
          rawText?: string;
          images?: Array<{ src: string; base64?: string; alt?: string }>;
          initialCode?: string;
          language?: string;
          meta?: Record<string, unknown>;
        };
        type OjCommand = {
          id: string;
          source: string;
          targetUrl: string;
          targetKey: string;
          problemId: string;
          problemTitle: string;
          fileName: string;
          language: string;
          code: string;
          autoSubmit: boolean;
          createdAt: number;
        };
        type OjResult = {
          id: string;
          source: string;
          url: string;
          status: 'done' | 'failed' | 'timeout';
          verdict?: string;
          rawText?: string;
          message?: string;
          finishedAt?: number;
        };
        const queue: ImportPayload[] = [];
        const sseClients = new Set<import('http').ServerResponse>();
        const ojCommands = new Map<string, OjCommand>();
        const ojResultQueue: OjResult[] = [];
        const ojResultClients = new Set<import('http').ServerResponse>();

        const readJsonBody = <T,>(req: any): Promise<T> =>
          new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => {
              try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
              } catch (err) {
                reject(err);
              }
            });
            req.on('error', reject);
          });
        const normalizeOjUrl = (raw: string): string => {
          try {
            const u = new URL(raw);
            if (u.hostname === 'www.educoder.net') return `${u.origin}${u.pathname}`;
            if (u.hostname === '10.11.219.21') return `${u.origin}${u.pathname}${u.hash}`;
            return `${u.origin}${u.pathname}${u.hash}`;
          } catch {
            return raw;
          }
        };
        const setCors = (res: any, methods = 'GET, POST, OPTIONS') => {
          res.setHeader('access-control-allow-origin', '*');
          res.setHeader('access-control-allow-methods', methods);
          res.setHeader('access-control-allow-headers', 'content-type');
        };

        server.middlewares.use('/__oj-submit-command', async (req, res) => {
          setCors(res, 'POST, OPTIONS');
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'method not allowed' }));
            return;
          }
          try {
            const payload = await readJsonBody<Omit<OjCommand, 'id' | 'targetKey' | 'createdAt'>>(req);
            if (!payload.source || !payload.targetUrl || !payload.code) {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: 'missing source/targetUrl/code' }));
              return;
            }
            const id = `oj-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
            const command: OjCommand = {
              ...payload,
              id,
              targetKey: normalizeOjUrl(payload.targetUrl),
              createdAt: Date.now(),
            };
            ojCommands.set(id, command);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, id, targetKey: command.targetKey }));
            console.log(`\x1b[35m[aicc-oj]\x1b[0m command ${id} → ${command.source} ${command.targetKey}`);
          } catch (err: any) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: String(err?.message || err) }));
          }
        });

        server.middlewares.use('/__oj-next-command', (req, res) => {
          setCors(res, 'GET, OPTIONS');
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'method not allowed' }));
            return;
          }
          const parsed = new URL(req.url ?? '', 'http://127.0.0.1');
          const source = parsed.searchParams.get('source') ?? '';
          const url = parsed.searchParams.get('url') ?? '';
          const key = normalizeOjUrl(url);
          const now = Date.now();
          for (const [id, cmd] of [...ojCommands]) {
            if (now - cmd.createdAt > 10 * 60_000) {
              ojCommands.delete(id);
              continue;
            }
            if (cmd.source === source && cmd.targetKey === key) {
              ojCommands.delete(id);
              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ command: cmd }));
              console.log(`\x1b[35m[aicc-oj]\x1b[0m picked ${id}`);
              return;
            }
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ command: null }));
        });

        server.middlewares.use('/__oj-result', async (req, res) => {
          setCors(res, 'POST, OPTIONS');
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'method not allowed' }));
            return;
          }
          try {
            const result = await readJsonBody<OjResult>(req);
            if (!result.id) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'missing id' }));
              return;
            }
            const payload: OjResult = { ...result, finishedAt: result.finishedAt ?? Date.now() };
            const msg = `data: ${JSON.stringify(payload)}\n\n`;
            let pushed = 0;
            for (const c of ojResultClients) {
              try { c.write(msg); pushed++; } catch { /* ignore */ }
            }
            if (pushed === 0) {
              ojResultQueue.push(payload);
              if (ojResultQueue.length > 50) ojResultQueue.shift();
            }
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, pushed }));
            console.log(`\x1b[35m[aicc-oj]\x1b[0m result ${payload.id} ${payload.status}/${payload.verdict ?? '-'}`);
          } catch (err: any) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: String(err?.message || err) }));
          }
        });

        server.middlewares.use('/__oj-result-sse', (req, res) => {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.end();
            return;
          }
          res.setHeader('content-type', 'text/event-stream');
          res.setHeader('cache-control', 'no-cache');
          res.setHeader('connection', 'keep-alive');
          res.setHeader('access-control-allow-origin', '*');
          (res as any).flushHeaders?.();
          res.write(': connected\n\n');
          ojResultClients.add(res);
          while (ojResultQueue.length > 0) {
            const p = ojResultQueue.shift()!;
            res.write(`data: ${JSON.stringify(p)}\n\n`);
          }
          const ping = setInterval(() => {
            try { res.write(': ping\n\n'); } catch { /* ignore */ }
          }, 30_000);
          req.on('close', () => {
            clearInterval(ping);
            ojResultClients.delete(res);
          });
        });

        // POST /__import → 入队 + 推送给 SSE 客户端
        server.middlewares.use('/__import', (req, res) => {
          // CORS
          res.setHeader('access-control-allow-origin', '*');
          res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
          res.setHeader('access-control-allow-headers', 'content-type');
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'method not allowed' }));
            return;
          }
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            try {
              const text = Buffer.concat(chunks).toString('utf8');
              const payload = JSON.parse(text) as ImportPayload;
              if (!payload.url || !payload.source) {
                res.statusCode = 400;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ error: 'missing url/source' }));
                return;
              }
              // 1. 落盘 raw 文件
              let rawPath: string | null = null;
              try {
                const dir = pathResolve(process.cwd(), 'logs', 'imports');
                mkdirSync(dir, { recursive: true });
                const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const safeSource = String(payload.source).replace(/[^\w-]/g, '_');
                const fname = `${ts}_${safeSource}.raw.json`;
                rawPath = pathResolve(dir, fname);
                writeFileSync(rawPath, JSON.stringify(payload, null, 2), 'utf8');
              } catch (err: any) {
                console.warn(`\x1b[31m[aicc-import]\x1b[0m 落盘失败: ${err?.message}`);
              }
              const sizeKB = (text.length / 1024).toFixed(1);
              const imgN = payload.images?.length ?? 0;
              console.log(
                `\x1b[36m[aicc-import]\x1b[0m ${payload.source} ${payload.title?.slice(0, 30) ?? '(无标题)'} (${sizeKB} KB, ${imgN} 图) ${rawPath ? `· raw 落盘 ${rawPath.split(/[\\\/]/).pop()}` : ''}`,
              );

              // 2. 立即响应 200，让 TM 早返回（不等 sam 处理）
              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: true, rawPath: rawPath?.split(/[\\\/]/).pop() }));

              // 3. 异步：Node 端处理（sam 识图 + 卸载）→ SSE 推 processed payload
              if (rawPath) {
                processImportFile(rawPath)
                  .then((result: { processedPath: string; payload: ImportPayload }) => {
                    const processed = result.payload;
                    const msg = `data: ${JSON.stringify(processed)}\n\n`;
                    let pushed = 0;
                    for (const c of sseClients) {
                      try { c.write(msg); pushed++; } catch { /* ignore */ }
                    }
                    if (pushed === 0) {
                      queue.push(processed);
                      if (queue.length > 50) queue.shift();
                    }
                    console.log(
                      `\x1b[36m[aicc-import]\x1b[0m processed → ${pushed > 0 ? `推送 ${pushed}` : '入队'} · ${result.processedPath.split(/[\\\/]/).pop()}`,
                    );
                  })
                  .catch((err: any) => {
                    console.error(`\x1b[31m[aicc-import]\x1b[0m processor 失败: ${err?.message || err}`);
                    // 失败也推 raw payload 让前端有反馈
                    const msg = `data: ${JSON.stringify(payload)}\n\n`;
                    for (const c of sseClients) {
                      try { c.write(msg); } catch { /* ignore */ }
                    }
                  });
              }
            } catch (e: any) {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: String(e?.message || e) }));
            }
          });
        });

        // GET /__import-sse → 前端订阅
        server.middlewares.use('/__import-sse', (req, res) => {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.end();
            return;
          }
          res.setHeader('content-type', 'text/event-stream');
          res.setHeader('cache-control', 'no-cache');
          res.setHeader('connection', 'keep-alive');
          res.setHeader('access-control-allow-origin', '*');
          (res as any).flushHeaders?.();
          // 心跳 & 立即写一行避免某些代理缓冲
          res.write(': connected\n\n');
          sseClients.add(res);
          // 推送队列里未消费的
          while (queue.length > 0) {
            const p = queue.shift()!;
            res.write(`data: ${JSON.stringify(p)}\n\n`);
          }
          // 30s 心跳保活
          const ping = setInterval(() => {
            try { res.write(': ping\n\n'); } catch { /* ignore */ }
          }, 30_000);
          req.on('close', () => {
            clearInterval(ping);
            sseClients.delete(res);
          });
        });
      },
    },
  ],
  server: {
    port: 5173,
    host: '127.0.0.1',
    // 端口被占用时直接报错，避免 fallback 到 5174 导致 localStorage origin 漂移、AI 配置看似丢失
    strictPort: true,
  },
});
