# 技术架构（AI Agent 视角）

> 本文档面向竞赛评委/技术读者。聚焦 **「这是不是真的 Agent」「Agent 之间是不是真的协作」** 两个核心问题。

## 0. 项目独有的 4 个差异化亮点（评委 30 秒看完）

1. **真 multi-agent 编排** — `DailyPlan` 由 3 个子 Agent 链式协作（学情诊断 → 题目筛选 → 计划编排），且**第 2 个不调 LLM** 是纯本地评分 Agent，是"hybrid agent graph"的真实例证（[§4](#4-多-agent-协作的核心证据dailyplan-编排链)）。
2. **费曼反向教学 Agent** — 用户教 AI 解题，AI 装菜鸟提问，AI 评委评分。**「学习者→老师」角色反转**，对位上纽大 Curistro 最佳创新奖（[§4.2](#42-费曼反向教学-agentstudent--evaluator)）。
3. **本地 1B 模型 + 离线兜底** — 路由器 + FastLane 让 70%+ 请求走本地，**演示时可一键"飞行模式"** 拔网线展示完整可用（[§5](#5-路由本地-vs-云端)）。
4. **AST-Light 本地结构 Agent** — 启发式提取代码结构特征（循环/嵌套/复杂度/red-flags）→ 喂给 LLM prompt，**LLM 不再瞎猜复杂度**（[§4.3](#43-本地工具型-agent-的第二个实例ast-light)）。

加上 4 视图可观测性面板（List / Graph / Dashboard / TimeLine），项目把"AI 是黑盒"这个常见诟病彻底打掉。

## 1. 一句话定位

**面向算法竞赛学习者的多 Agent 编程教练**。不是「带聊天框的 IDE」，而是 **多个 AI Agent 围绕「学」这件事自主感知、自主决策、自主行动**——用户从打开 app 到关掉，**13 个 Agent** 在背后工作，其中 3 个 (DailyPlan) + 2 个 (Feynman) 会编排协作，2 个本地纯逻辑 Agent (Selector / AstDiff) 不调 LLM。

## 2. 三层 AI 架构图

```
                          ┌──────────────────────────────────────┐
                          │             用户 (学生)               │
                          └──────────────┬───────────────────────┘
                                         │ 写代码 / 提交 / 卡住
                                         ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │            Layer 3 · 主动 / 协作 Agent 集群 (13 个 Agent)          │
   │ ────────────────────────────────────────────────────────────────  │
   │  · 被动响应：AnalyzeCode · AskCoach · AstDiff(本地)              │
   │  · 主动嗅探：StuckHint · IntentSniffer · HackCase ·              │
   │              RuntimeDiagnose · ConstraintSanity                  │
   │  · 学习反馈：ProblemOverview · AcReview · DailyReview ·          │
   │              SummarizeMistake                                    │
   │  · 编排链：DailyPlan(3 子) — Diagnosis · Selector(本地) ·        │
   │            Orchestrator                                          │
   │  · 反向教学：Feynman/Student × Feynman/Evaluator                 │
   │  各 Agent 共享 Sense → Decide → Act → Feedback 循环               │
   └────────────────────┬──────────────────────┬──────────────────────┘
                        │                      │
                        ▼                      ▼
   ┌──────────────────────────────┐  ┌──────────────────────────────┐
   │  Layer 2 · 智能路由层         │  │  Layer 2.5 · 状态/记忆层      │
   │ ──────────────────────────── │  │ ──────────────────────────── │
   │  IntentRouterClient          │  │  Zustand store (持久化到      │
   │  pickRoute(taskKind,len,    │  │  IndexedDB + localStorage)   │
   │  difficulty,...)             │  │  · 错题本 (mistakes)          │
   │                              │  │  · 学习时序 (sessions)        │
   │  动态决定:本地 ⚡ vs 云端 ☁  │  │  · 反馈历史 (events)          │
   │  目标:反应速度 vs 教学质量    │  │  · 失败次数计数器             │
   └──────────┬─────────┬─────────┘  └──────────────────────────────┘
              │         │                          ▲
              ▼         ▼                          │ 学情画像
   ┌──────────────┐  ┌──────────────────────┐      │
   │ FastLane(本地)│  │   云端 LLM           │──────┘
   │ Ollama       │  │   DeepSeek 默认       │
   │ sam:latest    │  │   MiniMax / OpenAI / │
   │ (1B 蒸馏)     │  │   兼容 OpenAI 接口    │
   └──────────────┘  └──────────────────────┘
   <500ms TTFT       高质量 reasoning
   100% JSON         多步骤教学方案
```

**为什么是 3 层**

- **Layer 3 (Agent 集群)** 解决「AI 应不应该出现」「在什么时机出现」——靠规则触发（用户行为）+ AI 自主决策（如 IntentSniffer 检测代码 stagnation 自己决定要不要插话）。
- **Layer 2 (路由)** 解决「谁来回答」——同样是「分析代码」，简单题 + 短代码走本地 1B 模型 500ms 出结果，复杂题 + 需要教学解释走云端。
- **Layer 1 (LLM)** 是燃料，不是大脑。**项目把「智能」放在 Layer 3 的编排逻辑里，而不是放在 prompt 工程里**——这是和「调 GPT 的 wrapper」最本质的区别。

## 3. Agent Loop（每个 Agent 都遵守的循环）

任何项目里的 Agent 都明确实现 4 步循环，并把每一步写进 `AgentTracePanel`（前端可见的「Agent 行动日志」）：

```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐
│ Sense   │→ │ Decide  │→ │ Act     │→ │ Feedback │
│ 感知数据│  │ 是否触发│  │ 执行动作│  │ 收集反馈 │
└─────────┘  └─────────┘  └─────────┘  └──────────┘
                                            │
            ┌──────────[learn/adjust]───────┘
            ▼
       更新 store → 影响下一轮 Sense
```

具体实例：

| Agent | Sense | Decide | Act | Feedback |
|---|---|---|---|---|
| **DailyPlan(主)** | 错题本/会话历史/失败计数 | 已有今日 plan? 没有→编排 | 触发 3 个子 Agent | 用户 accept/decline/重新规划 |
| **├ 学情诊断 (子)** | 输入近 7 天数据 | LLM 判断薄弱知识点 | 输出 weakConcepts/strengths | 进 Trace Panel |
| **├ 题目筛选 (子)** | weakConcepts + 题库 + 错题 | 本地纯逻辑筛选打分 | 输出 newProblems/reviewMistakes 候选 | 进 Trace Panel |
| **└ 计划编排 (子)** | 诊断 + 候选 | LLM 串成今日学习路径 | 输出 plan.steps[] | 渲染到 DailyPlanCard |
| **HackCase** | 用户连过 3 个样例 | AI 判断：还有没有边界？ | 生成 hack 输入 + 期望输出 | 用户运行后通过/失败 |
| **StuckHint** | 60s 无编辑 + 编译失败 | 是否符合 stuck 模式 | 出苏格拉底式提示 | 用户继续编辑 = 隐藏 |
| **IntentSniffer** | 代码 hash 变化但题目意图不变 | 写偏了吗？ | 提示「你是不是想做 X」 | 用户接受/否认 |
| **AcReview** | 提交结果 = AC | 没生成过总结? | LLM 总结亮点 + 复盘点 | 用户写笔记/关闭 |
| **DailyReview** | 当天首次进入 | 错题本里有没有该复习的？ | 弹推送 | 用户去做/今日不再 |
| **ProblemOverview** | 新题导入 | 没生成过 overview? | LLM 出题意速读 | 显示在编辑器顶部 |
| **AnalyzeCode (升级版)** | 同题失败 ≥ 3 次 | 启用 escalation prompt | LLM 写更深入的诊断 | 用户继续/AC 后清零 |

**关键**：表格里 11 个 Agent，3 个 (DailyPlan 编排链) 是真协作——前一个 Agent 的输出直接是后一个的输入，且**会因前面失败而提前中止**（不是「都跑一遍取最好的」）。

## 4. 多 Agent 协作的核心证据：DailyPlan 编排链

`store.ts` 里的 `requestDailyPlan` 是项目的「multi-agent 协作」的硬证据，**不能用单 LLM call 替代**。理由：

1. **数据流是有向、有依赖的**：诊断 Agent 必须先跑完，输出 `weakConcepts` 后，筛选 Agent 才能进行（不知道薄弱点筛什么？）。
2. **中间 Agent 是「无 LLM 的纯逻辑 Agent」**：题目筛选不调用 LLM，纯本地评分（按知识点重叠 + 难度 + 错题最近度），既省 token 又稳定。这是真正的「本地工具型 Agent」。
3. **每个子 Agent 都能独立失败**：诊断失败→不进入筛选；候选为空→不进入编排。**这是 agent graph，不是 prompt chain**。
4. **全程进 trace**：评委打开 AgentTracePanel 能看到 6 条记录（启动 + [1/3]输入 + [1/3]输出 + [2/3]输出 + [3/3]输出 + 完成），每条带时间戳。

### 4.1 DailyPlan 编排（数据流）

```typescript
// 简化伪代码（真实实现在 src/lib/store.ts:requestDailyPlan）
async requestDailyPlan() {
  trace('🤖 启动 3 步编排')

  // [1/3] 学情诊断 (cloud LLM)
  const diagnosis = await coach.generateLearningDiagnosis({
    recentMistakes, weekStats, stuckProblems
  })
  if (!diagnosis) return halt('诊断失败')
  trace('[1/3] 输出: 薄弱=' + diagnosis.weakConcepts)

  // [2/3] 题目筛选 (本地纯逻辑 Agent)
  const candidates = pickPlanCandidates({
    weakConcepts: diagnosis.weakConcepts,  // ← 依赖上一步
    mistakes, alreadyAdded, bank
  })
  if (candidates.empty) return halt('候选为空')
  trace('[2/3] 输出: 新题 X 道, 复习 Y 道')

  // [3/3] 计划编排 (cloud LLM)
  const plan = await coach.generatePlanOrchestration({
    diagnosis, candidates  // ← 依赖前两步
  })
  trace('[3/3] 输出: ' + plan.headline)

  set({ dailyPlan: plan })
}
```

### 4.2 费曼反向教学 Agent（Student × Evaluator）

**思路反转**：常见 AI 教学应用是「AI 教学生」，本项目额外提供 **「学生教 AI」** 模式（按 TopBar 🧠 进入）。

```
用户讲解 → Feynman/Student (装菜鸟，提澄清问题)
       ↓ N 轮迭代
用户结束讲解 → Feynman/Evaluator (3 维度评分 + 优缺点)
            → 报告：clarity / logic / accuracy 各 0-10 + verdict
```

**为什么这是真 multi-agent**：

- **Student** 和 **Evaluator** 是**功能完全不同的两个 Agent**：前者必须装菜鸟（不能流露答案），后者必须客观评分。**System prompt 完全不同**，**temperature 不同**（学生 0.6 自然、评委 0.3 严谨）。
- Evaluator 的输入是 **完整对话历史**（不是单次提问），它必须**在多轮里找证据**。
- 每轮 Student 的回应都进 trace，最后 Evaluator 的报告也进 trace，**评委可以看到 5-7 条 Feynman/* 的协作记录**。

**教育价值**：费曼学习法是研究确认的"深度理解"测试方法。比"AI 出题给学生做"更能识别真正的掌握程度。

### 4.3 本地工具型 Agent 的第二个实例：AST-Light

`src/core/astLite.ts` 是项目第 2 个**纯本地、无 LLM 的 Agent**（第 1 个是 `pickPlanCandidates`）。它在 `analyzeCode` 之前先跑：

```
用户写代码 → AnalyzeCode 触发
          → AstDiff Agent (本地启发式)
              ├─ 提取：循环数 / 嵌套深度 / 数据结构 / 递归 / I/O 标志
              ├─ 推断：复杂度 hint (O(1)..O(n³+))
              └─ 检测：red-flags (cin 未解绑/嵌套循环/map vs unordered_map ...)
          → 把 features 字符串 **注入** AnalyzeCode prompt
          → LLM 看到客观信号再写 issues
```

**为什么不直接让 LLM 自己看代码？** 因为：

- LLM 偶尔会**口胡复杂度**（写"O(n)"实际是 O(n²)）
- 启发式特征是**确定性**输出，可以作为 ground truth 喂给 LLM
- AST-Light 在 < 5ms 跑完，**不引入延迟**
- bundle 增加 < 5KB（不像引入 web-tree-sitter 那样要 +2MB wasm）

**对位 Umumum (上纽大二等奖)**：他们做了 AST 节点级 diff；我们做了 AST 启发式特征化。**精度略低，但工程性 + 成本 + 演示价值更优**。

## 5. 路由：本地 vs 云端 (项目独有的「便宜训得起 + 教得好」组合)

**FastLane (本地 sam:latest, 1B 参数蒸馏模型)** 实测数据（[bench-results/](../bench-results/)）：

| 难度 | 命中率 | TTFT | 总耗时 | 吞吐 |
|---|---|---|---|---|
| D1 (简单) | 100% (3/3) | 265–4242ms | 5.4s | 46 tok/s |
| D2 (中等) | 100% (2/2) | 305ms | 5.4s | 47 tok/s |
| D3 (中难) | 100% (2/2) | 312–372ms | 6s | 47 tok/s |
| D4 (难) | 100% (2/2) | 306–328ms | 5.5s | 49 tok/s |

**长上下文稳定性**（同一份 10500 字符 prompt）：

| ctx | TTFT | total | tok/s | JSON |
|---|---|---|---|---|
| 4K | 5.7s | 19.8s | 40.7 | ✓ |
| 8K | 6.2s | 20.4s | 43.8 | ✓ |
| 16K | 6.0s | 16.7s | 44.1 | ✓ |
| 24K | 6.3s | 18.2s | 43.8 | ✓ |
| 32K | 8.3s | 59.2s | 9.4 | ✓ (但慢) |

**结论**：**ctx ≤ 24K 时本地完全够用**，路由器把短代码 + 简单题永远走本地，把长代码 + 教学/复盘任务走云端。**这一层是「省 token」+「降延迟」+「数据隐私」三赢**。

`src/core/coach/router.ts` 里 `pickRoute()` 的硬规则：

- `parse` (题面解析) / `summarize` (错题总结) → 永远云端 (要高质量)
- `stuck` / `explain` (粘贴解释) → 永远本地 (要快)
- `analyze` (代码批注) → 动态：代码 < 1500 字符 + 简单题 → 本地，否则云端
- `ask` (自由提问) → 动态：短问题且非教学需求 → 本地

## 6. 状态/记忆层 (Layer 2.5)

很多 Agent demo 没记忆，每次都是冷启动。本项目的状态层是 **真持久化**：

- **`mistakes`** (错题本，IndexedDB) → DailyPlan / DailyReview 的输入
- **`sessions`** (每次提交的开始/结束/结果，IndexedDB) → 学情诊断的统计基础
- **`events`** (用户行为时间线) → AnalyzeCode 升级 prompt 的判定依据
- **`failureStatsByProblem`** (按题计数失败) → P3 escalation 的触发器
- **`coachOverview` / `acReview`** (按题缓存 LLM 输出) → 防止重复烧 token
- **`dailyPlan`** (按日期 key) → 跨天作废，重新规划

**这是真正意义上的 long-running agent**：今天的错题影响明天的计划，这周的卡顿影响下周的题目筛选。

## 6.5 离线模式 / 飞行模式（剧场感 demo）

`src/lib/offlineMode.ts` 监听 `navigator.onLine` + 提供"用户主动开飞行模式"开关。

**Coach.pick 在离线时强制走 fastLane**：

```typescript
private pick(hints) {
  let decision = pickRoute(hints, !!this.aiFast, this.routerHints);
  if (isEffectivelyOffline() && !decision.useFast && this.aiFast) {
    decision = { useFast: true, reason: '离线模式：本地 FastLane 兜底' };
  }
  return { client: decision.useFast ? this.aiFast : this.ai, decision };
}
```

**演示价值**：录像里点 TopBar 上的 ✈ 按钮 → 全 UI 立刻显示"离线 ⚡ 本地" → 此时仍能完整批注 / 总结 / 问答。**直接证明项目不是 ChatGPT 的 web 壳**，且**有数据隐私优势**。

## 7. 可见性：4 视图 AgentTracePanel

竞赛评委关心「AI 不是黑盒」。项目把每个 Agent 的每次行动写到 `AgentTracePanel`，提供 **3 个互补视图**（点 panel 头部 List / Network / Stats 切换）：

### 视图 A · List（时间线）
```
[12:00:00] 🤖 学习规划 Agent 启动 (3 步编排)        decide
[12:00:00] [1/3] 学情诊断 Agent · 输入              perceive
[12:00:03] [1/3] 学情诊断 Agent · 输出 (薄弱: DP)   feedback ✓
[12:00:03] [2/3] 题目筛选 Agent (本地) · 输出       decide
[12:00:08] [3/3] 计划编排 Agent · 输出              feedback ✓
[12:00:08] 🤖 编排完成                              act      ✓
```

### 视图 B · Graph（拓扑）
13 个 Agent 按职能分 5 个集群（被动 / 主动 / 反馈 / 编排 / 费曼），**节点在最近 6 秒内有 trace 时高亮 + 脉冲**——评委一眼看出"哪个 Agent 在跑"。本地 Agent (Selector / AstDiff) 用黄色边框区分。

### 视图 C · Stats（仪表板）
聚合最近 200 条 trace，按 Agent 显示：
- 调用次数 (×N)
- 平均延迟（自动按 perceive→feedback 配对推算）
- token 输入/输出
- 路由分布 (⚡ 本地 ×N / ☁ 云端 ×M)
- 错误数

**这就是教学场景下的「可解释 / 可观测 AI」**——业界 (OpenTelemetry / Langfuse) 推的 Agent observability 标准在本项目以最简洁的方式落地。

## 8. 创新点 vs 一般 LLM 应用

| 维度 | 一般 ChatGPT 教学应用 | 本项目 |
|---|---|---|
| Agent 数量 | 1 (chat) | **13** (其中 5 个协作 / 2 个本地无 LLM) |
| 触发方式 | 用户主动问 | **7 件主动行为** + 用户问 |
| 模型组合 | 单云端 LLM | 本地 1B + 云端 + 路由 + **离线兜底** |
| 记忆 | session 内 | 跨天 / 跨题 / 跨周 |
| 可解释 | 看回答 | **TracePanel 3 视图**（List / Graph / Dashboard） |
| 协作 | 无 | **DailyPlan = 3 子 Agent + Feynman = 2 子 Agent** |
| 反向教学 | 无 | **费曼模式：用户教 AI** |
| 结构分析 | LLM 主观 | **AST-Light 启发式 → 客观信号喂 LLM** |
| 隐私 | 全部上云 | 短代码不出本机 + **可一键飞行模式** |
| 教育领域适配 | 通用 | OJ 集成 / 错题本 / 升级 prompt |

## 9. 关键文件索引

| 关注点 | 文件 |
|---|---|
| **13 个 Agent 实现** | `src/core/analyzer.ts` (Coach class) |
| **3 步编排器 (DailyPlan)** | `src/lib/store.ts:requestDailyPlan` |
| **费曼 2 步编排** | `src/components/FeynmanModal.tsx` + `Coach.generateFeynman*` |
| 智能路由 | `src/core/ai/router.ts`, `src/core/coach/router.ts` |
| **本地无 LLM Agent #1** | `src/core/recommend.ts` `pickPlanCandidates` / `pickDailyReview` |
| **本地无 LLM Agent #2** | `src/core/astLite.ts` `extractFeatures` |
| **离线模式** | `src/lib/offlineMode.ts` |
| Prompt 工程 | `src/core/ai/prompts.ts` (15 个 builder) |
| 状态/记忆 | `src/lib/store.ts`, `src/lib/storage.ts` |
| **可视化（3 视图）** | `src/components/AgentTracePanel.tsx` + `AgentGraph.tsx` + `AgentDashboard.tsx` |
| Agent 输出卡 | `src/components/*Card.tsx` (8+ 个) |
| 性能基准 | `bench-results/` (sam-bench / quality / longctx) |
