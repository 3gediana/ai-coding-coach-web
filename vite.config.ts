import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import { writeFile, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, extname, resolve as pathResolve } from 'node:path';
import type { Connect } from 'vite';

const devArtifactPath = (...parts: string[]) => resolve(process.cwd(), 'dev-workspace', 'artifacts', ...parts);
const localProblemBankPath = (...parts: string[]) => resolve(process.cwd(), 'dev-workspace', 'problem-bank', ...parts);
const localFeedbackPath = (...parts: string[]) => resolve(process.cwd(), 'dev-workspace', 'feedback', ...parts);

type ProblemBankItem = {
  id: string;
  title: string;
  statement: string;
  source?: string;
  createdAt: number;
  [key: string]: unknown;
};

type ProblemBankBundle = {
  kind?: string;
  version?: number;
  savedAt?: number;
  problem: ProblemBankItem;
  [key: string]: unknown;
};

function safePathPart(value: unknown): string {
  return String(value ?? 'unknown')
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'unknown';
}

function localDatePart(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function classifyProblemBankItem(problem: ProblemBankItem): string[] {
  const source = typeof problem.source === 'string' ? problem.source : '';
  if (!source) return ['manual'];
  try {
    const u = new URL(source);
    const host = u.hostname.toLowerCase();
    if (host.includes('luogu.com.cn')) return ['oj', 'luogu'];
    if (host === 'atcoder.jp') return ['oj', 'atcoder'];
    if (host === 'poj.org') return ['oj', 'poj'];
    if (host === 'acm.hdu.edu.cn') return ['oj', 'hdu'];
    return ['oj', safePathPart(host)];
  } catch {
    return ['manual'];
  }
}

function isProblemBankItem(value: unknown): value is ProblemBankItem {
  const v = value as Partial<ProblemBankItem>;
  return !!v && typeof v.id === 'string' && typeof v.title === 'string' && typeof v.statement === 'string';
}

function normalizeProblemBankBundle(value: unknown): ProblemBankBundle | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { problem?: unknown };
  if (isProblemBankItem(v.problem)) {
    return value as ProblemBankBundle;
  }
  if (isProblemBankItem(value)) {
    return {
      kind: 'aicc.problem.bundle',
      version: 1,
      savedAt: Date.now(),
      problem: value,
    };
  }
  return null;
}

async function readJsonRequest<T>(req: any): Promise<T> {
  return new Promise((resolve, reject) => {
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
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const p = pathResolve(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await listJsonFiles(p));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(p);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function removeProblemBankFilesById(id: string): Promise<void> {
  const root = localProblemBankPath('problems');
  const prefix = `${safePathPart(id)}__`;
  const files = await listJsonFiles(root);
  await Promise.all(
    files
      .filter((f) => f.split(/[\\/]/).pop()?.startsWith(prefix))
      .map((f) => unlink(f).catch(() => undefined)),
  );
}

async function readLocalProblemBank(): Promise<ProblemBankBundle[]> {
  const root = localProblemBankPath('problems');
  const files = await listJsonFiles(root);
  const bundles: ProblemBankBundle[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      const bundle = normalizeProblemBankBundle(parsed);
      if (bundle) {
        bundles.push({
          ...bundle,
          problem: {
            ...bundle.problem,
            createdAt: typeof bundle.problem.createdAt === 'number' ? bundle.problem.createdAt : Date.now(),
          },
        });
      }
    } catch {
      /* ignore broken problem file */
    }
  }
  bundles.sort((a, b) => b.problem.createdAt - a.problem.createdAt);
  return bundles;
}

async function writeLocalProblemBankBundle(bundle: ProblemBankBundle): Promise<string> {
  const problem = bundle.problem;
  const existing = (await readLocalProblemBank()).find((item) => item.problem.id === problem.id);
  const state = bundle.state && typeof bundle.state === 'object'
    ? bundle.state
    : existing?.state;
  const merged: ProblemBankBundle = {
    ...existing,
    ...bundle,
    problem: {
      ...(existing?.problem ?? {}),
      ...bundle.problem,
    },
    state,
    savedAt: bundle.savedAt ?? Date.now(),
  };
  const parts = classifyProblemBankItem(problem);
  const target = localProblemBankPath('problems', ...parts, `${safePathPart(problem.id)}__${safePathPart(problem.title)}.json`);
  await removeProblemBankFilesById(problem.id);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return target;
}

function installLocalProblemBankMiddleware(middlewares: Connect.Server) {
  middlewares.use('/__problem-bank/problems', async (req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (req.method === 'GET') {
      const bundles = await readLocalProblemBank();
      const problems = bundles.map((b) => b.problem);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, root: localProblemBankPath('problems'), bundles, problems }));
      return;
    }
    if (req.method === 'POST') {
      try {
        const payload = await readJsonRequest<{ bundle?: unknown; problem?: unknown }>(req);
        const bundle = normalizeProblemBankBundle(payload.bundle ?? payload.problem);
        if (!bundle) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'invalid problem bundle' }));
          return;
        }
        const path = await writeLocalProblemBankBundle({
          ...bundle,
          kind: 'aicc.problem.bundle',
          version: 1,
          savedAt: Date.now(),
        });
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, path }));
      } catch (err: any) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
      }
      return;
    }
    if (req.method === 'DELETE') {
      const url = new URL(req.url || '', 'http://127.0.0.1');
      const id = url.searchParams.get('id');
      if (!id) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'missing id' }));
        return;
      }
      await removeProblemBankFilesById(id);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
  });
}

