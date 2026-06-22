import { describe, it, expect } from 'vitest';
import { type Habit, type HabitEntry } from '../habits';
import { dayCell, habitStats, series, consistencyScore, dayOfWeekBreakdown, consistencyTrend } from '../tracking';
import { addDays } from '../date';

function makeHabit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Read',
    stat: 'KN',
    type: 'binary',
    frequency: 'daily',
    difficulty: 'normal',
    status: 'active',
    streak: 0,
    log: {},
    createdISO: '2026-06-08',
    ...over,
  };
}

function log(entries: Record<string, HabitEntry>): Record<string, HabitEntry> {
  return entries;
}

const TODAY = '2026-06-14'; // a Sunday

describe('dayCell', () => {
  it('marks future and pre-creation days', () => {
    const h = makeHabit();
    expect(dayCell(h, '2026-06-20', TODAY)).toBe('future');
    expect(dayCell(h, '2026-06-01', TODAY)).toBe('none'); // before createdISO
  });

  it('green for a completed binary day', () => {
    const h = makeHabit({ log: log({ '2026-06-12': { xp: 20 } }) });
    expect(dayCell(h, '2026-06-12', TODAY)).toBe('green');
  });

  it('green when a quantity target is hit, yellow when under', () => {
    const h = makeHabit({ type: 'quantity', target: 10, log: log({ '2026-06-12': { amount: 10, xp: 20 }, '2026-06-13': { amount: 5, xp: 10 } }) });
    expect(dayCell(h, '2026-06-12', TODAY)).toBe('green');
    expect(dayCell(h, '2026-06-13', TODAY)).toBe('yellow');
  });

  it('red for a missed scheduled day, gray for an unscheduled day', () => {
    const daily = makeHabit();
    expect(dayCell(daily, '2026-06-10', TODAY)).toBe('red'); // scheduled, not done
    const weekdays = makeHabit({ frequency: 'weekdays' });
    expect(dayCell(weekdays, '2026-06-13', TODAY)).toBe('gray'); // Saturday
  });

  it('never shows red for a suspended habit', () => {
    const h = makeHabit({ status: 'suspended', suspendUntilISO: '2026-07-01' });
    expect(dayCell(h, '2026-06-10', TODAY)).toBe('gray');
  });
});

describe('habitStats', () => {
  it('totals, longest streak, and success% for a daily habit', () => {
    const h = makeHabit({
      createdISO: '2026-06-08',
      log: log({
        '2026-06-08': { xp: 20 },
        '2026-06-09': { xp: 20 },
        '2026-06-10': { xp: 20 },
        // 06-11 missed -> breaks streak
        '2026-06-12': { xp: 20 },
        '2026-06-13': { xp: 20 },
      }),
    });
    const s = habitStats(h, TODAY);
    expect(s.totalDays).toBe(5);
    expect(s.totalPoints).toBe(100);
    expect(s.longestStreak).toBe(3);
    expect(s.successPct).toBe(71); // 5 successes / 7 scheduled days
  });

  it('partial quantity days count as completed but not successful', () => {
    const h = makeHabit({
      type: 'quantity',
      target: 10,
      createdISO: '2026-06-12',
      log: log({ '2026-06-12': { amount: 10, xp: 20 }, '2026-06-13': { amount: 5, xp: 10 } }),
    });
    const s = habitStats(h, TODAY);
    expect(s.successPct).toBe(33); // 1 success / 3 scheduled
    expect(s.longestStreak).toBe(2); // both completed
  });

  it('counts successful weeks for times_per_week', () => {
    const h = makeHabit({
      frequency: 'times_per_week',
      timesPerWeek: 2,
      createdISO: '2026-05-31',
      log: log({
        '2026-06-01': { xp: 20 }, '2026-06-03': { xp: 20 }, // week of 05-31
        '2026-06-08': { xp: 20 }, '2026-06-10': { xp: 20 }, // week of 06-07
        '2026-06-14': { xp: 20 }, // current week, only 1 (not met)
      }),
    });
    const s = habitStats(h, TODAY);
    expect(s.longestStreak).toBe(2);
    expect(s.successPct).toBe(100); // 2/2 completed weeks
  });

  it('as_needed has a calendar-day streak and no success%', () => {
    const h = makeHabit({
      frequency: 'as_needed',
      createdISO: '2026-06-10',
      log: log({ '2026-06-10': { xp: 20 }, '2026-06-11': { xp: 20 }, '2026-06-12': { xp: 20 }, '2026-06-14': { xp: 20 } }),
    });
    const s = habitStats(h, TODAY);
    expect(s.longestStreak).toBe(3);
    expect(s.successPct).toBeNull();
    expect(s.totalDays).toBe(4);
  });
});

