// The Forge — crafting minigame engine (pure, no React / store; RNG injectable).
//
// A deterministic heat economy that scores a crafted item's quality tier in three phases.
//   Phase A ('stoke'): hold to fill a heat bar; release/commit near the sweet band → heat01.
//   Phase B ('strike'): an oscillating needle sweeps a moving sweet-zone; the player spends
//     the committed heat on light strikes, chargeable heavy strikes, and re-stokes (which
//     recover heat but fatigue the metal and bleed forge-progress). A tempo meter rewards
//     spaced, landed blows; near-perfect strikes crit; scheduled forge events (ember surge /
//     cold snap) punctuate the phase.
//   Phase C ('quench'): the finished piece must be plunged into the slack tub as a falling
//     bar crosses the quench band — one timed tap worth a small slice of the score.
// Reducer shape mirrors trials/lastStand.ts & trials/rooftopChase.ts (stepX(state,input,dt));
// the accuracy helpers mirror trials/armoryBreak.ts (triangular falloff, centre→1 edge→0).
// The only randomness is the event schedule, rolled ONCE at initForge from an injectable
// rng (default a constant, so un-seeded runs and tests stay fully deterministic); stepForge
// itself never rolls. dt arrives as a parameter.
// See docs/forge-minigame-development-plan.md §3 (mechanic) & §6 (Fuel & Flux mods).

// ── Tuning constants (§3; retuned for the tempo/crit overhaul) ──────────────────

export const HEAT_RISE_RATE = 0.25; // Phase A fill + Phase B re-stoke, per second
export const HEAT_FALL_RATE = 0.35; // Phase A bar drop when released, per second
export const HEAT_DECAY_RATE = 0.125; // Phase B passive drain (8 s runway at full heat)
export const HEAT_BAND_START = 0.62; // default lower edge of the Phase A sweet band
export const HEAT_BAND_WIDTH_BASE = 0.16; // Phase A band span, widened by DX
export const NEEDLE_PERIOD_S = 2.0; // Phase B needle: full left→right→left sweep
export const SWEET_HALF_BASE = 0.1; // Phase B sweet-zone half-width, widened by DX
export const CHARGE_TIME_S = 0.9; // hammer hold to prime a heavy strike
export const CHARGE_MULT = 1.7; // heavy strike progress + score weight multiplier
export const CHARGE_ZONE_SHRINK = 0.75; // sweet-zone half-width factor at full charge
export const RESTOKE_FATIGUE = 0.1; // max-heat loss per re-stoke session (0.15 pre-overhaul: longer runs mean more re-stokes, so each costs less)
export const PROGRESS_COOL_RATE = 0.04; // forge-progress drain per second while stoking

/**
 * Fraction of the needle's sweep speed at which the sweet-zone centre drifts.
 * Slower than the needle so the two motions don't lock into a beat pattern the
 * player can memorise — the zone slides under the needle at ~0.35× its speed.
 */
export const ZONE_DRIFT_FRAC = 0.35;

// Tempo meter (anti-mash by design): landed blows spaced inside the on-beat window
// build tempo, which multiplies progress; mashing (or whiffing) resets it. The hammer
// never refuses input — a mashed strike just lands weak (×TEMPO_MULT_MIN).
export const TEMPO_SPAM_S = 0.55; // strike gap below this = mash → tempo resets
export const TEMPO_MIN_GAP_S = 0.7; // on-beat window, lower edge
export const TEMPO_MAX_GAP_S = 1.6; // on-beat window, upper edge
export const TEMPO_GAIN = 0.25; // tempo gained per on-beat landed strike
export const TEMPO_DECAY_RATE = 0.08; // passive tempo drain per second (strike phase)
export const TEMPO_MULT_MIN = 0.75; // progress multiplier at tempo 0
export const TEMPO_MULT_MAX = 1.25; // progress multiplier at tempo 1

// Perfect-strike crits: near-centre blows ring true for bonus progress.
export const CRIT_ACC = 0.92; // strike accuracy at/above this = crit
export const CRIT_BONUS = 1.25; // extra progress multiplier on a crit

