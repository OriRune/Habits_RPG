import { describe, it, expect } from 'vitest';
import { aggregateRelics, rollBoons, rollCurse, getRelic, RELICS, type RelicDef } from '../relics';

const fixed = (v: number) => () => v;

describe('aggregateRelics', () => {
  it('sums stat bonuses, defense, ward, and maxHp across relics', () => {
    const defs = [getRelic('titan_grip'), getRelic('stone_heart'), getRelic('warding_rune')];
    const agg = aggregateRelics(defs);
    expect(agg.statBonuses.ST).toBe(6); // titan_grip
    expect(agg.statBonuses.WI).toBe(2); // warding_rune
    expect(agg.maxHp).toBe(45); // 25 + 20
    expect(agg.defense).toBe(2); // stone_heart
    expect(agg.ward).toBe(3); // warding_rune
  });

  it('ignores undefined entries', () => {
    expect(aggregateRelics([undefined, undefined]).maxHp).toBe(0);
  });

  it('applies negative curse effects', () => {
    const agg = aggregateRelics([getRelic('cracked_idol')]);
    expect(agg.statBonuses.EN).toBe(-3);
  });
});

describe('rollBoons', () => {
  it('offers distinct, non-cursed relics within the tier cap', () => {
    const boons = rollBoons(3, [], 2, fixed(0));
    expect(boons.length).toBe(3);
    expect(new Set(boons).size).toBe(3); // distinct
    for (const k of boons) {
      const r = getRelic(k) as RelicDef;
      expect(r.curse).toBeFalsy();
      expect(r.tier).toBeLessThanOrEqual(2);
    }
  });

  it('never offers a relic the player already holds', () => {
    const owned = Object.values(RELICS).filter((r) => !r.curse && r.tier === 1).map((r) => r.key);
    const boons = rollBoons(3, owned, 1, fixed(0));
    expect(boons.length).toBe(0); // all tier-1 boons owned, none left
  });

  it('gates tier-3 relics behind maxTier', () => {
    const lowTier = rollBoons(50, [], 1, fixed(0));
    expect(lowTier.every((k) => getRelic(k)!.tier === 1)).toBe(true);
  });
});

describe('rollCurse', () => {
  it('returns a curse relic key', () => {
    const key = rollCurse(fixed(0));
    expect(getRelic(key!)!.curse).toBe(true);
  });
});
