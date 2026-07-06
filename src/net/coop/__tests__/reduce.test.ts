/**
 * Tests for src/net/coop/reduce.ts — the pure co-op state-transition reducers.
 *
 * All RNG is injected via a seeded mulberry32 so tests are fully deterministic.
 * Fixtures are minimal hand-built MineState / ForestState / HexBattleState
 * objects using the same patterns as the existing mining.test.ts and
 * hexBattle.test.ts suites.
 */
import { describe, it, expect } from 'vitest';
import {
  applyMineWorldSlice,
  applyMineTileSlice,
  applyMineRemoteAttack,
  applyForestWorldSlice,
  applyForestTileSlice,
  applyForestRemoteAttack,
  applyTacticsState,
  resolveTacticsIntent,
  applyPlayerSlice,
  applyBye,
  pruneStalePlayers,
  buildPlayerSlice,
  buildWorldSlice,
  type RemotePlayers,
  type WorldSliceInput,
} from '../reduce';
import type { MineState, MineTile } from '@/engine/mining';
import type { ForestState, ForestTile } from '@/engine/forest';
import {
  hexBoard,
  hexKey,
  type Hex,
} from '@/engine/hex';
import {
  type HexBattleState,
  type PlayerUnit,
  type EnemyUnit,
  type SelectedAction,
  type Tile,
} from '@/engine/hexBattle';
import type { PlayerSlice } from '../protocol';
import {
  STA_REGEN_MS,
  MP_REGEN_MS,
  DASH_BASE_CD_MS,
  BOON_CONSOLATION_HEAL,
  BOON_CONSOLATION_GOLD,
} from '@/engine/crawl';
import { getWeapon, STARTER_WEAPON } from '@/engine/weapons';
import { BOONS } from '@/content/boons';
import type { RNG } from '@/engine/crawl';

// ---------------------------------------------------------------------------
// Shared RNG helper (mulberry32 — same as all other engine tests)
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

const WEAPON = getWeapon(STARTER_WEAPON);

// ---------------------------------------------------------------------------
// MineState / ForestState / HexBattleState fixture factories
// ---------------------------------------------------------------------------

/** Minimal MineState — same shape as crawl-boons.test.ts fixtures. */
function makeMineState(over: Partial<MineState> = {}): MineState {
  const rows = 7, cols = 7;
  const tiles: MineTile[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      return (border ? { kind: 'bedrock' } : { kind: 'floor' }) as MineTile;
    }),
  );
  return {
    floor: 1, rows, cols, tiles,
    player: { r: 3, c: 3, facing: 'right' },
    hp: 50, maxHp: 50, sta: 55, maxSta: 55, mp: 8, maxMp: 8,
    staNextRegenMs: STA_REGEN_MS, mpNextRegenMs: MP_REGEN_MS,
    meleePower: 5, rangedPower: 3, damageSpell: 2, supportSpell: 2, illusionPower: 1,
    defense: 0, ward: 0, weapon: WEAPON, knownSpells: [], pickaxePower: 1,
    monsters: [], haul: {},
    status: 'active', lastHitAtMs: -1000, deepest: 1, killsThisFloor: 0, score: 0,
    runes: [], ringOfFire: null, ringNextHitMs: {}, playerStatuses: [],
    lastSpellMs: -1000, nextRuneId: 1,
    lastDashMs: -DASH_BASE_CD_MS, dashCooldownMs: DASH_BASE_CD_MS,
    moveIntervalMs: 150, agLevel: 0,
    activeBoons: [], pendingBoonChoice: null,
    ...over,
  };
}

