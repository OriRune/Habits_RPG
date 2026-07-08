// Lockpicking trial engine — Skyrim-style (pure, no React).
// Player rotates a pick across a 180° semicircle to find a hidden sweet spot,
// then applies torque. The cylinder turns proportionally to how close the pick
// is to the sweet spot. Sustained torque against a jam snaps the pick.

export const NUM_LOCKS = 3;
export const PICK_BUDGET = 6;

export const PICK_MIN_DEG = 0;
export const PICK_MAX_DEG = 180;
export const CYLINDER_OPEN_DEG = 90;

/** Lock difficulty labels — index matches lock order. */
export const LOCK_LABELS = ['Novice', 'Apprentice', 'Adept'] as const;

/** Base tolerance (°) per lock — the half-width of the "turn zone". Narrows each lock. */
export const BASE_TOLERANCE_DEG = [22, 16, 11] as const;
/** Must be within this many degrees of the sweet spot for the cylinder to reach 90° (open). */
export const BASE_OPEN_TOLERANCE_DEG = [7, 5, 3.5] as const;

/** Added to tolerance (°) per character level — higher level = more forgiving. */
export const LEVEL_TOLERANCE_BONUS = 0.6;
/** Open-tolerance gets a smaller share of the level bonus. */
export const LEVEL_OPEN_TOLERANCE_BONUS = 0.2;

/** Added to tolerance (°) per DX stat level — trains the relevant stat. */
export const LEVEL_DX_TOLERANCE_BONUS = 0.3;
export const LEVEL_DX_OPEN_BONUS = 0.1;

/** Speed at which the cylinder rotates (°/sec). */
export const CYLINDER_TURN_SPEED = 180;
/** Speed at which the cylinder springs back to 0 when torque is released (°/sec). */
export const CYLINDER_RETURN_SPEED = 240;

/** Pick rotation speed when driven by keyboard (°/sec). */
export const PICK_KEY_SPEED = 90;

/**
 * Minimum seconds before a sustained jam snaps the pick, per lock difficulty.
 * Harder locks get a slightly longer floor so players can react before snapping.
 */
export const BREAK_TIME_MIN_PER_LOCK = [0.55, 0.65, 0.80] as const;

/**
 * Maximum seconds before snap — at the sweet spot edge (almost turning).
 * Shared across all locks because the near-sweet-spot experience should feel consistent.
 */
export const BREAK_TIME_MAX = 3.5;

/** Max shake offset (px) applied on a jam frame. */
export const SHAKE_AMPLITUDE = 6;

export interface LockConfig {
  sweetSpotDeg: number;
  toleranceDeg: number;
  openToleranceDeg: number;
}

/** Compute per-lock tolerance values, widened by character level and DX stat level. */
export function lockTolerance(
  lockIndex: number,
  level: number,
  dxLevel = 0,
): { toleranceDeg: number; openToleranceDeg: number } {
  const bonus     = Math.max(0, level - 1) * LEVEL_TOLERANCE_BONUS;
  const openBonus = Math.max(0, level - 1) * LEVEL_OPEN_TOLERANCE_BONUS;
  const dxBonus     = dxLevel * LEVEL_DX_TOLERANCE_BONUS;
  const dxOpenBonus = dxLevel * LEVEL_DX_OPEN_BONUS;
  // Cap at 2× base (MINI-15) — uncapped bonuses trend late-game locks toward an
  // auto-3★ (near-full-arc tolerance); the cap keeps them challenging.
  return {
    toleranceDeg:     Math.min(BASE_TOLERANCE_DEG[lockIndex]      + bonus     + dxBonus,     2 * BASE_TOLERANCE_DEG[lockIndex]),
    openToleranceDeg: Math.min(BASE_OPEN_TOLERANCE_DEG[lockIndex] + openBonus + dxOpenBonus, 2 * BASE_OPEN_TOLERANCE_DEG[lockIndex]),
  };
}

/** Generate NUM_LOCKS configs. Sweet spots randomised, always reachable. */
export function generateLocks(rng: () => number, level: number, dxLevel = 0): LockConfig[] {
  return Array.from({ length: NUM_LOCKS }, (_, i) => {
    const { toleranceDeg, openToleranceDeg } = lockTolerance(i, level, dxLevel);
    const margin = 20; // keep sweet spot away from hard edges
    const sweetSpotDeg = margin + rng() * (PICK_MAX_DEG - 2 * margin);
    return { sweetSpotDeg, toleranceDeg, openToleranceDeg };
  });
}

