import { describe, it, expect } from 'vitest';
import { mulberry32, randomSeed, floorSeed } from '../rng';
import { floodFieldMulti } from '../crawl';
import { generateMine, type MineSnapshot } from '../mining';
import { generateForest, type ForestSnapshot } from '../forest';
import { getWeapon, STARTER_WEAPON } from '../weapons';

describe('mulberry32', () => {
  it('is deterministic — same seed yields the same sequence', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('returns floats in [0, 1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds diverge', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('randomSeed produces a 32-bit unsigned integer', () => {
    const s = randomSeed();
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });
});

const SNAP: MineSnapshot = {
  meleePower: 5,
  rangedPower: 3,
  damageSpell: 2,
  supportSpell: 2,
  illusionPower: 1,
  defense: 0,
  ward: 0,
  maxHp: 50,
  maxSta: 55,
  maxMp: 8,
  weapon: getWeapon(STARTER_WEAPON),
  knownSpells: [],
  pickaxePower: 1,
  agLevel: 0,
};

describe('generateMine determinism (co-op map parity)', () => {
  it('produces an identical map + monsters from the same seed', () => {
    const a = generateMine(3, SNAP, mulberry32(0xC0FFEE));
    const b = generateMine(3, SNAP, mulberry32(0xC0FFEE));
    // Every client regenerates the same world slice from the shared seed.
    expect(JSON.stringify(a.tiles)).toEqual(JSON.stringify(b.tiles));
    expect(JSON.stringify(a.monsters)).toEqual(JSON.stringify(b.monsters));
    expect(a.player).toEqual(b.player);
  });

  it('produces a different map from a different seed', () => {
    const a = generateMine(3, SNAP, mulberry32(1));
    const b = generateMine(3, SNAP, mulberry32(2));
    expect(JSON.stringify(a.tiles)).not.toEqual(JSON.stringify(b.tiles));
  });
});

describe('floorSeed (per-floor co-op parity)', () => {
  it('is deterministic and a 32-bit unsigned integer', () => {
    const s = floorSeed(0xc0ffee, 3);
    expect(s).toEqual(floorSeed(0xc0ffee, 3));
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });

  it('differs between floors of the same run', () => {
    const base = 0xc0ffee;
    const seeds = [1, 2, 3, 4, 5].map((f) => floorSeed(base, f));
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('regenerates a floor identically regardless of prior RNG consumption', () => {
    // The whole point: two clients consume their run RNG at different rates (mining,
    // combat), but floor N must still generate the same map on both. Seeding from
    // floorSeed(base, N) makes generation independent of that divergence.
    const base = 0xabcdef;
    const clean = generateMine(2, SNAP, mulberry32(floorSeed(base, 2)));

    // Simulate a client whose run RNG has been heavily consumed before descending.
    const drained = mulberry32(base);
    for (let i = 0; i < 5000; i++) drained();
    const afterDrain = generateMine(2, SNAP, mulberry32(floorSeed(base, 2)));

    expect(JSON.stringify(afterDrain.tiles)).toEqual(JSON.stringify(clean.tiles));
    expect(JSON.stringify(afterDrain.monsters)).toEqual(JSON.stringify(clean.monsters));
  });
});

const FOREST_SNAP: ForestSnapshot = {
  meleePower: 5,
  rangedPower: 3,
  damageSpell: 2,
  supportSpell: 2,
  illusionPower: 1,
  defense: 0,
  ward: 0,
  maxHp: 50,
  maxSta: 55,
  maxMp: 8,
  weapon: getWeapon(STARTER_WEAPON),
  knownSpells: [],
  chopPower: 1,
  agLevel: 0,
};

describe('generateForest determinism (co-op map parity)', () => {
  it('regenerates a stage identically regardless of prior RNG consumption', () => {
    const base = 0x1234;
    const clean = generateForest(2, FOREST_SNAP, mulberry32(floorSeed(base, 2)));

    const drained = mulberry32(base);
    for (let i = 0; i < 5000; i++) drained();
    const afterDrain = generateForest(2, FOREST_SNAP, mulberry32(floorSeed(base, 2)));

    expect(JSON.stringify(afterDrain.tiles)).toEqual(JSON.stringify(clean.tiles));
    expect(JSON.stringify(afterDrain.beasts)).toEqual(JSON.stringify(clean.beasts));
    expect(afterDrain.player).toEqual(clean.player);
  });

  it('produces a different stage from a different seed', () => {
    const a = generateForest(2, FOREST_SNAP, mulberry32(1));
    const b = generateForest(2, FOREST_SNAP, mulberry32(2));
    expect(JSON.stringify(a.tiles)).not.toEqual(JSON.stringify(b.tiles));
  });
});

describe('floodFieldMulti (co-op nearest-player targeting)', () => {
  it('measures distance to the nearest of several targets', () => {
    // 1x9 open corridor with players at both ends.
    const rows = 1;
    const cols = 9;
    const field = floodFieldMulti([{ r: 0, c: 0 }, { r: 0, c: 8 }], rows, cols, () => true);
    expect(field.get('0,0')).toBe(0);
    expect(field.get('0,8')).toBe(0);
    // The middle cell is equidistant (4) from each end.
    expect(field.get('0,4')).toBe(4);
    // A cell near one end measures to THAT end, not the far one.
    expect(field.get('0,1')).toBe(1);
    expect(field.get('0,7')).toBe(1);
  });

  it('matches single-source flood when given one target', () => {
    const single = floodFieldMulti([{ r: 0, c: 0 }], 1, 5, () => true);
    expect(single.get('0,0')).toBe(0);
    expect(single.get('0,4')).toBe(4);
  });
});
