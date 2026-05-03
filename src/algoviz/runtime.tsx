/**
 * algoViz 运行时：把 LLM 生成的 .tsx 字符串变成可挂载的 React 组件。
 *
 * 选择：在主页面直接 babel-standalone 编译 + new Function 执行（不用 iframe）。
 *
 * 为什么不用 iframe sandbox：
 *   - Status 实时显示 + 频繁 props 更新 → iframe postMessage 通讯成本高
 *   - Animation 需要 @remotion/player 接管渲染 → 必须在同一 React 树
 *   - 用户体验为先（用户原话"相信大模型"），加 simple safety check + try/catch 兜底足够
 *
 * 安全策略：
 *   - 黑名单字符串扫描（fetch / eval / cookie / location 等）→ 命中拒绝执行
 *   - 编译失败 / 执行失败 → 返回 error 字符串，UI 友好显示，不挂主页面
 *   - 组件渲染挂掉 → 上层 ErrorBoundary 捕获
 */
import * as Babel from '@babel/standalone';
import * as React from 'react';
import * as RemotionShapes from '@remotion/shapes';

export interface CompileSuccess {
  Component: React.ComponentType<Record<string, unknown>>;
  error: null;
}
export interface CompileFailure {
  Component: null;
  error: string;
}
export type CompileResult = CompileSuccess | CompileFailure;

/**
 * 黑名单：检测明显有害 API。命中即拒绝。
 *
 * 不是绝对安全（绕过手段很多），但能挡住"不小心"和"无心之过"，配合 try/catch 已足够 MVP。
 */
