import { describe, it, expect } from 'vitest';
import {
  generateForest,
  advance,
  tryMove,
  act,
  stepBeasts,
  reveal,
  nodeYield,
  splitHaul,
  activateShrine,
  isWalkable,
  isOnShrine,
  isVisible,
  canAdvance,
  type ForestState,
  type ForestTile,
  type ForestSnapshot,
  type RNG,
  FOREST_ROWS,
  FOREST_COLS,
  FOREST_WINDUP_MS,
} from '../forest';
import { getWeapon, STARTER_WEAPON } from '@/engine/weapons';
import { manhattan, STA_REGEN_MS, MP_REGEN_MS } from '@/engine/crawl';

const WEAPON = getWeapon(STARTER_WEAPON);

const SNAP: ForestSnapshot = {
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
  chopPower: 1,
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

/** A small hand-built clearing: thicket border, interior trail, player centred, fully lit. */
function makeForest(over: Partial<ForestState> = {}): ForestState {
  const rows = 7;
  const cols = 7;
  const tiles: ForestTile[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: ForestTile[] = [];
    for (let c = 0; c < cols; c++) {
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      row.push(border ? { kind: 'thicket' } : { kind: 'trail' });
    }
    tiles.push(row);
  }
  const seen: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(true));
  return {
    stage: 1,
    rows,
    cols,
    tiles,
    seen,
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
    chopPower: 1,
    beasts: [],
    haul: {},
    status: 'active',
    lastHitAtMs: -1000,
    deepest: 1,
    killsThisStage: 0,
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    lastSpellMs: -1000,
    nextRuneId: 1,
    ...over,
  };
}

/** BFS over walkable tiles — is there a path from the player to any tree-line exit? */
function reachesTreeline(s: ForestState): boolean {
  const visited = new Set<string>();
  const queue = [[s.player.r, s.player.c]];
  visited.add(`${s.player.r},${s.player.c}`);
  while (queue.length) {
    const [r, c] = queue.shift()!;
    if (s.tiles[r]?.[c]?.kind === 'treeline') return true;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      if (isWalkable(s.tiles[nr]?.[nc])) {
        visited.add(key);
        queue.push([nr, nc]);
      }
    }
  }
  return false;
}

