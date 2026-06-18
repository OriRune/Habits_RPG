import { describe, it, expect } from 'vitest';
import {
  resolveCourtCheck,
  courtCheckModifier,
  COURT_DC,
} from '../trials/royalCourt';

describe('courtCheckModifier', () => {
  it('returns 0 for CH level 0', () => {
    expect(courtCheckModifier(0)).toBe(0);
  });

  it('is monotonically non-decreasing', () => {
    for (let i = 0; i < 9; i++) {
      expect(courtCheckModifier(i + 1)).toBeGreaterThanOrEqual(courtCheckModifier(i));
    }
  });

  it('matches CH level 1:1', () => {
    expect(courtCheckModifier(5)).toBe(5);
    expect(courtCheckModifier(10)).toBe(10);
  });
});

describe('resolveCourtCheck — natural rules', () => {
  it('natural 20 always succeeds, even against an impossible DC', () => {
    const result = resolveCourtCheck(20, 0, 999);
    expect(result.natural).toBe('crit');
    expect(result.success).toBe(true);
  });

  it('natural 1 always fails, even against a trivial DC with a high modifier', () => {
    const result = resolveCourtCheck(1, 20, 1);
    expect(result.natural).toBe('fumble');
    expect(result.success).toBe(false);
  });
});

describe('resolveCourtCheck — threshold boundary', () => {
  const dc = COURT_DC.medium; // 13

  it('passes when total exactly equals DC', () => {
    // roll 10 + CH 3 = 13 vs DC 13
    const result = resolveCourtCheck(10, 3, dc);
    expect(result.natural).toBeNull();
    expect(result.success).toBe(true);
    expect(result.total).toBe(13);
  });

  it('fails when total is one below DC', () => {
    // roll 9 + CH 3 = 12 vs DC 13
    const result = resolveCourtCheck(9, 3, dc);
    expect(result.natural).toBeNull();
    expect(result.success).toBe(false);
    expect(result.total).toBe(12);
  });

  it('succeeds above DC', () => {
    const result = resolveCourtCheck(15, 0, dc);
    expect(result.success).toBe(true);
  });
});

describe('resolveCourtCheck — modifier is applied', () => {
  it('modifier pushes a roll that would otherwise fail into a pass', () => {
    const dc = COURT_DC.medium; // 13
    // roll 10 alone = 10 < 13 (fail), but 10 + 5 = 15 >= 13 (pass)
    const noMod = resolveCourtCheck(10, 0, dc);
    const withMod = resolveCourtCheck(10, 5, dc);
    expect(noMod.success).toBe(false);
    expect(withMod.success).toBe(true);
  });

  it('result contains the correct roll, modifier, and total', () => {
    const result = resolveCourtCheck(7, 4, 10);
    expect(result.roll).toBe(7);
    expect(result.modifier).toBe(4);
    expect(result.total).toBe(11);
    expect(result.success).toBe(true);
  });
});

describe('COURT_DC constants', () => {
  it('easy < medium < hard', () => {
    expect(COURT_DC.easy).toBeLessThan(COURT_DC.medium);
    expect(COURT_DC.medium).toBeLessThan(COURT_DC.hard);
  });
});
