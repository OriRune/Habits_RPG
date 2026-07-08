import { describe, it, expect } from 'vitest';
import {
  resolveCourtCheck,
  courtCheckModifier,
  COURT_DC,
} from '../trials/royalCourt';
import { ROYAL_COURT_EXCHANGES } from '@/content/trials';

/** Pass probability of a gambit at a given CH level: enumerate all 20 d20 rolls. */
function passProbability(chLevel: number, dc: number): number {
  let passes = 0;
  for (let roll = 1; roll <= 20; roll++) {
    if (resolveCourtCheck(roll, chLevel, dc).success) passes++;
  }
  return passes / 20;
}

describe('courtCheckModifier', () => {
  it('returns 0 for CH level 0', () => {
    expect(courtCheckModifier(0)).toBe(0);
  });

  it('is monotonically non-decreasing', () => {
    for (let i = 0; i < 9; i++) {
      expect(courtCheckModifier(i + 1)).toBeGreaterThanOrEqual(courtCheckModifier(i));
    }
  });

  it('matches CH level 1:1', () => {
    expect(courtCheckModifier(5)).toBe(5);
    expect(courtCheckModifier(10)).toBe(10);
  });
});

describe('resolveCourtCheck — natural rules', () => {
  it('natural 20 always succeeds, even against an impossible DC', () => {
    const result = resolveCourtCheck(20, 0, 999);
    expect(result.natural).toBe('crit');
    expect(result.success).toBe(true);
  });

  it('natural 1 always fails, even against a trivial DC with a high modifier', () => {
    const result = resolveCourtCheck(1, 20, 1);
    expect(result.natural).toBe('fumble');
    expect(result.success).toBe(false);
  });
});

describe('resolveCourtCheck — threshold boundary', () => {
  const dc = COURT_DC.medium; // 13

  it('passes when total exactly equals DC', () => {
    // roll 10 + CH 3 = 13 vs DC 13
    const result = resolveCourtCheck(10, 3, dc);
    expect(result.natural).toBeNull();
    expect(result.success).toBe(true);
    expect(result.total).toBe(13);
  });

  it('fails when total is one below DC', () => {
    // roll 9 + CH 3 = 12 vs DC 13
    const result = resolveCourtCheck(9, 3, dc);
    expect(result.natural).toBeNull();
    expect(result.success).toBe(false);
    expect(result.total).toBe(12);
  });

  it('succeeds above DC', () => {
    const result = resolveCourtCheck(15, 0, dc);
    expect(result.success).toBe(true);
  });
});

describe('resolveCourtCheck — modifier is applied', () => {
  it('modifier pushes a roll that would otherwise fail into a pass', () => {
    const dc = COURT_DC.medium; // 13
    // roll 10 alone = 10 < 13 (fail), but 10 + 5 = 15 >= 13 (pass)
    const noMod = resolveCourtCheck(10, 0, dc);
    const withMod = resolveCourtCheck(10, 5, dc);
    expect(noMod.success).toBe(false);
    expect(withMod.success).toBe(true);
  });

  it('result contains the correct roll, modifier, and total', () => {
    const result = resolveCourtCheck(7, 4, 10);
    expect(result.roll).toBe(7);
    expect(result.modifier).toBe(4);
    expect(result.total).toBe(11);
    expect(result.success).toBe(true);
  });
});

describe('COURT_DC constants', () => {
  it('easy < medium < hard', () => {
    expect(COURT_DC.easy).toBeLessThan(COURT_DC.medium);
    expect(COURT_DC.medium).toBeLessThan(COURT_DC.hard);
  });
});

describe('gambit payoffs (MINI-14)', () => {
  // No-dominated-gambit invariant: in every exchange with a check-bearing choice,
  // that gambit's success payoff must strictly beat the best safe (non-check) choice.
  // Non-vacuous: fails against the old Voss/Physician gambits where gambit == safe == 3.
  it('every gambit success favorDelta strictly beats the best safe choice in its exchange', () => {
    for (const exchange of ROYAL_COURT_EXCHANGES) {
      const gambit = exchange.choices.find((c) => c.check);
      if (!gambit) continue;
      const safeMax = Math.max(
        ...exchange.choices.filter((c) => !c.check).map((c) => c.favorDelta),
      );
      expect(
        gambit.favorDelta,
        `${exchange.npc}: gambit ${gambit.favorDelta} must beat safe max ${safeMax}`,
      ).toBeGreaterThan(safeMax);
    }
  });

  // A medium-DC gambit should be a live +EV bet at realistic CH investment (Lv. 6)
  // but a losing bet at CH 0 — demonstrating gambits are a live wager, not free favour.
  it('medium-DC gambit EV exceeds the safe max at CH 6 but not at CH 0', () => {
    // The Court Herald: DC medium (13), gambit success +6 / fail -2, best safe +3.
    const dc = COURT_DC.medium;
    const success = 6;
    const fail = -2;
    const safeMax = 3;

    const ev = (ch: number) => {
      const p = passProbability(ch, dc);
      return p * success + (1 - p) * fail;
    };

    const evHigh = ev(6); // P = 0.7 → 0.7·6 + 0.3·(−2) = 3.6
    const evLow = ev(0);  // P = 0.4 → 0.4·6 + 0.6·(−2) = 1.2

    expect(evHigh).toBeGreaterThan(safeMax);
    expect(evLow).toBeLessThan(safeMax);
  });
});
