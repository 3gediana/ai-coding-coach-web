/**
 * Feynman 反向教学会话编排（轻量纯函数封装）。
 *
 * Feynman 不是严格链式编排（Student × N 轮 + Evaluator × 1），
 * 而是"对话状态机 + 最终评估"。这里只把两个关键动作包成纯函数：
 *
 *   - runFeynmanStudentTurn: 用户讲 1 轮 → AI 学生回应 1 轮（更新对话录）
 *   - runFeynmanEvaluation:  对话结束 → AI 评委给评分
 *
 * 这样 store / UI 调用方拿到的是带 fallback 的可测试版本，
 * 而不是直接裸调 Coach 方法。
 */

// ───────── Schema ─────────

export type FeynmanRole = 'user' | 'student';

export interface FeynmanTurn {
  role: FeynmanRole;
  text: string;
}

export interface FeynmanProblem {
  title: string;
  statement: string;
}

export interface FeynmanStudentReply {
  studentReply: string;
  questions: string[];
  confusion?: string;
}

export interface FeynmanEvaluation {
  scores: { clarity: number; logic: number; accuracy: number };
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  verdict: 'mastered' | 'partial' | 'struggling';
  summary: string;
}

/** 用户讲完 1 轮后，runFeynmanStudentTurn 的结果 */
export type StudentTurnResult =
  | {
      status: 'success';
      reply: FeynmanStudentReply;
      /** 已追加 user + student 两条的新对话录 */
      conversation: FeynmanTurn[];
    }
  | {
      status: 'failed';
      reason: string;
      /** 已追加 user 一条 + 1 条占位 student（"换种说法再讲一遍"）的对话录 */
      conversation: FeynmanTurn[];
    };

/** 评估结果 */
export type EvaluationResult =
  | { status: 'success'; evaluation: FeynmanEvaluation }
  | { status: 'too-short'; minTurns: number }
  | { status: 'failed'; reason: string };

// ───────── 依赖 ─────────

export interface FeynmanDeps {
  generateStudentReply: (args: {
    problem: FeynmanProblem;
    conversation: FeynmanTurn[];
    userTurn: string;
    turnIndex: number;
  }) => Promise<FeynmanStudentReply | null>;
  generateEvaluation: (args: {
    problem: FeynmanProblem;
    conversation: FeynmanTurn[];
  }) => Promise<FeynmanEvaluation | null>;
}

// ───────── Helpers ─────────

const STUDENT_FALLBACK_TEXT = '（AI 学生暂时没听懂，可以换种说法再讲一遍吗？）';

/** 用户至少讲过几轮才允许 evaluate */
export const FEYNMAN_MIN_USER_TURNS = 2;

/**
 * 用户讲 1 轮 → AI 学生回应 1 轮。
 *   - 成功：returns { status: 'success', reply, conversation: [...prev, user, student] }
 *   - 失败：returns { status: 'failed', conversation: [...prev, user, fallback-student] }
 *           调用方拿到的对话录里仍然包含一条占位 student，UI 不会"卡住"
 *
 * 不抛异常。
 */
export async function runFeynmanStudentTurn(
  deps: FeynmanDeps,
  args: {
    problem: FeynmanProblem;
    conversation: FeynmanTurn[];
    userText: string;
  },
): Promise<StudentTurnResult> {
  const userTrim = args.userText.trim();
  if (!userTrim) {
    return {
      status: 'failed',
      reason: '用户输入为空',
      conversation: args.conversation,
    };
  }

  const userTurnsBefore = args.conversation.filter((t) => t.role === 'user').length;
  const newUserTurn: FeynmanTurn = { role: 'user', text: userTrim };
  const conversationWithUser = [...args.conversation, newUserTurn];

  let reply: FeynmanStudentReply | null;
  try {
    reply = await deps.generateStudentReply({
      problem: args.problem,
      conversation: conversationWithUser,
      userTurn: userTrim,
      turnIndex: userTurnsBefore,
    });
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      status: 'failed',
      reason,
      conversation: [
        ...conversationWithUser,
        { role: 'student', text: STUDENT_FALLBACK_TEXT },
      ],
    };
  }

  if (!reply) {
    return {
      status: 'failed',
      reason: 'AI 学生未返回有效回应',
      conversation: [
        ...conversationWithUser,
        { role: 'student', text: STUDENT_FALLBACK_TEXT },
      ],
    };
  }

  return {
    status: 'success',
    reply,
    conversation: [
      ...conversationWithUser,
      { role: 'student', text: reply.studentReply },
    ],
  };
}

/**
 * 多轮对话结束后的评估。
 * 用户讲 < FEYNMAN_MIN_USER_TURNS 轮直接拒绝（避免空评估）。
 * 不抛异常。
 */
export async function runFeynmanEvaluation(
  deps: FeynmanDeps,
  args: {
    problem: FeynmanProblem;
    conversation: FeynmanTurn[];
  },
): Promise<EvaluationResult> {
  const userTurns = args.conversation.filter((t) => t.role === 'user').length;
  if (userTurns < FEYNMAN_MIN_USER_TURNS) {
    return { status: 'too-short', minTurns: FEYNMAN_MIN_USER_TURNS };
  }

  let evaluation: FeynmanEvaluation | null;
  try {
    evaluation = await deps.generateEvaluation(args);
  } catch (e: unknown) {
    return {
      status: 'failed',
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  if (!evaluation) {
    return { status: 'failed', reason: 'AI 评委未返回有效评估' };
  }
  return { status: 'success', evaluation };
}
