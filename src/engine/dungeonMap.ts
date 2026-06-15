// Branching floor maps — a floor is a small layered DAG of rooms the player routes through,
// picking one node per step (Slay-the-Spire shaped). Boss floors funnel to a single boss node.
// Pure + deterministic via injected RNG. Room payloads reuse engine/dungeon.ts's DungeonRoom.
import { type RNG } from './combat';
import { type BiomeDef, isBossDepth } from './biomes';
import { type DungeonRoom, type RoomKind, encounterRoomFor } from './dungeon';

export interface MapNode {
  id: string;
  layer: number;
  room: DungeonRoom;
  /** Node ids in the next layer reachable from here (empty on the final layer). */
  to: string[];
}

export interface FloorMap {
  nodes: Record<string, MapNode>;
  /** Node ids per layer, in order (layers[0] are the floor's entry choices). */
  layers: string[][];
}

/** Which non-boss room types may appear, and how often, gated by what's been unlocked. */
export interface MapGenOpts {
  /** Deepest floor ever reached — gates Merchant/Elite/etc. (Phase 4). */
  deepest?: number;
}

function randInt(rng: RNG, n: number): number {
  return Math.floor(rng() * n);
}

function weightedKind(rng: RNG, weights: [RoomKind, number][]): RoomKind {
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [k, w] of weights) {
    if ((r -= w) < 0) return k;
  }
  return weights[0][0];
}

function makeRoom(kind: RoomKind, biome: BiomeDef, rng: RNG): DungeonRoom {
  if (kind === 'encounter') return encounterRoomFor(biome, rng);
  return { type: kind } as DungeonRoom;
}

/** The room-type weights for a normal-floor node, gated by depth / how deep you've ever been. */
function normalKindWeights(depth: number, opts: MapGenOpts): [RoomKind, number][] {
  const deepest = Math.max(depth, opts.deepest ?? 0);
  const weights: [RoomKind, number][] = [
    ['combat', 5],
    ['encounter', 3.5],
    ['treasure', 2],
    ['shrine', 1.6],
    ['rest', 1.4],
  ];
  if (deepest >= 5) weights.push(['merchant', 1.3]);
  if (deepest >= 8) weights.push(['elite', 1.6]);
  return weights;
}

/**
 * Build a branching floor. Normal floors: 3 layers of 2–3 nodes with adjacency edges (branch +
 * merge), each last-layer room leading to the checkpoint. Boss floors: a couple of lead-ins that
 * funnel to a single boss node.
 */
export function generateFloorMap(
  depth: number,
  biome: BiomeDef,
  rng: RNG = Math.random,
  opts: MapGenOpts = {},
): FloorMap {
  const nodes: Record<string, MapNode> = {};
  const layers: string[][] = [];

  // Decide each layer's width and the room kinds.
  const widths: number[] = isBossDepth(depth)
    ? [2, 1]
    : [2 + randInt(rng, 2), 2 + randInt(rng, 2), 1 + randInt(rng, 2)]; // 2-3, 2-3, 1-2

  const bossLayer = isBossDepth(depth) ? widths.length - 1 : -1;

  let usedCombat = false;
  for (let layer = 0; layer < widths.length; layer++) {
    const ids: string[] = [];
    for (let j = 0; j < widths[layer]; j++) {
      const id = `n${layer}_${j}`;
      let kind: RoomKind;
      if (layer === bossLayer) {
        kind = 'boss';
      } else {
        kind = weightedKind(rng, normalKindWeights(depth, opts));
      }
      if (kind === 'combat') usedCombat = true;
      nodes[id] = { id, layer, room: makeRoom(kind, biome, rng), to: [] };
      ids.push(id);
    }
    layers.push(ids);
  }

  // Guarantee at least one combat room on a normal floor (so fights aren't skippable entirely).
  if (bossLayer < 0 && !usedCombat) {
    const l0 = layers[0];
    const pick = l0[randInt(rng, l0.length)];
    nodes[pick].room = makeRoom('combat', biome, rng);
  }

  // Wire adjacency edges between consecutive layers (no crossings; ensure full reachability).
  for (let layer = 0; layer < layers.length - 1; layer++) {
    const cur = layers[layer];
    const nxt = layers[layer + 1];
    const incoming = new Set<string>();
    cur.forEach((id, j) => {
      const base = nxt.length === 1 ? 0 : Math.round((j * (nxt.length - 1)) / Math.max(1, cur.length - 1));
      const targets = new Set<number>([base]);
      if (rng() < 0.45 && base + 1 < nxt.length) targets.add(base + 1);
      else if (rng() < 0.45 && base - 1 >= 0) targets.add(base - 1);
      for (const t of targets) {
        nodes[id].to.push(nxt[t]);
        incoming.add(nxt[t]);
      }
    });
    // Any next-layer node with no incoming edge gets linked from the nearest current node.
    nxt.forEach((nid, k) => {
      if (incoming.has(nid)) return;
      const from = cur[Math.min(cur.length - 1, k)];
      nodes[from].to.push(nid);
    });
  }

  return { nodes, layers };
}
