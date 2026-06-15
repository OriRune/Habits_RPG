import { describe, it, expect } from 'vitest';
import {
  generateMine,
  descend,
  tryMove,
  strike,
  stepMonsters,
  oreYield,
  isWalkable,
  type MineState,
  type MineTile,
  type MineSnapshot,
  type RNG,
  MINE_ROWS,
  MINE_COLS,
} from '../mining';
import { MINE_ORES } from '@/content/mining';

const SNAP: MineSnapshot = { meleePower: 5, maxHp: 50, maxSta: 10 };

/** Deterministic RNG (mulberry32) for repeatable generation. */
function rngFrom(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small hand-built cavern: bedrock border, interior floor, player centred. */
function makeState(over: Partial<MineState> = {}): MineState {
  const rows = 5;
  const cols = 5;
  const tiles: MineTile[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: MineTile[] = [];
    for (let c = 0; c < cols; c++) {
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      row.push(border ? { kind: 'bedrock' } : { kind: 'floor' });
    }
    tiles.push(row);
  }
  return {
    floor: 1,
    rows,
    cols,
    tiles,
    player: { r: 2, c: 2, facing: 'right' },
    hp: 50,
    maxHp: 50,
    sta: 10,
    maxSta: 10,
    meleePower: 5,
    monsters: [],
    haul: {},
    status: 'active',
    lastHitAtMs: -1000,
    deepest: 1,
    ...over,
  };
}

describe('generateMine', () => {
  const mine = generateMine(1, SNAP, rngFrom(42));

  it('is the configured size with a solid bedrock border', () => {
    expect(mine.rows).toBe(MINE_ROWS);
    expect(mine.cols).toBe(MINE_COLS);
    for (let c = 0; c < mine.cols; c++) {
      expect(mine.tiles[0][c].kind).toBe('bedrock');
      expect(mine.tiles[mine.rows - 1][c].kind).toBe('bedrock');
    }
    for (let r = 0; r < mine.rows; r++) {
      expect(mine.tiles[r][0].kind).toBe('bedrock');
      expect(mine.tiles[r][mine.cols - 1].kind).toBe('bedrock');
    }
  });

  it('carves exactly one entrance and one shaft, and spawns the player on the entrance', () => {
    const counts = mine.tiles.flat().reduce<Record<string, number>>((acc, t) => {
      acc[t.kind] = (acc[t.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.entrance).toBe(1);
    expect(counts.shaft).toBe(1);
    expect(mine.tiles[mine.player.r][mine.player.c].kind).toBe('entrance');
    expect(mine.hp).toBe(SNAP.maxHp);
    expect(mine.sta).toBe(SNAP.maxSta);
  });

  it('only places ore veins eligible for the floor', () => {
    const shallow = generateMine(1, SNAP, rngFrom(7));
    for (const tile of shallow.tiles.flat()) {
      if (tile.kind === 'ore' && tile.oreKey) {
        expect(MINE_ORES[tile.oreKey].floorMin).toBeLessThanOrEqual(1);
      }
    }
    // Iron/gold/crystal/gemstone are gated deeper, so never appear on floor 1.
    const keys = shallow.tiles.flat().map((t) => t.oreKey).filter(Boolean);
    expect(keys).not.toContain('iron_vein');
    expect(keys).not.toContain('crystal_node');
  });
});

describe('tryMove', () => {
  it('steps onto a walkable cell', () => {
    const s = tryMove(makeState(), 'right');
    expect(s.player).toMatchObject({ r: 2, c: 3, facing: 'right' });
  });

  it('turns but does not move when blocked by bedrock', () => {
    const s = tryMove(makeState({ player: { r: 1, c: 1, facing: 'right' } }), 'up');
    expect(s.player).toMatchObject({ r: 1, c: 1, facing: 'up' }); // (0,1) is bedrock
  });

  it('does not walk into a monster', () => {
    const s = tryMove(
      makeState({ monsters: [{ id: 'a', key: 'cave_slug', r: 2, c: 3, hp: 6, maxHp: 6, readyAtMs: 0 }] }),
      'right',
    );
    expect(s.player).toMatchObject({ r: 2, c: 2, facing: 'right' });
  });
});

describe('strike', () => {
  it('chips a rock over multiple swings before breaking it open', () => {
    const tiles = makeState().tiles;
    tiles[2][3] = { kind: 'rock', durability: 2 };
    let s = makeState({ tiles });
    s = strike(s, rngFrom(1));
    expect(s.tiles[2][3]).toMatchObject({ kind: 'rock', durability: 1 });
    expect(s.sta).toBe(9);
    s = strike(s, rngFrom(1));
    expect(s.tiles[2][3].kind).toBe('floor');
  });

  it('drops ore loot exactly once when the vein breaks', () => {
    const tiles = makeState().tiles;
    tiles[2][3] = { kind: 'ore', oreKey: 'rubble', durability: 1 };
    let s = makeState({ tiles });
    s = strike(s, rngFrom(3));
    expect(s.tiles[2][3].kind).toBe('floor');
    const gold = s.haul.gold ?? 0;
    expect(gold).toBeGreaterThan(0);
    // Swinging at the now-empty floor yields nothing more.
    const after = strike(s, rngFrom(3));
    expect(after.haul.gold ?? 0).toBe(gold);
  });

  it('damages a faced monster and banks its bounty on death', () => {
    const s = makeState({
      meleePower: 10,
      monsters: [{ id: 'a', key: 'cave_slug', r: 2, c: 3, hp: 6, maxHp: 6, readyAtMs: 0 }],
    });
    const after = strike(s, rngFrom(5));
    expect(after.monsters).toHaveLength(0);
    expect(after.haul.gold ?? 0).toBeGreaterThan(0);
  });

  it('cannot swing with no stamina', () => {
    const tiles = makeState().tiles;
    tiles[2][3] = { kind: 'rock', durability: 2 };
    const s = makeState({ tiles, sta: 0 });
    expect(strike(s, rngFrom(1))).toBe(s);
  });
});

describe('stepMonsters', () => {
  it('moves a monster one cell toward the player', () => {
    const s = makeState({ monsters: [{ id: 'a', key: 'cave_slug', r: 2, c: 4, hp: 6, maxHp: 6, readyAtMs: 0 }] });
    // (2,4) is bedrock border in the 5x5; use (1,3) instead — interior, two away.
    const s2 = makeState({ monsters: [{ id: 'a', key: 'cave_slug', r: 1, c: 3, hp: 6, maxHp: 6, readyAtMs: 0 }] });
    const after = stepMonsters(s2, 1000, rngFrom(1));
    const m = after.monsters[0];
    expect(Math.abs(m.r - 2) + Math.abs(m.c - 2)).toBeLessThan(Math.abs(1 - 2) + Math.abs(3 - 2));
    void s;
  });

  it('applies contact damage once per i-frame window', () => {
    const s = makeState({
      hp: 50,
      lastHitAtMs: -1000,
      monsters: [{ id: 'a', key: 'cave_slug', r: 2, c: 3, hp: 6, maxHp: 6, readyAtMs: 999999 }],
    });
    const hit = stepMonsters(s, 1000, rngFrom(1)); // cave_slug touchDamage = 4
    expect(hit.hp).toBe(46);
    const again = stepMonsters(hit, 1100, rngFrom(1)); // within the 800ms window
    expect(again.hp).toBe(46);
  });

  it('ends the run when HP reaches zero', () => {
    const s = makeState({
      hp: 3,
      lastHitAtMs: -1000,
      monsters: [{ id: 'a', key: 'cave_slug', r: 2, c: 3, hp: 6, maxHp: 6, readyAtMs: 999999 }],
    });
    const after = stepMonsters(s, 1000, rngFrom(1));
    expect(after.hp).toBe(0);
    expect(after.status).toBe('ended');
  });
});

describe('descend', () => {
  it('drops to the next floor, carrying HP and haul and refilling stamina', () => {
    const tiles = makeState().tiles;
    tiles[2][2] = { kind: 'shaft' };
    const s = makeState({ tiles, floor: 1, hp: 20, sta: 2, haul: { gold: 15 }, deepest: 1 });
    const next = descend(s, rngFrom(9));
    expect(next.floor).toBe(2);
    expect(next.deepest).toBe(2);
    expect(next.hp).toBe(20);
    expect(next.sta).toBe(next.maxSta);
    expect(next.haul.gold).toBe(15);
  });

  it('refuses to descend when not standing on a shaft', () => {
    const s = makeState({ floor: 1 });
    expect(descend(s, rngFrom(9))).toBe(s);
  });
});

describe('oreYield', () => {
  it('produces a reward within the ore definition bounds', () => {
    const reward = oreYield('bronze_vein', rngFrom(2));
    const amt = reward.materials?.bronze_bar ?? 0;
    expect(amt).toBeGreaterThanOrEqual(1);
    expect(amt).toBeLessThanOrEqual(2);
  });
});

describe('isWalkable', () => {
  it('treats floor/entrance/shaft as walkable and rock/bedrock as solid', () => {
    expect(isWalkable({ kind: 'floor' })).toBe(true);
    expect(isWalkable({ kind: 'shaft' })).toBe(true);
    expect(isWalkable({ kind: 'rock' })).toBe(false);
    expect(isWalkable({ kind: 'bedrock' })).toBe(false);
    expect(isWalkable(undefined)).toBe(false);
  });
});
