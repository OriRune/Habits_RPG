// Tests for Phase 1 combat depth: enemy movesets, telegraphed intents, and player-weaken.
import { describe, it, expect } from 'vitest';
import { emptyStatLevels, STAT_CAP } from '../progression';
import { emptyCombatStats } from '../combatStats';
import { deriveCombatant, createBattle, playerAction, type Fighter, type RNG } from '../combat';
import { getWeapon, STARTER_WEAPON } from '../weapons';
import { bossForLevel } from '../bosses';
import type { BossDef, EnemyMove } from '../bosses';

/** Always returns the same value — predictable variance and intent selection. */
const fixed = (v: number): RNG => () => v;

/**
 * High-stat fighter that survives and hits hard.
 * AG is explicitly set to 0 (below the BASE_STAT_LEVEL=1 default) so that
 * c.dodge = 0, making enemy dodge-check tests deterministic with fixed(0).
 */
function strongFighter(): Fighter {
  const lv = emptyStatLevels();
  lv.AG = 0; // Force dodge=0 so rng() < dodge is never true with fixed(0)
  lv.ST = STAT_CAP; lv.DX = STAT_CAP; lv.HP = STAT_CAP; lv.EN = STAT_CAP;
  return { c: deriveCombatant(lv, 10, emptyCombatStats(), {}), weapon: getWeapon(STARTER_WEAPON) };
}

/** A tanky test foe with a known attack stat. */
function liveFoe(moveset?: EnemyMove[]): BossDef {
  return {
    id: 'test', name: 'Test Foe', flavor: '', baseHp: 1000, attack: 2, defense: 0,
    weakTo: [], moveset,
    rewards: { gold: 0, items: [] },
  };
}

// ---------------------------------------------------------------------------
// Intent basics
// ---------------------------------------------------------------------------

describe('telegraphed intent', () => {
  it('is null on battle creation when foe has no moveset', () => {
    const b = createBattle(strongFighter(), liveFoe());
    expect(b.enemyIntent).toBeNull();
  });

  it('is set on battle creation when foe has a moveset', () => {
    const b = createBattle(strongFighter(), liveFoe([
      { kind: 'attack', label: 'strikes', icon: '⚔️' },
    ]), {}, fixed(0));
    expect(b.enemyIntent).not.toBeNull();
    expect(b.enemyIntent!.kind).toBe('attack');
  });

  it('updates after each turn (player sees next intent)', () => {
    const f = strongFighter();
    const foe = liveFoe([{ kind: 'attack', weight: 1, label: 'attacks' }]);
    const b1 = createBattle(f, foe, {}, fixed(0));
    const b2 = playerAction(b1, f, { kind: 'defend' }, fixed(0));
    // After player acts, a new intent should still be queued.
    expect(b2.enemyIntent).not.toBeNull();
    expect(b2.enemyIntent!.kind).toBe('attack');
  });

  it('intent from old phase clears (null) after a phase transition then is picked from new phase', () => {
    const f = strongFighter();
    const boss: BossDef = {
      id: 'two_phase', name: 'Two-Phase', flavor: '', baseHp: 0, attack: 1, defense: 0, weakTo: [],
      rewards: { gold: 0, items: [] },
      phases: [
        { hp: 1, attack: 1, defense: 0, weakTo: [],
          moveset: [{ kind: 'attack', label: 'strikes p1' }] },
        { hp: 1000, attack: 1, defense: 0, weakTo: [],
          moveset: [{ kind: 'guard', label: 'guards p2', bonus: 2 }] },
      ],
    };
    const b1 = createBattle(f, boss, {}, fixed(0));
    // Player one-shots phase 1. Enemy then acts in phase 2 and picks a new intent.
    const b2 = playerAction(b1, f, { kind: 'attack' }, fixed(0));
    expect(b2.phaseIndex).toBe(1);
    // After the enemy turn in phase 2, intent is from phase 2's moveset (guard).
    expect(b2.enemyIntent?.kind).toBe('guard');
  });
});

// ---------------------------------------------------------------------------
// Guard move
// ---------------------------------------------------------------------------

