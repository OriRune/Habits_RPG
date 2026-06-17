// Ancient Library trial engine (pure, no React).
// Simon-style glyph memory: a sequence is shown, then the player repeats it.
// Each round adds one glyph; the trial ends when the player makes a mistake or finishes all rounds.

/** The glyph symbols used in the sequence. */
export const GLYPHS = ['🔥', '💧', '🌿', '⚡', '🌙', '⭐'] as const;
export type Glyph = (typeof GLYPHS)[number];

export const LIBRARY_START_LENGTH = 3;
export const LIBRARY_MAX_ROUNDS = 6; // lengths 3, 4, 5, 6, 7, 8

/** Generate a master glyph sequence of the maximum length (deterministic). */
export function generateSequence(rng: () => number): Glyph[] {
  const maxLen = LIBRARY_START_LENGTH + LIBRARY_MAX_ROUNDS - 1;
  return Array.from({ length: maxLen }, () => GLYPHS[Math.floor(rng() * GLYPHS.length)]);
}

/**
 * Score = rounds completed / max rounds.
 * Rounds = 0 means the player failed on the very first input.
 */
export function libraryScore(roundsCompleted: number): number {
  return Math.min(1, roundsCompleted / LIBRARY_MAX_ROUNDS);
}
