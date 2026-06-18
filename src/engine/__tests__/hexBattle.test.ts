import { describe, it, expect } from 'vitest';
import {
  moveTilesFor,
  climbFor,
  heightDamageMult,
  heightRangeBonus,
  computeReachable,
  hasLineOfSight,
  computeTargetable,
  selectAction,
  movePlayer,
  playerAttack,
  playerCastSpell,
  endPlayerTurn,
  generateSkirmish,
  tacticsReward,
  TACTICS_SIZE_RADIUS,
  TACTICS_GRANTED_SPELLS,
  OCCLUSION_RISE,
  COVER_DEFENSE,
  HAZARD_DMG,
  type HexBattleState,
  type PlayerUnit,
  type EnemyUnit,
  type Tile,
} from '../hexBattle';
import { hexBoard, hexKey, hexDistance, type Hex } from '../hex';
import type { Fighter, Combatant } from '../combat';
import type { WeaponDef } from '../weapons';

// --- Fixtures -----------------------------------------------------------------------------------
const SWORD: WeaponDef = {
  key: 'test_sword', name: 'Test Sword', attackStat: 'ST', bonus: 5, staminaCost: 2, description: '',
};
const BOW: WeaponDef = {
  key: 'test_bow', name: 'Test Bow', attackStat: 'DX', bonus: 4, staminaCost: 2, ranged: true, range: 3, description: '',
};

/** Deterministic rng → variance multiplier of exactly 1.0 (0.85 + 0.5*0.3 = 1.0). */
const HALF = () => 0.5;
/** rng that always rolls 0.99 — never triggers dodge/blind chance gates. */
const HIGH = () => 0.99;

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tilesFor(radius: number): Record<string, Tile> {
  const t: Record<string, Tile> = {};
  for (const hex of hexBoard(radius)) t[hexKey(hex)] = { hex, elevation: 0, terrain: 'floor' };
  return t;
}

function setTile(tiles: Record<string, Tile>, h: Hex, over: Partial<Tile>): void {
  tiles[hexKey(h)] = { ...tiles[hexKey(h)], ...over };
}

