import { useState } from 'react';
import { type Habit } from '@/engine/habits';
import { computeXp } from '@/engine/xp';
import { useGameStore } from '@/store/useGameStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

/** Quantity-habit completion: enter how much was done, see the XP preview. */
export function CompleteHabitDialog({
  habit,
  viewDate,
  onClose,
}: {
  habit: Habit;
  viewDate?: string;
  onClose: () => void;
}) {
  const completeHabit = useGameStore((s) => s.completeHabit);
  const [actual, setActual] = useState(String(habit.target ?? 0));

  const amount = Math.max(0, Number(actual) || 0);
  const xp = computeXp({
    difficulty: habit.difficulty,
    type: 'quantity',
    actual: amount,
    target: habit.target,
    uncapped: habit.uncapped,
  });

  return (
    <Modal title={habit.name} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          Goal: {habit.target} {habit.unit ?? ''}. How much did you complete?
        </p>
        <input
          autoFocus
          type="number"
          min={0}
          className="w-full rounded-md border border-ink-light/40 bg-parchment-100 px-3 py-2 text-sm text-ink focus:border-gold-deep focus:outline-none"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
        />
        <div className="rounded-md border border-gold-deep/40 bg-parchment-300/60 px-3 py-2 text-sm text-ink">
          Reward: <span className="font-display font-semibold text-ember">{xp} XP</span>
          {habit.target ? <span className="text-ink-light"> ({Math.round((amount / habit.target) * 100)}%)</span> : null}
        </div>
        <Button
          onClick={() => {
            completeHabit(habit.id, amount, viewDate);
            onClose();
          }}
          className="w-full py-2.5"
        >
          Log Completion
        </Button>
      </div>
    </Modal>
  );
}
