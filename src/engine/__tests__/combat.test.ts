import { describe, it, expect } from 'vitest';
import {
  deriveCombatant,
  createBattle,
  playerAction,
  illusionBoost,
  type Fighter,
  type RNG,
} from '../combat';
import { emptyStatLevels } from '../progression';
import { emptyCombatStats, combatXpForWin, dungeonCombatStatXp } from '../combatStats';
import { getWeapon, STARTER_WEAPON } from '../weapons';
import { bossForLevel } from '../bosses';

const fixed = (v: number): RNG => () => v;

function fighter(
  levels = emptyStatLevels(),
  combat = emptyCombatStats(),
  weaponKey = STARTER_WEAPON,
  charLevel = 5,
): Fighter {
  return { c: deriveCombatant(levels, charLevel, combat), weapon: getWeapon(weaponKey) };
}

describe('deriveCombatant', () => {
  it('derives resources from stat levels + character level', () => {
    const lv = emptyStatLevels();
    lv.HP = 10;
    lv.KN = 10;
    lv.EN = 10;
    lv.ST = 10;
    const c = deriveCombatant(lv, 1, emptyCombatStats());
    expect(c.maxHp).toBe(123); // 50 + 10*7 + 1*3
    expect(c.maxMp).toBe(38); // 8 + 10*3
    expect(c.maxSta).toBe(22); // 12 + 10
    expect(c.meleePower).toBe(10); // raw Strength level
  });

  it('reads Defense/Ward from combat stats', () => {
    const c = deriveCombatant(emptyStatLevels(), 1, { defenseXp: 100, wardXp: 400 });
    expect(c.defense).toBe(10);
    expect(c.ward).toBe(20);
  });
});

describe('createBattle', () => {
  it('seeds full HP/MP/STA, or carries starting HP/MP', () => {
    const lv = emptyStatLevels();
    lv.KN = 10;
    const f = fighter(lv);
    const full = createBattle(f, bossForLevel(7));
    expect(full.playerHp).toBe(full.playerMaxHp);
    expect(full.playerMp).toBe(full.playerMaxMp);

    const carried = createBattle(f, bossForLevel(7), { startingHp: 20, startingMp: 5 });
    expect(carried.playerHp).toBe(20);
    expect(carried.playerMp).toBe(5);
  });
});

describe('attack', () => {
  it('damages the foe and spends stamina', () => {
    const lv = emptyStatLevels();
    lv.ST = 10;
    const f = fighter(lv);
    const s0 = createBattle(f, bossForLevel(7));
    const s1 = playerAction(s0, f, { kind: 'attack' }, fixed(0.5));
    expect(s1.bossHp).toBeLessThan(s0.bossMaxHp);
    expect(s1.playerSta).toBe(s0.playerSta - f.weapon.staminaCost);
  });

  it('a low-stamina swing is marked exhausted', () => {
    const f = fighter();
    const s0 = createBattle(f, bossForLevel(7));
    s0.playerSta = 1; // below the weapon's stamina cost
    const s1 = playerAction(s0, f, { kind: 'attack' }, fixed(0.5));
    expect(s1.log.join(' ')).toContain('exhausted');
  });
});

describe('spells', () => {
  it('Sparks costs MP and deals magic damage', () => {
    const lv = emptyStatLevels();
    lv.KN = 10; // MP pool
    lv.WI = 10; // damage spell power
    const f = fighter(lv);
    const s0 = createBattle(f, bossForLevel(7));
    const s1 = playerAction(s0, f, { kind: 'spell', spellKey: 'sparks' }, fixed(0.5));
    expect(s1.playerMp).toBe(s0.playerMp - 4);
    expect(s1.bossHp).toBeLessThan(s0.bossMaxHp);
  });

  it('a spell with insufficient MP is a no-op (no turn spent)', () => {
    const f = fighter();
    const s0 = createBattle(f, bossForLevel(7), { startingMp: 2 });
    const s1 = playerAction(s0, f, { kind: 'spell', spellKey: 'sparks' }, fixed(0.5));
    expect(s1).toBe(s0); // unchanged reference — turn not consumed
  });

  it('Mend restores HP', () => {
    const lv = emptyStatLevels();
    lv.KN = 10;
    const f = fighter(lv);
    const s0 = createBattle(f, bossForLevel(7), { startingHp: 30 });
    const s1 = playerAction(s0, f, { kind: 'spell', spellKey: 'mend' }, fixed(0.5));
    expect(s1.playerHp).toBeGreaterThan(30);
  });

  it('Firebolt applies burn that damages the foe over time', () => {
    const lv = emptyStatLevels();
    lv.KN = 20;
    lv.WI = 10;
    const f = fighter(lv);
    const s0 = createBattle(f, bossForLevel(7));
    const s1 = playerAction(s0, f, { kind: 'spell', spellKey: 'firebolt' }, fixed(0.5));
    expect(s1.enemyStatuses.some((x) => x.key === 'burn')).toBe(true);
  });
});

