import { useState } from 'react';
import { STATS } from '@/engine/stats';
import { type Difficulty } from '@/engine/xp';
import { type HabitType, type Frequency } from '@/engine/habits';
import { useGameStore, type NewHabitInput } from '@/store/useGameStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

const DIFFICULTIES: { id: Difficulty; label: string; xp: number }[] = [
  { id: 'easy', label: 'Easy', xp: 10 },
  { id: 'normal', label: 'Normal', xp: 20 },
  { id: 'hard', label: 'Hard', xp: 35 },
  { id: 'epic', label: 'Epic', xp: 50 },
];

const TAGS = ['Health', 'Fitness', 'Study', 'Creativity', 'Social', 'Chores', 'Mental health', 'Work', 'Sleep'];

const fieldCls =
  'w-full rounded-md border border-ink-light/40 bg-parchment-100 px-3 py-2 text-sm text-ink focus:border-gold-deep focus:outline-none';
const labelCls = 'mb-1 block font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted';

export function HabitForm({ onClose }: { onClose: () => void }) {
  const addHabit = useGameStore((s) => s.addHabit);
  const [name, setName] = useState('');
  const [stat, setStat] = useState(STATS[0].id);
  const [type, setType] = useState<HabitType>('binary');
  const [target, setTarget] = useState('20');
  const [unit, setUnit] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('daily');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [tag, setTag] = useState('');

  function submit() {
    if (!name.trim()) return;
    const input: NewHabitInput = {
      name: name.trim(),
      stat,
      type,
      frequency,
      difficulty,
      tag: tag || undefined,
      ...(type === 'quantity'
        ? { target: Math.max(1, Number(target) || 1), unit: unit || undefined }
        : {}),
    };
    addHabit(input);
    onClose();
  }

  return (
    <Modal title="New Habit" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Habit name</label>
          <input
            autoFocus
            className={fieldCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Read 20 pages"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Stat</label>
            <select className={fieldCls} value={stat} onChange={(e) => setStat(e.target.value as typeof stat)}>
              {STATS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Tag (optional)</label>
            <select className={fieldCls} value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">None</option>
              {TAGS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>Type</label>
          <div className="flex gap-2">
            {(['binary', 'quantity'] as HabitType[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                  type === t
                    ? 'border-gold-deep bg-gold/15 font-semibold text-ink'
                    : 'border-ink-light/40 text-ink-muted hover:border-gold-deep/60'
                }`}
              >
                {t === 'binary' ? 'Yes / No' : 'Quantity'}
              </button>
            ))}
          </div>
        </div>

        {type === 'quantity' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Target</label>
              <input
                type="number"
                min={1}
                className={fieldCls}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Unit (optional)</label>
              <input className={fieldCls} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pages, min" />
            </div>
          </div>
        )}

        <div>
          <label className={labelCls}>Frequency</label>
          <select className={fieldCls} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            <option value="daily">Daily</option>
            <option value="weekdays">Weekdays</option>
          </select>
        </div>

        <div>
          <label className={labelCls}>Difficulty</label>
          <div className="grid grid-cols-4 gap-2">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                onClick={() => setDifficulty(d.id)}
                className={`rounded-md border px-2 py-2 text-center text-xs ${
                  difficulty === d.id
                    ? 'border-gold-deep bg-gold/15 text-ink'
                    : 'border-ink-light/40 text-ink-muted hover:border-gold-deep/60'
                }`}
              >
                <div className="font-display font-semibold">{d.label}</div>
                <div className="text-[10px] text-ink-light">{d.xp} XP</div>
              </button>
            ))}
          </div>
        </div>

        <Button onClick={submit} disabled={!name.trim()} className="w-full py-2.5">
          Inscribe Habit
        </Button>
      </div>
    </Modal>
  );
}
