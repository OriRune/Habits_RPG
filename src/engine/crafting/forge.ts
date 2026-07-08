// The Forge — crafting minigame engine (pure, no React / store / RNG).
//
// A deterministic two-phase heat economy that scores a crafted item's quality tier.
//   Phase A ('stoke'): hold to fill a heat bar; release/commit near the sweet band → heat01.
//   Phase B ('strike'): an oscillating needle sweeps a moving sweet-zone; the player spends
//     the committed heat on light strikes, chargeable heavy strikes, and re-stokes (which
//     recover heat but fatigue the metal and bleed forge-progress).
// Reducer shape mirrors trials/lastStand.ts & trials/rooftopChase.ts (stepX(state,input,dt));
// the accuracy helpers mirror trials/armoryBreak.ts (triangular falloff, centre→1 edge→0).
// No RNG — the Forge is single-player and fully deterministic; dt arrives as a parameter.
// See docs/forge-minigame-development-plan.md §3 (mechanic) & §6 (Fuel & Flux mods).

// ── Tuning constants (§3; tuned in M6) ─────────────────────────────────────────

export const HEAT_RISE_RATE = 0.25; // Phase A fill + Phase B re-stoke, per second
export const HEAT_FALL_RATE = 0.35; // Phase A bar drop when released, per second
export const HEAT_DECAY_RATE = 0.125; // Phase B passive drain (8 s runway at full heat)
export const HEAT_BAND_START = 0.62; // lower edge of the Phase A sweet band
export const HEAT_BAND_WIDTH_BASE = 0.16; // Phase A band span, widened by DX
export const NEEDLE_PERIOD_S = 2.0; // Phase B needle: full left→right→left sweep
export const SWEET_HALF_BASE = 0.1; // Phase B sweet-zone half-width, widened by DX
export const CHARGE_TIME_S = 0.9; // hammer hold to prime a heavy strike
export const CHARGE_MULT = 1.9; // heavy strike progress + score weight multiplier
export const CHARGE_ZONE_SHRINK = 0.75; // sweet-zone half-width factor at full charge
export const RESTOKE_FATIGUE = 0.15; // max-heat loss per re-stoke session
export const PROGRESS_COOL_RATE = 0.04; // forge-progress drain per second while stoking

/**
 * Fraction of the needle's sweep speed at which the sweet-zone centre drifts.
 * Slower than the needle so the two motions don't lock into a beat pattern the
 * player can memorise — the zone slides under the needle at ~0.35× its speed.
 */
export const ZONE_DRIFT_FRAC = 0.35;

// ── Stat-scaling helpers (§3) ──────────────────────────────────────────────────
// Stats hard-cap at 25 (STAT_CAP), so the min() ceilings are unreachable safety rails.

/** Phase A sweet-band width — DX widens it (more room to lock good heat). */
export function heatBandWidth(dx: number): number {
  return Math.min(0.4, HEAT_BAND_WIDTH_BASE + dx * 0.008);
}

/**
 * Phase B sweet-zone half-width — DX widens it (more forgiving strike timing). `bonus`
 * is the Homestead Smithy `forge_focus` perk (0 or 0.03), added to the base before the
 * 0.35 cap (additive, never folded into flux). Default 0 keeps the un-perked width.
 */
export function strikeSweetHalf(dx: number, bonus: number = 0): number {
  return Math.min(0.35, SWEET_HALF_BASE + bonus + dx * 0.006);
}

/** Progress filled by a perfectly-accurate light strike — ST powers each blow. */
export function strikePower(st: number): number {
  return Math.min(0.4, 0.2 * (1 + st * 0.015));
}

// ── Accuracy helpers (triangular falloff, armoryAccuracy shape) ────────────────

/**
 * Phase A heat accuracy from a released bar position (0..1).
 * Peak (1.0) at the band centre; falls to 0 at both band edges; 0 outside the band.
 * `bandWidth` is the effective (DX- and flux-scaled) span so the score matches the
 * band the UI draws. Defaults to HEAT_BAND_WIDTH_BASE for the standard band.
 */