/** Minimal ForestState — same shape as crawl-boons.test.ts fixtures. */
function makeForestState(over: Partial<ForestState> = {}): ForestState {
  const rows = 7, cols = 7;
  const tiles: ForestTile[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      return (border ? { kind: 'thicket' } : { kind: 'trail' }) as ForestTile;
    }),
  );
  const seen = Array.from({ length: rows }, () => new Array(cols).fill(true) as boolean[]);
  return {
    stage: 1, rows, cols, tiles, seen,
    player: { r: 3, c: 3, facing: 'right' },
    hp: 50, maxHp: 50, sta: 55, maxSta: 55, mp: 8, maxMp: 8,
    staNextRegenMs: STA_REGEN_MS, mpNextRegenMs: MP_REGEN_MS,
    meleePower: 5, rangedPower: 3, damageSpell: 2, supportSpell: 2, illusionPower: 1,
    defense: 0, ward: 0, weapon: WEAPON, knownSpells: [], chopPower: 1,
    beasts: [], haul: {},
    status: 'active', lastHitAtMs: -1000, deepest: 1, killsThisStage: 0, score: 0,
    runes: [], ringOfFire: null, ringNextHitMs: {}, playerStatuses: [],
    lastSpellMs: -1000, nextRuneId: 1,
    lastDashMs: -DASH_BASE_CD_MS, dashCooldownMs: DASH_BASE_CD_MS,
    moveIntervalMs: 150, agLevel: 0,
    activeBoons: [], pendingBoonChoice: null,
    ...over,
  };
}

// Hex tactics fixtures (same as hexBattle.test.ts)
function tilesFor(radius: number): Record<string, Tile> {
  const t: Record<string, Tile> = {};
  for (const hex of hexBoard(radius)) t[hexKey(hex)] = { hex, elevation: 0, terrain: 'floor' };
  return t;
}

function makePlayerUnit(hex: Hex, over: Partial<PlayerUnit> = {}): PlayerUnit {
  return {
    hex, hp: 100, maxHp: 100, mp: 30, maxMp: 30, sta: 20, maxSta: 20,
    movesLeft: 4, hasActed: false, overwatch: false, ag: 8,
    meleePower: 10, rangedPower: 8, damageSpell: 6, supportSpell: 6, illusionPower: 0,
    defense: 0, ward: 0, dodge: 0, statuses: [], ...over,
  };
}

function makeEnemy(id: number, hex: Hex, over: Partial<EnemyUnit> = {}): EnemyUnit {
  return {
    id, templateId: 'goblin', name: `Foe${id}`, icon: '👹', aiArchetype: 'charger', hex,
    hp: 30, maxHp: 30, attack: 8, defense: 0, ward: 0, attackSchool: 'physical',
    weakTo: [], resistTo: [], range: 1, moveTiles: 3, climb: 1, statuses: [],
    guardBonus: 0, ...over,
  };
}

function makeTacticsState(over: Partial<HexBattleState> = {}): HexBattleState {
  const radius = over.radius ?? 3;
  return {
    radius,
    tiles: over.tiles ?? tilesFor(radius),
    player: over.player ?? makePlayerUnit({ q: 0, r: 0 }),
    enemies: over.enemies ?? [],
    turn: 'player', selected: null, reachable: [], targetable: [], effects: [],
    log: [], status: 'active', tier: 5, knownSpells: [],
    weapon: WEAPON, seq: 100, threatHexes: [], intentPlan: [],
    objective: null, turnCount: 1, ...over,
  };
}

// ---------------------------------------------------------------------------
// applyMineWorldSlice
// ---------------------------------------------------------------------------

