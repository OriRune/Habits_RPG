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
import { attackRoll, spellDamageRoll, spellHealAmount } from './combat';
import { getSpell, SCHOOL_STAT } from './spells';
import type { WeaponDef } from './weapons';
import { FOREST_NODES, FOREST_BEASTS, SHRINE_EVENTS, type ForestNodeDef } from '@/content/forest';
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
  applyStatus,
  pruneStatuses,
  activeStatus,
  DOT_TICK_MS,
  FREEZE_DURATION_MS,
  RING_HIT_CD_MS,
  RING_DURATION_MS,
  STA_REGEN_MS,
  MP_REGEN_MS,
  DASH_BASE_CD_MS,
  STAGGER_MS,
  CHARGE_DAMAGE_MULT,
  dashCooldown,
  moveInterval,
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

export type ForestTileKind = 'trail' | 'thicket' | 'tree' | 'clearing' | 'entrance' | 'treeline' | 'node' | 'shrine';

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
  status: 'active' | 'ended' | 'banking';
  lastHitAtMs: number;
  deepest: number;
  killsThisStage: number;
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
     tile.kind === 'treeline' || tile.kind === 'shrine')
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

/** Standing on the far tree line means the way deeper is open. */
export function canAdvance(state: ForestState): boolean {
  return tileAt(state, state.player.r, state.player.c)?.kind === 'treeline';
}

/** Current sight radius — wider when standing in a clearing. */
export function sightRadiusFor(state: ForestState): number {
  return tileAt(state, state.player.r, state.player.c)?.kind === 'clearing'
    ? CLEARING_SIGHT_RADIUS
    : SIGHT_RADIUS;
}

/** Circular sight test (≈ a disc so the lit area reads like a torch glow). */
function withinSight(dr: number, dc: number, rad: number): boolean {
  return dr * dr + dc * dc <= (rad + 0.5) * (rad + 0.5);
}