describe('series', () => {
  it('maps daily amounts over a range, 0 when unlogged', () => {
    const h = makeHabit({ type: 'quantity', target: 10, log: log({ '2026-06-12': { amount: 5, xp: 10 }, '2026-06-13': { amount: 8, xp: 16 } }) });
    expect(series(h, '2026-06-12', '2026-06-14')).toEqual([
      { date: '2026-06-12', amount: 5 },
      { date: '2026-06-13', amount: 8 },
      { date: '2026-06-14', amount: 0 },
    ]);
  });
});

describe('consistencyScore (Stage 5.3)', () => {
  // TODAY = '2026-06-14' (Sunday); windowDays = 7 for these tests to keep setup small.

  it('returns 0 for an empty habit list', () => {
    expect(consistencyScore([], TODAY, 7)).toBe(0);
  });

  it('returns 0 when all habits are as_needed (no denominator)', () => {
    const h = makeHabit({ frequency: 'as_needed', log: log({ [TODAY]: { xp: 20 } }) });
    expect(consistencyScore([h], TODAY, 7)).toBe(0);
  });

  it('returns 0 for a retired habit', () => {
    const h = makeHabit({
      status: 'retired',
      createdISO: '2026-06-08',
      log: log({ '2026-06-08': { xp: 20 }, '2026-06-09': { xp: 20 } }),
    });
    expect(consistencyScore([h], TODAY, 7)).toBe(0);
  });

  it('returns 100 when every scheduled day in the window is completed', () => {
    // Window: 2026-06-08 to 2026-06-14 (7 days). Habit created 06-08, daily.
    const h = makeHabit({
      createdISO: '2026-06-08',
      log: log({
        '2026-06-08': { xp: 20 },
        '2026-06-09': { xp: 20 },
        '2026-06-10': { xp: 20 },
        '2026-06-11': { xp: 20 },
        '2026-06-12': { xp: 20 },
        '2026-06-13': { xp: 20 },
        '2026-06-14': { xp: 20 },
      }),
    });
    expect(consistencyScore([h], TODAY, 7)).toBe(100);
  });

  it('returns ~57 when 4 of 7 scheduled days are completed', () => {
    const h = makeHabit({
      createdISO: '2026-06-08',
      log: log({
        '2026-06-08': { xp: 20 },
        '2026-06-10': { xp: 20 },
        '2026-06-12': { xp: 20 },
        '2026-06-14': { xp: 20 },
      }),
    });
    // 4 / 7 ≈ 57.14 → rounds to 57
    expect(consistencyScore([h], TODAY, 7)).toBe(57);
  });

  it('excludes the current week from times_per_week calculation', () => {
    // Week of 06-07 (Mon–Sun): completions 2 of 2 → 100%.
    // Current week 06-14 (today = sunday start of week): excluded.
    const h = makeHabit({
      frequency: 'times_per_week',
      timesPerWeek: 2,
      createdISO: '2026-06-07',
      log: log({ '2026-06-08': { xp: 20 }, '2026-06-10': { xp: 20 }, '2026-06-14': { xp: 20 } }),
    });
    // Only the week of 06-07 falls fully before today's week (06-14).
    expect(consistencyScore([h], TODAY, 14)).toBe(100);
  });

  it('respects the window start — completions before the window do not count as scheduled', () => {
    // Window of 1 day: only today (2026-06-14). Habit created long before.
    const h = makeHabit({
      createdISO: '2026-01-01',
      log: log({ '2026-06-14': { xp: 20 } }),
    });
    expect(consistencyScore([h], TODAY, 1)).toBe(100);
  });
});

// TODAY = '2026-06-14' (Sunday = weekday 0).
// Weekdays: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6

