import { describe, it, expect } from 'vitest';
import {
  resolveCompletion,
  isScheduledOn,
  isLoggableOn,
  effectiveStatus,
  isCompletedOn,
  weekCompletions,
  currentStreak,
  mostRecentMissedScheduledDay,
  statCompletedWithin,
  streakMilestone,
  type Habit,
} from '../habits';

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
    createdISO: '2026-06-01',
    ...over,
  };
}

/** Completed-day log from a list of ISO dates. */
function logFrom(dates: string[]): Record<string, { xp: number }> {
  return Object.fromEntries(dates.map((d) => [d, { xp: 20 }]));
}

describe('isScheduledOn', () => {
  it('daily is always scheduled', () => {
    expect(isScheduledOn(makeHabit(), '2026-06-13')).toBe(true);
  });
  it('weekdays excludes weekends', () => {
    const h = makeHabit({ frequency: 'weekdays' });
    expect(isScheduledOn(h, '2026-06-13')).toBe(false); // Saturday
    expect(isScheduledOn(h, '2026-06-15')).toBe(true); // Monday
  });
  it('custom uses the days list', () => {
    const h = makeHabit({ frequency: 'custom', days: [1, 3, 5] });
    expect(isScheduledOn(h, '2026-06-15')).toBe(true); // Monday
    expect(isScheduledOn(h, '2026-06-16')).toBe(false); // Tuesday
  });
  it('times_per_week and as_needed are never day-scheduled', () => {
    expect(isScheduledOn(makeHabit({ frequency: 'times_per_week', timesPerWeek: 3 }), '2026-06-15')).toBe(false);
    expect(isScheduledOn(makeHabit({ frequency: 'as_needed' }), '2026-06-15')).toBe(false);
  });
});

describe('lifecycle: effectiveStatus / isLoggableOn', () => {
  it('retired habits are not loggable', () => {
    expect(isLoggableOn(makeHabit({ status: 'retired' }), '2026-06-15')).toBe(false);
  });
  it('a suspension auto-resumes once its date passes', () => {
    const h = makeHabit({ status: 'suspended', suspendUntilISO: '2026-06-10' });
    expect(effectiveStatus(h, '2026-06-09')).toBe('suspended');
    expect(effectiveStatus(h, '2026-06-10')).toBe('active');
    expect(isLoggableOn(h, '2026-06-15')).toBe(true);
  });
  it('times_per_week and as_needed are loggable any active day', () => {
    expect(isLoggableOn(makeHabit({ frequency: 'as_needed' }), '2026-06-13')).toBe(true); // a Saturday
  });
});

describe('completion history (log)', () => {
  it('isCompletedOn reads the log', () => {
    const h = makeHabit({ log: logFrom(['2026-06-13']) });
    expect(isCompletedOn(h, '2026-06-13')).toBe(true);
    expect(isCompletedOn(h, '2026-06-12')).toBe(false);
  });
  it('weekCompletions counts the Sunday-started week', () => {
    // 2026-06-14 is a Sunday; its week is 06-14..06-20.
    const h = makeHabit({ log: logFrom(['2026-06-14', '2026-06-16', '2026-06-20', '2026-06-13']) });
    expect(weekCompletions(h, '2026-06-15')).toBe(3); // 13 belongs to the prior week
  });
});

describe('currentStreak', () => {
  it('counts consecutive completed daily days up to today', () => {
    const h = makeHabit({ log: logFrom(['2026-06-15', '2026-06-14', '2026-06-13']) });
    expect(currentStreak(h, '2026-06-15')).toBe(3);
  });
  it('does not break when today is scheduled but not yet done', () => {
    const h = makeHabit({ log: logFrom(['2026-06-14', '2026-06-13']) });
    expect(currentStreak(h, '2026-06-15')).toBe(2); // today pending, streak through yesterday
  });
  it('counts consecutive successful weeks for times_per_week', () => {
    const h = makeHabit({
      frequency: 'times_per_week',
      timesPerWeek: 2,
      createdISO: '2026-05-01',
      // week of 06-14: two done; week of 06-07: two done; week of 05-31: one (fails)
      log: logFrom(['2026-06-14', '2026-06-16', '2026-06-08', '2026-06-10', '2026-06-02']),
    });
    expect(currentStreak(h, '2026-06-15')).toBe(2);
  });
});

