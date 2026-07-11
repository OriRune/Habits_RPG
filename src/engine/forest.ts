// The Wild Forest — a large, scrolling, real-time foraging + combat minigame.
// Pure rules; randomness is injected so the engine is fully unit-testable.
//
// The forest is a large recursive-backtracker maze (≈33×33 on stage 1, scaling
// up with depth) viewed through an 11×11 scrolling camera window.  Impassable
// thicket takes the place of bedrock — it can't be cut through.  Node gathering
// is instant (one action); beasts use BFS pathfinding and lie dormant until the
// player enters their aggro radius (the ambush).  Fog of war is retained.
//
// Combat mirrors the mine (same damage math from src/engine/combat.ts, equipped
// weapon, known spells, BFS-pathfinding beasts with defense/weakTo/resistTo).
//
// Every rule is a pure function returning a new ForestState — the store owns
// the state, and a thin loop (src/hooks/useForestLoop.ts) decides *when* to
// call these.  No React, no store imports — fully unit-testable.

import type { Reward } from './challenges';
import type { StatId } from './stats';
import { mergeReward } from './dungeon';
import { attackRoll } from './combat';
import type { WeaponDef } from './weapons';
import { FOREST_NODES, FOREST_BEASTS, FOREST_GUARDIAN_STAGES, SHRINE_EVENTS, type ForestNodeDef } from '@/content/forest';
import { BOONS } from '@/content/boons';
import { bandForStage, FOREST_BANDS } from './crawlBiomes';

/** First stage of the deepest (open-ended) band — anchor for late-depth damage scaling. */
const ANCIENT_BAND_START = FOREST_BANDS[FOREST_BANDS.length - 1].depthMin;
import {
  type Dir,
  type RNG,
  type CrawlRune,
  type CrawlStatusEffect,
  type CrawlRingOfFire,
  DIRS,
  randInt,
  floodFieldMulti,
  flowStep,
  adjacent,
  manhattan,
  CRAWL_SPAWN_SAFE_RADIUS,
  applyStatus,
  pruneStatuses,
  activeStatus,
  DOT_TICK_MS,
  RING_HIT_CD_MS,
  STA_REGEN_MS,
  MP_REGEN_MS,
  applyPassiveRegen,
  setTile,
  DASH_BASE_CD_MS,
  STAGGER_MS,
  CHARGE_DAMAGE_MULT,
  dashCooldown,
  moveInterval,
  boonConsolation,
  boonMeleeMult,
  boonDefenseBonus,
  boonYieldMult,
  boonMoveMult,
  boonDashCdMult,
  boonSightBonus,
  rollBoonChoices,
  lateDepthDamageScale,
  crawlCastSpell,
  crawlTriggerRunes,
  crawlCoopClientStep,
  crawlDamageUnitById,
  crawlApplyBoonChoice,
  type CrawlSpellCaps,
  type CrawlRuneCaps,
  type CrawlContactCaps,
  type CrawlUnitCaps,
} from './crawl';

export type { Dir, RNG } from './crawl';

// ---------------------------------------------------------------------------
// Map constants
// ---------------------------------------------------------------------------

export const FOREST_BASE_ROWS = 33;
export const FOREST_BASE_COLS = 33;
export const FOREST_MAX_ROWS = 57;
export const FOREST_MAX_COLS = 57;
/** The map grows by this many cells per stage band. */
const FOREST_SCALE_PER_BAND = 4;
/** Stages per growth band. */
const FOREST_SCALE_BAND = 4;

/** Backward-compat aliases (tests / old references). */
export const FOREST_ROWS = FOREST_BASE_ROWS;
export const FOREST_COLS = FOREST_BASE_COLS;

/** Run entry gate (parallel to the mine). */
export const FOREST_ENERGY_COST = 2;
/** Fraction of the haul a fallen forager keeps; the rest is forfeit on death. */
export const FOREST_DEATH_KEEP = 0.5;
/** Fraction of the haul kept when stashing mid-run at a clearing (20% is the "hurry tax"). */
export const FOREST_STASH_KEEP = 0.8;

/** Invulnerability window after taking a contact hit (ms). */
export const FOREST_IFRAME_MS = 800;
/** How far you can see in the dark forest (Chebyshev radius). */
export const SIGHT_RADIUS = 3;
const CLEARING_SIGHT_RADIUS = 4;

/** Stamina cost per weapon swing against a beast. */
const SLASH_STA_COST = 2;
/** Stamina cost per axe swing against a choppable tree. */
const CHOP_STA_COST = 1;
/** Stamina cost per ranged shot (bow). */
const ARROW_STA_COST = 1;
/** How long before a winding-up beast actually strikes (ms). */
export const FOREST_WINDUP_MS = 360;
/** Spell effect cooldown between casts (ms). */
const SPELL_CD_MS = 500;

// ---------------------------------------------------------------------------
// Tile types
// ---------------------------------------------------------------------------

export type ForestTileKind = 'trail' | 'thicket' | 'tree' | 'clearing' | 'entrance' | 'treeline' | 'node' | 'shrine' | 'boon';

/** The entrance and clearings are the safe harbours where a full-value (1.0) end-bank is paid
 *  (BAL-12) — the same clearings that gate forestStash. Banking elsewhere keeps FOREST_STASH_KEEP. */
export function isForestSafeBankTile(kind: ForestTileKind | undefined): boolean {
  return kind === 'entrance' || kind === 'clearing';
}

/**
 * The deepest stage a SOLO run may start on: the deepest guardian boundary the player has
 * already descended PAST (strictly below `deepest`), else stage 1. Reuses the persisted
 * deepestForestStage as the "guardian beaten" proxy — no new field, no persist bump (BAL-25).
 */
export function unlockedStartStage(deepest: number): number {
  let start = 1;
  for (const g of Object.keys(FOREST_GUARDIAN_STAGES).map(Number)) {
    if (g < deepest) start = Math.max(start, g);
  }
  return start;
}

export interface ForestTile {
  kind: ForestTileKind;
  /** Blade swings left before thicket is cut open (thicket only — legacy; thicket is now permanent). */
  durability?: number;
  maxDurability?: number;
  /** Which gatherable this tile holds (node only — keys FOREST_NODES). */
  nodeKey?: string;
  /** Which shrine event this tile holds (shrine only — keys SHRINE_EVENTS). */
  shrineKey?: string;
}

// ---------------------------------------------------------------------------
// Beast type (real-time entity)
// ---------------------------------------------------------------------------

export interface ForestBeast {
  id: string;
  key: string;
  r: number;
  c: number;
  hp: number;
  maxHp: number;
  /** ms-timeline moment this beast may next step. */
  readyAtMs: number;
  /** Dormant beasts don't move or strike until the player enters their aggroRadius. */
  asleep: boolean;
  /** Frozen until this ms timestamp (ice spell / rune). */
  frozenUntilMs?: number;
  /** Ongoing poison/burn DoT damage per tick. */
  poisonDmg?: number;
  poisonNextTickMs?: number;
  poisonExpiresMs?: number;
  /**
   * Telegraph: the ms timestamp when the beast's wind-up expires and it may strike.
   * Undefined = not yet adjacent. Set on the first tick the beast becomes adjacent;
   * cleared again if the player escapes before the windup expires.
   */
  windupUntilMs?: number;
}

// ---------------------------------------------------------------------------
// Snapshot & run state
// ---------------------------------------------------------------------------

/** Character combat profile snapshotted at the start of a run. */
export interface ForestSnapshot {
  meleePower: number;
  rangedPower: number;
  damageSpell: number;
  supportSpell: number;
  illusionPower: number;
  defense: number;
  ward: number;
  maxHp: number;
  maxSta: number;
  maxMp: number;
  weapon: WeaponDef;
  knownSpells: string[];
  /** Equipped tool's chopping power (1 = one swing per durability, 2 = one-shots tier-2 trees, etc.). */
  chopPower: number;
  /** Agility level — drives dash cooldown and move speed. */
  agLevel: number;
  /** Active boon keys carried from the previous stage. Optional so callers that
   *  construct a snapshot literal without boons (e.g. beginForest) don't break. */
  activeBoons?: string[];
  /** Homestead Watchtower sight bonus (0 or 1) snapshotted at run start. Optional so
   *  callers without a town perk (or old saves) default to 0. See sightRadiusFor. */
  sightBonus?: number;
}

