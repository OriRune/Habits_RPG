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
 * The zone always starts at SWEET_ZONE_START; `zoneWidth` sets its span so the ST
 * stat (which widens per-lock zones) is scored against the SAME width the meter
 * draws. Defaults to SWEET_ZONE_WIDTH for callers that use the standard zone.
 */
export function armoryAccuracy(releasePos: number, zoneWidth: number = SWEET_ZONE_WIDTH): number {
  const zoneEnd = SWEET_ZONE_START + zoneWidth;
  if (releasePos < SWEET_ZONE_START) return 0;
  if (releasePos > zoneEnd) return 0;
  const centre = SWEET_ZONE_START + zoneWidth / 2;
  return 1 - Math.abs(releasePos - centre) / (zoneWidth / 2);
}

/**
 * Project the mash-meter power forward from the last animation frame to the true
 * release instant, so a well-timed release isn't quantized down to the previous
 * frame's value. While held, power rises at `riseSpeed` per second. (MINI-40c)
 */
export function projectReleasePower(power: number, riseSpeed: number, dtSeconds: number): number {
  return Math.max(0, Math.min(1, power + riseSpeed * Math.max(0, dtSeconds)));
}

/** Score for the trial: mean accuracy across all lock swings. */
export function armoryScore(accuracies: number[]): number {
  if (accuracies.length === 0) return 0;
  const sum = accuracies.reduce((a, b) => a + b, 0);
  return sum / ARMORY_LOCKS;
}
