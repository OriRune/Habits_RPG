import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Heart, Sparkles, Coins, Zap, Wind, ChevronsDown, DoorOpen } from 'lucide-react';
import { AdventureRitualModal } from '@/components/minigame/AdventureRitualModal';
import { useGameStore } from '@/store/useGameStore';
import { ROOM_META, DUNGEON_ENERGY_COST } from '@/engine/dungeon';
import { getBiome } from '@/engine/biomes';
import { getEncounter, checkChance, choiceAvailable, encounterDepthTier } from '@/engine/encounters';
import { runStatBonuses } from '@/store/shared';
import { getRelic } from '@/engine/relics';
import { type Reward } from '@/engine/challenges';
import { getMaterial } from '@/engine/materials';
import { getItem } from '@/engine/items';
import { getWeapon } from '@/engine/weapons';
import { getGear } from '@/engine/gear';
import { getStat } from '@/engine/stats';
import { DUNGEON_UNLOCK_LEVEL } from '@/engine/progression';
import { materialCrest } from '@/lib/sprites';
import { cn } from '@/lib/cn';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';
import { SectionTitle } from '@/components/ui/Divider';
import { SceneArt } from '@/components/ui/SceneArt';
import { BattleScene } from '@/components/combat/BattleScene';
import { StreakBonusChip } from '@/components/character/StreakBonusChip';
import { RelicTray } from '@/components/dungeon/RelicTray';
import { RunBuffs } from '@/components/dungeon/RunBuffs';
import { FloorMap } from '@/components/dungeon/FloorMap';
import { ShrineRoom } from '@/components/dungeon/ShrineRoom';
import { MerchantRoom } from '@/components/dungeon/MerchantRoom';
import { RestRoom } from '@/components/dungeon/RestRoom';
import { useDungeonAudio } from '@/hooks/useDungeonAudio';

/** What the next depth milestone unlocks (gates mirror engine/dungeonMap weights). */
function milestoneHint(deepest: number): string {
  if (deepest < 5) return 'Reach Floor 5 to unlock Merchants.';
  if (deepest < 8) return 'Reach Floor 8 to unlock Elite foes.';
  if (deepest < 10) return 'Reach Floor 10 to unlock rare (Tier 3) relics.';
  return 'All depths unlocked — chase a new record.';
}

function RunGauge({
  icon,
  value,
  max,
  fill,
}: {
  icon: React.ReactNode;
  value: number;
  max: number;
  fill: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div className="h-3 flex-1 overflow-hidden rounded-full border border-gold-deep/50 bg-wood-900">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: fill }} />
      </div>
      <span className="font-display text-xs tabular-nums text-parchment-300">
        {value}/{max}
      </span>
    </div>
  );
}

function rewardIsEmpty(reward: Reward): boolean {
  const mats = Object.values(reward.materials ?? {}).filter((n) => n > 0);
  return !reward.gold && mats.length === 0 && (reward.items ?? []).length === 0 && (reward.weapons ?? []).length === 0 && (reward.gear ?? []).length === 0;
}

function RewardLine({ reward, empty = 'No spoils.' }: { reward: Reward; empty?: string }) {
  if (rewardIsEmpty(reward)) return <span className="text-ink-light">{empty}</span>;
  const mats = Object.entries(reward.materials ?? {}).filter(([, n]) => n > 0);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink">
      {reward.gold ? (
        <span className="flex items-center gap-1 text-gold-deep">
          <Coins className="h-4 w-4" /> {reward.gold}
        </span>
      ) : null}
      {mats.map(([key, n]) => (
        <span key={key} className="flex items-center gap-1.5">
          <Sprite spriteKey={`material:${key}`} look={materialCrest(key)} size="sm" />
          {getMaterial(key)?.name ?? key} ×{n}
        </span>
      ))}
      {(reward.items ?? []).map((key, i) => (
        <span key={`i-${key}-${i}`} className="text-ink-muted">
          {getItem(key)?.name ?? key}
        </span>
      ))}
      {(reward.weapons ?? []).map((key, i) => (
        <span key={`w-${key}-${i}`} className="text-ink-muted">
          ⚔ {getWeapon(key).name}
        </span>
      ))}
      {(reward.gear ?? []).map((key, i) => (
        <span key={`g-${key}-${i}`} className="text-ink-muted">
          🛡 {getGear(key)?.name ?? key}
        </span>
      ))}
    </div>
  );
}