export interface ForestState {
  stage: number;
  rows: number;
  cols: number;
  tiles: ForestTile[][];
  /** Fog memory — `seen[r][c]` once the tile has ever entered the sight radius. */
  seen: boolean[][];
  player: { r: number; c: number; facing: Dir };
  // HP / stamina / mana
  hp: number;
  maxHp: number;
  sta: number;
  maxSta: number;
  mp: number;
  maxMp: number;
  // Regen timestamps
  staNextRegenMs: number;
  mpNextRegenMs: number;
  // Combat stats (snapshotted)
  meleePower: number;
  rangedPower: number;
  damageSpell: number;
  supportSpell: number;
  illusionPower: number;
  defense: number;
  ward: number;
  weapon: WeaponDef;
  knownSpells: string[];
  chopPower: number;
  // Entities
  beasts: ForestBeast[];
  // Loot
  haul: Reward;
  // Status
  status: 'active' | 'ended' | 'banking' | 'choosing';
  lastHitAtMs: number;
  deepest: number;
  killsThisStage: number;
  /** Accumulated run score: +10×stage per kill, +100×stage on each advance. */
  score: number;
  // Phase 5: in-run boons
  /** Keys of boons active for this run (empty at stage 1; carried across stages via snapshot). */
  activeBoons: string[];
  /** Keys of the 3 offered boon choices; null when no choice is pending. */
  pendingBoonChoice: string[] | null;
  // Spell effects
  runes: CrawlRune[];
  ringOfFire: CrawlRingOfFire | null;
  ringNextHitMs: Record<string, number>;
  playerStatuses: CrawlStatusEffect[];
  lastSpellMs: number;
  nextRuneId: number;
  /** Transient: where the last ranged shot travelled — used to render a tracer in the overlay. */
  lastShot?: { fromR: number; fromC: number; toR: number; toC: number; at: number } | null;
  // Phase 1: dash + AG-derived timing
  /** Timestamp of the last successful dash (ms). Negative = ready immediately. */
  lastDashMs: number;
  /** Dash cooldown computed from AG at run start (ms). */
  dashCooldownMs: number;
  /** Move cadence computed from AG at run start (ms). */
  moveIntervalMs: number;
  /** Agility level snapshot — preserved across stages. */
  agLevel: number;
  /** Homestead Watchtower sight bonus (0 or 1), snapshotted at run start and carried
   *  across stages via forestSnapshot. Added by sightRadiusFor. */
  sightBonus?: number;
}

/**
 * Re-anchor a persisted run's timestamps for a fresh page session.
 *
 * Every `*Ms` field is stamped from the rAF clock (ms since page load), which
 * restarts near 0 on reload — a rehydrated run would otherwise stall until the
 * new session's clock caught up to the old session's uptime. Cooldowns reset
 * to "ready" (mirroring the fresh-run init values) and transient timed effects
 * (runes, ring of fire, statuses, freezes, DoTs, windups) simply expire:
 * losing a few seconds of buffs on reload beats a stalled run.
 */
