/**
 * Clock seam unit tests (engine/date.ts).
 *
 * Verifies that now() / toISODate() can be overridden by _setNow for testing,
 * and that _resetNow restores the real wall clock.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { now, toISODate, _setNow, _resetNow } from '@/engine/date';

afterEach(() => {
  _resetNow();
});

describe('clock seam', () => {
  it('now() returns a Date within the real wall-clock window by default', () => {
    const before = Date.now();
    const t = now().getTime();
    const after = Date.now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('_setNow overrides now() and toISODate()', () => {
    const fixed = new Date(2026, 0, 15); // 2026-01-15
    _setNow(() => fixed);
    expect(now()).toBe(fixed);
    expect(toISODate()).toBe('2026-01-15');
  });

  it('_resetNow restores the real wall clock', () => {
    _setNow(() => new Date(2000, 0, 1));
    _resetNow();
    // After reset, toISODate() should reflect the current year, not 2000.
    expect(toISODate()).not.toBe('2000-01-01');
  });

  it('toISODate() with an explicit Date arg is unaffected by the clock override', () => {
    _setNow(() => new Date(2026, 0, 15)); // Jan 15 — the override
    const explicit = new Date(2026, 5, 20); // Jun 20 — caller-supplied date
    expect(toISODate(explicit)).toBe('2026-06-20'); // uses explicit, not override
  });
});