describe('flee', () => {
  it('escapes when Agility is high', () => {
    const lv = emptyStatLevels();
    lv.AG = 10; // flee ~0.7
    const f = fighter(lv);
    const s0 = createBattle(f, bossForLevel(7));
    const s1 = playerAction(s0, f, { kind: 'flee' }, fixed(0.1));
    expect(s1.status).toBe('fled');
  });
});

// ── Iteration 4 combat tests ──────────────────────────────────────────────────

describe('pending rune spells', () => {
  const HALF = fixed(0.5); // variance ×1.0, delay=2, no backfire (0.5 >= 0.15)

  it('fire rune deals damage to the boss 2 turns after casting with rng=0.5', () => {
    const lv = emptyStatLevels();
    lv.KN = 5; // enough MP for fire_rune (costs 7)
    const f = fighter(lv);
    const s0 = createBattle(f, bossForLevel(7));
    const s1 = playerAction(s0, f, { kind: 'spell', spellKey: 'fire_rune' }, HALF);
    // After cast: rune pending with turnsLeft=1 (decremented once by enemyTurn's tickStatuses)
    expect(s1.pendingRunes).toHaveLength(1);
    const s2 = playerAction(s1, f, { kind: 'attack' }, HALF);
    // Rune fires after the second tickStatuses decrement
    expect(s2.pendingRunes).toHaveLength(0);
    expect(s2.bossHp).toBeLessThan(s0.bossMaxHp);
  });

  it('ice rune applies freeze status to the boss', () => {
    const lv = emptyStatLevels();
    lv.KN = 5;
    const f = fighter(lv);
    const s0 = createBattle(f, bossForLevel(7));
    const s1 = playerAction(s0, f, { kind: 'spell', spellKey: 'ice_rune' }, HALF);
    expect(s1.pendingRunes).toHaveLength(1);
    const s2 = playerAction(s1, f, { kind: 'attack' }, HALF);
    expect(s2.pendingRunes).toHaveLength(0);
    expect(s2.enemyStatuses.some((x) => x.key === 'freeze')).toBe(true);
  });

  it('poison rune applies poison DoT to the boss', () => {
    const lv = emptyStatLevels();
    lv.KN = 5;
    const f = fighter(lv);
    const s0 = createBattle(f, bossForLevel(7));
    const s1 = playerAction(s0, f, { kind: 'spell', spellKey: 'poison_rune' }, HALF);
    const s2 = playerAction(s1, f, { kind: 'attack' }, HALF);
    expect(s2.pendingRunes).toHaveLength(0);
    expect(s2.enemyStatuses.some((x) => x.key === 'poison')).toBe(true);
  });

  it('backfire hits the player when rng < 0.15', () => {
    // With fixed(0), delay = 1+floor(0*3) = 1, backfire check 0 < 0.15 → backfire
    const ZERO = fixed(0);
    const lv = emptyStatLevels();
    lv.KN = 5;
    const f = fighter(lv);
    const s0 = createBattle(f, bossForLevel(7));
    const s1 = playerAction(s0, f, { kind: 'spell', spellKey: 'fire_rune' }, ZERO);
    // With turnsLeft=1 and fixed(0), the rune fires immediately (same turn, backfire)
    expect(s1.pendingRunes).toHaveLength(0); // consumed
    expect(s1.playerHp).toBeLessThan(s0.playerMaxHp); // player was hit
    expect(s1.bossHp).toBe(s0.bossMaxHp); // boss untouched (backfire)
  });
});

describe('freeze status effect in turn-based combat', () => {
  it('a frozen boss skips its turn', () => {
    const f = fighter();
    const s0 = createBattle(f, bossForLevel(7));
    // Manually place freeze on the boss
    s0.enemyStatuses = [{ key: 'freeze', turns: 1, magnitude: 1 }];
    const hpBefore = s0.playerMaxHp;
    const s1 = playerAction(s0, f, { kind: 'defend' }, fixed(0.5));
    // Boss was frozen — player should not have taken damage
    expect(s1.playerHp).toBe(hpBefore);
    // Freeze wears off after the turn
    expect(s1.enemyStatuses.some((x) => x.key === 'freeze')).toBe(false);
  });
});

describe('ring of fire turn-based fallback', () => {
  it('applies burn status to the boss', () => {
    const lv = emptyStatLevels();
    lv.KN = 5;
    const f = fighter(lv);
    const s0 = createBattle(f, bossForLevel(7));
    const s1 = playerAction(s0, f, { kind: 'spell', spellKey: 'ring_of_fire' }, fixed(0.5));
    expect(s1.enemyStatuses.some((x) => x.key === 'burn')).toBe(true);
  });
});

describe('teleport turn-based fallback', () => {
  it('grants bless (evasive ward) to the player', () => {
    const f = fighter();
    const s0 = createBattle(f, bossForLevel(7));
    const s1 = playerAction(s0, f, { kind: 'spell', spellKey: 'chaotic_blink' }, fixed(0.5));
    expect(s1.playerStatuses.some((x) => x.key === 'bless')).toBe(true);
  });
});