// Forge events (rolled once at initForge; see rollEventQueue).
export const EMBER_DUR_S = 2.5; // Ember Surge duration
export const EMBER_ZONE_MULT = 1.5; // Ember Surge: strike sweet-zone widening
export const EMBER_PROG_MULT = 1.3; // Ember Surge: landed-strike progress bonus
export const SNAP_DUR_S = 2.0; // Cold Snap duration
export const SNAP_DECAY_MULT = 2.5; // Cold Snap: passive heat-decay multiplier

// Phase C quench: one timed plunge as the bar falls from 1 → 0.
export const QUENCH_FALL_RATE = 0.45; // bar drop per second (~2.2 s window)
export const QUENCH_BAND_CENTRE = 0.55; // perfect-plunge bar position
export const QUENCH_HALF_BASE = 0.12; // quench band half-width, widened by DX + flux

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

/**
 * Progress filled by a perfectly-accurate light strike — ST powers each blow.
 * Base 0.13 (was 0.20 pre-overhaul): the tempo/crit multipliers raise a good
 * blow's real value, so the base drops to keep runs in the 15–25 s band.
 */
export function strikePower(st: number): number {
  return Math.min(0.26, 0.13 * (1 + st * 0.015));
}

/** Quench band half-width — DX and flux widen it (same forgiveness levers as strikes). */
export function quenchHalf(dx: number, zoneMult: number): number {
  return Math.min(0.35, (QUENCH_HALF_BASE + dx * 0.004) * zoneMult);
}

/** Tempo → progress multiplier: TEMPO_MULT_MIN at 0, TEMPO_MULT_MAX at 1, linear. */
export function tempoMult(tempo: number): number {
  const t = Math.min(1, Math.max(0, tempo));
  return TEMPO_MULT_MIN + (TEMPO_MULT_MAX - TEMPO_MULT_MIN) * t;
}

// ── Accuracy helpers (triangular falloff, armoryAccuracy shape) ────────────────

/**
 * Phase A heat accuracy from a released bar position (0..1).
 * Peak (1.0) at the band centre; falls to 0 at both band edges; 0 outside the band.
 * `bandWidth` is the effective (DX- and flux-scaled) span and `bandStart` the
 * temperament-shifted lower edge, so the score matches the band the UI draws.
 */
export function heatAccuracy(
  barPos: number,
  bandWidth: number = HEAT_BAND_WIDTH_BASE,
  bandStart: number = HEAT_BAND_START,
): number {
  if (bandWidth <= 0) return 0;
  const end = bandStart + bandWidth;
  if (barPos < bandStart || barPos > end) return 0;
  const centre = bandStart + bandWidth / 2;
  return 1 - Math.abs(barPos - centre) / (bandWidth / 2);
}

/**
 * Phase B strike accuracy from the needle position vs the (moving) sweet-zone centre.
 * Peak (1.0) at the centre; falls to 0 at ±halfWidth; 0 beyond. `halfWidth` is the
 * effective half-width after DX widening, flux, and the in-charge shrink. Also reused
 * for the Phase C plunge (bar position vs the quench band).
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
 * renders the zone at exactly the size stepForge scores (no twin drift). During an
 * Ember Surge, pass activeZoneMult(...) as `zoneMult` so both sides widen together.
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
 * The zone multiplier in force right now: the run's flux/temperament zoneMult, widened
 * ×EMBER_ZONE_MULT while an Ember Surge is active. Both stepForge and the UI derive
 * the strike zone through this helper so the drawn zone is always the scored zone.
 */