describe('mostRecentMissedScheduledDay', () => {
  it('returns the missed day after a real gap', () => {
    // 06-15 & 06-14 done, 06-13 missed, 06-12 done. Today 06-15 completed.
    const h = makeHabit({ log: logFrom(['2026-06-15', '2026-06-14', '2026-06-12']) });
    expect(mostRecentMissedScheduledDay(h, '2026-06-15')).toBe('2026-06-13');
  });
  it('returns undefined when there is no miss back to createdISO', () => {
    const h = makeHabit({ createdISO: '2026-06-13', log: logFrom(['2026-06-15', '2026-06-14', '2026-06-13']) });
    expect(mostRecentMissedScheduledDay(h, '2026-06-15')).toBeUndefined();
  });
  it('treats frozen days as bridged, not as a miss', () => {
    const h = makeHabit({
      createdISO: '2026-06-13',
      log: {
        '2026-06-15': { xp: 0, frozen: true },
        '2026-06-14': { xp: 0, frozen: true },
        '2026-06-13': { xp: 0, frozen: true },
      },
    });
    expect(mostRecentMissedScheduledDay(h, '2026-06-15')).toBeUndefined();
  });
  it('does not report today-not-yet-done as a miss', () => {
    // Today (06-15) unlogged, but every prior scheduled day back to createdISO is done.
    const h = makeHabit({ createdISO: '2026-06-13', log: logFrom(['2026-06-14', '2026-06-13']) });
    expect(mostRecentMissedScheduledDay(h, '2026-06-15')).toBeUndefined();
  });
});

describe('resolveCompletion', () => {
  it('first completion gives base XP, no recovery', () => {
    const r = resolveCompletion(makeHabit(), '2026-06-13');
    expect(r.xp).toBe(20);
    expect(r.recovery).toBe(false);
  });
  it('returning after a missed day grants +10% recovery (day-scheduled only)', () => {
    const h = makeHabit({ lastCompletedISO: '2026-06-10' });
    const r = resolveCompletion(h, '2026-06-13');
    expect(r.recovery).toBe(true);
    expect(r.xp).toBe(22);
  });
  it('as_needed never triggers a recovery penalty/bonus', () => {
    const h = makeHabit({ frequency: 'as_needed', lastCompletedISO: '2026-06-01' });
    expect(resolveCompletion(h, '2026-06-13').recovery).toBe(false);
  });
  it('a custom Mon/Wed/Fri habit with no missed scheduled day gets NO recovery (HABIT-05)', () => {
    // Wed 2026-06-10 → Fri 2026-06-12: gap is 2 calendar days but Thursday isn't scheduled, so
    // nothing was actually missed. The old `gap > 1` test wrongly handed this a permanent 1.1×.
    const h = makeHabit({
      frequency: 'custom',
      days: [1, 3, 5],
      createdISO: '2026-06-01',
      log: { '2026-06-10': { xp: 20 } },
      lastCompletedISO: '2026-06-10',
    });
    const r = resolveCompletion(h, '2026-06-12');
    expect(r.recovery).toBe(false);
    expect(r.xp).toBe(20); // base, no bonus
  });
  it('a custom Mon/Wed/Fri habit that actually skipped a scheduled day DOES recover (HABIT-05)', () => {
    // Completed Mon 2026-06-08, skipped Wed 2026-06-10, returning Fri 2026-06-12 → genuine miss.
    const h = makeHabit({
      frequency: 'custom',
      days: [1, 3, 5],
      createdISO: '2026-06-01',
      log: { '2026-06-08': { xp: 20 } },
      lastCompletedISO: '2026-06-08',
    });
    const r = resolveCompletion(h, '2026-06-12');
    expect(r.recovery).toBe(true);
    expect(r.xp).toBe(22);
  });
  it('uncapped quantity scales XP past 150%', () => {
    const h = makeHabit({ type: 'quantity', target: 3, uncapped: true });
    // 9 / 3 = 3.0 ratio < UNCAPPED_RATIO_CAP (10), so 20 * 3 = 60 (no cap hit here).
    expect(resolveCompletion(h, '2026-06-13', { actual: 9 }).xp).toBe(60);
  });

  it('uncapped quantity XP stops scaling past 10× target', () => {
    const h = makeHabit({ type: 'quantity', target: 1, uncapped: true });
    // 100 / 1 = 100 ratio, but capped at UNCAPPED_RATIO_CAP (10) → 20 * 10 = 200.
    expect(resolveCompletion(h, '2026-06-13', { actual: 100 }).xp).toBe(200);
    // Logging 10,000 gives the same result (cap is a hard ceiling).
    expect(resolveCompletion(h, '2026-06-13', { actual: 10000 }).xp).toBe(200);
  });
});

