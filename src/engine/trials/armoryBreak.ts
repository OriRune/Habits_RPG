// Armory Break trial engine (pure, no React).
// A power needle sweeps from 0 → 1 while the player holds; release in the sweet zone.
// Releasing above or below the zone scores 0 — overshoot is a miss.

export const ARMORY_LOCKS = 3;
/** Width of the sweet spot zone (fraction of the meter 0..1). */
export const SWEET_ZONE_WIDTH = 0.20;
/** Zone lower bound — zone occupies [SWEET_ZONE_START, SWEET_ZONE_END]. */
export const SWEET_ZONE_START = 0.60;
/** Zone upper bound — releasing above this scores 0 (overshoot = miss). */
export const SWEET_ZONE_END = SWEET_ZONE_START + SWEET_ZONE_WIDTH; // 0.80

/**
 * Compute hit accuracy from a release position (0..1).
 * Peak accuracy (1.0) at zone centre; falls to 0 at both edges; 0 outside the zone.
 */
export function armoryAccuracy(releasePos: number): number {
  if (releasePos < SWEET_ZONE_START) return 0;
  if (releasePos > SWEET_ZONE_END) return 0;
  const centre = SWEET_ZONE_START + SWEET_ZONE_WIDTH / 2;
  return 1 - Math.abs(releasePos - centre) / (SWEET_ZONE_WIDTH / 2);
}

/** Score for the trial: mean accuracy across all lock swings. */
export function armoryScore(accuracies: number[]): number {
  if (accuracies.length === 0) return 0;
  const sum = accuracies.reduce((a, b) => a + b, 0);
  return sum / ARMORY_LOCKS;
}
