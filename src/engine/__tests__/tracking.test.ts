import { describe, it, expect } from 'vitest';
import { type Habit, type HabitEntry } from '../habits';
import { dayCell, habitStats, series } from '../tracking';

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
