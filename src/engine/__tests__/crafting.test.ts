import { describe, it, expect } from 'vitest';
import { aggregateGear, gearXpMultiplier, getGear } from '../gear';
import { getWeapon } from '../weapons';
import {
  canCraft,
  getRecipe,
  RECIPES,
  reforgeAnchorOf,
  reforgeCost,
  scaleTierStat,
  scaleGearDef,
  scaleWeaponDef,
  scoreToTier,
  asCraftTier,
  tierLabel,
  CRUDE,
  NORMAL,
  FINE,
  MASTERWORK,
  type CraftTier,
} from '../crafting';
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

describe('reforgeAnchorOf / reforgeCost', () => {
  it('defaults the anchor to the recipe first-listed material when reforgeAnchor is absent', () => {
    expect(reforgeAnchorOf(getRecipe('iron_mace')!)).toBe('iron_bar'); // { iron_bar: 3 }
    expect(reforgeAnchorOf(getRecipe('leather_vest')!)).toBe('leather'); // { leather: 3 }
    expect(reforgeAnchorOf(getRecipe('scholars_lantern')!)).toBe('iron_bar'); // first key
  });

  it('uses the explicit anchor on the three band recipes', () => {
    expect(reforgeAnchorOf(getRecipe('obsidian_plate')!)).toBe('obsidian');
    expect(reforgeAnchorOf(getRecipe('mithril_pickaxe')!)).toBe('obsidian');
    expect(reforgeAnchorOf(getRecipe('resin_trinket')!)).toBe('amber_resin');
  });

  it('costs max(100, 2× recipe gold)', () => {
    expect(reforgeCost(getRecipe('obsidian_plate')!)).toBe(260); // 130 → 260
    expect(reforgeCost(getRecipe('mithril_pickaxe')!)).toBe(300); // 150 → 300
    expect(reforgeCost(getRecipe('resin_trinket')!)).toBe(200); // 100 → 200
    expect(reforgeCost(getRecipe('iron_mace')!)).toBe(100); // 20 → 40, floored to 100
    expect(reforgeCost(getRecipe('leather_vest')!)).toBe(100); // no gold → floor 100
  });
});

const ALL_TIERS: CraftTier[] = [CRUDE, NORMAL, FINE, MASTERWORK];

describe('scaleTierStat', () => {
  it('scales representative bases per tier (multiplier dominates big items, floors small ones)', () => {
    expect(ALL_TIERS.map((t) => scaleTierStat(12, t))).toEqual([10, 12, 14, 16]);
    expect(ALL_TIERS.map((t) => scaleTierStat(6, t))).toEqual([5, 6, 7, 8]);
    expect(ALL_TIERS.map((t) => scaleTierStat(4, t))).toEqual([3, 4, 5, 6]);
    expect(ALL_TIERS.map((t) => scaleTierStat(3, t))).toEqual([2, 3, 4, 5]);
  });

  it('keeps base 1 Crude at 1 (never zero) and leaves zero/absent stats untouched', () => {
    expect(scaleTierStat(1, CRUDE)).toBe(1);
    expect(scaleTierStat(0, MASTERWORK)).toBe(0);
  });

  it('every craftable gear/weapon stat is strictly increasing across the four tiers', () => {
    const bases: number[] = [];
    for (const recipe of Object.values(RECIPES)) {
      const { kind, key } = recipe.result;
      if (kind === 'gear') {
        const g = getGear(key)!;
        if (g.defense) bases.push(g.defense);
        if (g.ward) bases.push(g.ward);
        for (const n of Object.values(g.statBonuses ?? {})) if (n) bases.push(n);
      } else if (kind === 'weapon') {
        bases.push(getWeapon(key).bonus);
      }
    }
    expect(bases.length).toBeGreaterThan(0);
    for (const base of bases) {
      const tiers = ALL_TIERS.map((t) => scaleTierStat(base, t));
      expect(tiers[1]).toBe(base);
      expect(tiers[2]).toBeGreaterThan(tiers[1]);
      expect(tiers[3]).toBeGreaterThan(tiers[2]);
      if (base >= 2) expect(tiers[0]).toBeLessThan(tiers[1]);
      else expect(tiers[0]).toBe(1);
    }
  });
});

describe('scoreToTier', () => {
  it('maps the exact cutoff boundaries (0.20 / 0.40 / 0.75)', () => {
    expect(scoreToTier(0)).toBe(CRUDE);
    expect(scoreToTier(0.19)).toBe(CRUDE);
    expect(scoreToTier(0.2)).toBe(NORMAL);
    expect(scoreToTier(0.39)).toBe(NORMAL);
    expect(scoreToTier(0.4)).toBe(FINE);
    expect(scoreToTier(0.74)).toBe(FINE);
    expect(scoreToTier(0.75)).toBe(MASTERWORK);
    expect(scoreToTier(1)).toBe(MASTERWORK);
  });
});

describe('asCraftTier / tierLabel', () => {
  it('treats absent or garbage values as Normal and clamps out-of-range numbers', () => {
    expect(asCraftTier(undefined)).toBe(NORMAL);
    expect(asCraftTier(NaN)).toBe(NORMAL);
    expect(asCraftTier(-2)).toBe(CRUDE);
    expect(asCraftTier(7)).toBe(MASTERWORK);
    expect(tierLabel(undefined)).toBe('Normal');
    expect(tierLabel(3)).toBe('Masterwork');
  });
});

describe('scaleGearDef / scaleWeaponDef', () => {
  it('scales defense/ward/statBonuses but never xpBonus or tool power', () => {
    const vest = getGear('leather_vest')!; // defense 4
    const fine = scaleGearDef(vest, FINE);
    expect(fine.defense).toBe(scaleTierStat(vest.defense!, FINE));
    expect(fine.xpBonus).toEqual(vest.xpBonus);
    expect(fine.mining).toEqual(vest.mining);
    expect(fine.chopping).toEqual(vest.chopping);
    const lantern = getGear('scholars_lantern')!; // +3 KN, xpBonus perk
    const mw = scaleGearDef(lantern, MASTERWORK);
    expect(mw.statBonuses!.KN).toBe(scaleTierStat(lantern.statBonuses!.KN!, MASTERWORK));
    expect(mw.xpBonus).toEqual(lantern.xpBonus);
  });

  it('returns the def unchanged (same reference) at Normal', () => {
    const vest = getGear('leather_vest')!;
    expect(scaleGearDef(vest, NORMAL)).toBe(vest);
    const mace = getWeapon('iron_mace');
    expect(scaleWeaponDef(mace, NORMAL)).toBe(mace);
  });

  it('scales only weapon bonus, not staminaCost/attackStat/range', () => {
    const mace = getWeapon('iron_mace');
    const mw = scaleWeaponDef(mace, MASTERWORK);
    expect(mw.bonus).toBe(scaleTierStat(mace.bonus, MASTERWORK));
    expect(mw.staminaCost).toBe(mace.staminaCost);
    expect(mw.attackStat).toBe(mace.attackStat);
    expect(mw.range).toBe(mace.range);
  });
});
