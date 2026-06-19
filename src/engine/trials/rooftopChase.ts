// Rooftop Chase trial engine (pure, no React).
// Side-view endless runner: hero leaps between rooftops of a medieval town.
// Gaps between buildings are lethal — fall in and the run ends.
// A beast chaser appears after the opening stretch; dash to shove it back.
//
// Round 2: Building model, hasFallen, resolveContact(5-arg), chaser spawn delay, dash constants.
// Round 3 (Phase 0 overhaul): ChaseState, initChase, stepChase (pure sim reducer).
//   Speed constants retuned so the ramp covers a full ~90s run (cap ≈ 600 wu).

// ── Tuning constants ───────────────────────────────────────────────────────────

/**
 * World-units of running needed for a perfect score.
 * At BASE_SPEED=4 with SPEED_RAMP=0.010 this is reached in ~92 seconds of
 * clean running — the intended 1–3 min target for a skilled player.
 */
export const CHASE_TARGET_DISTANCE = 600;

/** Initial scroll speed (world-units / second). */
export const BASE_SPEED = 4;

/**
 * Speed increase per world-unit of distance traveled.
 * With BASE_SPEED=4, SPEED_RAMP=0.010, MAX_SPEED=10: cap is hit right at
 * CHASE_TARGET_DISTANCE, so the ramp is meaningful across the whole run.
 */
export const SPEED_RAMP = 0.010;

/** Hard cap on scroll speed. */
export const MAX_SPEED = 10;

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
export const CHASER_SPAWN_DISTANCE = 120;

/** Starting lead buffer (world-units ahead of chaser). Used as LEAD_MAX too. */
export const LEAD_START = 50;

/** Maximum lead the hero can accumulate. */
export const LEAD_MAX = 50;

/** Lead the chaser closes per second once active. */
export const CHASER_GAIN_PER_SEC = 4.5;

/** Lead lost on each stumble. */
export const STUMBLE_LEAD_LOSS = 12;

/**
 * Lead gained on each stomp — raised from 4 to 9 (Phase 3 rebalance) so a
 * well-timed stomp is genuinely competitive with a dash.
 */
export const STOMP_LEAD_GAIN = 9;

/**
 * Additional lead gained per consecutive stomp (chain-stomp bonus).
 * First stomp in a chain: +0; second: +2; third: +4; etc.
 * Chain resets when the hero lands on a roof.
 */
export const STOMP_CHAIN_BONUS = 2;

/** Lead gained from a single dash burst. */
export const DASH_LEAD_GAIN = 16;

/** Lead gained from successfully sliding under a lowbar banner (clean slide). */
export const SLIDE_LEAD_GAIN = 5;

/** Lead gained when jumping cleanly over a mook without stomping. */
export const MOOK_JUMP_LEAD_GAIN = 3;

/** Distance (wu) beyond which chaser surges inflict a small real lead drain. */
export const SURGE_REAL_DRAIN_START = 400;

/** Lead drained by each surge that fires beyond SURGE_REAL_DRAIN_START. */
export const SURGE_REAL_DRAIN = 3;

// ── Drama constants ────────────────────────────────────────────────────────────

/**
 * The chaser lunges toward the hero every this many world-units of distance.
 * A surge is theatrically alarming but has zero net lead impact: the chaser
 * closes by SURGE_LEAD_BURST then recedes by the same amount over SURGE_DURATION_MS.
 */
export const SURGE_INTERVAL_WU = 40;

/** How long each surge lasts (milliseconds). */
export const SURGE_DURATION_MS = 1200;

/**
 * How much lead the surge visually "steals" at its peak.
 * This is purely visual — the surge is self-recovering, so it never drains
 * the player's actual lead total. It just displaces chaserX temporarily.
 */
export const SURGE_VISUAL_OFFSET = 8;

/**
 * Lead level at which the "near-miss" feedback fires when a dash or stomp
 * shoves the chaser back. Encourages the player by acknowledging a close call.
 */
export const NEAR_MISS_LEAD_THRESHOLD = 12;

/**
 * Maximum world-unit distance between the chaser and the hero when lead is
 * at its maximum (LEAD_MAX). Scales linearly: at 0 lead the chaser is at the
 * hero's foot position; at LEAD_MAX it is this many wu behind.
 *
 * At 28 wu and PX_PER_WU = 8: the chaser starts ~19 wu off-screen left when
 * lead is full (HERO_X_PX = 150, behind-view ≈ 19 wu) and visibly closes in
 * as lead drains, rather than spawning right on top of the hero.
 */