export function DungeonView() {
  const [showRitual, setShowRitual] = useState(false);
  const dungeon = useGameStore((s) => s.dungeon);
  const soundEnabled = useGameStore((s) => s.settings.soundEnabled);
  useDungeonAudio(dungeon ?? null, soundEnabled);
  const energy = useGameStore((s) => s.character.energy);
  const level = useGameStore((s) => s.character.level);
  const habitBonus = useGameStore((s) => s.character.habitBonus);
  const deepestFloor = useGameStore((s) => s.deepestFloor);
  const showAdventureRitual = useGameStore((s) => s.settings.showAdventureRitual);
  const dungeonHistory = useGameStore((s) => s.dungeonHistory ?? []);
  const startDungeon = useGameStore((s) => s.startDungeon);
  const dungeonChoosePath = useGameStore((s) => s.dungeonChoosePath);
  const dungeonEncounterChoose = useGameStore((s) => s.dungeonEncounterChoose);
  const dungeonBattleAction = useGameStore((s) => s.dungeonBattleAction);
  const dungeonAdvance = useGameStore((s) => s.dungeonAdvance);
  const dungeonBank = useGameStore((s) => s.dungeonBank);
  const dungeonDescend = useGameStore((s) => s.dungeonDescend);
  const collectDungeon = useGameStore((s) => s.collectDungeon);

  // --- Entrance (no active run) ---
  if (!dungeon) {
    const unlocked = level >= DUNGEON_UNLOCK_LEVEL;
    const canEnter = unlocked && energy >= DUNGEON_ENERGY_COST;
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <SectionTitle tone="wood">Dungeon Expeditions</SectionTitle>
        <Panel tone="parchment" className="space-y-4 p-5">
          <SceneArt sceneKey="dungeon:entrance" size="lg" />
          <div>
            <div className="font-display text-base font-bold text-ink">Endless Descent</div>
            <div className="text-sm text-ink-muted">
              Descend through floors of foes, branching encounters, and treasure. Clear a floor to
              reach a checkpoint, then choose: <span className="text-ink">Bank &amp; Leave</span> with your
              spoils, or <span className="text-ink">Descend Deeper</span> for richer loot and tougher danger.
              Every fifth floor, a boss guards the way to a new region.{' '}
              <span className="text-ink">Fleeing combat</span> ends the run but keeps everything you
              gathered. <span className="text-ember">Dying mid-floor</span> costs 75% of that floor's
              gold and all its items — so know when to retreat.
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
            <span className="flex items-center gap-1.5 text-sm text-ink">
              <Zap className="h-4 w-4 text-stat-AG" /> Cost: {DUNGEON_ENERGY_COST} energy
            </span>
            <span className="text-sm text-ink-muted">You have {energy} ⚡</span>
          </div>

          <div className="rounded-md border border-gold-deep/30 bg-parchment-300/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-display text-ink">Deepest descent</span>
              <span className="font-display font-bold text-gold-deep">
                {deepestFloor > 0 ? `Floor ${deepestFloor}` : '—'}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-ink-muted">{milestoneHint(deepestFloor)}</div>
          </div>

          {dungeonHistory.length > 0 && (
            <div className="rounded-md border border-gold-deep/20 bg-parchment-100/50 p-3">
              <div className="mb-2 font-display text-xs uppercase tracking-wider text-ink-muted">Recent Runs</div>
              <div className="space-y-1">
                {dungeonHistory.slice(0, 5).map((run, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className={run.cleared ? 'text-stat-HP' : run.defeated ? 'text-ember' : 'text-ink-muted'}>
                      {run.cleared ? 'Banked' : run.defeated ? 'Fallen' : 'Fled'}
                    </span>
                    <span className="text-ink">Floor {run.depth}</span>
                    <span className="text-ink-light">{run.date}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button
            onClick={() => canEnter && showAdventureRitual ? setShowRitual(true) : startDungeon()}
            disabled={!canEnter}
            className="w-full py-2.5"
          >
            {!unlocked
              ? `Unlocks at Level ${DUNGEON_UNLOCK_LEVEL}`
              : canEnter
                ? 'Enter the Dungeon'
                : `Need ${DUNGEON_ENERGY_COST} energy (complete habits)`}
          </Button>
          {showRitual && (
            <AdventureRitualModal
              energyCost={DUNGEON_ENERGY_COST}
              onConfirm={() => { setShowRitual(false); startDungeon(); }}
              onCancel={() => setShowRitual(false)}
            />
          )}
          {!unlocked && (
            <p className="text-center text-xs text-ink-muted">
              Train your habits to reach Level {DUNGEON_UNLOCK_LEVEL} — you'll level up automatically.
            </p>
          )}
        </Panel>
      </div>
    );
  }

  const biome = getBiome(dungeon.biomeKey);

  // --- Run summary (ended) --- (checked before dereferencing the current room).
  if (dungeon.status === 'ended') {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <SectionTitle tone="wood">{dungeon.cleared ? 'Spoils Banked!' : 'You Fall...'}</SectionTitle>
        <Panel tone="parchment" className="space-y-4 p-5">
          <SceneArt sceneKey={dungeon.cleared ? 'dungeon:cleared' : 'dungeon:retreat'} size="lg" />
          <p className="text-sm text-ink-muted">
            {dungeon.cleared
              ? `You climb out at depth ${dungeon.depth}, laden with everything you banked.`
              : dungeon.hp > 0
                ? `You retreat from depth ${dungeon.depth} with all your gathered spoils intact.`
                : `You fall at depth ${dungeon.depth}. Your banked spoils are safe, but 75% of that floor's gold is lost and all its items are left behind.`}
          </p>
          {/* Per-run stat highlights */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-gold-deep/30 bg-wood-900/40 px-3 py-2.5 text-xs">
            <span className="flex items-center gap-1.5 text-ink-muted">
              <DoorOpen className="h-3.5 w-3.5 shrink-0" />
              Rooms
              <span className="ml-auto font-display font-bold tabular-nums text-ink">
                {dungeon.roomsCleared ?? 0}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-ink-muted">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              Relics
              <span className="ml-auto font-display font-bold tabular-nums text-ink">
                {dungeon.relics.length}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-ink-muted">
              <Zap className="h-3.5 w-3.5 shrink-0" />
              Damage dealt
              <span className="ml-auto font-display font-bold tabular-nums text-ink">
                {dungeon.damageDealt ?? 0}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-ink-muted">
              <Heart className="h-3.5 w-3.5 shrink-0" />
              Damage taken
              <span className="ml-auto font-display font-bold tabular-nums text-ink">
                {dungeon.damageTaken ?? 0}
              </span>
            </span>
          </div>
          <div>
            <div className="mb-1 font-display text-xs uppercase tracking-wider text-ink-muted">Spoils</div>
            <RewardLine reward={{ ...dungeon.bankedReward, gold: Math.round((dungeon.bankedReward.gold ?? 0) * habitBonus) }} />
            <StreakBonusChip className="mt-1.5 text-xs text-amber-600" />
          </div>
          <Button onClick={collectDungeon} className="w-full py-2.5">
            Collect &amp; Leave
          </Button>
        </Panel>
      </div>
    );
  }

  // --- Checkpoint (between floors): bank or descend ---
  if (dungeon.atCheckpoint) {
    const nextDepth = dungeon.depth + 1;
    const nextIsBoss = nextDepth % 5 === 0;
    return (
      <div
        className="mx-auto max-w-2xl space-y-4 px-4 py-5"
        style={{ '--biome-tint': biome.tint } as CSSProperties}
      >
        <SectionTitle tone="wood">Depth {dungeon.depth} · {biome.name}</SectionTitle>
        <Panel tone="parchment" className="space-y-4 p-5">
          <SceneArt sceneKey="dungeon:checkpoint" size="lg" caption="Floor cleared" />
          <div>
            <div className="font-display text-base font-bold text-ink">Checkpoint</div>
            <div className="text-sm text-ink-muted">
              Your spoils so far are safe. Mana and stamina return — but your wounds carry into the
              dark. Heal up, or press on for a boon{nextIsBoss ? ' before the boss' : ''}.
            </div>
          </div>

          <Panel tone="wood" className="space-y-2 p-3">
            <RunGauge icon={<Heart className="h-4 w-4 text-stat-HP" />} value={dungeon.hp} max={dungeon.maxHp} fill="#2e8a5e" />
            <RelicTray relics={dungeon.relics} />
            <RunBuffs relics={dungeon.relics} />
          </Panel>

          <div>
            <div className="mb-1 font-display text-xs uppercase tracking-wider text-ink-muted">Banked (safe)</div>
            <RewardLine reward={dungeon.bankedReward} empty="Nothing banked yet." />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="secondary" onClick={() => dungeonDescend('rest')} className="flex items-center justify-center gap-1.5 py-2.5">
              <Heart className="h-4 w-4" /> Rest (+{Math.round(dungeon.maxHp * 0.4)} HP)
            </Button>
            <Button onClick={() => dungeonDescend('pressOn')} className="flex items-center justify-center gap-1.5 py-2.5">
              <ChevronsDown className="h-4 w-4" /> Press On{nextIsBoss ? ' (Boss!)' : ''} — take a boon
            </Button>
          </div>
          <Button variant="secondary" onClick={dungeonBank} className="flex w-full items-center justify-center gap-1.5 py-2">
            <DoorOpen className="h-4 w-4" /> Bank &amp; Leave
          </Button>
          <p className="text-center text-[11px] text-ink-light">
            Dying on the next floor forfeits 75% of its gold and all its items — fleeing always keeps everything. What's banked here is always safe.
          </p>
        </Panel>
      </div>
    );
  }

  const room = dungeon.nodeId ? dungeon.map.nodes[dungeon.nodeId]?.room ?? null : null;
  const choosingPath = room === null;
  const inBattle = room?.type === 'combat' || room?.type === 'boss' || room?.type === 'elite';

  return (
    <div
      className="mx-auto max-w-2xl space-y-4 px-4 py-5"
      style={{ '--biome-tint': biome.tint } as CSSProperties}
    >
      <div className="flex items-center justify-between gap-2">
        <SectionTitle tone="wood" className="flex-1">
          Depth {dungeon.depth} · {biome.name}
        </SectionTitle>
        <span className="shrink-0 font-display text-xs text-parchment-300">
          {dungeon.path.length} room{dungeon.path.length === 1 ? '' : 's'} cleared
        </span>
      </div>

      {!inBattle && (
        <Panel tone="wood" className="space-y-2 p-3">
          <RunGauge icon={<Heart className="h-4 w-4 text-stat-HP" />} value={dungeon.hp} max={dungeon.maxHp} fill="#2e8a5e" />
          <RunGauge icon={<Sparkles className="h-4 w-4 text-stat-KN" />} value={dungeon.mp} max={dungeon.maxMp} fill="#3b82f6" />
          <RunGauge icon={<Wind className="h-4 w-4 text-stat-EN" />} value={dungeon.sta} max={dungeon.maxSta} fill="#c98a3a" />
          <div className="flex items-center justify-between border-t border-gold-deep/20 pt-1.5 text-[11px] text-parchment-300">
            <span>Banked: <RewardInline reward={dungeon.bankedReward} /></span>
            <span>This floor: <RewardInline reward={dungeon.floorReward} /></span>
          </div>
          <RelicTray relics={dungeon.relics} />
          <RunBuffs relics={dungeon.relics} />
        </Panel>
      )}

      {/* key on nodeId so every room entry triggers the fade-in animation */}
      <div key={dungeon.nodeId ?? 'path'} className="animate-fade-in">
      {choosingPath ? (
        <FloorMap map={dungeon.map} choices={dungeon.choices} path={dungeon.path} depth={dungeon.depth} onChoose={dungeonChoosePath} />
      ) : inBattle ? (
        <Panel tone="wood" className="p-4">
          {room!.type === 'boss' && dungeon.battle && dungeon.battle.phases.length > 1 && (
            <PhasePips count={dungeon.battle.phases.length} index={dungeon.battle.phaseIndex} />
          )}
          {dungeon.battle && (
            <BattleScene
              battle={dungeon.battle}
              biomeKey={dungeon.biomeKey}
              onAction={dungeonBattleAction}
              onResolve={dungeonAdvance}
              resolveWonLabel={room!.type === 'boss' ? 'Onward →' : 'Continue Deeper →'}
              resolveLostLabel="You fall — gather your spoils"
              resolveFledLabel="Retreat from the dungeon"
              allowFlee
              foeSize={room!.type === 'boss' ? 'xl' : 'lg'}
            />
          )}
        </Panel>
      ) : room!.type === 'treasure' ? (
        <Panel tone="parchment" className="space-y-3 p-5">
          <SceneArt sceneKey="room:treasure" />
          <div>
            <div className="font-display text-base font-bold text-ink">{ROOM_META.treasure.name}</div>
            <div className="text-sm text-ink-muted">{ROOM_META.treasure.description}</div>
          </div>
          {dungeon.roomLoot && (
            <div className="rounded-md border border-gold-deep/40 bg-parchment-300/50 p-3 text-sm">
              <div className="mb-1 text-ink">You claim:</div>
              <RewardLine reward={dungeon.roomLoot} />
            </div>
          )}
          <Button onClick={dungeonAdvance} className="w-full py-2.5">
            Continue Deeper →
          </Button>
        </Panel>
      ) : room!.type === 'shrine' ? (
        <ShrineRoom />
      ) : room!.type === 'merchant' ? (
        <MerchantRoom />
      ) : room!.type === 'rest' ? (
        <RestRoom />
      ) : (
        <EncounterRoom
          dungeon={dungeon}
          onChoose={dungeonEncounterChoose}
          onAdvance={dungeonAdvance}
        />
      )}
      </div>
    </div>
  );
}

function RewardInline({ reward }: { reward: Reward }) {
  if (rewardIsEmpty(reward)) return <span className="text-parchment-300/60">—</span>;
  const matCount = Object.values(reward.materials ?? {}).reduce((a, b) => a + b, 0);
  const parts: string[] = [];
  if (reward.gold) parts.push(`${reward.gold}g`);
  if (matCount) parts.push(`${matCount} mat`);
  const drops = (reward.items?.length ?? 0) + (reward.weapons?.length ?? 0) + (reward.gear?.length ?? 0);
  if (drops) parts.push(`${drops} relic${drops > 1 ? 's' : ''}`);
  return <span className="text-gold-bright">{parts.join(' · ')}</span>;
}

function PhasePips({ count, index }: { count: number; index: number }) {
  return (
    <div className="mb-3 flex items-center justify-center gap-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'h-2.5 w-2.5 rounded-full border',
            i < index ? 'border-ember/50 bg-ember/30' : i === index ? 'border-ember bg-ember' : 'border-parchment-300/40 bg-transparent',
          )}
          title={`Phase ${i + 1} of ${count}`}
        />
      ))}
    </div>
  );
}

