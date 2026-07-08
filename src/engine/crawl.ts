// Shared dungeon-crawl engine core.
//
// Both the Deep Mine (src/engine/mining.ts) and the Wild Forest (src/engine/forest.ts) are
// large, scrolling, real-time dungeon crawlers that share the same grid geometry, camera math,
// BFS pathfinding, stamina formula, and spell-effect types. This file exports those shared
// pieces so neither engine has to duplicate them.
//
// Nothing here is React-aware; every export is a pure function or a type.

import type { StatId } from './stats';
import type { Reward } from './challenges';
import { getSpell, SCHOOL_STAT } from './spells';
import { spellDamageRoll, spellHealAmount } from './combat';
// Engine imports the boon DATA table from content (the allowed direction); the boon
// EFFECT reducers + roller live here in the engine (ARCH-11), not in content/.
import { BOONS } from '@/content/boons';

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
 * Multi-source BFS: floods from several target cells at once, so each cell's
 * distance is to the *nearest* target. Used for co-op enemy targeting (chase the
 * closest of several players). With a single target this behaves like a plain
 * single-source BFS, so the single-player path is unchanged.
 */
export function floodFieldMulti(
  targets: ReadonlyArray<{ r: number; c: number }>,
  rows: number,
  cols: number,
  passable: (r: number, c: number) => boolean,
): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: Array<{ r: number; c: number }> = [];
  for (const t of targets) {
    const k = `${t.r},${t.c}`;
    if (dist.has(k)) continue;
    dist.set(k, 0);
    queue.push({ r: t.r, c: t.c });
  }
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
function facedCell(player: { r: number; c: number; facing: Dir }): { r: number; c: number } {
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

/**
 * Spawn-safety radius shared by both crawler generators (mine + forest): no hostile may
 * be placed within this Manhattan distance of the player's spawn tile at floor-generation
 * time, so a fresh floor never opens with a monster already on top of a low-level player
 * before they can react. Walk distance (4-directional BFS) is always ≥ Manhattan, so this
 * also guarantees at least this many steps of warning. Enforced as a candidate-cell filter,
 * so an over-constrained floor degrades gracefully — it simply seeds fewer hostiles rather
 * than looping or spilling closer to the spawn.
 */
export const CRAWL_SPAWN_SAFE_RADIUS = 4;

// ---------------------------------------------------------------------------
// Shared cave-generation placement primitive (2.1 — hoisted out of generateMine so
// hazard tiles / vaults / elites can each be one data-driven placement step instead
// of a bespoke procedure; generateForest has the identical shape and can adopt this
// in a follow-up).
// ---------------------------------------------------------------------------

/** Filter a cell list down to placement candidates. Thin on its own — pairs with
 *  {@link placeFeatures} so every placement step reads as "filter, then place". */
export function pickCandidates<TCell>(
  cells: ReadonlyArray<TCell>,
  filterFn: (cell: TCell) => boolean,
): TCell[] {
  return cells.filter(filterFn);
}

/**
 * Pop up to `count` cells off `candidates`, calling `place(cell)` for each — the shared
 * placement primitive behind generateMine's cluster/single-feature steps (rock clusters,
 * ore veins, guardians, boon caches). `candidates` is mutated (consumed); pass a copy if
 * the caller still needs the original list afterward. Returns the cells actually placed —
 * fewer than `count` once the pool runs dry.
 *
 * Two modes, matching the two placement patterns generateMine actually needs:
 *  - No `rng`: pops from the tail — for a pool the caller already shuffled once up front
 *    (e.g. openFloor), so repeated calls keep consuming the same shuffled order without
 *    paying to re-shuffle (and without re-drawing from `rng`) on every call.
 *  - With `rng`: picks a uniformly random remaining candidate each time (reservoir-style,
 *    one rng() draw per placement) — for a freshly-filtered, unshuffled candidate list
 *    where a single random pick is wanted (e.g. one guardian/boon cell out of many).
 */
export function placeFeatures<TCell>(
  candidates: TCell[],
  count: number,
  place: (cell: TCell) => void,
  rng?: RNG,
): TCell[] {
  const placed: TCell[] = [];
  for (let i = 0; i < count && candidates.length > 0; i++) {
    const idx = rng ? Math.floor(rng() * candidates.length) : candidates.length - 1;
    const [cell] = candidates.splice(idx, 1);
    place(cell);
    placed.push(cell);
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Phase 1 — Dash + charge constants & stat-scaling formulas
// ---------------------------------------------------------------------------

/** Base cooldown between dashes (ms). Reduced by Agility via {@link dashCooldown}. */
export const DASH_BASE_CD_MS = 2000;
/** How many swing intervals (of 240 ms each) the attack button must be held to charge. */
export const CHARGE_SWING_COUNT = 2;
/** Damage multiplier applied to a charged/heavy swing. MINI-17: raised 1.75→2.25 so a
 *  CHARGE_SWING_COUNT-interval hold honestly out-damages mashing (was DPS-negative at 1.75). */
export const CHARGE_DAMAGE_MULT = 2.25;
/** How long a staggered monster is briefly frozen after a charged hit (ms). */
export const STAGGER_MS = 500;

/**
 * Dash cooldown in ms, scaling down with Agility. A high-AG character can dash every
 * ~800 ms (the cap); low-AG characters wait up to 2 seconds between dashes.
 */
export function dashCooldown(agLevel: number): number {
  return Math.max(800, DASH_BASE_CD_MS - agLevel * 40);
}

/**
 * Move cadence in ms, scaling down slightly with Agility. Capped at 100 ms so the
 * player never moves so fast the viewport can't keep up.
 */
export function moveInterval(agLevel: number): number {
  return Math.max(100, 150 - agLevel * 2);
}

/**
 * Contact-damage multiplier for depth past the deepest (open-ended) band. Deep
 * floors/stages would otherwise plateau — every enemy template caps out at the
 * last band's stats. This ramps monster/beast touch damage by 4% per floor past
 * the last band's first floor, capped at 2×, so deep runs stay lethal.
 * `depthPastLastBand` ≤ 0 (shallower than the last band) returns 1.0 (no change).
 */
export function lateDepthDamageScale(depthPastLastBand: number): number {
  return Math.min(2, 1 + 0.04 * Math.max(0, depthPastLastBand));
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

// ---------------------------------------------------------------------------
// Phase 5 — In-run boon type
// ---------------------------------------------------------------------------

/**
 * A permanent power-up for the current run only.  Boons are stored as key
 * strings on run state (`activeBoons: string[]`); their effects are resolved by
 * the pure reducers in `src/content/boons.ts` — no closures, fully serialisable.
 * Keys must match entries in `BOONS` in that file.
 */
export interface CrawlBoon {
  key: string;
  name: string;
  desc: string;
  /** Glyph / emoji fallback; PNG art can be wired via minigameArt later. */
  icon: string;
  /** Which crawler this boon can appear in. */
  game: 'mine' | 'forest' | 'both';
  /** ×weapon damage (strike/act melee branch). */
  meleeMult?: number;
  /** Flat contact-damage reduction. */
  defenseBonus?: number;
  /** Move speed boost: moveIntervalMs = base / moveMult. */
  moveMult?: number;
  /** Dash-cooldown multiplier (≤1 = faster): dashCooldownMs = base * dashCdMult. */
  dashCdMult?: number;
  /** ×ore/chop/gather drop quantity. */
  yieldMult?: number;
  /** Forest sight radius (+N tiles). */
  sightBonus?: number;
  /** Charged swing needs N fewer hold-intervals (loop-side). */
  chargeReduce?: number;
  /** Flat +max HP on pickup; also instantly heals that amount. */
  maxHpBonus?: number;
}

/** Heal granted when a boon roll comes up empty (pool exhausted). */
export const BOON_CONSOLATION_HEAL = 15;
/** Gold granted when a boon roll comes up empty (pool exhausted). */
export const BOON_CONSOLATION_GOLD = 40;

/**
 * Consolation prize when `rollBoonChoices` returns `[]` (every eligible boon
 * already held): a modest heal + gold instead of the choice panel.  Callers
 * MUST use this in place of the `status:'choosing'` transition whenever the
 * roll is empty — entering 'choosing' with zero options soft-locks the run
 * (no button to pick, no skip, banking gated on 'active').
 */
export function boonConsolation<
  T extends { hp: number; maxHp: number; haul: { gold?: number } },
>(state: T): T {
  return {
    ...state,
    hp: Math.min(state.maxHp, state.hp + BOON_CONSOLATION_HEAL),
    haul: { ...state.haul, gold: (state.haul.gold ?? 0) + BOON_CONSOLATION_GOLD },
  };
}

// ---------------------------------------------------------------------------
// Boon effect reducers — fold across activeBoons to get the combined modifier.
// These are game RULES (multiplicative vs additive stacking), so they live in the
// engine (ARCH-11); the BOONS table they read is data and stays in content/.
// All boons stack multiplicatively for *Mult reducers, additively for *Bonus/*Reduce.
// ---------------------------------------------------------------------------

/** Combined weapon damage multiplier from held boons (multiplicative stack). */
export function boonMeleeMult(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.meleeMult != null ? acc * b.meleeMult : acc;
  }, 1);
}

/** Combined flat contact-damage reduction from held boons (additive stack). */
export function boonDefenseBonus(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.defenseBonus != null ? acc + b.defenseBonus : acc;
  }, 0);
}