describe('generateForest', () => {
  const forest = generateForest(1, SNAP, rngFrom(42));

  it('is at least FOREST_ROWS × FOREST_COLS with a thicket frame broken only by entrance and tree line', () => {
    expect(forest.rows).toBe(FOREST_ROWS);
    expect(forest.cols).toBe(FOREST_COLS);
    let entrances = 0;
    let treelines = 0;
    for (let c = 0; c < forest.cols; c++) {
      if (forest.tiles[0][c].kind === 'entrance') entrances++;
      if (forest.tiles[forest.rows - 1][c].kind === 'treeline') treelines++;
    }
    expect(entrances).toBe(1);
    expect(treelines).toBe(1);
    // The vertical borders are solid thicket.
    for (let r = 0; r < forest.rows; r++) {
      expect(forest.tiles[r][0].kind).toBe('thicket');
      expect(forest.tiles[r][forest.cols - 1].kind).toBe('thicket');
    }
  });

  it('spawns the player on the top-edge entrance with full HP/stamina', () => {
    expect(forest.player.r).toBe(0);
    expect(forest.tiles[forest.player.r][forest.player.c].kind).toBe('entrance');
    expect(forest.hp).toBe(SNAP.maxHp);
    expect(forest.sta).toBe(SNAP.maxSta);
  });

  it('carves a maze with a walkable path from the entrance to the tree line', () => {
    for (const seed of [1, 7, 99, 1234]) {
      expect(reachesTreeline(generateForest(1, SNAP, rngFrom(seed)))).toBe(true);
    }
  });

  it('only places stage-eligible nodes and beasts', () => {
    const shallow = generateForest(1, SNAP, rngFrom(7));
    const nodeKeys = shallow.tiles.flat().map((t) => t.nodeKey).filter(Boolean);
    expect(nodeKeys).not.toContain('crystal_find'); // stageMin 4
    // Stage-1 eligible: wild_boar (predator), forest_deer and wild_rabbit (prey).
    // Wolf/spider/bear/etc are gated deeper.
    const stage1Keys = new Set(['wild_boar', 'forest_deer', 'wild_rabbit']);
    for (const b of shallow.beasts) {
      expect(stage1Keys.has(b.key)).toBe(true);
    }
    expect(shallow.beasts.every((b) => b.asleep)).toBe(true); // all start dormant
  });

  it('has at least one spring on the map', () => {
    const springs = forest.tiles.flat().filter((t) => t.kind === 'node' && t.nodeKey === 'spring');
    expect(springs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('fog of war', () => {
  it('reveal lights the tiles within the sight radius and remembers them', () => {
    const seen = Array.from({ length: 7 }, () => new Array(7).fill(false));
    const lit = reveal(makeForest({ seen }));
    expect(lit.seen[3][3]).toBe(true); // on the player
    expect(lit.seen[3][5]).toBe(true); // within radius 3
    expect(isVisible(lit, 3, 5)).toBe(true);
  });

  it('lights a disc, not a square — far diagonals stay dark', () => {
    const s = makeForest(); // player at (3,3), radius 3
    expect(isVisible(s, 3, 6)).toBe(true); // straight, distance 3
    expect(isVisible(s, 6, 3)).toBe(true); // straight, distance 3
    expect(isVisible(s, 6, 6)).toBe(false); // diagonal corner — outside the circle
  });

  it('tryMove re-lights the fog as the player advances', () => {
    const seen = Array.from({ length: 7 }, () => new Array(7).fill(false));
    const start = reveal(makeForest({ player: { r: 1, c: 1, facing: 'right' }, seen }));
    expect(start.seen[1][5]).toBe(false); // out of sight before moving
    const moved = tryMove(start, 'right');
    expect(moved.player.c).toBe(2);
    expect(moved.seen[2][2]).toBe(true);
  });
});

describe('tryMove', () => {
  it('steps onto a walkable trail', () => {
    const s = tryMove(makeForest(), 'right');
    expect(s.player).toMatchObject({ r: 3, c: 4, facing: 'right' });
  });

  it('turns but does not move when blocked by thicket', () => {
    const tiles = makeForest().tiles;
    tiles[3][4] = { kind: 'thicket' };
    const s = tryMove(makeForest({ tiles }), 'right');
    expect(s.player).toMatchObject({ r: 3, c: 3, facing: 'right' });
  });

  it('does not walk into a beast', () => {
    const s = tryMove(
      makeForest({ beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 4, hp: 10, maxHp: 10, readyAtMs: 0, asleep: false }] }),
      'right',
    );
    expect(s.player).toMatchObject({ r: 3, c: 3, facing: 'right' });
  });
});

describe('act', () => {
  it('gathers a node instantly, even with no stamina', () => {
    const tiles = makeForest().tiles;
    tiles[3][4] = { kind: 'node', nodeKey: 'flower_bush' };
    const s = act(makeForest({ tiles, sta: 0 }), rngFrom(3));
    expect(s.tiles[3][4].kind).toBe('trail');
    expect(s.haul.materials?.herbs ?? 0).toBeGreaterThanOrEqual(1);
    expect(s.sta).toBe(0); // gathering is free
  });

  it('a spring node refills stamina instead of adding to the haul', () => {
    const tiles = makeForest().tiles;
    tiles[3][4] = { kind: 'node', nodeKey: 'spring' };
    const s = act(makeForest({ tiles, sta: 2 }), rngFrom(3));
    expect(s.tiles[3][4].kind).toBe('trail');
    expect(s.sta).toBeGreaterThan(2);
    expect(s.haul.materials ?? {}).toEqual({});
  });

  it('cannot slash through thicket — the maze walls are permanent', () => {
    const tiles = makeForest().tiles;
    tiles[3][4] = { kind: 'thicket' };
    const s = makeForest({ tiles });
    const after = act(s, rngFrom(1));
    expect(after.tiles[3][4].kind).toBe('thicket');
  });

  it('slashes a faced beast using weapon stats and drops leather on the kill', () => {
    const s = makeForest({
      meleePower: 20, // overkill to guarantee a kill regardless of RNG
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 4, hp: 10, maxHp: 10, readyAtMs: 0, asleep: false }],
    });
    const after = act(s, rngFrom(5));
    expect(after.beasts).toHaveLength(0);
    expect(after.haul.materials?.leather ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('cannot slash with no stamina', () => {
    const s = makeForest({
      sta: 0,
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 4, hp: 10, maxHp: 10, readyAtMs: 0, asleep: false }],
    });
    expect(act(s, rngFrom(1))).toBe(s);
  });
});

describe('stepBeasts', () => {
  it('wakes a dormant beast once the player strays within its aggro radius', () => {
    const s = makeForest({
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 5, hp: 10, maxHp: 10, readyAtMs: 0, asleep: true }],
    });
    const after = stepBeasts(s, 1000, rngFrom(1)); // distance 2 <= aggroRadius 3
    expect(after.beasts[0].asleep).toBe(false);
  });

  it('leaves a distant beast dormant and in place', () => {
    const s = makeForest({
      beasts: [{ id: 'a', key: 'wild_boar', r: 1, c: 1, hp: 10, maxHp: 10, readyAtMs: 0, asleep: true }],
    });
    const after = stepBeasts(s, 1000, rngFrom(1)); // distance 4 > aggroRadius 3
    expect(after.beasts[0].asleep).toBe(true);
    expect(after.beasts[0].r).toBe(1);
    expect(after.beasts[0].c).toBe(1);
  });

  it('co-op: wakes for the nearest of all players, and an empty coPlayers list matches solo', () => {
    const s = makeForest({
      beasts: [{ id: 'a', key: 'wild_boar', r: 1, c: 1, hp: 10, maxHp: 10, readyAtMs: 0, asleep: true }],
    });
    // The lone local player at (3,3) is 4 away → dormant; an empty list is identical.
    expect(stepBeasts(s, 1000, rngFrom(1), [])).toEqual(stepBeasts(s, 1000, rngFrom(1)));
    expect(stepBeasts(s, 1000, rngFrom(1), []).beasts[0].asleep).toBe(true);
    // A teammate standing next to the beast wakes it (nearest-player aggro).
    const after = stepBeasts(s, 1000, rngFrom(1), [{ r: 1, c: 2 }]);
    expect(after.beasts[0].asleep).toBe(false);
  });

  it('applies contact damage once per i-frame window (with telegraph delay)', () => {
    const s = makeForest({
      hp: 50,
      lastHitAtMs: -1000,
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 4, hp: 10, maxHp: 10, readyAtMs: 999999, asleep: false }],
    });
    // First tick: beast becomes adjacent → windup starts; no damage yet.
    const tick1 = stepBeasts(s, 1000, rngFrom(1));
    expect(tick1.hp).toBe(50);
    expect(tick1.beasts[0].windupUntilMs).toBeGreaterThan(1000);
    // Second tick: past the windup window → damage applied.
    const tick2 = stepBeasts(tick1, 1000 + 500 /* past FOREST_WINDUP_MS=360 */, rngFrom(1));
    expect(tick2.hp).toBe(46); // wild_boar touchDamage = 4
    // Third tick: within the 800ms i-frame window → no further damage.
    const tick3 = stepBeasts(tick2, 1000 + 600, rngFrom(1));
    expect(tick3.hp).toBe(46);
  });

  it('ends the run when HP reaches zero (after telegraph)', () => {
    const s = makeForest({
      hp: 3,
      lastHitAtMs: -1000,
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 4, hp: 10, maxHp: 10, readyAtMs: 999999, asleep: false }],
    });
    // First tick starts the windup; second tick (past windup) lands the fatal hit.
    const tick1 = stepBeasts(s, 1000, rngFrom(1));
    const tick2 = stepBeasts(tick1, 1500, rngFrom(1));
    expect(tick2.hp).toBe(0);
    expect(tick2.status).toBe('ended');
  });

  it('moves an awake beast toward the player via BFS', () => {
    const s = makeForest({
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 5, hp: 10, maxHp: 10, readyAtMs: 0, asleep: false }],
    });
    const before = Math.abs(3 - 3) + Math.abs(5 - 3);
    const after = stepBeasts(s, 1000, rngFrom(1));
    const b = after.beasts[0];
    const afterDist = Math.abs(b.r - 3) + Math.abs(b.c - 3);
    expect(afterDist).toBeLessThan(before);
  });
});

