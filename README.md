# AI Coding Coach

> 面向算法竞赛学习者的 AI 编程教练：把题目理解、代码批注、算法动画、运行反馈、错题复盘和学习规划串成一个完整闭环。

AI Coding Coach 不是一个“加了聊天框的刷题网页”。它更像一个会陪你做题的教练系统：你录入题目、写代码、运行、提交、犯错、修正、复盘，背后会有多条 AI / 本地 Agent 链路持续观察上下文，并在合适时机给出反馈。

## 核心亮点

### 1. AlgoViz：从题目自动生成算法动画

项目最核心的展示点是 **AlgoViz 算法可视化流水线**。系统不会只给一段静态解释，而是把题目拆成可播放的算法动画：

```text
Trace 轨迹生成
  ↓
VisualPlan 视觉规划
  ↓
Status 实时模块面板
  ↓
Animation Remotion 动画生成
```

Trace 阶段会直接判断算法模板路线，例如：

- `dynamic_programming.table.v1`
- `binary_search.interval.v1`
- `union_find.parent_array.v1`

后续 VisualPlan / Animation 会注入对应模板，让动画不仅“能动”，而且更像真正的算法教学动画。

| Dynamic Programming | Binary Search | Union Find |
|---|---|---|
| ![DP transition](./screenshots/02-algoviz-dp-transition.png) | ![Binary search found](./screenshots/05-algoviz-binary-search-found.png) | ![Union find union step](./screenshots/08-algoviz-union-find-union.png) |

### 2. 实时代码批注：反馈直接长在代码旁边

学生最需要的不是一大段泛泛而谈的回答，而是“这行哪里有问题”。AI Coding Coach 会把代码分析结果直接渲染到 Monaco 编辑器行尾：

- 错误、警告、提示分色展示
- 代码修改后旧批注自动隐藏
- 右侧面板同步显示整体诊断
- 可结合本地 FastLane 模型做低延迟反馈

这让反馈从“聊天窗口里的建议”变成“贴在代码上的教练批注”。

### 3. 多 Agent 学习闭环

项目内置多条面向学习场景的 Agent 链路：

- **AnalyzeCode**：代码审查与行内批注
- **AlgoViz**：算法轨迹、状态面板、动画生成
- **Hack Chain**：对抗式调试，主动寻找能 hack 当前代码的测试点
- **DailyPlan**：根据错题和学习历史生成每日训练计划
- **Feynman**：用户反向教 AI，AI 扮演学生追问，再由评委 Agent 评分
- **RuntimeDiagnose**：运行失败时做快速归因
- **ConstraintSanity**：结合题目数据范围提醒潜在复杂度风险
- **AcReview / DailyReview / SummarizeMistake**：AC 后复盘、错题总结、每日复习

它们不是孤立按钮，而是围绕“做题学习”这个主流程协同工作。

### 4. 云端 + 本地双轨路由

不同任务对模型的要求不同：

- 高频、短反馈任务适合本地 Ollama / FastLane
- 题面解析、动画生成、错题总结适合云端大模型

项目内置路由层，按任务类型、代码长度、上下文复杂度自动决定走本地还是云端。这样既能降低延迟和成本，也能在需要高质量推理时调用更强模型。

### 5. 不是黑盒：Agent 行动可观测

右侧 Agent Trace 面板会记录系统做过什么：

- 感知了什么输入
- 决定触发哪个任务
- 调用了哪个 Agent
- 返回了什么结果

这让“AI 在背后做事”变成可观察、可解释的过程，也更适合作为参赛作品展示。

## 用户流程

```text
录入题目
  ↓
AI 解析题面，生成题目摘要
  ↓
学生写代码
  ↓
实时批注 / 运行反馈 / 算法模块进度
  ↓
运行样例或提交结果
  ↓
错题沉淀 / AC 复盘 / 每日计划
  ↓
必要时播放 AlgoViz 动画理解算法
```

## 功能概览

