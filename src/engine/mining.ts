// The Deep Mine — a large, scrolling, real-time dungeon minigame.  Pure rules; randomness
// is injected so the engine is fully unit-testable.
//
// The mine is a large procedurally generated cavern (≈33×33 on floor 1, scaling up with
// depth) with impenetrable bedrock walls, sparse clusters of diggable rock, and ore veins
// spread across the open floor.  The player views it through an 11×11 scrolling window
// (see src/components/mining/MineRunOverlay.tsx for the camera).
//
// Combat uses the same damage math as the Arena (src/engine/combat.ts: attackRoll,
// spellDamageRoll, spellHealAmount) with BFS-pathfinding monsters, equipped-weapon attacks,
// and the player's known spell repertoire.  The pickaxe lives in the 'tool' gear slot —
// it's used automatically against rock; the equipped weapon fires against monsters.
//
// Every rule here is a pure function returning a new MineState — the store owns the state
// and a thin loop (src/hooks/useMiningLoop.ts) just decides *when* to call these.
// No React, no store imports → fully unit-testable.

import type { Reward } from './challenges';
import type { StatId } from './stats';
import { mergeReward } from './dungeon';
import { attackRoll } from './combat';
import type { WeaponDef } from './weapons';
import { MINE_ORES, MINE_MONSTERS, MINE_GUARDIAN_FLOORS, type MineOreDef } from '@/content/mining';
import {
  BOONS,
  boonMeleeMult,
  boonDefenseBonus,
  boonYieldMult,
  boonMoveMult,
  boonDashCdMult,
  rollBoonChoices,
} from '@/content/boons';
import { bandForFloor, MINE_BANDS } from './crawlBiomes';

/** First floor of the deepest (open-ended) band — anchor for late-depth damage scaling. */
const MAGMA_BAND_START = MINE_BANDS[MINE_BANDS.length - 1].depthMin;
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
  pruneStatuses,
  activeStatus,
  DOT_TICK_MS,
  RING_HIT_CD_MS,
  STA_REGEN_MS,
  MP_REGEN_MS,
  DASH_BASE_CD_MS,
  STAGGER_MS,
  CHARGE_DAMAGE_MULT,
  dashCooldown,
  moveInterval,
  boonConsolation,
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

export const MINE_BASE_ROWS = 33;
export const MINE_BASE_COLS = 33;
export const MINE_MAX_ROWS = 57;
export const MINE_MAX_COLS = 57;
/** The map grows by this many cells per floor band. */
const MINE_SCALE_PER_BAND = 4;
/** Floors per growth band. */
const MINE_SCALE_BAND = 4;

/** Backward-compat aliases (tests / old references). */
export const MINE_ROWS = MINE_BASE_ROWS;
export const MINE_COLS = MINE_BASE_COLS;

/** Run entry gate. */
export const MINE_ENERGY_COST = 2;
/** Fraction of the haul a fallen miner keeps on death; mirrors FOREST_DEATH_KEEP. */
export const MINE_DEATH_KEEP = 0.5;
/** Fraction of the haul kept when end-banking OFF a safe tile (the "hurry tax"); mirrors
 *  FOREST_STASH_KEEP. Full 1.0 banking is only paid on the entrance (see isMineSafeBankTile). */
export const MINE_STASH_KEEP = 0.8;

/** Stamina spent per pick swing (rock / ore). */
const STRIKE_STA_COST = 1;
/** Stamina spent per weapon attack against a monster. Falls back to this if weapon has no sta cost. */
const MELEE_STA_FALLBACK = 2;
/** Invulnerability window after taking a contact hit (ms). */
export const MINE_IFRAME_MS = 800;
/** Energy gems scattered roughly every N open floor cells. */
const ENERGY_GEM_INTERVAL = 80;
/** Spell effect cooldown between separate casts (ms). */
const SPELL_CD_MS = 500;

// ---------------------------------------------------------------------------
// Tile types
// ---------------------------------------------------------------------------

export type MineTileKind = 'floor' | 'rock' | 'ore' | 'bedrock' | 'shaft' | 'entrance' | 'boon' | 'tombstone';

/** The entrance is the only safe harbour where a full-value (1.0) end-bank is paid (BAL-12).
 *  Banking anywhere else keeps only MINE_STASH_KEEP, pricing the risk of a long haul out. */
export function isMineSafeBankTile(kind: MineTileKind | undefined): boolean {
  return kind === 'entrance';
}

/**
 * The deepest floor a SOLO run may start on: the deepest guardian boundary the player has
 * already descended PAST (strictly below `deepest`), else floor 1. Reuses the persisted
 * deepestMineFloor as the "guardian beaten" proxy — no new field, no persist bump (BAL-25).
 */
export function unlockedStartFloor(deepest: number): number {
  let start = 1;
  for (const g of Object.keys(MINE_GUARDIAN_FLOORS).map(Number)) {
    if (g < deepest) start = Math.max(start, g);
  }
  return start;
}

export interface MineTile {
  kind: MineTileKind;
  /** Pick swings left before it breaks (rock/ore only). */
  durability?: number;
  /** Original durability at spawn — used to render the HP bar. */
  maxDurability?: number;
  /** Which ore vein this tile holds (ore only — keys MINE_ORES). */
  oreKey?: string;
}

// ---------------------------------------------------------------------------
// Monster type
// ---------------------------------------------------------------------------

export interface MineMonster {
  id: string;
  key: string;
  r: number;
  c: number;
  hp: number;
  maxHp: number;
  readyAtMs: number;
  /** Frozen until this ms timestamp (ice spell / rune). Default 0 = not frozen. */
  frozenUntilMs?: number;
  /** Ongoing poison DoT damage per tick; 0 / absent when none. */
  poisonDmg?: number;
  poisonNextTickMs?: number;
  poisonExpiresMs?: number;
}

// ---------------------------------------------------------------------------
// Combat snapshot (snapshotted from the character at the start of a run)
// ---------------------------------------------------------------------------

