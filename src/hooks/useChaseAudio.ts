// Audio side-effect hook for the Rooftop Chase trial.
//
// Owns all Web Audio interactions for the chase; keeps useChaseLoop and the
// component purely concerned with timing and rendering respectively.
//
// Pattern: mirrors the dust-puff / landing-animation effects in RooftopChase.tsx —
// `useEffect` with no dependency array fires after every render (= every RAF frame),
// edge-detects one-frame flags via prevRef sentinels, and fires audio cues.
//
// A separate cleanup effect (empty deps) stops the drone on unmount.

import { useEffect, useRef } from 'react';
import type { ChaseState } from '@/engine/trials/rooftopChase';
import { LEAD_MAX } from '@/engine/trials/rooftopChase';
import * as sfx from '@/lib/sfx';

/**
 * Mount inside the RooftopChase component alongside useChaseLoop.
 *
 * @param state        Current ChaseState — re-rendered ~60 fps.
 * @param soundEnabled Mirrors settings.soundEnabled; silences all output when false.
 */
export function useChaseAudio(state: ChaseState, soundEnabled: boolean): void {
  // Sync sfx muted state whenever the setting changes (not every frame).
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

  // ── Audio effect — runs after every render (no dep array = every frame) ───
  useEffect(() => {
    // One-shot cues — fire on rising edge of each one-frame flag.
    if (state.justJumped       && !prevJumped.current)       sfx.play('jump');
    if (state.justDoubleJumped && !prevDoubleJumped.current) sfx.play('doubleJump');
    if (state.justLanded       && !prevLanded.current)       sfx.play('land');
    if (state.justStomped      && !prevStomped.current)      sfx.play('stomp');
    if (state.justDashed       && !prevDashed.current)       sfx.play('dash');
    if (state.justStumbled     && !prevStumbled.current)     sfx.play('stumble');
    if (state.justFell         && !prevFell.current)         sfx.play('fall');

    // Chaser spawns — play the growl and start the tension drone.
    if (state.chaserActive && !prevChaserActive.current) {
      sfx.play('growl');
      sfx.startDrone();
    }

    // Surge — beast lunges; deep rumble swell + instant drone spike.
    if (state.justSurged && !prevSurged.current) {
      sfx.play('surge');
      sfx.spikeDrone();
    }

    // Near-miss — hero shoved the beast back at dangerously low lead.
    if (state.justNearMiss && !prevNearMiss.current) {
      sfx.play('nearMiss');
    }

    // Run complete (reached the target distance without being caught).
    if (state.done && !prevDone.current && state.score >= 1) {
      sfx.play('win');
    }

    // Stop the drone when the run ends (win, fall, or caught).
    if (state.done && !prevDone.current) {
      sfx.stopDrone();
    }

    // Drive drone intensity from the lead fraction every frame while chasing.
    // 0 lead (caught) → intensity 1 (most intense); full lead → intensity 0.
    if (state.chaserActive && !state.done) {
      sfx.setDroneIntensity(1 - state.lead / LEAD_MAX);
    }

    // Advance edge-detection sentinels.
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
  }); // intentionally no dep array — must fire every frame
}
