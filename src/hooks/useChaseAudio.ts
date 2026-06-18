// Audio side-effect hook for the Rooftop Chase trial.
//
// Owns all Web Audio interactions for the chase; keeps useChaseLoop and the
// component purely concerned with timing and rendering respectively.
//
// Pattern: useEffect with no dependency array fires after every render (= every RAF
// frame). Edge-detection via prevRef sentinels fires one-shot cues on rising edges.

import { useEffect, useRef } from 'react';
import type { ChaseState } from '@/engine/trials/rooftopChase';
import { LEAD_MAX } from '@/engine/trials/rooftopChase';
import * as sfx from '@/lib/sfx';

/**
 * Mount inside the RooftopChaseRun component alongside useChaseLoop.
 *
 * @param state        Current ChaseState — re-rendered ~60 fps.
 * @param soundEnabled Mirrors settings.soundEnabled; silences all output when false.
 */
export function useChaseAudio(state: ChaseState, soundEnabled: boolean): void {
  useEffect(() => {
    sfx.setMuted(!soundEnabled);
  }, [soundEnabled]);

  // Stop the drone on unmount to avoid lingering sound after the modal closes.
  useEffect(() => {
    return () => {
      sfx.stopDrone();
    };
  }, []);

  // ── Per-frame edge-detection refs ──────────────────────────────────────────
  const prevJumped        = useRef(false);
  const prevDoubleJumped  = useRef(false);
  const prevLanded        = useRef(false);
  const prevStomped       = useRef(false);
  const prevDashed        = useRef(false);
  const prevStumbled      = useRef(false);
  const prevFell          = useRef(false);
  const prevChaserActive  = useRef(false);
  const prevSurged        = useRef(false);
  const prevNearMiss      = useRef(false);
  const prevDone          = useRef(false);
  const prevJumpedMook    = useRef(false);
  const prevLedgeCaught   = useRef(false);

  // ── Audio effect — runs after every render (no dep array = every frame) ───
  useEffect(() => {
    if (state.justJumped       && !prevJumped.current)       sfx.play('jump');
    if (state.justDoubleJumped && !prevDoubleJumped.current) sfx.play('doubleJump');
    if (state.justLanded       && !prevLanded.current)       sfx.play('land');
    if (state.justStomped      && !prevStomped.current)      sfx.play('stomp');
    if (state.justDashed       && !prevDashed.current)       sfx.play('dash');
    if (state.justStumbled     && !prevStumbled.current)     sfx.play('stumble');
    if (state.justFell         && !prevFell.current)         sfx.play('fall');
    if (state.justJumpedMook   && !prevJumpedMook.current)   sfx.play('dodge');
    if (state.justLedgeCaught  && !prevLedgeCaught.current)  sfx.play('ledgeCatch');

    // Chaser spawns — play growl and start the tension drone.
    if (state.chaserActive && !prevChaserActive.current) {
      sfx.play('growl');
      sfx.startDrone();
    }

    // Surge — beast lunges.
    if (state.justSurged && !prevSurged.current) {
      sfx.play('surge');
      sfx.spikeDrone();
    }

    // Near-miss — hero shoved the beast back at dangerously low lead.
    if (state.justNearMiss && !prevNearMiss.current) {
      sfx.play('nearMiss');
    }

    // Run complete — play the dedicated chase fanfare rather than the generic win cue.
    if (state.done && !prevDone.current && state.score >= 1) {
      sfx.play('chaseWin');
    }

    // Stop the drone when the run ends (win, fall, or caught).
    if (state.done && !prevDone.current) {
      sfx.stopDrone();
    }

    // Drive drone intensity from lead fraction every frame while chasing.
    if (state.chaserActive && !state.done) {
      sfx.setDroneIntensity(1 - state.lead / LEAD_MAX);
    }

    prevJumped.current       = state.justJumped;
    prevDoubleJumped.current = state.justDoubleJumped;
    prevLanded.current       = state.justLanded;
    prevStomped.current      = state.justStomped;
    prevDashed.current       = state.justDashed;
    prevStumbled.current     = state.justStumbled;
    prevFell.current         = state.justFell;
    prevChaserActive.current = state.chaserActive;
    prevSurged.current       = state.justSurged;
    prevNearMiss.current     = state.justNearMiss;
    prevDone.current         = state.done;
    prevJumpedMook.current   = state.justJumpedMook;
    prevLedgeCaught.current  = state.justLedgeCaught;
  }); // intentionally no dep array — must fire every frame
}
