import type { Lang, Problem } from '../types';

export type CoachIntent =
  | 'understand_problem'
  | 'check_idea'
  | 'debug_runtime_error'
  | 'review_code'
  | 'explain_selection'
  | 'stuck_hint'
  | 'general_question';

export type CoachContextTemplate =
  | 'problem_only'
  | 'problem_with_code_summary'
  | 'runtime_debug'
  | 'selection'
  | 'full_code_review'
  | 'general';

export type CoachOutputMode = 'chat' | 'chat_with_inline_issues';

export type CoachSource = 'manual' | 'topbar' | 'selection' | 'runtime-error' | 'stuck';

export interface CoachRoute {
  intent: CoachIntent;
  contextTemplate: CoachContextTemplate;
  outputMode: CoachOutputMode;
  confidence: number;
  reason: string;
  routedBy: 'rule' | 'ai' | 'fallback';
}

export interface CoachSelection {
  text: string;
  language?: Lang | string;
  fileName?: string;
  startLine?: number;
  endLine?: number;
}

export interface CoachAskInput {
  text: string;
  source?: CoachSource;
  selection?: CoachSelection;
}

export interface CoachDraft {
  source?: CoachSource;
  selection?: CoachSelection;
}

export interface CoachBehavior {
  idleSeconds: number;
  acCount: number;
  wrongCount: number;
  inMistakeBook: boolean;
  /** 当前问题最近是否做过 AI 分析（带未修复的批注数） */
  unresolvedIssueCount: number;
}

export interface CoachRouteInput {
  text: string;
  source?: CoachSource;
  hasProblem: boolean;
  hasSelection: boolean;
  codeLength: number;
  codeLineCount: number;
  lastRun?: {
    exitCode: number;
    stderrBrief?: string;
  };
  recentAction?: string;
  behavior?: CoachBehavior;
}

export interface CoachContextInput {
  route: CoachRoute;
  userText: string;
  problem?: Problem;
  code?: string;
  language?: Lang;
  fileName?: string;
  selection?: CoachSelection;
  lastRun?: {
    exitCode: number;
    stdin?: string;
    stdout?: string;
    stderr?: string;
    durationMs?: number;
  };
  behavior?: CoachBehavior;
}
