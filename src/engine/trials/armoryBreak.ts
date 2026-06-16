// Armory Break trial engine (pure, no React).
// A power needle sweeps from 0 → 1 while the player holds; they release at the peak.
// Accuracy = how close to the "sweet spot" they released.

export const ARMORY_LOCKS = 3;
/** Width of the sweet spot zone (fraction of the meter 0..1). */
export const SWEET_ZONE_WIDTH = 0.25;
/** The zone is centered around the peak position (always 1.0). The zone is [peak − half, peak]. */
export const SWEET_ZONE_START = 1 - SWEET_ZONE_WIDTH; // 0.75

/**
 * Compute hit accuracy from a release position (0..1).
 * Returns 0..1 where 1 = released at the peak (1.0), 0 = fully outside the zone.
 */
export function armoryAccuracy(releasePos: number): number {
  if (releasePos < SWEET_ZONE_START) return 0;
  // Linear ramp from zone start (0) to zone end = 1.0 (accuracy 1).
  return (releasePos - SWEET_ZONE_START) / SWEET_ZONE_WIDTH;
}

/** Score for the trial: mean accuracy across all lock swings. */
export function armoryScore(accuracies: number[]): number {
  if (accuracies.length === 0) return 0;
  const sum = accuracies.reduce((a, b) => a + b, 0);
  return sum / ARMORY_LOCKS; // total possible locks in denominator
}
