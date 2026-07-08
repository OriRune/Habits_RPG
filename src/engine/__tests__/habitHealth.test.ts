import { describe, it, expect } from 'vitest';
import {
  habitHealth,
  accountHealth,
  recoveryState,
  missedRecentScheduledDay,
} from '../habitHealth';
import { type Habit } from '../habits';
import { addDays } from '../date';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHabit(overrides: Partial<Habit>): Habit {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Test Habit',
    stat: 'ST',
    type: 'binary',
    frequency: 'daily',
    difficulty: 'normal',
    status: 'active',
    streak: 0,
    log: {},
    createdISO: '2026-01-01', // old enough to pass MIN_AGE_DAYS
    ...overrides,
  };
}

/** Build a log covering `count` days ending at `endDay` (inclusive). */
function buildLog(endDay: string, count: number, skipLast = 0): Habit['log'] {
  const log: Habit['log'] = {};
  for (let d = 0; d < count; d++) {
    const day = addDays(endDay, -(count - 1 - d));
    if (d >= count - skipLast) continue; // leave the last `skipLast` days empty
    log[day] = { xp: 20 };
  }
  return log;
}

const TODAY = '2026-06-22';
// 28-day window start
const WINDOW_START = addDays(TODAY, -27); // 2026-05-26

// ---------------------------------------------------------------------------
// habitHealth — guards (no warnings returned)
// ---------------------------------------------------------------------------

