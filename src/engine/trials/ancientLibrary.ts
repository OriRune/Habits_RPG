// Ancient Library trial engine (pure, no React).
// Simon-style glyph memory: a sequence is shown, then the player repeats it.
// Each round adds one glyph; the trial ends when the player makes a mistake or finishes all rounds.

/** The glyph symbols used in the sequence. */
export const GLYPHS = ['🔥', '💧', '🌿', '⚡', '🌙', '⭐'] as const;
export type Glyph = (typeof GLYPHS)[number];

export const LIBRARY_START_LENGTH = 2; // gentler warm-up: first round shows 2 glyphs
export const LIBRARY_MAX_ROUNDS   = 7; // lengths 2–8; max sequence length unchanged at 8

// ── Timing constants ───────────────────────────────────────────────────────────
/** ms to display each glyph in round 1 (slows the show phase in early rounds). */
export const GLYPH_SHOW_MS_BASE   = 700;
/** ms to display each glyph in the final round (linearly interpolated). */
export const GLYPH_SHOW_MS_MIN    = 500;
/** Pause after the last glyph before the input phase begins. */
export const PRE_INPUT_PAUSE_MS   = 400;
/** Duration of the ✅ flash after a successful round. */
export const CORRECT_FLASH_MS     = 800;
/** Delay before the next round starts after a correct flash. */
export const NEXT_ROUND_DELAY_MS  = 900;
/** Duration of the ❌ flash before finishing or retrying. */
export const WRONG_FLASH_MS       = 1000;
/** Duration of the tap-flash highlight on a glyph button. */
export const TAP_FLASH_MS         = 150;

/** Display speed (ms/glyph) for a given round, linearly interpolated. */
export function glyphShowMs(round: number): number {
  const t = Math.min(1, round / Math.max(1, LIBRARY_MAX_ROUNDS - 1));
  return Math.round(GLYPH_SHOW_MS_BASE - t * (GLYPH_SHOW_MS_BASE - GLYPH_SHOW_MS_MIN));
}

// ── Audio ─────────────────────────────────────────────────────────────────────
/** Pentatonic tone frequency (Hz) for each glyph — C5 D5 E5 G5 A5 C6. */
export const GLYPH_TONES: Record<Glyph, number> = {
  '🔥': 523,
  '💧': 587,
  '🌿': 659,
  '⚡': 784,
  '🌙': 880,
  '⭐': 1047,
};

// ── Thematic glyph colours (HSL, for button tinting) ─────────────────────────
export const GLYPH_COLORS: Record<Glyph, string> = {
  '🔥': '#f97316',
  '💧': '#60a5fa',
  '🌿': '#4ade80',
  '⚡': '#facc15',
  '🌙': '#c084fc',
  '⭐': '#fde68a',
};

// ── KN stat integration ───────────────────────────────────────────────────────
/** KN stat level that unlocks a first double-flash hint per round. */
export const KN_HINT_THRESHOLD   = 5;
/** KN stat level that unlocks a second double-flash hint per round. */
export const KN_HINT_THRESHOLD_2 = 10;

/**
 * Build the show schedule for one round.
 *
 * Normally returns [0, 1, 2, …sequenceLength-1]. With KN stat hints, one or two
 * positions from the back half are repeated consecutively ("double-flashed") so
 * the player gets an extra look at the harder-to-remember positions.
 */
export function buildShowSchedule(
  sequenceLength: number,
  knLevel: number,
  rng: () => number,
): number[] {
  const schedule: number[] = Array.from({ length: sequenceLength }, (_, i) => i);
  const hintCount =
    knLevel >= KN_HINT_THRESHOLD_2 ? 2 :
    knLevel >= KN_HINT_THRESHOLD   ? 1 : 0;

  // Need at least 3 positions for a meaningful back-half hint
  if (hintCount === 0 || sequenceLength < 3) return schedule;

  const midpoint = Math.floor(sequenceLength / 2);
  const picked = new Set<number>();

  for (let h = 0; h < hintCount; h++) {
    const candidates = Array.from({ length: sequenceLength }, (_, i) => i)
      .filter(i => i >= midpoint && !picked.has(i));
    if (candidates.length === 0) break;
    const pos = candidates[Math.floor(rng() * candidates.length)];
    picked.add(pos);
    // Insert a duplicate immediately after the first occurrence
    const insertAt = schedule.indexOf(pos) + 1;
    schedule.splice(insertAt, 0, pos);
  }
  return schedule;
}

// ── Deterministic RNG helpers ─────────────────────────────────────────────────
/** Simple LCG; inject a positive integer seed for a reproducible sequence. */
export function seededRng(seed = 42): () => number {
  let s = seed >>> 0; // coerce to uint32
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

/** Convert a YYYY-MM-DD ISO date string to a stable numeric seed. */
export function dailySeed(isoDate: string): number {
  return parseInt(isoDate.replace(/-/g, ''), 10);
}

// ── Sequence generation ───────────────────────────────────────────────────────
/** Generate a master glyph sequence of the maximum length (deterministic). */
export function generateSequence(rng: () => number): Glyph[] {
  const maxLen = LIBRARY_START_LENGTH + LIBRARY_MAX_ROUNDS - 1;
  return Array.from({ length: maxLen }, () => GLYPHS[Math.floor(rng() * GLYPHS.length)]);
}

// ── Scoring ───────────────────────────────────────────────────────────────────
/**
 * Score = rounds completed / max rounds.
 * Rounds = 0 means the player failed on the very first input.
 */
export function libraryScore(roundsCompleted: number): number {
  return Math.min(1, roundsCompleted / LIBRARY_MAX_ROUNDS);
}