export function rebaseForestRun(run: ForestState): ForestState {
  return {
    ...run,
    staNextRegenMs: 0,
    mpNextRegenMs: 0,
    lastHitAtMs: -FOREST_IFRAME_MS,
    lastSpellMs: -SPELL_CD_MS,
    lastDashMs: -DASH_BASE_CD_MS,
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    lastShot: null,
    beasts: (run.beasts ?? []).map((b) => ({
      ...b,
      readyAtMs: 0,
      frozenUntilMs: undefined,
      poisonDmg: undefined,
      poisonNextTickMs: undefined,
      poisonExpiresMs: undefined,
      windupUntilMs: undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

export function tileAt(state: ForestState, r: number, c: number): ForestTile | undefined {
  return state.tiles[r]?.[c];
}

export function isWalkable(tile: ForestTile | undefined): boolean {
  return (
    !!tile &&
    (tile.kind === 'trail' || tile.kind === 'entrance' || tile.kind === 'clearing' ||
     tile.kind === 'treeline' || tile.kind === 'shrine' || tile.kind === 'boon')
  );
}

/** Whether the player is currently standing on an unactivated shrine. */
export function isOnShrine(state: ForestState): boolean {
  return tileAt(state, state.player.r, state.player.c)?.kind === 'shrine';
}

export function beastAt(state: ForestState, r: number, c: number): ForestBeast | undefined {
  return state.beasts.find((b) => b.r === r && b.c === c);
}

export function facedCell(state: ForestState): { r: number; c: number } {
  const [dr, dc] = DIRS[state.player.facing];
  return { r: state.player.r + dr, c: state.player.c + dc };
}

/** Id of the beast in the faced cell, if any (co-op guests send an attack intent for it). */
export function facedBeastId(state: ForestState): string | null {
  const { r, c } = facedCell(state);
  return beastAt(state, r, c)?.id ?? null;
}

/**
 * What a ranged shot would hit right now: the first beast down the faced line
 * within the weapon's range, plus the last cell the arrow reaches (walls,
 * trees, and nodes block it). Pure query — `act()`'s ranged branch and the
 * co-op guest's intent targeting share it, so the two can never drift.
 * Both fields are null when the equipped weapon isn't ranged.
 */
export function rangedScan(state: ForestState): {
  target: ForestBeast | null;
  shotTo: { r: number; c: number } | null;
} {
  if (!state.weapon.ranged || !state.weapon.range) return { target: null, shotTo: null };
  const [dr, dc] = DIRS[state.player.facing];
  const range = state.weapon.range;
  let shotTo: { r: number; c: number } | null = null;
  let target: ForestBeast | null = null;

  for (let i = 1; i <= range; i++) {
    const tr = state.player.r + dr * i;
    const tc = state.player.c + dc * i;
    const tile = tileAt(state, tr, tc);
    // Walls, trees, and nodes block the arrow.
    if (!tile || !isWalkable(tile)) { shotTo = { r: tr - dr, c: tc - dc }; break; }
    const b = beastAt(state, tr, tc);
    if (b) { target = b; shotTo = { r: tr, c: tc }; break; }
    shotTo = { r: tr, c: tc };
  }

  return { target, shotTo };
}

/**
 * Id of the beast a ranged shot would hit down the faced line, if any.
 * Co-op guests send an attack intent for it instead of resolving the kill
 * locally — a local kill would diverge from the host's authoritative world.
 */
export function rangedBeastId(state: ForestState): string | null {
  return rangedScan(state).target?.id ?? null;
}

/** Standing on the far tree line means the way deeper is open. */
export function canAdvance(state: ForestState): boolean {
  return tileAt(state, state.player.r, state.player.c)?.kind === 'treeline';
}

/**
 * Whether a tap on cell (r, c) should act rather than walk: a beast to attack
 * or a breakable tile (tree/node) to harvest — exactly what `act` resolves.
 */
export function tapStrikeableAt(state: ForestState, r: number, c: number): boolean {
  if (beastAt(state, r, c)) return true;
  const kind = tileAt(state, r, c)?.kind;
  return kind === 'tree' || kind === 'node';
}

/** Turn in place without stepping — tap-to-shoot aims down a line the player may not be facing. */
export function faceDir(state: ForestState, dir: Dir): ForestState {
  if (state.status !== 'active' || state.player.facing === dir) return state;
  return { ...state, player: { ...state.player, facing: dir } };
}

/**
 * Direction to face for a tap on (r, c) beyond adjacency: non-null when a
 * ranged shot fired that way would hit a beast at or before the tapped cell.
 * Delegates the line walk to `rangedScan` so tap and keyboard can never drift.
 */
export function rangedTapDir(state: ForestState, r: number, c: number): Dir | null {
  if (!state.weapon.ranged || !state.weapon.range) return null;
  const dr = r - state.player.r;
  const dc = c - state.player.c;
  if ((dr !== 0) === (dc !== 0)) return null; // exactly one axis: excludes own tile + diagonals
  const dist = Math.abs(dr) + Math.abs(dc);
  if (dist > state.weapon.range) return null;
  const dir: Dir = dr > 0 ? 'down' : dr < 0 ? 'up' : dc > 0 ? 'right' : 'left';
  const { target } = rangedScan(faceDir(state, dir));
  if (!target) return null;
  const hitDist = Math.abs(target.r - state.player.r) + Math.abs(target.c - state.player.c);
  return hitDist <= dist ? dir : null;
}

/** Current sight radius — wider in clearings, expanded by the Lantern boon and the Watchtower town perk. */
export function sightRadiusFor(state: ForestState): number {
  const base = tileAt(state, state.player.r, state.player.c)?.kind === 'clearing'
    ? CLEARING_SIGHT_RADIUS
    : SIGHT_RADIUS;
  return base + boonSightBonus(state.activeBoons) + (state.sightBonus ?? 0);
}

/** Circular sight test (≈ a disc so the lit area reads like a torch glow). */
function withinSight(dr: number, dc: number, rad: number): boolean {
  return dr * dr + dc * dc <= (rad + 0.5) * (rad + 0.5);
}

/** Whether a cell is inside the player's *current* sight (drives beast visibility). */
export function isVisible(state: ForestState, r: number, c: number): boolean {
  return withinSight(r - state.player.r, c - state.player.c, sightRadiusFor(state));
}

export type PendingActKind = 'advance' | 'attack' | 'shrine' | 'harvest' | 'chop' | 'none';

/** Returns what the next Act press will do — used by the overlay for a context hint label. */
export function pendingActKind(state: ForestState): PendingActKind {
  if (canAdvance(state)) return 'advance';
  const { r, c } = facedCell(state);
  if (beastAt(state, r, c)) return 'attack';
  if (isOnShrine(state)) return 'shrine';
  const tile = tileAt(state, r, c);
  if (tile?.kind === 'node') return 'harvest';
  if (tile?.kind === 'tree') return 'chop';
  return 'none';
}

/** Re-light the fog: mark every tile within the current sight radius as seen. */
export function reveal(state: ForestState): ForestState {
  const rad = sightRadiusFor(state);
  const seen = state.seen.map((row) => row.slice());
  for (let dr = -rad; dr <= rad; dr++) {
    for (let dc = -rad; dc <= rad; dc++) {
      if (!withinSight(dr, dc, rad)) continue;
      const rr = state.player.r + dr;
      const cc = state.player.c + dc;
      if (seen[rr]?.[cc] !== undefined) seen[rr][cc] = true;
    }
  }
  return { ...state, seen };
}

/** Nearest beast to the player (for damage-school spells). */
function nearestBeast(state: ForestState): ForestBeast | null {
  let best: ForestBeast | null = null;
  let bestDist = Infinity;
  for (const b of state.beasts) {
    const d = manhattan(b, state.player);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function eligibleNodes(stage: number): ForestNodeDef[] {
  const bandId = bandForStage(stage).id;
  return Object.values(FOREST_NODES).filter(
    (n) => n.stageMin <= stage && (!n.band || n.band === bandId),
  );
}

function weightedNode(stage: number, rng: RNG): ForestNodeDef {
  const pool = eligibleNodes(stage).filter((n) => n.weight > 0);
  const total = pool.reduce((a, n) => a + n.weight, 0);
  let roll = rng() * total;
  for (const n of pool) {
    roll -= n.weight;
    if (roll < 0) return n;
  }
  return pool[pool.length - 1];
}

/** Loot dropped by gathering one node (stamina is handled in the engine, not the haul). */
export function nodeYield(nodeKey: string, rng: RNG): Reward {
  const def = FOREST_NODES[nodeKey];
  if (!def) return {};
  if (def.grants.kind === 'stamina') return {};
  if (def.grants.kind === 'gold') {
    return { gold: randInt(def.grants.amount[0], def.grants.amount[1], rng) };
  }
  const amt = randInt(def.grants.amount[0], def.grants.amount[1], rng);
  return { materials: { [def.grants.material]: amt } };
}

/** Flat score bonus awarded for killing a band-gate guardian. */
const GUARDIAN_SCORE_BONUS = 500;

/** Guaranteed treasure loot when a band-gate guardian is slain. */
function guardianTreasure(stage: number, rng: RNG): Reward {
  if (stage <= 4) {
    // Grove Sentinel: Thicket → Deepwood gate; reward previews Deepwood-band materials.
    return { gold: randInt(20, 40, rng), materials: { crystals: 3, herbs: 2 } };
  }
  // Ancient Guardian: Deepwood → Ancient gate; reward previews Ancient-band materials.
  return { gold: randInt(40, 70, rng), materials: { amber_resin: 3, crystals: 2 } };
}

// ---------------------------------------------------------------------------
// Kill-loot helper
// ---------------------------------------------------------------------------

function killBeast(state: ForestState, beast: ForestBeast, rng: RNG): ForestState {
  const def = FOREST_BEASTS[beast.key];
  const isGuardian = !!def?.isGuardian;
  let drop: Reward;
  if (isGuardian) {
    drop = guardianTreasure(state.stage, rng);
  } else {
    const gold = def ? randInt(def.bounty[0], def.bounty[1], rng) : 0;
    // Prey carry a custom material/amount; predators default to leather scaled by kill streak.
    const matKey = def?.dropMaterial ?? 'leather';
    const qty = def?.dropAmount
      ? randInt(def.dropAmount[0], def.dropAmount[1], rng)
      : Math.max(1, Math.round(beast.maxHp / 10) + state.killsThisStage);
    drop = mergeReward(
      { materials: { [matKey]: qty } },
      gold > 0 ? { gold } : {},
    );
  }
  const afterKill: ForestState = {
    ...state,
    beasts: state.beasts.filter((b) => b.id !== beast.id),
    haul: mergeReward(state.haul, drop),
    killsThisStage: state.killsThisStage + 1,
    score: state.score + 10 * state.stage + (isGuardian ? GUARDIAN_SCORE_BONUS : 0),
  };
  // Guardian kill: offer a boon choice (pauses the run via 'choosing' status).
  // An exhausted pool rolls [] — grant a consolation instead; entering
  // 'choosing' with zero options would soft-lock the run.
  if (isGuardian) {
    const choices = rollBoonChoices('forest', afterKill.activeBoons, rng);
    if (choices.length === 0) return boonConsolation(afterKill);
    return { ...afterKill, pendingBoonChoice: choices, status: 'choosing' };
  }
  return afterKill;
}

// ---------------------------------------------------------------------------
// Flee helper — mirror of flowStep but maximises BFS distance (prey escaping).
// Local to forest.ts so the shared crawl.ts / mine stay untouched.
// ---------------------------------------------------------------------------

function fleeStep(
  from: { r: number; c: number },
  field: Map<string, number>,
  blocked: Set<string>,
): { r: number; c: number } | null {
  const curDist = field.get(`${from.r},${from.c}`) ?? 0;
  let best: { r: number; c: number } | null = null;
  let bestDist = -Infinity;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
    const nr = from.r + dr;
    const nc = from.c + dc;
    const key = `${nr},${nc}`;
    if (blocked.has(key)) continue;
    const d = field.get(key);
    if (d === undefined) continue; // not reachable / not walkable
    // Only flee if moving to a cell farther from the player.
    if (d > curDist && d > bestDist) { bestDist = d; best = { r: nr, c: nc }; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Generation — large recursive-backtracker maze
// ---------------------------------------------------------------------------

/**
 * Build a fresh forest stage as a large recursive-backtracker maze.
 * Size scales with depth: ~33×33 at stage 1, growing every few stages.
 */
export function generateForest(stage: number, snapshot: ForestSnapshot, rng: RNG): ForestState {
  // Carry boons forward from the snapshot (absent on the very first call from beginForest).
  const activeBoons: string[] = snapshot.activeBoons ?? [];

  const band = Math.floor((stage - 1) / FOREST_SCALE_BAND);
  // Ensure dimensions are odd so the lattice carve works cleanly.
  const rawRows = Math.min(FOREST_MAX_ROWS, FOREST_BASE_ROWS + band * FOREST_SCALE_PER_BAND);
  const rawCols = Math.min(FOREST_MAX_COLS, FOREST_BASE_COLS + band * FOREST_SCALE_PER_BAND);
  const rows = rawRows % 2 === 0 ? rawRows + 1 : rawRows;
  const cols = rawCols % 2 === 0 ? rawCols + 1 : rawCols;

  // Start with all impassable thicket.
  const tiles: ForestTile[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ kind: 'thicket' as ForestTileKind })),
  );

  // Recursive-backtracker maze carve — odd cells are "rooms", even cells between
  // them are passages knocked open by the carve.
  const oddCols: number[] = [];
  for (let c = 1; c < cols - 1; c += 2) oddCols.push(c);
  const startC = oddCols[Math.floor(rng() * oddCols.length)];

  const inLattice = (r: number, c: number) =>
    r >= 1 && r < rows - 1 && c >= 1 && c < cols - 1 && r % 2 === 1 && c % 2 === 1;
  const visited = new Set<string>();
  const carve = (r: number, c: number) => {
    visited.add(`${r},${c}`);
    tiles[r][c] = { kind: 'trail' };
    const steps: [number, number][] = [[-2, 0], [2, 0], [0, -2], [0, 2]];
    // Fisher–Yates shuffle for a unique maze each run.
    for (let i = steps.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [steps[i], steps[j]] = [steps[j], steps[i]];
    }
    for (const [dr, dc] of steps) {
      const nr = r + dr;
      const nc = c + dc;
      if (inLattice(nr, nc) && !visited.has(`${nr},${nc}`)) {
        tiles[r + dr / 2][c + dc / 2] = { kind: 'trail' };
        carve(nr, nc);
      }
    }
  };
  carve(1, startC);

  // Entrance gap at top and tree-line exit at bottom.
  tiles[0][startC] = { kind: 'entrance' };
  const exitC = oddCols[Math.floor(rng() * oddCols.length)];
  tiles[rows - 1][exitC] = { kind: 'treeline' };

  // Spawn safety: the player starts on the entrance tile, and every beast placement
  // below keeps at least CRAWL_SPAWN_SAFE_RADIUS away from it — a fresh stage must
  // never open with a beast already inside aggro range of a player who hasn't moved.
  const playerSpawn = { r: 0, c: startC };

  // --- Scatter nodes, clearing rooms, choppable trees, and beasts ---
  const shuffle = <T,>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const roomCells: [number, number][] = [];
  for (let r = 1; r < rows - 1; r += 2) {
    for (let c = 1; c < cols - 1; c += 2) {
      if (tiles[r][c].kind === 'trail') roomCells.push([r, c]);
    }
  }
  const cellDegree = (r: number, c: number) =>
    [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([nr, nc]) => isWalkable(tiles[nr]?.[nc])).length;

  // Dead-ends (degree 1) are ideal node placement.
  const deadEnds = shuffle(
    roomCells.filter(
      ([r, c]) =>
        cellDegree(r, c) === 1 &&
        !(r === 1 && c === startC) &&
        !(r === rows - 2 && c === exitC),
    ),
  );
  let di = 0;

  // Place springs — kept deliberately sparse. The forest spends far less stamina
  // than the mine, so a handful of refill springs is plenty; the freed dead-ends
  // go to ordinary resource nodes below.
  const trailCount = tiles.flat().filter((t) => t.kind === 'trail').length;
  const springCount = Math.max(1, Math.min(3, Math.floor(trailCount / 90)));
  for (let i = 0; i < springCount && di < deadEnds.length; i++) {
    const [r, c] = deadEnds[di++];
    const nodeKey = stage >= 4 && i === 0 ? 'ancient_spring' : 'spring';
    tiles[r][c] = { kind: 'node', nodeKey };
  }

  // Weighted gatherables on the remaining dead-ends — the forest's main loot.
  const nodeCount = Math.min(deadEnds.length - di, 12 + 2 * stage);
  for (let i = 0; i < nodeCount && di < deadEnds.length; i++) {
    const [r, c] = deadEnds[di++];
    tiles[r][c] = { kind: 'node', nodeKey: weightedNode(stage, rng).key };
  }

  // --- Clearing loot-rooms: 3×3 open pockets carved through thicket ---
  // Each room is centred on a through-corridor lattice cell and contains a cluster
  // of nodes, dormant beasts, and corner trees.  The centre is already a trail cell
  // so the room is always connected to the maze.
  const currentBandId = bandForStage(stage).id;
  const eligibleBeasts = Object.values(FOREST_BEASTS).filter(
    (b) => !b.isGuardian && b.stageMin <= stage && (!b.band || b.band === currentBandId),
  );
  const beasts: ForestBeast[] = [];
  let beastId = 0;

  const corridors = shuffle(
    roomCells.filter(([r, c]) => cellDegree(r, c) >= 2 && !(r === 1 && c === startC)),
  );
  const treeDur = stage <= 2 ? 1 : stage <= 6 ? 2 : 3;
  const roomCount = Math.min(2 + Math.floor(stage / 2), corridors.length);
  // Track cells occupied by rooms so beasts placed later can avoid them.
  const roomCellSet = new Set<string>();

  for (let ri = 0; ri < roomCount; ri++) {
    const [cr, cc] = corridors[ri];
    // Carve the 3×3 block — only convert thicket; don't overwrite trail/node.
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (nr <= 0 || nr >= rows - 1 || nc <= 0 || nc >= cols - 1) continue;
        roomCellSet.add(`${nr},${nc}`);
        if (tiles[nr][nc].kind === 'thicket') {
          tiles[nr][nc] = { kind: 'clearing' };
        }
      }
    }
    // Place the centre tile as clearing (corridor cells may have been trail).
    tiles[cr][cc] = { kind: 'clearing' };

    // Nodes on a random selection of non-corner clearing cells (excluding centre).
    const roomEdge: [number, number][] = [
      [cr-1, cc], [cr+1, cc], [cr, cc-1], [cr, cc+1],
    ];
    shuffle(roomEdge);
    const roomNodeCount = 2 + Math.floor(rng() * 3); // 2-4 nodes
    let nodesPlaced = 0;
    for (const [nr, nc] of roomEdge) {
      if (nodesPlaced >= roomNodeCount) break;
      if (nr <= 0 || nr >= rows - 1 || nc <= 0 || nc >= cols - 1) continue;
      if (tiles[nr][nc].kind === 'clearing') {
        tiles[nr][nc] = { kind: 'node', nodeKey: weightedNode(stage, rng).key };
        nodesPlaced++;
      }
    }

    // Beasts on remaining open clearing cells (1-3). Cells inside the spawn-safety
    // radius are filtered out — a room carved beside the entrance would otherwise
    // seed an ambush beast adjacent to the player's spawn tile (it keeps its nodes
    // and trees; it just holds fewer/no beasts, degrading gracefully).
    if (eligibleBeasts.length > 0) {
      const openRoom: [number, number][] = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (
            tiles[nr]?.[nc]?.kind === 'clearing' &&
            manhattan({ r: nr, c: nc }, playerSpawn) > CRAWL_SPAWN_SAFE_RADIUS
          ) {
            openRoom.push([nr, nc]);
          }
        }
      }
      shuffle(openRoom);
      const roomBeastCount = 1 + Math.floor(rng() * 3); // 1-3 beasts
      for (let bi = 0; bi < roomBeastCount && bi < openRoom.length; bi++) {
        const [br, bc] = openRoom[bi];
        const def = eligibleBeasts[Math.floor(rng() * eligibleBeasts.length)];
        beasts.push({
          id: `rb${stage}-${beastId++}`, key: def.key,
          r: br, c: bc, hp: def.hp, maxHp: def.hp,
          readyAtMs: 0, asleep: true,
        });
      }
    }

    // Corner trees — only corners, so chopping them opens a dead-end pocket into the room.
    const corners: [number, number][] = [
      [cr-1, cc-1], [cr-1, cc+1], [cr+1, cc-1], [cr+1, cc+1],
    ];
    shuffle(corners);
    const roomTreeCount = 1 + Math.floor(rng() * 2); // 1-2 corner trees
    let treesPlaced = 0;
    for (const [tr, tc] of corners) {
      if (treesPlaced >= roomTreeCount) break;
      if (tr <= 0 || tr >= rows - 1 || tc <= 0 || tc >= cols - 1) continue;
      // Only place if still clearing (corner opened by the 3×3 carve).
      if (tiles[tr][tc].kind === 'clearing') {
        tiles[tr][tc] = { kind: 'tree', durability: treeDur, maxDurability: treeDur };
        treesPlaced++;
      }
    }

    // One rng() call decides the clearing centre fate:
    //   0–24%: boon cache tile (Phase 5)
    //   25–64%: shrine (existing behaviour)
    //   65–99%: plain clearing
    // Using one call preserves the RNG sequence and doesn't burn extra rolls.
    if (tiles[cr][cc].kind === 'clearing') {
      const centreRoll = rng();
      if (centreRoll < 0.25) {
        tiles[cr][cc] = { kind: 'boon' };
      } else if (centreRoll < 0.65) {
        const ev = weightedShrine(stage, rng);
        tiles[cr][cc] = { kind: 'shrine', shrineKey: ev.key };
      }
      // else: leave as clearing
    }
  }

  // --- Choppable trees on degree-1 wall cells (routing-safe) ---
  // A thicket cell with exactly one walkable neighbour can be chopped open to a
  // dead-end pocket without ever creating a new corridor.
  const wallCells: [number, number][] = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (tiles[r][c].kind !== 'thicket') continue;
      const walkableNeighbours = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]]
        .filter(([nr, nc]) => isWalkable(tiles[nr]?.[nc])).length;
      if (walkableNeighbours === 1) wallCells.push([r, c]);
    }
  }
  shuffle(wallCells);
  const treeCount = Math.min(wallCells.length, 14 + 3 * stage);
  for (let i = 0; i < treeCount; i++) {
    const [r, c] = wallCells[i];
    tiles[r][c] = { kind: 'tree', durability: treeDur, maxDurability: treeDur };
  }

  // --- Place wandering beasts on trail cells away from the entrance ---
  // Spawn safety: measured from the first trail row (one below playerSpawn), so every
  // wanderer starts strictly more than CRAWL_SPAWN_SAFE_RADIUS + 1 from the spawn tile.
  const trailCells: [number, number][] = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (tiles[r][c].kind === 'trail' && Math.abs(r - 1) + Math.abs(c - startC) > CRAWL_SPAWN_SAFE_RADIUS) {
        trailCells.push([r, c]);
      }
    }
  }
  shuffle(trailCells);
  // Space-bounded uncap: count keeps climbing with stage (deep stages no longer
  // plateau at a flat 16) but never exceeds the placeable trail cells.
  const wanderCount = eligibleBeasts.length === 0 ? 0 : Math.min(trailCells.length, 5 + stage);
  for (let i = 0; i < wanderCount && i < trailCells.length; i++) {
    const [r, c] = trailCells[i];
    const def = eligibleBeasts[Math.floor(rng() * eligibleBeasts.length)];
    beasts.push({
      id: `b${stage}-${beastId++}`, key: def.key,
      r, c, hp: def.hp, maxHp: def.hp,
      readyAtMs: 0, asleep: true,
    });
  }

  // --- Band-gate guardian (deterministic, once per boundary stage) ---
  const guardianKey = FOREST_GUARDIAN_STAGES[stage];
  if (guardianKey) {
    const gDef = FOREST_BEASTS[guardianKey];
    if (gDef) {
      // Place guardian on a trail cell far from the entrance (row 0) and treeline (last row).
      const treeline = tiles[rows - 2]?.findIndex((t) => t.kind === 'treeline') ?? -1;
      const treelineC = treeline >= 0 ? treeline : Math.floor(cols / 2);
      const guardianCells = trailCells.filter(
        ([r, c]) =>
          r > 3 &&
          r < rows - 4 &&
          manhattan({ r, c }, { r: 0, c: startC }) > 8 &&
          manhattan({ r, c }, { r: rows - 2, c: treelineC }) > 4,
      );
      const placed = guardianCells[Math.floor(rng() * guardianCells.length)];
      if (placed) {
        const [gr, gc] = placed;
        beasts.push({
          id: `guardian-${stage}`, key: guardianKey,
          r: gr, c: gc, hp: gDef.hp, maxHp: gDef.hp,
          readyAtMs: 0, asleep: true,
        });
      }
    }
  }

  const seen: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));

  return reveal({
    stage,
    rows,
    cols,
    tiles,
    seen,
    player: { r: 0, c: startC, facing: 'down' },
    hp: snapshot.maxHp,
    maxHp: snapshot.maxHp,
    sta: snapshot.maxSta,
    maxSta: snapshot.maxSta,
    mp: snapshot.maxMp,
    maxMp: snapshot.maxMp,
    staNextRegenMs: STA_REGEN_MS,
    mpNextRegenMs: MP_REGEN_MS,
    meleePower: snapshot.meleePower,
    rangedPower: snapshot.rangedPower,
    damageSpell: snapshot.damageSpell,
    supportSpell: snapshot.supportSpell,
    illusionPower: snapshot.illusionPower,
    defense: snapshot.defense,
    ward: snapshot.ward,
    weapon: snapshot.weapon,
    knownSpells: snapshot.knownSpells,
    chopPower: snapshot.chopPower,
    beasts,
    haul: {},
    status: 'active',
    lastHitAtMs: -FOREST_IFRAME_MS,
    deepest: stage,
    killsThisStage: 0,
    score: 0,
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    lastSpellMs: -SPELL_CD_MS,
    nextRuneId: 1,
    lastShot: null,
    // Phase 1: dash + speed derived from AG; Phase 5: boon multipliers applied immediately
    lastDashMs: -DASH_BASE_CD_MS,
    dashCooldownMs: Math.round(dashCooldown(snapshot.agLevel) * boonDashCdMult(activeBoons)),
    moveIntervalMs: Math.round(moveInterval(snapshot.agLevel) / boonMoveMult(activeBoons)),
    agLevel: snapshot.agLevel,
    // Phase 5: boons
    activeBoons,
    pendingBoonChoice: null,
    sightBonus: snapshot.sightBonus,
  });
}

