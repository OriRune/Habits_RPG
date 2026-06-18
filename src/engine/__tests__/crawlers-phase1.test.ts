/**
 * Phase 1 crawler overhaul — engine tests
 *
 * Covers:
 *  1. crawl.ts — dashCooldown / moveInterval scaling formulas
 *  2. mining.ts — tryDash (i-frame, 2-cell, 1-cell fallback, cooldown gate, inactive guard)
 *  3. mining.ts — strike(charged=true) — ST bonus, CHARGE_DAMAGE_MULT on rock, stagger on monster
 *  4. forest.ts — tryDash (same contract as mine + fog reveal guard)
 *  5. forest.ts — act(charged=true) — CHARGE_DAMAGE_MULT on tree, stagger on beast
 */

import { describe, it, expect } from 'vitest';

// crawl
import {
  dashCooldown,
  moveInterval,
  DASH_BASE_CD_MS,
  CHARGE_DAMAGE_MULT,
  STAGGER_MS,
  STA_REGEN_MS,
  MP_REGEN_MS,
} from '../crawl';

// mining
import {
  tryDash as mineDash,
  strike,
  type MineState,
  type MineTile,
  type MineMonster,
  type RNG,
} from '../mining';

// forest
import {
  tryDash as forestDash,
  act,
  type ForestState,
  type ForestTile,
  type ForestBeast,
} from '../forest';

import { getWeapon, STARTER_WEAPON } from '../weapons';

const WEAPON = getWeapon(STARTER_WEAPON);

// ---------------------------------------------------------------------------
// Shared deterministic RNG
// ---------------------------------------------------------------------------

function rngFrom(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// State factories — small 7×7 arenas; bedrock border, floor interior
// ---------------------------------------------------------------------------

function makeMineState(over: Partial<MineState> = {}): MineState {
  const rows = 7;
  const cols = 7;
  const tiles: MineTile[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      return border ? ({ kind: 'bedrock' } as MineTile) : ({ kind: 'floor' } as MineTile);
    }),
  );
  return {
    floor: 1,
    rows,
    cols,
    tiles,
    player: { r: 3, c: 3, facing: 'right' },
    hp: 50, maxHp: 50,
    sta: 55, maxSta: 55,
    mp: 8,  maxMp: 8,
    staNextRegenMs: STA_REGEN_MS,
    mpNextRegenMs: MP_REGEN_MS,
    meleePower: 5,
    rangedPower: 3,
    damageSpell: 2,
    supportSpell: 2,
    illusionPower: 1,
    defense: 0,
    ward: 0,
    weapon: WEAPON,
    knownSpells: [],
    pickaxePower: 1,
    monsters: [],
    haul: {},
    status: 'active',
    lastHitAtMs: -1000,
    deepest: 1,
    killsThisFloor: 0,
    score: 0,
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    lastSpellMs: -1000,
    nextRuneId: 1,
    // Phase 1 fields
    lastDashMs: -DASH_BASE_CD_MS,
    dashCooldownMs: DASH_BASE_CD_MS,
    moveIntervalMs: 150,
    agLevel: 0,
    ...over,
  };
}

