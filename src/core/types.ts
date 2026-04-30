/**
 * 核心类型定义。
 *
 * 这一层是为未来升级到 Web 版做准备的：
 * - 不引用任何 vscode API
 * - 数据结构稳定，方便序列化为 JSON 或存入数据库
 * - 未来 Web 后端可以直接复用这些 interface
 */

export type Lang = 'cpp' | 'c' | 'python';

/** 一道题目 */
export interface Problem {
  id: string;
  title: string;
  statement: string;
  inputFormat?: string;
  outputFormat?: string;
  constraints?: string;
  plainExplanation?: string;
  examples?: ProblemExample[];
  source?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  tags?: string[];
  createdAt: number;
  /**
   * P1 题眼速读：激活题目时云端生成一次，缓存到 problem 上避免重复烧 token。
   *
   * - headline：1 句话点出题眼（**不剧透解法**），≤ 40 字
   * - notes：2-3 条值得提前注意的点（边界条件 / 易错点 / 思路提示），每条 ≤ 50 字
   *
   * 用户可以 ✕ 关掉卡片（不影响缓存），下次激活同题不再重新生成。
   */
  coachOverview?: {
    headline: string;
    notes: string[];
    generatedAt: number;
  };
  /**
   * P2 AC 后复盘：提交 AC 后云端对比"你的代码 vs 经典最优解"，缓存到 problem 上。
   *
   * - passingPattern：1 句话归纳用户解法（"O(n²) 暴力枚举" / "O(n log n) 分治"）
   * - betterApproach：可选；如果有更优解法，给名字 + 复杂度 + 思路一两句
   * - followUps：2-3 条相关变种题型描述（不必给具体题号），方便用户继续练
   */
  acReview?: {
    passingPattern: string;
    betterApproach?: { name: string; complexity: string; gist: string };
    followUps: string[];
    generatedAt: number;
  };
}

export interface ProblemExample {
  input: string;
  output: string;
  explanation?: string;
}

/**
 * 学习规划 Agent（B 路线 - 自主 multi-Agent 编排）。
 *
 * 由 3 个子 Agent 协作产生：
 *   1. 学情诊断 Agent (cloud)：分析 7 天 sessions / 14 天 mistakes → 薄弱点
 *   2. 题目筛选 Agent (本地)：按薄弱点 + bank + mistakes → 候选题
 *   3. 计划编排 Agent (cloud)：综合产出今日学习路径
 *
 * 每个子 Agent 的输出都进 AgentTracePanel，对评委可见。
 * 这是真正的 multi-agent 编排（不是单 LLM 装多张脸）。
 */
export interface DailyPlan {
  id: string;
  date: string; // YYYY-MM-DD
  generatedAt: number;

  /** 子 Agent 1 的诊断输出 */
  diagnosis: {
    weakConcepts: string[];
    strengths: string[];
    todayFocus: string;
  };

  /** 子 Agent 2 的题目筛选输出（id 引用，UI 渲染时再 join） */
  candidates: {
    newProblems: Array<{ bankId: string; reason: string }>;
    reviewMistakes: Array<{ mistakeId: string; reason: string }>;
  };

  /** 子 Agent 3 的最终计划 */
  plan: {
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
  };

  /** 用户决策状态 */
  status: 'pending' | 'accepted' | 'declined';
  acceptedAt?: number;
  /** 完成进度（用户勾选的 step index） */
  completedStepIndices: number[];
}

/** AI 输出的代码诊断（一条问题） */
export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface CodeIssue {
  line: number; // 1-indexed
  endLine?: number;
  severity: Severity;
  category: 'bug' | 'optimization' | 'style' | 'algorithm';
  message: string;
  suggestion?: string;
}

/** AI 分析整段代码后的结果 */
export interface AnalysisResult {
  issues: CodeIssue[];
  complexitySummary?: string;
  overallComment?: string;
  fileId?: string;
  codeHash?: string;
  analyzedAt?: number;
  /** 路由决策信息（用于 UI 展示"用了哪个模型"） */
  routeInfo?: {
    /** 是否走 fastLane */
    useFast: boolean;
    /** 简短标签（"⚡ 本地" / "☁ 云端"） */
    label: string;
    /** 完整理由（用户 hover 时显示） */
    reason: string;
  };
}

/** 错题本里的一条记录 */
/** 提交评判结果 */
export type SubmissionVerdict = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'OTHER';

