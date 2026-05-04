/**
 * Coach：把"业务能力"封装为方法（题目识别 / 代码分析 / 错题总结）。
 *
 * 全部支持流式：UI 可在 AI 还在输出时就实时看到内容，不再 40s 干等。
 */
import { AIClient, parseJsonLoose } from './ai/client';
import {
  buildAcReviewPrompt,
  buildAnalyzeCodePrompt,
  buildAskQuestionPrompt,
  buildDiagnoseRuntimeErrorPrompt,
  buildDiagnosisAgentPrompt,
  buildExplainPastePrompt,
  buildFeynmanEvaluatorPrompt,
  buildFeynmanStudentPrompt,
  buildHackCasePrompt,
  buildParseProblemPrompt,
  buildPlainExplanationPrompt,
  buildPlanOrchestrationPrompt,
  buildProblemOverviewPrompt,
  buildSanityCheckConstraintsPrompt,
  buildSniffIntentPrompt,
  buildStuckHintPrompt,
  buildSummarizePrompt,
} from './ai/prompts';
import { pickRoute, type RouteHints, type RouteDecision, type RouterHints } from './ai/router';
import {
  buildAttackerPrompt,
  buildExplainerPrompt,
  buildFixSuggestorPrompt,
  type AttackerCandidate,
  type AttackerOutput,
  type ExecutorRunResult,
  type ExplainerOutput,
  type FixSuggestorOutput,
  type HackChainContext,
} from './hackChain';
import { isEffectivelyOffline } from '../lib/offlineMode';
import { formatFeaturesForPrompt } from './astLite';
import { buildCoachPrompt } from './coach/prompts';
import { effectiveContextWindowTokens } from './coach/contextBudget';
import type { CoachRoute } from './coach/types';
import type {
  AnalysisHistoryEntry,
  AnalysisResult,
  CodeIssue,
  Lang,
  LearnerProfile,
  Mistake,
  Problem,
  ProblemSummary,
  SubmissionVerdict,
} from './types';

interface StreamOpts {
  /** 流式增量回调：UI 可实时把累积文本显示出来 */
  onChunk?: (delta: string, accumulated: string) => void;
  /** 重试事件回调 */
  onRetry?: (attempt: number, delayMs: number, reason: string) => void;
  signal?: AbortSignal;
}

export class Coach {
  /**
   * @param ai 主 AIClient（云端，做录题/错题归档/对拍等"高质量后台"任务）
   * @param aiFast 可选的 fastLane 客户端（本地 ollama，做实时前台 analyze/stuck/explain）
   *               未提供时所有任务回落到 ai
   */
  constructor(
    private readonly ai: AIClient,
    private readonly aiFast?: AIClient,
    /** 用户在 Settings 自定义的路由阈值，未传走 DEFAULT_ROUTER_HINTS */
    private routerHints?: RouterHints,
    private readonly aiQuality?: AIClient,
  ) {}

  updateClient(client: AIClient) {
    (this as any).ai = client;
  }

  updateFastClient(client: AIClient | undefined) {
    (this as any).aiFast = client;
  }

  updateQualityClient(client: AIClient | undefined) {
    (this as any).aiQuality = client;
  }

  /** 用户改了路由阈值时调用 */
  updateRouterHints(hints: RouterHints | undefined) {
    this.routerHints = hints;
  }

  private qualityClient(): AIClient {
    return this.aiQuality ?? this.ai;
  }