function makePlayer(hex: Hex, over: Partial<PlayerUnit> = {}): PlayerUnit {
  return {
    hex, hp: 100, maxHp: 100, mp: 30, maxMp: 30, sta: 20, maxSta: 20,
    movesLeft: 4, hasActed: false, ag: 8,
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

function makeState(over: Partial<HexBattleState> = {}): HexBattleState {
  const radius = over.radius ?? 3;
  return {
    radius,
    tiles: over.tiles ?? tilesFor(radius),
    player: over.player ?? makePlayer({ q: 0, r: 0 }),
    enemies: over.enemies ?? [],
    turn: 'player', selected: null, reachable: [], targetable: [], effects: [],
    log: [], status: 'active', tier: 5, knownSpells: ['sparks', 'mend', 'dazzle'],
    weapon: SWORD, seq: 100, threatHexes: [], intentPlan: [], ...over,
  };
}

function fighter(over: Partial<Combatant> = {}): Fighter {
  const c: Combatant = {
    maxHp: 100, maxMp: 20, maxSta: 12, meleePower: 10, rangedPower: 8, dodge: 0.1, flee: 0,
    damageSpell: 6, supportSpell: 6, illusionPower: 4, defense: 0, ward: 0, ...over,
  };
  return { c, weapon: SWORD };
}

// --- Formulas -----------------------------------------------------------------------------------
describe('AG / elevation formulas', () => {
  it('moveTilesFor scales with AG and caps at 6', () => {
    expect(moveTilesFor(1)).toBe(2);
    expect(moveTilesFor(8)).toBe(4);
    expect(moveTilesFor(16)).toBe(6);
    expect(moveTilesFor(25)).toBe(6);
  });

  it('climbFor scales with AG and caps at 3', () => {
    expect(climbFor(1)).toBe(1);
    expect(climbFor(8)).toBe(2);
    expect(climbFor(16)).toBe(3);
    expect(climbFor(25)).toBe(3);
  });

  it('height damage favours the high ground, clamped', () => {
    expect(heightDamageMult(0)).toBe(1);
    expect(heightDamageMult(1)).toBeCloseTo(1.12);
    expect(heightDamageMult(-1)).toBeCloseTo(0.88);
    expect(heightDamageMult(10)).toBe(1.36); // clamp high
    expect(heightDamageMult(-10)).toBe(0.64); // clamp low
  });

  it('height range bonus is +1 per level up, max +2, never negative', () => {
    expect(heightRangeBonus(0)).toBe(0);
    expect(heightRangeBonus(1)).toBe(1);
    expect(heightRangeBonus(5)).toBe(2);
    expect(heightRangeBonus(-3)).toBe(0);
  });
});

// --- Movement -----------------------------------------------------------------------------------
describe('computeReachable', () => {
  it('respects the movement budget', () => {
    const s = makeState();
    expect(computeReachable(s, { q: 0, r: 0 }, 1, 3)).toHaveLength(6); // ring 1
    expect(computeReachable(s, { q: 0, r: 0 }, 2, 3)).toHaveLength(18); // rings 1+2
  });

  it('a slow tile costs 2 movement', () => {
    const s = makeState();
    setTile(s.tiles, { q: 1, r: 0 }, { terrain: 'slow' });
    const reach1 = computeReachable(s, { q: 0, r: 0 }, 1, 3).map(hexKey);
    expect(reach1).not.toContain('1,0'); // cost 2 > budget 1
    const reach2 = computeReachable(s, { q: 0, r: 0 }, 2, 3).map(hexKey);
    expect(reach2).toContain('1,0');
  });

  it('respects the climb limit on ascent', () => {
    const s = makeState();
    setTile(s.tiles, { q: 1, r: 0 }, { elevation: 2 });
    expect(computeReachable(s, { q: 0, r: 0 }, 1, 1).map(hexKey)).not.toContain('1,0');
    expect(computeReachable(s, { q: 0, r: 0 }, 1, 2).map(hexKey)).toContain('1,0');
  });

  it('allows free descent regardless of climb limit', () => {
    // Mover stands on a high tile; a low neighbour is always reachable.
    const s = makeState({ player: makePlayer({ q: 1, r: 0 }) });
    setTile(s.tiles, { q: 1, r: 0 }, { elevation: 2 });
    expect(computeReachable(s, { q: 1, r: 0 }, 1, 1).map(hexKey)).toContain('0,0');
  });

  it('routes around blocked terrain and occupied tiles', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 1, r: 0 })] });
    setTile(s.tiles, { q: 0, r: 1 }, { terrain: 'blocked' });
    const reach = computeReachable(s, { q: 0, r: 0 }, 1, 3).map(hexKey);
    expect(reach).not.toContain('1,0'); // occupied by enemy
    expect(reach).not.toContain('0,1'); // blocked wall
    expect(reach.length).toBe(4); // the other 4 neighbours remain
  });
});

// --- Line of sight ------------------------------------------------------------------------------
describe('hasLineOfSight', () => {
  const a: Hex = { q: 0, r: 0 };
  const b: Hex = { q: 3, r: 0 };

  it('is clear over flat ground', () => {
    expect(hasLineOfSight(makeState(), a, b)).toBe(true);
  });

  it('is blocked by a wall between the endpoints', () => {
    const s = makeState();
    setTile(s.tiles, { q: 1, r: 0 }, { terrain: 'blocked' });
    expect(hasLineOfSight(s, a, b)).toBe(false);
  });

  it('is blocked by a ridge taller than both endpoints', () => {
    const s = makeState();
    setTile(s.tiles, { q: 1, r: 0 }, { elevation: 1 });
    expect(hasLineOfSight(s, a, b)).toBe(false); // ridge 1 > max(0,0)
    setTile(s.tiles, { q: 0, r: 0 }, { elevation: 1 }); // now an endpoint is as tall as the ridge
    expect(hasLineOfSight(s, a, b)).toBe(true);
  });

  it('is blocked by a unit standing in the way', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 2, r: 0 })] });
    expect(hasLineOfSight(s, a, b)).toBe(false);
  });
});

// --- Targeting ----------------------------------------------------------------------------------
describe('computeTargetable', () => {
  it('melee hits only adjacent enemies', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 1, r: 0 }), makeEnemy(2, { q: 2, r: 0 })] });
    const hits = computeTargetable(s, { kind: 'attack' }).map(hexKey);
    expect(hits).toContain('1,0');
    expect(hits).not.toContain('2,0');
  });

  it('ranged reach extends with height advantage', () => {
    const s = makeState({ radius: 4, tiles: tilesFor(4), weapon: BOW, enemies: [makeEnemy(1, { q: 4, r: 0 })] });
    // Flat ground: range 3 can't reach distance 4.
    expect(computeTargetable(s, { kind: 'attack' }).map(hexKey)).not.toContain('4,0');
    // Player on a +1 ledge: effective range 4 reaches it.
    setTile(s.tiles, { q: 0, r: 0 }, { elevation: 1 });
    expect(computeTargetable(s, { kind: 'attack' }).map(hexKey)).toContain('4,0');
  });

  it('returns nothing once the player has acted', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 1, r: 0 })], player: makePlayer({ q: 0, r: 0 }, { hasActed: true }) });
    expect(computeTargetable(s, { kind: 'attack' })).toHaveLength(0);
  });
});