/** Everything the mine engine needs from the player's character, snapshotted at run start. */
export interface MineSnapshot {
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
  pickaxePower: number;
  /** Agility level — drives dash cooldown and move speed. */
  agLevel: number;
  /** Active boon keys carried from the previous floor. Optional so callers that
   *  construct a snapshot literal without boons (e.g. beginMining) don't break. */
  activeBoons?: string[];
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

export interface MineState {
  floor: number;
  rows: number;
  cols: number;
  tiles: MineTile[][];
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
  // Combat stats (snapshotted from character)
  meleePower: number;
  rangedPower: number;
  damageSpell: number;
  supportSpell: number;
  illusionPower: number;
  defense: number;
  ward: number;
  weapon: WeaponDef;
  knownSpells: string[];
  pickaxePower: number;
  // Monsters
  monsters: MineMonster[];
  // Loot
  haul: Reward;
  // Status
  status: 'active' | 'ended' | 'banking' | 'choosing';
  lastHitAtMs: number;
  deepest: number;
  killsThisFloor: number;
  /** Accumulated run score: +10×floor per kill, +100×floor on each descent. */
  score: number;
  // Phase 5: in-run boons
  /** Keys of boons active for this run (empty at floor 1; carried across floors via snapshot). */
  activeBoons: string[];
  /** Keys of the 3 offered boon choices; null when no choice is pending. */
  pendingBoonChoice: string[] | null;
  // Spell effects
  runes: CrawlRune[];
  ringOfFire: CrawlRingOfFire | null;
  ringNextHitMs: Record<string, number>;
  playerStatuses: CrawlStatusEffect[];
  lastSpellMs: number;
  // Running rune ID counter
  nextRuneId: number;
  // Phase 1: dash + AG-derived timing
  /** Timestamp of the last successful dash (ms). Negative = ready immediately. */
  lastDashMs: number;
  /** Dash cooldown computed from AG at run start (ms). */
  dashCooldownMs: number;
  /** Move cadence computed from AG at run start (ms). */
  moveIntervalMs: number;
  /** Agility level snapshot — preserved across floors. */
  agLevel: number;
  /** Position of the descent shaft on the current floor — for the HUD directional indicator. */
  shaftPos?: { r: number; c: number };
}

/**
 * Re-anchor a persisted run's timestamps for a fresh page session.
 *
 * Every `*Ms` field is stamped from the rAF clock (ms since page load), which
 * restarts near 0 on reload — a rehydrated run would otherwise stall until the
 * new session's clock caught up to the old session's uptime. Cooldowns reset
 * to "ready" (mirroring the fresh-run init values) and transient timed effects
 * (runes, ring of fire, statuses, freezes, DoTs) simply expire: losing a few
 * seconds of buffs on reload beats a stalled run.
 */
export function rebaseMineRun(run: MineState): MineState {
  return {
    ...run,
    staNextRegenMs: 0,
    mpNextRegenMs: 0,
    lastHitAtMs: -MINE_IFRAME_MS,
    lastSpellMs: -SPELL_CD_MS,
    lastDashMs: -DASH_BASE_CD_MS,
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    monsters: (run.monsters ?? []).map((m) => ({
      ...m,
      readyAtMs: 0,
      frozenUntilMs: undefined,
      poisonDmg: undefined,
      poisonNextTickMs: undefined,
      poisonExpiresMs: undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function tileAt(state: MineState, r: number, c: number): MineTile | undefined {
  return state.tiles[r]?.[c];
}

export function isWalkable(tile: MineTile | undefined): boolean {
  return !!tile && (
    tile.kind === 'floor' || tile.kind === 'entrance' || tile.kind === 'shaft' || tile.kind === 'boon' || tile.kind === 'tombstone'
  );
}

export function monsterAt(state: MineState, r: number, c: number): MineMonster | undefined {
  return state.monsters.find((m) => m.r === r && m.c === c);
}

export function facedCell(state: MineState): { r: number; c: number } {
  const [dr, dc] = DIRS[state.player.facing];
  return { r: state.player.r + dr, c: state.player.c + dc };
}

export function canDescend(state: MineState): boolean {
  return tileAt(state, state.player.r, state.player.c)?.kind === 'shaft';
}

/** Nearest monster to the player (for damage-school spells). */
function nearestMonster(state: MineState): MineMonster | null {
  let best: MineMonster | null = null;
  let bestDist = Infinity;
  for (const m of state.monsters) {
    const d = manhattan(m, state.player);
    if (d < bestDist) { bestDist = d; best = m; }
  }
  return best;
}

/** Kill-drop: loot pool scales with floor depth and biome band. */
function monsterLootPool(floor: number): Array<{ kind: 'gold' } | { kind: 'material'; material: string }> {
  const pool: Array<{ kind: 'gold' } | { kind: 'material'; material: string }> = [{ kind: 'gold' }];
  pool.push({ kind: 'material', material: 'bronze_bar' });
  if (floor >= 3) pool.push({ kind: 'material', material: 'iron_bar' });
  if (floor >= 6) pool.push({ kind: 'material', material: 'crystals' });
  if (floor >= 7) pool.push({ kind: 'material', material: 'frost_quartz' }); // frozen band
  if (floor >= 10) pool.push({ kind: 'material', material: 'gemstone' });
  if (floor >= 15) pool.push({ kind: 'material', material: 'obsidian' }); // magma band
  return pool;
}

/** Flat score bonus awarded for killing a band-gate guardian. */
const GUARDIAN_SCORE_BONUS = 500;

/** Guaranteed treasure loot when a band-gate guardian is slain. */
function guardianTreasure(floor: number, rng: RNG): Reward {
  if (floor <= 7) {
    // Stone Golem: Rocky → Frozen gate; reward previews Frozen-band materials.
    return { gold: randInt(30, 50, rng), materials: { frost_quartz: 3, iron_bar: 2 } };
  }
  // Magma Colossus: Frozen → Magma gate; reward previews Magma-band materials.
  return { gold: randInt(60, 100, rng), materials: { obsidian: 3, frost_quartz: 2 } };
}

function avgNodeDurability(floor: number): number {
  const ores = eligibleOres(floor).filter((o) => o.weight > 0);
  if (ores.length === 0) return 1;
  const totalWeight = ores.reduce((a, o) => a + o.weight, 0);
  return ores.reduce((a, o) => a + o.durability * o.weight, 0) / totalWeight;
}

/** Loot dropped by breaking one ore tile. */
export function oreYield(oreKey: string, rng: RNG): Reward {
  const def = MINE_ORES[oreKey];
  if (!def) return {};
  if (def.grants.kind === 'stamina') return {};
  if (def.grants.kind === 'gold') {
    return { gold: randInt(def.grants.amount[0], def.grants.amount[1], rng) };
  }
  const amt = randInt(def.grants.amount[0], def.grants.amount[1], rng);
  return { materials: { [def.grants.material]: amt } };
}

function eligibleOres(floor: number): MineOreDef[] {
  const bandId = bandForFloor(floor).id;
  return Object.values(MINE_ORES).filter(
    (o) => o.floorMin <= floor && (!o.band || o.band === bandId),
  );
}

function weightedOre(floor: number, rng: RNG): MineOreDef {
  const pool = eligibleOres(floor).filter((o) => o.weight > 0);
  const total = pool.reduce((a, o) => a + o.weight, 0);
  let roll = rng() * total;
  for (const o of pool) {
    roll -= o.weight;
    if (roll < 0) return o;
  }
  return pool[pool.length - 1];
}

// ---------------------------------------------------------------------------
// Generation — large cave with multi-walker drunk-walk
// ---------------------------------------------------------------------------

/**
 * Build a fresh cavern for `floor`.  Large, organic shape: start all bedrock, carve open
 * areas with overlapping drunk-walks from the entrance, then scatter sparse rock clusters,
 * ore clusters, energy gems, and monsters on the open floor.
 */
export function generateMine(floor: number, snapshot: MineSnapshot, rng: RNG): MineState {
  // Carry boons forward from the snapshot (absent on the very first call from beginMining).
  const activeBoons: string[] = snapshot.activeBoons ?? [];

  const band = Math.floor((floor - 1) / MINE_SCALE_BAND);
  const rows = Math.min(MINE_MAX_ROWS, MINE_BASE_ROWS + band * MINE_SCALE_PER_BAND);
  const cols = Math.min(MINE_MAX_COLS, MINE_BASE_COLS + band * MINE_SCALE_PER_BAND);

  // --- Step 1: start with all bedrock ---
  const floor_: MineTile[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ kind: 'bedrock' as MineTileKind })),
  );

  // --- Step 2: carve open caves with multiple drunk-walkers ---
  // Entrance near the top-centre.
  const startR = 2;
  const startC = Math.floor(cols / 2);

  const carve = (r: number, c: number): void => {
    if (r < 1 || r >= rows - 1 || c < 1 || c >= cols - 1) return;
    if (floor_[r][c].kind === 'floor') return; // already open
    floor_[r][c] = { kind: 'floor' };
    // Widen the corridor slightly by also opening one adjacent random cell
    const side: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const [dr, dc] = side[Math.floor(rng() * 4)];
    const wr = r + dr, wc = c + dc;
    if (wr >= 1 && wr < rows - 1 && wc >= 1 && wc < cols - 1) {
      floor_[wr][wc] = { kind: 'floor' };
    }
  };

  // How many walkers and steps to fill roughly 45% of interior cells
  const interior = (rows - 2) * (cols - 2);
  const targetFloor = Math.round(interior * 0.45);
  const numWalkers = 10;
  const stepsPerWalker = Math.ceil((targetFloor * 1.3) / numWalkers);

  // Seed the entrance
  carve(startR, startC);
  carve(startR + 1, startC);

  for (let w = 0; w < numWalkers; w++) {
    // Each new walker starts from an already-open cell to guarantee connectivity
    const openCells: Array<[number, number]> = [];
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (floor_[r][c].kind === 'floor') openCells.push([r, c]);
      }
    }
    let [r, c] = openCells.length > 0
      ? openCells[Math.floor(rng() * openCells.length)]
      : [startR, startC];
    for (let step = 0; step < stepsPerWalker; step++) {
      const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      const [dr, dc] = dirs[Math.floor(rng() * 4)];
      const nr = r + dr, nc = c + dc;
      if (nr >= 1 && nr < rows - 1 && nc >= 1 && nc < cols - 1) {
        r = nr; c = nc;
        carve(r, c);
      }
    }
  }

  // Ensure entrance and a breathing room below it are open
  floor_[startR][startC] = { kind: 'entrance' };
  floor_[startR + 1][startC] = { kind: 'floor' };

  // --- Step 3: BFS to find all reachable open cells from the entrance ---
  const reachable: Set<string> = new Set();
  const bfsQ: Array<[number, number]> = [[startR, startC]];
  reachable.add(`${startR},${startC}`);
  while (bfsQ.length > 0) {
    const [r, c] = bfsQ.shift()!;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
      const nr = r + dr, nc = c + dc;
      const k = `${nr},${nc}`;
      if (reachable.has(k)) continue;
      const t = floor_[nr]?.[nc];
      if (!t || t.kind === 'bedrock') continue;
      reachable.add(k);
      bfsQ.push([nr, nc]);
    }
  }

