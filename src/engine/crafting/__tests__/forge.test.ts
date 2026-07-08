import { describe, it, expect } from 'vitest';
import {
  initForge,
  stepForge,
  commitStoke,
  forgeScore,
  heatBandWidth,
  heatAccuracy,
  strikeSweetHalf,
  strikeAccuracy,
  strikePower,
  effectiveStrikeHalf,
  HEAT_BAND_START,
  HEAT_BAND_WIDTH_BASE,
  HEAT_DECAY_RATE,
  HEAT_RISE_RATE,
  NEEDLE_PERIOD_S,
  SWEET_HALF_BASE,
  CHARGE_TIME_S,
  CHARGE_MULT,
  CHARGE_ZONE_SHRINK,
  RESTOKE_FATIGUE,
  PROGRESS_COOL_RATE,
  DEFAULT_MODS,
  boostMods,
  type ForgeRunState,
  type ForgeInput,
  type ForgeMods,
} from '../forge';

// ── Test rig ─────────────────────────────────────────────────────────────────

const NONE: ForgeInput = { hammerHeld: false, bellowsHeld: false };
const HAMMER: ForgeInput = { hammerHeld: true, bellowsHeld: false };
const BELLOWS: ForgeInput = { hammerHeld: false, bellowsHeld: true };

const mods = (over: Partial<ForgeMods> = {}): ForgeMods => ({ ...DEFAULT_MODS, ...over });

/** A Phase-B state parked at a known needle/zone, ready to release a strike. */
function strikeState(over: Partial<ForgeRunState> = {}): ForgeRunState {
  return {
    ...initForge(0, 0),
    phase: 'strike',
    heat: 0.8,
    heatMax: 1,
    needlePos: 0.5,
    zoneCentre: 0.5,
    ...over,
  };
}

// ── Helper formulas ────────────────────────────────────────────────────────────

describe('stat-scaling helpers', () => {
  it('heatBandWidth is monotone in DX with exact endpoints', () => {
    expect(heatBandWidth(0)).toBeCloseTo(0.16, 10);
    expect(heatBandWidth(25)).toBeCloseTo(0.36, 10);
    expect(heatBandWidth(10)).toBeGreaterThan(heatBandWidth(0));
    expect(heatBandWidth(25)).toBeGreaterThan(heatBandWidth(10));
  });

  it('strikeSweetHalf is monotone in DX with exact endpoints', () => {
    expect(strikeSweetHalf(0)).toBeCloseTo(0.1, 10);
    expect(strikeSweetHalf(25)).toBeCloseTo(0.25, 10);
    expect(strikeSweetHalf(16)).toBeGreaterThan(strikeSweetHalf(8));
  });

  it('strikeSweetHalf adds the forge_focus bonus additively, under the 0.35 cap (10.5)', () => {
    expect(strikeSweetHalf(0, 0)).toBeCloseTo(strikeSweetHalf(0), 10); // default 0 → unchanged
    expect(strikeSweetHalf(0, 0.03)).toBeCloseTo(0.13, 10);            // 0.10 base + 0.03 perk
    expect(strikeSweetHalf(10, 0.03)).toBeCloseTo(strikeSweetHalf(10) + 0.03, 10);
    expect(strikeSweetHalf(50, 0.03)).toBeCloseTo(0.35, 10);          // additive, still capped
  });

  it('strikePower is monotone in ST: 0.20 at ST 0, ≈0.275 at ST 25', () => {
    expect(strikePower(0)).toBeCloseTo(0.2, 10);
    expect(strikePower(25)).toBeCloseTo(0.275, 3);
    expect(strikePower(16)).toBeGreaterThan(strikePower(8));
  });
});

