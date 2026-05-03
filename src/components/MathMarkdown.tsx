/**
 * MathMarkdown：渲染含 LaTeX 公式的 Markdown 文本。
 *
 * 用法：
 *   <MathMarkdown>{problem.statement}</MathMarkdown>
 *
 * 支持：
 *   - 行内公式：$n \le 10^5$
 *   - 块公式：$$\sum_{i=1}^{n} a_i$$
 *   - GFM 语法（表格 / 删除线 / 任务列表）
 *
 * 题目源里常见的写法（非 LaTeX）会自动被规整：
 *   - 1 \le n \le 10^5  → 1 ≤ n ≤ 10⁵
 *   - n*m 之类不被识别为公式（需要 $...$ 才触发）
 */
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { memo, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * 代码块上的可选动作（仅"块代码"显示，行内代码不带按钮）。
 * QAPanel 等"AI 回答场景"会传进来；题面 / 错题 / hint 等只读场景不传，保持原 UI。
 */
export interface CodeBlockActions {
  /** 自定义"复制"行为；不传则用 navigator.clipboard.writeText 默认实现 */
  onCopy?: (code: string, lang: string | undefined) => void;
  /** 替换当前激活文件内容（无 active file 时调用方应传 undefined 隐藏按钮） */
  onApplyToCurrent?: (code: string, lang: string | undefined) => void;
  /** 用代码内容新建文件 */
  onCreateNew?: (code: string, lang: string | undefined) => void;
}

interface Props {
  children: string;
  className?: string;
  /** 紧凑模式：行间距更小，用于题目摘要等狭窄区域 */
  compact?: boolean;
  /** AI 回答场景可选传入，给块代码加复制 / 替换 / 新建 按钮 */
  codeActions?: CodeBlockActions;
}

/** 把 children 递归提取为字符串：用于 code/pre 节点的源码取值 */
function flattenChildren(children: ReactNode): string {
  if (children == null || children === false) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(flattenChildren).join('');
  if (typeof children === 'object' && 'props' in (children as any)) {
    return flattenChildren((children as any).props?.children);
  }
  return '';
}

/** 从 className 中抽 language-xxx 的 xxx；没匹配返回 undefined */
function extractLang(className: string | undefined): string | undefined {
  return /language-([\w+-]+)/.exec(className ?? '')?.[1];
}

function buildComponents(actions: CodeBlockActions | undefined): Components | undefined {
  if (!actions) return undefined;
  return {
    pre({ children, ...props }) {
      // ReactMarkdown 把块代码渲染成 <pre><code class="language-xxx">…</code></pre>
      // 这里在 <pre> 外层包一个 relative div，把按钮固定在右上角；不动 <pre>/<code> 本体。
      const childArray = Array.isArray(children) ? children : [children];
      const codeNode = childArray.find(
        (c): c is { props: { className?: string; children?: ReactNode } } =>
          !!c && typeof c === 'object' && 'props' in (c as any),
      );
      const lang = extractLang(codeNode?.props?.className);
      const codeText = flattenChildren(codeNode?.props?.children).replace(/\n$/, '');
      return (
        <div className="relative group/codeblock">
          <pre {...props}>{children}</pre>
          {codeText && (
            <div
              className="absolute right-1.5 top-1.5 flex items-center gap-1 opacity-0 group-hover/codeblock:opacity-100 transition pointer-events-auto"
              data-aicc-codeblock-actions
            >
              <button
                type="button"
                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elev2 border border-line hover:bg-bg-elev hover:text-accent"
                onClick={() => {
                  if (actions.onCopy) actions.onCopy(codeText, lang);
                  else void navigator.clipboard?.writeText(codeText);
                }}
                title="复制代码"
              >
                复制
              </button>
              {actions.onApplyToCurrent && (
                <button
                  type="button"
                  className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elev2 border border-line hover:bg-bg-elev hover:text-accent"
                  onClick={() => actions.onApplyToCurrent?.(codeText, lang)}
                  title="替换当前文件内容（不可撤销，需要谨慎）"
                >
                  替换当前
                </button>
              )}
              {actions.onCreateNew && (
                <button
                  type="button"
                  className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elev2 border border-line hover:bg-bg-elev hover:text-accent"
                  onClick={() => actions.onCreateNew?.(codeText, lang)}
                  title="把这段代码作为新文件建到当前题目"
                >
                  新建文件
                </button>
              )}
            </div>
          )}
        </div>
      );
    },
  };
}

function MathMarkdownInner({ children, className, compact, codeActions }: Props) {
  const components = buildComponents(codeActions);
  return (
    <div className={cn('md-body', compact && 'md-compact', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const MathMarkdown = memo(MathMarkdownInner);