/** Push on through the tree line into a deeper, richer stage — carries HP + haul, refills sta/mp partially. */
/** The player power-stat snapshot a fresh stage is generated from. */
export function forestSnapshot(state: ForestState): ForestSnapshot {
  return {
    meleePower: state.meleePower,
    rangedPower: state.rangedPower,
    damageSpell: state.damageSpell,
    supportSpell: state.supportSpell,
    illusionPower: state.illusionPower,
    defense: state.defense,
    ward: state.ward,
    maxHp: state.maxHp,
    maxSta: state.maxSta,
    maxMp: state.maxMp,
    weapon: state.weapon,
    knownSpells: state.knownSpells,
    chopPower: state.chopPower,
    agLevel: state.agLevel,
    activeBoons: state.activeBoons,
    sightBonus: state.sightBonus,
  };
}

export function advance(state: ForestState, rng: RNG): ForestState {
  if (!canAdvance(state) || state.status !== 'active') return state;
  const nextStage = state.stage + 1;
  const next = generateForest(nextStage, forestSnapshot(state), rng);
  const staRefill = Math.round(state.maxSta * 0.25);
  const mpRefill = Math.round(state.maxMp * 0.25);
  return {
    ...next,
    hp: state.hp,
    sta: Math.min(state.maxSta, state.sta + staRefill),
    mp: Math.min(state.maxMp, state.mp + mpRefill),
    haul: state.haul,
    deepest: Math.max(state.deepest, nextStage),
    score: state.score + 100 * nextStage,
  };
}

