# 学习引擎详解

> 解析 `src/core/recommend.ts`, `src/core/profile.ts`, `src/core/utils.ts` 的学习系统

---

## 1. 学习引擎核心概念

### 1.1 设计哲学

- **错题复习优先**于推新题（学生对错题最有"认知亏欠"）
- **状态自适应**：没错题时不强推、刷完时不重复
- **可关闭**（DailyEngineCard UI 处理）
- 纯函数：易测试，无副作用

### 1.2 核心入口

```typescript
// src/core/recommend.ts
buildLearningEngine(args: {
  mistakes: Mistake[]
  problems: Problem[]
  sessions: Session[]
  bank: BankProblem[]
}): { overview: ProgressOverview, cards: LearningCard[] }
```

输出：
- `overview`：进度概览数字（错题率/本周活跃/top 错误类型）
- `cards`：1-4 张推荐行动卡片

---

## 2. 进度概览 (ProgressOverview)

### 2.1 计算逻辑

```typescript
buildOverview({ mistakes, problems, sessions })
  ├─ reviewedRate = 错题复习数 / 错题总数
  ├─ weekActivity = 7天内有session的唯一题目数
  ├─ topMistakeCategory = 最高频错题类别
  ├─ topMistakeTag = 最高频错题标签
  └─ hint = 状态文案
      ├─ 0 mistakes + 0 problems → "从一道经典题开始吧"
      ├─ 0 mistakes + 有 problems → "还没有错题，状态不错"
      ├─ reviewedRate < 0.4 → "X道错题，复习率Y%，建议先回看"
      ├─ reviewedRate < 1 → "X道错题，已复习Y道"
      └─ reviewedRate == 1 → "X道错题都复习过了，可挑战新题"
```

### 2.2 数据来源

| 指标 | 来源 |
|------|------|
| reviewedRate | `mistake.reviewedAt !== null` |
| weekActivity | `sessions` 中 7 天内有活动的 problemId |
| topMistakeCategory | `mistake.category` 最高频 |
| topMistakeTag | `mistake.knowledgePoints` 最高频 |

---

## 3. 推荐卡片 (LearningCard)

### 3.1 卡片类型

| 类型 | 触发条件 | icon |
|------|----------|------|
| `review-mistakes` | 有未复习错题 | 📝 |
| `new-similar` | 有 top tag 且题库有相似题 | 🎯 |
| `concept-recall` | 有 top category 且题库有相关题 | 💡 |
| `level-up` | 做完过题且题库有更高难度 | 🔥 |
| `first-step` | 0 mistakes + 0 problems | 🚀 |
| `browse-mistakes` | 错题全复习且无新卡片 | 📚 |

### 3.2 卡片优先级

1. `review-mistakes` — 永远优先（primary=true）
2. `new-similar`
3. `concept-recall`
4. `level-up`
5. `first-step` — 仅全空白时
6. `browse-mistakes` — 兜底

**最多返回 4 张卡片**。

---

## 4. 间隔重复 (Spaced Repetition)

### 4.1 pickDailyReview 算法

```typescript
pickDailyReview(mistakes): { mistake, reason } | null

评分公式：
├─ 从未复习：基础分 100 + ageDays + verdictBoost
├─ 复习一次（≥3天）：基础分 50 + reviewedDaysAgo + verdictBoost
└─ 复习多次（≥7天）：基础分 30 + reviewedDaysAgo + verdictBoost

verdictBoost：WA/RE/TLE +10 分（比 CE/OTHER 更紧迫）
```

**为什么这样设计**：
- 从未复习的错题最紧迫（认知亏欠最大）
- 已复习过的错题需要间隔才能转化为长期记忆
- WA/TLE 比 CE 更需要关注（思路问题而非语法）

### 4.2 复习阈值

- 复习 1 次后，需等待 **3 天** 才再推
- 复习 2+ 次后，需等待 **7 天** 才再推
- 今日新建的错题**不推**（太新鲜）

---

## 5. 题目筛选 (pickPlanCandidates)

### 5.1 新题评分

```typescript
pickPlanCandidates({ weakConcepts, mistakes, alreadyAdded, bank })
  └─ bank 中每道题评分：
      ├─ tag 命中 weakConcepts：+30 分
      ├─ title 命中 weakConcepts：+15 分
      ├─ difficulty = medium：+10 分
      └─ difficulty = easy：+5 分
      → 排序取 top 2
```

