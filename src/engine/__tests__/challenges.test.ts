import { describe, it, expect } from 'vitest';
import type { Habit } from '../habits';
import {
  challengeProgress,
  suggestReward,
  rivalGoal,
  resolveChallenge,
  type ChallengeDef,
  type ActiveChallenge,
} from '../challenges';

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

function log(...days: string[]): Habit['log'] {
  return Object.fromEntries(days.map((d) => [d, { xp: 20 }]));
}

const TODAY = '2026-06-10';
const def = (over: Partial<ChallengeDef>): ChallengeDef => ({
  id: 'c',
  name: 'C',
  description: '',
  kind: 'count',
  goal: 5,
  durationDays: 8, // 06-01 .. 06-08
  reward: {},
  ...over,
});

describe('challengeProgress', () => {
  it('count: tallies qualifying completions in the window', () => {
    const habits = [makeHabit({ log: log('2026-06-01', '2026-06-03', '2026-06-05') })];
    expect(challengeProgress(def({ kind: 'count' }), '2026-06-01', habits, TODAY)).toBe(3);
  });

  it('count: ignores completions outside the window', () => {
    const habits = [makeHabit({ log: log('2026-05-30', '2026-06-02') })];
    expect(challengeProgress(def({ kind: 'count' }), '2026-06-01', habits, TODAY)).toBe(1);
  });

  it('quantity: sums logged amounts on quantity habits', () => {
    const habits = [
      makeHabit({
        type: 'quantity',
        log: { '2026-06-01': { xp: 0, amount: 40 }, '2026-06-02': { xp: 0, amount: 60 } },
      }),
    ];
    expect(challengeProgress(def({ kind: 'quantity', goal: 100 }), '2026-06-01', habits, TODAY)).toBe(100);
  });

  it('respects the stat filter', () => {
    const habits = [
      makeHabit({ id: 'a', stat: 'ST', log: log('2026-06-01') }),
      makeHabit({ id: 'b', stat: 'KN', log: log('2026-06-02') }),
    ];
    expect(challengeProgress(def({ kind: 'count', stat: 'KN' }), '2026-06-01', habits, TODAY)).toBe(1);
  });

  it('streak: longest run of consecutive qualifying days', () => {
    const habits = [makeHabit({ log: log('2026-06-01', '2026-06-02', '2026-06-03', '2026-06-05') })];
    expect(challengeProgress(def({ kind: 'streak', goal: 7 }), '2026-06-01', habits, TODAY)).toBe(3);
  });

  it('recovery: counts only comebacks after a missed scheduled day', () => {
    // Completed 06-02 and 06-04; 06-01 and 06-03 missed (daily → scheduled) → 2 comebacks.
    const habits = [makeHabit({ log: log('2026-06-02', '2026-06-04') })];
    expect(challengeProgress(def({ kind: 'recovery', goal: 3 }), '2026-06-01', habits, TODAY)).toBe(2);
  });

  it('class: counts distinct days with a qualifying completion', () => {
    const habits = [
      makeHabit({ id: 'a', stat: 'WI', log: log('2026-06-01', '2026-06-03') }),
      makeHabit({ id: 'b', stat: 'WI', log: log('2026-06-01', '2026-06-04') }), // 06-01 shared
    ];
    expect(challengeProgress(def({ kind: 'class', stat: 'WI', goal: 5 }), '2026-06-01', habits, TODAY)).toBe(3);
  });
});

describe('suggestReward', () => {
  it('scales with difficulty and clamps gold', () => {
    const tiny = suggestReward({ kind: 'count', goal: 1, durationDays: 1 });
    expect(tiny.gold).toBe(20); // clamped to floor
    const big = suggestReward({ kind: 'count', goal: 1000, durationDays: 7 });
    expect(big.gold).toBe(300); // clamped to ceiling
  });

  it('grants stat XP only when a stat is set', () => {
    expect(suggestReward({ kind: 'count', goal: 5, durationDays: 7 }).statXp).toBeUndefined();
    const withStat = suggestReward({ kind: 'count', goal: 5, durationDays: 7, stat: 'ST' });
    expect(withStat.statXp?.ST).toBeGreaterThan(0);
  });
});

describe('rivalGoal', () => {
  it("is last week's qualifying count plus one", () => {
    const habits = [makeHabit({ stat: 'KN', log: log('2026-06-07', '2026-06-09') })];
    expect(rivalGoal('KN', habits, '2026-06-07')).toBe(3); // 2 completions + 1
  });

  it('is at least 1 when last week was empty', () => {
    expect(rivalGoal('KN', [makeHabit()], '2026-06-07')).toBe(1);
  });
});

describe('resolveChallenge', () => {
  it('grants partial reward between the threshold and the goal', () => {
    const active: ActiveChallenge = {
      def: def({ goal: 10, partial: { atRatio: 0.5, reward: { gold: 30 } }, reward: { gold: 100 } }),
      startISO: '2026-06-01',
      progress: 6,
      status: 'active',
    };
    const out = resolveChallenge(active);
    expect(out.met).toBe(false);
    expect(out.partial).toBe(true);
    expect(out.reward?.gold).toBe(30);
  });
});
