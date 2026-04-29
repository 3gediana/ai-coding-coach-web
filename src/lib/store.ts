/**
 * 全局状态 v2：多文件版本。
 *
 * 关键概念：
 * - "scope" = 题目作用域 ID。problemId 或 '__draft__'（未关联题目时的草稿区）
 * - 每个 scope 下挂 N 个 CodeFile
 * - activeFileIdByScope[scope] = 当前编辑器在编辑哪个 file
 *
 * 旧数据自动迁移：localStorage.aicc.code.v1 → IndexedDB files
 */
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';

import type {
  AIConfig,
  AnalysisHistoryEntry,
  AnalysisResult,
  CodeFile,
  FileLang,
  Lang,
  LearnerProfile,
  Mistake,
  OnboardingStep,
  Problem,
  Session,
  SubmissionVerdict,
} from '../core/types';
import { AIClient } from '../core/ai/client';
import { Coach } from '../core/analyzer';
import { storage } from './storage';
import { DEFAULT_AI_CONFIG } from './presets';
import { isLocalOllamaUrl } from './ollama';
import { buildLearnerProfile, codeHash } from '../core/utils';
import {
  buildLearningEngine,
  type BankProblem,
  type LearningCard,
  type ProgressOverview,
} from '../core/recommend';
import bankData from '../data/problemBank.json';

const PROBLEM_BANK = bankData as BankProblem[];

/** 今天日期 YYYY-MM-DD（本地时区） */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 从主 cfg 派生 fastLane 的 AIConfig：
 *   - fastLane 必须 enabled
 *   - baseUrl 必须是本地（localhost / 127.* / RFC1918）
 *   - 否则返回 null（Coach 会回落到主 client）
 */
function deriveFastConfig(cfg: AIConfig): AIConfig | null {
  const fl = cfg.fastLane;
  if (!fl?.enabled || !fl.baseUrl?.trim() || !fl.model?.trim()) return null;
  if (!isLocalOllamaUrl(fl.baseUrl)) return null;
  return {
    provider: 'ollama',
    baseUrl: fl.baseUrl.trim(),
    apiKey: '',
    model: fl.model.trim(),
    // 兜底默认值。注意：analyzer.ts 的每个任务（analyzeCode / stuckHint / explainPaste）
    // 都会显式传 maxTokens 覆盖此值，所以这里只在调用方未传时生效。
    maxTokens: 2048,
    temperature: 0.3,
    timeoutMs: 60_000,
    maxRetries: 1,
    // 用户在 fastLane 区域配置的 num_ctx；不填走 client.ts 默认 20480
    numCtx: fl.numCtx,
  };
}

/** 提交结果选项（错题或 AC 总结） */
/** 学生提问历史一条消息：用户问 / AI 答（流式时 streaming=true） */
export interface QAMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  /** assistant 消息流式中标记，结束后置 false。用户消息无此字段 */
  streaming?: boolean;
  /** 失败时的错误（仅 assistant 消息可能有） */
  error?: string;
}

export interface SubmitOpts {
  /** true 入错题本（非 AC），false 仅做通过总结 */
  isMistake: boolean;
  verdict?: SubmissionVerdict;
  /** 用户自述错误现象，可选 */
  userNote?: string;
}

const LS_AI_CFG = 'aicc.aiConfig.v1';
const LS_DEFAULT_LANG = 'aicc.defaultLang.v1';
const LS_OLD_CODE = 'aicc.code.v1'; // 旧数据迁移用

const DRAFT_SCOPE = '__draft__';

// ============== Tasks ==============

export type TaskKind =
  | 'parse-problem'
  | 'analyze-code'
  | 'summarize-mistake'
  | 'compare-files'
  | 'stuck-hint'
  | 'explain-paste';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  kind: TaskKind;
  label: string;
  status: TaskStatus;
  progress: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  error?: string;
  retryAttempt?: number;
  retryReason?: string;
  meta?: Record<string, unknown>;
}

interface TaskHandler {
  run: (
    onChunk: (delta: string, accumulated: string) => void,
    onRetry: (attempt: number, delayMs: number, reason: string) => void,
    signal: AbortSignal,
  ) => Promise<unknown>;
  onSuccess?: (result: unknown) => void | Promise<void>;
  onFailure?: (err: Error) => void;
}

/** 一次代码运行的快照（用于 analyzeCode 喂给 AI 看 stderr/exitCode） */
export interface RunSnapshot {
  fileId: string;
  fileName: string;
  language: string;
  exitCode: number;
  stdin: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  timestamp: number;
}

const handlersById = new Map<string, TaskHandler>();
const abortersById = new Map<string, AbortController>();
const MAX_CONCURRENT = 3;

// ============== Store ==============

interface State {
  aiConfig: AIConfig;
  ai: AIClient;
  coach: Coach;

  // 数据
  problems: Problem[];
  mistakes: Mistake[];
  sessions: Session[];
  activeProblemId: string | null;

  // 文件 — 多文件核心
  /** 默认新建文件的语言（C++/Python/C） */
  defaultLang: Lang;
  /** scope ('__draft__' 或 problemId) → 该 scope 下所有 file */
  filesByScope: Record<string, CodeFile[]>;
  /** 每个 scope 当前活跃的 file id */
  activeFileIdByScope: Record<string, string | null>;

  // 分析结果（按 problemId 缓存最新一次）
  analysisByProblem: Record<string, AnalysisResult>;
  streamPreviewById: Record<string, string>;

  // 学生提问历史（按 problemId 隔离），实时流式更新
  qaByProblem: Record<string, QAMessage[]>;
  /** 当前正在流式回答的 problemId（同一时间只有一个 ask in flight） */
  qaPendingProblemId: string | null;

  tasks: Task[];

  // UI
  sidebarTab: 'problems' | 'mistakes' | 'sessions' | 'dashboard' | null;
  settingsOpen: boolean;
  problemEditorOpen: boolean;
  problemBrowserOpen: boolean;
  cmdPaletteOpen: boolean;
  submitModalOpen: boolean;
  /** 底部运行时面板是否展开 */
  runtimePaneOpen: boolean;

  // 卡住检测 / 粘贴提示 / 默认开关
  lastEditAt: number;
  lastHintAt: number;
  currentHint: string | null;
  stuckHintEnabled: boolean;
  /** QA 输入框预填字符串（CodeEditor 框选 "问 AI" 时把代码 prefill 到 QAPanel） */
  askPrefill: string | null;
  /** FeedbackPanel 当前 tab（'analyze' / 'ask'），升到 store 让外部能切 */
  feedbackTab: 'analyze' | 'ask';
  /** Onboarding 当前步骤 */
  onboardingStep: OnboardingStep;
  /** Learning engine（学习引擎）输出：进度 + 行动卡 */
  learningOverview: ProgressOverview | null;
  learningCards: LearningCard[];
  /** 学习卡片今天是否被关闭过 */
  learningCardDismissedDate: string | null;
  /** 对拍：选中的两个 fileId */
  diffSelection: string[];
  /** 最近一次运行结果（按 scope）— 让 analyzeCode 能拿到 stderr/exitCode 给出对症建议 */
  lastRunByScope: Record<string, RunSnapshot>;