describe('effectiveStrikeHalf — a11y minimum-width floor (§7 M6)', () => {
  it('production inputs (zoneMult ≥ 1) are unchanged by the floor', () => {
    // DX 0, no flux, uncharged: raw 0.10 == floor, so identity.
    expect(effectiveStrikeHalf(0, 1, 0)).toBeCloseTo(strikeSweetHalf(0), 10);
    expect(effectiveStrikeHalf(16, 1, 0)).toBeCloseTo(strikeSweetHalf(16), 10);
  });

  it('threads the forge_focus bonus additively; default 0 is byte-identical (10.5)', () => {
    // DX 0, no flux, uncharged: 0.10 base + 0.03 perk = 0.13 (above the 0.10 floor).
    expect(effectiveStrikeHalf(0, 1, 0, 0.03)).toBeCloseTo(0.13, 10);
    // Default bonus 0 matches the un-perked width exactly.
    expect(effectiveStrikeHalf(16, 1, 0, 0)).toBeCloseTo(effectiveStrikeHalf(16, 1, 0), 10);
  });

  it('floors the UNCHARGED half-width at SWEET_HALF_BASE (0.10)', () => {
    // A hostile narrowing (zoneMult < 1) would drop the raw width below 0.10; the
    // floor restores it so even a low-DX player keeps a Normal-reachable target.
    expect(strikeSweetHalf(0) * 0.5).toBeLessThan(SWEET_HALF_BASE); // 0.05 raw
    expect(effectiveStrikeHalf(0, 0.5, 0)).toBeCloseTo(SWEET_HALF_BASE, 10);
  });

  it('charge shrink still bites below the floor (charging not penalty-free)', () => {
    // The floor applies to the UNCHARGED width only; a full charge shrinks the floored
    // 0.10 to 0.075 (×CHARGE_ZONE_SHRINK) rather than being floored back to full width.
    expect(effectiveStrikeHalf(0, 0.5, CHARGE_TIME_S)).toBeCloseTo(
      SWEET_HALF_BASE * CHARGE_ZONE_SHRINK,
      10,
    );
    expect(effectiveStrikeHalf(0, 0.5, CHARGE_TIME_S)).toBeLessThan(SWEET_HALF_BASE);
  });
});

describe('boostMods (Fuel & Flux → ForgeMods, §6)', () => {
  it('no boosts → defaults', () => {
    expect(boostMods()).toEqual(DEFAULT_MODS);
    expect(boostMods({ flux: false })).toEqual(DEFAULT_MODS);
  });

  it('Seasoned Wood → decayMult 0.7', () => {
    expect(boostMods({ fuel: 'wood' })).toEqual({ ...DEFAULT_MODS, decayMult: 0.7 });
  });

  it('Firebrick → fatigue 0.08', () => {
    expect(boostMods({ fuel: 'stone' })).toEqual({ ...DEFAULT_MODS, fatigue: 0.08 });
  });

  it('Gemstone flux → zoneMult 1.25, combinable with a fuel', () => {
    expect(boostMods({ flux: true })).toEqual({ ...DEFAULT_MODS, zoneMult: 1.25 });
    expect(boostMods({ fuel: 'wood', flux: true })).toEqual({
      decayMult: 0.7,
      fatigue: RESTOKE_FATIGUE,
      zoneMult: 1.25,
    });
  });

  it('does not mutate the shared DEFAULT_MODS', () => {
    boostMods({ fuel: 'wood', flux: true });
    expect(DEFAULT_MODS).toEqual({ decayMult: 1, fatigue: RESTOKE_FATIGUE, zoneMult: 1 });
  });
});

describe('accuracy helpers (triangular falloff)', () => {
  it('heatAccuracy: 1 at band centre, 0 at edges, 0 outside', () => {
    const centre = HEAT_BAND_START + HEAT_BAND_WIDTH_BASE / 2;
    expect(heatAccuracy(centre)).toBeCloseTo(1, 10);
    expect(heatAccuracy(HEAT_BAND_START)).toBeCloseTo(0, 10);
    expect(heatAccuracy(HEAT_BAND_START + HEAT_BAND_WIDTH_BASE)).toBeCloseTo(0, 10);
    expect(heatAccuracy(0.2)).toBe(0); // below band
    expect(heatAccuracy(0.99)).toBe(0); // above band
  });

  it('strikeAccuracy: 1 at zone centre, 0 at edges, 0 outside', () => {
    expect(strikeAccuracy(0.5, 0.5, 0.1)).toBeCloseTo(1, 10);
    expect(strikeAccuracy(0.6, 0.5, 0.1)).toBeCloseTo(0, 10); // at edge (FP-fuzzy boundary)
    expect(strikeAccuracy(0.55, 0.5, 0.1)).toBeCloseTo(0.5, 10);
    expect(strikeAccuracy(0.8, 0.5, 0.1)).toBe(0); // outside
  });
});

// ── Phase A / commitStoke ──────────────────────────────────────────────────────

