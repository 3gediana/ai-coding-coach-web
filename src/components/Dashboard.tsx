/**
 * 学习空间：综合学生画像。
 *
 * 模块：
 *   1. 顶部统计行（今日/本周/累计 + 🔥 streak）
 *   2. 学习日历 heatmap
 *   3. 8 周趋势曲线（通过/错题）
 *   4. 难度分布 + 用时分布（横向 mini bar）
 *   5. verdict 错误类型分布
 *   6. 知识雷达
 *   7. AI 辅助度评分卡
 *   8. OJ 来源分布
 *   9. 待复习提醒（如果 pendingReview > 0）
 */
import { useStore } from '../lib/store';
import { aggregateMastery, formatDurationMs } from '../core/utils';
import { aggregateStudentProfile } from '../core/profile';
import { useMemo } from 'react';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
} from 'recharts';
import {
  TrendingUp, Target, AlertCircle, Clock, Flame, Calendar,
  BookOpen, Sparkles, Award, BarChart3,
} from 'lucide-react';
import { LearningHeatmap } from './LearningHeatmap';
import { cn } from '../lib/cn';

const SITE_LABEL: Record<string, string> = {
  luogu: '洛谷', atcoder: 'AtCoder', poj: 'POJ', hdu: 'HDU',
  codeforces: 'CF', leetcode: 'LeetCode', nowcoder: '牛客', other: '其它',
};

