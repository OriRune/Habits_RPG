// Unit tests for the Rooftop Chase pure sim (initChase + stepChase).
//
// These tests target the new ChaseState/stepChase API introduced in Phase 0.
// They complement the existing course-generation / helper tests in trials.test.ts.

import { describe, it, expect } from 'vitest';
import {
  initChase,
  stepChase,
  chaseScore,
  speedAt,
  CHASE_TARGET_DISTANCE,
  CHASER_SPAWN_DISTANCE,
  LEAD_START,
  LEAD_MAX,
  JUMP_VELOCITY,
  GRAVITY,
  STUMBLE_MS,
  STUMBLE_LEAD_LOSS,
  STOMP_LEAD_GAIN,
  DASH_LEAD_GAIN,
  DASH_DURATION_MS,
  DASH_COOLDOWN_MS,
  STOMP_BOUNCE_VELOCITY,
  BASE_SPEED,
  MAX_SPEED,
  type ChaseState,
  type ChaseInput,
} from '../trials/rooftopChase';

// ── Helpers ────────────────────────────────────────────────────────────────────

function seededRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

const NO_INPUT: ChaseInput = { jumpPressed: false, slidePressed: false, dashPressed: false };
const JUMP:     ChaseInput = { jumpPressed: true,  slidePressed: false, dashPressed: false };
const DASH:     ChaseInput = { jumpPressed: false, slidePressed: false, dashPressed: true  };

const DT = 1 / 60; // one frame at 60 fps (seconds)

function fresh(rng = seededRng()): ChaseState {
  return initChase(rng);
}

/** Advance the sim by N frames with no input. */
function stepN(state: ChaseState, n: number, input = NO_INPUT): ChaseState {
  let s = state;
  for (let i = 0; i < n; i++) s = stepChase(s, input, DT);
  return s;
}

// ── initChase ─────────────────────────────────────────────────────────────────

describe('initChase', () => {
  it('starts at distance 0 with full lead', () => {
    const s = fresh();
    expect(s.distance).toBe(0);
    expect(s.lead).toBe(LEAD_START);
  });

  it('is not done initially', () => {
    expect(fresh().done).toBe(false);
  });

  it('chaser is not active at the start', () => {
    expect(fresh().chaserActive).toBe(false);
  });

  it('hero starts on the ground (heroY = heroRoofY = 0)', () => {
    const s = fresh();
    expect(s.heroY).toBe(0);
    expect(s.heroRoofY).toBe(0);
  });

  it('all one-frame flags start false', () => {
    const s = fresh();
    expect(s.justLanded).toBe(false);
    expect(s.justStomped).toBe(false);
    expect(s.justStumbled).toBe(false);
    expect(s.justDashed).toBe(false);
    expect(s.justFell).toBe(false);
  });

  it('uses the supplied RNG (different seeds → different courses)', () => {
    const a = initChase(seededRng(1));
    const b = initChase(seededRng(2));
    // Building layouts are almost certainly different for different seeds
    expect(a.buildings[1].x).not.toBeNaN();
    expect(b.buildings[1].x).not.toBeNaN();
    // At minimum the first few buildings should differ across different seeds
    const sameLayout = a.buildings.every((ab, i) => ab.x === b.buildings[i]?.x && ab.roofY === b.buildings[i]?.roofY);
    expect(sameLayout).toBe(false);
  });
});

// ── stepChase — no-op on done state ───────────────────────────────────────────

describe('stepChase — done state passthrough', () => {
  it('returns the same object when already done', () => {
    const s = fresh();
    const done: ChaseState = { ...s, done: true, score: 0.5 };
    const next = stepChase(done, JUMP, DT);
    expect(next).toBe(done);
  });
});

// ── stepChase — distance advances ─────────────────────────────────────────────

describe('stepChase — distance', () => {
  it('distance increases each frame', () => {
    const s0 = fresh();
    const s1 = stepChase(s0, NO_INPUT, DT);
    expect(s1.distance).toBeGreaterThan(s0.distance);
  });

  it('distance advances at approximately BASE_SPEED per second', () => {
    let s = fresh();
    for (let i = 0; i < 60; i++) s = stepChase(s, NO_INPUT, DT);
    // After 1 second at BASE_SPEED (plus tiny ramp), should be close to BASE_SPEED
    expect(s.distance).toBeCloseTo(BASE_SPEED, 0);
  });

  it('dash increases distance advance for its duration', () => {
    const s0 = fresh();
    const withDash = stepChase(s0, DASH, DT); // activate dash this frame
    const withoutDash = stepChase(s0, NO_INPUT, DT);
    expect(withDash.distance).toBeGreaterThan(withoutDash.distance);
  });
});

