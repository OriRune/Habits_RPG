import { describe, it, expect } from 'vitest';
import { computeXp, completionRatio, baseXp, BASE_XP } from '../xp';

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
    expect(completionRatio(40, 20)).toBe(1.5);
  });
  it('treats a non-positive target as complete', () => {
    expect(completionRatio(5, 0)).toBe(1);
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

  it('applies the +10% recovery bonus', () => {
    expect(computeXp({ difficulty: 'normal', type: 'binary', recovery: true })).toBe(22);
  });
});