export function heatAccuracy(barPos: number, bandWidth: number = HEAT_BAND_WIDTH_BASE): number {
  if (bandWidth <= 0) return 0;
  const end = HEAT_BAND_START + bandWidth;
  if (barPos < HEAT_BAND_START || barPos > end) return 0;
  const centre = HEAT_BAND_START + bandWidth / 2;
  return 1 - Math.abs(barPos - centre) / (bandWidth / 2);
}

/**
 * Phase B strike accuracy from the needle position vs the (moving) sweet-zone centre.
 * Peak (1.0) at the centre; falls to 0 at ±halfWidth; 0 beyond. `halfWidth` is the
 * effective half-width after DX widening, flux, and the in-charge shrink.
 */
export function strikeAccuracy(needlePos: number, zoneCentre: number, halfWidth: number): number {
  if (halfWidth <= 0) return 0;
  const d = Math.abs(needlePos - zoneCentre);
  if (d >= halfWidth) return 0;
  return 1 - d / halfWidth;
}

/**
 * Sweet-zone half-width shrink factor while a heavy strike charges: 1.0 uncharged,
 * linearly down to CHARGE_ZONE_SHRINK (0.75) at full charge. Floored there because
 * chargeT is capped at CHARGE_TIME_S. The heavy's risk: a narrower zone to hit.
 */
function chargeShrinkFactor(chargeT: number): number {
  const t = Math.min(1, Math.max(0, chargeT / CHARGE_TIME_S));
  return 1 - (1 - CHARGE_ZONE_SHRINK) * t;
}

/**
 * Effective Phase-B sweet-zone half-width after DX widening, flux (zoneMult), the
 * accessibility floor, and the in-charge shrink. Single source of truth so the UI
 * renders the zone at exactly the size stepForge scores (no twin drift).
 *
 * A11y floor (§7 M6): the 0.10 (SWEET_HALF_BASE) minimum is applied to the UNCHARGED
 * width only, *before* the charge shrink — so even DX 1 keeps a Normal-reachable
 * target, while a charged heavy still pays its zone shrink (0.10 → 0.075) instead of
 * being floored back to full width (which would make charging penalty-free at low DX).
 * With production inputs (zoneMult ≥ 1, strikeSweetHalf ≥ 0.10) the floor is an inert
 * safety rail, matching the min() ceiling idiom above; it only engages if a modifier
 * ever narrows the raw width below 0.10.
 */
export function effectiveStrikeHalf(dx: number, zoneMult: number, chargeT: number, bonus: number = 0): number {
  const uncharged = Math.max(SWEET_HALF_BASE, strikeSweetHalf(dx, bonus) * zoneMult);
  return uncharged * chargeShrinkFactor(chargeT);
}

/**
 * Reflect a 0..1 oscillator one step, bouncing off both walls. dt is small enough
 * that a single reflection per step is sufficient.
 */
function osc(pos: number, dir: 1 | -1, speed: number, dt: number): [number, 1 | -1] {
  let p = pos + dir * speed * dt;
  let d: 1 | -1 = dir;
  if (p > 1) {
    p = 1 - (p - 1);
    d = -1;
  } else if (p < 0) {
    p = -p;
    d = 1;
  }
  return [Math.max(0, Math.min(1, p)), d];
}

// ── State & inputs ─────────────────────────────────────────────────────────────

export interface ForgeRunState {
  phase: 'stoke' | 'strike' | 'done';
  heatBar: number; // Phase A fill (0..1)
  heat01: number; // committed Phase A accuracy (set at commitStoke)
  heat: number; // Phase B spendable heat resource
  heatMax: number; // Phase B heat ceiling; drops with re-stoke fatigue
  restokes: number; // completed re-stoke sessions
  charging: boolean;
  chargeT: number; // seconds the hammer has been held (capped at CHARGE_TIME_S)
  stoking: boolean;
  needlePos: number;
  needleDir: 1 | -1;
  zoneCentre: number;
  zoneDir: 1 | -1;
  progress: number; // forge completion (0..1)
  strikes: { acc: number; weight: number }[];
  /**
   * Flux zone multiplier baked in from ForgeMods.zoneMult. Stored so commitStoke —
   * whose signature carries only dx — can widen the Phase A band by the same flux
   * factor the strike path reads from `mods.zoneMult`. (Minimal addition to the
   * spec'd interface; see the M2 report.)
   */
  zoneMult: number;
}

