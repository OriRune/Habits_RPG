// src/lib/sfx.ts
// Lightweight synthesised sound effects and an adaptive tension drone.
// Zero asset files — everything is built from Web Audio oscillators and noise.
//
// All output runs through a single master GainNode so muting is instant and
// the per-cue gain levels are relative rather than absolute.
//
// The AudioContext is created lazily on first use; call sfx.resume() from a
// user-gesture handler (e.g. a "Begin" button) to satisfy browser autoplay policy
// before any sounds need to play.
//
// Usage:
//   sfx.resume()                — unlock/resume the context (call from user gesture)
//   sfx.play('jump')            — fire a one-shot cue
//   sfx.setMuted(true/false)    — master mute / unmute
//   sfx.startDrone()            — begin the adaptive tension drone
//   sfx.stopDrone()             — fade out and stop the drone
//   sfx.setDroneIntensity(0–1)  — drive drone from a danger level (0 = calm, 1 = intense)
//
// Adding cues: extend SfxCue and add a matching entry to _CUES.

export type SfxCue =
  | 'jump'
  | 'doubleJump'
  | 'land'
  | 'stomp'
  | 'dash'
  | 'stumble'
  | 'fall'
  | 'growl'
  | 'win';

// ── Module-level singletons ────────────────────────────────────────────────────

let _ctx: AudioContext | null = null;
let _masterGain: GainNode | null = null;
let _noiseBuffer: AudioBuffer | null = null;
let _muted = false;

// Drone state
let _droneOsc1: OscillatorNode | null = null;
let _droneOsc2: OscillatorNode | null = null;
let _droneFilter: BiquadFilterNode | null = null;
let _droneGain: GainNode | null = null;
let _droneActive = false;

// Master output gain level (not to be confused with mute).
const MASTER_GAIN = 0.35;

// ── Lazy context initialisation ────────────────────────────────────────────────

function getCtx(): AudioContext {
  if (!_ctx) {
    // Safari shipped unprefixed AudioContext in 14.1 (2021); the fallback keeps
    // older versions working.
    const AC =
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      ?? AudioContext;
    _ctx = new AC();
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = _muted ? 0 : MASTER_GAIN;
    _masterGain.connect(_ctx.destination);
    _noiseBuffer = _makeNoiseBuffer(_ctx, 0.6);
  }
  return _ctx;
}

/** Build a short loopable white-noise buffer. */
function _makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.ceil(rate * seconds), rate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buf;
}

// ── Synthesis helpers ──────────────────────────────────────────────────────────

/**
 * Schedule an oscillator with a pitch sweep and gain envelope.
 * Connects to _masterGain and self-stops after `dur` seconds.
 */
function _osc(
  ctx: AudioContext,
  type: OscillatorType,
  freqStart: number,
  freqEnd: number,
  dur: number,
  gainPeak: number,
  attackSec = 0.010,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t = ctx.currentTime;

  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, t);
  if (freqEnd !== freqStart) {
    // exponentialRamp requires a strictly positive end value.
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t + dur);
  }
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(gainPeak, t + attackSec);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(gain);
  gain.connect(_masterGain!);
  osc.start(t);
  osc.stop(t + dur + 0.06);
}

/**
 * Schedule a bandpass/lowpass-filtered noise burst.
 * Connects to _masterGain and self-stops after `dur` seconds.
 */