// ---------------------------------------------------------------------------
// Player movement
// ---------------------------------------------------------------------------

/** Turn to face `dir`, step into that cell if walkable and unoccupied, and re-light the fog. */
export function tryMove(state: ForestState, dir: Dir): ForestState {
  if (state.status !== 'active') return state;
  const [dr, dc] = DIRS[dir];
  const r = state.player.r + dr;
  const c = state.player.c + dc;
  const blocked = !isWalkable(tileAt(state, r, c)) || !!beastAt(state, r, c);
  if (blocked) return { ...state, player: { ...state.player, facing: dir } };
  return reveal({ ...state, player: { r, c, facing: dir } });
}

/**
 * Dash in `dir` — skips 1 or 2 cells (2 if clear, else 1), consuming the dash cooldown
 * and briefly granting i-frame immunity by setting `lastHitAtMs`.  This is the counter to
 * the {@link FOREST_WINDUP_MS} telegraph: sidestep during the wind-up window to cancel it.
 * No-ops when on cooldown or when there's nowhere to land.
 */
export function tryDash(state: ForestState, dir: Dir, nowMs: number): ForestState {
  if (state.status !== 'active') return state;
  const cd = state.dashCooldownMs ?? DASH_BASE_CD_MS;
  if (nowMs - (state.lastDashMs ?? -cd) < cd) return state;

  const [dr, dc] = DIRS[dir];
  let destR = state.player.r;
  let destC = state.player.c;

  for (let steps = 2; steps >= 1; steps--) {
    const r = state.player.r + dr * steps;
    const c = state.player.c + dc * steps;
    if (isWalkable(tileAt(state, r, c)) && !beastAt(state, r, c)) {
      destR = r;
      destC = c;
      break;
    }
  }

  if (destR === state.player.r && destC === state.player.c) return state;

  return reveal({
    ...state,
    player: { r: destR, c: destC, facing: dir },
    lastDashMs: nowMs,
    lastHitAtMs: nowMs, // i-frame: no contact damage for FOREST_IFRAME_MS after the dash
  });
}