/** Combined ore/chop/gather yield multiplier from held boons (multiplicative stack). */
export function boonYieldMult(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.yieldMult != null ? acc * b.yieldMult : acc;
  }, 1);
}

/** Combined move-speed multiplier from held boons (multiplicative stack).
 *  Applied as: `moveIntervalMs = base / boonMoveMult(keys)`. */
export function boonMoveMult(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.moveMult != null ? acc * b.moveMult : acc;
  }, 1);
}

/** Combined dash-cooldown multiplier from held boons (multiplicative stack).
 *  Applied as: `dashCooldownMs = base * boonDashCdMult(keys)`. */
export function boonDashCdMult(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.dashCdMult != null ? acc * b.dashCdMult : acc;
  }, 1);
}

/** Combined sight-radius bonus from held boons (additive stack). */
export function boonSightBonus(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.sightBonus != null ? acc + b.sightBonus : acc;
  }, 0);
}

/** Combined charge-interval reduction from held boons (additive stack).
 *  Subtracted from CHARGE_SWING_COUNT in the rAF loops. */
export function boonChargeReduce(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.chargeReduce != null ? acc + b.chargeReduce : acc;
  }, 0);
}

/**
 * Pick up to 3 distinct boon options from those eligible for `game`, excluding
 * any boons the player already holds (no duplication — each key is unique).
 * Uses the injected `rng` for determinism.
 */
