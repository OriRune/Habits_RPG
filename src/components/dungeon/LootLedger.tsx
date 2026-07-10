// Banked-vs-exposed loot for the dungeon run HUD (plan 4.3 / DUN-09): what's
// already safe sits in a cool container, what's still exposed on this floor sits
// in a warm one, with the exact flee/fall retention preview from the same engine
// helper the run-end path uses — the numbers here cannot drift from the outcome.
import { Lock, AlertTriangle } from 'lucide-react';
import type { DungeonRun } from '@/engine/dungeonTypes';
import { previewRetainedReward } from '@/engine/dungeonRun';
import type { Reward } from '@/engine/challenges';
import { cn } from '@/lib/cn';

function summarize(reward: Reward): string | null {
  const parts: string[] = [];
  if (reward.gold) parts.push(`${reward.gold}g`);
  const matCount = Object.values(reward.materials ?? {}).reduce((a, b) => a + b, 0);
  if (matCount) parts.push(`${matCount} mat`);
  const drops = (reward.items?.length ?? 0) + (reward.weapons?.length ?? 0) + (reward.gear?.length ?? 0);
  if (drops) parts.push(`${drops} drop${drops > 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function LootLedger({ run }: { run: Pick<DungeonRun, 'bankedReward' | 'floorReward'> }) {
  const banked = summarize(run.bankedReward);
  const exposed = summarize(run.floorReward);
  const fledKeep = previewRetainedReward(run, 'fled').kept;
  const fallKeep = previewRetainedReward(run, 'defeated').kept;
  const drops =
    (run.floorReward.items?.length ?? 0) +
    (run.floorReward.weapons?.length ?? 0) +
    (run.floorReward.gear?.length ?? 0);

  return (
    <div className="grid grid-cols-2 gap-1.5 border-t border-gold-deep/20 pt-1.5 text-[11px]">
      <div className="rounded-md border border-stat-HP/40 bg-stat-HP/10 px-2 py-1.5">
        <div className="flex items-center gap-1 font-display text-[10px] uppercase tracking-wider text-stat-HP">
          <Lock className="h-3 w-3 shrink-0" /> Banked · safe
        </div>
        <div className={cn('mt-0.5', banked ? 'text-on-wood' : 'text-on-wood-dim')}>
          {banked ?? 'Nothing banked yet'}
        </div>
      </div>
      <div className="rounded-md border border-ember/50 bg-ember/10 px-2 py-1.5">
        <div className="flex items-center gap-1 font-display text-[10px] uppercase tracking-wider text-ember-bright">
          <AlertTriangle className="h-3 w-3 shrink-0" /> This floor · exposed
        </div>
        <div className={cn('mt-0.5', exposed ? 'text-on-wood' : 'text-on-wood-dim')}>
          {exposed ?? 'Nothing at risk yet'}
        </div>
        {exposed && (
          <div className="mt-0.5 text-[10px] leading-snug text-on-wood-mid">
            Flee keeps <span className="text-gold-bright">{fledKeep.gold ?? 0}g</span> · a fall
            keeps <span className="text-gold-bright">{fallKeep.gold ?? 0}g</span>
            {drops > 0 && <> · drops are lost either way</>}
          </div>
        )}
      </div>
    </div>
  );
}
