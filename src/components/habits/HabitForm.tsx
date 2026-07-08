import { useState } from 'react';
import { ChevronLeft, Sparkles, Pencil } from 'lucide-react';
import { STATS, getStat } from '@/engine/stats';
import { type Difficulty, BASE_XP, HABIT_GOLD, levelXpMultiplier } from '@/engine/xp';
import { type Habit, type HabitType, type Frequency } from '@/engine/habits';
import { useGameStore, type NewHabitInput } from '@/store/useGameStore';
import { HABIT_TEMPLATE_GROUPS, type HabitTemplateGroup } from '@/content/habitTemplates';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const DIFFICULTIES: { id: Difficulty; label: string; guidance: string; xp: number }[] = [
  { id: 'easy', label: 'Easy', guidance: 'Small enough to do even on a bad day.', xp: BASE_XP.easy },
  { id: 'normal', label: 'Normal', guidance: 'A solid daily effort.', xp: BASE_XP.normal },
  { id: 'hard', label: 'Hard', guidance: 'Requires planning or discipline.', xp: BASE_XP.hard },
  { id: 'epic', label: 'Epic', guidance: 'A major effort — not for every habit.', xp: BASE_XP.epic },
];

const TAGS = ['Health', 'Fitness', 'Study', 'Creativity', 'Social', 'Chores', 'Mental health', 'Work', 'Sleep'];

const fieldCls =
  'w-full rounded-md border border-ink-light/40 bg-parchment-100 px-3 py-2 text-sm text-ink focus:border-gold-deep focus:outline-none';
const labelCls = 'mb-1 block font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted';

type FormMode = 'choose' | 'templates' | 'template_detail' | 'custom';