  // Collect reachable interior floor cells (excludes entrance itself)
  const openFloor: Array<[number, number]> = [];
  for (const k of reachable) {
    const [r, c] = k.split(',').map(Number);
    if (floor_[r][c].kind === 'floor') openFloor.push([r, c]);
  }

  // Shuffle so picks are uniform random
  for (let i = openFloor.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [openFloor[i], openFloor[j]] = [openFloor[j], openFloor[i]];
  }

  const takeFloor = (): [number, number] | undefined => openFloor.pop();

  // --- Step 4: shaft down — at the farthest reachable cell from the entrance ---
  // BFS-distance: we want cells deep in the cave (roughly max-distance from start)
  const bfsDist = new Map<string, number>();
  const bfsQ2: Array<[number, number, number]> = [[startR, startC, 0]];
  bfsDist.set(`${startR},${startC}`, 0);
  let farthestCell: [number, number] = [startR, startC];
  let farthestDist = 0;
  while (bfsQ2.length > 0) {
    const [r, c, d] = bfsQ2.shift()!;
    if (d > farthestDist) { farthestDist = d; farthestCell = [r, c]; }
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
      const nr = r + dr, nc = c + dc;
      const k = `${nr},${nc}`;
      if (bfsDist.has(k)) continue;
      const t = floor_[nr]?.[nc];
      if (!t || (t.kind !== 'floor' && t.kind !== 'entrance')) continue;
      bfsDist.set(k, d + 1);
      bfsQ2.push([nr, nc, d + 1]);
    }
  }
  const [shaftR, shaftC] = farthestCell;
  floor_[shaftR][shaftC] = { kind: 'shaft' };
  // Remove from openFloor pool
  const shaftIdx = openFloor.findIndex(([r, c]) => r === shaftR && c === shaftC);
  if (shaftIdx >= 0) openFloor.splice(shaftIdx, 1);

  // --- Step 5: scatter diggable rock clusters near bedrock/walls ---
  const rockDur = floor <= 2 ? 1 : floor <= 6 ? 2 : 3;
  const rockClusterCount = 5 + Math.floor(floor / 2);
  for (let ci = 0; ci < rockClusterCount; ci++) {
    const cell = takeFloor();
    if (!cell) break;
    const [cr, cc] = cell;
    floor_[cr][cc] = { kind: 'rock', durability: rockDur, maxDurability: rockDur };
    // Add 2-3 adjacent rock cells for a cluster feel
    const clusterSize = 2 + Math.floor(rng() * 2);
    for (let s = 0; s < clusterSize; s++) {
      const adj: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      const [dr, dc] = adj[Math.floor(rng() * 4)];
      const nr = cr + dr, nc = cc + dc;
      if (floor_[nr]?.[nc]?.kind === 'floor') {
        floor_[nr][nc] = { kind: 'rock', durability: rockDur, maxDurability: rockDur };
        const idx = openFloor.findIndex(([r, c]) => r === nr && c === nc);
        if (idx >= 0) openFloor.splice(idx, 1);
      }
    }
  }

  // --- Step 6: ore clusters ---
  const oreClusterCount = Math.min(openFloor.length, 4 + Math.floor(floor / 2));
  for (let ci = 0; ci < oreClusterCount; ci++) {
    const cell = takeFloor();
    if (!cell) break;
    const [cr, cc] = cell;
    const oreDef = weightedOre(floor, rng);
    floor_[cr][cc] = { kind: 'ore', oreKey: oreDef.key, durability: oreDef.durability, maxDurability: oreDef.durability };
    // Cluster: 1-4 adjacent ore tiles
    const veinSize = 1 + Math.floor(rng() * 3);
    for (let s = 0; s < veinSize; s++) {
      const cell2 = takeFloor();
      if (!cell2) break;
      const [r2, c2] = cell2;
      const oreDef2 = weightedOre(floor, rng);
      floor_[r2][c2] = { kind: 'ore', oreKey: oreDef2.key, durability: oreDef2.durability, maxDurability: oreDef2.durability };
    }
  }

  // --- Step 7: energy gems (scattered more densely than before) ---
  // Count remaining open floor cells after placements above
  const remainingFloor: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (floor_[r][c].kind === 'floor') remainingFloor.push([r, c]);
    }
  }
  const gemCount = Math.max(1, Math.floor(remainingFloor.length / ENERGY_GEM_INTERVAL));
  for (let i = remainingFloor.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [remainingFloor[i], remainingFloor[j]] = [remainingFloor[j], remainingFloor[i]];
  }
  for (let gi = 0; gi < gemCount; gi++) {
    const cell = remainingFloor[gi];
    if (!cell) break;
    const [gr, gc] = cell;
    // Only place on still-floor cells (might have been overwritten by ore/rock above)
    if (floor_[gr][gc].kind === 'floor') {
      floor_[gr][gc] = { kind: 'ore', oreKey: 'energy_gem', durability: 1, maxDurability: 1 };
    }
  }

  // --- Step 7b: cave mushroom (~1 per 3 floors — rare stamina pickup) ---
  // Reuses the shuffled remainingFloor array, picking a cell after the gem slots so it
  // never overlaps an energy gem. weight:0 in MINE_ORES keeps it out of the random pool.
  if (rng() < 0.33) {
    for (let mi = gemCount; mi < remainingFloor.length; mi++) {
      const cell = remainingFloor[mi];
      if (!cell) break;
      const [mr, mc] = cell;
      if (floor_[mr][mc].kind === 'floor') {
        floor_[mr][mc] = { kind: 'ore', oreKey: 'cave_mushroom', durability: 1, maxDurability: 1 };
        break;
      }
    }
  }

  // --- Step 8: monsters ---
  const mFloor: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = floor_[r][c];
      if ((t.kind === 'floor') && manhattan({ r, c }, { r: startR, c: startC }) > 4) {
        mFloor.push([r, c]);
      }
    }
  }
  for (let i = mFloor.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [mFloor[i], mFloor[j]] = [mFloor[j], mFloor[i]];
  }
  const currentBandId = bandForFloor(floor).id;
  const eligibleMon = Object.values(MINE_MONSTERS).filter(
    (m) => !m.isGuardian && m.floorMin <= floor && (!m.band || m.band === currentBandId),
  );
  // Space-bounded uncap: count keeps climbing with floor (deep floors no longer
  // plateau at a flat 10) but never exceeds the placeable spawn cells.
  const monCount = eligibleMon.length === 0 ? 0 : Math.min(mFloor.length, 2 + Math.floor(floor * 0.6));
  const monsters: MineMonster[] = [];
  for (let i = 0; i < monCount && i < mFloor.length; i++) {
    const [mr, mc] = mFloor[i];
    const def = eligibleMon[Math.floor(rng() * eligibleMon.length)];
    monsters.push({
      id: `m${floor}-${i}`,
      key: def.key,
      r: mr, c: mc,
      hp: def.hp, maxHp: def.hp,
      readyAtMs: 0,
      frozenUntilMs: 0,
      poisonDmg: 0, poisonNextTickMs: 0, poisonExpiresMs: 0,
    });
  }

  // --- Step 9: band-gate guardian (deterministic, once per boundary floor) ---
  const guardianKey = MINE_GUARDIAN_FLOORS[floor];
  if (guardianKey) {
    const gDef = MINE_MONSTERS[guardianKey];
    if (gDef) {
      // Find a floor cell distant from both the entrance and the shaft.
      const shaftCell = (() => {
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++)
            if (floor_[r][c].kind === 'shaft') return { r, c };
        return { r: rows - 3, c: Math.floor(cols / 2) };
      })();
      const guardianCells = mFloor.filter(
        ([r, c]) =>
          manhattan({ r, c }, { r: startR, c: startC }) > 8 &&
          manhattan({ r, c }, shaftCell) > 4,
      );
      const placed = guardianCells[Math.floor(rng() * guardianCells.length)];
      if (placed) {
        const [gr, gc] = placed;
        monsters.push({
          id: `guardian-${floor}`,
          key: guardianKey,
          r: gr, c: gc,
          hp: gDef.hp, maxHp: gDef.hp,
          readyAtMs: 0,
          frozenUntilMs: 0,
          poisonDmg: 0, poisonNextTickMs: 0, poisonExpiresMs: 0,
        });
      }
    }
  }

  // --- Step 10: boon cache (~1-in-3 chance on non-guardian floors) ---
  // Placed on a floor cell far from the entrance and BFS-reachable.
  if (!guardianKey && rng() < 0.34) {
    const boonCands: [number, number][] = [];
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (
          floor_[r][c].kind === 'floor' &&
          manhattan({ r, c }, { r: startR, c: startC }) > 5 &&
          reachable.has(`${r},${c}`)
        ) {
          boonCands.push([r, c]);
        }
      }
    }
    if (boonCands.length > 0) {
      const [br, bc] = boonCands[Math.floor(rng() * boonCands.length)];
      floor_[br][bc] = { kind: 'boon' };
    }
  }

  return {
    floor,
    rows, cols,
    tiles: floor_,
    player: { r: startR, c: startC, facing: 'down' },
    hp: snapshot.maxHp, maxHp: snapshot.maxHp,
    sta: snapshot.maxSta, maxSta: snapshot.maxSta,
    mp: snapshot.maxMp, maxMp: snapshot.maxMp,
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
    pickaxePower: snapshot.pickaxePower,
    monsters,
    haul: {},
    status: 'active',
    lastHitAtMs: -MINE_IFRAME_MS,
    deepest: floor,
    killsThisFloor: 0,
    score: 0,
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    lastSpellMs: -SPELL_CD_MS,
    nextRuneId: 1,
    // Phase 1: dash + speed derived from AG; Phase 5: boon multipliers applied immediately
    lastDashMs: -DASH_BASE_CD_MS,
    dashCooldownMs: Math.round(dashCooldown(snapshot.agLevel) * boonDashCdMult(activeBoons)),
    moveIntervalMs: Math.round(moveInterval(snapshot.agLevel) / boonMoveMult(activeBoons)),
    agLevel: snapshot.agLevel,
    // Phase 5: boons
    activeBoons,
    pendingBoonChoice: null,
    shaftPos: { r: shaftR, c: shaftC },
  };
}

