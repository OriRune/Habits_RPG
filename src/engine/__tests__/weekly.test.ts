import { describe, it, expect } from 'vitest';
import type { Habit } from '../habits';
import type { ActiveChallenge } from '../challenges';
import { weekKey } from '../date';
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
