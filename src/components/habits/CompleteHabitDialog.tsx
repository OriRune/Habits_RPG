import { useState } from 'react';
import { type Habit } from '@/engine/habits';
import { computeXp } from '@/engine/xp';
import { useGameStore } from '@/store/useGameStore';
import { Modal } from '@/components/ui/Modal';

/** Quantity-habit completion: enter how much was done, see the XP preview. */
export function CompleteHabitDialog({ habit, onClose }: { habit: Habit; onClose: () => void }) {
  const completeHabit = useGameStore((s) => s.completeHabit);
  const [actual, setActual] = useState(String(habit.target ?? 0));

  const amount = Math.max(0, Number(actual) || 0);
  const xp = computeXp({ difficulty: habit.difficulty, type: 'quantity', actual: amount, target: habit.target });

  return (
    <Modal title={habit.name} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-400">
          Goal: {habit.target} {habit.unit ?? ''}. How much did you complete?
        </p>
        <input
          autoFocus
          type="number"
          min={0}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
        />
        <div className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-300">
          Reward: <span className="font-semibold text-indigo-300">{xp} XP</span>
          {habit.target ? <span className="text-gray-500"> ({Math.round((amount / habit.target) * 100)}%)</span> : null}
        </div>
        <button
          onClick={() => {
            completeHabit(habit.id, amount);
            onClose();
          }}
          className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold hover:bg-indigo-500"
        >
          Log Completion
        </button>
      </div>
    </Modal>
  );
}