export function rollBoonChoices(
  game: 'mine' | 'forest',
  activeBoons: string[],
  rng: RNG,
): string[] {
  const held = new Set(activeBoons);
  const pool = Object.values(BOONS).filter(
    (b) => (b.game === 'both' || b.game === game) && !held.has(b.key),
  );
  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3).map((b) => b.key);
}

// ---------------------------------------------------------------------------
// Phase 6 — Screen-shake helper
// ---------------------------------------------------------------------------

/**
 * Pure, deterministic shake-offset helper.
 *
 * Returns the (sx, sy) CSS-pixel offset to add to the world-container translate
 * for one rAF frame of camera shake.  randX / randY must be in [0, 1] — callers
 * pass `Math.random()` each frame; tests pass fixed values for assertions.
 *
 * Decay model: quadratic ease-out so the shake front-loads the energy and
 * settles smoothly.  Y-axis is damped to 60 % of X so the camera feels natural
 * (heavy horizontal bias).
 */
export function shakeOffset(
  mag: number,
  elapsed: number,
  dur: number,
  randX: number,
  randY: number,
): { sx: number; sy: number } {
  if (mag <= 0 || dur <= 0 || elapsed >= dur) return { sx: 0, sy: 0 };
  const k = 1 - elapsed / dur;        // linear falloff 1 → 0
  const amp = mag * k * k;             // quadratic ease-out
  return {
    sx: (randX * 2 - 1) * amp,
    sy: (randY * 2 - 1) * amp * 0.6,
  };
}

// ---------------------------------------------------------------------------
// Shared crawler behaviours (ARCH-06 twin hoist)
// ---------------------------------------------------------------------------
//
// The mine and forest engines share ~5 near-identical functions (spell casting,
// rune triggers, co-op contact/damage, boon resolution).  They live here, generic
// over the run-state (`TState`) and unit (`TUnit`) shapes, with every content lookup
// (MINE_MONSTERS / FOREST_BEASTS, touchDamage, killMonster / killBeast) injected via
// a small callback bag so this file stays content/store/net-free.  Each engine keeps
// its own thin wrapper (`castSpell`, `triggerRunes`, …) that supplies concrete caps.

