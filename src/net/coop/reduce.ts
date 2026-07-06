/**
 * Pure co-op state-transition reducers.
 *
 * These are the state-transition halves extracted from the store actions
 * (`coopApplyWorld`, `coopApplyTile`, etc.) and the hooks (roster helpers,
 * slice builders). All inputs and outputs are plain values — no store reads or
 * writes, no network calls, no React. RNG and seed are injected so every
 * function is deterministic and unit-testable.
 *
 * The hooks and store actions delegate to these functions and supply the
 * module-global RNG / seed values as arguments.
 */

import { boonConsolation, type RNG } from '@/engine/crawl';
import {
  type MineState,
  type MineTile,
  generateMine,
  mineSnapshot,
  damageMonsterById,
} from '@/engine/mining';
import {
  type ForestState,
  type ForestTile,
  generateForest,
  forestSnapshot,
  damageBeastById,
} from '@/engine/forest';
import { mulberry32, floorSeed } from '@/engine/rng';
import { rollBoonChoices } from '@/content/boons';
import { MINE_MONSTERS } from '@/content/mining';
import { FOREST_BEASTS } from '@/content/forest';
import {
  type HexBattleState,
  movePlayer as tacticsMoveFn,
  playerAttack as tacticsAttackFn,
  playerCastSpell as tacticsCastFn,
  endPlayerTurn as tacticsEndTurnFn,
  holdOverwatch as tacticsHoldFn,
  recomputeClientHighlights,
} from '@/engine/hexBattle';
import type { Hex } from '@/engine/hex';
import type { WorldSlice, PlayerSlice, TacticsIntent } from './protocol';

/**
 * The fields of a WorldSlice that the mine/forest reducers actually consume.
 * The `type`, `t`, and `status` fields are transport/ordering concerns that
 * the reducers don't need — only `floor` and `monsters` drive state changes.
 * Using this narrower type lets callers (the store, tests) pass a partial
 * object without constructing a full WorldSlice.
 *
 * `t` is included as an optional field so that store actions can read the
 * ordering timestamp without changing the reducer signatures — reducers simply
 * never access it.
 */
