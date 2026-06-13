import { describe, it, expect } from 'vitest';
import { resolveCompletion, isDueOn, type Habit } from '../habits';

function makeHabit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Read',
    stat: 'KN',
    type: 'binary',
    frequency: 'daily',
    difficulty: 'normal',
    streak: 0,
    createdISO: '2026-06-01',
    ...over,
  };
}

describe('isDueOn', () => {
  it('daily is always due', () => {
    expect(isDueOn(makeHabit(), '2026-06-13')).toBe(true);
  });
  it('weekdays is not due on weekends', () => {
    const h = makeHabit({ frequency: 'weekdays' });
    expect(isDueOn(h, '2026-06-13')).toBe(false); // Saturday
    expect(isDueOn(h, '2026-06-15')).toBe(true); // Monday
  });
  it('custom uses the days list', () => {
    const h = makeHabit({ frequency: 'custom', days: [1, 3, 5] });
    expect(isDueOn(h, '2026-06-15')).toBe(true); // Monday
    expect(isDueOn(h, '2026-06-16')).toBe(false); // Tuesday
  });
});

describe('resolveCompletion', () => {
  it('first completion gives base XP and streak 1', () => {
    const r = resolveCompletion(makeHabit(), '2026-06-13');
    expect(r.xp).toBe(20);
    expect(r.recovery).toBe(false);
    expect(r.newStreak).toBe(1);
  });

  it('consecutive day continues the streak with no recovery', () => {
    const h = makeHabit({ streak: 3, lastCompletedISO: '2026-06-12' });
    const r = resolveCompletion(h, '2026-06-13');
    expect(r.newStreak).toBe(4);
    expect(r.recovery).toBe(false);
    expect(r.xp).toBe(20);
  });

  it('returning after a missed day grants the +10% recovery bonus and resets streak', () => {
    const h = makeHabit({ streak: 5, lastCompletedISO: '2026-06-10' });
    const r = resolveCompletion(h, '2026-06-13');
    expect(r.recovery).toBe(true);
    expect(r.newStreak).toBe(1);
    expect(r.xp).toBe(22); // 20 * 1.1
  });

  it('quantity habit scales XP by completion', () => {
    const h = makeHabit({ type: 'quantity', target: 20 });
    expect(resolveCompletion(h, '2026-06-13', { actual: 10 }).xp).toBe(10);
  });
});
