# AI 系统详解

> 深入解析 `src/core/ai/` 和 `src/core/coach/` 的 AI 能力层

---

## 1. AIClient 架构

### 1.1 核心职责

`src/core/ai/client.ts` 中的 `AIClient` 类是**所有 AI 调用的单一入口**，统一封装了：

- OpenAI 兼容协议（DeepSeek/MiniMax/OpenAI 等）
- Ollama 原生协议（本地模型）
- 流式 SSE 响应处理
- JSON 解析（含截断自动补全）
- 指数退避重试
- CORS 代理（开发模式）

### 1.2 对比两种协议

| 特性 | OpenAI 兼容 | Ollama 原生 |
|------|------------|-------------|
| Endpoint | `/v1/chat/completions` | `/api/chat` |
| 流式格式 | SSE `data: {...}` | NDJSON `\n{...}` |
| 认证 | `Authorization: Bearer <key>` | 无（本地） |
| 特殊参数 | `max_tokens`, `temperature` | `options.num_ctx`, `options.num_gpu` |
| thinking | N/A | `think: false` 关闭思考链 |

### 1.3 JSON 解析策略

```typescript
parseJsonLoose(text)
  ├─ stripThinkBlock()        // 去掉 <think>...</think> 和 <|...|>
  ├─ extractFirstJson()       // 用栈提取第一个完整 JSON
  ├─ completeTruncatedJson()  // 补全截断的 } / ]
  └─ repairJson()            // 修复行内注释/末尾逗号/未转义 newline
```

**为什么需要这套解析**：
- LLM 经常在流式输出时截断 JSON
- 思考块会污染 JSON 解析
- 直接 `JSON.parse()` 失败率 > 50%

### 1.4 重试策略

```typescript
fetchWithRetry(body, req)
  ├─ attempt 1..3
  ├─ 429 → Retry-After header 或 指数退避
  ├─ 5xx → 指数退避
  ├─ 网络错误 → 指数退避
  └─ abort signal → 立即终止
```

---

## 2. 意图路由 (Intent Router)

### 2.1 两层路由架构

| 层级 | 文件 | 职责 |
|------|------|------|
| Layer 2 | `src/core/ai/router.ts` | 任务级路由（fast vs cloud） |
| Layer 3 | `src/core/coach/router.ts` | 意图级路由（7 种意图分类） |

### 2.2 任务路由 (pickRoute)

```typescript
pickRoute(hints: RouteHints, hasFast: boolean, routerHints?: RouterHints)
  ├─ stuck / explain → always fast
  ├─ parse / summarize → always cloud
  ├─ analyze → 代码<1500 && 简单题 → fast
  └─ ask → 短问题 → fast

决策输出: { useFast, label, reason }
```

### 2.3 意图路由 (routeCoachRequest)

7 种意图分类：
1. `understand_problem` — 理解题意
2. `check_idea` — 检查思路
3. `debug_runtime_error` — 调试运行时错误
4. `review_code` — 审查代码
5. `explain_selection` — 解释选区
6. `stuck_hint` — 卡住提示
7. `general_question` — 通用问答

---

## 3. Coach 类方法详解

### 3.1 方法分类

| 类别 | 方法 | 输出 | 路由 |
|------|------|------|------|
| **被动响应** | `analyzeCode()` | `AnalysisResult` (issues[]) | 本地/云端 |
| | `askQuestion()` | markdown 文本 | 本地/云端 |
| | `askCoach()` | markdown 文本 | 本地/云端 |
| | `getStuckHint()` | 1-2 个问题 | 本地 |
| | `explainPaste()` | JSON | 本地 |
| **主动嗅探** | `diagnoseRuntimeError()` | 错误归因 | FastLane |
| | `sniffIntent()` | 意图偏离判断 | FastLane |
| | `sanityCheckConstraints()` | 范围风险 | FastLane |
| **学习反馈** | `summarizeMistake()` | `Mistake` | 云端 |
| | `generateAcReview()` | AC 复盘 | 云端 |
| | `generateProblemOverview()` | 头条+注意点 | 云端 |
| | `generateLearningDiagnosis()` | 薄弱点诊断 | 云端 |
| | `generatePlanOrchestration()` | 今日计划 | 云端 |
| | `pickDailyReview()` | 复习题（纯逻辑） | 本地 |
| | `pickPlanCandidates()` | 候选题（纯逻辑） | 本地 |
| **费曼** | `generateFeynmanStudentReply()` | 学生问题 | 云端 |
| | `generateFeynmanEvaluation()` | 评分报告 | 云端 |
| **其他** | `parseProblem()` | `Problem` | 云端 |
| | `generatePlainExplanation()` | 白话解释 | 云端/本地兜底 |
| | `generateHackCase()` | hack 输入 | 本地/云端 |

