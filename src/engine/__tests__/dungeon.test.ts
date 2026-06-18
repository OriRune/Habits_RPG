import { describe, it, expect } from 'vitest';
import { emptyStatXP, statPoints, statPower } from '../stats';
import { resolveTreasure, mergeReward, scaleReward, DUNGEON_ENERGY_COST } from '../dungeon';
import { type RNG } from '../combat';

const fixed = (v: number): RNG => () => v;

describe('statPoints / statPower', () => {
  it('tapers XP via sqrt (combat-stat mitigation curve)', () => {
    expect(statPoints(0)).toBe(0);
    expect(statPoints(100)).toBe(10);
    expect(statPoints(400)).toBe(20);
  });
  it('sums favored stat levels', () => {
    const lv = emptyStatXP();
    lv.DX = 20;
    lv.AG = 10;
    expect(statPower(lv, ['DX', 'AG'])).toBe(30);
  });
});

describe('dungeon constants', () => {
  it('entry costs 3 energy per design brief', () => {
    expect(DUNGEON_ENERGY_COST).toBe(3);
  });
});

describe('resolveTreasure', () => {
  it('scales gold with depth and always yields crystals', () => {
    const shallow = resolveTreasure(1, fixed(0));
    const deep = resolveTreasure(10, fixed(0));
    expect(shallow.gold!).toBeGreaterThanOrEqual(70);
    expect(deep.gold!).toBeGreaterThan(shallow.gold!);
    expect(shallow.materials?.crystals).toBeGreaterThanOrEqual(1);
  });
});

describe('mergeReward', () => {
  it('sums gold, materials, items, weapons, and gear', () => {
    const a = { gold: 50, materials: { iron_bar: 1 }, items: ['healing_potion'], weapons: ['iron_mace'] };
    const b = { gold: 30, materials: { iron_bar: 2, leather: 1 }, gear: ['leather_vest'] };
    const merged = mergeReward(a, b);
    expect(merged.gold).toBe(80);
    expect(merged.materials).toEqual({ iron_bar: 3, leather: 1 });
    expect(merged.items).toEqual(['healing_potion']);
    expect(merged.weapons).toEqual(['iron_mace']);
    expect(merged.gear).toEqual(['leather_vest']);
  });
});

describe('scaleReward', () => {
  it('keeps a fraction of gold/materials and drops all relics', () => {
    const kept = scaleReward({ gold: 100, materials: { iron_bar: 4, leather: 1 }, items: ['x'], weapons: ['y'] }, 0.25);
    expect(kept.gold).toBe(25);
    expect(kept.materials).toEqual({ iron_bar: 1 }); // floor(4*.25)=1, floor(1*.25)=0 dropped
    expect(kept.items).toEqual([]);
    expect(kept.weapons).toEqual([]);
  });
});