describe('Phase A stoke + commit', () => {
  it('heat bar rises while held and falls when released', () => {
    let s = initForge(10, 10);
    s = stepForge(s, BELLOWS, 1, 10, 10, DEFAULT_MODS);
    expect(s.heatBar).toBeCloseTo(HEAT_RISE_RATE, 10);
    const dropped = stepForge(s, NONE, 0.1, 10, 10, DEFAULT_MODS);
    expect(dropped.heatBar).toBeLessThan(s.heatBar);
  });

  it('commitStoke enters strike with heat = committed bar and band-proximity heat01', () => {
    // Park the bar exactly at the DX-0 band centre → heat01 == 1.
    const centre = HEAT_BAND_START + heatBandWidth(0) / 2;
    const s = commitStoke({ ...initForge(0, 0), heatBar: centre }, 0);
    expect(s.phase).toBe('strike');
    expect(s.heat).toBeCloseTo(centre, 10);
    expect(s.heat01).toBeCloseTo(1, 10);
  });

  it('commitStoke: bar outside the band scores heat01 = 0', () => {
    const s = commitStoke({ ...initForge(0, 0), heatBar: 0.2 }, 0);
    expect(s.heat01).toBe(0);
  });
});

// ── Strikes ────────────────────────────────────────────────────────────────────

describe('light strike', () => {
  it('advances progress by acc × strikePower and records weight 1', () => {
    const st = 12;
    // Charging then released within CHARGE_TIME_S → light strike, needle on centre → acc 1.
    const charged = strikeState({ charging: true, chargeT: 0.05 });
    const fired = stepForge(charged, NONE, 0, 0, st, DEFAULT_MODS);
    expect(fired.strikes).toHaveLength(1);
    expect(fired.strikes[0].weight).toBe(1);
    expect(fired.strikes[0].acc).toBeCloseTo(1, 6);
    expect(fired.progress).toBeCloseTo(strikePower(st), 6);
  });

  it('a perfect light strike at ST 0 fills exactly 0.20', () => {
    const charged = strikeState({ charging: true, chargeT: 0.01 });
    const fired = stepForge(charged, NONE, 0, 0, 0, DEFAULT_MODS);
    expect(fired.progress).toBeCloseTo(0.2, 6);
  });
});

describe('heavy strike', () => {
  it('requires chargeT ≥ CHARGE_TIME_S and multiplies progress by CHARGE_MULT', () => {
    const st = 12;
    const heavy = strikeState({ charging: true, chargeT: CHARGE_TIME_S });
    const fired = stepForge(heavy, NONE, 0, 0, st, DEFAULT_MODS);
    expect(fired.strikes[0].weight).toBe(CHARGE_MULT);
    // Full charge shrinks the zone to ×0.75, but needle is dead-centre so acc stays 1.
    expect(fired.progress).toBeCloseTo(strikePower(st) * CHARGE_MULT, 6);

    const light = strikeState({ charging: true, chargeT: CHARGE_TIME_S - 0.05 });
    const firedLight = stepForge(light, NONE, 0, 0, st, DEFAULT_MODS);
    expect(firedLight.strikes[0].weight).toBe(1);
  });

  it('sweet-zone half-width shrinks toward ×CHARGE_ZONE_SHRINK while charging', () => {
    // dx 0 → base half-width 0.10. Offset the needle between the shrunk and base edges.
    const base = strikeSweetHalf(0); // 0.10
    const offset = base * ((1 + CHARGE_ZONE_SHRINK) / 2); // 0.0875 — inside base, outside shrunk
    const at = strikeState({ needlePos: 0.5 + offset, zoneCentre: 0.5 });

    const lightHit = stepForge({ ...at, charging: true, chargeT: 0.01 }, NONE, 0, 0, 0, DEFAULT_MODS);
    const heavyMiss = stepForge(
      { ...at, charging: true, chargeT: CHARGE_TIME_S },
      NONE,
      0,
      0,
      0,
      DEFAULT_MODS,
    );
    expect(lightHit.strikes[0].acc).toBeGreaterThan(0); // still inside the full-width zone
    expect(heavyMiss.strikes[0].acc).toBe(0); // shrunk zone no longer reaches the needle
  });

  it('heat decays while the hammer charges', () => {
    const s = strikeState({ charging: true, chargeT: 0.2, heat: 0.8 });
    const after = stepForge(s, HAMMER, 0.5, 0, 0, DEFAULT_MODS);
    expect(after.charging).toBe(true);
    expect(after.heat).toBeCloseTo(0.8 - HEAT_DECAY_RATE * 0.5, 6);
    expect(after.strikes).toHaveLength(0); // still holding — no strike yet
  });
});

// ── Charge economy (DPS cross-check, §7 M6 balance) ─────────────────────────────

