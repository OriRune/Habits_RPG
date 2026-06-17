// Shared dungeon-crawl engine core.
//
// Both the Deep Mine (src/engine/mining.ts) and the Wild Forest (src/engine/forest.ts) are
// large, scrolling, real-time dungeon crawlers that share the same grid geometry, camera math,
// BFS pathfinding, stamina formula, and spell-effect types. This file exports those shared
// pieces so neither engine has to duplicate them.
//
// Nothing here is React-aware; every export is a pure function or a type.

import type { StatId } from './stats';

// ---------------------------------------------------------------------------
// Basic types
// ---------------------------------------------------------------------------

export type RNG = () => number;
export type Dir = 'up' | 'down' | 'left' | 'right';

export const DIRS: Record<Dir, [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

/** The 4-direction offsets as an iterable array (used in BFS loops). */
const DIR_OFFSETS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

export function randInt(min: number, max: number, rng: RNG): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// ---------------------------------------------------------------------------
// Camera viewport
// ---------------------------------------------------------------------------

/** Number of tiles shown along each axis of the scrolling viewport. */
export const VIEW = 11;

/**
 * Compute the top-left `{r0, c0}` corner of the viewport so the player is centred,
 * clamped to keep the window inside the map bounds.
 */
export function cameraWindow(
  player: { r: number; c: number },
  rows: number,
  cols: number,
): { r0: number; c0: number } {
  const half = Math.floor(VIEW / 2);
  const r0 = Math.max(0, Math.min(rows - VIEW, player.r - half));
  const c0 = Math.max(0, Math.min(cols - VIEW, player.c - half));
  return { r0, c0 };
}

// ---------------------------------------------------------------------------
// Dungeon stamina (separate from Arena / turn-based combat pool of 12+EN)
// ---------------------------------------------------------------------------

/**
 * Maximum stamina for a dungeon run (mine or forest).  Intentionally much larger than
 * the Arena/battle value (`12 + EN`) so the bigger worlds feel sustainable.
 */
export function dungeonStamina(enLevel: number): number {
  return 50 + enLevel;
}

// ---------------------------------------------------------------------------
// BFS flow-field pathfinding (adapted from Arena's floodField / flowStep)
// ---------------------------------------------------------------------------

/**
 * BFS from `target` (the player's position) across cells where `passable(r,c)` is true.
 * Returns a distance map  `"r,c" → distance`  so each monster can pick the optimal next
 * step with `flowStep`.  Does NOT include monster occupation in `passable` — that is
 * handled per-monster inside `flowStep` via the `blocked` set.
 */
export function floodField(
  target: { r: number; c: number },
  rows: number,
  cols: number,
  passable: (r: number, c: number) => boolean,
): Map<string, number> {
  const dist = new Map<string, number>();
  const startKey = `${target.r},${target.c}`;
  dist.set(startKey, 0);
  const queue: Array<{ r: number; c: number }> = [target];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(`${cur.r},${cur.c}`)!;
    for (const [dr, dc] of DIR_OFFSETS) {
      const nr = cur.r + dr;
      const nc = cur.c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const k = `${nr},${nc}`;
      if (dist.has(k)) continue;
      if (!passable(nr, nc)) continue;
      dist.set(k, d + 1);
      queue.push({ r: nr, c: nc });
    }
  }
  return dist;
}

/**
 * Pick the best adjacent step for a monster using the pre-built flow field.
 * `blocked` includes other monsters + the player's cell to avoid collisions.
 * Returns `null` when no improvement is possible (monster is already adjacent or stuck).
 */
export function flowStep(
  from: { r: number; c: number },
  field: Map<string, number>,
  blocked: Set<string>,
): { r: number; c: number } | null {
  const currentDist = field.get(`${from.r},${from.c}`) ?? Infinity;
  let best: { r: number; c: number } | null = null;
  let bestD = Infinity;
  for (const [dr, dc] of DIR_OFFSETS) {
    const nr = from.r + dr;
    const nc = from.c + dc;
    const k = `${nr},${nc}`;
    if (blocked.has(k)) continue;
    const d = field.get(k) ?? Infinity;
    if (d < bestD) {
      bestD = d;
      best = { r: nr, c: nc };
    }
  }
  // Only move if it brings the monster closer (avoids circling when stuck).
  return bestD < currentDist ? best : null;
}

// ---------------------------------------------------------------------------
// Rune system (shared by mine and forest spell casting)
// ---------------------------------------------------------------------------