### 3.2 流式 vs 非流式

| 流式 | 非流式 |
|------|--------|
| `analyzeCode()` | `parseProblem()` |
| `askQuestion()` | `summarizeMistake()` |
| `askCoach()` | `getStuckHint()` |
| `explainPaste()` | `generateProblemOverview()` |
| `chatJsonStream()` | `chatJson()` |

流式通过 `onChunk(delta, accumulated)` 回调让 UI 实时渲染。

---

## 4. FastLane 专属任务

FastLane 是**只走本地 Ollama** 的任务，用于高频低延迟场景：

### 4.1 RuntimeDiagnose（运行时错误归因）

```typescript
diagnoseRuntimeError({ code, exitCode, stderrTail, stdinHead })
  → { errorClass, likelyLine, oneLineHint }
```

- 输入：stderr 末尾 500 字 + exitCode
- 输出：错误类型分类（段错误/TLE/RuntimeError 等）
- 典型延迟：<500ms

### 4.2 SanityCheck（数据范围审计）

```typescript
sanityCheckConstraints({ problem, code })
  → risks: string[]
```

检查项：
- 整数类型溢出（n*m 可能超 int）
- 数组开小了
- 复杂度不符约束
- cin/cout 未关同步

### 4.3 IntentSniff（意图偏离嗅探）

```typescript
sniffIntent({ problem, code })
  → { onTrack: boolean, evidence: string }
```

触发条件：
- 用户停顿 ≥90s
- 代码净增 ≥30 字

保守判断：默认在轨，只有明显偏题才报告。

---

## 5. 提示词工程

### 5.1 提示词 builder 分类

**代码分析类**：
- `buildAnalyzeCodePrompt` — 代码批注（最复杂，支持 escalation/hint）
- `buildStuckHintPrompt` — 苏格拉底引导（不超过 80 字）
- `buildHackCasePrompt` — hack case 生成
- `buildExplainPastePrompt` — 粘贴片段分析

**题目解析类**：
- `buildParseProblemPrompt` — 题目原文 → JSON
- `buildPlainExplanationPrompt` — 生成白话解释
- `buildProblemOverviewPrompt` — 题意速读（头条+注意点）

**学习规划类**：
- `buildDiagnosisAgentPrompt` — 学情诊断
- `buildPlanOrchestrationPrompt` — 计划编排

**费曼类**：
- `buildFeynmanStudentPrompt` — AI 学生（temperature=0.6）
- `buildFeynmanEvaluatorPrompt` — AI 评委（temperature=0.3）

**嗅探类**：
- `buildDiagnoseRuntimeErrorPrompt` — 错误归因
- `buildSanityCheckConstraintsPrompt` — 范围审计
- `buildSniffIntentPrompt` — 意图偏离

### 5.2 通用风格指令

```typescript
SYSTEM_CODING_COACH = `你是一位资深的算法竞赛教练和编程导师，专注于辅导大学生学习 C++ 和 Python。

你的风格：
- 直接、犀利、不说废话
- 优先指出最关键的问题（按严重程度排序）
- 给出可执行的具体修改建议，不空谈
- 复杂度分析必须给出 Big-O 表达式`
```

---

## 6. AST-Light 本地 Agent

### 6.1 设计动机

LLM 经常**口胡复杂度**（O(n) 写成 O(n²)）。AST-Light 用启发式在 <5ms 内提取客观结构特征，喂给 LLM。

### 6.2 提取的特征

```typescript
extractFeatures(code: string, lang: Lang): CodeStructFeatures
  ├─ 循环嵌套深度
  ├─ 是否使用递归
  ├─ 数据结构选择（vector/array/map/set）
  ├─ I/O 方式（cin/cout/scanf/printf/stdin）
  ├─ 复杂度 hint（O(1)..O(n³+)）
  └─ red flags（cin 未关同步/嵌套循环/map vs unordered_map）
```

### 6.3 在 analyzeCode 中的使用

```typescript
analyzeCode(args)
  ├─ astFeatures = extractFeatures(args.code, args.language)  // 本地
  ├─ astFeatureBlock = formatFeaturesForPrompt(astFeatures)
  └─ buildAnalyzeCodePrompt({ ...args, astFeatureBlock })    // 注入 prompt
```

---

## 7. 文件路径速查

| 功能 | 文件 | 行号 |
|------|------|------|
| AIClient 主类 | `src/core/ai/client.ts` | ~380 行 |
| pickRoute | `src/core/ai/router.ts` | Coach 类外独立函数 |
| Coach 类 | `src/core/analyzer.ts` | ~1190 行 |
| routeCoachRequest | `src/core/coach/router.ts` | ~130 行 |
| prompts.ts | `src/core/ai/prompts.ts` | ~300+ 行 |
| AST-Light | `src/core/astLite.ts` | ~200 行 |