/** Spell cooldown shared by both crawlers (ms). */
export const CRAWL_SPELL_CD_MS = 500;

/**
 * The unit fields the shared crawler bodies read or write directly.  Both
 * `MineMonster` and `ForestBeast` are structurally assignable to this — the
 * engine-specific fields (`asleep`, `windupUntilMs`, `flees` on the def) are never
 * touched here; they only appear inside injected callbacks.
 */
export interface CrawlUnit {
  id: string;
  key: string;
  r: number;
  c: number;
  hp: number;
  maxHp: number;
  readyAtMs: number;
  frozenUntilMs?: number;
  poisonDmg?: number;
  poisonNextTickMs?: number;
  poisonExpiresMs?: number;
}

/** Run-state fields the shared spell/rune/contact bodies touch. */
export interface CrawlRunState {
  status: 'active' | 'ended' | 'banking' | 'choosing';
  player: { r: number; c: number; facing: Dir };
  rows: number;
  cols: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  sta: number;
  maxSta: number;
  staNextRegenMs: number;
  mpNextRegenMs: number;
  defense: number;
  ward: number;
  damageSpell: number;
  supportSpell: number;
  illusionPower: number;
  knownSpells: string[];
  activeBoons: string[];
  playerStatuses: CrawlStatusEffect[];
  runes: CrawlRune[];
  nextRuneId: number;
  ringOfFire: CrawlRingOfFire | null;
  ringNextHitMs: Record<string, number>;
  lastHitAtMs: number;
  lastSpellMs: number;
}

/** Clone-on-write a single tile in a 2D tile grid — clones only the mutated row, not
 *  the whole grid. `strike()`/`placeTombstone()` (mine), `act()`/`activateShrine()`
 *  (forest), and `crawlPickupBoonCache` all did a full-grid `tiles.map(row =>
 *  row.slice())` for a single-cell change before 5.3. */
export function setTile<TTile>(tiles: TTile[][], r: number, c: number, tile: TTile): TTile[][] {
  const next = tiles.slice();
  next[r] = next[r].slice();
  next[r][c] = tile;
  return next;
}

/** Passive stamina/mp regen, shared by `stepMonsters` (mine), `stepBeasts` (forest), and
 *  {@link crawlCoopClientStep} — was tripled verbatim across all three before 5.3. */
export function applyPassiveRegen<TState extends CrawlRunState>(state: TState, nowMs: number): TState {
  let s = state;
  if (nowMs >= s.staNextRegenMs && s.sta < s.maxSta) {
    s = { ...s, sta: Math.min(s.maxSta, s.sta + 1), staNextRegenMs: nowMs + STA_REGEN_MS };
  }
  if (nowMs >= s.mpNextRegenMs && s.mp < s.maxMp) {
    s = { ...s, mp: Math.min(s.maxMp, s.mp + 1), mpNextRegenMs: nowMs + MP_REGEN_MS };
  }
  return s;
}

/** Read/write the engine's unit list (`s.monsters` vs `s.beasts`) + resolve a kill. */
export interface CrawlUnitCaps<TState, TUnit> {
  unitsOf(s: TState): TUnit[];
  withUnits(s: TState, units: TUnit[]): TState;
  /** Per-engine killMonster / killBeast — grants loot and may end the run. */
  killUnit(s: TState, unit: TUnit, rng: RNG): TState;
}

/** Caps for {@link crawlCastSpell}. */
export interface CrawlSpellCaps<TState, TUnit> extends CrawlUnitCaps<TState, TUnit> {
  isWalkableAt(s: TState, r: number, c: number): boolean;
  unitAt(s: TState, r: number, c: number): TUnit | undefined;
  nearestUnit(s: TState): TUnit | null;
  /** Combat def for weak/resist/defense lookup (engine defs type these as `string[]`). */
  unitDef(unit: TUnit): { defense?: number; weakTo?: string[]; resistTo?: string[] } | undefined;
  /** Mine targets the faced cell first then nearest; forest targets nearest only. */
  preferFaced: boolean;
  /** Optional post-teleport hook (forest reveals fog of war). */
  afterTeleport?(s: TState): TState;
}

