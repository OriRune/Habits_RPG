import { describe, it, expect } from 'vitest';
import { emptyStatXP } from '../stats';
import { deriveCombatant, createBattle, playerAction, type RNG } from '../combat';
import { bossForLevel } from '../bosses';

/** Deterministic RNG returning a fixed value (0.5 = no crit, no dodge, mid variance). */
const fixed = (v: number): RNG => () => v;

describe('deriveCombatant', () => {
  it('derives HP and attack from stat XP', () => {
    const xp = emptyStatXP();
    xp.HP = 100; // points = 10
    xp.ST = 100; // points = 10
    const c = deriveCombatant(xp);
    expect(c.maxHp).toBe(60 + 10 * 8);
    expect(c.attack).toBe(8 + 15);
  });

  it('applies item buffs', () => {
    const c = deriveCombatant(emptyStatXP(), { KN: 5 });
    expect(c.spell).toBe(6 + Math.round(5 * 1.5));
  });
});

describe('bossForLevel', () => {
  it('returns the named Procrastination Slime at level 5', () => {
    expect(bossForLevel(5).id).toBe('procrastination_slime');
  });
  it('returns the Burnout Golem at level 20', () => {
    expect(bossForLevel(20).id).toBe('burnout_golem');
  });
  it('scales a generic boss otherwise', () => {
    expect(bossForLevel(7).id).toBe('trial_l7');
  });
});

describe('battle flow', () => {
  it('a strong player defeats a weak boss', () => {
    const xp = emptyStatXP();
    xp.ST = 2500; // big attack
    xp.HP = 900;
    const player = deriveCombatant(xp);
    let state = createBattle(player, bossForLevel(7));
    // Attack repeatedly with deterministic rng until resolved.
    let guard = 0;
    while (state.status === 'active' && guard++ < 50) {
      state = playerAction(state, player, { kind: 'attack' }, fixed(0.5));
    }
    expect(state.status).toBe('won');
  });

  it('anti-frustration reduces boss HP after repeated losses', () => {
    const player = deriveCombatant(emptyStatXP());
    const fresh = createBattle(player, bossForLevel(7), 0);
    const eased = createBattle(player, bossForLevel(7), 5);
    expect(eased.bossMaxHp).toBeLessThan(fresh.bossMaxHp);
  });
});
