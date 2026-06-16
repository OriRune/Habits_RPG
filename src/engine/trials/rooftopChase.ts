// Rooftop Chase trial engine (pure, no React).
// Side-view endless runner: hero auto-sprints across rooftops, jumping hazards,
// gaps, and goomba mooks. A chaser gains on stumbles; reaching TARGET_DISTANCE wins.
// New: double-jump, slide/duck under lowbars, re-tuned physics, fair gap widths.

// ── Tuning constants ───────────────────────────────────────────────────────────

/** World-units of running needed for a perfect score. */
export const CHASE_TARGET_DISTANCE = 200;

/** Initial scroll speed (world-units / second). */
export const BASE_SPEED = 6;

/** Speed increase per world-unit of distance traveled. */
export const SPEED_RAMP = 0.018;

/** Hard cap on scroll speed. */
export const MAX_SPEED = 22;

// Physics — tuned for a visible jump arc and clearable gaps.
// apex ≈ 7.6 world-units (53 px at 7 px/wu), air time ≈ 1.375 s at base speed.

/** Downward gravity (world-units / sec²). */
export const GRAVITY = 32;

/** Upward velocity when the hero jumps (world-units / sec). */
export const JUMP_VELOCITY = 22;

/** Maximum number of jumps before landing (1 = no double-jump, 2 = double-jump). */
export const MAX_JUMPS = 2;

/** Upward velocity for the second (double) jump midair — slightly weaker. */
export const DOUBLE_JUMP_VELOCITY = 18;

/** Stumble stagger duration in ms — hero cannot jump while stumbling. */
export const STUMBLE_MS = 480;

/** Slide/duck duration in ms — hero crouches to clear lowbar obstacles. */
export const SLIDE_MS = 450;

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
export const STOMP_BOUNCE_VELOCITY = 14;

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
export const OBSTACLE_HEIGHT = 4;

/** Mook head detection: hero must be descending and within this Y band above mook top. */
export const STOMP_WINDOW = 2.5;

// ── Types ──────────────────────────────────────────────────────────────────────

/** 'hazard' = jump over  ·  'gap' = jump across  ·  'mook' = jump/stomp  ·  'lowbar' = slide under */
export type FeatureKind = 'hazard' | 'gap' | 'mook' | 'lowbar';

export interface RoofFeature {
  id: number;
  kind: FeatureKind;
  /** Left edge position in world-units. */
  x: number;
  /** Width in world-units. */
  width: number;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * Time in seconds the hero spends in the air during a single full jump
 * (ground → apex → ground). Used to guarantee gap widths are clearable.
 */
export function jumpAirTime(): number {
  return (2 * JUMP_VELOCITY) / GRAVITY;
}

/**
 * Maximum gap width (world-units) that is safely clearable with one jump at the
 * given distance. Uses an 85% safety margin so the player doesn't need
 * frame-perfect timing.
 */
export function maxClearableGap(distance: number): number {
  return speedAt(distance) * jumpAirTime() * 0.85;
}

/**
 * Generate a deterministic feature stream for the course.
 * - First GRACE_DISTANCE units are clear.
 * - Spacing tightens as the course progresses.
 * - Kinds: ~30% hazard, ~25% gap, ~25% mook, ~20% lowbar.
 * - Gap widths are clamped so every gap is beatable with a single well-timed jump.
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

    if (r < 0.30) {
      kind = 'hazard';
      width = 2 + rng() * 1.5;           // 2–3.5 wu
    } else if (r < 0.55) {
      kind = 'gap';
      const desired = 7 + rng() * 5;     // 7–12 wu ideal
      // Clamp to what a single jump can clear at this speed
      const clearable = maxClearableGap(cursor);
      width = Math.max(5, Math.min(desired, clearable));
    } else if (r < 0.80) {
      kind = 'mook';
      width = 2.5;
    } else {
      kind = 'lowbar';
      width = 3 + rng() * 2;             // 3–5 wu (wide enough to see coming)
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
 * heroY:   vertical offset above roof (0 = grounded, positive = airborne).
 * heroVy:  current vertical velocity (+up = rising, -down = falling).
 * sliding: true while the hero is in a slide/duck (lowbar only clears when sliding).
 * feature: the feature currently overlapping the hero's hitbox.
 *
 * Returns:
 *   'stomp'   — hero descends onto mook's head within the stomp window.
 *   'stumble' — hero trips/collides (lead is lost, stagger applied).
 *   'clear'   — hero is safely airborne or correctly sliding past the obstacle.
 */
export function resolveContact(
  heroY: number,
  heroVy: number,
  sliding: boolean,
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

  if (feature.kind === 'hazard') {
    // Must be airborne to clear
    return grounded ? 'stumble' : 'clear';
  }

  // 'lowbar': a hanging banner / rope at head height — must slide under it.
  // Cannot be jumped over. Being airborne while not sliding still stumbles.
  if (feature.kind === 'lowbar') {
    return sliding ? 'clear' : 'stumble';
  }

  return grounded ? 'stumble' : 'clear';
}

/** Map distance traveled to a normalised 0..1 score. */
export function chaseScore(distance: number): number {
  return Math.max(0, Math.min(1, distance / CHASE_TARGET_DISTANCE));
}