/**
 * Fraction (0..1) of the full cylinder turn the player can achieve.
 * 1.0 when within openToleranceDeg; linear falloff to 0 at toleranceDeg.
 */
export function allowedTurn(pickDeg: number, lock: LockConfig): number {
  const d = Math.abs(pickDeg - lock.sweetSpotDeg);
  if (d <= lock.openToleranceDeg) return 1;
  if (d >= lock.toleranceDeg) return 0;
  return 1 - (d - lock.openToleranceDeg) / (lock.toleranceDeg - lock.openToleranceDeg);
}

/** True when the pick is close enough to the sweet spot to fully open the lock. */
export function canOpen(pickDeg: number, lock: LockConfig): boolean {
  return Math.abs(pickDeg - lock.sweetSpotDeg) <= lock.openToleranceDeg;
}

/**
 * Seconds of sustained torque-against-jam before the pick snaps.
 * Closer to the sweet spot → more time (cylinder almost turns, so less stress).
 * Harder locks get a higher minimum so players have time to react.
 */
export function breakTime(pickDeg: number, lock: LockConfig, lockIndex: number): number {
  const turn = allowedTurn(pickDeg, lock);
  const min  = BREAK_TIME_MIN_PER_LOCK[lockIndex];
  return min + turn * (BREAK_TIME_MAX - min);
}

/**
 * Final score (0..1).
 * All locks opened → [0.5, 1.0] linear on picks remaining.
 * Failed (out of picks mid-run) → up to 0.3 based on locks completed.
 */
export function lockpickingScore(
  locksOpened: number,
  picksRemaining: number,
  budget: number = PICK_BUDGET,
): number {
  if (locksOpened >= NUM_LOCKS) {
    return 0.5 + 0.5 * picksRemaining / budget;
  }
  return 0.3 * (locksOpened / NUM_LOCKS);
}

// ── Pure sim state (LockpickState + initLockpick + stepLockpick) ────────────────
//
// The full real-time simulation is captured in a plain serializable struct
// (LockpickState). stepLockpick() is a pure reducer: (state, input, dt, locks)
// → { state, events }. The hook (useLockpickLoop) holds state in refs, owns the
// RAF clock + dt clamp, and dispatches the returned event tags to SFX / CSS
// effects. Sound, DOM refs, shake offsets, hint text, requestAnimationFrame and
// performance.now() are VIEW concerns and stay out of this function.

/** Simulation phases. Terminal: 'done'. Paused (view drives the timeout): 'revealing'. */
export type LockpickPhase =
  | 'idle'
  | 'turning'
  | 'breaking'
  | 'opening'
  | 'revealing'
  | 'done';

/**
 * Event tags emitted by a step. The hook/component maps these to SFX and CSS
 * effects — the engine never touches sound or the DOM.
 *   'jam'     — a jamming frame (view: throttled scrape SFX + random shake).
 *   'open'    — torque succeeded; the cylinder is now sweeping open (view: click SFX + flash).
 *   'snap'    — the pick snapped (view: snap SFX + break flash).
 *   'advance' — a non-final lock finished opening; the next lock is armed.
 *   'reveal'  — out of picks; entered the sweet-spot reveal (view drives the hold timeout).
 *   'finish'  — the final lock opened; the run is done (state.score is final).
 */
export type LockpickEvent = 'jam' | 'open' | 'snap' | 'advance' | 'reveal' | 'finish';

/** One-frame input snapshot passed to stepLockpick per RAF tick. */
export interface LockpickInput {
  /** Edge: the torque button/key went down this frame (auto-repeat re-arms after a snap). */
  torquePressed: boolean;
  /** Edge: the torque button/key was released this frame. */
  torqueReleased: boolean;
  /** Held pick-rotation direction from keyboard / on-screen arrows: -1, 0, or 1. */
  pickKeyDir: number;
  /** Absolute pick angle set by a pointer this frame (already in [0,180]), or null. */
  pointerDeg: number | null;
}

