/**
 * 费曼反向教学 Modal — 项目"创新性 20%"的杀手锏。
 *
 * 流程：
 *   1. 用户对当前题目讲解解题思路（文字输入）
 *   2. AI 学生（装菜鸟）听完提 1-3 个澄清问题
 *   3. 用户继续讲解 / 回答（多轮交互）
 *   4. 用户点"结束讲解 → 评估" → AI 评委生成报告
 *
 * 跟 Curistro 的"最佳创新奖"对位，但场景特化为算法竞赛题。
 *
 * 多 Agent 协作：每轮的 student / 最终的 evaluator 都进 AgentTracePanel
 * 让评委可以在 trace 里看到 "Feynman/Student × N → Feynman/Evaluator × 1" 的链路。
 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  X,
  Send,
  Loader2,
  CheckCircle2,
  GraduationCap,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { hasUsableAIConfig, useStore } from '../lib/store';
import { cn } from '../lib/cn';
import {
  runFeynmanStudentTurn,
  runFeynmanEvaluation,
  FEYNMAN_MIN_USER_TURNS,
} from '../core/feynmanSession';

interface ConvoMsg {
  role: 'user' | 'student';
  text: string;
  questions?: string[];
  confusion?: string;
}

interface Evaluation {
  scores: { clarity: number; logic: number; accuracy: number };
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  verdict: 'mastered' | 'partial' | 'struggling';
  summary: string;
}

const VERDICT_META: Record<
  Evaluation['verdict'],
  { label: string; color: string; bg: string; emoji: string }
> = {
  mastered: { label: '已真正掌握', color: 'text-ok', bg: 'bg-ok/10 border-ok/40', emoji: '🎓' },
  partial: { label: '部分理解', color: 'text-warn', bg: 'bg-warn/10 border-warn/40', emoji: '📖' },
  struggling: { label: '理解有缺口', color: 'text-bad', bg: 'bg-bad/10 border-bad/40', emoji: '💪' },
};

export function FeynmanModal() {
  const open = useStore((s) => s.feynmanOpen);
  const close = useStore((s) => s.closeFeynman);
  const activeProblemId = useStore((s) => s.activeProblemId);
  const problems = useStore((s) => s.problems);
  const coach = useStore((s) => s.coach);
  const aiConfig = useStore((s) => s.aiConfig);
  const recordTrace = useStore((s) => s.recordAgentTrace);

  const problem = activeProblemId ? problems.find((p) => p.id === activeProblemId) : null;

  const [convo, setConvo] = useState<ConvoMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [convo, thinking]);

  // 关闭时清状态
  useEffect(() => {
    if (!open) {
      setConvo([]);
      setDraft('');
      setEvaluation(null);
      setThinking(false);
      setEvaluating(false);
    }
  }, [open]);

  if (!open) return null;
  if (!problem) {
    return (
      <Backdrop onClose={close}>
        <div className="glass-card max-w-sm p-6 text-center">
          <Brain size={28} className="mx-auto text-accent mb-3" />
          <div className="text-sm font-semibold mb-2">先激活一道题</div>
          <div className="text-xs text-ink-mute leading-relaxed">
            费曼模式让你给 AI 讲题。请先在 sidebar 选一道题。
          </div>
          <button
            onClick={close}
            className="btn-primary mt-4 text-xs"
            type="button"
          >
            知道了
          </button>
        </div>
      </Backdrop>
    );
  }

  const aiUsable = hasUsableAIConfig(aiConfig);

  if (!aiUsable) {
    return (
      <Backdrop onClose={close}>
        <div className="glass-card max-w-sm p-6 text-center">
          <Brain size={28} className="mx-auto text-warn mb-3" />
          <div className="text-sm font-semibold mb-2">需要先配 AI</div>
          <div className="text-xs text-ink-mute leading-relaxed">
            费曼模式需要云端 LLM 提供 reasoning。请先在编辑器中央 QuickSetupCard 输入 API key。
          </div>
          <button
            onClick={close}
            className="btn-primary mt-4 text-xs"
            type="button"
          >
            好
          </button>
        </div>
      </Backdrop>
    );
  }

  const sendTurn = async () => {
    const text = draft.trim();
    if (!text || thinking) return;
    const turnIndex = convo.filter((m) => m.role === 'user').length;
    setDraft('');
    setThinking(true);

    recordTrace({
      kind: 'perceive',
      level: 'info',
      title: `费曼/学生 Agent · 听讲（第 ${turnIndex + 1} 轮）`,
      detail: text.slice(0, 200),
      agentName: 'Feynman/Student',
      route: 'cloud',
    });

    // 用户输入即时落到对话录（占位）；真正的 student turn 通过纯函数 helper 跑
    const optimistic: ConvoMsg = { role: 'user', text };
    setConvo([...convo, optimistic]);

    const t0 = Date.now();
    const result = await runFeynmanStudentTurn(
      {
        generateStudentReply: (a) => coach.generateFeynmanStudentReply(a),
        generateEvaluation: (a) => coach.generateFeynmanEvaluation(a),
      },
      {
        problem: { title: problem.title, statement: problem.statement },
        conversation: convo.map((m) => ({ role: m.role, text: m.text })),
        userText: text,
      },
    );
    const latency = Date.now() - t0;

    if (result.status === 'failed') {
      recordTrace({
        kind: 'feedback',
        level: 'warn',
        title: 'Feynman/Student · 失败',
        detail: result.reason,
        agentName: 'Feynman/Student',
        latencyMs: latency,
        route: 'cloud',
      });
      // helper 已经在 conversation 末尾追加了占位 student
      setConvo(
        result.conversation.map((t, i) => {
          // 末尾占位 student 转成本地 ConvoMsg 形态（带 questions 字段空数组）
          if (i === result.conversation.length - 1 && t.role === 'student') {
            return { role: 'student', text: t.text, questions: [] };
          }
          return { role: t.role, text: t.text };
        }),
      );
      setThinking(false);
      return;
    }

    recordTrace({
      kind: 'feedback',
      level: 'success',
      title: `Feynman/Student · 提了 ${result.reply.questions.length} 个问题`,
      detail: `回应：${result.reply.studentReply}\n问题：\n- ${result.reply.questions.join('\n- ')}`,
      agentName: 'Feynman/Student',
      latencyMs: latency,
      route: 'cloud',
    });

    setConvo([
      ...convo,
      optimistic,
      {
        role: 'student',
        text: result.reply.studentReply,
        questions: result.reply.questions,
        confusion: result.reply.confusion,
      },
    ]);
    setThinking(false);
  };

  const finishAndEvaluate = async () => {
    const userTurns = convo.filter((m) => m.role === 'user').length;
    if (userTurns < FEYNMAN_MIN_USER_TURNS) return; // 太短不评估
    setEvaluating(true);
    recordTrace({
      kind: 'decide',
      level: 'info',
      title: '费曼/评委 Agent 启动',
      detail: `多轮对话已结束（${userTurns} 轮讲解），开始评估`,
      agentName: 'Feynman/Evaluator',
      route: 'cloud',
    });
    const t0 = Date.now();
    const result = await runFeynmanEvaluation(
      {
        generateStudentReply: (a) => coach.generateFeynmanStudentReply(a),
        generateEvaluation: (a) => coach.generateFeynmanEvaluation(a),
      },
      {
        problem: { title: problem.title, statement: problem.statement },
        conversation: convo.map((m) => ({ role: m.role, text: m.text })),
      },
    );
    const latency = Date.now() - t0;

    if (result.status === 'too-short') {
      setEvaluating(false);
      return;
    }
    if (result.status === 'failed') {
      recordTrace({
        kind: 'feedback',
        level: 'error',
        title: 'Feynman/Evaluator · 失败',
        detail: result.reason,
        agentName: 'Feynman/Evaluator',
        latencyMs: latency,
        route: 'cloud',
      });
      setEvaluating(false);
      return;
    }
    const res = result.evaluation;
    recordTrace({
      kind: 'feedback',
      level: res.verdict === 'mastered' ? 'success' : 'info',
      title: `Feynman/Evaluator · 完成（${res.verdict}）`,
      detail: `清晰度 ${res.scores.clarity}/10 · 逻辑 ${res.scores.logic}/10 · 准确性 ${res.scores.accuracy}/10\n${res.summary}`,
      agentName: 'Feynman/Evaluator',
      latencyMs: latency,
      route: 'cloud',
    });
    setEvaluation(res);
    setEvaluating(false);
  };

  const userTurnCount = convo.filter((m) => m.role === 'user').length;
  const canEvaluate = userTurnCount >= 2 && !thinking && !evaluating;

  return (
    <Backdrop onClose={close}>
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="glass-card w-[min(680px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-48px))] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-line bg-bg-elev2 flex items-center gap-2">
          <Brain size={16} className="text-accent" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold flex items-center gap-2">
              费曼模式：你来教 AI
              <span className="text-[10px] font-normal text-ink-mute">
                ({userTurnCount} 轮讲解)
              </span>
            </div>
            <div className="text-[11px] text-ink-mute truncate">
              讲题：<span className="text-ink">{problem.title}</span>
            </div>
          </div>
          <button onClick={close} type="button" className="btn">
            <X size={14} />
          </button>
        </div>

        {/* 评估报告视图 */}
        {evaluation ? (
          <EvaluationView
            evaluation={evaluation}
            onRetry={() => {
              setEvaluation(null);
              setConvo([]);
            }}
            onClose={close}
          />
        ) : (
          <>
            {/* 对话区 */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {convo.length === 0 && (
                <div className="text-center py-10">
                  <GraduationCap size={32} className="mx-auto text-accent mb-3" />
                  <div className="text-sm font-semibold mb-2">
                    用你自己的话讲解这道题的思路
                  </div>
                  <div className="text-xs text-ink-mute leading-relaxed max-w-md mx-auto">
                    AI 会装作第一次听这道题，提出澄清问题。
                    <br />
                    讲完 ≥ 2 轮后，AI 评委会评估你的清晰度、逻辑、准确性。
                  </div>
                  <div className="text-[10px] text-ink-mute mt-3">
                    💡 提示：从「这道题在问什么」开始，然后讲算法选择，最后讲复杂度
                  </div>
                </div>
              )}
              {convo.map((m, i) => (
                <ConvoBubble key={i} msg={m} />
              ))}
              {thinking && (
                <div className="flex items-center gap-2 text-xs text-ink-mute pl-2">
                  <Loader2 size={12} className="animate-spin text-accent" />
                  <span>AI 学生在听 / 思考问题…</span>
                </div>
              )}
              {evaluating && (
                <div className="flex items-center gap-2 text-xs text-accent-glow pl-2">
                  <Sparkles size={12} className="animate-pulse" />
                  <span>AI 评委在分析整个对话…</span>
                </div>
              )}
            </div>

            {/* 输入区 */}
            <div className="border-t border-line p-3 space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void sendTurn();
                  }
                }}
                placeholder={
                  convo.length === 0
                    ? '从「这题在问什么」讲起… (Cmd/Ctrl + Enter 发送)'
                    : '继续讲解 / 回答 AI 学生的问题…'
                }
                rows={3}
                className="w-full bg-bg-elev2 border border-line rounded p-2 text-xs resize-none focus:outline-none focus:border-accent"
                disabled={thinking || evaluating}
              />
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-ink-mute">
                  Cmd/Ctrl + Enter 发送 ·{' '}
                  {canEvaluate
                    ? '随时可结束讲解'
                    : `还差 ${Math.max(0, 2 - userTurnCount)} 轮可结束`}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={finishAndEvaluate}
                  disabled={!canEvaluate}
                  className={cn(
                    'btn text-[11px]',
                    canEvaluate && 'border-accent/40 text-accent-glow',
                  )}
                  title="结束讲解，让 AI 评委生成报告"
                >
                  <Sparkles size={11} /> 结束 → 评估
                </button>
                <button
                  type="button"
                  onClick={sendTurn}
                  disabled={!draft.trim() || thinking || evaluating}
                  className="btn-primary text-[11px]"
                >
                  <Send size={11} /> 讲下一段
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </Backdrop>
  );
}

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 modal-overlay flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function ConvoBubble({ msg }: { msg: ConvoMsg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] bg-accent/15 border border-accent/30 rounded-lg rounded-br-sm px-3 py-2">
          <div className="text-[10px] text-accent-glow font-semibold mb-1">你</div>
          <div className="text-xs whitespace-pre-wrap leading-relaxed">{msg.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[78%] bg-bg-elev2 border border-line rounded-lg rounded-bl-sm px-3 py-2 space-y-1.5">
        <div className="text-[10px] text-ink-mute font-semibold flex items-center gap-1">
          <GraduationCap size={10} className="text-cyan" /> AI 学生（装菜鸟）
        </div>
        <div className="text-xs whitespace-pre-wrap leading-relaxed">{msg.text}</div>
        {msg.confusion && (
          <div className="text-[10px] italic text-ink-mute border-l-2 border-warn/40 pl-2">
            🤔 {msg.confusion}
          </div>
        )}
        {msg.questions && msg.questions.length > 0 && (
          <div className="space-y-0.5 pt-1 border-t border-line/40">
            {msg.questions.map((q, i) => (
              <div key={i} className="text-xs text-ink leading-snug flex gap-1">
                <span className="text-accent shrink-0">Q{i + 1}.</span>
                <span>{q}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EvaluationView({
  evaluation,
  onRetry,
  onClose,
}: {
  evaluation: Evaluation;
  onRetry: () => void;
  onClose: () => void;
}) {
  const meta = VERDICT_META[evaluation.verdict];
  const avg = (
    (evaluation.scores.clarity + evaluation.scores.logic + evaluation.scores.accuracy) /
    3
  ).toFixed(1);
  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      {/* 头条 */}
      <div className={cn('rounded-lg border p-4', meta.bg)}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">{meta.emoji}</span>
          <div className="flex-1">
            <div className={cn('text-sm font-semibold', meta.color)}>
              {meta.label}（综合 {avg} / 10）
            </div>
            <div className="text-xs text-ink-mute mt-0.5">{evaluation.summary}</div>
          </div>
        </div>
      </div>

      {/* 三维度评分 */}
      <div className="space-y-2">
        <ScoreBar label="清晰度" desc="能让外行听懂吗" score={evaluation.scores.clarity} />
        <ScoreBar label="逻辑流畅度" desc="步骤之间有跳跃吗" score={evaluation.scores.logic} />
        <ScoreBar label="概念准确性" desc="术语 / 复杂度 / 边界" score={evaluation.scores.accuracy} />
      </div>

      {/* 优点 */}
      {evaluation.strengths.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-ok mb-1.5 flex items-center gap-1">
            <CheckCircle2 size={11} /> 你讲得好的地方
          </div>
          <ul className="space-y-1">
            {evaluation.strengths.map((s, i) => (
              <li key={i} className="text-xs leading-relaxed pl-3 relative">
                <span className="absolute left-0 text-ok">✓</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 不足 */}
      {evaluation.weaknesses.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-warn mb-1.5">
            需要改进
          </div>
          <ul className="space-y-1">
            {evaluation.weaknesses.map((s, i) => (
              <li key={i} className="text-xs leading-relaxed pl-3 relative">
                <span className="absolute left-0 text-warn">!</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 建议 */}
      {evaluation.suggestions.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-accent mb-1.5">
            下次怎么讲更好
          </div>
          <ul className="space-y-1">
            {evaluation.suggestions.map((s, i) => (
              <li key={i} className="text-xs leading-relaxed pl-3 relative">
                <span className="absolute left-0 text-accent">→</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 操作 */}
      <div className="flex items-center gap-2 pt-2 border-t border-line">
        <button type="button" onClick={onRetry} className="btn text-[11px]">
          <RotateCcw size={11} /> 再讲一次
        </button>
        <div className="flex-1" />
        <button type="button" onClick={onClose} className="btn-primary text-[11px]">
          完成
        </button>
      </div>
    </div>
  );
}

function ScoreBar({
  label,
  desc,
  score,
}: {
  label: string;
  desc: string;
  score: number;
}) {
  const pct = (score / 10) * 100;
  const color =
    score >= 8 ? 'bg-ok' : score >= 5 ? 'bg-warn' : 'bg-bad';
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1 text-xs">
        <span className="font-semibold">{label}</span>
        <span className="text-[10px] text-ink-mute">{desc}</span>
        <span className="ml-auto font-mono text-[11px]">{score} / 10</span>
      </div>
      <div className="h-2 bg-bg-elev2 rounded relative overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className={cn('absolute left-0 top-0 bottom-0 rounded', color)}
        />
      </div>
    </div>
  );
}