// ---------------------------------------------------------------------------
// Context-sensitive act: beast → weapon attack, node → gather
// ---------------------------------------------------------------------------

/**
 * Act on the faced cell — context-sensitive (one button):
 *   • ranged weapon: shoot down the faced line, hitting the first beast in range
 *     (walls / trees / nodes block the shot; falls through to gather/chop if no target)
 *   • beast → weapon attack (costs stamina)
 *   • node  → gather instantly (free; stamina nodes refill)
 *
 * @param nowMs   Current timestamp (ms); required for charged-swing stagger timing.
 * @param charged If true, applies {@link CHARGE_DAMAGE_MULT} and staggers hit beasts briefly.
 */
export function act(state: ForestState, rng: RNG, nowMs = 0, charged = false): ForestState {
  if (state.status !== 'active') return state;

  // --- Ranged shot: scan the faced direction ---
  if (state.weapon.ranged && state.weapon.range) {
    if (state.sta >= 1) {
      const { target, shotTo } = rangedScan(state);

      if (target && shotTo) {
        const def = FOREST_BEASTS[target.key];
        const full = state.sta >= ARROW_STA_COST;
        const { dealt: dmg } = attackRoll(
          state.rangedPower,
          state.weapon.bonus ?? 0,
          state.weapon.attackStat,
          (def?.weakTo ?? []) as StatId[],
          (def?.resistTo ?? []) as StatId[],
          full,
          def?.defense ?? 0,
          rng,
        );
        const shot = { fromR: state.player.r, fromC: state.player.c, toR: shotTo.r, toC: shotTo.c, at: nowMs };
        const afterSta = { ...state, sta: Math.max(0, state.sta - ARROW_STA_COST), lastShot: shot };
        const newHp = target.hp - dmg;
        if (newHp <= 0) return killBeast(afterSta, target, rng);
        return {
          ...afterSta,
          beasts: afterSta.beasts.map((b) => (b.id === target!.id ? { ...b, hp: newHp } : b)),
        };
      }

      // No target in the faced line — fall through to gather/chop on the adjacent cell.
    }
  }

  const { r, c } = facedCell(state);

  // --- Weapon attack vs a beast (melee) ---
  const beast = beastAt(state, r, c);
  if (beast) {
    if (state.sta < 1) return state;
    const def = FOREST_BEASTS[beast.key];
    const isRanged = state.weapon.attackStat === 'DX';
    const basePower = isRanged ? state.rangedPower : state.meleePower;
    // Charged swing and Iron Arm boon multiply attack power.
    const boonMult = boonMeleeMult(state.activeBoons);
    const power = charged ? basePower * CHARGE_DAMAGE_MULT * boonMult : basePower * boonMult;
    const full = state.sta >= (state.weapon.staminaCost ?? SLASH_STA_COST);
    const { dealt: dmg } = attackRoll(
      power,
      state.weapon.bonus ?? 0,
      state.weapon.attackStat,
      (def?.weakTo ?? []) as StatId[],
      (def?.resistTo ?? []) as StatId[],
      full,
      def?.defense ?? 0,
      rng,
    );
    const staCost = state.weapon.staminaCost ?? SLASH_STA_COST;
    const newHp = beast.hp - dmg;
    if (newHp <= 0) {
      return killBeast({ ...state, sta: Math.max(0, state.sta - staCost) }, beast, rng);
    }
    // Charged hit staggers the beast (brief freeze).
    const updatedBeasts = state.beasts.map((b) => {
      if (b.id !== beast.id) return b;
      if (charged && nowMs > 0) return { ...b, hp: newHp, frozenUntilMs: nowMs + STAGGER_MS };
      return { ...b, hp: newHp };
    });
    return { ...state, sta: Math.max(0, state.sta - staCost), beasts: updatedBeasts };
  }

  const tile = tileAt(state, r, c);
  if (!tile) return state;

  // --- Chop a tree (costs stamina, yields wood) ---
  if (tile.kind === 'tree') {
    if (state.sta <= 0) return state;
    // ST-scaled chopping: +1 effective chop power per 8 Strength levels.
    const stBonus = Math.floor(state.meleePower / 8);
    const baseChop = state.chopPower > 0 ? state.chopPower : 1;
    const effectiveChop = charged
      ? Math.ceil((baseChop + stBonus) * CHARGE_DAMAGE_MULT)
      : baseChop + stBonus;
    const maxDur = tile.maxDurability ?? 1;
    const dur = (tile.durability ?? 1) - effectiveChop;
    let haul = state.haul;
    const newSta = Math.max(0, state.sta - CHOP_STA_COST);
    if (dur <= 0) {
      // Tree felled — opens a dead-end pocket (routing-safe by construction).
      const woodBase = randInt(maxDur, Math.min(3, maxDur + 1), rng);
      // Forager boon: double chop yield.
      const woodAmt = Math.round(woodBase * boonYieldMult(state.activeBoons));
      haul = mergeReward(haul, { materials: { wood: woodAmt } });
    }
    const tiles = setTile(state.tiles, r, c, dur <= 0 ? { kind: 'trail' } : { ...tile, durability: dur });
    return { ...state, sta: newSta, tiles, haul };
  }

  // --- Gather a node instantly ---
  if (tile.kind === 'node' && tile.nodeKey) {
    const tiles = setTile(state.tiles, r, c, { kind: 'trail' });
    const nodeDef = FOREST_NODES[tile.nodeKey];
    if (nodeDef?.grants.kind === 'stamina') {
      const restore = randInt(nodeDef.grants.amount[0], nodeDef.grants.amount[1], rng);
      return { ...state, tiles, sta: Math.min(state.maxSta, state.sta + restore) };
    }
    const baseYield = nodeYield(tile.nodeKey, rng);
    // Forager boon: double gather yield.
    const yMult = boonYieldMult(state.activeBoons);
    if (yMult !== 1) {
      const scaled: typeof baseYield = {};
      if (baseYield.gold) scaled.gold = Math.round(baseYield.gold * yMult);
      if (baseYield.materials) {
        scaled.materials = Object.fromEntries(
          Object.entries(baseYield.materials).map(([k, v]) => [k, Math.round((v ?? 0) * yMult)]),
        );
      }
      return { ...state, tiles, haul: mergeReward(state.haul, scaled) };
    }
    return { ...state, tiles, haul: mergeReward(state.haul, baseYield) };
  }

  return state;
}

