import { describe, it, expect } from 'vitest';
import {
  deriveCombatant,
  createBattle,
  playerAction,
  type Fighter,
  type RNG,
} from '../combat';
import { emptyStatLevels } from '../progression';
import { emptyCombatStats } from '../combatStats';
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
    expect(c.maxSta).toBe(14); // 4 + 10
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

describe('defense mitigation', () => {
  it('higher Defense means less physical damage taken', () => {
    const squishy = fighter(emptyStatLevels(), { defenseXp: 0, wardXp: 0 });
    const armored = fighter(emptyStatLevels(), { defenseXp: 900, wardXp: 0 }); // mitigation 30
    const a = playerAction(createBattle(squishy, bossForLevel(7)), squishy, { kind: 'attack' }, fixed(0.5));
    const b = playerAction(createBattle(armored, bossForLevel(7)), armored, { kind: 'attack' }, fixed(0.5));
    const dmgToSquishy = a.playerMaxHp - a.playerHp;
    const dmgToArmored = b.playerMaxHp - b.playerHp;
    expect(dmgToArmored).toBeLessThan(dmgToSquishy);
  });
});