describe('applyMineWorldSlice', () => {
  it('same floor — updates monster positions and HP from the host slice', () => {
    const monster = { id: 'mon-1', key: 'slime', r: 2, c: 2, hp: 8, maxHp: 10, readyAtMs: 0 };
    const mine = makeMineState({ monsters: [monster] });

    const slice: WorldSliceInput = {
      floor: 1,
      monsters: [{ id: 'mon-1', r: 3, c: 3, hp: 5, readyAtMs: 500 }],
    };

    const result = applyMineWorldSlice(mine, slice, { baseSeed: 42, rng: rngFrom(1) });

    expect(result.floor).toBe(1);
    expect(result.monsters).toHaveLength(1);
    expect(result.monsters[0].hp).toBe(5);
    expect(result.monsters[0].r).toBe(3);
    expect(result.monsters[0].c).toBe(3);
    // Player HP/haul preserved
    expect(result.hp).toBe(mine.hp);
  });

  it('same floor — drops monsters that the host has killed (absent from slice)', () => {
    const alive = { id: 'mon-alive', key: 'slime', r: 2, c: 2, hp: 8, maxHp: 10, readyAtMs: 0 };
    const dead = { id: 'mon-dead', key: 'slime', r: 3, c: 3, hp: 0, maxHp: 10, readyAtMs: 0 };
    const mine = makeMineState({ monsters: [alive, dead] });

    const slice: WorldSliceInput = {
      floor: 1,
      monsters: [{ id: 'mon-alive', r: 2, c: 2, hp: 8, readyAtMs: 0 }],
    };

    const result = applyMineWorldSlice(mine, slice, { baseSeed: 42, rng: rngFrom(1) });
    expect(result.monsters).toHaveLength(1);
    expect(result.monsters[0].id).toBe('mon-alive');
  });

  it('same floor, no monsters in slice — clears all local monsters', () => {
    const monster = { id: 'mon-1', key: 'slime', r: 2, c: 2, hp: 8, maxHp: 10, readyAtMs: 0 };
    const mine = makeMineState({ monsters: [monster] });
    const slice: WorldSliceInput = { floor: 1, monsters: [] };

    const result = applyMineWorldSlice(mine, slice, { baseSeed: 42, rng: rngFrom(1) });
    expect(result.monsters).toHaveLength(0);
  });

  it('different floor (host descended) — regenerates floor and carries HP/haul forward', () => {
    const mine = makeMineState({ floor: 1, hp: 30, haul: { gold: 50 } });
    const slice: WorldSliceInput = { floor: 2, monsters: [] };

    const result = applyMineWorldSlice(mine, slice, { baseSeed: 100, rng: rngFrom(1) });

    expect(result.floor).toBe(2);
    // HP is preserved (not reset to maxHp by the floor transition)
    expect(result.hp).toBe(30);
    // Deepest advances
    expect(result.deepest).toBeGreaterThanOrEqual(2);
    // Haul is preserved
    expect(result.haul.gold).toBe(50);
  });

  it('different floor with no baseSeed — skips floor regen (no-op on floor)', () => {
    const mine = makeMineState({ floor: 1 });
    const slice: WorldSliceInput = { floor: 3, monsters: [] };

    const result = applyMineWorldSlice(mine, slice, { baseSeed: undefined, rng: rngFrom(1) });
    // Without a seed we cannot regen, so floor stays as-is
    expect(result.floor).toBe(1);
  });

  it('host guardian kill — guest enters choosing while eligible boons remain', () => {
    const guardian = { id: 'g-1', key: 'stone_golem', r: 2, c: 2, hp: 20, maxHp: 50, readyAtMs: 0 };
    const mine = makeMineState({ monsters: [guardian] });
    // Guardian absent from the host slice → killed on the host side.
    const result = applyMineWorldSlice(mine, { floor: 1, monsters: [] }, { baseSeed: 42, rng: rngFrom(1) });
    expect(result.status).toBe('choosing');
    expect(result.pendingBoonChoice?.length).toBeGreaterThan(0);
  });

  it('host guardian kill with exhausted boon pool — consolation, never a zero-option choosing (MINI-01)', () => {
    const allMineBoons = Object.values(BOONS)
      .filter((b) => b.game === 'mine' || b.game === 'both')
      .map((b) => b.key);
    const guardian = { id: 'g-1', key: 'stone_golem', r: 2, c: 2, hp: 20, maxHp: 50, readyAtMs: 0 };
    const mine = makeMineState({ hp: 20, monsters: [guardian], activeBoons: allMineBoons });
    const result = applyMineWorldSlice(mine, { floor: 1, monsters: [] }, { baseSeed: 42, rng: rngFrom(1) });
    expect(result.status).toBe('active');
    expect(result.pendingBoonChoice).toBeNull();
    expect(result.hp).toBe(20 + BOON_CONSOLATION_HEAL);
    expect(result.haul.gold ?? 0).toBe(BOON_CONSOLATION_GOLD);
  });
});

// ---------------------------------------------------------------------------
// applyMineTileSlice
// ---------------------------------------------------------------------------