export const CHASER_MAX_GAP = 28;

/** Upward vy given to hero after a stomp (world-units / sec). */
export const STOMP_BOUNCE_VELOCITY = 14;

// ── Dash constants ─────────────────────────────────────────────────────────────

/** How long the dash speed burst lasts (ms). */
export const DASH_DURATION_MS = 550;

/** Cooldown between dashes (ms). */
export const DASH_COOLDOWN_MS = 2600;

/** Speed multiplier during a dash (base speed * (1 + DASH_SPEED_BONUS)). */
export const DASH_SPEED_BONUS = 0.9;

// ── Course generation constants ────────────────────────────────────────────────

/** Width of the first (grace) building — no props, roofY = 0. */
export const GRACE_DISTANCE = 22;

/** How many buildings to pre-generate for the course.
 *  30 covers a perfect run (≈ building 24 at 600 wu) with a comfortable margin. */
export const BUILDING_COUNT = 30;

/** Possible roof elevation levels (world-units above baseline). */
export const ROOF_LEVELS = [0, 2.5, 5] as const;

/** Height of a hazard / mook hitbox (world-units). */
export const OBSTACLE_HEIGHT = 4;

/** Mook head detection: hero must be descending and within this Y band above mook top. */
export const STOMP_WINDOW = 2.5;

// ── Seeded RNG ─────────────────────────────────────────────────────────────────

/**
 * Simple LCG seeded pseudo-random number generator.
 * Returns a deterministic sequence of values in [0, 1) for a given seed.
 * Exported so callers can produce reproducible courses (e.g. for debugging).
 */
