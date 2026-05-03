/**
 * Feynman 反向教学会话单元测试。
 *
 * 覆盖关键分支：
 *  - 用户讲 1 轮成功 → AI 学生正常回应，对话录变成 [...prev, user, student]
 *  - Student 返回 null → 占位 student 仍写到对话录（UI 不卡住）
 *  - Student 抛异常 → 同上 fallback
 *  - 用户输入空 → 拒绝，不调 deps
 *  - 评估：用户少于 2 轮 → too-short
 *  - 评估：成功 / 失败 / 异常
 */
import { describe, it, expect, vi } from 'vitest';
import {
  runFeynmanStudentTurn,
  runFeynmanEvaluation,
  FEYNMAN_MIN_USER_TURNS,
  type FeynmanDeps,
  type FeynmanProblem,
  type FeynmanStudentReply,
  type FeynmanEvaluation,
  type FeynmanTurn,
} from './feynmanSession';

const PROBLEM: FeynmanProblem = {
  title: '两数之和',
  statement: '...',
};

const STUDENT_OK: FeynmanStudentReply = {
  studentReply: '我想确认一下哈希表那部分',
  questions: ['哈希表是怎么避免重复扫一遍的？', '为什么要用字典而不是排序？'],
  confusion: 'hash',
};

const EVALUATION_OK: FeynmanEvaluation = {
  scores: { clarity: 8, logic: 7, accuracy: 9 },
  strengths: ['思路清晰'],
  weaknesses: ['没说清复杂度'],
  suggestions: ['下次先讲清 O(n)'],
  verdict: 'mastered',
  summary: '讲解整体到位',
};

function makeDeps(overrides: Partial<FeynmanDeps> = {}): FeynmanDeps {
  return {
    generateStudentReply: vi.fn(async () => STUDENT_OK),
    generateEvaluation: vi.fn(async () => EVALUATION_OK),
    ...overrides,
  };
}

describe('runFeynmanStudentTurn', () => {
  it('1. 用户讲 1 轮成功 — 对话录追加 user + student', async () => {
    const deps = makeDeps();
    const result = await runFeynmanStudentTurn(deps, {
      problem: PROBLEM,
      conversation: [],
      userText: '我用哈希表存遍历过的数',
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.reply).toEqual(STUDENT_OK);
      expect(result.conversation).toHaveLength(2);
      expect(result.conversation[0]).toEqual({
        role: 'user',
        text: '我用哈希表存遍历过的数',
      });
      expect(result.conversation[1]).toEqual({
        role: 'student',
        text: STUDENT_OK.studentReply,
      });
    }

    // generateStudentReply 应该收到包含本轮 user 的对话录
    const call = (deps.generateStudentReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.userTurn).toBe('我用哈希表存遍历过的数');
    expect(call.turnIndex).toBe(0); // 之前用户没讲过
    expect(call.conversation).toHaveLength(1);
    expect(call.conversation[0].role).toBe('user');
  });

  it('2. 第二轮：turnIndex 增加', async () => {
    const deps = makeDeps();
    const prevConv: FeynmanTurn[] = [
      { role: 'user', text: '第一轮讲解' },
      { role: 'student', text: '第一轮回应' },
    ];
    await runFeynmanStudentTurn(deps, {
      problem: PROBLEM,
      conversation: prevConv,
      userText: '第二轮补充',
    });

    const call = (deps.generateStudentReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.turnIndex).toBe(1); // 之前用户讲过 1 轮
    expect(call.conversation).toHaveLength(3); // prev 2 + 本轮 user 1
  });

  it('3. Student 返回 null — 占位 student 仍写到对话录', async () => {
    const deps = makeDeps({
      generateStudentReply: vi.fn(async () => null),
    });
    const result = await runFeynmanStudentTurn(deps, {
      problem: PROBLEM,
      conversation: [],
      userText: '讲解',
    });

    expect(result.status).toBe('failed');
    expect(result.conversation).toHaveLength(2);
    expect(result.conversation[0].role).toBe('user');
    expect(result.conversation[1].role).toBe('student');
    expect(result.conversation[1].text).toMatch(/追问点/);
  });

  it('4. Student 抛异常 — fallback 同上', async () => {
    const deps = makeDeps({
      generateStudentReply: vi.fn(async () => {
        throw new Error('LLM timeout');
      }),
    });
    const result = await runFeynmanStudentTurn(deps, {
      problem: PROBLEM,
      conversation: [],
      userText: '讲解',
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('LLM timeout');
    }
    expect(result.conversation).toHaveLength(2);
    expect(result.conversation[1].text).toMatch(/追问点/);
  });

  it('5. 用户输入空白 — 拒绝且不调 deps', async () => {
    const deps = makeDeps();
    const result = await runFeynmanStudentTurn(deps, {
      problem: PROBLEM,
      conversation: [],
      userText: '   ',
    });

    expect(result.status).toBe('failed');
    expect(result.conversation).toEqual([]); // 不动
    expect(deps.generateStudentReply).not.toHaveBeenCalled();
  });
});

describe('runFeynmanEvaluation', () => {
  it('6. 用户讲 < 2 轮 — too-short', async () => {
    const deps = makeDeps();
    const result = await runFeynmanEvaluation(deps, {
      problem: PROBLEM,
      conversation: [{ role: 'user', text: '只讲一轮' }],
    });

    expect(result.status).toBe('too-short');
    if (result.status === 'too-short') {
      expect(result.minTurns).toBe(FEYNMAN_MIN_USER_TURNS);
    }
    expect(deps.generateEvaluation).not.toHaveBeenCalled();
  });

  it('7. 用户讲 ≥ 2 轮 + 评估成功', async () => {
    const deps = makeDeps();
    const result = await runFeynmanEvaluation(deps, {
      problem: PROBLEM,
      conversation: [
        { role: 'user', text: '第 1 轮' },
        { role: 'student', text: '回应' },
        { role: 'user', text: '第 2 轮' },
        { role: 'student', text: '再回应' },
      ],
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.evaluation).toEqual(EVALUATION_OK);
    }
  });

  it('8. 评估返回 null — failed', async () => {
    const deps = makeDeps({
      generateEvaluation: vi.fn(async () => null),
    });
    const result = await runFeynmanEvaluation(deps, {
      problem: PROBLEM,
      conversation: [
        { role: 'user', text: '1' },
        { role: 'user', text: '2' },
      ],
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toMatch(/未返回/);
    }
  });

  it('9. 评估抛异常 — failed 带 message', async () => {
    const deps = makeDeps({
      generateEvaluation: vi.fn(async () => {
        throw new Error('quota exceeded');
      }),
    });
    const result = await runFeynmanEvaluation(deps, {
      problem: PROBLEM,
      conversation: [
        { role: 'user', text: '1' },
        { role: 'user', text: '2' },
      ],
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('quota exceeded');
    }
  });
});