| 模块 | 作用 |
|---|---|
| 题目录入 | 支持手动粘贴题面，也支持部分 OJ URL 抓题 |
| 代码编辑器 | Monaco Editor，支持 C++ / C / Python / Markdown |
| 代码运行 | Python 使用 Pyodide，C/C++ 可接远程编译运行 |
| AI 批注 | 代码行尾直接展示错误、警告、提示 |
| 问教练 | 可围绕题意、代码片段、报错自由提问 |
| AlgoViz | 自动生成算法状态面板和可播放动画 |
| 错题本 | 保存错误原因、知识点、复习建议 |
| 学习计划 | 基于历史表现生成每日训练路径 |
| Agent Trace | 展示 Agent 行动日志、图谱和仪表盘 |
| 模型配置 | 支持云端兼容接口 / 本地推理服务，并可在设置中自由分配模型角色 |

## 技术架构

```text
React + TypeScript + Zustand
  ↓
学习状态层：题目 / 文件 / 错题 / 会话 / Agent Trace
  ↓
AI 编排层：AnalyzeCode / AlgoViz / Hack Chain / DailyPlan / Feynman
  ↓
模型路由层：云端 LLM / 本地 Ollama FastLane
  ↓
可视化层：Monaco 行内批注 + Remotion 算法动画
```

主要技术：

- **React 18**
- **TypeScript**
- **Zustand**
- **Monaco Editor**
- **Remotion**
- **Playwright**
- **Pyodide**
- **OpenAI-compatible cloud API**
- **Local inference runtime**

## AlgoViz 模板覆盖

当前内置了常见算法族的动画模板提示，包括：

- 动态规划表格
- 哈希查找
- 二分搜索
- 滑动窗口
- 双指针
- 前缀和
- 单调栈
- BFS 队列
- DFS / 回溯
- 堆 / Top-K
- 并查集
- 贪心区间
- 图最短路
- 树遍历

模板不是前端硬编码动画，而是作为生成约束注入给模型，让同一条生产流水线可以适配不同算法家族。

## 本地运行

```bash
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173/
```

## 从零克隆与部署

### 1. 环境要求

推荐环境：

- **Node.js 20 LTS 或更高**（项目已在较新的 Node 版本下开发；建议不要低于 Node 18）
- **npm 10+**
- **现代 Chromium 浏览器**（Chrome / Edge 均可）
- **Tampermonkey / 篡改猴**（用于从 OJ 抓题和把代码回填到 OJ）
- 可选：**Ollama**（用于本地 FastLane / 视觉识别）

检查版本：

```bash
node -v
npm -v
```

### 2. 克隆项目

```bash
git clone <your-repo-url>
cd ai-coding-coach-web
npm install
```

如果你需要 Playwright E2E 测试：

```bash
npx playwright install
```

### 3. 配置环境变量

复制模板：

```bash
cp .env.example .env.local
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

常用配置项：

```dotenv
AI_COACH_PROVIDER=deepseek
AI_COACH_BASE_URL=https://api.deepseek.com/v1/chat/completions
AI_COACH_KEY=your-api-key-here
AI_COACH_MODEL=deepseek-v4-flash

