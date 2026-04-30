# 文档索引

> 本目录是 **AI Coding Coach** 项目竞赛阶段的技术 + 战略文档。建议阅读顺序：

| 文件 | 一句话定位 | 适用读者 |
|---|---|---|
| **[architecture.md](./architecture.md)** | 三层 AI 架构 + 11 个 Agent + 多 Agent 协作硬证据 | 技术评委 / 同行 |
| **[competition-pitch.md](./competition-pitch.md)** | 按 6 个评分维度逐条对位项目亮点 | 比赛评委 |
| **[demo-script.md](./demo-script.md)** | 5 分钟 demo 视频脚本 + 录制 checklist + punch lines | 路演 / 视频组 |
| **[perf-comparison.md](./perf-comparison.md)** | 本地 1B vs 云端真实 bench 数据 + 路由策略论证 | 技术评委 |

## 快速导览（评委 5 分钟用）

1. **看架构图** — [architecture.md §2](./architecture.md#2-三层-ai-架构图)（30 秒）
2. **看多 Agent 协作硬证据** — [architecture.md §4](./architecture.md#4-多-agent-协作的核心证据dailyplan-编排链)（1 分钟）
3. **看创新性对位** — [competition-pitch.md 创新性段](./competition-pitch.md#创新性-20--主打multi-agent-编排在教育领域的真实落地)（1 分钟）
4. **看 demo 视频** — [demo-script.md](./demo-script.md)（5 分钟视频）
5. **看本地 1B 性能数据** — [perf-comparison.md §2](./perf-comparison.md#2-全难度命中率核心数据)（30 秒）

## 关键数字速查

| 维度 | 数字 |
|---|---|
| Agent 总数 | **13** |
| 真协作 Agent 链 | **5 个**（DailyPlan ×3 + Feynman ×2） |
| 本地无 LLM Agent | **2 个**（pickPlanCandidates + AstDiff） |
| 主动行为种类 | **7 件** |
| LLM provider 支持 | **DeepSeek / OpenAI / MiniMax / 本地 Ollama** |
| 本地模型命中率 (D1–D4) | **100% (9/9)** |
| 本地 TTFT (warm) | **300–500ms** |
| 本地长 ctx 稳定上限 | **24K** |
| Trace Panel 视图 | **3 视图** (List / Graph / Dashboard) |
| 离线可用 | **✓** 一键飞行模式 |
| 启动到能用耗时 | **< 30 秒** |

## 项目仓库

主代码：`../src/` — 详见 [architecture.md §9](./architecture.md#9-关键文件索引) 的文件索引。

测试数据：`../bench-results/` — 真实跑测的 .md + .json 报告。

截图：`../screenshots*/` — 多分辨率/多主题/多功能展示。
