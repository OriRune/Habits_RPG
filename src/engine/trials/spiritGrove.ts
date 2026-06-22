// Spirit Grove trial engine — pure, no React/store.
// WI (Wisdom) trial: draft 5 rounds from the pool, shuffle choices, check answers, score.

import type { SpiritGroveRound } from '@/content/trials';
import { SPIRIT_GROVE_ROUND_COUNT } from '@/content/trials';
import type { RNG } from '@/engine/crawl';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PreparedRound {
  round: SpiritGroveRound;
  /** displayOrder[displayPos] = originalChoiceIndex — shuffled once per session. */
  displayOrder: number[];
}

export interface RoundResult {
  correct: boolean;
  /** Display-position index the player clicked (maps back via displayOrder). */
  chosenDisplay: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle with injectable RNG (default: Math.random).
 * Returns a new array — does not mutate the input.
 */
export function fisherYatesShuffle<T>(arr: T[], rng: RNG = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Draft and prepare rounds for a Spirit Grove session.
 *
 * Draws 1 easy + 2 medium + 2 hard from the pool, padding with extras if any tier
 * is short. Each round gets a shuffled displayOrder so choices appear in a random
 * order each time.
 *
 * @param pool - The full round pool (typically SPIRIT_GROVE_ROUNDS from content).
 * @param rng  - Random source. Defaults to Math.random (pass a seeded generator for tests).
 */
export function prepareRounds(
  pool: SpiritGroveRound[],
  rng: RNG = Math.random,
): PreparedRound[] {
  const byDiff = (d: SpiritGroveRound['difficulty']) =>
    fisherYatesShuffle(pool.filter((r) => r.difficulty === d), rng);

  // Draw 1 easy + 2 medium + 2 hard, then pad if any tier is short.
  const selected: SpiritGroveRound[] = [
    ...byDiff('easy').slice(0, 1),
    ...byDiff('medium').slice(0, 2),
    ...byDiff('hard').slice(0, 2),
  ];
  if (selected.length < SPIRIT_GROVE_ROUND_COUNT) {
    const used = new Set(selected);
    const extras = fisherYatesShuffle(pool.filter((r) => !used.has(r)), rng);
    selected.push(...extras.slice(0, SPIRIT_GROVE_ROUND_COUNT - selected.length));
  }

  // Attach a shuffled choice display order to each round.
  return selected.slice(0, SPIRIT_GROVE_ROUND_COUNT).map((round) => ({
    round,
    displayOrder: fisherYatesShuffle(round.choices.map((_, i) => i), rng),
  }));
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Normalised 0–1 score for a Spirit Grove session.
 * Returns 0 when totalRounds is 0 (guard for empty pools in tests).
 */
export function spiritGroveScore(correctCount: number, totalRounds: number): number {
  if (totalRounds === 0) return 0;
  return correctCount / totalRounds;
}

// ── Validation (DEV only) ────────────────────────────────────────────────────

/**
 * Validate that every round in the pool has a correctIndex within its choices array.
 * Throws an Error for the first invalid round (intended for DEV-mode assertions only).
 */
export function validateSpiritGroveRounds(pool: SpiritGroveRound[]): void {
  for (const r of pool) {
    if (r.correctIndex >= r.choices.length) {
      throw new Error(
        `Spirit Grove: correctIndex ${r.correctIndex} out of range — "${r.omen.slice(0, 40)}…"`,
      );
    }
  }
}
