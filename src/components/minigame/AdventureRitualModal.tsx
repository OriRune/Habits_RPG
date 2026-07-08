import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useGameStore } from '@/store/useGameStore';
import { toISODate } from '@/engine/date';
import { isCompletedOn } from '@/engine/habits';

interface Props {
  /** Energy cost for this minigame (e.g. 2 for Mine/Forest, 3 for Arena/Tactics/Dungeon, 1 for Trials). */
  energyCost: number;
  /** Called when the player confirms they want to enter. */
  onConfirm: () => void;
  /** Called when the player cancels / closes. */
  onCancel: () => void;
}

/**
 * Pre-entry ritual modal — shows today's habit completions that powered the energy
 * being spent, then asks for confirmation before entering the minigame.
 */
export function AdventureRitualModal({ energyCost, onConfirm, onCancel }: Props) {
  const habits = useGameStore((s) => s.habits);
  const energy = useGameStore((s) => s.character.energy);
  const unlimitedEnergy = useGameStore((s) => s.settings.unlimitedEnergy);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const [dontShow, setDontShow] = useState(false);

  const today = toISODate();
  const completedToday = habits.filter((h) => isCompletedOn(h, today));

  function handleConfirm() {
    if (dontShow) updateSettings({ showAdventureRitual: false });
    onConfirm();
  }

  // The dev unlimited-energy toggle bypasses the cost — mirror the slices' entry gates.
  const canEnter = unlimitedEnergy || energy >= energyCost;

  return (
    <Modal title="Before You Adventure" onClose={onCancel}>
      <p className="mb-3 text-sm text-ink-muted">
        Each habit you complete today grants +1 Energy. You've earned:
      </p>

      {completedToday.length === 0 ? (
        <p className="mb-3 text-sm text-ink-muted italic">
          No habits completed today yet — but you still have {energy} Energy saved up.
        </p>
      ) : (
        <ul className="mb-3 space-y-1">
          {completedToday.map((h) => (
            <li key={h.id} className="flex items-center gap-2 text-sm text-ink">
              <span className="text-amber-400">⚡</span>
              <span>{h.name}</span>
              <span className="ml-auto text-xs text-ink-muted">+1</span>
            </li>
          ))}
        </ul>
      )}

      {/* Dark inset rows — text must be on-wood (light), not ink (dark on dark). */}
      <div className="mb-4 flex items-center justify-between rounded bg-wood-900/60 px-3 py-2 text-sm">
        <span className="text-on-wood-hi">Energy available</span>
        <span className="font-bold text-amber-400">{unlimitedEnergy ? '∞' : energy}</span>
      </div>

      <div className="mb-5 flex items-center justify-between rounded bg-wood-900/60 px-3 py-2 text-sm">
        <span className="text-on-wood-hi">Cost to enter</span>
        <span className={`font-bold ${canEnter ? 'text-ember-bright' : 'text-red-400'}`}>
          -{energyCost}
        </span>
      </div>

      {!canEnter && (
        <p className="mb-4 text-sm text-red-400">
          Not enough energy. Complete more habits to earn Energy.
        </p>
      )}

      <label className="mb-4 flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={dontShow}
          onChange={(e) => setDontShow(e.target.checked)}
          className="rounded"
        />
        Don't show this again
      </label>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button onClick={handleConfirm} disabled={!canEnter} className="flex-1">
          Enter ({energyCost} Energy)
        </Button>
      </div>
    </Modal>
  );
}
