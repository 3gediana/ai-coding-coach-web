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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { memo } from 'react';
import { cn } from '../lib/cn';

interface Props {
  children: string;
  className?: string;
  /** 紧凑模式：行间距更小，用于题目摘要等狭窄区域 */
  compact?: boolean;
}

function MathMarkdownInner({ children, className, compact }: Props) {
  return (
    <div className={cn('md-body', compact && 'md-compact', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const MathMarkdown = memo(MathMarkdownInner);