describe('guard move', () => {
  it('sets enemyGuardBonus after executing', () => {
    const f = strongFighter();
    // Foe that only guards.
    const foe = liveFoe([{ kind: 'guard', bonus: 10, label: 'braces', icon: '🛡️' }]);
    const b = createBattle(f, foe, {}, fixed(0));
    // Player attacks → enemy executes guard intent → guard bonus set.
    const b2 = playerAction(b, f, { kind: 'attack' }, fixed(0));
    expect(b2.enemyGuardBonus).toBe(10);
  });

  it('guard bonus is reflected in the log', () => {
    const f = strongFighter();
    const foe = liveFoe([{ kind: 'guard', bonus: 5, label: 'braces', icon: '🛡️' }]);
    const b = createBattle(f, foe, {}, fixed(0));
    const b2 = playerAction(b, f, { kind: 'attack' }, fixed(0));
    expect(b2.log.some((l) => l.includes('guard'))).toBe(true);
  });

  it('guard bonus reduces physical attack damage (attack into guard vs no guard)', () => {
    const f = strongFighter();

    // Turn sequence without guard: player attacks, enemy attacks normally.
    const plainFoe = liveFoe([{ kind: 'attack', label: 'attacks' }]);
    // Enemy attacks plain → player attacks plain foe (to measure player→enemy damage path is irrelevant;
    // we want to measure how guard affects the bossDefense for the PLAYER's attack).
    // Setup: manually inject guard bonus into the state, then attack.
    const b_base = createBattle(f, plainFoe, {}, fixed(0));
    const after_base = playerAction(b_base, f, { kind: 'attack' }, fixed(0));
    const dmgBase = b_base.bossHp - after_base.bossHp;

    // Now inject a large guard bonus and compare.
    const b_guarded = { ...b_base, enemyGuardBonus: 999 };
    const after_guarded = playerAction(b_guarded, f, { kind: 'attack' }, fixed(0));
    const dmgGuarded = b_guarded.bossHp - after_guarded.bossHp;

    expect(dmgGuarded).toBeLessThan(dmgBase);
  });

  it('guard bonus resets to 0 at the start of the next enemy turn', () => {
    const f = strongFighter();
    // Foe always guards — so guard fires every enemy turn.
    const foe = liveFoe([{ kind: 'guard', bonus: 5, label: 'braces', icon: '🛡️' }]);
    const b = createBattle(f, foe, {}, fixed(0));
    // Turn 1: enemy sets guard.
    const b2 = playerAction(b, f, { kind: 'attack' }, fixed(0));
    expect(b2.enemyGuardBonus).toBe(5);
    // Turn 2: guard resets to 0 at start of enemy turn, then set to 5 again (same foe).
    const b3 = playerAction(b2, f, { kind: 'attack' }, fixed(0));
    // Guard was reset then re-applied (foe always guards); can't stack beyond 5.
    expect(b3.enemyGuardBonus).toBe(5); // didn't double-stack
  });
});

// ---------------------------------------------------------------------------
// Heavy move
// ---------------------------------------------------------------------------

