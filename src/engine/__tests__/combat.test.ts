import { describe, it, expect } from 'vitest';
import { emptyStatXP } from '../stats';
import {
  deriveCombatant,
  createBattle,
  playerAction,
  type Fighter,
  type RNG,
} from '../combat';
import { emptyCombatStats } from '../combatStats';
import { getWeapon, STARTER_WEAPON } from '../weapons';
import { bossForLevel } from '../bosses';

const fixed = (v: number): RNG => () => v;

function fighter(
  statXp = emptyStatXP(),
  combat = emptyCombatStats(),
  weaponKey = STARTER_WEAPON,
): Fighter {
  return { c: deriveCombatant(statXp, combat), weapon: getWeapon(weaponKey) };
}

describe('deriveCombatant', () => {
  it('derives resources from the reassigned combat stats', () => {
    const xp = emptyStatXP();
    xp.HP = 100; // 10
    xp.KN = 100; // 10
    xp.EN = 100; // 10
    xp.ST = 100; // 10
    const c = deriveCombatant(xp, emptyCombatStats());
    expect(c.maxHp).toBe(140); // 60 + 10*8
    expect(c.maxMp).toBe(50); // 10 + 10*4
    expect(c.maxSta).toBe(20); // 5 + round(10*1.5)
    expect(c.meleePower).toBe(15); // round(10*1.5)
  });

  it('reads Defense/Ward from combat stats', () => {
    const c = deriveCombatant(emptyStatXP(), { defenseXp: 100, wardXp: 400 });
    expect(c.defense).toBe(10);
    expect(c.ward).toBe(20);
  });
});

describe('createBattle', () => {
  it('seeds full HP/MP/STA, or carries starting HP/MP', () => {
    const xp = emptyStatXP();
    xp.KN = 100;
    const f = fighter(xp);
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
    const xp = emptyStatXP();
    xp.ST = 100;
    const f = fighter(xp);
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
    const xp = emptyStatXP();
    xp.KN = 100; // MP pool
    xp.WI = 100; // damage spell power
    const f = fighter(xp);
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
    const xp = emptyStatXP();
    xp.KN = 100;
    const f = fighter(xp);
    const s0 = createBattle(f, bossForLevel(7), { startingHp: 30 });
    const s1 = playerAction(s0, f, { kind: 'spell', spellKey: 'mend' }, fixed(0.5));
    expect(s1.playerHp).toBeGreaterThan(30);
  });

  it('Firebolt applies burn that damages the foe over time', () => {
    const xp = emptyStatXP();
    xp.KN = 200;
    xp.WI = 100;
    const f = fighter(xp);
    const s0 = createBattle(f, bossForLevel(7));
    const s1 = playerAction(s0, f, { kind: 'spell', spellKey: 'firebolt' }, fixed(0.5));
    expect(s1.enemyStatuses.some((x) => x.key === 'burn')).toBe(true);
  });
});

describe('flee', () => {
  it('escapes when Agility is high', () => {
    const xp = emptyStatXP();
    xp.AG = 100; // flee ~0.7
    const f = fighter(xp);
    const s0 = createBattle(f, bossForLevel(7));
    const s1 = playerAction(s0, f, { kind: 'flee' }, fixed(0.1));
    expect(s1.status).toBe('fled');
  });
});

describe('defense mitigation', () => {
  it('higher Defense means less physical damage taken', () => {
    const squishy = fighter(emptyStatXP(), { defenseXp: 0, wardXp: 0 });
    const armored = fighter(emptyStatXP(), { defenseXp: 900, wardXp: 0 }); // mitigation 30
    const a = playerAction(createBattle(squishy, bossForLevel(7)), squishy, { kind: 'attack' }, fixed(0.5));
    const b = playerAction(createBattle(armored, bossForLevel(7)), armored, { kind: 'attack' }, fixed(0.5));
    const dmgToSquishy = a.playerMaxHp - a.playerHp;
    const dmgToArmored = b.playerMaxHp - b.playerHp;
    expect(dmgToArmored).toBeLessThan(dmgToSquishy);
  });
});