export interface WorldSliceInput {
  /** Host clock (ms) when produced — read by the staleness guard in the store
   *  actions (`coopApplyWorld` / `coopApplyForestWorld`); ignored by reducers. */
  t?: number;
  floor: number;
  monsters: ReadonlyArray<{
    id: string;
    r: number;
    c: number;
    hp: number;
    readyAtMs: number;
    asleep?: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Shared roster type (mirrors useCoopStore.remotePlayers)
// ---------------------------------------------------------------------------

export type RemotePlayers = Record<string, PlayerSlice & { lastSeen: number }>;

// ---------------------------------------------------------------------------
// Deep Mine co-op reducers
// ---------------------------------------------------------------------------

/**
 * Apply a host WorldSlice to the local mine state.
 *
 * - If the host has advanced to a new floor, regenerate that floor from its
 *   per-floor seed (identical to the host's seeded map) and carry our own
 *   hp/haul/boons forward.
 * - Merge monster positions/HP from the host; drop host-killed monsters.
 * - Detect a guardian kill on the host side so the guest can trigger a boon
 *   choice.
 *
 * Always returns a new MineState (the caller should set it unconditionally).
 */
export function applyMineWorldSlice(
  mining: MineState,
  slice: WorldSliceInput,
  deps: { baseSeed: number | undefined; rng: RNG },
): MineState {
  let current = mining;

  // Follow the host's descent.
  if (slice.floor !== current.floor && deps.baseSeed !== undefined) {
    const next = generateMine(
      slice.floor,
      mineSnapshot(current),
      mulberry32(floorSeed(deps.baseSeed, slice.floor)),
    );
    current = {
      ...next,
      hp: current.hp,
      sta: Math.min(next.maxSta, current.sta),
      mp: Math.min(next.maxMp, current.mp),
      haul: current.haul,
      deepest: Math.max(current.deepest, slice.floor),
    };
  }

  const byId = new Map(slice.monsters.map((m) => [m.id, m]));

  // Update positions/HP from the host; drop monsters the host has killed.
  // New host monsters not present locally are ignored — seeded maps match.
  const merged = current.monsters
    .filter((m) => byId.has(m.id))
    .map((m) => {
      const sl = byId.get(m.id)!;
      return { ...m, r: sl.r, c: sl.c, hp: sl.hp, readyAtMs: sl.readyAtMs };
    });

  // Detect guardian kill on the host side so the guest can trigger its own
  // boon choice. A guardian is gone when its id was present locally and is
  // absent from the host's monster list.
  const hostMonsterIds = new Set(slice.monsters.map((m) => m.id));
  const guardianJustKilled =
    current.status === 'active' &&
    !current.pendingBoonChoice &&
    current.monsters.some(
      (m) => MINE_MONSTERS[m.key]?.isGuardian && !hostMonsterIds.has(m.id),
    );

  if (guardianJustKilled) {
    const choices = rollBoonChoices('mine', current.activeBoons, deps.rng);
    // Exhausted pool rolls [] — consolation instead of a zero-option 'choosing'
    // soft-lock (mirrors the host-side guard in engine/mining.ts killMonster).
    if (choices.length === 0) return boonConsolation({ ...current, monsters: merged });
    return { ...current, monsters: merged, pendingBoonChoice: choices, status: 'choosing' as const };
  }

  return { ...current, monsters: merged };
}

/**
 * Apply a peer's tile change (dig / gather) to the local mine.
 * Returns the original reference if the tile is on a different floor or
 * already matches (no-op).
 */
export function applyMineTileSlice(
  mining: MineState,
  floor: number,
  r: number,
  c: number,
  tile: MineTile,
): MineState {
  if (mining.floor !== floor) return mining;
  const cur = mining.tiles[r]?.[c];
  if (!cur || cur === tile) return mining;
  const tiles = mining.tiles.map((row) => row.slice());
  tiles[r][c] = tile;
  return { ...mining, tiles };
}

/**
 * Apply a guest's remote attack to the host's mine (host-side resolution).
 * Returns the original reference if nothing changed.
 */
export function applyMineRemoteAttack(
  mining: MineState,
  monsterId: string,
  dmg: number,
  rng: RNG,
): MineState {
  if (mining.status !== 'active') return mining;
  return damageMonsterById(mining, monsterId, dmg, rng);
}

// ---------------------------------------------------------------------------
// Wild Forest co-op reducers
// ---------------------------------------------------------------------------

/**
 * Apply a host WorldSlice to the local forest state (mirrors applyMineWorldSlice).
 * Forest uses `stage` internally but the wire protocol maps it to `floor`.
 * Forest beasts carry an `asleep` flag that must be preserved.
 */
export function applyForestWorldSlice(
  forest: ForestState,
  slice: WorldSliceInput,
  deps: { baseSeed: number | undefined; rng: RNG },
): ForestState {
  let current = forest;

  // Follow the host's stage advance.
  if (slice.floor !== current.stage && deps.baseSeed !== undefined) {
    const next = generateForest(
      slice.floor,
      forestSnapshot(current),
      mulberry32(floorSeed(deps.baseSeed, slice.floor)),
    );
    current = {
      ...next,
      hp: current.hp,
      sta: Math.min(next.maxSta, current.sta),
      mp: Math.min(next.maxMp, current.mp),
      haul: current.haul,
      deepest: Math.max(current.deepest, slice.floor),
    };
  }

  const byId = new Map(slice.monsters.map((m) => [m.id, m]));

  // Merge beast positions/HP; carry the host's `asleep` so a woken beast
  // shows its HP bar on the guest.
  const merged = current.beasts
    .filter((b) => byId.has(b.id))
    .map((b) => {
      const sl = byId.get(b.id)!;
      return {
        ...b,
        r: sl.r,
        c: sl.c,
        hp: sl.hp,
        readyAtMs: sl.readyAtMs,
        asleep: sl.asleep ?? b.asleep,
      };
    });

  // Detect guardian kill for the boon-choice trigger.
  const hostBeastIds = new Set(slice.monsters.map((m) => m.id));
  const guardianJustKilled =
    current.status === 'active' &&
    !current.pendingBoonChoice &&
    current.beasts.some(
      (b) => FOREST_BEASTS[b.key]?.isGuardian && !hostBeastIds.has(b.id),
    );

  if (guardianJustKilled) {
    const choices = rollBoonChoices('forest', current.activeBoons, deps.rng);
    // Exhausted pool rolls [] — consolation instead of a zero-option 'choosing'
    // soft-lock (mirrors the host-side guard in engine/forest.ts killBeast).
    if (choices.length === 0) return boonConsolation({ ...current, beasts: merged });
    return { ...current, beasts: merged, pendingBoonChoice: choices, status: 'choosing' as const };
  }

  return { ...current, beasts: merged };
}

/**
 * Apply a peer's forest tile change. Returns the original reference on no-op.
 */
export function applyForestTileSlice(
  forest: ForestState,
  stage: number,
  r: number,
  c: number,
  tile: ForestTile,
): ForestState {
  if (forest.stage !== stage) return forest;
  const cur = forest.tiles[r]?.[c];
  if (!cur || cur === tile) return forest;
  const tiles = forest.tiles.map((row) => row.slice());
  tiles[r][c] = tile;
  return { ...forest, tiles };
}

/**
 * Apply a guest's remote attack to the host's forest.
 * Returns the original reference if nothing changed.
 */
export function applyForestRemoteAttack(
  forest: ForestState,
  beastId: string,
  dmg: number,
  rng: RNG,
): ForestState {
  if (forest.status !== 'active') return forest;
  return damageBeastById(forest, beastId, dmg, rng);
}

// ---------------------------------------------------------------------------
// Hex Tactics co-op reducers
// ---------------------------------------------------------------------------

/**
 * Apply a host TacticsState broadcast to this client's local view.
 *
 * - Re-keys `player` to this client's own hero (identified by `myId` in
 *   `incoming.players`).
 * - Preserves the client's current selection within the same turn (so the
 *   guest can still see what they had selected while waiting for the host to
 *   process their intent).
 * - Clears selection when the turn count changes (new turn, enemy phase
 *   completed).
 * - Calls `recomputeClientHighlights` on the result (it mutates in place).
 *
 * @param curTactics The client's current tactics state (null if first message).
 * @param incoming   The authoritative state from the host broadcast.
 * @param myId       This client's user/hero id.
 */
export function applyTacticsState(
  curTactics: HexBattleState | null,
  incoming: HexBattleState,
  myId: string,
): HexBattleState {
  // Re-key: the broadcast's `player` is the host's hero. Find this client's
  // own hero in `incoming.players` (if the field is present — it's only added
  // in multi-hero sessions).
  const { activeHeroId, players } = incoming;
  let player = incoming.player;
  if (activeHeroId && players) {
    const myHero = players.find((p) => p.id === myId);
    if (myHero) player = myHero;
  }

  // Preserve selection within the same turn; clear on a new turn.
  const turnChanged = curTactics == null || curTactics.turnCount !== incoming.turnCount;
  const selected =
    !turnChanged && incoming.status === 'active' ? (curTactics?.selected ?? null) : null;

  const next: HexBattleState = { ...incoming, player, selected };
  recomputeClientHighlights(next);
  return next;
}

/**
 * Apply a guest's TacticsIntent to the current battle state (host-side only).
 * Returns the new state if the action changed anything, otherwise the same
 * reference.
 *
 * The caller is responsible for ownership validation (the heroId must belong
 * to the guest, not the host) and status guard (battle must be 'active').
 *
 * @param tactics The current authoritative battle state.
 * @param intent  The guest's action intent.
 * @param rng     Injected RNG for damage/dodge variance (use Math.random in production).
 */
export function resolveTacticsIntent(
  tactics: HexBattleState,
  intent: TacticsIntent,
  rng: () => number,
): HexBattleState {
  switch (intent.action) {
    case 'move':
      return intent.to ? tacticsMoveFn(tactics, intent.to as Hex, intent.heroId) : tactics;
    case 'attack':
      return intent.to ? tacticsAttackFn(tactics, intent.to as Hex, rng, intent.heroId) : tactics;
    case 'cast':
      return intent.spellKey !== undefined
        ? tacticsCastFn(tactics, intent.spellKey, (intent.to as Hex | undefined) ?? null, rng, intent.heroId)
        : tactics;
    case 'hold':
      return tacticsHoldFn(tactics, rng, intent.heroId);
    case 'endTurn':
      return tacticsEndTurnFn(tactics, rng, intent.heroId);
    default:
      return tactics;
  }
}

// ---------------------------------------------------------------------------
// Roster helpers (RemotePlayers record management)
// ---------------------------------------------------------------------------

/**
 * Record an incoming PlayerSlice in the remote-player roster.
 * Returns the updated roster and a flag indicating whether this is a new
 * player (first time we've seen this userId).
 */
export function applyPlayerSlice(
  roster: RemotePlayers,
  msg: PlayerSlice,
  now: number,
): { roster: RemotePlayers; isNew: boolean } {
  const isNew = !roster[msg.userId];
  return {
    roster: { ...roster, [msg.userId]: { ...msg, lastSeen: now } },
    isNew,
  };
}

/**
 * Remove a player from the roster on a clean 'bye' message.
 * Returns the original roster reference if the player wasn't present.
 */
export function applyBye(roster: RemotePlayers, userId: string): RemotePlayers {
  if (!roster[userId]) return roster;
  const next = { ...roster };
  delete next[userId];
  return next;
}

/**
 * Prune players who haven't sent a slice within `timeoutMs`.
 * Returns the pruned roster and the usernames of timed-out players (so the
 * caller can show departure notices).
 */
export function pruneStalePlayers(
  roster: RemotePlayers,
  now: number,
  timeoutMs: number,
): { roster: RemotePlayers; timedOut: string[] } {
  const next: RemotePlayers = {};
  const timedOut: string[] = [];
  for (const key of Object.keys(roster)) {
    if (now - roster[key].lastSeen < timeoutMs) {
      next[key] = roster[key];
    } else {
      timedOut.push(roster[key].username);
    }
  }
  return { roster: next, timedOut };
}

// ---------------------------------------------------------------------------
// Slice builders (run → wire-format slice)
// ---------------------------------------------------------------------------

/** Build a PlayerSlice from the current run state. */
export function buildPlayerSlice(
  run: MineState | ForestState,
  ids: { userId: string; username: string },
): PlayerSlice {
  const depth = 'floor' in run ? run.floor : run.stage;
  return {
    type: 'player',
    userId: ids.userId,
    username: ids.username,
    r: run.player.r,
    c: run.player.c,
    facing: run.player.facing,
    hp: run.hp,
    maxHp: run.maxHp,
    floor: depth,
  };
}

/** Build a WorldSlice from the host's current run state. */
export function buildWorldSlice(run: MineState | ForestState): WorldSlice {
  const depth = 'floor' in run ? run.floor : run.stage;
  const entities = 'monsters' in run ? run.monsters : run.beasts;
  return {
    type: 'world',
    t: performance.now(),
    floor: depth,
    // 'choosing' is a UI sub-status; from the guest's perspective the world is still 'active'.
    status: run.status === 'choosing' ? 'active' : (run.status as WorldSlice['status']),
    monsters: entities.map((m) => ({
      id: m.id,
      key: m.key,
      r: m.r,
      c: m.c,
      hp: m.hp,
      readyAtMs: m.readyAtMs,
      asleep: (m as { asleep?: boolean }).asleep,
    })),
  };
}
