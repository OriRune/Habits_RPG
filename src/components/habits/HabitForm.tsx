import { useState } from 'react';
import { STATS } from '@/engine/stats';
import { type Difficulty } from '@/engine/xp';
import { type Habit, type HabitType, type Frequency } from '@/engine/habits';
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

export function HabitForm({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const addHabit = useGameStore((s) => s.addHabit);
  const updateHabit = useGameStore((s) => s.updateHabit);
  const isEdit = habit !== undefined;

  const [name, setName] = useState(habit?.name ?? '');
  const [stat, setStat] = useState(habit?.stat ?? STATS[0].id);
  const [type, setType] = useState<HabitType>(habit?.type ?? 'binary');
  const [target, setTarget] = useState(String(habit?.target ?? 20));
  const [unit, setUnit] = useState(habit?.unit ?? '');
  const [uncapped, setUncapped] = useState(habit?.uncapped ?? false);
  const [frequency, setFrequency] = useState<Frequency>(habit?.frequency ?? 'daily');
  const [days, setDays] = useState<number[]>(habit?.days ?? [1, 3, 5]);
  const [timesPerWeek, setTimesPerWeek] = useState(String(habit?.timesPerWeek ?? 3));
  const [difficulty, setDifficulty] = useState<Difficulty>(habit?.difficulty ?? 'normal');
  const [tag, setTag] = useState(habit?.tag ?? '');

  function toggleDay(d: number) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  }

  function submit() {
    if (!name.trim()) return;
    if (frequency === 'custom' && days.length === 0) return;
    const input: NewHabitInput = {
      name: name.trim(),
      stat,
      type,
      frequency,
      difficulty,
      tag: tag || undefined,
      ...(type === 'quantity'
        ? { target: Math.max(1, Number(target) || 1), unit: unit || undefined, uncapped }
        : {}),
      ...(frequency === 'custom' ? { days } : {}),
      ...(frequency === 'times_per_week'
        ? { timesPerWeek: Math.max(1, Math.min(7, Number(timesPerWeek) || 1)) }
        : {}),
    };
    if (isEdit) {
      updateHabit(habit.id, input);
    } else {
      addHabit(input);
    }
    onClose();
  }

  return (
    <Modal title={isEdit ? 'Edit Habit' : 'New Habit'} onClose={onClose}>
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
          {isEdit && (
            <p className="mb-1.5 text-xs text-ink-muted">
              Type can't be changed after creation — existing logs would become inconsistent.
            </p>
          )}
          <div className="flex gap-2">
            {(['binary', 'quantity'] as HabitType[]).map((t) => (
              <button
                key={t}
                onClick={() => !isEdit && setType(t)}
                disabled={isEdit}
                title={isEdit ? "Type can't be changed after creation" : undefined}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                  type === t
                    ? 'border-gold-deep bg-gold/15 font-semibold text-ink'
                    : 'border-ink-light/40 text-ink-muted hover:border-gold-deep/60'
                } ${isEdit ? 'cursor-not-allowed opacity-50' : ''}`}
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
            <label className="col-span-2 flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={uncapped} onChange={(e) => setUncapped(e.target.checked)} />
              Allow unlimited — no XP cap (e.g. miles run)
            </label>
          </div>
        )}

        <div>
          <label className={labelCls}>Frequency</label>
          <select className={fieldCls} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            <option value="daily">Daily</option>
            <option value="weekdays">Weekdays</option>
            <option value="custom">Certain days</option>
            <option value="times_per_week">X times per week</option>
            <option value="as_needed">As needed (no penalty)</option>
          </select>
        </div>

        {frequency === 'custom' && (
          <div>
            <label className={labelCls}>Days</label>
            <div className="flex gap-1">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <button
                  key={i}
                  onClick={() => toggleDay(i)}
                  className={`h-9 flex-1 rounded-md border text-sm font-semibold ${
                    days.includes(i)
                      ? 'border-gold-deep bg-gold/15 text-ink'
                      : 'border-ink-light/40 text-ink-muted hover:border-gold-deep/60'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {frequency === 'times_per_week' && (
          <div>
            <label className={labelCls}>Times per week</label>
            <input
              type="number"
              min={1}
              max={7}
              className={fieldCls}
              value={timesPerWeek}
              onChange={(e) => setTimesPerWeek(e.target.value)}
            />
          </div>
        )}

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
          {isEdit && (
            <p className="mt-1.5 text-xs text-ink-muted">Changes future XP only — past entries are unchanged.</p>
          )}
        </div>

        <Button onClick={submit} disabled={!name.trim()} className="w-full py-2.5">
          {isEdit ? 'Save Changes' : 'Inscribe Habit'}
        </Button>
      </div>
    </Modal>
  );
}
