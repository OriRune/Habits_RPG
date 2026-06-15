// The Wild Forest — a real-time foraging minigame. Pure rules; randomness is injected.
//
// Where the Deep Mine is "carve through near-solid rock", the forest is a *maze*: walkable
// trails winding through impassable thicket. Two things set it apart mechanically:
//   • Fog of war — only tiles within a sight radius are lit; explored tiles are remembered
//     (the `seen` grid), and beasts are invisible until they're within sight.
//   • Ambush predators — beasts lie dormant until the player enters their aggroRadius, then
//     wake and give chase. Resource nodes are gathered instantly (one action, no durability),
//     which feels distinct from the multi-hit, stamina-draining combat & thicket-slashing.
//
// Like the mine, every rule is a pure function returning a new ForestState — the store owns
// the state and a thin loop (src/hooks/useForestLoop.ts) just decides *when* to call these.
import type { Reward } from './challenges';
import { mergeReward } from './dungeon';
import { FOREST_NODES, FOREST_BEASTS, type ForestNodeDef } from '@/content/forest';

export type RNG = () => number;
export type Dir = 'up' | 'down' | 'left' | 'right';
export type ForestTileKind = 'trail' | 'thicket' | 'clearing' | 'entrance' | 'treeline' | 'node';

export interface ForestTile {
  kind: ForestTileKind;
  /** Blade swings left before thicket is cut open (thicket only). */
  durability?: number;
  /** Original durability at spawn — used to render the cut-progress bar. */
  maxDurability?: number;
  /** Which gatherable this tile holds (node only — keys FOREST_NODES). */
  nodeKey?: string;
}

export interface ForestBeast {
  id: string;
  key: string; // FOREST_BEASTS key
  r: number;
  c: number;
  hp: number;
  maxHp: number;
  /** ms-timeline moment this beast may next step (driven by the loop's clock). */
  readyAtMs: number;
  /** Dormant beasts don't move or strike until the player comes within aggroRadius. */
  asleep: boolean;
}

/** The character's combat profile snapshotted at the start of a run. */
export interface ForestSnapshot {
  meleePower: number;
  maxHp: number;
  maxSta: number;
}

export interface ForestState {
  stage: number;
  rows: number;
  cols: number;
  tiles: ForestTile[][];
  /** Fog memory — `seen[r][c]` once the tile has ever entered the sight radius. */
  seen: boolean[][];
  player: { r: number; c: number; facing: Dir };
  hp: number;
  maxHp: number;
  sta: number;
  maxSta: number;
  meleePower: number;
  beasts: ForestBeast[];
  /** Loot gathered so far this run (committed to the economy when the run ends). */
  haul: Reward;
  /** 'active' while playing, 'banking' on a voluntary leave summary, 'ended' on death. */
  status: 'active' | 'ended' | 'banking';
  /** ms-timeline moment of the last contact hit, for brief invulnerability frames. */
  lastHitAtMs: number;
  /** Deepest stage reached this run (drives the persistent milestone). */
  deepest: number;
  /** Beasts felled on this stage — drives the per-stage leather bonus. */
  killsThisStage: number;
}

export const FOREST_ROWS = 17;
export const FOREST_COLS = 13;
/** Run entry gates (parallel to the mine). */
export const FOREST_ENERGY_COST = 2;
export const FOREST_UNLOCK_LEVEL = 2;
/** Fraction of the haul a fallen forager keeps; the rest is forfeit on death. */
export const FOREST_DEATH_KEEP = 0.5;
const SLASH_STA_COST = 1;
/** Invulnerability window after taking a contact hit (ms). */
export const FOREST_IFRAME_MS = 800;
/** How far you can see in the dark forest (Chebyshev radius); clearings see one further. */
export const SIGHT_RADIUS = 3;
const CLEARING_SIGHT_RADIUS = 4;

