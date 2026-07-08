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
  type MineMonster,
  generateMine,
  mineSnapshot,
  damageMonsterById,
} from '@/engine/mining';
import {
  type ForestState,
  type ForestTile,
  type ForestBeast,
  generateForest,
  forestSnapshot,
  damageBeastById,
} from '@/engine/forest';
import { mulberry32, floorSeed } from '@/engine/rng';
import { rollBoonChoices } from '@/engine/crawl';
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
import type { WorldSlice, PlayerSlice, TacticsIntent, CoopMessage } from './protocol';
import type { CoopSession } from './session'; // type-only: no runtime import cycle

/**
 * The fields of a WorldSlice that the mine/forest reducers actually consume.
 * The `type` and `t` fields are transport/ordering concerns that the reducers
 * don't need — only `floor` and `monsters` drive state changes.
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
    /** Needed to rebuild an entity missing locally. Optional only for
     *  tolerance of malformed/ancient slices — the wire always carries it. */
    key?: string;
    r: number;
    c: number;
    hp: number;
    /** Optional: slices from a pre-maxHp host omit it (rebuild falls back to `hp`). */
    maxHp?: number;
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
 * - Rebuild the monster list from the host's authoritative slice: update
 *   positions/HP, drop host-killed monsters, re-instantiate host-alive
 *   monsters missing locally.
 * - Detect a guardian kill on the host side so the guest can trigger a boon
 *   choice.
 *
 * Returns a new MineState in the common case; returns the input reference
 * unchanged when the host is on a floor we cannot follow (floor mismatch with no
 * baseSeed to regen from) — see the MP-29(f) bail below.
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

  // MP-29(f): host is on a different floor but we have no seed to regen ours —
  // never merge the host's foreign-floor monsters onto our current floor. Bail
  // and wait for a slice we can actually apply.
  if (slice.floor !== current.floor && deps.baseSeed === undefined) return current;

  // Host-authoritative rebuild: walk the host's list, matching local monsters
  // by id (the spread preserves guest-visible status fields) and
  // re-instantiating any host-alive monster missing locally — an intersection
  // could never resurrect one after a one-sided local kill, leaving the two
  // worlds permanently diverged. Monsters absent from the slice stay dropped
  // (the host killed them).
  const localById = new Map(current.monsters.map((m) => [m.id, m]));
  const merged: MineMonster[] = [];
  for (const sl of slice.monsters) {
    const local = localById.get(sl.id);
    if (local) {
      merged.push({ ...local, r: sl.r, c: sl.c, hp: sl.hp, readyAtMs: sl.readyAtMs });
    } else if (sl.key) {
      // Fresh status fields (frozen/poison) are correct — the guest never
      // observed any. `maxHp ?? hp` tolerates a pre-maxHp host (cosmetic only).
      merged.push({
        id: sl.id,
        key: sl.key,
        r: sl.r,
        c: sl.c,
        hp: sl.hp,
        maxHp: sl.maxHp ?? sl.hp,
        readyAtMs: sl.readyAtMs,
      });
    }
  }

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

/** Structural tile equality — pristine-regen and live tiles are always distinct
 *  object references, so compare by value (small plain objects). */
function tilesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * MP-25: diff the mine's current floor against a pristine regen from the shared
 * seed, returning only the cells that diverge (dug/harvested/decayed). This is the
 * one-shot backfill sent to a late joiner, who regenerates the same pristine floor
 * and never saw the party's earlier per-cell TileSlices.
 */
export function diffMineTiles(
  mining: MineState,
  baseSeed: number,
): Array<{ r: number; c: number; tile: MineTile }> {
  const pristine = generateMine(
    mining.floor,
    mineSnapshot(mining),
    mulberry32(floorSeed(baseSeed, mining.floor)),
  );
  const out: Array<{ r: number; c: number; tile: MineTile }> = [];
  for (let r = 0; r < mining.tiles.length; r++) {
    const row = mining.tiles[r];
    const prow = pristine.tiles[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      // A tombstone is the host's own death-recovery marker (placed post-gen, per
      // player) — never propagate it: a joiner has no matching lost haul to recover
      // and it would just litter their map with a dead tile.
      if (cell.kind === 'tombstone') continue;
      if (!tilesEqual(prow?.[c], cell)) out.push({ r, c, tile: cell });
    }
  }
  return out;
}

/**
 * Apply a one-shot tile snapshot onto a freshly-regenerated floor (late joiner).
 * Returns the original reference if the snapshot is for another floor or empty.
 */