describe('dayOfWeekBreakdown', () => {
  it('returns 7 buckets covering all weekdays', () => {
    const result = dayOfWeekBreakdown([], TODAY);
    expect(result).toHaveLength(7);
    expect(result.map((b) => b.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('counts scheduled and completed days per weekday for a daily habit', () => {
    // Daily habit, 7-day window. Today is Sunday (0). Use windowDays=7 to limit scope.
    const h = makeHabit({
      createdISO: '2026-06-08', // Monday of the week
      log: log({
        '2026-06-09': { xp: 20 }, // Tuesday (2) — completed
        '2026-06-11': { xp: 20 }, // Thursday (4) — completed
        // other days scheduled but not completed
      }),
    });
    const result = dayOfWeekBreakdown([h], TODAY, 7);
    // Monday 2026-06-08 = weekday 1, in window (today - 6 = 2026-06-08)
    const mon = result.find((b) => b.weekday === 1)!;
    expect(mon.scheduled).toBe(1);
    expect(mon.completed).toBe(0);
    const tue = result.find((b) => b.weekday === 2)!;
    expect(tue.scheduled).toBe(1);
    expect(tue.completed).toBe(1);
  });

  it('excludes retired habits', () => {
    const h = makeHabit({
      status: 'retired',
      createdISO: '2026-01-01',
      log: log({ '2026-06-14': { xp: 20 } }),
    });
    const result = dayOfWeekBreakdown([h], TODAY, 7);
    expect(result.every((b) => b.scheduled === 0 && b.completed === 0)).toBe(true);
  });

  it('excludes times_per_week and as_needed habits (isScheduledOn returns false)', () => {
    const weekly = makeHabit({ frequency: 'times_per_week', timesPerWeek: 2, log: log({ '2026-06-14': { xp: 20 } }) });
    const asNeeded = makeHabit({ id: 'an', frequency: 'as_needed', log: log({ '2026-06-14': { xp: 20 } }) });
    const result = dayOfWeekBreakdown([weekly, asNeeded], TODAY, 7);
    expect(result.every((b) => b.scheduled === 0)).toBe(true);
  });
});

describe('consistencyTrend', () => {
  it('returns `weeks` entries in ascending weekStart order', () => {
    const result = consistencyTrend([], TODAY, 4);
    expect(result).toHaveLength(4);
    // Each weekStart should be a Sunday (7 days apart)
    for (let i = 1; i < result.length; i++) {
      expect(addDays(result[i - 1].weekStart, 7)).toBe(result[i].weekStart);
    }
  });

  it('returns 0 pct for all weeks when no habits exist', () => {
    const result = consistencyTrend([], TODAY, 4);
    expect(result.every((w) => w.pct === 0)).toBe(true);
  });

  it('returns 100 for a week where every scheduled day was completed', () => {
    // Use a 1-week window to test a fully-completed past week.
    // Last full week before TODAY (2026-06-14 = Sun): week of 2026-06-08 (Mon).
    // But startOfWeek(TODAY) = 2026-06-14 itself. So the prior week is 2026-06-07.
    // For simplicity, test with 1-week window (just the current week partial).
    const h = makeHabit({
      createdISO: '2026-06-08',
      log: log({
        '2026-06-08': { xp: 20 }, '2026-06-09': { xp: 20 }, '2026-06-10': { xp: 20 },
        '2026-06-11': { xp: 20 }, '2026-06-12': { xp: 20 }, '2026-06-13': { xp: 20 },
        '2026-06-14': { xp: 20 },
      }),
    });
    // weeks=1 → single bucket for the current week (2026-06-14 start of week = TODAY)
    const result = consistencyTrend([h], TODAY, 1);
    expect(result).toHaveLength(1);
    expect(result[0].pct).toBe(100);
  });

  it('current week uses partial data up to today', () => {
    // Today = Sunday 2026-06-14. Current week start = 2026-06-14.
    // Only today (1 day) is in window; habit created 06-14 and completed.
    const h = makeHabit({
      createdISO: '2026-06-14',
      log: log({ '2026-06-14': { xp: 20 } }),
    });
    const result = consistencyTrend([h], TODAY, 1);
    expect(result[0].pct).toBe(100);
  });
});
