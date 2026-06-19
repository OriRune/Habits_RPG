/**
 * Reset boundary tests (clock seam driven).
 *
 * Verifies that the daily trial gate and weekly rollover use toISODate() (which
 * now routes through the injectable now() seam) so boundaries are observable
 * without monkey-patching global Date.
 *
 * The clock is driven forward by calling _setNow before each action. afterEach
 * always calls _resetNow so no override leaks across tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { useGameStore } from '../useGameStore';
import { _setNow, _resetNow, weekKey } from '@/engine/date';

const get = () => useGameStore.getState();

afterEach(() => {
  _resetNow();
});

// ---------------------------------------------------------------------------
// Daily trial gate
// ---------------------------------------------------------------------------

describe('daily trial gate', () => {
  it('blocks a second completeTrial call on the same local day', () => {
    const tuesday = new Date(2026, 0, 13); // 2026-01-13
    _setNow(() => tuesday);
    get().resetGame(); // lastWeekKey and trialsClearedOn seeded from mocked clock

    get().completeTrial('lockpicking', 1.0);
    const goldAfterFirst = get().character.gold;

    get().completeTrial('lockpicking', 1.0); // same day → blocked
    expect(get().character.gold).toBe(goldAfterFirst);
  });

  it('re-opens the gate when the clock advances to the next local day', () => {
    const tuesday = new Date(2026, 0, 13);
    const wednesday = new Date(2026, 0, 14);

    _setNow(() => tuesday);
    get().resetGame();

    get().completeTrial('lockpicking', 1.0);
    const goldAfterFirst = get().character.gold;

    _setNow(() => wednesday); // advance the clock to the next day
    get().completeTrial('lockpicking', 1.0); // gate re-opens
    expect(get().character.gold).toBeGreaterThan(goldAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// Weekly rollover
// ---------------------------------------------------------------------------

describe('weekly rollover', () => {
  it('does not roll over mid-week', () => {
    const tuesday = new Date(2026, 0, 13); // week of 2026-01-11 (Sunday)
    _setNow(() => tuesday);
    get().resetGame(); // lastWeekKey = weekKey('2026-01-13') = '2026-01-11'

    get().checkWeeklyRollover();
    expect(get().lastWeekKey).toBe(weekKey('2026-01-13')); // unchanged
  });

  it('rolls over when the clock crosses a local week boundary', () => {
    // Seed store at Saturday Jan 17 — last day of the week of 2026-01-11.
    const saturday = new Date(2026, 0, 17); // 2026-01-17 Saturday
    _setNow(() => saturday);
    get().resetGame(); // lastWeekKey = '2026-01-11'

    get().checkWeeklyRollover(); // still same week → no-op
    expect(get().lastWeekKey).toBe('2026-01-11');

    // Advance to Sunday Jan 18 — the start of a new week.
    const nextSunday = new Date(2026, 0, 18); // 2026-01-18 Sunday
    _setNow(() => nextSunday);
    get().checkWeeklyRollover();

    expect(get().lastWeekKey).toBe('2026-01-18');
  });
});
