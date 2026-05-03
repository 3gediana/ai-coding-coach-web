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
import {
  Loader2,
  Trash2,
  User,
  Sparkles,
  Send,
  AlertTriangle,
  MessageCircle,
  Square,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { hasUsableAIConfig, useStore } from '../lib/store';
import { MathMarkdown, type CodeBlockActions } from './MathMarkdown';
import { cn } from '../lib/cn';
import type { CoachRoute } from '../core/coach/types';
import type { FileLang } from '../core/types';

const DRAFT_SCOPE = '__draft__';

export function QAPanel() {
  const activeProblemId = useStore((s) => s.activeProblemId);
  const qaByProblem = useStore((s) => s.qaByProblem);
  const askCoach = useStore((s) => s.askCoach);
  const abortCoach = useStore((s) => s.abortCoach);
  const retryLastCoach = useStore((s) => s.retryLastCoach);
  const clearQA = useStore((s) => s.clearQA);
  const pending = useStore((s) => s.qaPendingProblemId);
  const aiOk = useStore((s) => hasUsableAIConfig(s.aiConfig));
  const askPrefill = useStore((s) => s.askPrefill);
  const setAskPrefill = useStore((s) => s.setAskPrefill);
  const coachDraft = useStore((s) => s.coachDraft);
  const setCoachDraft = useStore((s) => s.setCoachDraft);
  // 代码块按钮：替换当前 / 新建文件 都需要拿到 active file 上下文
  const filesByScope = useStore((s) => s.filesByScope);
  const activeFileIdByScope = useStore((s) => s.activeFileIdByScope);
  const updateFileContent = useStore((s) => s.updateFileContent);
  const createFile = useStore((s) => s.createFile);

  const scope = activeProblemId ?? DRAFT_SCOPE;
  const messages = qaByProblem[scope] ?? [];
  const isPending = pending === scope;

  const activeFile = (filesByScope[scope] ?? []).find(
    (f) => f.id === activeFileIdByScope[scope],
  );

  /** 把 markdown 里 ```cpp ```python ```c 等 fence lang 映射到我们 FileLang */
  const mapFenceLangToFileLang = (lang: string | undefined): FileLang | null => {
    if (!lang) return null;
    const l = lang.toLowerCase();
    if (l === 'cpp' || l === 'c++' || l === 'cxx') return 'cpp';
    if (l === 'c') return 'c';
    if (l === 'py' || l === 'python' || l === 'python3') return 'python';
    if (l === 'md' || l === 'markdown') return 'markdown';
    if (l === 'txt' || l === 'plaintext' || l === 'text') return 'plaintext';
    return null;
  };

  /** 代码块按钮：复制 / 替换当前 / 新建文件 */
  const codeActions: CodeBlockActions = {
    onCopy: async (code) => {
      try {
        await navigator.clipboard.writeText(code);
        toast.success('已复制');
      } catch {
        toast.error('复制失败');
      }
    },
    // 仅在有 active file 且语言兼容时才提供"替换当前"
    onApplyToCurrent: activeFile
      ? (code, lang) => {
          const inferred = mapFenceLangToFileLang(lang);
          // 语言不一致时弹确认；一致直接替换
          if (
            inferred &&
            inferred !== activeFile.language &&
            !confirm(`AI 代码语言是 ${inferred}，当前文件是 ${activeFile.language}，仍要替换吗？`)
          ) {
            return;
          }
          updateFileContent(activeFile.id, code);
          toast.success(`已替换到 ${activeFile.name}`);
        }
      : undefined,
    // 在草稿 scope 也允许新建（createFile 已经支持 DRAFT_SCOPE）
    onCreateNew: (code, lang) => {
      const inferred = mapFenceLangToFileLang(lang) ?? activeFile?.language ?? 'cpp';
      void createFile({ scope, content: code, language: inferred, activate: true }).then(
        (file) => {
          if (file) toast.success(`已建文件 ${file.name}`);
        },
      );
    },
  };

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

  // 框选「问 AI」prefill：CodeEditor 通过 setAskPrefill 把代码段塞进来
  useEffect(() => {
    if (!askPrefill) return;
    setInput(askPrefill);
    // 让光标停在 prefill 末尾，方便用户继续输入问题
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    setAskPrefill(null);
  }, [askPrefill, setAskPrefill]);

  const onSubmit = () => {
    const q = input.trim();
    if (!q || isPending) return;
    askCoach({ text: q, source: coachDraft?.source ?? 'manual', selection: coachDraft?.selection });
    setInput('');
    setCoachDraft(null);
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
                ? '直接说你的困惑：题意、思路、报错、哪里错了，Coach 会自己判断要看哪些上下文'
                : '没激活题目也能问一般性问题：什么是 KMP？什么是单调队列？'}
            </div>
          </div>
        ) : (
          messages.map((m, idx) => {
            // 重答按钮只在最后一条 assistant 上显示，且不在流式中
            const isLastAssistant =
              m.role === 'assistant' &&
              idx === messages.length - 1 &&
              !m.streaming;
            return (
              <MessageBubble
                key={m.id}
                role={m.role}
                content={m.content}
                streaming={m.streaming}
                error={m.error}
                route={m.route}
                onRetry={isLastAssistant ? () => void retryLastCoach(scope) : undefined}
                codeActions={m.role === 'assistant' && !m.streaming ? codeActions : undefined}
              />
            );
          })
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
          <div className="flex items-center gap-3">
            {isPending && (
              <button
                onClick={() => abortCoach()}
                className="hover:text-bad transition flex items-center gap-1"
                title="停止当前流式生成"
              >
                <Square size={10} /> 停止
              </button>
            )}
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
        </div>
      )}

      {/* 输入框：置底 */}
      <div className="px-3 py-2 border-t border-line bg-bg-elev/30 flex gap-2 items-end">
        <textarea
          data-coach-input
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
  route,
  onRetry,
  codeActions,
}: {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: string;
  route?: CoachRoute;
  /** 仅最后一条 assistant 消息会传：点击后用同一条 user 提问重答 */
  onRetry?: () => void;
  /** 仅 assistant 完成后传：让 markdown 里 ```cpp 等代码块右上角出现按钮 */
  codeActions?: CodeBlockActions;
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
        {!isUser && route && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-ink-mute">
            {/* hover 显示决策原因；同步给 chip + 旁边文字，方便用户理解为什么走了这条路由 */}
            <span
              className="chip px-1.5 py-0 cursor-help"
              title={`${ROUTE_LABEL[route.intent] ?? route.intent} · ${ROUTED_BY_LABEL[route.routedBy] ?? route.routedBy} · 置信度 ${(route.confidence * 100).toFixed(0)}%\n${route.reason}`}
            >
              {ROUTE_LABEL[route.intent] ?? route.intent}
            </span>
            <span title={route.reason} className="cursor-help">
              {ROUTED_BY_LABEL[route.routedBy] ?? route.routedBy}
            </span>
          </div>
        )}
        {isUser ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : (
          <div className="md-compact">
            <MathMarkdown compact codeActions={codeActions}>
              {content || (streaming ? '思考中…' : '')}
            </MathMarkdown>
            {streaming && (
              <span className="inline-block w-1.5 h-3 bg-accent ml-0.5 animate-pulse" />
            )}
            {onRetry && (
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ink-mute">
                <button
                  onClick={onRetry}
                  className="hover:text-accent transition inline-flex items-center gap-1"
                  title="用同一条提问重答（删除当前回答后重新生成）"
                >
                  <RotateCcw size={10} /> 重答
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const ROUTE_LABEL: Record<string, string> = {
  understand_problem: '读题',
  check_idea: '思路',
  debug_runtime_error: '报错',
  review_code: '查代码',
  explain_selection: '选区',
  stuck_hint: '卡住',
  general_question: '问答',
};

const ROUTED_BY_LABEL: Record<string, string> = {
  rule: '规则判断',
  ai: 'AI 判断',
  fallback: '兜底',
};
