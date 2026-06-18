import { describe, it, expect } from 'vitest';
import {
  bandForFloor,
  bandForStage,
  MINE_BANDS,
  FOREST_BANDS,
  type MineBandId,
  type ForestBandId,
} from '../crawlBiomes';
import { MINE_ORES, MINE_MONSTERS } from '@/content/mining';
import { FOREST_NODES, FOREST_BEASTS } from '@/content/forest';
import { getMaterial } from '@/engine/materials';
import { generateMine } from '../mining';
import { generateForest } from '../forest';
import { getWeapon, STARTER_WEAPON } from '@/engine/weapons';
import type { MineSnapshot } from '../mining';
import type { ForestSnapshot } from '../forest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rngFrom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEAPON = getWeapon(STARTER_WEAPON);

const MINE_SNAP: MineSnapshot = {
  meleePower: 5, rangedPower: 3, damageSpell: 2, supportSpell: 2,
  illusionPower: 1, defense: 0, ward: 0, maxHp: 50, maxSta: 55, maxMp: 8,
  weapon: WEAPON, knownSpells: [], pickaxePower: 1, agLevel: 0,
};

const FOREST_SNAP: ForestSnapshot = {
  meleePower: 5, rangedPower: 3, damageSpell: 2, supportSpell: 2,
  illusionPower: 1, defense: 0, ward: 0, maxHp: 50, maxSta: 55, maxMp: 8,
  weapon: WEAPON, knownSpells: [], chopPower: 1, agLevel: 0,
};

// Lightweight eligibility helpers (mirrors engine internals) for isolation testing.
function mineEligibleOres(floor: number) {
  const bandId = bandForFloor(floor).id;
  return Object.values(MINE_ORES).filter(
    (o) => o.floorMin <= floor && (!o.band || o.band === bandId),
  );
}
function mineEligibleMon(floor: number) {
  const bandId = bandForFloor(floor).id;
  return Object.values(MINE_MONSTERS).filter(
    (m) => m.floorMin <= floor && (!m.band || m.band === bandId),
  );
}
function forestEligibleNodes(stage: number) {
  const bandId = bandForStage(stage).id;
  return Object.values(FOREST_NODES).filter(
    (n) => n.stageMin <= stage && (!n.band || n.band === bandId),
  );
}
function forestEligibleBeasts(stage: number) {
  const bandId = bandForStage(stage).id;
  return Object.values(FOREST_BEASTS).filter(
    (b) => b.stageMin <= stage && (!b.band || b.band === bandId),
  );
}

// ---------------------------------------------------------------------------
// bandForFloor — boundary checks
// ---------------------------------------------------------------------------

describe('bandForFloor', () => {
  it('floor 1 is Rocky Caverns', () => expect(bandForFloor(1).id).toBe<MineBandId>('rocky'));
  it('floor 6 is Rocky Caverns (last rocky floor)', () => expect(bandForFloor(6).id).toBe<MineBandId>('rocky'));
  it('floor 7 is Frozen Depths (first frozen floor)', () => expect(bandForFloor(7).id).toBe<MineBandId>('frozen'));
  it('floor 14 is Frozen Depths (last frozen floor)', () => expect(bandForFloor(14).id).toBe<MineBandId>('frozen'));
  it('floor 15 is Magma Core (first magma floor)', () => expect(bandForFloor(15).id).toBe<MineBandId>('magma'));
  it('floor 100 is Magma Core (clamps past last band)', () => expect(bandForFloor(100).id).toBe<MineBandId>('magma'));
  it('all bands have a non-empty name and palette', () => {
    for (const b of MINE_BANDS) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.palette.floor).toHaveLength(3);
      expect(b.palette.rock).toHaveLength(3);
      expect(b.palette.accent).toMatch(/^#/);
    }
  });
});

// ---------------------------------------------------------------------------
// bandForStage — boundary checks
// ---------------------------------------------------------------------------