export interface ForgeInput {
  hammerHeld: boolean;
  bellowsHeld: boolean;
}

/** Fuel & Flux run modifiers (§6). Defaults are the un-boosted run. */
export interface ForgeMods {
  decayMult: number; // fuel: heat-decay multiplier (Seasoned Wood → 0.7)
  fatigue: number; // per-session heatMax loss (Firebrick → 0.08, default RESTOKE_FATIGUE)
  zoneMult: number; // flux: both sweet zones widened (Gemstone → 1.25)
}

export const DEFAULT_MODS: ForgeMods = { decayMult: 1, fatigue: RESTOKE_FATIGUE, zoneMult: 1 };

/**
 * Fuel & Flux selection (§6). Store-facing input (passed to craft/reforge); no React or store
 * imports, so it lives here beside boostMods. One fuel + one flux max; the two fuels are
 * mutually exclusive by the `'wood' | 'stone'` type.
 */
export interface ForgeBoosts {
  /** Seasoned Wood (slower heat decay) or Firebrick (less re-stoke fatigue). */
  fuel?: 'wood' | 'stone';
  /** Gemstone flux — both sweet zones ×1.25 wider. */
  flux?: boolean;
}

/**
 * Map a Fuel & Flux selection to run modifiers (§6): Seasoned Wood → decayMult 0.7, Firebrick
 * → fatigue 0.08, Gemstone flux → zoneMult 1.25. No boosts ⇒ DEFAULT_MODS. Returns a fresh
 * object so the shared DEFAULT_MODS is never mutated.
 */
export function boostMods(boosts?: ForgeBoosts): ForgeMods {
  const out: ForgeMods = { ...DEFAULT_MODS };
  if (boosts?.fuel === 'wood') out.decayMult = 0.7;
  else if (boosts?.fuel === 'stone') out.fatigue = 0.08;
  if (boosts?.flux) out.zoneMult = 1.25;
  return out;
}

/** Fresh Phase A state. dx/st are part of the run API (used by stepForge); mods seed flux. */
export function initForge(_dx: number, _st: number, mods?: Partial<ForgeMods>): ForgeRunState {
  const zoneMult = mods?.zoneMult ?? DEFAULT_MODS.zoneMult;
  return {
    phase: 'stoke',
    heatBar: 0,
    heat01: 0,
    heat: 0,
    heatMax: 1,
    restokes: 0,
    charging: false,
    chargeT: 0,
    stoking: false,
    needlePos: 0,
    needleDir: 1,
    zoneCentre: 0.5,
    zoneDir: 1,
    progress: 0,
    strikes: [],
    zoneMult,
  };
}

/**
 * Phase A release/commit: lock the current bar level as heat and open Phase B.
 * heat01 = proximity of the bar to the DX/flux-widened band centre; heat = bar level.
 */
export function commitStoke(s: ForgeRunState, dx: number): ForgeRunState {
  if (s.phase !== 'stoke') return s;
  const bandWidth = heatBandWidth(dx) * s.zoneMult;
  return {
    ...s,
    phase: 'strike',
    heat01: heatAccuracy(s.heatBar, bandWidth),
    heat: s.heatBar,
    heatMax: 1,
  };
}

/**
 * Advance one time step. Pure: does not mutate `state`.
 * Phase A just fills/drops the heat bar. Phase B oscillates the needle+zone, applies
 * passive heat decay (× fuel decayMult), resolves strikes on hammer release, and runs
 * re-stoke sessions (heat rise, progress cooling, one fatigue hit per session start).
 * Ends when progress ≥ 1 or heat ≤ 0 (a primed charge is lost if heat expires first).
 */
