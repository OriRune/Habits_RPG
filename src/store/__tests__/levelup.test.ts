/**
 * Level-up gate interplay tests.
 *
 * Tests the checkLevelUp / grantStatXp logic that the improvement plan identified as
 * "subtle and fragile": the interplay between the battle guard, the BOSS_GATE_LEVEL
 * queue, and crossing multiple thresholds in one shot.
 *
 * These use the pure shared helpers directly rather than dispatching through the full
 * store, because the logic under test is in store/shared.ts (not in a slice action).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../useGameStore';
import { checkLevelUp, grantStatXp } from '../shared';
import { BOSS_GATE_LEVEL } from '@/engine/progression';
import { cumulativeXpToReach } from '@/engine/leveling';
import type { GameState } from '../shared';
import type { BattleState } from '@/engine/combat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const get = () => useGameStore.getState();

/** Build a mutable copy of the current store state so we can call pure helpers on it. */
function baseState(): GameState {
  return { ...get(), character: { ...get().character, statXp: { ...get().character.statXp } } };
}

/** Distribute `totalXp` evenly across all 8 stats so levelForTotalXp() computes correctly. */
function withTotalXp(s: GameState, totalXp: number): GameState {
  const perStat = Math.floor(totalXp / 8);
  const remainder = totalXp - perStat * 7;
  return {
    ...s,
    character: {
      ...s.character,
      statXp: {
        DX: perStat, AG: perStat, ST: perStat, EN: perStat,
        WI: perStat, CH: perStat, KN: perStat, HP: remainder,
      },
      statXpAtLastLevel: {
        DX: 0, AG: 0, ST: 0, EN: 0, WI: 0, CH: 0, KN: 0, HP: 0,
      },
    },
  };
}

beforeEach(() => {
  get().resetGame();
});

// ---------------------------------------------------------------------------
// checkLevelUp: battle guard
// ---------------------------------------------------------------------------

describe('checkLevelUp: battle guard', () => {
  it('does not advance level or set pendingLevelUp while battle is active', () => {
    // Enough XP for Lv2 (needs 100 total), character starts at Lv1.
    const s = withTotalXp(baseState(), cumulativeXpToReach(2) + 50);
    // Inject a battle (any truthy BattleState stops the gate).
    s.battle = { status: 'active' } as BattleState;

    checkLevelUp(s);

    expect(s.character.level).toBe(1);      // no auto-advance
    expect(s.pendingLevelUp).toBeNull();     // no pending queued
  });

  it('advances normally once battle is cleared', () => {
    const s = withTotalXp(baseState(), cumulativeXpToReach(2) + 50);
    s.battle = null; // no active battle

    checkLevelUp(s);

    expect(s.character.level).toBe(2); // auto-advanced
  });
});

// ---------------------------------------------------------------------------
// checkLevelUp: auto-advance (below BOSS_GATE_LEVEL)
// ---------------------------------------------------------------------------

describe('checkLevelUp: auto-advance below boss gate', () => {
  it('auto-advances from Lv1 to Lv2 when XP crosses the threshold', () => {
    const s = withTotalXp(baseState(), cumulativeXpToReach(2));
    checkLevelUp(s);
    expect(s.character.level).toBe(2);
    expect(s.pendingLevelUp).toBeNull();
  });

  it('auto-advances through multiple levels in one call', () => {
    // Enough XP for Lv4 but below the Lv5 (BOSS_GATE_LEVEL) threshold.
    const xp = cumulativeXpToReach(BOSS_GATE_LEVEL) - 1;
    const s = withTotalXp(baseState(), xp);
    checkLevelUp(s);
    expect(s.character.level).toBe(BOSS_GATE_LEVEL - 1); // all auto-levels applied
    expect(s.pendingLevelUp).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkLevelUp: boss gate (BOSS_GATE_LEVEL and above)
// ---------------------------------------------------------------------------

describe('checkLevelUp: boss gate at BOSS_GATE_LEVEL', () => {
  it('queues pendingLevelUp instead of advancing when XP crosses BOSS_GATE_LEVEL', () => {
    const xp = cumulativeXpToReach(BOSS_GATE_LEVEL);
    const s = withTotalXp(baseState(), xp);
    s.character = { ...s.character, level: BOSS_GATE_LEVEL - 1 };

    checkLevelUp(s);

    expect(s.character.level).toBe(BOSS_GATE_LEVEL - 1); // not auto-advanced
    expect(s.pendingLevelUp).toBe(BOSS_GATE_LEVEL);      // trial queued
  });

  it('does not re-queue pendingLevelUp if one is already pending', () => {
    const xp = cumulativeXpToReach(BOSS_GATE_LEVEL) + 1000; // way past the gate
    const s = withTotalXp(baseState(), xp);
    s.character = { ...s.character, level: BOSS_GATE_LEVEL - 1 };
    s.pendingLevelUp = BOSS_GATE_LEVEL; // already queued

    checkLevelUp(s);

    expect(s.pendingLevelUp).toBe(BOSS_GATE_LEVEL); // unchanged, not overwritten
  });
});

// ---------------------------------------------------------------------------
// grantStatXp: mid-run XP (the dungeon/trial use-case)
// ---------------------------------------------------------------------------

describe('grantStatXp', () => {
  it('returns updated character and pendingLevelUp when crossing BOSS_GATE_LEVEL', () => {
    // Set up a state that is Lv(BOSS_GATE_LEVEL - 1) with XP just below the gate.
    let s = withTotalXp(baseState(), cumulativeXpToReach(BOSS_GATE_LEVEL) - 10);
    s.character = { ...s.character, level: BOSS_GATE_LEVEL - 1 };

    // Grant just enough XP to cross the gate.
    const patch = grantStatXp(s, { ST: 20 });

    expect(patch.pendingLevelUp).toBe(BOSS_GATE_LEVEL); // trial queued
    expect(patch.character.level).toBe(BOSS_GATE_LEVEL - 1); // not auto-advanced past gate
  });

  it('auto-advances multiple levels when XP crosses sub-gate thresholds', () => {
    // Start at Lv1 with no XP; grant enough to reach Lv3.
    const s = baseState();
    const targetXp = cumulativeXpToReach(3);

    const patch = grantStatXp(s, { ST: targetXp });

    expect(patch.character.level).toBe(3);
    expect(patch.pendingLevelUp).toBeNull();
  });

  it('does not auto-advance when battle is active', () => {
    // Simulate being inside a trial boss fight: battle is set.
    const s = withTotalXp(baseState(), cumulativeXpToReach(2) - 10);
    s.battle = { status: 'active' } as BattleState;

    const patch = grantStatXp(s, { ST: 50 }); // enough to cross Lv2

    // checkLevelUp no-ops because battle is set, so level stays at 1.
    expect(patch.character.level).toBe(1);
    expect(patch.pendingLevelUp).toBeNull();
  });
});
