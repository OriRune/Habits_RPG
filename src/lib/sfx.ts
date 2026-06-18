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
  // ── Ancient Library ────────────────────────────────
  /** Two-note ascending chime — a round of glyphs memorised correctly. */
  | 'libraryCorrect'
  /** Short descending buzz — wrong glyph tapped. */
  | 'libraryWrong'
  // ── Spirit Grove ───────────────────────────────────
  /** Soft ascending shimmer — correct blessing chosen. */
  | 'groveCorrect'
  /** Quiet descending thud — wrong blessing chosen. */
  | 'groveWrong'
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
  /** Light sidestep whoosh — hero jumped cleanly over a guard. */
  | 'dodge'
  /** Short bright tap — hero catches the roof lip at the last moment. */
  | 'ledgeCatch'
  /** Triumphant multi-note fanfare with sustain — hero escaped. */
  | 'chaseWin'
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
  | 'defeat'
  // ── Armory Break ──────────────────────────────────
  /** Rising mechanical tension — charge building while held. */
  | 'armoryCharge'
  /** Metal snap/crack — lock breaks on a good release. */
  | 'armoryLockCrack'
  /** Dull thud — lock attempt missed. */
  | 'armoryLockMiss'
  /** Short triumphant fanfare — all locks cracked. */
  | 'armoryFinish'
  // ── Long March ────────────────────────────────────
  /** Soft exhale — Rest on a non-spring tile. */
  | 'marchRest'
  /** Light footstep — Walk on a non-spring tile. */
  | 'marchWalk'
  /** Heavy crunch — Push on a non-spring tile. */
  | 'marchPush'
  /** Bright water chime — any pace on a Mountain Spring tile. */
  | 'marchSpring'
  /** Somber descending tone — run ends from exhaustion. */
  | 'marchCollapse'
  /** Ascending fanfare — all 16 tiles completed. */
  | 'marchComplete'
  // ── Arena ──────────────────────────────────────────
  /** Quick sidestep whoosh — successful dodge. */
  | 'arenaDodge'
  /** Deep roar swell — boss phase transition. */
  | 'arenaBossPhase'
  // ── Royal Court ────────────────────────────────────
  /** Gentle ascending chime — a positive response earns favour. */
  | 'courtFavor'
  /** Soft descending tone — a poor response loses favour. */
  | 'courtDisfavor'
  /** Regal four-note arpeggio — court session complete. */
  | 'courtComplete'
  /** Short die-clatter noise burst — Charisma gambit roll starting. */
  | 'courtRoll'
  // ── Last Stand ────────────────────────────────────────────────────────
  /** Sharp metallic ring — shield parry lands cleanly. */
  | 'lastStandBlock'
  // ── Lockpicking ───────────────────────────────────────────────────────
  /** Short metallic scrape — pick dragging against tumblers while jammed. */
  | 'lockScrape'
  /** Satisfying cylinder click — lock opens. */
  | 'lockClick'
  /** Sharp metallic snap — pick breaks under sustained torque. */
  | 'lockSnap'
  // ── Deep Mine ─────────────────────────────────────────────────────────
  /** Dull thud + dust noise — pick breaks through a rock tile. */
  | 'mineRockBreak'
  /** Brighter crack + mineral tinkle — an ore vein shatters. */
  | 'mineOreBreak'
  /** Ascending magic shimmer — boon cache opens. */
  | 'mineBoonOpen'
  /** Whoosh + low rumble — player descends to the next floor. */
  | 'mineDescent'
  /** Deep impact thud + ominous resonant ping — guardian is on this floor. */
  | 'mineGuardianAlert';

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

// Mine ambient loop state
let _ambGain: GainNode | null = null;
let _ambNodes: (OscillatorNode | AudioBufferSourceNode)[] = [];
let _ambBandId: string | null = null;

// Master output gain level (not to be confused with mute).
const MASTER_GAIN = 0.35;
// Ambient loop gain (lower than drone — it's background texture, not tension)
const AMB_GAIN = 0.13;
// Cross-fade duration in seconds
const AMB_FADE_S = 1.5;

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

// ── Ambient synthesis ──────────────────────────────────────────────────────────

