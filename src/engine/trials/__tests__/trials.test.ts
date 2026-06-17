import { describe, it, expect } from 'vitest';
import { trialReward, scoreToStars, TRIALS, TRIALS_UNLOCK_LEVEL, emptyTrialsClearedOn, emptyBestTrialScore } from '../trials';
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
import { armoryScore, armoryAccuracy, ARMORY_LOCKS, SWEET_ZONE_START } from '../armoryBreak';
import { marchStep, marchScore, generateTerrain, MARCH_TILES } from '../longMarch';
import { generateSequence, libraryScore, LIBRARY_MAX_ROUNDS, GLYPHS } from '../ancientLibrary';

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
    const close = breakTime(97, lock);  // just outside open zone
    const far = breakTime(115, lock);   // well outside tolerance
    expect(close).toBeGreaterThan(far);
  });

  it('lockpickingScore: all locks + full picks = 1.0', () => {
    expect(lockpickingScore(NUM_LOCKS, PICK_BUDGET)).toBe(1);
  });

  it('lockpickingScore: all locks + 1 pick left ≈ 0.5', () => {
    expect(lockpickingScore(NUM_LOCKS, 1)).toBeCloseTo(0.5, 5);
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

  it('all prop kinds are in {hazard, mook, lowbar}', () => {
    const valid = new Set(['hazard', 'mook', 'lowbar']);
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
    expect(hasFallen(bs, mid, bs[0].roofY)).toBe(false);
  });

  it('hasFallen is false when airborne over a gap but above the next roof', () => {
    const bs = generateCourse(seededRng());
    const gapX = bs[0].x + bs[0].width + 0.5;
    const nextRoof = bs[1].roofY;
    expect(hasFallen(bs, gapX, nextRoof + 1)).toBe(false); // above next roof top
  });

  it('hasFallen is true when over a gap and below the next roof top', () => {
    const bs = generateCourse(seededRng());
    const gapX = bs[0].x + bs[0].width + 0.5;
    const nextRoof = bs[1].roofY;
    expect(hasFallen(bs, gapX, nextRoof - 0.5)).toBe(true); // below next roof top
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
  it('armoryAccuracy is 1 at release = 1.0', () => {
    expect(armoryAccuracy(1.0)).toBeCloseTo(1, 5);
  });

  it('armoryAccuracy is 0 below the zone', () => {
    expect(armoryAccuracy(SWEET_ZONE_START - 0.01)).toBe(0);
    expect(armoryAccuracy(0)).toBe(0);
  });

  it('armoryAccuracy is between 0 and 1 inside the zone', () => {
    const acc = armoryAccuracy(SWEET_ZONE_START + 0.05);
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

  it('marchScore: full completion = 1', () => {
    expect(marchScore(MARCH_TILES)).toBe(1);
  });

  it('marchScore: half = 0.5', () => {
    expect(marchScore(MARCH_TILES / 2)).toBeCloseTo(0.5, 5);
  });

  it('marchScore: capped at 1', () => {
    expect(marchScore(MARCH_TILES + 5)).toBe(1);
  });
});

// ── Ancient Library ────────────────────────────────────────────────────────────

describe('ancientLibrary', () => {
  it('generateSequence produces max-length array of valid glyphs', () => {
    const maxLen = 3 + LIBRARY_MAX_ROUNDS - 1;
    const seq = generateSequence(seededRng());
    expect(seq).toHaveLength(maxLen);
    const validSet = new Set(GLYPHS);
    for (const g of seq) expect(validSet.has(g)).toBe(true);
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

  it('generateSequence is deterministic for the same seed', () => {
    const a = generateSequence(seededRng(123));
    const b = generateSequence(seededRng(123));
    expect(a).toEqual(b);
  });
});