/** Caps for {@link crawlTriggerRunes}. */
export interface CrawlRuneCaps<TState, TUnit> extends CrawlUnitCaps<TState, TUnit> {
  iframeMs: number;
}

/** Caps for {@link crawlCoopClientStep}. */
export interface CrawlContactCaps<TState, TUnit> {
  unitsOf(s: TState): TUnit[];
  /** The non-adjacency toucher predicate (mine: not frozen; forest: awake predator, not frozen). */
  canStrike(unit: TUnit, nowMs: number): boolean;
  /** Depth-scaled raw contact damage before mitigation (reads content touchDamage). */
  contactRaw(unit: TUnit, s: TState): number;
  defenseBonus(boons: string[]): number;
  iframeMs: number;
}

/** Boon-pick state fields + caps for {@link crawlApplyBoonChoice}. */
export interface CrawlBoonState {
  status: 'active' | 'ended' | 'banking' | 'choosing';
  pendingBoonChoice: string[] | null;
  activeBoons: string[];
  agLevel: number;
  maxHp: number;
  hp: number;
  moveIntervalMs: number;
  dashCooldownMs: number;
}
export interface CrawlBoonCaps {
  getBoon(key: string): CrawlBoon | undefined;
  boonMoveMult(boons: string[]): number;
  boonDashCdMult(boons: string[]): number;
}

/**
 * Cast a spell inside a crawler run (shared body).  Guard order is standardised on
 * the mine's (status → known → exists → mp → cooldown), so an unknown spell key is
 * rejected in BOTH crawlers (ARCH-03: the forest previously let a guest/dev-tool cast
 * any key).  Targeting is forked via `caps.preferFaced` — everything else is identical.
 */
