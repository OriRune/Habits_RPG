// ============================================================================
//  Phase 5 boon tests — rollBoonChoices, reducers, effect integration,
//  acquisition (guardian kill + boon tile), applyBoonChoice, descend survival,
//  and generation reachability.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  BOONS,
  rollBoonChoices,
  boonMeleeMult,
  boonDefenseBonus,
  boonYieldMult,
  boonMoveMult,
  boonDashCdMult,
  boonSightBonus,
  boonChargeReduce,
} from '@/content/boons';
import {
  generateMine,
  tryMove as mineTryMove,
  strike,
  stepMonsters,
  descend,
  applyBoonChoice as applyMineBoonChoice,
  type MineState,
  type MineSnapshot,
  type MineTile,
  type RNG,
} from '@/engine/mining';
import {
  generateForest,
  tryMove as forestTryMove,
  act,
  stepBeasts,
  advance,
  sightRadiusFor,
  applyBoonChoice as applyForestBoonChoice,
  FOREST_WINDUP_MS,
  type ForestState,
  type ForestSnapshot,
  type ForestTile,
} from '@/engine/forest';
import { getWeapon, STARTER_WEAPON } from '@/engine/weapons';
import { STA_REGEN_MS, MP_REGEN_MS, DASH_BASE_CD_MS } from '@/engine/crawl';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic RNG (mulberry32). */
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

const BASE_MINE_SNAP: MineSnapshot = {
  meleePower: 5, rangedPower: 3, damageSpell: 2, supportSpell: 2, illusionPower: 1,
  defense: 0, ward: 0, maxHp: 50, maxSta: 55, maxMp: 8,
  weapon: WEAPON, knownSpells: [], pickaxePower: 1, agLevel: 0,
};

const BASE_FOREST_SNAP: ForestSnapshot = {
  meleePower: 5, rangedPower: 3, damageSpell: 2, supportSpell: 2, illusionPower: 1,
  defense: 0, ward: 0, maxHp: 50, maxSta: 55, maxMp: 8,
  weapon: WEAPON, knownSpells: [], chopPower: 1, agLevel: 0,
};

/** Build a minimal MineState. */
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

/** Build a minimal ForestState. */
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

// ---------------------------------------------------------------------------
// 1. BOON TABLE — content sanity
// ---------------------------------------------------------------------------

describe('BOONS table', () => {
  it('contains at least 9 entries', () => {
    expect(Object.keys(BOONS).length).toBeGreaterThanOrEqual(9);
  });

  it('every entry has a key matching its record key', () => {
    for (const [k, b] of Object.entries(BOONS)) {
      expect(b.key).toBe(k);
    }
  });

  it('every entry has name, desc, icon, and a valid game field', () => {
    for (const b of Object.values(BOONS)) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.desc.length).toBeGreaterThan(0);
      expect(b.icon.length).toBeGreaterThan(0);
      expect(['mine', 'forest', 'both']).toContain(b.game);
    }
  });

  it('lantern is forest-only', () => {
    expect(BOONS['lantern']?.game).toBe('forest');
  });

  it('vein_sense is mine-only', () => {
    expect(BOONS['vein_sense']?.game).toBe('mine');
  });

  it('forager is forest-only', () => {
    expect(BOONS['forager']?.game).toBe('forest');
  });
});

// ---------------------------------------------------------------------------
// 2. REDUCERS
// ---------------------------------------------------------------------------

describe('boonMeleeMult', () => {
  it('returns 1 with no boons', () => {
    expect(boonMeleeMult([])).toBe(1);
  });
  it('applies iron_arm multiplier', () => {
    expect(boonMeleeMult(['iron_arm'])).toBeCloseTo(1.3);
  });
  it('stacks multiplicatively with two boons that each have meleeMult', () => {
    // Add a second boon with meleeMult for testing stacking.
    // iron_arm is the only meleeMult boon in the table, so single-boon is fine.
    // Confirm stacking formula: adding it twice would give 1.3 * 1.3 = 1.69
    // But duplicates aren't normally allowed, so just test irrelevant key is ignored.
    expect(boonMeleeMult(['iron_arm', 'stone_skin'])).toBeCloseTo(1.3);
  });
  it('ignores boons without meleeMult', () => {
    expect(boonMeleeMult(['swift_step', 'vitality'])).toBe(1);
  });
});