export function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

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

    // Props: density ramps from 50% early to 80% late so the second half feels harder.
    const propChance = i < 10 ? 0.50 : i < 20 ? 0.65 : 0.80;
    const props: RoofProp[] = [];
    if (rng() < propChance && buildingWidth >= 8) {
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
 * The building supporting the hero — requires at least `LANDING_SUPPORT_FRAC × HERO_HITBOX_W`
 * world-units of horizontal overlap so players who clip the leading edge of a roof still land
 * safely instead of registering as a fall.
 *
 * @param heroLeftX  Hero's left hitbox edge (= `state.distance`).
 */
export function supportingBuilding(buildings: Building[], heroLeftX: number): Building | null {
  const minOverlap = LANDING_SUPPORT_FRAC * HERO_HITBOX_W;
  for (const b of buildings) {
    const overlap =
      Math.min(heroLeftX + HERO_HITBOX_W, b.x + b.width) - Math.max(heroLeftX, b.x);
    if (overlap >= minOverlap) return b;
  }
  return null;
}

/**
 * The building whose span the hero's **leading edge** (`heroLeftX + HERO_HITBOX_W`) is
 * inside, or null. Any positive leading-edge overlap counts (no minimum threshold).
 *
 * Used only for the descending ledge-catch in `hasFallen` / landing snapping.
 * Jump and slide gating continue to use `supportingBuilding` (≥25% body overlap).
 *
 * @param heroLeftX  Hero's left hitbox edge (= `state.distance`).
 */
export function touchingBuilding(buildings: Building[], heroLeftX: number): Building | null {
  const leadingEdge = heroLeftX + HERO_HITBOX_W;
  for (const b of buildings) {
    if (leadingEdge > b.x && leadingEdge <= b.x + b.width) return b;
  }
  return null;
}

/**
 * True when the hero is over a gap (not on any building) AND has fallen below the top of the
 * next building ahead — meaning they failed to clear it and the run should end.
 *
 * Uses `supportingBuilding` (≥25 % hitbox overlap) for the "on a roof" check so edge
 * landings are forgiving.  The look-ahead uses the front edge of the hitbox so the hero
 * is compared against the roof they are about to land on, not one they already passed.
 *
 * Special cases:
 * - If supported on a building (≥25% overlap): false.
 * - Ledge-catch: leading edge is inside a roof, hero descending, within LEDGE_CATCH_TOL: false.
 * - If airborne over a gap but still above the next roof top: false (still in the arc).
 * - No next building ahead: false (beyond the course end; finish handles that).
 *
 * @param heroLeftX  Hero's left hitbox edge (= `state.distance`).
 * @param heroVy     Hero's current vertical velocity (wu/sec; positive = rising).
 */
export function hasFallen(
  buildings: Building[],
  heroLeftX: number,
  heroY: number,
  heroVy: number,
): boolean {
  // 1. Fully supported (≥25% overlap) — not fallen.
  if (supportingBuilding(buildings, heroLeftX) !== null) return false;
  // 2. Ledge-catch / fall-through: leading edge has entered the next roof.
  //    Once the leading edge is inside a building, nextBuilding returns null (that
  //    building is behind the probe), so we handle all outcomes here explicitly.
  const touched = touchingBuilding(buildings, heroLeftX);
  if (touched !== null) {
    if (heroVy > 0) return false;                               // rising — still airborne
    if (heroY >= touched.roofY - LEDGE_CATCH_TOL) return false; // descending within catch
    return heroY < touched.roofY;                               // too deep — fell
  }
  // 3. Standard look-ahead fall check (leading edge not yet on any building).
  const next = nextBuilding(buildings, heroLeftX + HERO_HITBOX_W);
  if (next === null) return false; // past the end — win/finish logic handles it
  return heroY < next.roofY;
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

// ── Chaser world position ──────────────────────────────────────────────────────

/**
 * Compute the chaser's absolute world position from the hero's foot X and the
 * current lead value.
 *
 * The chaser is always `(lead / LEAD_MAX) × CHASER_MAX_GAP` world-units behind
 * the hero — fully derived from existing state (no new physics or failure modes).
 *
 * Y is snapped to the roof elevation under the chaser's X, or a parabolic leap
 * arc when the chaser is crossing a gap between buildings.
 *
 * @returns { x, y, airborne }
 */
export function chaserWorldPos(
  heroFootX: number,
  lead: number,
  buildings: readonly Building[],
): { x: number; y: number; airborne: boolean } {
  const gap = (Math.max(0, lead) / LEAD_MAX) * CHASER_MAX_GAP;
  const cx = heroFootX - gap;

  // On a roof — snap to its elevation.
  const underfoot = buildingAt(buildings as Building[], cx);
  if (underfoot) {
    return { x: cx, y: underfoot.roofY, airborne: false };
  }

  // Over a gap — find the last building to the left and first to the right.
  let prevRight = -Infinity;
  let prevRoofY = 0;
  let nextLeft  = Infinity;
  let nextRoofY = 0;

  for (const b of buildings) {
    const bRight = b.x + b.width;
    if (bRight <= cx && bRight > prevRight) {
      prevRight = bRight;
      prevRoofY = b.roofY;
    }
    if (b.x > cx && b.x < nextLeft) {
      nextLeft  = b.x;
      nextRoofY = b.roofY;
    }
  }

  if (!isFinite(prevRight) || !isFinite(nextLeft)) {
    // Edge case: no buildings on one side (before/after the course).
    return { x: cx, y: 0, airborne: true };
  }

  const gapWidth = nextLeft - prevRight;
  const t = gapWidth > 0 ? Math.max(0, Math.min(1, (cx - prevRight) / gapWidth)) : 0;
  // Parabolic arc: linear elevation lerp + a sine peak for the jump apex.
  // Arc height scales with gap width so wider gaps produce more dramatic leaps.
  const arcHeight = Math.max(2, gapWidth * 0.35);
  const y = prevRoofY + (nextRoofY - prevRoofY) * t + Math.sin(Math.PI * t) * arcHeight;

  return { x: cx, y, airborne: true };
}

// ── Collision resolution ───────────────────────────────────────────────────────

/**
 * Find a prop by id across all buildings. Returns { prop, roofY } or null.
 * Used to identify the type of a previously-touched prop when the hero exits
 * the overlap zone (exit-frame detection for clean mook fly-overs).
 */
function propById(
  buildings: readonly Building[],
  id: number,
): { prop: RoofProp; roofY: number } | null {
  for (const b of buildings) {
    for (const p of b.props) {
      if (p.id === id) return { prop: p, roofY: b.roofY };
    }
  }
  return null;
}

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
  const grounded = heroY <= roofY + 0.05;

  switch (prop.kind) {
    case 'mook': {
      // Stomp: descending, airborne, within the stomp detection window above mook top.
      const mookTop = roofY + OBSTACLE_HEIGHT;
      if (!grounded && heroVy < 0 && heroY > roofY && heroY <= mookTop + STOMP_WINDOW) {
        return 'stomp';
      }
      return grounded ? 'stumble' : 'clear';
    }
    case 'hazard':
      return grounded ? 'stumble' : 'clear';
    case 'lowbar':
      return sliding ? 'clear' : 'stumble';
    default: {
      // TypeScript exhaustiveness guard — adding a new PropKind without a case here is a compile error.
      const _exhaustive: never = prop.kind;
      void _exhaustive;
      return grounded ? 'stumble' : 'clear';
    }
  }
}

// ── Score ──────────────────────────────────────────────────────────────────────

/** Map distance traveled to a normalised 0..1 score. */
export function chaseScore(distance: number): number {
  return Math.max(0, Math.min(1, distance / CHASE_TARGET_DISTANCE));
}

// ── Pure sim state (ChaseState + initChase + stepChase) ───────────────────────
//
// The full simulation is captured in a plain serializable struct (ChaseState).
// stepChase() is a pure reducer: (state, input, dtSec) → newState.
// The component/hook holds state in refs and calls stepChase each RAF frame.

/**
 * Hero hitbox width in world-units.
 * Slightly narrower than the visual sprite for fairness.
 * Exported so the renderer can use the same value for pixel layout.
 */
export const HERO_HITBOX_W = 2.2;

/**
 * Fraction of the hero hitbox that must overlap a rooftop to count as supported.
 * 0.25 × HERO_HITBOX_W = 0.55 wu — governs grounded/jump/slide gating.
 */
export const LANDING_SUPPORT_FRAC = 0.25;

/**
 * How far below a roof surface (world-units) a descending hero whose leading edge
 * has entered that roof still counts as "catching the ledge" rather than falling.
 * Prevents a fall from registering when the sprite is visually on the lip.
 * 2.0 wu ≈ 16 px at PX_PER_WU = 8, covering typical descent speed at BASE_SPEED.
 */
export const LEDGE_CATCH_TOL = 2.0;

/** One-frame input snapshot passed to stepChase per RAF tick. */
export interface ChaseInput {
  /** True on the frame the jump button was pressed (edge-triggered). */
  jumpPressed: boolean;
  /** True on the frame the slide button was pressed (edge-triggered). */
  slidePressed: boolean;
  /** True on the frame the dash button was pressed (edge-triggered). */
  dashPressed: boolean;
}

/** Full simulation state. All timing durations are in milliseconds remaining. */
export interface ChaseState {
  /** The generated course (immutable after initChase). */
  readonly buildings: readonly Building[];

  // ── Hero position ──────────────────────────────────────────────────────────
  /** Absolute vertical position above the world baseline (0 = standing at baseline). */
  heroY: number;
  /** Vertical velocity, wu/sec (+up, −down). */
  heroVy: number;
  /** Roof elevation of the building currently underfoot (0 when over a gap or at baseline). */
  heroRoofY: number;
  /** World-x of the hero's left hitbox edge; increases over time. */
  distance: number;
  /** Jumps consumed since last landing (0 = grounded, 1 = first jump used). */
  jumpsUsed: number;
  /** Hero's Y at the end of the previous step — used for landing detection. */
  prevHeroY: number;

  // ── Timed states (ms remaining; 0 = inactive) ─────────────────────────────
  stumbleMs: number;
  slideMs: number;
  dashMs: number;
  dashCooldownMs: number;
  /** Duration remaining for the stomp visual flash (ms). */
  stompFlashMs: number;

  // ── Chaser ─────────────────────────────────────────────────────────────────
  lead: number;
  chaserActive: boolean;
  /** Chaser's absolute world-x (valid once chaserActive; 0 before spawn). */
  chaserX: number;
  /** Chaser's elevation above baseline: roof Y when grounded, arc height when leaping a gap. */
  chaserY: number;
  /** True while the chaser is in mid-air over a gap (for a leap animation in the renderer). */
  chaserAirborne: boolean;

  // ── Drama state ────────────────────────────────────────────────────────────
  /**
   * Milliseconds remaining in the current chaser surge (0 = no surge active).
   * Surges occur every SURGE_INTERVAL_WU of distance and are self-recovering.
   */
  surgeMs: number;
  /** World-unit distance at which the next surge will fire. */
  nextSurgeAt: number;
  /** True on the step a surge begins (one-frame flag for audio). */
  justSurged: boolean;
  /**
   * True on the step the player executes a dash or stomp while lead is below
   * NEAR_MISS_LEAD_THRESHOLD — signals a dramatic close-call recovery.
   */
  justNearMiss: boolean;

  // ── Collision tracking ─────────────────────────────────────────────────────
  /** Prop ID currently overlapping the hero (to fire the contact event only once per prop). */
  activeContactId: number | null;
  /** ID of the last successfully stomped prop, for the flash effect. */
  stompedPropId: number | null;
  /**
   * Consecutive stomp count — increments on each stomp, resets on landing.
   * Used for the chain-stomp bonus: nth stomp in a chain gives +(n−1)×STOMP_CHAIN_BONUS
   * extra lead on top of the base STOMP_LEAD_GAIN.
   */
  stompChain: number;
  /**
   * IDs of mook props that have been stomped (defeated) this run.
   * Defeated props are skipped in the collision scan and animated-out in the renderer.
   */
  defeatedPropIds: number[];

  // ── One-frame event flags (true for exactly one step, then cleared) ────────
  justLanded: boolean;
  justStomped: boolean;
  justStumbled: boolean;
  justDashed: boolean;
  /** True on the step the hero went over a gap and began falling. */
  justFell: boolean;
  /** True on the step the hero jumped from the ground (first jump). */
  justJumped: boolean;
  /** True on the step the hero performed a double-jump (midair second jump). */
  justDoubleJumped: boolean;
  /** True on the step the hero caught a ledge (lip-catch landing rather than clean landing). */
  justLedgeCaught: boolean;
  /** True on the step the hero jumped cleanly over a mook without stomping (airborne clear). */
  justJumpedMook: boolean;
  /** True on the step the hero successfully slid under a lowbar banner. */
  justSlideClear: boolean;

  // ── Terminal ───────────────────────────────────────────────────────────────
  done: boolean;
  /** Normalised 0..1 score at end (or current progress mid-run). */
  score: number;
}

/** Return the initial ChaseState for a fresh run. */
export function initChase(rng: () => number): ChaseState {
  return {
    buildings: generateCourse(rng),
    heroY: 0,
    heroVy: 0,
    heroRoofY: 0,
    distance: 0,
    jumpsUsed: 0,
    prevHeroY: 0,
    stumbleMs: 0,
    slideMs: 0,
    dashMs: 0,
    dashCooldownMs: 0,
    stompFlashMs: 0,
    lead: LEAD_START,
    chaserActive: false,
    chaserX: 0,
    chaserY: 0,
    chaserAirborne: false,
    surgeMs: 0,
    nextSurgeAt: CHASER_SPAWN_DISTANCE + SURGE_INTERVAL_WU,
    justSurged: false,
    justNearMiss: false,
    activeContactId: null,
    stompedPropId: null,
    stompChain: 0,
    defeatedPropIds: [],
    justLanded: false,
    justStomped: false,
    justStumbled: false,
    justDashed: false,
    justFell: false,
    justJumped: false,
    justDoubleJumped: false,
    justLedgeCaught: false,
    justJumpedMook: false,
    justSlideClear: false,
    done: false,
    score: 0,
  };
}

/**
 * Advance the chase simulation by one time step.
 *
 * Pure function: does not mutate `state`. Returns a new ChaseState.
 * One-frame event flags (justLanded, justStomped, etc.) are cleared at the
 * start of each step and re-set only if the event occurs this step.
 *
 * @param state  Current simulation state.
 * @param input  Edge-triggered input this frame (each flag is true for ≤1 step).
 * @param dtSec  Elapsed time since last step (seconds). Clamped externally to ≤0.05.
 */
export function stepChase(state: ChaseState, input: ChaseInput, dtSec: number): ChaseState {
  if (state.done) return state;

  const dtMs = dtSec * 1000;

  // ── 1. Tick timers ──────────────────────────────────────────────────────────
  let stumbleMs     = Math.max(0, state.stumbleMs     - dtMs);
  let slideMs       = Math.max(0, state.slideMs       - dtMs);
  let dashMs        = Math.max(0, state.dashMs        - dtMs);
  let dashCooldownMs = Math.max(0, state.dashCooldownMs - dtMs);
  let stompFlashMs  = Math.max(0, state.stompFlashMs  - dtMs);

  const nowStumbling = stumbleMs > 0;
  let stompedPropId = state.stompedPropId;

  // ── 2. Process input ────────────────────────────────────────────────────────
  let heroVy    = state.heroVy;
  let jumpsUsed = state.jumpsUsed;

  // Determine grounded state at start of frame (needed for jump/slide gating).
  // Uses supportingBuilding (≥25 % hitbox overlap) — consistent with the landing/fall logic.
  const underfootPrev = supportingBuilding(state.buildings as Building[], state.distance);
  const roofYPrev   = underfootPrev ? underfootPrev.roofY : state.heroRoofY;
  const groundedPrev = state.heroY <= roofYPrev + 0.05;

  // Jump — blocked while stumbling or sliding.
  const nowSliding = slideMs > 0 && groundedPrev;
  let justJumped = false;
  let justDoubleJumped = false;
  if (input.jumpPressed && !nowStumbling && !nowSliding) {
    if (groundedPrev) {
      heroVy         = JUMP_VELOCITY;
      jumpsUsed      = 1;
      justJumped     = true;
    } else if (jumpsUsed < MAX_JUMPS) {
      heroVy           = DOUBLE_JUMP_VELOCITY;
      jumpsUsed++;
      justDoubleJumped = true;
    }
  }

  // Slide — only while grounded and not stumbling.
  if (input.slidePressed && !nowStumbling && groundedPrev) {
    slideMs = SLIDE_MS;
  }

  // Dash — only when off cooldown and not stumbling.
  let justDashed = false;
  if (input.dashPressed && dashCooldownMs <= 0 && !nowStumbling) {
    dashMs         = DASH_DURATION_MS;
    dashCooldownMs = DASH_COOLDOWN_MS;
    justDashed     = true;
  }

  // ── 3. Advance distance ─────────────────────────────────────────────────────
  const activeDash  = dashMs > 0;
  const scrollSpeed = speedAt(state.distance) * (activeDash ? 1 + DASH_SPEED_BONUS : 1);
  const newDist     = state.distance + scrollSpeed * dtSec;

  // ── 4. Vertical physics (semi-implicit Euler) ───────────────────────────────
  const newVy = heroVy - GRAVITY * dtSec;
  const rawY  = state.heroY + newVy * dtSec;

  // ── 5. Find building underfoot after distance advance ───────────────────────
  // supportingBuilding (≥25% body overlap) governs grounded/jump/slide gating.
  // touchingBuilding (leading-edge inside a building) enables the ledge-catch.
  // footX (center) is kept solely for the chaser-position helper.
  const footX      = newDist + HERO_HITBOX_W / 2;
  const underfoot  = supportingBuilding(state.buildings as Building[], newDist);
  const touchedFwd = touchingBuilding(state.buildings as Building[], newDist);
  // Ledge-catch: hero's leading edge is over a roof, hero is descending, and still
  // within LEDGE_CATCH_TOL of that surface — treat as "about to land" not "fallen."
  const lipCatch  = !underfoot && touchedFwd !== null && newVy <= 0
                    && rawY >= touchedFwd.roofY - LEDGE_CATCH_TOL;
  const landingRoof  = underfoot ?? (lipCatch ? touchedFwd : null);
  const currentRoofY = landingRoof ? landingRoof.roofY : 0;

  // ── 6. Fall check ───────────────────────────────────────────────────────────
  if (hasFallen(state.buildings as Building[], newDist, rawY, newVy)) {
    return {
      ...state,
      heroY: rawY,
      heroVy: newVy,
      heroRoofY: currentRoofY,
      distance: newDist,
      jumpsUsed,
      prevHeroY: rawY,
      stumbleMs,
      slideMs: 0,
      dashMs,
      dashCooldownMs,
      stompFlashMs,
      stompedPropId,
      stompChain: state.stompChain,
      defeatedPropIds: state.defeatedPropIds,
      lead: state.lead,
      chaserActive: state.chaserActive,
      chaserX: state.chaserX,
      chaserY: state.chaserY,
      chaserAirborne: state.chaserAirborne,
      surgeMs: state.surgeMs,
      nextSurgeAt: state.nextSurgeAt,
      justSurged: false,
      justNearMiss: false,
      activeContactId: state.activeContactId,
      justLanded: false,
      justStomped: false,
      justStumbled: false,
      justDashed,
      justJumped,
      justDoubleJumped,
      justLedgeCaught: false,
      justJumpedMook: false,
      justSlideClear: false,
      justFell: true,
      done: true,
      score: chaseScore(newDist),
    };
  }

  // ── 7. Land on roof surface ─────────────────────────────────────────────────
  let newY           = rawY;
  let finalVy        = newVy;
  let justLanded     = false;
  let justLedgeCaught = false;

  // Land when: (a) normally supported (≥25% overlap), or (b) ledge-catch (leading edge
  // on next roof while descending within LEDGE_CATCH_TOL). Both paths set landingRoof.
  if (landingRoof && newY <= currentRoofY) {
    const wasAbove = state.prevHeroY > currentRoofY;
    if (wasAbove) {
      justLanded = true;
      jumpsUsed  = 0;
      if (lipCatch) justLedgeCaught = true;
    }
    newY    = currentRoofY;
    finalVy = 0;
  }

  const grounded    = newY <= currentRoofY + 0.05;
  // Slide is cancelled if hero leaves the ground.
  if (!grounded) slideMs = 0;
  const activeSlideFinal = grounded && slideMs > 0;

  // ── 8. Collision detection & resolution ────────────────────────────────────
  //
  // Mooks are rechecked EVERY overlap frame so a hero who first overlaps above
  // the stomp window can still register a stomp as they descend into it.
  // Hazards and lowbars use the original one-shot-per-new-contact approach.
  // Clean mook fly-overs (justJumpedMook) are detected on the *exit* frame —
  // when the hero stops overlapping a mook they neither stomped nor stumbled.
  const prevContactId = state.activeContactId;
  let activeContactId: number | null = prevContactId;
  let leadEvent: 'stumble' | 'stomp' | 'dash' | undefined;
  let justStomped    = false;
  let justStumbled   = false;
  let justSlideClear = false;
  let justJumpedMook = false;
  let finalHeroVy    = finalVy;
  let finalJumpsUsed = jumpsUsed;
  let newStumbleMs   = stumbleMs;

  if (justDashed) leadEvent = 'dash';

  let foundPropId:   number | null = null;
  let foundPropData: { prop: RoofProp; roofY: number } | null = null;

  outer: for (const b of state.buildings) {
    for (const p of b.props) {
      if (state.defeatedPropIds.includes(p.id)) continue; // already defeated — skip
      if (newDist < p.x + p.width && newDist + HERO_HITBOX_W > p.x) {
        foundPropId   = p.id;
        foundPropData = { prop: p, roofY: b.roofY };
        break outer;
      }
    }
  }

  if (foundPropData !== null) {
    activeContactId = foundPropId;
    const { prop, roofY: propRoofY } = foundPropData;
    const isNewContact = foundPropId !== prevContactId;

    if (prop.kind === 'mook') {
      // Stomp is re-evaluated every overlap frame so a descending hero clears the
      // stomp window after the initial contact registers correctly.
      const result = resolveContact(newY, finalHeroVy, activeSlideFinal, prop, propRoofY);
      if (result === 'stomp') {
        finalHeroVy    = STOMP_BOUNCE_VELOCITY;
        finalJumpsUsed = 0;
        justStomped    = true;
        stompedPropId  = foundPropId;
        // Chain stomps get a longer flash so the chain counter is readable.
        stompFlashMs   = 500 + 150 * state.stompChain;
        if (!leadEvent) leadEvent = 'stomp';
      } else if (result === 'stumble' && isNewContact) {
        // Grounded into a mook — stumble fires only once (first overlap frame).
        newStumbleMs = STUMBLE_MS;
        justStumbled = true;
        if (!leadEvent) leadEvent = 'stumble';
      }
      // 'clear' while airborne: justJumpedMook is set on the exit frame below.
    } else {
      // Hazard / lowbar: one-shot resolution on first overlap frame only.
      if (isNewContact) {
        const result = resolveContact(newY, finalHeroVy, activeSlideFinal, prop, propRoofY);
        if (result === 'stumble') {
          newStumbleMs = STUMBLE_MS;
          justStumbled = true;
          if (!leadEvent) leadEvent = 'stumble';
        } else if (result === 'clear' && prop.kind === 'lowbar' && activeSlideFinal) {
          justSlideClear = true;
        }
      }
    }

  } else {
    // No prop overlap this frame — check for mook fly-over exit: hero was touching
    // a mook last frame but cleared it while airborne (neither stomped nor stumbled).
    if (prevContactId !== null && !justStomped) {
      const prevPropData = propById(state.buildings, prevContactId);
      if (
        prevPropData !== null &&
        prevPropData.prop.kind === 'mook' &&
        !state.defeatedPropIds.includes(prevContactId) &&
        !justStumbled &&
        !grounded
      ) {
        justJumpedMook = true;
      }
    }
    activeContactId = null;
  }

  // ── 9. Update chaser lead ───────────────────────────────────────────────────
  const chaserActive = newDist >= CHASER_SPAWN_DISTANCE;
  let newLead        = updateLead(state.lead, dtSec, chaserActive, leadEvent);

  // Chain-stomp bonus: each consecutive stomp (without landing) adds extra lead.
  // chainBonus uses the chain count *before* this stomp (state.stompChain).
  const chainBonus = justStomped ? state.stompChain * STOMP_CHAIN_BONUS : 0;
  if (chainBonus > 0) {
    newLead = Math.min(LEAD_MAX, newLead + chainBonus);
  }

  // Clean slide reward.
  if (justSlideClear && chaserActive) {
    newLead = Math.min(LEAD_MAX, newLead + SLIDE_LEAD_GAIN);
  }

  // Mook jump-clear reward: smaller than a stomp, but meaningful.
  if (justJumpedMook && chaserActive) {
    newLead = Math.min(LEAD_MAX, newLead + MOOK_JUMP_LEAD_GAIN);
  }

  // Advance stomp chain counter: resets on landing, increments on stomp.
  const newStompChain = justLanded
    ? 0
    : justStomped
      ? state.stompChain + 1
      : state.stompChain;

  // Track defeated mooks: append the stomped prop id so the renderer can animate it out.
  const newDefeatedPropIds: number[] =
    justStomped && foundPropId !== null
      ? [...state.defeatedPropIds, foundPropId]
      : state.defeatedPropIds;

  // ── 9b. Surge drama (theatrical — zero net lead impact) ────────────────────
  let newSurgeMs     = Math.max(0, state.surgeMs - dtMs);
  let newNextSurgeAt = state.nextSurgeAt;
  let justSurged     = false;

  if (chaserActive && !state.done) {
    // Fire a new surge when distance crosses the next interval.
    if (newDist >= newNextSurgeAt && newSurgeMs <= 0) {
      newSurgeMs     = SURGE_DURATION_MS;
      newNextSurgeAt = newNextSurgeAt + SURGE_INTERVAL_WU;
      justSurged     = true;
      // Late-game surges inflict a small real lead drain — keeps drama impactful for experienced players.
      if (newDist >= SURGE_REAL_DRAIN_START) {
        newLead = Math.max(0, newLead - SURGE_REAL_DRAIN);
      }
    }
  }

  // Surge offset: a sine wave over the surge duration → chaser visually closes
  // by up to SURGE_VISUAL_OFFSET wu at the midpoint, then recedes back.
  // This offset is passed to chaserWorldPos and subtracted from the gap.
  const surgeFrac    = newSurgeMs > 0 ? 1 - newSurgeMs / SURGE_DURATION_MS : 0; // 0→1 as surge plays out
  const surgeOffset  = chaserActive
    ? Math.sin(Math.PI * surgeFrac) * SURGE_VISUAL_OFFSET
    : 0;

  // ── 9c. Near-miss detection ─────────────────────────────────────────────────
  // "Near-miss" fires when the hero shoves the chaser back while lead is very low.
  const justNearMiss =
    (justDashed || justStomped) &&
    state.lead < NEAR_MISS_LEAD_THRESHOLD &&
    chaserActive &&
    !state.done;

  // ── 9d. Compute chaser world position ──────────────────────────────────────
  // The surge offset reduces the effective gap (chaser lunges closer) without
  // affecting state.lead — position only.
  const chaserPos = chaserActive
    ? chaserWorldPos(footX, Math.max(0, newLead - surgeOffset), state.buildings)
    : { x: 0, y: 0, airborne: false };

  // ── 10. Terminal conditions ─────────────────────────────────────────────────
  const done = newLead <= 0 || newDist >= CHASE_TARGET_DISTANCE;

  return {
    buildings:      state.buildings,
    heroY:          newY,
    heroVy:         finalHeroVy,
    heroRoofY:      currentRoofY,
    distance:       newDist,
    jumpsUsed:      finalJumpsUsed,
    prevHeroY:      newY,
    stumbleMs:      newStumbleMs,
    slideMs,
    dashMs,
    dashCooldownMs,
    stompFlashMs,
    lead:           Math.max(0, newLead),
    chaserActive,
    chaserX:        chaserPos.x,
    chaserY:        chaserPos.y,
    chaserAirborne: chaserPos.airborne,
    surgeMs:        newSurgeMs,
    nextSurgeAt:    newNextSurgeAt,
    justSurged,
    justNearMiss,
    activeContactId,
    stompedPropId,
    stompChain:     newStompChain,
    defeatedPropIds: newDefeatedPropIds,
    justLanded,
    justStomped,
    justStumbled,
    justDashed,
    justJumped,
    justDoubleJumped,
    justLedgeCaught,
    justJumpedMook,
    justSlideClear,
    justFell:       false,
    done,
    score:          chaseScore(newDist),
  };
}
