# 多 Agent 协作系统详解

> 解析 13 个 Agent 的协作模式、触发机制、和可观测性

---

## 1. Agent 概览

### 1.1 Agent 分类

| 类别 | Agent | 协作模式 | 是否调 LLM |
|------|-------|----------|-------------|
| **被动响应** | AnalyzeCode | 单 Agent | 是 |
| | AskCoach | 单 Agent | 是 |
| | ParseProblem | 单 Agent | 是 |
| | StuckHint | 单 Agent | 是 |
| | ExplainPaste | 单 Agent | 是 |
| **主动嗅探** | RuntimeDiagnose | 单 Agent | FastLane |
| | ConstraintSanity | 单 Agent | FastLane |
| | IntentSniffer | 单 Agent | FastLane |
| | HackCase | 单 Agent | 是 |
| **学习反馈** | ProblemOverview | 单 Agent | 是 |
| | AcReview | 单 Agent | 是 |
| | DailyReview | 单 Agent | 本地逻辑 |
| | SummarizeMistake | 单 Agent | 是 |
| **编排链** | DailyPlan (主) | 3 子 Agent 链式 | 是 |
| | DailyPlan/Diagnosis | 子 Agent #1 | 是 |
| | DailyPlan/Selector | 子 Agent #2 | **本地逻辑** |
| | DailyPlan/Orchestrator | 子 Agent #3 | 是 |
| **费曼** | Feynman/Student | 2 Agent 迭代 | 是 |
| | Feynman/Evaluator | 最终评分 | 是 |

### 1.2 Agent 命名规范

```typescript
// 来自 store.ts:AgentName 类型
type AgentName =
  | 'AnalyzeCode'           // PascalCase
  | 'AskCoach'              // 主 Agent
  | 'DailyPlan'             // 父 Agent
  | 'DailyPlan/Diagnosis'   // / 子 Agent 表示父子关系
  | 'DailyPlan/Selector'
  | 'DailyPlan/Orchestrator'
  | 'Feynman/Student'
  | 'Feynman/Evaluator'
  // ...
```

---

## 2. DailyPlan 三步编排链

### 2.1 数据流

```
[启动] requestDailyPlan()
         ↓
[子 Agent 1] generateLearningDiagnosis()
  输入: recentMistakes, weekStats, stuckProblems
  输出: { weakConcepts, strengths, todayFocus }
  失败 → 中止编排
         ↓
[子 Agent 2] pickPlanCandidates() ← 本地纯逻辑（无 LLM）
  输入: weakConcepts + mistakes + bank
  输出: { newProblems[], reviewMistakes[] }
  候选为空 → 中止编排
         ↓
[子 Agent 3] generatePlanOrchestration()
  输入: diagnosis + candidates
  输出: { headline, steps[], encouragement }
         ↓
[完成] setDailyPlan(plan)
```

### 2.2 为什么需要三步？

1. **数据流有依赖**：诊断必须先跑完，才能知道筛什么题
2. **子 Agent 2 是纯逻辑**：`pickPlanCandidates` 不调 LLM，是真正的本地工具型 Agent
3. **每个 Agent 可独立失败**：诊断失败→中止，候选为空→中止，不是"都跑一遍取最好的"

### 2.3 代码位置

```typescript
// src/lib/store.ts:requestDailyPlan()
async function requestDailyPlan() {
  // [1/3] 学情诊断 (cloud LLM)
  const diagnosis = await coach.generateLearningDiagnosis({...})
  if (!diagnosis) return halt('诊断失败')

  // [2/3] 题目筛选 (本地纯逻辑 Agent)
  const candidates = pickPlanCandidates({...})
  if (candidates.empty) return halt('候选为空')

  // [3/3] 计划编排 (cloud LLM)
  const plan = await coach.generatePlanOrchestration({...})

  set({ dailyPlan: plan })
}
```

---

## 3. 费曼反向教学模式

### 3.1 流程

```
用户开启费曼模式
         ↓
[循环 N 轮]
  generateFeynmanStudentReply()
    → AI 装学生提问
    → 用户回答
         ↓
用户主动结束 或 达到最大轮数
         ↓
generateFeynmanEvaluation()
  → AI 评委评分 (clarity/logic/accuracy)
  → 优点/缺点/建议
  → verdict (mastered/partial/struggling)
```

### 3.2 为什么两个不同的 Agent？

| Agent | Student | Evaluator |
|-------|---------|-----------|
| **System prompt** | 装菜鸟，不流露答案 | 客观评委 |
| **Temperature** | 0.6（自然） | 0.3（严谨） |
| **输入** | 单轮对话 | 完整历史 |
| **输出** | 学生问题 | 评分报告 |

---

## 4. 本地无 LLM Agent

### 4.1 pickPlanCandidates（题目筛选）