  /**
   * 根据任务信号路由到 fastLane 或主 client。
   * 把决策对象返回方便上层把 reason 透传给 UI。
   */
  private pick(hints: RouteHints): { client: AIClient; decision: RouteDecision } {
    let decision = pickRoute(hints, !!this.aiFast, this.routerHints);
    // 离线模式：如果已经在 fastLane 路径上则保持；否则若有 fastLane 则强制 fastLane；否则 keep cloud（会失败但 UI 会兜底）
    if (isEffectivelyOffline() && !decision.useFast && this.aiFast) {
      decision = {
        useFast: true,
        reason: '离线模式：本地 FastLane 兜底',
        label: '⚡ 离线本地',
      };
    }
    const client = decision.useFast ? this.aiFast! : this.ai;
    // dev 日志：能在 console 看到每次路由决策
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(
        `[AI Router] ${hints.taskKind} → ${decision.label}（${decision.reason}）`,
      );
    }
    return { client, decision };
  }

  private offlineClient(): AIClient | null {
    return isEffectivelyOffline() ? this.aiFast ?? null : null;
  }

  /** 把粘贴的题目原文 -> 结构化 Problem（流式） */
  async parseProblem(rawText: string, opts: StreamOpts = {}): Promise<Problem> {
    const { system, user } = buildParseProblemPrompt(rawText);
    const client = this.offlineClient() ?? this.ai;
    const data = await client.chatJsonStream<{
      title?: string;
      statement?: string;
      inputFormat?: string;
      outputFormat?: string;
      constraints?: string;
      plainExplanation?: string;
      examples?: Array<{ input: string; output: string; explanation?: string }>;
      tags?: string[];
      difficulty?: 'easy' | 'medium' | 'hard';
    }>({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 6000,
      ...opts,
    });

    return {
      id: shortId(),
      title: data.title?.trim() || '未命名题目',
      statement: data.statement?.trim() || '',
      inputFormat: data.inputFormat,
      outputFormat: data.outputFormat,
      constraints: data.constraints,
      plainExplanation: data.plainExplanation?.trim(),
      examples: data.examples,
      tags: data.tags ?? [],
      difficulty: data.difficulty,
      createdAt: Date.now(),
    };
  }

  /**
   * 仅生成「白话解释」。
   * 用于已经从 OJ（如洛谷）抓回结构化字段、但 plainExplanation 字段空缺的题目。
   * 一次性返回（非流式）以便后台静默补齐。
   */
  async generatePlainExplanation(args: {
    title: string;
    statement: string;
    examples?: Array<{ input: string; output: string }>;
  }): Promise<string> {
    const { system, user } = buildPlainExplanationPrompt(args);
    const callOnceWith = async (client: AIClient) =>
      (
        await client.chat({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          maxTokens: 600,
          temperature: 0.4,
        })
      ).trim();
    const offline = this.offlineClient();
    if (offline) {
      try {
        const text = await callOnceWith(offline);
        if (text) return text;
      } catch (e) {
        if (typeof console !== 'undefined') {
          console.debug(
            `[Coach.generatePlainExplanation] offline fastLane failed: ${(e as any)?.message?.slice?.(0, 80)}`,
          );
        }
      }
      return '';
    }
    // 主云端：重试至多 2 次（共 3 次尝试）+ 退避
    for (let i = 0; i < 3; i++) {
      try {
        const text = await callOnceWith(this.ai);
        if (text) return text;
      } catch (e) {
        if (typeof console !== 'undefined') {
          console.debug(
            `[Coach.generatePlainExplanation] cloud attempt ${i + 1} threw: ${(e as any)?.message?.slice?.(0, 80)}`,
          );
        }
      }
      if (typeof console !== 'undefined') {
        console.debug(`[Coach.generatePlainExplanation] cloud attempt ${i + 1} empty, retrying`);
      }
      if (i < 2) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
    // 主云端连续失败 → fastLane 本地兜底（如果用户启用了 fastLane）
    if (this.aiFast) {
      if (typeof console !== 'undefined') {
        console.debug('[Coach.generatePlainExplanation] cloud failed 3 times, falling back to fastLane');
      }
      try {
        const text = await callOnceWith(this.aiFast);
        if (text) return text;
      } catch (e) {
        if (typeof console !== 'undefined') {
          console.debug(
            `[Coach.generatePlainExplanation] fastLane fallback also failed: ${(e as any)?.message?.slice?.(0, 80)}`,
          );
        }
      }
    }
    return '';
  }

  /**
   * P1 题眼速读：激活新题时云端读一次，给「头条 + 注意点」。
   *
   * 始终走主云端（cloud），因为：① 一题只生成一次，成本可控；② 大模型抓抽象能力强；
   * ③ 这事是后台静默的，速度不重要。
   *
   * 返回 null 表示模型输出无法解析或调用失败 —— 上层应静默忽略，不缓存空值。
   */
  async generateProblemOverview(args: {
    title: string;
    statement: string;
    constraints?: string;
    examples?: Array<{ input: string; output: string }>;
    difficulty?: 'easy' | 'medium' | 'hard';
    tags?: string[];
    signal?: AbortSignal;
  }): Promise<{ headline: string; notes: string[] } | null> {
    const { system, user } = buildProblemOverviewPrompt(args);
    type OverviewRaw = {
      headline?: string;
      title?: string;
      brief?: string;
      summary?: string;
      notes?: unknown;
      keyNotes?: unknown;
      points?: unknown;
      tips?: unknown;
    };
    const callWith = (client: AIClient, isCloud: boolean) =>
      client.chatJson<OverviewRaw>({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 500,
        temperature: 0.3,
        signal: args.signal,
        // 云端允许 2 次：题眼速读输出很短，但偶发 JSON 截断/格式漂移时重试可显著提升稳定性；
        // fastLane 本地稳定，仍允许默认 3 次 retry 增加成功率
        jsonAttempts: isCloud ? 2 : 3,
      });
    let data: OverviewRaw;
    const offline = this.offlineClient();
    if (offline) {
      try {
        data = await callWith(offline, false);
      } catch (e) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[Coach.generateProblemOverview] offline fastLane failed', e);
        }
        return null;
      }
    } else {
    try {
      data = await callWith(this.ai, true);
    } catch (e) {
      // 云端挂了（429/529/超时） → fastLane 本地兜底（如果用户启用了 fastLane）
      if (this.aiFast) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug(
            `[Coach.generateProblemOverview] cloud failed (${(e as any)?.message?.slice?.(0, 80)}), trying fastLane`,
          );
        }
        try {
          data = await callWith(this.aiFast, false);
        } catch (e2) {
          if (typeof console !== 'undefined' && console.debug) {
            console.debug('[Coach.generateProblemOverview] fastLane also failed', e2);
          }
          return null;
        }
      } else {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[Coach.generateProblemOverview] failed', e);
        }
        return null;
      }
    }
    }
    try {
      // 小模型偶发用同义字段名，全部接受（headline / title / brief / summary; notes / keyNotes / points / tips）
      const headline = (
        data.headline ?? data.title ?? data.brief ?? data.summary ?? ''
      )
        .toString()
        .trim();
      if (!headline) return null;
      const rawNotes = data.notes ?? data.keyNotes ?? data.points ?? data.tips;
      const notes = Array.isArray(rawNotes)
        ? rawNotes
            .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
            .map((n) => n.trim().slice(0, 80))
            .slice(0, 3)
        : [];
      return {
        headline: headline.slice(0, 60),
        notes,
      };
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Coach.generateProblemOverview] parse failed', e);
      }
      return null;
    }
  }

  /**
   * P2 AC 后复盘：对比"你的代码 vs 经典最优解"+ 推荐变种题。
   *
   * 始终走云端（cloud）：① 一题 AC 后只跑一次，成本可控；② 需要大模型抓"最优解法"+"变种题型"的能力。
   * 失败返回 null，上层应静默忽略，不缓存。
   */
  async generateAcReview(args: {
    problem: Problem;
    language: Lang;
    code: string;
    signal?: AbortSignal;
  }): Promise<{
    passingPattern: string;
    betterApproach?: { name: string; complexity: string; gist: string };
    followUps: string[];
  } | null> {
    const { system, user } = buildAcReviewPrompt(args);
    type AcReviewRaw = {
      passingPattern?: string;
      pattern?: string;
      summary?: string;
      approach?: string;
      betterApproach?: unknown;
      followUps?: unknown;
    };
    const callWith = (client: AIClient) =>
      client.chatJson<AcReviewRaw>({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 600,
        temperature: 0.3,
        signal: args.signal,
      });
    let data: AcReviewRaw;
    const offline = this.offlineClient();
    if (offline) {
      try {
        data = await callWith(offline);
      } catch (e) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[Coach.generateAcReview] offline fastLane failed', e);
        }
        return null;
      }
    } else {
    try {
      data = await callWith(this.ai);
    } catch (e) {
      // 主云端连续失败 → fastLane 本地兜底（如果用户启用了 fastLane）
      if (this.aiFast) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug(
            `[Coach.generateAcReview] cloud failed (${(e as any)?.message?.slice?.(0, 80)}), trying fastLane`,
          );
        }
        try {
          data = await callWith(this.aiFast);
        } catch (e2) {
          if (typeof console !== 'undefined' && console.debug) {
            console.debug('[Coach.generateAcReview] fastLane also failed', e2);
          }
          return null;
        }
      } else {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[Coach.generateAcReview] failed', e);
        }
        return null;
      }
    }
    }
    try {
      // LLM 偶发用同义字段名（pattern / summary / approach），全部接受
      const passingPattern = (
        data.passingPattern ?? data.pattern ?? data.summary ?? data.approach ?? ''
      )
        .toString()
        .trim();
      if (!passingPattern) return null;
      // betterApproach 可以是 null / undefined / 完整对象
      let betterApproach:
        | { name: string; complexity: string; gist: string }
        | undefined;
      if (data.betterApproach && typeof data.betterApproach === 'object') {
        const b = data.betterApproach as Record<string, unknown>;
        const name = (b.name ?? '').toString().trim();
        const complexity = (b.complexity ?? '').toString().trim();
        const gist = (b.gist ?? '').toString().trim();
        if (name && gist) {
          betterApproach = {
            name: name.slice(0, 30),
            complexity: complexity.slice(0, 30),
            gist: gist.slice(0, 200),
          };
        }
      }
      const followUps = Array.isArray(data.followUps)
        ? data.followUps
            .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
            .map((n) => n.trim().slice(0, 60))
            .slice(0, 3)
        : [];
      return {
        passingPattern: passingPattern.slice(0, 80),
        betterApproach,
        followUps,
      };
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Coach.generateAcReview] failed', e);
      }
      return null;
    }
  }

  /**
   * B 路线 — 学习规划 Agent 子 Agent 1：学情诊断（cloud）。
   *
   * 输入近期学习数据（mistakes / sessions / failure stats）→ 输出薄弱点诊断。
   * 失败返回 null 让上层降级（也可以用规则兜底，但保守起见返回 null）。
   */
  async generateLearningDiagnosis(args: {
    recentMistakes: Array<{
      title: string;
      category: string;
      rootCause?: string;
      verdict?: string;
      daysAgo: number;
    }>;
    weekStats: {
      totalProblems: number;
      totalSubmissions: number;
      acRate: number;
      avgSessionMinutes: number;
    };
    stuckProblems: Array<{ title: string; failureCount: number; verdicts: string[] }>;
    signal?: AbortSignal;
  }): Promise<{
    weakConcepts: string[];
    strengths: string[];
    todayFocus: string;
  } | null> {
    const { system, user } = buildDiagnosisAgentPrompt(args);
    type DiagRaw = {
      weakConcepts?: unknown;
      weak?: unknown;
      weaknesses?: unknown;
      weakAreas?: unknown;
      strengths?: unknown;
      strong?: unknown;
      strongAreas?: unknown;
      todayFocus?: string;
      focus?: string;
      today?: string;
    };
    const callWith = (client: AIClient, isCloud: boolean) =>
      client.chatJson<DiagRaw>({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 400,
        temperature: 0.3,
        signal: args.signal,
        // 云端只 1 次 retry：失败立即降级 fastLane（不浪费时间）
        jsonAttempts: isCloud ? 1 : 3,
      });
    let data: DiagRaw;
    try {
      data = await callWith(this.ai, true);
    } catch (e) {
      // 云端挂了 → fastLane 兜底
      if (this.aiFast) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug(
            `[Coach.generateLearningDiagnosis] cloud failed (${(e as any)?.message?.slice?.(0, 80)}), trying fastLane`,
          );
        }
        try {
          data = await callWith(this.aiFast, false);
        } catch (e2) {
          if (typeof console !== 'undefined' && console.debug) {
            console.debug('[Coach.generateLearningDiagnosis] fastLane also failed', e2);
          }
          return null;
        }
      } else {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[Coach.generateLearningDiagnosis] failed', e);
        }
        return null;
      }
    }
    try {
      // 小模型同义字段兜底（weak / weaknesses / weakAreas; strong / strongAreas; focus / today）
      const cleanList = (v: unknown, max: number): string[] =>
        Array.isArray(v)
          ? v
              .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
              .map((x) => x.trim().slice(0, 30))
              .slice(0, max)
          : [];
      const weakRaw = data.weakConcepts ?? data.weak ?? data.weaknesses ?? data.weakAreas;
      const weakConcepts = cleanList(weakRaw, 3);
      if (weakConcepts.length === 0) return null;
      const strongRaw = data.strengths ?? data.strong ?? data.strongAreas;
      const strengths = cleanList(strongRaw, 2);
      const todayFocus = (data.todayFocus ?? data.focus ?? data.today ?? '')
        .toString()
        .trim()
        .slice(0, 40);
      if (!todayFocus) return null;
      return { weakConcepts, strengths, todayFocus };
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Coach.generateLearningDiagnosis] parse failed', e);
      }
      return null;
    }
  }

  /**
   * B 路线 — 学习规划 Agent 子 Agent 3：计划编排（cloud）。
   *
   * 输入诊断结果 + 候选题目 → 输出今日学习路径。
   * 失败返回 null。
   */
  async generatePlanOrchestration(args: {
    diagnosis: { weakConcepts: string[]; strengths: string[]; todayFocus: string };
    candidates: {
      newProblems: Array<{
        bankId: string;
        title: string;
        difficulty?: string;
        tags?: string[];
        reason: string;
      }>;
      reviewMistakes: Array<{
        mistakeId: string;
        problemTitle: string;
        category: string;
        reason: string;
      }>;
    };
    signal?: AbortSignal;
  }): Promise<{
    headline: string;
    estimatedMinutes: number;
    steps: Array<{
      kind: 'new-problem' | 'review-mistake' | 'concept-recall';
      title: string;
      bankId?: string;
      mistakeId?: string;
      problemId?: string;
      reason: string;
      estimatedMinutes: number;
    }>;
    encouragement: string;
  } | null> {
    const { system, user } = buildPlanOrchestrationPrompt(args);
    try {
      // 同义字段兜底：headline / title; estimatedMinutes / minutes / totalMinutes;
      // steps / plan / tasks; encouragement / motto / cheer
      const data = await this.ai.chatJson<{
        headline?: string;
        title?: string;
        estimatedMinutes?: number;
        minutes?: number;
        totalMinutes?: number;
        steps?: unknown;
        plan?: unknown;
        tasks?: unknown;
        encouragement?: string;
        motto?: string;
        cheer?: string;
      }>({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 800,
        temperature: 0.3,
        signal: args.signal,
      });
      const headline = (data.headline ?? data.title ?? '').toString().trim().slice(0, 50);
      if (!headline) return null;
      const minutesRaw = data.estimatedMinutes ?? data.minutes ?? data.totalMinutes;
      const estimatedMinutes =
        typeof minutesRaw === 'number' && minutesRaw > 0
          ? Math.min(120, Math.round(minutesRaw))
          : 30;
      // 校验 steps：只接受合法 kind + 引用合法的 bankId/mistakeId
      const validBankIds = new Set(args.candidates.newProblems.map((p) => p.bankId));
      const validMistakeIds = new Set(args.candidates.reviewMistakes.map((m) => m.mistakeId));
      const stepsRaw = data.steps ?? data.plan ?? data.tasks;
      const rawSteps: unknown[] = Array.isArray(stepsRaw) ? stepsRaw : [];
      const steps = rawSteps
        .map((rs) => {
          if (!rs || typeof rs !== 'object') return null;
          const r = rs as Record<string, unknown>;
          // 同义字段：kind / type / action; 同义值：'newProblem' → 'new-problem' 等
          const rawKind = ((r.kind ?? r.type ?? r.action ?? '') as string).toString();
          const kind = rawKind
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .replace(/_/g, '-')
            .toLowerCase();
          const title = ((r.title ?? r.name ?? '') as string).toString().trim().slice(0, 40);
          const reason = ((r.reason ?? r.why ?? '') as string).toString().trim().slice(0, 80);
          const minutesRawStep = r.estimatedMinutes ?? r.minutes ?? r.duration;
          const est =
            typeof minutesRawStep === 'number' && minutesRawStep > 0
              ? Math.min(60, Math.round(minutesRawStep))
              : 10;
          if (kind === 'new-problem') {
            const bankId = (r.bankId ?? '').toString().trim();
            if (!bankId || !validBankIds.has(bankId)) return null;
            return {
              kind: 'new-problem' as const,
              title: title || '新题练习',
              bankId,
              reason,
              estimatedMinutes: est,
            };
          }
          if (kind === 'review-mistake') {
            const mistakeId = (r.mistakeId ?? '').toString().trim();
            if (!mistakeId || !validMistakeIds.has(mistakeId)) return null;
            return {
              kind: 'review-mistake' as const,
              title: title || '复习错题',
              mistakeId,
              reason,
              estimatedMinutes: est,
            };
          }
          if (kind === 'concept-recall') {
            return {
              kind: 'concept-recall' as const,
              title: title || '概念回顾',
              reason,
              estimatedMinutes: est,
            };
          }
          return null;
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .slice(0, 5);
      if (steps.length === 0) return null;
      const encouragement = (
        (data.encouragement ?? data.motto ?? data.cheer ?? '') as string
      )
        .toString()
        .trim()
        .slice(0, 60);
      return {
        headline,
        estimatedMinutes,
        steps,
        encouragement: encouragement || '今天稳一点，把昨天没解决的搞通。',
      };
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Coach.generatePlanOrchestration] failed', e);
      }
      return null;
    }
  }

  /**
   * 费曼模式 - "AI 学生" Agent：模拟第一次接触题目的同学，提澄清问题。
   *
   * 总是走云端（cloud）：高质量追问需要较强的 reasoning 能力（要看出讲解者的逻辑漏洞）。
   * 失败返回 null，UI 应显示"暂时没整理出追问点，换个角度再讲一遍？"之类的兜底。
   */
  async generateFeynmanStudentReply(args: {
    problem: { title: string; statement: string };
    conversation: Array<{ role: 'user' | 'student'; text: string }>;
    userTurn: string;
    turnIndex: number;
    signal?: AbortSignal;
  }): Promise<{
    studentReply: string;
    questions: string[];
    confusion?: string;
  } | null> {
    const { system, user } = buildFeynmanStudentPrompt(args);
    try {
      const data = await this.ai.chatJson<{
        studentReply?: string;
        questions?: unknown;
        confusion?: string;
      }>({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 360,
        temperature: 0.6, // 高一点让 AI 学生显得"自然"
        signal: args.signal,
      });
      const studentReply = (data.studentReply ?? '').toString().trim();
      if (!studentReply) return null;
      const questions = Array.isArray(data.questions)
        ? data.questions
            .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
            .map((q) => q.trim().slice(0, 120))
            .slice(0, 3)
        : [];
      const confusion = data.confusion?.toString().trim().slice(0, 60) || undefined;
      return {
        studentReply: studentReply.slice(0, 200),
        questions,
        confusion,
      };
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Coach.generateFeynmanStudentReply] failed', e);
      }
      return null;
    }
  }

  /**
   * 费曼模式 - "AI 评委" Agent：根据多轮对话评估讲解者掌握程度。
   */
  async generateFeynmanEvaluation(args: {
    problem: { title: string; statement: string };
    conversation: Array<{ role: 'user' | 'student'; text: string }>;
    signal?: AbortSignal;
  }): Promise<{
    scores: { clarity: number; logic: number; accuracy: number };
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
    verdict: 'mastered' | 'partial' | 'struggling';
    summary: string;
  } | null> {
    const { system, user } = buildFeynmanEvaluatorPrompt(args);
    const callEvaluator = async (client: AIClient) => {
      const raw = await client.chat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 650,
        temperature: 0.3,
        signal: args.signal,
      });
      return parseJsonLoose<{
        scores?: { clarity?: number; logic?: number; accuracy?: number };
        strengths?: unknown;
        weaknesses?: unknown;
        suggestions?: unknown;
        verdict?: string;
        summary?: string;
      }>(raw);
    };
    try {
      let data: Awaited<ReturnType<typeof callEvaluator>>;
      try {
        data = await callEvaluator(this.ai);
      } catch (e) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[Coach.generateFeynmanEvaluation] failed', e);
        }
        return null;
      }
      const clamp = (v: unknown) => {
        const n = typeof v === 'number' ? v : 0;
        return Math.max(0, Math.min(10, Math.round(n)));
      };
      const scores = {
        clarity: clamp(data.scores?.clarity),
        logic: clamp(data.scores?.logic),
        accuracy: clamp(data.scores?.accuracy),
      };
      const toStrArr = (v: unknown, max: number, lim: number) =>
        Array.isArray(v)
          ? v
              .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
              .map((s) => s.trim().slice(0, lim))
              .slice(0, max)
          : [];
      const verdictRaw = (data.verdict ?? '').toString().toLowerCase();
      const verdict: 'mastered' | 'partial' | 'struggling' =
        verdictRaw === 'mastered' || verdictRaw === 'partial' || verdictRaw === 'struggling'
          ? verdictRaw
          : 'partial';
      const strengths = toStrArr(data.strengths, 2, 100);
      const weaknesses = toStrArr(data.weaknesses, 2, 100);
      const suggestions = toStrArr(data.suggestions, 2, 100);
      const summary =
        (data.summary ?? '').toString().trim().slice(0, 150) ||
        weaknesses[0] ||
        suggestions[0] ||
        '讲解完成，但评估摘要缺失。';
      return {
        scores,
        strengths,
        weaknesses,
        suggestions,
        verdict,
        summary,
      };
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Coach.generateFeynmanEvaluation] failed', e);
      }
      return null;
    }
  }

  /** 分析当前代码（流式） */
  async analyzeCode(
    args: {
      problem?: Problem;
      code: string;
      language: Lang;
      profile?: LearnerProfile;
      history?: AnalysisHistoryEntry[];
      /** 同题/草稿区下的其它文件（让 AI 知道上下文：暴力对照 / 笔记 / 多版本） */
      siblings?: Array<{ name: string; language: string; content: string }>;
      /** 最近一次本地运行快照：exitCode + stderr + stdin，让 AI 看到运行结果给对症建议 */
      runtimeContext?: {
        exitCode: number;
        stdin?: string;
        stdout?: string;
        stderr?: string;
        durationMs?: number;
        timestamp?: number;
      };
      /**
       * P3 屡败 escalation：上层注入；prompt 切到「换思路」模式。
       * 触发由 store.FAILURE_STATS_ESCALATE_THRESHOLD 控制（默认同题 7 天内非-AC ≥2 次即触发）。
       */
      escalation?: {
        failureCount: number;
        recentVerdicts: string[];
      };
      /**
       * AST-Light 启发式结构特征（本地纯逻辑 Agent 输出）。
       * 喂给 prompt 让 LLM 看到客观的结构信号，避免空想出"O(n^2)"这种结论。
       */
      astFeatures?: import('./astLite').CodeStructFeatures;
      proactive?: boolean;
    },
    opts: StreamOpts = {},
  ): Promise<AnalysisResult> {
    // AST-Light 结构特征 → prompt 字符串（仅当上层提供时注入）
    const astFeatureBlock = args.astFeatures
      ? formatFeaturesForPrompt(args.astFeatures)
      : undefined;
    const { system, user } = buildAnalyzeCodePrompt({ ...args, astFeatureBlock });
    // 路由：根据代码长度 + 题目复杂度选 fast / main
    const { client, decision } = this.pick({
      taskKind: 'analyze',
      problem: args.problem,
      codeLength: args.code.length,
      codeLineCount: args.code.split('\n').length,
    });
    const data = await client.chatJsonStream<{
      issues?: Array<Partial<CodeIssue>>;
      complexitySummary?: string;
      overallComment?: string;
    }>({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 8000,
      ...opts,
    });

    // 计算合法行号范围（用于 clamp AI 可能数错的 line）
    const totalLines = Math.max(1, args.code.split('\n').length);

    // 1) 基础校验：line 是数字、message 非空
    const raw = (data.issues ?? []).filter(
      (i): i is CodeIssue => typeof i.line === 'number' && !!i.message,
    );

    // 2) clamp line 到 [1, totalLines]，把超界的拉回最后一行（不丢，但标记可能行号不准）
    const clamped = raw.map((i) => {
      const inRange = i.line >= 1 && i.line <= totalLines;
      const line = inRange ? i.line : Math.min(Math.max(1, Math.round(i.line)), totalLines);
      return {
        line,
        endLine: i.endLine,
        severity: (i.severity ?? 'info') as CodeIssue['severity'],
        category: (i.category ?? 'readability') as CodeIssue['category'],
        message: i.message,
        suggestion: i.suggestion,
      };
    });

    // 3) 同一 (line, severity) + message 前 30 字 重复时合并（AI 偶尔重复输出）
    const seen = new Map<string, CodeIssue>();
    for (const it of clamped) {
      const key = `${it.line}|${it.severity}|${(it.message ?? '').slice(0, 30)}`;
      if (!seen.has(key)) seen.set(key, it);
    }

    // 4) 按 severity 严重度排序
    const issues: CodeIssue[] = Array.from(seen.values()).sort(
      (a, b) => severityRank(b.severity) - severityRank(a.severity) || a.line - b.line,
    );

    return {
      issues,
      complexitySummary: data.complexitySummary,
      overallComment: data.overallComment,
      routeInfo: {
        useFast: decision.useFast,
        label: decision.label,
        reason: decision.reason,
      },
    };
  }

  /**
   * 学生在做题时问问题 → 流式回答。
   * 跟 analyze 不同：返回纯文本 markdown 而不是 JSON。
   * 通过 onChunk 回调让 UI 实时渲染。
   */
  async askQuestion(
    args: {
      problem?: Problem;
      code?: string;
      language?: Lang;
      question: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
    },
    opts: StreamOpts = {},
  ): Promise<string> {
    // 问题分类决定 maxTokens 和 system 指令长度
    const { messages, maxTokens, kind } = buildAskQuestionPrompt(args);
    // 路由：长问题 / 复杂题 → 主云端
    const { client } = this.pick({
      taskKind: 'ask',
      problem: args.problem,
      codeLength: args.code?.length,
      codeLineCount: args.code?.split('\n').length,
      questionLength: args.question.length,
    });
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(`[Ask Kind] ${kind} → maxTokens ${maxTokens}`);
    }
    let acc = '';
    for await (const _ of client.chatStream({
      messages,
      maxTokens,
      temperature: 0.4,
      ...opts,
      onChunk: (delta, accumulated) => {
        acc = accumulated;
        opts.onChunk?.(delta, accumulated);
      },
    })) {
      // 仅迭代消费，文本累积在 acc 里
    }
    return acc;
  }

  async askCoach(
    args: {
      route: CoachRoute;
      context: string;
      userText: string;
      problem?: Problem;
      code?: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
    },
    opts: StreamOpts = {},
  ): Promise<string> {
    const { client } = this.pick({
      taskKind: 'ask',
      problem: args.problem,
      codeLength: args.code?.length,
      codeLineCount: args.code?.split('\n').length,
      questionLength: args.userText.length,
    });
    const { messages, maxTokens, historyMeta } = buildCoachPrompt({
      ...args,
      contextWindowTokens: effectiveContextWindowTokens(client.getConfig()),
    });
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(
        `[Coach.askCoach] context=${historyMeta.contextWindowTokens}, history=${historyMeta.selectedMessages} msgs/${historyMeta.selectedRounds} rounds, budget=${historyMeta.historyTokenBudget}`,
      );
    }
    let acc = '';
    for await (const _ of client.chatStream({
      messages,
      maxTokens,
      temperature: 0.35,
      ...opts,
      onChunk: (delta, accumulated) => {
        acc = accumulated;
        opts.onChunk?.(delta, accumulated);
      },
    })) {
    }
    return acc;
  }

  /** 错题总结（流式） */
  async summarizeMistake(
    args: {
      problem: Problem;
      code: string;
      language: Lang;
      isMistake: boolean;
      verdict?: SubmissionVerdict;
      userNote?: string;
    },
    opts: StreamOpts = {},
  ): Promise<Mistake | ProblemSummary> {
    const { system, user } = buildSummarizePrompt(args);
    // 主路径走云端流式（前端 UI 需要 onChunk 实时显示）
    let data: any;
    const offline = this.offlineClient();
    if (offline) {
      data = await offline.chatJson<any>({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 4000,
        temperature: 0.3,
        signal: opts.signal,
      });
    } else {
    try {
      data = await this.ai.chatJsonStream<any>({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 6000,
        ...opts,
        // 云端只 1 次：失败立即 fallback 本地，避免 retry 吃满 timeout
        jsonAttempts: 1,
      });
    } catch (e) {
      // 云端挂了（429/529/SSE 中断/超时）→ fastLane 本地兜底（非流式即可，错题总结对实时性要求低）
      if (this.aiFast) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug(
            `[Coach.summarizeMistake] cloud failed (${(e as any)?.message?.slice?.(0, 80)}), trying fastLane`,
          );
        }
        data = await this.aiFast.chatJson<any>({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          maxTokens: 4000, // 本地稍降，避免 4B 模型 6000 输出更不稳
          temperature: 0.3,
          signal: opts.signal,
        });
      } else {
        throw e;
      }
    }
    }

    // 小模型偶发用同义字段名 → 全部接受兜底
    // rootCause: cause / reason / why
    // category:  type / kind / tag
    // knowledgePoints: knowledge / topics / tags / points
    // reviewTips: tips / suggestions / advice
    // hackCase:   counterCase / counterexample
    // correctSketch: sketch / fix / correctIdea
    // techniques: skills / methods
    // complexity: timeComplexity / bigO
    // extensions: variants / followUps / similar
    // summary:    overview / brief
    const dictGet = (...keys: string[]): unknown => {
      for (const k of keys) {
        const v = data?.[k];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };

    if (args.isMistake) {
      const hackCaseRaw = dictGet('hackCase', 'counterCase', 'counterexample');
      const hackCase = typeof hackCaseRaw === 'string' ? hackCaseRaw.trim() : '';
      const tipsRaw = dictGet('reviewTips', 'tips', 'suggestions', 'advice');
      const reviewTips: string[] = Array.isArray(tipsRaw)
        ? (tipsRaw as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      if (hackCase) reviewTips.unshift(`Hack case：${hackCase}`);
      // 验证 areaCodes：只保留在 taxonomy 里有效的 code
      const rawAreas: unknown = data.areaCodes;
      const areaCodes: string[] = Array.isArray(rawAreas)
        ? (rawAreas as unknown[])
            .filter((x): x is string => typeof x === 'string')
            .filter((c) => /^Y[1-4]\.[a-z]+\.[a-z_]+$/.test(c))
            .slice(0, 2)
        : [];
      const knowledgePointsRaw = dictGet('knowledgePoints', 'knowledge', 'topics', 'tags', 'points');
      const knowledgePoints = Array.isArray(knowledgePointsRaw)
        ? (knowledgePointsRaw as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      const correctSketchRaw = dictGet('correctSketch', 'sketch', 'fix', 'correctIdea');
      return {
        id: shortId(),
        problemId: args.problem.id,
        problemTitle: args.problem.title,
        language: args.language,
        wrongCode: args.code,
        rootCause: (dictGet('rootCause', 'cause', 'reason', 'why') as string | undefined) ?? '',
        category: (dictGet('category', 'type', 'kind', 'tag') as string | undefined) ?? '其他',
        knowledgePoints,
        reviewTips,
        correctSketch:
          typeof correctSketchRaw === 'string' ? correctSketchRaw : undefined,
        verdict: args.verdict,
        userNote: args.userNote,
        areaCodes,
        createdAt: Date.now(),
        reviewCount: 0,
      } as Mistake;
    }
    const knowledgePointsRaw = dictGet('knowledgePoints', 'knowledge', 'topics', 'tags', 'points');
    const techniquesRaw = dictGet('techniques', 'skills', 'methods');
    const extensionsRaw = dictGet('extensions', 'variants', 'followUps', 'similar');
    return {
      knowledgePoints: Array.isArray(knowledgePointsRaw) ? knowledgePointsRaw : [],
      techniques: Array.isArray(techniquesRaw) ? techniquesRaw : [],
      complexity:
        (dictGet('complexity', 'timeComplexity', 'bigO') as string | undefined) ?? '',
      extensions: Array.isArray(extensionsRaw) ? extensionsRaw : [],
      summary: (dictGet('summary', 'overview', 'brief') as string | undefined) ?? '',
    } as ProblemSummary;
  }

  /**
   * 卡住引导：苏格拉底式提问。
   * 输出纯文本 1-2 个问题，不超过 80 字。轻量、便宜。
   */
  async getStuckHint(
    args: { problem: Problem; code: string; language: Lang },
    opts: StreamOpts = {},
  ): Promise<string> {
    const { system, user } = buildStuckHintPrompt(args);
    // 路由：stuck-hint 极短反馈，几乎一定走 fast
    const { client } = this.pick({
      taskKind: 'stuck',
      problem: args.problem,
      codeLength: args.code.length,
      codeLineCount: args.code.split('\n').length,
    });
    const text = await client.chat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 200,
      temperature: 0.7,
      ...opts,
    });
    return text.trim();
  }

  /**
   * 解释粘贴段：JSON 输出。
   */
  async explainPaste(
    args: { problem?: Problem; snippet: string; language: Lang },
    opts: StreamOpts = {},
  ): Promise<{
    summary: string;
    fitsContext: boolean;
    concerns: string[];
    suggestion: string;
  }> {
    const { system, user } = buildExplainPastePrompt(args);
    // 路由：explain-paste 短代码片段优先本地，超长（>2000）走主
    const { client } = this.pick({
      taskKind: 'explain',
      problem: args.problem,
      codeLength: args.snippet.length,
      codeLineCount: args.snippet.split('\n').length,
    });
    const data = await client.chatJsonStream<any>({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 1500,
      ...opts,
    });
    return {
      summary: data.summary ?? '',
      fitsContext: !!data.fitsContext,
      concerns: data.concerns ?? [],
      suggestion: data.suggestion ?? '',
    };
  }

  // ────────────────────────────────────────────────
  // ★ Coach 主动嗅探（FastLane 专属）：
  //   **只**走 aiFast（本地 ollama）。若 fastLane 未配置一律返回 noop，
  //   绝不回落到主 client（避免静默烧云端 token）。
  //   调用方负责节流和静默落地（写 trace + 角标，不弹窗）。
  // ────────────────────────────────────────────────

  /** Coach 嗅探类任务是否可用：fastLane 配好才会有 aiFast */
  get fastLaneAvailable(): boolean {
    return !!this.aiFast;
  }

  /**
   * A. 编译/运行错误归因。学生跑代码失败时调，本地秒级出一句话。
   *
   * 返回 null 表示：fastLane 未配 / 模型输出无法用 / 调用失败。调用方应静默忽略。
   */
  async diagnoseRuntimeError(args: {
    problem?: Problem;
    language: Lang;
    code: string;
    exitCode: number;
    stderrTail: string;
    stdinHead?: string;
    signal?: AbortSignal;
  }): Promise<{
    errorClass: string;
    likelyLine: number | null;
    oneLineHint: string;
  } | null> {
    if (!this.aiFast) return null; // 防御纵深：与主体隔离，绝不蹭主 client
    const { system, user } = buildDiagnoseRuntimeErrorPrompt(args);
    try {
      const data = await this.aiFast.chatJson<{
        errorClass?: string;
        likelyLine?: number | null;
        oneLineHint?: string;
      }>({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 200,
        temperature: 0.2,
        signal: args.signal,
      });
      const hint = (data.oneLineHint ?? '').trim();
      if (!hint) return null;
      const totalLines = Math.max(1, args.code.split('\n').length);
      let line: number | null = null;
      if (typeof data.likelyLine === 'number' && Number.isFinite(data.likelyLine)) {
        const v = Math.round(data.likelyLine);
        if (v >= 1 && v <= totalLines) line = v;
      }
      return {
        errorClass: (data.errorClass ?? '其他').toString().slice(0, 24),
        likelyLine: line,
        oneLineHint: hint.slice(0, 120),
      };
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Coach.diagnoseRuntimeError] fastLane failed', e);
      }
      return null;
    }
  }

  /**
   * C. 数据范围 sanity check。题目首次跑通样例后调一次，扫一眼数据范围风险。
   *
   * 返回的 risks 数组可能为空（说明本地模型扫不出风险），上层应静默不展示。
   */
  async sanityCheckConstraints(args: {
    problem: Problem;
    language: Lang;
    code: string;
    signal?: AbortSignal;
  }): Promise<string[]> {
    if (!this.aiFast) return []; // 防御纵深：与主体隔离，绝不蹭主 client
    const { system, user } = buildSanityCheckConstraintsPrompt(args);
    try {
      const data = await this.aiFast.chatJson<{ risks?: unknown }>({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 250,
        temperature: 0.2,
        signal: args.signal,
      });
      if (!Array.isArray(data.risks)) return [];
      return data.risks
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .map((r) => r.trim().slice(0, 60))
        .slice(0, 3);
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Coach.sanityCheckConstraints] fastLane failed', e);
      }
      return [];
    }
  }

  /**
   * B. 题意偏离嗅探。学生停下来 ≥90s 且代码净增 ≥30 字时调。
   *
   * **保守判断**：返回 onTrack=true（含错误回退）时一律不要展示给学生。
   * 只有 onTrack=false 且 evidence 非空才落地为一条 trace + 角标。
   */
  async sniffIntent(args: {
    problem: Problem;
    language: Lang;
    code: string;
    signal?: AbortSignal;
  }): Promise<{ onTrack: boolean; evidence: string }> {
    // 防御纵深：fastLane 没配 → 默认在轨（保守，不打扰，绝不蹭主 client）
    if (!this.aiFast) return { onTrack: true, evidence: '' };
    const { system, user } = buildSniffIntentPrompt(args);
    try {
      const data = await this.aiFast.chatJson<{
        onTrack?: boolean;
        evidence?: string;
      }>({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 150,
        temperature: 0.3,
        signal: args.signal,
      });
      const onTrack = data.onTrack !== false; // 默认 true（保守）
      const evidence = (data.evidence ?? '').trim().slice(0, 100);
      return { onTrack, evidence };
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Coach.sniffIntent] fastLane failed', e);
      }
      // 失败 → 默认在轨（保守，不打扰）
      return { onTrack: true, evidence: '' };
    }
  }

  /**
   * 主动出 hack case：跑通样例后让 Coach 自己挑战边界。
   * 返回结构化 JSON，让上层可以直接把 stdin 灌进运行终端。
   */
  /**
   * Hack Chain Step 1：Attacker Agent — 产候选攻击 case 列表（≥1，≤3）。
   * 与单步 generateHackCase 区别：返回 candidates[] 而非单个，方便 Executor 挨个跑。
   */
  async generateHackAttacker(
    ctx: HackChainContext,
    opts: StreamOpts = {},
  ): Promise<AttackerOutput> {
    const { system, user } = buildAttackerPrompt(ctx);
    const client = this.ai;
    const data = await client.chatJsonStream<{
      hypothesis?: string;
      candidates?: Array<{
        kind?: string;
        description?: string;
        stdin?: string;
        expectedOutput?: string;
        expectedRisk?: string;
        targetBugType?: string;
        validationMethod?: string;
        oracle?: {
          language?: string;
          code?: string;
        };
        metamorphic?: {
          transformedStdin?: string;
          relation?: string;
          expectedRelation?: string;
        };
      }>;
    }>({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 2400,
      ...opts,
    });
    const allowed: Array<AttackerCandidate['kind']> = [
      'min_boundary',
      'max_boundary',
      'duplicates',
      'monotonic',
      'random_stress',
      'special_structure',
      'anti_greedy',
      'overflow',
      'edge',
      'large',
      'degenerate',
      'tricky',
    ];
    const allowedValidation: Array<NonNullable<AttackerCandidate['validationMethod']>> = [
      'expected_output',
      'oracle',
      'metamorphic',
      'runtime_only',
    ];
    const candidates: AttackerCandidate[] = (data.candidates ?? [])
      .map((c) => {
        const kind = (allowed as string[]).includes(c.kind ?? '')
          ? (c.kind as AttackerCandidate['kind'])
          : 'edge';
        const stdin = (c.stdin ?? '').replace(/\r\n/g, '\n');
        const oracleCode = c.oracle?.code?.replace(/\r\n/g, '\n').trim();
        const transformedStdin = c.metamorphic?.transformedStdin?.replace(/\r\n/g, '\n').trim();
        const relation: NonNullable<AttackerCandidate['metamorphic']>['relation'] =
          c.metamorphic?.relation === 'different_output' ? 'different_output' : 'same_output';
        const requestedValidation = (allowedValidation as string[]).includes(c.validationMethod ?? '')
          ? (c.validationMethod as AttackerCandidate['validationMethod'])
          : undefined;
        const validationMethod: NonNullable<AttackerCandidate['validationMethod']> =
          requestedValidation === 'oracle' && oracleCode
            ? 'oracle'
            : requestedValidation === 'metamorphic' && transformedStdin
              ? 'metamorphic'
              : requestedValidation === 'expected_output' && c.expectedOutput?.trim()
                ? 'expected_output'
                : c.expectedOutput?.trim()
                  ? 'expected_output'
                  : 'runtime_only';
        return {
          kind,
          description: (c.description ?? '').trim() || '边界 case',
          stdin: stdin.trim(),
          expectedOutput: c.expectedOutput?.trim() || undefined,
          expectedRisk: c.expectedRisk?.trim() || undefined,
          targetBugType: c.targetBugType?.trim() || undefined,
          validationMethod,
          oracle:
            validationMethod === 'oracle' && oracleCode
              ? { language: 'python' as const, code: oracleCode }
              : undefined,
          metamorphic:
            validationMethod === 'metamorphic' && transformedStdin
              ? {
                  transformedStdin,
                  relation,
                  expectedRelation: c.metamorphic?.expectedRelation?.trim() || undefined,
                }
              : undefined,
        };
      })
      .filter((c) => !!c.stdin)
      .slice(0, 5);
    return {
      hypothesis: (data.hypothesis ?? '').trim() || '（攻击者未给出明确假设）',
      candidates,
    };
  }

  /**
   * Hack Chain Step 3：Explainer Agent — 解释为啥学生代码挂了。
   * 输入：Attacker 假设 + 成功 hack 的 case + Executor 真实结果。
   */
  async generateHackExplanation(
    args: {
      ctx: HackChainContext;
      attackerHypothesis: string;
      winningCandidate: AttackerCandidate;
      executorResult: ExecutorRunResult;
    },
    opts: StreamOpts = {},
  ): Promise<ExplainerOutput> {
    const { system, user } = buildExplainerPrompt(args);
    const client = this.ai;
    const data = await client.chatJsonStream<{
      diagnosis?: string;
      rootCause?: string;
    }>({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 600,
      ...opts,
    });
    return {
      diagnosis: (data.diagnosis ?? '').trim() || '（无诊断结论）',
      rootCause: (data.rootCause ?? '').trim() || '（未给出根因分析）',
    };
  }

  /**
   * Hack Chain Step 4：FixSuggestor Agent — 给修改方向，不直接给答案。
   */
  async generateHackFixSuggestion(
    args: {
      ctx: HackChainContext;
      attackerHypothesis: string;
      diagnosis: string;
      rootCause: string;
    },
    opts: StreamOpts = {},
  ): Promise<FixSuggestorOutput> {
    const { system, user } = buildFixSuggestorPrompt(args);
    const client = this.ai;
    const data = await client.chatJsonStream<{
      direction?: string;
      hint?: string;
      conceptKeywords?: unknown;
    }>({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 500,
      ...opts,
    });
    const kw = Array.isArray(data.conceptKeywords)
      ? data.conceptKeywords
          .map((x) => String(x ?? '').trim())
          .filter((x) => !!x)
          .slice(0, 4)
      : [];
    return {
      direction: (data.direction ?? '').trim() || '（无方向提示）',
      hint: (data.hint ?? '').trim() || '（无引导问题）',
      conceptKeywords: kw,
    };
  }

  async generateHackCase(
    args: {
      problem: Problem;
      code: string;
      language: Lang;
      passedSamples?: Array<{ input: string; output: string }>;
    },
    opts: StreamOpts = {},
  ): Promise<{
    stdin: string;
    expectedOutput?: string;
    rationale: string;
    severity: 'edge' | 'large' | 'degenerate' | 'tricky';
  }> {
    const { system, user } = buildHackCasePrompt(args);
    // 路由：hack case 偏创造性，优先用主模型（云端），代码很短再考虑 fast
    const { client } = this.pick({
      taskKind: 'analyze',
      problem: args.problem,
      codeLength: args.code.length,
      codeLineCount: args.code.split('\n').length,
    });
    const data = await client.chatJsonStream<{
      stdin?: string;
      expectedOutput?: string;
      rationale?: string;
      severity?: string;
    }>({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 1200,
      ...opts,
    });
    const allowed: Array<'edge' | 'large' | 'degenerate' | 'tricky'> = [
      'edge',
      'large',
      'degenerate',
      'tricky',
    ];
    const severity = (allowed as string[]).includes(data.severity ?? '')
      ? (data.severity as 'edge' | 'large' | 'degenerate' | 'tricky')
      : 'edge';
    return {
      stdin: (data.stdin ?? '').replace(/\r\n/g, '\n').trim(),
      expectedOutput: data.expectedOutput?.trim() || undefined,
      rationale: (data.rationale ?? '').trim() || '边界 case 挑战',
      severity,
    };
  }
}

function severityRank(s: string): number {
  switch (s) {
    case 'error':
      return 4;
    case 'warning':
      return 3;
    case 'info':
      return 2;
    case 'hint':
      return 1;
    default:
      return 0;
  }
}

export function shortId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