/** The player power-stat snapshot a fresh floor is generated from. */
export function mineSnapshot(state: MineState): MineSnapshot {
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
    pickaxePower: state.pickaxePower,
    agLevel: state.agLevel,
    activeBoons: state.activeBoons,
  };
}

/** Descend the shaft into a richer, deeper floor — carries HP/sta/mp/haul/score forward. */
export function descend(state: MineState, rng: RNG): MineState {
  if (!canDescend(state) || state.status !== 'active') return state;
  const nextFloor = state.floor + 1;
  const next = generateMine(nextFloor, mineSnapshot(state), rng);
  return {
    ...next,
    hp: state.hp,
    sta: Math.min(state.maxSta, state.sta + Math.round(state.maxSta * 0.25)), // partial refill
    mp: Math.min(state.maxMp, state.mp + Math.round(state.maxMp * 0.25)),
    haul: state.haul,
    deepest: Math.max(state.deepest, nextFloor),
    score: state.score + 100 * nextFloor,
  };
}

/**
 * Place a tombstone tile on a random reachable floor cell away from the entrance.
 * Called by the store when a run begins/descends on a floor that has a saved tombstone.
 * The tile is walkable (player can step on it) and is recovered via mineStrike.
 */
export function placeTombstone(state: MineState, rng: RNG): MineState {
  const { rows, cols } = state;
  // Find the entrance tile to measure distance from the start position.
  let entR = 2, entC = Math.floor(cols / 2);
  outer: for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (state.tiles[r]?.[c]?.kind === 'entrance') { entR = r; entC = c; break outer; }
    }
  }
  // Collect floor cells that are far enough from the entrance to feel "hidden".
  const cands: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = state.tiles[r]?.[c];
      if (tile?.kind === 'floor' && manhattan({ r, c }, { r: entR, c: entC }) > 5) {
        cands.push([r, c]);
      }
    }
  }
  if (cands.length === 0) return state;
  const [tr, tc] = cands[Math.floor(rng() * cands.length)];
  const tiles = state.tiles.map((row) => row.slice());
  tiles[tr][tc] = { kind: 'tombstone' };
  return { ...state, tiles };
}

