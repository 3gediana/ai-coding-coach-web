/**
 * Coach：把"业务能力"封装为方法（题目识别 / 代码分析 / 错题总结）。
 *
 * 全部支持流式：UI 可在 AI 还在输出时就实时看到内容，不再 40s 干等。
 */
import { AIClient } from './ai/client';
import {
  buildAnalyzeCodePrompt,
  buildAskQuestionPrompt,
  buildDiagnoseRuntimeErrorPrompt,
  buildExplainPastePrompt,
  buildHackCasePrompt,
  buildParseProblemPrompt,
  buildPlainExplanationPrompt,
  buildSanityCheckConstraintsPrompt,
  buildSniffIntentPrompt,
  buildStuckHintPrompt,
  buildSummarizePrompt,
} from './ai/prompts';
import { pickRoute, type RouteHints, type RouteDecision, type RouterHints } from './ai/router';
import { buildCoachPrompt } from './coach/prompts';
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
  ) {}

  updateClient(client: AIClient) {
    (this as any).ai = client;
  }

  updateFastClient(client: AIClient | undefined) {
    (this as any).aiFast = client;
  }

  /** 用户改了路由阈值时调用 */
  updateRouterHints(hints: RouterHints | undefined) {
    this.routerHints = hints;
  }

  /**
   * 根据任务信号路由到 fastLane 或主 client。
   * 把决策对象返回方便上层把 reason 透传给 UI。
   */
  private pick(hints: RouteHints): { client: AIClient; decision: RouteDecision } {
    const decision = pickRoute(hints, !!this.aiFast, this.routerHints);
    const client = decision.useFast ? this.aiFast! : this.ai;
    // dev 日志：能在 console 看到每次路由决策
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(
        `[AI Router] ${hints.taskKind} → ${decision.label}（${decision.reason}）`,
      );
    }
    return { client, decision };
  }

  /** 把粘贴的题目原文 -> 结构化 Problem（流式） */
  async parseProblem(rawText: string, opts: StreamOpts = {}): Promise<Problem> {
    const { system, user } = buildParseProblemPrompt(rawText);
    const data = await this.ai.chatJsonStream<{
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
      statement: data.statement?.trim() || rawText.slice(0, 1000),
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
    const text = await this.ai.chat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 600,
      temperature: 0.4,
    });
    return text.trim();
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
    },
    opts: StreamOpts = {},
  ): Promise<AnalysisResult> {
    const { system, user } = buildAnalyzeCodePrompt(args);
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
    const { messages, maxTokens } = buildCoachPrompt(args);
    const { client } = this.pick({
      taskKind: 'ask',
      problem: args.problem,
      codeLength: args.code?.length,
      codeLineCount: args.code?.split('\n').length,
      questionLength: args.userText.length,
    });
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
    const data = await this.ai.chatJsonStream<any>({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 6000,
      ...opts,
    });

    if (args.isMistake) {
      const hackCase = (data.hackCase as string | undefined)?.trim();
      const reviewTips: string[] = [...(data.reviewTips ?? [])];
      if (hackCase) reviewTips.unshift(`Hack case：${hackCase}`);
      // 验证 areaCodes：只保留在 taxonomy 里有效的 code
      const rawAreas: unknown = data.areaCodes;
      const areaCodes: string[] = Array.isArray(rawAreas)
        ? (rawAreas as unknown[])
            .filter((x): x is string => typeof x === 'string')
            .filter((c) => /^Y[1-4]\.[a-z]+\.[a-z_]+$/.test(c))
            .slice(0, 2)
        : [];
      return {
        id: shortId(),
        problemId: args.problem.id,
        problemTitle: args.problem.title,
        language: args.language,
        wrongCode: args.code,
        rootCause: data.rootCause ?? '',
        category: data.category ?? '其他',
        knowledgePoints: data.knowledgePoints ?? [],
        reviewTips,
        correctSketch: data.correctSketch,
        verdict: args.verdict,
        userNote: args.userNote,
        areaCodes,
        createdAt: Date.now(),
        reviewCount: 0,
      } as Mistake;
    }
    return {
      knowledgePoints: data.knowledgePoints ?? [],
      techniques: data.techniques ?? [],
      complexity: data.complexity ?? '',
      extensions: data.extensions ?? [],
      summary: data.summary ?? '',
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