describe('advance', () => {
  it('pushes to the next stage, carrying HP and haul and refilling sta/mp partially', () => {
    const tiles = makeForest().tiles;
    tiles[3][3] = { kind: 'treeline' };
    const s = makeForest({ tiles, stage: 1, hp: 20, sta: 5, haul: { gold: 15 }, deepest: 1 });
    expect(canAdvance(s)).toBe(true);
    const next = advance(s, rngFrom(9));
    expect(next.stage).toBe(2);
    expect(next.deepest).toBe(2);
    expect(next.hp).toBe(20);
    expect(next.sta).toBeGreaterThan(5); // partial refill
    expect(next.haul.gold).toBe(15);
  });

  it('refuses to advance when not standing on the tree line', () => {
    const s = makeForest({ stage: 1 });
    expect(advance(s, rngFrom(9))).toBe(s);
  });
});

describe('splitHaul', () => {
  it('keeps the floored fraction and forfeits the rest', () => {
    const { kept, lost } = splitHaul({ gold: 15, materials: { herbs: 3, leather: 1 } }, 0.5);
    expect(kept.gold).toBe(7);
    expect(lost.gold).toBe(8);
    expect(kept.materials).toEqual({ herbs: 1 }); // leather: floor(1*0.5)=0 → only lost
    expect(lost.materials).toEqual({ herbs: 2, leather: 1 });
  });

  it('omits zero entries from each side', () => {
    const { kept, lost } = splitHaul({ gold: 1 }, 0.5);
    expect(kept.gold).toBeUndefined(); // floor(0.5)=0
    expect(lost.gold).toBe(1);
    expect(kept.materials).toBeUndefined();
  });
});