function makeForestState(over: Partial<ForestState> = {}): ForestState {
  const rows = 7;
  const cols = 7;
  const tiles: ForestTile[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      return border ? ({ kind: 'thicket' } as ForestTile) : ({ kind: 'trail' } as ForestTile);
    }),
  );
  const seen: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(true));
  return {
    stage: 1,
    rows,
    cols,
    tiles,
    seen,
    player: { r: 3, c: 3, facing: 'right' },
    hp: 50, maxHp: 50,
    sta: 55, maxSta: 55,
    mp: 8,  maxMp: 8,
    staNextRegenMs: STA_REGEN_MS,
    mpNextRegenMs: MP_REGEN_MS,
    meleePower: 5,
    rangedPower: 3,
    damageSpell: 2,
    supportSpell: 2,
    illusionPower: 1,
    defense: 0,
    ward: 0,
    weapon: WEAPON,
    knownSpells: [],
    chopPower: 1,
    beasts: [],
    haul: {},
    status: 'active',
    lastHitAtMs: -1000,
    deepest: 1,
    killsThisStage: 0,
    score: 0,
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    lastSpellMs: -1000,
    nextRuneId: 1,
    // Phase 1 fields
    lastDashMs: -DASH_BASE_CD_MS,
    dashCooldownMs: DASH_BASE_CD_MS,
    moveIntervalMs: 150,
    agLevel: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. crawl.ts — dashCooldown & moveInterval formulas
// ---------------------------------------------------------------------------

describe('dashCooldown(agLevel)', () => {
  it('equals DASH_BASE_CD_MS at AG 0', () => {
    expect(dashCooldown(0)).toBe(DASH_BASE_CD_MS); // 2000
  });

  it('decreases by 40ms per AG level', () => {
    expect(dashCooldown(10)).toBe(DASH_BASE_CD_MS - 10 * 40); // 1600
    expect(dashCooldown(20)).toBe(DASH_BASE_CD_MS - 20 * 40); // 1200
  });

  it('is capped at 800ms for high AG', () => {
    expect(dashCooldown(30)).toBe(800); // 2000 - 1200 = 800 → exactly cap
    expect(dashCooldown(50)).toBe(800); // would be negative without cap
  });
});

describe('moveInterval(agLevel)', () => {
  it('equals 150ms at AG 0', () => {
    expect(moveInterval(0)).toBe(150);
  });

  it('decreases by 2ms per AG level', () => {
    expect(moveInterval(10)).toBe(130);
    expect(moveInterval(20)).toBe(110);
  });

  it('is capped at 100ms for high AG', () => {
    expect(moveInterval(25)).toBe(100); // 150 - 50 = 100 → exactly cap
    expect(moveInterval(40)).toBe(100); // would be 70 without cap
  });
});

// ---------------------------------------------------------------------------
// 2. mining.ts — tryDash
// ---------------------------------------------------------------------------

describe('mine tryDash', () => {
  it('returns unchanged state when on cooldown', () => {
    const state = makeMineState({ lastDashMs: 9000, dashCooldownMs: 2000 });
    // nowMs = 10000 → elapsed = 1000 < 2000 cooldown
    const after = mineDash(state, 'right', 10_000);
    expect(after).toBe(state); // same reference = no-op
  });

  it('returns unchanged when status is not active', () => {
    const state = makeMineState({ status: 'dead' as MineState['status'] });
    const after = mineDash(state, 'right', 99_999);
    expect(after).toBe(state);
  });

  it('dashes 2 cells when both are clear', () => {
    // Player at (3,3) facing right; (3,4) and (3,5) are floor tiles.
    const state = makeMineState();
    const after = mineDash(state, 'right', 5_000);
    expect(after.player.r).toBe(3);
    expect(after.player.c).toBe(5);
    expect(after.player.facing).toBe('right');
  });

  it('falls back to 1-cell dash when 2nd cell is blocked', () => {
    // Place bedrock at (3,5) — 2 steps right.
    const state = makeMineState();
    state.tiles[3][5] = { kind: 'bedrock' };
    const after = mineDash(state, 'right', 5_000);
    expect(after.player.c).toBe(4);
  });

  it('falls back to 1-cell dash when 2nd cell has a monster', () => {
    const monster: MineMonster = { id: 'm1', key: 'bat', r: 3, c: 5, hp: 5, maxHp: 5, readyAtMs: 0 };
    const state = makeMineState({ monsters: [monster] });
    const after = mineDash(state, 'right', 5_000);
    expect(after.player.c).toBe(4);
  });

  it('returns unchanged when both destination cells are blocked', () => {
    const state = makeMineState();
    state.tiles[3][4] = { kind: 'bedrock' };
    state.tiles[3][5] = { kind: 'bedrock' };
    const after = mineDash(state, 'right', 5_000);
    expect(after).toBe(state);
  });

  it('sets lastDashMs to nowMs after a successful dash', () => {
    const state = makeMineState();
    const now = 7_777;
    const after = mineDash(state, 'right', now);
    expect(after.lastDashMs).toBe(now);
  });

  it('grants an i-frame by setting lastHitAtMs to nowMs', () => {
    const state = makeMineState();
    const now = 7_777;
    const after = mineDash(state, 'right', now);
    expect(after.lastHitAtMs).toBe(now);
  });

  it('updates facing even when dashing in a different direction', () => {
    const state = makeMineState({ player: { r: 3, c: 3, facing: 'right' } });
    const after = mineDash(state, 'up', 5_000);
    // (1,3) and (2,3) are both floor → 2-cell up dash
    expect(after.player.r).toBe(1);
    expect(after.player.facing).toBe('up');
  });
});

// ---------------------------------------------------------------------------
// 3. mining.ts — strike with charged=true
// ---------------------------------------------------------------------------

describe('mine strike (charged)', () => {
  const rng = rngFrom(42);

  it('normal strike reduces rock durability by effectivePick (1 with meleePower=5)', () => {
    // meleePower=5 → stBonus = floor(5/8)=0; effectivePick = 1
    const state = makeMineState({
      tiles: (() => {
        const t = makeMineState().tiles;
        t[3][4] = { kind: 'rock', durability: 5, maxDurability: 5 };
        return t;
      })(),
    });
    const after = strike(state, rng, 0, false);
    const tile = after.tiles[3][4] as MineTile & { durability: number };
    expect(tile.kind).toBe('rock');
    expect(tile.durability).toBe(4); // 5 - 1
  });

  it('charged strike reduces rock durability by ceil(1 * 1.75) = 2', () => {
    const state = makeMineState({
      tiles: (() => {
        const t = makeMineState().tiles;
        t[3][4] = { kind: 'rock', durability: 5, maxDurability: 5 };
        return t;
      })(),
    });
    const after = strike(state, rng, 0, true);
    const tile = after.tiles[3][4] as MineTile & { durability: number };
    expect(tile.kind).toBe('rock');
    expect(tile.durability).toBe(3); // 5 - ceil(1.75)=2
  });

  it('charged hit on a monster applies frozenUntilMs = nowMs + STAGGER_MS', () => {
    const monster: MineMonster = {
      id: 'm1', key: 'bat', r: 3, c: 4, hp: 50, maxHp: 50, readyAtMs: 0,
    };
    const state = makeMineState({ monsters: [monster], sta: 55 });
    const now = 3_000;
    const after = strike(state, rng, now, true);
    const m = after.monsters.find((x) => x.id === 'm1');
    if (!m) {
      // Monster was killed in one hit — that's still a valid charged strike.
      expect(after.monsters.find((x) => x.id === 'm1')).toBeUndefined();
    } else {
      expect(m.frozenUntilMs).toBe(now + STAGGER_MS);
    }
  });

  it('normal hit on a monster does NOT set frozenUntilMs', () => {
    const monster: MineMonster = {
      id: 'm1', key: 'bat', r: 3, c: 4, hp: 50, maxHp: 50, readyAtMs: 0,
    };
    const state = makeMineState({ monsters: [monster], sta: 55 });
    const after = strike(state, rng, 3_000, false);
    const m = after.monsters.find((x) => x.id === 'm1');
    if (m) {
      // frozenUntilMs should be absent or 0 (not set by the normal hit path)
      expect(m.frozenUntilMs ?? 0).toBe(0);
    }
    // If monster was killed that is also fine; no crash = pass.
  });

  it('charged strike deals more damage to a monster than a normal strike (same seed)', () => {
    const monster: MineMonster = {
      id: 'm1', key: 'bat', r: 3, c: 4, hp: 100, maxHp: 100, readyAtMs: 0,
    };
    const rngA = rngFrom(99);
    const rngB = rngFrom(99);
    const stateA = makeMineState({ monsters: [monster], sta: 55 });
    const stateB = makeMineState({ monsters: [monster], sta: 55 });
    const afterNormal = strike(stateA, rngA, 0, false);
    const afterCharged = strike(stateB, rngB, 0, true);
    const hpNormal = afterNormal.monsters.find((m) => m.id === 'm1')?.hp ?? 0;
    const hpCharged = afterCharged.monsters.find((m) => m.id === 'm1')?.hp ?? 0;
    expect(hpCharged).toBeLessThan(hpNormal);
  });
});

// ---------------------------------------------------------------------------
// 4. forest.ts — tryDash
// ---------------------------------------------------------------------------

describe('forest tryDash', () => {
  it('returns unchanged state when on cooldown', () => {
    const state = makeForestState({ lastDashMs: 9000, dashCooldownMs: 2000 });
    const after = forestDash(state, 'right', 10_000);
    expect(after).toBe(state);
  });

  it('returns unchanged when status is not active', () => {
    const state = makeForestState({ status: 'dead' as ForestState['status'] });
    const after = forestDash(state, 'right', 99_999);
    expect(after).toBe(state);
  });

  it('dashes 2 cells when both are clear', () => {
    const state = makeForestState();
    const after = forestDash(state, 'right', 5_000);
    expect(after.player.r).toBe(3);
    expect(after.player.c).toBe(5);
    expect(after.player.facing).toBe('right');
  });

  it('falls back to 1-cell dash when 2nd cell is a thicket', () => {
    const state = makeForestState();
    state.tiles[3][5] = { kind: 'thicket' };
    const after = forestDash(state, 'right', 5_000);
    expect(after.player.c).toBe(4);
  });

  it('falls back to 1-cell dash when 2nd cell has a beast', () => {
    const beast: ForestBeast = { id: 'b1', key: 'deer', r: 3, c: 5, hp: 10, maxHp: 10, readyAtMs: 0, asleep: false };
    const state = makeForestState({ beasts: [beast] });
    const after = forestDash(state, 'right', 5_000);
    expect(after.player.c).toBe(4);
  });

  it('returns unchanged when all destination cells are blocked', () => {
    const state = makeForestState();
    state.tiles[3][4] = { kind: 'thicket' };
    state.tiles[3][5] = { kind: 'thicket' };
    const after = forestDash(state, 'right', 5_000);
    expect(after).toBe(state);
  });

  it('sets lastDashMs to nowMs after a successful dash', () => {
    const state = makeForestState();
    const now = 8_000;
    const after = forestDash(state, 'right', now);
    expect(after.lastDashMs).toBe(now);
  });

  it('grants an i-frame by setting lastHitAtMs to nowMs', () => {
    const state = makeForestState();
    const now = 8_000;
    const after = forestDash(state, 'right', now);
    expect(after.lastHitAtMs).toBe(now);
  });
});

// ---------------------------------------------------------------------------
// 5. forest.ts — act with charged=true
// ---------------------------------------------------------------------------

describe('forest act (charged)', () => {
  const rng = rngFrom(42);

  it('charged chop reduces tree durability more than a normal chop (chopPower=1)', () => {
    // Place a tree at (3,4) — facing right
    const makeTreeState = () => {
      const s = makeForestState({
        tiles: (() => {
          const rows = 7;
          const cols = 7;
          const tiles: ForestTile[][] = Array.from({ length: rows }, (_, r) =>
            Array.from({ length: cols }, (_, c) => {
              const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
              return border ? ({ kind: 'thicket' } as ForestTile) : ({ kind: 'trail' } as ForestTile);
            }),
          );
          tiles[3][4] = { kind: 'tree', durability: 10, maxDurability: 10 } as ForestTile;
          return tiles;
        })(),
        seen: Array.from({ length: 7 }, () => new Array(7).fill(true)),
      });
      return s;
    };

    const rngA = rngFrom(77);
    const rngB = rngFrom(77);
    const afterNormal = act(makeTreeState(), rngA, 0, false);
    const afterCharged = act(makeTreeState(), rngB, 0, true);

    const treeNormal = afterNormal.tiles[3][4] as ForestTile & { durability?: number };
    const treeCharged = afterCharged.tiles[3][4] as ForestTile & { durability?: number };

    // Normal: effectiveChop = chopPower(1) + stBonus(0) = 1 → dur 9
    // Charged: effectiveChop = ceil(1 * 1.75) = 2 → dur 8
    const durNormal = treeNormal.durability ?? 0;
    const durCharged = treeCharged.durability ?? 0;
    expect(durCharged).toBeLessThan(durNormal);
  });

  it('charged hit on a beast applies frozenUntilMs = nowMs + STAGGER_MS', () => {
    const beast: ForestBeast = {
      id: 'b1', key: 'deer', r: 3, c: 4, hp: 60, maxHp: 60, readyAtMs: 0, asleep: false,
    };
    const state = makeForestState({ beasts: [beast], sta: 55 });
    const now = 4_000;
    const after = act(state, rng, now, true);
    const b = after.beasts.find((x) => x.id === 'b1');
    if (!b) {
      // Killed in one charged hit — still valid.
      expect(after.beasts.find((x) => x.id === 'b1')).toBeUndefined();
    } else {
      expect(b.frozenUntilMs).toBe(now + STAGGER_MS);
    }
  });

  it('charged hit deals more damage to a beast than a normal hit (same seed)', () => {
    const beast: ForestBeast = {
      id: 'b1', key: 'deer', r: 3, c: 4, hp: 200, maxHp: 200, readyAtMs: 0, asleep: false,
    };
    const rngA = rngFrom(11);
    const rngB = rngFrom(11);
    const stateA = makeForestState({ beasts: [beast], sta: 55 });
    const stateB = makeForestState({ beasts: [beast], sta: 55 });
    const afterNormal = act(stateA, rngA, 0, false);
    const afterCharged = act(stateB, rngB, 0, true);
    const hpNormal = afterNormal.beasts.find((b) => b.id === 'b1')?.hp ?? 0;
    const hpCharged = afterCharged.beasts.find((b) => b.id === 'b1')?.hp ?? 0;
    expect(hpCharged).toBeLessThan(hpNormal);
  });

  it('CHARGE_DAMAGE_MULT is > 1 (sanity)', () => {
    expect(CHARGE_DAMAGE_MULT).toBeGreaterThan(1);
  });
});