describe('selectAction', () => {
  it('populates the reachable cache when Move is selected', () => {
    const s = selectAction(makeState(), { kind: 'move' });
    expect(s.reachable.length).toBeGreaterThan(0);
    expect(s.targetable).toHaveLength(0);
  });
});

describe('movePlayer', () => {
  it('spends movement, relocates the player, and never consumes the action', () => {
    const s = makeState({ player: makePlayer({ q: 0, r: 0 }, { movesLeft: 4 }) });
    const next = movePlayer(s, { q: 2, r: 0 });
    expect(next.player.hex).toEqual({ q: 2, r: 0 });
    expect(next.player.movesLeft).toBe(2); // 4 − 2 tiles
    expect(next.player.hasActed).toBe(false);
  });

  it('rejects an unreachable destination', () => {
    const s = makeState({ player: makePlayer({ q: 0, r: 0 }, { movesLeft: 1 }) });
    expect(movePlayer(s, { q: 3, r: 0 })).toBe(s);
  });

  it('a slow tile consumes extra movement', () => {
    const s = makeState({ player: makePlayer({ q: 0, r: 0 }, { movesLeft: 4 }) });
    setTile(s.tiles, { q: 1, r: 0 }, { terrain: 'slow' });
    const next = movePlayer(s, { q: 1, r: 0 });
    expect(next.player.movesLeft).toBe(2); // 4 − 2 (slow)
  });
});

// --- Player actions: damage parity with combat primitives ---------------------------------------
describe('playerAttack', () => {
  it('melee damage matches the height-scaled attackRoll (high ground bonus)', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 1, r: 0 })] });
    setTile(s.tiles, { q: 0, r: 0 }, { elevation: 1 }); // player +1 over the foe
    const next = playerAttack(s, { q: 1, r: 0 }, HALF);
    // base = meleePower*1.12 + bonus = 11.2 + 5 = 16.2 → round 16
    expect(next.enemies[0].hp).toBe(30 - 16);
    expect(next.player.hasActed).toBe(true);
    expect(next.player.sta).toBe(18); // 20 − staminaCost 2
    expect(next.effects.some((e) => e.kind === 'melee')).toBe(true);
  });

  it('cover grants the defender flat mitigation', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 1, r: 0 })] });
    setTile(s.tiles, { q: 1, r: 0 }, { terrain: 'cover' });
    const next = playerAttack(s, { q: 1, r: 0 }, HALF);
    // flat: base 15 − COVER_DEFENSE = 15 − 3 = 12
    expect(next.enemies[0].hp).toBe(30 - (15 - COVER_DEFENSE));
  });

  it('does not mutate the input state (immutability)', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 1, r: 0 })] });
    const beforeHp = s.enemies[0].hp;
    playerAttack(s, { q: 1, r: 0 }, HALF);
    expect(s.enemies[0].hp).toBe(beforeHp);
  });

  it('ignores illegal (out-of-range) targets', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 2, r: 0 })] });
    expect(playerAttack(s, { q: 2, r: 0 }, HALF)).toBe(s);
  });

  it('a fired arrow uses the ranged power and emits an arrow effect', () => {
    const s = makeState({ weapon: BOW, enemies: [makeEnemy(1, { q: 3, r: 0 })] });
    const next = playerAttack(s, { q: 3, r: 0 }, HALF);
    // base = rangedPower 8 + bonus 4 = 12 → round 12
    expect(next.enemies[0].hp).toBe(30 - 12);
    expect(next.effects.some((e) => e.kind === 'arrow')).toBe(true);
  });
});

describe('playerCastSpell', () => {
  it('sparks deals Wisdom-scaled magic damage and spends MP', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 1, r: 0 })] });
    const next = playerCastSpell(s, 'sparks', { q: 1, r: 0 }, HALF);
    // base = power 8 + damageSpell 6*1.2 = 15.2 → round 15
    expect(next.enemies[0].hp).toBe(30 - 15);
    expect(next.player.mp).toBe(30 - 4); // sparks mpCost 4
    expect(next.effects.some((e) => e.kind === 'spell:sparks')).toBe(true);
  });

  it('mend heals the caster (no target required)', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 2, r: 0 })], player: makePlayer({ q: 0, r: 0 }, { hp: 50 }) });
    const next = playerCastSpell(s, 'mend', null, HALF);
    // heal = power 14 + supportSpell 6*1.5 = 23
    expect(next.player.hp).toBe(50 + 23);
    expect(next.player.mp).toBe(30 - 6);
  });
});

