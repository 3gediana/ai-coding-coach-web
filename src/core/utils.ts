/**
 * 工具层：令牌桶限流 / 代码哈希 / 掌握度聚合。
 *
 * 不依赖 vscode，未来 Web 版可直接复用。
 */
import type { CoachEvent, LearnerProfile, Mistake, Problem, Session } from './types';

// ============== 令牌桶 ==============

/**
 * 令牌桶限流器：用于控制 AI 调用频率，防止烧 Key。
 *
 * 例：每分钟 6 次 -> capacity=6, refillIntervalMs=10_000（每 10s 补 1 个）
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    public readonly capacity: number,
    public readonly refillIntervalMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  /** 尝试消耗 1 个 token；返回 true=允许，false=被限流 */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** 当前可用 tokens（向下取整，仅供 UI 展示） */
  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /** 距离下一个 token 可用还有多少毫秒（用于 UI 提示"X 秒后重试"） */
  msUntilNext(): number {
    this.refill();
    if (this.tokens >= 1) {
      return 0;
    }
    const need = 1 - this.tokens;
    return Math.ceil(need * this.refillIntervalMs);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillMs;
    if (elapsed <= 0) {
      return;
    }
    const toAdd = elapsed / this.refillIntervalMs;
    this.tokens = Math.min(this.capacity, this.tokens + toAdd);
    this.lastRefillMs = now;
  }
}

// ============== 代码哈希 ==============

/** 取代码的 64-bit FNV-1a 双串接哈希（同步、零依赖、用于去重） */
export function codeHash(text: string): string {
  let h1 = 2166136261;
  let h2 = 0x9dc5 ^ 0xfeed;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822507);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0')
  );
}

// ============== 掌握度计算 ==============

export interface ProblemMastery {
  problemId: string;
  problemTitle: string;
  tags: string[];
  score: number; // 0~1
  isMistake: boolean;
  effectiveMs: number;
  stuckCount: number;
  hintCount: number;
  outcome?: 'pass' | 'mistake' | 'incomplete';
}

export interface AggregateMastery {
  totalProblems: number;
  passedProblems: number;
  mistakeProblems: number;
  totalEffectiveMs: number;
  perProblem: ProblemMastery[];
  /** key=知识点 tag，value=该 tag 下的平均掌握度和样本数 */
  perTag: Record<string, { score: number; count: number }>;
}

/**
 * 单道题的掌握度（0~1，越高越好）。
 *
 * 公式（启发式，可调）：
 *   base = 0.7
 *   - 0.10 * stuckCount         （卡住次数）
 *   - 0.01 * awayMinutes        （离开分钟数）
 *   - 0.20 * isMistake          （成为错题）
 *   + 0.05 * hintTakenCount     （主动采纳 AI 建议）
 *   + 0.30 * (outcome === pass) （AC 加分）
 *   clamp 到 [0, 1]
 */
export function masteryOf(args: {
  session: Session;
  isMistake: boolean;
  hintTakenCount: number;
}): number {
  let s = 0.7;
  s -= 0.10 * args.session.stuckCount;
  s -= 0.01 * (args.session.awayMs / 60_000);
  if (args.isMistake) {
    s -= 0.20;
  }
  s += 0.05 * args.hintTakenCount;
  if (args.session.outcome === 'pass') {
    s += 0.30;
  }
  return Math.max(0, Math.min(1, s));
}