/** Full simulation state — plain serializable data, no view fields. */
export interface LockpickState {
  phase: LockpickPhase;
  /** Pick angle across the 180° arc. */
  pickDeg: number;
  /** Cylinder rotation (0 = rest, CYLINDER_OPEN_DEG = open). */
  cylinderDeg: number;
  /** Torque latch — set by input edges, cleared by the engine on a snap/open. */
  torqueHeld: boolean;
  /** Seconds of sustained jam accumulated against the current pick. */
  jamTime: number;
  /** Index of the lock currently being picked. */
  currentLock: number;
  /** Lockpicks remaining in the budget. */
  picksRemaining: number;
  /** Locks fully opened so far. */
  locksOpened: number;
  /** Per-lock outcome for the progress row. */
  lockResults: ('open' | 'failed' | null)[];
  /** Turn fraction while applying torque (drives the warmth glow). 0 otherwise. */
  warmth: number;
  /** Passive turn fraction while idle (faint proximity glow). */
  idleProximity: number;
  /** Jam timer fraction (0..1) → pick stress visual. */
  stressRatio: number;
  /** True on frames where the pick is jamming (view: shake + hint). */
  jamming: boolean;
  /** Terminal flag — the run is over and score is final. */
  done: boolean;
  /** Final score (0..1); meaningful once done. */
  score: number;
}

/** Return the initial LockpickState for a fresh run. */
export function initLockpick(): LockpickState {
  return {
    phase: 'idle',
    pickDeg: 90,
    cylinderDeg: 0,
    torqueHeld: false,
    jamTime: 0,
    currentLock: 0,
    picksRemaining: PICK_BUDGET,
    locksOpened: 0,
    lockResults: Array(NUM_LOCKS).fill(null),
    warmth: 0,
    idleProximity: 0,
    stressRatio: 0,
    jamming: false,
    done: false,
    score: 0,
  };
}

/**
 * Advance the lockpicking simulation by one time step.
 *
 * Pure function: does not mutate `state`. Returns a new LockpickState plus the
 * event tags that occurred this step. `dt` is seconds (clamped to ≤0.05 by the
 * hook). `locks` is the immutable lock table for the run.
 */
