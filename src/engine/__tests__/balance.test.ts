import { describe, it, expect } from 'vitest';
import {
  deriveCombatant,
  createBattle,
  playerAction,
  type Fighter,
  type BattleState,
  type RNG,
} from '../combat';
import { emptyStatLevels } from '../progression';
import { emptyCombatStats } from '../combatStats';
import { getWeapon, STARTER_WEAPON } from '../weapons';
import { enemyFor } from '../enemies';
import { bossForLevel } from '../bosses';
import { getBiome, bossFor } from '../biomes';
import type { StatId } from '../stats';
import type { BossDef } from '../bosses';

const fixed = (v: number): RNG => () => v;

/** A plausible on-level melee build: most points in Strength, some in HP/Endurance. */
function meleeFighter(charLevel: number, spread: Partial<Record<StatId, number>>): Fighter {
  const lv = { ...emptyStatLevels(), ...spread };
  return { c: deriveCombatant(lv, charLevel, emptyCombatStats()), weapon: getWeapon(STARTER_WEAPON) };
}

/**
 * Simulate a fight with a simple, realistic policy: swing while stamina allows, otherwise
 * brace to recover it. Deterministic rng (no dodges/crits) keeps the round count stable.
 */
function simulate(make: () => Fighter, foe: BossDef, maxRounds = 60) {
  let battle: BattleState = createBattle(make(), foe);
  let rounds = 0;
  while (battle.status === 'active' && rounds < maxRounds) {
    const f = make();
    const action = battle.playerSta >= f.weapon.staminaCost ? { kind: 'attack' as const } : { kind: 'defend' as const };
    battle = playerAction(battle, f, action, fixed(0.5));
    rounds++;
  }
  return { status: battle.status, rounds, playerHp: battle.playerHp };
}

describe('combat balance (reference fights)', () => {
  // A level-5 fighter who has trained Strength: ST 7, HP 5, EN 3.
  const lv5 = () => meleeFighter(5, { ST: 7, HP: 5, EN: 3, AG: 2 });

  it('a trained Lv5 fighter clears a depth-1 enemy and survives', () => {
    const foe = enemyFor(1, 5, ['skeleton'], fixed(0));
    const r = simulate(lv5, foe, 30);
    expect(r.status).toBe('won');
    expect(r.playerHp).toBeGreaterThan(0);
    expect(r.rounds).toBeLessThan(20);
  });

  it('a trained Lv5 fighter can win the first Level-Up Trial (Procrastination Slime)', () => {
    const r = simulate(lv5, bossForLevel(5), 50);
    expect(r.status).toBe('won');
    expect(r.playerHp).toBeGreaterThan(0);
  });

  it('the first dungeon boss still gates an underleveled (Lv1) fighter', () => {
    const tyrant = bossFor(getBiome('catacombs'), 5, 1);
    const r = simulate(() => meleeFighter(1, {}), tyrant, 60);
    expect(r.status).toBe('lost');
  });
});
