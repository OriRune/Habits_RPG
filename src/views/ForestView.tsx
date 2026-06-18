import { Trees, Zap } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { FOREST_ENERGY_COST } from '@/engine/forest';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';

/** What the next depth milestone unlocks (mirrors content/forest stageMin gates + biome bands). */
function milestoneHint(deepest: number): string {
  if (deepest < 2) return 'Reach Depth 2 for Gray Wolves (more leather).';
  if (deepest < 4) return 'Reach Depth 4 — the Deepwood Grove and its Shadow Lynx.';
  if (deepest < 5) return 'Reach Depth 5 — Forest Bears prowl these shadows.';
  if (deepest < 8) return 'Reach Depth 8 — the Ancient Heart hides Amber Resin.';
  return 'The Ancient Heart — chase a new record.';
}

/** Entrance screen for the Wild Forest (the active run renders in ForestRunOverlay). */
export function ForestView() {
  const energy = useGameStore((s) => s.character.energy);
  const deepestForestStage = useGameStore((s) => s.deepestForestStage);
  const bestForestScore = useGameStore((s) => s.bestForestScore);
  const beginForest = useGameStore((s) => s.beginForest);

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

        <div className="rounded-md border border-gold-deep/30 bg-parchment-300/40 p-3 text-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-display text-ink">Deepest trek</span>
            <span className="font-display font-bold text-gold-deep">
              {deepestForestStage > 0 ? `Depth ${deepestForestStage}` : '—'}
            </span>
          </div>
          {bestForestScore > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Best run score</span>
              <span className="font-mono text-xs text-ink">{bestForestScore.toLocaleString()}</span>
            </div>
          )}
          <div className="text-[11px] text-ink-muted">{milestoneHint(deepestForestStage)}</div>
        </div>

        <Button onClick={() => beginForest()} disabled={!canEnter} className="w-full py-2.5">
          {canEnter ? 'Enter the Forest' : `Need ${FOREST_ENERGY_COST} energy (complete habits)`}
        </Button>
      </Panel>
    </div>
  );
}
