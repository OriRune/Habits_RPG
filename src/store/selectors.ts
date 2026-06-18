// Derived read helpers over the store state. Kept separate from the store so
// components can compute view data without bloating the store definition.
import { type StatId } from '@/engine/stats';
import {
  type Habit,
  isCompletedOn,
  isLoggableOn,
  effectiveStatus,
  weekCompletions,
} from '@/engine/habits';
import { toISODate } from '@/engine/date';
import { levelProgress } from '@/engine/leveling';
import { rankStats } from '@/engine/classes';
import { deriveCombatant } from '@/engine/combat';
import { dungeonStamina } from '@/engine/crawl';
import { type GameState, totalXp } from './useGameStore';

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
