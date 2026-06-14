import { describe, it, expect } from 'vitest';
import { biomeForDepth, isBossDepth, bossFor, getBiome } from '../biomes';
import { enemyFor, ENEMIES } from '../enemies';
import { type RNG } from '../combat';

const fixed = (v: number): RNG => () => v;

describe('biomeForDepth', () => {
  it('changes region every 5 floors and cycles', () => {
    expect(biomeForDepth(1).key).toBe('catacombs');
    expect(biomeForDepth(5).key).toBe('catacombs');
    expect(biomeForDepth(6).key).toBe('ruins');
    expect(biomeForDepth(11).key).toBe('frozen');
    expect(biomeForDepth(16).key).toBe('catacombs'); // wraps around
  });
});

describe('isBossDepth', () => {
  it('flags every 5th depth', () => {
    expect(isBossDepth(5)).toBe(true);
    expect(isBossDepth(10)).toBe(true);
    expect(isBossDepth(4)).toBe(false);
    expect(isBossDepth(6)).toBe(false);
  });
});

describe('enemyFor', () => {
  it('draws from the biome pool and carries affinities', () => {
    const e = enemyFor(1, 1, ['skeleton'], fixed(0));
    expect(e.weakTo).toEqual(ENEMIES.skeleton.weakTo);
    expect(e.resistTo).toEqual(ENEMIES.skeleton.resistTo);
  });

  it('scales HP and attack up with depth', () => {
    const shallow = enemyFor(1, 1, ['skeleton'], fixed(0));
    const deep = enemyFor(10, 1, ['skeleton'], fixed(0));
    expect(deep.baseHp).toBeGreaterThan(shallow.baseHp);
    expect(deep.attack).toBeGreaterThan(shallow.attack);
  });
});

describe('bossFor', () => {
  it('scales each phase HP/attack with depth', () => {
    const biome = getBiome('catacombs');
    const shallow = bossFor(biome, 5, 1);
    const deep = bossFor(biome, 15, 1);
    expect(deep.phases![0].hp).toBeGreaterThan(shallow.phases![0].hp);
    expect(deep.phases![1].attack).toBeGreaterThan(shallow.phases![1].attack);
    expect(shallow.phases!.length).toBe(biome.boss.phases!.length);
  });
});
