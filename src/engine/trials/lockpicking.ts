// Lockpicking trial engine (pure, no React).
// A sliding cursor bounces across a bar; the player taps to "set" each pin
// while the cursor is inside the pin's target zone.

export const LOCK_PINS = 3;
/** Zone width as a fraction of bar width — shrinks each pin. */
export const BASE_ZONE_WIDTH = 0.22;
export const ZONE_SHRINK = 0.028; // subtract per pin index

/** Cursor speed (units/sec) per pin — escalates from slow to fast. */
export const CURSOR_SPEEDS = [0.42, 0.65, 0.90] as const;
/** Random ±fraction applied to speed on each wall bounce — prevents pure muscle-memory. */
export const CURSOR_JITTER = 0.08;

/** How far the cursor is off-center (0 = perfect, 0.5 = at zone edge). */
export function hitAccuracy(cursor: number, zoneStart: number, zoneWidth: number): number {
  const center = zoneStart + zoneWidth / 2;
  const half = zoneWidth / 2;
  return Math.max(0, 1 - Math.abs(cursor - center) / half);
}

export interface LockPin {
  /** Left edge of the target zone (0..1). */
  zoneStart: number;
  /** Width of the target zone (0..1). */
  zoneWidth: number;
}

/** Deterministic pin layout for a given seeded rng. */
export function generatePins(rng: () => number): LockPin[] {
  return Array.from({ length: LOCK_PINS }, (_, i) => {
    const zoneWidth = Math.max(0.08, BASE_ZONE_WIDTH - i * ZONE_SHRINK);
    // Keep zone fully inside [0, 1 - zoneWidth] so it always fits.
    const zoneStart = rng() * (1 - zoneWidth);
    return { zoneStart, zoneWidth };
  });
}

/** Score for the lockpicking trial: mean accuracy across hit pins; misses score 0. */
export function lockpickingScore(accuracies: number[]): number {
  if (accuracies.length === 0) return 0;
  const sum = accuracies.reduce((a, b) => a + b, 0);
  return sum / LOCK_PINS; // divide by total possible pins, not just hit ones
}
