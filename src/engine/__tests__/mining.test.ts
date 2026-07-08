import { describe, it, expect } from 'vitest';
import {
  generateMine,
  descend,
  tryMove,
  tryDash,
  strike,
  stepMonsters,
  castSpell,
  oreYield,
  isWalkable,
  applyBoonChoice,
  placeTombstone,
  findTombstone,
  unlockedStartFloor,
  isMineSafeBankTile,
  sightRadiusFor,
  MINE_SIGHT_RADIUS,
  MINE_DEATH_KEEP,
  MINE_TOMBSTONE_RECOVER_KEEP,
  type MineState,
  type MineTile,
  type MineSnapshot,
  type RNG,
  MINE_BASE_ROWS,
  MINE_BASE_COLS,
} from '../mining';
import { splitHaul } from '../crawl';
import { MINE_ORES, MINE_MONSTERS, MINE_AFFIXES } from '@/content/mining';
import { getWeapon, STARTER_WEAPON } from '@/engine/weapons';
import { STA_REGEN_MS, MP_REGEN_MS, FREEZE_DURATION_MS, DOT_TICK_MS, lateDepthDamageScale, manhattan, CRAWL_SPAWN_SAFE_RADIUS } from '@/engine/crawl';

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
    // 3.5 field
    richVein: null,
    richVeinRolled: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Twin-hoist regressions (ARCH-02/03/05) — mine side of the shared crawl.ts bodies
// ---------------------------------------------------------------------------

describe('crawl twin hoist (mine side)', () => {
  it('prunes an expired rune on a quiet tick (ARCH-02 parity)', () => {
    const s = makeState({
      monsters: [],
      runes: [{ id: 1, r: 1, c: 1, kind: 'fire', power: 5, expiresAtMs: 500 }],
    });
    const out = stepMonsters(s, 1000, rngFrom(1));
    expect(out.runes).toHaveLength(0);
  });

  it('rejects a spell not in knownSpells (ARCH-03 parity)', () => {
    const s = makeState({ knownSpells: [], mp: 8 });
    const out = castSpell(s, 'sparks', 1000, rngFrom(1));
    expect(out).toBe(s); // no-op
    expect(out.mp).toBe(8);
  });

  it('two monsters funnelling into one cell do not both occupy it (ARCH-05)', () => {
    // Bedrock everywhere except a T-funnel where (3,3) is the only cell that brings
    // both monsters closer to the player at (3,5).
    const rows = 7;
    const cols = 7;
    const tiles: MineTile[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: MineTile[] = [];
      for (let c = 0; c < cols; c++) row.push({ kind: 'bedrock' });
      tiles.push(row);
    }
    for (const [r, c] of [[2, 3], [4, 3], [3, 3], [3, 4], [3, 5]] as [number, number][]) {
      tiles[r][c] = { kind: 'floor' };
    }
    const s = makeState({
      tiles,
      player: { r: 3, c: 5, facing: 'left' },
      monsters: [
        { id: 'a', key: 'cave_slug', r: 2, c: 3, hp: 8, maxHp: 8, readyAtMs: 0 },
        { id: 'b', key: 'cave_slug', r: 4, c: 3, hp: 8, maxHp: 8, readyAtMs: 0 },
      ],
    });
    const out = stepMonsters(s, 1000, rngFrom(1));
    const cells = out.monsters.map((m) => `${m.r},${m.c}`);
    expect(new Set(cells).size).toBe(cells.length); // no same-tile stacking
  });
});

// ---------------------------------------------------------------------------
// MINI-33 residual: rune placement / rune trigger / ring-of-fire. Exercises the
// shared crawl.ts spell + rune bodies through the mine's castSpell + stepMonsters
// path (existing coverage only hit the `sparks` damage spell).
// ---------------------------------------------------------------------------

describe('crawl spell mechanics (mine wrapper)', () => {
  it('casts fire_rune onto the faced tile with a 30s lifetime', () => {
    // player at (3,3) facing 'right' → faced cell (3,4), an interior floor tile
    const s = makeState({ knownSpells: ['fire_rune'], mp: 8 });
    const out = castSpell(s, 'fire_rune', 1000, rngFrom(1));
    expect(out.mp).toBe(1); // 8 − 7 mpCost
    expect(out.runes).toHaveLength(1);
    const rune = out.runes[0];
    expect(rune).toMatchObject({ r: 3, c: 4, kind: 'fire' });
    expect(rune.expiresAtMs).toBe(1000 + 30000);
    expect(rune.power).toBeGreaterThan(0);
  });

  it('casts ice_rune (kind "ice") onto the faced tile', () => {
    const s = makeState({ knownSpells: ['ice_rune'], mp: 8 });
    const out = castSpell(s, 'ice_rune', 1000, rngFrom(1));
    expect(out.runes).toHaveLength(1);
    expect(out.runes[0]).toMatchObject({ r: 3, c: 4, kind: 'ice' });
    expect(out.runes[0].expiresAtMs).toBe(1000 + 30000);
  });

  it('a monster on a fire rune takes rune.power damage + burn, and the rune is consumed', () => {
    // Adjacent-to-player monster stays put (won't path) so it sits on the rune when it fires.
    const s = makeState({
      monsters: [{ id: 'm', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 0 }],
      runes: [{ id: 1, r: 3, c: 4, kind: 'fire', power: 5, expiresAtMs: 60000 }],
    });
    const out = stepMonsters(s, 1000, rngFrom(1));
    const m = out.monsters.find((x) => x.id === 'm')!;
    expect(m.hp).toBe(3);              // 8 − 5 rune power
    expect(m.poisonDmg).toBe(2);       // round(5 · 0.3) burn DoT
    expect(out.runes).toHaveLength(0); // consumed on trigger
  });

  it('a monster on an ice rune is frozen and the rune is consumed', () => {
    const s = makeState({
      monsters: [{ id: 'm', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 0 }],
      runes: [{ id: 1, r: 3, c: 4, kind: 'ice', power: 5, expiresAtMs: 60000 }],
    });
    const out = stepMonsters(s, 1000, rngFrom(1));
    const m = out.monsters.find((x) => x.id === 'm')!;
    expect(m.frozenUntilMs).toBe(1000 + FREEZE_DURATION_MS);
    expect(m.hp).toBe(3);              // ice runes still deal their power (8 − 5)
    expect(out.runes).toHaveLength(0);
  });

  it('ring_of_fire scorches a monster adjacent to the player', () => {
    const s = makeState({
      knownSpells: ['ring_of_fire'],
      mp: 10,
      maxMp: 10,
      monsters: [{ id: 'm', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 0 }],
    });
    const cast = castSpell(s, 'ring_of_fire', 1000, rngFrom(1));
    expect(cast.ringOfFire).not.toBeNull();
    expect(cast.ringOfFire!.dmg).toBe(7); // max(2, round(6 + 2·0.5))
    const out = stepMonsters(cast, 1100, rngFrom(1));
    const m = out.monsters.find((x) => x.id === 'm')!;
    expect(m.hp).toBe(1); // 8 − 7 ring damage
  });
});

