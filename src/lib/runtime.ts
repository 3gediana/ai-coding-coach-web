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

/**
 * 执行 Python 代码，返回 stdout/stderr。
 * stdin 如果给了，就预先 push 到 sys.stdin。
 */
export async function runPython(
  code: string,
  stdin: string,
  opts?: {
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
    timeoutMs?: number;
    onProgress?: (stage: string) => void;
  },
): Promise<RunResult> {
  const t0 = performance.now();
  const py = await loadPython(opts?.onProgress);

  // 配置 stdin/stdout/stderr 钩子
  let outBuf = '';
  let errBuf = '';
  py.setStdout({
    batched: (s: string) => {
      outBuf += s + '\n';
      opts?.onStdout?.(s + '\n');
    },
  });
  py.setStderr({
    batched: (s: string) => {
      errBuf += s + '\n';
      opts?.onStderr?.(s + '\n');
    },
  });

  // stdin：把整段输入按行喂
  let stdinIdx = 0;
  const stdinLines = stdin.split('\n');
  py.setStdin({
    stdin: () => {
      if (stdinIdx >= stdinLines.length) return null; // EOF
      return stdinLines[stdinIdx++];
    },
  });

  let exitCode = 0;
  try {
    const timeoutMs = opts?.timeoutMs ?? 10_000;
    await Promise.race([
      py.runPythonAsync(code),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Python 执行超时（${timeoutMs}ms）`)), timeoutMs),
      ),
    ]);
  } catch (e: any) {
    exitCode = 1;
    const msg = String(e?.message ?? e);
    errBuf += msg + '\n';
    opts?.onStderr?.(msg + '\n');
  }

  return {
    stdout: outBuf,
    stderr: errBuf,
    durationMs: performance.now() - t0,
    exitCode,
  };
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
