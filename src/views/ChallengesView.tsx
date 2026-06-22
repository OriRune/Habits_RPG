import { useState } from 'react';
import { Gift, Clock, Plus, Trash2 } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { isExpired, type ChallengeDef, type ChallengeKind, type Reward } from '@/engine/challenges';
import { weeklyRotation } from '@/engine/weekly';
import { getStat, type StatId } from '@/engine/stats';
import { rankStats } from '@/engine/classes';
import { toISODate, daysBetween, weekKey } from '@/engine/date';
import { challengeKindCrest } from '@/lib/sprites';
import { cn } from '@/lib/cn';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';
import { SectionTitle } from '@/components/ui/Divider';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChallengeBuilder } from '@/components/challenges/ChallengeBuilder';

const KIND_LABEL: Record<ChallengeKind, string> = {
  count: 'Completions',
  quantity: 'Quantity',
  streak: 'Streak',
  recovery: 'Recovery',
  class: 'Devotion',
  rival: 'Rival',
};

function rewardText(r: Reward): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${r.gold} gold`);
  if (r.statXp) {
    for (const [stat, amt] of Object.entries(r.statXp)) parts.push(`${amt} ${getStat(stat as StatId).short} XP`);
  }
  if (r.items) for (const key of r.items) parts.push(key.replace(/_/g, ' '));
  return parts.join(' · ') || 'reward';
}

/** Progress readout suffix tuned to the challenge kind. */
function progressText(def: ChallengeDef, progress: number): string {
  const base = `${progress} / ${def.goal}`;
  switch (def.kind) {
    case 'streak':
      return `${base} day streak`;
    case 'class':
      return `${base} days`;
    case 'recovery':
      return `${base} comebacks`;
    default:
      return base;
  }
}

function KindChip({ kind }: { kind: ChallengeKind }) {
  return (
    <span className="rounded-full border border-gold-deep/40 bg-wood-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-deep">
      {KIND_LABEL[kind]}
    </span>
  );
}

export function ChallengesView() {
  const challenges = useGameStore((s) => s.challenges);
  const customChallenges = useGameStore((s) => s.customChallenges);
  const character = useGameStore((s) => s.character);
  const startChallenge = useGameStore((s) => s.startChallenge);
  const claimChallenge = useGameStore((s) => s.claimChallenge);
  const deleteCustomChallenge = useGameStore((s) => s.deleteCustomChallenge);
  const [building, setBuilding] = useState(false);
  const today = toISODate();

  const classStat = character.classId ? rankStats(character.statXp)[0] : null;
  const rotation = weeklyRotation(weekKey(today), classStat);

  const activeIds = new Set(challenges.filter((c) => c.status === 'active').map((c) => c.def.id));
  const rotationAvail = rotation.filter((d) => !activeIds.has(d.id));
  const customAvail = customChallenges.filter((d) => !activeIds.has(d.id));

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <div className="flex items-center justify-between">
        <SectionTitle tone="wood">The Trial Board</SectionTitle>
        <Button variant="secondary" onClick={() => setBuilding(true)} className="flex items-center gap-1.5 px-3 py-1.5">
          <Plus className="h-4 w-4" /> Create
        </Button>
      </div>

      {challenges.length === 0 && rotationAvail.length === 0 && customAvail.length === 0 && (
        <EmptyState message="No challenges yet — use the Create button to build one, or wait for the weekly rotation to refresh." />
      )}

      {challenges.length > 0 && (
        <div className="space-y-3">
          {challenges.map((c, i) => {
            const expired = c.status === 'active' && isExpired(c, today);
            const status = expired ? 'expired' : c.status;
            const pct = Math.min(100, Math.round((c.progress / c.def.goal) * 100));
            const daysLeft = c.def.durationDays - daysBetween(today, c.startISO);
            const claimable = status === 'completed' || status === 'expired';
            return (
              <Panel key={i} tone="parchment" className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <Sprite spriteKey={`challenge:${c.def.kind}`} look={challengeKindCrest(c.def.kind)} size="sm" className="mt-0.5" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-display text-sm font-bold text-ink">{c.def.name}</span>
                        <KindChip kind={c.def.kind} />
                      </div>
                      <div className="text-xs text-ink-muted">{c.def.description}</div>
                    </div>
                  </div>
                  {status === 'active' && (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-ink-light">
                      <Clock className="h-3 w-3" /> {Math.max(0, daysLeft)}d
                    </span>
                  )}
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full border border-gold-deep/40 bg-wood-900">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      status === 'completed' ? 'bg-gradient-to-r from-jewel-green to-stat-HP' : 'bg-gradient-to-r from-gold-deep to-gold-bright',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-ink-muted">
                  <span>{progressText(c.def, c.progress)}</span>
                  <span>Reward: {rewardText(c.def.reward)}</span>
                </div>

                {status === 'claimed' && (
                  <div className="mt-2 font-display text-xs text-jewel-green">Reward claimed ✓</div>
                )}
                {claimable && (
                  <Button
                    onClick={() => claimChallenge(i)}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 py-2"
                  >
                    <Gift className="h-4 w-4" />
                    {status === 'completed' ? 'Claim Reward' : 'Claim Partial Reward'}
                  </Button>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {rotationAvail.length > 0 && (
        <>
          <SectionTitle tone="wood" className="pt-2">This Week's Trials</SectionTitle>
          <div className="space-y-2">
            {rotationAvail.map((d) => (
              <AvailableRow key={d.id} def={d} onStart={() => startChallenge(d.id)} />
            ))}
          </div>
        </>
      )}

      {customAvail.length > 0 && (
        <>
          <SectionTitle tone="wood" className="pt-2">Your Challenges</SectionTitle>
          <div className="space-y-2">
            {customAvail.map((d) => (
              <AvailableRow
                key={d.id}
                def={d}
                onStart={() => startChallenge(d.id)}
                onDelete={() => deleteCustomChallenge(d.id)}
              />
            ))}
          </div>
        </>
      )}

      {building && <ChallengeBuilder onClose={() => setBuilding(false)} />}
    </div>
  );
}

function AvailableRow({
  def,
  onStart,
  onDelete,
}: {
  def: ChallengeDef;
  onStart: () => void;
  onDelete?: () => void;
}) {
  return (
    <Panel tone="parchment" className="flex items-center justify-between gap-3 p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Sprite spriteKey={`challenge:${def.kind}`} look={challengeKindCrest(def.kind)} size="sm" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-bold text-ink">{def.name}</span>
            <KindChip kind={def.kind} />
          </div>
          <div className="text-xs text-ink-muted">
            {def.description} · {def.durationDays}d · {rewardText(def.reward)}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onDelete && (
          <button onClick={onDelete} className="p-1.5 text-ink-light hover:text-ember" aria-label="Delete challenge">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <Button variant="secondary" onClick={onStart} className="px-3 py-1.5">
          Accept
        </Button>
      </div>
    </Panel>
  );
}
