// Thin Wild Forest instantiation of the shared real-time crawler loop — the former
// standalone forest loop is merged into useCrawlLoop.ts (the "when" logic lives there;
// this file only wires the forest's store actions and run-state accessors into a
// CrawlLoopCaps). Forest-specific seams: advance-instead-of-descend, shrine own-tile
// handling, ranged guest intents (rangedBeastId), and ranged tap aiming.
//
// Deliberate behavior alignment from the merge: advancing at the treeline now yields
// to an adjacent faced beast (mine's descend-priority rule) — previously Space would
// advance mid-fight; now it attacks, matching the mine.
import { useGameStore } from '@/store/useGameStore';
import {
  canAdvance,
  facedCell,
  facedBeastId,
  rangedBeastId,
  isOnShrine,
  tapStrikeableAt,
  rangedTapDir,
  type Dir,
  type ForestState,
} from '@/engine/forest';
import { useCoopStore } from '@/net/coop/session';
import { useAuthStore } from '@/net/auth';
import { useCrawlLoop, type CrawlLoopCaps, type CrawlLoopControls } from './useCrawlLoop';

/** Fallback move cadence when run state has no moveIntervalMs (old saves). */
const MOVE_INTERVAL_MS = 150;
/** Minimum gap between blade swings / gathers (ms) so holding the key doesn't burn stamina at 60fps. */
const ACT_INTERVAL_MS = 240;
/** How often we advance the beast clock (ms). */
const BEAST_TICK_MS = 120;

export type ForestControlsApi = CrawlLoopControls;

const forestCaps: CrawlLoopCaps<ForestState> = {
  getRun: () => useGameStore.getState().forest,
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
  floor: (run) => run.stage,
  tileAt: (run, r, c) => run.tiles[r]?.[c],

  canDescend: canAdvance,
  facedCell,
  facedTargetId: facedBeastId,
  // A guest's attack intent can also hit the first beast down the faced ranged line —
  // a guest must never resolve a kill locally (the host owns the world; a local kill
  // diverges permanently since the world merge is host-authoritative).
  intentTargetId: (run) => facedBeastId(run) ?? rangedBeastId(run),
  tapStrikeable: tapStrikeableAt,
  rangedTapDir,
  face: (dir: Dir) => useGameStore.getState().forestFace(dir),
  // Shrines are consumed from the tile underfoot; the den beast is gated to host/solo.
  ownTile: {
    isOn: isOnShrine,
    act: (nowMs, isGuest) => useGameStore.getState().forestShrine(nowMs, !isGuest),
  },

  move: (dir: Dir) => useGameStore.getState().forestMove(dir),
  strike: (nowMs) => useGameStore.getState().forestAct(nowMs),
  strikeCharged: (nowMs) => useGameStore.getState().forestActCharged(nowMs),
  dash: (dir: Dir, nowMs) => useGameStore.getState().forestDash(dir, nowMs),
  cast: (spellKey, nowMs) => useGameStore.getState().forestCast(spellKey, nowMs),
  tick: (nowMs, coPlayers) => useGameStore.getState().forestTick(nowMs, coPlayers),
  coopClientTick: (nowMs) => useGameStore.getState().coopForestClientTick(nowMs),
  descend: () => useGameStore.getState().forestAdvance(),

  broadcastTile: (floor, r, c, tile) => {
    const coop = useCoopStore.getState();
    const myId = useAuthStore.getState().session?.user?.id;
    coop.send?.({ type: 'tile', userId: myId ?? 'anon', floor, r, c, tile: tile as never });
  },

  moveIntervalFallbackMs: MOVE_INTERVAL_MS,
  swingIntervalMs: ACT_INTERVAL_MS,
  monsterTickMs: BEAST_TICK_MS,
};

/** Drives an active Wild Forest run. Mount once inside the run overlay. */
export function useForestLoop(): ForestControlsApi {
  return useCrawlLoop(forestCaps);
}
