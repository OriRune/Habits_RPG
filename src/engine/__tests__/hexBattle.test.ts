import { describe, it, expect } from 'vitest';
import {
  moveTilesFor,
  climbFor,
  heightDamageMult,
  heightRangeBonus,
  computeReachable,
  hasLineOfSight,
  computeTargetable,
  computeEnemyThreat,
  planEnemyIntents,
  previewPlayerAttack,
  previewSpell,
  selectAction,
  movePlayer,
  playerAttack,
  playerCastSpell,
  holdOverwatch,
  endPlayerTurn,
  generateSkirmish,
  isTacticsLoadoutSpell,
  tacticsDamageFraction,
  tacticsReward,
  TACTICS_SIZE_RADIUS,
  TACTICS_GRANTED_SPELLS,
  OCCLUSION_RISE,
  COVER_DEFENSE,
  HAZARD_DMG,
  type HexBattleState,
  type PlayerUnit,
  type EnemyUnit,
  type TacticsObjective,
  type Tile,
} from '../hexBattle';
import { hexBoard, hexKey, hexDistance, hexEquals, type Hex } from '../hex';
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

function makeState(over: Partial<HexBattleState> = {}): HexBattleState {
  const radius = over.radius ?? 3;
  return {
    radius,
    tiles: over.tiles ?? tilesFor(radius),
    player: over.player ?? makePlayer({ q: 0, r: 0 }),
    enemies: over.enemies ?? [],
    turn: 'player', selected: null, reachable: [], targetable: [], effects: [],
    log: [], status: 'active', tier: 5, knownSpells: ['sparks', 'mend', 'dazzle'],
    weapon: SWORD, seq: 100, threatHexes: [], intentPlan: [],
    objective: null, turnCount: 1, ...over,
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
  it('moveTilesFor scales with AG and caps at 7 (AG 20)', () => {
    expect(moveTilesFor(1)).toBe(2);
    expect(moveTilesFor(8)).toBe(4);
    expect(moveTilesFor(16)).toBe(6);
    expect(moveTilesFor(20)).toBe(7); // BAL-23: AG 20 is now the ceiling (was capped at 6)
    expect(moveTilesFor(25)).toBe(7);
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

// BAL-08: push and blink finally deliver the CH/KN payoff their tooltips promise.
describe('positional spell scaling (BAL-08)', () => {
  // Open board, no walls — the foe travels its full distance so we can measure it.
  function pushTo(illusionPower: number): number {
    const s = makeState({
      radius: 6,
      tiles: tilesFor(6),
      knownSpells: ['push'],
      player: makePlayer({ q: 0, r: 0 }, { illusionPower }),
      enemies: [makeEnemy(1, { q: 1, r: 0 })], // adjacent, due east
    });
    const next = playerCastSpell(s, 'push', { q: 1, r: 0 }, HALF);
    return hexDistance(next.player.hex, next.enemies[0].hex);
  }

  it('Force Push hurls the foe 2 tiles at CH 0 and farther with Charisma', () => {
    expect(pushTo(0)).toBe(1 + 2); // adjacent (dist 1) + 2 push = 3
    expect(pushTo(16)).toBe(1 + 4); // +floor(16/8)=+2 tiles → dist 5
    expect(pushTo(16)).toBeGreaterThan(pushTo(0));
  });

  function blinkRadius(supportSpell: number): number {
    const s = makeState({
      radius: 6,
      tiles: tilesFor(6),
      knownSpells: ['blink'],
      player: makePlayer({ q: 0, r: 0 }, { supportSpell }),
    });
    const tiles = computeTargetable(s, { kind: 'spell', spellKey: 'blink' });
    return Math.max(...tiles.map((h) => hexDistance({ q: 0, r: 0 }, h)));
  }

  it('Blink reaches 2 squares at KN 0 and farther with Knowledge', () => {
    expect(blinkRadius(0)).toBe(2);
    expect(blinkRadius(16)).toBe(4); // 2 + floor(16/8) = 4
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

// --- Enrage move (MINI-36): permanently buffs the enemy's own attack -----------------------------
describe('enrage move', () => {
  it("permanently raises the enemy's attack and persists to the next turn", () => {
    // Adjacent foe whose only moveset entry is enrage → pickMove always selects it.
    const enemy = makeEnemy(1, { q: 1, r: 0 }, {
      attack: 8,
      moveset: [{ kind: 'enrage', weight: 1, bonus: 4, label: 'works itself into a frenzy', icon: '🔥' }],
    });
    const s0 = makeState({ enemies: [enemy] });
    // HIGH rng avoids the dodge/blind gates so the enrage branch fires.
    const s1 = endPlayerTurn(s0, HIGH);
    expect(s1.enemies[0].attack).toBe(12); // 8 + bonus 4 (fall-through basic attack would leave it at 8)
    expect(s1.log.some((l) => l.includes('Attack +4'))).toBe(true);
    expect(s1.player.hp).toBe(100); // enrage is a buff, not a strike — the hero is untouched
    // The buff is not per-turn: a second enrage stacks on top of the first.
    const s2 = endPlayerTurn(s1, HIGH);
    expect(s2.enemies[0].attack).toBe(16); // 12 + 4
  });
});

// --- Charger lunge (MINI-09): a kited charger closes on the third turn ---------------------------
describe('charger lunge anti-kite', () => {
  // Board wide enough to hold a distance-5 foe; the hero never moves (endPlayerTurn only).
  const wide = tilesFor(5);

  it('a charger kept out of reach for two turns lunges with a doubled budget on the third', () => {
    // moveTiles:1 charger at distance 5 — its normal budget closes only 1 tile/turn, never reaching.
    const s0 = makeState({
      radius: 5, tiles: wide,
      player: makePlayer({ q: 0, r: 0 }, { hp: 500, maxHp: 500 }),
      enemies: [makeEnemy(1, { q: 5, r: 0 }, { aiArchetype: 'charger', moveTiles: 1, attack: 5 })],
    });
    const s1 = endPlayerTurn(s0, HIGH); // turn 1: dist 5 → 4, turnsOutOfReach = 1
    const s2 = endPlayerTurn(s1, HIGH); // turn 2: dist 4 → 3, turnsOutOfReach = 2
    expect(hexDistance(s2.enemies[0].hex, s2.player.hex)).toBe(3);
    const s3 = endPlayerTurn(s2, HIGH); // turn 3: lunge — doubled budget closes 2 tiles into reach
    // The lunge closes 2 tiles in one turn (3 → 1), which a single move budget could never do.
    expect(hexDistance(s3.enemies[0].hex, s3.player.hex)).toBeLessThanOrEqual(1);
    expect(s3.log.some((l) => l.includes('lunges forward'))).toBe(true);
  });

  it('the lunge out-paces a max-distance kiter on a medium board (2×+1, not 2×)', () => {
    // The finding's headline case. Radius-4 (medium) board: max distance 8, real enemy moveTiles 3.
    // A plain 2× lunge (=6) lands at distance 2 — one short of melee — so a wall-pegged max-AG bow
    // player (top move 6, here the stationary hero at the far wall = the worst case) survives forever.
    // The 2×+1 budget (=7) crosses from 8 straight into melee reach. turnsOutOfReach seeded to 2 so
    // this single enemy phase IS the lunge turn.
    const r4 = tilesFor(4);
    const s0 = makeState({
      radius: 4, tiles: r4,
      player: makePlayer({ q: -4, r: 0 }, { hp: 500, maxHp: 500 }),
      enemies: [makeEnemy(1, { q: 4, r: 0 }, { aiArchetype: 'charger', moveTiles: 3, attack: 5, turnsOutOfReach: 2 })],
    });
    expect(hexDistance(s0.enemies[0].hex, s0.player.hex)).toBe(8);
    const s1 = endPlayerTurn(s0, HIGH); // lunge: budget 7 closes 8 → ≤1 (old budget 6 stalls at 2)
    expect(hexDistance(s1.enemies[0].hex, s1.player.hex)).toBeLessThanOrEqual(1);
    expect(s1.log.some((l) => l.includes('lunges forward'))).toBe(true);
  });

  it('flankers also lunge; holders and kiters never do', () => {
    const r4 = tilesFor(4);
    const setup = (arch: 'flanker' | 'holder' | 'kiter') =>
      makeState({
        radius: 4, tiles: r4,
        player: makePlayer({ q: -4, r: 0 }, { hp: 500, maxHp: 500 }),
        enemies: [makeEnemy(1, { q: 4, r: 0 }, { aiArchetype: arch, moveTiles: 3, attack: 5, turnsOutOfReach: 2, range: arch === 'kiter' ? 3 : 1 })],
      });
    // Flanker is a melee "close-to-engage" archetype → it lunges and connects like a charger.
    const flank = endPlayerTurn(setup('flanker'), HIGH);
    expect(flank.log.some((l) => l.includes('lunges forward'))).toBe(true);
    // Holder (holds ground) and kiter (wants range) never get the doubled budget — scope guard.
    for (const arch of ['holder', 'kiter'] as const) {
      const next = endPlayerTurn(setup(arch), HIGH);
      expect(next.log.some((l) => l.includes('lunges forward')), `${arch} must not lunge`).toBe(false);
      expect(hexDistance(next.enemies[0].hex, next.player.hex), `${arch} closed too far`).toBeGreaterThan(1);
    }
  });
});

// --- Lunge telegraph (audit D2): the predictors use the same budget enemyAct will ----------------
describe('lunge telegraph in threat zone and intents', () => {
  const r4 = tilesFor(4);
  const setup = (turnsOutOfReach: number) =>
    makeState({
      radius: 4, tiles: r4,
      player: makePlayer({ q: -4, r: 0 }, { hp: 500, maxHp: 500 }),
      enemies: [makeEnemy(1, { q: 4, r: 0 }, { aiArchetype: 'charger', moveTiles: 3, turnsOutOfReach })],
    });

  it('the danger zone covers the lunge reach once the lunge is pending', () => {
    // Distance 8; base budget 3 + melee range 1 threatens only to distance 4 — but the pending
    // lunge budget (2×3+1 = 7) + range 1 reaches the player's own tile. The overlay must show it.
    const calm = computeEnemyThreat(setup(0));
    expect(calm.some((h) => hexEquals(h, { q: -4, r: 0 }))).toBe(false);
    const primed = computeEnemyThreat(setup(2));
    expect(primed.some((h) => hexEquals(h, { q: -4, r: 0 }))).toBe(true);
  });

  it('the intent plan predicts the lunge move and flags it', () => {
    const calm = planEnemyIntents(setup(0));
    expect(calm[0].lunge ?? false).toBe(false);
    expect(hexDistance(calm[0].moveTo, { q: -4, r: 0 })).toBeGreaterThan(1);
    const primed = planEnemyIntents(setup(2));
    expect(primed[0].lunge).toBe(true);
    expect(primed[0].attackIcon).toBe('💨');
    // Prediction parity: intent lands where enemyAct's lunge budget actually reaches.
    expect(hexDistance(primed[0].moveTo, { q: -4, r: 0 })).toBeLessThanOrEqual(1);
    expect(primed[0].willAttack).toBe(true);
  });
});

// --- Player-side freeze & blind (audit D1): inflicts on the hero actually bite -------------------
describe('player-side freeze and blind', () => {
  it('a freeze inflicted during the enemy phase costs the hero the coming turn', () => {
    // Adjacent foe whose only move inflicts a 1-turn freeze (mirrors the ice templates).
    const s0 = makeState({
      enemies: [makeEnemy(1, { q: 1, r: 0 }, {
        moveset: [{ kind: 'inflict', weight: 1, inflictKey: 'freeze', inflictTurns: 1, inflictMag: 1, label: 'breathes freezing air', icon: '❄️' }],
      })],
    });
    const s1 = endPlayerTurn(s0, HIGH); // HIGH avoids the dodge gate; the inflict lands
    expect(s1.player.statuses.some((st) => st.key === 'freeze')).toBe(true);
    expect(s1.player.movesLeft).toBe(0);
    expect(s1.player.hasActed).toBe(true);
    expect(s1.log.some((l) => l.includes('frozen solid'))).toBe(true);
    // The skip is real: move and attack are both no-ops (reference-equal returns).
    expect(movePlayer(s1, { q: 0, r: 1 })).toBe(s1);
    expect(playerAttack(s1, s1.enemies[0].hex, HIGH)).toBe(s1);
  });

  it('the hero thaws after the lost turn (freeze decays at their end of turn)', () => {
    // Pre-frozen hero (2 turns so it survives the first decay) vs a guard-only foe (never re-inflicts).
    const s0 = makeState({
      player: makePlayer({ q: 0, r: 0 }, { statuses: [{ key: 'freeze', turns: 2, magnitude: 1 }] }),
      enemies: [makeEnemy(1, { q: 3, r: 0 }, { moveTiles: 0, moveset: [{ kind: 'guard', weight: 1, bonus: 2, label: 'braces', icon: '🛡️' }] })],
    });
    const s1 = endPlayerTurn(s0, HIGH); // decay 2→1; still frozen → turn lost
    expect(s1.player.movesLeft).toBe(0);
    const s2 = endPlayerTurn(s1, HIGH); // decay 1→0 — thawed, full restore
    expect(s2.player.statuses.some((st) => st.key === 'freeze')).toBe(false);
    expect(s2.player.movesLeft).toBe(moveTilesFor(s2.player.ag));
    expect(s2.player.hasActed).toBe(false);
  });

  it('a blinded hero whiffs 40% of strikes — stamina still spent', () => {
    const LOW = () => 0.1; // blind roll 0.1 < 0.4 → miss
    const blinded = () => makeState({
      player: makePlayer({ q: 0, r: 0 }, { statuses: [{ key: 'blind', turns: 2, magnitude: 1 }] }),
      enemies: [makeEnemy(1, { q: 1, r: 0 })],
    });
    const miss = playerAttack(blinded(), { q: 1, r: 0 }, LOW);
    expect(miss.enemies[0].hp).toBe(30); // untouched
    expect(miss.player.sta).toBe(18); // the committed swing still cost 2 stamina
    expect(miss.player.hasActed).toBe(true);
    expect(miss.log.some((l) => l.includes('blinded and miss'))).toBe(true);
    // High roll passes the gate — the strike lands as normal.
    const hit = playerAttack(blinded(), { q: 1, r: 0 }, HIGH);
    expect(hit.enemies[0].hp).toBeLessThan(30);
  });

  it('an unblinded hero never consults the blind gate', () => {
    const LOW = () => 0.1;
    const s = makeState({ enemies: [makeEnemy(1, { q: 1, r: 0 })] });
    const hit = playerAttack(s, { q: 1, r: 0 }, LOW);
    expect(hit.enemies[0].hp).toBeLessThan(30);
  });
});

// --- Preview honesty (audit D5/B7): the hover preview mirrors attackRoll exactly ------------------
describe('attack preview honesty', () => {
  const adjacentFoe = (over: Partial<PlayerUnit> = {}, enemyOver: Partial<EnemyUnit> = {}) =>
    makeState({
      player: makePlayer({ q: 0, r: 0 }, over),
      enemies: [makeEnemy(1, { q: 1, r: 0 }, enemyOver)],
    });

  it('min/max bracket the actual roll at both variance extremes', () => {
    const preview = previewPlayerAttack(adjacentFoe(), { q: 1, r: 0 })!;
    const low = playerAttack(adjacentFoe(), { q: 1, r: 0 }, () => 0);
    expect(30 - low.enemies[0].hp).toBe(preview.min);
    const high = playerAttack(adjacentFoe(), { q: 1, r: 0 }, () => 0.9999999);
    expect(30 - high.enemies[0].hp).toBe(preview.max);
  });

  it('flags and halves an exhausted swing (sta below weapon cost)', () => {
    const fresh = previewPlayerAttack(adjacentFoe(), { q: 1, r: 0 })!;
    expect(fresh.exhausted).toBeFalsy();
    const tired = previewPlayerAttack(adjacentFoe({ sta: 1 }), { q: 1, r: 0 })!; // SWORD costs 2
    expect(tired.exhausted).toBe(true);
    expect(tired.min).toBeLessThan(fresh.min);
    // The halved preview still brackets the actual exhausted roll.
    const low = playerAttack(adjacentFoe({ sta: 1 }), { q: 1, r: 0 }, () => 0);
    expect(30 - low.enemies[0].hp).toBe(tired.min);
  });

  it('never shows LETHAL on a hit exhaustion will leave short', () => {
    // Foe at 7 HP: a fresh min (13) kills, an exhausted min (6) does not. The old preview
    // ignored stamina and promised a kill the swing couldn't deliver.
    const fresh = previewPlayerAttack(adjacentFoe({}, { hp: 7 }), { q: 1, r: 0 })!;
    expect(fresh.lethal).toBe(true);
    const tired = previewPlayerAttack(adjacentFoe({ sta: 1 }, { hp: 7 }), { q: 1, r: 0 })!;
    expect(tired.lethal).toBe(false);
  });

  it('spell preview brackets the actual spell roll', () => {
    const state = adjacentFoe();
    const preview = previewSpell(state, 'sparks', { q: 1, r: 0 })!;
    const low = playerCastSpell(adjacentFoe(), 'sparks', { q: 1, r: 0 }, () => 0);
    expect(30 - low.enemies[0].hp).toBe(preview.min);
    const high = playerCastSpell(adjacentFoe(), 'sparks', { q: 1, r: 0 }, () => 0.9999999);
    expect(30 - high.enemies[0].hp).toBe(preview.max);
  });
});

// --- Swift objective failure (audit B6): a spent budget reads as missed, not still-live ----------
describe('swift objective failure', () => {
  const swift = (target: number): TacticsObjective => ({
    kind: 'swift', label: 'Swift Strike', desc: '', target, progress: 0, complete: false, failed: false,
  });
  // A distant foe that never closes (moveTiles 0, guard-only) so the match stays live.
  const idleFoe = () => makeEnemy(1, { q: 3, r: 0 }, { moveTiles: 0, moveset: [{ kind: 'guard', weight: 1, bonus: 2, label: 'braces', icon: '🛡️' }] });

  it('fails the moment the turn budget is spent without a win', () => {
    const s0 = makeState({ objective: swift(2), turnCount: 2, enemies: [idleFoe()] });
    const s1 = endPlayerTurn(s0, HIGH); // turn 2 (the last inside the budget) ends with foes alive
    expect(s1.objective!.failed).toBe(true);
    expect(s1.log.some((l) => l.includes('Swift Strike missed'))).toBe(true);
  });

  it('stays live while a win inside the budget is still possible', () => {
    const s0 = makeState({ objective: swift(2), turnCount: 1, enemies: [idleFoe()] });
    const s1 = endPlayerTurn(s0, HIGH);
    expect(s1.objective!.failed).toBe(false);
  });

  it('a win after the miss does not resurrect the objective', () => {
    const s0 = makeState({
      objective: { ...swift(2), failed: true },
      turnCount: 5,
      enemies: [makeEnemy(1, { q: 1, r: 0 }, { hp: 1 })],
    });
    const s1 = playerAttack(s0, { q: 1, r: 0 }, HIGH); // kills the last foe → won
    expect(s1.status).toBe('won');
    expect(s1.objective!.complete).toBe(false);
  });
});

// --- Holder leash (audit D3): distant holders lumber toward the fight ----------------------------
describe('holder leash', () => {
  const wide = tilesFor(5);
  it('a holder beyond the leash approaches; one inside it digs in', () => {
    const far = makeState({
      radius: 5, tiles: wide,
      player: makePlayer({ q: -5, r: 0 }, { hp: 500, maxHp: 500 }),
      enemies: [makeEnemy(1, { q: 3, r: 0 }, { aiArchetype: 'holder', moveTiles: 2 })], // dist 8
    });
    const s1 = endPlayerTurn(far, HIGH);
    expect(hexDistance(s1.enemies[0].hex, s1.player.hex)).toBeLessThan(8); // lumbered closer
    const near = makeState({
      radius: 5, tiles: wide,
      player: makePlayer({ q: -1, r: 0 }, { hp: 500, maxHp: 500 }),
      enemies: [makeEnemy(1, { q: 2, r: 0 }, { aiArchetype: 'holder', moveTiles: 2 })], // dist 3 ≤ leash
    });
    const s2 = endPlayerTurn(near, HIGH);
    expect(hexEquals(s2.enemies[0].hex, { q: 2, r: 0 })).toBe(true); // held its ground
  });
});

// --- Kiter press (audit D4): a kiter kept out of reach stops idling ------------------------------
describe('kiter press anti-stalemate', () => {
  const wide = tilesFor(5);
  it('tracks out-of-reach turns and closes in once the press threshold is reached', () => {
    // Ranged kiter (range 3) pinned at distance 9 with zero movement would idle forever —
    // out-of-reach turns must accumulate.
    const pinned = makeState({
      radius: 5, tiles: wide,
      player: makePlayer({ q: -5, r: 0 }, { hp: 500, maxHp: 500 }),
      enemies: [makeEnemy(1, { q: 4, r: 0 }, { aiArchetype: 'kiter', range: 3, moveTiles: 0 })],
    });
    const t1 = endPlayerTurn(pinned, HIGH);
    expect(t1.enemies[0].turnsOutOfReach).toBe(1);
    // Once primed (≥ KITER_PRESS_TURNS), the same kiter with movement scores like a charger
    // and closes the distance instead of ring-keeping.
    const primed = makeState({
      radius: 5, tiles: wide,
      player: makePlayer({ q: -5, r: 0 }, { hp: 500, maxHp: 500 }),
      enemies: [makeEnemy(1, { q: 4, r: 0 }, { aiArchetype: 'kiter', range: 3, moveTiles: 3, turnsOutOfReach: 3 })],
    });
    const t2 = endPlayerTurn(primed, HIGH);
    expect(hexDistance(t2.enemies[0].hex, t2.player.hex)).toBeLessThanOrEqual(6); // closed ≥3 of 9
  });
});

// --- MP regen (audit D8) --------------------------------------------------------------------------
describe('mana regeneration', () => {
  it('restores +1 MP each turn, capped at max', () => {
    const s0 = makeState({ player: makePlayer({ q: 0, r: 0 }, { mp: 10, maxMp: 30 }), enemies: [makeEnemy(1, { q: 3, r: 0 }, { moveTiles: 0 })] });
    const s1 = endPlayerTurn(s0, HIGH);
    expect(s1.player.mp).toBe(11);
    const full = makeState({ player: makePlayer({ q: 0, r: 0 }, { mp: 30, maxMp: 30 }), enemies: [makeEnemy(1, { q: 3, r: 0 }, { moveTiles: 0 })] });
    expect(endPlayerTurn(full, HIGH).player.mp).toBe(30);
  });
});

// --- Reinforcement waves (audit D6) ---------------------------------------------------------------
describe('reinforcement waves', () => {
  it('generateSkirmish fields at most WAVE_CAP and queues the rest, all counted in the force total', () => {
    const s = generateSkirmish(fighter(), 8, 10, ['sparks'], { enemyCount: 8, rng: seeded(3) });
    expect(s.enemies.length).toBe(5); // WAVE_CAP
    expect(s.reinforcements?.length).toBe(3);
    const totalHp = [...s.enemies, ...(s.reinforcements ?? [])].reduce((sum, e) => sum + e.maxHp, 0);
    expect(s.enemyForceMaxHp).toBe(totalHp);
    expect(s.log[0]).toContain('More approach from the edges');
  });

  it('clearing the board with waves queued is NOT a win, and the next turn spawns the wave', () => {
    const queued = [makeEnemy(9, { q: 0, r: 0 }), makeEnemy(10, { q: 0, r: 0 })];
    const s0 = makeState({
      enemies: [makeEnemy(1, { q: 1, r: 0 }, { hp: 1 })],
      reinforcements: queued,
    });
    const s1 = playerAttack(s0, { q: 1, r: 0 }, HIGH); // kill the last fielded foe
    expect(s1.status).toBe('active'); // waves pending — not a win
    expect(s1.enemies.length).toBe(0);
    const s2 = endPlayerTurn(s1, HIGH); // empty board pulls the wave immediately
    expect(s2.enemies.length).toBe(2);
    expect(s2.reinforcements?.length ?? 0).toBe(0);
    expect(s2.log.some((l) => l.includes('Reinforcements arrive'))).toBe(true);
    // Spawned units stand on real, distinct, unblocked tiles.
    const k0 = hexKey(s2.enemies[0].hex);
    const k1 = hexKey(s2.enemies[1].hex);
    expect(k0).not.toBe(k1);
    expect(s2.tiles[k0].terrain).not.toBe('blocked');
  });

  it('waves arrive on the cadence while foes remain fielded', () => {
    const s0 = makeState({
      enemies: [makeEnemy(1, { q: 4, r: 0 }, { moveTiles: 0, hp: 500, maxHp: 500 })],
      reinforcements: [makeEnemy(9, { q: 0, r: 0 })],
      turnCount: 2, // ends turn 2 → turnCount becomes 3 → 3 % WAVE_EVERY_TURNS(2) === 1 → wave
      radius: 4, tiles: tilesFor(4),
      player: makePlayer({ q: -4, r: 0 }, { hp: 500, maxHp: 500 }),
    });
    const s1 = endPlayerTurn(s0, HIGH);
    expect(s1.enemies.length).toBe(2);
  });

  it('damage fraction counts queued reinforcements as standing HP', () => {
    const s = makeState({
      enemies: [makeEnemy(1, { q: 1, r: 0 }, { hp: 0, maxHp: 30 })], // slain (30 dealt)
      reinforcements: [makeEnemy(9, { q: 0, r: 0 }, { hp: 30, maxHp: 30 })],
      enemyForceMaxHp: 60,
    });
    expect(tacticsDamageFraction(s)).toBeCloseTo(0.5);
  });
});

// --- Usage ledger (audit D9) -----------------------------------------------------------------------
describe('stat usage ledger', () => {
  it('moves, strikes, and casts record their stat expression', () => {
    const s0 = makeState({ enemies: [makeEnemy(1, { q: 2, r: 0 })], knownSpells: ['sparks'] });
    const moved = movePlayer(selectAction(s0, { kind: 'move' }), { q: 0, r: 1 });
    expect(moved.statUsage?.AG).toBe(1);
    const struck = playerAttack(makeState({ enemies: [makeEnemy(1, { q: 1, r: 0 })] }), { q: 1, r: 0 }, HIGH);
    expect(struck.statUsage?.ST).toBe(1); // SWORD is ST
    const cast = playerCastSpell(makeState({ enemies: [makeEnemy(1, { q: 1, r: 0 })], knownSpells: ['sparks'] }), 'sparks', { q: 1, r: 0 }, HIGH);
    expect(cast.statUsage?.WI).toBe(1); // damage school
  });

  it('the ledger is copy-on-write — earlier snapshots are not mutated', () => {
    const s0 = makeState({ enemies: [makeEnemy(1, { q: 2, r: 0 })] });
    const s1 = movePlayer(selectAction(s0, { kind: 'move' }), { q: 0, r: 1 });
    const s2 = movePlayer(s1, { q: 0, r: 2 });
    expect(s1.statUsage?.AG).toBe(1);
    expect(s2.statUsage?.AG).toBe(2);
    expect(s0.statUsage).toBeUndefined();
  });
});

// --- Melee overwatch attack of opportunity (audit D10) --------------------------------------------
describe('overwatch attack of opportunity', () => {
  it('a melee hero on overwatch strikes an adjacent enemy that breaks away', () => {
    // Kiter adjacent to the hero wants distance (tooClose penalty) → it retreats → AoO fires.
    const s0 = makeState({
      player: makePlayer({ q: 0, r: 0 }, { overwatch: true, hasActed: true }),
      enemies: [makeEnemy(1, { q: 1, r: 0 }, { aiArchetype: 'kiter', range: 3, moveTiles: 3, hp: 100, maxHp: 100 })],
    });
    const s1 = endPlayerTurn(s0, HIGH);
    expect(hexDistance(s1.enemies[0].hex, s1.player.hex)).toBeGreaterThan(1); // it fled
    expect(s1.enemies[0].hp).toBeLessThan(100); // and paid for it
    expect(s1.log.some((l) => l.includes('breaks away'))).toBe(true);
    expect(s1.player.overwatch).toBe(false); // one-shot stance expired
  });
});

// --- Dev invincibility (audit B2): wired like ArenaState.invincible ------------------------------
describe('dev invincibility', () => {
  it('heroes take no attack, hazard, or DoT damage and are topped up each turn', () => {
    const tiles = tilesFor(3);
    setTile(tiles, { q: 0, r: 0 }, { terrain: 'hazard' }); // hero ends the turn standing in fire
    const s0 = makeState({
      tiles,
      invincible: true,
      player: makePlayer({ q: 0, r: 0 }, { sta: 5, mp: 10, statuses: [{ key: 'poison', turns: 3, magnitude: 4 }] }),
      enemies: [makeEnemy(1, { q: 1, r: 0 }, { attack: 50 })],
    });
    const s1 = endPlayerTurn(s0, HIGH);
    expect(s1.player.hp).toBe(s1.player.maxHp);
    expect(s1.player.mp).toBe(s1.player.maxMp);
    expect(s1.player.sta).toBe(s1.player.maxSta);
    expect(s1.status).toBe('active');
  });

  it('enemies still take their own hazard/DoT ticks while the hero is invincible', () => {
    const tiles = tilesFor(3);
    setTile(tiles, { q: 3, r: 0 }, { terrain: 'hazard' });
    const s0 = makeState({
      tiles,
      invincible: true,
      enemies: [makeEnemy(1, { q: 3, r: 0 }, { moveTiles: 0, moveset: [{ kind: 'guard', weight: 1, bonus: 2, label: 'braces', icon: '🛡️' }] })],
    });
    const s1 = endPlayerTurn(s0, HIGH);
    expect(s1.enemies[0].hp).toBe(30 - HAZARD_DMG);
  });
});

// --- Push respects hero occupancy (audit B5) ------------------------------------------------------
describe('force push vs hero occupancy', () => {
  it('a pushed enemy stops short of a living ally instead of stacking on their hex', () => {
    // Co-op shape: caster h1 at origin, ally h2 directly along the push line behind the foe.
    const h1 = makePlayer({ q: 0, r: 0 }, { id: 'h1', knownSpells: ['push', 'sparks'] });
    const h2 = makePlayer({ q: 2, r: 0 }, { id: 'h2', name: 'Ally' });
    const s0 = makeState({
      player: h1,
      players: [h1, h2],
      activeHeroId: 'h1',
      knownSpells: ['push', 'sparks'],
      enemies: [makeEnemy(1, { q: 1, r: 0 })],
    });
    const s1 = playerCastSpell(s0, 'push', { q: 1, r: 0 }, HALF, 'h1');
    expect(s1).not.toBe(s0); // the cast resolved
    const foe = s1.enemies[0];
    const ally = s1.players!.find((p) => p.id === 'h2')!;
    expect(hexEquals(foe.hex, ally.hex)).toBe(false);
    expect(hexEquals(foe.hex, { q: 1, r: 0 })).toBe(true); // blocked immediately — never moved
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
  it('pays scaling gold + a material bundle on a win, and nothing on an undamaged loss', () => {
    // tier-5, radius-3 (sizeBonus 0): 40 * 1.75 = 70 gold; bundle qty = 1 + floor(5/4) = 2.
    expect(tacticsReward(makeState({ status: 'won', tier: 5 }))).toEqual({
      gold: 70,
      materials: { cloth_roll: 2, bronze_bar: 2 },
    });
    expect(tacticsReward(makeState({ status: 'lost', tier: 5 }))).toEqual({});
    expect(tacticsReward(makeState({ status: 'active', tier: 5 }))).toEqual({});
  });

  it('adds a potion at higher tiers', () => {
    expect(tacticsReward(makeState({ status: 'won', tier: 8 })).items).toEqual(['healing_potion']);
  });

  it('MINI-22: bigger boards pay more gold at the same tier', () => {
    const small = tacticsReward(makeState({ status: 'won', tier: 5, radius: 3 })).gold!;
    const large = tacticsReward(makeState({ status: 'won', tier: 5, radius: 6 })).gold!;
    expect(large).toBeGreaterThan(small);
    // radius-6 sizeBonus = 4 → 40 * 1.75 * (1 + 0.25*4) = 70 * 2 = 140 (audit D6: at the old
    // 0.15 step a Large-board foe paid ~½ a Small-board foe — bigger fights were the worst pay).
    expect(large).toBe(140);
  });

  it('BAL-10: a win awards the tier-scaled material bundle', () => {
    const r5 = tacticsReward(makeState({ status: 'won', tier: 5 }));
    expect(r5.materials).toEqual({ cloth_roll: 2, bronze_bar: 2 });
    const r8 = tacticsReward(makeState({ status: 'won', tier: 8 })); // 1 + floor(8/4) = 3
    expect(r8.materials).toEqual({ cloth_roll: 3, bronze_bar: 3 });
  });

  it('MINI-23: a loss/retreat pays gold proportional to damage dealt; no damage pays nothing', () => {
    // Two 30-HP foes; one worn to 15 HP → 15/60 = 0.25 of the standing force ground down.
    const damaged = makeState({
      status: 'lost', tier: 5,
      enemies: [makeEnemy(1, { q: 1, r: 0 }, { hp: 15, maxHp: 30 }), makeEnemy(2, { q: 0, r: 1 })],
    });
    // baseGold (tier 5, radius 3) = 70 → round(70 * 0.25) = 18.
    expect(tacticsReward(damaged)).toEqual({ gold: 18 });

    // A retreat (status 'active') with the same partial damage also pays proportionally.
    expect(tacticsReward({ ...damaged, status: 'active' }).gold).toBe(18);

    // Kills count too (MINI-23): two 30-HP foes spawned (enemyForceMaxHp 60), ONE slain and
    // removed by checkOutcome, the survivor at full HP → 30/60 = 0.5 of the force destroyed.
    const oneKilled = makeState({
      status: 'active', tier: 5, enemyForceMaxHp: 60,
      enemies: [makeEnemy(2, { q: 0, r: 1 })], // survivor at 30/30; the other is gone
    });
    // round(70 * 0.5) = 35 — a survivors-only metric would have paid 0 here.
    expect(tacticsReward(oneKilled)).toEqual({ gold: 35 });

    // Fresh retreat — enemies untouched — pays nothing (guard: no chip damage = no reward).
    const fresh = makeState({
      status: 'active', tier: 5,
      enemies: [makeEnemy(1, { q: 1, r: 0 }), makeEnemy(2, { q: 0, r: 1 })],
    });
    expect(tacticsReward(fresh)).toEqual({});
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
    // Frozen as-spawned force HP is captured for the retreat-reward denominator (MINI-23).
    expect(s.enemyForceMaxHp).toBe(s.enemies.reduce((sum, e) => sum + e.maxHp, 0));
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

// --- Phase E: spell loadout -----------------------------------------------------------------------
describe('isTacticsLoadoutSpell', () => {
  it('excludes the three always-granted positional spells', () => {
    for (const key of TACTICS_GRANTED_SPELLS) {
      expect(isTacticsLoadoutSpell(key)).toBe(false);
    }
  });

  it('accepts standard damage/support spells', () => {
    // 'sparks' is a standard damage spell with no mechanic override.
    expect(isTacticsLoadoutSpell('sparks')).toBe(true);
  });

  it('rejects unknown spell keys', () => {
    expect(isTacticsLoadoutSpell('not_a_real_spell')).toBe(false);
  });
});

describe('generateSkirmish spell loadout', () => {
  it('always includes the three granted spells regardless of loadout', () => {
    const s = generateSkirmish(fighter(), 8, 5, [], { rng: seeded(1) });
    for (const key of TACTICS_GRANTED_SPELLS) {
      expect(s.knownSpells).toContain(key);
    }
  });

  it('limits knownSpells to loadout ∪ granted when a subset is passed', () => {
    // Pass only 'sparks' as the loadout; the match should have sparks + the 3 granted spells.
    const s = generateSkirmish(fighter(), 8, 5, ['sparks'], { rng: seeded(2) });
    expect(s.knownSpells).toContain('sparks');
    for (const key of TACTICS_GRANTED_SPELLS) {
      expect(s.knownSpells).toContain(key);
    }
    // 'mend' was not in the loadout, so it must not appear.
    expect(s.knownSpells).not.toContain('mend');
  });

  it('empty loadout produces exactly the three granted spells', () => {
    const s = generateSkirmish(fighter(), 8, 5, [], { rng: seeded(3) });
    const expected = [...TACTICS_GRANTED_SPELLS].sort();
    expect([...s.knownSpells].sort()).toEqual(expected);
  });
});

// --- Phase F: overwatch Hold action ---------------------------------------------------------------
describe('holdOverwatch', () => {
  it('sets player.overwatch and ends the player turn', () => {
    const enemy = makeEnemy(1, { q: 0, r: -3 }); // far away, won't trigger reaction
    const s0 = makeState({ enemies: [enemy] });
    const s1 = holdOverwatch(s0, seeded(42));
    expect(s1.player.overwatch).toBe(false); // expired after enemy phase, player's turn again
    // Turn should have been handed back to the player.
    expect(s1.turn).toBe('player');
    expect(s1.player.hasActed).toBe(false);
    // Log should contain the overwatch message.
    expect(s1.log.some((l) => l.toLowerCase().includes('overwatch'))).toBe(true);
  });

  it('is rejected when the player has already acted', () => {
    const s0 = makeState({ player: makePlayer({ q: 0, r: 0 }, { hasActed: true }) });
    const s1 = holdOverwatch(s0);
    expect(s1).toBe(s0); // no-op — reference equality
  });

  it('fires a reaction shot when an enemy steps into melee range', () => {
    // Player at center with a melee weapon; enemy starts adjacent so enemyAct
    // will try to attack from its current position — that keeps it adjacent, triggering overwatch.
    const enemy = makeEnemy(1, { q: 0, r: 1 }, { hp: 200, maxHp: 200 }); // high HP so it survives
    const s0 = makeState({ enemies: [enemy] });
    const s1 = holdOverwatch(s0, seeded(1));
    // The reaction log line should mention the enemy name.
    expect(s1.log.some((l) => l.includes('Foe1'))).toBe(true);
    // Overwatch should be cleared (was consumed).
    expect(s1.player.overwatch).toBe(false);
    // Enemy should have taken some damage.
    const enemy1 = s1.enemies.find((e) => e.id === 1);
    expect(enemy1).toBeDefined();
    if (enemy1) expect(enemy1.hp).toBeLessThan(200);
  });

  it('disarms the overwatch stance when no enemy enters range', () => {
    // Enemy on the far side of the board (r = -3) won't reach melee range in one move.
    const enemy = makeEnemy(1, { q: 0, r: -3 }, { hp: 50, maxHp: 50 });
    const s0 = makeState({ enemies: [enemy] });
    const s1 = holdOverwatch(s0, seeded(7));
    expect(s1.player.overwatch).toBe(false); // expired at start of next player turn
  });
});

// --- Phase G: secondary objectives ---------------------------------------------------------------
describe('objective: beacon', () => {
  function beaconState(streak: number, enemyOnBeacon: boolean): HexBattleState {
    const beaconHex: Hex = { q: 0, r: 0 };
    const objective: TacticsObjective = {
      kind: 'beacon', label: 'Hold the Beacon', desc: '', target: 5, progress: streak,
      beaconHex, complete: false, failed: false,
    };
    const enemy = makeEnemy(1, enemyOnBeacon ? beaconHex : { q: 0, r: -3 }, { hp: 200, maxHp: 200 });
    return makeState({ enemies: [enemy], objective });
  }

  it('increments streak when beacon tile is clear', () => {
    const s = beaconState(2, false /* enemy not on beacon */);
    const s1 = endPlayerTurn(s, seeded(1));
    expect(s1.objective?.progress).toBe(3);
    expect(s1.objective?.complete).toBe(false);
  });

  it('resets streak when an enemy occupies the beacon tile', () => {
    const s = beaconState(3, true /* enemy ON beacon */);
    const s1 = endPlayerTurn(s, seeded(1));
    expect(s1.objective?.progress).toBe(0);
  });

  it('marks complete when streak reaches target', () => {
    const s = beaconState(4, false); // one more tick → progress=5=target
    const s1 = endPlayerTurn(s, seeded(1));
    expect(s1.objective?.complete).toBe(true);
  });

  // MINI-24: decisive wins used to forfeit the beacon (needs 5 turns; a fast kill never gets there).
  it('auto-completes on a decisive win when the beacon was never breached', () => {
    const objective: TacticsObjective = {
      kind: 'beacon', label: 'Hold the Beacon', desc: '', target: 5, progress: 2, // well short of 5
      beaconHex: { q: 3, r: 0 }, complete: false, failed: false,
    };
    const enemy = makeEnemy(1, { q: 1, r: 0 }, { hp: 1 }); // adjacent, one-shot
    const s0 = makeState({ enemies: [enemy], objective });
    const s1 = playerAttack(s0, { q: 1, r: 0 }, seeded(1));
    expect(s1.status).toBe('won');
    expect(s1.objective?.complete).toBe(true); // clearing the board IS holding it
  });

  it('does NOT auto-complete a win if the beacon was contested earlier', () => {
    const objective: TacticsObjective = {
      kind: 'beacon', label: 'Hold the Beacon', desc: '', target: 5, progress: 2,
      beaconHex: { q: 3, r: 0 }, beaconBroken: true, complete: false, failed: false,
    };
    const enemy = makeEnemy(1, { q: 1, r: 0 }, { hp: 1 });
    const s0 = makeState({ enemies: [enemy], objective });
    const s1 = playerAttack(s0, { q: 1, r: 0 }, seeded(1));
    expect(s1.status).toBe('won');
    expect(s1.objective?.complete).toBe(false); // ceding the tile forfeits the freebie
  });
});

describe('objective: swift', () => {
  it('is complete when the match is won within the turn budget', () => {
    const objective: TacticsObjective = {
      kind: 'swift', label: 'Swift Strike', desc: '', target: 3, progress: 0,
      complete: false, failed: false,
    };
    // Kill the enemy directly to trigger checkOutcome with turnCount=1.
    const enemy = makeEnemy(1, { q: 1, r: 0 }, { hp: 1 });
    const s0 = makeState({ enemies: [enemy], objective, turnCount: 1 });
    const s1 = playerAttack(s0, { q: 1, r: 0 }, seeded(1));
    expect(s1.status).toBe('won');
    expect(s1.objective?.complete).toBe(true);
  });

  it('is NOT complete when the match is won after the turn budget expires', () => {
    const objective: TacticsObjective = {
      kind: 'swift', label: 'Swift Strike', desc: '', target: 2, progress: 0,
      complete: false, failed: false,
    };
    const enemy = makeEnemy(1, { q: 1, r: 0 }, { hp: 1 });
    // turnCount = 3 > target of 2
    const s0 = makeState({ enemies: [enemy], objective, turnCount: 3 });
    const s1 = playerAttack(s0, { q: 1, r: 0 }, seeded(1));
    expect(s1.status).toBe('won');
    expect(s1.objective?.complete).toBe(false);
  });
});

describe('objective: flawless', () => {
  it('fails when player HP drops below the threshold during the enemy phase', () => {
    const objective: TacticsObjective = {
      kind: 'flawless', label: 'Unscathed', desc: '', target: 50, progress: 100,
      complete: false, failed: false,
    };
    // Enemy adjacent, strong enough to hurt the player (100 HP; any damage is the test).
    const enemy = makeEnemy(1, { q: 0, r: 1 }, { hp: 200, maxHp: 200, attack: 50 });
    const player = makePlayer({ q: 0, r: 0 }, { hp: 60, maxHp: 100 }); // 60 HP (> 50%)
    const s0 = makeState({ enemies: [enemy], objective, player });
    const s1 = endPlayerTurn(s0, seeded(1));
    // Player took ≥10 damage → HP < 50% threshold → failed.
    if (s1.player.hp < 50) {
      expect(s1.objective?.failed).toBe(true);
    }
    // If for some reason the enemy missed (dodge), the test still passes — we just confirm
    // the failed flag is set iff HP actually dropped below threshold.
    if (s1.player.hp >= 50) {
      expect(s1.objective?.failed).toBe(false);
    }
  });
});

describe('tacticsReward with objective', () => {
  it('awards +60% gold when the objective is complete', () => {
    const baseGold = Math.round(40 * (1 + 5 * 0.15)); // tier 5 base
    const objective: TacticsObjective = {
      kind: 'swift', label: '', desc: '', target: 3, progress: 0, complete: true, failed: false,
    };
    const s = makeState({
      status: 'won', tier: 5, objective,
      enemies: [], player: makePlayer({ q: 0, r: 0 }),
    });
    const reward = tacticsReward(s);
    expect(reward.gold).toBe(Math.round(baseGold * 1.6));
    expect(reward.items).toContain('healing_potion');
  });

  it('does not award bonus when objective is incomplete', () => {
    const baseGold = Math.round(40 * (1 + 5 * 0.15));
    const objective: TacticsObjective = {
      kind: 'swift', label: '', desc: '', target: 3, progress: 0, complete: false, failed: false,
    };
    const s = makeState({
      status: 'won', tier: 5, objective,
      enemies: [], player: makePlayer({ q: 0, r: 0 }),
    });
    const reward = tacticsReward(s);
    expect(reward.gold).toBe(baseGold);
  });

  it('pays standard reward when no objective exists', () => {
    const baseGold = Math.round(40 * (1 + 5 * 0.15));
    const s = makeState({
      status: 'won', tier: 5, objective: null,
      enemies: [], player: makePlayer({ q: 0, r: 0 }),
    });
    const reward = tacticsReward(s);
    expect(reward.gold).toBe(baseGold);
  });
});

// ── Multi-hero (co-op) engine tests ─────────────────────────────────────────────────────────────

import {
  livingHeroes,
  nearestHero,
  type HeroOpts,
} from '../hexBattle';

/** Minimal Fighter for generateSkirmish tests. */
function heroFighter(): Fighter {
  return fighter({ maxHp: 80, meleePower: 8, defense: 2, dodge: 0 });
}

describe('multi-hero: generateSkirmish with 2 heroes', () => {
  const hero0: HeroOpts = { fighter: heroFighter(), ag: 8, knownSpells: [], id: 'p0', name: 'Alice' };
  const hero1: HeroOpts = { fighter: heroFighter(), ag: 8, knownSpells: [], id: 'p1', name: 'Bob' };

  it('populates players[] with 2 distinct heroes on separate hexes', () => {
    const s = generateSkirmish(hero0.fighter, hero0.ag, 1, [], {
      rng: seeded(42), heroes: [hero0, hero1],
    });
    expect(s.players).toHaveLength(2);
    expect(s.players![0].id).toBe('p0');
    expect(s.players![1].id).toBe('p1');
    // Heroes must not occupy the same tile.
    const k0 = hexKey(s.players![0].hex);
    const k1 = hexKey(s.players![1].hex);
    expect(k0).not.toBe(k1);
  });

  it('sets activeHeroId and s.player points to the first hero', () => {
    const s = generateSkirmish(hero0.fighter, hero0.ag, 1, [], {
      rng: seeded(7), heroes: [hero0, hero1],
    });
    expect(s.activeHeroId).toBe('p0');
    expect(s.player).toBe(s.players![0]); // exact reference equality (alias)
  });

  it('scales enemy count upward compared to a solo skirmish at the same tier', () => {
    const solo = generateSkirmish(hero0.fighter, hero0.ag, 1, [], { rng: seeded(3) });
    const duo  = generateSkirmish(hero0.fighter, hero0.ag, 1, [], {
      rng: seeded(3), heroes: [hero0, hero1],
    });
    // Duo should have at least as many enemies as solo (scaled by hero count).
    expect(duo.enemies.length).toBeGreaterThanOrEqual(solo.enemies.length);
  });

  it('1-hero roster behaves identically to the legacy single-fighter path', () => {
    const f = heroFighter();
    const single = generateSkirmish(f, 8, 3, [], { rng: seeded(99) });
    const singleViaRoster = generateSkirmish(f, 8, 3, [], {
      rng: seeded(99), heroes: [{ fighter: f, ag: 8, knownSpells: [], id: 'p0' }],
    });
    // Both have no players[] (undefined — 1-hero roster is treated as solo).
    expect(single.players).toBeUndefined();
    expect(singleViaRoster.players).toBeUndefined();
    // Same enemy count.
    expect(single.enemies.length).toBe(singleViaRoster.enemies.length);
  });
});

describe('multi-hero: livingHeroes and nearestHero helpers', () => {
  it('livingHeroes falls back to [s.player] when no players[] exists', () => {
    const s = makeState({ player: makePlayer({ q: 0, r: 0 }) });
    expect(livingHeroes(s)).toHaveLength(1);
    expect(livingHeroes(s)[0]).toBe(s.player);
  });

  it('livingHeroes filters dead heroes from players[]', () => {
    const p0 = makePlayer({ q: 0, r: 0 }, { id: 'p0', hp: 50 });
    const p1 = makePlayer({ q: 1, r: 0 }, { id: 'p1', hp: 0 }); // dead
    const s = makeState({ player: p0, players: [p0, p1], activeHeroId: 'p0' });
    const alive = livingHeroes(s);
    expect(alive).toHaveLength(1);
    expect(alive[0].id).toBe('p0');
  });

  it('nearestHero returns the closest living hero to a given hex', () => {
    const p0 = makePlayer({ q: 0, r: 0 }, { id: 'p0' }); // distance 2 from q:2,r:0
    const p1 = makePlayer({ q: 1, r: 0 }, { id: 'p1' }); // distance 1 from q:2,r:0
    const s = makeState({ player: p0, players: [p0, p1], activeHeroId: 'p0' });
    const nearest = nearestHero(s, { q: 2, r: 0 });
    expect(nearest.id).toBe('p1');
  });

  it('nearestHero ignores dead heroes', () => {
    const p0 = makePlayer({ q: 0, r: 0 }, { id: 'p0' }); // closer
    const p1 = makePlayer({ q: 2, r: 0 }, { id: 'p1', hp: 0 }); // dead — farther but irrelevant
    const s = makeState({ player: p0, players: [p0, p1], activeHeroId: 'p0' });
    const nearest = nearestHero(s, { q: 2, r: 0 });
    expect(nearest.id).toBe('p0'); // only living option
  });
});

describe('multi-hero: turn sequencing — enemy phase waits for all heroes', () => {
  /**
   * Build a 2-hero state. Includes one unkillable enemy far away (moveTiles:1, melee) so
   * checkOutcome never fires 'won' prematurely — without enemies the battle ends immediately.
   */
  function dualHeroState(): HexBattleState {
    const p0 = makePlayer({ q: 0, r: 2 }, { id: 'p0', movesLeft: 0, hasActed: true });
    const p1 = makePlayer({ q: 1, r: 1 }, { id: 'p1', movesLeft: 0, hasActed: true });
    // Enemy at the far edge (distance ≥ 4) with moveTiles:1, range:1 — can't reach heroes in one turn.
    const distant = makeEnemy(1, { q: 0, r: -2 }, { hp: 9999, maxHp: 9999, attack: 1, moveTiles: 1, range: 1 });
    return makeState({ player: p0, players: [p0, p1], activeHeroId: 'p0', enemies: [distant] });
  }

  it('after hero p0 ends turn, turn stays "player" (p1 still needs to go)', () => {
    const s0 = dualHeroState();
    const s1 = endPlayerTurn(s0, HALF, 'p0');
    // p0 ended but p1 has not → still player phase.
    expect(s1.turn).toBe('player');
  });

  it('after both heroes end turn, the turn advances', () => {
    const s0 = dualHeroState();
    const s1 = endPlayerTurn(s0, HALF, 'p0');
    const s2 = endPlayerTurn(s1, HALF, 'p1');
    // Both ended → enemy phase ran (no enemies, so goes back to player) → turn count bumped.
    expect(s2.turnCount).toBe(2);
  });

  it('both heroes have their movesLeft and hasActed reset after a full round', () => {
    const s0 = dualHeroState();
    const s1 = endPlayerTurn(s0, HALF, 'p0');
    const s2 = endPlayerTurn(s1, HALF, 'p1');
    for (const p of s2.players!) {
      expect(p.hasActed).toBe(false);
      expect(p.movesLeft).toBeGreaterThan(0);
    }
  });
});

describe('multi-hero: loss condition — only when ALL heroes are down', () => {
  it('battle continues when one of two heroes dies', () => {
    const p0 = makePlayer({ q: 0, r: 0 }, { id: 'p0', hp: 50 });
    const p1 = makePlayer({ q: 1, r: 0 }, { id: 'p1', hp: 1, dodge: 0 });
    // Enemy adjacent to p1 with lethal damage.
    const enemy = makeEnemy(1, { q: 1, r: 1 }, { attack: 200, range: 1 });
    const s0 = makeState({ player: p0, players: [p0, p1], activeHeroId: 'p0', enemies: [enemy] });
    const s1 = endPlayerTurn(s0, HIGH, 'p0');
    const s2 = endPlayerTurn(s1, HIGH, 'p1');
    // p1 died from the enemy attack but p0 is still alive — should NOT be lost.
    expect(s2.status).toBe('active');
  });

  it('status = lost only when every hero is dead', () => {
    const p0 = makePlayer({ q: 0, r: 0 }, { id: 'p0', hp: 1, dodge: 0 });
    const p1 = makePlayer({ q: 1, r: 0 }, { id: 'p1', hp: 1, dodge: 0 });
    // Two enemies, each adjacent and lethal.
    const e0 = makeEnemy(1, { q: 0, r: 1 }, { attack: 200, range: 1 });
    const e1 = makeEnemy(2, { q: 1, r: 1 }, { attack: 200, range: 1 });
    const s0 = makeState({ player: p0, players: [p0, p1], activeHeroId: 'p0', enemies: [e0, e1] });
    const s1 = endPlayerTurn(s0, HIGH, 'p0');
    const s2 = endPlayerTurn(s1, HIGH, 'p1');
    expect(s2.status).toBe('lost');
  });
});

describe('multi-hero: guest targetability anchors to the acting hero (MP-13)', () => {
  it('a guest hero can attack after the host hero has already acted', () => {
    const p0 = makePlayer({ q: 0, r: 2 }, { id: 'p0', hasActed: true, movesLeft: 0 });
    const p1 = makePlayer({ q: 0, r: 0 }, { id: 'p1', hasActed: false });
    const enemy = makeEnemy(1, { q: 1, r: 0 }, { hp: 30, maxHp: 30 });
    const s0 = makeState({ player: p0, players: [p0, p1], activeHeroId: 'p0', enemies: [enemy] });

    const s1 = playerAttack(s0, { q: 1, r: 0 }, HALF, 'p1');

    // Without the re-anchor hoist, computeTargetable reads the host's acted hero
    // and returns [] → the guest's attack is silently dropped (foe stays at 30).
    const foe = s1.enemies.find((e) => e.id === 1)!;
    expect(foe.hp).toBeLessThan(30);
  });

  it('a guest hero can cast a targeted spell after the host hero has acted', () => {
    const p0 = makePlayer({ q: 0, r: 2 }, { id: 'p0', hasActed: true, movesLeft: 0 });
    const p1 = makePlayer({ q: 0, r: 0 }, { id: 'p1', hasActed: false });
    const enemy = makeEnemy(1, { q: 1, r: 0 }, { hp: 30, maxHp: 30 });
    const s0 = makeState({ player: p0, players: [p0, p1], activeHeroId: 'p0', enemies: [enemy] });

    const s1 = playerCastSpell(s0, 'sparks', { q: 1, r: 0 }, HALF, 'p1');

    const foe = s1.enemies.find((e) => e.id === 1)!;
    expect(foe.hp).toBeLessThan(30);
  });

  it('range validates from the acting hero, not the host — rejects an out-of-range guest attack', () => {
    // Host p0 is adjacent to the foe and has NOT acted; guest p1 is far away.
    // Without the fix, targetability validates from p0 (in range) and wrongly
    // accepts p1's attack. With the fix it validates from p1 (out of range) → no-op.
    const p0 = makePlayer({ q: 0, r: 0 }, { id: 'p0', hasActed: false });
    const p1 = makePlayer({ q: -3, r: 0 }, { id: 'p1', hasActed: false });
    const enemy = makeEnemy(1, { q: 1, r: 0 }, { hp: 30, maxHp: 30 });
    const s0 = makeState({ player: p0, players: [p0, p1], activeHeroId: 'p0', enemies: [enemy] });

    const s1 = playerAttack(s0, { q: 1, r: 0 }, HALF, 'p1');

    expect(s1).toBe(s0); // p1 can't reach the foe → intent rejected, state unchanged
  });
});
