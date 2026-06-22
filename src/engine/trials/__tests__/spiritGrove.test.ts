// Tests for src/engine/trials/spiritGrove.ts — pure draft/shuffle/score/validate.
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '@/engine/rng';
import {
  fisherYatesShuffle,
  prepareRounds,
  spiritGroveScore,
  validateSpiritGroveRounds,
  clueVisible,
  WI_CLUE_NOVICE,
  WI_CLUE_SAGE,
  type PreparedRound,
} from '../spiritGrove';
import type { SpiritGroveRound } from '@/content/trials';
import { SPIRIT_GROVE_ROUND_COUNT, SPIRIT_GROVE_ROUNDS } from '@/content/trials';

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

// ── clueVisible ───────────────────────────────────────────────────────────────

describe('clueVisible', () => {
  const NOVICE = WI_CLUE_NOVICE - 1; // below threshold
  const DEFAULT = WI_CLUE_NOVICE;    // at default threshold
  const SAGE = WI_CLUE_SAGE;         // at sage threshold

  it('novice (WI < 5): shows clues only on easy rounds', () => {
    expect(clueVisible('easy', NOVICE)).toBe(true);
    expect(clueVisible('medium', NOVICE)).toBe(false);
    expect(clueVisible('hard', NOVICE)).toBe(false);
  });

  it('novice at WI=0: all non-easy hidden', () => {
    expect(clueVisible('easy', 0)).toBe(true);
    expect(clueVisible('medium', 0)).toBe(false);
    expect(clueVisible('hard', 0)).toBe(false);
  });

  it('default (WI 5–9): shows clues on easy and medium, hides hard', () => {
    expect(clueVisible('easy', DEFAULT)).toBe(true);
    expect(clueVisible('medium', DEFAULT)).toBe(true);
    expect(clueVisible('hard', DEFAULT)).toBe(false);
    // Also check WI=9 (still below sage)
    expect(clueVisible('easy', WI_CLUE_SAGE - 1)).toBe(true);
    expect(clueVisible('medium', WI_CLUE_SAGE - 1)).toBe(true);
    expect(clueVisible('hard', WI_CLUE_SAGE - 1)).toBe(false);
  });

  it('sage (WI >= 10): all clues always visible', () => {
    expect(clueVisible('easy', SAGE)).toBe(true);
    expect(clueVisible('medium', SAGE)).toBe(true);
    expect(clueVisible('hard', SAGE)).toBe(true);
    // Also check WI well above threshold
    expect(clueVisible('hard', 20)).toBe(true);
  });
});

// ── prepareRounds — harder (mastery) mode ────────────────────────────────────

describe('prepareRounds (harder=true)', () => {
  it('returns exactly SPIRIT_GROVE_ROUND_COUNT rounds', () => {
    const prepared = prepareRounds(FULL_POOL, mulberry32(1), { harder: true });
    expect(prepared).toHaveLength(SPIRIT_GROVE_ROUND_COUNT);
  });

  it('drafts 0 easy, 2 medium, 3 hard from a full pool', () => {
    const prepared = prepareRounds(FULL_POOL, mulberry32(1), { harder: true });
    const diffs = prepared.map((p) => p.round.difficulty);
    expect(diffs.filter((d) => d === 'easy')).toHaveLength(0);
    expect(diffs.filter((d) => d === 'medium')).toHaveLength(2);
    expect(diffs.filter((d) => d === 'hard')).toHaveLength(3);
  });

  it('still pads to SPIRIT_GROVE_ROUND_COUNT when hard tier is short', () => {
    // Only 1 hard round available — needs 3, so 2 padding rounds drawn from the
    // remaining medium rounds. Pool must have at least 5 rounds to fill all 5 slots.
    const tinyPool: SpiritGroveRound[] = [
      makeRound('medium', 'm0'),
      makeRound('medium', 'm1'),
      makeRound('medium', 'm2'),
      makeRound('medium', 'm3'),
      makeRound('hard', 'h0'),
    ];
    const prepared = prepareRounds(tinyPool, mulberry32(7), { harder: true });
    expect(prepared).toHaveLength(SPIRIT_GROVE_ROUND_COUNT);
    for (const p of prepared) {
      expect(tinyPool).toContain(p.round);
    }
  });

  it('has no duplicate rounds', () => {
    const prepared = prepareRounds(FULL_POOL, mulberry32(1), { harder: true });
    const ids = prepared.map((p) => p.round.omen);
    expect(new Set(ids).size).toBe(SPIRIT_GROVE_ROUND_COUNT);
  });
});

// ── Production pool integrity ────────────────────────────────────────────────

describe('SPIRIT_GROVE_ROUNDS production pool', () => {
  it('passes validateSpiritGroveRounds (no out-of-range correctIndex)', () => {
    expect(() => validateSpiritGroveRounds(SPIRIT_GROVE_ROUNDS)).not.toThrow();
  });

  it('every round has exactly 4 choices', () => {
    for (const r of SPIRIT_GROVE_ROUNDS) {
      expect(r.choices).toHaveLength(4);
    }
  });

  it('every round has a non-empty omen and explanation', () => {
    for (const r of SPIRIT_GROVE_ROUNDS) {
      expect(r.omen.trim().length).toBeGreaterThan(0);
      expect(r.explanation?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it('pool has at least 5 rounds per difficulty tier', () => {
    const easy = SPIRIT_GROVE_ROUNDS.filter((r) => r.difficulty === 'easy');
    const medium = SPIRIT_GROVE_ROUNDS.filter((r) => r.difficulty === 'medium');
    const hard = SPIRIT_GROVE_ROUNDS.filter((r) => r.difficulty === 'hard');
    expect(easy.length).toBeGreaterThanOrEqual(5);
    expect(medium.length).toBeGreaterThanOrEqual(5);
    expect(hard.length).toBeGreaterThanOrEqual(5);
  });

  it('can draft a full session from the pool', () => {
    const prepared = prepareRounds(SPIRIT_GROVE_ROUNDS, mulberry32(42));
    expect(prepared).toHaveLength(SPIRIT_GROVE_ROUND_COUNT);
  });

  it('can draft a full mastery session from the pool', () => {
    const prepared = prepareRounds(SPIRIT_GROVE_ROUNDS, mulberry32(99), { harder: true });
    expect(prepared).toHaveLength(SPIRIT_GROVE_ROUND_COUNT);
    const diffs = prepared.map((p) => p.round.difficulty);
    expect(diffs.filter((d) => d === 'easy')).toHaveLength(0);
  });
});
