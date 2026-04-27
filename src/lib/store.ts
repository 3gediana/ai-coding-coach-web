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
  Problem,
  Session,
} from '../core/types';
import { AIClient } from '../core/ai/client';
import { Coach } from '../core/analyzer';
import { storage } from './storage';
import { DEFAULT_AI_CONFIG } from './presets';
import { buildLearnerProfile } from '../core/utils';

const LS_AI_CFG = 'aicc.aiConfig.v1';
const LS_DEFAULT_LANG = 'aicc.defaultLang.v1';
const LS_OLD_CODE = 'aicc.code.v1'; // 旧数据迁移用

const DRAFT_SCOPE = '__draft__';

// ============== Tasks ==============

export type TaskKind = 'parse-problem' | 'analyze-code' | 'summarize-mistake' | 'compare-files';
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

  tasks: Task[];

  // UI
  sidebarTab: 'problems' | 'mistakes' | 'sessions' | 'dashboard' | null;
  settingsOpen: boolean;
  problemEditorOpen: boolean;
  cmdPaletteOpen: boolean;
  /** 对拍：选中的两个 fileId */
  diffSelection: string[];

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

  refreshProblems: () => Promise<void>;
  refreshMistakes: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  refreshAll: () => Promise<void>;

  enqueueParseProblem: (rawText: string) => string;
  enqueueAnalyze: (opts?: { reason?: string }) => string | null;
  enqueueSummarize: (isMistake: boolean) => string | null;
  enqueueDiff: () => string | null;

  cancelTask: (id: string) => void;
  retryTask: (id: string) => void;
  clearFinishedTasks: () => void;

  deleteProblem: (id: string) => Promise<void>;
  deleteMistake: (id: string) => Promise<void>;

  setSidebarTab: (t: State['sidebarTab']) => void;
  setSettingsOpen: (v: boolean) => void;
  setProblemEditorOpen: (v: boolean) => void;
  setCmdPaletteOpen: (v: boolean) => void;
}

// ============== 初始化 ==============

const initialAIConfig: AIConfig = (() => {
  try {
    const raw = localStorage.getItem(LS_AI_CFG);
    if (raw) return { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw) };
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
  return `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    \n    return 0;\n}\n`;
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
  const coach = new Coach(ai);

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

    tasks: [],

    sidebarTab: 'problems',
    settingsOpen: false,
    problemEditorOpen: false,
    cmdPaletteOpen: false,
    diffSelection: [],

    setAIConfig: (cfg) => {
      try {
        localStorage.setItem(LS_AI_CFG, JSON.stringify(cfg));
      } catch {
        /* ignore */
      }
      get().ai.updateConfig(cfg);
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
      if (!st.aiConfig.apiKey) {
        toast.error('请先在设置里填 API Key');
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
      if (file.content.trim().length === 0) {
        toast.error('文件内容为空');
        return null;
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
                };
              })
              .filter((h) => h.issuesSnapshot.length > 0 || h.overallComment);

            return get().coach.analyzeCode(
              {
                problem,
                code: file.content,
                language: langOfFile(file.language),
                profile,
                history,
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
      const scopeKey = problem.id;
      const fileId = st.activeFileIdByScope[scopeKey];
      const file = (st.filesByScope[scopeKey] ?? []).find((f) => f.id === fileId);
      if (!file || (file.language !== 'cpp' && file.language !== 'c' && file.language !== 'python')) {
        toast.error('当前活跃文件不是代码文件');
        return null;
      }

      const label = isMistake ? `加入错题本：${problem.title}` : `提交总结：${problem.title}`;
      return enqueue('summarize-mistake', label, {
        run: (onChunk, onRetry, signal) =>
          get().coach.summarizeMistake(
            { problem, code: file.content, language: langOfFile(file.language), isMistake },
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

    setSidebarTab: (t) => set({ sidebarTab: t }),
    setSettingsOpen: (v) => set({ settingsOpen: v }),
    setProblemEditorOpen: (v) => set({ problemEditorOpen: v }),
    setCmdPaletteOpen: (v) => set({ cmdPaletteOpen: v }),
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