const SECURITY_BLACKLIST: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bfetch\s*\(/, reason: 'fetch（网络请求）' },
  { pattern: /\bXMLHttpRequest\b/, reason: 'XMLHttpRequest' },
  { pattern: /\bnavigator\.\s*sendBeacon\b/, reason: 'sendBeacon' },
  { pattern: /\beval\s*\(/, reason: 'eval' },
  { pattern: /\bnew\s+Function\s*\(/, reason: 'new Function' },
  { pattern: /\bimport\s*\(/, reason: 'dynamic import' },
  { pattern: /\.cookie\b/, reason: 'cookie 访问' },
  { pattern: /\blocalStorage\b/, reason: 'localStorage' },
  { pattern: /\bsessionStorage\b/, reason: 'sessionStorage' },
  { pattern: /\bindexedDB\b/, reason: 'indexedDB' },
  { pattern: /\btop\s*\./, reason: 'top.* 访问' },
  { pattern: /\bparent\s*\./, reason: 'parent.* 访问' },
  { pattern: /\bwindow\.\s*open\b/, reason: 'window.open' },
  { pattern: /\blocation\.\s*(href|replace|assign)\b/, reason: 'location 跳转' },
  { pattern: /\bdocument\.\s*write\b/, reason: 'document.write' },
];

function safetyCheck(code: string): string | null {
  for (const { pattern, reason } of SECURITY_BLACKLIST) {
    if (pattern.test(code)) {
      return `安全检查未通过：代码中检测到 ${reason}`;
    }
  }
  return null;
}

/**
 * 编译 LLM 生成的组件源码并执行得到 React 组件。
 *
 * @param code     LLM 输出的 .tsx 源码（可含 TS 类型注解、JSX、export default）
 * @param globals  注入到代码作用域的全局对象，比如 { React, Remotion }
 *
 * 流程：
 *   1) 安全黑名单
 *   2) babel-standalone 编译 TSX/JSX → ES5 + commonjs 模块
 *   3) new Function 包成工厂；export default 通过 module.exports.default 取出
 */
export function compileLLMComponent(
  code: string,
  globals: Record<string, unknown> = {},
): CompileResult {
  if (!code?.trim()) {
    return { Component: null, error: '组件源码为空' };
  }
  const safetyError = safetyCheck(code);
  if (safetyError) {
    return { Component: null, error: safetyError };
  }
  let transformed: string;
  try {
    const result = Babel.transform(code, {
      presets: [
        ['react', { runtime: 'classic' }],
        'typescript',
      ],
      plugins: ['transform-modules-commonjs'],
      filename: 'llm-component.tsx',
    });
    transformed = result.code ?? '';
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { Component: null, error: `编译失败：${msg.slice(0, 240)}` };
  }
  if (!transformed) {
    return { Component: null, error: '编译产物为空' };
  }
  const moduleObj: { exports: { default?: unknown } } = { exports: {} };
  const requireShim = (name: string): unknown => {
    if (name === 'react') return globals.React ?? React;
    if (name === 'remotion' && globals.Remotion) return globals.Remotion;
    if (name === '@remotion/shapes') return globals.RemotionShapes ?? RemotionShapes;
    throw new Error(`不支持的 import: ${name}`);
  };
  // 全局注入：让 LLM 代码可以写 const { useCurrentFrame } = Remotion 拿到我们注入的全局
  const globalNames = [
    'module',
    'exports',
    'require',
    'React',
    ...Object.keys(globals).filter((k) => k !== 'React' && k !== 'require'),
  ];
  const globalValues = [
    /* module */ { exports: {} },
    /* exports */ {},
    /* require */ requireShim,
    /* React */ globals.React ?? React,
    ...globalNames.slice(4).map((k) => globals[k]),
  ];
  // 修正：let module + exports 共享
  globalValues[0] = moduleObj;
  globalValues[1] = moduleObj.exports;
  try {
    const factory = new Function(...globalNames, `${transformed}\n;return module.exports;`);
    factory(...globalValues);
    // babel 转 commonjs 后：export default X → module.exports.default = X
    // 兼容老式 module.exports = X：fallback 到 exports 本身
    const exp = moduleObj.exports as { default?: unknown } | unknown;
    const Component =
      typeof exp === 'function'
        ? exp
        : (exp as { default?: unknown })?.default ?? null;
    if (typeof Component !== 'function') {
      return {
        Component: null,
        error: '编译产物不是 React 组件函数（缺少 export default function）',
      };
    }
    return { Component: Component as React.ComponentType<Record<string, unknown>>, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { Component: null, error: `执行失败：${msg.slice(0, 240)}` };
  }
}

/**
 * 渲染 LLM 组件的 React 包装：内置 ErrorBoundary + 加载/错误状态展示。
 * 编译结果用 useMemo 缓存，code 变化才重编译。
 */
export interface LLMComponentRendererProps {
  /** LLM 输出的源码 */
  code: string;
  /** 注入的全局（Status 通常 { React }；Animation 需要 { React, Remotion }） */
  globals?: Record<string, unknown>;
  /** 传给组件的 props */
  componentProps?: Record<string, unknown>;
  /** 可选：编译失败/异常时的兜底渲染 */
  fallback?: (error: string) => React.ReactNode;
}

export function LLMComponentRenderer({
  code,
  globals,
  componentProps,
  fallback,
}: LLMComponentRendererProps): React.ReactElement {
  const compiled = React.useMemo(
    () => compileLLMComponent(code, globals ?? {}),
    [code, globals],
  );
  if (compiled.error || !compiled.Component) {
    const msg = compiled.error ?? '未知错误';
    return (
      <>
        {fallback ? (
          fallback(msg)
        ) : (
          <DefaultErrorView error={msg} />
        )}
      </>
    );
  }
  const Component = compiled.Component;
  return (
    <LLMErrorBoundary fallback={fallback}>
      <Component {...(componentProps ?? {})} />
    </LLMErrorBoundary>
  );
}

function DefaultErrorView({ error }: { error: string }): React.ReactElement {
  return (
    <div
      style={{
        padding: 12,
        border: '1px solid #b91c1c',
        background: '#7f1d1d20',
        borderRadius: 8,
        color: '#fca5a5',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>组件渲染失败</div>
      <div style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {error}
      </div>
    </div>
  );
}

interface ErrorBoundaryState {
  err: Error | null;
}

class LLMErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: (error: string) => React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { err: null };
  static getDerivedStateFromError(err: Error): ErrorBoundaryState {
    return { err };
  }
  componentDidCatch(err: Error): void {
    if (typeof console !== 'undefined') {
      console.warn('[algoViz LLMErrorBoundary]', err);
    }
  }
  render(): React.ReactNode {
    if (this.state.err) {
      const msg = `运行时异常：${this.state.err.message?.slice?.(0, 240) ?? String(this.state.err)}`;
      return this.props.fallback ? this.props.fallback(msg) : <DefaultErrorView error={msg} />;
    }
    return this.props.children;
  }
}