export function HabitForm({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const addHabit = useGameStore((s) => s.addHabit);
  const isEdit = habit !== undefined;

  // Start in 'choose' mode for new habits, skip to 'custom' for edits
  const [mode, setMode] = useState<FormMode>(isEdit ? 'custom' : 'choose');
  const [selectedGroup, setSelectedGroup] = useState<HabitTemplateGroup | null>(null);

  if (mode === 'choose') {
    return (
      <Modal title="New Habit" onClose={onClose}>
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">How would you like to add a habit?</p>
          <button
            onClick={() => setMode('templates')}
            className="flex w-full items-center gap-3 rounded-md border border-gold-deep/40 bg-gold/10 px-4 py-3 text-left hover:bg-gold/20 transition-colors"
          >
            <Sparkles className="h-5 w-5 shrink-0 text-gold-bright" />
            <div>
              <div className="font-semibold text-ink">Quick Start from Template</div>
              <div className="text-xs text-ink-muted">
                Pick a ready-made habit set — Fitness, Reading, Study, and more.
              </div>
            </div>
          </button>
          <button
            onClick={() => setMode('custom')}
            className="flex w-full items-center gap-3 rounded-md border border-ink-light/40 px-4 py-3 text-left hover:border-gold-deep/60 transition-colors"
          >
            <Pencil className="h-5 w-5 shrink-0 text-ink-muted" />
            <div>
              <div className="font-semibold text-ink">Custom Habit</div>
              <div className="text-xs text-ink-muted">Build from scratch with full control.</div>
            </div>
          </button>
        </div>
      </Modal>
    );
  }

  if (mode === 'templates') {
    return (
      <Modal title="Templates" onClose={onClose}>
        <div className="space-y-2">
          <button
            onClick={() => setMode('choose')}
            className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink mb-1"
          >
            <ChevronLeft className="h-3 w-3" /> Back
          </button>
          <p className="text-sm text-ink-muted">Choose a template set to get started:</p>
          {HABIT_TEMPLATE_GROUPS.map((group) => {
            const stat = getStat(group.primaryStat);
            return (
              <button
                key={group.id}
                onClick={() => { setSelectedGroup(group); setMode('template_detail'); }}
                className="flex w-full items-start gap-3 rounded-md border border-ink-light/40 px-3 py-2.5 text-left hover:border-gold-deep/60 transition-colors"
              >
                <div
                  className="mt-0.5 h-3 w-3 shrink-0 rounded-full"
                  style={{ background: stat.color }}
                />
                <div>
                  <div className="font-semibold text-sm text-ink">{group.label}</div>
                  <div className="text-xs text-ink-muted">{group.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </Modal>
    );
  }

  if (mode === 'template_detail' && selectedGroup) {
    return (
      <Modal title={selectedGroup.label} onClose={onClose}>
        <div className="space-y-2">
          <button
            onClick={() => setMode('templates')}
            className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink mb-1"
          >
            <ChevronLeft className="h-3 w-3" /> Back
          </button>
          <p className="text-sm text-ink-muted">
            Add individual habits from this template, or add them all at once.
          </p>
          <div className="space-y-1.5">
            {selectedGroup.habits.map((template, i) => {
              const stat = getStat(template.stat);
              const xp = BASE_XP[template.difficulty];
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-md border border-ink-light/30 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{template.name}</div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-ink-muted">
                      <span style={{ color: stat.color }} className="font-semibold">{stat.name}</span>
                      <span>·</span>
                      <span>{template.difficulty}</span>
                      <span>·</span>
                      <span>{xp} XP + 1 ⚡</span>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => { addHabit(template as NewHabitInput); }}
                    className="shrink-0 px-2.5 py-1 text-xs"
                  >
                    Add
                  </Button>
                </div>
              );
            })}
          </div>
          <Button
            onClick={() => {
              for (const t of selectedGroup.habits) addHabit(t as NewHabitInput);
              onClose();
            }}
            className="w-full py-2 mt-1"
          >
            Add all {selectedGroup.habits.length} habits
          </Button>
        </div>
      </Modal>
    );
  }

  // Custom / edit form
  return <HabitFormFields habit={habit} onClose={onClose} onBack={!isEdit ? () => setMode('choose') : undefined} />;
}

// ---------------------------------------------------------------------------
// Actual form fields (custom / edit path)
// ---------------------------------------------------------------------------

function HabitFormFields({
  habit,
  onClose,
  onBack,
}: {
  habit?: Habit;
  onClose: () => void;
  onBack?: () => void;
}) {
  const addHabit = useGameStore((s) => s.addHabit);
  const updateHabit = useGameStore((s) => s.updateHabit);
  const level = useGameStore((s) => s.character.level);
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

  // Reward preview values — scaled by the player's level so the preview matches what a
  // completion actually grants (BAL-01 habit-XP scaling); gear/recovery bonuses land on top.
  const xpPerCompletion = Math.round(BASE_XP[difficulty] * levelXpMultiplier(level));
  const goldPerCompletion = HABIT_GOLD[difficulty];
  const freq = frequency === 'daily' ? 7 : frequency === 'weekdays' ? 5 : frequency === 'times_per_week' ? Math.min(7, Number(timesPerWeek) || 1) : null;
  const weeklyXp = freq !== null ? xpPerCompletion * freq : null;

  return (
    <Modal title={isEdit ? 'Edit Habit' : 'New Habit'} onClose={onClose}>
      <div className="space-y-4">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
          >
            <ChevronLeft className="h-3 w-3" /> Back to templates
          </button>
        )}

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
            <label className={labelCls}>Stat (Training XP)</label>
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
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-sm',
                  type === t
                    ? 'border-gold-deep bg-gold/15 font-semibold text-ink'
                    : 'border-ink-light/40 text-ink-muted hover:border-gold-deep/60',
                  isEdit && 'cursor-not-allowed opacity-50',
                )}
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
              XP scales with amount, up to 10× target (normally capped at 150%)
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
                  className={cn(
                    'h-9 flex-1 rounded-md border text-sm font-semibold',
                    days.includes(i)
                      ? 'border-gold-deep bg-gold/15 text-ink'
                      : 'border-ink-light/40 text-ink-muted hover:border-gold-deep/60',
                  )}
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
                title={d.guidance}
                className={cn(
                  'rounded-md border px-2 py-2 text-center text-xs',
                  difficulty === d.id
                    ? 'border-gold-deep bg-gold/15 text-ink'
                    : 'border-ink-light/40 text-ink-muted hover:border-gold-deep/60',
                )}
              >
                <div className="font-display font-semibold">{d.label}</div>
                <div className="text-[10px] text-ink-light">{d.xp} XP</div>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-muted italic">
            {DIFFICULTIES.find((d) => d.id === difficulty)?.guidance}
          </p>
          {isEdit && (
            <p className="mt-0.5 text-xs text-ink-muted">Changes future XP only — past entries are unchanged.</p>
          )}
        </div>

        {/* Reward preview — only for new habits */}
        {!isEdit && (
          <div className="rounded-md border border-gold-deep/30 bg-gold/5 px-3 py-2.5 space-y-1">
            <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-gold-deep">
              Reward preview
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-ink-muted">
              <span>XP per completion</span>
              <span className="font-semibold text-ink">{xpPerCompletion} XP → {getStat(stat).name}</span>
              <span>Energy per completion</span>
              <span className="font-semibold text-ink">+1 ⚡</span>
              {goldPerCompletion > 0 && (
                <>
                  <span>Gold per completion</span>
                  <span className="font-semibold text-ink">{goldPerCompletion} gold</span>
                </>
              )}
              {weeklyXp !== null && (
                <>
                  <span>Expected weekly XP</span>
                  <span className="font-semibold text-ink">~{weeklyXp} XP</span>
                </>
              )}
            </div>
          </div>
        )}

        <Button onClick={submit} disabled={!name.trim()} className="w-full py-2.5">
          {isEdit ? 'Save Changes' : 'Inscribe Habit'}
        </Button>
      </div>
    </Modal>
  );
}