const DIRS: Record<Dir, [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
function randInt(min: number, max: number, rng: RNG): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function tileAt(state: ForestState, r: number, c: number): ForestTile | undefined {
  return state.tiles[r]?.[c];
}

export function isWalkable(tile: ForestTile | undefined): boolean {
  return (
    !!tile &&
    (tile.kind === 'trail' || tile.kind === 'entrance' || tile.kind === 'clearing' || tile.kind === 'treeline')
  );
}

export function beastAt(state: ForestState, r: number, c: number): ForestBeast | undefined {
  return state.beasts.find((b) => b.r === r && b.c === c);
}

/** The tile the player is currently facing (the target of an action). */
export function facedCell(state: ForestState): { r: number; c: number } {
  const [dr, dc] = DIRS[state.player.facing];
  return { r: state.player.r + dr, c: state.player.c + dc };
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

/** Circular sight test (≈ a disc, not a square) so the lit area reads like a torch glow. */
function withinSight(dr: number, dc: number, rad: number): boolean {
  return dr * dr + dc * dc <= (rad + 0.5) * (rad + 0.5);
}

/** Whether a cell is inside the player's *current* sight (drives beast visibility). */
export function isVisible(state: ForestState, r: number, c: number): boolean {
  return withinSight(r - state.player.r, c - state.player.c, sightRadiusFor(state));
}

/** Nodes eligible on a given stage (stageMin <= stage). */
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

// --- generation --------------------------------------------------------------

/** Build a fresh forest stage (full HP/stamina, empty haul) as a recursive-backtracker maze. */
export function generateForest(stage: number, snapshot: ForestSnapshot, rng: RNG): ForestState {
  const rows = FOREST_ROWS;
  const cols = FOREST_COLS;
  // Everything starts as impassable thicket; we carve trails out of it. Thicket is a permanent
  // maze wall — it can't be cut through, so the carve below must leave every cell reachable.
  const tiles: ForestTile[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: ForestTile[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({ kind: 'thicket' });
    }
    tiles.push(row);
  }

  // Odd cells are "rooms"; even cells between them are walls knocked out by the carve.
  const oddCols: number[] = [];
  for (let c = 1; c < cols - 1; c += 2) oddCols.push(c);
  const startC = oddCols[Math.floor(rng() * oddCols.length)];

  const inLattice = (r: number, c: number) =>
    r >= 1 && r < rows - 1 && c >= 1 && c < cols - 1 && r % 2 === 1 && c % 2 === 1;
  const visited = new Set<string>();
  const carve = (r: number, c: number) => {
    visited.add(`${r},${c}`);
    tiles[r][c] = { kind: 'trail' };
    const steps: Array<[number, number]> = [[-2, 0], [2, 0], [0, -2], [0, 2]];
    // Fisher–Yates shuffle so the maze is different every run.
    for (let i = steps.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [steps[i], steps[j]] = [steps[j], steps[i]];
    }
    for (const [dr, dc] of steps) {
      const nr = r + dr;
      const nc = c + dc;
      if (inLattice(nr, nc) && !visited.has(`${nr},${nc}`)) {
        tiles[r + dr / 2][c + dc / 2] = { kind: 'trail' }; // knock the wall between
        carve(nr, nc);
      }
    }
  };
  carve(1, startC);

  // Entrance gap in the top edge (player spawns here) and a tree-line exit in the bottom edge.
  tiles[0][startC] = { kind: 'entrance' };
  const exitC = oddCols[Math.floor(rng() * oddCols.length)];
  tiles[rows - 1][exitC] = { kind: 'treeline' };

  // Helpers over the carved maze.
  const roomCells: Array<[number, number]> = [];
  for (let r = 1; r < rows - 1; r += 2) {
    for (let c = 1; c < cols - 1; c += 2) {
      if (tiles[r][c].kind === 'trail') roomCells.push([r, c]);
    }
  }
  const degree = (r: number, c: number) =>
    [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dr, dc]) => isWalkable(tiles[r + dr]?.[c + dc])).length;
  const shuffle = <T,>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // Dead-end spurs (degree 1) are where resource nodes live — placing a node there never
  // blocks the through-path. Keep the entrance/exit spurs clear.
  const deadEnds = shuffle(
    roomCells.filter(
      ([r, c]) =>
        degree(r, c) === 1 && !(r === 1 && c === startC) && !(r === rows - 2 && c === exitC),
    ),
  );
  let di = 0;
  // One spring (stamina refill) when there's room for it.
  if (di < deadEnds.length) {
    const [r, c] = deadEnds[di++];
    tiles[r][c] = { kind: 'node', nodeKey: 'spring' };
  }
  // Weighted gatherables on the remaining dead-ends.
  const nodeCount = Math.min(deadEnds.length - di, 4 + stage);
  for (let i = 0; i < nodeCount; i++) {
    const [r, c] = deadEnds[di++];
    tiles[r][c] = { kind: 'node', nodeKey: weightedNode(stage, rng).key };
  }

  // A couple of open clearings (wider sight, safe breathing room) on through-corridors.
  const corridors = shuffle(roomCells.filter(([r, c]) => degree(r, c) >= 2 && !(r === 1 && c === startC)));
  for (let i = 0; i < Math.min(2, corridors.length); i++) {
    const [r, c] = corridors[i];
    tiles[r][c] = { kind: 'clearing' };
  }

  // Dormant beasts on trail cells away from the entrance.
  const trailCells: Array<[number, number]> = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (tiles[r][c].kind === 'trail' && Math.abs(r - 1) + Math.abs(c - startC) > 3) {
        trailCells.push([r, c]);
      }
    }
  }
  shuffle(trailCells);
  const eligibleBeasts = Object.values(FOREST_BEASTS).filter((b) => b.stageMin <= stage);
  const beastCount = eligibleBeasts.length === 0 ? 0 : Math.min(6, 2 + Math.floor(stage / 2));
  const beasts: ForestBeast[] = [];
  for (let i = 0; i < beastCount && i < trailCells.length; i++) {
    const [r, c] = trailCells[i];
    const def = eligibleBeasts[Math.floor(rng() * eligibleBeasts.length)];
    beasts.push({ id: `b${stage}-${i}`, key: def.key, r, c, hp: def.hp, maxHp: def.hp, readyAtMs: 0, asleep: true });
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
    meleePower: snapshot.meleePower,
    beasts,
    haul: {},
    status: 'active',
    lastHitAtMs: -FOREST_IFRAME_MS,
    deepest: stage,
    killsThisStage: 0,
  });
}