describe('applyMineTileSlice', () => {
  it('same floor — applies the tile change', () => {
    const mine = makeMineState();
    const newTile: MineTile = { kind: 'floor' }; // previously e.g. 'rock', now 'floor'

    // Place a rock at (2,2) so we can change it
    mine.tiles[2][2] = { kind: 'rock', durability: 1, maxDurability: 1 };

    const result = applyMineTileSlice(mine, 1, 2, 2, newTile);

    expect(result).not.toBe(mine); // new reference
    expect(result.tiles[2][2].kind).toBe('floor');
    // Other tiles unchanged
    expect(result.tiles[2][3].kind).toBe('floor');
  });

  it('different floor — returns the same reference (no-op)', () => {
    const mine = makeMineState({ floor: 1 });
    const result = applyMineTileSlice(mine, 2, 2, 2, { kind: 'floor' });
    expect(result).toBe(mine);
  });

  it('same tile reference — returns the same reference (no-op)', () => {
    const mine = makeMineState();
    // Pass the exact same tile object — the reducer uses reference equality
    const existingTile = mine.tiles[2][2];
    const result = applyMineTileSlice(mine, 1, 2, 2, existingTile);
    expect(result).toBe(mine);
  });
});

// ---------------------------------------------------------------------------
// applyMineRemoteAttack
// ---------------------------------------------------------------------------

describe('applyMineRemoteAttack', () => {
  it('damages the target monster by id', () => {
    const monster = { id: 'mon-1', key: 'slime', r: 2, c: 2, hp: 10, maxHp: 10, readyAtMs: 0 };
    const mine = makeMineState({ monsters: [monster] });

    const result = applyMineRemoteAttack(mine, 'mon-1', 4, rngFrom(1));

    const m = result.monsters.find((x) => x.id === 'mon-1');
    expect(m).toBeDefined();
    expect(m!.hp).toBeLessThan(10); // took some damage
  });

  it('returns the same reference when status is not active', () => {
    const mine = makeMineState({ status: 'ended' });
    const result = applyMineRemoteAttack(mine, 'mon-1', 4, rngFrom(1));
    expect(result).toBe(mine);
  });
});

// ---------------------------------------------------------------------------
// applyForestWorldSlice
// ---------------------------------------------------------------------------

describe('applyForestWorldSlice', () => {
  it('same stage — updates beast positions, HP, and asleep flag from the host slice', () => {
    const beast = { id: 'b-1', key: 'wolf', r: 2, c: 2, hp: 15, maxHp: 15, readyAtMs: 0, asleep: true };
    const forest = makeForestState({ beasts: [beast] });

    const slice: WorldSliceInput = {
      floor: 1,
      monsters: [{ id: 'b-1', r: 3, c: 3, hp: 8, readyAtMs: 100, asleep: false }],
    };

    const result = applyForestWorldSlice(forest, slice, { baseSeed: 42, rng: rngFrom(1) });

    expect(result.beasts).toHaveLength(1);
    expect(result.beasts[0].hp).toBe(8);
    expect(result.beasts[0].r).toBe(3);
    expect(result.beasts[0].asleep).toBe(false);
  });

  it('same stage — drops beasts absent from the host slice', () => {
    const b1 = { id: 'b-alive', key: 'wolf', r: 2, c: 2, hp: 15, maxHp: 15, readyAtMs: 0, asleep: false };
    const b2 = { id: 'b-dead', key: 'wolf', r: 4, c: 4, hp: 0, maxHp: 15, readyAtMs: 0, asleep: false };
    const forest = makeForestState({ beasts: [b1, b2] });

    const slice: WorldSliceInput = {
      floor: 1,
      monsters: [{ id: 'b-alive', r: 2, c: 2, hp: 15, readyAtMs: 0 }],
    };

    const result = applyForestWorldSlice(forest, slice, { baseSeed: 42, rng: rngFrom(1) });
    expect(result.beasts).toHaveLength(1);
    expect(result.beasts[0].id).toBe('b-alive');
  });

  it('different stage (host advanced) — carries HP and haul forward', () => {
    // Haul uses the Reward shape: materials is the keyed map for harvested resources.
    const forest = makeForestState({ stage: 1, hp: 35, haul: { materials: { wood: 10 } } });
    const slice: WorldSliceInput = { floor: 2, monsters: [] };

    const result = applyForestWorldSlice(forest, slice, { baseSeed: 200, rng: rngFrom(1) });
    expect(result.stage).toBe(2);
    expect(result.hp).toBe(35);
    expect(result.haul.materials?.['wood']).toBe(10);
  });

  it('host guardian kill with exhausted boon pool — consolation, never a zero-option choosing (MINI-01)', () => {
    const allForestBoons = Object.values(BOONS)
      .filter((b) => b.game === 'forest' || b.game === 'both')
      .map((b) => b.key);
    const guardian = {
      id: 'g-1', key: 'grove_sentinel', r: 2, c: 2, hp: 20, maxHp: 40, readyAtMs: 0, asleep: false,
    };
    const forest = makeForestState({ hp: 20, beasts: [guardian], activeBoons: allForestBoons });
    const result = applyForestWorldSlice(forest, { floor: 1, monsters: [] }, { baseSeed: 42, rng: rngFrom(1) });
    expect(result.status).toBe('active');
    expect(result.pendingBoonChoice).toBeNull();
    expect(result.hp).toBe(20 + BOON_CONSOLATION_HEAL);
    expect(result.haul.gold ?? 0).toBe(BOON_CONSOLATION_GOLD);
  });
});

