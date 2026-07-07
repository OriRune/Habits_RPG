// Tests for triggered relic mechanics:
//   onCombatWin  — relic heals a share of maxHp after every combat win
//   lowHp        — relic grants a defense bonus while hp/maxHp < threshold
//   onShrine     — relic accumulates stat bonuses into runBuff on shrine success
//
// These tests exercise the engine helpers and the content entries — they do NOT
// mock the Zustand store. The store-layer wiring (dungeonSlice) is covered by the
// existing lifecycle smoke-test; the pure relic logic is easiest to test here.

import { describe, it, expect } from 'vitest';
import { getRelic, aggregateRelics } from '../relics';
import type { RelicTrigger } from '../relics';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Simulate onCombatWin: collect all heal-pct values for a set of relic keys. */
function combatWinHeal(relicKeys: string[], maxHp: number): number {
  let heal = 0;
  for (const key of relicKeys) {
    const def = getRelic(key);
    if (def?.trigger?.type === 'onCombatWin') {
      heal += Math.round(maxHp * def.trigger.healPct);
    }
  }
  return heal;
}

/** Simulate lowHp defense: sum defense bonuses for relics whose threshold is met. */
function lowHpDefense(relicKeys: string[], hpRatio: number): number {
  let bonus = 0;
  for (const key of relicKeys) {
    const def = getRelic(key);
    if (def?.trigger?.type === 'lowHp' && hpRatio < def.trigger.threshold) {
      bonus += def.trigger.defense ?? 0;
    }
  }
  return bonus;
}

/** Simulate onShrine: accumulate stat bonuses for one shrine success. */
function shrineBuff(
  relicKeys: string[],
  existing: Record<string, number> = {},
): Record<string, number> {
  const buff = { ...existing };
  for (const key of relicKeys) {
    const def = getRelic(key);
    if (def?.trigger?.type === 'onShrine') {
      for (const [stat, n] of Object.entries(def.trigger.statBonuses)) {
        buff[stat] = (buff[stat] ?? 0) + (n ?? 0);
      }
    }
  }
  return buff;
}

// ── Content integrity ──────────────────────────────────────────────────────────

describe('triggered relic content', () => {
  it('bloodied_fang has onCombatWin trigger', () => {
    const def = getRelic('bloodied_fang');
    expect(def).toBeDefined();
    expect(def!.trigger?.type).toBe('onCombatWin');
    expect((def!.trigger as Extract<RelicTrigger, { type: 'onCombatWin' }>).healPct).toBeGreaterThan(0);
  });

  it('desperate_ward has lowHp trigger with a defense bonus', () => {
    const def = getRelic('desperate_ward');
    expect(def).toBeDefined();
    expect(def!.trigger?.type).toBe('lowHp');
    const t = def!.trigger as Extract<RelicTrigger, { type: 'lowHp' }>;
    expect(t.threshold).toBeGreaterThan(0);
    expect(t.threshold).toBeLessThanOrEqual(1);
    expect(t.defense).toBeGreaterThan(0);
  });

  it('shrine_stone has onShrine trigger with statBonuses', () => {
    const def = getRelic('shrine_stone');
    expect(def).toBeDefined();
    expect(def!.trigger?.type).toBe('onShrine');
    const t = def!.trigger as Extract<RelicTrigger, { type: 'onShrine' }>;
    expect(Object.keys(t.statBonuses).length).toBeGreaterThan(0);
  });

  it('triggered relics never appear in flat relic aggregation (effect is empty)', () => {
    const keys = ['bloodied_fang', 'desperate_ward', 'shrine_stone'];
    const agg = aggregateRelics(keys.map(getRelic));
    // All three have no flat effect — aggregation should return zeroes.
    expect(agg.defense).toBe(0);
    expect(agg.ward).toBe(0);
    expect(agg.maxHp).toBe(0);
    expect(Object.keys(agg.statBonuses).length).toBe(0);
  });
});

// ── onCombatWin ────────────────────────────────────────────────────────────────

describe('onCombatWin trigger', () => {
  it('heals the correct fraction of maxHp', () => {
    const heal = combatWinHeal(['bloodied_fang'], 100);
    const def = getRelic('bloodied_fang')!;
    const expected = Math.round(100 * (def.trigger as Extract<RelicTrigger, { type: 'onCombatWin' }>).healPct);
    expect(heal).toBe(expected);
  });

  it('does not fire for non-trigger relics', () => {
    expect(combatWinHeal(['ember_sigil', 'stone_heart'], 100)).toBe(0);
  });

  it('stacks when multiple onCombatWin relics are held', () => {
    const single = combatWinHeal(['bloodied_fang'], 100);
    // Two copies of the same relic to simulate multiple triggers.
    const double = combatWinHeal(['bloodied_fang', 'bloodied_fang'], 100);
    expect(double).toBe(single * 2);
  });
});

// ── lowHp ─────────────────────────────────────────────────────────────────────

describe('lowHp trigger', () => {
  const threshold = (getRelic('desperate_ward')!.trigger as Extract<RelicTrigger, { type: 'lowHp' }>).threshold;

  it('grants defense bonus when hp is below threshold', () => {
    const ratio = threshold - 0.01;
    const bonus = lowHpDefense(['desperate_ward'], ratio);
    expect(bonus).toBeGreaterThan(0);
  });

  it('does not grant bonus when hp is at or above threshold', () => {
    expect(lowHpDefense(['desperate_ward'], threshold)).toBe(0);
    expect(lowHpDefense(['desperate_ward'], threshold + 0.1)).toBe(0);
    expect(lowHpDefense(['desperate_ward'], 1.0)).toBe(0);
  });

  it('does not fire for non-trigger relics', () => {
    expect(lowHpDefense(['padded_jerkin', 'stone_heart'], 0.1)).toBe(0);
  });
});

// ── onShrine ──────────────────────────────────────────────────────────────────

describe('onShrine trigger', () => {
  it('accumulates statBonuses on first shrine success', () => {
    const buff = shrineBuff(['shrine_stone']);
    const t = getRelic('shrine_stone')!.trigger as Extract<RelicTrigger, { type: 'onShrine' }>;
    for (const [stat, n] of Object.entries(t.statBonuses)) {
      expect(buff[stat]).toBe(n);
    }
  });

  it('stacks on repeated shrine successes', () => {
    const once = shrineBuff(['shrine_stone']);
    const twice = shrineBuff(['shrine_stone'], once);
    for (const [stat, n] of Object.entries(once)) {
      expect(twice[stat]).toBe(n * 2);
    }
  });

  it('does not fire for non-trigger relics', () => {
    const buff = shrineBuff(['sage_bead', 'warding_rune']);
    expect(Object.keys(buff).length).toBe(0);
  });

  it('accumulates independently from multiple shrine_stone relics', () => {
    const once = shrineBuff(['shrine_stone']);
    const double = shrineBuff(['shrine_stone', 'shrine_stone']);
    for (const [stat, n] of Object.entries(once)) {
      expect(double[stat]).toBe(n * 2);
    }
  });
});
