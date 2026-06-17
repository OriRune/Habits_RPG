// Rooftop Chase trial engine (pure, no React).
// Side-view endless runner: hero leaps between rooftops of a medieval town.
// Gaps between buildings are lethal — fall in and the run ends.
// A beast chaser appears after the opening stretch; dash to shove it back.
//
// New in round 2:
//   - Building model (discrete platforms at varied heights) replaces flat-floor + 'gap' features.
//   - hasFallen() / buildingAt() / nextBuilding() pure helpers.
//   - resolveContact() now takes roofY (5-arg).
//   - Chaser delayed spawn (CHASER_SPAWN_DISTANCE) + updateLead() takes active flag + 'dash' event.
//   - Dash constants: DASH_COOLDOWN_MS, DASH_LEAD_GAIN, DASH_DURATION_MS, DASH_SPEED_BONUS.

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

// ── Chaser constants ───────────────────────────────────────────────────────────

/** Distance (wu) the hero must travel before the chaser appears. */
export const CHASER_SPAWN_DISTANCE = 45;

/** Starting lead buffer (world-units ahead of chaser). Used as LEAD_MAX too. */
export const LEAD_START = 50;

/** Maximum lead the hero can accumulate. */
export const LEAD_MAX = 50;

/** Lead the chaser closes per second once active. */
export const CHASER_GAIN_PER_SEC = 4.5;

/** Lead lost on each stumble. */
export const STUMBLE_LEAD_LOSS = 12;

/** Lead gained on each stomp. */
export const STOMP_LEAD_GAIN = 4;

/** Lead gained from a single dash burst. */
export const DASH_LEAD_GAIN = 16;

/** Upward vy given to hero after a stomp (world-units / sec). */
export const STOMP_BOUNCE_VELOCITY = 14;

// ── Dash constants ─────────────────────────────────────────────────────────────

/** How long the dash speed burst lasts (ms). */
export const DASH_DURATION_MS = 380;

/** Cooldown between dashes (ms). */
export const DASH_COOLDOWN_MS = 2600;

/** Speed multiplier during a dash (base speed * (1 + DASH_SPEED_BONUS)). */
export const DASH_SPEED_BONUS = 0.4;

// ── Course generation constants ────────────────────────────────────────────────

/** Width of the first (grace) building — no props, roofY = 0. */
export const GRACE_DISTANCE = 22;

/** How many buildings to pre-generate for the course. */
export const BUILDING_COUNT = 50;

/** Possible roof elevation levels (world-units above baseline). */
export const ROOF_LEVELS = [0, 2.5, 5] as const;

/** Height of a hazard / mook hitbox (world-units). */
export const OBSTACLE_HEIGHT = 4;

/** Mook head detection: hero must be descending and within this Y band above mook top. */
export const STOMP_WINDOW = 2.5;

// ── Types ──────────────────────────────────────────────────────────────────────

/** Kinds of obstacles that sit on a rooftop. 'gap' is no longer a prop kind — gaps are structural. */
export type PropKind = 'hazard' | 'mook' | 'lowbar';

export interface RoofProp {
  id: number;
  kind: PropKind;
  /** Left edge position in world-units (absolute). */
  x: number;
  /** Width in world-units. */
  width: number;
}

