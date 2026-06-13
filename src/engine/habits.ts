// Habit model + completion logic (design brief Sections 2, 3, 14, 18).
import type { StatId } from './stats';
import { computeXp, type Difficulty } from './xp';
import { daysBetween, weekdayOf } from './date';

export type HabitType = 'binary' | 'quantity';
export type Frequency = 'daily' | 'weekdays' | 'custom';

export interface Habit {
  id: string;
  name: string;
  stat: StatId;
  type: HabitType;
  /** Goal amount for quantity habits (e.g. 20 pages). */
  target?: number;
  unit?: string;
  frequency: Frequency;
  /** For 'custom' frequency: weekdays 0(Sun)..6(Sat) the habit is due. */
  days?: number[];
  difficulty: Difficulty;
  tag?: string;
  streak: number;
  /** ISO date (YYYY-MM-DD) the habit was last completed. */
  lastCompletedISO?: string;
  createdISO: string;
}

/** Whether the habit is scheduled for the given day (brief: frequency / rest days). */
export function isDueOn(habit: Habit, iso: string): boolean {
  switch (habit.frequency) {
    case 'daily':
      return true;
    case 'weekdays': {
      const wd = weekdayOf(iso);
      return wd >= 1 && wd <= 5;
    }
    case 'custom':
      return habit.days?.includes(weekdayOf(iso)) ?? false;
  }
}

export function isCompletedOn(habit: Habit, iso: string): boolean {
  return habit.lastCompletedISO === iso;
}

export interface CompletionResult {
  xp: number;
  recovery: boolean;
  newStreak: number;
}

/**
 * Resolve a completion: XP earned, whether a recovery bonus applied, and the
 * updated streak. A recovery bonus (brief Section 14) is granted when the habit
 * was missed the day before but is completed today.
 */
export function resolveCompletion(
  habit: Habit,
  todayIso: string,
  opts: { actual?: number } = {},
): CompletionResult {
  const gap = habit.lastCompletedISO
    ? daysBetween(todayIso, habit.lastCompletedISO)
    : Infinity;

  // Recovery: there was a previous completion, but not yesterday or today
  // (i.e. at least one day was missed in between).
  const recovery = Number.isFinite(gap) && gap > 1;

  // Streak continues if completed on consecutive due days; resets otherwise.
  const newStreak = gap === 1 ? habit.streak + 1 : 1;

  const xp = computeXp({
    difficulty: habit.difficulty,
    type: habit.type,
    actual: opts.actual,
    target: habit.target,
    recovery,
  });

  return { xp, recovery, newStreak };
}