/** Push on through the tree line into a deeper, richer stage — carries HP + haul, refills stamina. */
export function advance(state: ForestState, rng: RNG): ForestState {
  if (!canAdvance(state) || state.status !== 'active') return state;
  const snap: ForestSnapshot = { meleePower: state.meleePower, maxHp: state.maxHp, maxSta: state.maxSta };
  const next = generateForest(state.stage + 1, snap, rng);
  return { ...next, hp: state.hp, sta: state.maxSta, haul: state.haul, deepest: Math.max(state.deepest, state.stage + 1) };
}

// --- player actions ----------------------------------------------------------

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
 * Act on the faced cell. Context-sensitive (one button):
 *   • beast → slash it (costs stamina; drops leather + gold on death)
 *   • node  → gather it instantly (free; stamina node refills instead)
 * Thicket is a permanent maze wall and can't be cut.
 */
export function act(state: ForestState, rng: RNG): ForestState {
  if (state.status !== 'active') return state;
  const { r, c } = facedCell(state);

  // A beast in the way → slash it.
  const beast = beastAt(state, r, c);
  if (beast) {
    if (state.sta <= 0) return state;
    const hp = beast.hp - state.meleePower;
    if (hp <= 0) {
      const def = FOREST_BEASTS[beast.key];
      const qty = Math.max(1, Math.round(beast.maxHp / 10) + state.killsThisStage);
      const gold = def ? randInt(def.bounty[0], def.bounty[1], rng) : 0;
      const drop: Reward = mergeReward({ materials: { leather: qty } }, gold > 0 ? { gold } : {});
      return {
        ...state,
        sta: Math.min(state.maxSta, state.sta - SLASH_STA_COST + 2),
        beasts: state.beasts.filter((b) => b.id !== beast.id),
        haul: mergeReward(state.haul, drop),
        killsThisStage: state.killsThisStage + 1,
      };
    }
    return {
      ...state,
      sta: state.sta - SLASH_STA_COST,
      beasts: state.beasts.map((b) => (b.id === beast.id ? { ...b, hp } : b)),
    };
  }

  const tile = tileAt(state, r, c);
  if (!tile) return state;

  // Gather a node — instant, free, single action.
  if (tile.kind === 'node' && tile.nodeKey) {
    const tiles = state.tiles.map((row) => row.slice());
    tiles[r][c] = { kind: 'trail' };
    const def = FOREST_NODES[tile.nodeKey];
    if (def?.grants.kind === 'stamina') {
      const restore = randInt(def.grants.amount[0], def.grants.amount[1], rng);
      return { ...state, tiles, sta: Math.min(state.maxSta, state.sta + restore) };
    }
    return { ...state, tiles, haul: mergeReward(state.haul, nodeYield(tile.nodeKey, rng)) };
  }

  return state;
}

