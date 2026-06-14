import { useState } from 'react';
import { LineChart } from 'lucide-react';
import { type Habit, effectiveStatus } from '@/engine/habits';
import { habitStats } from '@/engine/tracking';
import { getStat } from '@/engine/stats';
import { toISODate } from '@/engine/date';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Heatmap } from './Heatmap';
import { HabitChart } from './HabitChart';

const FREQ_LABEL: Record<Habit['frequency'], string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  custom: 'Custom days',
  times_per_week: 'X / week',
  as_needed: 'As needed',
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-gold-deep/20 bg-parchment-100/60 px-2 py-1.5 text-center">
      <div className="font-display text-base font-bold text-ink">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</div>
    </div>
  );
}

export function HabitHistoryCard({ habit }: { habit: Habit }) {
  const [showGraph, setShowGraph] = useState(false);
  const today = toISODate();
  const stat = getStat(habit.stat);
  const stats = habitStats(habit, today);
  const status = effectiveStatus(habit, today);

  return (
    <Panel tone="parchment" className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-base font-bold text-ink">{habit.name}</div>
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <span className="font-semibold" style={{ color: stat.color }}>{stat.name}</span>
            <span className="text-ink-light">·</span>
            <span>{FREQ_LABEL[habit.frequency]}</span>
          </div>
        </div>
        {status !== 'active' && (
          <span className="shrink-0 rounded-full border border-ink-light/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
            {status}
          </span>
        )}
      </div>

      <Heatmap habit={habit} />

      <div className="grid grid-cols-4 gap-2">
        <Stat label="Days" value={stats.totalDays} />
        <Stat label="Best streak" value={stats.longestStreak} />
        <Stat label="Success" value={stats.successPct === null ? '—' : `${stats.successPct}%`} />
        <Stat label="Points" value={stats.totalPoints} />
      </div>

      {habit.type === 'quantity' && (
        <>
          <Button variant="secondary" onClick={() => setShowGraph((g) => !g)} className="flex w-full items-center justify-center gap-1.5 py-1.5 text-xs">
            <LineChart className="h-4 w-4" /> {showGraph ? 'Hide graph' : 'Show graph'}
          </Button>
          {showGraph && <HabitChart habit={habit} />}
        </>
      )}
    </Panel>
  );
}