async function writeLocalFeedback(payload: Record<string, unknown>): Promise<string> {
  const now = Date.now();
  const createdAt = typeof payload.createdAt === 'number' ? payload.createdAt : now;
  const category = safePathPart(payload.category ?? 'feedback');
  const title = safePathPart(payload.summary ?? payload.content ?? 'feedback').slice(0, 48);
  const target = localFeedbackPath(localDatePart(createdAt), `${createdAt}__${category}__${title}.json`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    `${JSON.stringify({ ...payload, createdAt, savedAt: now }, null, 2)}\n`,
    'utf8',
  );
  return target;
}

function installFeedbackMiddleware(middlewares: Connect.Server) {
  middlewares.use('/__aicc-feedback', async (req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
      return;
    }
    try {
      const payload = await readJsonRequest<Record<string, unknown>>(req);
      const content = typeof payload.content === 'string' ? payload.content.trim() : '';
      if (content.length < 2) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'feedback content is empty' }));
        return;
      }
      const path = await writeLocalFeedback({ ...payload, content });
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, path }));
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    }
  });
}

/**
 * Dev 时通过自定义中间件转发到真实 AI endpoint，绕开 CORS。
 *
 * 客户端调用：fetch('/ai-proxy/' + encodeURIComponent('https://.../v1/chat/completions'), ...)
 */

// ============== Ollama 自动起服务 ==============

let managedOllama: ChildProcess | null = null;
let ensuringPromise: Promise<boolean> | null = null;
let warmupPromise: Promise<Array<{ label: string; model: string; ok: boolean; latencyMs: number; error?: string }>> | null = null;
let lastWarmupAt = 0;
let serverOllamaMode: 'enabled' | 'disabled' =
  process.env.AICC_OLLAMA === '0' ? 'disabled' : 'enabled';
const ollamaAutostartEnv = process.env.AICC_OLLAMA_AUTOSTART?.toLowerCase();
const serverOllamaAutostart =
  ollamaAutostartEnv !== '0' && ollamaAutostartEnv !== 'false';