AICC_OLLAMA_BASE=http://127.0.0.1:11434
AICC_VISION_MODEL=qwen3.5:4b
```

说明：

- `AI_COACH_*`：云端 OpenAI-compatible 模型接口，用于题面解析、代码分析、问教练、总结等。
- `AICC_OLLAMA_BASE`：本地 Ollama 地址。
- `AICC_VISION_MODEL`：OJ 题面图片识别模型，推荐使用可视觉理解的本地模型；没有本地视觉模型时，纯文本题仍可正常使用。
- `.env.local` 不要提交到 Git。

### 4. 启动开发服务

推荐固定端口启动：

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

打开：

```text
http://127.0.0.1:5173/
```

Vite 开发服务同时提供本地桥接接口：

- `POST /__import`：油猴脚本推送题目到 AI Coach
- `GET /__import-sse`：前端接收题目导入事件
- `POST /__oj-submit-command`：前端下发“回填/评测”命令
- `GET /__oj-next-command`：油猴脚本在 OJ 页面轮询命令
- `POST /__oj-result`：油猴脚本回传 `filled` / `done` / `failed`
- `GET /__oj-result-sse`：前端监听 OJ 回传结果
- `POST /__probe-snapshot`：DOM 探针快照回传
- `POST /__oj-debug-log`：OJ 回填调试日志

### 5. 生产构建与预览

```bash
npm run build
npm run preview
```

预览默认使用 Vite preview。实际部署到静态托管平台时，只部署 `dist/` 即可。

注意：

- 静态部署只包含前端页面。
- OJ 油猴桥接依赖 Vite dev middleware 的本地接口；如果要在生产环境继续使用 OJ 抓题/回填，需要提供等价的后端桥接服务。
- 本项目当前主要面向本地学习/竞赛展示场景，推荐使用本地 `npm run dev -- --host 127.0.0.1 --port 5173`。

## 油猴脚本安装与 OJ 联动

项目内有两个用户脚本：

```text
scripts/userscripts/aicc-pusher.user.js
scripts/userscripts/aicc-probe.user.js
```

### 1. 正式推送脚本：`aicc-pusher.user.js`

用途：

- 在头歌 Educoder / 校内 OJ 页面显示“推送到 AI Coach”按钮。
- 抓取当前题面、样例、图片和初始代码。
- 将题目推送到本地 AI Coach。
- 接收 AI Coach 下发的代码回填命令。
- 支持：
  - **只回填到 OJ**
  - **回填并自动评测**

安装方式：

1. 打开 Tampermonkey / 篡改猴。
2. 新建脚本。
3. 复制 `scripts/userscripts/aicc-pusher.user.js` 的完整内容。
4. 保存并启用。
5. 刷新 OJ 页面。

当前匹配站点：

```js
// @match http://10.11.219.21/*
// @match https://www.educoder.net/*
```

如果你的学校 OJ 域名不同，需要在脚本头部增加对应 `@match`，并在代码中扩展 `detectSite()` / URL 归一化逻辑。

### 2. DOM 探针脚本：`aicc-probe.user.js`

用途：

- 通用采集页面结构。
- 识别 Monaco / CodeMirror / Ace / textarea。
- 记录按钮、表单、结果区、iframe、storage、网络请求等。
- 将快照回传到：

```text
logs/dom-snapshots/
```

安装方式与正式脚本相同，但它只用于侦查页面结构，不会自动提交代码。

### 3. 推荐 OJ 使用流程

1. 启动本地服务：

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

2. 打开 OJ 题目页。
3. 点击油猴浮动按钮，将题目推送到 AI Coach。
4. 在 AI Coach 中写代码。
5. 打开底部终端运行样例。
6. 当样例输出与题目第一个样例完全匹配时，终端会临时显示：

```text
样例 AC  回填  评测
```

按钮含义：

- **回填**：只把当前代码写回原 OJ 编辑器，不自动提交。
- **评测**：写回原 OJ 后点击 OJ 的提交/评测按钮，并等待 verdict 回传。

这个按钮不是常驻的。以下情况会自动消失：

- 换题
- 换文件
- 修改当前代码
- 重新运行
- 编译失败 / 运行失败
- 样例输出不匹配
- 点击回填或评测后

### 4. 平台适配说明

当前已验证：

- **头歌 Educoder**
  - 编辑器：Monaco
  - 写入策略：聚焦 textarea，清空后通过编辑器事件写入
  - 不污染系统剪切板

- **校内 OJ**
  - 编辑器：CodeMirror
  - 写入策略：优先调用 `cm.CodeMirror.setValue(code)`

命令匹配使用：

```text
source + normalized URL
```

所以同时打开头歌和校内 OJ 不会互相抢命令。  
但如果同一道题开多个相同标签页，可见的页面可能先拿到命令；建议同题只保留一个前台页面。

## 配置模型

在网页右上角设置里配置模型：

- 云端兼容接口
- 本地推理服务
- 多模型注册与角色分配

建议：

- 主模型 / 题面解析 / 代码批注 / 问教练：使用响应快、成本低的云端模型
- AlgoViz 模板生成 / 动画生成：使用质量更高的云端模型
- 实时检测 / stuck hint / 短解释：优先使用本地 FastLane 模型

## 验证

```bash
npm run typecheck
```

可选：

```bash
npm test
npm run test:e2e
```

## 项目文档

更多竞赛和架构文档见：

- [`docs/architecture.md`](./docs/architecture.md)
- [`docs/competition-pitch.md`](./docs/competition-pitch.md)
- [`docs/demo-script.md`](./docs/demo-script.md)
- [`docs/perf-comparison.md`](./docs/perf-comparison.md)

## 一句话总结

AI Coding Coach 的目标是把“AI 会回答问题”推进到“AI 能陪学生完成一次完整算法学习过程”：

**看懂题 → 写代码 → 批注纠错 → 动画理解 → 运行验证 → 错题复盘 → 下一步训练。**
