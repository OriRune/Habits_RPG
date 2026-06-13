import { describe, it, expect } from 'vitest';
import { emptyStatXP } from '../stats';
import { classFor, assignClass, rankStats, advancedClassFor } from '../classes';

describe('classFor', () => {
  // Brief Section 17: highest Knowledge, second Dexterity -> Sorcerer.
  it('maps Knowledge/Dexterity to Sorcerer', () => {
    expect(classFor('KN', 'DX')).toBe('Sorcerer');
  });
  it('maps Strength/Strength diagonal to Strongman', () => {
    expect(classFor('ST', 'ST')).toBe('Strongman');
  });
  it('maps Hit Points/Hit Points to Tank', () => {
    expect(classFor('HP', 'HP')).toBe('Tank');
  });
});

describe('advancedClassFor', () => {
  it('upgrades known base classes', () => {
    expect(advancedClassFor('Rogue')).toBe('Shadowblade');
    expect(advancedClassFor('Wizard')).toBe('Archmage');
  });
  it('returns undefined for classes without an advancement', () => {
    expect(advancedClassFor('Strongman')).toBeUndefined();
  });
});

describe('rankStats', () => {
  it('orders by XP descending', () => {
    const xp = emptyStatXP();
    xp.KN = 300;
    xp.DX = 200;
    xp.ST = 50;
    expect(rankStats(xp).slice(0, 3)).toEqual(['KN', 'DX', 'ST']);
  });
});

describe('assignClass', () => {
  it('derives the class from the two highest stats', () => {
    const xp = emptyStatXP();
    xp.KN = 300;
    xp.DX = 200;
    const result = assignClass(xp);
    expect(result.primary).toBe('KN');
    expect(result.secondary).toBe('DX');
    expect(result.classId).toBe('Sorcerer');
    expect(result.ambiguous).toBe(false);
  });

  it('flags ties as ambiguous for player choice', () => {
    const xp = emptyStatXP();
    xp.KN = 200;
    xp.DX = 200; // tie at the top
    expect(assignClass(xp).ambiguous).toBe(true);
  });
});
