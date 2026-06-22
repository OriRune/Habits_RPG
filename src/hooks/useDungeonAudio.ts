// Audio side-effect hook for Dungeon Delve.
//
// The dungeon is state-transition driven (not RAF-per-frame like the Chase), so
// this hook edge-detects changes to the run state and fires the appropriate cue.
// It mirrors the pattern of useTacticsAudio: one useEffect per sfx concern, each
// holding a ref to the "last seen" value so React batching never fires a cue twice.
//
// Cue mapping:
//   dungeonRoomEnter — nodeId changes to a non-null value (entering any room)
//   dungeonTreasure  — roomLoot transitions from null → non-null
//   dungeonRelic     — relics.length increases
//   dungeonBank      — atCheckpoint transitions from false → true
//   dungeonDescend   — depth increases (a floor was cleared and we went deeper)
//   victory/defeat   — battle status won/lost (reuse existing cues)
//   battleStart      — battle transitions from null → non-null (combat entered)

import { useEffect, useRef } from 'react';
import type { DungeonRun } from '@/engine/dungeonTypes';
import * as sfx from '@/lib/sfx';

/**
 * Mount inside DungeonView when a run is active.
 *
 * @param dungeon      Current DungeonRun from the store (null when no run).
 * @param soundEnabled Mirrors settings.soundEnabled.
 */
export function useDungeonAudio(
  dungeon: DungeonRun | null,
  soundEnabled: boolean,
): void {
  // ── Sync muted state ──────────────────────────────────────────────────────
  useEffect(() => {
    sfx.setMuted(!soundEnabled);
  }, [soundEnabled]);

  // ── Edge-detection refs ───────────────────────────────────────────────────
  const prevNodeId       = useRef<string | null>(null);
  const prevRoomLoot     = useRef<boolean>(false);         // true when roomLoot was non-null
  const prevRelicCount   = useRef<number>(0);
  const prevAtCheckpoint = useRef<boolean>(false);
  const prevDepth        = useRef<number>(0);
  const prevBattleNull   = useRef<boolean>(true);          // true when battle was null
  const prevBattleStatus = useRef<string | null>(null);

  // ── Reset refs when the run starts or ends ────────────────────────────────
  useEffect(() => {
    if (!dungeon) {
      prevNodeId.current       = null;
      prevRoomLoot.current     = false;
      prevRelicCount.current   = 0;
      prevAtCheckpoint.current = false;
      prevDepth.current        = 0;
      prevBattleNull.current   = true;
      prevBattleStatus.current = null;
    }
  }, [dungeon]);

  // ── Main audio effect ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!dungeon) return;

    // Room entry — nodeId changes from null/prev to a new non-null value.
    if (dungeon.nodeId !== prevNodeId.current && dungeon.nodeId !== null) {
      sfx.play('dungeonRoomEnter');
    }
    prevNodeId.current = dungeon.nodeId;

    // Treasure payout — roomLoot appears.
    const hasLoot = dungeon.roomLoot !== null;
    if (hasLoot && !prevRoomLoot.current) {
      sfx.play('dungeonTreasure');
    }
    prevRoomLoot.current = hasLoot;

    // Relic gained — relics array grew.
    if (dungeon.relics.length > prevRelicCount.current) {
      sfx.play('dungeonRelic');
    }
    prevRelicCount.current = dungeon.relics.length;

    // Checkpoint reached — atCheckpoint flips to true.
    if (dungeon.atCheckpoint && !prevAtCheckpoint.current) {
      sfx.play('dungeonBank');
    }
    prevAtCheckpoint.current = dungeon.atCheckpoint;

    // Descended to a new floor — depth increased.
    if (dungeon.depth > prevDepth.current && prevDepth.current > 0) {
      sfx.play('dungeonDescend');
    }
    prevDepth.current = dungeon.depth;

    // Combat entered — battle transitions from null to non-null.
    const battleNull = dungeon.battle === null;
    if (!battleNull && prevBattleNull.current) {
      sfx.play('battleStart');
    }
    prevBattleNull.current = battleNull;

    // Combat outcome.
    const status = dungeon.battle?.status ?? null;
    if (prevBattleStatus.current === 'active' && status === 'won') sfx.play('victory');
    if (prevBattleStatus.current === 'active' && status === 'lost') sfx.play('defeat');
    prevBattleStatus.current = status ?? null;

  }, [dungeon]);
}
