import { describe, it, expect } from 'vitest';
import { quickStartAllocations, QUICK_START_SPELL } from '../CreationView';
import { STARTING_STAT_POINTS, CREATION_STAT_MAX, BASE_STAT_LEVEL } from '@/engine/progression';
import { SIGNATURE_SPELL_CHOICES } from '@/engine/spells';

// Regression for HABIT-07: a quick-starter must still spend all its origin points
// and receive a signature spell rather than silently forfeiting both.
describe('quickStart defaults', () => {
  it('spends every starting stat point across at least two stats', () => {
    const alloc = quickStartAllocations();
    const values = Object.values(alloc);
    const spent = values.reduce((sum, v) => sum + (v ?? 0), 0);
    expect(spent).toBe(STARTING_STAT_POINTS);
    // more than one stat receives points -> a viable spread, not a single dump
    expect(values.filter((v) => (v ?? 0) > 0).length).toBeGreaterThanOrEqual(2);
    // never exceed the per-stat creation cap
    for (const v of values) {
      expect(v ?? 0).toBeLessThanOrEqual(CREATION_STAT_MAX - BASE_STAT_LEVEL);
    }
  });

  it('grants a real signature spell', () => {
    expect(QUICK_START_SPELL).toBeTruthy();
    expect(SIGNATURE_SPELL_CHOICES).toContain(QUICK_START_SPELL);
  });
});
