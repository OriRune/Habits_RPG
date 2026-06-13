import { useState } from 'react';
import { Check, Flame, Trash2 } from 'lucide-react';
import { getStat } from '@/engine/stats';
import { type Habit } from '@/engine/habits';
import { useGameStore } from '@/store/useGameStore';
import { isHabitDoneToday } from '@/store/selectors';
import { cn } from '@/lib/cn';
import { CompleteHabitDialog } from './CompleteHabitDialog';

export function HabitCard({ habit }: { habit: Habit }) {
  const completeHabit = useGameStore((s) => s.completeHabit);
  const removeHabit = useGameStore((s) => s.removeHabit);
  const [dialog, setDialog] = useState(false);
  const done = isHabitDoneToday(habit);
  const stat = getStat(habit.stat);

  function onComplete() {
    if (done) return;
    if (habit.type === 'quantity') setDialog(true);
    else completeHabit(habit.id);
  }

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors',
          done
            ? 'border-gold-deep/40 bg-parchment-400/40'
            : 'border-ink-light/30 bg-parchment-100/70 hover:border-gold-deep/60',
        )}
      >
        {/* Wax-seal completion button */}
        <button
          onClick={onComplete}
          disabled={done}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition',
            done
              ? 'border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep text-wood-900 shadow-gold-sm'
              : 'border-ink-light/50 hover:border-gold-deep hover:bg-gold/10',
          )}
          aria-label={done ? 'Completed' : 'Complete habit'}
        >
          {done && <Check className="h-5 w-5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className={cn('truncate font-medium text-ink', done && 'text-ink-muted line-through')}>
            {habit.name}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
            <span className="font-semibold" style={{ color: stat.color }}>
              {stat.name}
            </span>
            <span className="text-ink-light">·</span>
            <span className="capitalize">{habit.difficulty}</span>
            {habit.type === 'quantity' && (
              <>
                <span className="text-ink-light">·</span>
                <span>
                  {habit.target} {habit.unit ?? ''}
                </span>
              </>
            )}
            {habit.streak > 0 && (
              <span className="flex items-center gap-0.5 font-semibold text-ember">
                <Flame className="h-3 w-3" />
                {habit.streak}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => removeHabit(habit.id)}
          className="shrink-0 text-ink-light/60 hover:text-ember"
          aria-label="Delete habit"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {dialog && <CompleteHabitDialog habit={habit} onClose={() => setDialog(false)} />}
    </>
  );
}
