import { useState } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { toISODate, addDays } from '@/engine/date';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

const PRESETS: { label: string; days: number }[] = [
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
];

/** Suspend a habit until a chosen date (preset duration or a custom date). */
export function SuspendDialog({ habitId, onClose }: { habitId: string; onClose: () => void }) {
  const suspendHabit = useGameStore((s) => s.suspendHabit);
  const [customDate, setCustomDate] = useState('');

  function suspendFor(days: number) {
    suspendHabit(habitId, addDays(toISODate(), days));
    onClose();
  }

  function suspendUntil() {
    if (!customDate) return;
    suspendHabit(habitId, customDate);
    onClose();
  }

  return (
    <Modal title="Suspend Habit" onClose={onClose}>
      <p className="mb-4 text-sm text-ink-muted">
        Pause this habit (injury, vacation, overload…). It stays on your tracker marked as
        suspended and auto-resumes on the date you pick.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map((p) => (
          <Button key={p.label} variant="secondary" onClick={() => suspendFor(p.days)} className="py-2">
            {p.label}
          </Button>
        ))}
      </div>
      <div className="mt-4">
        <label className="mb-1 block font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Or resume on a specific date
        </label>
        <div className="flex gap-2">
          <input
            type="date"
            min={toISODate()}
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="flex-1 rounded-md border border-ink-light/40 bg-parchment-100 px-3 py-2 text-sm text-ink focus:border-gold-deep focus:outline-none"
          />
          <Button onClick={suspendUntil} disabled={!customDate} className="px-4">
            Suspend
          </Button>
        </div>
      </div>
    </Modal>
  );
}
