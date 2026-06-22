// Recovery modal — helps users restart after a rough patch.
// Shows the keep/suspend flow: pick 1–3 habits to keep as focus, suspend the rest.
import { useState } from 'react';
import { Heart, Star } from 'lucide-react';
import { type Habit } from '@/engine/habits';
import { useGameStore } from '@/store/useGameStore';
import { addDays, startOfWeek, toISODate } from '@/engine/date';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { getStat } from '@/engine/stats';
import { cn } from '@/lib/cn';

interface RecoveryModalProps {
  habits: Habit[];
  onClose: () => void;
  /** Called (before onClose) when the user confirms the flow — used to clear the banner. */
  onConfirm?: () => void;
}

const MAX_KEEP = 3;

export function RecoveryModal({ habits, onClose, onConfirm }: RecoveryModalProps) {
  const setHabitFocus = useGameStore((s) => s.setHabitFocus);
  const batchSuspendHabits = useGameStore((s) => s.batchSuspendHabits);

  // Only show active, loggable habits to keep
  const activeHabits = habits.filter((h) => h.status === 'active');
  const [keepIds, setKeepIds] = useState<Set<string>>(
    () => new Set(activeHabits.filter((h) => h.focus).map((h) => h.id).slice(0, MAX_KEEP)),
  );

  function toggleKeep(id: string) {
    setKeepIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_KEEP) {
        next.add(id);
      }
      return next;
    });
  }

  function handleConfirm() {
    const today = toISODate();
    // Next Sunday (start of next week)
    const nextWeek = addDays(startOfWeek(today), 7);

    // Mark kept habits as focus
    for (const h of activeHabits) {
      setHabitFocus(h.id, keepIds.has(h.id));
    }
    // Suspend the rest until next week
    batchSuspendHabits(keepIds, nextWeek);
    onConfirm?.();
    onClose();
  }

  return (
    <Modal title="Return to Training" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-gold-deep/30 bg-wood-800/30 px-3 py-2.5 text-sm text-ink-muted">
          <Heart className="mt-0.5 h-4 w-4 shrink-0 text-ember-bright" />
          <p>
            Rough patches happen to every hero. Let's simplify this week — pick{' '}
            <span className="font-semibold text-ink">1–{MAX_KEEP} habits</span> to keep active.
            The rest will take a break until next week.
          </p>
        </div>

        <div>
          <p className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Choose habits to keep ({keepIds.size}/{MAX_KEEP})
          </p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {activeHabits.length === 0 && (
              <p className="text-sm text-ink-muted italic">No active habits to choose from.</p>
            )}
            {activeHabits.map((h) => {
              const selected = keepIds.has(h.id);
              const stat = getStat(h.stat);
              const atCap = keepIds.size >= MAX_KEEP && !selected;
              return (
                <button
                  key={h.id}
                  onClick={() => toggleKeep(h.id)}
                  disabled={atCap}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    selected
                      ? 'border-gold-deep bg-gold/15 text-ink'
                      : atCap
                        ? 'border-ink-light/20 text-ink-light opacity-50 cursor-not-allowed'
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
                  <span className="shrink-0 text-[10px] font-semibold" style={{ color: stat.color }}>
                    {stat.short}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {keepIds.size > 0 && activeHabits.length - keepIds.size > 0 && (
          <p className="text-xs text-ink-muted">
            {activeHabits.length - keepIds.size} habit{activeHabits.length - keepIds.size !== 1 ? 's' : ''} will be suspended until next week.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} className="flex-1 py-2">
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={keepIds.size === 0 && activeHabits.length > 0}
            className="flex-1 py-2"
          >
            {keepIds.size === 0 ? 'Take a break' : `Keep ${keepIds.size} habit${keepIds.size !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
