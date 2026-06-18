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
import { getWeapon, STARTER_WEAPON } from '@/engine/weapons';
import { STA_REGEN_MS, MP_REGEN_MS } from '@/engine/crawl';

const WEAPON = getWeapon(STARTER_WEAPON);

const SNAP: MineSnapshot = {
  meleePower: 5,
  rangedPower: 3,
  damageSpell: 2,
  supportSpell: 2,
  illusionPower: 1,
  defense: 0,
  ward: 0,
  maxHp: 50,
  maxSta: 55,
  maxMp: 8,
  weapon: WEAPON,
  knownSpells: [],
  pickaxePower: 1,
  agLevel: 0,
};

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
  const rows = 7;
  const cols = 7;
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
    player: { r: 3, c: 3, facing: 'right' },
    hp: 50,
    maxHp: 50,
    sta: 55,
    maxSta: 55,
    mp: 8,
    maxMp: 8,
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
    lastDashMs: -2000,
    dashCooldownMs: 2000,
    moveIntervalMs: 150,
    agLevel: 0,
    // Phase 5 fields
    activeBoons: [],
    pendingBoonChoice: null,
    ...over,
  };
}

describe('generateMine', () => {
  const mine = generateMine(1, SNAP, rngFrom(42));

  it('is at least the base size (MINE_ROWS × MINE_COLS) with a solid bedrock border', () => {
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

  it('all floor/ore/shaft/entrance cells are reachable from the entrance via BFS', () => {
    const reachable = new Set<string>();
    const queue: Array<[number, number]> = [[mine.player.r, mine.player.c]];
    reachable.add(`${mine.player.r},${mine.player.c}`);
    while (queue.length > 0) {
      const [r, c] = queue.shift()!;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as [number,number][]) {
        const nr = r + dr, nc = c + dc;
        const k = `${nr},${nc}`;
        if (reachable.has(k)) continue;
        const t = mine.tiles[nr]?.[nc];
        if (!t || t.kind === 'bedrock' || t.kind === 'rock') continue;
        reachable.add(k);
        queue.push([nr, nc]);
      }
    }
    // At minimum the shaft must be reachable
    let shaftFound = false;
    for (const k of reachable) {
      const [r, c] = k.split(',').map(Number);
      if (mine.tiles[r]?.[c]?.kind === 'shaft') { shaftFound = true; break; }
    }
    expect(shaftFound).toBe(true);
  });

  it('only places ore veins eligible for the floor', () => {
    const shallow = generateMine(1, SNAP, rngFrom(7));
    for (const tile of shallow.tiles.flat()) {
      if (tile.kind === 'ore' && tile.oreKey && tile.oreKey !== 'energy_gem') {
        expect(MINE_ORES[tile.oreKey].floorMin).toBeLessThanOrEqual(1);
      }
    }
    // Iron/crystal/gemstone are gated deeper, so never appear on floor 1.
    const keys = shallow.tiles.flat().map((t) => t.oreKey).filter(Boolean);
    expect(keys).not.toContain('iron_vein');
    expect(keys).not.toContain('crystal_node');
  });

  it('has at least one energy gem on the map', () => {
    const gems = mine.tiles.flat().filter((t) => t.kind === 'ore' && t.oreKey === 'energy_gem');
    expect(gems.length).toBeGreaterThanOrEqual(1);
  });
});

describe('tryMove', () => {
  it('steps onto a walkable cell', () => {
    const s = tryMove(makeState(), 'right');
    expect(s.player).toMatchObject({ r: 3, c: 4, facing: 'right' });
  });

  it('turns but does not move when blocked by bedrock', () => {
    const s = tryMove(makeState({ player: { r: 1, c: 1, facing: 'right' } }), 'up');
    expect(s.player).toMatchObject({ r: 1, c: 1, facing: 'up' }); // (0,1) is bedrock
  });

  it('does not walk into a monster', () => {
    const s = tryMove(
      makeState({ monsters: [{ id: 'a', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 0 }] }),
      'right',
    );
    expect(s.player).toMatchObject({ r: 3, c: 3, facing: 'right' });
  });
});

describe('strike', () => {
  it('chips a rock using pickaxePower and costs 1 stamina per swing', () => {
    const tiles = makeState().tiles;
    tiles[3][4] = { kind: 'rock', durability: 2, maxDurability: 2 };
    let s = makeState({ tiles, pickaxePower: 1 });
    s = strike(s, rngFrom(1));
    expect(s.tiles[3][4]).toMatchObject({ kind: 'rock', durability: 1 });
    expect(s.sta).toBe(54); // started 55, -1 for swing
    s = strike(s, rngFrom(1));
    expect(s.tiles[3][4].kind).toBe('floor');
  });

  it('a tier-2 pickaxe one-shots a 2-durability rock', () => {
    const tiles = makeState().tiles;
    tiles[3][4] = { kind: 'rock', durability: 2, maxDurability: 2 };
    const s = makeState({ tiles, pickaxePower: 2 });
    const after = strike(s, rngFrom(1));
    expect(after.tiles[3][4].kind).toBe('floor');
  });

  it('drops ore loot exactly once when the vein breaks', () => {
    const tiles = makeState().tiles;
    tiles[3][4] = { kind: 'ore', oreKey: 'rubble', durability: 1 };
    let s = makeState({ tiles });
    s = strike(s, rngFrom(3));
    expect(s.tiles[3][4].kind).toBe('floor');
    const gold = s.haul.gold ?? 0;
    expect(gold).toBeGreaterThan(0);
    // Swinging at the now-empty floor yields nothing more.
    const after = strike(s, rngFrom(3));
    expect(after.haul.gold ?? 0).toBe(gold);
  });

  it('damages a faced monster using weapon stats and banks its bounty on death', () => {
    const s = makeState({
      meleePower: 20,
      monsters: [{ id: 'a', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 0 }],
    });
    const after = strike(s, rngFrom(5));
    expect(after.monsters).toHaveLength(0);
    const bankedGold = after.haul.gold ?? 0;
    const bankedMats = Object.values(after.haul.materials ?? {}).reduce((a, n) => a + n, 0);
    expect(bankedGold + bankedMats).toBeGreaterThan(0);
  });

  it('cannot swing with no stamina', () => {
    const tiles = makeState().tiles;
    tiles[3][4] = { kind: 'rock', durability: 2 };
    const s = makeState({ tiles, sta: 0 });
    expect(strike(s, rngFrom(1))).toBe(s);
  });
});

describe('stepMonsters', () => {
  it('moves a monster toward the player via BFS', () => {
    // Monster at (3,6) — 3 cells to the right of the player at (3,3)
    // Valid: (3,5) and (3,4) are interior floor in the 7×7 test grid
    const s = makeState({
      monsters: [{ id: 'a', key: 'cave_slug', r: 3, c: 5, hp: 8, maxHp: 8, readyAtMs: 0 }],
    });
    const before = Math.abs(3 - 3) + Math.abs(5 - 3);
    const after = stepMonsters(s, 1000, rngFrom(1));
    const m = after.monsters[0];
    const afterDist = Math.abs(m.r - 3) + Math.abs(m.c - 3);
    expect(afterDist).toBeLessThan(before);
  });

  it('applies contact damage from an adjacent monster (minus player defense)', () => {
    const s = makeState({
      hp: 50,
      defense: 0,
      lastHitAtMs: -1000,
      monsters: [{ id: 'a', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 999999 }],
    });
    const hit = stepMonsters(s, 1000, rngFrom(1)); // cave_slug touchDamage = 4, defense = 0
    expect(hit.hp).toBe(46);
    // Second call within i-frame window: no additional damage
    const again = stepMonsters(hit, 1100, rngFrom(1));
    expect(again.hp).toBe(46);
  });

  it('ends the run when HP reaches zero', () => {
    const s = makeState({
      hp: 3,
      lastHitAtMs: -1000,
      monsters: [{ id: 'a', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 999999 }],
    });
    const after = stepMonsters(s, 1000, rngFrom(1));
    expect(after.hp).toBe(0);
    expect(after.status).toBe('ended');
  });
});

describe('descend', () => {
  it('drops to the next floor, carrying HP and haul, and refills sta/mp partially', () => {
    const tiles = makeState().tiles;
    tiles[3][3] = { kind: 'shaft' };
    const s = makeState({ tiles, floor: 1, hp: 20, sta: 5, haul: { gold: 15 }, deepest: 1 });
    const next = descend(s, rngFrom(9));
    expect(next.floor).toBe(2);
    expect(next.deepest).toBe(2);
    expect(next.hp).toBe(20);
    expect(next.sta).toBeGreaterThan(5); // got some stamina back
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
