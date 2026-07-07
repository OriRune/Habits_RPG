import { describe, it, expect } from 'vitest';
import { aggregateGear, gearXpMultiplier, getGear } from '../gear';
import { canCraft, getRecipe } from '../crafting';
import { type Habit } from '../habits';

function makeHabit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1', name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily',
    difficulty: 'normal', status: 'active', streak: 0, log: {}, createdISO: '2026-06-01',
    ...over,
  };
}

describe('aggregateGear', () => {
  it('sums stat bonuses, defense, ward, and collects xp perks', () => {
    const g = aggregateGear([getGear('iron_kettle_bell'), getGear('sage_ring'), getGear('scholars_lantern')]);
    expect(g.statBonuses.ST).toBe(4);
    expect(g.statBonuses.WI).toBe(3);
    expect(g.statBonuses.KN).toBe(3);
    expect(g.ward).toBe(2); // sage_ring
    expect(g.xpBonuses).toHaveLength(1); // scholars_lantern
  });

  it('ignores empty slots', () => {
    const g = aggregateGear([undefined, getGear('leather_vest'), undefined]);
    expect(g.defense).toBe(4);
  });
});

describe('gearXpMultiplier', () => {
  it('boosts XP for a matching tag', () => {
    const study = makeHabit({ tag: 'Study' });
    expect(gearXpMultiplier([getGear('scholars_lantern')], study)).toBeCloseTo(1.1);
  });
  it('does not boost a non-matching habit', () => {
    const chore = makeHabit({ tag: 'Chores' });
    expect(gearXpMultiplier([getGear('scholars_lantern')], chore)).toBe(1);
  });
});

describe('canCraft', () => {
  it('passes only when every material (and gold) is affordable', () => {
    const recipe = getRecipe('scholars_lantern')!; // { iron_bar:1, crystals:1, gold:30 }
    expect(canCraft(recipe, { iron_bar: 1, crystals: 1 }, 30)).toBe(true);
    expect(canCraft(recipe, { iron_bar: 1, crystals: 0 }, 30)).toBe(false); // missing crystals
    expect(canCraft(recipe, { iron_bar: 1, crystals: 1 }, 10)).toBe(false); // not enough gold
  });

  it('recipe results point at real catalog entries', () => {
    expect(getRecipe('leather_vest')!.result).toEqual({ kind: 'gear', key: 'leather_vest' });
    expect(getGear('leather_vest')).toBeDefined();
  });

  it('new late-tier recipes resolve and point at real gear entries', () => {
    for (const key of ['mithril_pickaxe', 'obsidian_plate', 'resin_trinket']) {
      const recipe = getRecipe(key);
      expect(recipe).toBeDefined();
      expect(recipe!.result.key).toBe(key);
      expect(getGear(recipe!.result.key)).toBeDefined();
    }
  });
});
