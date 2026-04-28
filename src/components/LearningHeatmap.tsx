/**
 * LearningHeatmap：GitHub 风格的学习打卡热力图。
 *
 * - 最近 26 周（约半年）的每日活动
 * - 颜色深浅 = 当日有效学习时长
 * - hover 提示具体日期 + 时长 + AC/错题数
 *
 * 完全自绘 SVG，不依赖第三方库；动画用 CSS。
 */
import { useMemo } from 'react';
import type { Session } from '../core/types';

interface Props {
  sessions: Session[];
  weeks?: number; // 默认 26 周（半年）
  className?: string;
}

interface DayCell {
  date: string;       // YYYY-MM-DD（用户本地）
  effectiveMin: number;
  passCount: number;
  mistakeCount: number;
  total: number;      // session 数量（用于 hover）
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad(n: number) { return n < 10 ? '0' + n : '' + n; }
function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 把 minutes 映射到 0–4 等级 */
function levelOf(min: number): 0 | 1 | 2 | 3 | 4 {
  if (min <= 0) return 0;
  if (min < 15) return 1;
  if (min < 45) return 2;
  if (min < 90) return 3;
  return 4;
}

// 用 CSS 变量跟随主题：level 0 = 略深背景，level 1-4 = accent 渐变
// rgb(var(--c-...)) 在 SVG attribute 里需要完整 rgb() 包裹
const LEVEL_COLOR = [
  'rgb(var(--c-bg-elev2) / 0.6)',
  'rgb(var(--c-accent) / 0.25)',
  'rgb(var(--c-accent) / 0.5)',
  'rgb(var(--c-accent) / 0.75)',
  'rgb(var(--c-accent))',
];
const STROKE_OK = 'rgb(var(--c-ok) / 0.7)';
const STROKE_NORMAL = 'rgb(var(--c-line) / 0.5)';
const TEXT_MUTE = 'rgb(var(--c-ink-mute))';

export function LearningHeatmap({ sessions, weeks = 26, className }: Props) {
  const grid = useMemo(() => {
    // 按日期 key 累积
    const map = new Map<string, DayCell>();
    for (const s of sessions) {
      if (!s.startedAt) continue;
      const d = new Date(s.startedAt);
      const k = ymd(d);
      const cell = map.get(k) ?? {
        date: k, effectiveMin: 0, passCount: 0, mistakeCount: 0, total: 0,
      };
      cell.effectiveMin += Math.round((s.effectiveMs ?? 0) / 60000);
      if (s.outcome === 'pass') cell.passCount++;
      if (s.outcome === 'mistake') cell.mistakeCount++;
      cell.total++;
      map.set(k, cell);
    }

    // 起点：今天往前推 weeks*7-1 天，并对齐到周一
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const totalDays = weeks * 7;
    const start = new Date(today.getTime() - (totalDays - 1) * MS_PER_DAY);
    // 让网格从周一开始（getDay 0=Sun）：把 start 往前对齐
    const dow = (start.getDay() + 6) % 7; // 周一=0
    start.setTime(start.getTime() - dow * MS_PER_DAY);

    // 生成 weeks 列 × 7 行
    const cols: DayCell[][] = [];
    let cur = start.getTime();
    while (cur <= today.getTime()) {
      const week: DayCell[] = [];
      for (let r = 0; r < 7; r++) {
        const d = new Date(cur);
        const k = ymd(d);
        const fromMap = map.get(k);
        week.push(
          fromMap ?? {
            date: k, effectiveMin: 0, passCount: 0, mistakeCount: 0, total: 0,
          },
        );
        cur += MS_PER_DAY;
      }
      cols.push(week);
    }
    return cols;
  }, [sessions, weeks]);

  // 月份标签（在每列上方，仅当跨月时显示）
  const monthLabels = useMemo(() => {
    const labels: { col: number; label: string }[] = [];
    let lastMonth = -1;
    grid.forEach((week, i) => {
      const firstDay = week[0];
      const m = Number(firstDay.date.split('-')[1]);
      if (m !== lastMonth) {
        labels.push({ col: i, label: `${m}月` });
        lastMonth = m;
      }
    });
    return labels;
  }, [grid]);

  // 总计
  const total = useMemo(() => {
    let mins = 0, ac = 0, mis = 0, days = 0;
    for (const week of grid) for (const d of week) {
      if (d.effectiveMin > 0) days++;
      mins += d.effectiveMin; ac += d.passCount; mis += d.mistakeCount;
    }
    return { mins, ac, mis, days };
  }, [grid]);

  const cellSize = 11;
  const gap = 2;
  const labelW = 18;
  const monthH = 14;
  const w = grid.length * (cellSize + gap) + labelW;
  const h = 7 * (cellSize + gap) + monthH;

  return (
    <div className={'glass-card p-3 ' + (className ?? '')}>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <div className="text-xs font-semibold text-ink">学习日历</div>
        <div className="text-[10px] text-ink-mute flex items-center gap-2">
          <span>近 {weeks} 周</span>
          <span className="text-ink-dim">·</span>
          <span>打卡 <span className="text-ok font-semibold">{total.days}</span> 天</span>
          <span className="text-ink-dim">·</span>
          <span>AC <span className="text-ok font-semibold">{total.ac}</span></span>
          <span className="text-ink-dim">·</span>
          <span>错题 <span className="text-warn font-semibold">{total.mis}</span></span>
          <span className="text-ink-dim">·</span>
          <span>{Math.round(total.mins / 60)}h {total.mins % 60}m</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg width={w} height={h} className="block">
          {/* 月份标签 */}
          {monthLabels.map((m) => (
            <text
              key={m.col + '_' + m.label}
              x={labelW + m.col * (cellSize + gap)}
              y={10}
              fontSize="9"
              fill={TEXT_MUTE}
            >
              {m.label}
            </text>
          ))}
          {/* 周几标签（Mon Wed Fri） */}
          {[1, 3, 5].map((r) => (
            <text
              key={'wd' + r}
              x={0}
              y={monthH + r * (cellSize + gap) + cellSize - 1}
              fontSize="9"
              fill={TEXT_MUTE}
            >
              {['Mon', 'Wed', 'Fri'][[1, 3, 5].indexOf(r)]}
            </text>
          ))}
          {/* 格子 */}
          {grid.map((week, ci) =>
            week.map((d, ri) => {
              const lv = levelOf(d.effectiveMin);
              const ok = d.passCount > 0;
              const stroke = ok ? STROKE_OK : STROKE_NORMAL;
              return (
                <rect
                  key={d.date}
                  x={labelW + ci * (cellSize + gap)}
                  y={monthH + ri * (cellSize + gap)}
                  width={cellSize}
                  height={cellSize}
                  rx={2}
                  ry={2}
                  fill={LEVEL_COLOR[lv]}
                  stroke={stroke}
                  strokeWidth={ok ? 1 : 0.5}
                  style={{ transition: 'fill 0.2s' }}
                >
                  <title>
                    {d.date}
                    {d.effectiveMin > 0 ? ` · ${d.effectiveMin} 分钟` : ' · 未学习'}
                    {d.passCount > 0 ? ` · AC ×${d.passCount}` : ''}
                    {d.mistakeCount > 0 ? ` · 错题 ×${d.mistakeCount}` : ''}
                  </title>
                </rect>
              );
            }),
          )}
        </svg>
      </div>
      {/* 图例 */}
      <div className="flex items-center gap-1.5 mt-2 text-[10px] text-ink-mute">
        <span>少</span>
        {LEVEL_COLOR.map((c, i) => (
          <span
            key={i}
            className="inline-block rounded-sm"
            style={{
              width: 11,
              height: 11,
              background: c,
              border: '1px solid rgb(var(--c-line) / 0.5)',
            }}
          />
        ))}
        <span>多</span>
        <span className="ml-3 inline-flex items-center gap-1">
          <span
            className="inline-block rounded-sm"
            style={{ width: 9, height: 9, border: `1px solid ${STROKE_OK}` }}
          />
          有 AC
        </span>
      </div>
    </div>
  );
}