/** 把所有 session 聚合到题目维度，并进一步聚合到知识点维度 */
export function aggregateMastery(args: {
  sessions: Session[];
  problems: Problem[];
  mistakes: Mistake[];
  events: CoachEvent[];
}): AggregateMastery {
  const problemMap = new Map(args.problems.map((p) => [p.id, p]));
  const mistakeProblemIds = new Set(
    args.mistakes.map((m) => m.problemId).filter((x): x is string => !!x),
  );

  const hintCountByProblem = new Map<string, number>();
  for (const e of args.events) {
    if (e.type === 'hint_taken' && e.problemId) {
      hintCountByProblem.set(e.problemId, (hintCountByProblem.get(e.problemId) ?? 0) + 1);
    }
  }

  // 每个 problem 取最近一次 session（不重复计同一题多次会话）
  const lastSessionByProblem = new Map<string, Session>();
  for (const s of args.sessions) {
    if (!s.problemId) {
      continue;
    }
    const prev = lastSessionByProblem.get(s.problemId);
    if (!prev || s.startedAt > prev.startedAt) {
      lastSessionByProblem.set(s.problemId, s);
    }
  }

  const perProblem: ProblemMastery[] = [];
  let passed = 0;
  let totalEffectiveMs = 0;

  for (const [pid, session] of lastSessionByProblem) {
    const problem = problemMap.get(pid);
    if (!problem) {
      continue;
    }
    const isMistake = mistakeProblemIds.has(pid);
    const hintCount = hintCountByProblem.get(pid) ?? 0;
    const score = masteryOf({ session, isMistake, hintTakenCount: hintCount });

    perProblem.push({
      problemId: pid,
      problemTitle: problem.title,
      tags: problem.tags ?? [],
      score,
      isMistake,
      effectiveMs: session.effectiveMs,
      stuckCount: session.stuckCount,
      hintCount,
      outcome: session.outcome,
    });

    totalEffectiveMs += session.effectiveMs;
    if (session.outcome === 'pass') {
      passed++;
    }
  }

  // 按 tag 聚合
  const tagAcc: Record<string, { sum: number; count: number }> = {};
  for (const pm of perProblem) {
    for (const tag of pm.tags) {
      const slot = (tagAcc[tag] ??= { sum: 0, count: 0 });
      slot.sum += pm.score;
      slot.count += 1;
    }
  }
  const perTag: AggregateMastery['perTag'] = {};
  for (const [tag, { sum, count }] of Object.entries(tagAcc)) {
    perTag[tag] = { score: count > 0 ? sum / count : 0, count };
  }

  return {
    totalProblems: lastSessionByProblem.size,
    passedProblems: passed,
    mistakeProblems: mistakeProblemIds.size,
    totalEffectiveMs,
    perProblem,
    perTag,
  };
}

// ============== 学习画像 ==============

/**
 * 把 sessions/mistakes/events 提炼为 LearnerProfile，给 AI 当上下文。
 *
 * 体积控制：
 *   - weakestTags 最多 3 个
 *   - topMistakeCategories 最多 5 个（取自最近 10 道错题）
 *   - currentTagsHitWeak 取交集
 */
export function buildLearnerProfile(args: {
  sessions: Session[];
  problems: Problem[];
  mistakes: Mistake[];
  events: CoachEvent[];
  currentProblemTags?: string[];
}): LearnerProfile {
  const stats = aggregateMastery({
    sessions: args.sessions,
    problems: args.problems,
    mistakes: args.mistakes,
    events: args.events,
  });

  const weakestTags = Object.entries(stats.perTag)
    .filter(([, v]) => v.count >= 1)
    .sort((a, b) => a[1].score - b[1].score)
    .slice(0, 3)
    .map(([tag, v]) => ({ tag, mastery: v.score, count: v.count }));

  const recentMistakes = args.mistakes
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
  const catCount = new Map<string, number>();
  for (const m of recentMistakes) {
    catCount.set(m.category, (catCount.get(m.category) ?? 0) + 1);
  }
  const topMistakeCategories = Array.from(catCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));

  const weakSet = new Set(weakestTags.map((w) => w.tag));
  const currentTagsHitWeak = (args.currentProblemTags ?? []).filter((t) => weakSet.has(t));

  return {
    totalProblems: stats.totalProblems,
    totalMistakes: args.mistakes.length,
    weakestTags,
    topMistakeCategories,
    currentTagsHitWeak,
  };
}

// ============== 时间格式化 ==============

export function formatDurationMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ${s % 60}s`;
  }
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