describe('statCompletedWithin (Stage 4.4)', () => {
  const today = '2026-06-20';

  it('returns true when a habit of the stat was logged today', () => {
    const h = makeHabit({ stat: 'DX', log: { [today]: { xp: 20 } }, lastCompletedISO: today });
    expect(statCompletedWithin([h], 'DX', today, 7)).toBe(true);
  });

  it('returns true when a habit was logged within the window (6 days ago)', () => {
    const sixDaysAgo = '2026-06-14';
    const h = makeHabit({ stat: 'KN', log: { [sixDaysAgo]: { xp: 20 } }, lastCompletedISO: sixDaysAgo });
    expect(statCompletedWithin([h], 'KN', today, 7)).toBe(true);
  });

  it('returns false when the only completion is 8 days ago (outside 7-day window)', () => {
    const eightDaysAgo = '2026-06-12';
    const h = makeHabit({ stat: 'ST', log: { [eightDaysAgo]: { xp: 20 } }, lastCompletedISO: eightDaysAgo });
    expect(statCompletedWithin([h], 'ST', today, 7)).toBe(false);
  });

  it('returns false when the habit has a different stat', () => {
    const h = makeHabit({ stat: 'WI', log: { [today]: { xp: 20 } }, lastCompletedISO: today });
    expect(statCompletedWithin([h], 'DX', today, 7)).toBe(false);
  });

  it('returns false for an empty habit list', () => {
    expect(statCompletedWithin([], 'DX', today, 7)).toBe(false);
  });

  it('finds the qualifying habit via full log scan when lastCompletedISO is absent', () => {
    // A habit with a log entry but no cached lastCompletedISO (edge case for old saves).
    const threeDaysAgo = '2026-06-17';
    const h = makeHabit({ stat: 'AG', log: { [threeDaysAgo]: { xp: 20 } } });
    // lastCompletedISO is undefined on the base makeHabit, so this tests the log-scan path.
    expect(statCompletedWithin([h], 'AG', today, 7)).toBe(true);
  });
});

describe('streakMilestone', () => {
  it('returns a reward at 7 / 30 / 100 days', () => {
    expect(streakMilestone(7)).toEqual({ days: 7, gold: 25, freezes: 0 });
    expect(streakMilestone(30)).toEqual({ days: 30, gold: 100, freezes: 1 });
    expect(streakMilestone(100)).toEqual({ days: 100, gold: 500, freezes: 1 });
  });

  it('returns null for non-milestone streaks (incl. 0, 6, 8, 29, 31, 99, 101)', () => {
    for (const n of [0, 1, 6, 8, 29, 31, 99, 101, 200]) {
      expect(streakMilestone(n)).toBeNull();
    }
  });
});