export function applyMineTileSnapshot(
  mining: MineState,
  floor: number,
  entries: ReadonlyArray<{ r: number; c: number; tile: MineTile }>,
): MineState {
  if (mining.floor !== floor || entries.length === 0) return mining;
  const tiles = mining.tiles.map((row) => row.slice());
  let changed = false;
  for (const e of entries) {
    if (tiles[e.r]?.[e.c] !== undefined) {
      tiles[e.r][e.c] = e.tile;
      changed = true;
    }
  }
  return changed ? { ...mining, tiles } : mining;
}

/**
 * MP-11: clamp a guest-supplied per-hit damage value to a sane ceiling — the
 * target's own max HP. Under the friendly-trust model the wire still carries
 * client-computed `dmg` (`AttackIntent`); this bounds a buggy or modified client
 * to at most the target's total health in one hit, preventing absurd/overflow
 * values from reaching the host-authoritative world. The deferred full fix
 * recomputes damage host-side from the guest's known stats.
 */
export function clampRemoteDamage(dmg: number, maxHp: number): number {
  return Math.min(dmg, maxHp);
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
  const mon = mining.monsters.find((m) => m.id === monsterId);
  const capped = mon ? clampRemoteDamage(dmg, mon.maxHp) : dmg;
  return damageMonsterById(mining, monsterId, capped, rng);
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

  // MP-29(f) twin: host is on a different stage but we have no seed to regen
  // ours — never merge the host's foreign-stage beasts onto our current stage.
  if (slice.floor !== current.stage && deps.baseSeed === undefined) return current;

  // Host-authoritative rebuild (mirrors applyMineWorldSlice): match local
  // beasts by id, re-instantiate host-alive beasts missing locally (e.g. after
  // a one-sided local ranged kill), drop beasts absent from the slice.
  // The host's `asleep` is carried so a woken beast shows its HP bar.
  const localById = new Map(current.beasts.map((b) => [b.id, b]));
  const merged: ForestBeast[] = [];
  for (const sl of slice.monsters) {
    const local = localById.get(sl.id);
    if (local) {
      merged.push({
        ...local,
        r: sl.r,
        c: sl.c,
        hp: sl.hp,
        readyAtMs: sl.readyAtMs,
        asleep: sl.asleep ?? local.asleep,
      });
    } else if (sl.key) {
      merged.push({
        id: sl.id,
        key: sl.key,
        r: sl.r,
        c: sl.c,
        hp: sl.hp,
        maxHp: sl.maxHp ?? sl.hp,
        readyAtMs: sl.readyAtMs,
        asleep: sl.asleep ?? false,
      });
    }
  }

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

/** MP-25 forest twin of diffMineTiles — diff the current stage against a pristine regen. */
export function diffForestTiles(
  forest: ForestState,
  baseSeed: number,
): Array<{ r: number; c: number; tile: ForestTile }> {
  const pristine = generateForest(
    forest.stage,
    forestSnapshot(forest),
    mulberry32(floorSeed(baseSeed, forest.stage)),
  );
  const out: Array<{ r: number; c: number; tile: ForestTile }> = [];
  for (let r = 0; r < forest.tiles.length; r++) {
    const row = forest.tiles[r];
    const prow = pristine.tiles[r];
    for (let c = 0; c < row.length; c++) {
      if (!tilesEqual(prow?.[c], row[c])) out.push({ r, c, tile: row[c] });
    }
  }
  return out;
}

/** MP-25 forest twin of applyMineTileSnapshot. */
export function applyForestTileSnapshot(
  forest: ForestState,
  stage: number,
  entries: ReadonlyArray<{ r: number; c: number; tile: ForestTile }>,
): ForestState {
  if (forest.stage !== stage || entries.length === 0) return forest;
  const tiles = forest.tiles.map((row) => row.slice());
  let changed = false;
  for (const e of entries) {
    if (tiles[e.r]?.[e.c] !== undefined) {
      tiles[e.r][e.c] = e.tile;
      changed = true;
    }
  }
  return changed ? { ...forest, tiles } : forest;
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
  const beast = forest.beasts.find((b) => b.id === beastId);
  const capped = beast ? clampRemoteDamage(dmg, beast.maxHp) : dmg;
  return damageBeastById(forest, beastId, capped, rng);
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
 * Membership floor (MP-23): intents whose `heroId` isn't in `tactics.players`
 * are rejected here so an unknown/stale id can't fall through to the host's hero.
 * The caller remains responsible for ownership validation (the heroId must belong
 * to the sending guest, not merely be a roster member) and the status guard.
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
  // MP-23: reject intents whose heroId isn't a member of the current roster, so a
  // stale/malformed heroId can't fall through to acting as the host's hero (every
  // engine entry point resolves an unknown heroId to state.player). Skip the check
  // for solo/legacy state that carries no players roster.
  if (tactics.players && !tactics.players.some((p) => p.id === intent.heroId)) return tactics;
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

/**
 * MP-22: whether a tactics state change is worth broadcasting to the party.
 *
 * A bare selection click (`tacticsSelect` → `selectAction`) only rewrites the
 * local highlight caches — `selected`, `reachable`, `targetable` — which every
 * guest recomputes itself. Re-broadcasting the whole board on each hover/click is
 * pure free-tier waste. Returns false only when NOTHING but those fields
 * differs; any change to the authoritative world (player/enemies/turn/log/status/
 * turnCount/…) still broadcasts. A null/undefined `prev` (first send) always broadcasts.
 *
 * `selectAction` deep-clones the state (`clone`), which also resets `effects` to `[]`,
 * so `effects` is blanked too — otherwise the first click after any action would differ
 * on the cleared animation queue and ship a redundant full snapshot. Every real resolver
 * that pushes `effects` also writes `log`/hp, so genuine actions still differ and still
 * broadcast. The surviving fields are fresh references but value-equal — compare by value
 * (JSON), like `tilesEqual` above.
 */
export function shouldBroadcastTactics(
  prev: HexBattleState | null | undefined,
  next: HexBattleState,
): boolean {
  if (!prev) return true;
  const strip = (s: HexBattleState) => ({ ...s, selected: null, reachable: [], targetable: [], effects: [] });
  return JSON.stringify(strip(prev)) !== JSON.stringify(strip(next));
}

/**
 * MP-22: cap the `log` on the wire to its last `n` lines. The log grows unbounded
 * over a battle but the overlay only ever renders `log.slice(-4)`, so a tail loses
 * nothing visible while keeping the broadcast payload small. Returns the same
 * reference when already within the cap.
 */
export function tailTacticsLog(state: HexBattleState, n: number): HexBattleState {
  if (state.log.length <= n) return state;
  return { ...state, log: state.log.slice(-n) };
}

/**
 * The inputs the tactics message router needs, gathered by the caller (the hook)
 * from the store / staleness mark. Kept as plain values so the decision stays pure.
 *
 * `accept` is the RESULT of the stateful `acceptTacticsStateT(t)` high-water guard,
 * computed by the caller. It must only be evaluated for a guest receiving a
 * `tactics-state` (the host never advances its own mark) — the router simply
 * consumes the boolean.
 */
export interface TacticsMsgCtx {
  isHost: boolean;
  userId: string;
  /** Whether a local tactics board currently exists (`!!store.tactics`). */
  hasTactics: boolean;
  /** Whether the local board exists AND its status is 'active'. */
  tacticsActive: boolean;
  /** Result of the staleness guard for a `tactics-state` (guest only). */
  accept: boolean;
}

/**
 * Descriptor the router returns; the hook executes it against the store/channel.
 *  - `resend`: host, hero-join, board already exists → rebroadcast current state (MP-10).
 *  - `begin`:  host, hero-join, no board → beginTacticsCoop with the joiner's hero.
 *  - `apply`:  guest, fresh tactics-state → coopApplyTactics re-keyed to us (MP-03).
 *  - `intent`: host, valid guest tactics-intent → resolve + rebroadcast.
 *  - `bye`:    a peer departed → drop its avatar + toast.
 *  - `ignore`: every early-exit (wrong role, stale, self-intent, inactive board).
 */
export type TacticsMsgAction =
  | { kind: 'resend' }
  | { kind: 'begin' }
  | { kind: 'apply' }
  | { kind: 'intent' }
  | { kind: 'bye'; userId: string; username: string }
  | { kind: 'ignore' };

/**
 * Pure decision for an incoming co-op tactics message — the branch logic
 * extracted from `useTacticsCoopSession`'s inline broadcast handler so it's
 * unit-testable (MP-03 staleness accept/reject, MP-10 hero-join resend-on-existing).
 * No store reads, no sends, no module state: the caller supplies `ctx` and runs
 * the returned descriptor.
 */
export function handleTacticsMessage(msg: CoopMessage, ctx: TacticsMsgCtx): TacticsMsgAction {
  switch (msg.type) {
    case 'hero-join':
      // Host only: build the board, or resend if it already exists.
      if (!ctx.isHost) return { kind: 'ignore' };
      return ctx.hasTactics ? { kind: 'resend' } : { kind: 'begin' };

    case 'tactics-state':
      // Guest only: apply the host's authoritative state, dropping stale stamps.
      if (ctx.isHost) return { kind: 'ignore' };
      if (!ctx.accept) return { kind: 'ignore' };
      return { kind: 'apply' };

    case 'tactics-intent':
      // Host only: apply the guest's action while the board is live and the
      // heroId belongs to a non-host hero.
      if (!ctx.isHost) return { kind: 'ignore' };
      if (!ctx.tacticsActive) return { kind: 'ignore' };
      if (msg.heroId === ctx.userId) return { kind: 'ignore' };
      // Ownership: a guest may only drive its OWN hero. Equivalent to the roster check at
      // 2 players, but closes the spoofing hole the moment sessions grow beyond one guest.
      if (msg.heroId !== msg.userId) return { kind: 'ignore' };
      return { kind: 'intent' };

    case 'bye':
      if (msg.userId === ctx.userId) return { kind: 'ignore' };
      return { kind: 'bye', userId: msg.userId, username: msg.username };

    default:
      return { kind: 'ignore' };
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * MP-08: compute the next {session, joined} when the discovered session changes.
 * `joined` is preserved only while the *same* session id stays active; if the
 * session disappears (null) or its id changes, `joined` resets to false so a
 * guest isn't silently auto-attached to the party's next raid (which would leak
 * a live solo run's slices into it). The host/guest join paths call
 * `setSession(newSession)` then `setJoined(true)`, so a deliberate join re-sets
 * `joined` immediately after this reset.
 */
export function nextSessionState(
  prev: { session: CoopSession | null; joined: boolean },
  incoming: CoopSession | null,
): { session: CoopSession | null; joined: boolean } {
  const sameSession = !!incoming && !!prev.session && incoming.id === prev.session.id;
  return { session: incoming, joined: sameSession ? prev.joined : false };
}

/**
 * MP-09: whether a discovered session is my own orphaned row that should be
 * reaped (marked ended). It's an orphan when I'm the host but haven't joined it —
 * e.g. I closed the tab mid-raid and the row is still `active`, or an old row
 * resurfaces after a later session ended. Reaping stops dead raids from being
 * offered as joinable zombies.
 */
export function shouldReapOrphan(
  session: CoopSession | null,
  myId: string,
  joined: boolean,
): boolean {
  return !!session && session.host_id === myId && !joined;
}

/**
 * MP-24: whether this client's wire protocol is compatible with a discovered
 * session. A version mismatch means the host and I disagree on message shapes, so
 * joining would silently desync — refuse instead. Legacy rows created before the
 * `protocol_version` column existed report `undefined`; treat those as compatible
 * so a rollout doesn't lock everyone out (only an explicit mismatch is refused).
 */
export function canJoinSession(
  session: { protocol_version?: number | null } | null,
  myVersion: number,
): boolean {
  if (!session) return false;
  if (session.protocol_version === undefined || session.protocol_version === null) return true;
  return session.protocol_version === myVersion;
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
 *
 * MP-21: `exempt` grants a matching userId a longer `timeoutMs` (not immortality) —
 * used to keep a backgrounded host (whose sim/broadcast throttles while its tab is
 * hidden) in the roster instead of falsely reporting it left. The window is bounded
 * so a host that closed its tab or dropped the network — which sends no `bye` and no
 * further slice to clear its paused flag — is still reaped once it exceeds that window.
 */
export function pruneStalePlayers(
  roster: RemotePlayers,
  now: number,
  timeoutMs: number,
  exempt?: { isExempt: (userId: string) => boolean; timeoutMs: number },
): { roster: RemotePlayers; timedOut: string[] } {
  const next: RemotePlayers = {};
  const timedOut: string[] = [];
  for (const key of Object.keys(roster)) {
    const limit = exempt?.isExempt(key) ? exempt.timeoutMs : timeoutMs;
    if (now - roster[key].lastSeen < limit) {
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

/**
 * Build a WorldSlice from the host's current run state.
 *
 * MP-21: `hostPaused` flags a host whose tab is hidden (monster sim frozen). It is
 * only stamped when true so guests keep the host in their roster instead of evicting
 * it during the alt-tab throttle; a later slice with it absent clears the flag.
 */
export function buildWorldSlice(run: MineState | ForestState, hostPaused = false): WorldSlice {
  const depth = 'floor' in run ? run.floor : run.stage;
  const entities = 'monsters' in run ? run.monsters : run.beasts;
  return {
    type: 'world',
    // Wall clock, not performance.now(): the stamp crosses machines and must
    // survive a host reload (performance.now() restarts at 0, which would make
    // every new slice look stale to a guest's high-water mark).
    t: Date.now(),
    floor: depth,
    ...(hostPaused ? { hostPaused: true } : {}),
    monsters: entities.map((m) => ({
      id: m.id,
      key: m.key,
      r: m.r,
      c: m.c,
      hp: m.hp,
      maxHp: m.maxHp,
      readyAtMs: m.readyAtMs,
      asleep: (m as { asleep?: boolean }).asleep,
    })),
  };
}
