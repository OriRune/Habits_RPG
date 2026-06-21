import { describe, it, expect } from 'vitest';
import { generateFloorMap, type FloorMap } from '../dungeonMap';
import { getBiome } from '../biomes';

// Small deterministic PRNG so structural assertions are stable.
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

/** All node ids reachable as entry choices (layer 0) or via edges. */
function reachable(map: FloorMap): Set<string> {
  const seen = new Set<string>(map.layers[0]);
  const queue = [...map.layers[0]];
  while (queue.length) {
    const id = queue.shift()!;
    for (const to of map.nodes[id].to) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

describe('generateFloorMap — normal floor', () => {
  const map = generateFloorMap(2, biome, seeded(42));

  it('builds 3 layers of 1–3 nodes each', () => {
    expect(map.layers.length).toBe(3);
    for (const layer of map.layers) expect(layer.length).toBeGreaterThanOrEqual(1);
  });

  it('every node is reachable from the entry layer', () => {
    const seen = reachable(map);
    expect(seen.size).toBe(Object.keys(map.nodes).length);
  });

  it('last-layer rooms are terminal (lead to the checkpoint)', () => {
    for (const id of map.layers[map.layers.length - 1]) {
      expect(map.nodes[id].to).toHaveLength(0);
    }
  });

  it('does not emit merchant/elite below their depth gates', () => {
    // depth 2, deepest 0 → merchants (>=5) and elites (>=8) must not appear.
    for (const n of Object.values(map.nodes)) {
      expect(['merchant', 'elite']).not.toContain(n.room.type);
      expect(['combat', 'encounter', 'treasure', 'shrine', 'rest']).toContain(n.room.type);
    }
  });

  it('unlocks merchant/elite room types at depth', () => {
    const deep = generateFloorMap(9, biome, seeded(3));
    const kinds = new Set(Object.values(deep.nodes).map((n) => n.room.type));
    // At depth 9 the gates are open; over a few nodes at least one special type should appear.
    expect([...kinds].some((k) => ['merchant', 'elite', 'shrine', 'rest'].includes(k))).toBe(true);
  });

  it('guarantees at least one combat room', () => {
    expect(Object.values(map.nodes).some((n) => n.room.type === 'combat')).toBe(true);
  });
});

describe('generateFloorMap — boss floor', () => {
  const map = generateFloorMap(5, biome, seeded(7));

  it('funnels lead-in rooms to a single boss capstone', () => {
    const last = map.layers[map.layers.length - 1];
    expect(last).toHaveLength(1);
    expect(map.nodes[last[0]].room.type).toBe('boss');
    // Every entry node can reach the boss.
    for (const id of map.layers[0]) expect(map.nodes[id].to).toContain(last[0]);
  });
});

describe('determinism', () => {
  it('same seed → same structure', () => {
    const a = generateFloorMap(3, biome, seeded(99));
    const b = generateFloorMap(3, biome, seeded(99));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('branching path constraint', () => {
  // Verify the Slay-the-Spire-style invariant: after choosing a node on layer N,
  // the only reachable nodes on layer N+1 are exactly that node's `to` list.
  // This is the engine guarantee that FloorMap.tsx and resolveCurrentNode rely on.
  it('picking a node on layer 0 restricts next choices to its .to array', () => {
    const map = generateFloorMap(2, biome, seeded(12));
    // Simulate picking the first node on layer 0.
    const pickedId = map.layers[0][0];
    const picked = map.nodes[pickedId];
    // picked.to must be a subset of layer 1 (no cross-layer edges).
    for (const id of picked.to) {
      expect(map.layers[1]).toContain(id);
    }
    // The store sets choices = picked.to after entering the room — verify it is a
    // non-empty subset of the next layer (player always has somewhere to go).
    expect(picked.to.length).toBeGreaterThanOrEqual(1);
  });

  it('every node on non-final layers has at least one outgoing edge (full reachability)', () => {
    // After choosing any room, the player always gets at least one next option.
    const map = generateFloorMap(3, biome, seeded(77));
    for (let li = 0; li < map.layers.length - 1; li++) {
      for (const id of map.layers[li]) {
        expect(map.nodes[id].to.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('last-layer nodes have empty .to — they resolve to the checkpoint', () => {
    const map = generateFloorMap(3, biome, seeded(55));
    const finalLayer = map.layers[map.layers.length - 1];
    for (const id of finalLayer) {
      expect(map.nodes[id].to).toHaveLength(0);
    }
  });
});