/**
 * Build looping ambient nodes for the given mine band, connected to `dest`.
 * Returns every node created so they can be stopped later.
 *   rocky  — damp cave: low rumble + drip resonance
 *   frozen — cold wind: high-freq hiss + low moan oscillator
 *   magma  — lava core: sub-bass rumble + crackle + sawtooth harmonic
 */
function _buildAmbient(
  ctx: AudioContext,
  bandId: string,
  dest: AudioNode,
): (OscillatorNode | AudioBufferSourceNode)[] {
  const nodes: (OscillatorNode | AudioBufferSourceNode)[] = [];

  function loopNoise(filtFreq: number, filtType: BiquadFilterType, Q: number, gain: number): void {
    const src = ctx.createBufferSource();
    src.buffer = _noiseBuffer!;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = filtType;
    filt.frequency.value = filtFreq;
    filt.Q.value = Q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filt);
    filt.connect(g);
    g.connect(dest);
    src.start();
    nodes.push(src);
  }

  function loopOsc(type: OscillatorType, freq: number, gain: number): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(g);
    g.connect(dest);
    osc.start();
    nodes.push(osc);
  }

  if (bandId === 'frozen') {
    loopNoise(3000, 'highpass', 0.4, 0.38); // icy wind hiss
    loopNoise(520,  'bandpass', 1.1, 0.22); // cave resonance
    loopOsc('sine', 68, 0.15);              // low wind moan
  } else if (bandId === 'magma') {
    loopNoise(85,  'lowpass',  0.6, 0.72); // sub-bass rumble
    loopNoise(480, 'bandpass', 1.5, 0.28); // crackle / bubble
    loopOsc('sawtooth', 40, 0.10);         // harmonic grind
  } else {
    // rocky (default)
    loopNoise(260, 'lowpass',  0.8, 0.55); // damp cave echo
    loopNoise(1100,'bandpass', 9.0, 0.16); // drip resonance
  }

  return nodes;
}

// ── Cue definitions ────────────────────────────────────────────────────────────