function _noise(
  ctx: AudioContext,
  filterFreqStart: number,
  filterFreqEnd: number,
  dur: number,
  gainPeak: number,
  filterType: BiquadFilterType = 'bandpass',
  filterQ = 1.5,
): void {
  const src = ctx.createBufferSource();
  src.buffer = _noiseBuffer!;
  src.loop = true;

  const filt = ctx.createBiquadFilter();
  filt.type = filterType;
  filt.Q.value = filterQ;
  filt.frequency.setValueAtTime(filterFreqStart, ctx.currentTime);
  filt.frequency.linearRampToValueAtTime(
    Math.max(filterFreqEnd, 20),
    ctx.currentTime + dur,
  );

  const gain = ctx.createGain();
  const t = ctx.currentTime;
  const attack = Math.min(0.03, dur * 0.15);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(gainPeak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(filt);
  filt.connect(gain);
  gain.connect(_masterGain!);
  src.start(t);
  src.stop(t + dur + 0.06);
}

// ── Cue definitions ────────────────────────────────────────────────────────────

const _CUES: Record<SfxCue, (ctx: AudioContext) => void> = {

  /** Short rising blip — leap off a rooftop. */
  jump(ctx) {
    _osc(ctx, 'sine', 320, 580, 0.13, 0.36, 0.008);
  },

  /** Higher, brighter blip — midair correction jump. */
  doubleJump(ctx) {
    _osc(ctx, 'sine',     520, 940,  0.10, 0.28, 0.006);
    _osc(ctx, 'triangle', 1040, 1600, 0.08, 0.10, 0.005);
  },

  /** Low thud + noise tick — hero's boots hit a rooftop. */
  land(ctx) {
    _osc(ctx, 'triangle', 110, 46, 0.20, 0.42, 0.005);
    _noise(ctx, 180, 70, 0.12, 0.16, 'bandpass', 0.7);
  },

  /** Punchy square with downward pitch — satisfying boot on a guard's head. */
  stomp(ctx) {
    _osc(ctx, 'square', 210, 52, 0.24, 0.52, 0.004);
    _noise(ctx, 400, 110, 0.15, 0.20, 'bandpass', 1.2);
  },

  /** Noise whoosh sweeping upward — burst of speed. */
  dash(ctx) {
    _noise(ctx, 180, 2400, 0.28, 0.36, 'bandpass', 2.5);
    _osc(ctx, 'sine', 220, 460, 0.18, 0.16, 0.012);
  },

  /** Descending buzz — hero trips or clips an obstacle. */
  stumble(ctx) {
    _osc(ctx, 'sawtooth', 195, 72, 0.33, 0.30, 0.016);
    _noise(ctx, 320, 90, 0.22, 0.13, 'bandpass', 1.0);
  },

  /** Long descending tone + noise fade — hero falls into a gap. */
  fall(ctx) {
    _osc(ctx, 'sine', 380, 52, 0.88, 0.38, 0.05);
    _noise(ctx, 600, 55, 0.82, 0.11, 'lowpass', 0.8);
  },

  /**
   * Low detuned sawtooth wobble — the beast appears behind the hero.
   * Two oscillators slightly out of tune for a thick, unsettling growl.
   */
  growl(ctx) {
    const freqs: [number, number][] = [[72, 0.22], [68, 0.18]];
    const t = ctx.currentTime;
    freqs.forEach(([baseFreq, peakGain]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      // Manual pitch wobble — alternate between base and +18 Hz every 0.1 s.
      [0, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60].forEach((dt, wi) => {
        osc.frequency.setValueAtTime(baseFreq + (wi % 2 === 0 ? 0 : 18), t + dt);
      });
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(peakGain, t + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.72);
      osc.connect(gain);
      gain.connect(_masterGain!);
      osc.start(t);
      osc.stop(t + 0.78);
    });
  },

  /** Four-note ascending arpeggio — run completed. */
  win(ctx) {
    const notes = [440, 554, 660, 880];
    notes.forEach((freq, i) => {
      const delay = i * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = ctx.currentTime + delay;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.36, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      osc.connect(gain);
      gain.connect(_masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.34);
    });
  },
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Unlock / resume the AudioContext.
 *
 * Browsers require a user gesture before audio can play. Call this from any
 * button click (e.g. "Begin Trial") before sounds are expected to play.
 * Subsequent calls are no-ops if the context is already running.
 */
export async function resume(): Promise<void> {
  const ctx = getCtx();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
}

/**
 * Play a named one-shot cue.
 * Silently no-ops when muted or when the AudioContext hasn't been resumed yet
 * (autoplay policy).
 */
export function play(cue: SfxCue): void {
  if (_muted) return;
  const ctx = getCtx();
  if (ctx.state === 'suspended') return;
  _CUES[cue]?.(ctx);
}

/**
 * Master mute toggle.
 * Smoothly ramps the master gain to 0 or back to avoid click artifacts.
 */
export function setMuted(muted: boolean): void {
  _muted = muted;
  if (_masterGain && _ctx) {
    _masterGain.gain.setTargetAtTime(
      muted ? 0 : MASTER_GAIN,
      _ctx.currentTime,
      0.05,
    );
  }
}

/**
 * Start the adaptive tension drone.
 *
 * The drone is two slightly-detuned sawtooth oscillators routed through a
 * lowpass filter. At intensity 0 it is silent; at intensity 1 it becomes an
 * audible, slightly open rumble. Drive it each frame with setDroneIntensity().
 */
export function startDrone(): void {
  if (_droneActive) return;
  const ctx = getCtx();
  _droneActive = true;

  _droneOsc1 = ctx.createOscillator();
  _droneOsc2 = ctx.createOscillator();
  _droneOsc1.type = 'sawtooth';
  _droneOsc2.type = 'sawtooth';
  _droneOsc1.frequency.value = 55;   // low A
  _droneOsc2.frequency.value = 58.5; // +3.5 Hz beating creates an unsettling pulse

  _droneFilter = ctx.createBiquadFilter();
  _droneFilter.type = 'lowpass';
  _droneFilter.frequency.value = 220;
  _droneFilter.Q.value = 0.8;

  _droneGain = ctx.createGain();
  _droneGain.gain.value = 0; // starts silent; setDroneIntensity drives it up

  _droneOsc1.connect(_droneFilter);
  _droneOsc2.connect(_droneFilter);
  _droneFilter.connect(_droneGain);
  _droneGain.connect(_masterGain!);

  _droneOsc1.start();
  _droneOsc2.start();
}

/**
 * Fade out and stop the drone.
 * Safe to call when the drone isn't running.
 */
export function stopDrone(): void {
  if (!_droneActive || !_ctx) return;
  _droneActive = false;
  const t = _ctx.currentTime;
  // Smooth fade-out to avoid click.
  _droneGain?.gain.setTargetAtTime(0, t, 0.3);
  const stopAt = t + 1.5;
  try { _droneOsc1?.stop(stopAt); } catch (_e) { /* already stopped */ }
  try { _droneOsc2?.stop(stopAt); } catch (_e) { /* already stopped */ }
  // Null out refs; the audio context will keep the nodes alive until stopAt.
  _droneOsc1 = null;
  _droneOsc2 = null;
  _droneFilter = null;
  _droneGain = null;
}

/**
 * Drive the drone's intensity from a 0–1 danger value.
 * 0 = hero is safe (max lead), 1 = beast is about to catch the hero.
 *
 * Safe to call every animation frame — uses setTargetAtTime for smooth
 * interpolation rather than instant snaps.
 */
export function setDroneIntensity(x01: number): void {
  if (!_droneGain || !_droneFilter || !_ctx) return;
  const x = Math.max(0, Math.min(1, x01));
  const t = _ctx.currentTime;
  // Max gain ~0.14 keeps the drone atmospheric rather than overpowering.
  _droneGain.gain.setTargetAtTime(x * 0.14, t, 0.15);
  // Filter cutoff opens from 220 → 1100 Hz as danger rises — the timbre
  // becomes harsher and more present right before a potential catch.
  _droneFilter.frequency.setTargetAtTime(220 + x * 880, t, 0.20);
}