type DungeonRunView = NonNullable<ReturnType<typeof useGameStore.getState>['dungeon']>;

function EncounterRoom({
  dungeon,
  onChoose,
  onAdvance,
}: {
  dungeon: DungeonRunView;
  onChoose: (i: number) => void;
  onAdvance: () => void;
}) {
  const statLevels = useGameStore((s) => s.character.statLevels);
  // MINI-27: the odds preview must count relics/runBuff the same as the resolver does, or the
  // displayed % lies. Read the merged run bonuses imperatively (a fresh object from a plain
  // selector would loop under useSyncExternalStore); the parent re-renders us on every run change.
  const runBonus = runStatBonuses(useGameStore.getState());

  // Gate context for choice availability checks.
  const gateCtx = { hp: dungeon.hp, mp: dungeon.mp, sta: dungeon.sta, depth: dungeon.depth, relics: dungeon.relics };

  const room = dungeon.nodeId ? dungeon.map.nodes[dungeon.nodeId]?.room : undefined;
  const enc = dungeon.encounter;
  const def = room?.type === 'encounter' ? getEncounter(room.key) : undefined;
  if (!def || !enc) {
    // Fallback (missing content) — let the player move on rather than soft-lock.
    return (
      <Panel tone="parchment" className="space-y-3 p-5">
        <div className="text-sm text-ink-muted">The passage is quiet.</div>
        <Button onClick={onAdvance} className="w-full py-2.5">Continue Deeper →</Button>
      </Panel>
    );
  }
  const node = def.nodes[enc.nodeId];
  if (!node) {
    return (
      <Panel tone="parchment" className="space-y-3 p-5">
        <div className="text-sm text-ink-muted">The passage is quiet.</div>
        <Button onClick={onAdvance} className="w-full py-2.5">Continue Deeper →</Button>
      </Panel>
    );
  }

  // Map encounter outcome → scene key for the banner art
  const outcomeSceneKey =
    enc.lastOutcome === 'success' ? 'outcome:success' :
    enc.lastOutcome === 'fail'    ? 'outcome:fail'    :
    enc.lastOutcome === 'neutral' ? 'outcome:partial'  :
    null;

  return (
    <Panel tone="parchment" className="space-y-3 p-5">
      <SceneArt
        sceneKey={outcomeSceneKey ?? 'room:encounter'}
        caption={outcomeSceneKey ? undefined : def.title}
      />

      {/* Outcome of the last choice — shown before the next prompt so it reads naturally */}
      {enc.lastText && (
        <div
          className={cn(
            'rounded-md border p-2.5',
            enc.lastOutcome === 'fail'
              ? 'border-ember/40 bg-ember/5'
              : enc.lastOutcome === 'success'
                ? 'border-gold-deep/40 bg-parchment-300/50'
                : 'border-gold-deep/20 bg-parchment-100/60',
          )}
        >
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <span className="font-display text-[10px] uppercase tracking-wider text-ink-muted">
              {enc.lastOutcome === 'fail' ? 'Outcome — failure' : enc.lastOutcome === 'success' ? 'Outcome — success' : 'Outcome'}
            </span>
            {enc.lastDeltas && (
              <span className="flex items-center gap-1.5 text-[11px]">
                {enc.lastDeltas.hp !== 0 && (
                  <span className={enc.lastDeltas.hp > 0 ? 'text-stat-HP' : 'text-ember'}>
                    {enc.lastDeltas.hp > 0 ? '+' : ''}{enc.lastDeltas.hp} HP
                  </span>
                )}
                {enc.lastDeltas.mp !== 0 && (
                  <span className={enc.lastDeltas.mp > 0 ? 'text-stat-KN' : 'text-ember'}>
                    {enc.lastDeltas.mp > 0 ? '+' : ''}{enc.lastDeltas.mp} MP
                  </span>
                )}
                {enc.lastDeltas.sta !== 0 && (
                  <span className={enc.lastDeltas.sta > 0 ? 'text-stat-EN' : 'text-ember'}>
                    {enc.lastDeltas.sta > 0 ? '+' : ''}{enc.lastDeltas.sta} STA
                  </span>
                )}
              </span>
            )}
          </div>
          <p className="text-sm text-ink">{enc.lastText}</p>
        </div>
      )}

      {/* Next narrative node */}
      <div>
        <div className="font-display text-base font-bold text-ink">{def.title}</div>
        <p className="mt-1 text-sm text-ink-muted">{node.text}</p>
      </div>

      {enc.done ? (
        <Button onClick={onAdvance} className="w-full py-2.5">
          Continue Deeper →
        </Button>
      ) : (
        <div className="space-y-2">
          {(node.choices ?? []).map((choice, i) => {
            const lvl = choice.stat ? statLevels[choice.stat] : null;
            const power = choice.stat ? lvl! + (runBonus[choice.stat] ?? 0) : 0;
            const odds = choice.stat
              ? Math.round(checkChance(power, (choice.difficulty ?? 5) + encounterDepthTier(dungeon.depth)) * 100)
              : null;
            const available = choiceAvailable(choice, gateCtx);

            // Build a short unavailability hint for locked choices.
            let lockHint: string | null = null;
            if (!available && choice.requires) {
              const r = choice.requires;
              if (r.minHp    !== undefined) lockHint = `Need ${r.minHp} HP`;
              else if (r.minMp  !== undefined) lockHint = `Need ${r.minMp} MP`;
              else if (r.minSta !== undefined) lockHint = `Need ${r.minSta} Stamina`;
              else if (r.minDepth !== undefined) lockHint = `Floor ${r.minDepth}+ only`;
              else if (r.hasRelic !== undefined) lockHint = `Requires: ${getRelic(r.hasRelic)?.name ?? r.hasRelic}`;
            }

            // Build outcome tags (boon/curse indicators).
            const boonTier = choice.boon ?? null;
            const boonSuccessTier = choice.boonOnSuccess ?? null;
            const hasCurseRisk = choice.curseOnFail ?? false;

            return (
              <Button
                key={i}
                variant="secondary"
                onClick={() => available ? onChoose(i) : undefined}
                disabled={!available}
                className="flex w-full flex-col items-stretch gap-1 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>{choice.label}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {boonTier && (
                      <span className="rounded border border-gold-deep/50 bg-parchment-300/30 px-1.5 py-0.5 text-[10px] text-gold-deep">
                        ✦ Boon
                      </span>
                    )}
                    {boonSuccessTier && (
                      <span className="rounded border border-gold-deep/50 bg-parchment-300/30 px-1.5 py-0.5 text-[10px] text-gold-deep">
                        ✦ Boon on success
                      </span>
                    )}
                    {hasCurseRisk && (
                      <span className="rounded border border-ember/40 bg-ember/5 px-1.5 py-0.5 text-[10px] text-ember">
                        ⚠ Curse on fail
                      </span>
                    )}
                    {choice.stat && (
                      <span
                        className="rounded border border-gold-deep/40 bg-parchment-300/40 px-1.5 py-0.5 text-[11px] tabular-nums text-ink-muted"
                        title={`Your ${getStat(choice.stat).name} is ${lvl}${
                          runBonus[choice.stat] ? ` (+${runBonus[choice.stat]} gear/relics)` : ''
                        } vs difficulty ${(choice.difficulty ?? 5) + encounterDepthTier(dungeon.depth)}`}
                      >
                        {getStat(choice.stat).short} {lvl} · ~{odds}%
                      </span>
                    )}
                    {!available && lockHint && (
                      <span className="rounded border border-parchment-300/30 bg-parchment-100/20 px-1.5 py-0.5 text-[10px] text-ink-light">
                        🔒 {lockHint}
                      </span>
                    )}
                  </div>
                </div>
              </Button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
