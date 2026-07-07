// Derived read helpers over the store state. Kept separate from the store so
// components can compute view data without bloating the store definition.
import { type StatId } from '@/engine/stats';
import {
  buildBalanceReport,
  buildEnergySummary,
  freshEarningsLedger,
  type BalanceReport,
  type EnergySummary,
} from '@/engine/balance';
import {
  type Habit,
  isCompletedOn,
  isLoggableOn,
  effectiveStatus,
  weekCompletions,
} from '@/engine/habits';
import { toISODate, now } from '@/engine/date';
import { levelProgress } from '@/engine/leveling';
import { rankStats } from '@/engine/classes';
import { deriveCombatant } from '@/engine/combat';
import { dungeonStamina } from '@/engine/crawl';
import { consistencyScore, consistencyTrend, dayOfWeekBreakdown } from '@/engine/tracking';
import { previewNextGains } from '@/engine/progression';
import { buildDailySummary, type DailySummary } from '@/engine/dashboard';
import { accountHealth, recoveryState, type RecoveryState } from '@/engine/habitHealth';
import { type GameState, totalXp } from './useGameStore';
import { habitBonusCounts } from './shared';

/** Cheapest minigame entry cost (Skill Trial = 1 energy). Used for the "energy ready" hint. */
const MIN_MINIGAME_COST = 1;

export function selectTotalXp(s: GameState): number {
  return totalXp(s.character.statXp);
}

export function selectLevelProgress(s: GameState) {
  return levelProgress(totalXp(s.character.statXp));
}

/**
 * Habits to show on the main tracker today: active habits loggable today, plus suspended
 * habits (shown marked). Retired habits are excluded.
 */
export function selectDashboardHabits(s: GameState): Habit[] {
  return makeSelectDashboardHabits(toISODate())(s);
}

/**
 * Date-parameterized version of {@link selectDashboardHabits}: the habits to show on the tracker
 * for a given ISO day (used when browsing/editing past days). Reflects that day's lifecycle state.
 */
export function makeSelectDashboardHabits(iso: string) {
  return (s: GameState): Habit[] =>
    s.habits.filter((h) => {
      const st = effectiveStatus(h, iso);
      if (st === 'retired') return false;
      if (st === 'suspended') return true; // shown, marked, not loggable
      return isLoggableOn(h, iso);
    });
}

export function isHabitDoneToday(h: Habit): boolean {
  return isCompletedOn(h, toISODate());
}

export function isHabitSuspended(h: Habit): boolean {
  return effectiveStatus(h, toISODate()) === 'suspended';
}

/** Weekly progress for a times_per_week habit (else null). */
export function selectWeekProgress(h: Habit): { done: number; target: number } | null {
  if (h.frequency !== 'times_per_week') return null;
  return { done: weekCompletions(h, toISODate()), target: h.timesPerWeek ?? 1 };
}

export function selectTopStats(s: GameState): StatId[] {
  return rankStats(s.character.statXp);
}

/**
 * Account-wide habit consistency score (0–100) over the last 30 days.
 * Used by the "Consistency" leaderboard track and the public snapshot.
 */
export function selectHabitScore(s: GameState): number {
  return consistencyScore(s.habits, toISODate());
}

/**
 * Stats that matter in the Deep Mine, derived from base stat levels.
 * Gear bonuses are excluded — use as a "before gear" lobby preview.
 */
export function selectMineStats(s: GameState) {
  const c = deriveCombatant(
    s.character.statLevels,
    s.character.level,
    s.combatStats,
  );
  return {
    meleePower: c.meleePower,
    agLevel: s.character.statLevels.AG,
    defense: c.defense,
    maxHp: c.maxHp,
    maxSta: dungeonStamina(s.character.statLevels.EN),
  };
}

/** Brief Section 18: warn gently when daily habit load is high. */
export function selectHabitLoadWarning(s: GameState): string | null {
  const daily = s.habits.filter((h) => h.frequency === 'daily' && h.status === 'active').length;
  if (daily >= 12) {
    return `You have ${daily} daily habits. Consider making some weekly or optional.`;
  }
  return null;
}

/**
 * Preview which stat points the character would gain on the next level-up,
 * based on Training XP earned since the last level-up.
 */
export function selectNextStatGains(s: GameState): Record<StatId, number> {
  return previewNextGains(s.character);
}

/** Full daily summary for the dashboard command center. */
export function selectDailySummary(s: GameState): DailySummary {
  const today = toISODate();
  const recovery = recoveryState(s.habits, today);
  return buildDailySummary(s.habits, today, {
    currentEnergy: s.character.energy,
    minMinigameCost: MIN_MINIGAME_COST,
    struggling: recovery.struggling,
    nowHour: now().getHours(),
    streakFreezes: s.inventory['streak_freeze'] ?? 0,
  });
}

/** Recovery state — whether the account appears to be struggling. */
export function selectRecoveryState(s: GameState): RecoveryState {
  return recoveryState(s.habits, toISODate());
}

/** Account-level habit health warnings (load, stat concentration). */
export function selectAccountHealth(s: GameState) {
  return accountHealth(s.habits, toISODate());
}

/** Account completion-rate (0–100) per week over the last 12 weeks. */
export function selectConsistencyTrend(s: GameState) {
  return consistencyTrend(s.habits, toISODate());
}

/** Completion breakdown by weekday (0=Sun..6=Sat) over the last 12 weeks (84 days). */
export function selectDayOfWeek(s: GameState) {
  return dayOfWeekBreakdown(s.habits, toISODate());
}

/** Ordered depth gates that unlock dungeon features. */
const DUNGEON_MILESTONES: ReadonlyArray<{ depth: number; label: string }> = [
  { depth: 5, label: 'Merchant shops appear' },
  { depth: 8, label: 'Elite rooms appear' },
  { depth: 10, label: 'Tier-3 relics unlocked' },
];

/**
 * Dungeon milestone progress: the player's deepest-ever floor and the next
 * depth gate they haven't reached yet, or null when all are cleared.
 * Mirrors the inline `milestoneHint` logic in DungeonView so other views
 * (CharacterView, etc.) can display consistent progress text.
 */
export function selectDungeonMilestone(s: GameState): {
  deepestFloor: number;
  nextMilestone: { depth: number; label: string } | null;
} {
  const deepestFloor = s.deepestFloor;
  const nextMilestone = DUNGEON_MILESTONES.find((m) => m.depth > deepestFloor) ?? null;
  return { deepestFloor, nextMilestone };
}

export function selectBalanceReport(s: GameState): BalanceReport {
  return buildBalanceReport(s.earnings ?? freshEarningsLedger());
}

export function selectEnergySummary(s: GameState): EnergySummary {
  return buildEnergySummary(s.energyLog ?? {}, toISODate());
}

/**
 * Habit-streak minigame-gold multiplier plus the raw counts behind it, for the streak-bonus
 * readout ("Streak bonus ×1.15 — 3 of 4 habits on streak"). `bonus` is the stored multiplier;
 * the counts are recomputed live so the chip stays truthful between recompute calls.
 */
export function selectHabitBonusInfo(s: GameState): {
  bonus: number;
  trackedCount: number;
  healthyCount: number;
} {
  const { tracked, healthy } = habitBonusCounts(s.habits);
  return { bonus: s.character.habitBonus, trackedCount: tracked, healthyCount: healthy };
}

export type { DailySummary, RecoveryState };
