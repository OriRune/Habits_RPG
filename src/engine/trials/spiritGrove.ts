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

// ── WI clue visibility ────────────────────────────────────────────────────────

/** WI stat level below which clues are hidden on medium and hard rounds. */
export const WI_CLUE_NOVICE = 5;
/** WI stat level at/above which all clues are always visible. */
export const WI_CLUE_SAGE = 10;

/**
 * Whether the choice clues are visible to a player at a given Wisdom stat level.
 *
 * Novice  (WI < 5)       — clues shown only on easy rounds.
 * Default (5 ≤ WI < 10) — clues on easy + medium; hard rounds rely on the omen alone.
 * Sage    (WI ≥ 10)      — full clue access on all difficulties.
 *
 * Note: we gate the *clue* text (contextual hint), never the answer label, so WI
 * cannot reveal the correct choice directly — it only unlocks the grove's guidance.
 * High WI grants clue visibility rather than exposing the explanation pre-click,
 * which would trivialise hard rounds.
 */
export function clueVisible(difficulty: SpiritGroveRound['difficulty'], wi: number): boolean {
  if (wi >= WI_CLUE_SAGE) return true;
  if (wi >= WI_CLUE_NOVICE) return difficulty !== 'hard';
  return difficulty === 'easy';
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

export interface PrepareRoundsOptions {
  /**
   * Mastery mode: skip easy rounds and add an extra hard round (0 easy + 2 medium + 3 hard).
   * Enabled automatically when the player's best Spirit Grove score is 100%.
   */
  harder?: boolean;
}

/**
 * Draft and prepare rounds for a Spirit Grove session.
 *
 * Normal (harder=false):  1 easy + 2 medium + 2 hard.
 * Mastery (harder=true):  0 easy + 2 medium + 3 hard — once the player has
 *   achieved a perfect score, easy rounds are replaced by a third hard round.
 *
 * Any tier that is shorter than the requested count is padded with extras from
 * the remaining pool (other tiers, no duplicates). Each round gets a shuffled
 * displayOrder so choices appear in a different position each session.
 *
 * @param pool - The full round pool (typically SPIRIT_GROVE_ROUNDS from content).
 * @param rng  - Random source. Defaults to Math.random (pass a seeded generator for tests).
 * @param opts - Optional draft configuration.
 */
export function prepareRounds(
  pool: SpiritGroveRound[],
  rng: RNG = Math.random,
  opts: PrepareRoundsOptions = {},
): PreparedRound[] {
  const { harder = false } = opts;
  const byDiff = (d: SpiritGroveRound['difficulty']) =>
    fisherYatesShuffle(pool.filter((r) => r.difficulty === d), rng);

  // Normal: 1 easy + 2 medium + 2 hard.
  // Mastery: 0 easy + 2 medium + 3 hard.
  const selected: SpiritGroveRound[] = harder
    ? [
        ...byDiff('medium').slice(0, 2),
        ...byDiff('hard').slice(0, 3),
      ]
    : [
        ...byDiff('easy').slice(0, 1),
        ...byDiff('medium').slice(0, 2),
        ...byDiff('hard').slice(0, 2),
      ];

  // Pad with extras from the remaining pool if any tier was short.
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