/**
 * MINI-31: find the tombstone tile on the current floor, if any. The tombstone is
 * only encoded as a tile kind (there is no `tombstonePos` on state), so the overlay
 * compass has to scan for it. Returns null when this floor holds no tombstone.
 */
export function findTombstone(state: MineState): { r: number; c: number } | null {
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.tiles[r]?.[c]?.kind === 'tombstone') return { r, c };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Player movement + dash (Phase 1)
// ---------------------------------------------------------------------------

/** Turn to face `dir`; step into the cell if walkable and unoccupied. */
export function tryMove(state: MineState, dir: Dir): MineState {
  if (state.status !== 'active') return state;
  const [dr, dc] = DIRS[dir];
  const r = state.player.r + dr;
  const c = state.player.c + dc;
  const blocked = !isWalkable(tileAt(state, r, c)) || !!monsterAt(state, r, c);
  return {
    ...state,
    player: blocked ? { ...state.player, facing: dir } : { r, c, facing: dir },
  };
}

/**
 * Dash in `dir` — skips 1 or 2 cells (2 if clear, else 1), consuming the dash
 * cooldown and briefly granting i-frame immunity by setting `lastHitAtMs`.
 * No-ops when on cooldown or when there's nowhere to land.
 */
export function tryDash(state: MineState, dir: Dir, nowMs: number): MineState {
  if (state.status !== 'active') return state;
  const cd = state.dashCooldownMs ?? DASH_BASE_CD_MS;
  if (nowMs - (state.lastDashMs ?? -cd) < cd) return state;

  const [dr, dc] = DIRS[dir];
  let destR = state.player.r;
  let destC = state.player.c;

  // Prefer 2-cell dash; fall back to 1 if blocked.
  for (let steps = 2; steps >= 1; steps--) {
    const r = state.player.r + dr * steps;
    const c = state.player.c + dc * steps;
    if (isWalkable(tileAt(state, r, c)) && !monsterAt(state, r, c)) {
      destR = r;
      destC = c;
      break;
    }
  }

  if (destR === state.player.r && destC === state.player.c) return state;

  return {
    ...state,
    player: { r: destR, c: destC, facing: dir },
    lastDashMs: nowMs,
    lastHitAtMs: nowMs, // i-frame: no contact damage for MINE_IFRAME_MS after the dash
  };
}