describe('charge economy vs light spam', () => {
  it('a charged heavy yields CHARGE_MULT× the progress of a light at equal accuracy', () => {
    const st = 12;
    const light = stepForge(
      strikeState({ charging: true, chargeT: 0.01 }),
      NONE,
      0,
      0,
      st,
      DEFAULT_MODS,
    );
    const heavy = stepForge(
      strikeState({ charging: true, chargeT: CHARGE_TIME_S }),
      NONE,
      0,
      0,
      st,
      DEFAULT_MODS,
    );
    // Both needle dead-centre → acc 1; heavy is exactly ×CHARGE_MULT the light.
    expect(heavy.progress / light.progress).toBeCloseTo(CHARGE_MULT, 6);
  });

  it('charging is progress-per-second positive vs needle-gated accurate lights', () => {
    // Heavy DPS (per unit strikePower) = CHARGE_MULT / CHARGE_TIME_S over the charge window.
    // Light DPS = 1 / cadence. Break-even cadence below which light spam wins outright:
    const breakEvenCadence = CHARGE_TIME_S / CHARGE_MULT; // ≈ 0.474 s/light
    // A *perfectly-accurate* light can only land as the needle re-enters the zone centre,
    // i.e. ~twice per full sweep → cadence ≥ NEEDLE_PERIOD_S / 2 (1.0 s at DX 0).
    const accurateLightCadence = NEEDLE_PERIOD_S / 2;
    expect(accurateLightCadence).toBeGreaterThan(breakEvenCadence);
    // NOTE (playtest item): the engine imposes NO light cooldown, so a player who mashes
    // low-accuracy lights faster than ~0.47 s beats the heavy on RAW progress — same trap
    // as the mine's old 1.75 mult. Charging stays worthwhile only via the accuracy-weighted
    // score (forgeScore), not raw DPS. Flagged, not retuned, per M6.
  });
});

// ── Re-stoke ─────────────────────────────────────────────────────────────────

describe('re-stoke', () => {
  it('raises heat and cools progress while stoking', () => {
    const s = strikeState({ heat: 0.4, progress: 0.5 });
    const after = stepForge(s, BELLOWS, 1, 0, 0, DEFAULT_MODS);
    expect(after.stoking).toBe(true);
    expect(after.heat).toBeCloseTo(0.4 + HEAT_RISE_RATE, 6);
    expect(after.progress).toBeCloseTo(0.5 - PROGRESS_COOL_RATE, 6);
  });

  it('applies fatigue once per SESSION, not per frame', () => {
    let s = strikeState({ heat: 0.5, heatMax: 1 });
    // Hold bellows continuously for ~3 s across many small steps → ONE fatigue hit.
    for (let i = 0; i < 60; i++) s = stepForge(s, BELLOWS, 0.05, 0, 0, DEFAULT_MODS);
    expect(s.restokes).toBe(1);
    expect(s.heatMax).toBeCloseTo(1 - RESTOKE_FATIGUE, 6);

    // Release, then a fresh hold → a second session, a second fatigue hit.
    s = stepForge(s, NONE, 0.05, 0, 0, DEFAULT_MODS);
    s = stepForge(s, BELLOWS, 0.05, 0, 0, DEFAULT_MODS);
    expect(s.restokes).toBe(2);
    expect(s.heatMax).toBeCloseTo(1 - 2 * RESTOKE_FATIGUE, 6);
  });

  it('makes strikes impossible while stoking (charge cancelled, no fire)', () => {
    const s = strikeState({ charging: true, chargeT: CHARGE_TIME_S });
    // Release the hammer but hold bellows the same frame.
    const after = stepForge(s, BELLOWS, 0.05, 0, 0, DEFAULT_MODS);
    expect(after.strikes).toHaveLength(0);
    expect(after.charging).toBe(false);
    expect(after.chargeT).toBe(0);
  });
});

// ── End conditions ─────────────────────────────────────────────────────────────

describe('end conditions', () => {
  it('progress ≥ 1 ends the run', () => {
    const s = strikeState({ progress: 0.95, charging: true, chargeT: 0.01 });
    const fired = stepForge(s, NONE, 0, 0, 25, DEFAULT_MODS); // strikePower(25)=0.275 → over 1
    expect(fired.progress).toBeGreaterThanOrEqual(1);
    expect(fired.phase).toBe('done');
  });

  it('heat ≤ 0 ends the run mid-charge with the primed strike lost', () => {
    const s = strikeState({ heat: 0.01, charging: true, chargeT: CHARGE_TIME_S });
    const after = stepForge(s, HAMMER, 0.5, 0, 25, DEFAULT_MODS);
    expect(after.phase).toBe('done');
    expect(after.heat).toBe(0);
    expect(after.strikes).toHaveLength(0); // no strike fires when heat expires
  });

  it('a done run is a fixed point', () => {
    const s: ForgeRunState = { ...strikeState(), phase: 'done' };
    expect(stepForge(s, HAMMER, 0.1, 10, 10, DEFAULT_MODS)).toBe(s);
  });
});

