import { Pickaxe, Zap } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { MINE_ENERGY_COST } from '@/engine/mining';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';

/** What the next depth milestone unlocks (mirrors content/mining floorMin gates + biome bands). */
function milestoneHint(deepest: number): string {
  if (deepest < 3)  return 'Reach Floor 3 for Iron veins.';
  if (deepest < 4)  return 'Reach Floor 4 for Gold veins.';
  if (deepest < 7)  return 'Reach Floor 7 — defeat the Stone Golem to enter the Frozen Depths.';
  if (deepest < 10) return 'Reach Floor 10 for Gemstones & Ice Crawlers.';
  if (deepest < 15) return 'Reach Floor 15 — defeat the Magma Colossus to enter the Magma Core.';
  return 'The Magma Core — chase a new record.';
}

/** Entrance screen for the Deep Mine (the active run renders in MineRunOverlay). */
export function MiningView() {
  const energy = useGameStore((s) => s.character.energy);
  const deepestMineFloor = useGameStore((s) => s.deepestMineFloor);
  const bestMineScore = useGameStore((s) => s.bestMineScore);
  const beginMining = useGameStore((s) => s.beginMining);

  const canEnter = energy >= MINE_ENERGY_COST;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <SectionTitle tone="wood">The Deep Mine</SectionTitle>
      <Panel tone="parchment" className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-md texture-wood border border-gold-deep/60 text-gold-bright">
            <Pickaxe className="h-6 w-6" />
          </span>
          <div>
            <div className="font-display text-base font-bold text-ink">Swing &amp; Descend</div>
            <div className="text-sm text-ink-muted">A real-time delve, separate from the Dungeon.</div>
          </div>
        </div>

        <p className="text-sm text-ink-muted">
          Walk the cavern and swing your pick to break rock and ore veins for{' '}
          <span className="text-ink">gold and crafting materials</span>. Cave monsters roam — bonk them
          with your pick before they wear you down. Find the{' '}
          <span className="text-ink">shaft</span> to descend to deeper, richer floors. Leave whenever you
          like, but{' '}
          <span className="text-ink">fall to a monster and you'll forfeit half your haul</span>.
        </p>

        <div className="flex items-center justify-between rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <Zap className="h-4 w-4 text-stat-AG" /> Cost: {MINE_ENERGY_COST} energy
          </span>
          <span className="text-sm text-ink-muted">You have {energy} ⚡</span>
        </div>

        <div className="rounded-md border border-gold-deep/30 bg-parchment-300/40 p-3 text-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-display text-ink">Deepest dig</span>
            <span className="font-display font-bold text-gold-deep">
              {deepestMineFloor > 0 ? `Floor ${deepestMineFloor}` : '—'}
            </span>
          </div>
          {bestMineScore > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Best run score</span>
              <span className="font-mono text-xs text-ink">{bestMineScore.toLocaleString()}</span>
            </div>
          )}
          <div className="text-[11px] text-ink-muted">{milestoneHint(deepestMineFloor)}</div>
        </div>

        <Button onClick={() => beginMining()} disabled={!canEnter} className="w-full py-2.5">
          {canEnter ? 'Enter the Mine' : `Need ${MINE_ENERGY_COST} energy (complete habits)`}
        </Button>
      </Panel>
    </div>
  );
}
