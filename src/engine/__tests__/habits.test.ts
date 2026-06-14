import { describe, it, expect } from 'vitest';
import {
  resolveCompletion,
  isScheduledOn,
  isLoggableOn,
  effectiveStatus,
  isCompletedOn,
  weekCompletions,
  currentStreak,
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
  it('uncapped quantity scales XP past 150%', () => {
    const h = makeHabit({ type: 'quantity', target: 3, uncapped: true });
    // 9 / 3 = 3.0 ratio, normal base 20 -> 60 (would be capped to 30 if not uncapped)
    expect(resolveCompletion(h, '2026-06-13', { actual: 9 }).xp).toBe(60);
  });
});