// ── Scoring ─────────────────────────────────────────────────────────────────

describe('forgeScore', () => {
  it('all-perfect run scores ≥ 0.75 (Masterwork band)', () => {
    const s = strikeState({
      heat01: 1,
      progress: 1,
      strikes: [
        { acc: 1, weight: 1 },
        { acc: 1, weight: CHARGE_MULT },
      ],
    });
    expect(forgeScore(s)).toBeGreaterThanOrEqual(0.75);
  });

  it('all-zero run lands in the Crude band (< 0.20)', () => {
    const s = strikeState({ heat01: 0, progress: 0, strikes: [{ acc: 0, weight: 1 }] });
    expect(forgeScore(s)).toBeLessThan(0.2);
  });

  it('heat01 = 0 caps the score at 0.65', () => {
    const s = strikeState({
      heat01: 0,
      progress: 1,
      strikes: [{ acc: 1, weight: 1 }],
    });
    expect(forgeScore(s)).toBeCloseTo(0.65, 6);
  });

  it('weighting: one accurate heavy outweighs one sloppy light', () => {
    const accurateHeavy = strikeState({
      heat01: 0,
      progress: 1,
      strikes: [
        { acc: 1, weight: CHARGE_MULT },
        { acc: 0.1, weight: 1 },
      ],
    });
    const sloppyHeavy = strikeState({
      heat01: 0,
      progress: 1,
      strikes: [
        { acc: 0.1, weight: CHARGE_MULT },
        { acc: 1, weight: 1 },
      ],
    });
    expect(forgeScore(accurateHeavy)).toBeGreaterThan(forgeScore(sloppyHeavy));
  });

  it('low-accuracy spam scores below fewer accurate strikes', () => {
    const spam = strikeState({
      heat01: 0,
      progress: 1,
      strikes: Array.from({ length: 12 }, () => ({ acc: 0.15, weight: 1 })),
    });
    const accurate = strikeState({
      heat01: 0,
      progress: 0.7,
      strikes: [
        { acc: 0.95, weight: 1 },
        { acc: 0.95, weight: CHARGE_MULT },
      ],
    });
    expect(forgeScore(accurate)).toBeGreaterThan(forgeScore(spam));
  });
});

// ── Fuel & Flux mods ───────────────────────────────────────────────────────────

describe('fuel & flux mods', () => {
  it('decayMult 0.7 slows the passive heat drain', () => {
    const base = strikeState({ heat: 0.8 });
    const slow = stepForge(base, NONE, 1, 0, 0, mods({ decayMult: 0.7 }));
    const fast = stepForge(base, NONE, 1, 0, 0, DEFAULT_MODS);
    expect(slow.heat).toBeGreaterThan(fast.heat);
    expect(slow.heat).toBeCloseTo(0.8 - HEAT_DECAY_RATE * 0.7, 6);
  });

  it('fatigue override 0.08 reduces the per-session heatMax loss', () => {
    const s = strikeState({ heat: 0.5, heatMax: 1 });
    const after = stepForge(s, BELLOWS, 0.05, 0, 0, mods({ fatigue: 0.08 }));
    expect(after.heatMax).toBeCloseTo(0.92, 6);
  });

  it('zoneMult 1.25 widens the Phase A band', () => {
    // Bar sits just outside the DX-0 band top; flux widens the band enough to score.
    const bar = HEAT_BAND_START + heatBandWidth(0) + 0.02;
    const plain = commitStoke({ ...initForge(0, 0), heatBar: bar }, 0);
    const fluxed = commitStoke({ ...initForge(0, 0, { zoneMult: 1.25 }), heatBar: bar }, 0);
    expect(plain.heat01).toBe(0);
    expect(fluxed.heat01).toBeGreaterThan(0);
  });

  it('zoneMult 1.25 widens the strike sweet-zone', () => {
    // Needle just past the DX-0 half-width → miss at ×1, hit with flux.
    const offset = strikeSweetHalf(0) + 0.01;
    const at = strikeState({ needlePos: 0.5 + offset, zoneCentre: 0.5, charging: true, chargeT: 0.01 });
    const plain = stepForge(at, NONE, 0, 0, 0, DEFAULT_MODS);
    const fluxed = stepForge(at, NONE, 0, 0, 0, mods({ zoneMult: 1.25 }));
    expect(plain.strikes[0].acc).toBe(0);
    expect(fluxed.strikes[0].acc).toBeGreaterThan(0);
  });
});
