// Audio side-effect hook for Hex Tactics.
//
// Unlike the Rooftop Chase hook (which fires every RAF frame and edge-detects
// one-frame boolean flags), Tactics is event-queue driven: the engine returns a
// fresh HexBattleState with `effects: TacticalEffect[]` on every action. The hook
// subscribes to the `tactics` reference and processes only newly-seen effects
// (tracked by their monotonically-increasing `id`), so no sound fires twice even
// if React re-renders without a state change.
//
// Drone intensity is updated on each state change to reflect danger level
// (low HP + many enemies alive → high intensity).

import { useEffect, useRef } from 'react';
import type { HexBattleState, HexBattleStatus } from '@/engine/hexBattle';
import type { Turn } from '@/engine/hexBattle';
import * as sfx from '@/lib/sfx';

/**
 * Mount inside TacticsOverlay alongside the animation useEffect.
 *
 * @param tactics      Current HexBattleState from the Zustand store (null-safe).
 * @param soundEnabled Mirrors settings.soundEnabled; silences all output when false.
 */
export function useTacticsAudio(
  tactics: HexBattleState | null,
  soundEnabled: boolean,
): void {
  // Sync sfx muted state whenever the setting changes.
  useEffect(() => {
    sfx.setMuted(!soundEnabled);
  }, [soundEnabled]);

  // Drone: start on mount (battle begins when TacticsOverlay renders),
  // stop and clean up on unmount (battle over, overlay removed).
  useEffect(() => {
    sfx.startDrone();
    return () => {
      sfx.stopDrone();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stateful refs for edge-detection across renders ──────────────────────

  /** Highest effect id we've already fired a cue for. */
  const prevEffectSeq      = useRef(-1);
  /** Enemy count from the previous render (to detect deaths). */
  const prevEnemyCount     = useRef<number | null>(null);
  /** Previous battle status to detect victory/defeat transitions. */
  const prevStatus         = useRef<HexBattleStatus | null>(null);
  /** Previous turn to detect player→enemy and enemy→player transitions. */
  const prevTurn           = useRef<Turn | null>(null);
  /** Enemy count at battle start — used to normalise drone intensity. */
  const startingEnemies    = useRef(0);
  /** Whether the objective was already complete last render (edge-detect completion). */
  const prevObjComplete    = useRef(false);
  /** Whether the objective was already failed last render (edge-detect the miss). */
  const prevObjFailed      = useRef(false);

  // ── Main audio effect — fires whenever tactics state changes ─────────────
  useEffect(() => {
    if (!tactics) return;

    // Capture starting enemy count once (first render with active battle).
    if (prevStatus.current === null && tactics.status === 'active') {
      startingEnemies.current = tactics.enemies.length;
    }

    // ── New effects since last render ─────────────────────────────────────
    const newFx = tactics.effects.filter((e) => e.id > prevEffectSeq.current);
    if (newFx.length > 0) {
      prevEffectSeq.current = newFx.reduce((m, e) => Math.max(m, e.id), prevEffectSeq.current);
      for (const fx of newFx) {
        if      (fx.kind === 'melee')         sfx.play('swing');
        else if (fx.kind === 'arrow')         sfx.play('arrowFly');
        else if (fx.kind === 'spell:push')    sfx.play('push');
        else if (fx.kind === 'spell:blink')   sfx.play('blink');
        else if (fx.kind.startsWith('spell:')) {
          // Heal spells carry a 'heal' color on their floater; the main spell fx fires cast.
          sfx.play(fx.color === 'heal' ? 'heal' : 'cast');
        } else if (fx.kind === 'floater') {
          if      (fx.color === 'dmg-player') sfx.play('playerHurt');
          else if (fx.color === 'heal')       sfx.play('heal');
          // 'dmg-enemy' floaters: the melee/arrow above already fired for that hit.
        }
      }
    }

    // ── Enemy death ───────────────────────────────────────────────────────
    const aliveCount = tactics.enemies.length;
    if (prevEnemyCount.current !== null && aliveCount < prevEnemyCount.current) {
      sfx.play('enemyDeath');
    }
    prevEnemyCount.current = aliveCount;

    // ── Turn boundary ─────────────────────────────────────────────────────
    if (prevTurn.current !== null && prevTurn.current !== tactics.turn
        && tactics.status === 'active') {
      sfx.play('turnEnd');
    }
    prevTurn.current = tactics.turn;

    // ── Secondary objective completed / missed ────────────────────────────
    const objNowComplete = tactics.objective?.complete ?? false;
    if (!prevObjComplete.current && objNowComplete) sfx.play('tacticsObjective');
    prevObjComplete.current = objNowComplete;
    // A quiet descending thud when the objective is missed mid-match (swift budget spent,
    // flawless HP floor broken) — softer than the defeat sting; the match itself is still live.
    const objNowFailed = tactics.objective?.failed ?? false;
    if (!prevObjFailed.current && objNowFailed && tactics.status === 'active') sfx.play('groveWrong');
    prevObjFailed.current = objNowFailed;

    // ── Outcome ───────────────────────────────────────────────────────────
    if (prevStatus.current === 'active' && tactics.status !== 'active') {
      sfx.play(tactics.status === 'won' ? 'victory' : 'defeat');
      sfx.stopDrone();
    }
    prevStatus.current = tactics.status;

    // ── Drone intensity ───────────────────────────────────────────────────
    if (tactics.status === 'active' && startingEnemies.current > 0) {
      // Danger = low HP + many enemies still alive.
      const hpDanger      = 1 - (tactics.player.hp / Math.max(1, tactics.player.maxHp));
      const enemyPressure = aliveCount / startingEnemies.current;
      sfx.setDroneIntensity(Math.min(1, 0.35 * hpDanger + 0.65 * enemyPressure));
    }
  }, [tactics]);
}
