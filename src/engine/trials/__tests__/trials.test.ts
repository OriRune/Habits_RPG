import { describe, it, expect } from 'vitest';
import { trialReward, scoreToStars, TRIALS, TRIALS_UNLOCK_LEVEL, emptyTrialsClearedOn, emptyBestTrialScore } from '../trials';
import {
  generateAttacks,
  lastStandScore,
  reactionSpeed,
  reactionRating,
  blockWindowForWave,
  seededRng as lastStandRng,
  TOTAL_WAVES,
  ATTACKS_PER_WAVE,
  BLOCK_WINDOW_BY_WAVE,
  SPAWN_AHEAD_MS,
  WAVE_INTERVAL_MS,
  DIRECTIONS,
  REACTION_PERFECT,
  REACTION_GOOD,
} from '../lastStand';
import {
  lockpickingScore,
  generateLocks,
  allowedTurn,
  canOpen,
  breakTime,
  lockTolerance,
  NUM_LOCKS,
  PICK_BUDGET,
  BASE_TOLERANCE_DEG,
  BASE_OPEN_TOLERANCE_DEG,
} from '../lockpicking';
import {
  chaseScore,
  generateCourse,
  buildingAt,
  nextBuilding,
  hasFallen,
  speedAt,
  updateLead,
  resolveContact,
  jumpAirTime,
  maxClearableGap,
  CHASE_TARGET_DISTANCE,
  BASE_SPEED,
  MAX_SPEED,
  LEAD_MAX,
  LEAD_START,
  STUMBLE_LEAD_LOSS,
  STOMP_LEAD_GAIN,
  CHASER_SPAWN_DISTANCE,
  CHASER_GAIN_PER_SEC,
  DASH_LEAD_GAIN,
  BUILDING_COUNT,
  ROOF_LEVELS,
  MAX_JUMPS,
  SLIDE_MS,
} from '../rooftopChase';
import { armoryScore, armoryAccuracy, ARMORY_LOCKS, SWEET_ZONE_START, SWEET_ZONE_END, SWEET_ZONE_WIDTH } from '../armoryBreak';
import { marchStep, marchScore, marchStartStamina, generateTerrain, MARCH_TILES, MARCH_START_STA, MARCH_MAX_DISTANCE } from '../longMarch';
import {
  generateSequence, libraryScore, buildShowSchedule, glyphShowMs, seededRng as alSeededRng, dailySeed,
  LIBRARY_MAX_ROUNDS, LIBRARY_START_LENGTH, GLYPH_SHOW_MS_BASE, GLYPH_SHOW_MS_MIN,
  KN_HINT_THRESHOLD, KN_HINT_THRESHOLD_2, GLYPHS,
} from '../ancientLibrary';

// ── Deterministic RNG helpers ──────────────────────────────────────────────────

function seededRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

// ── trialReward ────────────────────────────────────────────────────────────────

describe('trialReward', () => {
  it('returns positive gold and statXp for the correct stat', () => {
    const r = trialReward('DX', 1, 5);
    expect(r.gold).toBeGreaterThan(0);
    expect(r.statXp?.DX).toBeGreaterThan(0);
  });

  it('scales up with score: full-score > half-score > zero-score', () => {
    const full = trialReward('ST', 1, 10);
    const half = trialReward('ST', 0.5, 10);
    const zero = trialReward('ST', 0, 10);
    expect(full.gold!).toBeGreaterThan(half.gold!);
    expect(half.gold!).toBeGreaterThan(zero.gold!);
    expect(full.statXp!.ST!).toBeGreaterThan(half.statXp!.ST!);
  });

  it('has a participation floor: score=0 still gives >0 gold', () => {
    const r = trialReward('EN', 0, 1);
    expect(r.gold).toBeGreaterThan(0);
    expect(r.statXp?.EN).toBeGreaterThan(0);
  });

  it('scales with level', () => {
    const low = trialReward('WI', 1, 1);
    const high = trialReward('WI', 1, 20);
    expect(high.gold!).toBeGreaterThan(low.gold!);
  });

  it('clamps score to [0,1]', () => {
    const over = trialReward('KN', 2, 5);
    const exact = trialReward('KN', 1, 5);
    expect(over.gold).toEqual(exact.gold);
    const under = trialReward('KN', -1, 5);
    const floor = trialReward('KN', 0, 5);
    expect(under.gold).toEqual(floor.gold);
  });
});

// ── scoreToStars ───────────────────────────────────────────────────────────────

describe('scoreToStars', () => {
  it('returns 3 stars at 0.75', () => expect(scoreToStars(0.75)).toBe(3));
  it('returns 3 stars at 1.0', () => expect(scoreToStars(1)).toBe(3));
  it('returns 2 stars at 0.40', () => expect(scoreToStars(0.4)).toBe(2));
  it('returns 2 stars at 0.74', () => expect(scoreToStars(0.74)).toBe(2));
  it('returns 1 star below 0.40', () => expect(scoreToStars(0.39)).toBe(1));
  it('returns 1 star at 0', () => expect(scoreToStars(0)).toBe(1));
});

// ── TRIALS registry ────────────────────────────────────────────────────────────