**为什么 medium 优先**：
- 基础不稳时刷太难的题会挫败
- 太简单的题没有提升
- 中等难度是"最近发展区"

### 5.2 复习题评分

```typescript
└─ mistakes 中每道评分：
    ├─ category 命中 weakConcepts：+50 分
    ├─ 知识点击中 weakConcepts：+50 分
    ├─ 从未复习 + ageDays ≥ 1：+30 + ageDays
    └─ 复习一次 + reviewedDaysAgo ≥ 3：+20 + reviewedDaysAgo
    → 排序取 top 2
```

---

## 6. 学生画像 (StudentProfile)

### 6.1 aggregateStudentProfile

```typescript
aggregateStudentProfile({ sessions, problems, mistakes })
  → StudentProfile
```

**计算维度**：
- 时间：todayMs/weekMs/monthProblems/totalEffectiveMs
- 连续学习：currentStreakDays/bestStreakDays/streakUrgencyMs
- 题目统计：totalProblems/passedProblems/passRate
- 难度分布：easy/medium/hard/unknown 的 total 和 passed
- 错题分析：pendingReview/reviewRate/verdictBreakdown/topAreaCodes
- OJ 来源：siteBreakdown
- 用时分布：under5/under15/under30/under60/over60 分钟分箱
- AI 辅助度：avgHintsPerPass/avgAnalyzePerPass/independentRate
- 近 8 周趋势：weeklyTrend[]

### 6.2 连续学习天数计算

```typescript
// sessions 的 startedAt 按天聚合
activeDaySet = new Set(sessions.map(s => ymd(s.startedAt)))

// 从今天往前数连续天数
cursor = todayStart
while (activeDaySet.has(ymd(cursor))) {
  currentStreak++
  cursor -= MS_DAY
}

// 若今天未打卡但昨天打了，从昨天往前算
if (currentStreak === 0 && activeDaySet.has(ymd(todayStart - MS_DAY))) {
  cursor = todayStart - MS_DAY
  // ...
}
```

---

## 7. 掌握度计算 (Mastery)

### 7.1 单题掌握度

```typescript
masteryOf({ session, isMistake, hintTakenCount })
  base = 0.7
  - 0.10 * stuckCount        // 卡住次数
  - 0.01 * awayMinutes       // 离开分钟数
  - 0.20 * isMistake         // 成为错题
  + 0.05 * hintTakenCount    // 主动采纳 AI 建议
  + 0.30 * (outcome === 'pass')  // AC 加分
  clamp [0, 1]
```

### 7.2 知识点掌握度

```typescript
aggregateMastery({ sessions, problems, mistakes, events })
  ├─ perProblem: 每道题的 ProblemMastery
  └─ perTag: 按 tag 聚合的平均分
      └─ { score: avg(score), count: 题目数 }
```

---

## 8. buildLearnerProfile

### 8.1 用途

给 AI 当上下文，告诉它学生当前的薄弱点。

```typescript
buildLearnerProfile({ sessions, problems, mistakes, events, currentProblemTags })
  ├─ weakestTags: 最弱的 3 个 tag（按掌握度排序）
  ├─ topMistakeCategories: 最近 10 道错题中最高频的 5 个类别
  ├─ currentTagsHitWeak: 当前题目命中了哪些薄弱 tag
  ├─ streakDays: 连续学习天数
  ├─ pendingReviewCount: 待复习错题数
  ├─ last7DaysProblems: 近 7 天做题数
  ├─ independentRate: 独立解题率
  └─ topVerdict: 最高频 verdict
```

### 8.2 体积控制

- `weakestTags` 最多 3 个
- `topMistakeCategories` 最多 5 个（取自最近 10 道）
- 超出部分截断

---

## 9. 文件路径速查

| 功能 | 文件 | 关键行号 |
|------|------|----------|
| buildLearningEngine | `src/core/recommend.ts` | 74-83 |
| buildOverview | `src/core/recommend.ts` | 87-142 |
| buildCards | `src/core/recommend.ts` | 146-260 |
| pickDailyReview | `src/core/recommend.ts` | 313-363 |
| pickPlanCandidates | `src/core/recommend.ts` | 377-478 |
| aggregateStudentProfile | `src/core/profile.ts` | 112-344 |
| masteryOf | `src/core/utils.ts` | 119-135 |
| aggregateMastery | `src/core/utils.ts` | 138-221 |
| buildLearnerProfile | `src/core/utils.ts` | 233-297 |
