import { describe, it, expect } from 'vitest';
import { trialReward, scoreToStars, TRIALS, TRIALS_UNLOCK_LEVEL, emptyTrialsClearedOn, emptyBestTrialScore } from '../trials';
import { lockpickingScore, generatePins, hitAccuracy, LOCK_PINS } from '../lockpicking';
import {
  chaseScore,
  generateFeatures,
  speedAt,
  updateLead,
  resolveContact,
  CHASE_TARGET_DISTANCE,
  BASE_SPEED,
  MAX_SPEED,
  LEAD_MAX,
  LEAD_START,
  STUMBLE_LEAD_LOSS,
  STOMP_LEAD_GAIN,
  GRACE_DISTANCE,
  FEATURE_COUNT,
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
  it('generatePins returns LOCK_PINS pins with valid zones', () => {
    const pins = generatePins(seededRng());
    expect(pins).toHaveLength(LOCK_PINS);
    for (const p of pins) {
      expect(p.zoneStart).toBeGreaterThanOrEqual(0);
      expect(p.zoneStart + p.zoneWidth).toBeLessThanOrEqual(1.001);
    }
  });

  it('hitAccuracy is 1 at zone center', () => {
    const acc = hitAccuracy(0.5, 0.4, 0.2); // center = 0.5, zone [0.4, 0.6]
    expect(acc).toBeCloseTo(1, 5);
  });

  it('hitAccuracy is 0 outside the zone', () => {
    expect(hitAccuracy(0.1, 0.4, 0.2)).toBe(0);
    expect(hitAccuracy(0.9, 0.4, 0.2)).toBe(0);
  });

  it('lockpickingScore divides by total pins, not hits', () => {
    // 2 perfect hits, 1 miss
    expect(lockpickingScore([1, 1, 0])).toBeCloseTo(2 / LOCK_PINS, 5);
  });

  it('all perfect hits = 1.0', () => {
    expect(lockpickingScore([1, 1, 1])).toBe(1);
  });

  it('all misses = 0', () => {
    expect(lockpickingScore([0, 0, 0])).toBe(0);
  });

  it('empty accuracies = 0', () => {
    expect(lockpickingScore([])).toBe(0);
  });
});

// ── Rooftop Chase ──────────────────────────────────────────────────────────────

describe('rooftopChase', () => {
  // generateFeatures
  it('generateFeatures returns FEATURE_COUNT features', () => {
    const f = generateFeatures(seededRng());
    expect(f).toHaveLength(FEATURE_COUNT);
  });

  it('all features have valid kinds', () => {
    const valid = new Set(['hazard', 'gap', 'mook']);
    for (const f of generateFeatures(seededRng())) {
      expect(valid.has(f.kind)).toBe(true);
    }
  });

  it('all features start after GRACE_DISTANCE', () => {
    for (const f of generateFeatures(seededRng())) {
      expect(f.x).toBeGreaterThanOrEqual(GRACE_DISTANCE);
    }
  });

  it('features are sorted by x (ascending)', () => {
    const fs = generateFeatures(seededRng());
    for (let i = 1; i < fs.length; i++) {
      expect(fs[i].x).toBeGreaterThan(fs[i - 1].x);
    }
  });

  it('generateFeatures is deterministic for the same seed', () => {
    const a = generateFeatures(seededRng(99));
    const b = generateFeatures(seededRng(99));
    expect(a).toEqual(b);
  });

  it('all features have positive width', () => {
    for (const f of generateFeatures(seededRng())) {
      expect(f.width).toBeGreaterThan(0);
    }
  });

  // speedAt
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

  // updateLead
  it('updateLead regenerates lead over time', () => {
    const next = updateLead(LEAD_START, 1);
    expect(next).toBeGreaterThan(LEAD_START);
  });

  it('updateLead stumble reduces lead', () => {
    const next = updateLead(LEAD_START, 0, 'stumble');
    expect(next).toBeLessThan(LEAD_START);
    expect(next).toBeCloseTo(Math.max(0, LEAD_START - STUMBLE_LEAD_LOSS), 5);
  });

  it('updateLead stomp increases lead', () => {
    const next = updateLead(LEAD_START, 0, 'stomp');
    expect(next).toBeGreaterThan(LEAD_START);
    expect(next).toBeCloseTo(Math.min(LEAD_MAX, LEAD_START + STOMP_LEAD_GAIN), 5);
  });

  it('updateLead is clamped to [0, LEAD_MAX]', () => {
    expect(updateLead(0, 0, 'stumble')).toBe(0);
    expect(updateLead(LEAD_MAX, 1, 'stomp')).toBe(LEAD_MAX);
  });

  // resolveContact
  it('resolveContact: grounded on hazard = stumble', () => {
    const f = { id: 0, kind: 'hazard' as const, x: 10, width: 3 };
    expect(resolveContact(0, 0, f)).toBe('stumble');
  });

  it('resolveContact: airborne over hazard = clear', () => {
    const f = { id: 0, kind: 'hazard' as const, x: 10, width: 3 };
    expect(resolveContact(5, -1, f)).toBe('clear');
  });

  it('resolveContact: grounded inside gap = stumble', () => {
    const f = { id: 1, kind: 'gap' as const, x: 10, width: 10 };
    expect(resolveContact(0, 0, f)).toBe('stumble');
  });

  it('resolveContact: airborne over gap = clear', () => {
    const f = { id: 1, kind: 'gap' as const, x: 10, width: 10 };
    expect(resolveContact(4, -0.5, f)).toBe('clear');
  });

  it('resolveContact: descending onto mook head = stomp', () => {
    const f = { id: 2, kind: 'mook' as const, x: 10, width: 2.5 };
    // heroY = 4 (airborne), heroVy = -2 (falling) — within stomp window
    expect(resolveContact(4, -2, f)).toBe('stomp');
  });

  it('resolveContact: grounded into mook side = stumble', () => {
    const f = { id: 2, kind: 'mook' as const, x: 10, width: 2.5 };
    expect(resolveContact(0, 0, f)).toBe('stumble');
  });

  // chaseScore
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
