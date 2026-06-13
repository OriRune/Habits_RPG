// Derived read helpers over the store state. Kept separate from the store so
// components can compute view data without bloating the store definition.
import { type StatId } from '@/engine/stats';
import { type Habit, isDueOn, isCompletedOn } from '@/engine/habits';
import { toISODate } from '@/engine/date';
import { levelProgress } from '@/engine/leveling';
import { rankStats } from '@/engine/classes';
import { type GameState, totalXp } from './useGameStore';

export function selectTotalXp(s: GameState): number {
  return totalXp(s.character.statXp);
}

export function selectLevelProgress(s: GameState) {
  return levelProgress(totalXp(s.character.statXp));
}

/** Habits scheduled for today (brief: frequency / rest days). */
export function selectDueToday(s: GameState): Habit[] {
  const today = toISODate();
  return s.habits.filter((h) => isDueOn(h, today));
}

export function selectCompletedToday(s: GameState): Habit[] {
  const today = toISODate();
  return s.habits.filter((h) => isCompletedOn(h, today));
}

export function isHabitDoneToday(h: Habit): boolean {
  return isCompletedOn(h, toISODate());
}

export function selectTopStats(s: GameState): StatId[] {
  return rankStats(s.character.statXp);
}

/** Brief Section 18: warn gently when daily habit load is high. */
export function selectHabitLoadWarning(s: GameState): string | null {
  const daily = s.habits.filter((h) => h.frequency === 'daily').length;
  if (daily >= 12) {
    return `You have ${daily} daily habits. Consider making some weekly or optional.`;
  }
  return null;
}