  // ===== actions =====
  setAIConfig: (cfg: AIConfig) => void;
  setDefaultLang: (l: Lang) => void;
  setActiveProblem: (id: string | null) => Promise<void>;

  // 文件 CRUD
  createFile: (opts: {
    scope?: string;
    name?: string;
    language?: FileLang;
    content?: string;
    activate?: boolean;
  }) => Promise<CodeFile>;
  renameFile: (fileId: string, newName: string) => Promise<void>;
  duplicateFile: (fileId: string, newName?: string) => Promise<CodeFile>;
  deleteFile: (fileId: string) => Promise<void>;
  pinFile: (fileId: string, pinned: boolean) => Promise<void>;
  setActiveFile: (scope: string, fileId: string | null) => void;
  updateFileContent: (fileId: string, content: string) => void;
  changeFileLanguage: (fileId: string, language: FileLang) => Promise<void>;

  // 对拍选择
  toggleDiffSelection: (fileId: string) => void;
  clearDiffSelection: () => void;
  /** RuntimePane 运行结束后写入；analyzeCode 之前会读取作为上下文 */
  setLastRun: (scope: string, snap: RunSnapshot) => void;
  clearLastRun: (scope: string) => void;

  refreshProblems: () => Promise<void>;
  refreshMistakes: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  refreshAll: () => Promise<void>;

  enqueueParseProblem: (rawText: string) => string;
  enqueueAnalyze: (opts?: { reason?: string }) => string | null;
  enqueueSummarize: (arg: boolean | SubmitOpts) => string | null;
  enqueueDiff: () => string | null;

  cancelTask: (id: string) => void;
  retryTask: (id: string) => void;
  clearFinishedTasks: () => void;

  deleteProblem: (id: string) => Promise<void>;
  deleteMistake: (id: string) => Promise<void>;
  /** 标记错题已复习（更新 reviewedAt + reviewCount++） */
  markMistakeReviewed: (id: string) => Promise<void>;

  setSidebarTab: (t: State['sidebarTab']) => void;
  setSettingsOpen: (v: boolean) => void;
  setProblemEditorOpen: (v: boolean) => void;
  setProblemBrowserOpen: (v: boolean) => void;

  /** 学生在做题时问问题：流式回答到 qaByProblem[scope] */
  askQuestion: (question: string) => Promise<void>;
  /** 清空当前 scope 的提问历史 */
  clearQA: (scope: string) => void;
  setCmdPaletteOpen: (v: boolean) => void;
  setSubmitModalOpen: (v: boolean) => void;
  setRuntimePaneOpen: (v: boolean) => void;

  // 卡住检测 / 粘贴
  markEdit: () => void;
  setStuckHintEnabled: (v: boolean) => void;
  dismissHint: () => void;
  enqueueStuckHint: () => string | null;
  setAskPrefill: (s: string | null) => void;
  setFeedbackTab: (t: 'analyze' | 'ask') => void;

  // Onboarding actions
  /** 启动 onboarding：注入 demo 题 + bug 代码 → 切到 wait-analyze */
  startOnboarding: () => Promise<void>;
  /** 推进到下一步（参数指定到哪步） */
  advanceOnboarding: (to: OnboardingStep) => void;
  /** 用户跳过 / 完成 → idle 并标记 done 到 localStorage */
  finishOnboarding: () => void;

  // Learning engine actions
  /** 重新计算学习概览 + 行动卡（错题 / 已做题变化时调用） */
  refreshLearningEngine: () => void;
  /** 用户关闭今天的学习卡片（跨天会重新出现） */
  dismissLearningCard: () => void;
  /** 把内置题库的题加到 problems（学生点 "新题" 行动卡时调用） */
  addBankProblem: (bankId: string) => Promise<string | null>;

  // 外部导入（Tampermonkey 推送）
  /** 接收 TM 推送的 payload，去重 / 调 sam 多模态 / parseProblem / 入库 / 激活 */
  handleImportPayload: (payload: import('./importReceiver').ImportPayload) => Promise<void>;
}

// ============== 初始化 ==============

