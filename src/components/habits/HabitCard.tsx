import { useState } from 'react';
import { AlertTriangle, BarChart3, Check, Flame, MoreVertical, Pause, Pencil, Play, Archive, Trash2, CalendarClock, Undo2, Star } from 'lucide-react';
import { getStat } from '@/engine/stats';
import { type Habit, isCompletedOn, effectiveStatus, weekCompletions, currentStreak } from '@/engine/habits';
import { habitHealth, type HabitWarning, type HabitActionCode } from '@/engine/habitHealth';
import { toISODate, parseISODate, addDays } from '@/engine/date';
import { useGameStore } from '@/store/useGameStore';
import { statCrest } from '@/lib/sprites';
import { Sprite } from '@/components/ui/Sprite';
import { cn } from '@/lib/cn';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { CompleteHabitDialog } from './CompleteHabitDialog';
import { DatePicker } from './DatePicker';
import { HabitForm } from './HabitForm';
import { SuspendDialog } from './SuspendDialog';
import { DeleteHabitDialog } from './DeleteHabitDialog';

const FREQ_LABEL: Record<Habit['frequency'], string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  custom: 'Custom days',
  times_per_week: 'Weekly',
  as_needed: 'As needed',
};

export function HabitCard({
  habit,
  viewDate = toISODate(),
  onViewHistory,
}: {
  habit: Habit;
  viewDate?: string;
  /** Called when the user picks "View History" from the kebab. */
  onViewHistory?: (habitId: string) => void;
}) {
  const completeHabit = useGameStore((s) => s.completeHabit);
  const uncompleteHabit = useGameStore((s) => s.uncompleteHabit);
  const retireHabit = useGameStore((s) => s.retireHabit);
  const reactivateHabit = useGameStore((s) => s.reactivateHabit);
  const setHabitFocus = useGameStore((s) => s.setHabitFocus);
  const [dialog, setDialog] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  // Escape hatch: "Log older entry…" opens a full-range DatePicker for genuine backdated corrections.
  const [logOlderOpen, setLogOlderOpen] = useState(false);
  const [olderDate, setOlderDate] = useState<string | null>(null);

  const done = isCompletedOn(habit, viewDate);
  const warnings = habitHealth(habit, viewDate);
  const suspended = effectiveStatus(habit, viewDate) === 'suspended';
  const retired = habit.status === 'retired';
  const stat = getStat(habit.stat);
  const liveStreak = currentStreak(habit, viewDate);
  const week =
    habit.frequency === 'times_per_week'
      ? { done: weekCompletions(habit, viewDate), target: habit.timesPerWeek ?? 1 }
      : null;

  function onSeal() {
    if (suspended || retired) return;
    if (done) {
      uncompleteHabit(habit.id, viewDate);
      return;
    }
    if (habit.type === 'quantity') {
      setDialog(true);
    } else {
      // completeHabit itself pushes the reward-receipt toast (actual XP · gold · energy),
      // so binary and quantity paths report identically — no separate toast here.
      completeHabit(habit.id, undefined, viewDate);
    }
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
        {/* Wax-seal completion button (toggles completion on/off) */}
        <button
          onClick={onSeal}
          disabled={suspended || retired}
          className={cn(
            'group flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition',
            done
              ? 'border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep text-wood-900 shadow-gold-sm enabled:hover:from-gold'
              : 'border-ink-light/50 enabled:hover:border-gold-deep enabled:hover:bg-gold/10 disabled:opacity-50',
          )}
          aria-label={done ? 'Mark incomplete' : 'Complete habit'}
        >
          {done && <Check className="h-5 w-5 group-enabled:group-hover:hidden" />}
          {done && <Undo2 className="hidden h-4 w-4 group-enabled:group-hover:block" />}
        </button>

        <Sprite
          spriteKey={`stat:${habit.stat}`}
          look={statCrest(habit.stat)}
          size="sm"
          label={stat.name}
          className={cn(done && 'opacity-60')}
        />

        <div className="min-w-0 flex-1">
          <div className={cn('flex items-center gap-1.5 truncate font-medium text-ink', done && 'text-ink-muted line-through')}>
            {habit.focus && (
              <Star className="h-3 w-3 shrink-0 fill-gold-bright text-gold-bright" aria-label="Focus habit" />
            )}
            <span className="truncate">{habit.name}</span>
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
            {!week && liveStreak > 0 && (
              <span className="flex items-center gap-0.5 font-semibold text-ember">
                <Flame className="h-3 w-3" />
                {liveStreak}
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

        {/* Health-insight badge — amber triangle when the engine detects a pattern worth noting */}
        {warnings.length > 0 && (
          <button
            onClick={() => setWarningOpen(true)}
            className="shrink-0 text-amber-500 hover:text-amber-600 transition-colors"
            aria-label={`${warnings.length} habit insight${warnings.length > 1 ? 's' : ''}`}
          >
            <AlertTriangle className="h-4 w-4" />
          </button>
        )}

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
                <MenuItem icon={Pencil} label="Edit…" onClick={() => { setEditOpen(true); setMenuOpen(false); }} />
                {onViewHistory && (
                  <MenuItem icon={BarChart3} label="View History" onClick={() => { onViewHistory(habit.id); setMenuOpen(false); }} />
                )}
                {!retired && !suspended && (
                  <MenuItem
                    icon={Star}
                    label={habit.focus ? 'Remove focus' : 'Mark as focus'}
                    onClick={() => { setHabitFocus(habit.id, !habit.focus); setMenuOpen(false); }}
                  />
                )}
                {done && (
                  <MenuItem icon={Undo2} label="Mark incomplete" onClick={() => { uncompleteHabit(habit.id, viewDate); setMenuOpen(false); }} />
                )}
                {!retired && (
                  <MenuItem icon={CalendarClock} label="Log older entry…" onClick={() => { setLogOlderOpen(true); setMenuOpen(false); }} />
                )}
                {suspended || retired ? (
                  <MenuItem icon={Play} label="Reactivate" onClick={() => { reactivateHabit(habit.id); setMenuOpen(false); }} />
                ) : (
                  <MenuItem icon={Pause} label="Suspend…" onClick={() => { setSuspendOpen(true); setMenuOpen(false); }} />
                )}
                {!retired && (
                  <MenuItem icon={Archive} label="Retire" onClick={() => { retireHabit(habit.id); setMenuOpen(false); }} />
                )}
                <MenuItem icon={Trash2} label="Delete" danger onClick={() => { setDeleteOpen(true); setMenuOpen(false); }} />
              </div>
            </>
          )}
        </div>
      </div>

      {dialog && <CompleteHabitDialog habit={habit} viewDate={viewDate} onClose={() => setDialog(false)} />}
      {editOpen && <HabitForm habit={habit} onClose={() => setEditOpen(false)} />}
      {warningOpen && (
        <HabitInsightsModal
          warnings={warnings}
          onClose={() => setWarningOpen(false)}
          onEdit={() => { setWarningOpen(false); setEditOpen(true); }}
          onSuspend={() => { setWarningOpen(false); setSuspendOpen(true); }}
          onRetire={() => { setWarningOpen(false); retireHabit(habit.id); }}
          onFocus={() => { setWarningOpen(false); setHabitFocus(habit.id, true); }}
        />
      )}
      {suspendOpen && <SuspendDialog habitId={habit.id} onClose={() => setSuspendOpen(false)} />}
      {deleteOpen && <DeleteHabitDialog habit={habit} onClose={() => setDeleteOpen(false)} />}
      {logOlderOpen && (
        <LogOlderEntryModal
          habit={habit}
          onClose={() => setLogOlderOpen(false)}
          onCommit={(date) => {
            setLogOlderOpen(false);
            if (habit.type === 'binary') {
              completeHabit(habit.id, undefined, date);
            } else {
              setOlderDate(date);
            }
          }}
        />
      )}
      {olderDate && (
        <CompleteHabitDialog habit={habit} viewDate={olderDate} onClose={() => setOlderDate(null)} />
      )}
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

// ---------------------------------------------------------------------------
// Habit insights modal — lists warnings from habitHealth() with suggested fix actions
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<HabitActionCode, string> = {
  lower_target: 'Lower target',
  change_frequency: 'Change frequency',
  change_difficulty: 'Change difficulty',
  edit: 'Edit habit',
  suspend: 'Suspend',
  retire: 'Retire',
  mark_focus: 'Mark as focus',
};

function HabitInsightsModal({
  warnings,
  onClose,
  onEdit,
  onSuspend,
  onRetire,
  onFocus,
}: {
  warnings: HabitWarning[];
  onClose: () => void;
  onEdit: () => void;
  onSuspend: () => void;
  onRetire: () => void;
  onFocus: () => void;
}) {
  function handleAction(code: HabitActionCode) {
    if (code === 'lower_target' || code === 'change_frequency' || code === 'change_difficulty' || code === 'edit') {
      onEdit();
    } else if (code === 'suspend') {
      onSuspend();
    } else if (code === 'retire') {
      onRetire();
    } else if (code === 'mark_focus') {
      onFocus();
    }
  }

  return (
    <Modal title="Habit Insights" onClose={onClose}>
      <div className="space-y-4">
        {warnings.map((w, i) => (
          <div key={i} className="space-y-2">
            <p className="text-sm text-ink leading-snug">{w.message}</p>
            <div className="flex flex-wrap gap-2">
              {w.suggestedActions.map((code) => (
                <Button
                  key={code}
                  variant="secondary"
                  onClick={() => handleAction(code)}
                  className="px-2.5 py-1 text-xs"
                >
                  {ACTION_LABELS[code]}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Escape hatch for logging habit completions older than the 7-day DatePicker window.
 * Shows a full-history calendar with an integrity warning — the extra friction is intentional.
 */
function LogOlderEntryModal({
  habit,
  onClose,
  onCommit,
}: {
  habit: Habit;
  onClose: () => void;
  onCommit: (date: string) => void;
}) {
  const today = toISODate();
  // Default to yesterday — one day before the normal window floor is a typical "forgot to log" case.
  const [pickedDate, setPickedDate] = useState(addDays(today, -1));

  return (
    <Modal title="Log older entry" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Logging older entries can inflate streaks and challenge progress — use only to correct genuine misses.</span>
        </div>
        <DatePicker
          value={pickedDate}
          onChange={setPickedDate}
          minISO={habit.createdISO}
          maxISO={today}
          hasActivity={(iso) => habit.log[iso] !== undefined}
        />
        <Button
          onClick={() => onCommit(pickedDate)}
          className="w-full py-2"
        >
          Log {parseISODate(pickedDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </Button>
      </div>
    </Modal>
  );
}
