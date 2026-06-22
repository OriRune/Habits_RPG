import { useState } from 'react';
import { Swords, Zap } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { ARENA_ENERGY_COST, ARENA_UNLOCK_LEVEL } from '@/engine/arena';
import { AdventureRitualModal } from '@/components/minigame/AdventureRitualModal';
import { bossForLevel } from '@/engine/bosses';
import { MAX_LEVEL } from '@/engine/progression';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';

/** Entrance screen for the Arena (the live fight renders in ArenaOverlay). */
const SPEED_LABEL: Record<string, string> = {
  auto: 'Auto (by level)',
  slow: 'Slow (easier)',
  normal: 'Normal',
  fast: 'Fast (harder)',
};

export function ArenaView() {
  const [showRitual, setShowRitual] = useState(false);
  const energy = useGameStore((s) => s.character.energy);
  const level = useGameStore((s) => s.character.level);
  const deepestArenaTier = useGameStore((s) => s.deepestArenaTier);
  const arenaSpeed = useGameStore((s) => s.settings.arenaSpeed);
  const beginArena = useGameStore((s) => s.beginArena);
  const showAdventureRitual = useGameStore((s) => s.settings.showAdventureRitual);

  const unlocked = level >= ARENA_UNLOCK_LEVEL;
  const canEnter = unlocked && energy >= ARENA_ENERGY_COST;
  const tier = Math.max(ARENA_UNLOCK_LEVEL, Math.min(MAX_LEVEL, level));
  const boss = bossForLevel(tier);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <SectionTitle tone="wood">The Arena</SectionTitle>
      <Panel tone="parchment" className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-md texture-wood border border-gold-deep/60 text-ember-bright">
            <Swords className="h-6 w-6" />
          </span>
          <div>
            <div className="font-display text-base font-bold text-ink">Real-Time Boss Duel</div>
            <div className="text-sm text-ink-muted">Your stats, weapon, spells &amp; potions — live on a hex floor.</div>
          </div>
        </div>

        <p className="text-sm text-ink-muted">
          Face a boss on an open hex arena. <span className="text-ink">Strike up close, loose bolts from range,
          and weave in spells</span> — every blow the boss throws lights up the tiles it will hit, so
          <span className="text-ink"> step off the danger in time</span>. Win for the full bounty; fall and you
          carry out only half of what you wore down.
        </p>

        <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
          <div className="flex items-center justify-between">
            <span className="font-display text-sm text-ink">Challenger</span>
            <span className="font-display font-bold text-ember-deep">{boss.name}</span>
          </div>
          <div className="mt-1 text-[11px] italic text-ink-muted">{boss.flavor}</div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <Zap className="h-4 w-4 text-stat-AG" /> Cost: {ARENA_ENERGY_COST} energy
          </span>
          <span className="text-sm text-ink-muted">You have {energy} ⚡</span>
        </div>

        <div className="rounded-md border border-gold-deep/30 bg-parchment-300/40 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-display text-ink">Highest tier bested</span>
            <span className="font-display font-bold text-gold-deep">
              {deepestArenaTier > 0 ? `Tier ${deepestArenaTier}` : '—'}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="font-display text-ink">Speed</span>
            <span className="font-display text-xs font-bold text-gold-deep">
              {SPEED_LABEL[arenaSpeed] ?? arenaSpeed}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-ink-muted">Adjust pace in Settings → General.</div>
        </div>

        <Button
          onClick={() => canEnter && showAdventureRitual ? setShowRitual(true) : beginArena()}
          disabled={!canEnter}
          className="w-full py-2.5"
        >
          {!unlocked
            ? `Unlocks at Level ${ARENA_UNLOCK_LEVEL}`
            : canEnter
              ? 'Enter the Arena'
              : `Need ${ARENA_ENERGY_COST} energy (complete habits)`}
        </Button>
        {showRitual && (
          <AdventureRitualModal
            energyCost={ARENA_ENERGY_COST}
            onConfirm={() => { setShowRitual(false); beginArena(); }}
            onCancel={() => setShowRitual(false)}
          />
        )}
        {!unlocked && (
          <p className="text-center text-xs text-ink-muted">
            Train your habits to reach Level {ARENA_UNLOCK_LEVEL} — you'll level up automatically.
          </p>
        )}
      </Panel>
    </div>
  );
}