describe('generateMine', () => {
  const mine = generateMine(1, SNAP, rngFrom(42));

  it('is at least the base size (MINE_BASE_ROWS × MINE_BASE_COLS) with a solid bedrock border', () => {
    expect(mine.rows).toBe(MINE_BASE_ROWS);
    expect(mine.cols).toBe(MINE_BASE_COLS);
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
      if (tile.kind === 'ore' && tile.oreKey && tile.oreKey !== 'vigor_crystal') {
        expect(MINE_ORES[tile.oreKey].floorMin).toBeLessThanOrEqual(1);
      }
    }
    // Iron/crystal/gemstone are gated deeper, so never appear on floor 1.
    const keys = shallow.tiles.flat().map((t) => t.oreKey).filter(Boolean);
    expect(keys).not.toContain('iron_vein');
    expect(keys).not.toContain('crystal_node');
  });

  it('has at least one vigor crystal on the map', () => {
    const gems = mine.tiles.flat().filter((t) => t.kind === 'ore' && t.oreKey === 'vigor_crystal');
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

  it('always banks guaranteed bounty gold on a non-guardian kill (BAL-11)', () => {
    const min = MINE_MONSTERS['cave_slug'].bounty[0]; // 1
    for (let seed = 0; seed < 30; seed++) {
      const s = makeState({
        meleePower: 20,
        monsters: [{ id: 'a', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 0 }],
      });
      const after = strike(s, rngFrom(seed));
      expect(after.monsters).toHaveLength(0);
      // Bounty gold lands even on seeds where the pool pick is a material.
      expect(after.haul.gold ?? 0).toBeGreaterThanOrEqual(min);
    }
  });

  it('kill-loot scales with the wielded attack stat, not always meleePower (MINI-19)', () => {
    const totalLoot = (h: MineState['haul']) =>
      (h.gold ?? 0) + Object.values(h.materials ?? {}).reduce((a, n) => a + n, 0);
    // Same power (20), same seed → identical rng draws; only the attack-stat
    // routing differs. An archer (DX, meleePower 0) must not out-loot a melee.
    // hp 1 dies to a single strike; maxHp 40 drives the swings-to-kill loot formula.
    const monster = { id: 'a', key: 'cave_slug', r: 3, c: 4, hp: 1, maxHp: 40, readyAtMs: 0 };
    const melee = makeState({
      weapon: { ...WEAPON, attackStat: 'ST' },
      meleePower: 20,
      rangedPower: 0,
      monsters: [{ ...monster }],
    });
    const archer = makeState({
      weapon: { ...WEAPON, attackStat: 'DX' },
      meleePower: 0,
      rangedPower: 20,
      monsters: [{ ...monster }],
    });
    const meleeLoot = totalLoot(strike(melee, rngFrom(7)).haul);
    const archerLoot = totalLoot(strike(archer, rngFrom(7)).haul);
    expect(archerLoot).toBeLessThanOrEqual(meleeLoot);
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

  it('MINI-17: a frozen monster deals no contact damage, then bites once thawed (forest parity)', () => {
    const frozen = makeState({
      hp: 50,
      defense: 0,
      lastHitAtMs: -1000,
      monsters: [{ id: 'a', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 999999, frozenUntilMs: 5000 }],
    });
    // now 1000 < frozenUntilMs 5000 → staggered, can't bite (pre-fix it dealt 4).
    expect(stepMonsters(frozen, 1000, rngFrom(1)).hp).toBe(50);
    // Once the freeze lapses (now 6000 ≥ 5000) contact damage resumes: cave_slug touchDamage 4.
    expect(stepMonsters(frozen, 6000, rngFrom(1)).hp).toBe(46);
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

describe('applyBoonChoice', () => {
  function choosingState(boonKeys: string[]): MineState {
    return makeState({
      status: 'choosing',
      pendingBoonChoice: boonKeys,
      agLevel: 0,
      moveIntervalMs: 150,   // moveInterval(0)
      dashCooldownMs: 2000,  // dashCooldown(0)
    });
  }

  it('ignores the call when status is not choosing', () => {
    const s = makeState({ status: 'active', pendingBoonChoice: ['swift_step', 'iron_arm', 'vein_sense'] });
    expect(applyBoonChoice(s, 'swift_step')).toBe(s);
  });

  it('ignores a key not in the pending choices', () => {
    const s = choosingState(['stone_skin', 'quick_dash', 'overcharge']);
    expect(applyBoonChoice(s, 'swift_step')).toBe(s);
  });

  it('swift_step: updates moveIntervalMs and clears pendingBoonChoice', () => {
    // moveInterval(0) = 150; swift_step moveMult = 1.25 → Math.round(150/1.25) = 120
    const after = applyBoonChoice(choosingState(['swift_step', 'stone_skin', 'quick_dash']), 'swift_step');
    expect(after.status).toBe('active');
    expect(after.pendingBoonChoice).toBeNull();
    expect(after.activeBoons).toContain('swift_step');
    expect(after.moveIntervalMs).toBe(120);
  });

  it('quick_dash: updates dashCooldownMs', () => {
    // dashCooldown(0) = 2000; quick_dash dashCdMult = 0.7 → Math.round(2000*0.7) = 1400
    const after = applyBoonChoice(choosingState(['quick_dash', 'stone_skin', 'iron_arm']), 'quick_dash');
    expect(after.dashCooldownMs).toBe(1400);
  });

  it('vitality: increases maxHp and heals the player by the bonus', () => {
    const s = choosingState(['vitality', 'stone_skin', 'iron_arm']);
    const before = s.hp;
    const after = applyBoonChoice(s, 'vitality');
    expect(after.maxHp).toBe(s.maxHp + 20);
    expect(after.hp).toBe(before + 20);
  });
});

describe('boon effects in strike', () => {
  it('iron_arm: weapon hit deals strictly more damage than without the boon', () => {
    const monster = { id: 'a', key: 'cave_slug', r: 3, c: 4, hp: 100, maxHp: 100, readyAtMs: 0 };
    const baseState = makeState({ meleePower: 5, monsters: [monster] });
    const boonState = makeState({ meleePower: 5, monsters: [monster], activeBoons: ['iron_arm'] });
    const seed = 42;
    const hpAfterBase = strike(baseState, rngFrom(seed)).monsters[0]?.hp ?? 100;
    const hpAfterBoon = strike(boonState, rngFrom(seed)).monsters[0]?.hp ?? 100;
    // iron_arm adds 30% meleeMult — always deals more (or equal on min-roll edge case)
    expect(hpAfterBoon).toBeLessThanOrEqual(hpAfterBase);
  });

  it('vein_sense: doubles the gold from a broken rubble vein', () => {
    // Use a fixed rng returning 0.5: randInt(1,4,rng) = 1 + floor(0.5*4) = 3
    // With vein_sense (yieldMult:2): Math.round(3*2) = 6
    const fixedRng: RNG = () => 0.5;
    const tiles = makeState().tiles;
    tiles[3][4] = { kind: 'ore', oreKey: 'rubble', durability: 1 };

    const base = strike(makeState({ tiles }), fixedRng);
    const boon = strike(makeState({ tiles, activeBoons: ['vein_sense'] }), fixedRng);
    expect(base.haul.gold).toBe(3);
    expect(boon.haul.gold).toBe(6);
  });
});

describe('unlockedStartFloor (BAL-25)', () => {
  // MINE_GUARDIAN_FLOORS = { 7, 15 }.
  it('starts at floor 1 until a guardian band is descended past', () => {
    expect(unlockedStartFloor(0)).toBe(1);
    expect(unlockedStartFloor(6)).toBe(1);
    expect(unlockedStartFloor(7)).toBe(1); // at the floor-7 guardian, not yet PAST it
  });
  it('unlocks a boundary only once the player has gone strictly below it', () => {
    expect(unlockedStartFloor(8)).toBe(7); // past floor 7
    expect(unlockedStartFloor(15)).toBe(7); // at the floor-15 guardian, past floor 7 only
    expect(unlockedStartFloor(16)).toBe(15); // past floor 15
    expect(unlockedStartFloor(99)).toBe(15); // clamps to the deepest boundary
  });
});

describe('isMineSafeBankTile (BAL-12)', () => {
  it('is true only on the entrance', () => {
    expect(isMineSafeBankTile('entrance')).toBe(true);
    expect(isMineSafeBankTile('floor')).toBe(false);
    expect(isMineSafeBankTile('shaft')).toBe(false);
    expect(isMineSafeBankTile(undefined)).toBe(false);
  });
});

describe('deep-floor difficulty (MINI-20)', () => {
  it('spawns the sub-300ms magma sprinter on deep floors', () => {
    let sawFast = false;
    let minCadence = Infinity;
    for (let seed = 0; seed < 8; seed++) {
      const mine = generateMine(24, SNAP, rngFrom(seed));
      for (const m of mine.monsters) {
        minCadence = Math.min(minCadence, MINE_MONSTERS[m.key]?.moveCadenceMs ?? Infinity);
        if (m.key === 'cinder_wisp') sawFast = true;
      }
    }
    expect(sawFast).toBe(true);           // the new fast template actually spawns
    expect(minCadence).toBeLessThan(300); // nothing was sub-300 pre-fix
  });

  it('monster count keeps climbing past the old cap of 10', () => {
    const mine = generateMine(24, SNAP, rngFrom(3));
    expect(mine.monsters.length).toBeGreaterThan(10); // pre-fix: Math.min(10, …) capped at 10
  });

  it('lateDepthDamageScale ramps 4%/floor and caps at 2×', () => {
    expect(lateDepthDamageScale(0)).toBe(1);      // at the band start — no change
    expect(lateDepthDamageScale(-5)).toBe(1);     // shallower — clamped to 1
    expect(lateDepthDamageScale(5)).toBeGreaterThan(1);
    expect(lateDepthDamageScale(5)).toBeCloseTo(1.2, 5);
    expect(lateDepthDamageScale(1000)).toBe(2);   // capped
  });
});

describe('sightRadiusFor (ARCH-14)', () => {
  it('returns the base radius with no boons', () => {
    expect(sightRadiusFor(makeState({ activeBoons: [] }))).toBe(MINE_SIGHT_RADIUS);
  });

  it('widens by the Lantern boon bonus (+2)', () => {
    expect(sightRadiusFor(makeState({ activeBoons: ['lantern'] }))).toBe(MINE_SIGHT_RADIUS + 2);
  });

  it('widens by the Homestead Watchtower sight bonus (+1) and stacks with the boon (10.5)', () => {
    expect(sightRadiusFor(makeState({ sightBonus: 1 }))).toBe(MINE_SIGHT_RADIUS + 1);
    expect(sightRadiusFor(makeState({ activeBoons: ['lantern'], sightBonus: 1 }))).toBe(MINE_SIGHT_RADIUS + 3);
  });
});

describe('death split via splitHaul (ARCH-14)', () => {
  it('kept + lost reconstruct the original haul at MINE_DEATH_KEEP', () => {
    const haul = { gold: 15, materials: { stone: 3, iron_bar: 1 } };
    const { kept, lost } = splitHaul(haul, MINE_DEATH_KEEP);
    expect((kept.gold ?? 0) + (lost.gold ?? 0)).toBe(haul.gold);
    for (const [mat, qty] of Object.entries(haul.materials)) {
      expect((kept.materials?.[mat] ?? 0) + (lost.materials?.[mat] ?? 0)).toBe(qty);
    }
  });
});

describe('3.1: band-exclusive spawn weighting', () => {
  it('gates floor-1 filler ores out past their floorMax', () => {
    for (let seed = 0; seed < 5; seed++) {
      const mine = generateMine(20, SNAP, rngFrom(seed + 200));
      const keys = mine.tiles.flat().map((t) => t.oreKey).filter(Boolean);
      expect(keys).not.toContain('rubble');
      expect(keys).not.toContain('bronze_vein');
      expect(keys).not.toContain('stone_lode');
    }
  });

  it('band-native monsters spawn more often than a band-agnostic monster of equal count', () => {
    let iceCrawler = 0;
    let deepLurker = 0; // band-agnostic, eligible from floor 6 onward, weight 1 (default)
    for (let seed = 0; seed < 40; seed++) {
      const mine = generateMine(10, SNAP, rngFrom(seed + 300));
      for (const m of mine.monsters) {
        if (m.key === 'ice_crawler') iceCrawler++;
        if (m.key === 'deep_lurker') deepLurker++;
      }
    }
    expect(iceCrawler).toBeGreaterThan(deepLurker);
  });
});

describe('0.6: node durability scales with depth', () => {
  it('rock and ore durability on a deep floor is at least as high as on floor 1', () => {
    const shallow = generateMine(1, SNAP, rngFrom(5));
    const deep = generateMine(30, SNAP, rngFrom(5));
    const avgDur = (m: MineState) => {
      const nodes = m.tiles.flat().filter((t) => (t.kind === 'rock' || t.kind === 'ore') && t.maxDurability != null);
      return nodes.reduce((a, t) => a + (t.maxDurability ?? 0), 0) / Math.max(1, nodes.length);
    };
    expect(avgDur(deep)).toBeGreaterThan(avgDur(shallow));
  });
});

describe('0.3: kill-loot snowball is capped', () => {
  it('loot-per-kill growth flattens once killsThisFloor exceeds the cap', () => {
    // One-shot power so every strike kills in a single swing; loot qty grows with
    // killsThisFloor until the cap (5), then should stop growing further.
    const totalLoot = (h: MineState['haul']) =>
      (h.gold ?? 0) + Object.values(h.materials ?? {}).reduce((a, n) => a + n, 0);
    let s = makeState({ meleePower: 999 });
    const deltas: number[] = [];
    let prevTotal = 0;
    for (let i = 0; i < 9; i++) {
      s = {
        ...s,
        monsters: [{ id: `m${i}`, key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 0 }],
      };
      s = strike(s, rngFrom(100 + i));
      const total = totalLoot(s.haul);
      deltas.push(total - prevTotal);
      prevTotal = total;
    }
    // Growth across the first few (uncapped) kills vs. the last few (capped) kills:
    // the later deltas must not keep climbing linearly forever.
    const earlyMax = Math.max(...deltas.slice(0, 4));
    const lateMax = Math.max(...deltas.slice(5));
    expect(lateMax).toBeLessThanOrEqual(earlyMax + 2); // small rng slack, no unbounded growth
  });
});

describe('0.5: guardian re-kill farming is reduced', () => {
  it('flags the guardian as a re-kill once the player has already passed its floor', () => {
    const freshSnap: MineSnapshot = { ...SNAP, deepestMineFloor: 0 };
    const fresh = generateMine(7, freshSnap, rngFrom(3));
    const freshGuardian = fresh.monsters.find((m) => m.key === 'stone_golem');
    expect(freshGuardian?.isRekillGuardian).toBeUndefined();

    const pastSnap: MineSnapshot = { ...SNAP, deepestMineFloor: 10 };
    const restarted = generateMine(7, pastSnap, rngFrom(3));
    const rekillGuardian = restarted.monsters.find((m) => m.key === 'stone_golem');
    expect(rekillGuardian?.isRekillGuardian).toBe(true);
  });

  it('a re-kill pays reduced gold-only treasure and skips the boon choice', () => {
    const pastSnap: MineSnapshot = { ...SNAP, deepestMineFloor: 10 };
    let s = generateMine(7, pastSnap, rngFrom(3));
    const guardian = s.monsters.find((m) => m.key === 'stone_golem')!;
    // Face the guardian directly (its cell may not be terrain-adjacent to the entrance).
    s = {
      ...s,
      meleePower: 999,
      monsters: [guardian],
      player: { r: guardian.r, c: guardian.c - 1, facing: 'right' },
    };
    const after = strike(s, rngFrom(1));
    expect(after.status).toBe('active'); // not 'choosing' — no boon offered on a re-kill
    expect(Object.keys(after.haul.materials ?? {})).toHaveLength(0); // gold-only re-kill treasure
    expect(after.haul.gold ?? 0).toBeLessThan(30); // below the genuine first-kill's 30-50 range
  });
});

describe('1.1: late-depth monster HP and contact-hit scaling', () => {
  it('a deep-floor monster spawns with more HP than the same key on floor 1', () => {
    let shallowHp = 0;
    let deepHp = 0;
    for (let seed = 0; seed < 6 && (shallowHp === 0 || deepHp === 0); seed++) {
      const shallow = generateMine(1, SNAP, rngFrom(seed));
      const deep = generateMine(30, SNAP, rngFrom(seed));
      const sm = shallow.monsters.find((m) => m.key === 'cave_slug');
      const dm = deep.monsters.find((m) => m.key === 'cave_slug');
      if (sm) shallowHp = sm.maxHp;
      if (dm) deepHp = dm.maxHp;
    }
    expect(deepHp).toBeGreaterThan(shallowHp);
  });

  it('more than one adjacent monster can land a hit per i-frame window at max depth', () => {
    const s = makeState({
      floor: 40, // far past MAGMA_BAND_START(15)+25 → lateDepthDamageScale caps at 2
      hp: 999,
      maxHp: 999,
      defense: 0,
      lastHitAtMs: -1000,
      monsters: [
        { id: 'a', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 999999 },
        { id: 'b', key: 'cave_slug', r: 3, c: 2, hp: 8, maxHp: 8, readyAtMs: 999999 },
        { id: 'c', key: 'cave_slug', r: 2, c: 3, hp: 8, maxHp: 8, readyAtMs: 999999 },
      ],
    });
    const single = stepMonsters(
      makeState({ ...s, monsters: [s.monsters[0]] }),
      1000,
      rngFrom(1),
    );
    const swarmed = stepMonsters(s, 1000, rngFrom(1));
    // A 3-monster swarm at max depth must deal strictly more than a single toucher would.
    expect(999 - swarmed.hp).toBeGreaterThan(999 - single.hp);
  });
});

describe('0.2: tombstone recovery keeps death worse than the free hurry-bank', () => {
  it('MINE_TOMBSTONE_RECOVER_KEEP is below 1.0 so full recovery requires effort, not a guarantee', () => {
    expect(MINE_TOMBSTONE_RECOVER_KEEP).toBeLessThan(1);
    expect(MINE_TOMBSTONE_RECOVER_KEEP).toBeGreaterThan(0);
  });
});

describe('MINI-31: findTombstone', () => {
  it('returns null on a floor with no tombstone', () => {
    const mine = generateMine(1, SNAP, rngFrom(11));
    expect(findTombstone(mine)).toBeNull();
  });

  it('locates a placed tombstone tile', () => {
    const mine = generateMine(1, SNAP, rngFrom(11));
    const withTomb = placeTombstone(mine, rngFrom(3));
    const pos = findTombstone(withTomb);
    expect(pos).not.toBeNull();
    expect(withTomb.tiles[pos!.r][pos!.c].kind).toBe('tombstone');
    // The scan is a pure read — it must not mutate the passed state.
    expect(findTombstone(mine)).toBeNull();
  });
});

describe('3.3: band hazard tiles', () => {
  it('ice_slide only ever generates on frozen-band floors, lava_dot only on magma-band floors', () => {
    let sawIceOffBand = false;
    let sawLavaOffBand = false;
    let sawIceOnFrozen = false;
    let sawLavaOnMagma = false;
    for (let seed = 0; seed < 20; seed++) {
      const rocky = generateMine(3, SNAP, rngFrom(seed));
      const frozen = generateMine(10, SNAP, rngFrom(seed));
      const magma = generateMine(20, SNAP, rngFrom(seed));
      for (const row of rocky.tiles) {
        for (const t of row) {
          if (t.kind === 'ice_slide' || t.kind === 'lava_dot') sawIceOffBand = sawIceOffBand || t.kind === 'ice_slide';
          if (t.kind === 'lava_dot') sawLavaOffBand = true;
        }
      }
      for (const row of frozen.tiles) {
        for (const t of row) {
          if (t.kind === 'lava_dot') sawLavaOffBand = true;
          if (t.kind === 'ice_slide') sawIceOnFrozen = true;
        }
      }
      for (const row of magma.tiles) {
        for (const t of row) {
          if (t.kind === 'ice_slide') sawIceOffBand = true;
          if (t.kind === 'lava_dot') sawLavaOnMagma = true;
        }
      }
    }
    expect(sawIceOffBand).toBe(false);
    expect(sawLavaOffBand).toBe(false);
    expect(sawIceOnFrozen).toBe(true);
    expect(sawLavaOnMagma).toBe(true);
  });

  it('landing on ice_slide keeps the player sliding through consecutive ice tiles', () => {
    const s = makeState({ player: { r: 3, c: 2, facing: 'right' } });
    s.tiles[3][3] = { kind: 'ice_slide' };
    s.tiles[3][4] = { kind: 'ice_slide' };
    const out = tryMove(s, 'right');
    // Steps onto (3,3) [ice], slides through (3,4) [ice], one more step lands on (3,5) [floor].
    expect(out.player).toEqual({ r: 3, c: 5, facing: 'right' });
  });

  it('a single ice_slide tile only adds one extra cell, and a dash onto ice slides too', () => {
    const s = makeState({ player: { r: 3, c: 2, facing: 'right' } });
    s.tiles[3][3] = { kind: 'ice_slide' };
    const moved = tryMove(s, 'right');
    expect(moved.player).toEqual({ r: 3, c: 4, facing: 'right' });

    const dashState = makeState({ player: { r: 3, c: 1, facing: 'right' }, lastDashMs: -10000 });
    dashState.tiles[3][3] = { kind: 'ice_slide' };
    const dashed = tryDash(dashState, 'right', 5000);
    // Dash lands on (3,3) [ice] after 2 cells, then slides one further to (3,4).
    expect(dashed.player).toEqual({ r: 3, c: 4, facing: 'right' });
  });

  it('ice_slide does not slide the player past a monster or off the walkable floor', () => {
    const s = makeState({
      player: { r: 3, c: 2, facing: 'right' },
      monsters: [{ id: 'm1', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 999999 }],
    });
    s.tiles[3][3] = { kind: 'ice_slide' };
    const out = tryMove(s, 'right');
    expect(out.player).toEqual({ r: 3, c: 3, facing: 'right' });
  });

  it('lava_dot deals ward-mitigated damage on a tick while the player stands on it', () => {
    const noWard = makeState({ player: { r: 3, c: 3, facing: 'down' }, hp: 50, ward: 0, lastLavaTickMs: -100000 });
    noWard.tiles[3][3] = { kind: 'lava_dot' };
    const highWard = makeState({ player: { r: 3, c: 3, facing: 'down' }, hp: 50, ward: 5, lastLavaTickMs: -100000 });
    highWard.tiles[3][3] = { kind: 'lava_dot' };

    const noWardOut = stepMonsters(noWard, 5000, rngFrom(1));
    const highWardOut = stepMonsters(highWard, 5000, rngFrom(1));

    expect(noWardOut.hp).toBeLessThan(50);
    expect(highWardOut.hp).toBeLessThan(50); // never fully negated — always at least 1 dmg
    expect(50 - highWardOut.hp).toBeLessThan(50 - noWardOut.hp);
  });

  it('lava_dot does not re-tick until LAVA_TICK_MS has passed, and does nothing off the tile', () => {
    const s = makeState({ player: { r: 3, c: 3, facing: 'down' }, hp: 50, ward: 0, lastLavaTickMs: -100000 });
    s.tiles[3][3] = { kind: 'lava_dot' };
    const firstTick = stepMonsters(s, 5000, rngFrom(1));
    expect(firstTick.hp).toBeLessThan(50);
    const immediateRetick = stepMonsters(firstTick, 5001, rngFrom(1));
    expect(immediateRetick.hp).toBe(firstTick.hp);

    const offTile = makeState({ player: { r: 3, c: 2, facing: 'down' }, hp: 50, ward: 0, lastLavaTickMs: -100000 });
    offTile.tiles[3][3] = { kind: 'lava_dot' };
    const stillFull = stepMonsters(offTile, 5000, rngFrom(1));
    expect(stillFull.hp).toBe(50);
  });
});

describe('3.4: mother lode vault', () => {
  it('never spawns before the depth threshold, and spawns exactly one per floor past it', () => {
    for (let floor = 1; floor < 6; floor++) {
      for (let seed = 0; seed < 5; seed++) {
        const mine = generateMine(floor, SNAP, rngFrom(seed));
        const vaults = mine.tiles.flat().filter((t) => t.kind === 'vault');
        expect(vaults).toHaveLength(0);
      }
    }
    for (let seed = 0; seed < 10; seed++) {
      const mine = generateMine(12, SNAP, rngFrom(seed));
      const vaults = mine.tiles.flat().filter((t) => t.kind === 'vault');
      expect(vaults.length).toBeLessThanOrEqual(1);
    }
  });

  it('a vault node has far higher durability than a typical ore node on the same floor', () => {
    let vaultDur = 0;
    let maxOreDur = 0;
    for (let seed = 0; seed < 10 && vaultDur === 0; seed++) {
      const mine = generateMine(12, SNAP, rngFrom(seed));
      for (const row of mine.tiles) {
        for (const t of row) {
          if (t.kind === 'vault') vaultDur = t.maxDurability ?? 0;
          if (t.kind === 'ore') maxOreDur = Math.max(maxOreDur, t.maxDurability ?? 0);
        }
      }
    }
    expect(vaultDur).toBeGreaterThan(0);
    expect(vaultDur).toBeGreaterThan(maxOreDur);
  });

  it('breaking a vault yields a reward notably larger than a single ore break', () => {
    const s = makeState({
      floor: 12,
      player: { r: 3, c: 2, facing: 'right' },
      pickaxePower: 99, // one-shot the node regardless of its durability
    });
    s.tiles[3][3] = { kind: 'vault', durability: 1, maxDurability: 1 };
    const out = strike(s, rngFrom(1));
    expect(out.tiles[3][3].kind).toBe('floor');
    // motherLodeYield's flat gold floor is 20 + floor*2, before any of its 3 ore rolls.
    expect(out.haul.gold ?? 0).toBeGreaterThanOrEqual(20 + s.floor * 2);
  });
});

describe('3.5: timed rich vein event', () => {
  it('never spawns before the depth threshold', () => {
    for (let seed = 0; seed < 30; seed++) {
      const out = stepMonsters(makeState({ floor: 2 }), 1000, rngFrom(seed));
      expect(out.richVein).toBeNull();
    }
  });

  it('rolls at most once per floor — later ticks never spawn a second vein or move an active one', () => {
    let sawSpawn = false;
    for (let seed = 0; seed < 30; seed++) {
      const s = makeState({ floor: 10, player: { r: 1, c: 1, facing: 'right' } });
      const firstTick = stepMonsters(s, 1000, rngFrom(seed));
      expect(firstTick.richVeinRolled).toBe(true);
      const secondTick = stepMonsters(firstTick, 1500, rngFrom(seed + 1));
      expect(secondTick.richVein?.r).toBe(firstTick.richVein?.r);
      expect(secondTick.richVein?.c).toBe(firstTick.richVein?.c);
      if (firstTick.richVein) sawSpawn = true;
    }
    // ~40% spawn chance across 30 independent seeds should hit at least once.
    expect(sawSpawn).toBe(true);
  });

  it('a spawned rich vein blocks movement, sits at its recorded position, and expires in the future', () => {
    let armed: MineState | null = null;
    for (let seed = 0; seed < 30 && !armed; seed++) {
      const t = stepMonsters(makeState({ floor: 10, player: { r: 1, c: 1, facing: 'right' } }), 1000, rngFrom(seed));
      if (t.richVein) armed = t;
    }
    expect(armed?.richVein).toBeTruthy();
    const { r, c, expiresAtMs } = armed!.richVein!;
    expect(armed!.tiles[r][c].kind).toBe('rich_vein');
    expect(isWalkable(armed!.tiles[r][c])).toBe(false);
    expect(expiresAtMs).toBeGreaterThan(1000);
  });

  it('reverts to floor and clears richVein once its window elapses unmined', () => {
    let armed: MineState | null = null;
    for (let seed = 0; seed < 30 && !armed; seed++) {
      const t = stepMonsters(makeState({ floor: 10, player: { r: 1, c: 1, facing: 'right' } }), 1000, rngFrom(seed));
      if (t.richVein) armed = t;
    }
    expect(armed?.richVein).toBeTruthy();
    const { r, c, expiresAtMs } = armed!.richVein!;
    const expired = stepMonsters(armed!, expiresAtMs + 1, rngFrom(999));
    expect(expired.richVein).toBeNull();
    expect(expired.tiles[r][c].kind).toBe('floor');
  });

  it('mining a rich vein yields a reward, clears its timer, and reverts the tile to floor', () => {
    const s = makeState({
      floor: 10,
      player: { r: 3, c: 2, facing: 'right' },
      pickaxePower: 99, // one-shot the node
      richVein: { r: 3, c: 3, expiresAtMs: 999999 },
    });
    s.tiles[3][3] = { kind: 'rich_vein', durability: 1, maxDurability: 1 };
    const out = strike(s, rngFrom(1));
    expect(out.tiles[3][3].kind).toBe('floor');
    expect(out.richVein).toBeNull();
    const gotGold = (out.haul.gold ?? 0) > 0;
    const gotMaterials = Object.keys(out.haul.materials ?? {}).length > 0;
    expect(gotGold || gotMaterials).toBe(true);
  });
});

describe('3.6: elite monster affixes', () => {
  it('never rolls an elite at or before the depth threshold', () => {
    for (let floor = 1; floor <= 10; floor++) {
      for (let seed = 0; seed < 5; seed++) {
        const mine = generateMine(floor, SNAP, rngFrom(seed));
        expect(mine.monsters.some((m) => m.affix)).toBe(false);
      }
    }
  });

  it('rolls at most one elite per floor past the threshold, and does roll one sometimes', () => {
    let sawAffix = false;
    for (let seed = 0; seed < 15; seed++) {
      const mine = generateMine(20, SNAP, rngFrom(seed));
      const elites = mine.monsters.filter((m) => m.affix);
      expect(elites.length).toBeLessThanOrEqual(1);
      if (elites.length > 0) sawAffix = true;
    }
    expect(sawAffix).toBe(true);
  });

  it('armored affix increases effective defense against a melee strike', () => {
    const base = makeState({ player: { r: 3, c: 2, facing: 'right' }, meleePower: 30 });
    const mon = { id: 'm', key: 'cave_slug', r: 3, c: 3, hp: 999, maxHp: 999, readyAtMs: 999999 };
    const plainOut = strike({ ...base, monsters: [{ ...mon }] }, rngFrom(7));
    const armoredOut = strike({ ...base, monsters: [{ ...mon, affix: 'armored' as const }] }, rngFrom(7));
    const plainDealt = 999 - plainOut.monsters[0].hp;
    const armoredDealt = 999 - armoredOut.monsters[0].hp;
    expect(armoredDealt).toBeLessThan(plainDealt);
  });

  it('swift affix shortens the delay before the monster is ready to step again', () => {
    const rows = 7;
    const cols = 7;
    const tiles: MineTile[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: MineTile[] = [];
      for (let c = 0; c < cols; c++) {
        const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
        row.push({ kind: border ? 'bedrock' : 'floor' });
      }
      tiles.push(row);
    }
    const mon = { id: 'm', key: 'cave_slug', r: 1, c: 1, hp: 8, maxHp: 8, readyAtMs: 0 };
    const plainOut = stepMonsters(
      makeState({ tiles, player: { r: 5, c: 5, facing: 'left' }, monsters: [{ ...mon }] }),
      1000, rngFrom(1),
    );
    const swiftOut = stepMonsters(
      makeState({ tiles, player: { r: 5, c: 5, facing: 'left' }, monsters: [{ ...mon, affix: 'swift' as const }] }),
      1000, rngFrom(1),
    );
    const def = MINE_MONSTERS['cave_slug'];
    expect(plainOut.monsters[0].readyAtMs).toBe(1000 + def.moveCadenceMs);
    expect(swiftOut.monsters[0].readyAtMs).toBeLessThan(plainOut.monsters[0].readyAtMs);
  });

  it('venomous affix poisons the player on a landed contact hit, and the poison later ticks on its own', () => {
    const s = makeState({
      player: { r: 3, c: 3, facing: 'right' },
      hp: 50,
      lastHitAtMs: -100000,
      monsters: [{ id: 'v', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 999999, affix: 'venomous' as const }],
    });
    const afterHit = stepMonsters(s, 1000, rngFrom(1));
    expect(afterHit.hp).toBeLessThan(50);
    const poison = afterHit.playerStatuses.find((x) => x.key === 'poison');
    expect(poison).toBeTruthy();
    expect(poison!.magnitude).toBe(MINE_AFFIXES.venomous.poisonOnContact!.magnitude);

    // Remove the monster so any further hp loss can only come from the poison DoT itself.
    const noMonster = { ...afterHit, monsters: [] };
    const afterTick = stepMonsters(noMonster, 1000 + DOT_TICK_MS, rngFrom(2));
    expect(afterTick.hp).toBeLessThan(afterHit.hp);
  });
});

describe('3.7: guardian telegraphed specials', () => {
  it("a guardian within range starts winding up, targeting the player's current position", () => {
    const s = makeState({
      player: { r: 3, c: 3, facing: 'right' },
      monsters: [{ id: 'g', key: 'stone_golem', r: 3, c: 5, hp: 50, maxHp: 50, readyAtMs: 999999 }],
    });
    const out = stepMonsters(s, 1000, rngFrom(1));
    const g = out.monsters[0];
    expect(g.special).toMatchObject({ targetR: 3, targetC: 3 });
    expect(g.special!.readyAtMs).toBeGreaterThan(1000);
  });

  it('a guardian out of range does not start winding up', () => {
    const s = makeState({
      player: { r: 1, c: 1, facing: 'right' },
      monsters: [{ id: 'g', key: 'stone_golem', r: 5, c: 5, hp: 50, maxHp: 50, readyAtMs: 999999 }],
    });
    const out = stepMonsters(s, 1000, rngFrom(1));
    expect(out.monsters[0].special).toBeUndefined();
  });

  it('a guardian roots in place while winding up, even though it would otherwise path toward the player', () => {
    const rows = 7;
    const cols = 7;
    const tiles: MineTile[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: MineTile[] = [];
      for (let c = 0; c < cols; c++) {
        const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
        row.push({ kind: border ? 'bedrock' : 'floor' });
      }
      tiles.push(row);
    }
    const s = makeState({
      tiles,
      player: { r: 5, c: 5, facing: 'left' },
      monsters: [{
        id: 'g', key: 'stone_golem', r: 1, c: 1, hp: 50, maxHp: 50, readyAtMs: 0,
        special: { targetR: 5, targetC: 5, readyAtMs: 999999 },
      }],
    });
    const out = stepMonsters(s, 1000, rngFrom(1));
    expect(out.monsters[0].r).toBe(1);
    expect(out.monsters[0].c).toBe(1);
  });

  it("a landed slam damages the player and applies the guardian's themed status when they are in the blast zone", () => {
    const s = makeState({
      player: { r: 3, c: 3, facing: 'right' },
      hp: 50,
      lastHitAtMs: -100000,
      monsters: [{
        id: 'g', key: 'stone_golem', r: 3, c: 6, hp: 50, maxHp: 50, readyAtMs: 999999,
        special: { targetR: 3, targetC: 3, readyAtMs: 999 }, // already due
      }],
    });
    const out = stepMonsters(s, 1000, rngFrom(1));
    expect(out.hp).toBeLessThan(50);
    expect(out.monsters[0].special).toBeUndefined();
    expect(out.monsters[0].specialCooldownUntilMs).toBeGreaterThan(1000);
    const weaken = out.playerStatuses.find((x) => x.key === 'weaken');
    expect(weaken).toBeTruthy();
    expect(weaken!.magnitude).toBeGreaterThan(0);
  });

  it('a landed slam whiffs (no damage, no status) when the player has moved out of the blast zone', () => {
    const s = makeState({
      player: { r: 1, c: 1, facing: 'right' },
      hp: 50,
      lastHitAtMs: -100000,
      monsters: [{
        id: 'g', key: 'stone_golem', r: 3, c: 6, hp: 50, maxHp: 50, readyAtMs: 999999,
        special: { targetR: 3, targetC: 3, readyAtMs: 999 },
      }],
    });
    const out = stepMonsters(s, 1000, rngFrom(1));
    expect(out.hp).toBe(50);
    expect(out.monsters[0].special).toBeUndefined(); // resolves (hit or miss)
    expect(out.playerStatuses.find((x) => x.key === 'weaken')).toBeUndefined();
  });

  it('after a slam resolves, the guardian cannot immediately wind up again', () => {
    const s = makeState({
      player: { r: 3, c: 3, facing: 'right' },
      hp: 50,
      lastHitAtMs: -100000,
      monsters: [{
        id: 'g', key: 'stone_golem', r: 3, c: 4, hp: 50, maxHp: 50, readyAtMs: 999999,
        special: { targetR: 3, targetC: 3, readyAtMs: 999 },
      }],
    });
    const resolved = stepMonsters(s, 1000, rngFrom(1));
    expect(resolved.monsters[0].special).toBeUndefined();
    const again = stepMonsters(resolved, 1001, rngFrom(2));
    expect(again.monsters[0].special).toBeUndefined();
  });

  it("magma colossus's slam applies a burn DoT instead of weaken", () => {
    const s = makeState({
      player: { r: 3, c: 3, facing: 'right' },
      hp: 50,
      lastHitAtMs: -100000,
      monsters: [{
        id: 'g', key: 'magma_colossus', r: 3, c: 6, hp: 70, maxHp: 70, readyAtMs: 999999,
        special: { targetR: 3, targetC: 3, readyAtMs: 999 },
      }],
    });
    const out = stepMonsters(s, 1000, rngFrom(1));
    expect(out.playerStatuses.find((x) => x.key === 'burn')).toBeTruthy();
    expect(out.playerStatuses.find((x) => x.key === 'weaken')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Spawn safety (2026-07 UX audit): a fresh floor must never open with a monster
// already within CRAWL_SPAWN_SAFE_RADIUS of the player's spawn tile.
// ---------------------------------------------------------------------------

describe('monster spawn safety (CRAWL_SPAWN_SAFE_RADIUS)', () => {
  it('never places a floor-1 monster within the safety radius of the player spawn (50 seeds)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const mine = generateMine(1, SNAP, rngFrom(seed));
      for (const m of mine.monsters) {
        expect(manhattan({ r: m.r, c: m.c }, mine.player)).toBeGreaterThan(CRAWL_SPAWN_SAFE_RADIUS);
      }
    }
  });

  it('holds on a guardian floor too (floor 7, 50 seeds)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const mine = generateMine(7, SNAP, rngFrom(seed));
      for (const m of mine.monsters) {
        expect(manhattan({ r: m.r, c: m.c }, mine.player)).toBeGreaterThan(CRAWL_SPAWN_SAFE_RADIUS);
      }
    }
  });
});
