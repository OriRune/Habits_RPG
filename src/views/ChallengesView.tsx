import { Gift, Clock } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { CHALLENGE_TEMPLATES, isExpired, type Reward } from '@/engine/challenges';
import { getStat, type StatId } from '@/engine/stats';
import { toISODate, daysBetween } from '@/engine/date';
import { cn } from '@/lib/cn';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';

function rewardText(r: Reward): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${r.gold} gold`);
  if (r.statXp) {
    for (const [stat, amt] of Object.entries(r.statXp)) parts.push(`${amt} ${getStat(stat as StatId).short} XP`);
  }
  if (r.items) for (const key of r.items) parts.push(key.replace(/_/g, ' '));
  return parts.join(' · ') || 'reward';
}

export function ChallengesView() {
  const challenges = useGameStore((s) => s.challenges);
  const startChallenge = useGameStore((s) => s.startChallenge);
  const claimChallenge = useGameStore((s) => s.claimChallenge);
  const today = toISODate();

  const activeIds = new Set(challenges.filter((c) => c.status === 'active').map((c) => c.def.id));
  const available = CHALLENGE_TEMPLATES.filter((d) => !activeIds.has(d.id));

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <SectionTitle tone="wood">The Trial Board</SectionTitle>

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
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-display text-sm font-bold text-ink">{c.def.name}</div>
                    <div className="text-xs text-ink-muted">{c.def.description}</div>
                  </div>
                  {status === 'active' && (
                    <span className="flex items-center gap-1 text-xs text-ink-light">
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
                  <span>
                    {c.progress} / {c.def.goal}
                  </span>
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

      {available.length > 0 && (
        <>
          <SectionTitle tone="wood" className="pt-2">Available</SectionTitle>
          <div className="space-y-2">
            {available.map((d) => (
              <Panel key={d.id} tone="parchment" className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="font-display text-sm font-bold text-ink">{d.name}</div>
                  <div className="text-xs text-ink-muted">
                    {d.description} · {d.durationDays}d · {rewardText(d.reward)}
                  </div>
                </div>
                <Button variant="secondary" onClick={() => startChallenge(d.id)} className="shrink-0 px-3 py-1.5">
                  Accept
                </Button>
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
