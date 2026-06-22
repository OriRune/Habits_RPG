import { describe, it, expect } from 'vitest';
import { buildDailySummary, weeklyCompletionRate } from '../dashboard';
import { type Habit } from '../habits';

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
    createdISO: '2026-01-01',
    ...overrides,
  };
}

const BASE_OPTS = {
  currentEnergy: 0,
  minMinigameCost: 1,
  loadWarning: false,
  struggling: false,
};

// ---------------------------------------------------------------------------
// weeklyCompletionRate
// ---------------------------------------------------------------------------

describe('weeklyCompletionRate', () => {
  it('returns 0 when there are no schedulable habits', () => {
    const rate = weeklyCompletionRate([], '2026-06-22');
    expect(rate).toBe(0);
  });

  it('returns 1 when all scheduled days this week are done', () => {
    // Sunday 2026-06-21 to Saturday 2026-06-27; today is Thursday 2026-06-22 (4 days: Sun-Wed done)
    const habit = makeHabit({
      frequency: 'daily',
      log: {
        '2026-06-21': { xp: 20 },
        '2026-06-22': { xp: 20 },
      },
    });
    // only 2 scheduled days in window (Sun + Mon when today=Mon)
    const rate = weeklyCompletionRate([habit], '2026-06-22');
    // Mon is index 1; Sun start of week is 2026-06-21; 2 days: both done
    expect(rate).toBe(1);
  });

  it('excludes as_needed habits', () => {
    const habit = makeHabit({ frequency: 'as_needed', log: {} });
    const rate = weeklyCompletionRate([habit], '2026-06-22');
    expect(rate).toBe(0);
  });

  it('returns partial rate for partial completions', () => {
    // Daily habit, this week (Sun+Mon), only Sun done
    const habit = makeHabit({
      frequency: 'daily',
      log: { '2026-06-21': { xp: 20 } }, // Sun done, Mon not
    });
    const rate = weeklyCompletionRate([habit], '2026-06-22');
    expect(rate).toBe(0.5); // 1 of 2
  });
});

// ---------------------------------------------------------------------------
// buildDailySummary
// ---------------------------------------------------------------------------

describe('buildDailySummary', () => {
  const today = '2026-06-22';

  it('counts completedToday and pendingToday correctly', () => {
    const h1 = makeHabit({ log: { [today]: { xp: 20 } } });
    const h2 = makeHabit({});
    const summary = buildDailySummary([h1, h2], today, BASE_OPTS);
    expect(summary.completedToday).toBe(1);
    expect(summary.pendingToday).toBe(1);
    expect(summary.scheduledToday).toBe(2);
  });

  it('energyEarnedToday matches completions (not pending)', () => {
    const h1 = makeHabit({ log: { [today]: { xp: 20 } } });
    const h2 = makeHabit({ log: { [today]: { xp: 20 } } });
    const h3 = makeHabit({});
    const summary = buildDailySummary([h1, h2, h3], today, BASE_OPTS);
    expect(summary.energyEarnedToday).toBe(2);
  });

  it('does not count retired habits in energyEarnedToday', () => {
    const h = makeHabit({ status: 'retired', log: { [today]: { xp: 20 } } });
    const summary = buildDailySummary([h], today, BASE_OPTS);
    expect(summary.energyEarnedToday).toBe(0);
  });

  it('focusHabits filters to focus=true and active', () => {
    const f = makeHabit({ focus: true });
    const nf = makeHabit({ focus: false });
    const summary = buildDailySummary([f, nf], today, BASE_OPTS);
    expect(summary.focusHabits).toHaveLength(1);
    expect(summary.focusHabits[0].id).toBe(f.id);
  });

  it('pendingFocusHabits excludes already-done focus habits', () => {
    const done = makeHabit({ focus: true, log: { [today]: { xp: 20 } } });
    const pending = makeHabit({ focus: true });
    const summary = buildDailySummary([done, pending], today, BASE_OPTS);
    expect(summary.pendingFocusHabits).toHaveLength(1);
    expect(summary.pendingFocusHabits[0].id).toBe(pending.id);
  });

  it('recommends finish_focus when a focus habit is pending', () => {
    const h = makeHabit({ name: 'Morning Run', focus: true });
    const summary = buildDailySummary([h], today, BASE_OPTS);
    expect(summary.recommendedAction?.kind).toBe('finish_focus');
    expect(summary.recommendedAction?.message).toContain('Morning Run');
  });

  it('recommends start_today when nothing is done yet', () => {
    const h = makeHabit({ name: 'Exercise' });
    const summary = buildDailySummary([h], today, BASE_OPTS);
    expect(summary.recommendedAction?.kind).toBe('start_today');
  });

  it('recommends energy_ready after completions with enough energy', () => {
    const h = makeHabit({ log: { [today]: { xp: 20 } } });
    const summary = buildDailySummary([h], today, {
      ...BASE_OPTS,
      currentEnergy: 3,
      minMinigameCost: 1,
    });
    expect(summary.recommendedAction?.kind).toBe('energy_ready');
  });

  it('recovery is highest priority over focus habits', () => {
    const f = makeHabit({ focus: true });
    const summary = buildDailySummary([f], today, {
      ...BASE_OPTS,
      struggling: true,
    });
    expect(summary.recommendedAction?.kind).toBe('struggling');
  });

  it('topStreaks returns up to 3, sorted descending', () => {
    const h1 = makeHabit({ streak: 10 });
    const h2 = makeHabit({ streak: 5 });
    const h3 = makeHabit({ streak: 7 });
    const h4 = makeHabit({ streak: 2 });
    const summary = buildDailySummary([h1, h2, h3, h4], today, BASE_OPTS);
    expect(summary.topStreaks).toHaveLength(3);
    expect(summary.topStreaks[0].streak).toBe(10);
    expect(summary.topStreaks[1].streak).toBe(7);
    expect(summary.topStreaks[2].streak).toBe(5);
  });
});
