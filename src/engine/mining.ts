// The Deep Mine — a real-time mining minigame. Pure rules; randomness is injected.
//
// Movement is tile-stepped, so the run state only changes on discrete events (a step,
// a pick swing, a monster move/contact). Every rule here is a pure function returning a
// new MineState — the store owns the state and a thin loop (src/hooks/useMiningLoop.ts)
// just decides *when* to call these. No React, no store imports → fully unit-testable.
import type { Reward } from './challenges';
import { mergeReward } from './dungeon';
import { MINE_ORES, MINE_MONSTERS, type MineOreDef } from '@/content/mining';

export type RNG = () => number;
export type Dir = 'up' | 'down' | 'left' | 'right';
export type MineTileKind = 'floor' | 'rock' | 'ore' | 'bedrock' | 'shaft' | 'entrance';

export interface MineTile {
  kind: MineTileKind;
  /** Pick swings left before it breaks (rock/ore only). */
  durability?: number;
  /** Which ore vein this tile holds (ore only — keys MINE_ORES). */
  oreKey?: string;
}

export interface MineMonster {
  id: string;
  key: string; // MINE_MONSTERS key
  r: number;
  c: number;
  hp: number;
  maxHp: number;
  /** ms-timeline moment this monster may next step (driven by the loop's clock). */
  readyAtMs: number;
}

/** The character's combat profile snapshotted at the start of a run. */
export interface MineSnapshot {
  meleePower: number;
  maxHp: number;
  maxSta: number;
}

export interface MineState {
  floor: number;
  rows: number;
  cols: number;
  tiles: MineTile[][];
  player: { r: number; c: number; facing: Dir };
  hp: number;
  maxHp: number;
  sta: number;
  maxSta: number;
  meleePower: number;
  monsters: MineMonster[];
  /** Loot gathered so far this run (committed to the economy when the run ends). */
  haul: Reward;
  status: 'active' | 'ended';
  /** ms-timeline moment of the last contact hit, for brief invulnerability frames. */
  lastHitAtMs: number;
  /** Deepest floor reached this run (drives the persistent milestone). */
  deepest: number;
}

export const MINE_ROWS = 11;
export const MINE_COLS = 9;
/** Run entry gates (mirror the dungeon's energy cost + unlock level). */
export const MINE_ENERGY_COST = 2;
export const MINE_UNLOCK_LEVEL = 2;
const STRIKE_STA_COST = 1;
/** Invulnerability window after taking a contact hit (ms). */
export const MINE_IFRAME_MS = 800;

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

export function tileAt(state: MineState, r: number, c: number): MineTile | undefined {
  return state.tiles[r]?.[c];
}

export function isWalkable(tile: MineTile | undefined): boolean {
  return !!tile && (tile.kind === 'floor' || tile.kind === 'entrance' || tile.kind === 'shaft');
}

export function monsterAt(state: MineState, r: number, c: number): MineMonster | undefined {
  return state.monsters.find((m) => m.r === r && m.c === c);
}

/** The tile the player is currently facing (the target of a strike). */
export function facedCell(state: MineState): { r: number; c: number } {
  const [dr, dc] = DIRS[state.player.facing];
  return { r: state.player.r + dr, c: state.player.c + dc };
}

export function canDescend(state: MineState): boolean {
  return tileAt(state, state.player.r, state.player.c)?.kind === 'shaft';
}

/** Veins eligible on a given floor (floorMin <= floor). */
function eligibleOres(floor: number): MineOreDef[] {
  return Object.values(MINE_ORES).filter((o) => o.floorMin <= floor);
}

function weightedOre(floor: number, rng: RNG): MineOreDef {
  const pool = eligibleOres(floor);
  const total = pool.reduce((a, o) => a + o.weight, 0);
  let roll = rng() * total;
  for (const o of pool) {
    roll -= o.weight;
    if (roll < 0) return o;
  }
  return pool[pool.length - 1];
}

/** Loot dropped by breaking one ore tile. */
export function oreYield(oreKey: string, rng: RNG): Reward {
  const def = MINE_ORES[oreKey];
  if (!def) return {};
  if (def.grants.kind === 'gold') {
    return { gold: randInt(def.grants.amount[0], def.grants.amount[1], rng) };
  }
  const amt = randInt(def.grants.amount[0], def.grants.amount[1], rng);
  return { materials: { [def.grants.material]: amt } };
}

