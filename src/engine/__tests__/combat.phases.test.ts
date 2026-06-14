import { describe, it, expect } from 'vitest';
import { emptyStatXP } from '../stats';
import { emptyCombatStats } from '../combatStats';
import { deriveCombatant, createBattle, playerAction, type Fighter, type RNG } from '../combat';
import { getWeapon, STARTER_WEAPON } from '../weapons';
import type { BossDef } from '../bosses';

const fixed = (v: number): RNG => () => v;

function strongFighter(): Fighter {
  const xp = emptyStatXP();
  xp.ST = 10000; // huge melee
  xp.DX = 10000; // huge ranged (whichever the starter weapon uses)
  xp.HP = 10000; // survive the foe's turn
  return { c: deriveCombatant(xp, emptyCombatStats(), {}), weapon: getWeapon(STARTER_WEAPON) };
}

const twoPhase: BossDef = {
  id: 'tester',
  name: 'Tester',
  flavor: '',
  baseHp: 10,
  attack: 1,
  defense: 0,
  weakTo: [],
  phases: [
    { hp: 10, attack: 1, defense: 0, weakTo: [] },
    { hp: 10, attack: 1, defense: 0, weakTo: [], transitionMsg: 'PHASE TWO BEGINS' },
  ],
  rewards: { gold: 0, items: [] },
};

describe('multi-phase bosses', () => {
  it('advances to the next phase instead of ending when a phase falls', () => {
    const battle = createBattle(strongFighter(), twoPhase);
    const after = playerAction(battle, strongFighter(), { kind: 'attack' }, fixed(0));
    expect(after.status).toBe('active');
    expect(after.phaseIndex).toBe(1);
    expect(after.bossHp).toBeGreaterThan(0); // fresh HP bar for phase two
    expect(after.log.some((l) => l.includes('PHASE TWO BEGINS'))).toBe(true);
  });

  it('declares victory only when the final phase falls', () => {
    let battle = createBattle(strongFighter(), twoPhase);
    battle = playerAction(battle, strongFighter(), { kind: 'attack' }, fixed(0)); // phase 1 → 2
    battle = playerAction(battle, strongFighter(), { kind: 'attack' }, fixed(0)); // phase 2 → won
    expect(battle.status).toBe('won');
  });
});

describe('resistTo', () => {
  it('reduces damage from a resisted stat', () => {
    const fighter = strongFighter();
    const weaponStat = fighter.weapon.attackStat;
    const plain: BossDef = { id: 'a', name: 'A', flavor: '', baseHp: 100000, attack: 1, defense: 0, weakTo: [], rewards: { gold: 0, items: [] } };
    const resistant: BossDef = { ...plain, id: 'b', name: 'B', resistTo: [weaponStat] };

    const a = playerAction(createBattle(fighter, plain), fighter, { kind: 'attack' }, fixed(0));
    const b = playerAction(createBattle(fighter, resistant), fighter, { kind: 'attack' }, fixed(0));

    const dealtPlain = a.bossMaxHp - a.bossHp;
    const dealtResisted = b.bossMaxHp - b.bossHp;
    expect(dealtResisted).toBeLessThan(dealtPlain);
  });
});
