/**
 * Coach：把"业务能力"封装为方法（题目识别 / 代码分析 / 错题总结）。
 *
 * 全部支持流式：UI 可在 AI 还在输出时就实时看到内容，不再 40s 干等。
 */
import { AIClient } from './ai/client';
import {
  buildAnalyzeCodePrompt,
  buildParseProblemPrompt,
  buildSummarizePrompt,
} from './ai/prompts';
import type {
  AnalysisHistoryEntry,
  AnalysisResult,
  CodeIssue,
  Lang,
  LearnerProfile,
  Mistake,
  Problem,
  ProblemSummary,
} from './types';

interface StreamOpts {
  /** 流式增量回调：UI 可实时把累积文本显示出来 */
  onChunk?: (delta: string, accumulated: string) => void;
  /** 重试事件回调 */
  onRetry?: (attempt: number, delayMs: number, reason: string) => void;
  signal?: AbortSignal;
}

export class Coach {
  constructor(private readonly ai: AIClient) {}

  updateClient(client: AIClient) {
    (this as any).ai = client;
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
      examples: data.examples,
      tags: data.tags ?? [],
      difficulty: data.difficulty,
      createdAt: Date.now(),
    };
  }

  /** 分析当前代码（流式） */
  async analyzeCode(
    args: {
      problem?: Problem;
      code: string;
      language: Lang;
      profile?: LearnerProfile;
      history?: AnalysisHistoryEntry[];
    },
    opts: StreamOpts = {},
  ): Promise<AnalysisResult> {
    const { system, user } = buildAnalyzeCodePrompt(args);
    const data = await this.ai.chatJsonStream<{
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

    const issues: CodeIssue[] = (data.issues ?? [])
      .filter((i): i is CodeIssue => typeof i.line === 'number' && !!i.message)
      .map((i) => ({
        line: i.line,
        endLine: i.endLine,
        severity: (i.severity ?? 'info') as CodeIssue['severity'],
        category: (i.category ?? 'style') as CodeIssue['category'],
        message: i.message,
        suggestion: i.suggestion,
      }))
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

    return {
      issues,
      complexitySummary: data.complexitySummary,
      overallComment: data.overallComment,
    };
  }

  /** 错题总结（流式） */
  async summarizeMistake(
    args: {
      problem: Problem;
      code: string;
      language: Lang;
      isMistake: boolean;
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
      return {
        id: shortId(),
        problemId: args.problem.id,
        problemTitle: args.problem.title,
        language: args.language,
        wrongCode: args.code,
        rootCause: data.rootCause ?? '',
        category: data.category ?? '其他',
        knowledgePoints: data.knowledgePoints ?? [],
        reviewTips: data.reviewTips ?? [],
        correctSketch: data.correctSketch,
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
