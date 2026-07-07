// RAF-clock hook for the Rooftop Chase trial.
//
// Owns the timing loop; all rules live in the pure engine (rooftopChase.ts).
// Pattern mirrors useMiningLoop / useArenaLoop: "timing here, rules in engine."
//
// The hook no longer calls onFinish directly — the component watches state.done
// and decides when to submit (accept score) or restart (try again). This lets
// the player retry a poor run without navigating back through the modal.

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  initChase,
  stepChase,
  seededRng,
  type ChaseState,
  type ChaseInput,
} from '@/engine/trials/rooftopChase';

export interface ChaseControls {
  jump:  () => void;
  slide: () => void;
  dash:  () => void;
}

/**
 * Mount once inside the RooftopChaseRun component.
 *
 * Returns the current ChaseState (re-renders ~60fps while active) plus
 * imperative control callbacks for the on-screen buttons.
 * The run stops when state.done — the caller is responsible for submission.
 */
export function useChaseLoop(): {
  state:    ChaseState;
  controls: ChaseControls;
} {
  // Seed is fixed at mount time so each run is reproducible if needed.
  const seed = useRef(Date.now());

  // Stable sim ref — updated every frame, never triggers re-renders by itself.
  const stateRef    = useRef<ChaseState>(initChase(seededRng(seed.current)));
  // Render state — one setState per frame.
  const [renderState, setRenderState] = useState<ChaseState>(() => stateRef.current);

  // Edge-triggered input buffer: set by handlers, consumed and cleared each RAF tick.
  const inputRef = useRef<ChaseInput>({ jumpPressed: false, slidePressed: false, dashPressed: false });

  const lastTsRef = useRef<number | null>(null);
  const doneRef   = useRef(false);

  // ── Input callbacks (exposed to component buttons + keyboard handler) ───────
  const jump  = useCallback(() => { inputRef.current.jumpPressed  = true; }, []);
  const slide = useCallback(() => { inputRef.current.slidePressed = true; }, []);
  const dash  = useCallback(() => { inputRef.current.dashPressed  = true; }, []);

  // ── Keyboard bindings ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore OS key auto-repeat — a held key must not count as a second press.
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault(); jump();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault(); slide();
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyD') {
        e.preventDefault(); dash();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [jump, slide, dash]);

  // ── Touch gesture bindings ────────────────────────────────────────────────────
  // Swipe-down  → slide  (natural "duck" gesture on touch devices).
  // Tap (no swipe) → jump is handled by the play area's onClick; we only intercept
  // a clear downward swipe here to avoid double-firing jump on every touch event.
  useEffect(() => {
    const SWIPE_MIN_PX = 30;  // minimum vertical travel to count as a swipe
    const SWIPE_MAX_MS = 250; // maximum duration to count as a swipe (not a hold)

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartT = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      touchStartT = performance.now();
    };

    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY; // positive = downward on screen
      const dt = performance.now() - touchStartT;

      if (dt < SWIPE_MAX_MS && dy > SWIPE_MIN_PX && dy > Math.abs(dx)) {
        // Clear downward swipe — trigger slide. The play-area onClick handles taps (jump).
        slide();
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend',   onTouchEnd,   { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend',   onTouchEnd);
    };
  }, [slide]);

  // ── RAF loop ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let raf: number;

    const loop = (ts: number) => {
      if (doneRef.current) return;

      if (lastTsRef.current === null) lastTsRef.current = ts;
      // Cap dt at 50 ms so a tab-switch or heavy frame doesn't send the hero flying.
      const dtSec = Math.min((ts - lastTsRef.current) / 1000, 0.05);
      lastTsRef.current = ts;

      // Consume buffered input (edge-triggered: flags are true for exactly one tick).
      const input: ChaseInput = { ...inputRef.current };
      inputRef.current = { jumpPressed: false, slidePressed: false, dashPressed: false };

      const newState = stepChase(stateRef.current, input, dtSec);
      stateRef.current = newState;
      setRenderState(newState);

      if (newState.done) {
        doneRef.current = true;
        return; // do not re-schedule — component watches state.done and handles submission
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []); // mount-once

  return {
    state:    renderState,
    controls: { jump, slide, dash },
  };
}