export function crawlCastSpell<TState extends CrawlRunState, TUnit extends CrawlUnit>(
  state: TState,
  spellKey: string,
  nowMs: number,
  rng: RNG,
  caps: CrawlSpellCaps<TState, TUnit>,
): TState {
  if (state.status !== 'active') return state;
  if (!state.knownSpells.includes(spellKey)) return state;
  const spell = getSpell(spellKey);
  if (!spell || state.mp < spell.mpCost) return state;
  if (nowMs - state.lastSpellMs < CRAWL_SPELL_CD_MS) return state;

  let s: TState = { ...state, mp: state.mp - spell.mpCost, lastSpellMs: nowMs };
  const schoolStat = SCHOOL_STAT[spell.school];

  const pickTarget = (): TUnit | null => {
    if (caps.preferFaced) {
      const { r, c } = facedCell(s.player);
      return caps.unitAt(s, r, c) ?? caps.nearestUnit(s);
    }
    return caps.nearestUnit(s);
  };

  // Rune placement (on the faced floor tile)
  if (spell.mechanic === 'rune-fire' || spell.mechanic === 'rune-ice' || spell.mechanic === 'rune-poison') {
    const kind = spell.mechanic.slice(5) as 'fire' | 'ice' | 'poison';
    const { r, c } = facedCell(s.player);
    if (caps.isWalkableAt(s, r, c)) {
      const { dealt } = spellDamageRoll(spell.power, s.damageSpell, schoolStat, [], [], 0, rng);
      const rune: CrawlRune = { id: s.nextRuneId, r, c, kind, power: dealt, expiresAtMs: nowMs + 30000 };
      s = { ...s, runes: [...s.runes, rune], nextRuneId: s.nextRuneId + 1 };
    }
    return s;
  }

  // Ring of fire
  if (spell.mechanic === 'ring-of-fire') {
    const dmg = Math.max(2, Math.round(spell.power + s.damageSpell * 0.5));
    return { ...s, ringOfFire: { expiresAtMs: nowMs + RING_DURATION_MS, dmg }, ringNextHitMs: {} };
  }

  // Teleport to a random open cell 3-6 steps away
  if (spell.mechanic === 'teleport') {
    const { r: pr, c: pc } = s.player;
    const candidates: Array<{ r: number; c: number }> = [];
    for (let row = 0; row < s.rows; row++) {
      for (let col = 0; col < s.cols; col++) {
        const d = manhattan({ r: row, c: col }, { r: pr, c: pc });
        if (d >= 3 && d <= 6 && caps.isWalkableAt(s, row, col) && !caps.unitAt(s, row, col)) {
          candidates.push({ r: row, c: col });
        }
      }
    }
    if (candidates.length > 0) {
      const dest = candidates[Math.floor(rng() * candidates.length)];
      s = { ...s, player: { ...s.player, r: dest.r, c: dest.c } };
    }
    return caps.afterTeleport ? caps.afterTeleport(s) : s;
  }

  // Damage spell: hit the faced/nearest unit, apply status.
  if (spell.school === 'damage') {
    const target = pickTarget();
    if (target) {
      const def = caps.unitDef(target);
      const { dealt } = spellDamageRoll(
        spell.power, s.damageSpell, schoolStat,
        (def?.weakTo ?? []) as StatId[],
        (def?.resistTo ?? []) as StatId[],
        def?.defense ?? 0, rng,
      );
      const newHp = target.hp - dealt;
      if (newHp <= 0) {
        s = caps.killUnit(s, target, rng);
      } else {
        let units: TUnit[] = caps.unitsOf(s).map((u) => (u.id === target.id ? { ...u, hp: newHp } : u));
        if (spell.status) {
          const key = spell.status.key;
          if (key === 'burn' || key === 'poison') {
            const magnitude = spell.status.magnitude;
            const durationMs = spell.status.turns * DOT_TICK_MS;
            units = units.map((u) =>
              u.id === target.id
                ? { ...u, poisonDmg: Math.max(u.poisonDmg ?? 0, magnitude), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + durationMs }
                : u,
            );
          } else if (key === 'freeze') {
            units = units.map((u) =>
              u.id === target.id ? { ...u, frozenUntilMs: nowMs + FREEZE_DURATION_MS } : u,
            );
          }
        }
        s = caps.withUnits(s, units);
      }
    }
    return s;
  }

  // Support spell: heal HP, apply player status (bless)
  if (spell.school === 'support') {
    if (spell.power > 0) {
      const heal = spellHealAmount(spell.power, s.supportSpell);
      s = { ...s, hp: Math.min(s.maxHp, s.hp + heal) };
    }
    if (spell.status) {
      const { key, magnitude, turns } = spell.status;
      s = {
        ...s,
        playerStatuses: applyStatus(s.playerStatuses, { key: key as CrawlStatusEffect['key'], magnitude, durationMs: turns * DOT_TICK_MS }, nowMs),
      };
    }
    return s;
  }

  // Illusion spell: debuff the faced/nearest unit.
  if (spell.school === 'illusion' && spell.status) {
    const target = pickTarget();
    if (target) {
      const { key, magnitude, turns } = spell.status;
      // BAL-07: CH extends illusion duration on the same floor(CH/4) slope as turn-combat
      // (magnitude stays untouched here — in the crawler it's DoT damage/tick, not the weaken fraction).
      const durationMs = (turns + Math.floor(s.illusionPower / 4)) * DOT_TICK_MS;
      if (key === 'freeze') {
        s = caps.withUnits(s, caps.unitsOf(s).map((u) =>
          u.id === target.id ? { ...u, frozenUntilMs: nowMs + Math.max(FREEZE_DURATION_MS, durationMs) } : u,
        ));
      } else if (key === 'poison') {
        s = caps.withUnits(s, caps.unitsOf(s).map((u) =>
          u.id === target.id
            ? { ...u, poisonDmg: Math.max(u.poisonDmg ?? 0, magnitude), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + durationMs }
            : u,
        ));
      }
    }
    return s;
  }

  return s;
}

/**
 * Trigger any runes stepped on by the player or a unit this tick (shared body).
 * ARCH-02: the survivor filter drops expired runes UNCONDITIONALLY (was gated on
 * `triggered.size > 0` in the forest, so forest runes never expired on quiet ticks).
 */