const _CUES: Record<SfxCue, (ctx: AudioContext) => void> = {

  // ── Spirit Grove ──────────────────────────────────────────────────────────

  /** Two gently rising sine tones — soft, nature-calm correct answer chime. */
  groveCorrect(ctx) {
    _osc(ctx, 'sine', 440, 660, 0.45, 0.18, 0.020);
    _osc(ctx, 'sine', 880, 1100, 0.38, 0.08, 0.025);
  },

  /** Low, brief descending triangle — quiet acknowledgment of a wrong guess. */
  groveWrong(ctx) {
    _osc(ctx, 'triangle', 260, 140, 0.30, 0.16, 0.015);
  },

  // ── Rooftop Chase ──────────────────────────────────────────────────────────

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

  /** Light sidestep whoosh — hero jumped cleanly over a guard without stomping. */
  dodge(ctx) {
    _noise(ctx, 500, 2800, 0.11, 0.16, 'bandpass', 3.0);
    _osc(ctx, 'sine', 380, 620, 0.09, 0.12, 0.006);
  },

  /** Short bright tap — hero catches the ledge lip at the last moment. */
  ledgeCatch(ctx) {
    _osc(ctx, 'triangle', 520, 280, 0.14, 0.28, 0.004);
    _noise(ctx, 900, 300, 0.10, 0.14, 'bandpass', 1.5);
  },

  /**
   * Triumphant chase-win fanfare — five ascending notes then a held chord.
   * More elaborate than the generic 'win' to mark a full 600 wu escape.
   */
  chaseWin(ctx) {
    const t = ctx.currentTime;
    // Rising run: C E G C' E'
    [262, 330, 392, 523, 659].forEach((freq, i) => {
      const t0 = t + i * 0.10;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.32, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
      osc.connect(gain);
      gain.connect(_masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    });
    // Held C-major chord that swells and fades over 1.2 s.
    [[262, 0.20], [330, 0.16], [392, 0.14], [523, 0.12]].forEach(([freq, peak]) => {
      const t0 = t + 5 * 0.10;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.20);
      osc.connect(gain);
      gain.connect(_masterGain!);
      osc.start(t0);
      osc.stop(t0 + 1.30);
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

  // ── Armory Break ──────────────────────────────────────────────────────────

  /** Rising mechanical tension — one-shot played when the player starts charging. */
  armoryCharge(ctx) {
    _noise(ctx, 120, 700, 0.90, 0.22, 'bandpass', 2.8);
    _osc(ctx, 'sawtooth', 55, 180, 0.90, 0.14, 0.05);
  },

  /** Metal snap — satisfying crack when the lock breaks (good or OK release). */
  armoryLockCrack(ctx) {
    _osc(ctx, 'square', 260, 80, 0.20, 0.40, 0.004);
    _noise(ctx, 800, 180, 0.15, 0.28, 'bandpass', 2.0);
    _osc(ctx, 'sine', 520, 160, 0.28, 0.18, 0.003);
  },

  /** Dull thud — failed lock attempt (released outside the zone). */
  armoryLockMiss(ctx) {
    _osc(ctx, 'triangle', 110, 42, 0.22, 0.35, 0.005);
    _noise(ctx, 180, 52, 0.15, 0.16, 'lowpass', 0.8);
  },

  /** Short triumphant fanfare — all three locks cracked. */
  armoryFinish(ctx) {
    const t = ctx.currentTime;
    [330, 415, 523, 880].forEach((freq, i) => {
      const t0 = t + i * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.30, t0 + 0.010);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(gain);
      gain.connect(_masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.28);
    });
  },

  // ── Long March ────────────────────────────────────────────────────────────

  /** Soft exhale — Rest on a non-spring tile. Low filtered-noise decay. */
  marchRest(ctx) {
    _noise(ctx, 300, 110, 0.25, 0.13, 'lowpass', 0.6);
    _osc(ctx, 'sine', 130, 82, 0.22, 0.07, 0.018);
  },

  /** Muffled footstep — Walk on a non-spring tile. */
  marchWalk(ctx) {
    _osc(ctx, 'triangle', 88, 36, 0.13, 0.28, 0.005);
    _noise(ctx, 200, 75, 0.08, 0.11, 'bandpass', 0.9);
  },

  /** Heavier crunch — Push on a non-spring tile. */
  marchPush(ctx) {
    _osc(ctx, 'triangle', 68, 26, 0.19, 0.36, 0.004);
    _noise(ctx, 360, 88, 0.15, 0.22, 'bandpass', 1.5);
  },

  /** Bright water droplet chime — any pace on a Mountain Spring tile. */
  marchSpring(ctx) {
    _osc(ctx, 'sine', 880, 1320, 0.24, 0.18, 0.010);
    _osc(ctx, 'sine', 1320, 1980, 0.18, 0.10, 0.012);
    _noise(ctx, 2200, 4400, 0.14, 0.10, 'highpass', 2.2);
  },

  /** Somber descending tone — run ends from exhaustion. */
  marchCollapse(ctx) {
    _osc(ctx, 'sawtooth', 230, 46, 0.50, 0.26, 0.030);
    _noise(ctx, 380, 55, 0.44, 0.11, 'lowpass', 0.7);
  },

  /** Ascending arpeggio fanfare — all 16 tiles completed. */
  marchComplete(ctx) {
    const t = ctx.currentTime;
    [330, 415, 523, 659, 880].forEach((freq, i) => {
      const t0 = t + i * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.28, t0 + 0.010);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
      osc.connect(gain);
      gain.connect(_masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.30);
    });
  },

  // ── Arena ──────────────────────────────────────────────────────────────────

  /** Quick sidestep whoosh — player successfully evades an attack. */
  arenaDodge(ctx) {
    _noise(ctx, 700, 3200, 0.12, 0.22, 'bandpass', 3.2);
    _osc(ctx, 'sine', 460, 760, 0.10, 0.16, 0.005);
  },

  /** Deep roar swell — boss enters a new phase. */
  arenaBossPhase(ctx) {
    _osc(ctx, 'sawtooth', 82, 40,  0.60, 0.32, 0.022);
    _osc(ctx, 'sawtooth', 138, 70, 0.52, 0.20, 0.030);
    _noise(ctx, 220, 58, 0.48, 0.22, 'lowpass', 0.5);
    _osc(ctx, 'sine', 1100, 580,   0.38, 0.12, 0.010);
  },

  // ── Royal Court ──────────────────────────────────────────────────────────

  /** Two ascending sine tones — a regal chime for earning favour. */
  courtFavor(ctx) {
    _osc(ctx, 'sine', 523, 784, 0.35, 0.16, 0.015);
    _osc(ctx, 'sine', 1047, 1568, 0.28, 0.07, 0.018);
  },

  /** Soft descending triangle — quiet acknowledgment of a misstep. */
  courtDisfavor(ctx) {
    _osc(ctx, 'triangle', 330, 196, 0.28, 0.14, 0.012);
    _noise(ctx, 200, 80, 0.18, 0.05, 'lowpass', 0.6);
  },

  /** Regal four-note ascending arpeggio — audience concluded. */
  courtComplete(ctx) {
    const t = ctx.currentTime;
    [330, 415, 523, 659].forEach((freq, i) => {
      const t0 = t + i * 0.10;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.26, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      osc.connect(gain);
      gain.connect(_masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.34);
    });
    // Sustained final note fades over 0.7 s.
    const t0 = t + 4 * 0.10;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 659;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.20, t0 + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.70);
    osc.connect(gain);
    gain.connect(_masterGain!);
    osc.start(t0);
    osc.stop(t0 + 0.76);
  },

  /** Short die-clatter — three filtered noise bursts, slightly offset, like a die tumbling to rest. */
  courtRoll(ctx) {
    _noise(ctx, 2200, 400, 0.08, 0.22, 'bandpass', 4.0);
    _noise(ctx, 1800, 300, 0.07, 0.18, 'bandpass', 4.0);
    _noise(ctx, 1400, 200, 0.06, 0.14, 'bandpass', 4.0);
  },

  // ── Ancient Library ──────────────────────────────────────────────────────

  /** Soft two-note ascending chime — round complete. */
  libraryCorrect(ctx) {
    _osc(ctx, 'sine', 659, 880, 0.30, 0.16, 0.010);
    _osc(ctx, 'sine', 880, 1320, 0.22, 0.08, 0.012);
  },

  /** Short descending buzz — wrong glyph tapped. */
  libraryWrong(ctx) {
    _osc(ctx, 'triangle', 280, 130, 0.28, 0.20, 0.012);
    _noise(ctx, 240, 80, 0.20, 0.10, 'lowpass', 0.7);
  },

  // ── Last Stand ────────────────────────────────────────────────────────────

  /** Sharp metallic shield-parry clang — triangle ring + sine harmonic + bandpass noise burst. */
  lastStandBlock(ctx) {
    _osc(ctx, 'triangle', 980, 420, 0.22, 0.42, 0.003);
    _osc(ctx, 'sine', 1560, 680, 0.16, 0.22, 0.004);
    _noise(ctx, 2800, 700, 0.14, 0.24, 'bandpass', 2.8);
  },

  // ── Lockpicking ──────────────────────────────────────────────────────

  /** Short high-frequency scrape — pick grinding against tumblers while jammed. */
  lockScrape(ctx) {
    _noise(ctx, 2200, 700, 0.10, 0.12, 'bandpass', 4.0);
    _osc(ctx, 'triangle', 220, 100, 0.08, 0.06, 0.004);
  },

  /** Satisfying mechanical click — cylinder turns and the lock opens. */
  lockClick(ctx) {
    _osc(ctx, 'triangle', 380, 160, 0.11, 0.38, 0.003);
    _noise(ctx, 1400, 300, 0.08, 0.22, 'bandpass', 2.2);
    _osc(ctx, 'sine', 760, 340, 0.14, 0.14, 0.002);
  },

  /** Sharp metallic crack — pick snaps under too much torque. */
  lockSnap(ctx) {
    _osc(ctx, 'square', 520, 110, 0.07, 0.48, 0.002);
    _noise(ctx, 2600, 420, 0.06, 0.28, 'bandpass', 2.6);
  },

  // ── Deep Mine ─────────────────────────────────────────────────────────────

  /** Dull pick-crack + settling dust — rock tile cleared. */
  mineRockBreak(ctx) {
    _osc(ctx, 'triangle', 120, 42, 0.22, 0.38, 0.004);
    _noise(ctx, 350, 80, 0.18, 0.18, 'bandpass', 1.0);
  },

  /** Sharper crack + mineral tinkle — ore vein shatters and yields loot. */
  mineOreBreak(ctx) {
    _osc(ctx, 'triangle', 200, 70, 0.18, 0.32, 0.004);
    _noise(ctx, 600, 150, 0.12, 0.16, 'bandpass', 1.8);
    _osc(ctx, 'sine', 1200, 700, 0.14, 0.10, 0.006);
  },

  /** Ascending three-note shimmer + high sparkle — boon cache opens. */
  mineBoonOpen(ctx) {
    const t = ctx.currentTime;
    [523, 784, 1047].forEach((freq, i) => {
      const t0 = t + i * 0.06;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.14 - i * 0.03, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.40);
      osc.connect(gain);
      gain.connect(_masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.46);
    });
    _noise(ctx, 2800, 5000, 0.20, 0.06, 'highpass', 1.8);
  },

  /** Whoosh + low rumble — shaft descent to the next floor. */
  mineDescent(ctx) {
    _noise(ctx, 2200, 100, 0.55, 0.24, 'lowpass', 0.6);
    _osc(ctx, 'sawtooth', 80, 36, 0.52, 0.16, 0.025);
    _osc(ctx, 'sine', 160, 52, 0.44, 0.10, 0.030);
  },

  mineGuardianAlert(ctx) {
    // Deep sub-bass impact thud
    _noise(ctx, 60, 30, 0.80, 0.40, 'lowpass', 1.2);
    // Ominous low sawtooth growl
    _osc(ctx, 'sawtooth', 48, 38, 0.55, 0.65, 0.030);
    // Resonant metallic warning ping
    _osc(ctx, 'triangle', 340, 170, 0.42, 0.70, 0.006);
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
 * Play a synthesized tone at an arbitrary frequency.
 * Used by Ancient Library to play per-glyph notes without requiring a named cue per frequency.
 */
export function playNote(freq: number, durationMs = 200): void {
  if (_muted) return;
  const ctx = getCtx();
  if (ctx.state === 'suspended') return;
  _osc(ctx, 'sine', freq, freq * 0.94, durationMs / 1000, 0.18, 0.008);
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

/**
 * Start (or cross-fade to) the biome ambient for the Deep Mine.
 * `bandId` is 'rocky' | 'frozen' | 'magma'.
 * No-ops when the requested band is already playing.
 * Safe to call before the AudioContext is resumed — nodes are created and will
 * begin emitting audio once the context is resumed by a user gesture.
 */
export function startMineAmbient(bandId: string): void {
  if (bandId === _ambBandId) return;
  const ctx = getCtx();

  // Fade out and schedule teardown of the current ambient.
  if (_ambGain && _ctx) {
    const t = _ctx.currentTime;
    const oldGain = _ambGain;
    const oldNodes = [..._ambNodes];
    oldGain.gain.cancelScheduledValues(t);
    oldGain.gain.setValueAtTime(oldGain.gain.value, t);
    oldGain.gain.linearRampToValueAtTime(0.0001, t + AMB_FADE_S);
    _ambNodes = [];
    setTimeout(() => {
      for (const n of oldNodes) { try { n.stop(); } catch { /* already stopped */ } }
      oldGain.disconnect();
    }, (AMB_FADE_S + 0.25) * 1000);
  }

  _ambBandId = bandId;
  const ag = ctx.createGain();
  ag.gain.value = 0.0001;
  ag.connect(_masterGain!);
  _ambGain = ag;
  _ambNodes = _buildAmbient(ctx, bandId, ag);

  const t = ctx.currentTime;
  ag.gain.linearRampToValueAtTime(_muted ? 0.0001 : AMB_GAIN, t + AMB_FADE_S);
}

/**
 * Fade out and stop the mine ambient.
 * Safe to call when no ambient is running.
 */
export function stopMineAmbient(): void {
  if (!_ambGain || !_ctx) return;
  const t = _ctx.currentTime;
  const oldGain = _ambGain;
  const oldNodes = [..._ambNodes];
  oldGain.gain.cancelScheduledValues(t);
  oldGain.gain.setValueAtTime(oldGain.gain.value, t);
  oldGain.gain.linearRampToValueAtTime(0.0001, t + AMB_FADE_S);
  _ambNodes = [];
  _ambGain = null;
  _ambBandId = null;
  setTimeout(() => {
    for (const n of oldNodes) { try { n.stop(); } catch { /* already stopped */ } }
    oldGain.disconnect();
  }, (AMB_FADE_S + 0.25) * 1000);
}