describe('heavy move', () => {
  it('deals more damage than a basic attack at the same attack stat', () => {
    const f = strongFighter();
    const foe: BossDef = {
      id: 'x', name: 'X', flavor: '', baseHp: 1000, attack: 20, defense: 0,
      weakTo: [], rewards: { gold: 0, items: [] },
    };

    // Attack-only foe: measure player damage received.
    const attackFoe = { ...foe, moveset: [{ kind: 'attack' as const, label: 'attacks' }] };
    const b1 = createBattle(f, attackFoe, {}, fixed(0.5)); // use 0.5 for moderate variance
    // Player attacks — enemy attacks back.
    const a1 = playerAction(b1, f, { kind: 'attack' }, fixed(0.5));
    const dmgAttack = b1.playerHp - a1.playerHp;

    // Heavy foe (mult 2.5): guaranteed to exceed plain attack at same rng.
    const heavyFoe = { ...foe, moveset: [{ kind: 'heavy' as const, mult: 2.5, label: 'heavy-attacks' }] };
    const b2 = createBattle(f, heavyFoe, {}, fixed(0.5));
    const a2 = playerAction(b2, f, { kind: 'attack' }, fixed(0.5));
    const dmgHeavy = b2.playerHp - a2.playerHp;

    expect(dmgHeavy).toBeGreaterThan(dmgAttack);
  });

  it('logs the heavy attack description', () => {
    const f = strongFighter();
    const foe = liveFoe([{ kind: 'heavy', mult: 2.0, label: 'winds up a crushing blow', icon: '💥' }]);
    const b = createBattle(f, foe, {}, fixed(0));
    const after = playerAction(b, f, { kind: 'attack' }, fixed(0));
    expect(after.log.some((l) => l.includes('winds up a crushing blow'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi move
// ---------------------------------------------------------------------------

describe('multi move', () => {
  it('hits the stated number of times (reflected in log)', () => {
    const f = strongFighter(); // HP survives all hits; AG=0 so no dodge
    const foe = liveFoe([{ kind: 'multi', hits: 3, label: 'rapid-strikes' }]);
    const b = createBattle(f, foe, {}, fixed(0));
    const after = playerAction(b, f, { kind: 'attack' }, fixed(0)); // player attacks; enemy multi-strikes
    const hitLogs = after.log.filter((l) => l.startsWith('  Hit'));
    expect(hitLogs.length).toBe(3);
  });

  it('logs each individual hit', () => {
    const f = strongFighter();
    const foe = liveFoe([{ kind: 'multi', hits: 2, label: 'flurry' }]);
    const b = createBattle(f, foe, {}, fixed(0));
    const after = playerAction(b, f, { kind: 'attack' }, fixed(0));
    expect(after.log.some((l) => l.includes('Hit 1'))).toBe(true);
    expect(after.log.some((l) => l.includes('Hit 2'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inflict move
// ---------------------------------------------------------------------------

describe('inflict move', () => {
  it('applies a status effect to the player', () => {
    const f = strongFighter();
    const foe = liveFoe([{ kind: 'inflict', inflictKey: 'poison', inflictTurns: 5, inflictMag: 2, label: 'poisons' }]);
    const b = createBattle(f, foe, {}, fixed(0));
    // Player attacks; enemy inflicts poison.
    const after = playerAction(b, f, { kind: 'attack' }, fixed(0));
    const poisoned = after.playerStatuses.find((s) => s.key === 'poison');
    expect(poisoned).toBeDefined();
    // turns = inflictTurns - 1 because tickStatuses fires at end of each round.
    expect(poisoned!.turns).toBe(4);
    expect(poisoned!.magnitude).toBe(2);
  });

  it('applies weaken that reduces subsequent player attack damage', () => {
    const f = strongFighter();

    // Baseline damage: player attacks normally.
    const plainFoe = liveFoe();
    const b_plain = createBattle(f, plainFoe, {}, fixed(0));
    const after_plain = playerAction(b_plain, f, { kind: 'attack' }, fixed(0));
    const dmgNormal = b_plain.bossHp - after_plain.bossHp;

    // Foe inflicts weaken on turn 1, then player attacks while weakened on turn 2.
    const weakenFoe = liveFoe([{ kind: 'inflict', inflictKey: 'weaken', inflictTurns: 3, inflictMag: 0.5, label: 'weakens' }]);
    const b = createBattle(f, weakenFoe, {}, fixed(0));
    // Turn 1: player attacks, foe inflicts weaken.
    const b2 = playerAction(b, f, { kind: 'attack' }, fixed(0));
    expect(b2.playerStatuses.some((s) => s.key === 'weaken')).toBe(true);
    // Turn 2: player attacks while weakened.
    const b3 = playerAction(b2, f, { kind: 'attack' }, fixed(0));
    const dmgWeakened = b2.bossHp - b3.bossHp;

    expect(dmgWeakened).toBeLessThan(dmgNormal);
  });

  it('blind foe sometimes misses', () => {
    // Not testing the inflict move itself, but verifying that enemy blind status applies.
    const f = strongFighter();
    const foe = liveFoe();
    const b = createBattle(f, foe, {}, fixed(0));
    // Manually inject blind onto the enemy.
    const b2 = { ...b, enemyStatuses: [{ key: 'blind' as const, turns: 3, magnitude: 1 }] };
    // With fixed(0.3): blind check is rng() < 0.4 → 0.3 < 0.4 → miss.
    const after = playerAction(b2, f, { kind: 'attack' }, fixed(0.3));
    expect(after.log.some((l) => l.includes('blindly'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Drain move
// ---------------------------------------------------------------------------

describe('drain move', () => {
  it('heals the enemy more than a plain attack (foe ends with higher HP)', () => {
    const f = strongFighter();

    // Baseline: foe only attacks — no self-heal.
    const plainFoe: BossDef = {
      id: 'plain', name: 'Plain', flavor: '', baseHp: 1000, attack: 10, defense: 0,
      weakTo: [], rewards: { gold: 0, items: [] },
      moveset: [{ kind: 'attack', label: 'attacks' }],
    };
    const b_plain = { ...createBattle(f, plainFoe, {}, fixed(0)), bossHp: 500 };
    const after_plain = playerAction(b_plain, f, { kind: 'attack' }, fixed(0));

    // Drain foe: same attack stat but drains on its turn.
    const drainFoe: BossDef = {
      id: 'drain_foe', name: 'Drainer', flavor: '', baseHp: 1000, attack: 10, defense: 0,
      weakTo: [], rewards: { gold: 0, items: [] },
      moveset: [{ kind: 'drain', drainRatio: 1.0, label: 'drains' }],
    };
    const b_drain = { ...createBattle(f, drainFoe, {}, fixed(0)), bossHp: 500 };
    const after_drain = playerAction(b_drain, f, { kind: 'attack' }, fixed(0));

    // Drain foe should have higher HP than plain-attack foe (same player damage taken, plus healing).
    expect(after_drain.bossHp).toBeGreaterThan(after_plain.bossHp);
  });

  it('logs both the hit and the heal amount', () => {
    const f = strongFighter();
    const foe: BossDef = {
      id: 'drain_foe', name: 'Drainer', flavor: '', baseHp: 1000, attack: 10, defense: 0,
      weakTo: [], rewards: { gold: 0, items: [] },
      moveset: [{ kind: 'drain', drainRatio: 1.0, label: 'drains your vitality' }],
    };
    // Pre-wound so drain has room to heal.
    const b = { ...createBattle(f, foe, {}, fixed(0)), bossHp: 500 };
    const after = playerAction(b, f, { kind: 'attack' }, fixed(0));
    expect(after.log.some((l) => l.includes('drains your vitality') && l.includes('healing'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Enrage move
// ---------------------------------------------------------------------------

describe('enrage move', () => {
  it('permanently increases enemy attack', () => {
    const f = strongFighter();
    const foe = liveFoe([{ kind: 'enrage', bonus: 5, label: 'enrages' }]);
    const b = createBattle(f, foe, {}, fixed(0));
    const initialAttack = b.bossAttack;
    const after = playerAction(b, f, { kind: 'attack' }, fixed(0));
    expect(after.bossAttack).toBe(initialAttack + 5);
    expect(after.enemyEnrageBonus).toBe(5);
  });

  it('stacks across multiple enrages', () => {
    const f = strongFighter();
    const foe = liveFoe([{ kind: 'enrage', bonus: 3, label: 'enrages' }]);
    const b = createBattle(f, foe, {}, fixed(0));
    const base = b.bossAttack;
    const b2 = playerAction(b, f, { kind: 'attack' }, fixed(0));
    const b3 = playerAction(b2, f, { kind: 'attack' }, fixed(0));
    expect(b3.bossAttack).toBe(base + 6);
    expect(b3.enemyEnrageBonus).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: no moveset → default attack behavior
// ---------------------------------------------------------------------------

describe('no-moveset fallback', () => {
  it('foe with no moveset deals damage via default attack', () => {
    const f = strongFighter(); // high HP so it survives; AG=0 so no dodge
    const foe: BossDef = {
      id: 'plain', name: 'Plain Foe', flavor: '', baseHp: 1000, attack: 20, defense: 0,
      weakTo: [], rewards: { gold: 0, items: [] },
      // no moveset
    };
    const b = createBattle(f, foe, {}, fixed(0));
    expect(b.enemyIntent).toBeNull();
    // Player attacks; enemy attacks back (no moveset → default attack).
    const after = playerAction(b, f, { kind: 'attack' }, fixed(0));
    expect(after.playerHp).toBeLessThan(b.playerHp);
  });

  it('trial bosses (no moveset) remain unchanged', () => {
    const boss = bossForLevel(5) as BossDef;
    expect(boss.moveset).toBeUndefined();
    const b = createBattle(strongFighter(), boss);
    expect(b.enemyIntent).toBeNull();
  });
});
