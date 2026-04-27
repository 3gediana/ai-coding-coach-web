/**
 * 全局状态：AI 配置 / 数据 / 任务队列 / 分析流 / UI。
 *
 * 关键设计：
 * - 任意 AI 调用都进 taskQueue，UI 只看任务状态，不阻塞
 * - taskQueue 支持并发（默认 3）+ 流式进度 + 失败重试
 * - 编辑器永远响应；AI 跑完自动 toast，结果落到 analysisByProblem
 */
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';

import type {
  AIConfig,
  AnalysisHistoryEntry,
  AnalysisResult,
  Lang,
  LearnerProfile,
  Mistake,
  Problem,
  Session,
} from '../core/types';
import { AIClient } from '../core/ai/client';
import { Coach } from '../core/analyzer';
import { storage } from './storage';
import { DEFAULT_AI_CONFIG } from './presets';
import { buildLearnerProfile } from '../core/utils';

const LS_AI_CFG = 'aicc.aiConfig.v1';
const LS_LANG = 'aicc.language.v1';
const LS_CODE = 'aicc.code.v1'; // {[problemId|'__draft__']: string}

// ============== Tasks ==============

export type TaskKind = 'parse-problem' | 'analyze-code' | 'summarize-mistake';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  kind: TaskKind;
  label: string;
  status: TaskStatus;
  progress: string; // 流式累积文本
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

const handlersById = new Map<string, TaskHandler>();
const abortersById = new Map<string, AbortController>();

const MAX_CONCURRENT = 3;

// ============== Store ==============

interface State {
  // AI 配置
  aiConfig: AIConfig;
  ai: AIClient;
  coach: Coach;

  // 数据
  problems: Problem[];
  mistakes: Mistake[];
  sessions: Session[];
  activeProblemId: string | null;

  // 编辑器
  language: Lang;
  codeByProblem: Record<string, string>; // key: problemId or '__draft__'
  draftCode: string;

  // 分析结果（按 problemId 缓存最新一次）
  analysisByProblem: Record<string, AnalysisResult>;
  /** 进行中的流式预览（按任务 id） */
  streamPreviewById: Record<string, string>;

  // 任务
  tasks: Task[];

  // UI
  sidebarTab: 'problems' | 'mistakes' | 'sessions' | 'dashboard' | null;
  settingsOpen: boolean;
  problemEditorOpen: boolean;

  // ===== actions =====
  setAIConfig: (cfg: AIConfig) => void;
  setLanguage: (l: Lang) => void;
  setCode: (code: string) => void;

  setActiveProblem: (id: string | null) => Promise<void>;
  refreshProblems: () => Promise<void>;
  refreshMistakes: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshAll: () => Promise<void>;

  enqueueParseProblem: (rawText: string) => string;
  enqueueAnalyze: (opts?: { reason?: string }) => string | null;
  enqueueSummarize: (isMistake: boolean) => string | null;

  cancelTask: (id: string) => void;
  retryTask: (id: string) => void;
  clearFinishedTasks: () => void;

  deleteProblem: (id: string) => Promise<void>;
  deleteMistake: (id: string) => Promise<void>;

  setSidebarTab: (t: State['sidebarTab']) => void;
  setSettingsOpen: (v: boolean) => void;
  setProblemEditorOpen: (v: boolean) => void;
}