// ---------------------------------------------------------------------------
// Player attack (auto-context: weapon vs monster, pickaxe vs rock)
// ---------------------------------------------------------------------------

function killMonster(state: MineState, mon: MineMonster, rng: RNG): MineState {
  const def = MINE_MONSTERS[mon.key];
  const isGuardian = !!def?.isGuardian;
  let drop: Reward;
  if (isGuardian) {
    drop = guardianTreasure(state.floor, rng);
  } else {
    // Guaranteed bounty gold on every kill (mirrors forest killBeast).
    const bounty = def ? randInt(def.bounty[0], def.bounty[1], rng) : 0;
    const killBonus = state.killsThisFloor + 1;
    // Loot quantity scales with the swings the kill *would* take with the wielded
    // weapon's attack stat (DX weapons fire on rangedPower, else meleePower).
    const atkPower = state.weapon.attackStat === 'DX' ? state.rangedPower : state.meleePower;
    const swingsToKill = Math.ceil(mon.maxHp / Math.max(1, atkPower));
    const qty = Math.max(1, Math.round(swingsToKill / avgNodeDurability(state.floor)) + killBonus);
    const pool = monsterLootPool(state.floor);
    const pick = pool[Math.floor(rng() * pool.length)];
    // Pool pick (gold-or-material) is a bonus roll on top of the guaranteed bounty.
    const bonus: Reward = pick.kind === 'gold' ? { gold: qty } : { materials: { [pick.material]: qty } };
    drop = mergeReward(bonus, bounty > 0 ? { gold: bounty } : {});
  }
  const afterKill: MineState = {
    ...state,
    monsters: state.monsters.filter((m) => m.id !== mon.id),
    haul: mergeReward(state.haul, drop),
    killsThisFloor: state.killsThisFloor + 1,
    score: state.score + 10 * state.floor + (isGuardian ? GUARDIAN_SCORE_BONUS : 0),
  };
  // Guardian kill: offer a boon choice (pauses the run via 'choosing' status).
  // An exhausted pool rolls [] — grant a consolation instead; entering
  // 'choosing' with zero options would soft-lock the run.
  if (isGuardian) {
    const choices = rollBoonChoices('mine', afterKill.activeBoons, rng);
    if (choices.length === 0) return boonConsolation(afterKill);
    return { ...afterKill, pendingBoonChoice: choices, status: 'choosing' };
  }
  return afterKill;
}

/**
 * Co-op client helper: the id of the monster in the cell the player faces, or
 * null. A guest uses this to send a melee attack-intent to the host (which
 * resolves the damage authoritatively) instead of damaging its local copy.
 */
export function facedMonsterId(state: MineState): string | null {
  const { r, c } = facedCell(state);
  return monsterAt(state, r, c)?.id ?? null;
}

/**
 * Swing at the faced cell.  Auto-context: monster → weapon attack; rock/ore → pickaxe mining.
 *
 * @param nowMs  Current timestamp (ms); required for charged-swing stagger timing.
 * @param charged  If true, applies {@link CHARGE_DAMAGE_MULT} and staggers hit monsters briefly.
 */
export function strike(state: MineState, rng: RNG, nowMs = 0, charged = false): MineState {
  if (state.status !== 'active') return state;
  const { r, c } = facedCell(state);

  // --- Monster in the way: weapon attack ---
  const mon = monsterAt(state, r, c);
  if (mon) {
    const def = MINE_MONSTERS[mon.key];
    const staCost = state.weapon.staminaCost ?? MELEE_STA_FALLBACK;
    if (state.sta < 1) return state; // need at least 1 sta
    const full = state.sta >= staCost;
    const basePower = state.weapon.attackStat === 'DX' ? state.rangedPower : state.meleePower;
    // Charged swing and Iron Arm boon multiply attack power.
    const boonMult = boonMeleeMult(state.activeBoons);
    const power = charged ? basePower * CHARGE_DAMAGE_MULT * boonMult : basePower * boonMult;
    const { dealt } = attackRoll(
      power,
      state.weapon.bonus,
      state.weapon.attackStat,
      (def?.weakTo ?? []) as StatId[],
      (def?.resistTo ?? []) as StatId[],
      full,
      def?.defense ?? 0,
      rng,
    );
    const newSta = Math.max(0, state.sta - staCost);
    const newHp = mon.hp - dealt;
    if (newHp <= 0) {
      return killMonster({ ...state, sta: newSta }, mon, rng);
    }
    // Charged hit staggers the monster (brief freeze).
    const updatedMonsters = state.monsters.map((m) => {
      if (m.id !== mon.id) return m;
      if (charged && nowMs > 0) return { ...m, hp: newHp, frozenUntilMs: nowMs + STAGGER_MS };
      return { ...m, hp: newHp };
    });
    return { ...state, sta: newSta, monsters: updatedMonsters };
  }

  // --- Rock or ore: pickaxe mining ---
  const tile = tileAt(state, r, c);
  if (!tile || (tile.kind !== 'rock' && tile.kind !== 'ore')) return state;
  if (state.sta <= 0) return state;

  // ST-scaled mining: +1 effective pick power per 8 Strength levels.
  const stBonus = Math.floor(state.meleePower / 8);
  const basePick = state.pickaxePower > 0 ? state.pickaxePower : 1;
  // Charged swing also boosts mining speed — rounds up so even tier-1 rock is cleared in 1 swing.
  const effectivePick = charged
    ? Math.ceil((basePick + stBonus) * CHARGE_DAMAGE_MULT)
    : basePick + stBonus;
  const dur = (tile.durability ?? 1) - effectivePick;
  const tiles = state.tiles.map((row) => row.slice());
  let haul = state.haul;
  const oreBroke = dur <= 0 && tile.kind === 'ore';

  if (dur <= 0) {
    if (tile.kind === 'ore' && tile.oreKey) {
      const yieldResult = oreYield(tile.oreKey, rng);
      // Vein Sense boon: double ore quantity.
      const yMult = boonYieldMult(state.activeBoons);
      if (yMult !== 1) {
        const scaled: typeof yieldResult = {};
        if (yieldResult.gold) scaled.gold = Math.round(yieldResult.gold * yMult);
        if (yieldResult.materials) {
          scaled.materials = Object.fromEntries(
            Object.entries(yieldResult.materials).map(([k, v]) => [k, Math.round((v ?? 0) * yMult)]),
          );
        }
        haul = mergeReward(haul, scaled);
      } else {
        haul = mergeReward(haul, yieldResult);
      }
    }
    tiles[r][c] = { kind: 'floor' };
  } else {
    tiles[r][c] = { ...tile, durability: dur };
  }

  // Breaking a rock always yields stone (scales with hardness), plus a 20% bonus ore chance.
  if (dur <= 0 && tile.kind === 'rock') {
    const maxDur = tile.maxDurability ?? 1;
    const stoneAmt = randInt(maxDur, Math.min(3, maxDur + 1), rng);
    haul = mergeReward(haul, { materials: { stone: stoneAmt } });
    const bonusPool = eligibleOres(state.floor).filter((o) => o.weight > 0);
    if (bonusPool.length > 0 && rng() < 0.2) {
      const bonusDef = bonusPool[Math.floor(rng() * bonusPool.length)];
      haul = mergeReward(haul, oreYield(bonusDef.key, rng));
    }
  }

  // Stamina restore from special ores (energy gem) or a small +1 for any broken ore
  const staDef = oreBroke && tile.oreKey ? MINE_ORES[tile.oreKey] : undefined;
  const staRestore =
    staDef?.grants.kind === 'stamina' ? staDef.grants.amount[0] : oreBroke ? 1 : 0;
  const newSta = Math.min(state.maxSta, state.sta - STRIKE_STA_COST + staRestore);

  return { ...state, sta: newSta, tiles, haul };
}