export interface Mistake {
  id: string;
  problemId?: string;
  problemTitle: string;
  language: Lang;
  wrongCode: string;
  correctCode?: string;
  rootCause: string;
  category: string;
  knowledgePoints: string[];
  reviewTips: string[];
  correctSketch?: string;
  createdAt: number;
  reviewedAt?: number;
  reviewCount: number;
  /** 提交时的评判结果（WA/TLE/...），AC 时不入错题本 */
  verdict?: SubmissionVerdict;
  /** 用户自己描述的错误现象（如 "n=10 时输出多了一个 0"） */
  userNote?: string;
  /** 命中的知识点分类 code（来自 taxonomy.ts），最多 2 个 */
  areaCodes?: string[];
}

/**
 * 学习画像：跨题维度的"学生侧写"。
 *
 * 用于在每次实时分析时给 AI 当上下文，让反馈针对该学生的薄弱点。
 * 体积控制在约 200-300 tokens 以内。
 */
export interface LearnerProfile {
  totalProblems: number;
  totalMistakes: number;
  /** 最薄弱的 3 个知识点（按掌握度升序） */
  weakestTags: Array<{ tag: string; mastery: number; count: number }>;
  /** 最常见的错误分类 + 频次（最近 N 道错题） */
  topMistakeCategories: Array<{ category: string; count: number }>;
  /** 当前题的 tags 中，哪些是该学生的薄弱项（命中即重点关注） */
  currentTagsHitWeak: string[];
  /** 连续学习天数（活跃度信号） */
  streakDays?: number;
  /** 待复习错题数（>3 天没看的） */
  pendingReviewCount?: number;
  /** 近 7 天通过题数（学习强度） */
  last7DaysProblems?: number;
  /** 独立解题率（0..1，越高越不依赖 AI hint） */
  independentRate?: number;
  /** 最近最常见的 verdict（错误类型分布特征） */
  topVerdict?: string;
}

/** 同一会话内最近 N 次分析的精简快照（喂给 AI 当上下文） */
export interface AnalysisHistoryEntry {
  ts: number;
  reason: string;
  /** 仅保留 line + severity + category + 简短 message，体积可控 */
  issuesSnapshot: Array<{
    line: number;
    severity: Severity;
    category: string;
    message: string;
  }>;
  overallComment?: string;
  /** 当时的代码哈希（让 AI 知道"代码改了"还是"没改") */
  codeHash?: string;
  /** 当时的代码行数（让 AI 知道结构改了多少） */
  codeLineCount?: number;
}

/** 通过题目后的总结记录 */
export interface ProblemSummary {
  knowledgePoints: string[];
  techniques: string[];
  complexity: string;
  extensions: string[];
  summary: string;
}

/** AI 服务提供方（仅做记录，所有都走 OpenAI 兼容协议） */
export type AIProvider =
  | 'minimax'
  | 'deepseek'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'qwen'
  | 'zhipu'
  | 'moonshot'
  | 'ollama'
  | 'custom';

/** AI 服务配置 */
export interface AIConfig {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  /** 单次请求超时（毫秒）；不填用 client 默认 */
  timeoutMs?: number;
  /** 最大重试次数；不填用 client 默认 */
  maxRetries?: number;
  /** 温度；不填走每个请求各自的默认 */
  temperature?: number;
  /**
   * Ollama 上下文窗口大小（num_ctx，仅 provider=ollama 时生效）
   * - 越大幻觉越少（占比低），但 KV cache 越大可能 CPU offload 导致掉速
   * - 不填默认 20480（实测 GPU 安全上限，参考 bench-results/longctx-ceiling）
   * - 显存小的机器建议 8192–16384；大显存（≥12GB）可拉到 32768
   */
  numCtx?: number;
  /**
   * 本地快车道（local fast lane）：
   * 启用后，"前台实时类"任务（analyze-code / stuck-hint / explain-paste）改走本地 ollama，
   * 其余后台慢任务（parse-problem / summarize-mistake / compare-files）继续用主配置（云端）。
   *
   * 设计动机：
   *   - 本地模型免费、低延迟（< 500ms TTFT），适合实时反馈
   *   - 云端模型更准、更稳，适合录题/归档/对拍这类一次性高质量任务
   */
  fastLane?: {
    enabled: boolean;
    /** 本地 ollama endpoint（baseUrl 必须是 localhost / 127.* / 局域网） */
    baseUrl: string;
    /** ollama 模型名，例如 'sam:latest' */
    model: string;
    /** ollama 上下文窗口（num_ctx），不填默认 20480 */
    numCtx?: number;
  };
  /**
   * 路由阈值（仅 fastLane 启用后生效）。
   * 命中其一 → 跳主云端；都不命中 → 走 fastLane。
   * 字段未填走 router.ts 里 DEFAULT_ROUTER_HINTS。
   */
  routerHints?: {
    codeCharLimit?: number;
    codeLineLimit?: number;
    questionCharLimit?: number;
    pasteCharLimit?: number;
    heavyTags?: string[];
  };
  /**
   * Coach 意图路由（独立的轻量模型，用于规则识别不出意图时的兜底）。
   * - 不启用时只走规则路由
   * - 启用且配置好时，按 baseUrl/apiKey/model 调用一次小模型返回 JSON
   */
  intentRouter?: {
    enabled: boolean;
    provider?: AIProvider;
    baseUrl: string;
    apiKey?: string;
    model: string;
  };
}

