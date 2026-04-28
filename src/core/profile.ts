/**
 * 学生画像聚合：从 sessions / problems / mistakes / events 计算各种画像维度。
 *
 * 设计原则：
 *   - 纯函数，方便测试和缓存
 *   - 每个字段独立计算，UI 按需取
 *   - 不引入新依赖（不用 dayjs/date-fns，原生 Date 够用）
 */
import type { Mistake, Problem, Session, SubmissionVerdict } from './types';

// ────────── 时间工具 ──────────

const MS_DAY = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function ymd(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfWeek(ts: number): number {
  // 周一为一周开始
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function siteOf(source?: string): string | null {
  if (!source) return null;
  if (source.includes('luogu.com.cn')) return 'luogu';
  if (source.includes('atcoder.jp')) return 'atcoder';
  if (source.includes('poj.org')) return 'poj';
  if (source.includes('hdu.edu.cn')) return 'hdu';
  if (source.includes('codeforces.com')) return 'codeforces';
  if (source.includes('leetcode.')) return 'leetcode';
  if (source.includes('nowcoder.com')) return 'nowcoder';
  return 'other';
}

// ────────── 画像类型 ──────────

export interface StudentProfile {
  // 时间维度
  todayMs: number;
  todayProblems: number;
  weekMs: number;
  weekProblems: number;
  monthProblems: number;
  totalEffectiveMs: number;

  // streak（基于实际有 session 的天数）
  currentStreakDays: number;
  bestStreakDays: number;
  /** 距离打破连续记录还有多久（毫秒）；< 0 表示今天已经打卡 */
  streakUrgencyMs: number;

  // 题目数
  totalProblems: number;
  passedProblems: number;
  mistakeProblems: number;
  passRate: number; // 0..1

  // 难度分布（基于 problem.difficulty）
  difficultyBreakdown: Record<'easy' | 'medium' | 'hard' | 'unknown', { total: number; passed: number }>;

  // 错题分析
  pendingReview: number; // 超过阈值天数未复习的错题数
  reviewRate: number; // reviewedAt 非空 / 总错题
  verdictBreakdown: Record<SubmissionVerdict, number>;
  topAreaCodes: Array<{ code: string; count: number }>;

  // OJ 来源分布
  siteBreakdown: Record<string, number>;

  // 用时分布（按 effectiveMs 分箱，仅 pass 的题）
  timeDistribution: {
    under5: number;
    under15: number;
    under30: number;
    under60: number;
    over60: number;
  };

  // AI 辅助度
  avgHintsPerPass: number;
  avgAnalyzePerPass: number;
  avgStuckPerPass: number;
  /** 独立解题率：通过 + 0 hint 的题目 / 总通过题目 */
  independentRate: number;

  // 趋势：近 8 周
  weeklyTrend: Array<{
    weekStart: number; // 周一 0:00 时间戳
    label: string; // "MM/DD"
    passed: number;
    mistakes: number;
    effectiveMs: number;
  }>;
}

// ────────── 主聚合函数 ──────────

const REVIEW_DAYS_THRESHOLD = 3; // 超过 3 天没复习 → 待复习

export function aggregateStudentProfile(args: {
  sessions: Session[];
  problems: Problem[];
  mistakes: Mistake[];
}): StudentProfile {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthAgo = now - 30 * MS_DAY;

  const problemMap = new Map(args.problems.map((p) => [p.id, p]));
  const mistakeProblemIds = new Set(
    args.mistakes.map((m) => m.problemId).filter((x): x is string => !!x),
  );

  // 每题取最近一次 session
  const lastSessionByProblem = new Map<string, Session>();
  for (const s of args.sessions) {
    if (!s.problemId) continue;
    const prev = lastSessionByProblem.get(s.problemId);
    if (!prev || s.startedAt > prev.startedAt) {
      lastSessionByProblem.set(s.problemId, s);
    }
  }

  // ───── 时间维度 ─────
  let todayMs = 0;
  let weekMs = 0;
  const todayProblemSet = new Set<string>();
  const weekProblemSet = new Set<string>();
  const monthProblemSet = new Set<string>();
  let totalEffectiveMs = 0;

  for (const s of args.sessions) {
    totalEffectiveMs += s.effectiveMs;
    if (s.startedAt >= todayStart) {
      todayMs += s.effectiveMs;
      if (s.problemId) todayProblemSet.add(s.problemId);
    }
    if (s.startedAt >= weekStart) {
      weekMs += s.effectiveMs;
      if (s.problemId) weekProblemSet.add(s.problemId);
    }
    if (s.startedAt >= monthAgo && s.problemId) {
      monthProblemSet.add(s.problemId);
    }
  }

  // ───── streak（连续学习天数） ─────
  // 基于 sessions 的 startedAt，按"是否有任何 session"判断当天打卡
  const activeDaySet = new Set<string>();
  for (const s of args.sessions) {
    activeDaySet.add(ymd(s.startedAt));
  }
  // 当前 streak：从今天往前数，找连续打卡
  let currentStreak = 0;
  let cursor = todayStart;
  while (activeDaySet.has(ymd(cursor))) {
    currentStreak++;
    cursor -= MS_DAY;
  }
  // 如果今天没打卡，但昨天打了，则当前 streak 仍然是从昨天往前算（防止白天还没开始时显示 0）
  if (currentStreak === 0 && activeDaySet.has(ymd(todayStart - MS_DAY))) {
    cursor = todayStart - MS_DAY;
    while (activeDaySet.has(ymd(cursor))) {
      currentStreak++;
      cursor -= MS_DAY;
    }
  }
  // 历史最长 streak
  const sortedDays = Array.from(activeDaySet)
    .map((s) => new Date(s).getTime())
    .sort((a, b) => a - b);
  let bestStreak = 0;
  let runStart = sortedDays[0] ?? 0;
  let runLen = sortedDays.length > 0 ? 1 : 0;
  for (let i = 1; i < sortedDays.length; i++) {
    if (sortedDays[i] - sortedDays[i - 1] <= MS_DAY * 1.5) {
      runLen++;
    } else {
      bestStreak = Math.max(bestStreak, runLen);
      runStart = sortedDays[i];
      runLen = 1;
    }
  }
  bestStreak = Math.max(bestStreak, runLen);
  void runStart;
  // urgency：今天没打卡时，距离今天 23:59 还有多久（提醒"快去打卡"）
  const streakUrgencyMs =
    activeDaySet.has(ymd(todayStart)) ? -1 : todayStart + MS_DAY - now;

  // ───── 题目 / 难度 ─────
  let passed = 0;
  const difficultyBreakdown: StudentProfile['difficultyBreakdown'] = {
    easy: { total: 0, passed: 0 },
    medium: { total: 0, passed: 0 },
    hard: { total: 0, passed: 0 },
    unknown: { total: 0, passed: 0 },
  };
  for (const [pid, session] of lastSessionByProblem) {
    const p = problemMap.get(pid);
    const diff = (p?.difficulty as 'easy' | 'medium' | 'hard' | undefined) ?? 'unknown';
    difficultyBreakdown[diff].total++;
    if (session.outcome === 'pass') {
      difficultyBreakdown[diff].passed++;
      passed++;
    }
  }

  // ───── 错题分析 ─────
  let pendingReview = 0;
  let reviewedCount = 0;
  const verdictBreakdown: Record<SubmissionVerdict, number> = {
    AC: 0, WA: 0, TLE: 0, MLE: 0, RE: 0, CE: 0, OTHER: 0,
  };
  const areaCodeCount = new Map<string, number>();
  for (const m of args.mistakes) {
    if (m.reviewedAt) reviewedCount++;
    else if (now - m.createdAt > REVIEW_DAYS_THRESHOLD * MS_DAY) pendingReview++;
    if (m.verdict) verdictBreakdown[m.verdict] = (verdictBreakdown[m.verdict] ?? 0) + 1;
    for (const code of m.areaCodes ?? []) {
      areaCodeCount.set(code, (areaCodeCount.get(code) ?? 0) + 1);
    }
  }
  const reviewRate = args.mistakes.length > 0 ? reviewedCount / args.mistakes.length : 0;
  const topAreaCodes = Array.from(areaCodeCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([code, count]) => ({ code, count }));

  // ───── OJ 来源分布 ─────
  const siteBreakdown: Record<string, number> = {};
  for (const p of args.problems) {
    const site = siteOf(p.source);
    if (site) siteBreakdown[site] = (siteBreakdown[site] ?? 0) + 1;
  }

  // ───── 用时分布（仅 pass 的题） ─────
  const timeDistribution: StudentProfile['timeDistribution'] = {
    under5: 0,
    under15: 0,
    under30: 0,
    under60: 0,
    over60: 0,
  };
  for (const session of lastSessionByProblem.values()) {
    if (session.outcome !== 'pass') continue;
    const min = session.effectiveMs / 60_000;
    if (min < 5) timeDistribution.under5++;
    else if (min < 15) timeDistribution.under15++;
    else if (min < 30) timeDistribution.under30++;
    else if (min < 60) timeDistribution.under60++;
    else timeDistribution.over60++;
  }

  // ───── AI 辅助度（仅 pass 的题） ─────
  let totalHints = 0;
  let totalAnalyze = 0;
  let totalStuck = 0;
  let zeroHintPasses = 0;
  let passCount = 0;
  for (const session of lastSessionByProblem.values()) {
    if (session.outcome !== 'pass') continue;
    passCount++;
    totalHints += session.hintCount;
    totalAnalyze += session.analyzeCount;
    totalStuck += session.stuckCount;
    if (session.hintCount === 0) zeroHintPasses++;
  }

  // ───── 近 8 周趋势 ─────
  const weeklyTrend: StudentProfile['weeklyTrend'] = [];
  for (let i = 7; i >= 0; i--) {
    const wkStart = weekStart - i * 7 * MS_DAY;
    const wkEnd = wkStart + 7 * MS_DAY;
    let pPass = 0;
    let pMist = 0;
    let pMs = 0;
    for (const session of args.sessions) {
      if (session.startedAt < wkStart || session.startedAt >= wkEnd) continue;
      pMs += session.effectiveMs;
      if (session.outcome === 'pass') pPass++;
    }
    for (const m of args.mistakes) {
      if (m.createdAt < wkStart || m.createdAt >= wkEnd) continue;
      pMist++;
    }
    const d = new Date(wkStart);
    weeklyTrend.push({
      weekStart: wkStart,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      passed: pPass,
      mistakes: pMist,
      effectiveMs: pMs,
    });
  }

  return {
    todayMs,
    todayProblems: todayProblemSet.size,
    weekMs,
    weekProblems: weekProblemSet.size,
    monthProblems: monthProblemSet.size,
    totalEffectiveMs,

    currentStreakDays: currentStreak,
    bestStreakDays: bestStreak,
    streakUrgencyMs,

    totalProblems: lastSessionByProblem.size,
    passedProblems: passed,
    mistakeProblems: mistakeProblemIds.size,
    passRate: lastSessionByProblem.size > 0 ? passed / lastSessionByProblem.size : 0,

    difficultyBreakdown,

    pendingReview,
    reviewRate,
    verdictBreakdown,
    topAreaCodes,

    siteBreakdown,

    timeDistribution,

    avgHintsPerPass: passCount > 0 ? totalHints / passCount : 0,
    avgAnalyzePerPass: passCount > 0 ? totalAnalyze / passCount : 0,
    avgStuckPerPass: passCount > 0 ? totalStuck / passCount : 0,
    independentRate: passCount > 0 ? zeroHintPasses / passCount : 0,

    weeklyTrend,
  };
}
