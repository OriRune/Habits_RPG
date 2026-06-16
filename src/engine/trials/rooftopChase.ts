// Rooftop Chase trial engine (pure, no React).
// Side-view endless runner: hero auto-sprints across rooftops, jumping hazards,
// gaps, and goomba mooks. A chaser gains on stumbles; reaching TARGET_DISTANCE wins.

// ── Tuning constants ───────────────────────────────────────────────────────────

/** World-units of running needed for a perfect score. */
export const CHASE_TARGET_DISTANCE = 200;

/** Initial scroll speed (world-units / second). */
export const BASE_SPEED = 6;

/** Speed increase per world-unit of distance traveled. */
export const SPEED_RAMP = 0.018;

/** Hard cap on scroll speed. */
export const MAX_SPEED = 22;

/** Downward gravity (world-units / sec²). Applied to hero Y velocity each frame. */
export const GRAVITY = 48;

/** Upward velocity when the hero jumps (world-units / sec). */
export const JUMP_VELOCITY = 18;

/** Stumble stagger duration in ms — hero cannot jump while stumbling. */
export const STUMBLE_MS = 480;

/** Starting lead buffer (world-units ahead of chaser). */
export const LEAD_START = 30;

/** Maximum lead the hero can accumulate. */
export const LEAD_MAX = 50;

/** Lead regenerated per second of clean running. */
export const LEAD_REGEN_PER_SEC = 2;

/** Lead lost on each stumble. */
export const STUMBLE_LEAD_LOSS = 12;

/** Lead gained on each stomp. */
export const STOMP_LEAD_GAIN = 4;

/** Upward vy given to hero after a stomp (world-units / sec). */
export const STOMP_BOUNCE_VELOCITY = 12;

/** World-units of clear opening at the start of the course (no features). */
export const GRACE_DISTANCE = 20;

/** Minimum gap between the start of consecutive features (world-units). */
export const MIN_FEATURE_SPACING = 14;

/** Maximum gap between consecutive features (tightens with feature index). */
export const MAX_FEATURE_SPACING = 30;

/** How many features to pre-generate for the course. */
export const FEATURE_COUNT = 60;

/** Y coordinate of the roof surface (hero feet rest here when grounded). */
export const ROOF_Y = 0;

/** Height of a hazard / mook hitbox (world-units). */
export const OBSTACLE_HEIGHT = 3;

/** Mook head detection: hero must be descending and within this Y band above mook top. */
export const STOMP_WINDOW = 2.5;

// ── Types ──────────────────────────────────────────────────────────────────────

export type FeatureKind = 'hazard' | 'gap' | 'mook';

export interface RoofFeature {
  id: number;
  kind: FeatureKind;
  /** Left edge position in world-units. */
  x: number;
  /** Width in world-units (hazards/mooks ~2–3; gaps ~8–12). */
  width: number;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * Generate a deterministic feature stream for the course.
 * - First GRACE_DISTANCE units are clear.
 * - Spacing tightens as the course progresses.
 * - Kinds chosen by rng: ~35% hazard, ~30% gap, ~35% mook.
 */
export function generateFeatures(rng: () => number, count = FEATURE_COUNT): RoofFeature[] {
  const features: RoofFeature[] = [];
  let cursor = GRACE_DISTANCE;

  for (let i = 0; i < count; i++) {
    // Spacing tightens from MAX→MIN as index advances
    const t = Math.min(1, i / (count * 0.7));
    const spacing = MIN_FEATURE_SPACING + (1 - t) * (MAX_FEATURE_SPACING - MIN_FEATURE_SPACING);
    cursor += spacing * (0.7 + rng() * 0.6); // ±30% jitter

    const r = rng();
    let kind: FeatureKind;
    let width: number;

    if (r < 0.35) {
      kind = 'hazard';
      width = 2 + rng() * 1.5; // 2–3.5
    } else if (r < 0.65) {
      kind = 'gap';
      width = 8 + rng() * 5;   // 8–13 (clearable with one jump)
    } else {
      kind = 'mook';
      width = 2.5;
    }

    features.push({ id: i, kind, x: cursor, width });
  }

  return features;
}

/**
 * Current scroll speed at a given distance.
 * Monotonically increases from BASE_SPEED, capped at MAX_SPEED.
 */
export function speedAt(distance: number): number {
  return Math.min(MAX_SPEED, BASE_SPEED + SPEED_RAMP * distance);
}

/**
 * Update the chaser lead value.
 * Regeneration happens every tick (call with dtSec).
 * Pass 'stumble' or 'stomp' on those event frames.
 */
export function updateLead(
  lead: number,
  dtSec: number,
  event?: 'stumble' | 'stomp',
): number {
  let next = lead + LEAD_REGEN_PER_SEC * dtSec;
  if (event === 'stumble') next -= STUMBLE_LEAD_LOSS;
  if (event === 'stomp')   next += STOMP_LEAD_GAIN;
  return Math.max(0, Math.min(LEAD_MAX, next));
}

/**
 * Classify the hero's interaction with a feature.
 *
 * heroY: vertical offset above roof (0 = grounded, positive = airborne).
 * heroVy: current vertical velocity (positive = moving up, negative = falling).
 * feature: the feature currently overlapping the hero's x position.
 *
 * Returns:
 *   'stomp'   — hero descends onto mook's head within the stomp window.
 *   'stumble' — hero is grounded and colliding, or grounded inside a gap.
 *   'clear'   — hero is airborne over obstacle, or safely past the zone.
 */
export function resolveContact(
  heroY: number,
  heroVy: number,
  feature: RoofFeature,
): 'clear' | 'stumble' | 'stomp' {
  const grounded = heroY <= 0;

  if (feature.kind === 'gap') {
    return grounded ? 'stumble' : 'clear';
  }

  if (feature.kind === 'mook') {
    // Stomp: descending (vy < 0), airborne, feet within stomp window above mook top
    if (!grounded && heroVy < 0 && heroY > 0 && heroY <= STOMP_WINDOW + OBSTACLE_HEIGHT) {
      return 'stomp';
    }
    return grounded ? 'stumble' : 'clear';
  }

  // 'hazard': must be airborne to clear
  return grounded ? 'stumble' : 'clear';
}

/** Map distance traveled to a normalised 0..1 score. */
export function chaseScore(distance: number): number {
  return Math.max(0, Math.min(1, distance / CHASE_TARGET_DISTANCE));
}