let loggedExternalOllama = false;

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
    if (await probeOllamaServe(1500)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function probeOllamaServe(timeoutMs = 1500): Promise<boolean> {
  if (!(await probePort('127.0.0.1', 11434, Math.min(timeoutMs, 500)))) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch('http://127.0.0.1:11434/api/version', { signal: ctrl.signal });
    clearTimeout(timer);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * 探测 11434 端口；若不通则 spawn `ollama serve`，并轮询到就绪。
 * 重复并发调用复用同一个 promise。
 *
 * 当网页端 Ollama 模式为 enabled 时自动 spawn；disabled 时不触碰本地服务。
 */
async function ensureOllamaRunning(): Promise<boolean> {
  if (await probeOllamaServe(1200)) {
    if (!loggedExternalOllama && !managedOllama) {
      console.log('\x1b[32m[aicc-ollama]\x1b[0m 检测到后台已有 ollama serve，直接复用');
      loggedExternalOllama = true;
    }
    return true;
  }
  if (serverOllamaMode === 'disabled' || !serverOllamaAutostart) {
    return false;
  }
  if (ensuringPromise) return ensuringPromise;
  ensuringPromise = (async () => {
    if (await probeOllamaServe(1200)) return true;
    if (await probePort('127.0.0.1', 11434, 300)) {
      const ready = await waitOllamaReady(5_000);
      if (ready) return true;
      console.warn('\x1b[31m[aicc-ollama]\x1b[0m 端口 11434 已被占用，但不是可用的 Ollama API，跳过自动启动');
      ensuringPromise = null;
      return false;
    }
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
    else {
      console.warn('\x1b[31m[aicc-ollama]\x1b[0m ⚠ 20s 内 ollama 未就绪，跳过');
      ensuringPromise = null;
    }
    // ensuringPromise 保持已 resolve，下次直接复用结果（避免重复 spawn）
    return ready;
  })();
  return ensuringPromise;
}

function ensureOllamaOnServerStart(): void {
  if (serverOllamaMode === 'disabled' || !serverOllamaAutostart) return;
  void ensureOllamaRunning();
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

async function unloadOllamaTargets(targets: Array<{ baseUrl?: string; model?: string }>) {
  const seen = new Set<string>();
  for (const t of targets) {
    const model = t.model?.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    try {
      await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
        signal: AbortSignal.timeout(8000),
      });
      console.log(`\x1b[33m[aicc-ollama]\x1b[0m unloaded ${model}`);
    } catch (err: any) {
      console.warn(`\x1b[31m[aicc-ollama]\x1b[0m unload ${model} 失败: ${err?.message || err}`);
    }
  }
}

async function warmupOllamaTargets(targets: Array<{ baseUrl?: string; model?: string; label?: string }>) {
  const unique = targets
    .filter((t) => t.baseUrl?.trim() && t.model?.trim())
    .filter((t, i, arr) => arr.findIndex((x) => x.baseUrl?.trim() === t.baseUrl?.trim() && x.model?.trim() === t.model?.trim()) === i);
  if (unique.length === 0) return [];
  if (unique.length > 1) {
    return unique.map((t) => ({
      label: t.label ?? 'ollama',
      model: t.model!,
      ok: false,
      latencyMs: 0,
      error: '本地 Ollama 只允许同时预热一种模型',
    }));
  }
  if (warmupPromise) return warmupPromise;
  if (Date.now() - lastWarmupAt < 60_000) {
    return unique.map((t) => ({
      label: t.label ?? 'ollama',
      model: t.model!,
      ok: true,
      latencyMs: 0,
    }));
  }
  warmupPromise = (async () => {
    const target = unique[0];
    const model = target.model!.trim();
    const startedAt = Date.now();
    try {
      if (!(await probePort('127.0.0.1', 11434, 300))) {
        const ok = await ensureOllamaRunning();
        if (!ok) {
          return [{
            label: target.label ?? 'ollama',
            model,
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: serverOllamaMode === 'disabled'
              ? 'ollama 模式已关闭'
              : 'ollama 未就绪；已尝试自动启动，请确认本机已安装 Ollama 且 11434 未被其它程序占用',
          }];
        }
      }
      const upstream = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi /no_think' }],
          stream: false,
          keep_alive: '24h',
          options: { num_predict: 1, temperature: 0 },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const text = upstream.ok ? '' : await upstream.text().catch(() => '');
      lastWarmupAt = Date.now();
      return [{
        label: target.label ?? 'ollama',
        model,
        ok: upstream.ok,
        latencyMs: Date.now() - startedAt,
        error: upstream.ok ? undefined : `HTTP ${upstream.status}: ${text.slice(0, 160)}`,
      }];
    } catch (err: any) {
      return [{
        label: target.label ?? 'ollama',
        model,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: String(err?.message || err).slice(0, 160),
      }];
    } finally {
      warmupPromise = null;
    }
  })();
  return warmupPromise;
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

function installAiProxyMiddleware(middlewares: Connect.Server) {
  middlewares.use('/ai-proxy', async (req, res) => {
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

    if (isLocalOllamaTarget(target)) {
      const ok = await ensureOllamaRunning();
      if (!ok) {
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          error: serverOllamaMode === 'disabled'
            ? 'ollama 模式已关闭'
            : 'ollama 未就绪：平台已尝试自动启动 `ollama serve`，请确认本机已安装 Ollama，且 11434 端口未被其它程序占用',
        }));
        return;
      }
    }

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
          if (k === 'content-encoding' || k === 'content-length' || k === 'transfer-encoding') return;
          res.setHeader(k, v);
        });
        if (!upstream.body) {
          res.end();
          return;
        }
        const reader = upstream.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
        } finally {
          res.end();
        }
      } catch (e: any) {
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: String(e?.message || e) }));
      }
    });
  });
}

