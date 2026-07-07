// Lockpicking trial engine — Skyrim-style (pure, no React).
// Player rotates a pick across a 180° semicircle to find a hidden sweet spot,
// then applies torque. The cylinder turns proportionally to how close the pick
// is to the sweet spot. Sustained torque against a jam snaps the pick.

export const NUM_LOCKS = 3;
export const PICK_BUDGET = 6;

export const PICK_MIN_DEG = 0;
export const PICK_MAX_DEG = 180;
export const CYLINDER_OPEN_DEG = 90;

/** Lock difficulty labels — index matches lock order. */
export const LOCK_LABELS = ['Novice', 'Apprentice', 'Adept'] as const;

/** Base tolerance (°) per lock — the half-width of the "turn zone". Narrows each lock. */
export const BASE_TOLERANCE_DEG = [22, 16, 11] as const;
/** Must be within this many degrees of the sweet spot for the cylinder to reach 90° (open). */
export const BASE_OPEN_TOLERANCE_DEG = [7, 5, 3.5] as const;

/** Added to tolerance (°) per character level — higher level = more forgiving. */
export const LEVEL_TOLERANCE_BONUS = 0.6;
/** Open-tolerance gets a smaller share of the level bonus. */
export const LEVEL_OPEN_TOLERANCE_BONUS = 0.2;

/** Added to tolerance (°) per DX stat level — trains the relevant stat. */
export const LEVEL_DX_TOLERANCE_BONUS = 0.3;
export const LEVEL_DX_OPEN_BONUS = 0.1;

/** Speed at which the cylinder rotates (°/sec). */
export const CYLINDER_TURN_SPEED = 180;
/** Speed at which the cylinder springs back to 0 when torque is released (°/sec). */
export const CYLINDER_RETURN_SPEED = 240;

/** Pick rotation speed when driven by keyboard (°/sec). */
export const PICK_KEY_SPEED = 90;

/**
 * Minimum seconds before a sustained jam snaps the pick, per lock difficulty.
 * Harder locks get a slightly longer floor so players can react before snapping.
 */
export const BREAK_TIME_MIN_PER_LOCK = [0.55, 0.65, 0.80] as const;

/**
 * Maximum seconds before snap — at the sweet spot edge (almost turning).
 * Shared across all locks because the near-sweet-spot experience should feel consistent.
 */
export const BREAK_TIME_MAX = 3.5;

/** Max shake offset (px) applied on a jam frame. */
export const SHAKE_AMPLITUDE = 6;

export interface LockConfig {
  sweetSpotDeg: number;
  toleranceDeg: number;
  openToleranceDeg: number;
}

/** Compute per-lock tolerance values, widened by character level and DX stat level. */
export function lockTolerance(
  lockIndex: number,
  level: number,
  dxLevel = 0,
): { toleranceDeg: number; openToleranceDeg: number } {
  const bonus     = Math.max(0, level - 1) * LEVEL_TOLERANCE_BONUS;
  const openBonus = Math.max(0, level - 1) * LEVEL_OPEN_TOLERANCE_BONUS;
  const dxBonus     = dxLevel * LEVEL_DX_TOLERANCE_BONUS;
  const dxOpenBonus = dxLevel * LEVEL_DX_OPEN_BONUS;
  // Cap at 2× base (MINI-15) — uncapped bonuses trend late-game locks toward an
  // auto-3★ (near-full-arc tolerance); the cap keeps them challenging.
  return {
    toleranceDeg:     Math.min(BASE_TOLERANCE_DEG[lockIndex]      + bonus     + dxBonus,     2 * BASE_TOLERANCE_DEG[lockIndex]),
    openToleranceDeg: Math.min(BASE_OPEN_TOLERANCE_DEG[lockIndex] + openBonus + dxOpenBonus, 2 * BASE_OPEN_TOLERANCE_DEG[lockIndex]),
  };
}

/** Generate NUM_LOCKS configs. Sweet spots randomised, always reachable. */
export function generateLocks(rng: () => number, level: number, dxLevel = 0): LockConfig[] {
  return Array.from({ length: NUM_LOCKS }, (_, i) => {
    const { toleranceDeg, openToleranceDeg } = lockTolerance(i, level, dxLevel);
    const margin = 20; // keep sweet spot away from hard edges
    const sweetSpotDeg = margin + rng() * (PICK_MAX_DEG - 2 * margin);
    return { sweetSpotDeg, toleranceDeg, openToleranceDeg };
  });
}

/**
 * Fraction (0..1) of the full cylinder turn the player can achieve.
 * 1.0 when within openToleranceDeg; linear falloff to 0 at toleranceDeg.
 */
export function allowedTurn(pickDeg: number, lock: LockConfig): number {
  const d = Math.abs(pickDeg - lock.sweetSpotDeg);
  if (d <= lock.openToleranceDeg) return 1;
  if (d >= lock.toleranceDeg) return 0;
  return 1 - (d - lock.openToleranceDeg) / (lock.toleranceDeg - lock.openToleranceDeg);
}

/** True when the pick is close enough to the sweet spot to fully open the lock. */
export function canOpen(pickDeg: number, lock: LockConfig): boolean {
  return Math.abs(pickDeg - lock.sweetSpotDeg) <= lock.openToleranceDeg;
}

/**
 * Seconds of sustained torque-against-jam before the pick snaps.
 * Closer to the sweet spot → more time (cylinder almost turns, so less stress).
 * Harder locks get a higher minimum so players have time to react.
 */
export function breakTime(pickDeg: number, lock: LockConfig, lockIndex: number): number {
  const turn = allowedTurn(pickDeg, lock);
  const min  = BREAK_TIME_MIN_PER_LOCK[lockIndex];
  return min + turn * (BREAK_TIME_MAX - min);
}

/**
 * Final score (0..1).
 * All locks opened → [0.5, 1.0] linear on picks remaining.
 * Failed (out of picks mid-run) → up to 0.3 based on locks completed.
 */
export function lockpickingScore(
  locksOpened: number,
  picksRemaining: number,
  budget: number = PICK_BUDGET,
): number {
  if (locksOpened >= NUM_LOCKS) {
    return 0.5 + 0.5 * picksRemaining / budget;
  }
  return 0.3 * (locksOpened / NUM_LOCKS);
}