export function Dashboard() {
  const sessions = useStore((s) => s.sessions);
  const problems = useStore((s) => s.problems);
  const mistakes = useStore((s) => s.mistakes);
  const setSidebarTab = useStore((s) => s.setSidebarTab);

  const stats = useMemo(
    () => aggregateMastery({ sessions, problems, mistakes, events: [] }),
    [sessions, problems, mistakes],
  );

  const profile = useMemo(
    () => aggregateStudentProfile({ sessions, problems, mistakes }),
    [sessions, problems, mistakes],
  );

  const radarData = useMemo(() => {
    const tags = Object.entries(stats.perTag)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6);
    return tags.map(([tag, v]) => ({
      tag,
      mastery: Math.round(v.score * 100),
      count: v.count,
    }));
  }, [stats]);

  return (
    <div className="p-3 space-y-3">
      {/* ────── 1. 顶部统计行 ────── */}
      <div className="grid grid-cols-3 gap-2">
        <Stat
          icon={Calendar}
          label="今日"
          value={profile.todayProblems > 0 ? `${profile.todayProblems} 题` : '0 题'}
          sub={profile.todayMs > 0 ? formatDurationMs(profile.todayMs) : '未开始'}
          good={profile.todayProblems > 0}
        />
        <Stat
          icon={TrendingUp}
          label="本周"
          value={`${profile.weekProblems} 题`}
          sub={formatDurationMs(profile.weekMs)}
        />
        <Stat
          icon={Clock}
          label="累计"
          value={`${stats.totalProblems} 题`}
          sub={formatDurationMs(profile.totalEffectiveMs)}
        />
      </div>

      {/* Streak + 通过率（关键数字大字号） */}
      <div className="grid grid-cols-2 gap-2">
        <div className="glass-card p-3">
          <div className="flex items-center gap-1 text-[9px] text-ink-mute uppercase tracking-wider mb-1.5">
            <Flame size={9} className="text-warn" />
            连续打卡
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={cn(
              'text-2xl font-bold leading-none tabular-nums',
              profile.currentStreakDays > 0 ? 'text-warn' : 'text-ink-mute',
            )}>
              {profile.currentStreakDays}
            </span>
            <span className="text-[11px] text-ink-mute">天</span>
            {profile.bestStreakDays > profile.currentStreakDays && (
              <span className="ml-auto text-[10px] text-ink-mute">最长 {profile.bestStreakDays}</span>
            )}
          </div>
          {profile.streakUrgencyMs > 0 && profile.streakUrgencyMs < 6 * 3600_000 && (
            <div className="text-[10px] text-warn mt-1.5">
              ⏰ 今天还没打卡，剩 {Math.ceil(profile.streakUrgencyMs / 3600_000)}h
            </div>
          )}
        </div>
        <div className="glass-card p-3">
          <div className="flex items-center gap-1 text-[9px] text-ink-mute uppercase tracking-wider mb-1.5">
            <Award size={9} className="text-ok" />
            通过率
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-ok leading-none tabular-nums">
              {Math.round(profile.passRate * 100)}%
            </span>
            <span className="text-[11px] text-ink-mute">
              {profile.passedProblems}/{profile.totalProblems}
            </span>
          </div>
          <div className="text-[10px] text-ink-mute mt-1.5">
            错题 {profile.mistakeProblems} 道
          </div>
        </div>
      </div>

      {/* ────── 9. 待复习提醒（若有） ────── */}
      {profile.pendingReview > 0 && (
        <button
          onClick={() => setSidebarTab('mistakes')}
          className="w-full glass-card p-3 border-warn/40 bg-warn/5 hover:bg-warn/10 transition text-left"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-warn" />
            <div className="flex-1">
              <div className="text-xs font-semibold text-warn">
                {profile.pendingReview} 道错题待复习
              </div>
              <div className="text-[10px] text-ink-mute mt-0.5">
                超过 3 天没回看 — 点击进入错题本
              </div>
            </div>
          </div>
        </button>
      )}

      {/* ────── 2. 学习日历 ────── */}
      <LearningHeatmap sessions={sessions} weeks={26} />

      {/* ────── 3. 8 周趋势曲线 ────── */}
      {profile.weeklyTrend.some((w) => w.passed > 0 || w.mistakes > 0) && (
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 mb-2 text-xs">
            <BarChart3 size={12} className="text-cyan" />
            <span className="font-semibold">近 8 周趋势</span>
            <span className="ml-auto text-[10px] text-ink-mute">
              通过 vs 错题
            </span>
          </div>
          <div className="h-32 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={profile.weeklyTrend} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="passGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(133 153 0)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="rgb(133 153 0)" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="mistGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(203 75 22)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="rgb(203 75 22)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'rgb(var(--c-ink-mute))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'rgb(var(--c-ink-mute))' }} axisLine={false} tickLine={false} width={20} />
                <Tooltip
                  contentStyle={{
                    background: 'rgb(var(--c-bg-card))',
                    border: '1px solid rgb(var(--c-line))',
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  labelStyle={{ color: 'rgb(var(--c-ink))' }}
                />
                <Area type="monotone" dataKey="passed" stroke="rgb(133 153 0)" strokeWidth={2} fill="url(#passGrad)" name="通过" />
                <Area type="monotone" dataKey="mistakes" stroke="rgb(203 75 22)" strokeWidth={2} fill="url(#mistGrad)" name="错题" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ────── 4a. 难度分布 ────── */}
      {(profile.difficultyBreakdown.easy.total + profile.difficultyBreakdown.medium.total + profile.difficultyBreakdown.hard.total) > 0 && (
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 mb-2 text-xs">
            <Target size={12} className="text-accent" />
            <span className="font-semibold">难度分布</span>
          </div>
          <div className="space-y-1.5">
            <DiffBar
              label="入门"
              total={profile.difficultyBreakdown.easy.total}
              passed={profile.difficultyBreakdown.easy.passed}
              color="ok"
            />
            <DiffBar
              label="中等"
              total={profile.difficultyBreakdown.medium.total}
              passed={profile.difficultyBreakdown.medium.passed}
              color="warn"
            />
            <DiffBar
              label="困难"
              total={profile.difficultyBreakdown.hard.total}
              passed={profile.difficultyBreakdown.hard.passed}
              color="bad"
            />
          </div>
        </div>
      )}

      {/* ────── 4b. 用时分布 ────── */}
      {profile.passedProblems > 0 && (
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 mb-2 text-xs">
            <Clock size={12} className="text-cyan" />
            <span className="font-semibold">单题用时分布</span>
            <span className="ml-auto text-[10px] text-ink-mute">仅通过题</span>
          </div>
          <div className="space-y-1.5">
            {[
              { key: 'under5', label: '< 5 分钟', count: profile.timeDistribution.under5 },
              { key: 'under15', label: '5–15 分钟', count: profile.timeDistribution.under15 },
              { key: 'under30', label: '15–30 分钟', count: profile.timeDistribution.under30 },
              { key: 'under60', label: '30–60 分钟', count: profile.timeDistribution.under60 },
              { key: 'over60', label: '> 60 分钟', count: profile.timeDistribution.over60 },
            ].map((row) => {
              const total = Object.values(profile.timeDistribution).reduce((a, b) => a + b, 0);
              const pct = total > 0 ? (row.count / total) * 100 : 0;
              return (
                <div key={row.key} className="flex items-center gap-2 text-[11px]">
                  <span className="w-20 text-ink-dim shrink-0">{row.label}</span>
                  <div className="flex-1 h-2 bg-bg-elev2/50 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan/60 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-ink-mute font-mono">{row.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ────── 5. verdict 分布 ────── */}
      {mistakes.length > 0 && (
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 mb-2 text-xs">
            <BookOpen size={12} className="text-warn" />
            <span className="font-semibold">错误类型</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['WA', 'TLE', 'MLE', 'RE', 'CE', 'OTHER'] as const).map((v) => {
              const n = profile.verdictBreakdown[v];
              if (n === 0) return null;
              return (
                <span
                  key={v}
                  className={cn(
                    'chip text-[10px]',
                    v === 'WA' && 'border-bad/40 text-bad bg-bad/10',
                    v === 'TLE' && 'border-warn/40 text-warn bg-warn/10',
                    v === 'MLE' && 'border-warn/40 text-warn bg-warn/10',
                    v === 'RE' && 'border-bad/40 text-bad bg-bad/10',
                    v === 'CE' && 'border-bad/40 text-bad bg-bad/10',
                    v === 'OTHER' && 'border-line text-ink-dim',
                  )}
                >
                  {v} {n}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ────── 6. 知识雷达 ────── */}
      <div className="glass-card p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-xs">
            <Sparkles size={12} className="text-accent" />
            <span className="font-semibold">知识雷达</span>
          </div>
          <span className="text-[10px] text-ink-mute">出现最多的 6 个 tag</span>
        </div>
        {radarData.length === 0 ? (
          <p className="text-xs text-ink-mute py-8 text-center">练几道题才有数据</p>
        ) : (
          <div className="h-52 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgb(var(--c-line))" />
                <PolarAngleAxis dataKey="tag" tick={{ fill: 'rgb(var(--c-ink-dim))', fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fill: 'rgb(var(--c-ink-mute))', fontSize: 9 }} axisLine={false} />
                <Radar
                  name="掌握度"
                  dataKey="mastery"
                  stroke="rgb(var(--c-accent))"
                  fill="rgb(var(--c-accent))"
                  fillOpacity={0.35}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ────── 7. AI 辅助度评分 ────── */}
      {profile.passedProblems > 0 && (
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 mb-2 text-xs">
            <Sparkles size={12} className="text-cyan" />
            <span className="font-semibold">AI 辅助度</span>
            <span className="ml-auto text-[10px] text-ink-mute">基于通过题平均</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <Metric
              label="独立解题率"
              value={`${Math.round(profile.independentRate * 100)}%`}
              sub="0 hint AC"
              tone={profile.independentRate > 0.7 ? 'good' : profile.independentRate > 0.4 ? 'normal' : 'warn'}
            />
            <Metric
              label="平均 hint"
              value={profile.avgHintsPerPass.toFixed(1)}
              sub="次/题"
            />
            <Metric
              label="平均 analyze"
              value={profile.avgAnalyzePerPass.toFixed(1)}
              sub="次/题"
            />
            <Metric
              label="平均卡住"
              value={profile.avgStuckPerPass.toFixed(1)}
              sub="次/题"
              tone={profile.avgStuckPerPass < 1 ? 'good' : profile.avgStuckPerPass < 3 ? 'normal' : 'warn'}
            />
          </div>
        </div>
      )}

      {/* ────── 8. OJ 来源分布 ────── */}
      {Object.keys(profile.siteBreakdown).length > 0 && (
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 mb-2 text-xs">
            <BookOpen size={12} className="text-cyan" />
            <span className="font-semibold">题目来源</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(profile.siteBreakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([site, n]) => (
                <span key={site} className="chip text-[10px]">
                  {SITE_LABEL[site] ?? site} {n}
                </span>
              ))}
          </div>
        </div>
      )}

      {/* ────── 错题分类 + topAreaCodes（保留但简化） ────── */}
      {mistakes.length > 0 && (
        <div className="glass-card p-3">
          <div className="text-xs font-semibold mb-2">错题最常见类型</div>
          <ul className="space-y-1">
            {topCategories(mistakes).slice(0, 5).map((c) => (
              <li key={c.category} className="flex items-center justify-between text-xs">
                <span className="text-ink-dim">{c.category}</span>
                <span className="chip-warn text-[10px]">×{c.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ────── 子组件 ──────

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  good,
  warn,
}: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
  good?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-1 text-[9px] text-ink-mute uppercase tracking-wider mb-1.5">
        <Icon size={9} />
        {label}
      </div>
      {/* 数字大字号 + 紧凑 sub 建立 hierarchy；学生反思时一眼锁定关键数字 */}
      <div
        className={cn(
          'text-2xl font-bold leading-none tabular-nums',
          good && 'text-ok',
          warn && 'text-warn',
          !good && !warn && 'text-ink',
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-ink-mute mt-1.5">{sub}</div>}
    </div>
  );
}

function DiffBar({
  label,
  total,
  passed,
  color,
}: {
  label: string;
  total: number;
  passed: number;
  color: 'ok' | 'warn' | 'bad';
}) {
  if (total === 0) return null;
  const passPct = (passed / total) * 100;
  // 满饱和度填色（米黄背景下足够醒目）+ 跟 light 主题契合
  const colorMap = {
    ok: 'bg-ok',
    warn: 'bg-warn',
    bad: 'bg-bad',
  };
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-12 text-ink-dim shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-bg-elev2 rounded-full overflow-hidden">
        <div
          className={cn('h-full transition-all', colorMap[color])}
          style={{ width: `${passPct}%`, opacity: 0.85 }}
        />
      </div>
      <span className="w-12 text-right text-ink-mute font-mono tabular-nums">
        {passed}/{total}
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'normal' | 'warn';
}) {
  return (
    <div className="rounded-md border border-line bg-bg-elev/40 p-2">
      <div className="text-[9px] text-ink-mute uppercase tracking-wider">{label}</div>
      <div
        className={cn(
          'text-base font-bold mt-0.5',
          tone === 'good' && 'text-ok',
          tone === 'warn' && 'text-warn',
          (!tone || tone === 'normal') && 'text-ink',
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[9px] text-ink-mute">{sub}</div>}
    </div>
  );
}

function topCategories(mistakes: Array<{ category: string }>) {
  const m = new Map<string, number>();
  for (const x of mistakes) {
    m.set(x.category, (m.get(x.category) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}