export function activeZoneMult(s: Pick<ForgeRunState, 'event'>, zoneMult: number): number {
  return zoneMult * (s.event?.kind === 'ember' ? EMBER_ZONE_MULT : 1);
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

// ── Forge events ────────────────────────────────────────────────────────────────

export type ForgeEventKind = 'ember' | 'snap';

/** A scheduled event: activates when the strike-phase clock reaches atT. */
export interface ForgeEventSpec {
  kind: ForgeEventKind;
  atT: number;
}

/** The event in force: cleared when the strike-phase clock reaches endsT. */
export interface ForgeEvent {
  kind: ForgeEventKind;
  endsT: number;
}

/**
 * Roll the run's event schedule (once, at initForge). Two events per run, one of each
 * kind in rng-chosen order: the first 3–7 s into the strike phase, the second 5–9 s
 * after the first. With the default constant rng (0.5) this pins to snap@5s, ember@12s
 * — deterministic for tests and for any caller that doesn't opt into randomness.
 */
export function rollEventQueue(rng: () => number): ForgeEventSpec[] {
  const firstAt = 3 + rng() * 4;
  const firstKind: ForgeEventKind = rng() < 0.5 ? 'ember' : 'snap';
  const secondKind: ForgeEventKind = firstKind === 'ember' ? 'snap' : 'ember';
  return [
    { kind: firstKind, atT: firstAt },
    { kind: secondKind, atT: firstAt + 5 + rng() * 4 },
  ];
}

/** Event duration by kind. */
export function eventDuration(kind: ForgeEventKind): number {
  return kind === 'ember' ? EMBER_DUR_S : SNAP_DUR_S;
}

// ── Metal temperaments ──────────────────────────────────────────────────────────

export type ForgeTemperamentId = 'stubborn' | 'fickle' | 'supple';

/**
 * A material family's forging personality — multiplies onto the run's ForgeMods so
 * different recipes PLAY differently, not just cost differently. The recipe→id mapping
 * lives in engine/crafting.ts::recipeTemperament (this file stays content-free).
 */
export interface ForgeTemperament {
  label: string;
  blurb: string;
  needlePeriodMult: number;
  driftMult: number;
  zoneMult: number;
  decayMult: number;
  powerMult: number;
  bandStartShift: number;
  fatigueMult: number;
}

export const TEMPERAMENTS: Record<ForgeTemperamentId, ForgeTemperament> = {
  stubborn: {
    label: 'Stubborn',
    blurb: 'A slow, heavy needle and a tight zone — line up deliberate blows.',
    needlePeriodMult: 1.2,
    driftMult: 0.8,
    zoneMult: 0.9,
    decayMult: 1,
    powerMult: 1.15,
    bandStartShift: 0.04,
    fatigueMult: 1,
  },
  fickle: {
    label: 'Fickle',
    blurb: 'A twitchy needle, a restless zone, and a fire that bleeds fast.',
    needlePeriodMult: 0.8,
    driftMult: 1.6,
    zoneMult: 1.15,
    decayMult: 1.15,
    powerMult: 0.9,
    bandStartShift: -0.06,
    fatigueMult: 1,
  },
  supple: {
    label: 'Supple',
    blurb: 'Forgiving heat and cheap re-stokes — keep the rhythm going.',
    needlePeriodMult: 1,
    driftMult: 1,
    zoneMult: 1,
    decayMult: 0.85,
    powerMult: 1,
    bandStartShift: -0.1,
    fatigueMult: 0.6,
  },
};

/**
 * Fold a temperament into a run's mods: multipliers compose multiplicatively (so flux
 * × fickle zoneMult = 1.25 × 1.15), the band shift adds, and fatigue scales by
 * fatigueMult. Returns a fresh object; never mutates. No id ⇒ untouched copy.
 */
export function applyTemperament(mods: ForgeMods, id?: ForgeTemperamentId): ForgeMods {
  if (!id) return { ...mods };
  const t = TEMPERAMENTS[id];
  return {
    decayMult: mods.decayMult * t.decayMult,
    fatigue: mods.fatigue * t.fatigueMult,
    zoneMult: mods.zoneMult * t.zoneMult,
    needlePeriodMult: mods.needlePeriodMult * t.needlePeriodMult,
    driftMult: mods.driftMult * t.driftMult,
    powerMult: mods.powerMult * t.powerMult,
    bandStartShift: mods.bandStartShift + t.bandStartShift,
  };
}

// ── State & inputs ─────────────────────────────────────────────────────────────

export interface ForgeRunState {
  phase: 'stoke' | 'strike' | 'quench' | 'done';
  heatBar: number; // Phase A fill (0..1)
  heat01: number; // committed Phase A accuracy (set at commitStoke)
  heat: number; // Phase B spendable heat resource
  heatMax: number; // Phase B heat ceiling; drops with re-stoke fatigue
  restokes: number; // completed re-stoke sessions
  charging: boolean; // strike: hammer held; quench: hammer-was-held (edge detector)
  chargeT: number; // seconds the hammer has been held (capped at CHARGE_TIME_S)
  stoking: boolean;
  needlePos: number;
  needleDir: 1 | -1;
  zoneCentre: number;
  zoneDir: 1 | -1;
  progress: number; // forge completion (0..1)
  strikes: { acc: number; weight: number; crit: boolean }[];
  t: number; // strike-phase clock, seconds (drives tempo gaps + the event schedule)
  tempo: number; // rhythm meter 0..1 → tempoMult on progress
  lastStrikeT: number | null; // strike-phase time of the last resolved strike
  eventQueue: ForgeEventSpec[]; // pending events, ascending atT
  event: ForgeEvent | null; // event currently in force
  quenchBar: number; // Phase C falling bar (1 → 0)
  quench01: number; // committed plunge accuracy (0 on timeout/heat death)
  /**
   * Flux zone multiplier baked in from ForgeMods.zoneMult. Stored so commitStoke —
   * whose signature carries only dx — can widen the Phase A band by the same flux
   * factor the strike path reads from `mods.zoneMult`. (Minimal addition to the
   * spec'd interface; see the M2 report.)
   */
  zoneMult: number;
  /** Temperament-shifted Phase A band lower edge, seeded at initForge. */
  bandStart: number;
}

export interface ForgeInput {
  hammerHeld: boolean;
  bellowsHeld: boolean;
}

/**
 * Run modifiers: Fuel & Flux (§6) × metal temperament. Defaults are the un-boosted,
 * even-tempered run.
 */
export interface ForgeMods {
  decayMult: number; // fuel/temperament: heat-decay multiplier (Seasoned Wood → 0.7)
  fatigue: number; // per-session heatMax loss (Firebrick → 0.05, default RESTOKE_FATIGUE)
  zoneMult: number; // flux/temperament: sweet zones widened (Gemstone → 1.25)
  needlePeriodMult: number; // temperament: needle sweep-period multiplier
  driftMult: number; // temperament: zone-drift speed multiplier
  powerMult: number; // temperament: strike progress multiplier
  bandStartShift: number; // temperament: Phase A band lower-edge shift
}

export const DEFAULT_MODS: ForgeMods = {
  decayMult: 1,
  fatigue: RESTOKE_FATIGUE,
  zoneMult: 1,
  needlePeriodMult: 1,
  driftMult: 1,
  powerMult: 1,
  bandStartShift: 0,
};

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
 * → fatigue 0.05, Gemstone flux → zoneMult 1.25. No boosts ⇒ DEFAULT_MODS. Returns a fresh
 * object so the shared DEFAULT_MODS is never mutated.
 */
export function boostMods(boosts?: ForgeBoosts): ForgeMods {
  const out: ForgeMods = { ...DEFAULT_MODS };
  if (boosts?.fuel === 'wood') out.decayMult = 0.7;
  else if (boosts?.fuel === 'stone') out.fatigue = 0.05;
  if (boosts?.flux) out.zoneMult = 1.25;
  return out;
}

/**
 * Fresh Phase A state. dx/st are part of the run API (used by stepForge); mods seed flux
 * and the temperament band shift. `rng` rolls the event schedule ONCE here — pass
 * Math.random for a live run; the default constant keeps un-seeded runs deterministic
 * (snap@5s, ember@12s).
 */
export function initForge(
  _dx: number,
  _st: number,
  mods?: Partial<ForgeMods>,
  rng: () => number = () => 0.5,
): ForgeRunState {
  const zoneMult = mods?.zoneMult ?? DEFAULT_MODS.zoneMult;
  const bandStart = Math.min(0.8, Math.max(0.3, HEAT_BAND_START + (mods?.bandStartShift ?? 0)));
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
    t: 0,
    tempo: 0,
    lastStrikeT: null,
    eventQueue: rollEventQueue(rng),
    event: null,
    quenchBar: 1,
    quench01: 0,
    zoneMult,
    bandStart,
  };
}

