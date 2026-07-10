// Route analysis + danger pricing (dungeon-delve-plan-2026-07.md items 2.1, 2.2, decision D2).
// The simulation at the bottom is the pricing acceptance harness: safe routes must stay legal
// but visibly poorer, and no route class may strictly dominate.
import { describe, it, expect } from 'vitest';
import {
  generateFloorMap,
  enumerateRoutes,
  routeDanger,
  classifyRoute,
  classifyDanger,
  rewardClassForDanger,
  routeOutlook,
  dangerRewardFactor,
  DANGER_REWARD_FACTORS,
  DANGER_WEIGHT,
  type FloorMap,
  type MapNode,
} from '../dungeonMap';
import { type DungeonRoom, type RoomKind } from '../dungeon';
import { getBiome, isBossDepth } from '../biomes';

// Small deterministic PRNG so the simulation is stable run to run.
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const biome = getBiome('catacombs');

/** A hand-built diamond: two entries, a shared middle, two exits. */
function diamondMap(kinds: Record<string, RoomKind>): FloorMap {
  const node = (id: string, layer: number, to: string[]): MapNode => ({
    id,
    layer,
    room: { type: kinds[id] ?? 'rest' } as DungeonRoom,
    to,
  });
  return {
    nodes: {
      a: node('a', 0, ['c']),
      b: node('b', 0, ['c']),
      c: node('c', 1, ['d', 'e']),
      d: node('d', 2, []),
      e: node('e', 2, []),
    },
    layers: [['a', 'b'], ['c'], ['d', 'e']],
  };
}

describe('enumerateRoutes', () => {
  const map = diamondMap({ a: 'combat', b: 'treasure', c: 'encounter', d: 'elite', e: 'rest' });

  it('finds every entry-to-terminal route', () => {
    const routes = enumerateRoutes(map);
    expect(routes).toHaveLength(4); // 2 entries × 1 middle × 2 exits
    for (const route of routes) {
      expect(map.layers[0]).toContain(route[0]);
      expect(map.nodes[route[route.length - 1]].to).toHaveLength(0);
      // Each hop follows a real edge.
      for (let i = 0; i < route.length - 1; i++) {
        expect(map.nodes[route[i]].to).toContain(route[i + 1]);
      }
    }
  });

  it('scopes to a subtree when given a start node', () => {
    const routes = enumerateRoutes(map, 'c');
    expect(routes).toEqual([['c', 'd'], ['c', 'e']]);
  });

  it('covers every route of generated maps (routes × layers agree)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const gen = generateFloorMap(3, biome, seeded(seed));
      const routes = enumerateRoutes(gen);
      expect(routes.length).toBeGreaterThanOrEqual(1);
      for (const route of routes) expect(route).toHaveLength(gen.layers.length);
    }
  });
});

describe('routeDanger / classification', () => {
  const map = diamondMap({ a: 'combat', b: 'treasure', c: 'encounter', d: 'elite', e: 'rest' });

  it('sums danger weights along a route (combat 1, elite 2)', () => {
    expect(routeDanger(map, ['a', 'c', 'd'])).toBe((DANGER_WEIGHT.combat ?? 0) + (DANGER_WEIGHT.elite ?? 0));
    expect(routeDanger(map, ['b', 'c', 'e'])).toBe(0);
    // Partial paths work too — this is the realized-danger input to pricing.
    expect(routeDanger(map, ['a'])).toBe(1);
  });

  it('buckets danger 0/1/2+ as low/medium/high with matching loot classes', () => {
    expect(classifyDanger(0)).toBe('low');
    expect(classifyDanger(1)).toBe('medium');
    expect(classifyDanger(2)).toBe('high');
    expect(classifyDanger(5)).toBe('high');
    expect(rewardClassForDanger(0)).toBe('lean');
    expect(rewardClassForDanger(1)).toBe('standard');
    expect(rewardClassForDanger(3)).toBe('rich');
  });

  it('classifyRoute combines danger + both class labels', () => {
    expect(classifyRoute(map, ['b', 'c', 'e'])).toEqual({
      danger: 0,
      dangerClass: 'low',
      rewardClass: 'lean',
    });
    expect(classifyRoute(map, ['a', 'c', 'd'])).toEqual({
      danger: 3,
      dangerClass: 'high',
      rewardClass: 'rich',
    });
  });

  it('routeOutlook reports the danger/rooms ranges of a subtree', () => {
    const outlook = routeOutlook(map, 'c')!;
    expect(outlook.routes).toBe(2);
    expect(outlook.minDanger).toBe(0); // c → e (rest)
    expect(outlook.maxDanger).toBe(2); // c → d (elite)
    expect(outlook.minRooms).toBe(2);
    expect(outlook.maxRooms).toBe(2);
    expect(routeOutlook(map, 'missing')).toBeNull();
  });
});

