import { describe, it, expect } from 'vitest';
import {
  initLockpick,
  stepLockpick,
  lockpickingScore,
  PICK_BUDGET,
  NUM_LOCKS,
  CYLINDER_OPEN_DEG,
  type LockpickState,
  type LockpickInput,
  type LockpickEvent,
  type LockConfig,
} from '../lockpicking';

// ── Test rig ─────────────────────────────────────────────────────────────────

const noInput = (): LockpickInput => ({
  torquePressed: false,
  torqueReleased: false,
  pickKeyDir: 0,
  pointerDeg: null,
});

// A lock whose sweet spot is at 90°, wide enough that we can pick a pick angle
// that jams (0 < turn < 1) or opens (turn === 1) deterministically.
const LOCK: LockConfig = { sweetSpotDeg: 90, toleranceDeg: 20, openToleranceDeg: 5 };
const LOCKS: LockConfig[] = [LOCK, LOCK, LOCK];

const DT = 0.05;

/** Step until `pred(state)` holds or `maxSteps` is exhausted; collect all events. */
function run(
  state: LockpickState,
  input: () => LockpickInput,
  pred: (s: LockpickState) => boolean,
  maxSteps = 400,
): { state: LockpickState; events: LockpickEvent[]; steps: number } {
  const events: LockpickEvent[] = [];
  let s = state;
  let steps = 0;
  while (!pred(s) && steps < maxSteps) {
    const res = stepLockpick(s, input(), DT, LOCKS);
    s = res.state;
    events.push(...res.events);
    steps++;
  }
  return { state: s, events, steps };
}

// ── jam → break transition ───────────────────────────────────────────────────

describe('stepLockpick — jam → break', () => {
  it('a sustained jam consumes a pick and enters the breaking phase', () => {
    // Aim off the open zone (d = 15°) so 0 < turn < 1 → jams under torque.
    let s = initLockpick();
    let firstFrame = true;
    const input = (): LockpickInput => {
      const i = noInput();
      if (firstFrame) { i.pointerDeg = 105; i.torquePressed = true; firstFrame = false; }
      return i;
    };

    const { state, events } = run(s, input, (x) => x.phase === 'breaking');

    expect(state.phase).toBe('breaking');
    expect(state.picksRemaining).toBe(PICK_BUDGET - 1);
    expect(state.torqueHeld).toBe(false);        // engine latches torque off on a snap
    expect(events).toContain('jam');             // we jammed on the way to the snap
    expect(events).toContain('snap');
    // Stress must have climbed to full right before the snap.
    // (recompute: step once more before snap is unobservable here, so assert the
    //  jam produced a rising stress by checking it hit the ceiling at some point)
  });

  it('stress ratio rises toward 1 while jamming, then the pick snaps', () => {
    let s = initLockpick();
    // Move the pick into the jam zone and hold torque continuously.
    s = stepLockpick(s, { ...noInput(), pointerDeg: 105, torquePressed: true }, DT, LOCKS).state;

    let sawStress = 0;
    let snapped = false;
    for (let i = 0; i < 400 && !snapped; i++) {
      const res = stepLockpick(s, noInput(), DT, LOCKS);
      s = res.state;
      if (s.jamming) sawStress = Math.max(sawStress, s.stressRatio);
      if (res.events.includes('snap')) snapped = true;
    }
    expect(snapped).toBe(true);
    expect(sawStress).toBeGreaterThan(0.9); // stress reached near-full before snapping
  });
});

// ── pick-budget exhaustion → revealing ───────────────────────────────────────

describe('stepLockpick — budget exhaustion', () => {
  it('the last snap marks the lock failed and, once the cylinder returns, reveals', () => {
    // Start with a single pick so the next snap is terminal.
    let s: LockpickState = { ...initLockpick(), picksRemaining: 1 };
    s = stepLockpick(s, { ...noInput(), pointerDeg: 105, torquePressed: true }, DT, LOCKS).state;

    // Run to the snap.
    const toSnap = run(s, noInput, (x) => x.phase === 'breaking');
    expect(toSnap.state.picksRemaining).toBe(0);
    expect(toSnap.state.lockResults[0]).toBe('failed');

    // Release torque and keep stepping — the cylinder springs back, then reveal.
    const toReveal = run(toSnap.state, noInput, (x) => x.phase === 'revealing');
    expect(toReveal.state.phase).toBe('revealing');
    expect(toReveal.events).toContain('reveal');
  });
});

// ── lock open → advance / reset ──────────────────────────────────────────────

describe('stepLockpick — lock opens', () => {
  it('opening a non-final lock advances to the next lock and resets the pick', () => {
    // Pick sits exactly on the sweet spot (turn === 1) and torque is held.
    let s = initLockpick();
    s = stepLockpick(s, { ...noInput(), pointerDeg: 90, torquePressed: true }, DT, LOCKS).state;

    // Drive to the 'opening' phase (torque succeeds).
    const toOpening = run(s, noInput, (x) => x.phase === 'opening');
    expect(toOpening.events).toContain('open');

    // Drive through the opening sweep to the advance.
    const advanced = run(toOpening.state, noInput, (x) => x.currentLock === 1);
    expect(advanced.events).toContain('advance');
    expect(advanced.state.locksOpened).toBe(1);
    expect(advanced.state.lockResults[0]).toBe('open');
    expect(advanced.state.currentLock).toBe(1);
    expect(advanced.state.pickDeg).toBe(90);   // pick recentred
    expect(advanced.state.cylinderDeg).toBe(0);
    expect(advanced.state.phase).toBe('idle');
    expect(advanced.state.done).toBe(false);
  });

  it('opening the final lock finishes the run with the correct score', () => {
    // Craft a state mid-opening on the last lock, all prior locks opened.
    const picks = 4;
    const s: LockpickState = {
      ...initLockpick(),
      phase: 'opening',
      cylinderDeg: CYLINDER_OPEN_DEG - 0.5,
      currentLock: NUM_LOCKS - 1,
      locksOpened: NUM_LOCKS - 1,
      picksRemaining: picks,
      lockResults: ['open', 'open', null],
    };

    const res = stepLockpick(s, noInput(), DT, LOCKS);
    expect(res.state.phase).toBe('done');
    expect(res.state.done).toBe(true);
    expect(res.events).toContain('finish');
    expect(res.state.locksOpened).toBe(NUM_LOCKS);
    expect(res.state.lockResults[NUM_LOCKS - 1]).toBe('open');
    expect(res.state.score).toBeCloseTo(lockpickingScore(NUM_LOCKS, picks), 5);
  });
});

// ── purity / determinism ─────────────────────────────────────────────────────

describe('stepLockpick — purity', () => {
  it('does not mutate the input state', () => {
    const s = { ...initLockpick(), pickDeg: 42, cylinderDeg: 10 };
    const snapshot = JSON.stringify(s);
    stepLockpick(s, { ...noInput(), torquePressed: true, pointerDeg: 105 }, DT, LOCKS);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('is deterministic for identical (state, input, dt, locks)', () => {
    const s = { ...initLockpick(), torqueHeld: true, pickDeg: 105, cylinderDeg: 20, jamTime: 0.2 };
    const a = stepLockpick(s, noInput(), DT, LOCKS);
    const b = stepLockpick(s, noInput(), DT, LOCKS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
