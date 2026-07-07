import { describe, it, expect } from 'vitest';
import { computeXp, completionRatio, baseXp, levelXpMultiplier, BASE_XP, COMPLETION_CAP, UNCAPPED_RATIO_CAP } from '../xp';

describe('baseXp', () => {
  it('matches the brief difficulty table', () => {
    expect(BASE_XP).toEqual({ easy: 10, normal: 20, hard: 35, epic: 50 });
    expect(baseXp('hard')).toBe(35);
  });
});

describe('completionRatio', () => {
  it('is the actual/target fraction', () => {
    expect(completionRatio(10, 20)).toBe(0.5);
  });
  it('caps at 150%', () => {
    expect(completionRatio(40, 20)).toBe(COMPLETION_CAP);
  });
  it('treats a non-positive target as complete', () => {
    expect(completionRatio(5, 0)).toBe(1);
  });
  it('uncapped: scales linearly up to UNCAPPED_RATIO_CAP', () => {
    expect(completionRatio(3, 1, true)).toBe(3);
    expect(completionRatio(10, 1, true)).toBe(UNCAPPED_RATIO_CAP);
  });
  it('uncapped: is hard-capped at UNCAPPED_RATIO_CAP regardless of actual', () => {
    expect(completionRatio(1000, 1, true)).toBe(UNCAPPED_RATIO_CAP);
    expect(completionRatio(10000, 1, true)).toBe(UNCAPPED_RATIO_CAP);
  });
});

describe('computeXp', () => {
  it('binary habit grants full base XP', () => {
    expect(computeXp({ difficulty: 'normal', type: 'binary' })).toBe(20);
  });

  // Brief Section 3 worked example: read 10/20 pages, normal -> 10 XP.
  it('quantity habit scales by completion (50% -> half XP)', () => {
    expect(computeXp({ difficulty: 'normal', type: 'quantity', actual: 10, target: 20 })).toBe(10);
  });

  // Brief Section 3 worked example: read 40/20 pages, normal -> capped 30 XP.
  it('quantity habit caps overachievement at 150%', () => {
    expect(computeXp({ difficulty: 'normal', type: 'quantity', actual: 40, target: 20 })).toBe(30);
  });

  it('uncapped quantity scales XP linearly past 150%', () => {
    expect(computeXp({ difficulty: 'normal', type: 'quantity', actual: 40, target: 20, uncapped: true })).toBe(40);
  });

  it('applies the +10% recovery bonus', () => {
    expect(computeXp({ difficulty: 'normal', type: 'binary', recovery: true })).toBe(22);
  });

  // BAL-01: habit XP scales with character level so it keeps pace with the trial/dungeon curves.
  it('omitting level (or level 1) yields the flat base — backward compatible', () => {
    expect(computeXp({ difficulty: 'normal', type: 'binary' })).toBe(20);
    expect(computeXp({ difficulty: 'normal', type: 'binary', level: 1 })).toBe(20);
  });

  it('scales base XP by 1 + 0.15×(L−1) with character level', () => {
    // L10: 20 × (1 + 0.15×9) = 20 × 2.35 = 47
    expect(computeXp({ difficulty: 'normal', type: 'binary', level: 10 })).toBe(47);
    // L20: 20 × (1 + 0.15×19) = 20 × 3.85 = 77
    expect(computeXp({ difficulty: 'normal', type: 'binary', level: 20 })).toBe(77);
    // Hard at L20: 35 × 3.85 = 134.75 → 135
    expect(computeXp({ difficulty: 'hard', type: 'binary', level: 20 })).toBe(135);
  });

  it('level scaling composes with quantity ratio and recovery', () => {
    // 50% of a normal habit at L10 with recovery: 20 × 0.5 × 1.1 × 2.35 = 25.85 → 26
    expect(
      computeXp({ difficulty: 'normal', type: 'quantity', actual: 10, target: 20, recovery: true, level: 10 }),
    ).toBe(26);
  });
});

describe('levelXpMultiplier', () => {
  it('is 1.0 at level 1 and grows 0.15 per level', () => {
    expect(levelXpMultiplier(1)).toBe(1);
    expect(levelXpMultiplier(10)).toBeCloseTo(2.35);
  });
  it('clamps sub-1 levels to 1.0 (never below base)', () => {
    expect(levelXpMultiplier(0)).toBe(1);
  });
});
