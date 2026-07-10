// Dungeon-run room lifecycle — pure transforms over a DungeonRun (design brief: Dungeon Delve).
// No React, no store imports. The store-side `enterRoom` (which needs GameState) lives in the
// store layer and calls `currentRoom` from here.
import { type DungeonRun, type DungeonEndReason } from './dungeonTypes';
import { type Reward } from './challenges';
import { mergeReward, scaleReward } from './dungeon';
import { rollBoons } from './relics';

/**
 * Retention policy for runs that end early: the share of the *current floor's* gold and
 * material quantities kept (floored per `scaleReward`; small stacks can round to zero).
 * The current floor's discrete drops (items/weapons/gear) are always lost. Loot banked at
 * prior checkpoints is never touched. All player-facing copy must render from these values
 * (via `previewRetainedReward`), never from hard-coded numbers.
 */
export const DUNGEON_RETENTION: Record<Exclude<DungeonEndReason, 'banked'>, number> = {
  fled: 0.6,
  defeated: 0.25,
};

/** The run's end reason, deriving a fallback for saves that predate `endReason`. */
export function runEndReason(run: Pick<DungeonRun, 'endReason' | 'cleared' | 'hp'>): DungeonEndReason {
  return run.endReason ?? (run.cleared ? 'banked' : run.hp <= 0 ? 'defeated' : 'fled');
}

/**
 * Exact kept/lost split of the current floor's loot if the run ended now for `reason`.
 * `kept` is computed with the same `scaleReward` used by `finishRun`, so this preview can
 * never drift from the real outcome — including `Math.floor` zeroing small material stacks.
 */
export function previewRetainedReward(
  run: Pick<DungeonRun, 'floorReward'>,
  reason: Exclude<DungeonEndReason, 'banked'>,
): { kept: Reward; lost: Reward } {
  const floor = run.floorReward;
  const kept = scaleReward(floor, DUNGEON_RETENTION[reason]);
  const lostMaterials: Record<string, number> = {};
  for (const [k, v] of Object.entries(floor.materials ?? {})) {
    const lost = v - (kept.materials?.[k] ?? 0);
    if (lost > 0) lostMaterials[k] = lost;
  }
  const lost: Reward = {
    gold: (floor.gold ?? 0) - (kept.gold ?? 0),
    materials: lostMaterials,
    items: [...(floor.items ?? [])],
    weapons: [...(floor.weapons ?? [])],
    gear: [...(floor.gear ?? [])],
  };
  return { kept, lost };
}

/** Boon tiers unlock with how deep you've gone: tier 2 from depth 4, tier 3 from depth 10. */
export function boonMaxTier(depth: number, deepest: number): number {
  const d = Math.max(depth, deepest);
  if (d >= 10) return 3;
  if (d >= 4) return 2;
  return 1;
}

/** Offer three boon choices on a run (press-on / shrine / elite). No-op if the pool is empty. */
export function offerBoon(run: DungeonRun, maxTier: number): void {
  const choices = rollBoons(3, run.relics, maxTier);
  run.pendingBoon = choices.length ? choices : null;
}

/**
 * Resolve the current room: carry the given resources, then either present the next path
 * choices or reach the floor checkpoint when the node is terminal. Shared by combat, encounters,
 * and the new room types (shrine/merchant/rest). Pure: returns a fresh run.
 */
export function resolveCurrentNode(run: DungeonRun, hp: number, mp: number, sta: number): DungeonRun {
  const node = run.nodeId ? run.map.nodes[run.nodeId] : null;
  // Partial mana regen when pressing onward (full restore happens at checkpoints).
  const regenMp = Math.min(run.maxMp, mp + Math.round(run.maxMp * 0.15));
  const next: DungeonRun = {
    ...run,
    nodeId: null,
    hp,
    mp: regenMp,
    sta,
    battle: null,
    encounter: null,
    roomLoot: null,
    merchant: null,
    // Reaching here means the room resolved successfully (flee/defeat go through finishRun).
    ...(node ? { roomsCleared: (run.roomsCleared ?? 0) + 1 } : {}),
  };
  if (!node || node.to.length === 0) {
    // Floor cleared → checkpoint. HP carries over (attrition); the Rest/Press-On/Bank choice and
    // any MP/Stamina restore happen at the checkpoint (dungeonDescend). No free full heal.
    next.choices = [];
    next.atCheckpoint = true;
    next.bankedReward = mergeReward(next.bankedReward, next.floorReward);
    next.floorReward = {};
  } else {
    next.choices = node.to;
  }
  return next;
}

/** The room payload of the node currently being resolved (null at a path choice / floor start). */
export function currentRoom(run: DungeonRun) {
  return run.nodeId ? run.map.nodes[run.nodeId]?.room ?? null : null;
}

/** Finalize a run that ended early (fled or defeated): bank the retained share of the
 *  current floor's loot per `DUNGEON_RETENTION` and stamp the end reason. Banking safely
 *  goes through `dungeonBank` in the store, not here. */
export function finishRun(
  run: DungeonRun,
  reason: Exclude<DungeonEndReason, 'banked'>,
  hp: number,
): DungeonRun {
  const { kept, lost } = previewRetainedReward(run, reason);
  return {
    ...run,
    hp,
    status: 'ended',
    cleared: false,
    endReason: reason,
    bankedReward: mergeReward(run.bankedReward, kept),
    floorReward: {},
    lostReward: lost,
    battle: null,
    encounter: null,
  };
}