// --- generation --------------------------------------------------------------

/** Build a fresh cavern for `floor` (full HP/stamina, empty haul). */
export function generateMine(floor: number, snapshot: MineSnapshot, rng: RNG): MineState {
  const rows = MINE_ROWS;
  const cols = MINE_COLS;
  const tiles: MineTile[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: MineTile[] = [];
    for (let c = 0; c < cols; c++) {
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      row.push(border ? { kind: 'bedrock' } : { kind: 'rock', durability: 2 });
    }
    tiles.push(row);
  }

  // Entrance pocket near the top-centre; the player spawns standing on it.
  const startR = 1;
  const startC = Math.floor(cols / 2);
  tiles[startR][startC] = { kind: 'entrance' };
  tiles[startR + 1][startC] = { kind: 'floor' }; // a little breathing room below

  // Collect interior rock cells we may carve into (excludes the entrance pocket).
  const interior: Array<[number, number]> = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (tiles[r][c].kind === 'rock') interior.push([r, c]);
    }
  }
  const takeCell = (): [number, number] | undefined => {
    if (interior.length === 0) return undefined;
    const i = Math.floor(rng() * interior.length);
    return interior.splice(i, 1)[0];
  };

  // Shaft down — placed in the lower half so descending means digging deeper.
  const lower = interior.filter(([r]) => r >= Math.floor(rows / 2));
  const shaftPick = lower.length ? lower[Math.floor(rng() * lower.length)] : takeCell();
  if (shaftPick) {
    const [sr, sc] = shaftPick;
    tiles[sr][sc] = { kind: 'shaft' };
    const idx = interior.findIndex(([r, c]) => r === sr && c === sc);
    if (idx >= 0) interior.splice(idx, 1);
  }

  // Scatter ore veins (more, richer with depth).
  const oreCount = Math.min(interior.length, 5 + floor);
  for (let i = 0; i < oreCount; i++) {
    const cell = takeCell();
    if (!cell) break;
    const def = weightedOre(floor, rng);
    tiles[cell[0]][cell[1]] = { kind: 'ore', oreKey: def.key, durability: def.durability };
  }

  // Spawn monsters in carved pockets so they can roam toward the player.
  const monsters: MineMonster[] = [];
  const eligibleMon = Object.values(MINE_MONSTERS).filter((m) => m.floorMin <= floor);
  const monCount = eligibleMon.length === 0 ? 0 : Math.min(4, 1 + Math.floor(floor / 2));
  for (let i = 0; i < monCount; i++) {
    const cell = takeCell();
    if (!cell) break;
    const def = eligibleMon[Math.floor(rng() * eligibleMon.length)];
    tiles[cell[0]][cell[1]] = { kind: 'floor' };
    monsters.push({ id: `m${floor}-${i}`, key: def.key, r: cell[0], c: cell[1], hp: def.hp, maxHp: def.hp, readyAtMs: 0 });
  }

  return {
    floor,
    rows,
    cols,
    tiles,
    player: { r: startR, c: startC, facing: 'down' },
    hp: snapshot.maxHp,
    maxHp: snapshot.maxHp,
    sta: snapshot.maxSta,
    maxSta: snapshot.maxSta,
    meleePower: snapshot.meleePower,
    monsters,
    haul: {},
    status: 'active',
    lastHitAtMs: -MINE_IFRAME_MS,
    deepest: floor,
  };
}

/** Descend the shaft into a richer, deeper floor — carries HP + haul, refills stamina. */
export function descend(state: MineState, rng: RNG): MineState {
  if (!canDescend(state) || state.status !== 'active') return state;
  const snap: MineSnapshot = { meleePower: state.meleePower, maxHp: state.maxHp, maxSta: state.maxSta };
  const next = generateMine(state.floor + 1, snap, rng);
  return { ...next, hp: state.hp, sta: state.maxSta, haul: state.haul, deepest: Math.max(state.deepest, state.floor + 1) };
}

// --- player actions ----------------------------------------------------------

/** Turn to face `dir`, and step into that cell if it is walkable and unoccupied. */
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