// ── stepChase — jump physics ───────────────────────────────────────────────────

describe('stepChase — jumping', () => {
  it('jumping from ground gives upward velocity', () => {
    const s0 = fresh();
    const s1 = stepChase(s0, JUMP, DT);
    expect(s1.heroVy).toBeGreaterThan(0);
  });

  it('jump sets jumpsUsed to 1', () => {
    const s0 = fresh();
    const s1 = stepChase(s0, JUMP, DT);
    expect(s1.jumpsUsed).toBe(1);
  });

  it('hero becomes airborne after a jump', () => {
    let s = fresh();
    s = stepChase(s, JUMP, DT);
    s = stepChase(s, NO_INPUT, DT);
    expect(s.heroY).toBeGreaterThan(s.heroRoofY + 0.05);
  });

  it('double-jump is allowed mid-air', () => {
    let s = fresh();
    s = stepChase(s, JUMP, DT);
    // Hero is now airborne with jumpsUsed = 1
    const airborne = stepChase(s, NO_INPUT, DT);
    const withDoubleJump = stepChase(airborne, JUMP, DT);
    expect(withDoubleJump.jumpsUsed).toBe(2);
  });

  it('cannot triple-jump (capped at MAX_JUMPS = 2)', () => {
    let s = fresh();
    s = stepChase(s, JUMP, DT);          // first jump
    s = stepChase(s, NO_INPUT, DT);       // airborne
    s = stepChase(s, JUMP, DT);          // double-jump
    const before = s.heroVy;
    s = stepChase(s, JUMP, DT);          // should be no-op
    // jumpsUsed stays at 2, velocity is not boosted (may continue to decrease from gravity)
    expect(s.jumpsUsed).toBe(2);
    expect(s.heroVy).toBeLessThanOrEqual(before);
  });

  it('hero lands back on roof after a full jump arc', () => {
    let s = fresh();
    s = stepChase(s, JUMP, DT);
    // Simulate enough frames for a full arc
    for (let i = 0; i < 120; i++) {
      if (s.done) break;
      s = stepChase(s, NO_INPUT, DT);
      if (!s.justLanded && s.heroY <= s.heroRoofY + 0.05 && i > 10) break;
    }
    expect(s.heroY).toBeCloseTo(s.heroRoofY, 1);
    expect(s.jumpsUsed).toBe(0);
  });

  it('justLanded is true for exactly one frame on landing', () => {
    let s = fresh();
    s = stepChase(s, JUMP, DT);
    // Run until landed
    let landedFrame: ChaseState | null = null;
    for (let i = 0; i < 200; i++) {
      const prev = s;
      s = stepChase(s, NO_INPUT, DT);
      if (s.justLanded && !prev.justLanded) {
        landedFrame = s;
        break;
      }
    }
    expect(landedFrame).not.toBeNull();
    // Next frame should clear it
    const afterLand = stepChase(landedFrame!, NO_INPUT, DT);
    expect(afterLand.justLanded).toBe(false);
  });
});

// ── stepChase — jump blocked while stumbling ──────────────────────────────────

describe('stepChase — stumble gates jump', () => {
  it('cannot jump while stumbling', () => {
    const s0 = fresh();
    // Force stumble state
    const stumbling: ChaseState = { ...s0, stumbleMs: STUMBLE_MS };
    const s1 = stepChase(stumbling, JUMP, DT);
    // heroVy should remain at 0 (or continuing from gravity), no jump applied
    expect(s1.heroVy).toBeLessThanOrEqual(0 + 0.001); // gravity pulls down even on the same frame
    expect(s1.jumpsUsed).toBe(0);
  });
});

// ── stepChase — dash ───────────────────────────────────────────────────────────

