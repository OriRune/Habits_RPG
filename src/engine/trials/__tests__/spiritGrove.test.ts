// Tests for src/engine/trials/spiritGrove.ts — pure draft/shuffle/score/validate.
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '@/engine/rng';
import {
  fisherYatesShuffle,
  prepareRounds,
  spiritGroveScore,
  validateSpiritGroveRounds,
  type PreparedRound,
} from '../spiritGrove';
import type { SpiritGroveRound } from '@/content/trials';
import { SPIRIT_GROVE_ROUND_COUNT } from '@/content/trials';

// ── Test-pool helpers ─────────────────────────────────────────────────────────

function makeRound(
  difficulty: SpiritGroveRound['difficulty'],
  label: string,
  choiceCount = 3,
): SpiritGroveRound {
  return {
    omen: `omen-${label}`,
    choices: Array.from({ length: choiceCount }, (_, i) => ({ label: `${label}-choice-${i}` })),
    correctIndex: 0,
    difficulty,
  };
}

/** Full pool: 5 easy, 5 medium, 5 hard — mirrors the production SPIRIT_GROVE_ROUNDS shape. */
const FULL_POOL: SpiritGroveRound[] = [
  ...Array.from({ length: 5 }, (_, i) => makeRound('easy', `e${i}`)),
  ...Array.from({ length: 5 }, (_, i) => makeRound('medium', `m${i}`)),
  ...Array.from({ length: 5 }, (_, i) => makeRound('hard', `h${i}`)),
];

// ── fisherYatesShuffle ────────────────────────────────────────────────────────

describe('fisherYatesShuffle', () => {
  it('returns an array of the same length', () => {
    const rng = mulberry32(1);
    expect(fisherYatesShuffle([1, 2, 3, 4, 5], rng)).toHaveLength(5);
  });

  it('contains the same elements as the input', () => {
    const rng = mulberry32(42);
    const input = [1, 2, 3, 4, 5, 6];
    const result = fisherYatesShuffle(input, rng);
    expect(result.sort()).toEqual([...input].sort());
  });

  it('does not mutate the input array', () => {
    const rng = mulberry32(7);
    const input = [10, 20, 30];
    fisherYatesShuffle(input, rng);
    expect(input).toEqual([10, 20, 30]);
  });

  it('produces deterministic output under a fixed seed', () => {
    const result1 = fisherYatesShuffle([0, 1, 2, 3, 4], mulberry32(999));
    const result2 = fisherYatesShuffle([0, 1, 2, 3, 4], mulberry32(999));
    expect(result1).toEqual(result2);
  });
});

// ── prepareRounds ─────────────────────────────────────────────────────────────

describe('prepareRounds', () => {
  it('returns exactly SPIRIT_GROVE_ROUND_COUNT rounds', () => {
    const prepared = prepareRounds(FULL_POOL, mulberry32(1));
    expect(prepared).toHaveLength(SPIRIT_GROVE_ROUND_COUNT);
  });

  it('drafts 1 easy, 2 medium, 2 hard from a full pool', () => {
    const prepared = prepareRounds(FULL_POOL, mulberry32(1));
    const diffs = prepared.map((p) => p.round.difficulty);
    expect(diffs.filter((d) => d === 'easy')).toHaveLength(1);
    expect(diffs.filter((d) => d === 'medium')).toHaveLength(2);
    expect(diffs.filter((d) => d === 'hard')).toHaveLength(2);
  });

  it('pads with extras when a tier is short (only 1 hard round available)', () => {
    const shortPool: SpiritGroveRound[] = [
      makeRound('easy', 'e0'),
      makeRound('easy', 'e1'),
      makeRound('medium', 'm0'),
      makeRound('medium', 'm1'),
      makeRound('hard', 'h0'), // only 1 hard — need 2, so 1 padding round is drawn
    ];
    const prepared = prepareRounds(shortPool, mulberry32(1));
    expect(prepared).toHaveLength(SPIRIT_GROVE_ROUND_COUNT);
    // All selected rounds come from the pool.
    for (const p of prepared) {
      expect(shortPool).toContain(p.round);
    }
  });

  it('no duplicate rounds in a single session', () => {
    const prepared = prepareRounds(FULL_POOL, mulberry32(1));
    const ids = prepared.map((p) => p.round.omen);
    expect(new Set(ids).size).toBe(SPIRIT_GROVE_ROUND_COUNT);
  });

  it('displayOrder is a valid permutation of choice indices', () => {
    const prepared = prepareRounds(FULL_POOL, mulberry32(1));
    for (const p of prepared) {
      const expected = p.round.choices.map((_, i) => i).sort();
      expect([...p.displayOrder].sort()).toEqual(expected);
    }
  });

  it('produces identical results from the same seed', () => {
    const a = prepareRounds(FULL_POOL, mulberry32(42));
    const b = prepareRounds(FULL_POOL, mulberry32(42));
    const toOmens = (ps: PreparedRound[]) => ps.map((p) => p.round.omen);
    expect(toOmens(a)).toEqual(toOmens(b));
  });

  it('produces different orderings from different seeds (probabilistic)', () => {
    const a = prepareRounds(FULL_POOL, mulberry32(1));
    const b = prepareRounds(FULL_POOL, mulberry32(12345));
    // Extremely unlikely that two independent seeds produce the exact same ordering.
    const aOmens = a.map((p) => p.round.omen).join(',');
    const bOmens = b.map((p) => p.round.omen).join(',');
    expect(aOmens).not.toBe(bOmens);
  });
});

// ── spiritGroveScore ──────────────────────────────────────────────────────────

describe('spiritGroveScore', () => {
  it('returns 0 when totalRounds is 0 (zero-total guard)', () => {
    expect(spiritGroveScore(0, 0)).toBe(0);
  });

  it('returns 0 for all wrong', () => {
    expect(spiritGroveScore(0, 5)).toBe(0);
  });

  it('returns 1 for a perfect score', () => {
    expect(spiritGroveScore(5, 5)).toBe(1);
  });

  it('returns 0.6 for 3 out of 5', () => {
    expect(spiritGroveScore(3, 5)).toBeCloseTo(0.6);
  });
});

// ── validateSpiritGroveRounds ────────────────────────────────────────────────

describe('validateSpiritGroveRounds', () => {
  it('does not throw for a valid pool', () => {
    expect(() => validateSpiritGroveRounds(FULL_POOL)).not.toThrow();
  });

  it('throws when a round has correctIndex >= choices.length', () => {
    const badPool: SpiritGroveRound[] = [
      {
        omen: 'bad omen',
        choices: [{ label: 'only one' }],
        correctIndex: 1, // out of range for a 1-element choices array
        difficulty: 'easy',
      },
    ];
    expect(() => validateSpiritGroveRounds(badPool)).toThrow(/correctIndex 1 out of range/);
  });

  it('includes the round omen in the error message', () => {
    const badPool: SpiritGroveRound[] = [
      {
        omen: 'The flame gutters in a windless room',
        choices: [{ label: 'Warmth' }],
        correctIndex: 2,
        difficulty: 'medium',
      },
    ];
    expect(() => validateSpiritGroveRounds(badPool)).toThrow(
      /The flame gutters in a windless room/,
    );
  });
});
