// RAF-clock hook for the Lockpicking trial.
//
// Owns the timing loop; all rules live in the pure engine (lockpicking.ts).
// Pattern mirrors useChaseLoop: "timing here, rules in engine."
//
// The hook holds the sim in a ref, advances it once per frame with a clamped
// dt, and dispatches the engine's event tags to the caller (SFX / CSS effects).
// Keyboard is handled here (window-level); pointer aim is fed in by the
// component (it needs the play-area rect) via the `aimPick` control.

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  initLockpick,
  stepLockpick,
  type LockpickState,
  type LockpickInput,
  type LockpickEvent,
  type LockConfig,
} from '@/engine/trials/lockpicking';

export interface LockpickControls {
  /** Set the held pick-rotation direction (-1, 0, 1) — on-screen arrows / keyboard. */
  setPickDir:    (dir: number) => void;
  /** Latch torque on (button/pointer down). */
  pressTorque:   () => void;
  /** Latch torque off (button/pointer up/leave). */
  releaseTorque: () => void;
  /** Aim the pick to an absolute angle (pointer move; component computes the degree). */
  aimPick:       (deg: number) => void;
}

/**
 * Mount once inside the Lockpicking component.
 *
 * `locks` is captured at mount (stable for the run). `onEvent` receives each
 * engine event tag in order as it occurs (used for SFX). Returns the current
 * LockpickState (re-renders ~60fps while active) plus imperative controls.
 *
 * The loop stops when the sim reaches 'done' (terminal) or 'revealing' (paused —
 * the component drives the reveal hold timeout).
 */
export function useLockpickLoop(
  locks: LockConfig[],
  onEvent?: (tag: LockpickEvent) => void,
): { state: LockpickState; controls: LockpickControls } {
  // Locks captured once at mount — never re-read.
  const locksRef = useRef(locks);

  // Stable sim ref — updated every frame, never triggers re-renders by itself.
  const stateRef = useRef<LockpickState>(initLockpick());
  const [renderState, setRenderState] = useState<LockpickState>(() => stateRef.current);

  // Input buffer: torque edges are consumed each tick; pickKeyDir is held.
  const inputRef = useRef<LockpickInput>({
    torquePressed: false,
    torqueReleased: false,
    pickKeyDir: 0,
    pointerDeg: null,
  });

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const lastTsRef = useRef<number | null>(null);
  const doneRef   = useRef(false);

  // ── Controls (exposed to component buttons + pointer handler) ───────────────
  const setPickDir    = useCallback((dir: number) => { inputRef.current.pickKeyDir = dir; }, []);
  const pressTorque   = useCallback(() => { inputRef.current.torquePressed = true; }, []);
  const releaseTorque = useCallback(() => { inputRef.current.torqueReleased = true; }, []);
  const aimPick       = useCallback((deg: number) => { inputRef.current.pointerDeg = deg; }, []);

  // ── Keyboard bindings ────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft'  || e.code === 'KeyA') { e.preventDefault(); inputRef.current.pickKeyDir = -1; }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); inputRef.current.pickKeyDir = 1; }
      else if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); inputRef.current.torquePressed = true; }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'ArrowRight' || e.code === 'KeyD') inputRef.current.pickKeyDir = 0;
      else if (e.code === 'Space' || e.code === 'ArrowUp') inputRef.current.torqueReleased = true;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // ── RAF loop ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let raf: number;

    const loop = (ts: number) => {
      if (doneRef.current) return;

      if (lastTsRef.current === null) lastTsRef.current = ts;
      // Cap dt at 50 ms so a tab-switch or heavy frame doesn't over-integrate.
      const dt = Math.min((ts - lastTsRef.current) / 1000, 0.05);
      lastTsRef.current = ts;

      // Consume edge-triggered inputs; keep the held pickKeyDir.
      const input: LockpickInput = { ...inputRef.current };
      inputRef.current.torquePressed  = false;
      inputRef.current.torqueReleased = false;
      inputRef.current.pointerDeg     = null;

      const { state: next, events } = stepLockpick(stateRef.current, input, dt, locksRef.current);
      stateRef.current = next;
      setRenderState(next);

      for (const ev of events) onEventRef.current?.(ev);

      // 'revealing' pauses the sim (the component drives the reveal timeout);
      // 'done' is terminal. Either way, stop the RAF loop.
      if (next.phase === 'done' || next.phase === 'revealing') {
        doneRef.current = true;
        return;
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []); // mount-once

  return {
    state: renderState,
    controls: { setPickDir, pressTorque, releaseTorque, aimPick },
  };
}