/**
 * Phase A release/commit: lock the current bar level as heat and open Phase B.
 * heat01 = proximity of the bar to the DX/flux-widened, temperament-shifted band centre;
 * heat = bar level.
 */
export function commitStoke(s: ForgeRunState, dx: number): ForgeRunState {
  if (s.phase !== 'stoke') return s;
  const bandWidth = heatBandWidth(dx) * s.zoneMult;
  return {
    ...s,
    phase: 'strike',
    heat01: heatAccuracy(s.heatBar, bandWidth, s.bandStart),
    heat: s.heatBar,
    heatMax: 1,
  };
}

/**
 * Advance one time step. Pure: does not mutate `state`.
 * Phase A just fills/drops the heat bar. Phase B oscillates the needle+zone (speeds ×
 * temperament), advances the strike clock + event schedule, applies passive heat decay
 * (× fuel decayMult, × SNAP_DECAY_MULT in a cold snap), decays tempo, resolves strikes
 * on hammer release (tempo/crit/event multipliers on progress), and runs re-stoke
 * sessions (heat rise, progress cooling, one fatigue hit per session start — waived
 * during a cold snap). progress ≥ 1 → 'quench'; heat ≤ 0 → 'done' (quench01 stays 0:
 * a piece the fire died under was never finished hot). Phase C drops the quench bar;
 * a hammer rising-edge plunges (quench01 = band accuracy), timeout scores 0.
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

  if (s.phase === 'quench') {
    // Bar falls; a hammer rising-edge plunges the piece. `charging` doubles as the
    // previous frame's hammer state so a held button can't fire more than once.
    const quenchBar = Math.max(0, s.quenchBar - QUENCH_FALL_RATE * dtSec);
    const plunge = input.hammerHeld && !s.charging;
    if (plunge && quenchBar > 0) {
      const half = quenchHalf(dx, s.zoneMult);
      return {
        ...s,
        phase: 'done',
        quenchBar,
        quench01: strikeAccuracy(quenchBar, QUENCH_BAND_CENTRE, half),
        charging: true,
      };
    }
    if (quenchBar <= 0) {
      return { ...s, phase: 'done', quenchBar: 0, quench01: 0, charging: input.hammerHeld };
    }
    return { ...s, quenchBar, charging: input.hammerHeld };
  }

  // ── phase === 'strike' ───────────────────────────────────────────────────────

  // 1. Advance the strike clock; activate/expire the scheduled event.
  const t = s.t + dtSec;
  let event = s.event && t < s.event.endsT ? s.event : null;
  let eventQueue = s.eventQueue;
  if (!event && eventQueue.length > 0 && eventQueue[0].atT <= t) {
    const spec = eventQueue[0];
    eventQueue = eventQueue.slice(1);
    event = { kind: spec.kind, endsT: t + eventDuration(spec.kind) };
  }
  const inSnap = event?.kind === 'snap';
  const inEmber = event?.kind === 'ember';

  // 2. Oscillate the needle and the (slower) sweet-zone centre, speeds × temperament.
  const needleSpeed = 2 / (NEEDLE_PERIOD_S * mods.needlePeriodMult);
  const [needlePos, needleDir] = osc(s.needlePos, s.needleDir, needleSpeed, dtSec);
  const [zoneCentre, zoneDir] = osc(
    s.zoneCentre,
    s.zoneDir,
    needleSpeed * ZONE_DRIFT_FRAC * mods.driftMult,
    dtSec,
  );

  // 3. Re-stoke session detection + one-shot metal fatigue on session start
  //    (fatigue waived during a cold snap — the bellows as a reaction, not a panic).
  const stoking = input.bellowsHeld;
  let heatMax = s.heatMax;
  let restokes = s.restokes;
  if (stoking && !s.stoking) {
    heatMax = Math.max(0, heatMax - (inSnap ? 0 : mods.fatigue));
    restokes += 1;
  }

  // 4. Heat: rises while stoking, else passive decay (× fuel decayMult, × snap).
  let heat = stoking
    ? s.heat + HEAT_RISE_RATE * dtSec
    : s.heat - HEAT_DECAY_RATE * mods.decayMult * (inSnap ? SNAP_DECAY_MULT : 1) * dtSec;
  heat = Math.min(heat, heatMax);

  // 5. Forge-progress cools while stoking; tempo always drains (it can't be banked).
  let progress = stoking ? Math.max(0, s.progress - PROGRESS_COOL_RATE * dtSec) : s.progress;
  let tempo = Math.max(0, s.tempo - TEMPO_DECAY_RATE * dtSec);

  // 6. Heat exhausted → run ends. A primed charge is lost (no strike fires).
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
      t,
      tempo,
      event,
      eventQueue,
    };
  }

  // 7. Strike verbs — impossible while stoking (any in-progress charge is cancelled).
  let charging = s.charging;
  let chargeT = s.chargeT;
  let strikes = s.strikes;
  let lastStrikeT = s.lastStrikeT;

  if (stoking) {
    charging = false;
    chargeT = 0;
  } else if (input.hammerHeld) {
    charging = true;
    chargeT = Math.min(CHARGE_TIME_S, s.chargeT + dtSec);
  } else if (s.charging) {
    // Hammer released → resolve one strike at the needle's current position.
    const isHeavy = s.chargeT >= CHARGE_TIME_S;
    const halfWidth = effectiveStrikeHalf(dx, activeZoneMult({ event }, mods.zoneMult), s.chargeT, sweetBonus);
    const acc = strikeAccuracy(needlePos, zoneCentre, halfWidth);
    const crit = acc >= CRIT_ACC;
    const weight = isHeavy ? CHARGE_MULT : 1;
    // Progress uses the tempo IN FORCE at the blow (pre-gain), so rhythm pays on the
    // next strike, and mashing pays ×TEMPO_MULT_MIN immediately.
    progress +=
      acc *
      strikePower(st) *
      mods.powerMult *
      weight *
      tempoMult(tempo) *
      (crit ? CRIT_BONUS : 1) *
      (inEmber ? EMBER_PROG_MULT : 1);
    strikes = [...strikes, { acc, weight, crit }];
    // Tempo update: whiffs and mash-gap strikes reset; on-beat landed strikes build.
    // A landed heavy always counts as on-beat — its charge time spaces it naturally.
    const gap = lastStrikeT === null ? null : t - lastStrikeT;
    if (acc <= 0 || (gap !== null && gap < TEMPO_SPAM_S)) {
      tempo = 0;
    } else if (isHeavy || (gap !== null && gap >= TEMPO_MIN_GAP_S && gap <= TEMPO_MAX_GAP_S)) {
      tempo = Math.min(1, tempo + TEMPO_GAIN);
    }
    lastStrikeT = t;
    charging = false;
    chargeT = 0;
  }

  const finished = progress >= 1;

  return {
    ...s,
    phase: finished ? 'quench' : 'strike',
    heat,
    heatMax,
    restokes,
    charging: finished ? false : charging,
    chargeT: finished ? 0 : chargeT,
    stoking,
    needlePos,
    needleDir,
    zoneCentre,
    zoneDir,
    progress,
    strikes,
    t,
    tempo,
    lastStrikeT,
    event,
    eventQueue,
    quenchBar: finished ? 1 : s.quenchBar,
  };
}

/**
 * Final quality score (§3 blend + quench). Contribution-weighted mean accuracy prevents
 * spam:
 *   meanAcc  = Σ(acc·w) / Σw
 *   strike01 = √(progressFilled × meanAcc)   — needs BOTH fill and accuracy
 *   score01  = clamp(0.32·heat01 + 0.58·strike01 + 0.10·quench01, 0, 1)
 * A perfect Phase A is worth only 0.32 and a perfect quench 0.10, so Masterwork (≥0.75)
 * needs real strikes too; heat01 = 0 caps the score at 0.68, and a botched quench caps
 * it at 0.90 (Masterwork stays reachable for a smith who fumbles the plunge).
 */
export function forgeScore(s: ForgeRunState): number {
  return forgeScoreParts(s).score01;
}

/**
 * The score and its strike component, from the same formula — the UI uses this both for
 * the mid-run quality forecast (score01 of the current state IS the forecast: unfinished
 * progress and an unplunged quench simply contribute less) and for the result breakdown,
 * so the displayed numbers can never drift from what forgeScore awards.
 */
export function forgeScoreParts(s: ForgeRunState): { strike01: number; score01: number } {
  let sumW = 0;
  let sumAW = 0;
  for (const { acc, weight } of s.strikes) {
    sumW += weight;
    sumAW += acc * weight;
  }
  const meanAcc = sumW > 0 ? sumAW / sumW : 0;
  const progressFilled = Math.max(0, Math.min(1, s.progress));
  const strike01 = Math.sqrt(progressFilled * meanAcc);
  const score01 = Math.max(0, Math.min(1, 0.32 * s.heat01 + 0.58 * strike01 + 0.1 * s.quench01));
  return { strike01, score01 };
}
