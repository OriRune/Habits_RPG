import { Grid3x3, Zap, Mountain } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { TACTICS_ENERGY_COST, TACTICS_UNLOCK_LEVEL, type TacticsSize } from '@/engine/hexBattle';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';
import { cn } from '@/lib/cn';
import { resume as sfxResume } from '@/lib/sfx';

const SIZE_OPTIONS: { id: TacticsSize; label: string; tiles: number }[] = [
  { id: 'small', label: 'Small', tiles: 37 },
  { id: 'medium', label: 'Medium', tiles: 61 },
  { id: 'large', label: 'Large', tiles: 127 },
];

/** Entrance screen for Hex Tactics (the live skirmish renders in TacticsOverlay). */
export function TacticsView() {
  const energy = useGameStore((s) => s.character.energy);
  const level = useGameStore((s) => s.character.level);
  const ag = useGameStore((s) => s.character.statLevels.AG);
  const deepestTacticsTier = useGameStore((s) => s.deepestTacticsTier);
  const tacticsSize = useGameStore((s) => s.settings.tacticsSize);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const beginTactics = useGameStore((s) => s.beginTactics);

  const unlocked = level >= TACTICS_UNLOCK_LEVEL;
  const canEnter = unlocked && energy >= TACTICS_ENERGY_COST;
  // Mirror the engine: 2 base move tiles + 1 per 4 AG (cap 6); climb 1 + 1 per 8 AG (cap 3).
  const moveTiles = Math.min(6, 2 + Math.floor(ag / 4));
  const climb = Math.min(3, 1 + Math.floor(ag / 8));

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <SectionTitle tone="wood">Hex Tactics</SectionTitle>
      <Panel tone="parchment" className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-md texture-wood border border-gold-deep/60 text-stat-AG">
            <Grid3x3 className="h-6 w-6" />
          </span>
          <div>
            <div className="font-display text-base font-bold text-ink">Turn-Based Skirmish</div>
            <div className="text-sm text-ink-muted">One hero, a hex battlefield, and the high ground.</div>
          </div>
        </div>

        <p className="text-sm text-ink-muted">
          Face a band of foes on a board where every tile has a <span className="text-ink">height</span>.
          Strike from <span className="text-ink">high ground for bonus damage and reach</span>; take cover,
          skirt hazards, and pick your moment. This is where <span className="text-ink">Agility</span> finally
          pays off — it sets how far you move and how high you can climb each turn.
        </p>

        <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
          <div className="mb-2 font-display text-sm text-ink">Battlefield size</div>
          <div className="flex gap-1.5">
            {SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => updateSettings({ tacticsSize: opt.id })}
                className={cn(
                  'flex flex-1 flex-col items-center rounded-md border px-2 py-1.5 font-display text-xs font-bold transition-colors',
                  tacticsSize === opt.id
                    ? 'border-stat-AG bg-stat-AG/20 text-stat-AG'
                    : 'border-gold-deep/30 bg-parchment-300/40 text-ink-muted hover:bg-parchment-300/70',
                )}
              >
                {opt.label}
                <span className="text-[10px] font-normal opacity-80">{opt.tiles} tiles</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
          <div className="flex items-center gap-2 text-sm text-ink">
            <Mountain className="h-4 w-4 text-stat-AG" />
            <span className="font-display">Your Agility ({ag})</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-sm text-ink-muted">
            <span>Move range</span>
            <span className="font-display font-bold text-stat-AG">{moveTiles} tiles / turn</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm text-ink-muted">
            <span>Climb height</span>
            <span className="font-display font-bold text-stat-AG">{climb} levels / step</span>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <Zap className="h-4 w-4 text-stat-AG" /> Cost: {TACTICS_ENERGY_COST} energy
          </span>
          <span className="text-sm text-ink-muted">You have {energy} ⚡</span>
        </div>

        <div className="rounded-md border border-gold-deep/30 bg-parchment-300/40 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-display text-ink">Highest tier won</span>
            <span className="font-display font-bold text-gold-deep">
              {deepestTacticsTier > 0 ? `Tier ${deepestTacticsTier}` : '—'}
            </span>
          </div>
        </div>

        <Button onClick={() => { void sfxResume(); beginTactics(); }} disabled={!canEnter} className="w-full py-2.5">
          {!unlocked
            ? `Unlocks at Level ${TACTICS_UNLOCK_LEVEL}`
            : canEnter
              ? 'Begin the Skirmish'
              : `Need ${TACTICS_ENERGY_COST} energy (complete habits)`}
        </Button>
        {!unlocked && (
          <p className="text-center text-xs text-ink-muted">
            Train your habits to reach Level {TACTICS_UNLOCK_LEVEL} — you'll level up automatically.
          </p>
        )}
      </Panel>
    </div>
  );
}
