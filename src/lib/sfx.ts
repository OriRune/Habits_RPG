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
  // ── Rooftop Chase ──────────────────────────────────
  | 'jump'
  | 'doubleJump'
  | 'land'
  | 'stomp'
  | 'dash'
  | 'stumble'
  | 'fall'
  | 'growl'
  | 'surge'
  | 'nearMiss'
  | 'win'
  // ── Hex Tactics (combat) ──────────────────────────
  /** Short melee weapon swing. */
  | 'swing'
  /** Arrow/bolt projectile whoosh. */
  | 'arrowFly'
  /** Impact thud when an attack lands. */
  | 'hit'
  /** Spell-cast shimmer/crackle. */
  | 'cast'
  /** Soft bell chime for a heal. */
  | 'heal'
  /** Force gust — Push spell launch. */
  | 'push'
  /** Phase-shift blip — Blink teleport. */
  | 'blink'
  /** Deep descending thud when an enemy dies. */
  | 'enemyDeath'
  /** Low thump when the player is hit. */
  | 'playerHurt'
  /** Subtle tick for turn boundary. */
  | 'turnEnd'
  /** Rising triumphant fanfare — battle won. */
  | 'victory'
  /** Descending somber tones — battle lost. */
  | 'defeat';

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

  /**
   * Beast surge swell — a deep throaty rumble that crests and fades.
   * Three low oscillators in a thick chord with a brief amplitude swell.
   */
  surge(ctx) {
    const t = ctx.currentTime;
    const voices: [number, number][] = [[58, 0.28], [62, 0.20], [46, 0.18]];
    voices.forEach(([baseFreq, peak]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      // Slowly descend in pitch across the swell for an ominous lunge feel.
      osc.frequency.setValueAtTime(baseFreq + 12, t);
      osc.frequency.linearRampToValueAtTime(baseFreq, t + 0.55);
      osc.frequency.linearRampToValueAtTime(baseFreq - 6, t + 1.10);
      // Attack → sustain → decay envelope.
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.22);
      gain.gain.setValueAtTime(peak * 0.75, t + 0.60);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.20);
      osc.connect(gain);
      gain.connect(_masterGain!);
      osc.start(t);
      osc.stop(t + 1.26);
    });
    // A filtered noise burst at the start for impact texture.
    _noise(ctx, 90, 40, 0.35, 0.14, 'lowpass', 0.6);
  },

  /**
   * Near-miss electric sting — a bright metallic ping when the hero just
   * barely shoves the beast back at very low lead.
   */
  nearMiss(ctx) {
    // High-frequency metallic ping decaying fast.
    _osc(ctx, 'sine',     1480, 820, 0.22, 0.28, 0.004);
    _osc(ctx, 'triangle', 2100, 1100, 0.16, 0.14, 0.003);
    // Short noise burst for the "spark" texture.
    _noise(ctx, 3200, 800, 0.12, 0.18, 'highpass', 2.0);
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

  // ── Hex Tactics combat cues ───────────────────────────────────────────────

  /** Short melee weapon swing — noise + downward osc. */
  swing(ctx) {
    _noise(ctx, 900, 200, 0.14, 0.22, 'bandpass', 2.2);
    _osc(ctx, 'square', 200, 82, 0.12, 0.18, 0.007);
  },

  /** Arrow whoosh — high-Q bandpass noise sweep. */
  arrowFly(ctx) {
    _noise(ctx, 2600, 700, 0.20, 0.16, 'bandpass', 3.8);
  },

  /** Impact thud — low triangle + soft noise burst. */
  hit(ctx) {
    _osc(ctx, 'triangle', 145, 50, 0.18, 0.32, 0.005);
    _noise(ctx, 320, 95, 0.11, 0.18, 'bandpass', 1.0);
  },

  /** Spell-cast shimmer — two rising sine tones. */
  cast(ctx) {
    _osc(ctx, 'sine', 640, 1280, 0.26, 0.26, 0.014);
    _osc(ctx, 'sine', 1420, 2200, 0.18, 0.10, 0.010);
  },

  /** Heal chime — two harmonious bell-like sines. */
  heal(ctx) {
    _osc(ctx, 'sine', 660, 660, 0.55, 0.20, 0.008);
    _osc(ctx, 'sine', 990, 990, 0.48, 0.12, 0.010);
  },

  /** Force push gust — upward noise sweep + bass thump. */
  push(ctx) {
    _noise(ctx, 420, 3400, 0.28, 0.30, 'bandpass', 2.6);
    _osc(ctx, 'sine', 260, 76, 0.18, 0.26, 0.010);
  },

  /** Blink teleport — quick pitch descend then a sharp blip. */
  blink(ctx) {
    _osc(ctx, 'sine', 900, 240, 0.10, 0.20, 0.005);
    _osc(ctx, 'sine', 1800, 900, 0.14, 0.18, 0.003);
  },

  /** Enemy death — descending rumble. */
  enemyDeath(ctx) {
    _osc(ctx, 'sawtooth', 165, 40, 0.40, 0.30, 0.006);
    _noise(ctx, 210, 58, 0.26, 0.18, 'lowpass', 0.7);
  },

  /** Player hurt — low square thump with noise. */
  playerHurt(ctx) {
    _osc(ctx, 'square', 108, 46, 0.20, 0.40, 0.004);
    _noise(ctx, 250, 78, 0.14, 0.20, 'bandpass', 0.8);
  },

  /** Turn boundary — short, quiet sine blip. */
  turnEnd(ctx) {
    _osc(ctx, 'sine', 490, 380, 0.08, 0.12, 0.005);
  },

  /**
   * Victory fanfare — five-note ascending arpeggio with a final sustained chord.
   * More elaborate than the chase 'win' to mark the weight of a tactical victory.
   */
  victory(ctx) {
    const t = ctx.currentTime;
    const notes = [330, 415, 494, 659, 880];
    notes.forEach((freq, i) => {
      const t0 = t + i * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.30, t0 + 0.010);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.30);
      osc.connect(gain);
      gain.connect(_masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.36);
    });
    // Sustaining final chord (E major-ish) that fades over 0.8 s.
    [[330, 0.18], [494, 0.15], [659, 0.14]].forEach(([freq, peak]) => {
      const t0 = t + notes.length * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.80);
      osc.connect(gain);
      gain.connect(_masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.86);
    });
  },

  /**
   * Defeat — four descending minor notes, somber and unhurried.
   */
  defeat(ctx) {
    const t = ctx.currentTime;
    const notes = [392, 330, 262, 196]; // G, E, C, G (descending)
    notes.forEach((freq, i) => {
      const t0 = t + i * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.24, t0 + 0.020);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
      osc.connect(gain);
      gain.connect(_masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.62);
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

/**
 * Briefly spike the drone to maximum intensity for dramatic effect (e.g. beast
 * surges). The normal per-frame `setDroneIntensity` call will smoothly reclaim
 * control on the next frame, so this needs no teardown.
 */
export function spikeDrone(): void {
  if (!_droneGain || !_droneFilter || !_ctx) return;
  const t = _ctx.currentTime;
  // Instant burst to near-max, then allow setDroneIntensity to smooth back.
  _droneGain.gain.setTargetAtTime(0.14, t, 0.03);
  _droneFilter.frequency.setTargetAtTime(1100, t, 0.03);
}