// ---------------------------------------------------------------------------
// Spell casting (mirrors mining.ts castSpell)
// ---------------------------------------------------------------------------

// Callback bag wiring the forest's concrete state/beast/content into the shared
// crawl.ts generics (ARCH-06 twin hoist).
const forestUnitCaps: CrawlUnitCaps<ForestState, ForestBeast> = {
  unitsOf: (s) => s.beasts,
  withUnits: (s, units) => ({ ...s, beasts: units }),
  killUnit: killBeast,
};
const forestSpellCaps: CrawlSpellCaps<ForestState, ForestBeast> = {
  ...forestUnitCaps,
  isWalkableAt: (s, r, c) => isWalkable(tileAt(s, r, c)),
  unitAt: beastAt,
  nearestUnit: nearestBeast,
  unitDef: (b) => FOREST_BEASTS[b.key],
  preferFaced: false,
  afterTeleport: reveal,
};
const forestRuneCaps: CrawlRuneCaps<ForestState, ForestBeast> = {
  ...forestUnitCaps,
  iframeMs: FOREST_IFRAME_MS,
};
const forestContactCaps: CrawlContactCaps<ForestState, ForestBeast> = {
  unitsOf: (s) => s.beasts,
  canStrike: (b, nowMs) => {
    const def = FOREST_BEASTS[b.key];
    if (b.asleep || !def || def.flees || def.touchDamage <= 0) return false;
    if (b.frozenUntilMs && nowMs < b.frozenUntilMs) return false;
    return true;
  },
  contactRaw: (b, s) => Math.round((FOREST_BEASTS[b.key]?.touchDamage ?? 0) * lateDepthDamageScale(s.stage - ANCIENT_BAND_START)),
  defenseBonus: boonDefenseBonus,
  iframeMs: FOREST_IFRAME_MS,
};

export function castSpell(state: ForestState, spellKey: string, nowMs: number, rng: RNG): ForestState {
  return crawlCastSpell(state, spellKey, nowMs, rng, forestSpellCaps);
}

// ---------------------------------------------------------------------------
// Rune triggers
// ---------------------------------------------------------------------------

function triggerRunes(state: ForestState, nowMs: number, rng: RNG): ForestState {
  return crawlTriggerRunes(state, nowMs, rng, forestRuneCaps);
}

// ---------------------------------------------------------------------------
// Beast ticking: wake, BFS move, ring-of-fire, contact damage, DoT ticks, regen
// ---------------------------------------------------------------------------

/**
 * Advance the beast clock by one tick.  Also advances passive sta/mp regen,
 * DoT ticks on beasts, ring-of-fire, rune triggers, and contact damage.
 */
export function stepBeasts(
  state: ForestState,
  nowMs: number,
  rng: RNG,
  coPlayers: ReadonlyArray<{ r: number; c: number }> = [],
): ForestState {
  if (state.status !== 'active') return state;
  let s = state;
  // In co-op, beasts wake to / chase / flee the NEAREST of all players. The local
  // player is always first; contact damage below stays host-only (s.player) — each
  // guest takes its own contact damage via coopClientStep.
  const players = coPlayers.length > 0 ? [s.player, ...coPlayers] : [s.player];

  // ---------- Passive regen ----------
  s = applyPassiveRegen(s, nowMs);

  // ---------- Player status pruning ----------
  s = { ...s, playerStatuses: pruneStatuses(s.playerStatuses, nowMs) };

  // ---------- Ring of fire ----------
  if (s.ringOfFire && nowMs < s.ringOfFire.expiresAtMs) {
    const ring = s.ringOfFire;
    let updatedBeasts = s.beasts;
    const nextHitMs = { ...s.ringNextHitMs };
    for (const beast of s.beasts) {
      if (!adjacent(beast, s.player)) continue;
      const lastHit = nextHitMs[beast.id] ?? 0;
      if (nowMs < lastHit) continue;
      nextHitMs[beast.id] = nowMs + RING_HIT_CD_MS;
      const def = FOREST_BEASTS[beast.key];
      const dealt = Math.max(1, ring.dmg - (def?.defense ?? 0));
      const newHp = beast.hp - dealt;
      if (newHp <= 0) {
        s = killBeast({ ...s, beasts: updatedBeasts, ringNextHitMs: nextHitMs }, beast, rng);
        updatedBeasts = s.beasts;
      } else {
        updatedBeasts = updatedBeasts.map((b) => (b.id === beast.id ? { ...b, hp: newHp } : b));
      }
    }
    s = { ...s, beasts: updatedBeasts, ringNextHitMs: nextHitMs };
  } else if (s.ringOfFire && nowMs >= s.ringOfFire.expiresAtMs) {
    s = { ...s, ringOfFire: null };
  }

  // ---------- DoT ticks ----------
  let updatedBeasts = s.beasts;
  for (const beast of updatedBeasts) {
    if (!beast.poisonDmg || !beast.poisonNextTickMs) continue;
    if (nowMs < beast.poisonNextTickMs) continue;
    if (beast.poisonExpiresMs && nowMs >= beast.poisonExpiresMs) continue;
    const def = FOREST_BEASTS[beast.key];
    const dealt = Math.max(1, beast.poisonDmg - (def?.defense ?? 0));
    const newHp = beast.hp - dealt;
    if (newHp <= 0) {
      s = killBeast({ ...s, beasts: updatedBeasts }, beast, rng);
      updatedBeasts = s.beasts;
    } else {
      updatedBeasts = updatedBeasts.map((b) =>
        b.id === beast.id ? { ...b, hp: newHp, poisonNextTickMs: nowMs + DOT_TICK_MS } : b
      );
    }
  }
  s = { ...s, beasts: updatedBeasts };

  // ---------- Wake pass (ambush trigger) ----------
  s = {
    ...s,
    beasts: s.beasts.map((b) => {
      if (!b.asleep) return b;
      const def = FOREST_BEASTS[b.key];
      const dist = Math.min(...players.map((p) => manhattan(b, p)));
      if (def && dist <= def.aggroRadius) {
        return { ...b, asleep: false, readyAtMs: nowMs };
      }
      return b;
    }),
  };

  // ---------- BFS movement pass ----------
  // Multi-source flood: distance to the nearest player (single-source when solo).
  const field = floodFieldMulti(
    players, s.rows, s.cols,
    (r, c) => isWalkable(tileAt(s, r, c) as ForestTile | undefined),
  );
  const beasts = s.beasts;
  const newOccupied = new Set<string>(beasts.map((b) => `${b.r},${b.c}`));
  const playerCells = new Set<string>(players.map((p) => `${p.r},${p.c}`));

  const movedBeasts = beasts.map((b) => {
    const def = FOREST_BEASTS[b.key];
    if (b.asleep || !def || nowMs < b.readyAtMs) return b;
    if (b.frozenUntilMs && nowMs < b.frozenUntilMs) return b;
    // Predators already adjacent to any player — windup/contact phase handles them.
    // Prey adjacent to a player have nowhere useful to flee; let them cower.
    if (players.some((p) => adjacent(b, p))) return b;
    // Build per-beast blocked set: other beasts + every player cell
    const blocked = new Set<string>(playerCells);
    for (const other of beasts) {
      if (other.id !== b.id) blocked.add(`${other.r},${other.c}`);
    }
    // ARCH-05: also block cells already claimed by beasts that moved earlier this
    // tick, so two beasts can't path onto the same free cell in one step.
    for (const k of newOccupied) blocked.add(k);
    let next: { r: number; c: number } | null;
    if (def.flees) {
      // Prey flee: step toward the cell farthest from the nearest player.
      next = fleeStep({ r: b.r, c: b.c }, field, blocked);
    } else {
      // Predator chases the nearest player.
      next = flowStep({ r: b.r, c: b.c }, field, blocked);
      // Skip if step would land on any player (contact handled below).
      if (next && playerCells.has(`${next.r},${next.c}`)) next = null;
    }
    if (!next) return b;
    newOccupied.delete(`${b.r},${b.c}`);
    newOccupied.add(`${next.r},${next.c}`);
    return { ...b, r: next.r, c: next.c, readyAtMs: nowMs + def.moveCadenceMs };
  });
  s = { ...s, beasts: movedBeasts };

  // ---------- Rune triggers ----------
  s = triggerRunes(s, nowMs, rng);

  // ---------- Telegraph + contact damage ----------
  // Two-phase per predator: set windupUntilMs when first becoming adjacent (no
  // damage yet); deal damage only after the windup expires and the beast is still
  // adjacent.  Prey never wind up or deal contact damage.
  s = {
    ...s,
    beasts: s.beasts.map((b) => {
      const def = FOREST_BEASTS[b.key];
      if (b.asleep || !def || (def.flees) || def.touchDamage <= 0) return b;
      if (b.frozenUntilMs && nowMs < b.frozenUntilMs) return b;
      const adj = adjacent(b, s.player);
      if (adj && b.windupUntilMs === undefined) {
        // First tick adjacent — start the telegraph.
        return { ...b, windupUntilMs: nowMs + FOREST_WINDUP_MS };
      }
      if (!adj && b.windupUntilMs !== undefined) {
        // Player escaped during windup — cancel.
        return { ...b, windupUntilMs: undefined };
      }
      return b;
    }),
  };
  // Resolve one strike per tick (i-frame gate prevents more than one per 800ms).
  if (nowMs - s.lastHitAtMs >= FOREST_IFRAME_MS) {
    const striker = s.beasts.find((b) => {
      if (b.asleep || b.windupUntilMs === undefined) return false;
      if (nowMs < b.windupUntilMs) return false;         // still winding up
      if (b.frozenUntilMs && nowMs < b.frozenUntilMs) return false;
      return adjacent(b, s.player);
    });
    if (striker) {
      const def = FOREST_BEASTS[striker.key];
      const rawDmg = Math.round((def?.touchDamage ?? 0) * lateDepthDamageScale(s.stage - ANCIENT_BAND_START));
      // Contact mitigation unified with the mine (ARCH-04): defense always applies, bless
      // adds its magnitude on top; ward no longer reduces contact damage (it still mitigates
      // rune/spell hits).
      const bless = activeStatus(s.playerStatuses, 'bless', nowMs);
      const dealt = Math.max(1, rawDmg - s.defense - (bless ? bless.magnitude : 0) - boonDefenseBonus(s.activeBoons));
      const hp = Math.max(0, s.hp - dealt);
      // Reset windupUntilMs so the next hit also telegraphs.
      s = {
        ...s,
        hp,
        lastHitAtMs: nowMs,
        status: hp <= 0 ? 'ended' : 'active',
        beasts: s.beasts.map((b) =>
          b.id === striker.id ? { ...b, windupUntilMs: undefined } : b
        ),
      };
    }
  }

  return s;
}