/** Onboarding 状态：首次启动引导学生走一遍核心流程 */
export type OnboardingStep =
  | 'idle'           // 已完成或被跳过
  | 'inject'         // 正在注入 demo 题（瞬间过）
  | 'wait-analyze'   // 高亮「分析代码」按钮，等学生点
  | 'wait-edit'      // 高亮 AI 批注，等学生改代码
  | 'celebrate';     // 完成后 3 秒庆祝 toast

/** 时间状态机的 5 个状态 */
export type TriggerState = 'CODING' | 'THINKING' | 'STUCK' | 'AWAY' | 'RETURNED';

/** 事件类型 */
export type CoachEventType =
  | 'state_change'
  | 'analysis'
  | 'manual_analyze'
  | 'submit'
  | 'mistake_added'
  | 'pass_summary'
  | 'paste_detected'
  | 'hint_pushed'
  | 'hint_taken'
  | 'session_start'
  | 'session_end'
  | 'problem_activated';

/** 一条事件日志 */
export interface CoachEvent {
  ts: number;
  sessionId: string;
  problemId?: string;
  type: CoachEventType;
  payload?: Record<string, unknown>;
}

/** 一次会话 */
export interface Session {
  id: string;
  problemId?: string;
  problemTitle?: string;
  startedAt: number;
  endedAt?: number;
  effectiveMs: number; // 有效解题时长（不含 AWAY）
  awayMs: number;      // 离开总时长
  stuckCount: number;
  analyzeCount: number;
  hintCount: number;
  outcome?: 'pass' | 'mistake' | 'incomplete';
  language?: Lang;
  finalCode?: string;
}

/**
 * 文件类型。每个题目下可以挂多个 CodeFile：
 * - 多解法：v1-暴力.cpp / v2-哈希.cpp
 * - 多语言：solution.cpp / solution.py
 * - 笔记：思路.md / 复杂度推导.md
 * - 辅助：tests.cpp / brute.cpp（对拍用）
 */
export type FileLang = Lang | 'markdown' | 'plaintext';

export interface CodeFile {
  id: string;
  /** null 表示草稿区（未关联题目） */
  problemId: string | null;
  name: string;
  language: FileLang;
  content: string;
  /** 置顶 tab：题目切回时优先打开 */
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 存储抽象。VS Code 版本用 globalStorage 写 JSON 文件实现。
 * 未来 Web 版本可以换成 fetch 调用后端 API 的实现，业务代码不用改。
 */
export interface CoachStorage {
  // 题目
  saveProblem(p: Problem): Promise<void>;
  getProblem(id: string): Promise<Problem | undefined>;
  listProblems(): Promise<Problem[]>;
  deleteProblem(id: string): Promise<void>;

  // 错题
  saveMistake(m: Mistake): Promise<void>;
  getMistake(id: string): Promise<Mistake | undefined>;
  listMistakes(): Promise<Mistake[]>;
  deleteMistake(id: string): Promise<void>;

  // 会话
  saveSession(s: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  listSessions(): Promise<Session[]>;
  deleteSession(id: string): Promise<void>;

  // 事件（追加写）
  appendEvent(e: CoachEvent): Promise<void>;
  listEvents(opts?: { sessionId?: string; sinceTs?: number; limit?: number }): Promise<CoachEvent[]>;

  // 文件（每题挂多个）
  saveFile(f: CodeFile): Promise<void>;
  getFile(id: string): Promise<CodeFile | undefined>;
  listFiles(opts?: { problemId?: string | null }): Promise<CodeFile[]>;
  deleteFile(id: string): Promise<void>;

  /** 清空全部数据（题目/错题/会话/事件/文件），不可撤销 */
  wipeAll(): Promise<void>;
}