export function stepLockpick(
  state: LockpickState,
  input: LockpickInput,
  dt: number,
  locks: LockConfig[],
): { state: LockpickState; events: LockpickEvent[] } {
  // Paused/terminal phases are driven by the view (reveal timeout / done); the
  // hook stops the RAF loop on these, so this is just a safety guard.
  if (state.phase === 'done' || state.phase === 'revealing') {
    return { state, events: [] };
  }

  const events: LockpickEvent[] = [];

  let phase: LockpickPhase = state.phase;
  let pickDeg        = state.pickDeg;
  let cylinderDeg    = state.cylinderDeg;
  let torqueHeld     = state.torqueHeld;

  // Pointer aim (absolute) mirrors the pointer handler, which runs in every
  // non-terminal phase — apply before the phase branches.
  if (input.pointerDeg !== null) {
    pickDeg = Math.max(PICK_MIN_DEG, Math.min(PICK_MAX_DEG, input.pointerDeg));
  }

  // Resolve the torque latch from input edges (auto-repeat re-arms it).
  if (input.torquePressed)  torqueHeld = true;
  if (input.torqueReleased) torqueHeld = false;

  // ── Breaking: cylinder snaps back toward 0 ─────────────────────────────────
  if (phase === 'breaking') {
    cylinderDeg = Math.max(0, cylinderDeg - CYLINDER_RETURN_SPEED * 2.5 * dt);
    let warmth = state.warmth;
    let stressRatio = state.stressRatio;
    if (cylinderDeg <= 0) {
      warmth = 0;
      stressRatio = 0;
      if (state.picksRemaining <= 0) {
        phase = 'revealing';
        events.push('reveal');
      } else {
        phase = 'idle';
      }
    }
    return {
      state: { ...state, phase, pickDeg, cylinderDeg, torqueHeld, warmth, stressRatio, jamming: false },
      events,
    };
  }

  // ── Opening: cylinder sweeps to CYLINDER_OPEN_DEG ──────────────────────────
  if (phase === 'opening') {
    cylinderDeg = Math.min(CYLINDER_OPEN_DEG, cylinderDeg + CYLINDER_TURN_SPEED * 2.5 * dt);
    if (cylinderDeg >= CYLINDER_OPEN_DEG) {
      const nextOpened = state.locksOpened + 1;
      const lockResults = state.lockResults.map(
        (r, i): 'open' | 'failed' | null => (i === state.currentLock ? 'open' : r),
      );
      if (nextOpened >= NUM_LOCKS) {
        events.push('finish');
        return {
          state: {
            ...state,
            phase: 'done',
            pickDeg,
            cylinderDeg,
            torqueHeld,
            locksOpened: nextOpened,
            lockResults,
            warmth: 0,
            idleProximity: 0,
            stressRatio: 0,
            jamming: false,
            done: true,
            score: lockpickingScore(nextOpened, state.picksRemaining),
          },
          events,
        };
      }
      events.push('advance');
      return {
        state: {
          ...state,
          phase: 'idle',
          pickDeg: 90, // reset pick to center so the next lock starts fair
          cylinderDeg: 0,
          torqueHeld,
          jamTime: 0,
          currentLock: state.currentLock + 1,
          locksOpened: nextOpened,
          lockResults,
          warmth: 0,
          idleProximity: 0,
          stressRatio: 0,
          jamming: false,
        },
        events,
      };
    }
    return {
      state: { ...state, phase, pickDeg, cylinderDeg, torqueHeld, jamming: false },
      events,
    };
  }

  // ── Idle / turning ─────────────────────────────────────────────────────────
  let jamTime        = state.jamTime;
  let picksRemaining = state.picksRemaining;
  let lockResults    = state.lockResults;
  let warmth         = state.warmth;
  let idleProximity  = state.idleProximity;
  let stressRatio    = state.stressRatio;
  let jamming        = false;

  if (input.pickKeyDir !== 0) {
    pickDeg = Math.max(
      PICK_MIN_DEG,
      Math.min(PICK_MAX_DEG, pickDeg + input.pickKeyDir * PICK_KEY_SPEED * dt),
    );
  }

  const lock           = locks[state.currentLock];
  const turn           = allowedTurn(pickDeg, lock);
  const targetCylinder = turn * CYLINDER_OPEN_DEG;

  if (torqueHeld) {
    phase = 'turning';

    if (cylinderDeg < targetCylinder) {
      cylinderDeg = Math.min(targetCylinder, cylinderDeg + CYLINDER_TURN_SPEED * dt);
    } else if (cylinderDeg > targetCylinder) {
      cylinderDeg = Math.max(targetCylinder, cylinderDeg - CYLINDER_RETURN_SPEED * dt);
    }
    warmth = turn;

    const isJamming = turn < 1 && cylinderDeg >= targetCylinder - 0.5;

    if (isJamming) {
      jamming = true;
      jamTime += dt;

      const bt = breakTime(pickDeg, lock, state.currentLock);
      stressRatio = Math.min(jamTime / bt, 1);
      events.push('jam'); // view: throttled scrape SFX + shake

      if (jamTime > bt) {
        jamTime = 0;
        warmth = 0;
        stressRatio = 0;
        idleProximity = 0;
        jamming = false;
        picksRemaining -= 1;
        torqueHeld = false;
        if (picksRemaining <= 0) {
          lockResults = lockResults.map(
            (r, i): 'open' | 'failed' | null => (i === state.currentLock ? 'failed' : r),
          );
        }
        // Always enter breaking — the reveal/finish fires once the cylinder returns.
        phase = 'breaking';
        events.push('snap');
      }
    } else {
      stressRatio = 0;
      jamTime = 0;
      if (canOpen(pickDeg, lock) && cylinderDeg >= CYLINDER_OPEN_DEG - 1) {
        torqueHeld = false;
        phase = 'opening';
        warmth = 0;
        events.push('open');
      }
    }
  } else {
    idleProximity = turn;
    phase = 'idle';
    jamTime = 0;
    warmth = 0;
    stressRatio = 0;
    if (cylinderDeg > 0) {
      cylinderDeg = Math.max(0, cylinderDeg - CYLINDER_RETURN_SPEED * dt);
    }
  }

  return {
    state: {
      ...state,
      phase,
      pickDeg,
      cylinderDeg,
      torqueHeld,
      jamTime,
      picksRemaining,
      lockResults,
      warmth,
      idleProximity,
      stressRatio,
      jamming,
    },
    events,
  };
}
