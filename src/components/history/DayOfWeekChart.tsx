// Completion rate by day of week — 7 bars, Sun..Sat.
import { useGameStore } from '@/store/useGameStore';
import { selectDayOfWeek } from '@/store/selectors';
import { Panel } from '@/components/ui/Panel';
import { cn } from '@/lib/cn';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DayOfWeekChart() {
  const breakdown = useGameStore(selectDayOfWeek);

  const maxPct = Math.max(
    1,
    ...breakdown.map((b) => (b.scheduled > 0 ? Math.round((b.completed / b.scheduled) * 100) : 0)),
  );

  const hasAny = breakdown.some((b) => b.scheduled > 0);

  return (
    <Panel tone="parchment" className="p-4">
      <p className="mb-3 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Completion rate by day of week (12 weeks)
      </p>
      {!hasAny ? (
        <p className="text-center text-xs text-ink-muted italic">No scheduled habit data yet.</p>
      ) : (
        <div className="flex h-20 items-end gap-1 border-b border-l border-ink-light/30 pl-1">
          {breakdown.map((b) => {
            const pct = b.scheduled > 0 ? Math.round((b.completed / b.scheduled) * 100) : 0;
            const barH = maxPct > 0 ? Math.max(pct > 0 ? 4 : 0, (pct / maxPct) * 100) : 0;
            const isWeekend = b.weekday === 0 || b.weekday === 6;
            return (
              <div
                key={b.weekday}
                className="flex flex-1 flex-col items-center gap-0.5"
                title={`${DAY_LABELS[b.weekday]}: ${pct}% (${b.completed}/${b.scheduled})`}
              >
                <div
                  className={cn(
                    'w-full rounded-t-sm',
                    isWeekend
                      ? 'bg-gradient-to-t from-ember/60 to-ember-bright/80'
                      : 'bg-gradient-to-t from-gold-deep to-gold-bright',
                  )}
                  style={{ height: `${barH}%` }}
                />
                <span className="text-[9px] text-ink-light">{DAY_LABELS[b.weekday].slice(0, 2)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
