/**
 * 代码执行运行时：浏览器内跑 Python（Pyodide）/ C++ 暂不支持本地运行。
 *
 * Pyodide 通过 CDN 懒加载（首次 ~6MB wasm + 10MB stdlib）。
 * 之后会缓存在浏览器，第二次秒级。
 */

import { safeGetItem, safeRemoveItem, safeSetItem } from './safeLocalStorage';

const PYODIDE_VERSION = '0.26.4';
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise: Promise<any> | null = null;
let pythonRunQueue: Promise<void> = Promise.resolve();

/**
 * 懒加载 Pyodide。
 * @param onProgress 加载进度回调（'loading-script' / 'loading-runtime' / 'ready'）
 */
export function loadPython(onProgress?: (stage: string) => void): Promise<any> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      onProgress?.('loading-script');
      // 注入 pyodide.js
      if (!(window as any).loadPyodide) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = `${PYODIDE_CDN}pyodide.js`;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('加载 pyodide.js 失败'));
          document.head.appendChild(s);
        });
      }
      onProgress?.('loading-runtime');
      const py = await (window as any).loadPyodide({ indexURL: PYODIDE_CDN });
      onProgress?.('ready');
      return py;
    })().catch((e) => {
      pyodidePromise = null;
      throw e;
    });
  }
  return pyodidePromise;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number;
}

interface PythonRunOptions {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  timeoutMs?: number;
  onProgress?: (stage: string) => void;
}

/**
 * 执行 Python 代码，返回 stdout/stderr。
 * stdin 如果给了，就预先 push 到 sys.stdin。
 */
export async function runPython(
  code: string,
  stdin: string,
  opts?: PythonRunOptions,
): Promise<RunResult> {
  const previous = pythonRunQueue;
  let release!: () => void;
  pythonRunQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await runPythonExclusive(code, stdin, opts);
  } finally {
    release();
  }
}

async function runPythonExclusive(
  code: string,
  stdin: string,
  opts?: PythonRunOptions,
): Promise<RunResult> {
  const t0 = performance.now();
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    const msg = '当前环境不支持 Web Worker，无法安全运行 Python';
    opts?.onStderr?.(msg + '\n');
    return { stdout: '', stderr: msg, durationMs: performance.now() - t0, exitCode: 1 };
  }
  let outBuf = '';
  let errBuf = '';
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const worker = createPythonWorker();
  let settled = false;
  return await new Promise<RunResult>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const armTimeout = (ms: number, text: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        errBuf += text + '\n';
        opts?.onStderr?.(text + '\n');
        finish({ stdout: outBuf, stderr: errBuf, durationMs: performance.now() - t0, exitCode: 1 });
      }, ms);
    };
    armTimeout(Math.max(timeoutMs, 60_000), 'Python 运行时加载超时');
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as
        | { type: 'progress'; stage: string }
        | { type: 'stdout'; chunk: string }
        | { type: 'stderr'; chunk: string }
        | { type: 'done'; stdout: string; stderr: string; exitCode: number }
        | { type: 'error'; message: string };
      if (msg.type === 'progress') {
        opts?.onProgress?.(msg.stage);
        if (msg.stage === 'ready') armTimeout(timeoutMs, `Python 执行超时（${timeoutMs}ms）`);
        return;
      }
      if (msg.type === 'stdout') {
        outBuf += msg.chunk;
        opts?.onStdout?.(msg.chunk);
        return;
      }
      if (msg.type === 'stderr') {
        errBuf += msg.chunk;
        opts?.onStderr?.(msg.chunk);
        return;
      }
      if (msg.type === 'done') {
        finish({
          stdout: msg.stdout,
          stderr: msg.stderr,
          durationMs: performance.now() - t0,
          exitCode: msg.exitCode,
        });
        return;
      }
      errBuf += msg.message + '\n';
      opts?.onStderr?.(msg.message + '\n');
      finish({ stdout: outBuf, stderr: errBuf, durationMs: performance.now() - t0, exitCode: 1 });
    };
    worker.onerror = (event) => {
      const msg = event.message || 'Python Worker 执行失败';
      errBuf += msg + '\n';
      opts?.onStderr?.(msg + '\n');
      finish({ stdout: outBuf, stderr: errBuf, durationMs: performance.now() - t0, exitCode: 1 });
    };
    worker.postMessage({ code, stdin, indexURL: PYODIDE_CDN });
  });
}

