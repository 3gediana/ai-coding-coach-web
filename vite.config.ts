import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';

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
 */
async function ensureOllamaRunning(): Promise<boolean> {
  if (await probePort('127.0.0.1', 11434, 300)) return true;
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
  ],
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
});