describe('bandForStage', () => {
  it('stage 1 is Thicket', () => expect(bandForStage(1).id).toBe<ForestBandId>('thicket'));
  it('stage 3 is Thicket (last thicket stage)', () => expect(bandForStage(3).id).toBe<ForestBandId>('thicket'));
  it('stage 4 is Deepwood Grove (first deepwood stage)', () => expect(bandForStage(4).id).toBe<ForestBandId>('deepwood'));
  it('stage 7 is Deepwood Grove (last deepwood stage)', () => expect(bandForStage(7).id).toBe<ForestBandId>('deepwood'));
  it('stage 8 is Ancient Heart (first ancient stage)', () => expect(bandForStage(8).id).toBe<ForestBandId>('ancient'));
  it('stage 50 is Ancient Heart (clamps past last band)', () => expect(bandForStage(50).id).toBe<ForestBandId>('ancient'));
  it('all bands have a non-empty name and palette', () => {
    for (const b of FOREST_BANDS) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.palette.floor).toHaveLength(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Mine content eligibility
// ---------------------------------------------------------------------------

describe('mine eligibility filters', () => {
  it('floor 1: only band-agnostic ores appear (no frozen/magma-only ores)', () => {
    const ores = mineEligibleOres(1);
    expect(ores.some((o) => o.band === 'frozen')).toBe(false);
    expect(ores.some((o) => o.band === 'magma')).toBe(false);
    expect(ores.some((o) => !o.band)).toBe(true); // at least one agnostic
  });

  it('floor 7: frozen-band ores appear; rocky-only items absent; magma-only still absent', () => {
    const ores = mineEligibleOres(7);
    expect(ores.some((o) => o.band === 'frozen')).toBe(true);
    expect(ores.some((o) => o.band === 'magma')).toBe(false);
  });

  it('floor 15: magma-band ores appear; frozen-band ores do not', () => {
    const ores = mineEligibleOres(15);
    expect(ores.some((o) => o.band === 'magma')).toBe(true);
    expect(ores.some((o) => o.band === 'frozen')).toBe(false);
  });

  it('floor 1: no frozen/magma-only monsters', () => {
    const mon = mineEligibleMon(1);
    expect(mon.some((m) => m.band === 'frozen')).toBe(false);
    expect(mon.some((m) => m.band === 'magma')).toBe(false);
  });

  it('floor 7: ice_crawler is eligible', () => {
    const mon = mineEligibleMon(7);
    expect(mon.some((m) => m.key === 'ice_crawler')).toBe(true);
    expect(mon.some((m) => m.key === 'magma_hound')).toBe(false);
  });

  it('floor 15: magma_hound is eligible; ice_crawler is not', () => {
    const mon = mineEligibleMon(15);
    expect(mon.some((m) => m.key === 'magma_hound')).toBe(true);
    expect(mon.some((m) => m.key === 'ice_crawler')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Forest content eligibility
// ---------------------------------------------------------------------------

describe('forest eligibility filters', () => {
  it('stage 1: no deepwood/ancient nodes', () => {
    const nodes = forestEligibleNodes(1);
    expect(nodes.some((n) => n.band === 'deepwood')).toBe(false);
    expect(nodes.some((n) => n.band === 'ancient')).toBe(false);
  });

  it('stage 4: glowcap (deepwood) is eligible; heart_bloom (ancient) is not', () => {
    const nodes = forestEligibleNodes(4);
    expect(nodes.some((n) => n.key === 'glowcap')).toBe(true);
    expect(nodes.some((n) => n.key === 'heart_bloom')).toBe(false);
  });

  it('stage 8: heart_bloom (ancient) is eligible; glowcap (deepwood) is not', () => {
    const nodes = forestEligibleNodes(8);
    expect(nodes.some((n) => n.key === 'heart_bloom')).toBe(true);
    expect(nodes.some((n) => n.key === 'glowcap')).toBe(false);
  });

  it('stage 1: no deepwood/ancient beasts', () => {
    const beasts = forestEligibleBeasts(1);
    expect(beasts.some((b) => b.band === 'deepwood')).toBe(false);
    expect(beasts.some((b) => b.band === 'ancient')).toBe(false);
  });

  it('stage 4: shadow_lynx (deepwood) is eligible; grove_wraith (ancient) is not', () => {
    const beasts = forestEligibleBeasts(4);
    expect(beasts.some((b) => b.key === 'shadow_lynx')).toBe(true);
    expect(beasts.some((b) => b.key === 'grove_wraith')).toBe(false);
  });

  it('stage 8: grove_wraith (ancient) is eligible; shadow_lynx (deepwood) is not', () => {
    const beasts = forestEligibleBeasts(8);
    expect(beasts.some((b) => b.key === 'grove_wraith')).toBe(true);
    expect(beasts.some((b) => b.key === 'shadow_lynx')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// New materials resolve correctly
// ---------------------------------------------------------------------------

describe('new band materials', () => {
  it('frost_quartz resolves from getMaterial', () => {
    const m = getMaterial('frost_quartz');
    expect(m).toBeDefined();
    expect(m!.name).toBe('Frost Quartz');
  });
  it('obsidian resolves from getMaterial', () => {
    const m = getMaterial('obsidian');
    expect(m).toBeDefined();
    expect(m!.name).toBe('Obsidian');
  });
  it('amber_resin resolves from getMaterial', () => {
    const m = getMaterial('amber_resin');
    expect(m).toBeDefined();
    expect(m!.name).toBe('Amber Resin');
  });
});

// ---------------------------------------------------------------------------
// Generation reachability — band-specific floors still produce valid maps
// ---------------------------------------------------------------------------

describe('generation reachability with band filtering', () => {
  function mineIsReachable(floor: number): boolean {
    const mine = generateMine(floor, MINE_SNAP, rngFrom(42 + floor));
    const reachable = new Set<string>();
    const queue: [number, number][] = [[mine.player.r, mine.player.c]];
    reachable.add(`${mine.player.r},${mine.player.c}`);
    while (queue.length) {
      const [r, c] = queue.shift()!;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as [number,number][]) {
        const nr = r + dr, nc = c + dc;
        const k = `${nr},${nc}`;
        if (reachable.has(k)) continue;
        const t = mine.tiles[nr]?.[nc];
        if (!t || t.kind === 'bedrock' || t.kind === 'rock') continue;
        reachable.add(k);
        queue.push([nr, nc]);
      }
    }
    return [...reachable].some((k) => {
      const [r, c] = k.split(',').map(Number);
      return mine.tiles[r]?.[c]?.kind === 'shaft';
    });
  }

  it('floor 7 (Frozen Depths) shaft is reachable', () => expect(mineIsReachable(7)).toBe(true));
  it('floor 15 (Magma Core) shaft is reachable', () => expect(mineIsReachable(15)).toBe(true));
  it('floor 10 (mid-Frozen) shaft is reachable', () => expect(mineIsReachable(10)).toBe(true));

  function forestIsReachable(stage: number): boolean {
    const forest = generateForest(stage, FOREST_SNAP, rngFrom(99 + stage));
    const reachable = new Set<string>();
    const queue: [number, number][] = [[forest.player.r, forest.player.c]];
    reachable.add(`${forest.player.r},${forest.player.c}`);
    while (queue.length) {
      const [r, c] = queue.shift()!;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as [number,number][]) {
        const nr = r + dr, nc = c + dc;
        const k = `${nr},${nc}`;
        if (reachable.has(k)) continue;
        const t = forest.tiles[nr]?.[nc];
        if (!t || t.kind === 'thicket' || t.kind === 'tree') continue;
        reachable.add(k);
        queue.push([nr, nc]);
      }
    }
    return [...reachable].some((k) => {
      const [r, c] = k.split(',').map(Number);
      return forest.tiles[r]?.[c]?.kind === 'treeline';
    });
  }

  it('stage 4 (Deepwood Grove) treeline is reachable', () => expect(forestIsReachable(4)).toBe(true));
  it('stage 8 (Ancient Heart) treeline is reachable', () => expect(forestIsReachable(8)).toBe(true));
});

// ---------------------------------------------------------------------------
// Band-specific ore/node keys appear on generated maps (smoke test)
// ---------------------------------------------------------------------------

describe('band content appears on generated maps', () => {
  it('floor 7 mine contains at least one frost_quartz_vein or ice_crawler', () => {
    // Generate several floors since they are probabilistic
    let found = false;
    for (let seed = 0; seed < 10 && !found; seed++) {
      const mine = generateMine(7, MINE_SNAP, rngFrom(seed));
      const hasOre = mine.tiles.flat().some((t) => t.kind === 'ore' && t.oreKey === 'frost_quartz_vein');
      const hasMon = mine.monsters.some((m) => m.key === 'ice_crawler');
      if (hasOre || hasMon) found = true;
    }
    expect(found).toBe(true);
  });

  it('floor 15 mine does not contain ice_crawler (wrong band)', () => {
    for (let seed = 0; seed < 5; seed++) {
      const mine = generateMine(15, MINE_SNAP, rngFrom(seed));
      expect(mine.monsters.every((m) => m.key !== 'ice_crawler')).toBe(true);
    }
  });

  it('stage 4 forest contains shadow_lynx or glowcap', () => {
    let found = false;
    for (let seed = 0; seed < 10 && !found; seed++) {
      const forest = generateForest(4, FOREST_SNAP, rngFrom(seed));
      const hasNode = forest.tiles.flat().some((t) => t.kind === 'node' && t.nodeKey === 'glowcap');
      const hasBeast = forest.beasts.some((b) => b.key === 'shadow_lynx');
      if (hasNode || hasBeast) found = true;
    }
    expect(found).toBe(true);
  });

  it('stage 8 forest does not contain shadow_lynx (wrong band)', () => {
    for (let seed = 0; seed < 5; seed++) {
      const forest = generateForest(8, FOREST_SNAP, rngFrom(seed));
      expect(forest.beasts.every((b) => b.key !== 'shadow_lynx')).toBe(true);
    }
  });
});
