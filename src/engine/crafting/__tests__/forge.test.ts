import { describe, it, expect } from 'vitest';
import {
  initForge,
  stepForge,
  commitStoke,
  forgeScore,
  forgeScoreParts,
  heatBandWidth,
  heatAccuracy,
  strikeSweetHalf,
  strikeAccuracy,
  strikePower,
  effectiveStrikeHalf,
  activeZoneMult,
  quenchHalf,
  tempoMult,
  rollEventQueue,
  eventDuration,
  applyTemperament,
  TEMPERAMENTS,
  HEAT_BAND_START,
  HEAT_BAND_WIDTH_BASE,
  HEAT_DECAY_RATE,
  HEAT_RISE_RATE,
  SWEET_HALF_BASE,
  CHARGE_TIME_S,
  CHARGE_MULT,
  CHARGE_ZONE_SHRINK,
  RESTOKE_FATIGUE,
  PROGRESS_COOL_RATE,
  TEMPO_SPAM_S,
  TEMPO_GAIN,
  TEMPO_DECAY_RATE,
  TEMPO_MULT_MIN,
  TEMPO_MULT_MAX,
  CRIT_ACC,
  CRIT_BONUS,
  EMBER_DUR_S,
  EMBER_ZONE_MULT,
  EMBER_PROG_MULT,
  SNAP_DUR_S,
  SNAP_DECAY_MULT,
  QUENCH_FALL_RATE,
  QUENCH_BAND_CENTRE,
  QUENCH_HALF_BASE,
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

/**
 * A Phase-B state parked at a known needle/zone, ready to release a strike.
 * Event queue emptied so unit tests aren't surprised by the default schedule
 * (events get their own block; the bot sims use the real schedule).
 */
function strikeState(over: Partial<ForgeRunState> = {}): ForgeRunState {
  return {
    ...initForge(0, 0),
    phase: 'strike',
    heat: 0.8,
    heatMax: 1,
    needlePos: 0.5,
    zoneCentre: 0.5,
    eventQueue: [],
    ...over,
  };
}

/** A Phase-C state with the bar parked at a known position. */
function quenchState(over: Partial<ForgeRunState> = {}): ForgeRunState {
  return { ...strikeState(), phase: 'quench', quenchBar: 1, charging: false, ...over };
}

// The multiplier a lone perfect strike carries: tempo starts at 0 (×TEMPO_MULT_MIN)
// and acc 1 always crits (×CRIT_BONUS). Used wherever a test lands a dead-centre blow.
const FIRST_PERFECT_MULT = TEMPO_MULT_MIN * CRIT_BONUS;

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

  it('strikePower is monotone in ST: 0.13 at ST 0, ≈0.179 at ST 25 (overhaul retune)', () => {
    // Base dropped 0.20 → 0.13: tempo (≤×1.25) + crit (×1.25) raise a good blow's
    // real value, so the base falls to keep runs in the 15–25 s band.
    expect(strikePower(0)).toBeCloseTo(0.13, 10);
    expect(strikePower(25)).toBeCloseTo(0.13 * (1 + 25 * 0.015), 10);
    expect(strikePower(16)).toBeGreaterThan(strikePower(8));
  });

  it('quenchHalf: DX and flux widen the plunge band, capped at 0.35', () => {
    expect(quenchHalf(0, 1)).toBeCloseTo(QUENCH_HALF_BASE, 10);
    expect(quenchHalf(25, 1)).toBeCloseTo(QUENCH_HALF_BASE + 0.1, 10);
    expect(quenchHalf(0, 1.25)).toBeCloseTo(QUENCH_HALF_BASE * 1.25, 10);
    expect(quenchHalf(100, 2)).toBeCloseTo(0.35, 10);
  });

  it('tempoMult: linear from TEMPO_MULT_MIN to TEMPO_MULT_MAX, clamped', () => {
    expect(tempoMult(0)).toBeCloseTo(TEMPO_MULT_MIN, 10);
    expect(tempoMult(1)).toBeCloseTo(TEMPO_MULT_MAX, 10);
    expect(tempoMult(0.5)).toBeCloseTo((TEMPO_MULT_MIN + TEMPO_MULT_MAX) / 2, 10);
    expect(tempoMult(-1)).toBeCloseTo(TEMPO_MULT_MIN, 10);
    expect(tempoMult(2)).toBeCloseTo(TEMPO_MULT_MAX, 10);
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

describe('activeZoneMult (Ember Surge widening)', () => {
  it('no event → the run zoneMult unchanged', () => {
    expect(activeZoneMult({ event: null }, 1.25)).toBeCloseTo(1.25, 10);
  });

  it('ember event → ×EMBER_ZONE_MULT; snap leaves the zone alone', () => {
    expect(activeZoneMult({ event: { kind: 'ember', endsT: 9 } }, 1)).toBeCloseTo(
      EMBER_ZONE_MULT,
      10,
    );
    expect(activeZoneMult({ event: { kind: 'snap', endsT: 9 } }, 1)).toBeCloseTo(1, 10);
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

  it('Firebrick → fatigue 0.05', () => {
    expect(boostMods({ fuel: 'stone' })).toEqual({ ...DEFAULT_MODS, fatigue: 0.05 });
  });

  it('Gemstone flux → zoneMult 1.25, combinable with a fuel', () => {
    expect(boostMods({ flux: true })).toEqual({ ...DEFAULT_MODS, zoneMult: 1.25 });
    expect(boostMods({ fuel: 'wood', flux: true })).toEqual({
      ...DEFAULT_MODS,
      decayMult: 0.7,
      zoneMult: 1.25,
    });
  });

  it('does not mutate the shared DEFAULT_MODS', () => {
    boostMods({ fuel: 'wood', flux: true });
    expect(DEFAULT_MODS).toEqual({
      decayMult: 1,
      fatigue: RESTOKE_FATIGUE,
      zoneMult: 1,
      needlePeriodMult: 1,
      driftMult: 1,
      powerMult: 1,
      bandStartShift: 0,
    });
  });
});

describe('metal temperaments', () => {
  it('pins the three personalities', () => {
    expect(TEMPERAMENTS.stubborn).toMatchObject({
      needlePeriodMult: 1.2,
      driftMult: 0.8,
      zoneMult: 0.9,
      decayMult: 1,
      powerMult: 1.15,
      bandStartShift: 0.04,
      fatigueMult: 1,
    });
    expect(TEMPERAMENTS.fickle).toMatchObject({
      needlePeriodMult: 0.8,
      driftMult: 1.6,
      zoneMult: 1.15,
      decayMult: 1.15,
      powerMult: 0.9,
      bandStartShift: -0.06,
      fatigueMult: 1,
    });
    expect(TEMPERAMENTS.supple).toMatchObject({
      needlePeriodMult: 1,
      driftMult: 1,
      zoneMult: 1,
      decayMult: 0.85,
      powerMult: 1,
      bandStartShift: -0.1,
      fatigueMult: 0.6,
    });
  });

  it('applyTemperament composes multiplicatively with boosts (flux × fickle)', () => {
    const composed = applyTemperament(boostMods({ flux: true, fuel: 'wood' }), 'fickle');
    expect(composed.zoneMult).toBeCloseTo(1.25 * 1.15, 10);
    expect(composed.decayMult).toBeCloseTo(0.7 * 1.15, 10);
    expect(composed.needlePeriodMult).toBeCloseTo(0.8, 10);
    expect(composed.bandStartShift).toBeCloseTo(-0.06, 10);
  });

  it('supple scales fatigue by 0.6 and shifts the band down', () => {
    const m = applyTemperament(mods(), 'supple');
    expect(m.fatigue).toBeCloseTo(RESTOKE_FATIGUE * 0.6, 10);
    expect(m.bandStartShift).toBeCloseTo(-0.1, 10);
  });

  it('never mutates its input; no id returns an untouched copy', () => {
    const input = mods({ zoneMult: 1.25 });
    const out = applyTemperament(input, 'stubborn');
    expect(input).toEqual(mods({ zoneMult: 1.25 }));
    expect(out).not.toBe(input);
    const copy = applyTemperament(input);
    expect(copy).toEqual(input);
    expect(copy).not.toBe(input);
  });

  it('initForge seeds bandStart from the shift and commitStoke scores against it', () => {
    const supple = applyTemperament(mods(), 'supple');
    const s = initForge(0, 0, supple);
    expect(s.bandStart).toBeCloseTo(HEAT_BAND_START - 0.1, 10);
    // The shifted band centre scores heat01 = 1 …
    const centre = s.bandStart + heatBandWidth(0) / 2;
    expect(commitStoke({ ...s, heatBar: centre }, 0).heat01).toBeCloseTo(1, 10);
    // … while the DEFAULT band centre now sits at the shifted band's top edge → 0.
    const oldCentre = HEAT_BAND_START + heatBandWidth(0) / 2;
    expect(commitStoke({ ...s, heatBar: oldCentre }, 0).heat01).toBeCloseTo(0, 5);
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

  it('heatAccuracy honours a shifted bandStart (temperaments)', () => {
    const start = 0.52; // supple shift
    expect(heatAccuracy(start + HEAT_BAND_WIDTH_BASE / 2, HEAT_BAND_WIDTH_BASE, start)).toBeCloseTo(1, 10);
    expect(heatAccuracy(HEAT_BAND_START + HEAT_BAND_WIDTH_BASE / 2, HEAT_BAND_WIDTH_BASE, start)).toBeCloseTo(0, 5);
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

  it('the strike clock and event schedule stay frozen during Phase A', () => {
    let s = initForge(0, 0);
    for (let i = 0; i < 100; i++) s = stepForge(s, BELLOWS, 0.1, 0, 0, DEFAULT_MODS); // 10 s
    expect(s.t).toBe(0);
    expect(s.event).toBeNull();
    expect(s.eventQueue).toHaveLength(2);
  });
});

// ── Strikes ────────────────────────────────────────────────────────────────────

describe('light strike', () => {
  it('advances progress by acc × power × tempo × crit and records weight 1 + crit', () => {
    const st = 12;
    // Charging then released within CHARGE_TIME_S → light strike, needle on centre → acc 1.
    const charged = strikeState({ charging: true, chargeT: 0.05 });
    const fired = stepForge(charged, NONE, 0, 0, st, DEFAULT_MODS);
    expect(fired.strikes).toHaveLength(1);
    expect(fired.strikes[0].weight).toBe(1);
    expect(fired.strikes[0].acc).toBeCloseTo(1, 6);
    expect(fired.strikes[0].crit).toBe(true); // acc 1 ≥ CRIT_ACC
    // Fresh run: tempo 0 → ×TEMPO_MULT_MIN; perfect → ×CRIT_BONUS.
    expect(fired.progress).toBeCloseTo(strikePower(st) * FIRST_PERFECT_MULT, 6);
  });

  it('a sub-crit strike carries no crit bonus (progress = acc × power × tempoMult)', () => {
    // Needle offset for acc exactly 0.5 at half-width 0.10 (chargeT 0 — no zone shrink).
    const at = strikeState({ needlePos: 0.55, zoneCentre: 0.5, charging: true, chargeT: 0 });
    const fired = stepForge(at, NONE, 0, 0, 0, DEFAULT_MODS);
    expect(fired.strikes[0].acc).toBeCloseTo(0.5, 6);
    expect(fired.strikes[0].crit).toBe(false);
    expect(fired.progress).toBeCloseTo(0.5 * strikePower(0) * TEMPO_MULT_MIN, 6);
  });
});

describe('heavy strike', () => {
  it('requires chargeT ≥ CHARGE_TIME_S and multiplies progress by CHARGE_MULT', () => {
    const st = 12;
    const heavy = strikeState({ charging: true, chargeT: CHARGE_TIME_S });
    const fired = stepForge(heavy, NONE, 0, 0, st, DEFAULT_MODS);
    expect(fired.strikes[0].weight).toBe(CHARGE_MULT);
    // Full charge shrinks the zone to ×0.75, but needle is dead-centre so acc stays 1.
    expect(fired.progress).toBeCloseTo(strikePower(st) * CHARGE_MULT * FIRST_PERFECT_MULT, 6);

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

// ── Tempo meter ─────────────────────────────────────────────────────────────────

describe('tempo meter', () => {
  it('an on-beat landed strike gains TEMPO_GAIN (dt 0 — no decay in the same step)', () => {
    const s = strikeState({ charging: true, chargeT: 0.01, t: 1.0, lastStrikeT: 0, tempo: 0 });
    const fired = stepForge(s, NONE, 0, 0, 0, DEFAULT_MODS); // gap 1.0 ∈ [0.7, 1.6]
    expect(fired.tempo).toBeCloseTo(TEMPO_GAIN, 10);
    expect(fired.lastStrikeT).toBeCloseTo(1.0, 10);
  });

  it('a mash-gap strike (< TEMPO_SPAM_S) resets tempo to 0 — the hammer never refuses input', () => {
    const s = strikeState({ charging: true, chargeT: 0.01, t: 0.3, lastStrikeT: 0, tempo: 0.8 });
    const fired = stepForge(s, NONE, 0, 0, 0, DEFAULT_MODS);
    expect(fired.strikes).toHaveLength(1); // the strike still lands…
    expect(fired.tempo).toBe(0); // …but the rhythm is gone
  });

  it('a whiff (acc 0) resets tempo even on a perfect beat', () => {
    const s = strikeState({
      charging: true,
      chargeT: 0.01,
      t: 1.0,
      lastStrikeT: 0,
      tempo: 0.8,
      needlePos: 0.95,
      zoneCentre: 0.5,
    });
    const fired = stepForge(s, NONE, 0, 0, 0, DEFAULT_MODS);
    expect(fired.strikes[0].acc).toBe(0);
    expect(fired.tempo).toBe(0);
  });

  it('a landed heavy counts as on-beat regardless of gap', () => {
    const s = strikeState({
      charging: true,
      chargeT: CHARGE_TIME_S,
      t: 5,
      lastStrikeT: 0, // gap 5 s — way past TEMPO_MAX_GAP_S
      tempo: 0.4,
    });
    const fired = stepForge(s, NONE, 0, 0, 0, DEFAULT_MODS);
    expect(fired.tempo).toBeCloseTo(0.4 + TEMPO_GAIN, 10);
  });

  it('a light at an off-window gap neither gains nor resets', () => {
    const s = strikeState({ charging: true, chargeT: 0.01, t: 2.5, lastStrikeT: 0, tempo: 0.4 });
    const fired = stepForge(s, NONE, 0, 0, 0, DEFAULT_MODS); // gap 2.5 > 1.6
    expect(fired.tempo).toBeCloseTo(0.4, 10);
  });

  it('the first landed strike of a run is neutral (no gain, no reset)', () => {
    const s = strikeState({ charging: true, chargeT: 0.01, tempo: 0.4, lastStrikeT: null });
    const fired = stepForge(s, NONE, 0, 0, 0, DEFAULT_MODS);
    expect(fired.tempo).toBeCloseTo(0.4, 10);
    expect(fired.lastStrikeT).not.toBeNull();
  });

  it('tempo decays passively at TEMPO_DECAY_RATE and caps at 1', () => {
    const s = strikeState({ tempo: 0.5 });
    expect(stepForge(s, NONE, 1, 0, 0, DEFAULT_MODS).tempo).toBeCloseTo(0.5 - TEMPO_DECAY_RATE, 6);
    const nearCap = strikeState({ charging: true, chargeT: CHARGE_TIME_S, tempo: 0.9, lastStrikeT: null });
    expect(stepForge(nearCap, NONE, 0, 0, 0, DEFAULT_MODS).tempo).toBe(1);
  });

  it('progress uses the tempo in force BEFORE the strike’s own gain', () => {
    // tempo 0.5 → tempoMult exactly 1.0; sub-crit acc 0.5 → no crit factor.
    // chargeT 0 keeps the zone unshrunk so the accuracy is exact.
    const s = strikeState({
      charging: true,
      chargeT: 0,
      tempo: 0.5,
      needlePos: 0.55,
      zoneCentre: 0.5,
    });
    const fired = stepForge(s, NONE, 0, 0, 0, DEFAULT_MODS);
    expect(fired.progress).toBeCloseTo(0.5 * strikePower(0) * 1.0, 6);
  });
});

// ── Crits ───────────────────────────────────────────────────────────────────────

describe('perfect-strike crits', () => {
  it('acc ≥ CRIT_ACC marks the strike and multiplies progress by CRIT_BONUS', () => {
    const perfect = stepForge(
      strikeState({ charging: true, chargeT: 0.01 }),
      NONE,
      0,
      0,
      0,
      DEFAULT_MODS,
    );
    expect(perfect.strikes[0].crit).toBe(true);
    expect(perfect.progress).toBeCloseTo(strikePower(0) * TEMPO_MULT_MIN * CRIT_BONUS, 6);
  });

  it('a near-miss below the threshold is no crit', () => {
    // acc = 1 − 0.015/0.10 = 0.85 < 0.92.
    const s = strikeState({ needlePos: 0.515, zoneCentre: 0.5, charging: true, chargeT: 0.01 });
    const fired = stepForge(s, NONE, 0, 0, 0, DEFAULT_MODS);
    expect(fired.strikes[0].acc).toBeLessThan(CRIT_ACC);
    expect(fired.strikes[0].crit).toBe(false);
    expect(fired.progress).toBeCloseTo(fired.strikes[0].acc * strikePower(0) * TEMPO_MULT_MIN, 6);
  });
});

// ── Charge economy (anti-spam, redesigned in the overhaul) ──────────────────────

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

  it('the tempo floor inverts the old spam exploit at the boundary cadence', () => {
    // Mash cadence < TEMPO_SPAM_S pins tempo at 0 (×TEMPO_MULT_MIN); its best possible
    // raw rate — perfect accuracy at the boundary — now loses to a high-tempo heavy
    // cycle. (Faster mash raises the nominal rate but the needle makes near-zero
    // accuracy physically unavoidable; the bot sim below pins that end of it.)
    const mashRate = TEMPO_MULT_MIN / TEMPO_SPAM_S;
    const heavyRate = (CHARGE_MULT * TEMPO_MULT_MAX) / CHARGE_TIME_S;
    expect(mashRate).toBeLessThan(heavyRate);
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

// ── Forge events ─────────────────────────────────────────────────────────────────

describe('forge events (seeded schedule)', () => {
  it('the default constant rng pins snap@5s then ember@12s (legacy determinism)', () => {
    expect(initForge(0, 0).eventQueue).toEqual([
      { kind: 'snap', atT: 5 },
      { kind: 'ember', atT: 12 },
    ]);
  });

  it('rollEventQueue: one of each kind, rng-ordered, 3–7 s then +5–9 s', () => {
    const low = rollEventQueue(() => 0); // kind roll 0 < 0.5 → ember first
    expect(low).toEqual([
      { kind: 'ember', atT: 3 },
      { kind: 'snap', atT: 8 },
    ]);
    const high = rollEventQueue(() => 0.999);
    expect(high[0].kind).toBe('snap');
    expect(high[0].atT).toBeCloseTo(6.996, 3);
    expect(high[1].kind).toBe('ember');
    expect(high[1].atT).toBeCloseTo(6.996 + 5 + 3.996, 3);
  });

  it('activates when the strike clock reaches atT and expires after its duration', () => {
    let s = strikeState({ eventQueue: [{ kind: 'ember', atT: 1 }] });
    s = stepForge(s, NONE, 0.5, 0, 0, DEFAULT_MODS); // t = 0.5 — not yet
    expect(s.event).toBeNull();
    s = stepForge(s, NONE, 0.6, 0, 0, DEFAULT_MODS); // t = 1.1 — active
    expect(s.event).toEqual({ kind: 'ember', endsT: 1.1 + EMBER_DUR_S });
    expect(s.eventQueue).toHaveLength(0);
    s = stepForge(s, NONE, EMBER_DUR_S, 0, 0, DEFAULT_MODS); // past endsT — expired
    expect(s.event).toBeNull();
    expect(eventDuration('snap')).toBe(SNAP_DUR_S);
  });

  it('Ember Surge widens the effective strike zone (a normal miss lands)', () => {
    // Needle just past the DX-0 half-width → miss normally, hit during the surge.
    const offset = strikeSweetHalf(0) + 0.02;
    const at = strikeState({
      needlePos: 0.5 + offset,
      zoneCentre: 0.5,
      charging: true,
      chargeT: 0.01,
    });
    const plain = stepForge(at, NONE, 0, 0, 0, DEFAULT_MODS);
    const surged = stepForge(
      { ...at, event: { kind: 'ember', endsT: 99 } },
      NONE,
      0,
      0,
      0,
      DEFAULT_MODS,
    );
    expect(plain.strikes[0].acc).toBe(0);
    expect(surged.strikes[0].acc).toBeGreaterThan(0);
  });

  it('Ember Surge multiplies landed progress by EMBER_PROG_MULT', () => {
    const at = strikeState({ charging: true, chargeT: 0.01 });
    const plain = stepForge(at, NONE, 0, 0, 0, DEFAULT_MODS);
    const surged = stepForge(
      { ...at, event: { kind: 'ember', endsT: 99 } },
      NONE,
      0,
      0,
      0,
      DEFAULT_MODS,
    );
    expect(surged.progress / plain.progress).toBeCloseTo(EMBER_PROG_MULT, 6);
  });

  it('Cold Snap multiplies passive decay by SNAP_DECAY_MULT', () => {
    const base = strikeState({ heat: 0.8, event: { kind: 'snap', endsT: 99 } });
    const after = stepForge(base, NONE, 1, 0, 0, DEFAULT_MODS);
    expect(after.heat).toBeCloseTo(0.8 - HEAT_DECAY_RATE * SNAP_DECAY_MULT, 6);
  });

  it('a re-stoke started during a Cold Snap costs no fatigue', () => {
    const snap = strikeState({ heat: 0.5, heatMax: 1, event: { kind: 'snap', endsT: 99 } });
    const during = stepForge(snap, BELLOWS, 0.05, 0, 0, DEFAULT_MODS);
    expect(during.restokes).toBe(1);
    expect(during.heatMax).toBeCloseTo(1, 10); // fatigue waived

    const calm = strikeState({ heat: 0.5, heatMax: 1 });
    const normally = stepForge(calm, BELLOWS, 0.05, 0, 0, DEFAULT_MODS);
    expect(normally.heatMax).toBeCloseTo(1 - RESTOKE_FATIGUE, 10);
  });
});

// ── End conditions ─────────────────────────────────────────────────────────────

describe('end conditions', () => {
  it('progress ≥ 1 enters the quench phase with a full bar', () => {
    const s = strikeState({ progress: 0.95, charging: true, chargeT: 0.01, tempo: 1 });
    const fired = stepForge(s, NONE, 0, 0, 25, DEFAULT_MODS); // perfect crit at max tempo → over 1
    expect(fired.progress).toBeGreaterThanOrEqual(1);
    expect(fired.phase).toBe('quench');
    expect(fired.quenchBar).toBe(1);
    expect(fired.charging).toBe(false);
  });

  it('heat ≤ 0 ends the run mid-charge with the primed strike lost and quench01 = 0', () => {
    const s = strikeState({ heat: 0.01, charging: true, chargeT: CHARGE_TIME_S });
    const after = stepForge(s, HAMMER, 0.5, 0, 25, DEFAULT_MODS);
    expect(after.phase).toBe('done');
    expect(after.heat).toBe(0);
    expect(after.strikes).toHaveLength(0); // no strike fires when heat expires
    expect(after.quench01).toBe(0); // the fire died — the piece was never finished hot
  });

  it('a done run is a fixed point', () => {
    const s: ForgeRunState = { ...strikeState(), phase: 'done' };
    expect(stepForge(s, HAMMER, 0.1, 10, 10, DEFAULT_MODS)).toBe(s);
  });
});

// ── Quench (Phase C) ─────────────────────────────────────────────────────────────

describe('quench', () => {
  it('the bar falls at QUENCH_FALL_RATE per second', () => {
    const s = quenchState();
    expect(stepForge(s, NONE, 1, 0, 0, DEFAULT_MODS).quenchBar).toBeCloseTo(1 - QUENCH_FALL_RATE, 6);
  });

  it('a hammer rising-edge plunges: perfect at the band centre', () => {
    const s = quenchState({ quenchBar: QUENCH_BAND_CENTRE });
    const done = stepForge(s, HAMMER, 0, 0, 0, DEFAULT_MODS);
    expect(done.phase).toBe('done');
    expect(done.quench01).toBeCloseTo(1, 10);
  });

  it('plunge accuracy is triangular against the quench band (DX 0: half 0.12)', () => {
    const halfOff = quenchHalf(0, 1) / 2;
    const s = quenchState({ quenchBar: QUENCH_BAND_CENTRE + halfOff });
    expect(stepForge(s, HAMMER, 0, 0, 0, DEFAULT_MODS).quench01).toBeCloseTo(0.5, 6);
    const wayOff = quenchState({ quenchBar: QUENCH_BAND_CENTRE + quenchHalf(0, 1) + 0.05 });
    const done = stepForge(wayOff, HAMMER, 0, 0, 0, DEFAULT_MODS);
    expect(done.phase).toBe('done'); // a bad plunge still ends the run…
    expect(done.quench01).toBe(0); // …scoring nothing
  });

  it('flux (zoneMult) widens the quench band', () => {
    const off = QUENCH_HALF_BASE + 0.02; // outside the base band, inside the ×1.25 band
    const plain = quenchState({ quenchBar: QUENCH_BAND_CENTRE + off });
    expect(stepForge(plain, HAMMER, 0, 0, 0, DEFAULT_MODS).quench01).toBe(0);
    const fluxed = quenchState({ quenchBar: QUENCH_BAND_CENTRE + off, zoneMult: 1.25 });
    expect(stepForge(fluxed, HAMMER, 0, 0, 0, DEFAULT_MODS).quench01).toBeGreaterThan(0);
  });

  it('a held hammer cannot plunge — only a fresh press (rising edge)', () => {
    const held = quenchState({ quenchBar: QUENCH_BAND_CENTRE, charging: true });
    const after = stepForge(held, HAMMER, 0.1, 0, 0, DEFAULT_MODS);
    expect(after.phase).toBe('quench'); // still falling
    // Release, then press again → fires.
    const released = stepForge(after, NONE, 0.1, 0, 0, DEFAULT_MODS);
    expect(released.charging).toBe(false);
    expect(stepForge(released, HAMMER, 0, 0, 0, DEFAULT_MODS).phase).toBe('done');
  });

  it('an untapped bar times out to done with quench01 = 0', () => {
    const s = quenchState({ quenchBar: 0.01 });
    const done = stepForge(s, NONE, 0.5, 0, 0, DEFAULT_MODS);
    expect(done.phase).toBe('done');
    expect(done.quenchBar).toBe(0);
    expect(done.quench01).toBe(0);
  });

  it('a zero-dt idle quench step changes nothing', () => {
    const s = quenchState({ quenchBar: 0.8 });
    expect(stepForge(s, NONE, 0, 0, 0, DEFAULT_MODS)).toEqual(s);
  });
});

// ── Scoring ─────────────────────────────────────────────────────────────────

describe('forgeScore', () => {
  it('all-perfect run (heat + strikes + quench) scores 1.0', () => {
    const s = strikeState({
      heat01: 1,
      progress: 1,
      quench01: 1,
      strikes: [
        { acc: 1, weight: 1, crit: true },
        { acc: 1, weight: CHARGE_MULT, crit: true },
      ],
    });
    expect(forgeScore(s)).toBeCloseTo(1, 6);
    expect(forgeScore(s)).toBeGreaterThanOrEqual(0.75); // Masterwork band
  });

  it('all-zero run lands in the Crude band (< 0.20)', () => {
    const s = strikeState({ heat01: 0, progress: 0, strikes: [{ acc: 0, weight: 1, crit: false }] });
    expect(forgeScore(s)).toBeLessThan(0.2);
  });

  it('heat01 = 0 caps the score at 0.68 — no faking Masterwork past Phase A', () => {
    const s = strikeState({
      heat01: 0,
      progress: 1,
      quench01: 1,
      strikes: [{ acc: 1, weight: 1, crit: true }],
    });
    expect(forgeScore(s)).toBeCloseTo(0.68, 6);
  });

  it('a botched quench caps at 0.90 — Masterwork stays reachable', () => {
    const s = strikeState({
      heat01: 1,
      progress: 1,
      quench01: 0,
      strikes: [{ acc: 1, weight: 1, crit: true }],
    });
    expect(forgeScore(s)).toBeCloseTo(0.9, 6);
    expect(forgeScore(s)).toBeGreaterThanOrEqual(0.75);
  });

  it('perfect heat alone is 0.32 — Normal, never Fine', () => {
    const s = strikeState({ heat01: 1, progress: 0, strikes: [] });
    expect(forgeScore(s)).toBeCloseTo(0.32, 6);
    expect(forgeScore(s)).toBeLessThan(0.4);
  });

  it('weighting: one accurate heavy outweighs one sloppy light', () => {
    const accurateHeavy = strikeState({
      heat01: 0,
      progress: 1,
      strikes: [
        { acc: 1, weight: CHARGE_MULT, crit: true },
        { acc: 0.1, weight: 1, crit: false },
      ],
    });
    const sloppyHeavy = strikeState({
      heat01: 0,
      progress: 1,
      strikes: [
        { acc: 0.1, weight: CHARGE_MULT, crit: false },
        { acc: 1, weight: 1, crit: true },
      ],
    });
    expect(forgeScore(accurateHeavy)).toBeGreaterThan(forgeScore(sloppyHeavy));
  });

  it('forgeScoreParts is the same formula (UI forecast can never drift from the score)', () => {
    const s = strikeState({
      heat01: 0.8,
      progress: 0.6,
      quench01: 0.5,
      strikes: [
        { acc: 0.7, weight: 1, crit: false },
        { acc: 0.95, weight: CHARGE_MULT, crit: true },
      ],
    });
    const parts = forgeScoreParts(s);
    expect(parts.score01).toBeCloseTo(forgeScore(s), 10);
    expect(parts.score01).toBeCloseTo(0.32 * 0.8 + 0.58 * parts.strike01 + 0.1 * 0.5, 10);
  });

  it('low-accuracy spam scores below fewer accurate strikes', () => {
    const spam = strikeState({
      heat01: 0,
      progress: 1,
      strikes: Array.from({ length: 12 }, () => ({ acc: 0.15, weight: 1, crit: false })),
    });
    const accurate = strikeState({
      heat01: 0,
      progress: 0.7,
      strikes: [
        { acc: 0.95, weight: 1, crit: true },
        { acc: 0.95, weight: CHARGE_MULT, crit: true },
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

  it('needlePeriodMult slows the needle; driftMult speeds the zone (temperaments)', () => {
    const base = strikeState({ needlePos: 0.2, zoneCentre: 0.5 });
    const slowNeedle = stepForge(base, NONE, 0.1, 0, 0, mods({ needlePeriodMult: 2 }));
    const fastNeedle = stepForge(base, NONE, 0.1, 0, 0, DEFAULT_MODS);
    expect(slowNeedle.needlePos - 0.2).toBeCloseTo((fastNeedle.needlePos - 0.2) / 2, 6);
    const fastDrift = stepForge(base, NONE, 0.1, 0, 0, mods({ driftMult: 2 }));
    expect(fastDrift.zoneCentre - 0.5).toBeCloseTo((fastNeedle.zoneCentre - 0.5) * 2, 6);
  });

  it('powerMult scales landed progress (stubborn hits harder)', () => {
    const at = strikeState({ charging: true, chargeT: 0.01 });
    const plain = stepForge(at, NONE, 0, 0, 0, DEFAULT_MODS);
    const strong = stepForge(at, NONE, 0, 0, 0, mods({ powerMult: 1.15 }));
    expect(strong.progress / plain.progress).toBeCloseTo(1.15, 6);
  });
});

// ── Run economy (bot sims — the overhaul's balance guarantees) ───────────────────

const DT = 1 / 60;

interface SmithOpts {
  dx: number;
  st: number;
  runMods: ForgeMods;
  /** |needle − zone| tolerance to fire. Small = skilled aim, large = casual aim. */
  aimTol: number;
  /** Minimum gap between light taps (the player's chosen rhythm). */
  minGapS: number;
  /** Alternate charged heavies between lights. */
  useHeavies: boolean;
  /** Stoke miss, as a fraction of the half-band (0 = perfect commit). */
  stokeErrFrac?: number;
  /** |quenchBar − centre| tolerance to plunge (0.02 = sharp, larger = sloppy). */
  quenchTol?: number;
  /** Heat threshold to begin a re-stoke session (default 0.3; high = stoke-happy marathon). */
  stokeBelow?: number;
}

/**
 * A deterministic scripted player: perfect-ish stoke, strikes when the needle crosses
 * the zone within aimTol, re-stokes below 0.3 heat, plunges near the quench centre.
 * dt is a fixed 1/60 s; the run's event schedule (snap@5s, ember@12s) applies.
 */
function runSmith(o: SmithOpts): { s: ForgeRunState; wallT: number } {
  const { dx, st, runMods: m } = o;
  let s = initForge(dx, st, m);
  let wallT = 0;
  // Phase A: hold to the (possibly missed) commit point, then commit.
  const halfBand = (heatBandWidth(dx) * s.zoneMult) / 2;
  const commitAt = s.bandStart + halfBand + (o.stokeErrFrac ?? 0) * halfBand;
  while (s.heatBar < commitAt - (HEAT_RISE_RATE * DT) / 2 && wallT < 10) {
    s = stepForge(s, BELLOWS, DT, dx, st, m);
    wallT += DT;
  }
  s = commitStoke(s, dx);
  // Phase B: rhythm controller. Stops re-stoking once fatigue has crushed the ceiling
  // (a real player gives up the bellows and lets the piece finish or the fire die).
  let stokeMode = false;
  let heavyNext = o.useHeavies;
  let tapped = false; // pressed last frame → release (fire) this frame
  while (s.phase === 'strike' && wallT < 60) {
    let input = NONE;
    if (stokeMode) {
      input = BELLOWS;
      if (s.heat >= Math.min(0.9 * s.heatMax, 0.85)) stokeMode = false;
    } else if (s.heat < (o.stokeBelow ?? 0.3) && !s.charging && s.heatMax >= 0.35) {
      stokeMode = true;
      input = BELLOWS;
      tapped = false;
    } else if (tapped) {
      tapped = false; // release → the light strike resolves this frame
    } else {
      const aligned = Math.abs(s.needlePos - s.zoneCentre) < o.aimTol;
      if (heavyNext) {
        if (s.charging && s.chargeT >= CHARGE_TIME_S && aligned) {
          heavyNext = false; // release → the heavy resolves this frame
        } else {
          input = HAMMER; // keep charging until aligned
        }
      } else {
        const gapOk = s.lastStrikeT === null || s.t - s.lastStrikeT >= o.minGapS;
        if (gapOk && aligned) {
          input = HAMMER;
          tapped = true;
          if (o.useHeavies) heavyNext = true;
        }
      }
    }
    s = stepForge(s, input, DT, dx, st, m);
    wallT += DT;
  }
  // Phase C: plunge as the bar crosses the band centre.
  while (s.phase === 'quench' && wallT < 60) {
    const plunge = Math.abs(s.quenchBar - QUENCH_BAND_CENTRE) < (o.quenchTol ?? 0.02);
    s = stepForge(s, plunge ? HAMMER : NONE, DT, dx, st, m);
    wallT += DT;
  }
  return { s, wallT };
}

/** A masher: perfect stoke, then blind taps every 0.2 s, never re-stoking. */
function runMasher(dx: number, st: number): { s: ForgeRunState; wallT: number } {
  const m = mods();
  let s = initForge(dx, st, m);
  let wallT = 0;
  const centre = s.bandStart + (heatBandWidth(dx) * s.zoneMult) / 2;
  while (s.heatBar < centre - (HEAT_RISE_RATE * DT) / 2 && wallT < 10) {
    s = stepForge(s, BELLOWS, DT, dx, st, m);
    wallT += DT;
  }
  s = commitStoke(s, dx);
  let frame = 0;
  while (s.phase !== 'done' && wallT < 60) {
    s = stepForge(s, { hammerHeld: frame % 12 === 0, bellowsHeld: false }, DT, dx, st, m);
    frame += 1;
    wallT += DT;
  }
  return { s, wallT };
}

describe('run economy (bot sims)', () => {
  const MID = { dx: 8, st: 8 };

  it('intended play (on-beat lights + heavies) crafts a Masterwork in the 12–25 s band', () => {
    const { s, wallT } = runSmith({ ...MID, runMods: mods(), aimTol: 0.015, minGapS: 0.8, useHeavies: true });
    expect(s.phase).toBe('done');
    expect(s.progress).toBeGreaterThanOrEqual(1); // finished the piece (ended via quench)
    expect(forgeScore(s)).toBeGreaterThanOrEqual(0.75); // Masterwork
    expect(wallT).toBeGreaterThanOrEqual(12);
    expect(wallT).toBeLessThanOrEqual(25);
  });

  it('steady casual play (loose aim, sloppy stoke + quench) earns a mid tier and a complete-ish piece', () => {
    const { s, wallT } = runSmith({
      ...MID,
      runMods: mods(),
      aimTol: 0.09,
      minGapS: 0.95,
      useHeavies: false,
      stokeErrFrac: 0.5, // heat01 0.5 — a decent but imperfect commit
      quenchTol: 0.08,
    });
    expect(s.phase).toBe('done');
    expect(s.progress).toBeGreaterThanOrEqual(0.7); // finishes or nearly finishes
    const score = forgeScore(s);
    expect(score).toBeGreaterThanOrEqual(0.4); // at least Fine
    expect(score).toBeLessThan(0.75); // loose play is not Masterwork
    expect(wallT).toBeLessThanOrEqual(30);
  });

  it('blind mashing loses to intended play on BOTH progress and score (the old exploit is dead)', () => {
    const mash = runMasher(MID.dx, MID.st);
    const skilled = runSmith({ ...MID, runMods: mods(), aimTol: 0.015, minGapS: 0.8, useHeavies: true });
    expect(mash.s.progress).toBeLessThan(1); // the fire dies under a masher
    expect(skilled.s.progress).toBeGreaterThan(mash.s.progress);
    expect(forgeScore(skilled.s)).toBeGreaterThan(forgeScore(mash.s));
    expect(forgeScore(mash.s)).toBeLessThan(0.75); // mash can never fake Masterwork
  });

  it('a re-stoke marathon loses to a clean run at equal strike skill (plan §7 M6 guarantee)', () => {
    // Same aim, same rhythm, same heavies — the ONLY difference is stoking policy.
    // The marathon smith pumps the bellows whenever heat dips below the band start,
    // burning sessions (fatigue) and bleeding progress; the clean smith stokes only
    // when the fire is genuinely dying. Fatigue + progress cooling must make the
    // marathon strictly worse, or infinite stoking would be the dominant line.
    const clean = runSmith({ ...MID, runMods: mods(), aimTol: 0.015, minGapS: 0.8, useHeavies: true });
    const marathon = runSmith({
      ...MID, runMods: mods(), aimTol: 0.015, minGapS: 0.8, useHeavies: true, stokeBelow: 0.62,
    });
    expect(marathon.s.restokes).toBeGreaterThanOrEqual(3);
    expect(marathon.s.restokes).toBeGreaterThan(clean.s.restokes);
    expect(forgeScore(clean.s)).toBeGreaterThan(forgeScore(marathon.s));
  });

  it('reduced-motion accommodations (wider zones, slower decay) preserve the earned tier', () => {
    // The UI plays reduced-motion runs with zoneMult ×1.5 and decayMult ×0.5 on top of
    // the run mods; the same intended-play script must land the same tier (Masterwork).
    const rm = mods({ zoneMult: 1.5, decayMult: 0.5 });
    const { s } = runSmith({ ...MID, runMods: rm, aimTol: 0.015, minGapS: 0.8, useHeavies: true });
    expect(forgeScore(s)).toBeGreaterThanOrEqual(0.75);
  });
});