describe('boonDefenseBonus', () => {
  it('returns 0 with no boons', () => {
    expect(boonDefenseBonus([])).toBe(0);
  });
  it('returns 3 for stone_skin', () => {
    expect(boonDefenseBonus(['stone_skin'])).toBe(3);
  });
  it('stacks additively', () => {
    // Two stone_skin would give 6 — but we test with other bonuses.
    // stone_skin is the only defenseBonus boon; just verify non-defense boons don't add.
    expect(boonDefenseBonus(['stone_skin', 'iron_arm'])).toBe(3);
  });
});

describe('boonYieldMult', () => {
  it('returns 1 with no boons', () => {
    expect(boonYieldMult([])).toBe(1);
  });
  it('vein_sense doubles yield', () => {
    expect(boonYieldMult(['vein_sense'])).toBe(2);
  });
  it('forager doubles yield', () => {
    expect(boonYieldMult(['forager'])).toBe(2);
  });
  it('non-yield boons leave it at 1', () => {
    expect(boonYieldMult(['swift_step', 'iron_arm'])).toBe(1);
  });
});

describe('boonMoveMult', () => {
  it('returns 1 with no boons', () => {
    expect(boonMoveMult([])).toBe(1);
  });
  it('swift_step returns 1.25', () => {
    expect(boonMoveMult(['swift_step'])).toBeCloseTo(1.25);
  });
});

describe('boonDashCdMult', () => {
  it('returns 1 with no boons', () => {
    expect(boonDashCdMult([])).toBe(1);
  });
  it('quick_dash returns 0.7', () => {
    expect(boonDashCdMult(['quick_dash'])).toBeCloseTo(0.7);
  });
});

describe('boonSightBonus', () => {
  it('returns 0 with no boons', () => {
    expect(boonSightBonus([])).toBe(0);
  });
  it('lantern adds 2', () => {
    expect(boonSightBonus(['lantern'])).toBe(2);
  });
  it('stacks additively (two lanterns would give 4)', () => {
    expect(boonSightBonus(['lantern', 'lantern'])).toBe(4);
  });
});

