// Tests for the enemy MP & stamina economy added to the combat engine.
import { describe, it, expect } from 'vitest';
import { emptyStatLevels, STAT_CAP } from '../progression';
import { emptyCombatStats } from '../combatStats';
import { deriveCombatant, createBattle, playerAction, type Fighter, type RNG } from '../combat';
import { getWeapon, STARTER_WEAPON } from '../weapons';
import type { BossDef, EnemyMove } from '../bosses';
import type { BattleState } from '../combat';

const fixed = (v: number): RNG => () => v;

function strongFighter(): Fighter {
  const lv = emptyStatLevels();
  lv.AG = 0; lv.ST = STAT_CAP; lv.DX = STAT_CAP; lv.HP = STAT_CAP; lv.EN = STAT_CAP;
  return { c: deriveCombatant(lv, 10, emptyCombatStats(), {}), weapon: getWeapon(STARTER_WEAPON) };
}

function tankFoe(moveset: EnemyMove[], attackSchool: 'physical' | 'magic' = 'physical'): BossDef {
  return {
    id: 'test', name: 'Test Foe', flavor: '', baseHp: 1000, attack: 5, defense: 0,
    weakTo: [], attackSchool,
    phases: [{ hp: 1000, attack: 5, defense: 0, weakTo: [], attackSchool, moveset }],
    rewards: { gold: 0, items: [] },
  };
}

describe('enemy resources — initialisation', () => {
  it('pools are set on battle creation from applyPhase', () => {
    const foe = tankFoe([{ kind: 'attack', label: 'attacks' }]);
    const b = createBattle(strongFighter(), foe, {}, fixed(0));
    // phase.attack = 5 → basePool = 8 + round(5 * 0.4) = 8 + 2 = 10
    expect(b.bossMaxMp).toBe(10);
    expect(b.bossMp).toBe(10);
    expect(b.bossMaxSta).toBe(10);
    expect(b.bossSta).toBe(10);
  });

  it('custom maxMp/maxSta on a phase override the auto-derived value', () => {
    const foe: BossDef = {
      id: 'x', name: 'X', flavor: '', baseHp: 100, attack: 10, defense: 0, weakTo: [],
      phases: [{ hp: 100, attack: 10, defense: 0, weakTo: [], maxMp: 5, maxSta: 7 }],
      rewards: { gold: 0, items: [] },
    };
    const b = createBattle(strongFighter(), foe, {}, fixed(0));
    expect(b.bossMaxMp).toBe(5);
    expect(b.bossMaxSta).toBe(7);
    expect(b.bossMp).toBe(5);
    expect(b.bossSta).toBe(7);
  });

  it('foe with no moveset (trial guardian) starts with pools but never spends them', () => {
    const noMoveset: BossDef = {
      id: 'plain', name: 'Plain', flavor: '', baseHp: 100, attack: 4, defense: 0,
      weakTo: [], rewards: { gold: 0, items: [] },
    };
    const b = createBattle(strongFighter(), noMoveset, {}, fixed(0));
    expect(b.bossMaxMp).toBeGreaterThan(0);
    const after = playerAction(b, strongFighter(), { kind: 'defend' }, fixed(0));
    // Free-attack fallback spends nothing.
    expect(after.bossMp).toBe(after.bossMaxMp);
    expect(after.bossSta).toBe(after.bossMaxSta);
  });
});

describe('enemy resources — cost deduction', () => {
  it('physical foe spends stamina on a basic attack', () => {
    const foe = tankFoe([{ kind: 'attack', label: 'swings' }], 'physical');
    const b = createBattle(strongFighter(), foe, {}, fixed(0));
    const after = playerAction(b, strongFighter(), { kind: 'defend' }, fixed(0));
    // attack costs 1 STA; regen adds 2; net = +1 vs staBefore (capped at max)
    // Since staBefore == max, it stays at max.
    expect(after.bossSta).toBeLessThanOrEqual(after.bossMaxSta);
    // After the attack the foe spent 1 STA, then regened 2 — net still at cap.
    // Verify it's not gone negative.
    expect(after.bossSta).toBeGreaterThanOrEqual(0);
    // More useful: manually cap off regen and check the deduction.
    const bFull = { ...b, bossSta: 1, bossMaxSta: 100 }; // just 1 STA
    const after2 = playerAction(bFull, strongFighter(), { kind: 'defend' }, fixed(0));
    // Spent 1 (attack cost), then regened 2 → bossSta = 0 - 1 → clamped 0, then +2 = 2.
    expect(after2.bossSta).toBe(2);
  });

  it('magic foe spends MP on a basic attack', () => {
    const foe = tankFoe([{ kind: 'attack', label: 'blasts' }], 'magic');
    const b = createBattle(strongFighter(), foe, {}, fixed(0));
    // Force low MP to see deduction clearly.
    const bLow = { ...b, bossMp: 2, bossMaxMp: 100 };
    const after = playerAction(bLow, strongFighter(), { kind: 'defend' }, fixed(0));
    // Spent 2 (attack on magic foe costs 2), regen +1 → 2 - 2 + 1 = 1.
    expect(after.bossMp).toBe(1);
  });

  it('inflict always costs MP', () => {
    const foe = tankFoe([{ kind: 'inflict', inflictKey: 'weaken', inflictTurns: 2, inflictMag: 0.3, label: 'weakens' }], 'physical');
    const b = createBattle(strongFighter(), foe, {}, fixed(0));
    const bLow = { ...b, bossMp: 3, bossMaxMp: 100 };
    const after = playerAction(bLow, strongFighter(), { kind: 'defend' }, fixed(0));
    // inflict costs 3 MP, regen +1 → 3 - 3 + 1 = 1.
    expect(after.bossMp).toBe(1);
  });

  it('heavy move costs more stamina than a basic attack (physical)', () => {
    const f = strongFighter();
    const attackFoe = tankFoe([{ kind: 'attack', label: 'swings' }], 'physical');
    const heavyFoe  = tankFoe([{ kind: 'heavy', mult: 2, label: 'crushes' }], 'physical');

    // Force starting STA low enough that regen won't fully mask the difference.
    const stateA = { ...createBattle(f, attackFoe, {}, fixed(0)), bossSta: 5, bossMaxSta: 100 };
    const stateH = { ...createBattle(f, heavyFoe,  {}, fixed(0)), bossSta: 5, bossMaxSta: 100 };

    const afterA = playerAction(stateA, f, { kind: 'defend' }, fixed(0));
    const afterH = playerAction(stateH, f, { kind: 'defend' }, fixed(0));

    // attack: 5 - 1 + 2 = 6; heavy: 5 - 3 + 2 = 4
    expect(afterH.bossSta).toBeLessThan(afterA.bossSta);
  });
});

