import { Heart, Sparkles, Coins, Zap, Wind, ChevronsDown, DoorOpen } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { ROOM_META, DUNGEON_ENERGY_COST } from '@/engine/dungeon';
import { getBiome } from '@/engine/biomes';
import { getEncounter } from '@/engine/encounters';
import { type Reward } from '@/engine/challenges';
import { getMaterial } from '@/engine/materials';
import { getItem } from '@/engine/items';
import { getWeapon } from '@/engine/weapons';
import { getGear } from '@/engine/gear';
import { materialCrest } from '@/lib/sprites';
import { cn } from '@/lib/cn';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';
import { SectionTitle } from '@/components/ui/Divider';
import { SceneArt } from '@/components/ui/SceneArt';
import { BattleScene } from '@/components/combat/BattleScene';

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
  const dungeon = useGameStore((s) => s.dungeon);
  const energy = useGameStore((s) => s.character.energy);
  const startDungeon = useGameStore((s) => s.startDungeon);
  const dungeonEncounterChoose = useGameStore((s) => s.dungeonEncounterChoose);
  const dungeonBattleAction = useGameStore((s) => s.dungeonBattleAction);
  const dungeonAdvance = useGameStore((s) => s.dungeonAdvance);
  const dungeonBank = useGameStore((s) => s.dungeonBank);
  const dungeonDescend = useGameStore((s) => s.dungeonDescend);
  const collectDungeon = useGameStore((s) => s.collectDungeon);

  // --- Entrance (no active run) ---
  if (!dungeon) {
    const canEnter = energy >= DUNGEON_ENERGY_COST;
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
              Every fifth floor, a boss guards the way to a new region. Fall mid-floor and you lose
              most of that floor's haul — so know when to walk away.
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
            <span className="flex items-center gap-1.5 text-sm text-ink">
              <Zap className="h-4 w-4 text-stat-AG" /> Cost: {DUNGEON_ENERGY_COST} energy
            </span>
            <span className="text-sm text-ink-muted">You have {energy} ⚡</span>
          </div>

          <Button onClick={startDungeon} disabled={!canEnter} className="w-full py-2.5">
            {canEnter ? 'Enter the Dungeon' : `Need ${DUNGEON_ENERGY_COST} energy (complete habits)`}
          </Button>
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
              : `You go down at depth ${dungeon.depth}. You keep what you banked at the last checkpoint and a fraction of this floor's haul.`}
          </p>
          <div>
            <div className="mb-1 font-display text-xs uppercase tracking-wider text-ink-muted">Spoils</div>
            <RewardLine reward={dungeon.bankedReward} />
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
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <SectionTitle tone="wood">Depth {dungeon.depth} · {biome.name}</SectionTitle>
        <Panel tone="parchment" className="space-y-4 p-5">
          <SceneArt sceneKey="dungeon:checkpoint" size="lg" caption="Floor cleared" />
          <div>
            <div className="font-display text-base font-bold text-ink">Checkpoint</div>
            <div className="text-sm text-ink-muted">
              You rest and recover fully. Your spoils so far are safe — bank them, or press your luck.
            </div>
          </div>

          <Panel tone="wood" className="space-y-2 p-3">
            <RunGauge icon={<Heart className="h-4 w-4 text-stat-HP" />} value={dungeon.hp} max={dungeon.maxHp} fill="#2e8a5e" />
            <RunGauge icon={<Sparkles className="h-4 w-4 text-stat-KN" />} value={dungeon.mp} max={dungeon.maxMp} fill="#3b82f6" />
            <RunGauge icon={<Wind className="h-4 w-4 text-stat-EN" />} value={dungeon.sta} max={dungeon.maxSta} fill="#c98a3a" />
          </Panel>

          <div>
            <div className="mb-1 font-display text-xs uppercase tracking-wider text-ink-muted">Banked (safe)</div>
            <RewardLine reward={dungeon.bankedReward} empty="Nothing banked yet." />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="secondary" onClick={dungeonBank} className="flex items-center justify-center gap-1.5 py-2.5">
              <DoorOpen className="h-4 w-4" /> Bank &amp; Leave
            </Button>
            <Button onClick={dungeonDescend} className="flex items-center justify-center gap-1.5 py-2.5">
              <ChevronsDown className="h-4 w-4" /> Descend{nextIsBoss ? ' (Boss!)' : ' Deeper'}
            </Button>
          </div>
          <p className="text-center text-[11px] text-ink-light">
            Falling on the next floor forfeits most of what you gather there — but not what's banked.
          </p>
        </Panel>
      </div>
    );
  }

  const room = dungeon.rooms[dungeon.index];
  const inBattle = room.type === 'combat' || room.type === 'boss';
  const inActiveCombat = inBattle && dungeon.battle?.status === 'active';

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle tone="wood" className="flex-1">
          Depth {dungeon.depth} · {biome.name}
        </SectionTitle>
        <span className="shrink-0 font-display text-xs text-parchment-300">
          Room {dungeon.index + 1}/{dungeon.rooms.length}
        </span>
      </div>

      {!inActiveCombat && (
        <Panel tone="wood" className="space-y-2 p-3">
          <RunGauge icon={<Heart className="h-4 w-4 text-stat-HP" />} value={dungeon.hp} max={dungeon.maxHp} fill="#2e8a5e" />
          <RunGauge icon={<Sparkles className="h-4 w-4 text-stat-KN" />} value={dungeon.mp} max={dungeon.maxMp} fill="#3b82f6" />
          <RunGauge icon={<Wind className="h-4 w-4 text-stat-EN" />} value={dungeon.sta} max={dungeon.maxSta} fill="#c98a3a" />
          <div className="flex items-center justify-between border-t border-gold-deep/20 pt-1.5 text-[11px] text-parchment-300">
            <span>Banked: <RewardInline reward={dungeon.bankedReward} /></span>
            <span>This floor: <RewardInline reward={dungeon.floorReward} /></span>
          </div>
        </Panel>
      )}

      {inBattle ? (
        <Panel tone="wood" className="p-4">
          {room.type === 'boss' && dungeon.battle && dungeon.battle.phases.length > 1 && (
            <PhasePips count={dungeon.battle.phases.length} index={dungeon.battle.phaseIndex} />
          )}
          {dungeon.battle && (
            <BattleScene
              battle={dungeon.battle}
              onAction={dungeonBattleAction}
              onResolve={dungeonAdvance}
              resolveWonLabel={room.type === 'boss' ? 'Onward →' : 'Continue Deeper →'}
              resolveLostLabel="You fall — gather your spoils"
              resolveFledLabel="Retreat from the dungeon"
              allowFlee
            />
          )}
        </Panel>
      ) : room.type === 'treasure' ? (
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
      ) : (
        <EncounterRoom
          dungeon={dungeon}
          onChoose={dungeonEncounterChoose}
          onAdvance={dungeonAdvance}
        />
      )}
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
  const room = dungeon.rooms[dungeon.index];
  const enc = dungeon.encounter;
  const def = room.type === 'encounter' ? getEncounter(room.key) : undefined;
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

  return (
    <Panel tone="parchment" className="space-y-3 p-5">
      <SceneArt sceneKey="room:encounter" caption={def.title} />
      <div>
        <div className="font-display text-base font-bold text-ink">{def.title}</div>
        <p className="mt-1 text-sm text-ink-muted">{node.text}</p>
      </div>

      {enc.lastText && (
        <div
          className={cn(
            'rounded-md border p-2.5 text-sm',
            enc.lastOutcome === 'fail'
              ? 'border-ember/40 bg-ember/5 text-ink'
              : enc.lastOutcome === 'success'
                ? 'border-gold-deep/40 bg-parchment-300/50 text-ink'
                : 'border-gold-deep/20 bg-parchment-100/60 text-ink-muted',
          )}
        >
          {enc.lastText}
        </div>
      )}

      {enc.done ? (
        <Button onClick={onAdvance} className="w-full py-2.5">
          Continue Deeper →
        </Button>
      ) : (
        <div className="space-y-2">
          {(node.choices ?? []).map((choice, i) => (
            <Button
              key={i}
              variant="secondary"
              onClick={() => onChoose(i)}
              className="w-full justify-start px-3 py-2 text-left text-sm"
            >
              {choice.label}
            </Button>
          ))}
        </div>
      )}
    </Panel>
  );
}
