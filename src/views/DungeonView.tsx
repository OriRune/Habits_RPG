import { Heart, Sparkles, Coins, Zap } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { ROOM_META, ROOM_FAVORED, DUNGEON_ENERGY_COST, type RoomType } from '@/engine/dungeon';
import { type Reward } from '@/engine/challenges';
import { getStat } from '@/engine/stats';
import { getMaterial } from '@/engine/materials';
import { getItem } from '@/engine/items';
import { materialCrest } from '@/lib/sprites';
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

function FavoredStats({ type }: { type: RoomType }) {
  const favored = ROOM_FAVORED[type];
  if (favored.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-ink-muted">
      <span>Favored:</span>
      {favored.map((s) => (
        <span key={s} className="font-semibold" style={{ color: getStat(s).color }}>
          {getStat(s).short}
        </span>
      ))}
    </div>
  );
}

function RewardLine({ reward }: { reward: Reward }) {
  const mats = Object.entries(reward.materials ?? {}).filter(([, n]) => n > 0);
  const items = reward.items ?? [];
  if (!reward.gold && mats.length === 0 && items.length === 0) {
    return <span className="text-ink-light">No spoils.</span>;
  }
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
      {items.map((key, i) => (
        <span key={`${key}-${i}`} className="text-ink-muted">
          {getItem(key)?.name ?? key}
        </span>
      ))}
    </div>
  );
}

export function DungeonView() {
  const dungeon = useGameStore((s) => s.dungeon);
  const energy = useGameStore((s) => s.character.energy);
  const startDungeon = useGameStore((s) => s.startDungeon);
  const dungeonResolveRoom = useGameStore((s) => s.dungeonResolveRoom);
  const dungeonBattleAction = useGameStore((s) => s.dungeonBattleAction);
  const dungeonAdvance = useGameStore((s) => s.dungeonAdvance);
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
            <div className="font-display text-base font-bold text-ink">Standard Delve</div>
            <div className="text-sm text-ink-muted">
              Brave a series of rooms — traps, foes, puzzles, and treasure. Your stats decide
              your fate; spoils are gold, materials, and the occasional relic.
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

  // --- Run summary (ended) --- (checked before dereferencing the current room, which
  // may be out of range once the final room is cleared).
  if (dungeon.status === 'ended') {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <SectionTitle tone="wood">{dungeon.cleared ? 'Dungeon Cleared!' : 'You Retreat...'}</SectionTitle>
        <Panel tone="parchment" className="space-y-4 p-5">
          <SceneArt sceneKey={dungeon.cleared ? 'dungeon:cleared' : 'dungeon:retreat'} size="lg" />
          <p className="text-sm text-ink-muted">
            {dungeon.cleared
              ? 'You emerge victorious, laden with spoils.'
              : 'You fall back, wounded — but you keep what you gathered. Train your habits and return stronger.'}
          </p>
          <div>
            <div className="mb-1 font-display text-xs uppercase tracking-wider text-ink-muted">Spoils</div>
            <RewardLine reward={dungeon.reward} />
          </div>
          <Button onClick={collectDungeon} className="w-full py-2.5">
            Collect &amp; Leave
          </Button>
        </Panel>
      </div>
    );
  }

  const room = dungeon.rooms[dungeon.index];
  const meta = ROOM_META[room.type];
  const inActiveCombat = room.type === 'combat' && dungeon.battle?.status === 'active';

  // --- Active run ---
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <div className="flex items-center justify-between">
        <SectionTitle tone="wood" className="flex-1">
          Room {dungeon.index + 1} of {dungeon.rooms.length}
        </SectionTitle>
      </div>

      {!inActiveCombat && (
        <Panel tone="wood" className="space-y-2 p-3">
          <RunGauge icon={<Heart className="h-4 w-4 text-stat-HP" />} value={dungeon.hp} max={dungeon.maxHp} fill="#2e8a5e" />
          <RunGauge icon={<Sparkles className="h-4 w-4 text-stat-KN" />} value={dungeon.mp} max={dungeon.maxMp} fill="#3b82f6" />
        </Panel>
      )}

      {room.type === 'combat' ? (
        <Panel tone="wood" className="p-4">
          {dungeon.battle && (
            <BattleScene
              battle={dungeon.battle}
              onAction={dungeonBattleAction}
              onResolve={dungeonAdvance}
              resolveWonLabel="Continue Deeper →"
              resolveLostLabel="The run ends — gather your spoils"
              resolveFledLabel="Leave the dungeon"
              allowFlee
            />
          )}
        </Panel>
      ) : (
        <Panel tone="parchment" className="space-y-3 p-5">
          <SceneArt sceneKey={`room:${room.type}`} />
          <div>
            <div className="font-display text-base font-bold text-ink">{meta.name}</div>
            <div className="text-sm text-ink-muted">{meta.description}</div>
          </div>
          <FavoredStats type={room.type} />

          {dungeon.lastResult ? (
            <>
              <SceneArt sceneKey={`outcome:${dungeon.lastResult.outcome}`} size="sm" />
              <div
                className={`rounded-md border p-3 text-sm ${
                  dungeon.lastResult.outcome === 'fail'
                    ? 'border-ember/40 bg-ember/5 text-ink'
                    : 'border-gold-deep/40 bg-parchment-300/50 text-ink'
                }`}
              >
                <div className="mb-1">{dungeon.lastResult.message}</div>
                <RewardLine reward={dungeon.lastResult.reward} />
              </div>
              <Button onClick={dungeonAdvance} className="w-full py-2.5">
                Continue Deeper →
              </Button>
            </>
          ) : (
            <Button onClick={dungeonResolveRoom} className="w-full py-2.5">
              {meta.verb}
            </Button>
          )}
        </Panel>
      )}
    </div>
  );
}
