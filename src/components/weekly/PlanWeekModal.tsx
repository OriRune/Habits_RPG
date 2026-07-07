// "Plan Your Week" modal — pick 1–3 focus habits at the start of each week.
// Triggered automatically after the weekly report or manually from the dashboard.
import { CalendarDays, Star } from 'lucide-react';
import { type WeeklyReport, weeklyRotation } from '@/engine/weekly';
import { useGameStore } from '@/store/useGameStore';
import { getStat } from '@/engine/stats';
import { rankStats } from '@/engine/classes';
import { toISODate, weekKey } from '@/engine/date';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { MAX_FOCUS_HABITS } from '@/store/slices/habitsSlice';

interface PlanWeekModalProps {
  /** The just-closed weekly report, for showing a recap strip. Null when opened manually. */
  lastReport: WeeklyReport | null;
  onClose: () => void;
}

export function PlanWeekModal({ lastReport, onClose }: PlanWeekModalProps) {
  const allHabits = useGameStore((s) => s.habits);
  const setHabitFocus = useGameStore((s) => s.setHabitFocus);
  const character = useGameStore((s) => s.character);
  const challenges = useGameStore((s) => s.challenges);
  const startChallenge = useGameStore((s) => s.startChallenge);

  const activeHabits = allHabits.filter((h) => h.status === 'active');
  const focusCount = activeHabits.filter((h) => h.focus).length;

  // This week's challenge rotation, minus any already-active ones (mirrors ChallengesView).
  const classStat = character.classId ? rankStats(character.statXp)[0] : null;
  const rotation = weeklyRotation(weekKey(toISODate()), classStat);
  const activeIds = new Set(challenges.filter((c) => c.status === 'active').map((c) => c.def.id));
  const rotationAvail = rotation.filter((d) => !activeIds.has(d.id));

  return (
    <Modal title="Plan Your Week" onClose={onClose}>
      <div className="space-y-4">
        {/* Optional recap strip from the just-closed report */}
        {lastReport && lastReport.completions > 0 && (
          <div className="flex items-center gap-3 rounded-md border border-gold-deep/30 bg-wood-800/30 px-3 py-2.5 text-sm text-ink-muted">
            <CalendarDays className="h-4 w-4 shrink-0 text-gold-bright" />
            <span>
              Last week:{' '}
              <span className="font-semibold text-ink">{lastReport.completions}</span> completions
              {lastReport.topStat && (
                <>
                  {' · '}Top stat:{' '}
                  <span
                    className="font-semibold"
                    style={{ color: getStat(lastReport.topStat).color }}
                  >
                    {getStat(lastReport.topStat).name}
                  </span>
                </>
              )}
            </span>
          </div>
        )}

        {/* Guidance copy */}
        <div className="flex items-start gap-2 rounded-md border border-gold-deep/30 bg-wood-800/30 px-3 py-2.5 text-sm text-ink-muted">
          <Star className="mt-0.5 h-4 w-4 shrink-0 fill-gold-bright text-gold-bright" />
          <p>
            Choose up to{' '}
            <span className="font-semibold text-ink">{MAX_FOCUS_HABITS} focus habits</span> for the
            week. They'll appear at the top of your quest log and drive the recommended action.
          </p>
        </div>

        {/* Habit list */}
        <div>
          <p className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Focus habits ({focusCount}/{MAX_FOCUS_HABITS})
          </p>
          <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {activeHabits.length === 0 && (
              <p className="text-sm italic text-ink-muted">No active habits to choose from.</p>
            )}
            {activeHabits.map((h) => {
              const selected = h.focus ?? false;
              const stat = getStat(h.stat);
              const atCap = focusCount >= MAX_FOCUS_HABITS && !selected;
              return (
                <button
                  key={h.id}
                  onClick={() => setHabitFocus(h.id, !selected)}
                  disabled={atCap}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    selected
                      ? 'border-gold-deep bg-gold/15 text-ink'
                      : atCap
                        ? 'cursor-not-allowed border-ink-light/20 text-ink-light opacity-50'
                        : 'border-ink-light/30 text-ink hover:border-gold-deep/60',
                  )}
                >
                  <Star
                    className={cn(
                      'h-4 w-4 shrink-0',
                      selected ? 'fill-gold-bright text-gold-bright' : 'text-ink-light/40',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{h.name}</span>
                  <span
                    className="shrink-0 text-[10px] font-semibold"
                    style={{ color: stat.color }}
                  >
                    {stat.short}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* This week's challenge rotation — one-tap accept (HABIT-23). */}
        {rotationAvail.length > 0 && (
          <div>
            <p className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              This week's trials
            </p>
            <div className="space-y-1.5">
              {rotationAvail.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2.5 rounded-md border border-ink-light/30 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink">{d.name}</div>
                    <div className="truncate text-xs text-ink-muted">{d.description}</div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => startChallenge(d.id)}
                    className="shrink-0 px-3 py-1.5 text-xs"
                  >
                    Accept
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button onClick={onClose} className="w-full py-2">
          {focusCount > 0 ? `Focus on ${focusCount} habit${focusCount !== 1 ? 's' : ''} this week` : "I'll decide later"}
        </Button>
      </div>
    </Modal>
  );
}
