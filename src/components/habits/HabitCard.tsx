import { useState } from 'react';
import { Check, Flame, MoreVertical, Pause, Play, Archive, Trash2, CalendarClock } from 'lucide-react';
import { getStat } from '@/engine/stats';
import { type Habit } from '@/engine/habits';
import { useGameStore } from '@/store/useGameStore';
import { isHabitDoneToday, isHabitSuspended, selectWeekProgress } from '@/store/selectors';
import { cn } from '@/lib/cn';
import { CompleteHabitDialog } from './CompleteHabitDialog';
import { SuspendDialog } from './SuspendDialog';

const FREQ_LABEL: Record<Habit['frequency'], string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  custom: 'Custom days',
  times_per_week: 'Weekly',
  as_needed: 'As needed',
};

export function HabitCard({ habit }: { habit: Habit }) {
  const completeHabit = useGameStore((s) => s.completeHabit);
  const removeHabit = useGameStore((s) => s.removeHabit);
  const retireHabit = useGameStore((s) => s.retireHabit);
  const reactivateHabit = useGameStore((s) => s.reactivateHabit);
  const [dialog, setDialog] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const done = isHabitDoneToday(habit);
  const suspended = isHabitSuspended(habit);
  const retired = habit.status === 'retired';
  const stat = getStat(habit.stat);
  const week = selectWeekProgress(habit);

  function onComplete() {
    if (done || suspended || retired) return;
    if (habit.type === 'quantity') setDialog(true);
    else completeHabit(habit.id);
  }

  return (
    <>
      <div
        className={cn(
          'relative flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors',
          suspended
            ? 'border-ink-light/30 bg-parchment-300/40 opacity-70'
            : done
              ? 'border-gold-deep/40 bg-parchment-400/40'
              : 'border-ink-light/30 bg-parchment-100/70 hover:border-gold-deep/60',
        )}
      >
        {/* Wax-seal completion button */}
        <button
          onClick={onComplete}
          disabled={done || suspended || retired}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition',
            done
              ? 'border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep text-wood-900 shadow-gold-sm'
              : 'border-ink-light/50 enabled:hover:border-gold-deep enabled:hover:bg-gold/10 disabled:opacity-50',
          )}
          aria-label={done ? 'Completed' : 'Complete habit'}
        >
          {done && <Check className="h-5 w-5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className={cn('truncate font-medium text-ink', done && 'text-ink-muted line-through')}>
            {habit.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
            <span className="font-semibold" style={{ color: stat.color }}>
              {stat.name}
            </span>
            <span className="text-ink-light">·</span>
            <span>{FREQ_LABEL[habit.frequency]}</span>
            {habit.type === 'quantity' && (
              <>
                <span className="text-ink-light">·</span>
                <span>
                  {habit.target} {habit.unit ?? ''}
                  {habit.uncapped ? '+' : ''}
                </span>
              </>
            )}
            {week && (
              <span className="font-semibold text-ink">
                {week.done}/{week.target} this week
              </span>
            )}
            {!week && habit.streak > 0 && (
              <span className="flex items-center gap-0.5 font-semibold text-ember">
                <Flame className="h-3 w-3" />
                {habit.streak}
              </span>
            )}
            {suspended && (
              <span className="flex items-center gap-0.5 font-semibold text-stat-AG">
                <CalendarClock className="h-3 w-3" />
                resumes {habit.suspendUntilISO}
              </span>
            )}
          </div>
        </div>

        {/* Kebab menu */}
        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="text-ink-light/60 hover:text-ink"
            aria-label="Habit options"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-6 z-20 w-40 overflow-hidden rounded-md border border-gold-deep/40 bg-parchment-100 shadow-gold-sm">
                {suspended || retired ? (
                  <MenuItem icon={Play} label="Reactivate" onClick={() => { reactivateHabit(habit.id); setMenuOpen(false); }} />
                ) : (
                  <MenuItem icon={Pause} label="Suspend…" onClick={() => { setSuspendOpen(true); setMenuOpen(false); }} />
                )}
                {!retired && (
                  <MenuItem icon={Archive} label="Retire" onClick={() => { retireHabit(habit.id); setMenuOpen(false); }} />
                )}
                <MenuItem icon={Trash2} label="Delete" danger onClick={() => { removeHabit(habit.id); setMenuOpen(false); }} />
              </div>
            </>
          )}
        </div>
      </div>

      {dialog && <CompleteHabitDialog habit={habit} onClose={() => setDialog(false)} />}
      {suspendOpen && <SuspendDialog habitId={habit.id} onClose={() => setSuspendOpen(false)} />}
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Pause;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gold/10',
        danger ? 'text-ember' : 'text-ink',
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