export interface Building {
  id: number;
  /** Left edge of the rooftop in world-units. */
  x: number;
  /** Width of the rooftop in world-units. */
  width: number;
  /** Roof elevation above the baseline (world-units). Hero stands at this Y when grounded here. */
  roofY: number;
  /** Obstacles sitting on this roof. */
  props: RoofProp[];
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
 * Current scroll speed at a given distance.
 * Monotonically increases from BASE_SPEED, capped at MAX_SPEED.
 */
export function speedAt(distance: number): number {
  return Math.min(MAX_SPEED, BASE_SPEED + SPEED_RAMP * distance);
}

// ── Course generation ──────────────────────────────────────────────────────────

/**
 * Generate a deterministic list of buildings for the course.
 * - First building is wide (GRACE_DISTANCE), at roofY = 0, no props.
 * - Subsequent buildings: varied heights (step at most ±1 ROOF_LEVEL), random gaps between them.
 * - Gaps are clamped so every jump is survivable; up-leaps get tighter clamps.
 * - Props placed at least 3 wu from each building edge so there's room to land before reacting.
 */
export function generateCourse(rng: () => number, count = BUILDING_COUNT): Building[] {
  const buildings: Building[] = [];
  let propIdCounter = 0;

  // First building: the grace platform
  buildings.push({
    id: 0,
    x: 0,
    width: GRACE_DISTANCE,
    roofY: 0,
    props: [],
  });

  let levelIndex = 0; // index into ROOF_LEVELS for the previous building

  for (let i = 1; i < count; i++) {
    const prevBuilding = buildings[i - 1];
    const prevRight = prevBuilding.x + prevBuilding.width;
    const cursor = prevRight; // where we are placing a gap

    // Pick next roof level (step ±1, clamped to [0, ROOF_LEVELS.length - 1])
    const levelStep = rng() < 0.5 ? -1 : 1;
    const nextLevelIndex = Math.max(0, Math.min(ROOF_LEVELS.length - 1, levelIndex + levelStep));
    const nextRoofY = ROOF_LEVELS[nextLevelIndex];
    const prevRoofY = ROOF_LEVELS[levelIndex];
    const goingUp = nextRoofY > prevRoofY;

    // Gap width: tighter when going up (rise eats horizontal reach)
    const baseGap = maxClearableGap(cursor);
    const gapMax = goingUp ? baseGap * 0.7 : baseGap;
    const gapMin = 3; // always visually a gap
    const desiredGap = 4 + rng() * 8; // 4–12 wu
    const gapWidth = Math.max(gapMin, Math.min(desiredGap, gapMax));

    const buildingX = prevRight + gapWidth;

    // Building width: varies 10–28 wu
    const buildingWidth = 10 + rng() * 18;

    // Props: 65% chance of one prop per roof
    const props: RoofProp[] = [];
    if (rng() > 0.35 && buildingWidth >= 8) {
      const propR = rng();
      let kind: PropKind;
      let propWidth: number;
      if (propR < 0.4) {
        kind = 'hazard';
        propWidth = 2 + rng() * 1.5; // 2–3.5 wu
      } else if (propR < 0.75) {
        kind = 'mook';
        propWidth = 2.5;
      } else {
        kind = 'lowbar';
        propWidth = 3 + rng() * 2; // 3–5 wu
      }
      // Place prop at least 3 wu from the left edge, leaving 3 wu on the right
      const safeLeft = buildingX + 3;
      const safeRight = buildingX + buildingWidth - 3 - propWidth;
      if (safeRight > safeLeft) {
        const propX = safeLeft + rng() * (safeRight - safeLeft);
        props.push({ id: propIdCounter++, kind, x: propX, width: propWidth });
      }
    }

    buildings.push({
      id: i,
      x: buildingX,
      width: buildingWidth,
      roofY: nextRoofY,
      props,
    });

    levelIndex = nextLevelIndex;
  }

  return buildings;
}

// ── Navigation helpers ─────────────────────────────────────────────────────────

/**
 * The building whose rooftop spans world-x `footX`, or null if `footX` is over a gap.
 */
export function buildingAt(buildings: Building[], footX: number): Building | null {
  for (const b of buildings) {
    if (footX >= b.x && footX < b.x + b.width) return b;
  }
  return null;
}

/**
 * The next building that starts *after* `footX` (the likely landing target while airborne).
 */
export function nextBuilding(buildings: Building[], footX: number): Building | null {
  for (const b of buildings) {
    if (b.x > footX) return b;
  }
  return null;
}

/**
 * True when the hero is over a gap (not on any building) AND has fallen below the top of the
 * next building ahead — meaning they failed to clear it and the run should end.
 *
 * Special cases:
 * - If standing on a building: false (not in a gap).
 * - If airborne over a gap but still above the next roof top: false (still in the arc).
 * - No next building ahead: false (beyond the course end; finish handles that).
 */
export function hasFallen(buildings: Building[], footX: number, heroY: number): boolean {
  if (buildingAt(buildings, footX) !== null) return false; // on a roof
  const next = nextBuilding(buildings, footX);
  if (next === null) return false; // past the end — let the win/finish logic handle it
  return heroY < next.roofY; // fell below the target roof's top
}

// ── Lead / chaser ──────────────────────────────────────────────────────────────

/**
 * Update the chaser lead value.
 *
 * When inactive (before CHASER_SPAWN_DISTANCE), lead is pinned at LEAD_MAX.
 * When active, the chaser steadily closes (CHASER_GAIN_PER_SEC per second).
 * Events: 'stumble' loses lead, 'stomp' and 'dash' gain lead.
 */
export function updateLead(
  lead: number,
  dtSec: number,
  active: boolean,
  event?: 'stumble' | 'stomp' | 'dash',
): number {
  if (!active) return LEAD_MAX;
  let next = lead - CHASER_GAIN_PER_SEC * dtSec;
  if (event === 'stumble') next -= STUMBLE_LEAD_LOSS;
  if (event === 'stomp')   next += STOMP_LEAD_GAIN;
  if (event === 'dash')    next += DASH_LEAD_GAIN;
  return Math.max(0, Math.min(LEAD_MAX, next));
}

// ── Collision resolution ───────────────────────────────────────────────────────

/**
 * Classify the hero's interaction with a prop on a rooftop.
 *
 * heroY:   absolute vertical offset above baseline (0 = baseline, positive = airborne).
 * heroVy:  current vertical velocity (+up = rising, -down = falling).
 * sliding: true while the hero is in a slide/duck (lowbar only clears when sliding).
 * prop:    the prop currently overlapping the hero's hitbox.
 * roofY:   the elevation of the roof the prop stands on.
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
  prop: RoofProp,
  roofY: number,
): 'clear' | 'stumble' | 'stomp' {
  // Grounded = hero's feet at or below this roof surface
  const grounded = heroY <= roofY + 0.05;

  if (prop.kind === 'mook') {
    // Stomp: descending (vy < 0), airborne, feet within stomp window above mook top
    const mookTop = roofY + OBSTACLE_HEIGHT;
    if (!grounded && heroVy < 0 && heroY > roofY && heroY <= mookTop + STOMP_WINDOW) {
      return 'stomp';
    }
    return grounded ? 'stumble' : 'clear';
  }

  if (prop.kind === 'hazard') {
    // Must be airborne to clear
    return grounded ? 'stumble' : 'clear';
  }

  // 'lowbar': a hanging banner at head height — must slide under it.
  // Jumping into it or running into it both stumble.
  if (prop.kind === 'lowbar') {
    return sliding ? 'clear' : 'stumble';
  }

  return grounded ? 'stumble' : 'clear';
}

// ── Score ──────────────────────────────────────────────────────────────────────

/** Map distance traveled to a normalised 0..1 score. */
export function chaseScore(distance: number): number {
  return Math.max(0, Math.min(1, distance / CHASE_TARGET_DISTANCE));
}