export function crawlTriggerRunes<TState extends CrawlRunState, TUnit extends CrawlUnit>(
  state: TState,
  nowMs: number,
  rng: RNG,
  caps: CrawlRuneCaps<TState, TUnit>,
): TState {
  if (state.runes.length === 0) return state;

  const triggered = new Set<number>();
  let s = state;

  const fireRune = (rune: CrawlRune, unitId: string | null) => {
    triggered.add(rune.id);
    if (unitId === null) {
      // Hit player
      if (nowMs - s.lastHitAtMs >= caps.iframeMs) {
        const dealt = Math.max(1, Math.round(rune.power * 0.5) - s.ward);
        s = { ...s, hp: Math.max(0, s.hp - dealt), lastHitAtMs: nowMs };
        if (s.hp <= 0) s = { ...s, status: 'ended' };
      }
    } else {
      const unit = caps.unitsOf(s).find((u) => u.id === unitId);
      if (!unit) return;
      const newHp = unit.hp - rune.power;
      if (newHp <= 0) {
        s = caps.killUnit(s, unit, rng);
      } else {
        let units: TUnit[] = caps.unitsOf(s).map((u) => (u.id === unitId ? { ...u, hp: newHp } : u));
        if (rune.kind === 'fire') {
          units = units.map((u) =>
            u.id === unitId
              ? { ...u, poisonDmg: Math.max(u.poisonDmg ?? 0, Math.round(rune.power * 0.3)), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + DOT_TICK_MS * 3 }
              : u,
          );
        } else if (rune.kind === 'ice') {
          units = units.map((u) =>
            u.id === unitId ? { ...u, frozenUntilMs: nowMs + FREEZE_DURATION_MS } : u,
          );
        } else if (rune.kind === 'poison') {
          units = units.map((u) =>
            u.id === unitId
              ? { ...u, poisonDmg: Math.max(u.poisonDmg ?? 0, Math.round(rune.power * 0.25)), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + DOT_TICK_MS * 4 }
              : u,
          );
        }
        s = caps.withUnits(s, units);
      }
    }
  };

  // Check if the player stepped on a rune
  for (const rune of s.runes) {
    if (triggered.has(rune.id)) continue;
    if (rune.r === s.player.r && rune.c === s.player.c) {
      fireRune(rune, null);
    }
  }
  // Check if any unit stepped on a rune
  for (const unit of caps.unitsOf(s)) {
    for (const rune of s.runes) {
      if (triggered.has(rune.id)) continue;
      if (rune.r === unit.r && rune.c === unit.c) {
        fireRune(rune, unit.id);
      }
    }
  }

  // Expire triggered + timed-out runes (ARCH-02: prune expired even on a quiet tick).
  const survivors = s.runes.filter((r) => !triggered.has(r.id) && r.expiresAtMs > nowMs);
  return { ...s, runes: survivors };
}

/**
 * Co-op guest per-tick: advance only the LOCAL body — sta/mp regen, own contact
 * damage from an adjacent striker (i-frame gated), status pruning.  Host owns unit
 * movement/AI/kills.  ARCH-04: contact mitigation is unified with the mine's rule —
 * baseline defense always applies, bless adds its magnitude on top, ward no longer
 * reduces contact damage (it still mitigates rune/spell hits).
 */
export function crawlCoopClientStep<TState extends CrawlRunState, TUnit extends CrawlUnit>(
  state: TState,
  nowMs: number,
  caps: CrawlContactCaps<TState, TUnit>,
): TState {
  if (state.status !== 'active') return state;
  let s = applyPassiveRegen(state, nowMs);

  let hp = s.hp;
  let lastHitAtMs = s.lastHitAtMs;
  if (nowMs - s.lastHitAtMs >= caps.iframeMs) {
    const toucher = caps.unitsOf(s).find((u) => caps.canStrike(u, nowMs) && adjacent(u, s.player));
    if (toucher) {
      const raw = caps.contactRaw(toucher, s);
      const bless = activeStatus(s.playerStatuses, 'bless', nowMs);
      const dealt = Math.max(1, raw - s.defense - (bless ? bless.magnitude : 0) - caps.defenseBonus(s.activeBoons));
      hp = Math.max(0, hp - dealt);
      lastHitAtMs = nowMs;
    }
  }

  const playerStatuses = pruneStatuses(s.playerStatuses, nowMs);
  if (hp === s.hp && lastHitAtMs === s.lastHitAtMs && s === state) return state;
  return { ...s, hp, lastHitAtMs, playerStatuses, status: hp <= 0 ? 'ended' : s.status };
}

/**
 * Host-side: apply a remote player's attack to a unit by id, so a kill resolves
 * exactly once on the authoritative host.  Shared by the mine/forest wrappers.
 */