/**
 * Co-op host: apply a guest's melee attack to a beast (resolved once, host-side),
 * killing it (with loot) if HP drops to zero. Mirrors the mine's damageMonsterById.
 */
export function damageBeastById(
  state: ForestState,
  beastId: string,
  dmg: number,
  rng: RNG,
): ForestState {
  return crawlDamageUnitById(state, beastId, dmg, rng, forestUnitCaps);
}

/**
 * Co-op guest per-tick: advance only the local body — regen, own contact damage
 * from an adjacent predator (i-frame gated, no windup telegraph), status pruning.
 * The host owns beast movement/AI and broadcasts it. Mirrors the mine's coopClientStep.
 */
export function coopClientStep(state: ForestState, nowMs: number): ForestState {
  return crawlCoopClientStep(state, nowMs, forestContactCaps);
}

// ---------------------------------------------------------------------------
// Shrine activation
// ---------------------------------------------------------------------------

/** Weighted random shrine event selection (mirror of weightedNode). */
function weightedShrine(stage: number, rng: RNG): { key: string } {
  const pool = Object.values(SHRINE_EVENTS).filter((e) => e.weight > 0);
  // Scale den chance up at higher depths (bears available from stage 5).
  const total = pool.reduce((a, e) => a + e.weight + (e.kind === 'den' && stage >= 5 ? 1 : 0), 0);
  let roll = rng() * total;
  for (const e of pool) {
    const w = e.weight + (e.kind === 'den' && stage >= 5 ? 1 : 0);
    roll -= w;
    if (roll < 0) return e;
  }
  return pool[pool.length - 1];
}

/**
 * Activate the shrine the player is standing on.  Consumes it (shrine → clearing).
 * Needs `nowMs` for the blessing duration; provided by the store, not `act()`.
 *
 * `allowDenSpawn` — when false, a Disturbed Den shrine is still consumed (the tile changes to
 * clearing so co-op peers see it vanish) but no guardian beast is spawned.  Pass `false` for
 * co-op guests so the den beast only ever lives in the host's authoritative world state.
 */
export function activateShrine(state: ForestState, nowMs: number, rng: RNG, allowDenSpawn = true): ForestState {
  if (state.status !== 'active') return state;
  const tile = tileAt(state, state.player.r, state.player.c);
  if (tile?.kind !== 'shrine' || !tile.shrineKey) return state;

  const event = SHRINE_EVENTS[tile.shrineKey];
  if (!event) return state;

  // Consume the shrine tile.
  const tiles = setTile(state.tiles, state.player.r, state.player.c, { kind: 'clearing' });
  let s: ForestState = { ...state, tiles };

  if (event.kind === 'cache' && event.loot) {
    const goldAmt = event.loot.gold ? randInt(event.loot.gold[0], event.loot.gold[1], rng) : 0;
    const matAmt = event.loot.material && event.loot.amount
      ? randInt(event.loot.amount[0], event.loot.amount[1], rng)
      : 0;
    const loot: Reward = mergeReward(
      goldAmt > 0 ? { gold: goldAmt } : {},
      matAmt > 0 && event.loot.material ? { materials: { [event.loot.material]: matAmt } } : {},
    );
    s = { ...s, haul: mergeReward(s.haul, loot) };
  }

  if (event.kind === 'blessing' && event.buff) {
    const { status, magnitude, turns } = event.buff;
    s = {
      ...s,
      playerStatuses: applyStatus(
        s.playerStatuses,
        { key: status, magnitude, durationMs: turns * DOT_TICK_MS },
        nowMs,
      ),
    };
  }

  if (allowDenSpawn && event.kind === 'den' && event.guardianKey) {
    const def = FOREST_BEASTS[event.guardianKey];
    if (def) {
      // Spawn the guardian on a random adjacent walkable, unoccupied cell.
      const candidates: [number, number][] = [];
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
        const nr = state.player.r + dr;
        const nc = state.player.c + dc;
        if (isWalkable(tileAt(s, nr, nc)) && !beastAt(s, nr, nc)) {
          candidates.push([nr, nc]);
        }
      }
      if (candidates.length > 0) {
        const [br, bc] = candidates[Math.floor(rng() * candidates.length)];
        const guardian: ForestBeast = {
          id: `shrine-${nowMs}`,
          key: event.guardianKey,
          r: br, c: bc,
          hp: def.hp, maxHp: def.hp,
          readyAtMs: nowMs,
          asleep: false,
        };
        s = { ...s, beasts: [...s.beasts, guardian] };
      }
    }
  }

  return s;
}

// ---------------------------------------------------------------------------
// Phase 5: boon choice resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the player's boon pick: appends the chosen key to `activeBoons`,
 * clears `pendingBoonChoice`, restores `status:'active'`, and immediately
 * recomputes `moveIntervalMs`/`dashCooldownMs` so the speed boon is felt on
 * the current stage (not only after the next advance).
 * No-ops if no choice is pending or the key is not in the offered set.
 */
export function applyBoonChoice(state: ForestState, key: string): ForestState {
  return crawlApplyBoonChoice(state, key, { getBoon: (k) => BOONS[k], boonMoveMult, boonDashCdMult });
}
