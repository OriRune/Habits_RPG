// XP calculation for habit completion (design brief Section 3 & 14).
// Pure functions — fully unit tested.

export type Difficulty = 'easy' | 'normal' | 'hard' | 'epic';

/** Base XP by difficulty (brief Section 3: Yes/No XP table). */
export const BASE_XP: Record<Difficulty, number> = {
  easy: 10,
  normal: 20,
  hard: 35,
  epic: 50,
};

/** Completion above this is capped so overachieving can't be exploited (brief: 150%). */
export const COMPLETION_CAP = 1.5;

/**
 * Maximum completion ratio for `uncapped` quantity habits (§4.2 — 10× goal).
 * Allows genuine outlier days (e.g. running 50 km on a 5 km goal) while closing the
 * trivial exploitation path (logging 10,000 against a target of 1).
 */
export const UNCAPPED_RATIO_CAP = 10;

/** Recovery bonus multiplier when a missed habit is completed the next day (brief Section 14). */
export const RECOVERY_BONUS = 1.1;

export function baseXp(difficulty: Difficulty): number {
  return BASE_XP[difficulty];
}

/**
 * Completion ratio for a quantity habit. The capped path clamps at COMPLETION_CAP (150%);
 * the uncapped path clamps at UNCAPPED_RATIO_CAP (10×) to allow outlier days while
 * blocking trivial exploitation. target <= 0 is treated as fully complete (1.0).
 */
export function completionRatio(actual: number, target: number, uncapped = false): number {
  if (target <= 0) return 1;
  if (uncapped) return Math.min(actual / target, UNCAPPED_RATIO_CAP);
  return Math.min(actual / target, COMPLETION_CAP);
}

export interface XpInput {
  difficulty: Difficulty;
  /** 'binary' = full base XP; 'quantity' = scaled by completion. */
  type: 'binary' | 'quantity';
  actual?: number;
  target?: number;
  /** Apply the +10% recovery bonus (missed yesterday, done today). */
  recovery?: boolean;
  /** Quantity only: remove the 150% completion cap so XP scales linearly with amount. */
  uncapped?: boolean;
}

/** Gold awarded on completion by difficulty (§5.3 — keeps habits-only players in the economy). */
export const HABIT_GOLD: Record<Difficulty, number> = { easy: 0, normal: 2, hard: 5, epic: 10 };

/** Gold amount for a single completion at the given difficulty. */
export function habitGold(difficulty: Difficulty): number {
  return HABIT_GOLD[difficulty];
}

/**
 * Final XP for a completion. Quantity habits scale by capped completion %;
 * recovery applies a 10% bonus on top. Rounded to a whole number.
 *
 * Brief examples:
 *   normal, 10/20 pages  -> 20 * 0.5  = 10
 *   normal, 40/20 pages  -> 20 * 1.5  = 30 (capped)
 */
export function computeXp(input: XpInput): number {
  const base = baseXp(input.difficulty);
  const ratio =
    input.type === 'quantity'
      ? completionRatio(input.actual ?? 0, input.target ?? 0, input.uncapped)
      : 1;
  const recovery = input.recovery ? RECOVERY_BONUS : 1;
  return Math.round(base * ratio * recovery);
}