const initialAIConfig: AIConfig = (() => {
  try {
    const raw = localStorage.getItem(LS_AI_CFG);
    if (raw) {
      const parsed = JSON.parse(raw);
      // 浅合并 + fastLane 嵌套兜底（老用户 localStorage 里没 fastLane 字段时用默认值预填）
      return {
        ...DEFAULT_AI_CONFIG,
        ...parsed,
        fastLane: { ...DEFAULT_AI_CONFIG.fastLane!, ...(parsed.fastLane ?? {}) },
      };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_AI_CONFIG;
})();

const initialDefaultLang: Lang = ((): Lang => {
  const v = localStorage.getItem(LS_DEFAULT_LANG) as Lang | null;
  if (v === 'cpp' || v === 'c' || v === 'python') return v;
  return 'cpp';
})();

const sessionId = nanoid();

// ============== 默认模板 ==============

export function defaultCode(lang: FileLang): string {
  if (lang === 'python') {
    return `# 在这里写你的解法\n\ndef solve():\n    pass\n\nif __name__ == "__main__":\n    solve()\n`;
  }
  if (lang === 'markdown') {
    return `# 解题思路\n\n## 思路\n\n## 复杂度\n\n- 时间：O(?)\n- 空间：O(?)\n\n## 参考\n\n`;
  }
  if (lang === 'plaintext') {
    return '';
  }
  if (lang === 'c') {
    // C 标准头文件，覆盖最常用的：IO / 内存 / 字符串 / 数学
    return `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <math.h>\n\nint main() {\n    \n    return 0;\n}\n`;
  }
  // cpp / 默认：显式列出常用 header（让学生看到具体用了什么）
  return `#include <iostream>\n#include <vector>\n#include <string>\n#include <algorithm>\n#include <cmath>\n#include <cstring>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n`;
}

export function defaultFileName(lang: FileLang, existing: string[]): string {
  const ext =
    lang === 'python'
      ? 'py'
      : lang === 'markdown'
        ? 'md'
        : lang === 'plaintext'
          ? 'txt'
          : lang === 'c'
            ? 'c'
            : 'cpp';
  const base = lang === 'markdown' ? 'notes' : 'main';
  let name = `${base}.${ext}`;
  if (!existing.includes(name)) return name;
  let i = 2;
  while (existing.includes(`${base}-v${i}.${ext}`)) i++;
  return `${base}-v${i}.${ext}`;
}

// ============== Store 创建 ==============

export const useStore = create<State>((set, get) => {
  const ai = new AIClient(initialAIConfig);
  // fastLane: 本地 ollama 客户端，专做实时前台任务
  const fastCfg = deriveFastConfig(initialAIConfig);
  const aiFast = fastCfg ? new AIClient(fastCfg) : undefined;
  const coach = new Coach(ai, aiFast, initialAIConfig.routerHints);

  // ---- 任务队列 ----

  const tick = () => {
    const tasks = get().tasks;
    const running = tasks.filter((t) => t.status === 'running').length;
    if (running >= MAX_CONCURRENT) return;
    const next = tasks.find((t) => t.status === 'queued');
    if (!next) return;
    void runTask(next.id);
  };

  const runTask = async (taskId: string) => {
    const handler = handlersById.get(taskId);
    if (!handler) return;
    const ctrl = new AbortController();
    abortersById.set(taskId, ctrl);

    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, status: 'running', startedAt: Date.now() } : t,
      ),
    }));

    try {
      const result = await handler.run(
        (_d, accumulated) => {
          set((s) => ({
            streamPreviewById: { ...s.streamPreviewById, [taskId]: accumulated },
            tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, progress: accumulated } : t)),
          }));
        },
        (attempt, _delayMs, reason) => {
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === taskId
                ? { ...t, retryAttempt: attempt, retryReason: reason }
                : t,
            ),
          }));
        },
        ctrl.signal,
      );

      const now = Date.now();
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'done',
                finishedAt: now,
                durationMs: t.startedAt ? now - t.startedAt : undefined,
              }
            : t,
        ),
      }));
      await handler.onSuccess?.(result);
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError' || ctrl.signal.aborted;
      const now = Date.now();
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: isAbort ? 'cancelled' : 'failed',
                finishedAt: now,
                durationMs: t.startedAt ? now - t.startedAt : undefined,
                error: isAbort ? '已取消' : String(e?.message || e),
              }
            : t,
        ),
      }));
      if (!isAbort) {
        handler.onFailure?.(e);
        const lbl = get().tasks.find((t) => t.id === taskId)?.label ?? '任务';
        toast.error(`${lbl} 失败：${String(e?.message || e).slice(0, 80)}`);
      }
    } finally {
      abortersById.delete(taskId);
      tick();
    }
  };

  const enqueue = (
    kind: TaskKind,
    label: string,
    handler: TaskHandler,
    meta?: Record<string, unknown>,
  ): string => {
    const id = nanoid();
    handlersById.set(id, handler);
    set((s) => ({
      tasks: [{ id, kind, label, status: 'queued', progress: '', meta }, ...s.tasks],
    }));
    setTimeout(tick, 0);
    return id;
  };

  // ---- helpers ----

  const langOfFile = (lang: FileLang): Lang => {
    if (lang === 'cpp' || lang === 'c' || lang === 'python') return lang;
    return 'cpp'; // markdown/plaintext 文件分析时按 cpp 走（应该不会触发）
  };

  return {
    aiConfig: initialAIConfig,
    ai,
    coach,

    problems: [],
    mistakes: [],
    sessions: [],
    activeProblemId: null,

    defaultLang: initialDefaultLang,
    filesByScope: {},
    activeFileIdByScope: {},

    analysisByProblem: {},
    streamPreviewById: {},

    qaByProblem: {},
    qaPendingProblemId: null,

    tasks: [],

    sidebarTab: 'problems',
    settingsOpen: false,
    problemEditorOpen: false,
    problemBrowserOpen: false,
    cmdPaletteOpen: false,
    submitModalOpen: false,
    runtimePaneOpen: localStorage.getItem('aicc.runtimePane.v1') === 'on',

    lastEditAt: Date.now(),
    lastHintAt: 0,
    currentHint: null,
    // 卡住引导默认 OFF（学生想认真思考时不被打扰；用 TopBar 的「求助」按钮主动召唤）
    stuckHintEnabled: localStorage.getItem('aicc.stuckHint.v1') === 'on',
    askPrefill: null,
    feedbackTab: 'analyze',
    // Onboarding：localStorage 已标记完成 → idle；否则 wait-analyze 状态会在 App 启动时由触发器决定是否进 inject
    onboardingStep: localStorage.getItem('aicc.onboarding.v1') === 'done' ? 'idle' : 'idle',
    learningOverview: null,
    learningCards: [],
    learningCardDismissedDate: localStorage.getItem('aicc.learning.dismissed.v1'),
    diffSelection: [],
    lastRunByScope: {},

    setAIConfig: (cfg) => {
      try {
        localStorage.setItem(LS_AI_CFG, JSON.stringify(cfg));
      } catch {
        /* ignore */
      }
      get().ai.updateConfig(cfg);
      // 同步 fastLane：根据新 cfg 派生本地 client
      const newFastCfg = deriveFastConfig(cfg);
      if (newFastCfg) {
        // 已有 fast client → updateConfig；没有 → 新建并塞给 coach
        const existing: AIClient | undefined = (get().coach as any).aiFast;
        if (existing) {
          existing.updateConfig(newFastCfg);
        } else {
          get().coach.updateFastClient(new AIClient(newFastCfg));
        }
      } else {
        get().coach.updateFastClient(undefined);
      }
      // 同步路由阈值
      get().coach.updateRouterHints(cfg.routerHints);
      set({ aiConfig: cfg });
    },

    setDefaultLang: (l) => {
      localStorage.setItem(LS_DEFAULT_LANG, l);
      set({ defaultLang: l });
    },

    setActiveProblem: async (id) => {
      const st = get();
      set({ activeProblemId: id, diffSelection: [] });
      const scope = id ?? DRAFT_SCOPE;
      const list = st.filesByScope[scope] ?? [];
      // 该 scope 没有文件 → 自动创建一个默认文件
      if (list.length === 0) {
        await get().createFile({ scope, activate: true });
      } else if (!st.activeFileIdByScope[scope]) {
        // 有文件但没活跃，激活第一个
        set((s) => ({
          activeFileIdByScope: { ...s.activeFileIdByScope, [scope]: list[0].id },
        }));
      }
    },

    // ===== 文件 CRUD =====

    createFile: async ({ scope, name, language, content, activate = true }) => {
      const st = get();
      const scopeKey = scope ?? st.activeProblemId ?? DRAFT_SCOPE;
      const lang: FileLang = language ?? st.defaultLang;
      const existing = st.filesByScope[scopeKey] ?? [];
      const finalName = name?.trim() || defaultFileName(lang, existing.map((f) => f.name));
      const file: CodeFile = {
        id: nanoid(),
        problemId: scopeKey === DRAFT_SCOPE ? null : scopeKey,
        name: finalName,
        language: lang,
        content: content ?? defaultCode(lang),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await storage.saveFile(file);
      set((s) => ({
        filesByScope: {
          ...s.filesByScope,
          [scopeKey]: [...(s.filesByScope[scopeKey] ?? []), file],
        },
        activeFileIdByScope: activate
          ? { ...s.activeFileIdByScope, [scopeKey]: file.id }
          : s.activeFileIdByScope,
      }));
      return file;
    },

    renameFile: async (fileId, newName) => {
      const st = get();
      const scopeKey = findScopeOfFile(st, fileId);
      if (!scopeKey) return;
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file) return;
      const updated = { ...file, name: newName.trim(), updatedAt: Date.now() };
      await storage.saveFile(updated);
      set((s) => ({
        filesByScope: {
          ...s.filesByScope,
          [scopeKey]: (s.filesByScope[scopeKey] ?? []).map((f) =>
            f.id === fileId ? updated : f,
          ),
        },
      }));
    },

    duplicateFile: async (fileId, newName) => {
      const st = get();
      const scopeKey = findScopeOfFile(st, fileId);
      if (!scopeKey) throw new Error('file not found');
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file) throw new Error('file not found');
      const existing = st.filesByScope[scopeKey] ?? [];
      const fname =
        newName ?? smartDupName(file.name, existing.map((f) => f.name));
      const dup: CodeFile = {
        ...file,
        id: nanoid(),
        name: fname,
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await storage.saveFile(dup);
      set((s) => ({
        filesByScope: {
          ...s.filesByScope,
          [scopeKey]: [...(s.filesByScope[scopeKey] ?? []), dup],
        },
        activeFileIdByScope: { ...s.activeFileIdByScope, [scopeKey]: dup.id },
      }));
      return dup;
    },

    deleteFile: async (fileId) => {
      const st = get();
      const scopeKey = findScopeOfFile(st, fileId);
      if (!scopeKey) return;
      await storage.deleteFile(fileId);
      const remaining = (st.filesByScope[scopeKey] ?? []).filter((f) => f.id !== fileId);
      const wasActive = st.activeFileIdByScope[scopeKey] === fileId;
      set((s) => ({
        filesByScope: { ...s.filesByScope, [scopeKey]: remaining },
        activeFileIdByScope: {
          ...s.activeFileIdByScope,
          [scopeKey]: wasActive ? remaining[0]?.id ?? null : s.activeFileIdByScope[scopeKey],
        },
        diffSelection: s.diffSelection.filter((id) => id !== fileId),
      }));
      // 删完了 → 自动建一个新的，避免空白
      if (remaining.length === 0) {
        await get().createFile({ scope: scopeKey, activate: true });
      }
    },

    pinFile: async (fileId, pinned) => {
      const st = get();
      const scopeKey = findScopeOfFile(st, fileId);
      if (!scopeKey) return;
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file) return;
      const updated = { ...file, pinned, updatedAt: Date.now() };
      await storage.saveFile(updated);
      set((s) => ({
        filesByScope: {
          ...s.filesByScope,
          [scopeKey]: (s.filesByScope[scopeKey] ?? []).map((f) =>
            f.id === fileId ? updated : f,
          ),
        },
      }));
    },

    setActiveFile: (scope, fileId) => {
      set((s) => ({
        activeFileIdByScope: { ...s.activeFileIdByScope, [scope]: fileId },
      }));
    },

    updateFileContent: (fileId, content) => {
      const st = get();
      const scopeKey = findScopeOfFile(st, fileId);
      if (!scopeKey) return;
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file) return;
      const updated = { ...file, content, updatedAt: Date.now() };
      // 同步到 IDB（节流由调用者管理；这里直接写）
      void storage.saveFile(updated);
      set((s) => ({
        filesByScope: {
          ...s.filesByScope,
          [scopeKey]: (s.filesByScope[scopeKey] ?? []).map((f) =>
            f.id === fileId ? updated : f,
          ),
        },
      }));
    },

    changeFileLanguage: async (fileId, language) => {
      const st = get();
      const scopeKey = findScopeOfFile(st, fileId);
      if (!scopeKey) return;
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file) return;
      const updated = { ...file, language, updatedAt: Date.now() };
      await storage.saveFile(updated);
      set((s) => ({
        filesByScope: {
          ...s.filesByScope,
          [scopeKey]: (s.filesByScope[scopeKey] ?? []).map((f) =>
            f.id === fileId ? updated : f,
          ),
        },
      }));
    },

    // ===== 对拍选择 =====

    toggleDiffSelection: (fileId) => {
      set((s) => {
        const next = s.diffSelection.includes(fileId)
          ? s.diffSelection.filter((x) => x !== fileId)
          : [...s.diffSelection, fileId].slice(-2); // 最多保留最近选的 2 个
        return { diffSelection: next };
      });
    },

    clearDiffSelection: () => set({ diffSelection: [] }),

    setLastRun: (scope, snap) =>
      set((s) => ({
        lastRunByScope: { ...s.lastRunByScope, [scope]: snap },
      })),
    clearLastRun: (scope) =>
      set((s) => {
        const next = { ...s.lastRunByScope };
        delete next[scope];
        return { lastRunByScope: next };
      }),

    // ===== 数据加载 =====

    refreshProblems: async () => {
      const list = await storage.listProblems();
      set({ problems: list });
    },
    refreshMistakes: async () => {
      const list = await storage.listMistakes();
      set({ mistakes: list });
    },
    refreshSessions: async () => {
      const list = await storage.listSessions();
      set({ sessions: list });
    },

    refreshFiles: async () => {
      const all = await storage.listFiles();
      const grouped: Record<string, CodeFile[]> = {};
      for (const f of all) {
        const k = f.problemId ?? DRAFT_SCOPE;
        (grouped[k] ??= []).push(f);
      }
      // 每组按 pinned + updatedAt 排序
      for (const k of Object.keys(grouped)) {
        grouped[k].sort((a, b) => {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return a.createdAt - b.createdAt;
        });
      }
      set({ filesByScope: grouped });

      // 给每个 scope 选 active：保留之前的，如果之前的不存在了选第一个
      const st = get();
      const nextActive: Record<string, string | null> = {};
      for (const [k, fs] of Object.entries(grouped)) {
        const prev = st.activeFileIdByScope[k];
        const stillExists = prev && fs.some((f) => f.id === prev);
        nextActive[k] = stillExists ? prev! : fs[0]?.id ?? null;
      }
      set({ activeFileIdByScope: nextActive });
    },

    refreshAll: async () => {
      await Promise.all([
        get().refreshProblems(),
        get().refreshMistakes(),
        get().refreshSessions(),
        get().refreshFiles(),
      ]);
      // 旧数据迁移
      await migrateLegacyCode(get);
      // 草稿 scope 没有文件 → 创建默认
      const st = get();
      const draftFiles = st.filesByScope[DRAFT_SCOPE] ?? [];
      if (draftFiles.length === 0) {
        await get().createFile({ scope: DRAFT_SCOPE, activate: true });
      }
    },

    // ===== AI 任务 =====

    enqueueParseProblem: (rawText) => {
      const label = `解析题目：${rawText.split('\n')[0].slice(0, 24) || '未命名'}`;
      return enqueue('parse-problem', label, {
        run: (onChunk, onRetry, signal) =>
          get().coach.parseProblem(rawText, { onChunk, onRetry, signal }),
        onSuccess: async (result) => {
          const p = result as Problem;
          await storage.saveProblem(p);
          await get().refreshProblems();
          await get().setActiveProblem(p.id);
          toast.success(`已录入：${p.title}`);
        },
      });
    },

    enqueueAnalyze: (opts) => {
      const st = get();
      // ollama 等本地服务不需要 apiKey
      const needsKey = st.aiConfig.provider !== 'ollama';
      if (needsKey && !st.aiConfig.apiKey) {
        toast.error('请先在设置里填 API Key');
        set({ settingsOpen: true });
        return null;
      }
      if (!st.aiConfig.baseUrl) {
        toast.error('请先在设置里配 Base URL');
        set({ settingsOpen: true });
        return null;
      }
      const scopeKey = st.activeProblemId ?? DRAFT_SCOPE;
      const activeFileId = st.activeFileIdByScope[scopeKey];
      const files = st.filesByScope[scopeKey] ?? [];
      const file = files.find((f) => f.id === activeFileId);
      if (!file) {
        toast.error('当前没有活跃文件');
        return null;
      }
      if (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python') {
        toast.error(`${file.language} 文件不能直接分析（请切到代码文件）`);
        return null;
      }
      // 阈值：少于 3 行非空代码或 < 30 字符 → 没什么可分析
      const nonEmptyLines = file.content.split('\n').filter((l) => l.trim().length > 0).length;
      if (file.content.trim().length < 30 || nonEmptyLines < 3) {
        toast.warning('代码太短了', { description: '至少写 3 行实质代码再触发分析（节省 AI 调用）' });
        return null;
      }
      // 重复触发防护：同一文件已有未完成的分析任务在跑/排队 → 复用旧 task，不创建新的
      const existing = st.tasks.find(
        (t) =>
          t.kind === 'analyze-code' &&
          (t.status === 'running' || t.status === 'queued') &&
          // task label 含文件名（"分析：xxx · main.cpp"），用 endsWith 匹配文件名
          t.label.endsWith(`· ${file.name}`),
      );
      if (existing) {
        toast.info('已有分析在跑，请等当前结果', { duration: 1500 });
        return existing.id;
      }
      const problem = st.activeProblemId
        ? st.problems.find((p) => p.id === st.activeProblemId)
        : undefined;

      const label = problem
        ? `分析：${problem.title} · ${file.name}`
        : `分析：${file.name}`;

      return enqueue(
        'analyze-code',
        label,
        {
          run: async (onChunk, onRetry, signal) => {
            const events = await storage.listEvents({ sessionId, limit: 200 });
            const profile: LearnerProfile = buildLearnerProfile({
              sessions: st.sessions,
              problems: st.problems,
              mistakes: st.mistakes,
              events,
              currentProblemTags: problem?.tags,
            });
            const history: AnalysisHistoryEntry[] = events
              .filter(
                (e) =>
                  e.problemId === problem?.id &&
                  (e.type === 'analysis' || e.type === 'manual_analyze'),
              )
              .slice(-2)
              .map((e) => {
                const p = e.payload as any;
                return {
                  ts: e.ts,
                  reason: p?.reason ?? 'auto',
                  issuesSnapshot: p?.issuesSnapshot ?? [],
                  overallComment: p?.overallComment,
                  codeHash: p?.codeHash,
                  codeLineCount: p?.codeLineCount,
                };
              })
              .filter((h) => h.issuesSnapshot.length > 0 || h.overallComment);

            // 收集同 scope 其它文件作为上下文（除当前文件外，最多 5 个）
            const siblings = files
              .filter((f) => f.id !== file.id && f.content.trim().length > 0)
              .slice(0, 5)
              .map((f) => ({ name: f.name, language: f.language, content: f.content }));

            // 取最近一次运行快照（让 AI 看到 stderr / exitCode）
            // 仅当快照对应当前 file 且 30 分钟内才用，避免给 AI 过期上下文
            const runSnap = get().lastRunByScope[problem?.id ?? DRAFT_SCOPE];
            const runtimeContext =
              runSnap &&
              runSnap.fileId === file.id &&
              Date.now() - runSnap.timestamp < 30 * 60 * 1000
                ? {
                    exitCode: runSnap.exitCode,
                    stdin: runSnap.stdin,
                    stdout: runSnap.stdout,
                    stderr: runSnap.stderr,
                    durationMs: runSnap.durationMs,
                    timestamp: runSnap.timestamp,
                  }
                : undefined;

            return get().coach.analyzeCode(
              {
                problem,
                code: file.content,
                language: langOfFile(file.language),
                profile,
                history,
                siblings,
                runtimeContext,
              },
              { onChunk, onRetry, signal },
            );
          },
          onSuccess: async (result) => {
            const r = result as AnalysisResult;
            const pid = problem?.id ?? DRAFT_SCOPE;
            set((s) => ({
              analysisByProblem: { ...s.analysisByProblem, [pid]: r },
            }));
            await storage.appendEvent({
              ts: Date.now(),
              sessionId,
              problemId: problem?.id,
              type: opts?.reason === 'manual' ? 'manual_analyze' : 'analysis',
              payload: {
                reason: opts?.reason ?? 'manual',
                fileId: file.id,
                fileName: file.name,
                issueCount: r.issues.length,
                issuesSnapshot: r.issues.slice(0, 10).map((i) => ({
                  line: i.line,
                  severity: i.severity,
                  category: i.category,
                  message: i.message.slice(0, 120),
                })),
                overallComment: r.overallComment?.slice(0, 200),
                codeHash: codeHash(file.content),
                codeLineCount: file.content.split('\n').length,
              },
            });
            toast.success(
              `分析完成：${r.issues.length === 0 ? '没发现明显问题' : `${r.issues.length} 个问题`}`,
            );
          },
        },
        { problemId: problem?.id, fileId: file.id },
      );
    },

    enqueueSummarize: (arg) => {
      // 兼容旧 boolean 接口：true=入错题本，false=AC 总结
      const opts: SubmitOpts =
        typeof arg === 'boolean' ? { isMistake: arg } : arg;
      const st = get();
      if (!st.activeProblemId) {
        toast.error('请先激活一道题目');
        return null;
      }
      if (!st.aiConfig.apiKey) {
        toast.error('请先在设置里填 API Key');
        set({ settingsOpen: true });
        return null;
      }
      const problem = st.problems.find((p) => p.id === st.activeProblemId);
      if (!problem) return null;
      const scopeKey = problem.id;
      const fileId = st.activeFileIdByScope[scopeKey];
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file || (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python')) {
        toast.error('当前活跃文件不是代码文件');
        return null;
      }

      const verdictTag = opts.verdict ? `[${opts.verdict}] ` : '';
      const label = opts.isMistake
        ? `${verdictTag}入错题：${problem.title}`
        : `通过总结：${problem.title}`;
      return enqueue('summarize-mistake', label, {
        run: (onChunk, onRetry, signal) =>
          get().coach.summarizeMistake(
            {
              problem,
              code: file.content,
              language: langOfFile(file.language),
              isMistake: opts.isMistake,
              verdict: opts.verdict,
              userNote: opts.userNote,
            },
            { onChunk, onRetry, signal },
          ),
        onSuccess: async (result) => {
          if (opts.isMistake) {
            const m = result as Mistake;
            await storage.saveMistake(m);
            await get().refreshMistakes();
            toast.success(`已加入错题本：${m.category}`);
          } else {
            toast.success(`已总结知识点`);
            // 错题本联动：这题之前如果在错题本里且未复习 → 自动标记
            // 真正的"复习"不是手动按按钮，是 AC 通过
            const related = get().mistakes.filter(
              (m) => m.problemId === problem.id && !m.reviewedAt,
            );
            for (const m of related) {
              await get().markMistakeReviewed(m.id);
            }
            if (related.length > 0) {
              toast.success(`✨ 自动标记 ${related.length} 条错题已复习`, {
                description: 'AC 即为有效复习',
                duration: 4000,
              });
              // 同步刷新学习引擎（复习率会改变）
              get().refreshLearningEngine();
            }
          }
        },
      });
    },

    enqueueDiff: () => {
      const st = get();
      if (!st.aiConfig.apiKey) {
        toast.error('请先配置 AI');
        set({ settingsOpen: true });
        return null;
      }
      if (st.diffSelection.length !== 2) {
        toast.error('请勾选两个文件');
        return null;
      }
      const all = Object.values(st.filesByScope).flat();
      const f1 = all.find((f) => f.id === st.diffSelection[0]);
      const f2 = all.find((f) => f.id === st.diffSelection[1]);
      if (!f1 || !f2) return null;
      const problem = st.activeProblemId
        ? st.problems.find((p) => p.id === st.activeProblemId)
        : undefined;

      return enqueue('compare-files', `对拍：${f1.name} ↔ ${f2.name}`, {
        run: async (onChunk, onRetry, signal) => {
          // 复用 chat 直接走 AI（自定义 prompt 简单做）
          const sys = '你是资深算法竞赛教练，对比两份解法的差异、正确性、复杂度，给出谁更优、各自适用场景，并指出潜在 bug。直接输出 markdown，不要任何前置说明。';
          const user = `${problem ? `题目：${problem.title}\n${problem.statement}\n\n` : ''}解法 A（${f1.name}，${f1.language}）：\n\`\`\`${f1.language}\n${f1.content}\n\`\`\`\n\n解法 B（${f2.name}，${f2.language}）：\n\`\`\`${f2.language}\n${f2.content}\n\`\`\`\n\n请用 markdown 给出对比报告。`;
          const stream = get().coach['ai'].chatStream({
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: user },
            ],
            maxTokens: 6000,
            onChunk,
            onRetry,
            signal,
          });
          let acc = '';
          for await (const _ of stream) {
            // 已通过 onChunk 累积到 task.progress
          }
          // 取最终 progress 作 result
          const finalTask = get().tasks.find((t) => t.label.includes(`${f1.name} ↔ ${f2.name}`));
          acc = finalTask?.progress ?? '';
          return acc;
        },
        onSuccess: async () => {
          toast.success(`对拍完成：${f1.name} ↔ ${f2.name}`);
        },
      });
    },

    cancelTask: (id) => {
      const ctrl = abortersById.get(id);
      ctrl?.abort();
    },

    retryTask: (id) => {
      const handler = handlersById.get(id);
      if (!handler) {
        toast.error('任务已被清除，无法重试');
        return;
      }
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                status: 'queued',
                progress: '',
                error: undefined,
                retryAttempt: undefined,
                retryReason: undefined,
                startedAt: undefined,
                finishedAt: undefined,
                durationMs: undefined,
              }
            : t,
        ),
      }));
      setTimeout(tick, 0);
    },

    clearFinishedTasks: () => {
      set((s) => ({
        tasks: s.tasks.filter((t) => t.status === 'queued' || t.status === 'running'),
      }));
    },

    deleteProblem: async (id) => {
      // 删题目时同步把它的所有 file 也删了
      const st = get();
      const files = st.filesByScope[id] ?? [];
      await Promise.all(files.map((f) => storage.deleteFile(f.id)));
      await storage.deleteProblem(id);
      set((s) => {
        const nextFiles = { ...s.filesByScope };
        delete nextFiles[id];
        const nextActive = { ...s.activeFileIdByScope };
        delete nextActive[id];
        return {
          activeProblemId: s.activeProblemId === id ? null : s.activeProblemId,
          filesByScope: nextFiles,
          activeFileIdByScope: nextActive,
        };
      });
      await get().refreshProblems();
    },
    deleteMistake: async (id) => {
      await storage.deleteMistake(id);
      await get().refreshMistakes();
    },
    markMistakeReviewed: async (id) => {
      // 先从 store 取（避免 storage 异步不一致 + 测试场景兼容）
      let m = get().mistakes.find((x) => x.id === id);
      if (!m) m = await storage.getMistake(id);
      if (!m) return;
      const updated: Mistake = {
        ...m,
        reviewedAt: Date.now(),
        reviewCount: (m.reviewCount ?? 0) + 1,
      };
      await storage.saveMistake(updated);
      // 直接 patch store 立刻反映（不靠 refreshMistakes 重新拉一遍）
      set((s) => ({
        mistakes: s.mistakes.map((x) => (x.id === id ? updated : x)),
      }));
    },

    setSidebarTab: (t) => set({ sidebarTab: t }),
    setSettingsOpen: (v) => set({ settingsOpen: v }),
    setProblemEditorOpen: (v) => set({ problemEditorOpen: v }),
    setProblemBrowserOpen: (v) => set({ problemBrowserOpen: v }),

    askQuestion: async (question) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      const s = get();
      if (!s.aiConfig.apiKey) {
        toast.error('请先配置 AI 服务（baseUrl + apiKey + model）');
        s.setSettingsOpen(true);
        return;
      }
      // scope: 当前激活题目 id，否则用 DRAFT_SCOPE
      const scope = s.activeProblemId ?? DRAFT_SCOPE;
      const problem = s.activeProblemId
        ? s.problems.find((p) => p.id === s.activeProblemId)
        : undefined;
      const files = s.filesByScope[scope] ?? [];
      const activeFileId = s.activeFileIdByScope[scope];
      const file = files.find((f) => f.id === activeFileId) ?? files[0];
      const code = file?.content ?? '';
      const language: Lang = langOfFile(file?.language ?? 'cpp');

      const userMsg: QAMessage = {
        id: nanoid(),
        role: 'user',
        content: trimmed,
        ts: Date.now(),
      };
      const assistMsg: QAMessage = {
        id: nanoid(),
        role: 'assistant',
        content: '',
        ts: Date.now(),
        streaming: true,
      };

      set((st) => ({
        qaByProblem: {
          ...st.qaByProblem,
          [scope]: [...(st.qaByProblem[scope] ?? []), userMsg, assistMsg],
        },
        qaPendingProblemId: scope,
      }));

      // 发起流式调用
      const history = (get().qaByProblem[scope] ?? [])
        .slice(0, -2)  // 排除刚塞进去的 userMsg + assistMsg
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        await get().coach.askQuestion(
          {
            problem,
            code,
            language,
            question: trimmed,
            history,
          },
          {
            onChunk: (_delta, accumulated) => {
              set((st) => {
                const list = st.qaByProblem[scope] ?? [];
                const idx = list.findIndex((m) => m.id === assistMsg.id);
                if (idx < 0) return st;
                const next = list.slice();
                next[idx] = { ...next[idx], content: accumulated };
                return { qaByProblem: { ...st.qaByProblem, [scope]: next } };
              });
            },
          },
        );
        // 完成：清除 streaming 标记
        set((st) => {
          const list = st.qaByProblem[scope] ?? [];
          const idx = list.findIndex((m) => m.id === assistMsg.id);
          if (idx < 0) return st;
          const next = list.slice();
          next[idx] = { ...next[idx], streaming: false };
          return {
            qaByProblem: { ...st.qaByProblem, [scope]: next },
            qaPendingProblemId: null,
          };
        });
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        set((st) => {
          const list = st.qaByProblem[scope] ?? [];
          const idx = list.findIndex((m) => m.id === assistMsg.id);
          if (idx < 0) return st;
          const next = list.slice();
          next[idx] = {
            ...next[idx],
            streaming: false,
            error: msg,
            content: next[idx].content || '（AI 调用失败）',
          };
          return {
            qaByProblem: { ...st.qaByProblem, [scope]: next },
            qaPendingProblemId: null,
          };
        });
        toast.error('AI 提问失败', { description: msg });
      }
    },

    clearQA: (scope) => {
      set((st) => {
        const next = { ...st.qaByProblem };
        delete next[scope];
        return { qaByProblem: next };
      });
    },
    setCmdPaletteOpen: (v) => set({ cmdPaletteOpen: v }),
    setSubmitModalOpen: (v) => set({ submitModalOpen: v }),
    setRuntimePaneOpen: (v) => {
      localStorage.setItem('aicc.runtimePane.v1', v ? 'on' : 'off');
      set({ runtimePaneOpen: v });
    },

    // ───── 卡住检测 ─────
    markEdit: () => set({ lastEditAt: Date.now() }),
    setStuckHintEnabled: (v) => {
      localStorage.setItem('aicc.stuckHint.v1', v ? 'on' : 'off');
      set({ stuckHintEnabled: v });
    },
    dismissHint: () => set({ currentHint: null }),
    enqueueStuckHint: () => {
      const st = get();
      if (!st.aiConfig.apiKey || !st.activeProblemId) return null;
      const problem = st.problems.find((p) => p.id === st.activeProblemId);
      if (!problem) return null;
      const fileId = st.activeFileIdByScope[st.activeProblemId];
      const file = (st.filesByScope[st.activeProblemId] ?? []).find((f) => f.id === fileId);
      if (!file) return null;
      // 只对代码文件提示
      if (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python') return null;

      set({ lastHintAt: Date.now() });
      return enqueue('stuck-hint', `卡住引导：${problem.title}`, {
        run: async (onChunk, onRetry, signal) => {
          const text = await get().coach.getStuckHint(
            { problem, code: file.content, language: langOfFile(file.language) },
            { onChunk, onRetry, signal },
          );
          return text;
        },
        onSuccess: (result) => {
          const text = (result as string)?.trim();
          if (text) set({ currentHint: text });
        },
      });
    },

    // ───── 框选问 AI / FeedbackPanel tab ─────
    setAskPrefill: (s) => set({ askPrefill: s }),
    setFeedbackTab: (t) => set({ feedbackTab: t }),

    // ───── Onboarding ─────
    startOnboarding: async () => {
      // 注入 Two Sum demo 题 + 故意 bug 代码
      const problemId = '__onboarding_two_sum__';
      const fileId = '__onboarding_main__';
      const now = Date.now();
      const demoProblem: Problem = {
        id: problemId,
        title: '两数之和（入门）',
        statement:
          '给定整数数组 nums 和目标 target，找出使得它们之和等于 target 的两个不同下标 i, j（i < j），输出 i 和 j。\n如果有多组解，输出任意一组即可。',
        constraints: '2 ≤ n ≤ 1000\n-10⁹ ≤ nums[i] ≤ 10⁹\n保证至少有一组解',
        examples: [
          { input: '4 9\n2 7 11 15', output: '0 1', explanation: 'nums[0]+nums[1] = 2+7 = 9' },
        ],
        tags: ['数组', '入门'],
        difficulty: 'easy',
        createdAt: now,
      };
      // 故意有 bug 的初始代码：j <= n 越界
      const buggyCode = `#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n, target;
    cin >> n >> target;
    vector<int> nums(n);
    for (int i = 0; i < n; i++) cin >> nums[i];

    // 暴力枚举所有 (i, j) 对
    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j <= n; j++) {  // ← bug 在这里
            if (nums[i] + nums[j] == target) {
                cout << i << " " << j << endl;
                return 0;
            }
        }
    }
    return 0;
}
`;
      await storage.saveProblem(demoProblem);
      set((st) => ({
        problems: [demoProblem, ...st.problems.filter((p) => p.id !== problemId)],
        activeProblemId: problemId,
        filesByScope: {
          ...st.filesByScope,
          [problemId]: [
            {
              id: fileId,
              problemId,
              name: 'main.cpp',
              language: 'cpp',
              content: buggyCode,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        activeFileIdByScope: { ...st.activeFileIdByScope, [problemId]: fileId },
        sidebarTab: null,
        feedbackTab: 'analyze',
        onboardingStep: 'wait-analyze',
      }));
      toast.info('👋 跟我做一遍 Two Sum，3 步看完核心流程', {
        description: '点高亮的「分析代码」按钮开始',
        duration: 5000,
      });
    },

    advanceOnboarding: (to) => set({ onboardingStep: to }),

    finishOnboarding: () => {
      localStorage.setItem('aicc.onboarding.v1', 'done');
      set({ onboardingStep: 'idle' });
    },

    // ───── Learning Engine ─────
    refreshLearningEngine: () => {
      const st = get();
      const { overview, cards } = buildLearningEngine({
        mistakes: st.mistakes,
        problems: st.problems,
        sessions: st.sessions,
        bank: PROBLEM_BANK,
      });
      set({ learningOverview: overview, learningCards: cards });
    },

    dismissLearningCard: () => {
      const t = today();
      localStorage.setItem('aicc.learning.dismissed.v1', t);
      set({ learningCardDismissedDate: t });
    },

    handleImportPayload: async (payload) => {
      // payload 是 Node 端 importProcessor 处理后的 processed payload
      // - rawText 已含 sam 识别结果（[图 N 识别] xxx）
      // - imageRecognitions 字段记录每张图的识别详情
      // 前端职责：去重、调 cloud AI parseProblem（可选）、入库、激活
      const st = get();
      const id = 'import-' + payload.url.replace(/[^a-zA-Z0-9]/g, '_').slice(-50);
      const existing = st.problems.find((p) => p.id === id);
      const hasRecognition = !!(payload as any).imageRecognitions?.length;

      if (existing) {
        // 已存在 → 用最新的 rawText 更新（让重新推送能刷新识别结果）
        if (payload.rawText && payload.rawText !== existing.statement) {
          const updated = { ...existing, statement: payload.rawText };
          await storage.saveProblem(updated);
          set((s) => ({
            problems: s.problems.map((p) => (p.id === id ? updated : p)),
          }));
          toast.info(`🔄 已更新：${updated.title}`, {
            description: hasRecognition ? '含最新识别结果' : '题面已刷新',
          });
        } else {
          toast.info(`已存在：${existing.title}`);
        }
        await get().setActiveProblem(existing.id);
        return;
      }

      // 新建：尝试 cloud AI parseProblem（可选）
      const statement = payload.rawText || '';
      let problem: Problem;
      if (st.aiConfig.apiKey && statement) {
        try {
          const parsed = await get().coach.parseProblem(statement);
          problem = {
            ...parsed,
            id,
            title: payload.title || parsed.title || '导入的题目',
            statement: parsed.statement || statement,
            createdAt: Date.now(),
          };
        } catch (err: any) {
          console.warn('[handleImportPayload] parseProblem 失败，使用原文', err?.message || err);
          problem = {
            id,
            title: payload.title || '导入的题目',
            statement,
            tags: [],
            createdAt: Date.now(),
          };
        }
      } else {
        problem = {
          id,
          title: payload.title || '导入的题目',
          statement,
          tags: [],
          createdAt: Date.now(),
        };
      }

      // 入库 + 编辑文件
      await storage.saveProblem(problem);
      const lang: FileLang = (payload.language === 'python' ? 'python' : payload.language === 'c' ? 'c' : 'cpp');
      const fileId = 'file-' + Date.now();
      const fileName = lang === 'cpp' ? 'main.cpp' : lang === 'c' ? 'main.c' : 'main.py';
      const file: CodeFile = {
        id: fileId,
        problemId: problem.id,
        name: fileName,
        language: lang,
        content: payload.initialCode || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await storage.saveFile(file);

      set((s) => ({
        problems: [problem, ...s.problems],
        filesByScope: { ...s.filesByScope, [problem.id]: [file] },
        activeFileIdByScope: { ...s.activeFileIdByScope, [problem.id]: fileId },
      }));

      await get().setActiveProblem(problem.id);
      const imgCount = payload.images?.length ?? 0;
      const recogCount = (payload as any).imageRecognitions?.filter((r: any) => r.description)?.length ?? 0;
      toast.success(`📥 已导入：${problem.title}`, {
        description: `来自 ${payload.source}${imgCount > 0 ? ` · ${recogCount}/${imgCount} 张图已识别` : ''}`,
      });
    },

    addBankProblem: async (bankId) => {
      const bank = PROBLEM_BANK.find((b) => b.id === bankId);
      if (!bank) return null;
      // 已添加过则直接激活
      const existing = get().problems.find((p) => p.id === bankId);
      if (existing) {
        await get().setActiveProblem(bankId);
        return bankId;
      }
      const newProblem: Problem = {
        id: bank.id,
        title: bank.title,
        statement: bank.statement,
        constraints: bank.constraints,
        examples: bank.examples,
        tags: bank.tags,
        difficulty: bank.difficulty,
        createdAt: Date.now(),
      };
      await storage.saveProblem(newProblem);
      set((s) => ({ problems: [newProblem, ...s.problems] }));
      await get().setActiveProblem(bankId);
      // 同时刷新引擎（避免反复推荐已添加的）
      get().refreshLearningEngine();
      return bankId;
    },
  };
});

// ============== helpers ==============

function findScopeOfFile(st: State, fileId: string): string | null {
  for (const [scope, files] of Object.entries(st.filesByScope)) {
    if (files.some((f) => f.id === fileId)) return scope;
  }
  return null;
}

function smartDupName(orig: string, existing: string[]): string {
  const dotIdx = orig.lastIndexOf('.');
  const base = dotIdx > 0 ? orig.slice(0, dotIdx) : orig;
  const ext = dotIdx > 0 ? orig.slice(dotIdx) : '';
  // 如果 base 已经是 v\d+，bump number
  const m = base.match(/^(.+)-v(\d+)$/);
  let prefix = base;
  let n = 2;
  if (m) {
    prefix = m[1];
    n = parseInt(m[2], 10) + 1;
  }
  while (existing.includes(`${prefix}-v${n}${ext}`)) n++;
  return `${prefix}-v${n}${ext}`;
}

/** 把旧 codeByProblem (LS_OLD_CODE) 迁移成 files store */
async function migrateLegacyCode(get: () => State) {
  const raw = localStorage.getItem(LS_OLD_CODE);
  if (!raw) return;
  try {
    const old = JSON.parse(raw) as Record<string, string>;
    const st = get();
    let migrated = 0;
    for (const [scope, code] of Object.entries(old)) {
      if (!code || code.trim().length === 0) continue;
      // 已有 file 的 scope 不迁移（避免重复）
      if ((st.filesByScope[scope] ?? []).length > 0) continue;
      const lang = guessLang(code);
      await get().createFile({
        scope,
        name: defaultFileName(lang, []),
        language: lang,
        content: code,
        activate: false,
      });
      migrated++;
    }
    if (migrated > 0) {
      console.log(`[migrate] 已从旧 codeByProblem 迁移 ${migrated} 个文件`);
    }
    localStorage.removeItem(LS_OLD_CODE);
  } catch (e) {
    console.warn('[migrate] 旧数据解析失败', e);
  }
}

function guessLang(code: string): FileLang {
  if (/^\s*#include/.test(code) || /\bint\s+main\s*\(/.test(code)) return 'cpp';
  if (/^\s*def\s+|^\s*import\s+|if __name__/.test(code)) return 'python';
  return 'cpp';
}

// 启动时拉取数据 + 迁移
useStore.getState().refreshAll();

// 测试用：暴露 store + 强关所有 modal 的 helper（仅用于 e2e）
if (typeof window !== 'undefined') {
  (window as any).__aicc_useStore__ = useStore;
  (window as any).__aicc_clear__ = () => {
    const s = useStore.getState();
    s.setSettingsOpen(false);
    s.setProblemEditorOpen(false);
    s.setCmdPaletteOpen(false);
    s.setSubmitModalOpen(false);
    s.dismissHint();
    s.setAskPrefill(null);
    // 不清 diffSelection，避免 e2e 测试连锁失败
  };
}

// dev 模式：把 store 暴露到 window 便于 e2e 测试 / debugging
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as any).__aiccStore = useStore;
}
