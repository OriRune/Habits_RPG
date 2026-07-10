// Branching floor maps — a floor is a small layered DAG of rooms the player routes through,
// picking one node per step (Slay-the-Spire shaped). Boss floors funnel to a single boss node.
// Pure + deterministic via injected RNG. Room payloads reuse engine/dungeon.ts's DungeonRoom.
import { type RNG } from './combat';
import { type BiomeDef, isBossDepth } from './biomes';
import { type DungeonRoom, type RoomKind } from './dungeon';

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
  if (kind === 'encounter') {
    const key = biome.encounters.length
      ? biome.encounters[Math.floor(rng() * biome.encounters.length)]
      : 'sealed_door';
    return { type: 'encounter', key };
  }
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

// ---------------------------------------------------------------------------
// Route analysis (plan 2.1) + danger-priced rewards (plan 2.2, decision D2)
// ---------------------------------------------------------------------------

/** Danger weight per room kind — an elite or boss counts double a plain fight. */
export const DANGER_WEIGHT: Partial<Record<RoomKind, number>> = {
  combat: 1,
  elite: 2,
  boss: 2,
};

export type DangerClass = 'low' | 'medium' | 'high';

/** Bucket a danger score for the map UI: 0 = low, 1 = medium, 2+ = high. */
export function classifyDanger(danger: number): DangerClass {
  return danger <= 0 ? 'low' : danger === 1 ? 'medium' : 'high';
}

/** Loot-outlook bucket paired 1:1 with `classifyDanger` — safe routes are deliberately lean. */
export type RewardClass = 'lean' | 'standard' | 'rich';
export function rewardClassForDanger(danger: number): RewardClass {
  return danger <= 0 ? 'lean' : danger === 1 ? 'standard' : 'rich';
}

/**
 * Every complete route from `fromId` (or from each entry node) to a terminal node.
 * Floors are tiny DAGs (≤3 layers × ≤3 nodes), so exhaustive enumeration is cheap.
 */
export function enumerateRoutes(map: FloorMap, fromId?: string): string[][] {
  const starts = fromId ? [fromId] : map.layers[0];
  const out: string[][] = [];
  const walk = (id: string, acc: string[]) => {
    const node = map.nodes[id];
    if (!node) return;
    const route = [...acc, id];
    if (node.to.length === 0) out.push(route);
    else for (const next of node.to) walk(next, route);
  };
  for (const s of starts) walk(s, []);
  return out;
}

/** Total danger weight along a route — also works on a partial path (danger realized so far). */
export function routeDanger(map: FloorMap, route: string[]): number {
  return route.reduce((sum, id) => {
    const node = map.nodes[id];
    return sum + (node ? DANGER_WEIGHT[node.room.type] ?? 0 : 0);
  }, 0);
}

/** A full route's danger score and its UI classification (plan 2.1's classifyRoute). */
export function classifyRoute(
  map: FloorMap,
  route: string[],
): { danger: number; dangerClass: DangerClass; rewardClass: RewardClass } {
  const danger = routeDanger(map, route);
  return { danger, dangerClass: classifyDanger(danger), rewardClass: rewardClassForDanger(danger) };
}

/** Range summary of every floor completion through `fromId` — feeds the route chips. */
export interface RouteOutlook {
  /** Distinct completions from this node (inclusive) to the checkpoint. */
  routes: number;
  /** Danger-weight range across those completions, counting `fromId` itself. */
  minDanger: number;
  maxDanger: number;
  /** Rooms remaining including `fromId`. */
  minRooms: number;
  maxRooms: number;
}

export function routeOutlook(map: FloorMap, fromId: string): RouteOutlook | null {
  const routes = enumerateRoutes(map, fromId);
  if (routes.length === 0) return null;
  let minDanger = Infinity, maxDanger = -Infinity, minRooms = Infinity, maxRooms = -Infinity;
  for (const route of routes) {
    const d = routeDanger(map, route);
    minDanger = Math.min(minDanger, d);
    maxDanger = Math.max(maxDanger, d);
    minRooms = Math.min(minRooms, route.length);
    maxRooms = Math.max(maxRooms, route.length);
  }
  return { routes: routes.length, minDanger, maxDanger, minRooms, maxRooms };
}

/**
 * Gold factor by *realized* route danger (decision D2): floor loot pays out scaled by the
 * danger weight of the rooms actually entered so far — so a zero-combat route stays legal
 * but deliberately lean, loot grabbed after the fights pays full, and fleeing before the
 * fight never keeps danger-priced loot. Indexed by cumulative danger, clamped to the last
 * entry. All player-facing loot-outlook copy derives from these (never hard-code).
 */
export const DANGER_REWARD_FACTORS = [0.6, 0.85, 1, 1.1, 1.2] as const;

export function dangerRewardFactor(danger: number): number {
  return DANGER_REWARD_FACTORS[Math.max(0, Math.min(danger, DANGER_REWARD_FACTORS.length - 1))];
}