describe('habitHealth — guards', () => {
  it('returns [] for a habit that is too new (< 7 days old)', () => {
    const h = makeHabit({ createdISO: '2026-06-20' }); // 2 days old
    expect(habitHealth(h, TODAY)).toHaveLength(0);
  });

  it('returns [] for a retired habit', () => {
    const h = makeHabit({ status: 'retired' });
    expect(habitHealth(h, TODAY)).toHaveLength(0);
  });

  it('returns [] for a suspended habit', () => {
    const h = makeHabit({ status: 'suspended', suspendUntilISO: '2026-07-01' });
    expect(habitHealth(h, TODAY)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// missedRecentScheduledDay — daily-reminder offer cue
// ---------------------------------------------------------------------------

describe('missedRecentScheduledDay', () => {
  it('true when a daily habit went unlogged yesterday', () => {
    // Logged through yesterday, then drop yesterday's entry to force a real miss.
    const h = makeHabit({ log: buildLog(addDays(TODAY, -1), 10) });
    delete h.log[addDays(TODAY, -1)];
    expect(missedRecentScheduledDay([h], TODAY)).toBe(true);
  });

  it('false when every recent scheduled day was logged', () => {
    const h = makeHabit({ log: buildLog(addDays(TODAY, -1), 10) });
    expect(missedRecentScheduledDay([h], TODAY)).toBe(false);
  });

  it("ignores today's own (still-in-progress) missing entry", () => {
    // Logged through yesterday, nothing today — today doesn't count as a miss.
    const h = makeHabit({ log: buildLog(addDays(TODAY, -1), 10) });
    expect(missedRecentScheduledDay([h], TODAY)).toBe(false);
  });

  it('false for a brand-new habit with no scheduled history yet', () => {
    const h = makeHabit({ createdISO: TODAY, log: {} });
    expect(missedRecentScheduledDay([h], TODAY)).toBe(false);
  });

  it('ignores as_needed and times_per_week habits', () => {
    const asNeeded = makeHabit({ frequency: 'as_needed', log: {} });
    const weekly = makeHabit({ frequency: 'times_per_week', log: {} });
    expect(missedRecentScheduledDay([asNeeded, weekly], TODAY)).toBe(false);
  });

  it('does not count a frozen (streak-freeze) day as a miss', () => {
    const h = makeHabit({ log: buildLog(addDays(TODAY, -1), 10) });
    // Replace yesterday's normal entry with a freeze entry — still "logged".
    h.log[addDays(TODAY, -1)] = { xp: 0, frozen: true };
    expect(missedRecentScheduledDay([h], TODAY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// habitHealth — repeated_misses
// ---------------------------------------------------------------------------

describe('habitHealth — repeated_misses', () => {
  it('fires when a daily habit has 4+ misses in the last 28 days', () => {
    // Completions only before the window → all 28 window days are misses.
    // Also add some log entries outside the window so `unused_weeks` check doesn't
    // sole-fire (we want to observe repeated_misses specifically).
    const log: Habit['log'] = {};
    // 5 completions in May, before the window (before 2026-05-26)
    for (let d = 0; d < 5; d++) {
      log[addDays('2026-05-25', -d)] = { xp: 20 };
    }
    const h = makeHabit({ log });
    const warnings = habitHealth(h, TODAY);
    expect(warnings.some((w) => w.code === 'repeated_misses')).toBe(true);
  });

  it('does NOT fire when a daily habit has fewer than 4 misses in the last 28 days', () => {
    // Fill 26 of the 28 window days (2 misses = below threshold)
    const log = buildLog(TODAY, 28, 2);
    const h = makeHabit({ log });
    const warnings = habitHealth(h, TODAY);
    expect(warnings.some((w) => w.code === 'repeated_misses')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// habitHealth — target_too_high
// ---------------------------------------------------------------------------

describe('habitHealth — target_too_high', () => {
  it('fires for a quantity habit with 3+ partial completions in the window', () => {
    const log: Habit['log'] = {};
    // Fill all 28 window days: first 4 as partial, rest as full
    for (let d = 0; d < 28; d++) {
      const day = addDays(WINDOW_START, d);
      if (d < 4) {
        log[day] = { xp: 10, amount: 2 }; // partial (target is 5)
      } else {
        log[day] = { xp: 20, amount: 5 }; // full
      }
    }
    const h = makeHabit({ type: 'quantity', target: 5, log });
    const warnings = habitHealth(h, TODAY);
    expect(warnings.some((w) => w.code === 'target_too_high')).toBe(true);
  });

  it('does NOT fire for a binary habit', () => {
    const log = buildLog(TODAY, 28);
    const h = makeHabit({ type: 'binary', log });
    const warnings = habitHealth(h, TODAY);
    expect(warnings.some((w) => w.code === 'target_too_high')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// habitHealth — always_completed
// ---------------------------------------------------------------------------

describe('habitHealth — always_completed', () => {
  it('fires when 12+ scheduled days all have completions (perfect window)', () => {
    const log = buildLog(TODAY, 28, 0); // all 28 days done
    const h = makeHabit({ log });
    const warnings = habitHealth(h, TODAY);
    expect(warnings.some((w) => w.code === 'always_completed')).toBe(true);
  });

  it('does NOT fire when there is any miss in the window', () => {
    const log = buildLog(TODAY, 28, 1); // 27 done, 1 miss
    const h = makeHabit({ log });
    const warnings = habitHealth(h, TODAY);
    expect(warnings.some((w) => w.code === 'always_completed')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// habitHealth — unused_weeks
// ---------------------------------------------------------------------------

describe('habitHealth — unused_weeks', () => {
  it('fires when a daily habit has no log entries for the last 3 weeks', () => {
    // No log entries at all; habit is old enough (createdISO < 3-week cutoff)
    const h = makeHabit({ log: {} });
    const warnings = habitHealth(h, TODAY);
    expect(warnings.some((w) => w.code === 'unused_weeks')).toBe(true);
  });

  it('does NOT fire when there is a recent completion within 3 weeks', () => {
    const h = makeHabit({ log: { '2026-06-15': { xp: 20 } } }); // 7 days ago
    const warnings = habitHealth(h, TODAY);
    expect(warnings.some((w) => w.code === 'unused_weeks')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// habitHealth — weekday_weekend_gap
// ---------------------------------------------------------------------------

describe('habitHealth — weekday_weekend_gap', () => {
  it('fires when weekdays are done but weekends are mostly missed', () => {
    // Build a log for the 28-day window: complete all weekdays, skip all weekends.
    // Weekends in 2026-05-26 to 2026-06-22:
    //   May 30(Sat), May 31(Sun), Jun 6(Sat), Jun 7(Sun),
    //   Jun 13(Sat), Jun 14(Sun), Jun 20(Sat), Jun 21(Sun) — 8 weekend days
    const weekendSet = new Set([
      '2026-05-30', '2026-05-31',
      '2026-06-06', '2026-06-07',
      '2026-06-13', '2026-06-14',
      '2026-06-20', '2026-06-21',
    ]);
    const log: Habit['log'] = {};
    for (let d = 0; d < 28; d++) {
      const day = addDays(WINDOW_START, d);
      if (!weekendSet.has(day)) {
        log[day] = { xp: 20 }; // weekday done
      }
      // weekend: missing from log
    }
    const h = makeHabit({ log });
    const warnings = habitHealth(h, TODAY);
    expect(warnings.some((w) => w.code === 'weekday_weekend_gap')).toBe(true);
  });

  it('does NOT fire when weekend completion rate is also high', () => {
    const log = buildLog(TODAY, 28, 0); // all days done
    const h = makeHabit({ log });
    const warnings = habitHealth(h, TODAY);
    expect(warnings.some((w) => w.code === 'weekday_weekend_gap')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// accountHealth
// ---------------------------------------------------------------------------

describe('accountHealth', () => {
  it('fires high_load for 12+ active daily habits', () => {
    const habits = Array.from({ length: 12 }, (_, i) =>
      makeHabit({ id: `h${i}`, stat: 'ST' }),
    );
    const warnings = accountHealth(habits, TODAY);
    expect(warnings.some((w) => w.code === 'high_load')).toBe(true);
  });

  it('does NOT fire high_load for 11 daily habits', () => {
    const habits = Array.from({ length: 11 }, (_, i) =>
      makeHabit({ id: `h${i}`, stat: 'ST' }),
    );
    const warnings = accountHealth(habits, TODAY);
    expect(warnings.some((w) => w.code === 'high_load')).toBe(false);
  });

  it('fires stat_overloaded when 4+ daily habits share a stat', () => {
    const habits = Array.from({ length: 4 }, (_, i) =>
      makeHabit({ id: `h${i}`, stat: 'EN' }),
    );
    const warnings = accountHealth(habits, TODAY);
    expect(warnings.some((w) => w.code === 'stat_overloaded')).toBe(true);
  });

  it('does NOT fire stat_overloaded for 3 habits on one stat', () => {
    const habits = Array.from({ length: 3 }, (_, i) =>
      makeHabit({ id: `h${i}`, stat: 'EN' }),
    );
    const warnings = accountHealth(habits, TODAY);
    expect(warnings.some((w) => w.code === 'stat_overloaded')).toBe(false);
  });

  it('returns [] for an empty habit list', () => {
    expect(accountHealth([], TODAY)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// recoveryState — thresholds
// ---------------------------------------------------------------------------

describe('recoveryState', () => {
  it('returns not struggling when there are no habits', () => {
    expect(recoveryState([], TODAY).struggling).toBe(false);
  });

  it('flags long_absence when no completion in the last 5 days and active habits exist', () => {
    // absenceCutoff = addDays('2026-06-22', -4) = '2026-06-18'
    // last completion = '2026-06-17' which is before the cutoff
    const h = makeHabit({ log: { '2026-06-17': { xp: 20 } } });
    const state = recoveryState([h], TODAY);
    expect(state.struggling).toBe(true);
    expect(state.reason).toBe('long_absence');
  });

  it('does NOT flag long_absence when a completion occurred within the 5-day window', () => {
    const h = makeHabit({ log: { '2026-06-18': { xp: 20 } } }); // exactly at edge = within window
    const state = recoveryState([h], TODAY);
    expect(state.reason).not.toBe('long_absence');
  });

  it('does NOT flag long_absence for a fresh account with no active habits', () => {
    const h = makeHabit({ status: 'retired', log: {} });
    const state = recoveryState([h], TODAY);
    expect(state.struggling).toBe(false);
  });

  it('flags low_weekly_rate when < 30% of scheduled obligations met over 14 days', () => {
    // Recent completion today so long_absence does not fire.
    // Only 1 completion in 14 scheduled days (1/14 ≈ 7% < 30%).
    const h = makeHabit({ log: { [TODAY]: { xp: 20 } } });
    const state = recoveryState([h], TODAY);
    expect(state.struggling).toBe(true);
    expect(state.reason).toBe('low_weekly_rate');
  });

  it('does NOT flag low_weekly_rate when completion rate is at or above 30%', () => {
    // 7 completions in 14 scheduled days = 50% ≥ 30%.
    const log: Habit['log'] = {};
    for (let d = 0; d < 14; d += 2) {
      log[addDays(TODAY, -(13 - d))] = { xp: 20 };
    }
    const h = makeHabit({ log });
    const state = recoveryState([h], TODAY);
    expect(state.struggling).toBe(false);
  });
});