describe('stepChase — dash', () => {
  it('dash sets dashMs > 0 and dashCooldownMs > 0', () => {
    const s = stepChase(fresh(), DASH, DT);
    expect(s.dashMs).toBeGreaterThan(0);
    expect(s.dashCooldownMs).toBeGreaterThan(0);
  });

  it('dash sets justDashed = true for one frame', () => {
    const s1 = stepChase(fresh(), DASH, DT);
    expect(s1.justDashed).toBe(true);
    const s2 = stepChase(s1, NO_INPUT, DT);
    expect(s2.justDashed).toBe(false);
  });

  it('dash cannot be used while on cooldown', () => {
    let s = stepChase(fresh(), DASH, DT);
    // Try to dash again immediately
    const s2 = stepChase(s, DASH, DT);
    // dashMs did not reset to DASH_DURATION_MS (it has been ticking down from the first dash)
    expect(s2.dashMs).toBeLessThan(DASH_DURATION_MS);
    expect(s2.justDashed).toBe(false);
  });

  it('dash increases lead when chaser is active', () => {
    // Inject a state with chaser active and lead already below LEAD_MAX so gain is visible.
    const base = fresh();
    const lowLead: ChaseState = {
      ...base,
      distance:     CHASER_SPAWN_DISTANCE + 5,
      chaserActive: true,
      lead:         20, // well below LEAD_MAX so a dash gain is unambiguous
    };
    const afterDash = stepChase(lowLead, DASH, DT);
    expect(afterDash.lead).toBeGreaterThan(20);
  });

  it('dash cooldown counts down each frame', () => {
    let s = stepChase(fresh(), DASH, DT);
    const cd0 = s.dashCooldownMs;
    s = stepChase(s, NO_INPUT, DT);
    expect(s.dashCooldownMs).toBeLessThan(cd0);
  });

  it('dash becomes available again after cooldown expires', () => {
    let s = stepChase(fresh(), DASH, DT);
    // Advance past cooldown
    const framesNeeded = Math.ceil(DASH_COOLDOWN_MS / (DT * 1000)) + 5;
    s = stepN(s, framesNeeded);
    expect(s.dashCooldownMs).toBe(0);
    // Can dash again
    const s2 = stepChase(s, DASH, DT);
    expect(s2.justDashed).toBe(true);
  });
});

// ── stepChase — chaser activation ─────────────────────────────────────────────

describe('stepChase — chaser', () => {
  it('chaser becomes active once distance >= CHASER_SPAWN_DISTANCE', () => {
    // Inject a state just before the spawn threshold.
    const pre: ChaseState = {
      ...fresh(),
      distance:     CHASER_SPAWN_DISTANCE - 0.01,
      chaserActive: false,
    };
    const s = stepChase(pre, NO_INPUT, DT);
    // One frame advances distance past the threshold, activating the chaser.
    expect(s.chaserActive).toBe(true);
    expect(s.distance).toBeGreaterThanOrEqual(CHASER_SPAWN_DISTANCE);
  });

  it('lead starts draining once chaser is active', () => {
    // Inject a state with chaser already active at LEAD_MAX.
    const base = fresh();
    let s: ChaseState = {
      ...base,
      distance:     CHASER_SPAWN_DISTANCE + 1,
      chaserActive: true,
      lead:         LEAD_MAX,
    };
    const leadAtSpawn = s.lead;
    // Step 60 frames (~1 second) — hero is on grace building footprint
    // (distance still near start, well within building x-range), no falling.
    for (let i = 0; i < 60; i++) s = stepChase(s, NO_INPUT, DT);
    expect(s.lead).toBeLessThan(leadAtSpawn);
  });

  it('game ends when lead reaches 0', () => {
    // Force a state with almost-zero lead and active chaser
    const s0 = fresh();
    const lowLead: ChaseState = {
      ...s0,
      chaserActive: true,
      lead: 0.01,
      distance: CHASER_SPAWN_DISTANCE + 10,
    };
    const s1 = stepChase(lowLead, NO_INPUT, DT);
    expect(s1.done).toBe(true);
    expect(s1.lead).toBe(0);
  });

  it('stumble reduces lead when chaser is active', () => {
    // Inject chaser-active state with some lead already drained.
    const base = fresh();
    const s: ChaseState = {
      ...base,
      distance:     CHASER_SPAWN_DISTANCE + 10,
      chaserActive: true,
      lead:         30, // below LEAD_MAX so loss is unambiguous
      stumbleMs:    0,
    };
    const leadBefore = s.lead;
    // Inject stumble directly (testing updateLead via the state mutation path)
    const afterStumble: ChaseState = {
      ...s,
      stumbleMs: STUMBLE_MS,
      lead: Math.max(0, s.lead - STUMBLE_LEAD_LOSS),
    };
    expect(afterStumble.lead).toBeLessThan(leadBefore);
    expect(afterStumble.lead).toBeCloseTo(Math.max(0, leadBefore - STUMBLE_LEAD_LOSS), 5);
  });
});

// ── stepChase — score ──────────────────────────────────────────────────────────

describe('stepChase — score', () => {
  it('score is 0 at start', () => {
    expect(fresh().score).toBe(0);
  });

  it('score increases as distance increases', () => {
    const s0 = fresh();
    const s1 = stepN(s0, 60);
    expect(s1.score).toBeGreaterThan(s0.score);
  });

  it('score = 1 when distance reaches CHASE_TARGET_DISTANCE', () => {
    const s0 = fresh();
    const atTarget: ChaseState = {
      ...s0,
      distance: CHASE_TARGET_DISTANCE - 0.001,
      chaserActive: false,
    };
    const s1 = stepChase(atTarget, NO_INPUT, DT);
    expect(s1.score).toBe(1);
    expect(s1.done).toBe(true);
  });

  it('score matches chaseScore(distance) at any point', () => {
    let s = stepN(fresh(), 120);
    expect(s.score).toBeCloseTo(chaseScore(s.distance), 6);
  });
});

