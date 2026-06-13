import { Trophy, Gift, Clock } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { CHALLENGE_TEMPLATES, isExpired, type Reward } from '@/engine/challenges';
import { getStat } from '@/engine/stats';
import { toISODate, daysBetween } from '@/engine/date';
import { cn } from '@/lib/cn';

function rewardText(r: Reward): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${r.gold} gold`);
  if (r.statXp) {
    for (const [stat, amt] of Object.entries(r.statXp)) parts.push(`${amt} ${getStat(stat as never).short} XP`);
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
    <div className="mx-auto max-w-2xl px-4 py-5">
      <h1 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-200">
        <Trophy className="h-5 w-5 text-amber-400" /> Challenges
      </h1>

      {/* Active / completed challenges */}
      {challenges.length > 0 && (
        <div className="mb-6 space-y-3">
          {challenges.map((c, i) => {
            const expired = c.status === 'active' && isExpired(c, today);
            const status = expired ? 'expired' : c.status;
            const pct = Math.min(100, Math.round((c.progress / c.def.goal) * 100));
            const daysLeft = c.def.durationDays - daysBetween(today, c.startISO);
            const claimable = status === 'completed' || status === 'expired';
            return (
              <div key={i} className="rounded-xl border border-gray-800 bg-[#11151f] p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-semibold">{c.def.name}</div>
                    <div className="text-xs text-gray-500">{c.def.description}</div>
                  </div>
                  {status === 'active' && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <Clock className="h-3 w-3" /> {Math.max(0, daysLeft)}d
                    </span>
                  )}
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-800">
                  <div
                    className={cn('h-full rounded-full', status === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                  <span>
                    {c.progress} / {c.def.goal}
                  </span>
                  <span>Reward: {rewardText(c.def.reward)}</span>
                </div>

                {status === 'claimed' && <div className="mt-2 text-xs text-emerald-400">Reward claimed ✓</div>}
                {claimable && (
                  <button
                    onClick={() => claimChallenge(i)}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-xs font-semibold hover:bg-emerald-500"
                  >
                    <Gift className="h-4 w-4" />
                    {status === 'completed' ? 'Claim Reward' : 'Claim Partial Reward'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Available challenges to start */}
      {available.length > 0 && (
        <>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-600">Available</h2>
          <div className="space-y-2">
            {available.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-xl border border-gray-800 bg-[#11151f] p-3">
                <div>
                  <div className="text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-gray-500">
                    {d.description} · {d.durationDays}d · {rewardText(d.reward)}
                  </div>
                </div>
                <button
                  onClick={() => startChallenge(d.id)}
                  className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-500"
                >
                  Start
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