```typescript
// src/core/recommend.ts
pickPlanCandidates({ weakConcepts, mistakes, alreadyAdded, bank })
  ├─ 新题候选：从 bank 按 weakConcepts 模糊匹配
  │   - tag 命中 +30 分
  │   - title 命中 +15 分
  │   - difficulty 偏好：medium +10, easy +5
  │   - 排序取 top 2
  └─ 复习题候选：从 mistakes 按间隔重复打分
      - category 命中 weakConcepts +50
      - 从未复习 +30 + ageDays
      - 复习一次 +20 + reviewedDaysAgo
      - 排序取 top 2
```

**设计理由**：
- 确定性逻辑，稳定便宜
- 题目筛选不需要 LLM 的创意能力
- 评分函数可调，可解释性强

### 4.2 pickDailyReview（每日复习）

```typescript
// src/core/recommend.ts
pickDailyReview(mistakes)
  ├─ 从未复习：100 + ageDays + verdictBoost
  ├─ 复习一次（≥3 天）：50 + reviewedDaysAgo + verdictBoost
  ├─ 复习多次（≥7 天）：30 + reviewedDaysAgo + verdictBoost
  └─ verdictBoost：WA/RE/TLE +10
```

### 4.3 AstDiff（AST-Light）

见 `cb/ai-system.md` §6。

---

## 5. Agent 触发机制

### 5.1 被动触发（用户主动）

| 触发 | Agent | 时机 |
|------|-------|------|
| 用户点"分析代码" | AnalyzeCode | 分析面板 |
| 用户提问 | AskCoach | QA 面板 |
| 用户粘贴代码 | ExplainPaste | 粘贴事件 |
| 用户点"卡住" | StuckHint | 按钮点击 |
| 提交 AC | AcReview | 判题 AC |
| 导入新题 | ProblemOverview | 题目激活 |
| 提交 WA/TLE 等 | SummarizeMistake | 判题非 AC |

### 5.2 主动嗅探（自动判断）

| 触发条件 | Agent | 机制 |
|----------|-------|------|
| 运行失败（exitCode≠0） | RuntimeDiagnose | 同步，<500ms |
| 首次跑通样例 | ConstraintSanity | 异步，不阻塞 |
| 停顿 ≥90s + 代码净增 ≥30 字 | IntentSniffer | 节流，5 分钟全局 |
| 每天首次开 app + 无今日计划 | DailyPlan | 4s 延迟 |
| 每天首次开 app + 有待复习错题 | DailyReview | Toast 弹窗 |

### 5.3 节流/去重机制

```typescript
// store.ts 模块级变量（不进 React 状态）
const lastDiagByStderrHash = new Map()   // 同一 stderr 60s 不重复归因
const sanityCheckedProblems = new Set()   // 每 problemId 只 sanity check 一次
const lastSniffByCodeHash = new Map()     // 同一代码不重复 sniff
const lastIntentSniffAt = { ts: 0 }       // 5 分钟全局节流
```

---

## 6. 可观测性：AgentTracePanel

### 6.1 Trace 事件结构

```typescript
interface AgentTraceEvent {
  id: string
  ts: number
  kind: 'perceive' | 'decide' | 'act' | 'feedback'
  level: 'info' | 'success' | 'warn' | 'error'
  title: string           // 一句话标题
  detail?: string         // 可选详情
  problemId?: string
  taskId?: string
  agentName?: AgentName   // 推断或指定
  latencyMs?: number     // 耗时
  tokenIn?: number
  tokenOut?: number
  route?: 'fast' | 'cloud'
}
```

### 6.2 三视图

| 视图 | 展示内容 |
|------|----------|
| **List** | 时间线列表，每条含 kind 图标 + title + 时间差 |
| **Graph** | 拓扑图，节点=Agent，边=调用关系，5 色区分职能集群 |
| **Dashboard** | 统计：调用次数/平均延迟/token/路由分布/错误数 |

### 6.3 inferAgentName 规则

自动从 title 推断 agentName，用于 graph 节点着色：

```typescript
// store.ts
if (title.includes('学情诊断')) return 'DailyPlan/Diagnosis'
if (title.includes('题目筛选')) return 'DailyPlan/Selector'
if (title.includes('计划编排')) return 'DailyPlan/Orchestrator'
if (title.includes('学习规划')) return 'DailyPlan'
// ...
```

---

## 7. 文件路径速查

| 功能 | 文件 | 关键行号 |
|------|------|----------|
| requestDailyPlan | `src/lib/store.ts` | ~1500+ (TaskUpdate) |
| pickPlanCandidates | `src/core/recommend.ts` | 377-478 |
| pickDailyReview | `src/core/recommend.ts` | 313-363 |
| generateFeynman* | `src/core/analyzer.ts` | 546-664 |
| AgentTraceEvent | `src/lib/store.ts` | AgentTraceEvent 类型 |
| inferAgentName | `src/lib/store.ts` | 214-238 |
| AgentTracePanel | `src/components/AgentTracePanel.tsx` | — |
| AgentGraph | `src/components/AgentGraph.tsx` | — |
| AgentDashboard | `src/components/AgentDashboard.tsx` | — |