// --- beasts ------------------------------------------------------------------

const adjacent = (a: { r: number; c: number }, b: { r: number; c: number }) =>
  Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

/**
 * Wake any dormant beast within its aggroRadius (the ambush), step every awake, off-cooldown
 * beast one cell toward the player, then apply contact damage from an adjacent one (once per
 * i-frame window). `nowMs` is the loop's clock. Ends the run when HP hits 0.
 */
export function stepBeasts(state: ForestState, nowMs: number, _rng: RNG): ForestState {
  if (state.status !== 'active') return state;
  let changed = false;

  // Wake pass — an ambush triggers the instant the player strays too close.
  let beasts = state.beasts.map((b) => {
    if (!b.asleep) return b;
    const def = FOREST_BEASTS[b.key];
    const dist = Math.abs(b.r - state.player.r) + Math.abs(b.c - state.player.c);
    if (def && dist <= def.aggroRadius) {
      changed = true;
      return { ...b, asleep: false, readyAtMs: nowMs };
    }
    return b;
  });

  // Movement pass — only awake beasts give chase.
  const occupied = new Set(beasts.map((b) => `${b.r},${b.c}`));
  beasts = beasts.map((b) => {
    const def = FOREST_BEASTS[b.key];
    if (b.asleep || !def || nowMs < b.readyAtMs) return b;
    const dr = sign(state.player.r - b.r);
    const dc = sign(state.player.c - b.c);
    const tries =
      Math.abs(state.player.r - b.r) >= Math.abs(state.player.c - b.c)
        ? [[dr, 0], [0, dc]]
        : [[0, dc], [dr, 0]];
    for (const [sr, sc] of tries) {
      if (sr === 0 && sc === 0) continue;
      const nr = b.r + sr;
      const nc = b.c + sc;
      const onPlayer = nr === state.player.r && nc === state.player.c;
      if (onPlayer || occupied.has(`${nr},${nc}`) || !isWalkable(tileAt(state, nr, nc))) continue;
      occupied.delete(`${b.r},${b.c}`);
      occupied.add(`${nr},${nc}`);
      changed = true;
      return { ...b, r: nr, c: nc, readyAtMs: nowMs + def.moveCadenceMs };
    }
    return b; // blocked: stay put (contact i-frames pace its hits)
  });

  // Contact damage from an adjacent, awake beast (one hit per i-frame window).
  let hp = state.hp;
  let lastHitAtMs = state.lastHitAtMs;
  if (nowMs - state.lastHitAtMs >= FOREST_IFRAME_MS) {
    const toucher = beasts.find((b) => !b.asleep && adjacent(b, state.player));
    if (toucher) {
      const def = FOREST_BEASTS[toucher.key];
      hp = Math.max(0, hp - (def?.touchDamage ?? 0));
      lastHitAtMs = nowMs;
      changed = true;
    }
  }

  if (!changed) return state; // idle tick — let the store skip the re-render
  return { ...state, beasts, hp, lastHitAtMs, status: hp <= 0 ? 'ended' : 'active' };
}

// --- death forfeit -----------------------------------------------------------

/**
 * Split a haul into the portion the player keeps and the portion forfeited on death.
 * `keepFraction` is rounded down, so a fallen forager always loses at least the remainder
 * (e.g. keep 0.5 of 15 gold → keep 7, lose 8). Zero entries are omitted from each side.
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
