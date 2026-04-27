import { useStore } from '../lib/store';
import { aggregateMastery, formatDurationMs } from '../core/utils';
import { useMemo } from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { TrendingUp, Target, AlertCircle, Clock } from 'lucide-react';

export function Dashboard() {
  const sessions = useStore((s) => s.sessions);
  const problems = useStore((s) => s.problems);
  const mistakes = useStore((s) => s.mistakes);

  const stats = useMemo(
    () => aggregateMastery({ sessions, problems, mistakes, events: [] }),
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
      <div className="grid grid-cols-2 gap-2">
        <Stat icon={Target} label="练题数" value={stats.totalProblems} />
        <Stat icon={TrendingUp} label="通过数" value={stats.passedProblems} good />
        <Stat icon={AlertCircle} label="错题题数" value={stats.mistakeProblems} warn />
        <Stat icon={Clock} label="累计时长" value={formatDurationMs(stats.totalEffectiveMs)} />
      </div>

      <div className="glass-card p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-ink">知识雷达</span>
          <span className="text-[10px] text-ink-mute">取出现最多的 6 个 tag</span>
        </div>
        {radarData.length === 0 ? (
          <p className="text-xs text-ink-mute py-8 text-center">练几道题才有数据</p>
        ) : (
          <div className="h-52 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="#262b3d" />
                <PolarAngleAxis
                  dataKey="tag"
                  tick={{ fill: '#9aa3b8', fontSize: 10 }}
                />
                <PolarRadiusAxis
                  domain={[0, 100]}
                  tick={{ fill: '#5f6884', fontSize: 9 }}
                  axisLine={false}
                />
                <Radar
                  name="掌握度"
                  dataKey="mastery"
                  stroke="#7c83ff"
                  fill="#7c83ff"
                  fillOpacity={0.35}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: '#9aa3b8' }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {mistakes.length > 0 && (
        <div className="glass-card p-3">
          <div className="text-xs font-semibold mb-2">最近错题分类</div>
          <ul className="space-y-1">
            {topCategories(mistakes).slice(0, 5).map((c) => (
              <li
                key={c.category}
                className="flex items-center justify-between text-xs"
              >
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

function Stat({
  icon: Icon,
  label,
  value,
  good,
  warn,
}: {
  icon: any;
  label: string;
  value: string | number;
  good?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-ink-mute uppercase tracking-wider mb-1">
        <Icon size={10} />
        {label}
      </div>
      <div
        className={
          'text-lg font-bold ' +
          (good ? 'text-ok' : warn ? 'text-warn' : 'text-ink')
        }
      >
        {value}
      </div>
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
