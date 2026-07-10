// Phase 3 progression rules (dungeon-delve-plan-2026-07.md items 3.2 + 3.4, decision D6):
// biome expedition starts, the start-relative energy contract, and cycle mutators.
import { describe, it, expect } from 'vitest';
import {
  expeditionStarts,
  descentCharged,
  DUNGEON_FREE_FLOORS,
} from '../dungeon';
import { cycleMutator, bossFor, getBiome, CYCLE_MUTATORS, BIOME_ORDER } from '../biomes';
import { enemyFor, ENEMIES } from '../enemies';

describe('expeditionStarts (plan 3.2 / D6)', () => {
  it('offers only floor 1 to a fresh character', () => {
    expect(expeditionStarts(0, [])).toEqual([1]);
  });

  it('unlocks a biome start by slaying its previous boss', () => {
    expect(expeditionStarts(5, [5])).toEqual([1, 6]);
    expect(expeditionStarts(5, [5, 10])).toEqual([1, 6, 11]);
  });

  it('grants legacy credit via deepestFloor (pre-tracking saves proved the kill by descending)', () => {
    expect(expeditionStarts(6, [])).toEqual([1, 6]);
    expect(expeditionStarts(13, [])).toEqual([1, 6, 11]);
    // Reaching the boss floor itself is not proof of beating it.
    expect(expeditionStarts(5, [])).toEqual([1]);
  });

  it('unlocks stay contiguous — a later credit cannot skip an earlier gap', () => {
    // Slaying boss 10 without boss-5 credit cannot happen in play; the helper still
    // refuses to offer floor 11 without floor 6.
    expect(expeditionStarts(0, [10])).toEqual([1]);
  });
});

describe('descentCharged (D1 relative to the start floor, D6)', () => {
  it('matches the floor-1 contract exactly', () => {
    expect(descentCharged(2)).toBe(false);
    expect(descentCharged(DUNGEON_FREE_FLOORS)).toBe(false);
    expect(descentCharged(DUNGEON_FREE_FLOORS + 1)).toBe(true);
  });

  it('shifts the covered window to the expedition start', () => {
    // A floor-6 start covers 6–8; descending to 9 is the first paid floor.
    expect(descentCharged(7, 6)).toBe(false);
    expect(descentCharged(8, 6)).toBe(false);
    expect(descentCharged(9, 6)).toBe(true);
  });
});

describe('cycleMutator (plan 3.4 / DUN-15)', () => {
  const cycleLen = BIOME_ORDER.length * 5;

  it('leaves the first pass (floors 1–15) unmutated', () => {
    expect(cycleMutator(1)).toBeNull();
    expect(cycleMutator(cycleLen)).toBeNull();
  });

  it('applies one mutator per cycle, clamping past the table', () => {
    expect(cycleMutator(cycleLen + 1)).toBe(CYCLE_MUTATORS[0]);
    expect(cycleMutator(cycleLen * 2)).toBe(CYCLE_MUTATORS[0]);
    expect(cycleMutator(cycleLen * 2 + 1)).toBe(CYCLE_MUTATORS[1]);
    expect(cycleMutator(cycleLen * 3 + 1)).toBe(CYCLE_MUTATORS[2]);
    expect(cycleMutator(999)).toBe(CYCLE_MUTATORS[CYCLE_MUTATORS.length - 1]);
  });

  it('every mutator escalates and pays for it', () => {
    let prev = { enemyHp: 1, enemyAttack: 1, goldBonus: 1 };
    for (const m of CYCLE_MUTATORS) {
      expect(m.enemyHp).toBeGreaterThan(prev.enemyHp);
      expect(m.enemyAttack).toBeGreaterThan(prev.enemyAttack);
      expect(m.goldBonus).toBeGreaterThanOrEqual(m.enemyHp * 0.9); // premium tracks the HP tax
      prev = m;
    }
  });

  it('scales enemies at spawn: floor 16 foes carry the Sunless multipliers', () => {
    const t = ENEMIES.goblin;
    const scale = 1 + (16 - 1) * 0.14; // level 1: no level term
    const m = CYCLE_MUTATORS[0];
    const foe = enemyFor(16, 1, ['goblin'], () => 0);
    expect(foe.baseHp).toBe(Math.round(t.hp * scale * m.enemyHp));
    expect(foe.attack).toBe(Math.round(t.attack * scale * m.enemyAttack));
    // …and floor 15 (same cycle 0) stays on the base formula.
    const shallow = enemyFor(15, 1, ['goblin'], () => 0);
    expect(shallow.baseHp).toBe(Math.round(t.hp * (1 + 14 * 0.14)));
  });

  it('scales bosses the same way', () => {
    const biome = getBiome('catacombs');
    const m = CYCLE_MUTATORS[0];
    const base = biome.boss;
    const scale = 1 + (20 - 1) * 0.1; // depth 20 boss, level 1
    const boss = bossFor(biome, 20, 1);
    expect(boss.baseHp).toBe(Math.round(base.baseHp * scale * m.enemyHp));
    expect(boss.attack).toBe(Math.round(base.attack * scale * m.enemyAttack));
  });
});