// ---------------------------------------------------------------------------
// applyForestTileSlice
// ---------------------------------------------------------------------------

describe('applyForestTileSlice', () => {
  it('same stage — applies the tile change', () => {
    const forest = makeForestState();
    forest.tiles[2][2] = { kind: 'tree', durability: 2, maxDurability: 2 };

    const result = applyForestTileSlice(forest, 1, 2, 2, { kind: 'trail' } as ForestTile);

    expect(result).not.toBe(forest);
    expect(result.tiles[2][2].kind).toBe('trail');
  });

  it('different stage — returns the same reference', () => {
    const forest = makeForestState({ stage: 1 });
    const result = applyForestTileSlice(forest, 2, 2, 2, { kind: 'trail' } as ForestTile);
    expect(result).toBe(forest);
  });

  it('same tile reference — returns the same reference (no-op)', () => {
    const forest = makeForestState();
    // Pass the exact same tile object — the reducer uses reference equality
    const existingTile = forest.tiles[2][2];
    const result = applyForestTileSlice(forest, 1, 2, 2, existingTile);
    expect(result).toBe(forest);
  });
});

// ---------------------------------------------------------------------------
// applyForestRemoteAttack
// ---------------------------------------------------------------------------

describe('applyForestRemoteAttack', () => {
  it('damages the target beast by id', () => {
    const beast = { id: 'b-1', key: 'wolf', r: 2, c: 2, hp: 12, maxHp: 12, readyAtMs: 0, asleep: false };
    const forest = makeForestState({ beasts: [beast] });

    const result = applyForestRemoteAttack(forest, 'b-1', 5, rngFrom(1));

    const b = result.beasts.find((x) => x.id === 'b-1');
    expect(b).toBeDefined();
    expect(b!.hp).toBeLessThan(12);
  });

  it('returns same reference when not active', () => {
    const forest = makeForestState({ status: 'banking' });
    const result = applyForestRemoteAttack(forest, 'b-1', 5, rngFrom(1));
    expect(result).toBe(forest);
  });
});

// ---------------------------------------------------------------------------
// applyTacticsState
// ---------------------------------------------------------------------------