// ---------------------------------------------------------------------------
// Spell casting
// ---------------------------------------------------------------------------

// Callback bag wiring the mine's concrete state/monster/content into the shared
// crawl.ts generics (ARCH-06 twin hoist).
const mineUnitCaps: CrawlUnitCaps<MineState, MineMonster> = {
  unitsOf: (s) => s.monsters,
  withUnits: (s, units) => ({ ...s, monsters: units }),
  killUnit: killMonster,
};
const mineSpellCaps: CrawlSpellCaps<MineState, MineMonster> = {
  ...mineUnitCaps,
  isWalkableAt: (s, r, c) => isWalkable(tileAt(s, r, c)),
  unitAt: monsterAt,
  nearestUnit: nearestMonster,
  unitDef: (m) => MINE_MONSTERS[m.key],
  preferFaced: true,
};
const mineRuneCaps: CrawlRuneCaps<MineState, MineMonster> = {
  ...mineUnitCaps,
  iframeMs: MINE_IFRAME_MS,
};
const mineContactCaps: CrawlContactCaps<MineState, MineMonster> = {
  unitsOf: (s) => s.monsters,
  // MINI-17: a frozen/staggered monster can't bite.
  canStrike: (m, nowMs) => !(m.frozenUntilMs && nowMs < m.frozenUntilMs),
  contactRaw: (m, s) => Math.round((MINE_MONSTERS[m.key]?.touchDamage ?? 1) * lateDepthDamageScale(s.floor - MAGMA_BAND_START)),
  defenseBonus: boonDefenseBonus,
  iframeMs: MINE_IFRAME_MS,
};

export function castSpell(state: MineState, spellKey: string, nowMs: number, rng: RNG): MineState {
  return crawlCastSpell(state, spellKey, nowMs, rng, mineSpellCaps);
}

// ---------------------------------------------------------------------------
// Rune triggers (called after any unit moves)
// ---------------------------------------------------------------------------

function triggerRunes(state: MineState, nowMs: number, rng: RNG): MineState {
  return crawlTriggerRunes(state, nowMs, rng, mineRuneCaps);
}

// ---------------------------------------------------------------------------
// Monster tick: BFS move + DoT + contact damage
// ---------------------------------------------------------------------------

/**
 * Advance the entire monster clock by one tick:
 *   1. DoT ticks (poison / burn — tracked on the monster).
 *   2. BFS move toward the player, routing around walls and each other.
 *   3. Contact damage to the player (with i-frame gating) from adjacent monsters.
 *   4. Ring-of-fire damage to any monster adjacent to the player.
 *   5. Trigger any runes stepped on by a moving monster.
 */