export function stepForge(
  s: ForgeRunState,
  input: ForgeInput,
  dtSec: number,
  dx: number,
  st: number,
  mods: ForgeMods,
  sweetBonus: number = 0,
): ForgeRunState {
  if (s.phase === 'done') return s;

  if (s.phase === 'stoke') {
    // One panel drives Phase A, so either control counts as "holding the bellows".
    const holding = input.bellowsHeld || input.hammerHeld;
    const heatBar = Math.max(
      0,
      Math.min(1, s.heatBar + (holding ? HEAT_RISE_RATE : -HEAT_FALL_RATE) * dtSec),
    );
    return { ...s, heatBar };
  }

  // ── phase === 'strike' ───────────────────────────────────────────────────────

  // 1. Oscillate the needle and the (slower) sweet-zone centre.
  const needleSpeed = 2 / NEEDLE_PERIOD_S;
  const [needlePos, needleDir] = osc(s.needlePos, s.needleDir, needleSpeed, dtSec);
  const [zoneCentre, zoneDir] = osc(s.zoneCentre, s.zoneDir, needleSpeed * ZONE_DRIFT_FRAC, dtSec);

  // 2. Re-stoke session detection + one-shot metal fatigue on session start.
  const stoking = input.bellowsHeld;
  let heatMax = s.heatMax;
  let restokes = s.restokes;
  if (stoking && !s.stoking) {
    heatMax = Math.max(0, heatMax - mods.fatigue);
    restokes += 1;
  }

  // 3. Heat: rises while stoking, else passive decay (× fuel decayMult). Clamp to ceiling.
  let heat = stoking
    ? s.heat + HEAT_RISE_RATE * dtSec
    : s.heat - HEAT_DECAY_RATE * mods.decayMult * dtSec;
  heat = Math.min(heat, heatMax);

  // 4. Forge-progress cools while stoking.
  let progress = stoking ? Math.max(0, s.progress - PROGRESS_COOL_RATE * dtSec) : s.progress;

  // 5. Heat exhausted → run ends. A primed charge is lost (no strike fires).
  if (heat <= 0) {
    return {
      ...s,
      phase: 'done',
      heat: 0,
      heatMax,
      restokes,
      stoking,
      charging: false,
      chargeT: 0,
      progress,
      needlePos,
      needleDir,
      zoneCentre,
      zoneDir,
    };
  }

  // 6. Strike verbs — impossible while stoking (any in-progress charge is cancelled).
  let charging = s.charging;
  let chargeT = s.chargeT;
  let strikes = s.strikes;

  if (stoking) {
    charging = false;
    chargeT = 0;
  } else if (input.hammerHeld) {
    charging = true;
    chargeT = Math.min(CHARGE_TIME_S, s.chargeT + dtSec);
  } else if (s.charging) {
    // Hammer released → resolve one strike at the needle's current position.
    const isHeavy = s.chargeT >= CHARGE_TIME_S;
    const halfWidth = effectiveStrikeHalf(dx, mods.zoneMult, s.chargeT, sweetBonus);
    const acc = strikeAccuracy(needlePos, zoneCentre, halfWidth);
    const weight = isHeavy ? CHARGE_MULT : 1;
    progress += acc * strikePower(st) * weight;
    strikes = [...strikes, { acc, weight }];
    charging = false;
    chargeT = 0;
  }

  const done = progress >= 1;

  return {
    ...s,
    phase: done ? 'done' : 'strike',
    heat,
    heatMax,
    restokes,
    charging,
    chargeT,
    stoking,
    needlePos,
    needleDir,
    zoneCentre,
    zoneDir,
    progress,
    strikes,
  };
}

/**
 * Final quality score (§3 blend). Contribution-weighted mean accuracy prevents spam:
 *   meanAcc  = Σ(acc·w) / Σw
 *   strike01 = √(progressFilled × meanAcc)   — needs BOTH fill and accuracy
 *   score01  = clamp(0.35·heat01 + 0.65·strike01, 0, 1)
 * A perfect Phase A is worth only 0.35, so Masterwork (≥0.75) needs real strikes too.
 */
export function forgeScore(s: ForgeRunState): number {
  let sumW = 0;
  let sumAW = 0;
  for (const { acc, weight } of s.strikes) {
    sumW += weight;
    sumAW += acc * weight;
  }
  const meanAcc = sumW > 0 ? sumAW / sumW : 0;
  const progressFilled = Math.max(0, Math.min(1, s.progress));
  const strike01 = Math.sqrt(progressFilled * meanAcc);
  return Math.max(0, Math.min(1, 0.35 * s.heat01 + 0.65 * strike01));
}