const initialAIConfig: AIConfig = (() => {
  try {
    const raw = localStorage.getItem(LS_AI_CFG);
    if (raw) return { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_AI_CONFIG;
})();

const initialLang: Lang = ((): Lang => {
  const v = localStorage.getItem(LS_LANG) as Lang | null;
  if (v === 'cpp' || v === 'c' || v === 'python') return v;
  return 'cpp';
})();

const initialCodeMap: Record<string, string> = ((): Record<string, string> => {
  try {
    const raw = localStorage.getItem(LS_CODE);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
})();

const sessionId = nanoid();

export const useStore = create<State>((set, get) => {
  const ai = new AIClient(initialAIConfig);
  const coach = new Coach(ai);

  const persistCode = () => {
    try {
      localStorage.setItem(LS_CODE, JSON.stringify(get().codeByProblem));
    } catch {
      /* ignore */
    }
  };

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
        (_delta, accumulated) => {
          set((s) => ({
            streamPreviewById: { ...s.streamPreviewById, [taskId]: accumulated },
            tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, progress: accumulated } : t)),
          }));
        },
        (attempt, delayMs, reason) => {
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
        toast.error(`${labelOf(taskId, get().tasks)} 失败：${String(e?.message || e).slice(0, 80)}`);
      }
    } finally {
      abortersById.delete(taskId);
      // 不删 handler，retryTask 还要用
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
      tasks: [
        { id, kind, label, status: 'queued', progress: '', meta },
        ...s.tasks,
      ],
    }));
    setTimeout(tick, 0);
    return id;
  };

  return {
    aiConfig: initialAIConfig,
    ai,
    coach,

    problems: [],
    mistakes: [],
    sessions: [],
    activeProblemId: null,

    language: initialLang,
    codeByProblem: {
      ...initialCodeMap,
      __draft__: initialCodeMap['__draft__'] ?? defaultCode(initialLang),
    },
    draftCode: initialCodeMap['__draft__'] ?? defaultCode(initialLang),

    analysisByProblem: {},
    streamPreviewById: {},

    tasks: [],

    sidebarTab: 'problems',
    settingsOpen: false,
    problemEditorOpen: false,

    setAIConfig: (cfg) => {
      try {
        localStorage.setItem(LS_AI_CFG, JSON.stringify(cfg));
      } catch {
        /* ignore */
      }
      get().ai.updateConfig(cfg);
      set({ aiConfig: cfg });
    },

    setLanguage: (l) => {
      localStorage.setItem(LS_LANG, l);
      const st = get();
      const key = st.activeProblemId ?? '__draft__';
      const existing = st.codeByProblem[key];
      // 切语言时如果当前 buffer 是默认模板，自动换默认模板
      const isDefaultBuffer =
        !existing || existing === defaultCode(st.language) || existing.trim().length === 0;
      const nextCode = isDefaultBuffer ? defaultCode(l) : existing;
      const nextMap = { ...st.codeByProblem, [key]: nextCode };
      set({
        language: l,
        codeByProblem: nextMap,
        draftCode: key === '__draft__' ? nextCode : st.draftCode,
      });
      try {
        localStorage.setItem(LS_CODE, JSON.stringify(nextMap));
      } catch {
        /* ignore */
      }
    },

    setCode: (code) => {
      const st = get();
      const key = st.activeProblemId ?? '__draft__';
      const nextMap = { ...st.codeByProblem, [key]: code };
      set({
        codeByProblem: nextMap,
        draftCode: key === '__draft__' ? code : st.draftCode,
      });
      // 节流持久化（简单做法：每次 setCode 都写，量不大）
      try {
        localStorage.setItem(LS_CODE, JSON.stringify(nextMap));
      } catch {
        /* ignore */
      }
    },

    setActiveProblem: async (id) => {
      const st = get();
      // 第一次切到某题时，如果还没 buffer，填默认模板
      let nextMap = st.codeByProblem;
      if (id && !(id in st.codeByProblem)) {
        nextMap = { ...st.codeByProblem, [id]: defaultCode(st.language) };
        try {
          localStorage.setItem(LS_CODE, JSON.stringify(nextMap));
        } catch {
          /* ignore */
        }
      }
      set({ activeProblemId: id, codeByProblem: nextMap });
    },

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
    refreshAll: async () => {
      await Promise.all([
        get().refreshProblems(),
        get().refreshMistakes(),
        get().refreshSessions(),
      ]);
    },

    enqueueParseProblem: (rawText) => {
      const label = `解析题目：${rawText.split('\n')[0].slice(0, 24) || '未命名'}`;
      return enqueue('parse-problem', label, {
        run: (onChunk, onRetry, signal) =>
          get().coach.parseProblem(rawText, { onChunk, onRetry, signal }),
        onSuccess: async (result) => {
          const p = result as Problem;
          await storage.saveProblem(p);
          await get().refreshProblems();
          set({ activeProblemId: p.id });
          toast.success(`已录入：${p.title}`);
        },
      });
    },

    enqueueAnalyze: (opts) => {
      const st = get();
      if (!st.aiConfig.apiKey) {
        toast.error('请先在设置里填 API Key');
        set({ settingsOpen: true });
        return null;
      }
      const key = st.activeProblemId ?? '__draft__';
      const code = st.codeByProblem[key] ?? '';
      if (code.trim().length === 0) {
        toast.error('代码为空');
        return null;
      }
      const problem = st.activeProblemId
        ? st.problems.find((p) => p.id === st.activeProblemId)
        : undefined;

      const label = problem
        ? `分析：${problem.title}`
        : `分析当前代码`;

      return enqueue(
        'analyze-code',
        label,
        {
          run: async (onChunk, onRetry, signal) => {
            // 构造画像 + 历史
            const events = await storage.listEvents({ sessionId, limit: 200 });
            const profile: LearnerProfile = buildLearnerProfile({
              sessions: st.sessions,
              problems: st.problems,
              mistakes: st.mistakes,
              events,
              currentProblemTags: problem?.tags,
            });
            const history: AnalysisHistoryEntry[] = events
              .filter((e) => e.type === 'analysis' || e.type === 'manual_analyze')
              .filter((e) => e.problemId === problem?.id)
              .slice(-2)
              .map((e) => {
                const p = e.payload as
                  | {
                      reason?: string;
                      issuesSnapshot?: AnalysisHistoryEntry['issuesSnapshot'];
                      overallComment?: string;
                    }
                  | undefined;
                return {
                  ts: e.ts,
                  reason: p?.reason ?? 'auto',
                  issuesSnapshot: p?.issuesSnapshot ?? [],
                  overallComment: p?.overallComment,
                };
              })
              .filter((h) => h.issuesSnapshot.length > 0 || h.overallComment);

            return get().coach.analyzeCode(
              {
                problem,
                code,
                language: st.language,
                profile,
                history,
              },
              { onChunk, onRetry, signal },
            );
          },
          onSuccess: async (result) => {
            const r = result as AnalysisResult;
            const pid = problem?.id ?? '__draft__';
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
                issueCount: r.issues.length,
                issuesSnapshot: r.issues.slice(0, 10).map((i) => ({
                  line: i.line,
                  severity: i.severity,
                  category: i.category,
                  message: i.message.slice(0, 120),
                })),
                overallComment: r.overallComment?.slice(0, 200),
              },
            });
            toast.success(
              `分析完成：${r.issues.length === 0 ? '没发现明显问题' : `${r.issues.length} 个问题`}`,
            );
          },
        },
        { problemId: problem?.id },
      );
    },

    enqueueSummarize: (isMistake) => {
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
      const code = st.codeByProblem[problem.id] ?? '';

      const label = isMistake ? `加入错题本：${problem.title}` : `提交总结：${problem.title}`;
      return enqueue('summarize-mistake', label, {
        run: (onChunk, onRetry, signal) =>
          get().coach.summarizeMistake(
            { problem, code, language: st.language, isMistake },
            { onChunk, onRetry, signal },
          ),
        onSuccess: async (result) => {
          if (isMistake) {
            const m = result as Mistake;
            await storage.saveMistake(m);
            await get().refreshMistakes();
            toast.success(`已加入错题本：${m.category}`);
          } else {
            toast.success(`已总结知识点`);
          }
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
      await storage.deleteProblem(id);
      const st = get();
      const nextActive = st.activeProblemId === id ? null : st.activeProblemId;
      const nextMap = { ...st.codeByProblem };
      delete nextMap[id];
      set({ activeProblemId: nextActive, codeByProblem: nextMap });
      persistCode();
      await get().refreshProblems();
    },
    deleteMistake: async (id) => {
      await storage.deleteMistake(id);
      await get().refreshMistakes();
    },

    setSidebarTab: (t) => set({ sidebarTab: t }),
    setSettingsOpen: (v) => set({ settingsOpen: v }),
    setProblemEditorOpen: (v) => set({ problemEditorOpen: v }),
  };
});

function labelOf(taskId: string, tasks: Task[]) {
  return tasks.find((t) => t.id === taskId)?.label ?? '任务';
}

export function defaultCode(lang: Lang): string {
  if (lang === 'python') {
    return `# 在这里写你的解法\n\ndef solve():\n    pass\n\nif __name__ == "__main__":\n    solve()\n`;
  }
  return `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    \n    return 0;\n}\n`;
}

// 启动时拉取数据
useStore.getState().refreshAll();