export function stepMonsters(
  state: MineState,
  nowMs: number,
  rng: RNG,
  /**
   * Co-op only: positions of the OTHER players sharing this run. Monsters then
   * chase the nearest of all players. Contact damage / i-frames stay against
   * `state.player` (each client simulates its own body), so passing `[]` (the
   * default) preserves single-player behavior exactly.
   */
  coPlayers: ReadonlyArray<{ r: number; c: number }> = [],
): MineState {
  if (state.status !== 'active') return state;

  // --- Regen stamina / mp ---
  let s = state;
  if (nowMs >= s.staNextRegenMs && s.sta < s.maxSta) {
    s = { ...s, sta: Math.min(s.maxSta, s.sta + 1), staNextRegenMs: nowMs + STA_REGEN_MS };
  }
  if (nowMs >= s.mpNextRegenMs && s.mp < s.maxMp) {
    s = { ...s, mp: Math.min(s.maxMp, s.mp + 1), mpNextRegenMs: nowMs + MP_REGEN_MS };
  }

  // --- Monster DoT ticks ---
  let monsters = s.monsters.map((m) => {
    const pdmg = m.poisonDmg ?? 0;
    const pnext = m.poisonNextTickMs ?? 0;
    const pexp = m.poisonExpiresMs ?? 0;
    if (pdmg <= 0 || nowMs < pnext || nowMs >= pexp) return m;
    const newHp = m.hp - pdmg;
    if (newHp <= 0) return { ...m, hp: 0 }; // kills resolved below
    return { ...m, hp: newHp, poisonNextTickMs: pnext + DOT_TICK_MS };
  });
  // Remove monsters killed by DoT and add their loot
  let sSoFar: MineState = { ...s, monsters };
  for (const m of monsters) {
    if (m.hp <= 0) sSoFar = killMonster(sSoFar, m, rng);
  }
  if (sSoFar.status !== 'active') return sSoFar;
  s = sSoFar;
  monsters = s.monsters;

  // --- BFS flow field toward the nearest player (all players in co-op) ---
  const players = coPlayers.length > 0 ? [s.player, ...coPlayers] : [s.player];
  const field = floodFieldMulti(
    players,
    s.rows,
    s.cols,
    (r, c) => isWalkable(tileAt(s, r, c) as MineTile | undefined),
  );

  // --- Move each monster ---
  let changed = false;
  const newOccupied = new Set<string>(monsters.map((m) => `${m.r},${m.c}`));

  const movedMonsters = monsters.map((m) => {
    const def = MINE_MONSTERS[m.key];
    if (!def || nowMs < m.readyAtMs) return m;
    if (m.frozenUntilMs && nowMs < m.frozenUntilMs) return m;

    // Don't move if already adjacent to any player (just attack in contact phase)
    if (players.some((p) => adjacent(m, p))) return m;

    // Per-monster blocked set: other monsters + every player's cell
    const blocked = new Set<string>(players.map((p) => `${p.r},${p.c}`));
    for (const other of monsters) {
      if (other.id !== m.id) blocked.add(`${other.r},${other.c}`);
    }
    // ARCH-05: also block cells already claimed by monsters that moved earlier this
    // tick, so two monsters can't path onto the same free cell in one step.
    for (const k of newOccupied) blocked.add(k);

    const next = flowStep({ r: m.r, c: m.c }, field, blocked);
    if (!next) return m;

    newOccupied.delete(`${m.r},${m.c}`);
    newOccupied.add(`${next.r},${next.c}`);
    changed = true;
    return { ...m, r: next.r, c: next.c, readyAtMs: nowMs + def.moveCadenceMs };
  });

  // --- Contact damage from adjacent monsters (one hit per i-frame window) ---
  let hp = s.hp;
  let lastHitAtMs = s.lastHitAtMs;
  if (nowMs - s.lastHitAtMs >= MINE_IFRAME_MS) {
    // MINI-17: a frozen/staggered monster can't bite — parity with the forest (forest.ts),
    // which is what gives the charge verb's 500ms stagger its defensive value in the mine.
    const toucher = movedMonsters.find((m) => !(m.frozenUntilMs && nowMs < m.frozenUntilMs) && adjacent(m, s.player));
    if (toucher) {
      const def = MINE_MONSTERS[toucher.key];
      const raw = Math.round((def?.touchDamage ?? 1) * lateDepthDamageScale(s.floor - MAGMA_BAND_START));
      const bless = activeStatus(s.playerStatuses, 'bless', nowMs);
      const dealt = Math.max(1, raw - s.defense - (bless ? bless.magnitude : 0) - boonDefenseBonus(s.activeBoons));
      hp = Math.max(0, hp - dealt);
      lastHitAtMs = nowMs;
      changed = true;
    }
  }

  // --- Ring of fire ---
  let ringOfFire = s.ringOfFire;
  let ringNextHitMs = s.ringNextHitMs;
  let ringMonsters = movedMonsters;
  if (ringOfFire && nowMs < ringOfFire.expiresAtMs) {
    ringMonsters = ringMonsters.map((m) => {
      if (!adjacent(m, s.player)) return m;
      const nextHit = ringNextHitMs[m.id] ?? 0;
      if (nowMs < nextHit) return m;
      const newHp = m.hp - ringOfFire!.dmg;
      ringNextHitMs = { ...ringNextHitMs, [m.id]: nowMs + RING_HIT_CD_MS };
      changed = true;
      if (newHp <= 0) return { ...m, hp: 0 };
      return { ...m, hp: newHp };
    });
    // Kill ring-of-fire dead monsters
    let ringSoFar: MineState = { ...s, monsters: ringMonsters, hp, lastHitAtMs, ringNextHitMs };
    for (const m of ringMonsters) {
      if (m.hp <= 0) ringSoFar = killMonster(ringSoFar, m, rng);
    }
    if (ringSoFar.status !== 'active') return ringSoFar;
    s = ringSoFar;
    ringMonsters = s.monsters;
  } else if (ringOfFire && nowMs >= ringOfFire.expiresAtMs) {
    ringOfFire = null;
    changed = true;
  }

  // --- Rune triggers ---
  let result: MineState = {
    ...s,
    monsters: ringMonsters,
    hp,
    lastHitAtMs,
    ringOfFire,
    ringNextHitMs,
    playerStatuses: pruneStatuses(s.playerStatuses, nowMs),
  };
  result = triggerRunes(result, nowMs, rng);

  if (!changed && result === s) return state; // idle tick: skip re-render
  return { ...result, status: result.hp <= 0 ? 'ended' : result.status };
}

// ---------------------------------------------------------------------------
// Co-op helpers (Phase 3). The host runs stepMonsters (above) authoritatively;
// these support the client side and host-resolved remote attacks.
// ---------------------------------------------------------------------------

/**
 * Client-side per-tick step for a co-op guest. Monsters are positioned by the
 * host (applied separately), so this does NOT move monsters, run runes, or resolve
 * monster kills (all host-authoritative). It only advances the LOCAL player's own
 * body: stamina/mp regen, status expiry, and contact damage from any adjacent
 * monster (each client owns its own HP under trust-the-client). Mirrors the regen
 * + contact-damage blocks of {@link stepMonsters}.
 */
export function coopClientStep(state: MineState, nowMs: number): MineState {
  return crawlCoopClientStep(state, nowMs, mineContactCaps);
}

/**
 * Host-side: apply a remote player's attack to a monster by id, so that a kill
 * resolves exactly once on the authoritative host (loot is granted to the host's
 * `haul`; remote players bank their own ore/kills client-side under trust-client).
 */
export function damageMonsterById(
  state: MineState,
  monsterId: string,
  dmg: number,
  rng: RNG,
): MineState {
  return crawlDamageUnitById(state, monsterId, dmg, rng, mineUnitCaps);
}

// ---------------------------------------------------------------------------
// Phase 5: boon choice resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the player's boon pick: appends the chosen key to `activeBoons`,
 * clears `pendingBoonChoice`, restores `status:'active'`, and immediately
 * recomputes `moveIntervalMs`/`dashCooldownMs` so the speed boon is felt on
 * the current floor (not only after the next descent).
 * No-ops if no choice is pending or the key is not in the offered set.
 */
export function applyBoonChoice(state: MineState, key: string): MineState {
  return crawlApplyBoonChoice(state, key, { getBoon: (k) => BOONS[k], boonMoveMult, boonDashCdMult });
}
