import { useState } from 'react';
import { type Habit } from '@/engine/habits';
import { type ChartRange, series, rangeStart } from '@/engine/tracking';
import { toISODate, startOfWeek } from '@/engine/date';
import { cn } from '@/lib/cn';

const RANGES: ChartRange[] = ['week', 'month', 'year'];

/** Aggregate daily series for display: daily bars for week/month, weekly sums for year. */
function bars(habit: Habit, range: ChartRange): { label: string; value: number }[] {
  const today = toISODate();
  const data = series(habit, rangeStart(today, range), today);
  if (range === 'year') {
    const weeks = new Map<string, number>();
    for (const d of data) {
      const wk = startOfWeek(d.date);
      weeks.set(wk, (weeks.get(wk) ?? 0) + d.amount);
    }
    return [...weeks.entries()].map(([wk, value]) => ({ label: wk.slice(5), value }));
  }
  return data.map((d) => ({ label: d.date.slice(8), value: d.amount }));
}

/** Custom (dependency-free) bar chart of a quantity habit's amounts over time. */
export function HabitChart({ habit }: { habit: Habit }) {
  const [range, setRange] = useState<ChartRange>('month');
  const data = bars(habit, range);
  const max = Math.max(1, ...data.map((d) => d.value));
  const unit = habit.unit ? ` ${habit.unit}` : '';

  return (
    <div className="rounded-md border border-gold-deep/30 bg-parchment-100/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-xs text-ink-muted">peak {max}{unit}</span>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] font-display capitalize',
                range === r ? 'bg-gold/20 text-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-28 items-end gap-px border-b border-l border-ink-light/30 pl-1">
        {data.map((d, i) => (
          <div
            key={i}
            title={`${d.label}: ${d.value}${unit}`}
            className="flex-1 rounded-t-sm bg-gradient-to-t from-gold-deep to-gold-bright"
            style={{ height: `${Math.max(d.value > 0 ? 4 : 0, (d.value / max) * 100)}%` }}
          />
        ))}
      </div>

      {data.every((d) => d.value === 0) && (
        <div className="pt-2 text-center text-[11px] text-ink-light">No data logged in this range yet.</div>
      )}
    </div>
  );
}