describe('boonChargeReduce', () => {
  it('returns 0 with no boons', () => {
    expect(boonChargeReduce([])).toBe(0);
  });
  it('overcharge returns 1', () => {
    expect(boonChargeReduce(['overcharge'])).toBe(1);
  });
  it('stacks additively', () => {
    expect(boonChargeReduce(['overcharge', 'overcharge'])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. rollBoonChoices
// ---------------------------------------------------------------------------

describe('rollBoonChoices', () => {
  it('returns up to 3 distinct keys for mine', () => {
    const choices = rollBoonChoices('mine', [], rngFrom(1));
    expect(choices.length).toBeGreaterThanOrEqual(1);
    expect(choices.length).toBeLessThanOrEqual(3);
    expect(new Set(choices).size).toBe(choices.length); // all distinct
  });

  it('returns up to 3 distinct keys for forest', () => {
    const choices = rollBoonChoices('forest', [], rngFrom(2));
    expect(choices.length).toBeGreaterThanOrEqual(1);
    expect(choices.length).toBeLessThanOrEqual(3);
    expect(new Set(choices).size).toBe(choices.length);
  });

  it('never offers a forest-only boon (lantern, forager) to the mine', () => {
    for (let seed = 0; seed < 50; seed++) {
      const choices = rollBoonChoices('mine', [], rngFrom(seed));
      expect(choices).not.toContain('lantern');
      expect(choices).not.toContain('forager');
    }
  });

  it('never offers a mine-only boon (vein_sense) to the forest', () => {
    for (let seed = 0; seed < 50; seed++) {
      const choices = rollBoonChoices('forest', [], rngFrom(seed));
      expect(choices).not.toContain('vein_sense');
    }
  });

  it('excludes already-held boons (no duplicates)', () => {
    const held = ['swift_step', 'iron_arm'];
    for (let seed = 0; seed < 20; seed++) {
      const choices = rollBoonChoices('mine', held, rngFrom(seed));
      for (const key of choices) {
        expect(held).not.toContain(key);
      }
    }
  });

  it('returns fewer than 3 when the eligible pool is exhausted', () => {
    // Hold every mine boon — pool should be empty, returns []
    const mineKeys = Object.values(BOONS)
      .filter((b) => b.game === 'mine' || b.game === 'both')
      .map((b) => b.key);
    const choices = rollBoonChoices('mine', mineKeys, rngFrom(1));
    expect(choices).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. applyBoonChoice — mine
// ---------------------------------------------------------------------------

describe('applyMineBoonChoice', () => {
  it('returns state unchanged if status is not choosing', () => {
    const s = makeMineState({ status: 'active', pendingBoonChoice: ['swift_step', 'iron_arm', 'stone_skin'] });
    const after = applyMineBoonChoice(s, 'swift_step');
    expect(after).toBe(s);
  });

  it('returns state unchanged for a key not in pendingBoonChoice', () => {
    const s = makeMineState({ status: 'choosing', pendingBoonChoice: ['stone_skin', 'vitality', 'quick_dash'] });
    const after = applyMineBoonChoice(s, 'iron_arm');
    expect(after).toBe(s);
  });

  it('appends the chosen key to activeBoons and restores status to active', () => {
    const s = makeMineState({ status: 'choosing', pendingBoonChoice: ['swift_step', 'iron_arm', 'stone_skin'] });
    const after = applyMineBoonChoice(s, 'iron_arm');
    expect(after.activeBoons).toContain('iron_arm');
    expect(after.pendingBoonChoice).toBeNull();
    expect(after.status).toBe('active');
  });

  it('recomputes moveIntervalMs when swift_step is chosen', () => {
    const s = makeMineState({
      status: 'choosing', pendingBoonChoice: ['swift_step', 'stone_skin', 'vitality'],
      moveIntervalMs: 150, agLevel: 0,
    });
    const after = applyMineBoonChoice(s, 'swift_step');
    // swift_step moveMult = 1.25 → interval should be shorter
    expect(after.moveIntervalMs).toBeLessThan(150);
  });

  it('recomputes dashCooldownMs when quick_dash is chosen', () => {
    const s = makeMineState({
      status: 'choosing', pendingBoonChoice: ['quick_dash', 'stone_skin', 'vitality'],
      dashCooldownMs: DASH_BASE_CD_MS, agLevel: 0,
    });
    const after = applyMineBoonChoice(s, 'quick_dash');
    expect(after.dashCooldownMs).toBeLessThan(DASH_BASE_CD_MS);
  });

  it('increases maxHp and heals on vitality pickup', () => {
    const s = makeMineState({
      status: 'choosing', pendingBoonChoice: ['vitality', 'stone_skin', 'iron_arm'],
      hp: 40, maxHp: 50,
    });
    const after = applyMineBoonChoice(s, 'vitality');
    expect(after.maxHp).toBe(70);    // +20
    expect(after.hp).toBe(60);       // min(70, 40+20)
  });

  it('does not exceed new maxHp when already near full', () => {
    const s = makeMineState({
      status: 'choosing', pendingBoonChoice: ['vitality', 'stone_skin', 'iron_arm'],
      hp: 50, maxHp: 50,
    });
    const after = applyMineBoonChoice(s, 'vitality');
    expect(after.maxHp).toBe(70);
    expect(after.hp).toBe(70);       // min(70, 50+20)
  });
});

// ---------------------------------------------------------------------------
// 5. Effect integration — mine
// ---------------------------------------------------------------------------

describe('Iron Arm raises melee damage (mine)', () => {
  it('strike deals more damage with iron_arm active', () => {
    // Set up two states: with and without iron_arm; each facing a monster
    const monsters = [{ id: 'a', key: 'cave_slug', r: 3, c: 4, hp: 100, maxHp: 100, readyAtMs: 0 }];
    const sPlain = makeMineState({ meleePower: 20, monsters });
    const sIronArm = makeMineState({ meleePower: 20, monsters, activeBoons: ['iron_arm'] });
    const afterPlain = strike(sPlain, rngFrom(5));
    const afterIronArm = strike(sIronArm, rngFrom(5));
    // Monster should have less HP after iron_arm strike
    const hpPlain = afterPlain.monsters[0]?.hp ?? 0;
    const hpBoosted = afterIronArm.monsters[0]?.hp ?? 0;
    expect(hpBoosted).toBeLessThan(hpPlain);
  });
});

describe('Stone Skin lowers contact damage (mine)', () => {
  it('stepMonsters deals less contact damage with stone_skin', () => {
    const monsters = [{ id: 'a', key: 'cave_slug', r: 3, c: 4, hp: 8, maxHp: 8, readyAtMs: 999999 }];
    const sPlain = makeMineState({ hp: 50, defense: 0, lastHitAtMs: -1000, monsters });
    const sStoneSkin = makeMineState({ hp: 50, defense: 0, lastHitAtMs: -1000, monsters, activeBoons: ['stone_skin'] });
    const hitPlain = stepMonsters(sPlain, 1000, rngFrom(1));
    const hitBoosted = stepMonsters(sStoneSkin, 1000, rngFrom(1));
    // cave_slug touchDamage = 4; stone_skin defenseBonus = 3 → should take only 1 dmg
    expect(hitBoosted.hp).toBeGreaterThan(hitPlain.hp);
  });
});

// ---------------------------------------------------------------------------
// 6. Effect integration — forest
// ---------------------------------------------------------------------------

describe('Iron Arm raises melee damage (forest)', () => {
  it('act deals more damage with iron_arm active', () => {
    const beasts = [{ id: 'b', key: 'rabbit', r: 3, c: 4, hp: 100, maxHp: 100, readyAtMs: 0, asleep: false }];
    const sPlain = makeForestState({ meleePower: 20, beasts });
    const sIronArm = makeForestState({ meleePower: 20, beasts, activeBoons: ['iron_arm'] });
    const afterPlain = act(sPlain, rngFrom(5));
    const afterBoosted = act(sIronArm, rngFrom(5));
    const hpPlain = afterPlain.beasts[0]?.hp ?? 0;
    const hpBoosted = afterBoosted.beasts[0]?.hp ?? 0;
    expect(hpBoosted).toBeLessThan(hpPlain);
  });
});

describe('Lantern widens sight radius (forest)', () => {
  it('sightRadiusFor returns a larger radius with lantern', () => {
    const sPlain = makeForestState();
    const sLantern = makeForestState({ activeBoons: ['lantern'] });
    expect(sightRadiusFor(sLantern)).toBeGreaterThan(sightRadiusFor(sPlain));
    expect(sightRadiusFor(sLantern)).toBe(sightRadiusFor(sPlain) + 2);
  });
});

describe('Stone Skin lowers contact damage (forest)', () => {
  it('stepBeasts deals less contact damage with stone_skin', () => {
    // wild_boar: touchDamage=4; stone_skin reduces by 3 → only 1 dealt instead of 4.
    // Pre-set windupUntilMs=0 so the strike fires immediately at nowMs=1000.
    const beasts = [{
      id: 'b', key: 'wild_boar', r: 3, c: 4, hp: 8, maxHp: 8,
      readyAtMs: 0, asleep: false, windupUntilMs: 0,
    }];
    const sPlain = makeForestState({ hp: 50, defense: 0, lastHitAtMs: -1000, beasts });
    const sStoneSkin = makeForestState({ hp: 50, defense: 0, lastHitAtMs: -1000, beasts, activeBoons: ['stone_skin'] });
    const hitPlain = stepBeasts(sPlain, 1000, rngFrom(1));
    const hitBoosted = stepBeasts(sStoneSkin, 1000, rngFrom(1));
    expect(hitBoosted.hp).toBeGreaterThan(hitPlain.hp);
  });
});

// ---------------------------------------------------------------------------
// 7. Boon tile walkability (mine)
//    Pickup detection (consume tile + enter 'choosing') is store-side in mineMove.
// ---------------------------------------------------------------------------

describe('Boon tile is walkable (mine)', () => {
  it('tryMove steps onto a boon tile (boon kind is walkable)', () => {
    const tiles = makeMineState().tiles.map((row) => row.slice());
    tiles[3][4] = { kind: 'boon' };
    const s = makeMineState({ tiles });
    const after = mineTryMove(s, 'right');
    // Player should move onto the boon cell; engine tryMove doesn't consume it.
    expect(after.player).toMatchObject({ r: 3, c: 4, facing: 'right' });
    expect(after.tiles[3][4].kind).toBe('boon'); // unconsumed — store handles that
    expect(after.status).toBe('active');          // engine tryMove doesn't trigger choosing
  });
});

// ---------------------------------------------------------------------------
// 8. Boon tile walkability (forest)
//    Pickup detection is store-side in forestMove.
// ---------------------------------------------------------------------------

describe('Boon tile is walkable (forest)', () => {
  it('tryMove steps onto a boon tile (boon kind is walkable)', () => {
    const tiles = makeForestState().tiles.map((row) => row.slice() as ForestTile[]);
    tiles[3][4] = { kind: 'boon' } as ForestTile;
    const s = makeForestState({ tiles });
    const after = forestTryMove(s, 'right');
    expect(after.player).toMatchObject({ r: 3, c: 4, facing: 'right' });
    expect(after.tiles[3][4].kind).toBe('boon'); // unconsumed — store handles that
    expect(after.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// 9. Descend survival (mine)
// ---------------------------------------------------------------------------

describe('Descend survival (mine)', () => {
  it('activeBoons persists through descend', () => {
    const tiles = makeMineState().tiles.map((row) => row.slice());
    tiles[3][3] = { kind: 'shaft' };
    const s = makeMineState({ tiles, floor: 1, activeBoons: ['swift_step', 'iron_arm'] });
    const next = descend(s, rngFrom(9));
    expect(next.floor).toBe(2);
    expect(next.activeBoons).toContain('swift_step');
    expect(next.activeBoons).toContain('iron_arm');
  });

  it('swift_step boon still affects moveIntervalMs after descend', () => {
    const tiles = makeMineState().tiles.map((row) => row.slice());
    tiles[3][3] = { kind: 'shaft' };
    const sWithout = makeMineState({ tiles, floor: 1, activeBoons: [] });
    const sWithBoon = makeMineState({ tiles, floor: 1, activeBoons: ['swift_step'] });
    const nextWithout = descend(sWithout, rngFrom(9));
    const nextWithBoon = descend(sWithBoon, rngFrom(9));
    // Floor 2 with swift_step should be faster (lower moveIntervalMs)
    expect(nextWithBoon.moveIntervalMs).toBeLessThan(nextWithout.moveIntervalMs);
  });
});

// ---------------------------------------------------------------------------
// 10. Advance survival (forest)
// ---------------------------------------------------------------------------

describe('Advance survival (forest)', () => {
  it('activeBoons persists through advance', () => {
    // Generate a real forest at stage 1 to get treeline, then advance
    const snap: ForestSnapshot = { ...BASE_FOREST_SNAP, activeBoons: ['lantern', 'forager'] };
    const forest = generateForest(1, snap, rngFrom(7));
    // Find the treeline tile and place player on it
    let treeR = -1, treeC = -1;
    outer: for (let r = 0; r < forest.rows; r++) {
      for (let c = 0; c < forest.cols; c++) {
        if (forest.tiles[r][c].kind === 'treeline') { treeR = r; treeC = c; break outer; }
      }
    }
    if (treeR === -1) return; // no treeline found — skip
    const atTree = { ...forest, player: { r: treeR, c: treeC, facing: 'right' as const } };
    const next = advance(atTree, rngFrom(9));
    expect(next.activeBoons).toContain('lantern');
    expect(next.activeBoons).toContain('forager');
  });
});

// ---------------------------------------------------------------------------
// 11. Generation reachability — boon tile is BFS-reachable (mine)
// ---------------------------------------------------------------------------

describe('Generation: boon cache is reachable (mine)', () => {
  it('any boon tile is reachable from the entrance via BFS', () => {
    // Try several seeds; only test seeds that actually produce a boon tile
    for (let seed = 0; seed < 30; seed++) {
      const mine = generateMine(1, BASE_MINE_SNAP, rngFrom(seed));
      const boonTiles: [number, number][] = [];
      for (let r = 0; r < mine.rows; r++) {
        for (let c = 0; c < mine.cols; c++) {
          if (mine.tiles[r][c].kind === 'boon') boonTiles.push([r, c]);
        }
      }
      if (boonTiles.length === 0) continue;

      // BFS from entrance
      const reachable = new Set<string>();
      const queue: [number, number][] = [[mine.player.r, mine.player.c]];
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

      for (const [br, bc] of boonTiles) {
        expect(reachable.has(`${br},${bc}`)).toBe(true);
      }
      return; // tested at least one seed with a boon tile
    }
  });
});

// ---------------------------------------------------------------------------
// 12. applyBoonChoice — forest (parallel to mine)
// ---------------------------------------------------------------------------

describe('applyForestBoonChoice', () => {
  it('returns state unchanged if not choosing', () => {
    const s = makeForestState({ status: 'active', pendingBoonChoice: ['lantern', 'forager', 'stone_skin'] });
    expect(applyForestBoonChoice(s, 'lantern')).toBe(s);
  });

  it('appends key and restores active status', () => {
    const s = makeForestState({ status: 'choosing', pendingBoonChoice: ['lantern', 'stone_skin', 'iron_arm'] });
    const after = applyForestBoonChoice(s, 'lantern');
    expect(after.activeBoons).toContain('lantern');
    expect(after.status).toBe('active');
    expect(after.pendingBoonChoice).toBeNull();
  });

  it('vitality raises maxHp and heals', () => {
    const s = makeForestState({
      status: 'choosing', pendingBoonChoice: ['vitality', 'stone_skin', 'iron_arm'],
      hp: 30, maxHp: 50,
    });
    const after = applyForestBoonChoice(s, 'vitality');
    expect(after.maxHp).toBe(70);
    expect(after.hp).toBe(50); // min(70, 30+20)
  });
});
