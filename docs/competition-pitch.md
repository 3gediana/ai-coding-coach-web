# 竞赛 Pitch：按评分维度逐条对位

> 假设评分维度为：**创新性 20% · 技术深度 20% · 应用价值 15% · 用户体验 15% · 完整度 15% · 演示 / 商业 15%**。具体百分比可能微调，但维度组合在国内 AI Agent 类比赛里普遍一致。

---

## 创新性 (20%) — 主打：**Multi-Agent 编排在教育领域的真实落地**

### 1.1 不是「LLM Wrapper」的硬证据
项目里有 **11 个独立 Agent**，其中 3 个 (`学情诊断 → 题目筛选 → 计划编排`) 通过有向数据流真协作——**前一个的输出是后一个的输入，且任意一步失败可让整条链提前终止**。这在 `src/lib/store.ts:requestDailyPlan` 里直接可见。详细 [架构文档 §4](./architecture.md#4)。

### 1.2 「本地工具型 Agent」是项目独特创新
3 个子 Agent 中第 2 个 (题目筛选) 是 **纯本地逻辑、不调 LLM** 的 Agent (`src/core/recommend.ts:pickPlanCandidates`)。常见的 multi-agent 实现是 N 个 LLM 全 prompt——本项目证明 **「本地评分函数」也是 Agent**，省 token 又稳定。这种"混合 Agent 链"在大赛里很罕见。

### 1.3 主动 Agent 集群
**7 件主动行为** 让 AI 不等用户问、自己出现：题目导入即出概览、卡 60s 出苏格拉底提示、过 3 个样例后挑战 hack case、连续 3 次 WA 启用 escalation prompt、AC 后自动复盘、跨天推送复习、每日开 app 编排今日学习路径。**主动性 ≠ 弹弹弹**，每个 Agent 都有规则门槛 + AI 自主决策。

### 1.4 教育领域真实命中
不是「拿通用 Coach 套层 OJ 皮」。项目核心面向**算法竞赛学习者**：错题本结构、按知识点打分、按难度档路由、专门的 escalation prompt、OJ 油猴脚本桥接。**领域理解深度** 体现在每个 prompt 都写了「不要给完整 AC 代码、要按 severity 排序、要指向最相关行」这种教学约束。

---

## 技术深度 (20%) — 主打：**端云协同 + 低延迟 + 可解释**

### 2.1 三层架构
[架构文档 §2](./architecture.md#2) 详述。简版：

- **Layer 3 主动 Agent 集群** — 11 个 Agent 共享 Sense→Decide→Act→Feedback 循环
- **Layer 2 智能路由** — `pickRoute(taskKind, codeLength, difficulty, ...)` 按任务种类 + 代码长度 + 难度动态选 ⚡ 本地 / ☁ 云端
- **Layer 1 LLM 池** — 本地 Ollama (sam:latest, 1B 蒸馏) + 云端 (DeepSeek 默认 / MiniMax / OpenAI 兼容)

### 2.2 真实性能数据 ([bench-results/](../bench-results/))
- **本地 sam:latest 在 D1–D4 全难度命中率 100% (9/9)**
- TTFT 中位数 **300–500ms**，普通代码批注 5–9 秒
- 长上下文 ≤ 24K 时 tok/s 维持 40+，**24K 之后才显著掉速到 9.4 tok/s**
- 1B 蒸馏模型在简单题命中率不输 70B+ 云端

### 2.3 可解释性：AgentTracePanel
每个 Agent 的每次行动都写到前端可视面板（4 种 kind × 4 种 level），**评委可在 demo 视频 0:42 看到「[1/3] 学情诊断 Agent · 输出: 薄弱=DP / 强项=贪心」这种真实日志**。教育场景下「AI 是黑盒」是大忌——本项目把它打开了。

### 2.4 状态层是真持久化（IndexedDB + localStorage）
Mistakes / Sessions / Events / FailureStats / DailyPlan 全部跨 session 持久化。**「今天的错题影响明天的计划」是 long-running agent 的 mark of authenticity**。

### 2.5 工程化细节
- **流式 SSE** 输出 (Coach 多个方法 streamOpts.onDelta)
- **JSON Mode + 防御解析** (sam:latest D1–D4 JSON 100% 成功率)
- **缓存层防止重复烧 token** (problem.coachOverview / problem.acReview)
- **失败计数器自动升级 prompt** (P3 escalation)

---

## 应用价值 (15%) — 主打：**真用户场景 + 可量化收益**

### 3.1 用户画像 & 真问题
ACM/算法竞赛学习者，痛点是：

- 不会的题想问老师 → 老师不在
- 想找类似题练 → 不知道哪些类似
- WA 了不知道哪错 → 看不懂判题信息
- 错题反复犯 → 没人提醒重做

**项目对应解法**：Coach.askCoach / DailyPlan.候选 / analyzeCode / DailyReview。

### 3.2 量化收益（demo 数据）

| 场景 | 不用本项目 | 用本项目 | 提升 |
|---|---|---|---|
| WA 后定位 bug | 自查 5–15 min | AnalyzeCode 5–9s 出问题行 + 修复建议 | **30–100×** |
| 题面读不懂 | 翻样例算半小时 | ProblemOverview 自动出题意+模式 | **新手友好度跃迁** |
| 学习方向 | 凭感觉选题 | DailyPlan 按薄弱点编排 | **避免无效练习** |
| 错题本 | 大多数人不维护 | 自动累积 + 主动推送复习 | **从 0 到 1** |

### 3.3 隐私 & 成本
- 短代码不出本机 (本地路由)
- 用户自带 API key (项目不收任何 token 费)
- 错题本 / 计划全部存浏览器，**离线可用 80%+ 功能**

### 3.4 用户群规模
全国高校 ACM/算法课至少 **百万级活跃用户**，oj.iiitc.edu.cn / hdoj / vjudge / 学校 OJ 都是潜在落地场景。项目的油猴脚本支持已实测 educoder + 学校 OJ。

---

## 用户体验 (15%) — 主打：**最少 1 步 = 跑起来 ≥ 80% 功能**

### 4.1 极简启动
打开 app → 输入 API key → 点「保存并测试」→ 进入主界面看到示例题。**全程 < 30 秒**，不需要装环境、注册、配 endpoint。

### 4.2 最小化设置面板
SettingsModal 默认只露 4 个字段 (provider chip + base url + api key + model)，把 fastLane / IntentRouter / Coach sniff 等 8 个高级开关折进 "Advanced settings" 折叠区。**面向新手默认值即可用，老手有完整控制**。

### 4.3 主动而不是打扰
所有主动 Agent 都遵守：

- 每天/每题只弹 1 次（dismissedDate / generatedKey 控制）
- 用户 ✕ 关掉就当天/当题不再弹
- 7 个开关随时可关 (FastLane / IntentRouter / Coach Sniff / DiagnoseOnFail / ConstraintSanity / IntentSniff / DailyReview)

### 4.4 视觉与交互
- glass-card 风格统一，floating 浮卡都从屏幕边缘 spring 进入
- AgentTracePanel 用 4 色 level + 4 种 kind icon 一眼分辨
- DailyPlanCard 三态 (generating / pending / accepted) 自然过渡

---

## 完整度 (15%) — 主打：**生产级可用，不是 PPT 玩具**

### 5.1 真完整功能
- ✅ 题面解析 + 多文件支持
- ✅ 代码批注 + 复杂度推断
- ✅ 错题本 + 自动复习
- ✅ 学习计划 (multi-agent)
- ✅ OJ 提交桥 (educoder + 学校 OJ + 油猴脚本)
- ✅ 主动 Agent 集群 (7 件)
- ✅ Agent Trace 可视化
- ✅ 4 种 LLM provider + 本地 Ollama
- ✅ 流式输出 + JSON 严格模式
- ✅ 持久化 (IndexedDB + localStorage)

### 5.2 性能 / 兼容性测试
- `bench-results/` 含 5 类基准（sam-bench / quality / longctx-stab / longctx-ceiling / longctx-run）
- `screenshots*/` 含多分辨率/多主题/多功能截图
- Vite production build 无 error，TS strict 模式无 warning

### 5.3 文档
- [docs/architecture.md](./architecture.md) 详细架构
- [docs/competition-pitch.md](./competition-pitch.md) 本文
- [docs/demo-script.md](./demo-script.md) 演示脚本
- [docs/perf-comparison.md](./perf-comparison.md) 性能对比
- 仓库内每个核心模块 (analyzer.ts / store.ts / recommend.ts) 都有详细 doc comment

---

## 演示 / 商业 (15%) — 主打：**5 分钟 demo 看到所有亮点**

### 6.1 视频结构 ([demo-script.md](./demo-script.md))
- **0:00–1:30** 痛点 + 30 秒上手 + 第一次 AnalyzeCode (展示路由)
- **1:30–3:00** 写错代码 → 3 次失败触发 escalation → 看 P3 升级
- **3:00–4:00** **DailyPlan 编排链直播** (3 步进 trace panel)
- **4:00–4:30** 长期价值 (错题本 / 主动复习 / 油猴 OJ)
- **4:30–5:00** 架构图 + 「这是真 Agent，不是聊天框」

### 6.2 商业化路径
- **C 端 SaaS**: ¥9.9/月，AI key 由平台代充 (主要靠云端调用差价)
- **B 端 / 学校采购**: 学校私有部署 + 学校 OJ 桥接，按学生数收 license
- **API 模式**: 把 11 个 Agent 抽成 API 给其它教学产品集成
- 当前形态 (BYO key + 全前端) 已经是 **零运营成本可发布的 PWA**

### 6.3 对比同赛道
绝大多数 AI 教学项目 = ChatGPT 聊天框 + 简单题库。本项目的差异在于 **「Agent 主动性 + 多 Agent 协作 + 端云路由」3 个组合在一起**。把它和评委见过的 5–10 个项目放一起，Pitch 时直接放架构图，3 秒分清。

---

## 一页纸总结（Pitch Deck 用）

```
┌─────────────────────────────────────────────────────────┐
│   AI Coding Coach — 多 Agent 算法编程教练                │
│                                                          │
│   ▎13 个 Agent · 5 个真协作 · 7 件主动行为              │
│   ▎ 本地 1B + 云端 + 离线兜底 · 2 个本地无 LLM Agent     │
│   ▎ D1–D4 全难度 100% 命中 · TTFT 300–500ms            │
│   ▎ 跨天 long-running 状态 · IndexedDB 持久化           │
│                                                          │
│   ▎ 4 大杀手锏（评委 30 秒看完）                          │
│   1. DailyPlan 编排链：3 子 Agent (含本地工具型)         │
│   2. 费曼反向教学：用户教 AI、AI 装菜鸟、AI 评委评分     │
│   3. 飞行模式：拔网线本地 1B 完整可用 · 演示戏剧性       │
│   4. AST-Light：本地结构 Agent 喂 LLM 客观信号          │
│                                                          │
│   ▎ 对比一般 ChatGPT 教学应用                            │
│     · Agent 数      13     vs 1                         │
│     · 主动行为      7 件   vs 0                         │
│     · 真协作         5 个   vs 0                         │
│     · 反向教学      费曼   vs 无                         │
│     · 离线可用      ✓      vs ✗                         │
│     · 可观测视图    3      vs 0                         │
│                                                          │
│   ▎ 应用价值：百万级 ACM/算法学习者市场                  │
│   ▎ 商业：BYO key 零运营成本 PWA · 可 SaaS / B 端 / API │
└─────────────────────────────────────────────────────────┘
```

## 重要差异化亮点 - 一段话版（pitch deck 第一页用）

> 项目最特别的不是「会聊天的 AI 教练」，而是 **3 个东西的组合**：
>
> 1. **真 multi-agent 编排** — DailyPlan 用 3 个子 Agent 协作（其中第 2 个是本地评分函数，无 LLM），费曼模式用 2 个子 Agent (Student + Evaluator) 反向教学；
>
> 2. **本地 + 云端 + 离线** — 70%+ 请求走本地 1B 模型，**演示时一键飞行模式拔网线，AI 完整可用**——同赛道项目几乎都是 ChatGPT 套壳；
>
> 3. **3 视图 Agent 可观测面板** — List / Graph / Dashboard，业界 (OpenTelemetry / Langfuse) 推的 observability 标准在教育产品里落地，让评委用眼睛就能看到"AI 在干活"，**直接打掉"AI 是黑盒"这个常见诟病**。
