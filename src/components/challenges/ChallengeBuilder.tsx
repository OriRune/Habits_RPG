import { useMemo, useState } from 'react';
import { STATS, getStat, type StatId } from '@/engine/stats';
import { type ChallengeKind, type Reward, suggestReward } from '@/engine/challenges';
import { useGameStore, type CustomChallengeDraft } from '@/store/useGameStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

const KINDS: { id: ChallengeKind; label: string; hint: string }[] = [
  { id: 'count', label: 'Completions', hint: 'Finish N qualifying habits' },
  { id: 'quantity', label: 'Quantity', hint: 'Log N total (summed amounts)' },
  { id: 'streak', label: 'Streak', hint: 'N days in a row' },
  { id: 'recovery', label: 'Recovery', hint: 'N comebacks after a missed day' },
  { id: 'class', label: 'Devotion', hint: 'Qualify on N separate days' },
];

const TAGS = ['Health', 'Fitness', 'Study', 'Creativity', 'Social', 'Chores', 'Mental health', 'Work', 'Sleep'];

const fieldCls =
  'w-full rounded-md border border-ink-light/40 bg-parchment-100 px-3 py-2 text-sm text-ink focus:border-gold-deep focus:outline-none';
const labelCls = 'mb-1 block font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted';

function rewardText(r: Reward): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${r.gold} gold`);
  if (r.statXp) for (const [s, amt] of Object.entries(r.statXp)) parts.push(`${amt} ${getStat(s as StatId).short} XP`);
  return parts.join(' · ') || 'no reward';
}

export function ChallengeBuilder({ onClose }: { onClose: () => void }) {
  const createCustomChallenge = useGameStore((s) => s.createCustomChallenge);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ChallengeKind>('count');
  const [stat, setStat] = useState<StatId | ''>('');
  const [tag, setTag] = useState('');
  const [goal, setGoal] = useState('5');
  const [duration, setDuration] = useState('7');
  const [editReward, setEditReward] = useState(false);
  const [goldOverride, setGoldOverride] = useState('');
  const [xpOverride, setXpOverride] = useState('');

  const draft: CustomChallengeDraft = useMemo(
    () => ({
      name,
      kind,
      stat: stat || undefined,
      tag: tag || undefined,
      goal: Math.max(1, Number(goal) || 1),
      durationDays: Math.max(1, Number(duration) || 1),
    }),
    [name, kind, stat, tag, goal, duration],
  );

  const suggested = useMemo(() => suggestReward(draft), [draft]);

  // When the player opens the reward editor, seed the fields from the suggestion.
  function toggleEdit() {
    if (!editReward) {
      setGoldOverride(String(suggested.gold ?? 0));
      setXpOverride(String(stat ? suggested.statXp?.[stat] ?? 0 : 0));
    }
    setEditReward((v) => !v);
  }

  function buildOverride(): Reward | undefined {
    if (!editReward) return undefined;
    const gold = Math.max(0, Math.round(Number(goldOverride) || 0));
    const reward: Reward = { gold };
    const xp = Math.max(0, Math.round(Number(xpOverride) || 0));
    if (stat && xp > 0) reward.statXp = { [stat]: xp };
    return reward;
  }

  function submit() {
    if (!name.trim()) return;
    createCustomChallenge(draft, buildOverride());
    onClose();
  }

  return (
    <Modal title="Forge a Challenge" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Name</label>
          <input
            autoFocus
            className={fieldCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. No-Sugar Streak"
          />
        </div>

        <div>
          <label className={labelCls}>Type</label>
          <div className="grid grid-cols-1 gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.id}
                onClick={() => setKind(k.id)}
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
                  kind === k.id
                    ? 'border-gold-deep bg-gold/15 text-ink'
                    : 'border-ink-light/40 text-ink-muted hover:border-gold-deep/60'
                }`}
              >
                <span className="font-display font-semibold">{k.label}</span>
                <span className="text-[11px] text-ink-light">{k.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Stat (optional)</label>
            <select className={fieldCls} value={stat} onChange={(e) => setStat(e.target.value as StatId | '')}>
              <option value="">Any stat</option>
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
              <option value="">Any tag</option>
              {TAGS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{kind === 'quantity' ? 'Goal amount' : 'Goal'}</label>
            <input type="number" min={1} className={fieldCls} value={goal} onChange={(e) => setGoal(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Duration (days)</label>
            <input
              type="number"
              min={1}
              className={fieldCls}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-md border border-gold-deep/40 bg-parchment-100/60 p-3">
          <div className="flex items-center justify-between">
            <span className={labelCls + ' mb-0'}>Reward</span>
            <button onClick={toggleEdit} className="text-xs font-semibold text-gold-deep hover:text-gold">
              {editReward ? 'Use suggested' : 'Edit reward'}
            </button>
          </div>
          {!editReward ? (
            <div className="mt-1 text-sm text-ink">{rewardText(suggested)}</div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Gold</label>
                <input
                  type="number"
                  min={0}
                  className={fieldCls}
                  value={goldOverride}
                  onChange={(e) => setGoldOverride(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>{stat ? `${getStat(stat).short} XP` : 'Stat XP'}</label>
                <input
                  type="number"
                  min={0}
                  disabled={!stat}
                  className={fieldCls}
                  value={stat ? xpOverride : ''}
                  placeholder={stat ? undefined : 'pick a stat'}
                  onChange={(e) => setXpOverride(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <Button onClick={submit} disabled={!name.trim()} className="w-full py-2.5">
          Add to Board
        </Button>
      </div>
    </Modal>
  );
}
