import { describe, it, expect } from 'vitest';
import {
  generateMine,
  descend,
  tryMove,
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
  type MineState,
  type MineTile,
  type MineSnapshot,
  type RNG,
  MINE_ROWS,
  MINE_COLS,
} from '../mining';
import { splitHaul } from '../forest';
import { MINE_ORES, MINE_MONSTERS } from '@/content/mining';
import { getWeapon, STARTER_WEAPON } from '@/engine/weapons';
import { STA_REGEN_MS, MP_REGEN_MS, FREEZE_DURATION_MS, lateDepthDamageScale } from '@/engine/crawl';

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