/** Whether a cell is inside the player's *current* sight (drives beast visibility). */
export function isVisible(state: ForestState, r: number, c: number): boolean {
  return withinSight(r - state.player.r, c - state.player.c, sightRadiusFor(state));
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
  return Object.values(FOREST_NODES).filter((n) => n.stageMin <= stage);
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

// ---------------------------------------------------------------------------
// Kill-loot helper
// ---------------------------------------------------------------------------

function killBeast(state: ForestState, beast: ForestBeast, rng: RNG): ForestState {
  const def = FOREST_BEASTS[beast.key];
  const gold = def ? randInt(def.bounty[0], def.bounty[1], rng) : 0;
  // Prey carry a custom material/amount; predators default to leather scaled by kill streak.
  const matKey = def?.dropMaterial ?? 'leather';
  const qty = def?.dropAmount
    ? randInt(def.dropAmount[0], def.dropAmount[1], rng)
    : Math.max(1, Math.round(beast.maxHp / 10) + state.killsThisStage);
  const drop: Reward = mergeReward(
    { materials: { [matKey]: qty } },
    gold > 0 ? { gold } : {},
  );
  return {
    ...state,
    beasts: state.beasts.filter((b) => b.id !== beast.id),
    haul: mergeReward(state.haul, drop),
    killsThisStage: state.killsThisStage + 1,
  };
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
  const eligibleBeasts = Object.values(FOREST_BEASTS).filter((b) => b.stageMin <= stage);
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

    // Beasts on remaining open clearing cells (1-3).
    if (eligibleBeasts.length > 0) {
      const openRoom: [number, number][] = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (tiles[nr]?.[nc]?.kind === 'clearing') openRoom.push([nr, nc]);
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

    // ~40% chance: turn the clearing centre into an activatable shrine.
    // The centre is always connected via the room's edge cells, so walkable
    // shrine tiles preserve maze reachability.
    if (rng() < 0.4 && tiles[cr][cc].kind === 'clearing') {
      const ev = weightedShrine(stage, rng);
      tiles[cr][cc] = { kind: 'shrine', shrineKey: ev.key };
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
  const trailCells: [number, number][] = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (tiles[r][c].kind === 'trail' && Math.abs(r - 1) + Math.abs(c - startC) > 4) {
        trailCells.push([r, c]);
      }
    }
  }
  shuffle(trailCells);
  const wanderCount = eligibleBeasts.length === 0 ? 0 : Math.min(16, 5 + stage);
  for (let i = 0; i < wanderCount && i < trailCells.length; i++) {
    const [r, c] = trailCells[i];
    const def = eligibleBeasts[Math.floor(rng() * eligibleBeasts.length)];
    beasts.push({
      id: `b${stage}-${beastId++}`, key: def.key,
      r, c, hp: def.hp, maxHp: def.hp,
      readyAtMs: 0, asleep: true,
    });
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
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    lastSpellMs: -SPELL_CD_MS,
    nextRuneId: 1,
    lastShot: null,
    // Phase 1: dash + speed derived from AG
    lastDashMs: -DASH_BASE_CD_MS,
    dashCooldownMs: dashCooldown(snapshot.agLevel),
    moveIntervalMs: moveInterval(snapshot.agLevel),
    agLevel: snapshot.agLevel,
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
  };
}

export function advance(state: ForestState, rng: RNG): ForestState {
  if (!canAdvance(state) || state.status !== 'active') return state;
  const next = generateForest(state.stage + 1, forestSnapshot(state), rng);
  const staRefill = Math.round(state.maxSta * 0.25);
  const mpRefill = Math.round(state.maxMp * 0.25);
  return {
    ...next,
    hp: state.hp,
    sta: Math.min(state.maxSta, state.sta + staRefill),
    mp: Math.min(state.maxMp, state.mp + mpRefill),
    haul: state.haul,
    deepest: Math.max(state.deepest, state.stage + 1),
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
        const shot = { fromR: state.player.r, fromC: state.player.c, toR: shotTo.r, toC: shotTo.c, at: Date.now() };
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
    // Charged swing multiplies attack power.
    const power = charged ? basePower * CHARGE_DAMAGE_MULT : basePower;
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
    const tiles = state.tiles.map((row) => row.slice());
    let haul = state.haul;
    const newSta = Math.max(0, state.sta - CHOP_STA_COST);
    if (dur <= 0) {
      // Tree felled — opens a dead-end pocket (routing-safe by construction).
      tiles[r][c] = { kind: 'trail' };
      const woodAmt = randInt(maxDur, Math.min(3, maxDur + 1), rng);
      haul = mergeReward(haul, { materials: { wood: woodAmt } });
    } else {
      tiles[r][c] = { ...tile, durability: dur };
    }
    return { ...state, sta: newSta, tiles, haul };
  }

  // --- Gather a node instantly ---
  if (tile.kind === 'node' && tile.nodeKey) {
    const tiles = state.tiles.map((row) => row.slice());
    tiles[r][c] = { kind: 'trail' };
    const nodeDef = FOREST_NODES[tile.nodeKey];
    if (nodeDef?.grants.kind === 'stamina') {
      const restore = randInt(nodeDef.grants.amount[0], nodeDef.grants.amount[1], rng);
      return { ...state, tiles, sta: Math.min(state.maxSta, state.sta + restore) };
    }
    return { ...state, tiles, haul: mergeReward(state.haul, nodeYield(tile.nodeKey, rng)) };
  }

  return state;
}

// ---------------------------------------------------------------------------
// Spell casting (mirrors mining.ts castSpell)
// ---------------------------------------------------------------------------

export function castSpell(state: ForestState, spellKey: string, nowMs: number, rng: RNG): ForestState {
  if (state.status !== 'active') return state;
  if (nowMs - state.lastSpellMs < SPELL_CD_MS) return state;

  const spell = getSpell(spellKey);
  if (!spell) return state;
  if (state.mp < spell.mpCost) return state;

  let s = { ...state, mp: state.mp - spell.mpCost, lastSpellMs: nowMs };

  const schoolStat = SCHOOL_STAT[spell.school];

  // ---------- Rune placement ----------
  if (spell.mechanic === 'rune-fire' || spell.mechanic === 'rune-ice' || spell.mechanic === 'rune-poison') {
    const kind = spell.mechanic.slice(5) as 'fire' | 'ice' | 'poison';
    const { r, c } = facedCell(s);
    const tile = tileAt(s, r, c);
    if (tile && isWalkable(tile)) {
      const { dealt } = spellDamageRoll(spell.power, s.damageSpell, schoolStat, [], [], 0, rng);
      const rune: CrawlRune = { id: s.nextRuneId, r, c, kind, power: dealt, expiresAtMs: nowMs + 30000 };
      s = { ...s, runes: [...s.runes, rune], nextRuneId: s.nextRuneId + 1 };
    }
    return s;
  }

  // ---------- Ring of fire ----------
  if (spell.mechanic === 'ring-of-fire') {
    const dmg = Math.max(2, Math.round(spell.power + s.damageSpell * 0.5));
    return { ...s, ringOfFire: { expiresAtMs: nowMs + RING_DURATION_MS, dmg }, ringNextHitMs: {} };
  }

  // ---------- Teleport ----------
  if (spell.mechanic === 'teleport') {
    const { r: pr, c: pc } = s.player;
    const candidates: Array<{ r: number; c: number }> = [];
    for (let row = 0; row < s.rows; row++) {
      for (let col = 0; col < s.cols; col++) {
        const d = manhattan({ r: row, c: col }, { r: pr, c: pc });
        if (d >= 3 && d <= 6 && isWalkable(tileAt(s, row, col)) && !beastAt(s, row, col)) {
          candidates.push({ r: row, c: col });
        }
      }
    }
    if (candidates.length > 0) {
      const dest = candidates[Math.floor(rng() * candidates.length)];
      s = { ...s, player: { ...s.player, r: dest.r, c: dest.c } };
    }
    return reveal(s);
  }

  // ---------- Damage spell: hit nearest beast ----------
  if (spell.school === 'damage') {
    const target = nearestBeast(s);
    if (target) {
      const def = FOREST_BEASTS[target.key];
      const { dealt } = spellDamageRoll(
        spell.power, s.damageSpell, schoolStat,
        (def?.weakTo ?? []) as StatId[],
        (def?.resistTo ?? []) as StatId[],
        def?.defense ?? 0, rng,
      );
      const newHp = target.hp - dealt;
      if (newHp <= 0) {
        s = killBeast(s, target, rng);
      } else {
        let updatedBeasts = s.beasts.map((b) => (b.id === target.id ? { ...b, hp: newHp } : b));
        if (spell.status) {
          const { key, magnitude, turns } = spell.status;
          const durationMs = turns * DOT_TICK_MS;
          if (key === 'burn' || key === 'poison') {
            updatedBeasts = updatedBeasts.map((b) =>
              b.id === target.id
                ? { ...b, poisonDmg: Math.max(b.poisonDmg ?? 0, magnitude), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + durationMs }
                : b
            );
          } else if (key === 'freeze') {
            updatedBeasts = updatedBeasts.map((b) =>
              b.id === target.id ? { ...b, frozenUntilMs: nowMs + FREEZE_DURATION_MS } : b
            );
          }
        }
        s = { ...s, beasts: updatedBeasts };
      }
    }
    return s;
  }

  // ---------- Support spell: heal / bless ----------
  if (spell.school === 'support') {
    if (spell.power > 0) {
      const heal = spellHealAmount(spell.power, s.supportSpell);
      s = { ...s, hp: Math.min(s.maxHp, s.hp + heal) };
    }
    if (spell.status) {
      const { key, magnitude, turns } = spell.status;
      s = {
        ...s,
        playerStatuses: applyStatus(
          s.playerStatuses,
          { key: key as CrawlStatusEffect['key'], magnitude, durationMs: turns * DOT_TICK_MS },
          nowMs,
        ),
      };
    }
    return s;
  }

  // ---------- Illusion spell: debuff nearest beast ----------
  if (spell.school === 'illusion' && spell.status) {
    const target = nearestBeast(s);
    if (target) {
      const { key, magnitude, turns } = spell.status;
      const durationMs = (turns + Math.floor(s.illusionPower / 8)) * DOT_TICK_MS;
      if (key === 'freeze') {
        s = {
          ...s,
          beasts: s.beasts.map((b) =>
            b.id === target.id ? { ...b, frozenUntilMs: nowMs + Math.max(FREEZE_DURATION_MS, durationMs) } : b
          ),
        };
      } else if (key === 'poison') {
        s = {
          ...s,
          beasts: s.beasts.map((b) =>
            b.id === target.id
              ? { ...b, poisonDmg: Math.max(b.poisonDmg ?? 0, magnitude), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + durationMs }
              : b
          ),
        };
      }
    }
    return s;
  }

  return s;
}

// ---------------------------------------------------------------------------
// Rune triggers
// ---------------------------------------------------------------------------

function triggerRunes(state: ForestState, nowMs: number, rng: RNG): ForestState {
  if (state.runes.length === 0) return state;
  const triggered = new Set<number>();
  let s = state;

  const fireRune = (rune: CrawlRune, beastId: string | null) => {
    triggered.add(rune.id);
    if (beastId === null) {
      if (nowMs - s.lastHitAtMs >= FOREST_IFRAME_MS) {
        const dealt = Math.max(1, Math.round(rune.power * 0.5) - s.ward);
        s = { ...s, hp: Math.max(0, s.hp - dealt), lastHitAtMs: nowMs };
        if (s.hp <= 0) s = { ...s, status: 'ended' };
      }
    } else {
      const beast = s.beasts.find((b) => b.id === beastId);
      if (!beast) return;
      const newHp = beast.hp - rune.power;
      if (newHp <= 0) {
        s = killBeast(s, beast, rng);
      } else {
        let updated = s.beasts.map((b) => (b.id === beastId ? { ...b, hp: newHp } : b));
        if (rune.kind === 'fire') {
          updated = updated.map((b) =>
            b.id === beastId
              ? { ...b, poisonDmg: Math.max(b.poisonDmg ?? 0, Math.round(rune.power * 0.3)), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + DOT_TICK_MS * 3 }
              : b
          );
        } else if (rune.kind === 'ice') {
          updated = updated.map((b) =>
            b.id === beastId ? { ...b, frozenUntilMs: nowMs + FREEZE_DURATION_MS } : b
          );
        } else if (rune.kind === 'poison') {
          updated = updated.map((b) =>
            b.id === beastId
              ? { ...b, poisonDmg: Math.max(b.poisonDmg ?? 0, Math.round(rune.power * 0.25)), poisonNextTickMs: nowMs + DOT_TICK_MS, poisonExpiresMs: nowMs + DOT_TICK_MS * 4 }
              : b
          );
        }
        s = { ...s, beasts: updated };
      }
    }
  };

  // Check if player stepped on a rune
  for (const rune of s.runes) {
    if (!triggered.has(rune.id) && rune.r === s.player.r && rune.c === s.player.c) {
      fireRune(rune, null);
    }
  }
  // Check if any beast stepped on a rune
  for (const rune of s.runes) {
    for (const beast of s.beasts) {
      if (!triggered.has(rune.id) && beast.r === rune.r && beast.c === rune.c) {
        fireRune(rune, beast.id);
      }
    }
  }
  if (triggered.size > 0) {
    s = { ...s, runes: s.runes.filter((r) => !triggered.has(r.id)) };
  }
  return s;
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
  if (nowMs >= s.staNextRegenMs && s.sta < s.maxSta) {
    s = { ...s, sta: Math.min(s.maxSta, s.sta + 1), staNextRegenMs: nowMs + STA_REGEN_MS };
  }
  if (nowMs >= s.mpNextRegenMs && s.mp < s.maxMp) {
    s = { ...s, mp: Math.min(s.maxMp, s.mp + 1), mpNextRegenMs: nowMs + MP_REGEN_MS };
  }

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
      const rawDmg = def?.touchDamage ?? 0;
      // Defense (from support-spell bless) mitigates contact damage.
      const blessedDefense = activeStatus(s.playerStatuses, 'bless', nowMs) ? s.defense : 0;
      const dealt = Math.max(1, rawDmg - blessedDefense - s.ward);
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
  if (state.status !== 'active' || dmg <= 0) return state;
  const beast = state.beasts.find((b) => b.id === beastId);
  if (!beast) return state;
  const newHp = beast.hp - dmg;
  if (newHp <= 0) return killBeast(state, beast, rng);
  return {
    ...state,
    beasts: state.beasts.map((b) => (b.id === beastId ? { ...b, hp: newHp } : b)),
  };
}

/**
 * Co-op guest per-tick: advance only the local body — regen, own contact damage
 * from an adjacent predator (i-frame gated, no windup telegraph), status pruning.
 * The host owns beast movement/AI and broadcasts it. Mirrors the mine's coopClientStep.
 */
export function coopClientStep(state: ForestState, nowMs: number): ForestState {
  if (state.status !== 'active') return state;
  let s = state;

  if (nowMs >= s.staNextRegenMs && s.sta < s.maxSta) {
    s = { ...s, sta: Math.min(s.maxSta, s.sta + 1), staNextRegenMs: nowMs + STA_REGEN_MS };
  }
  if (nowMs >= s.mpNextRegenMs && s.mp < s.maxMp) {
    s = { ...s, mp: Math.min(s.maxMp, s.mp + 1), mpNextRegenMs: nowMs + MP_REGEN_MS };
  }

  let hp = s.hp;
  let lastHitAtMs = s.lastHitAtMs;
  if (nowMs - s.lastHitAtMs >= FOREST_IFRAME_MS) {
    const toucher = s.beasts.find((b) => {
      const def = FOREST_BEASTS[b.key];
      if (b.asleep || !def || def.flees || def.touchDamage <= 0) return false;
      if (b.frozenUntilMs && nowMs < b.frozenUntilMs) return false;
      return adjacent(b, s.player);
    });
    if (toucher) {
      const def = FOREST_BEASTS[toucher.key];
      const blessedDefense = activeStatus(s.playerStatuses, 'bless', nowMs) ? s.defense : 0;
      const dealt = Math.max(1, (def?.touchDamage ?? 0) - blessedDefense - s.ward);
      hp = Math.max(0, hp - dealt);
      lastHitAtMs = nowMs;
    }
  }

  const playerStatuses = pruneStatuses(s.playerStatuses, nowMs);
  if (hp === s.hp && lastHitAtMs === s.lastHitAtMs && s === state) return state;
  return { ...s, hp, lastHitAtMs, playerStatuses, status: hp <= 0 ? 'ended' : s.status };
}

// ---------------------------------------------------------------------------
// Death forfeit
// ---------------------------------------------------------------------------

/**
 * Split a haul into the portion the player keeps and the portion forfeited on death.
 */
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
 */
export function activateShrine(state: ForestState, nowMs: number, rng: RNG): ForestState {
  if (state.status !== 'active') return state;
  const tile = tileAt(state, state.player.r, state.player.c);
  if (tile?.kind !== 'shrine' || !tile.shrineKey) return state;

  const event = SHRINE_EVENTS[tile.shrineKey];
  if (!event) return state;

  // Consume the shrine tile.
  const tiles = state.tiles.map((row) => row.slice());
  tiles[state.player.r][state.player.c] = { kind: 'clearing' };
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

  if (event.kind === 'den' && event.guardianKey) {
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