describe('enemy resources — affordability gating', () => {
  it('foe falls back to null (free attack) when nothing in pool is affordable', () => {
    // Move costs 5 STA; foe starts with 0 STA.
    const expensiveMove: EnemyMove = { kind: 'heavy', mult: 2, label: 'crushes', staCost: 5 };
    const foe = tankFoe([expensiveMove], 'physical');
    const b = createBattle(strongFighter(), foe, {}, fixed(0));
    const bBroke = { ...b, bossSta: 0, bossMaxSta: 100 };
    // pickEnemyMove should return null → intent is null (free attack).
    expect(bBroke.enemyIntent).toBe(b.enemyIntent); // just checking state shape here
    // On the actual turn, the free-attack fallback fires (intent = null branch in executeEnemyMove).
    // Verify the foe still acts and doesn't crash.
    const after = playerAction(bBroke, strongFighter(), { kind: 'defend' }, fixed(0));
    expect(after.status).toBe('active');
    // STA: 0 (no deduction for free attack) + regen 2 = 2.
    expect(after.bossSta).toBe(2);
  });

  it('pickEnemyMove excludes unaffordable moves from the roll', () => {
    // Two moves: cheap (attack, 1 STA) and expensive (heavy, 3 STA).
    // Starting STA = 2 → only 'attack' is affordable.
    const cheapMove:     EnemyMove = { kind: 'attack', label: 'swings', weight: 1 };
    const expensiveMove: EnemyMove = { kind: 'heavy',  label: 'crushes', mult: 2, weight: 100 };
    const foe = tankFoe([cheapMove, expensiveMove], 'physical');
    const b = createBattle(strongFighter(), foe, {}, fixed(0));
    // Cast to BattleState so TypeScript allows reassignment from playerAction's return type.
    const bLowSta: BattleState = { ...b, bossSta: 2, bossMaxSta: 100 };

    // Run several turns and assert the foe never telegraphs 'heavy'.
    let state = bLowSta;
    for (let i = 0; i < 5; i++) {
      state = playerAction(state, strongFighter(), { kind: 'defend' }, fixed(0));
      if (state.enemyIntent !== null) {
        expect(state.enemyIntent.kind).not.toBe('heavy');
      }
      state = { ...state, bossSta: 2 }; // keep STA at 2 to keep heavy unaffordable
    }
  });
});

describe('enemy resources — regen', () => {
  it('resources regen by a fixed amount each turn', () => {
    const foe = tankFoe([{ kind: 'attack', label: 'swings' }], 'physical');
    const b = createBattle(strongFighter(), foe, {}, fixed(0));
    // Drain to zero.
    const bDrained = { ...b, bossMp: 0, bossSta: 0 };
    const after = playerAction(bDrained, strongFighter(), { kind: 'defend' }, fixed(0));
    // STA: 0 - 1 (attack cost) → clamp 0 → +2 regen = 2. MP: 0 + 1 = 1.
    expect(after.bossSta).toBe(2);
    expect(after.bossMp).toBe(1);
  });
});

describe('enemy resources — phase transition', () => {
  it('pools refill to max when a new phase begins', () => {
    const f = strongFighter();
    const boss: BossDef = {
      id: 'two', name: 'Two', flavor: '', baseHp: 0, attack: 0, defense: 0, weakTo: [],
      rewards: { gold: 0, items: [] },
      phases: [
        { hp: 1, attack: 5, defense: 0, weakTo: [],
          moveset: [{ kind: 'attack', label: 'swings' }] },
        { hp: 1000, attack: 10, defense: 0, weakTo: [],
          moveset: [{ kind: 'guard', label: 'braces' }] },
      ],
    };
    const b = createBattle(f, boss, {}, fixed(0));
    // Drain pools before the phase transition.
    const bDrained = { ...b, bossMp: 0, bossSta: 0 };
    // Player one-shots phase 1 → phase 2 begins → applyPhase refills.
    const after = playerAction(bDrained, f, { kind: 'attack' }, fixed(0));
    expect(after.phaseIndex).toBe(1);
    // Phase 2 attack=10 → basePool = 8 + round(10*0.4) = 12. Pools refilled.
    expect(after.bossMp).toBe(after.bossMaxMp);
    expect(after.bossSta).toBe(after.bossMaxSta);
  });
});
