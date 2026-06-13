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
          'flex items-center gap-3 rounded-xl border p-3 transition-colors',
          done ? 'border-emerald-700/50 bg-emerald-900/10' : 'border-gray-800 bg-[#11151f]',
        )}
      >
        <button
          onClick={onComplete}
          disabled={done}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition',
            done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-600 hover:border-indigo-400',
          )}
          aria-label={done ? 'Completed' : 'Complete habit'}
        >
          {done && <Check className="h-5 w-5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className={cn('truncate text-sm font-medium', done && 'text-gray-400 line-through')}>{habit.name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
            <span style={{ color: stat.color }}>{stat.name}</span>
            <span>·</span>
            <span className="capitalize">{habit.difficulty}</span>
            {habit.type === 'quantity' && (
              <>
                <span>·</span>
                <span>
                  {habit.target} {habit.unit ?? ''}
                </span>
              </>
            )}
            {habit.streak > 0 && (
              <span className="flex items-center gap-0.5 text-amber-400">
                <Flame className="h-3 w-3" />
                {habit.streak}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => removeHabit(habit.id)}
          className="shrink-0 text-gray-600 hover:text-red-400"
          aria-label="Delete habit"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {dialog && <CompleteHabitDialog habit={habit} onClose={() => setDialog(false)} />}
    </>
  );
}