/** Swing the pick at the faced cell: hit a monster, or chip rock/ore (dropping loot on break). */
export function strike(state: MineState, rng: RNG): MineState {
  if (state.status !== 'active' || state.sta <= 0) return state;
  const { r, c } = facedCell(state);

  // Monster in the way → damage it.
  const mon = monsterAt(state, r, c);
  if (mon) {
    const hp = mon.hp - state.meleePower;
    if (hp <= 0) {
      const def = MINE_MONSTERS[mon.key];
      const bounty = def ? { gold: randInt(def.bounty[0], def.bounty[1], rng) } : {};
      return {
        ...state,
        sta: state.sta - STRIKE_STA_COST,
        monsters: state.monsters.filter((m) => m.id !== mon.id),
        haul: mergeReward(state.haul, bounty),
      };
    }
    return {
      ...state,
      sta: state.sta - STRIKE_STA_COST,
      monsters: state.monsters.map((m) => (m.id === mon.id ? { ...m, hp } : m)),
    };
  }

  // Otherwise chip the faced tile if it is diggable.
  const tile = tileAt(state, r, c);
  if (!tile || (tile.kind !== 'rock' && tile.kind !== 'ore')) return state;
  const durability = (tile.durability ?? 1) - 1;
  const tiles = state.tiles.map((row) => row.slice());
  let haul = state.haul;
  if (durability <= 0) {
    if (tile.kind === 'ore' && tile.oreKey) haul = mergeReward(haul, oreYield(tile.oreKey, rng));
    tiles[r][c] = { kind: 'floor' };
  } else {
    tiles[r][c] = { ...tile, durability };
  }
  return { ...state, sta: state.sta - STRIKE_STA_COST, tiles, haul };
}

// --- monsters ----------------------------------------------------------------

const adjacent = (a: { r: number; c: number }, b: { r: number; c: number }) =>
  Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

/**
 * Step every off-cooldown monster one cell toward the player (greedy, walkable-only),
 * then apply contact damage if one is adjacent and the i-frame window has elapsed.
 * `nowMs` is the loop's clock. Ends the run when HP hits 0.
 */
export function stepMonsters(state: MineState, nowMs: number, _rng: RNG): MineState {
  if (state.status !== 'active') return state;
  const occupied = new Set(state.monsters.map((m) => `${m.r},${m.c}`));
  let changed = false;
  const monsters = state.monsters.map((m) => {
    const def = MINE_MONSTERS[m.key];
    if (!def || nowMs < m.readyAtMs) return m;
    const dr = sign(state.player.r - m.r);
    const dc = sign(state.player.c - m.c);
    // Prefer the axis with the greater distance; fall back to the other.
    const tries =
      Math.abs(state.player.r - m.r) >= Math.abs(state.player.c - m.c)
        ? [[dr, 0], [0, dc]]
        : [[0, dc], [dr, 0]];
    for (const [sr, sc] of tries) {
      if (sr === 0 && sc === 0) continue;
      const nr = m.r + sr;
      const nc = m.c + sc;
      const onPlayer = nr === state.player.r && nc === state.player.c;
      if (onPlayer || occupied.has(`${nr},${nc}`) || !isWalkable(tileAt(state, nr, nc))) continue;
      occupied.delete(`${m.r},${m.c}`);
      occupied.add(`${nr},${nc}`);
      changed = true;
      return { ...m, r: nr, c: nc, readyAtMs: nowMs + def.moveCadenceMs };
    }
    return m; // blocked: stay put (contact i-frames pace its hits, not its cooldown)
  });

  // Contact damage from the nearest adjacent monster (one hit per i-frame window).
  let hp = state.hp;
  let lastHitAtMs = state.lastHitAtMs;
  if (nowMs - state.lastHitAtMs >= MINE_IFRAME_MS) {
    const toucher = monsters.find((m) => adjacent(m, state.player));
    if (toucher) {
      const def = MINE_MONSTERS[toucher.key];
      hp = Math.max(0, hp - (def?.touchDamage ?? 0));
      lastHitAtMs = nowMs;
      changed = true;
    }
  }

  if (!changed) return state; // idle tick — let the store skip the re-render
  return { ...state, monsters, hp, lastHitAtMs, status: hp <= 0 ? 'ended' : 'active' };
}