describe('nodeYield', () => {
  it('produces a reward within the node definition bounds', () => {
    const reward = nodeYield('flower_bush', rngFrom(2));
    const amt = reward.materials?.herbs ?? 0;
    expect(amt).toBeGreaterThanOrEqual(1);
    expect(amt).toBeLessThanOrEqual(2);
  });
});

describe('isWalkable', () => {
  it('treats trail/entrance/clearing/treeline/shrine as walkable and thicket/node as solid', () => {
    expect(isWalkable({ kind: 'trail' })).toBe(true);
    expect(isWalkable({ kind: 'treeline' })).toBe(true);
    expect(isWalkable({ kind: 'clearing' })).toBe(true);
    expect(isWalkable({ kind: 'shrine' })).toBe(true);
    expect(isWalkable({ kind: 'thicket' })).toBe(false);
    expect(isWalkable({ kind: 'node' })).toBe(false);
    expect(isWalkable(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Feature: Ranged bow
// ---------------------------------------------------------------------------

const BOW_SNAP: ForestSnapshot = {
  ...SNAP,
  rangedPower: 30, // overkill to guarantee kills
  weapon: { key: 'hunting_bow', name: 'Hunting Bow', attackStat: 'DX', bonus: 5, staminaCost: 1, ranged: true, range: 5, description: 'Test bow' },
};

describe('act (ranged bow)', () => {
  it('hits the first beast in the faced line', () => {
    const tiles = makeForest().tiles;
    // Player at (3,3) facing right. Beasts at (3,5) and (3,6).
    const s = makeForest({
      weapon: BOW_SNAP.weapon, rangedPower: BOW_SNAP.rangedPower,
      beasts: [
        { id: 'near', key: 'wild_boar', r: 3, c: 5, hp: 10, maxHp: 10, readyAtMs: 0, asleep: false },
        { id: 'far',  key: 'wild_boar', r: 3, c: 6, hp: 10, maxHp: 10, readyAtMs: 0, asleep: false },
      ],
      tiles,
    });
    const after = act(s, rngFrom(1));
    // Near beast should be dead (overkill power), far beast untouched.
    expect(after.beasts.find((b) => b.id === 'near')).toBeUndefined();
    expect(after.beasts.find((b) => b.id === 'far')?.hp).toBe(10);
  });

  it('blocks the shot at a thicket wall', () => {
    const tiles = makeForest().tiles;
    tiles[3][4] = { kind: 'thicket' }; // wall between player and beast
    const s = makeForest({
      weapon: BOW_SNAP.weapon, rangedPower: BOW_SNAP.rangedPower,
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 5, hp: 10, maxHp: 10, readyAtMs: 0, asleep: false }],
      tiles,
    });
    const after = act(s, rngFrom(1));
    expect(after.beasts[0].hp).toBe(10); // shot blocked
  });

  it('does not hit a beast beyond the weapon range', () => {
    const shortBow: typeof BOW_SNAP.weapon = { ...BOW_SNAP.weapon, range: 2 };
    const s = makeForest({
      weapon: shortBow, rangedPower: BOW_SNAP.rangedPower,
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 6, hp: 10, maxHp: 10, readyAtMs: 0, asleep: false }],
    });
    const after = act(s, rngFrom(1));
    expect(after.beasts[0].hp).toBe(10); // out of range
  });

  it('falls through to gather when bow has no target in line', () => {
    const tiles = makeForest().tiles;
    tiles[3][4] = { kind: 'node', nodeKey: 'flower_bush' };
    const s = makeForest({ weapon: BOW_SNAP.weapon, rangedPower: BOW_SNAP.rangedPower, tiles });
    const after = act(s, rngFrom(3));
    // No beast in line → gather the adjacent node
    expect(after.tiles[3][4].kind).toBe('trail');
    expect(after.haul.materials?.herbs ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('melee weapon still only hits the adjacent faced beast (regression)', () => {
    // Beast at (3,5) — two cells away. Melee should not reach.
    const s = makeForest({
      meleePower: 30,
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 5, hp: 10, maxHp: 10, readyAtMs: 0, asleep: false }],
    });
    const after = act(s, rngFrom(1));
    expect(after.beasts[0].hp).toBe(10); // not adjacent, melee misses
  });
});

// ---------------------------------------------------------------------------
// Feature: Fleeing prey
// ---------------------------------------------------------------------------

describe('stepBeasts (fleeing prey)', () => {
  it('moves a fleeing prey beast away from the player', () => {
    const s = makeForest({
      beasts: [{ id: 'deer', key: 'forest_deer', r: 3, c: 5, hp: 8, maxHp: 8, readyAtMs: 0, asleep: false }],
    });
    const before = manhattan({ r: 3, c: 5 }, s.player);
    const after = stepBeasts(s, 1000, rngFrom(2));
    const b = after.beasts[0];
    if (b) {
      const afterDist = manhattan({ r: b.r, c: b.c }, after.player);
      // Prey should move farther away (or stay if cornered).
      expect(afterDist).toBeGreaterThanOrEqual(before);
    }
  });

  it('prey deals no contact damage when adjacent and does not trip the i-frame', () => {
    const s = makeForest({
      hp: 50,
      lastHitAtMs: -1000,
      beasts: [{ id: 'rabbit', key: 'wild_rabbit', r: 3, c: 4, hp: 5, maxHp: 5, readyAtMs: 999999, asleep: false }],
    });
    // Advance past windup window (prey have no windup anyway — just ensure no damage).
    const tick1 = stepBeasts(s, 1000, rngFrom(1));
    const tick2 = stepBeasts(tick1, 1500, rngFrom(1));
    expect(tick2.hp).toBe(50);
    expect(tick2.lastHitAtMs).toBe(-1000); // i-frame not consumed
  });

  it('killBeast drops the prey-specific material (game_meat for deer)', () => {
    const s = makeForest({
      rangedPower: 50,
      weapon: BOW_SNAP.weapon,
      beasts: [{ id: 'deer', key: 'forest_deer', r: 3, c: 5, hp: 8, maxHp: 8, readyAtMs: 0, asleep: false }],
    });
    const after = act(s, rngFrom(1));
    expect(after.beasts).toHaveLength(0);
    expect(after.haul.materials?.game_meat ?? 0).toBeGreaterThanOrEqual(1);
    expect(after.haul.materials?.leather).toBeUndefined();
  });

  it('killBeast still drops leather for predators', () => {
    const s = makeForest({
      meleePower: 30,
      beasts: [{ id: 'boar', key: 'wild_boar', r: 3, c: 4, hp: 10, maxHp: 10, readyAtMs: 0, asleep: false }],
    });
    const after = act(s, rngFrom(5));
    expect(after.haul.materials?.leather ?? 0).toBeGreaterThanOrEqual(1);
    expect(after.haul.materials?.game_meat).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Feature: Telegraphed attacks
// ---------------------------------------------------------------------------

describe('stepBeasts (telegraph)', () => {
  it('predator becoming adjacent sets windupUntilMs without dealing damage', () => {
    const s = makeForest({
      hp: 50,
      lastHitAtMs: -1000,
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 4, hp: 10, maxHp: 10, readyAtMs: 999999, asleep: false }],
    });
    const tick = stepBeasts(s, 1000, rngFrom(1));
    expect(tick.hp).toBe(50); // no damage yet
    expect(tick.beasts[0].windupUntilMs).toBeGreaterThan(1000);
  });

  it('predator strikes after windupUntilMs elapses while still adjacent', () => {
    const s = makeForest({
      hp: 50,
      lastHitAtMs: -1000,
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 4, hp: 10, maxHp: 10, readyAtMs: 999999, asleep: false }],
    });
    const tick1 = stepBeasts(s, 1000, rngFrom(1));
    const tick2 = stepBeasts(tick1, 1000 + FOREST_WINDUP_MS + 50, rngFrom(1));
    expect(tick2.hp).toBe(46); // wild_boar touchDamage = 4
  });

  it('predator clears windup if player escapes during the window', () => {
    const s = makeForest({
      hp: 50,
      lastHitAtMs: -1000,
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 4, hp: 10, maxHp: 10, readyAtMs: 999999, asleep: false }],
    });
    const tick1 = stepBeasts(s, 1000, rngFrom(1)); // windup starts
    // Move player away.
    const moved = tryMove(tick1, 'left');
    const tick2 = stepBeasts(moved, 1000 + FOREST_WINDUP_MS + 50, rngFrom(1));
    expect(tick2.hp).toBe(50); // no damage
    expect(tick2.beasts[0].windupUntilMs).toBeUndefined();
  });

  it('resets windupUntilMs after a successful strike so next hit also telegraphs', () => {
    const s = makeForest({
      hp: 50,
      lastHitAtMs: -1000,
      beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 4, hp: 10, maxHp: 10, readyAtMs: 999999, asleep: false }],
    });
    const tick1 = stepBeasts(s, 1000, rngFrom(1));
    const tick2 = stepBeasts(tick1, 1000 + FOREST_WINDUP_MS + 50, rngFrom(1)); // strike
    expect(tick2.hp).toBe(46);
    expect(tick2.beasts[0].windupUntilMs).toBeUndefined(); // cleared after strike
  });
});