/** A rune trap placed on a floor tile by the player; triggers when any unit steps on it. */
export interface CrawlRune {
  id: number;
  r: number;
  c: number;
  kind: 'fire' | 'ice' | 'poison';
  power: number;
  expiresAtMs: number;
}

// ---------------------------------------------------------------------------
// Status effects (real-time, ms-based — used inside dungeon runs)
// ---------------------------------------------------------------------------

/** An active status on the player or a monster inside a dungeon run. */
export interface CrawlStatusEffect {
  key: 'burn' | 'poison' | 'freeze' | 'bless' | 'weaken' | 'blind';
  magnitude: number;
  expiresAtMs: number;
  /** Next DoT tick time (burn / poison only). */
  nextTickAtMs?: number;
}

/** DoT tick interval for burn / poison in dungeon real-time (matches Arena's TURN_MS = 1500ms). */
export const DOT_TICK_MS = 1500;
/** How long a freeze lasts (ms). */
export const FREEZE_DURATION_MS = 3000;

/** Upsert a status into a list, extending duration and raising magnitude if already present. */
export function applyStatus(
  list: CrawlStatusEffect[],
  effect: { key: CrawlStatusEffect['key']; magnitude: number; durationMs: number },
  nowMs: number,
): CrawlStatusEffect[] {
  const expiresAtMs = nowMs + effect.durationMs;
  const existing = list.find((x) => x.key === effect.key);
  if (existing) {
    return list.map((x) =>
      x.key === effect.key
        ? {
            ...x,
            expiresAtMs: Math.max(x.expiresAtMs, expiresAtMs),
            magnitude: Math.max(x.magnitude, effect.magnitude),
          }
        : x,
    );
  }
  const entry: CrawlStatusEffect = {
    key: effect.key,
    magnitude: effect.magnitude,
    expiresAtMs,
  };
  if (effect.key === 'burn' || effect.key === 'poison') {
    entry.nextTickAtMs = nowMs + DOT_TICK_MS;
  }
  return [...list, entry];
}

/** Remove expired statuses from a list. */
export function pruneStatuses(list: CrawlStatusEffect[], nowMs: number): CrawlStatusEffect[] {
  return list.filter((x) => x.expiresAtMs > nowMs);
}

/** Find an active (non-expired) status. */
export function activeStatus(
  list: CrawlStatusEffect[],
  key: CrawlStatusEffect['key'],
  nowMs: number,
): CrawlStatusEffect | undefined {
  return list.find((x) => x.key === key && x.expiresAtMs > nowMs);
}

// ---------------------------------------------------------------------------
// Ring-of-fire shared type
// ---------------------------------------------------------------------------

export interface CrawlRingOfFire {
  expiresAtMs: number;
  dmg: number;
}

// ---------------------------------------------------------------------------
// Regen intervals
// ---------------------------------------------------------------------------

/** Passive stamina regen: +1 sta every STA_REGEN_MS while in a dungeon run. */
export const STA_REGEN_MS = 1200;
/** Passive MP regen: +1 mp every MP_REGEN_MS while in a dungeon run. */
export const MP_REGEN_MS = 2000;
/** Ring-of-fire pulse interval (ms) per adjacent enemy. */
export const RING_HIT_CD_MS = 600;
/** Duration of the ring-of-fire effect (ms). */
export const RING_DURATION_MS = 8000;

// ---------------------------------------------------------------------------
// General grid helpers (generic over tile shape)
// ---------------------------------------------------------------------------

/** Get the tile in front of `player` (the cell the player is facing). */
export function facedCell(player: { r: number; c: number; facing: Dir }): { r: number; c: number } {
  const [dr, dc] = DIRS[player.facing];
  return { r: player.r + dr, c: player.c + dc };
}

/** Manhattan-adjacent test (4-directional). */
export function adjacent(a: { r: number; c: number }, b: { r: number; c: number }): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

/** Manhattan distance between two cells. */
export function manhattan(a: { r: number; c: number }, b: { r: number; c: number }): number {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
}

// ---------------------------------------------------------------------------
// Shared monster combat types (extended by MineMonsterDef / ForestBeastDef)
// ---------------------------------------------------------------------------

/**
 * Combat fields optionally added to dungeon monster / beast definitions.
 * When absent the engine falls back to touch-only contact damage.
 */
export interface MonsterCombatStats {
  /** Physical damage mitigation on each hit. */
  defense?: number;
  /** Stats this monster is weak to (damage × 1.25). */
  weakTo?: StatId[];
  /** Stats this monster resists (damage × 0.6). */
  resistTo?: StatId[];
}