// --- Enemy AI -----------------------------------------------------------------------------------
describe('enemy turn', () => {
  it('an out-of-range foe closes the distance, then strikes when adjacent', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 3, r: 0 }, { attack: 8 })] });
    const next = endPlayerTurn(s, HIGH); // HIGH rng avoids the dodge gate
    expect(hexDistance(next.enemies[0].hex, next.player.hex)).toBeLessThan(3);
    expect(next.player.hp).toBeLessThan(100); // it reached melee and hit
  });

  it('walls block the AI from reaching the player', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 3, r: 0 })] });
    // Box the player in: every neighbour is an impassable wall.
    for (const n of [
      { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 1 },
    ]) {
      setTile(s.tiles, n, { terrain: 'blocked' });
    }
    const next = endPlayerTurn(s, HIGH);
    expect(hexDistance(next.enemies[0].hex, next.player.hex)).toBeGreaterThanOrEqual(2);
    expect(next.player.hp).toBe(100); // never got in range
  });

  it('a frozen foe cannot act', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 1, r: 0 }, { statuses: [{ key: 'freeze', turns: 2, magnitude: 1 }] })] });
    const next = endPlayerTurn(s, HIGH);
    expect(next.player.hp).toBe(100); // it was adjacent but frozen
  });
});

// --- End-of-turn DoT --------------------------------------------------------------------------
describe('end-of-turn ticks', () => {
  it('a hazard tile burns its occupant', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 3, r: 0 }, { moveTiles: 0 })] });
    setTile(s.tiles, { q: 0, r: 0 }, { terrain: 'hazard' });
    const next = endPlayerTurn(s, HIGH);
    expect(next.player.hp).toBe(100 - HAZARD_DMG);
  });

  it('burn ticks damage and decays', () => {
    const s = makeState({
      enemies: [makeEnemy(1, { q: 3, r: 0 }, { moveTiles: 0, statuses: [{ key: 'burn', turns: 2, magnitude: 5 }] })],
    });
    const next = endPlayerTurn(s, HIGH);
    expect(next.enemies[0].hp).toBe(30 - 5);
    expect(next.enemies[0].statuses[0].turns).toBe(1);
  });
});

// --- Outcomes -----------------------------------------------------------------------------------
describe('win / lose detection', () => {
  it('killing the last foe wins', () => {
    const s = makeState({ enemies: [makeEnemy(1, { q: 1, r: 0 }, { hp: 1 })] });
    const next = playerAttack(s, { q: 1, r: 0 }, HALF);
    expect(next.status).toBe('won');
    expect(next.enemies).toHaveLength(0);
  });

  it('the player dying during the enemy phase loses and stops the loop', () => {
    const s = makeState({
      player: makePlayer({ q: 0, r: 0 }, { hp: 1 }),
      enemies: [makeEnemy(1, { q: 1, r: 0 }, { attack: 50 }), makeEnemy(2, { q: 0, r: 1 }, { attack: 50 })],
    });
    const next = endPlayerTurn(s, HIGH);
    expect(next.status).toBe('lost');
    expect(next.player.hp).toBe(0);
  });
});

// --- Reward -------------------------------------------------------------------------------------
describe('tacticsReward', () => {
  it('pays scaling gold on a win and nothing otherwise', () => {
    expect(tacticsReward(makeState({ status: 'won', tier: 5 }))).toEqual({ gold: 70 });
    expect(tacticsReward(makeState({ status: 'lost', tier: 5 }))).toEqual({});
    expect(tacticsReward(makeState({ status: 'active', tier: 5 }))).toEqual({});
  });

  it('adds a potion at higher tiers', () => {
    expect(tacticsReward(makeState({ status: 'won', tier: 8 })).items).toEqual(['healing_potion']);
  });
});

