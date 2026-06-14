import { describe, it, expect } from 'vitest';
import {
  allocateStatGains,
  emptyStatLevels,
  statLevelsFromXp,
  POINTS_PER_LEVEL,
  STAT_CAP,
  BASE_STAT_LEVEL,
} from '../progression';
import { STAT_IDS, emptyStatXP, type StatId } from '../stats';

const sum = (r: Record<StatId, number>) => STAT_IDS.reduce((a, s) => a + r[s], 0);

describe('emptyStatLevels', () => {
  it('starts every stat at the base level', () => {
    const lv = emptyStatLevels();
    for (const s of STAT_IDS) expect(lv[s]).toBe(BASE_STAT_LEVEL);
  });
});

describe('statLevelsFromXp (migration)', () => {
  it('maps XP through the old sqrt curve, floored at base and clamped to the cap', () => {
    const xp = { ...emptyStatXP(), ST: 100, WI: 9, KN: 1_000_000 };
    const lv = statLevelsFromXp(xp);
    expect(lv.ST).toBe(10); // sqrt(100)
    expect(lv.WI).toBe(3); // sqrt(9)
    expect(lv.KN).toBe(STAT_CAP); // clamped
    expect(lv.AG).toBe(BASE_STAT_LEVEL); // untrained -> base, not 0
  });
});

describe('allocateStatGains', () => {
  it('grants exactly the pool when nothing is capped', () => {
    const delta = { ...emptyStatXP(), ST: 80, EN: 40 };
    const gains = allocateStatGains(POINTS_PER_LEVEL, delta, emptyStatLevels(), []);
    expect(sum(gains)).toBe(POINTS_PER_LEVEL);
  });

  it('weights points toward the most-trained stats', () => {
    const delta = { ...emptyStatXP(), ST: 300, WI: 20 };
    const gains = allocateStatGains(POINTS_PER_LEVEL, delta, emptyStatLevels(), []);
    expect(gains.ST).toBeGreaterThan(gains.WI);
    expect(gains.ST).toBeGreaterThanOrEqual(2);
  });

  it('spreads a pool across multiple trained stats rather than dumping all into one', () => {
    const delta = { ...emptyStatXP(), ST: 100, DX: 100, EN: 100 };
    const gains = allocateStatGains(POINTS_PER_LEVEL, delta, emptyStatLevels(), []);
    // Three equally-trained stats, three points -> one each.
    expect(gains.ST).toBe(1);
    expect(gains.DX).toBe(1);
    expect(gains.EN).toBe(1);
  });

  it('nudges toward class-favored stats when effort is otherwise spread', () => {
    const even = STAT_IDS.reduce((acc, s) => {
      acc[s] = 50;
      return acc;
    }, {} as Record<StatId, number>);
    const gains = allocateStatGains(POINTS_PER_LEVEL, even, emptyStatLevels(), ['KN', 'WI']);
    expect(gains.KN + gains.WI).toBeGreaterThan(0);
  });

  it('falls back to HP when there is no recent effort and no class', () => {
    const gains = allocateStatGains(POINTS_PER_LEVEL, emptyStatXP(), emptyStatLevels(), []);
    expect(gains.HP).toBe(POINTS_PER_LEVEL);
  });

  it('falls back to class stats when there is no recent effort', () => {
    const gains = allocateStatGains(POINTS_PER_LEVEL, emptyStatXP(), emptyStatLevels(), ['CH']);
    expect(gains.CH).toBe(POINTS_PER_LEVEL);
  });

  it('never pushes a stat past the cap and skips capped stats', () => {
    const current = { ...emptyStatLevels(), ST: STAT_CAP - 1 };
    const delta = { ...emptyStatXP(), ST: 1000 }; // wants to dump everything into ST
    const gains = allocateStatGains(POINTS_PER_LEVEL, delta, current, []);
    expect(current.ST + gains.ST).toBeLessThanOrEqual(STAT_CAP);
    expect(gains.ST).toBe(1); // only room for one more
  });

  it('stops granting when every eligible stat is capped', () => {
    const current = STAT_IDS.reduce((acc, s) => {
      acc[s] = STAT_CAP;
      return acc;
    }, {} as Record<StatId, number>);
    const gains = allocateStatGains(POINTS_PER_LEVEL, { ...emptyStatXP(), ST: 100 }, current, []);
    expect(sum(gains)).toBe(0);
  });
});
