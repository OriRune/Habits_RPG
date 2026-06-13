import { describe, it, expect } from 'vitest';
import {
  xpForNextLevel,
  cumulativeXpToReach,
  levelForTotalXp,
  levelProgress,
} from '../leveling';

describe('xpForNextLevel', () => {
  // Brief Section 4 worked table.
  it('matches the brief table', () => {
    expect(xpForNextLevel(1)).toBe(100);
    expect(xpForNextLevel(2)).toBe(283);
    expect(xpForNextLevel(3)).toBe(520);
    expect(xpForNextLevel(4)).toBe(800);
    expect(xpForNextLevel(5)).toBe(1118);
    expect(xpForNextLevel(10)).toBe(3162);
    expect(xpForNextLevel(20)).toBe(8944);
  });
});

describe('cumulativeXpToReach', () => {
  it('level 1 needs no XP', () => {
    expect(cumulativeXpToReach(1)).toBe(0);
  });
  it('level 2 needs the level-1 increment', () => {
    expect(cumulativeXpToReach(2)).toBe(100);
  });
  it('level 3 sums the first two increments', () => {
    expect(cumulativeXpToReach(3)).toBe(100 + 283);
  });
});

describe('levelForTotalXp', () => {
  it('starts at level 1 with no XP', () => {
    expect(levelForTotalXp(0)).toBe(1);
  });
  it('stays level 1 just below the threshold', () => {
    expect(levelForTotalXp(99)).toBe(1);
  });
  it('hits level 2 at exactly 100 XP', () => {
    expect(levelForTotalXp(100)).toBe(2);
  });
  it('hits level 3 at 383 XP', () => {
    expect(levelForTotalXp(383)).toBe(3);
  });
});

describe('levelProgress', () => {
  it('reports progress within the current level', () => {
    const p = levelProgress(150);
    expect(p.level).toBe(2);
    expect(p.intoLevel).toBe(50);
    expect(p.neededForNext).toBe(283);
    expect(p.ratio).toBeCloseTo(50 / 283, 5);
  });
});