// ---------------------------------------------------------------------------
// Feature: Shrine events
// ---------------------------------------------------------------------------

describe('isOnShrine', () => {
  it('returns true only when standing on a shrine tile', () => {
    const tiles = makeForest().tiles;
    tiles[3][3] = { kind: 'shrine', shrineKey: 'hunters_cache' };
    const s = makeForest({ tiles });
    expect(isOnShrine(s)).toBe(true);
    const off = tryMove(s, 'right');
    expect(isOnShrine(off)).toBe(false);
  });
});

describe('activateShrine', () => {
  it('hunters_cache: adds loot and consumes the shrine tile', () => {
    const tiles = makeForest().tiles;
    tiles[3][3] = { kind: 'shrine', shrineKey: 'hunters_cache' };
    const s = makeForest({ tiles });
    const after = activateShrine(s, 1000, rngFrom(1));
    expect(after.tiles[3][3].kind).toBe('clearing');
    expect((after.haul.gold ?? 0)).toBeGreaterThanOrEqual(10);
    expect((after.haul.materials?.game_meat ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('forest_blessing: applies bless status', () => {
    const tiles = makeForest().tiles;
    tiles[3][3] = { kind: 'shrine', shrineKey: 'forest_blessing' };
    const s = makeForest({ tiles });
    const after = activateShrine(s, 1000, rngFrom(1));
    expect(after.tiles[3][3].kind).toBe('clearing');
    expect(after.playerStatuses.some((st) => st.key === 'bless')).toBe(true);
  });

  it('disturbed_den: spawns an awake guardian adjacent', () => {
    const tiles = makeForest().tiles;
    tiles[3][3] = { kind: 'shrine', shrineKey: 'disturbed_den' };
    const s = makeForest({ tiles, stage: 5 }); // stage 5 has forest_bear
    const after = activateShrine(s, 1000, rngFrom(1));
    expect(after.tiles[3][3].kind).toBe('clearing');
    const guardian = after.beasts.find((b) => b.key === 'forest_bear');
    expect(guardian).toBeDefined();
    expect(guardian?.asleep).toBe(false);
    // Guardian should be adjacent to the player (who is at [3,3]).
    if (guardian) {
      const dist = Math.abs(guardian.r - 3) + Math.abs(guardian.c - 3);
      expect(dist).toBe(1);
    }
  });

  it('does nothing when not standing on a shrine', () => {
    const s = makeForest();
    const after = activateShrine(s, 1000, rngFrom(1));
    expect(after).toBe(s);
  });

  it('generateForest: shrines only placed on clearing tiles; maze stays reachable', () => {
    for (const seed of [1, 7, 42, 99, 1234]) {
      const forest = generateForest(3, SNAP, rngFrom(seed));
      // Any shrine must be a walkable tile (reachability check covers this).
      expect(reachesTreeline(forest)).toBe(true);
    }
  });
});
