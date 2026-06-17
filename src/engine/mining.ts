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
import { attackRoll, spellDamageRoll, spellHealAmount } from './combat';
import { getSpell, SCHOOL_STAT } from './spells';
import type { WeaponDef } from './weapons';
import { MINE_ORES, MINE_MONSTERS, type MineOreDef } from '@/content/mining';
import {
  type Dir,
  type RNG,
  type CrawlRune,
  type CrawlStatusEffect,
  type CrawlRingOfFire,
  DIRS,
  randInt,
  floodField,
  flowStep,
  adjacent,
  manhattan,
  applyStatus,
  pruneStatuses,
  activeStatus,
  DOT_TICK_MS,
  FREEZE_DURATION_MS,
  RING_HIT_CD_MS,
  RING_DURATION_MS,
  STA_REGEN_MS,
  MP_REGEN_MS,
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

/** Run entry gates. */
export const MINE_ENERGY_COST = 2;
export const MINE_UNLOCK_LEVEL = 2;

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

export type MineTileKind = 'floor' | 'rock' | 'ore' | 'bedrock' | 'shaft' | 'entrance';

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
  status: 'active' | 'ended' | 'banking';
  lastHitAtMs: number;
  deepest: number;
  killsThisFloor: number;
  // Spell effects
  runes: CrawlRune[];
  ringOfFire: CrawlRingOfFire | null;
  ringNextHitMs: Record<string, number>;
  playerStatuses: CrawlStatusEffect[];
  lastSpellMs: number;
  // Running rune ID counter
  nextRuneId: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function tileAt(state: MineState, r: number, c: number): MineTile | undefined {
  return state.tiles[r]?.[c];
}

export function isWalkable(tile: MineTile | undefined): boolean {
  return !!tile && (tile.kind === 'floor' || tile.kind === 'entrance' || tile.kind === 'shaft');
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

/** Kill-drop: loot pool scales with floor depth. */
function monsterLootPool(floor: number): Array<{ kind: 'gold' } | { kind: 'material'; material: string }> {
  const pool: Array<{ kind: 'gold' } | { kind: 'material'; material: string }> = [{ kind: 'gold' }];
  pool.push({ kind: 'material', material: 'bronze_bar' });
  if (floor >= 3) pool.push({ kind: 'material', material: 'iron_bar' });
  if (floor >= 6) pool.push({ kind: 'material', material: 'crystals' });
  if (floor >= 10) pool.push({ kind: 'material', material: 'gemstone' });
  return pool;
}

function avgNodeDurability(floor: number): number {
  const ores = Object.values(MINE_ORES).filter((o) => o.floorMin <= floor && o.weight > 0);
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
  return Object.values(MINE_ORES).filter((o) => o.floorMin <= floor);
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
  const eligibleMon = Object.values(MINE_MONSTERS).filter((m) => m.floorMin <= floor);
  const monCount = eligibleMon.length === 0 ? 0 : Math.min(10, 2 + Math.floor(floor * 0.6));
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
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    lastSpellMs: -SPELL_CD_MS,
    nextRuneId: 1,
  };
}

/** Descend the shaft into a richer, deeper floor — carries HP/sta/mp/haul forward. */
export function descend(state: MineState, rng: RNG): MineState {
  if (!canDescend(state) || state.status !== 'active') return state;
  const snap: MineSnapshot = {
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
  };
  const next = generateMine(state.floor + 1, snap, rng);
  return {
    ...next,
    hp: state.hp,
    sta: Math.min(state.maxSta, state.sta + Math.round(state.maxSta * 0.25)), // partial refill
    mp: Math.min(state.maxMp, state.mp + Math.round(state.maxMp * 0.25)),
    haul: state.haul,
    deepest: Math.max(state.deepest, state.floor + 1),
  };
}

// ---------------------------------------------------------------------------
// Player movement
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

// ---------------------------------------------------------------------------
// Player attack (auto-context: weapon vs monster, pickaxe vs rock)
// ---------------------------------------------------------------------------

function killMonster(state: MineState, mon: MineMonster, rng: RNG): MineState {
  const killBonus = state.killsThisFloor + 1;
  const swingsToKill = Math.ceil(mon.maxHp / Math.max(1, state.meleePower));
  const qty = Math.max(1, Math.round(swingsToKill / avgNodeDurability(state.floor)) + killBonus);
  const pool = monsterLootPool(state.floor);
  const pick = pool[Math.floor(rng() * pool.length)];
  const drop: Reward =
    pick.kind === 'gold' ? { gold: qty } : { materials: { [pick.material]: qty } };
  return {
    ...state,
    monsters: state.monsters.filter((m) => m.id !== mon.id),
    haul: mergeReward(state.haul, drop),
    killsThisFloor: state.killsThisFloor + 1,
  };
}

/**
 * Swing the pick at the faced cell.  Auto-context:
 *   • monster → weapon attack (uses equipped weapon's stat, bonus, staminaCost)
 *   • rock/ore → pickaxe mining (uses pickaxePower; falls back to 1 if no pick)
 */
export function strike(state: MineState, rng: RNG): MineState {
  if (state.status !== 'active') return state;
  const { r, c } = facedCell(state);

  // --- Monster in the way: weapon attack ---
  const mon = monsterAt(state, r, c);
  if (mon) {
    const def = MINE_MONSTERS[mon.key];
    const staCost = state.weapon.staminaCost ?? MELEE_STA_FALLBACK;
    if (state.sta < 1) return state; // need at least 1 sta
    const full = state.sta >= staCost;
    const power = state.weapon.attackStat === 'DX' ? state.rangedPower : state.meleePower;
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
    return {
      ...state,
      sta: newSta,
      monsters: state.monsters.map((m) => (m.id === mon.id ? { ...m, hp: newHp } : m)),
    };
  }

  // --- Rock or ore: pickaxe mining ---
  const tile = tileAt(state, r, c);
  if (!tile || (tile.kind !== 'rock' && tile.kind !== 'ore')) return state;
  if (state.sta <= 0) return state;

  const pickPower = state.pickaxePower > 0 ? state.pickaxePower : 1;
  const dur = (tile.durability ?? 1) - pickPower;
  const tiles = state.tiles.map((row) => row.slice());
  let haul = state.haul;
  const oreBroke = dur <= 0 && tile.kind === 'ore';

  if (dur <= 0) {
    if (tile.kind === 'ore' && tile.oreKey) haul = mergeReward(haul, oreYield(tile.oreKey, rng));
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

export function castSpell(state: MineState, spellKey: string, nowMs: number, rng: RNG): MineState {
  if (state.status !== 'active') return state;
  if (!state.knownSpells.includes(spellKey)) return state;
  const spell = getSpell(spellKey);
  if (!spell || state.mp < spell.mpCost) return state;
  if (nowMs - state.lastSpellMs < SPELL_CD_MS) return state;

  let s: MineState = { ...state, mp: state.mp - spell.mpCost, lastSpellMs: nowMs };
  const schoolStat = SCHOOL_STAT[spell.school];

  // Rune placement (on the faced floor tile)
  if (spell.mechanic === 'rune-fire' || spell.mechanic === 'rune-ice' || spell.mechanic === 'rune-poison') {
    const kind = spell.mechanic.slice(5) as 'fire' | 'ice' | 'poison';
    const { r, c } = facedCell(s);
    const t = tileAt(s, r, c);
    if (t && isWalkable(t)) {
      const { dealt } = spellDamageRoll(spell.power, s.damageSpell, schoolStat, [], [], 0, rng);
      const rune: CrawlRune = {
        id: s.nextRuneId,
        r, c, kind, power: dealt,
        expiresAtMs: nowMs + 30000,
      };
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
        if (d >= 3 && d <= 6 && isWalkable(tileAt(s, row, col)) && !monsterAt(s, row, col)) {
          candidates.push({ r: row, c: col });
        }
      }
    }
    if (candidates.length > 0) {
      const dest = candidates[Math.floor(rng() * candidates.length)];
      s = { ...s, player: { ...s.player, r: dest.r, c: dest.c } };
    }
    return s;
  }

  // Damage spell: hit nearest monster
  if (spell.school === 'damage') {
    const target = nearestMonster(s);
    if (target) {
      const def = MINE_MONSTERS[target.key];
      const { dealt } = spellDamageRoll(
        spell.power, s.damageSpell, schoolStat,
        (def?.weakTo ?? []) as StatId[],
        (def?.resistTo ?? []) as StatId[],
        def?.defense ?? 0, rng,
      );
      const newHp = target.hp - dealt;
      if (newHp <= 0) {
        s = killMonster(s, target, rng);
      } else {
        let updatedMon = s.monsters.map((m) => m.id === target.id ? { ...m, hp: newHp } : m);
        // Apply status if applicable (e.g. fire → burn, ice → freeze, poison)
        if (spell.status) {
          const key = spell.status.key;
          if (key === 'burn' || key === 'poison') {
            const magnitude = spell.status.magnitude;
            const durationMs = spell.status.turns * DOT_TICK_MS;
            if (key === 'burn') {
              updatedMon = updatedMon.map((m) =>
                m.id === target.id
                  ? { ...m, poisonDmg: Math.max(m.poisonDmg ?? 0, magnitude), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + durationMs }
                  : m
              );
            } else {
              updatedMon = updatedMon.map((m) =>
                m.id === target.id
                  ? { ...m, poisonDmg: Math.max(m.poisonDmg ?? 0, magnitude), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + durationMs }
                  : m
              );
            }
          } else if (key === 'freeze') {
            updatedMon = updatedMon.map((m) =>
              m.id === target.id ? { ...m, frozenUntilMs: nowMs + FREEZE_DURATION_MS } : m
            );
          }
        }
        s = { ...s, monsters: updatedMon };
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

  // Illusion spell: apply debuff to nearest monster
  if (spell.school === 'illusion' && spell.status) {
    const target = nearestMonster(s);
    if (target) {
      const { key, magnitude, turns } = spell.status;
      const durationMs = (turns + Math.floor(s.illusionPower / 8)) * DOT_TICK_MS;
      if (key === 'freeze') {
        s = {
          ...s,
          monsters: s.monsters.map((m) =>
            m.id === target.id ? { ...m, frozenUntilMs: nowMs + Math.max(FREEZE_DURATION_MS, durationMs) } : m
          ),
        };
      } else if (key === 'poison') {
        s = {
          ...s,
          monsters: s.monsters.map((m) =>
            m.id === target.id
              ? { ...m, poisonDmg: Math.max(m.poisonDmg ?? 0, magnitude), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + durationMs }
              : m
          ),
        };
      }
    }
    return s;
  }

  return s;
}

// ---------------------------------------------------------------------------
// Rune triggers (called after any unit moves)
// ---------------------------------------------------------------------------

function triggerRunes(state: MineState, nowMs: number, rng: RNG): MineState {
  if (state.runes.length === 0) return state;

  const triggered = new Set<number>();
  let s = state;

  const fireRune = (rune: CrawlRune, monsterId: string | null) => {
    triggered.add(rune.id);
    if (monsterId === null) {
      // Hit player
      if (nowMs - s.lastHitAtMs >= MINE_IFRAME_MS) {
        const dealt = Math.max(1, Math.round(rune.power * 0.5) - s.ward);
        s = { ...s, hp: Math.max(0, s.hp - dealt), lastHitAtMs: nowMs };
        if (s.hp <= 0) s = { ...s, status: 'ended' };
      }
    } else {
      const mon = s.monsters.find((m) => m.id === monsterId);
      if (!mon) return;
      const newHp = mon.hp - rune.power;
      if (newHp <= 0) {
        s = killMonster(s, mon, rng);
      } else {
        let updatedMon = s.monsters.map((m) => m.id === monsterId ? { ...m, hp: newHp } : m);
        if (rune.kind === 'fire') {
          updatedMon = updatedMon.map((m) =>
            m.id === monsterId
              ? { ...m, poisonDmg: Math.max(m.poisonDmg ?? 0, Math.round(rune.power * 0.3)), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + DOT_TICK_MS * 3 }
              : m
          );
        } else if (rune.kind === 'ice') {
          updatedMon = updatedMon.map((m) =>
            m.id === monsterId ? { ...m, frozenUntilMs: nowMs + FREEZE_DURATION_MS } : m
          );
        } else if (rune.kind === 'poison') {
          updatedMon = updatedMon.map((m) =>
            m.id === monsterId
              ? { ...m, poisonDmg: Math.max(m.poisonDmg ?? 0, Math.round(rune.power * 0.25)), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + DOT_TICK_MS * 4 }
              : m
          );
        }
        s = { ...s, monsters: updatedMon };
      }
    }
  };

  // Check if player stepped on a rune
  for (const rune of s.runes) {
    if (triggered.has(rune.id)) continue;
    if (rune.r === s.player.r && rune.c === s.player.c) {
      fireRune(rune, null);
    }
  }
  // Check if any monster stepped on a rune
  for (const mon of s.monsters) {
    for (const rune of s.runes) {
      if (triggered.has(rune.id)) continue;
      if (rune.r === mon.r && rune.c === mon.c) {
        fireRune(rune, mon.id);
      }
    }
  }

  // Expire old runes
  const survivors = s.runes.filter((r) => !triggered.has(r.id) && r.expiresAtMs > nowMs);
  return { ...s, runes: survivors };
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
export function stepMonsters(state: MineState, nowMs: number, rng: RNG): MineState {
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

  // --- BFS flow field from player ---
  const field = floodField(
    s.player,
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

    // Don't move if already adjacent to the player (just attack in contact phase)
    if (adjacent(m, s.player)) return m;

    // Per-monster blocked set: other monsters + player cell
    const blocked = new Set<string>([`${s.player.r},${s.player.c}`]);
    for (const other of monsters) {
      if (other.id !== m.id) blocked.add(`${other.r},${other.c}`);
    }

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
    const toucher = movedMonsters.find((m) => adjacent(m, s.player));
    if (toucher) {
      const def = MINE_MONSTERS[toucher.key];
      const raw = def?.touchDamage ?? 1;
      const bless = activeStatus(s.playerStatuses, 'bless', nowMs);
      const dealt = Math.max(1, raw - s.defense - (bless ? bless.magnitude : 0));
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