describe('TRIALS', () => {
  it('has 8 entries', () => expect(TRIALS).toHaveLength(8));
  it('each trial has a unique id and stat', () => {
    const ids = new Set(TRIALS.map((t) => t.id));
    const stats = new Set(TRIALS.map((t) => t.stat));
    expect(ids.size).toBe(8);
    expect(stats.size).toBe(8);
  });
  it('unlock level is at least 1', () => expect(TRIALS_UNLOCK_LEVEL).toBeGreaterThanOrEqual(1));
});

// ── empty records ──────────────────────────────────────────────────────────────

describe('emptyTrialsClearedOn', () => {
  it('has a key for every trial id', () => {
    const rec = emptyTrialsClearedOn();
    for (const t of TRIALS) expect(rec[t.id]).toBe('');
  });
});

describe('emptyBestTrialScore', () => {
  it('initialises all to 0', () => {
    const rec = emptyBestTrialScore();
    for (const t of TRIALS) expect(rec[t.id]).toBe(0);
  });
});

// ── Lockpicking ────────────────────────────────────────────────────────────────

describe('lockpicking', () => {
  it('generateLocks returns NUM_LOCKS configs with sweet spots inside [0,180]', () => {
    const locks = generateLocks(seededRng(), 1);
    expect(locks).toHaveLength(NUM_LOCKS);
    for (const l of locks) {
      expect(l.sweetSpotDeg).toBeGreaterThanOrEqual(0);
      expect(l.sweetSpotDeg).toBeLessThanOrEqual(180);
      expect(l.toleranceDeg).toBeGreaterThan(0);
      expect(l.openToleranceDeg).toBeGreaterThan(0);
      expect(l.openToleranceDeg).toBeLessThanOrEqual(l.toleranceDeg);
    }
  });

  it('locks have narrowing tolerance across difficulty progression', () => {
    const locks = generateLocks(seededRng(), 1);
    expect(locks[0].toleranceDeg).toBeGreaterThan(locks[1].toleranceDeg);
    expect(locks[1].toleranceDeg).toBeGreaterThan(locks[2].toleranceDeg);
  });

  it('lockTolerance widens with level', () => {
    const low = lockTolerance(0, 1);
    const high = lockTolerance(0, 10);
    expect(high.toleranceDeg).toBeGreaterThan(low.toleranceDeg);
    expect(high.openToleranceDeg).toBeGreaterThan(low.openToleranceDeg);
  });

  it('lockTolerance base matches BASE_TOLERANCE_DEG at level 1', () => {
    const t = lockTolerance(0, 1);
    expect(t.toleranceDeg).toBeCloseTo(BASE_TOLERANCE_DEG[0], 5);
    expect(t.openToleranceDeg).toBeCloseTo(BASE_OPEN_TOLERANCE_DEG[0], 5);
  });

  it('allowedTurn is 1 exactly at the sweet spot', () => {
    const lock = { sweetSpotDeg: 90, toleranceDeg: 20, openToleranceDeg: 6 };
    expect(allowedTurn(90, lock)).toBe(1);
  });

  it('allowedTurn is 1 within openToleranceDeg', () => {
    const lock = { sweetSpotDeg: 90, toleranceDeg: 20, openToleranceDeg: 6 };
    expect(allowedTurn(94, lock)).toBe(1); // within 6°
    expect(allowedTurn(86, lock)).toBe(1);
  });

  it('allowedTurn is 0 at or beyond toleranceDeg', () => {
    const lock = { sweetSpotDeg: 90, toleranceDeg: 20, openToleranceDeg: 6 };
    expect(allowedTurn(110, lock)).toBe(0); // exactly at edge
    expect(allowedTurn(130, lock)).toBe(0); // well beyond
  });

  it('allowedTurn decreases linearly between openTol and tol', () => {
    const lock = { sweetSpotDeg: 90, toleranceDeg: 20, openToleranceDeg: 6 };
    const mid = allowedTurn(97, lock); // 7° from sweet spot, midway in [6,20]
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('canOpen is true within openToleranceDeg', () => {
    const lock = { sweetSpotDeg: 90, toleranceDeg: 20, openToleranceDeg: 6 };
    expect(canOpen(90, lock)).toBe(true);
    expect(canOpen(95, lock)).toBe(true);
    expect(canOpen(85, lock)).toBe(true);
  });

  it('canOpen is false outside openToleranceDeg', () => {
    const lock = { sweetSpotDeg: 90, toleranceDeg: 20, openToleranceDeg: 6 };
    expect(canOpen(97, lock)).toBe(false);
    expect(canOpen(50, lock)).toBe(false);
  });

  it('breakTime is longer closer to sweet spot', () => {
    const lock = { sweetSpotDeg: 90, toleranceDeg: 20, openToleranceDeg: 6 };
    const close = breakTime(97, lock, 0);  // just outside open zone
    const far = breakTime(115, lock, 0);   // well outside tolerance
    expect(close).toBeGreaterThan(far);
  });

  it('lockTolerance widens with DX level', () => {
    const noDx = lockTolerance(0, 1, 0);
    const withDx = lockTolerance(0, 1, 10);
    expect(withDx.toleranceDeg).toBeGreaterThan(noDx.toleranceDeg);
    expect(withDx.openToleranceDeg).toBeGreaterThan(noDx.openToleranceDeg);
  });

  it('lockpickingScore: all locks + full picks = 1.0', () => {
    expect(lockpickingScore(NUM_LOCKS, PICK_BUDGET)).toBe(1);
  });

  it('lockpickingScore: all locks + 0 picks = 0.5 (floor)', () => {
    expect(lockpickingScore(NUM_LOCKS, 0)).toBeCloseTo(0.5, 5);
  });

  it('lockpickingScore: all locks + 1 pick = linear interpolation above 0.5', () => {
    const s = lockpickingScore(NUM_LOCKS, 1);
    expect(s).toBeCloseTo(0.5 + 0.5 * 1 / PICK_BUDGET, 5);
  });

  it('lockpickingScore: all locks + some picks ∈ (0.5, 1)', () => {
    const s = lockpickingScore(NUM_LOCKS, Math.floor(PICK_BUDGET / 2));
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
  });

  it('lockpickingScore: 0 locks, 0 picks = 0 (< 0.4, 1★)', () => {
    expect(lockpickingScore(0, 0)).toBe(0);
  });

  it('lockpickingScore: partial failure < 0.4', () => {
    expect(lockpickingScore(1, 0)).toBeLessThan(0.4);
    expect(lockpickingScore(2, 0)).toBeLessThan(0.4);
  });
});

// ── Rooftop Chase ──────────────────────────────────────────────────────────────

describe('rooftopChase', () => {
  // ── generateCourse ──────────────────────────────────────────────────────────
  it('generateCourse returns BUILDING_COUNT buildings', () => {
    expect(generateCourse(seededRng())).toHaveLength(BUILDING_COUNT);
  });

  it('generateCourse is deterministic for the same seed', () => {
    const a = generateCourse(seededRng(99));
    const b = generateCourse(seededRng(99));
    expect(a).toEqual(b);
  });

  it('buildings are sorted by x (ascending, non-overlapping)', () => {
    const bs = generateCourse(seededRng());
    for (let i = 1; i < bs.length; i++) {
      expect(bs[i].x).toBeGreaterThan(bs[i - 1].x + bs[i - 1].width);
    }
  });

  it('all buildings have positive width', () => {
    for (const b of generateCourse(seededRng())) {
      expect(b.width).toBeGreaterThan(0);
    }
  });

  it('all roofY values are in ROOF_LEVELS', () => {
    const levelsSet = new Set(ROOF_LEVELS);
    for (const b of generateCourse(seededRng())) {
      expect(levelsSet.has(b.roofY as 0 | 2.5 | 5)).toBe(true);
    }
  });

  it('adjacent buildings differ by at most one ROOF_LEVEL step', () => {
    const bs = generateCourse(seededRng());
    const step = ROOF_LEVELS[1] - ROOF_LEVELS[0]; // 2.5
    for (let i = 1; i < bs.length; i++) {
      expect(Math.abs(bs[i].roofY - bs[i - 1].roofY)).toBeLessThanOrEqual(step + 0.01);
    }
  });

  it('first building starts at x = 0', () => {
    expect(generateCourse(seededRng())[0].x).toBe(0);
  });

  it('first building has roofY = 0', () => {
    expect(generateCourse(seededRng())[0].roofY).toBe(0);
  });

  it('all prop kinds are known prop types', () => {
    // 'crossbowman' was added in Phase E as a second slide-required obstacle.
    const valid = new Set<string>(['hazard', 'mook', 'lowbar', 'crossbowman']);
    for (const b of generateCourse(seededRng())) {
      for (const p of b.props) {
        expect(valid.has(p.kind)).toBe(true);
      }
    }
  });

  it('all props have positive width and sit within their building', () => {
    for (const b of generateCourse(seededRng())) {
      for (const p of b.props) {
        expect(p.width).toBeGreaterThan(0);
        expect(p.x).toBeGreaterThanOrEqual(b.x);
        expect(p.x + p.width).toBeLessThanOrEqual(b.x + b.width);
      }
    }
  });

  it('gap between consecutive buildings is <= maxClearableGap at the gap start', () => {
    const bs = generateCourse(seededRng());
    for (let i = 1; i < bs.length; i++) {
      const gapStart = bs[i - 1].x + bs[i - 1].width;
      const gapWidth = bs[i].x - gapStart;
      // Use the tightest clamp (upward gap); base clearable is always ≥ the upward one
      expect(gapWidth).toBeLessThanOrEqual(maxClearableGap(gapStart) + 0.01);
    }
  });

  // ── buildingAt ──────────────────────────────────────────────────────────────
  it('buildingAt returns the correct building when footX is on a roof', () => {
    const bs = generateCourse(seededRng());
    const b = bs[1]; // skip grace building
    const mid = b.x + b.width / 2;
    expect(buildingAt(bs, mid)).toBe(b);
  });

  it('buildingAt returns null when footX is over a gap', () => {
    const bs = generateCourse(seededRng());
    const gapX = bs[0].x + bs[0].width + 0.1; // just past the first building
    expect(buildingAt(bs, gapX)).toBeNull();
  });

  // ── nextBuilding ────────────────────────────────────────────────────────────
  it('nextBuilding returns the first building whose x is > footX', () => {
    const bs = generateCourse(seededRng());
    const gapX = bs[0].x + bs[0].width + 0.1;
    expect(nextBuilding(bs, gapX)).toBe(bs[1]);
  });

  it('nextBuilding returns null when past all buildings', () => {
    const bs = generateCourse(seededRng());
    const last = bs[bs.length - 1];
    expect(nextBuilding(bs, last.x + last.width + 100)).toBeNull();
  });

  // ── hasFallen ───────────────────────────────────────────────────────────────
  it('hasFallen is false when standing on a building', () => {
    const bs = generateCourse(seededRng());
    const mid = bs[0].x + bs[0].width / 2;
    expect(hasFallen(bs, mid, bs[0].roofY, 0)).toBe(false); // vy=0: standing
  });

  it('hasFallen is false when airborne over a gap but above the next roof', () => {
    const bs = generateCourse(seededRng());
    const gapX = bs[0].x + bs[0].width + 0.5;
    const nextRoof = bs[1].roofY;
    expect(hasFallen(bs, gapX, nextRoof + 1, -5)).toBe(false); // above next roof top
  });

  it('hasFallen is true when over a gap and below the next roof top', () => {
    const bs = generateCourse(seededRng());
    const gapX = bs[0].x + bs[0].width + 0.5;
    const nextRoof = bs[1].roofY;
    // gapX is 0.5wu into the gap; leading edge = gapX + HERO_HITBOX_W is still short
    // of bs[1].x (gapMin = 3 > HERO_HITBOX_W), so no ledge-catch fires.
    expect(hasFallen(bs, gapX, nextRoof - 0.5, -5)).toBe(true); // below next roof top
  });

  // ── speedAt ─────────────────────────────────────────────────────────────────
  it('speedAt starts at BASE_SPEED at distance 0', () => {
    expect(speedAt(0)).toBeCloseTo(BASE_SPEED, 5);
  });

  it('speedAt is monotonically non-decreasing', () => {
    const ds = [0, 50, 100, 150, 200, 300];
    for (let i = 1; i < ds.length; i++) {
      expect(speedAt(ds[i])).toBeGreaterThanOrEqual(speedAt(ds[i - 1]));
    }
  });

  it('speedAt is capped at MAX_SPEED', () => {
    expect(speedAt(100000)).toBe(MAX_SPEED);
  });

  // ── updateLead ──────────────────────────────────────────────────────────────
  it('updateLead returns LEAD_MAX when inactive (before spawn)', () => {
    expect(updateLead(20, 1, false)).toBe(LEAD_MAX);
    expect(updateLead(0, 5, false)).toBe(LEAD_MAX);
  });

  it('updateLead drains lead when active over time', () => {
    const next = updateLead(LEAD_MAX, 1, true);
    expect(next).toBeLessThan(LEAD_MAX);
    expect(next).toBeCloseTo(LEAD_MAX - CHASER_GAIN_PER_SEC, 4);
  });

  it('updateLead stumble reduces lead when active', () => {
    const next = updateLead(LEAD_START, 0, true, 'stumble');
    expect(next).toBeLessThan(LEAD_START);
    expect(next).toBeCloseTo(Math.max(0, LEAD_START - STUMBLE_LEAD_LOSS), 5);
  });

  it('updateLead stomp increases lead when active', () => {
    const start = 30; // below LEAD_MAX so the gain is visible
    const next = updateLead(start, 0, true, 'stomp');
    expect(next).toBeGreaterThan(start);
    expect(next).toBeCloseTo(Math.min(LEAD_MAX, start + STOMP_LEAD_GAIN), 5);
  });

  it('updateLead dash increases lead when active', () => {
    const next = updateLead(20, 0, true, 'dash');
    expect(next).toBeGreaterThan(20);
    expect(next).toBeCloseTo(Math.min(LEAD_MAX, 20 + DASH_LEAD_GAIN), 5);
  });

  it('updateLead is clamped to [0, LEAD_MAX]', () => {
    expect(updateLead(0, 0, true, 'stumble')).toBe(0);
    expect(updateLead(LEAD_MAX, 0, true, 'stomp')).toBe(LEAD_MAX);
    expect(updateLead(LEAD_MAX, 0, true, 'dash')).toBe(LEAD_MAX);
  });

  it('CHASER_SPAWN_DISTANCE is a positive distance before TARGET', () => {
    expect(CHASER_SPAWN_DISTANCE).toBeGreaterThan(0);
    expect(CHASER_SPAWN_DISTANCE).toBeLessThan(CHASE_TARGET_DISTANCE);
  });

  // ── resolveContact (5-arg: heroY, heroVy, sliding, prop, roofY) ────────────
  it('resolveContact: grounded on hazard at roofY=0 = stumble', () => {
    const p = { id: 0, kind: 'hazard' as const, x: 10, width: 3 };
    expect(resolveContact(0, 0, false, p, 0)).toBe('stumble');
  });

  it('resolveContact: airborne over hazard at roofY=0 = clear', () => {
    const p = { id: 0, kind: 'hazard' as const, x: 10, width: 3 };
    expect(resolveContact(5, -1, false, p, 0)).toBe('clear');
  });

  it('resolveContact: grounded on hazard at elevated roofY = stumble', () => {
    const p = { id: 0, kind: 'hazard' as const, x: 10, width: 3 };
    expect(resolveContact(2.5, 0, false, p, 2.5)).toBe('stumble');
  });

  it('resolveContact: airborne over hazard at elevated roofY = clear', () => {
    const p = { id: 0, kind: 'hazard' as const, x: 10, width: 3 };
    expect(resolveContact(7, -1, false, p, 2.5)).toBe('clear');
  });

  it('resolveContact: descending onto mook head at roofY=0 = stomp', () => {
    const p = { id: 2, kind: 'mook' as const, x: 10, width: 2.5 };
    // heroY = 4 (airborne), heroVy = -2 (falling) — within stomp window above mook top
    expect(resolveContact(4, -2, false, p, 0)).toBe('stomp');
  });

  it('resolveContact: descending onto mook head at elevated roofY = stomp', () => {
    const p = { id: 2, kind: 'mook' as const, x: 10, width: 2.5 };
    // roofY=2.5, mookTop = 2.5 + 4 = 6.5, heroY=7 (within stomp window above mookTop)
    expect(resolveContact(7, -2, false, p, 2.5)).toBe('stomp');
  });

  it('resolveContact: grounded into mook side at roofY=0 = stumble', () => {
    const p = { id: 2, kind: 'mook' as const, x: 10, width: 2.5 };
    expect(resolveContact(0, 0, false, p, 0)).toBe('stumble');
  });

  it('resolveContact: lowbar not sliding at roofY=0 = stumble (grounded)', () => {
    const p = { id: 3, kind: 'lowbar' as const, x: 10, width: 4 };
    expect(resolveContact(0, 0, false, p, 0)).toBe('stumble');
  });

  it('resolveContact: lowbar not sliding at roofY=0 = stumble (airborne)', () => {
    const p = { id: 3, kind: 'lowbar' as const, x: 10, width: 4 };
    expect(resolveContact(3, 1, false, p, 0)).toBe('stumble');
  });

  it('resolveContact: lowbar sliding at roofY=0 = clear', () => {
    const p = { id: 3, kind: 'lowbar' as const, x: 10, width: 4 };
    expect(resolveContact(0, 0, true, p, 0)).toBe('clear');
  });

  it('resolveContact: lowbar sliding at elevated roofY = clear', () => {
    const p = { id: 3, kind: 'lowbar' as const, x: 10, width: 4 };
    expect(resolveContact(2.5, 0, true, p, 2.5)).toBe('clear');
  });

  // ── jumpAirTime / maxClearableGap ────────────────────────────────────────────
  it('jumpAirTime returns a value > 1 s with current physics', () => {
    expect(jumpAirTime()).toBeGreaterThan(1.0);
  });

  it('MAX_JUMPS is 2 (double-jump enabled)', () => {
    expect(MAX_JUMPS).toBe(2);
  });

  it('SLIDE_MS is a positive duration', () => {
    expect(SLIDE_MS).toBeGreaterThan(0);
  });

  // ── chaseScore ───────────────────────────────────────────────────────────────
  it('chaseScore(0) = 0', () => {
    expect(chaseScore(0)).toBe(0);
  });

  it('chaseScore(TARGET) = 1', () => {
    expect(chaseScore(CHASE_TARGET_DISTANCE)).toBe(1);
  });

  it('chaseScore(TARGET/2) ≈ 0.5', () => {
    expect(chaseScore(CHASE_TARGET_DISTANCE / 2)).toBeCloseTo(0.5, 5);
  });

  it('chaseScore is clamped at 1 for distance > TARGET', () => {
    expect(chaseScore(CHASE_TARGET_DISTANCE * 2)).toBe(1);
  });

  it('chaseScore negative distance returns 0', () => {
    expect(chaseScore(-10)).toBe(0);
  });
});

// ── Armory Break ───────────────────────────────────────────────────────────────

describe('armoryBreak', () => {
  const centre = SWEET_ZONE_START + SWEET_ZONE_WIDTH / 2;

  it('armoryAccuracy is 1 at zone centre', () => {
    expect(armoryAccuracy(centre)).toBeCloseTo(1, 5);
  });

  it('armoryAccuracy is 0 below the zone', () => {
    expect(armoryAccuracy(SWEET_ZONE_START - 0.01)).toBe(0);
    expect(armoryAccuracy(0)).toBe(0);
  });

  it('armoryAccuracy is 0 above the zone (overshoot = miss)', () => {
    expect(armoryAccuracy(SWEET_ZONE_END + 0.01)).toBe(0);
    expect(armoryAccuracy(1.0)).toBe(0);
  });

  it('armoryAccuracy is 0 at zone edges', () => {
    expect(armoryAccuracy(SWEET_ZONE_START)).toBeCloseTo(0, 5);
    expect(armoryAccuracy(SWEET_ZONE_END)).toBeCloseTo(0, 5);
  });

  it('armoryAccuracy is between 0 and 1 inside the zone', () => {
    const acc = armoryAccuracy(centre - SWEET_ZONE_WIDTH * 0.2);
    expect(acc).toBeGreaterThan(0);
    expect(acc).toBeLessThan(1);
  });

  it('armoryScore: all perfect = 1', () => {
    expect(armoryScore([1, 1, 1])).toBe(1);
  });

  it('armoryScore: all missed = 0', () => {
    expect(armoryScore([0, 0, 0])).toBe(0);
  });

  it('armoryScore: empty = 0', () => {
    expect(armoryScore([])).toBe(0);
  });

  it('armoryScore divides by ARMORY_LOCKS (not num hits)', () => {
    expect(armoryScore([1, 0, 0])).toBeCloseTo(1 / ARMORY_LOCKS, 5);
  });
});

// ── Long March ─────────────────────────────────────────────────────────────────

describe('longMarch', () => {
  it('generateTerrain returns MARCH_TILES tiles', () => {
    const tiles = generateTerrain(seededRng());
    expect(tiles).toHaveLength(MARCH_TILES);
  });

  it('terrain kinds are valid', () => {
    const valid = new Set(['clear', 'rough', 'mud', 'spring']);
    for (const tile of generateTerrain(seededRng())) {
      expect(valid.has(tile.kind)).toBe(true);
    }
  });

  it('walk on clear gives +1 distance, -1 stamina', () => {
    const result = marchStep({ kind: 'clear', label: 'Clear Path', emoji: '🌄' }, 'walk');
    expect(result.distanceDelta).toBe(1);
    expect(result.staminaDelta).toBe(-1);
  });

  it('rest restores 2 stamina on clear', () => {
    const result = marchStep({ kind: 'clear', label: 'Clear Path', emoji: '🌄' }, 'rest');
    expect(result.distanceDelta).toBe(0);
    expect(result.staminaDelta).toBe(2);
  });

  it('push gives +2 distance on clear', () => {
    const result = marchStep({ kind: 'clear', label: 'Clear Path', emoji: '🌄' }, 'push');
    expect(result.distanceDelta).toBe(2);
    expect(result.staminaDelta).toBeLessThan(0);
  });

  it('mud reduces distance on walk', () => {
    const result = marchStep({ kind: 'mud', label: 'Muddy Track', emoji: '💧' }, 'walk');
    expect(result.distanceDelta).toBe(0);
  });

  it('rest gives +6 stamina on spring (not full restore)', () => {
    const result = marchStep({ kind: 'spring', label: 'Mountain Spring', emoji: '✨' }, 'rest');
    expect(result.staminaDelta).toBe(6);
    expect(result.distanceDelta).toBe(0);
  });

  it('walk on spring gives positive stamina', () => {
    const result = marchStep({ kind: 'spring', label: 'Mountain Spring', emoji: '✨' }, 'walk');
    expect(result.staminaDelta).toBeGreaterThan(0);
    expect(result.distanceDelta).toBe(1);
  });

  it('push on spring gives positive stamina', () => {
    const result = marchStep({ kind: 'spring', label: 'Mountain Spring', emoji: '✨' }, 'push');
    expect(result.staminaDelta).toBeGreaterThan(0);
    expect(result.distanceDelta).toBe(2);
  });

  it('marchScore: full completion + max distance = 1', () => {
    expect(marchScore(MARCH_TILES, MARCH_MAX_DISTANCE)).toBe(1);
  });

  it('marchScore: full completion + zero distance = 0.70', () => {
    expect(marchScore(MARCH_TILES, 0)).toBeCloseTo(0.7, 5);
  });

  it('marchScore: half tiles + half distance = 0.5', () => {
    expect(marchScore(MARCH_TILES / 2, MARCH_MAX_DISTANCE / 2)).toBeCloseTo(0.5, 5);
  });

  it('marchScore: capped at 1', () => {
    expect(marchScore(MARCH_TILES + 5, MARCH_MAX_DISTANCE + 10)).toBe(1);
  });

  it('marchStartStamina: EN 0 returns base', () => {
    expect(marchStartStamina(0)).toBe(MARCH_START_STA);
  });

  it('marchStartStamina: EN 3 returns base + 1', () => {
    expect(marchStartStamina(3)).toBe(MARCH_START_STA + 1);
  });

  it('marchStartStamina: high EN caps at base + 6', () => {
    expect(marchStartStamina(100)).toBe(MARCH_START_STA + 6);
  });
});

// ── Ancient Library ────────────────────────────────────────────────────────────

describe('ancientLibrary', () => {
  const maxLen = LIBRARY_START_LENGTH + LIBRARY_MAX_ROUNDS - 1;

  it('generateSequence produces max-length array of valid glyphs', () => {
    const seq = generateSequence(seededRng());
    expect(seq).toHaveLength(maxLen);
    const validSet = new Set(GLYPHS);
    for (const g of seq) expect(validSet.has(g)).toBe(true);
  });

  it('generateSequence is deterministic for the same seed', () => {
    const a = generateSequence(seededRng(123));
    const b = generateSequence(seededRng(123));
    expect(a).toEqual(b);
  });

  it('libraryScore: all rounds = 1', () => {
    expect(libraryScore(LIBRARY_MAX_ROUNDS)).toBe(1);
  });

  it('libraryScore: 0 rounds = 0', () => {
    expect(libraryScore(0)).toBe(0);
  });

  it('libraryScore: capped at 1', () => {
    expect(libraryScore(LIBRARY_MAX_ROUNDS + 2)).toBe(1);
  });

  it('libraryScore: half rounds ≈ 0.5', () => {
    expect(libraryScore(LIBRARY_MAX_ROUNDS / 2)).toBeCloseTo(0.5, 5);
  });

  // ── glyphShowMs ──────────────────────────────────────────────────────────────

  it('glyphShowMs: round 0 returns GLYPH_SHOW_MS_BASE', () => {
    expect(glyphShowMs(0)).toBe(GLYPH_SHOW_MS_BASE);
  });

  it('glyphShowMs: final round returns GLYPH_SHOW_MS_MIN', () => {
    expect(glyphShowMs(LIBRARY_MAX_ROUNDS - 1)).toBe(GLYPH_SHOW_MS_MIN);
  });

  it('glyphShowMs: monotonically non-increasing', () => {
    for (let r = 1; r < LIBRARY_MAX_ROUNDS; r++) {
      expect(glyphShowMs(r)).toBeLessThanOrEqual(glyphShowMs(r - 1));
    }
  });

  it('glyphShowMs: stays at minimum beyond max rounds', () => {
    expect(glyphShowMs(LIBRARY_MAX_ROUNDS + 5)).toBe(GLYPH_SHOW_MS_MIN);
  });

  // ── buildShowSchedule ────────────────────────────────────────────────────────

  it('buildShowSchedule: no KN returns identity schedule', () => {
    const sched = buildShowSchedule(5, 0, seededRng());
    expect(sched).toEqual([0, 1, 2, 3, 4]);
  });

  it('buildShowSchedule: KN below threshold returns identity schedule', () => {
    const sched = buildShowSchedule(5, KN_HINT_THRESHOLD - 1, seededRng());
    expect(sched).toEqual([0, 1, 2, 3, 4]);
  });

  it('buildShowSchedule: KN at threshold adds one duplicate', () => {
    const sched = buildShowSchedule(5, KN_HINT_THRESHOLD, seededRng());
    expect(sched).toHaveLength(6);
    // Every original index is still present
    for (let i = 0; i < 5; i++) expect(sched).toContain(i);
  });

  it('buildShowSchedule: KN at second threshold adds two duplicates', () => {
    const sched = buildShowSchedule(6, KN_HINT_THRESHOLD_2, seededRng());
    expect(sched).toHaveLength(8);
    for (let i = 0; i < 6; i++) expect(sched).toContain(i);
  });

  it('buildShowSchedule: short sequence returns identity regardless of KN', () => {
    const sched = buildShowSchedule(2, KN_HINT_THRESHOLD_2, seededRng());
    expect(sched).toEqual([0, 1]);
  });

  it('buildShowSchedule: hints come from the back half of the sequence', () => {
    // All duplicated indices should be >= midpoint
    const len = 6;
    const midpoint = Math.floor(len / 2);
    const sched = buildShowSchedule(len, KN_HINT_THRESHOLD, seededRng(42));
    const counts = new Array(len).fill(0);
    sched.forEach(i => counts[i]++);
    const duplicated = counts.map((c, i) => c > 1 ? i : -1).filter(i => i >= 0);
    expect(duplicated.every(i => i >= midpoint)).toBe(true);
  });

  // ── seededRng + dailySeed ────────────────────────────────────────────────────

  it('seededRng: same seed produces identical sequence', () => {
    const a = alSeededRng(99);
    const b = alSeededRng(99);
    const na = Array.from({ length: 10 }, () => a());
    const nb = Array.from({ length: 10 }, () => b());
    expect(na).toEqual(nb);
  });

  it('seededRng: different seeds produce different sequences', () => {
    const a = alSeededRng(1);
    const b = alSeededRng(2);
    expect(a()).not.toBe(b());
  });

  it('seededRng: values are in [0, 1)', () => {
    const rng = alSeededRng(7);
    for (let i = 0; i < 20; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('dailySeed: same date string returns same value', () => {
    expect(dailySeed('2026-06-18')).toBe(dailySeed('2026-06-18'));
  });

  it('dailySeed: different dates return different values', () => {
    expect(dailySeed('2026-06-18')).not.toBe(dailySeed('2026-06-19'));
  });

  it('dailySeed: produces a stable numeric seed from a known date', () => {
    expect(dailySeed('2026-06-18')).toBe(20260618);
  });
});

// ── Last Stand ─────────────────────────────────────────────────────────────────

describe('lastStand / lastStandRng', () => {
  it('returns values in [0, 1)', () => {
    const rng = lastStandRng(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = lastStandRng(99);
    const b = lastStandRng(99);
    for (let i = 0; i < 20; i++) expect(a()).toBeCloseTo(b(), 10);
  });

  it('produces different sequences for different seeds', () => {
    expect(lastStandRng(1)()).not.toEqual(lastStandRng(2)());
  });
});

describe('lastStand / generateAttacks', () => {
  it(`produces ${TOTAL_WAVES * ATTACKS_PER_WAVE} attacks`, () => {
    expect(generateAttacks(lastStandRng(1))).toHaveLength(TOTAL_WAVES * ATTACKS_PER_WAVE);
  });

  it('all directions are valid', () => {
    const valid = new Set(DIRECTIONS);
    for (const a of generateAttacks(lastStandRng(7))) {
      expect(valid.has(a.dir)).toBe(true);
    }
  });

  it('all results start null', () => {
    for (const a of generateAttacks(lastStandRng(3))) {
      expect(a.result).toBeNull();
    }
  });

  it('landing times are strictly increasing', () => {
    const attacks = generateAttacks(lastStandRng(5));
    for (let i = 1; i < attacks.length; i++) {
      expect(attacks[i].landMs).toBeGreaterThan(attacks[i - 1].landMs);
    }
  });

  it('first attack lands at SPAWN_AHEAD_MS', () => {
    expect(generateAttacks(lastStandRng(0))[0].landMs).toBe(SPAWN_AHEAD_MS);
  });

  it('last attack lands at the expected maximum time', () => {
    const expectedLast = (TOTAL_WAVES - 1) * WAVE_INTERVAL_MS
      + (ATTACKS_PER_WAVE - 1) * (WAVE_INTERVAL_MS / ATTACKS_PER_WAVE)
      + SPAWN_AHEAD_MS;
    const attacks = generateAttacks(lastStandRng(42));
    expect(attacks[attacks.length - 1].landMs).toBe(expectedLast);
  });

  it('each wave contains exactly ATTACKS_PER_WAVE attacks', () => {
    const attacks = generateAttacks(lastStandRng(9));
    for (let w = 0; w < TOTAL_WAVES; w++) {
      expect(attacks.filter(a => a.wave === w)).toHaveLength(ATTACKS_PER_WAVE);
    }
  });

  it('every wave has two different directions (variety guarantee)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const attacks = generateAttacks(lastStandRng(seed));
      for (let w = 0; w < TOTAL_WAVES; w++) {
        const dirs = attacks.filter(a => a.wave === w).map(a => a.dir);
        expect(new Set(dirs).size).toBe(ATTACKS_PER_WAVE);
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const a = generateAttacks(lastStandRng(55));
    const b = generateAttacks(lastStandRng(55));
    expect(a).toEqual(b);
  });

  it('attack ids are unique and sequential from 0', () => {
    const attacks = generateAttacks(lastStandRng(2));
    attacks.forEach((a, i) => expect(a.id).toBe(i));
  });
});

describe('lastStand / blockWindowForWave', () => {
  it('returns the correct value for each defined wave index', () => {
    BLOCK_WINDOW_BY_WAVE.forEach((expected, i) => {
      expect(blockWindowForWave(i)).toBe(expected);
    });
  });

  it('clamps to the last entry for out-of-bounds wave indexes', () => {
    const last = BLOCK_WINDOW_BY_WAVE[BLOCK_WINDOW_BY_WAVE.length - 1];
    expect(blockWindowForWave(999)).toBe(last);
  });

  it('block window never widens across waves', () => {
    for (let i = 1; i < BLOCK_WINDOW_BY_WAVE.length; i++) {
      expect(BLOCK_WINDOW_BY_WAVE[i]).toBeLessThanOrEqual(BLOCK_WINDOW_BY_WAVE[i - 1]);
    }
  });
});

describe('lastStand / reactionSpeed', () => {
  // landMs = 1400; SPAWN_AHEAD_MS = 1400 → spawn at ms 0
  const land = SPAWN_AHEAD_MS; // 1400

  it('blocked at spawn → 1.0', () => {
    expect(reactionSpeed(land, 0)).toBeCloseTo(1, 5);
  });

  it('blocked at landing → 0.0', () => {
    expect(reactionSpeed(land, land)).toBeCloseTo(0, 5);
  });

  it('blocked at midpoint → 0.5', () => {
    expect(reactionSpeed(land, land / 2)).toBeCloseTo(0.5, 5);
  });

  it('clamps to 0 if blocked past landing', () => {
    expect(reactionSpeed(land, land + 100)).toBe(0);
  });

  it('clamps to 1 if block time before spawn (negative margin would exceed SPAWN_AHEAD_MS)', () => {
    expect(reactionSpeed(land, -100)).toBe(1);
  });
});

describe('lastStand / reactionRating', () => {
  it('speed >= REACTION_PERFECT → "perfect"', () => {
    expect(reactionRating(REACTION_PERFECT)).toBe('perfect');
    expect(reactionRating(1.0)).toBe('perfect');
  });

  it('speed >= REACTION_GOOD but < REACTION_PERFECT → "good"', () => {
    expect(reactionRating(REACTION_GOOD)).toBe('good');
    expect(reactionRating(REACTION_PERFECT - 0.01)).toBe('good');
  });

  it('speed < REACTION_GOOD → "late"', () => {
    expect(reactionRating(0)).toBe('late');
    expect(reactionRating(REACTION_GOOD - 0.01)).toBe('late');
  });
});

describe('lastStand / lastStandScore', () => {
  it('zero resolved → 0 (no divide-by-zero)', () => expect(lastStandScore([], 0)).toBe(0));
  it('no blocks but attacks resolved → 0', () => expect(lastStandScore([], 16)).toBe(0));

  it('all blocked at spawn → 1', () => {
    // 16 attacks all blocked with speed 1.0; sum = 16; resolved = 16 → 1.
    const speeds = Array(16).fill(1);
    expect(lastStandScore(speeds, 16)).toBe(1);
  });

  it('all blocked at landing → 0', () => {
    const speeds = Array(16).fill(0);
    expect(lastStandScore(speeds, 16)).toBe(0);
  });

  it('mixed speeds average correctly', () => {
    // 8 blocks at speed 1.0, 8 misses (contribute 0 via denominator).
    // Expected: 8 * 1 / 16 = 0.5
    const speeds = Array(8).fill(1);
    expect(lastStandScore(speeds, 16)).toBeCloseTo(0.5, 5);
  });

  it('misses lower the score even when everything blocked is fast', () => {
    // 4 fast blocks out of 8 resolved — same as half-blocked at full speed.
    expect(lastStandScore(Array(4).fill(1), 8)).toBeCloseTo(0.5, 5);
  });

  it('uses resolved count as denominator so dying early does not penalise unplayed attacks', () => {
    // Died early with 4 perfect blocks out of 8 resolved (8 attacks never played).
    // Score should be 0.5, not 0.25.
    expect(lastStandScore(Array(4).fill(1), 8)).toBeCloseTo(0.5, 5);
  });

  it('clamps above 1', () => {
    // Floating-point edge: sum of speeds slightly above resolved count.
    expect(lastStandScore(Array(16).fill(1.1), 16)).toBe(1);
  });
});
