/**
 * 学生即时提问面板 — 结合当前题目 + 代码做上下文，流式 AI 回答。
 *
 * 嵌入 FeedbackPanel 顶部，永久显示。每个题目（或 draft scope）独立保存对话历史。
 *
 * UX：
 *   - 输入框默认 1 行，按 Enter 发送，Shift+Enter 换行
 *   - 流式 token 实时渲染（带闪烁光标）
 *   - 顶部右侧"清空"按钮
 *   - 折叠时只显示输入框，展开时显示历史 + 输入
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Trash2, User, Sparkles, Send, AlertTriangle, MessageCircle } from 'lucide-react';
import { useStore } from '../lib/store';
import { MathMarkdown } from './MathMarkdown';
import { cn } from '../lib/cn';

const DRAFT_SCOPE = '__draft__';

export function QAPanel() {
  const activeProblemId = useStore((s) => s.activeProblemId);
  const qaByProblem = useStore((s) => s.qaByProblem);
  const askQuestion = useStore((s) => s.askQuestion);
  const clearQA = useStore((s) => s.clearQA);
  const pending = useStore((s) => s.qaPendingProblemId);
  const aiOk = useStore((s) => !!s.aiConfig.apiKey);

  const scope = activeProblemId ?? DRAFT_SCOPE;
  const messages = qaByProblem[scope] ?? [];
  const isPending = pending === scope;

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 有新消息时自动滚到底
  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, [messages.length, messages[messages.length - 1]?.content]);

  // textarea 自适应高度（最多 5 行）
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, [input]);

  const onSubmit = () => {
    const q = input.trim();
    if (!q || isPending) return;
    askQuestion(q);
    setInput('');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 对话历史：填满可滚动区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-ink-mute gap-2 py-12">
            <div className="w-12 h-12 rounded-full bg-cyan/10 border border-cyan/30 flex items-center justify-center">
              <MessageCircle size={20} className="text-cyan" />
            </div>
            <div className="text-sm font-medium text-ink-dim">问点什么</div>
            <div className="text-[11px] max-w-[280px] leading-relaxed">
              {activeProblemId
                ? '可以问这题的思路、卷面中的知识点、代码为什么 WA… AI 会结合题面 + 当前代码回答'
                : '没激活题目也能问一般性问题：什么是 KMP？什么是单调队列？'}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              role={m.role}
              content={m.content}
              streaming={m.streaming}
              error={m.error}
            />
          ))
        )}
      </div>

      {/* 对话顶部插菜单（仅有历史时显示） */}
      {messages.length > 0 && (
        <div className="px-3 py-1 border-t border-line/40 flex items-center justify-between text-[10px] text-ink-mute">
          <span>
            {messages.filter((m) => m.role === 'user').length} 问
            {isPending && (
              <span className="ml-2 inline-flex items-center gap-1 text-accent">
                <Loader2 size={10} className="animate-spin" /> AI 思考中
              </span>
            )}
          </span>
          <button
            onClick={() => {
              if (confirm('清空当前对话历史？')) clearQA(scope);
            }}
            className="hover:text-bad transition flex items-center gap-1"
            title="清空对话历史"
          >
            <Trash2 size={10} /> 清空
          </button>
        </div>
      )}

      {/* 输入框：置底 */}
      <div className="px-3 py-2 border-t border-line bg-bg-elev/30 flex gap-2 items-end">
        <textarea
          ref={taRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={
            aiOk
              ? activeProblemId
                ? '问点关于这题的：单调队列怎么写？为什么 WA？…'
                : '没激活题目也能问：什么是 KMP？'
              : '请先在设置里配 AI'
          }
          disabled={isPending || !aiOk}
          className="flex-1 input resize-none text-[12px] leading-relaxed py-1.5 min-h-[28px]"
          style={{ height: 'auto' }}
        />
        <button
          onClick={onSubmit}
          disabled={!input.trim() || isPending || !aiOk}
          className="btn-primary shrink-0 self-end"
          title={isPending ? 'AI 思考中…' : '发送 (Enter)'}
        >
          {isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Send size={13} />
          )}
        </button>
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  streaming,
  error,
}: {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: string;
}) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'shrink-0 w-6 h-6 rounded-full flex items-center justify-center',
          isUser ? 'bg-accent/15 text-accent' : 'bg-cyan/15 text-cyan',
        )}
      >
        {isUser ? <User size={12} /> : <Sparkles size={12} />}
      </div>
      <div
        className={cn(
          'flex-1 min-w-0 rounded-lg px-3 py-2 text-[12px] leading-relaxed',
          isUser ? 'bg-accent/10 border border-accent/25' : 'bg-bg border border-line',
        )}
      >
        {error && (
          <div className="flex items-center gap-1 text-bad text-[10px] mb-1">
            <AlertTriangle size={10} />
            <span className="font-mono">{error}</span>
          </div>
        )}
        {isUser ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : (
          <div className="md-compact">
            <MathMarkdown compact>{content || (streaming ? '思考中…' : '')}</MathMarkdown>
            {streaming && (
              <span className="inline-block w-1.5 h-3 bg-accent ml-0.5 animate-pulse" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
