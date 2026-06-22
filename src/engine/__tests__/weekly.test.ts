import { describe, it, expect } from 'vitest';
import type { Habit } from '../habits';
import type { ActiveChallenge } from '../challenges';
import { weekKey, addDays } from '../date';
import { buildWeeklyReport, weeklyRotation } from '../weekly';

function makeHabit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h',
    name: 'H',
    stat: 'KN',
    type: 'binary',
    frequency: 'daily',
    difficulty: 'normal',
    status: 'active',
    streak: 0,
    log: {},
    createdISO: '2026-01-01',
    ...over,
  };
}

const WS = weekKey('2026-06-08'); // the Sunday that starts the week of Mon 06-08

describe('buildWeeklyReport', () => {
  const habits = [
    makeHabit({
      name: 'Read',
      stat: 'KN',
      log: { '2026-06-08': { xp: 20 }, '2026-06-09': { xp: 35 } },
    }),
    makeHabit({ id: 'r', name: 'Run', stat: 'EN', log: { '2026-06-09': { xp: 10 } } }),
  ];
  const completionLog = { '2026-06-08': 1, '2026-06-09': 2, '2026-05-01': 9 };
  const challenges: ActiveChallenge[] = [
    { def: { id: 'x', name: 'X', description: '', kind: 'count', goal: 1, durationDays: 7, reward: {} }, startISO: '2026-06-08', progress: 1, status: 'claimed' },
  ];

  const report = buildWeeklyReport(WS, habits, completionLog, challenges, 'steady');

  it('counts only that week\'s completions', () => {
    expect(report.completions).toBe(3); // 06-08 + 06-09, not the 05-01 entry
  });

  it('aggregates XP by stat and picks the top stat', () => {
    expect(report.xpByStat.KN).toBe(55);
    expect(report.xpByStat.EN).toBe(10);
    expect(report.xpTotal).toBe(65);
    expect(report.topStat).toBe('KN');
  });

  it('finds the best in-week streak', () => {
    expect(report.bestStreak).toEqual({ habitName: 'Read', days: 2 });
  });

  it('counts challenges won that started in the week', () => {
    expect(report.challengesWon).toBe(1);
  });
});