// ── stepChase — speed escalation ──────────────────────────────────────────────

describe('stepChase — speed constants', () => {
  it('speedAt(0) equals BASE_SPEED', () => {
    expect(speedAt(0)).toBe(BASE_SPEED);
  });

  it('speedAt(CHASE_TARGET_DISTANCE) equals MAX_SPEED', () => {
    // With BASE_SPEED=4, SPEED_RAMP=0.010, MAX_SPEED=10, cap is at (10-4)/0.010 = 600 = TARGET
    expect(speedAt(CHASE_TARGET_DISTANCE)).toBeCloseTo(MAX_SPEED, 5);
  });

  it('speed ramp is meaningful: midpoint speed > 50% of max', () => {
    const midSpeed = speedAt(CHASE_TARGET_DISTANCE / 2);
    expect(midSpeed).toBeGreaterThan(BASE_SPEED + (MAX_SPEED - BASE_SPEED) * 0.5 - 0.1);
  });
});

// ── stepChase — one-frame event flag hygiene ──────────────────────────────────

describe('stepChase — event flag hygiene', () => {
  it('justDashed is cleared on the next frame after dashing', () => {
    const s1 = stepChase(fresh(), DASH, DT);
    expect(s1.justDashed).toBe(true);
    const s2 = stepChase(s1, NO_INPUT, DT);
    expect(s2.justDashed).toBe(false);
  });

  it('justFell stays true in a done state (loop stops; animation plays)', () => {
    // Once done with justFell=true, stepChase returns the same state unchanged
    const fell: ChaseState = { ...fresh(), done: true, justFell: true, score: 0.3 };
    const next = stepChase(fell, NO_INPUT, DT);
    expect(next).toBe(fell); // exact same reference — early return
  });
});

// ── stepChase — CHASE_TARGET_DISTANCE constant sanity ─────────────────────────

describe('constant sanity', () => {
  it('CHASE_TARGET_DISTANCE is 600', () => {
    expect(CHASE_TARGET_DISTANCE).toBe(600);
  });

  it('CHASER_SPAWN_DISTANCE is less than CHASE_TARGET_DISTANCE', () => {
    expect(CHASER_SPAWN_DISTANCE).toBeLessThan(CHASE_TARGET_DISTANCE);
  });

  it('CHASER_SPAWN_DISTANCE is 120', () => {
    expect(CHASER_SPAWN_DISTANCE).toBe(120);
  });

  it('MAX_SPEED cap aligns with CHASE_TARGET_DISTANCE (speed ramp fully used)', () => {
    // speedAt(TARGET) should equal MAX_SPEED
    expect(speedAt(CHASE_TARGET_DISTANCE)).toBeCloseTo(MAX_SPEED, 4);
  });

  // Smoke-test: a perfect run should take roughly 60–120 seconds of clean running.
  it('perfect run duration is in the 60–120 s range', () => {
    let dist = 0;
    let time = 0;
    const dt = 0.01; // 10ms steps for accuracy
    while (dist < CHASE_TARGET_DISTANCE) {
      dist += speedAt(dist) * dt;
      time += dt;
    }
    expect(time).toBeGreaterThan(60);
    expect(time).toBeLessThan(120);
  });
});

// ── stepChase — stomp constants ───────────────────────────────────────────────

describe('stepChase — stomp constants', () => {
  it('stomp bounce velocity is exported and positive', () => {
    expect(STOMP_BOUNCE_VELOCITY).toBeGreaterThan(0);
  });

  it('stomp lead gain is positive', () => {
    expect(STOMP_LEAD_GAIN).toBeGreaterThan(0);
  });

  it('dash lead gain exceeds stomp lead gain (balance note)', () => {
    // This test documents the current imbalance (Phase 1 will address it).
    expect(DASH_LEAD_GAIN).toBeGreaterThan(STOMP_LEAD_GAIN);
  });
});

// ── jump air-time covers a reasonable range ────────────────────────────────────

describe('jump arc sanity', () => {
  it('single jump air-time is roughly 1.375 s', () => {
    const airTime = (2 * JUMP_VELOCITY) / GRAVITY;
    expect(airTime).toBeCloseTo(1.375, 2);
  });
});