function createPythonWorker(): Worker {
  const source = `
let pyodidePromise = null;
self.onmessage = async (event) => {
  const { code, stdin, indexURL } = event.data;
  let outBuf = '';
  let errBuf = '';
  try {
    self.postMessage({ type: 'progress', stage: 'loading-script' });
    if (!self.loadPyodide) {
      self.importScripts(indexURL + 'pyodide.js');
    }
    self.postMessage({ type: 'progress', stage: 'loading-runtime' });
    if (!pyodidePromise) {
      pyodidePromise = self.loadPyodide({ indexURL });
    }
    const py = await pyodidePromise;
    self.postMessage({ type: 'progress', stage: 'ready' });
    py.setStdout({
      batched: (s) => {
        const chunk = s + '\\n';
        outBuf += chunk;
        self.postMessage({ type: 'stdout', chunk });
      },
    });
    py.setStderr({
      batched: (s) => {
        const chunk = s + '\\n';
        errBuf += chunk;
        self.postMessage({ type: 'stderr', chunk });
      },
    });
    let stdinIdx = 0;
    const stdinLines = String(stdin || '').split('\\n');
    py.setStdin({
      stdin: () => {
        if (stdinIdx >= stdinLines.length) return null;
        return stdinLines[stdinIdx++];
      },
    });
    let exitCode = 0;
    try {
      await py.runPythonAsync(code);
    } catch (e) {
      exitCode = 1;
      const text = String((e && e.message) || e);
      errBuf += text + '\\n';
      self.postMessage({ type: 'stderr', chunk: text + '\\n' });
    }
    self.postMessage({ type: 'done', stdout: outBuf, stderr: errBuf, exitCode });
  } catch (e) {
    self.postMessage({ type: 'error', message: String((e && e.message) || e) });
  }
};
`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker;
}

/**
 * C++/C 远程编译执行：用 Wandbox 公开 API（真 g++，全 STL 支持）。
 *
 * 失败时降级到 JSCPP（纯 JS 解释器，C++ 子集）。
 *
 * 用户可在设置里切换 endpoint（私有 sandbox），或完全禁用。
 */

const DEFAULT_CPP_ENDPOINT = 'https://wandbox.org/api/compile.json';

function resolveCppEndpoint(): string {
  return safeGetItem('aicc.cppEndpoint.v1') || DEFAULT_CPP_ENDPOINT;
}

interface WandboxResponse {
  status?: string;
  signal?: string;
  compiler_output?: string;
  compiler_error?: string;
  program_output?: string;
  program_error?: string;
  program_message?: string;
}

export async function runCpp(
  code: string,
  stdin: string,
  opts?: {
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
    timeoutMs?: number;
    language?: 'cpp' | 'c';
    onProgress?: (stage: string) => void;
  },
): Promise<RunResult> {
  const t0 = performance.now();
  const lang = opts?.language ?? 'cpp';
  const compiler = lang === 'c' ? 'gcc-head-c' : 'gcc-head';
  const compileOptions = lang === 'c' ? 'warning,gnu11' : 'warning,gnu++17';

  const ctrl = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  opts?.onProgress?.('compiling');

  try {
    const resp = await fetch(resolveCppEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        stdin,
        compiler,
        options: compileOptions,
        save: false,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      throw new Error(`远程编译服务返回 ${resp.status}`);
    }
    const j = (await resp.json()) as WandboxResponse;

    // 编译错误优先显示
    const compilerErr = (j.compiler_error ?? '').trim();
    const programOut = j.program_output ?? '';
    const programErr = j.program_error ?? '';
    const programMsg = (j.program_message ?? '').trim();
    const signalMsg = (j.signal ?? '').trim();
    const runtimeMeta = [
      signalMsg ? `Signal: ${signalMsg}` : '',
      programMsg,
    ].filter(Boolean).join('\n');
    const parsedStatus = j.status ? parseInt(j.status, 10) : 0;
    const exitCode = compilerErr ? 1 : signalMsg ? 1 : isNaN(parsedStatus) ? 0 : parsedStatus;
    const stderr = [
      compilerErr ? '=== 编译错误 ===\n' + compilerErr : '',
      programErr,
      runtimeMeta,
    ].filter(Boolean).join('\n');

    if (compilerErr) {
      opts?.onStderr?.('=== 编译错误 ===\n' + compilerErr + '\n');
    }
    if (programOut) opts?.onStdout?.(programOut);
    if (programErr) opts?.onStderr?.(programErr);
    if (runtimeMeta) opts?.onStderr?.(runtimeMeta + '\n');

    return {
      stdout: programOut,
      stderr,
      durationMs: performance.now() - t0,
      exitCode,
    };
  } catch (e: any) {
    clearTimeout(timer);
    const msg = e?.name === 'AbortError'
      ? `执行超时（${timeoutMs}ms）`
      : `远程编译失败：${e?.message ?? e}`;
    opts?.onStderr?.(msg + '\n');
    opts?.onStderr?.(
      '\n提示：远程服务可能被网络拦截。可在设置里切换其它 endpoint，' +
        '或本地装 g++ 自行编译。\n',
    );
    return {
      stdout: '',
      stderr: msg,
      durationMs: performance.now() - t0,
      exitCode: 1,
    };
  }
}

export function isRuntimeSupported(language: string): boolean {
  return language === 'python' || language === 'cpp' || language === 'c';
}

export function getCppEndpoint(): string {
  return resolveCppEndpoint();
}

export function setCppEndpoint(url: string) {
  if (url.trim()) {
    safeSetItem('aicc.cppEndpoint.v1', url.trim());
  } else {
    safeRemoveItem('aicc.cppEndpoint.v1');
  }
}