describe('buildWeeklyReport — mostImproved / mostMissed / suggestedAdjustment', () => {
  // WS = 2026-06-07 (Sunday). Prior week = 2026-05-31..2026-06-06.
  const WS2 = weekKey('2026-06-07');
  const priorWS = addDays(WS2, -7); // 2026-05-31

  it('mostImproved: picks the habit with the largest positive completion delta', () => {
    const stayed = makeHabit({
      id: 'a', name: 'Stayed',
      log: {
        [addDays(priorWS, 0)]: { xp: 10 }, // 1 prior
        [addDays(WS2, 0)]: { xp: 10 },     // 1 this week → delta 0
      },
    });
    const improved = makeHabit({
      id: 'b', name: 'Improved',
      log: {
        [addDays(priorWS, 0)]: { xp: 10 }, // 1 prior
        [addDays(WS2, 0)]: { xp: 10 },
        [addDays(WS2, 1)]: { xp: 10 },
        [addDays(WS2, 2)]: { xp: 10 },     // 3 this week → delta +2
      },
    });
    const report = buildWeeklyReport(WS2, [stayed, improved], {}, [], 'steady');
    expect(report.mostImproved).toEqual({ habitName: 'Improved', delta: 2 });
  });

  it('mostImproved: null when no habit improved', () => {
    const regressed = makeHabit({
      id: 'c', name: 'Regressed',
      log: {
        [addDays(priorWS, 0)]: { xp: 10 },
        [addDays(priorWS, 1)]: { xp: 10 }, // 2 prior, 0 this week
      },
    });
    const report = buildWeeklyReport(WS2, [regressed], {}, [], 'steady');
    expect(report.mostImproved).toBeNull();
  });

  it('mostMissed: counts scheduled-but-not-completed days in the week', () => {
    // Daily habit, missed 3 of 7 days in WS2 (only 4 logged)
    const h = makeHabit({
      id: 'd', name: 'Sporadic',
      frequency: 'daily',
      createdISO: '2026-01-01',
      log: {
        [addDays(WS2, 0)]: { xp: 10 },
        [addDays(WS2, 1)]: { xp: 10 },
        [addDays(WS2, 2)]: { xp: 10 },
        [addDays(WS2, 3)]: { xp: 10 },
        // 4 missed: days 4-6 (but createdISO is before week so all 7 are scheduled)
      },
    });
    const report = buildWeeklyReport(WS2, [h], {}, [], 'steady');
    expect(report.mostMissed).toEqual({ habitName: 'Sporadic', missed: 3 });
  });

  it('mostMissed: null when every scheduled day was completed', () => {
    const h = makeHabit({
      id: 'e', name: 'Perfect',
      frequency: 'daily',
      createdISO: '2026-01-01',
      log: Object.fromEntries(
        Array.from({ length: 7 }, (_, d) => [addDays(WS2, d), { xp: 10 }]),
      ),
    });
    const report = buildWeeklyReport(WS2, [h], {}, [], 'steady');
    expect(report.mostMissed).toBeNull();
  });

  it('suggestedAdjustment: non-null when the mostMissed habit is old enough for habitHealth', () => {
    // Habit with enough missed days (4+) in a 28-day window to trigger a warning.
    // createdISO well before the window so MIN_AGE_DAYS check passes.
    const weekEndDate = addDays(WS2, 6); // 2026-06-13
    const windowStart = addDays(weekEndDate, -27); // 28-day window
    const logEntries: Record<string, { xp: number }> = {};
    // Miss 5 scheduled days in the window (outside the closing week)
    for (let d = 0; d < 5; d++) {
      // these are NOT logged (missed)
      void addDays(windowStart, d); // just for reference — intentionally not logged
    }
    // Complete a few so the habit isn't "unused"
    logEntries[addDays(windowStart, 6)] = { xp: 10 };
    // Miss most of the closing week
    logEntries[addDays(WS2, 0)] = { xp: 10 }; // only 1 completion in closing week

    const h = makeHabit({
      id: 'f', name: 'Struggling',
      frequency: 'daily',
      createdISO: '2026-01-01', // well before window
      log: logEntries,
    });
    const report = buildWeeklyReport(WS2, [h], {}, [], 'steady');
    // The habit missed 6 of 7 days in the closing week → mostMissed
    // AND has enough misses in the 28-day window → habitHealth triggers repeated_misses
    expect(report.suggestedAdjustment).not.toBeNull();
    expect(typeof report.suggestedAdjustment).toBe('string');
  });

  it('suggestedAdjustment: null for a clean account with no warnings', () => {
    // Habit created within 7 days of weekEnd so habitHealth returns [] (too new).
    // weekEnd = addDays(WS2, 6) = '2026-06-13'. createdISO 5 days before weekEnd = '2026-06-08'.
    // ageFloor = addDays('2026-06-13', -6) = '2026-06-07'. '2026-06-08' > '2026-06-07' → too new.
    const weekEndDate = addDays(WS2, 6); // '2026-06-13'
    const freshStart = addDays(weekEndDate, -5); // '2026-06-08'
    const h = makeHabit({
      id: 'g', name: 'Fresh',
      frequency: 'daily',
      createdISO: freshStart,
      log: Object.fromEntries(
        Array.from({ length: 6 }, (_, d) => [addDays(freshStart, d), { xp: 10 }]),
      ),
    });
    const report = buildWeeklyReport(WS2, [h], {}, [], 'steady');
    expect(report.suggestedAdjustment).toBeNull();
  });
});

describe('weeklyRotation', () => {
  it('is deterministic per week but rotates across weeks', () => {
    const a1 = weeklyRotation(WS, null).map((d) => d.id);
    const a2 = weeklyRotation(WS, null).map((d) => d.id);
    expect(a1).toEqual(a2);
    const b = weeklyRotation(weekKey('2026-06-15'), null).map((d) => d.id);
    expect(b).not.toEqual(a1);
  });

  it('always offers a rival challenge', () => {
    expect(weeklyRotation(WS, null).some((d) => d.kind === 'rival')).toBe(true);
  });

  it('adds a class challenge only when a class stat is given', () => {
    expect(weeklyRotation(WS, null).some((d) => d.kind === 'class')).toBe(false);
    expect(weeklyRotation(WS, 'WI').some((d) => d.kind === 'class' && d.stat === 'WI')).toBe(true);
  });
});