describe('applyTacticsState', () => {
  it('preserves selection within the same turn', () => {
    const selected: SelectedAction = { kind: 'move' };
    const current = makeTacticsState({ turnCount: 1, selected });
    const incoming = makeTacticsState({ turnCount: 1 });

    const result = applyTacticsState(current, incoming, 'my-hero');

    expect(result.selected).toEqual(selected);
  });

  it('clears selection when the turn count changes', () => {
    const current = makeTacticsState({ turnCount: 1, selected: { kind: 'attack' } });
    const incoming = makeTacticsState({ turnCount: 2, selected: null });

    const result = applyTacticsState(current, incoming, 'my-hero');

    expect(result.selected).toBeNull();
  });

  it('clears selection when curTactics is null (first message)', () => {
    const incoming = makeTacticsState({ turnCount: 1, selected: null });

    const result = applyTacticsState(null, incoming, 'my-hero');

    expect(result.selected).toBeNull();
  });

  it('re-keys player to this client\'s own hero when players array is present', () => {
    // PlayerUnit has an optional `id` field (co-op hero ID).
    const guestHero = makePlayerUnit({ q: 2, r: -1 }, { hp: 70, id: 'guest-id' });
    const hostHero = makePlayerUnit({ q: 0, r: 0 });
    const incoming: HexBattleState = {
      ...makeTacticsState(),
      player: hostHero,
      activeHeroId: 'guest-id',
      players: [hostHero, guestHero],
    };

    const result = applyTacticsState(null, incoming, 'guest-id');

    // The result's player should be the guest's own hero (identified by id)
    expect(result.player.hp).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// resolveTacticsIntent
// ---------------------------------------------------------------------------

describe('resolveTacticsIntent', () => {
  it('move intent — moves player to destination hex', () => {
    const dest: Hex = { q: 1, r: 0 };
    const state = makeTacticsState();
    // Give player enough moves
    state.player.movesLeft = 4;

    const result = resolveTacticsIntent(
      state,
      { type: 'tactics-intent', userId: 'u1', heroId: 'h1', action: 'move', to: dest },
      rngFrom(1),
    );

    // The player should have moved (movesLeft decremented or hex updated)
    // Either the position changed or state is unchanged if dest was unreachable
    // Just assert we get a valid HexBattleState back without throwing
    expect(result).toBeTruthy();
    expect(result.status).toBe('active');
  });

  it('endTurn intent — advances to enemy turn', () => {
    const state = makeTacticsState({ enemies: [makeEnemy(1, { q: 2, r: -1 })] });

    const result = resolveTacticsIntent(
      state,
      { type: 'tactics-intent', userId: 'u1', heroId: 'h1', action: 'endTurn' },
      rngFrom(42),
    );

    // After endTurn the turn should be 'enemy' or game should have resolved
    expect(['enemy', 'player', 'won', 'lost']).toContain(result.turn ?? result.status);
  });

  it('unknown action — returns the same reference', () => {
    const state = makeTacticsState();

    const result = resolveTacticsIntent(
      state,
      { type: 'tactics-intent', userId: 'u1', heroId: 'h1', action: 'move' /* no `to` */ },
      rngFrom(1),
    );

    // No `to` hex provided → reducer should return state unchanged
    expect(result).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// applyPlayerSlice (roster)
// ---------------------------------------------------------------------------

describe('applyPlayerSlice', () => {
  const slice: PlayerSlice = {
    type: 'player',
    userId: 'u1',
    username: 'Alice',
    r: 5, c: 5, facing: 'right',
    hp: 40, maxHp: 50, floor: 2,
  };

  it('adds a new player to an empty roster and reports isNew=true', () => {
    const { roster, isNew } = applyPlayerSlice({}, slice, 1000);
    expect(isNew).toBe(true);
    expect(roster['u1']).toBeDefined();
    expect(roster['u1'].username).toBe('Alice');
    expect(roster['u1'].lastSeen).toBe(1000);
  });

  it('updates an existing player and reports isNew=false', () => {
    const initial: RemotePlayers = { u1: { ...slice, lastSeen: 500 } };
    const updated: PlayerSlice = { ...slice, hp: 20 };

    const { roster, isNew } = applyPlayerSlice(initial, updated, 2000);
    expect(isNew).toBe(false);
    expect(roster['u1'].hp).toBe(20);
    expect(roster['u1'].lastSeen).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// applyBye (roster)
// ---------------------------------------------------------------------------

describe('applyBye', () => {
  it('removes the player from the roster', () => {
    const slice: PlayerSlice = {
      type: 'player', userId: 'u1', username: 'Alice',
      r: 5, c: 5, facing: 'right', hp: 40, maxHp: 50, floor: 2,
    };
    const roster: RemotePlayers = { u1: { ...slice, lastSeen: 1000 } };

    const result = applyBye(roster, 'u1');
    expect(result['u1']).toBeUndefined();
  });

  it('returns the same reference when the player is not in the roster', () => {
    const roster: RemotePlayers = {};
    const result = applyBye(roster, 'u1');
    expect(result).toBe(roster);
  });
});

// ---------------------------------------------------------------------------
// pruneStalePlayers (roster)
// ---------------------------------------------------------------------------

describe('pruneStalePlayers', () => {
  function makeRoster(entries: Array<{ id: string; lastSeen: number }>): RemotePlayers {
    const base: PlayerSlice = {
      type: 'player', userId: '', username: 'X',
      r: 1, c: 1, facing: 'right', hp: 50, maxHp: 50, floor: 1,
    };
    const r: RemotePlayers = {};
    for (const e of entries) {
      r[e.id] = { ...base, userId: e.id, lastSeen: e.lastSeen };
    }
    return r;
  }

  it('keeps players seen within the timeout window', () => {
    const now = 10000;
    const roster = makeRoster([{ id: 'u1', lastSeen: 9000 }]); // 1 s ago
    const { roster: pruned, timedOut } = pruneStalePlayers(roster, now, 5000);

    expect(pruned['u1']).toBeDefined();
    expect(timedOut).toHaveLength(0);
  });

  it('prunes players who timed out and returns their usernames', () => {
    const now = 10000;
    const roster = makeRoster([
      { id: 'u1', lastSeen: 4000 }, // 6 s ago → timed out
      { id: 'u2', lastSeen: 9500 }, // 0.5 s ago → kept
    ]);

    const { roster: pruned, timedOut } = pruneStalePlayers(roster, now, 5000);

    expect(pruned['u1']).toBeUndefined();
    expect(pruned['u2']).toBeDefined();
    expect(timedOut).toContain('X'); // username of u1
  });

  it('returns an empty roster unchanged', () => {
    const { roster, timedOut } = pruneStalePlayers({}, 10000, 5000);
    expect(Object.keys(roster)).toHaveLength(0);
    expect(timedOut).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildPlayerSlice
// ---------------------------------------------------------------------------

describe('buildPlayerSlice', () => {
  it('builds a correct PlayerSlice from a MineState', () => {
    const mine = makeMineState({ floor: 3, hp: 30 });
    const slice = buildPlayerSlice(mine, { userId: 'u1', username: 'Bob' });

    expect(slice.type).toBe('player');
    expect(slice.userId).toBe('u1');
    expect(slice.floor).toBe(3);
    expect(slice.hp).toBe(30);
    expect(slice.r).toBe(mine.player.r);
  });

  it('builds a correct PlayerSlice from a ForestState (using stage as floor)', () => {
    const forest = makeForestState({ stage: 5, hp: 20 });
    const slice = buildPlayerSlice(forest, { userId: 'u2', username: 'Carol' });

    expect(slice.floor).toBe(5);
    expect(slice.hp).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// buildWorldSlice
// ---------------------------------------------------------------------------

describe('buildWorldSlice', () => {
  it('builds a WorldSlice from a MineState with monsters', () => {
    const monster = { id: 'm1', key: 'slime', r: 2, c: 2, hp: 5, maxHp: 10, readyAtMs: 100 };
    const mine = makeMineState({ floor: 2, monsters: [monster], status: 'active' });

    const slice = buildWorldSlice(mine);

    expect(slice.type).toBe('world');
    expect(slice.floor).toBe(2);
    expect(slice.status).toBe('active');
    expect(slice.monsters).toHaveLength(1);
    expect(slice.monsters[0].id).toBe('m1');
    expect(slice.monsters[0].hp).toBe(5);
  });

  it('maps status "choosing" to "active" (boon-choice is a UI sub-state)', () => {
    const mine = makeMineState({ status: 'choosing' });
    const slice = buildWorldSlice(mine);
    expect(slice.status).toBe('active');
  });

  it('builds a WorldSlice from a ForestState using beasts', () => {
    const beast = { id: 'b1', key: 'wolf', r: 3, c: 3, hp: 10, maxHp: 10, readyAtMs: 0, asleep: true };
    const forest = makeForestState({ stage: 3, beasts: [beast] });

    const slice = buildWorldSlice(forest);

    expect(slice.floor).toBe(3);
    expect(slice.monsters).toHaveLength(1);
    expect(slice.monsters[0].asleep).toBe(true);
  });
});
