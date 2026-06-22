// Tests for buildBalanceReport and buildEnergySummary (engine/balance.ts).
import { describe, it, expect } from 'vitest';
import {
  freshEarningsLedger,
  buildBalanceReport,
  buildEnergySummary,
} from '../balance';

describe('freshEarningsLedger', () => {
  it('returns a zeroed ledger', () => {
    const ledger = freshEarningsLedger();
    expect(ledger.energyEarned).toBe(0);
    expect(ledger.energySpent).toBe(0);
    expect(ledger.xp.habit).toBe(0);
    expect(ledger.gold.mine).toBe(0);
    expect(ledger.count.boss).toBe(0);
  });
});

describe('buildBalanceReport', () => {
  it('returns zeros on a fresh ledger', () => {
    const report = buildBalanceReport(freshEarningsLedger());
    expect(report.totalXp).toBe(0);
    expect(report.totalGold).toBe(0);
    expect(report.habitXpShare).toBe(0);
    expect(report.minigameXpShare).toBe(0);
    expect(report.avgXpPerHabit).toBe(0);
    expect(report.avgXpPerMinigameRun).toBe(0);
    expect(report.avgGoldPerEnergy).toBe(0);
    expect(report.rows).toHaveLength(9);
  });

  it('computes XP share correctly', () => {
    const ledger = freshEarningsLedger();
    ledger.xp.habit = 300;
    ledger.count.habit = 3;
    ledger.xp.mine = 100;
    ledger.count.mine = 1;
    const report = buildBalanceReport(ledger);
    expect(report.totalXp).toBe(400);
    expect(report.habitXpShare).toBe(75); // 300/400
    expect(report.minigameXpShare).toBe(25); // 100/400
  });

  it('computes average XP per habit', () => {
    const ledger = freshEarningsLedger();
    ledger.xp.habit = 150;
    ledger.count.habit = 5;
    const report = buildBalanceReport(ledger);
    expect(report.avgXpPerHabit).toBe(30);
  });

  it('computes average gold per energy', () => {
    const ledger = freshEarningsLedger();
    ledger.gold.mine = 200;
    ledger.gold.habit = 50;
    ledger.energySpent = 5;
    const report = buildBalanceReport(ledger);
    // totalGold = 250, energySpent = 5 → 50
    expect(report.avgGoldPerEnergy).toBe(50);
  });

  it('builds per-source rows with correct pct', () => {
    const ledger = freshEarningsLedger();
    ledger.xp.habit = 100;
    ledger.xp.forest = 100;
    const report = buildBalanceReport(ledger);
    const habitRow = report.rows.find((r) => r.source === 'habit')!;
    const forestRow = report.rows.find((r) => r.source === 'forest')!;
    expect(habitRow.xpPct).toBe(50);
    expect(forestRow.xpPct).toBe(50);
  });

  it('returns 0 avgXp when count is zero', () => {
    const ledger = freshEarningsLedger();
    ledger.xp.dungeon = 200;
    // count.dungeon = 0
    const report = buildBalanceReport(ledger);
    const dungeonRow = report.rows.find((r) => r.source === 'dungeon')!;
    expect(dungeonRow.avgXp).toBe(0);
  });
});

describe('buildEnergySummary', () => {
  it('returns zeros when log is empty', () => {
    const summary = buildEnergySummary({}, '2026-06-22');
    expect(summary.todayEarned).toBe(0);
    expect(summary.todaySpent).toBe(0);
    expect(summary.todayNet).toBe(0);
    expect(summary.weekEarned).toBe(0);
    expect(summary.weekSpent).toBe(0);
    expect(summary.weekNet).toBe(0);
  });

  it('captures today earned/spent', () => {
    const log = { '2026-06-22': { earned: 4, spent: 2 } };
    const summary = buildEnergySummary(log, '2026-06-22');
    expect(summary.todayEarned).toBe(4);
    expect(summary.todaySpent).toBe(2);
    expect(summary.todayNet).toBe(2);
  });

  it('sums the current week (Sunday start)', () => {
    // Week starting 2026-06-21 (Sunday) through 2026-06-22 (Monday today)
    const log = {
      '2026-06-21': { earned: 3, spent: 1 },
      '2026-06-22': { earned: 5, spent: 2 },
    };
    const summary = buildEnergySummary(log, '2026-06-22');
    expect(summary.weekEarned).toBe(8);
    expect(summary.weekSpent).toBe(3);
    expect(summary.weekNet).toBe(5);
  });

  it('ignores future days', () => {
    // today is Monday; log has an entry for next Sunday
    const log = {
      '2026-06-22': { earned: 2, spent: 1 },
      '2026-06-28': { earned: 10, spent: 10 }, // future — should be ignored
    };
    const summary = buildEnergySummary(log, '2026-06-22');
    expect(summary.weekEarned).toBe(2);
    expect(summary.weekSpent).toBe(1);
  });
});