describe('defense mitigation', () => {
  it('higher Defense means less physical damage taken', () => {
    const squishy = fighter(emptyStatLevels(), { defenseXp: 0, wardXp: 0 });
    const armored = fighter(emptyStatLevels(), { defenseXp: 900, wardXp: 0 }); // mitigation 30
    // Pass a fixed rng to createBattle so BOTH foes telegraph the same opening move — otherwise the
    // intent is picked from global Math.random and the two battles can retaliate with different
    // moves (one guard = 0 dmg), making the comparison flaky depending on prior Math.random calls.
    const a = playerAction(createBattle(squishy, bossForLevel(7), {}, fixed(0.5)), squishy, { kind: 'attack' }, fixed(0.5));
    const b = playerAction(createBattle(armored, bossForLevel(7), {}, fixed(0.5)), armored, { kind: 'attack' }, fixed(0.5));
    const dmgToSquishy = a.playerMaxHp - a.playerHp;
    const dmgToArmored = b.playerMaxHp - b.playerHp;
    expect(dmgToArmored).toBeLessThan(dmgToSquishy);
  });
});

// MINI-39: the foe's affinity is hidden until the player lands a hit that reveals it.
describe('affinity reveal', () => {
  it('a tagged (weak) hit flips affinityRevealed; a neutral hit leaves it hidden', () => {
    const lv = emptyStatLevels();
    lv.ST = 10;
    const f = fighter(lv);

    const weakFoe = createBattle(f, bossForLevel(7), {}, fixed(0.5));
    weakFoe.weakTo = [f.weapon.attackStat]; // force our weapon's stat to be a weakness
    weakFoe.resistTo = [];
    expect(weakFoe.affinityRevealed).toBeFalsy(); // hidden before any hit
    const afterWeak = playerAction(weakFoe, f, { kind: 'attack' }, fixed(0.5));
    expect(afterWeak.affinityRevealed).toBe(true);

    const neutralFoe = createBattle(f, bossForLevel(7), {}, fixed(0.5));
    neutralFoe.weakTo = [];
    neutralFoe.resistTo = [];
    const afterNeutral = playerAction(neutralFoe, f, { kind: 'attack' }, fixed(0.5));
    expect(afterNeutral.affinityRevealed).toBeFalsy(); // a plain hit reveals nothing
  });
});

// BAL-07: Charisma's illusion payoff. The shared illusionBoost helper backs all three casters
// (combat / arena / hexBattle), so testing it here covers the formula everywhere.
describe('illusionBoost (BAL-07 CH scaling)', () => {
  it('CH 0 leaves an illusion status untouched', () => {
    const weaken = { key: 'weaken' as const, turns: 3, magnitude: 0.4 };
    const out = illusionBoost(weaken, 0);
    expect(out.turns).toBe(3);
    expect(out.magnitude).toBeCloseTo(0.4, 5);
  });

  it('lengthens duration by floor(CH/4) — doubled from the old floor(CH/8)', () => {
    // CH 24: old bonus floor(24/8)=3 → new floor(24/4)=6. Most CH points now move the needle.
    expect(illusionBoost({ key: 'blind' as const, turns: 2, magnitude: 1 }, 24).turns).toBe(2 + 6);
    expect(illusionBoost({ key: 'blind' as const, turns: 2, magnitude: 1 }, 8).turns).toBe(2 + 2);
  });

  it('deepens weaken magnitude by floor(CH/6)·0.05, staying a sane 0–1 fraction', () => {
    // base 0.4 + floor(24/6)=4 · 0.05 = 0.6 — a flat +floor(CH/6) would have given a broken 4.4.
    expect(illusionBoost({ key: 'weaken' as const, turns: 3, magnitude: 0.4 }, 24).magnitude).toBeCloseTo(0.6, 5);
    expect(illusionBoost({ key: 'weaken' as const, turns: 3, magnitude: 0.4 }, 12).magnitude).toBeCloseTo(0.5, 5);
  });
});

// ARCH-25c: pin the combat-stat reward formulas (combatStats.ts). These pure fns feed
// dungeonSlice's win rewards; a coefficient drift here would silently rebalance the mode.
describe('combat-stat reward formulas (ARCH-25c)', () => {
  it('combatXpForWin scales as 12 + round(enemyMaxHp / 6)', () => {
    expect(combatXpForWin(0)).toBe(12);
    expect(combatXpForWin(60)).toBe(22);   // 12 + 10
    expect(combatXpForWin(100)).toBe(29);  // 12 + round(16.67)
  });

  it('dungeonCombatStatXp = 8 + round(hp/10), split 60/40 attack/HP', () => {
    const a = dungeonCombatStatXp(100); // total 8 + 10 = 18
    expect(a).toEqual({ total: 18, atkShare: 11, hpShare: 7 }); // round(18·0.6)=11
    const b = dungeonCombatStatXp(0);   // total 8
    expect(b).toEqual({ total: 8, atkShare: 5, hpShare: 3 });   // round(8·0.6)=5
    // the split always reconstitutes total (no rounding leak)
    expect(a.atkShare + a.hpShare).toBe(a.total);
    expect(b.atkShare + b.hpShare).toBe(b.total);
  });
});
