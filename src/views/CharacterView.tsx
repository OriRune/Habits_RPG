import { useGameStore } from '@/store/useGameStore';
import { selectNextStatGains } from '@/store/selectors';
import { STATS } from '@/engine/stats';
import { CLASS_CHART, ADVANCED_CLASSES } from '@/engine/classes';
import { classCrest } from '@/lib/sprites';
import { StatBar } from '@/components/character/StatBar';
import { HeroBanner } from '@/components/character/HeroBanner';
import { LoadoutPanel } from '@/components/character/LoadoutPanel';
import { WeaponsSection } from '@/components/character/WeaponsSection';
import { ItemsSection } from '@/components/character/ItemsSection';
import { GearSection } from '@/components/inventory/GearSection';
import { Panel } from '@/components/ui/Panel';
import { Sprite } from '@/components/ui/Sprite';
import { SectionTitle } from '@/components/ui/Divider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Trophy, TrendingUp } from 'lucide-react';

// All discoverable classes (unique names from the chart) for the Codex.
const ALL_CLASSES = Array.from(
  new Set(Object.values(CLASS_CHART).flatMap((row) => Object.values(row))),
).sort();

export function CharacterView() {
  const character = useGameStore((s) => s.character);
  const nextGains = useGameStore(selectNextStatGains);
  const codex = useGameStore((s) => s.codex);
  const deepestFloor = useGameStore((s) => s.deepestFloor);
  const deepestMineFloor = useGameStore((s) => s.deepestMineFloor);
  const bestMineScore = useGameStore((s) => s.bestMineScore);
  const deepestForestStage = useGameStore((s) => s.deepestForestStage);
  const bestForestScore = useGameStore((s) => s.bestForestScore);
  const deepestArenaTier = useGameStore((s) => s.deepestArenaTier);
  const deepestTacticsTier = useGameStore((s) => s.deepestTacticsTier);

  const hasAnyRecord = deepestFloor > 0 || deepestMineFloor > 0 || deepestForestStage > 0 || deepestArenaTier > 0 || deepestTacticsTier > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <HeroBanner />

      <LoadoutPanel />

      {/* Armory — weapons, gear, and items (below paper doll, above attributes) */}
      <WeaponsSection />
      <GearSection />
      <ItemsSection />

      {/* Attributes */}
      <Panel tone="parchment" className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <SectionTitle className="flex-1">Hero Stats</SectionTitle>
          <TrendingUp className="h-4 w-4 text-gold-deep" />
        </div>

        {/* Training XP explanation */}
        <div className="mb-3 rounded-md border border-gold-deep/30 bg-wood-800/30 px-3 py-2 text-[11px] text-ink-muted space-y-0.5">
          <p>
            <span className="font-semibold text-ink-light">Habits</span> grant{' '}
            <span className="font-semibold text-gold-bright">Training XP</span> — the <span className="italic">xp</span> shown on each row.
          </p>
          <p>
            Training XP drives your{' '}
            <span className="font-semibold text-ink-light">Hero Level</span>. When you level up,{' '}
            <span className="font-semibold text-gold-bright">Hero Stats</span> (the <span className="italic">Lv</span> values) increase based on which habits you trained most.
          </p>
          {Object.values(nextGains).some((v) => v > 0) && (
            <p className="text-gold-deep font-semibold">
              ↑ Your next level-up will raise the stats marked in gold.
            </p>
          )}
        </div>

        <div className="space-y-2.5">
          {STATS.map((s) => (
            <StatBar
              key={s.id}
              stat={s.id}
              level={character.statLevels[s.id]}
              xp={character.statXp[s.id]}
              nextGain={nextGains[s.id]}
              hint={s.id === 'AG' ? 'Sets move range & climb height in Hex Tactics' : undefined}
            />
          ))}
        </div>
      </Panel>

      {/* Minigame Records */}
      {!hasAnyRecord ? (
        <Panel tone="parchment" className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-gold-deep/50" />
            <SectionTitle className="flex-1">Records</SectionTitle>
          </div>
          <EmptyState message="Explore a dungeon or minigame to set your first record." />
        </Panel>
      ) : (
        <Panel tone="parchment" className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-gold-deep" />
            <SectionTitle className="flex-1">Records</SectionTitle>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {deepestFloor > 0 && (
              <>
                <span className="text-ink-muted">Dungeon Delve</span>
                <span className="text-right font-display font-bold text-ink">Floor {deepestFloor}</span>
              </>
            )}
            {deepestMineFloor > 0 && (
              <>
                <span className="text-ink-muted">Deep Mine</span>
                <span className="text-right font-display font-bold text-ink">
                  Floor {deepestMineFloor}
                  {bestMineScore > 0 && <span className="ml-1.5 font-normal text-ink-muted text-xs">({bestMineScore.toLocaleString()} pts)</span>}
                </span>
              </>
            )}
            {deepestForestStage > 0 && (
              <>
                <span className="text-ink-muted">Wild Forest</span>
                <span className="text-right font-display font-bold text-ink">
                  Stage {deepestForestStage}
                  {bestForestScore > 0 && <span className="ml-1.5 font-normal text-ink-muted text-xs">({bestForestScore.toLocaleString()} pts)</span>}
                </span>
              </>
            )}
            {deepestArenaTier > 0 && (
              <>
                <span className="text-ink-muted">Arena</span>
                <span className="text-right font-display font-bold text-ink">Tier {deepestArenaTier}</span>
              </>
            )}
            {deepestTacticsTier > 0 && (
              <>
                <span className="text-ink-muted">Hex Tactics</span>
                <span className="text-right font-display font-bold text-ink">Tier {deepestTacticsTier}</span>
              </>
            )}
          </div>
        </Panel>
      )}

      {/* Class Codex */}
      <Panel tone="parchment" className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle className="flex-1">Class Codex</SectionTitle>
          <span className="ml-3 shrink-0 font-display text-xs text-ink-muted">
            {codex.length} / {ALL_CLASSES.length}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {ALL_CLASSES.map((name) => {
            const found = codex.includes(name);
            const adv = ADVANCED_CLASSES[name];
            return (
              <div key={name} className="flex flex-col items-center gap-1.5 text-center">
                <Sprite spriteKey={`class:${name}`} look={classCrest(name)} size="md" shrouded={!found} label={found ? name : undefined} />
                <div className={`text-xs font-semibold ${found ? 'text-ink' : 'text-ink-light'}`}>
                  {found ? name : '???'}
                </div>
                {found && adv && <div className="text-[10px] text-gold-deep">→ {adv}</div>}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
