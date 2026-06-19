import { Trees, Zap, Wind, Shield } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { FOREST_ENERGY_COST } from '@/engine/forest';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';

/** What the next depth milestone unlocks (mirrors content/forest stageMin gates + biome bands). */
function milestoneHint(deepest: number): string {
  if (deepest < 2) return 'Reach Depth 2 — Gray Wolves appear (more leather for gear).';
  if (deepest < 3) return 'Reach Depth 3 — Alpha Boars roam; good practice before the guardian.';
  if (deepest < 4) return 'Reach Depth 4 — defeat the Grove Sentinel to unlock the Deepwood.';
  if (deepest < 5) return 'Reach Depth 5 — Forest Bears and Glowcap Mushrooms (crystals for Tier 2 gear).';
  if (deepest < 8) return 'Reach Depth 8 — defeat the Ancient Guardian to reach the Ancient Heart.';
  return 'The Ancient Heart — Heartwood Blooms drop amber resin for Tier 3 crafting.';
}

/** Per-band material summary shown at the entrance. */
function bandMaterials(deepest: number): { band: string; mats: string } | null {
  if (deepest < 1) return null;
  if (deepest < 4) return { band: 'Thicket', mats: 'leather · herbs · cloth · game_meat' };
  if (deepest < 8) return { band: 'Deepwood', mats: '+ crystals (Tier 2 gear)' };
  return { band: 'Ancient Heart', mats: '+ amber resin (Tier 3 gear)' };
}

/** Entrance screen for the Wild Forest (the active run renders in ForestRunOverlay). */
export function ForestView() {
  const energy = useGameStore((s) => s.character.energy);
  const deepestForestStage = useGameStore((s) => s.deepestForestStage);
  const bestForestScore = useGameStore((s) => s.bestForestScore);
  const beginForest = useGameStore((s) => s.beginForest);
  const ag = useGameStore((s) => s.character.statLevels.AG);
  const en = useGameStore((s) => s.character.statLevels.EN);

  const canEnter = energy >= FOREST_ENERGY_COST;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <SectionTitle tone="wood">The Wild Forest</SectionTitle>
      <Panel tone="parchment" className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-md texture-wood border border-gold-deep/60 text-emerald-300">
            <Trees className="h-6 w-6" />
          </span>
          <div>
            <div className="font-display text-base font-bold text-ink">Forage &amp; Hunt</div>
            <div className="text-sm text-ink-muted">A dark maze of trails, separate from the Mine.</div>
          </div>
        </div>

        <p className="text-sm text-ink-muted">
          Pick your way through a fog-shrouded maze of trails. Gather{' '}
          <span className="text-ink">flower bushes for herbs and flax for cloth</span>. Wild animals lurk
          unseen — they ambush when you draw near, but drop <span className="text-ink">leather</span> when
          felled. Reach the far <span className="text-ink">tree line</span> to push deeper. Leave whenever you
          like, but <span className="text-ink">fall in combat and you'll forfeit half your haul</span>.
        </p>

        <div className="flex items-center justify-between rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <Zap className="h-4 w-4 text-stat-AG" /> Cost: {FOREST_ENERGY_COST} energy
          </span>
          <span className="text-sm text-ink-muted">You have {energy} ⚡</span>
        </div>

        {/* Run records */}
        <div className="rounded-md border border-gold-deep/30 bg-parchment-300/40 p-3 text-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-display text-ink">Deepest trek</span>
            <span className="font-display font-bold text-gold-deep">
              {deepestForestStage > 0 ? `Depth ${deepestForestStage}` : '—'}
            </span>
          </div>
          {bestForestScore > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Best score</span>
              <span className="font-mono text-xs text-ink">{bestForestScore.toLocaleString()}</span>
            </div>
          )}
          {(() => {
            const bm = bandMaterials(deepestForestStage);
            return bm && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-ink-muted">{bm.band} drops</span>
                <span className="text-ink">{bm.mats}</span>
              </div>
            );
          })()}
          <div className="text-[11px] text-ink-muted">{milestoneHint(deepestForestStage)}</div>
        </div>

        {/* Relevant stats */}
        <div className="flex items-center gap-4 text-xs text-ink-muted">
          <span className="flex items-center gap-1">
            <Wind className="h-3.5 w-3.5 text-stat-AG" />
            <span className="text-ink-muted">AG {ag}</span>
            <span className="text-ink-muted/60 text-[10px]">— speed &amp; dash</span>
          </span>
          <span className="flex items-center gap-1">
            <Shield className="h-3.5 w-3.5 text-stat-EN" />
            <span className="text-ink-muted">EN {en}</span>
            <span className="text-ink-muted/60 text-[10px]">— stamina pool</span>
          </span>
        </div>

        <Button onClick={() => beginForest()} disabled={!canEnter} className="w-full py-2.5">
          {canEnter ? 'Enter the Forest' : `Need ${FOREST_ENERGY_COST} energy (complete habits)`}
        </Button>
      </Panel>
    </div>
  );
}
