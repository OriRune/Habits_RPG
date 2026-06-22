// Balance report engine — pure derivations over the EarningsLedger.
// No React, no store imports. Fully unit-testable.
import { addDays, startOfWeek } from './date';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Every source that can credit XP, gold, or Energy. */
export type EarningSource =
  | 'habit'
  | 'mine'
  | 'forest'
  | 'arena'
  | 'tactics'
  | 'dungeon'
  | 'trial'
  | 'challenge'
  | 'boss';

export const EARNING_SOURCES: EarningSource[] = [
  'habit', 'mine', 'forest', 'arena', 'tactics', 'dungeon', 'trial', 'challenge', 'boss',
];

/** Cumulative progression tallies keyed by source. Starts from v25 save; zeroed on fresh saves. */
export interface EarningsLedger {
  /** Cumulative statXp granted per source. */
  xp: Record<EarningSource, number>;
  /** Cumulative gold granted per source. */
  gold: Record<EarningSource, number>;
  /** Number of reward events per source (habit completions / run completions / claims…). */
  count: Record<EarningSource, number>;
  /** Cumulative Energy earned (habit completions). */
  energyEarned: number;
  /** Cumulative Energy spent (minigame entries). */
  energySpent: number;
}

/** Per-day Energy earned/spent, keyed by ISO date. Powers the dashboard strip. */
export interface EnergyLogEntry {
  earned: number;
  spent: number;
}

/** Computed per-source stats for one category row in the balance report. */
export interface BalanceSourceRow {
  source: EarningSource;
  xp: number;
  xpPct: number;   // fraction of total XP (0–100)
  gold: number;
  goldPct: number; // fraction of total gold (0–100)
  count: number;
  avgXp: number;   // xp / count (or 0 when count=0)
  avgGold: number; // gold / count (or 0 when count=0)
}

/** Derived balance overview computed from the EarningsLedger. */
export interface BalanceReport {
  rows: BalanceSourceRow[];
  totalXp: number;
  totalGold: number;
  /** Fraction of total XP that came from habits (0–100). */
  habitXpShare: number;
  /** Fraction of total XP from all minigames combined (0–100). */
  minigameXpShare: number;
  /** Average XP per habit completion (or 0). */
  avgXpPerHabit: number;
  /** Average XP per minigame run completion (mine+forest+arena+tactics+dungeon+trial combined). */
  avgXpPerMinigameRun: number;
  /** Cumulative Energy earned. */
  energyEarned: number;
  /** Cumulative Energy spent. */
  energySpent: number;
  /** Average gold reward per Energy spent (or 0). */
  avgGoldPerEnergy: number;
}

/** Energy summary for the dashboard (today + this week). */
export interface EnergySummary {
  todayEarned: number;
  todaySpent: number;
  todayNet: number;
  weekEarned: number;
  weekSpent: number;
  weekNet: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an empty EarningsLedger (zeroed). */
export function freshEarningsLedger(): EarningsLedger {
  const zero = () => Object.fromEntries(EARNING_SOURCES.map((s) => [s, 0])) as Record<EarningSource, number>;
  return { xp: zero(), gold: zero(), count: zero(), energyEarned: 0, energySpent: 0 };
}

const MINIGAME_SOURCES: EarningSource[] = ['mine', 'forest', 'arena', 'tactics', 'dungeon', 'trial'];

// ---------------------------------------------------------------------------
// buildBalanceReport
// ---------------------------------------------------------------------------

/**
 * Derive a full BalanceReport from the cumulative EarningsLedger.
 * Pure — no I/O, no side effects.
 */
export function buildBalanceReport(ledger: EarningsLedger): BalanceReport {
  const totalXp = EARNING_SOURCES.reduce((sum, s) => sum + ledger.xp[s], 0);
  const totalGold = EARNING_SOURCES.reduce((sum, s) => sum + ledger.gold[s], 0);

  const rows: BalanceSourceRow[] = EARNING_SOURCES.map((source) => {
    const xp = ledger.xp[source];
    const gold = ledger.gold[source];
    const count = ledger.count[source];
    return {
      source,
      xp,
      xpPct: totalXp > 0 ? Math.round((xp / totalXp) * 100) : 0,
      gold,
      goldPct: totalGold > 0 ? Math.round((gold / totalGold) * 100) : 0,
      count,
      avgXp: count > 0 ? Math.round(xp / count) : 0,
      avgGold: count > 0 ? Math.round(gold / count) : 0,
    };
  });

  const habitXp = ledger.xp['habit'];
  const minigameXp = MINIGAME_SOURCES.reduce((sum, s) => sum + ledger.xp[s], 0);
  const minigameCount = MINIGAME_SOURCES.reduce((sum, s) => sum + ledger.count[s], 0);

  return {
    rows,
    totalXp,
    totalGold,
    habitXpShare: totalXp > 0 ? Math.round((habitXp / totalXp) * 100) : 0,
    minigameXpShare: totalXp > 0 ? Math.round((minigameXp / totalXp) * 100) : 0,
    avgXpPerHabit: ledger.count['habit'] > 0
      ? Math.round(habitXp / ledger.count['habit'])
      : 0,
    avgXpPerMinigameRun: minigameCount > 0
      ? Math.round(minigameXp / minigameCount)
      : 0,
    energyEarned: ledger.energyEarned,
    energySpent: ledger.energySpent,
    avgGoldPerEnergy: ledger.energySpent > 0
      ? Math.round(totalGold / ledger.energySpent)
      : 0,
  };
}

// ---------------------------------------------------------------------------
// buildEnergySummary
// ---------------------------------------------------------------------------

/**
 * Compute today's and this week's Energy earned/spent from the per-day log.
 * Pure — no I/O, no side effects.
 */
export function buildEnergySummary(
  energyLog: Record<string, EnergyLogEntry>,
  today: string,
): EnergySummary {
  const todayEntry = energyLog[today] ?? { earned: 0, spent: 0 };

  const ws = startOfWeek(today);
  let weekEarned = 0;
  let weekSpent = 0;
  for (let d = 0; d < 7; d++) {
    const day = addDays(ws, d);
    if (day > today) break;
    const e = energyLog[day];
    if (e) {
      weekEarned += e.earned;
      weekSpent += e.spent;
    }
  }

  return {
    todayEarned: todayEntry.earned,
    todaySpent: todayEntry.spent,
    todayNet: todayEntry.earned - todayEntry.spent,
    weekEarned,
    weekSpent,
    weekNet: weekEarned - weekSpent,
  };
}