export function crawlDamageUnitById<TState extends CrawlRunState, TUnit extends CrawlUnit>(
  state: TState,
  unitId: string,
  dmg: number,
  rng: RNG,
  caps: CrawlUnitCaps<TState, TUnit>,
): TState {
  if (state.status !== 'active' || dmg <= 0) return state;
  const unit = caps.unitsOf(state).find((u) => u.id === unitId);
  if (!unit) return state;
  const newHp = unit.hp - dmg;
  if (newHp <= 0) return caps.killUnit(state, unit, rng);
  return caps.withUnits(state, caps.unitsOf(state).map((u) => (u.id === unitId ? { ...u, hp: newHp } : u)));
}

/**
 * Resolve the player's boon pick (shared body): appends the chosen key to
 * `activeBoons`, clears `pendingBoonChoice`, restores `status:'active'`, and
 * recomputes `moveIntervalMs`/`dashCooldownMs` so a speed boon is felt immediately.
 * No-ops if no choice is pending or the key is not in the offered set.
 */
export function crawlApplyBoonChoice<T extends CrawlBoonState>(
  state: T,
  key: string,
  caps: CrawlBoonCaps,
): T {
  if (state.status !== 'choosing') return state;
  if (!state.pendingBoonChoice?.includes(key)) return state;
  const boon = caps.getBoon(key);
  if (!boon) return state;
  const activeBoons = [...state.activeBoons, key];
  const hpBonus = boon.maxHpBonus ?? 0;
  return {
    ...state,
    activeBoons,
    pendingBoonChoice: null,
    status: 'active',
    moveIntervalMs: Math.round(moveInterval(state.agLevel) / caps.boonMoveMult(activeBoons)),
    dashCooldownMs: Math.round(dashCooldown(state.agLevel) * caps.boonDashCdMult(activeBoons)),
    maxHp: state.maxHp + hpBonus,
    hp: Math.min(state.maxHp + hpBonus, state.hp + hpBonus),
  };
}

// ---------------------------------------------------------------------------
// Death/stash forfeit (2.3 — hoisted out of forest.ts; mine cross-imported it from
// there, which meant an engine-layer feature ("mine" pulling reward-split logic from
// "forest") had no home of its own. Shared code belongs in crawl.ts.)
// ---------------------------------------------------------------------------

/** Caps for {@link crawlPickupBoonCache}. */
export interface CrawlBoonCacheCaps<TState, TTile> {
  tilesOf(s: TState): TTile[][];
  withTiles(s: TState, tiles: TTile[][]): TState;
  /** The tile a cleared boon cache becomes (mine: `{kind:'floor'}`, forest: `{kind:'trail'}`). */
  emptyTile: TTile;
}

/**
 * Open a boon cache at (r, c): clears the tile, rolls up to 3 choices, and either enters
 * 'choosing' or grants the exhausted-pool consolation prize (2.4). Shared body behind
 * mine's mineStrike (deliberate press on the tile) and forest's forestMove (walk-onto) —
 * both open the same cache mechanic, just from different input events. Mine wires this;
 * forest's own call site (forestSlice.ts) is a follow-up, not part of this change.
 */
export function crawlPickupBoonCache<
  TState extends CrawlBoonState & { haul: { gold?: number } },
  TTile,
>(
  state: TState,
  r: number,
  c: number,
  game: 'mine' | 'forest',
  rng: RNG,
  caps: CrawlBoonCacheCaps<TState, TTile>,
): TState {
  const tiles = setTile(caps.tilesOf(state), r, c, caps.emptyTile);
  const cleared = caps.withTiles(state, tiles);
  const choices = rollBoonChoices(game, cleared.activeBoons, rng);
  if (choices.length === 0) return boonConsolation(cleared);
  return { ...cleared, pendingBoonChoice: choices, status: 'choosing' };
}

/** Split a haul into the portion the player keeps and the portion forfeited. */
export function splitHaul(haul: Reward, keepFraction: number): { kept: Reward; lost: Reward } {
  const kept: Reward = {};
  const lost: Reward = {};
  if (haul.gold) {
    const k = Math.floor(haul.gold * keepFraction);
    if (k > 0) kept.gold = k;
    if (haul.gold - k > 0) lost.gold = haul.gold - k;
  }
  if (haul.materials) {
    for (const [mat, qty] of Object.entries(haul.materials)) {
      const k = Math.floor(qty * keepFraction);
      if (k > 0) (kept.materials ??= {})[mat] = k;
      if (qty - k > 0) (lost.materials ??= {})[mat] = qty - k;
    }
  }
  return { kept, lost };
}