describe('dangerRewardFactor', () => {
  it('is monotonically non-decreasing and clamped at both ends', () => {
    expect(dangerRewardFactor(-1)).toBe(DANGER_REWARD_FACTORS[0]);
    for (let d = 0; d < 8; d++) {
      expect(dangerRewardFactor(d + 1)).toBeGreaterThanOrEqual(dangerRewardFactor(d));
    }
    expect(dangerRewardFactor(99)).toBe(DANGER_REWARD_FACTORS[DANGER_REWARD_FACTORS.length - 1]);
  });

  it('prices a zero-danger roll at half and a deep-danger roll above par', () => {
    expect(dangerRewardFactor(0)).toBeLessThan(1);
    expect(dangerRewardFactor(2)).toBe(1);
    expect(dangerRewardFactor(4)).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Pricing simulation (plan 2.2 acceptance, decision D2). Mirrors the store's
// application exactly: a room's gold is priced by the cumulative danger of the
// path up to AND including it (path includes the current node on entry).
// ---------------------------------------------------------------------------

/** Expected gold of one room under the pricing model (rng-average, matching engine bases). */
function roomGoldEV(kind: RoomKind, depth: number, cumDanger: number): number {
  const f = dangerRewardFactor(cumDanger);
  if (kind === 'combat') return (30 + depth * 5) * f; // combatRoomGold
  if (kind === 'elite') return (40 + depth * 12) * f; // elite bonus in dungeonAdvance
  if (kind === 'treasure') return (60 + depth * 10 + 19.5) * f; // resolveTreasure, mean rng
  return 0; // encounter/shrine/rest/merchant gold is content-driven or a spend, not a roll
}

function routeGoldEV(map: FloorMap, route: string[], depth: number): number {
  let cum = 0;
  let ev = 0;
  for (const id of route) {
    const kind = map.nodes[id].room.type;
    cum += DANGER_WEIGHT[kind] ?? 0;
    ev += roomGoldEV(kind, depth, cum);
  }
  return ev;
}

describe('route pricing simulation (D2 acceptance)', () => {
  // ~4k normal floors across the depth band (boss floors excluded — their route is forced).
  const DEPTHS = [1, 2, 3, 4, 6, 7, 9, 11].filter((d) => !isBossDepth(d));
  const MAPS_PER_DEPTH = 500;

  const stats: Record<'low' | 'medium' | 'high', { n: number; ev: number }> = {
    low: { n: 0, ev: 0 },
    medium: { n: 0, ev: 0 },
    high: { n: 0, ev: 0 },
  };
  let totalRoutes = 0;

  const rng = seeded(2026);
  for (const depth of DEPTHS) {
    for (let i = 0; i < MAPS_PER_DEPTH; i++) {
      const map = generateFloorMap(depth, biome, rng, { deepest: depth });
      for (const route of enumerateRoutes(map)) {
        const cls = classifyDanger(routeDanger(map, route));
        stats[cls].n += 1;
        stats[cls].ev += routeGoldEV(map, route, depth);
        totalRoutes += 1;
      }
    }
  }
  const mean = (c: 'low' | 'medium' | 'high') => (stats[c].n ? stats[c].ev / stats[c].n : 0);
  // Characterization at the tuned factors (seed 2026, 18,522 routes): route shares
  // low 23% / medium 44% / high 33%; mean gold EV 51 / 90 / 156; low ≈ 43% of a
  // danger route; high ≈ 3.0× low. Room weights left unchanged (plan 2.7).

  it('risk pays: expected gold rises strictly with route danger class', () => {
    expect(mean('low')).toBeGreaterThan(0);
    expect(mean('medium')).toBeGreaterThan(mean('low'));
    expect(mean('high')).toBeGreaterThan(mean('medium'));
  });

  it('a zero-danger route earns roughly 40–60% of a danger route (D2 band)', () => {
    const dangerEV = (stats.medium.ev + stats.high.ev) / (stats.medium.n + stats.high.n);
    const ratio = mean('low') / dangerEV;
    expect(ratio).toBeGreaterThanOrEqual(0.4);
    expect(ratio).toBeLessThanOrEqual(0.6);
  });

  it('no class strictly dominates: high pays more in total but not runaway multiples', () => {
    expect(mean('high') / mean('low')).toBeLessThanOrEqual(4);
  });

  it('safe routes exist but are not the norm (room-weight characterization, plan 2.7)', () => {
    const lowShare = stats.low.n / totalRoutes;
    expect(lowShare).toBeGreaterThan(0.05); // the no-combat route stays a real option…
    expect(lowShare).toBeLessThan(0.45); // …without being the dominant floor shape
  });
});