const ollamaAutostartPlugin: Plugin = {
  name: 'aicc-ollama-autostart',
  configureServer(server) {
    ensureOllamaOnServerStart();
    server.httpServer?.on('close', killManagedOllama);
  },
  configurePreviewServer(server) {
    ensureOllamaOnServerStart();
    server.httpServer?.on('close', killManagedOllama);
  },
};

export default defineConfig({
  // 让 .env.local 里 AI_COACH_* / DEEPSEEK_* 也能在前端访问（保持与已有变量命名一致）
  envPrefix: ['VITE_', 'AI_COACH_', 'DEEPSEEK_'],
  plugins: [
    react(),
    ollamaAutostartPlugin,
    {
      name: 'aicc-ai-proxy',
      configureServer(server) {
        installAiProxyMiddleware(server.middlewares);
        installLocalProblemBankMiddleware(server.middlewares);
        installFeedbackMiddleware(server.middlewares);
      },
      configurePreviewServer(server) {
        installAiProxyMiddleware(server.middlewares);
        installLocalProblemBankMiddleware(server.middlewares);
        installFeedbackMiddleware(server.middlewares);
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
      // ========== Tampermonkey 题目导入接收端 + Node 端 qwen3.5 处理 ==========
      // 流程：
      //   1. TM POST /__import → 落盘 dev-workspace/artifacts/logs/imports/<ts>.raw.json
      //   2. 立即响应 200（TM 早返回，不等处理）
      //   3. 异步调 importProcessor.processImportFile（Node 端调 ollama qwen3.5）
      //   4. 处理完写 dev-workspace/artifacts/logs/imports/<ts>.processed.json
      //   5. SSE 推 processed payload 给前端 → 前端入库（不再调 AI）
      //
      // 这样：
      //   - 处理逻辑在 Node 端，稳定可观测（log + 落盘文件可重放）
      //   - 浏览器没刷新也能调试（看 .processed.json 文件即可）
      //   - qwen3.5 keep_alive=0 由 Node 端 finally 块统一管理
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
          status: 'filled' | 'done' | 'failed' | 'timeout';
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
            if (u.hostname === '10.11.219.21') return `${u.origin}${u.pathname}${u.hash.replace(/#problem-[^#/?&]+$/, '')}`;
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

        const safeFilePart = (value: unknown): string =>
          String(value ?? 'unknown')
            .replace(/^https?:\/\//, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 80) || 'unknown';

        server.middlewares.use('/__probe-snapshot', async (req, res) => {
          setCors(res, 'POST, OPTIONS');
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
          try {
            const payload = await readJsonBody<Record<string, unknown>>(req);
            const dir = devArtifactPath('logs', 'dom-snapshots');
            mkdirSync(dir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const site = safeFilePart(payload.domain ?? payload.url ?? 'page');
            const baseName = `${stamp}_${site}`;
            const jsonPath = pathResolve(dir, `${baseName}.json`);
            writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
            let htmlPath: string | null = null;
            if (typeof payload.fullHtml === 'string' && payload.fullHtml.trim()) {
              htmlPath = pathResolve(dir, `${baseName}.html`);
              writeFileSync(htmlPath, payload.fullHtml, 'utf8');
            }
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, jsonPath, htmlPath }));
            console.log(`\x1b[36m[aicc-probe]\x1b[0m snapshot saved ${jsonPath}`);
          } catch (err: any) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: String(err?.message || err) }));
          }
        });

        server.middlewares.use('/__oj-debug-log', async (req, res) => {
          setCors(res, 'POST, OPTIONS');
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
          try {
            const payload = await readJsonBody<Record<string, unknown>>(req);
            const dir = devArtifactPath('logs', 'oj-debug');
            mkdirSync(dir, { recursive: true });
            const date = new Date().toISOString().slice(0, 10);
            const logPath = pathResolve(dir, `${date}.jsonl`);
            appendFileSync(logPath, JSON.stringify({ ts: Date.now(), ...payload }) + '\n', 'utf8');
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, logPath }));
            console.log(`\x1b[35m[aicc-oj-debug]\x1b[0m ${String(payload.event ?? 'event')} ${String(payload.commandId ?? '')}`);
          } catch (err: any) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: String(err?.message || err) }));
          }
        });

        server.middlewares.use('/__aicc-ollama-mode', async (req, res) => {
          setCors(res, 'GET, POST, OPTIONS');
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (req.method === 'GET') {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ mode: serverOllamaMode }));
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'method not allowed' }));
            return;
          }
          try {
            const payload = await readJsonBody<{ mode?: 'enabled' | 'disabled' }>(req);
            serverOllamaMode = payload.mode === 'disabled' ? 'disabled' : 'enabled';
            process.env.AICC_OLLAMA = serverOllamaMode === 'disabled' ? '0' : '1';
            if (serverOllamaMode === 'enabled') {
              void ensureOllamaRunning();
            }
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, mode: serverOllamaMode }));
          } catch (e: any) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: String(e?.message || e) }));
          }
        });

        server.middlewares.use('/__aicc-ollama-unload', async (req, res) => {
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
            const payload = await readJsonBody<{ targets?: Array<{ baseUrl?: string; model?: string }> }>(req);
            const targets = Array.isArray(payload.targets) ? payload.targets : [];
            await unloadOllamaTargets(targets);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, count: targets.length }));
          } catch (e: any) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: String(e?.message || e) }));
          }
        });

        server.middlewares.use('/__aicc-ollama-warmup', async (req, res) => {
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
            const payload = await readJsonBody<{ targets?: Array<{ baseUrl?: string; model?: string; label?: string }> }>(req);
            const targets = Array.isArray(payload.targets) ? payload.targets : [];
            const results = await warmupOllamaTargets(targets);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, results }));
          } catch (e: any) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: String(e?.message || e) }));
          }
        });

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
                const dir = devArtifactPath('logs', 'imports');
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

              // 2. 立即响应 200，让 TM 早返回（不等 qwen3.5 处理）
              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: true, rawPath: rawPath?.split(/[\\\/]/).pop() }));

              // 3. 异步：Node 端处理（qwen3.5 识图 + 卸载）→ SSE 推 processed payload
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
    port: 3333,
    host: '127.0.0.1',
    allowedHosts: ['1y2ae99xyr7b.vip3.xiaomiqiu123.top'],
    // 端口被占用时直接报错，避免 fallback 到其它端口导致 localStorage origin 漂移、AI 配置看似丢失
    strictPort: true,
  },
});