// --- Generation ---------------------------------------------------------------------------------
describe('generateSkirmish', () => {
  it('builds a valid, connected board with scaled foes', () => {
    const s = generateSkirmish(fighter(), 8, 5, ['sparks', 'mend', 'fire_rune'], { rng: seeded(42) });
    expect(s.status).toBe('active');
    expect(Object.keys(s.tiles)).toHaveLength(37); // radius-3 board
    expect(s.enemies.length).toBeGreaterThanOrEqual(2);
    expect(s.enemies.length).toBeLessThanOrEqual(5);
    expect(s.player.hex).toEqual({ q: 0, r: 3 });
    expect(s.player.movesLeft).toBe(moveTilesFor(8));
    // Mechanic spells are filtered out of the action set.
    expect(s.knownSpells).not.toContain('fire_rune');
    expect(s.knownSpells).toContain('sparks');
    // Positional spells are always granted regardless of inventory.
    for (const k of TACTICS_GRANTED_SPELLS) expect(s.knownSpells).toContain(k);
    // Every enemy spawn is reachable from the player spawn (board not walled off).
    const reachable = new Set<string>([hexKey(s.player.hex)]);
    let frontier = [s.player.hex];
    const occupied = new Set(s.enemies.map((e) => hexKey(e.hex)));
    while (frontier.length) {
      const next: Hex[] = [];
      for (const cur of frontier) {
        for (const n of hexBoard(s.radius)) {
          if (hexDistance(cur, n) !== 1) continue;
          const key = hexKey(n);
          if (reachable.has(key) || s.tiles[key].terrain === 'blocked') continue;
          reachable.add(key);
          next.push(n);
        }
      }
      frontier = next;
    }
    for (const key of occupied) expect(reachable.has(key)).toBe(true);
  });

  it('always grants push/blink/cleave even when the player has no spellbooks', () => {
    // A brand-new character has only starter spells — no positional spellbooks found.
    const noBooks = generateSkirmish(fighter(), 8, 4, ['sparks', 'mend'], { rng: seeded(1) });
    for (const k of TACTICS_GRANTED_SPELLS) expect(noBooks.knownSpells).toContain(k);
    // Arena-only mechanics still filtered out even if somehow in inventory.
    const withRune = generateSkirmish(fighter(), 8, 4, ['fire_rune', 'chaotic_blink'], { rng: seeded(2) });
    expect(withRune.knownSpells).not.toContain('fire_rune');
    expect(withRune.knownSpells).not.toContain('chaotic_blink');
    // Deduplication: if the player already owned push/blink/cleave, no duplicates.
    const withAll = generateSkirmish(fighter(), 8, 4, ['push', 'blink', 'cleave', 'sparks'], { rng: seeded(3) });
    expect(withAll.knownSpells.filter((k) => k === 'push')).toHaveLength(1);
  });

  it('maps sizes to radii and scales the board + enemy count up with size', () => {
    expect(TACTICS_SIZE_RADIUS).toEqual({ small: 3, medium: 4, large: 6 });
    const small = generateSkirmish(fighter(), 8, 5, ['sparks'], { radius: TACTICS_SIZE_RADIUS.small, rng: seeded(7) });
    const large = generateSkirmish(fighter(), 8, 5, ['sparks'], { radius: TACTICS_SIZE_RADIUS.large, rng: seeded(7) });
    expect(Object.keys(small.tiles)).toHaveLength(37); // radius 3
    expect(Object.keys(large.tiles)).toHaveLength(127); // radius 6
    expect(large.enemies.length).toBeGreaterThan(small.enemies.length);
    expect(large.enemies.length).toBeLessThanOrEqual(8);
    // Large board stays connected (player can reach every enemy spawn).
    const reachable = new Set<string>([hexKey(large.player.hex)]);
    let frontier = [large.player.hex];
    while (frontier.length) {
      const next: Hex[] = [];
      for (const cur of frontier) {
        for (const n of hexBoard(large.radius)) {
          if (hexDistance(cur, n) !== 1) continue;
          const key = hexKey(n);
          if (reachable.has(key) || large.tiles[key].terrain === 'blocked') continue;
          reachable.add(key);
          next.push(n);
        }
      }
      frontier = next;
    }
    for (const e of large.enemies) expect(reachable.has(hexKey(e.hex))).toBe(true);
  });

  it('no tile towers more than OCCLUSION_RISE over the tile directly behind it (the up neighbour)', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = generateSkirmish(fighter(), 12, 8, ['sparks'], { radius: 6, rng: seeded(seed) });
      for (const tile of Object.values(s.tiles)) {
        const b = s.tiles[hexKey({ q: tile.hex.q, r: tile.hex.r - 1 })]; // directly behind
        if (b) expect(tile.elevation - b.elevation).toBeLessThanOrEqual(OCCLUSION_RISE);
      }
    }
  });
});
