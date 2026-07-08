// Thin Deep Mine instantiation of the shared real-time crawler loop (5.1). All the
// actual "when do we move/strike/dash/tick" logic lives in useCrawlLoop.ts; this file
// just wires the mine's store actions and run-state accessors into a CrawlLoopCaps.
import { useGameStore } from '@/store/useGameStore';
import { canDescend, facedCell, facedMonsterId, type Dir, type MineState } from '@/engine/mining';
import { useCoopStore } from '@/net/coop/session';
import { useAuthStore } from '@/net/auth';
import { useCrawlLoop, type CrawlLoopCaps, type CrawlLoopControls } from './useCrawlLoop';

/** Fallback move cadence when run state has no moveIntervalMs (old saves). */
const MOVE_INTERVAL_MS = 150;
/** Minimum gap between pick swings (ms) so holding the key doesn't burn stamina at 60fps. */
const SWING_INTERVAL_MS = 240;
/** How often we advance the monster clock (ms). */
const MONSTER_TICK_MS = 120;

export type MiningControls = CrawlLoopControls;

const mineCaps: CrawlLoopCaps<MineState> = {
  getRun: () => useGameStore.getState().mining,
  isActive: (run) => run.status === 'active',
  player: (run) => run.player,
  knownSpells: (run) => run.knownSpells,
  activeBoons: (run) => run.activeBoons ?? [],
  dashCooldownMs: (run) => run.dashCooldownMs,
  lastDashMs: (run) => run.lastDashMs,
  moveIntervalMs: (run) => run.moveIntervalMs,
  weaponAttackStat: (run) => run.weapon.attackStat,
  meleePower: (run) => run.meleePower,
  rangedPower: (run) => run.rangedPower,
  floor: (run) => run.floor,
  tileAt: (run, r, c) => run.tiles[r]?.[c],

  canDescend,
  facedCell,
  facedTargetId: facedMonsterId,

  move: (dir: Dir) => useGameStore.getState().mineMove(dir),
  strike: () => useGameStore.getState().mineStrike(),
  strikeCharged: (nowMs) => useGameStore.getState().mineStrikeCharged(nowMs),
  dash: (dir: Dir, nowMs) => useGameStore.getState().mineDash(dir, nowMs),
  cast: (spellKey, nowMs) => useGameStore.getState().mineCast(spellKey, nowMs),
  tick: (nowMs, coPlayers) => useGameStore.getState().mineTick(nowMs, coPlayers),
  coopClientTick: (nowMs) => useGameStore.getState().coopClientTick(nowMs),
  descend: () => useGameStore.getState().mineDescend(),

  broadcastTile: (floor, r, c, tile) => {
    const coop = useCoopStore.getState();
    const myId = useAuthStore.getState().session?.user?.id;
    coop.send?.({ type: 'tile', userId: myId ?? 'anon', floor, r, c, tile: tile as never });
  },

  moveIntervalFallbackMs: MOVE_INTERVAL_MS,
  swingIntervalMs: SWING_INTERVAL_MS,
  monsterTickMs: MONSTER_TICK_MS,
};

/** Drives an active Deep Mine run. Mount once inside the run overlay. */
export function useMiningLoop(): MiningControls {
  return useCrawlLoop(mineCaps);
}
