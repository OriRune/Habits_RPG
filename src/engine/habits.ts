// Habit model + completion/scheduling logic (design brief Sections 2, 3, 14, 18).
import type { StatId } from './stats';
import { computeXp, type Difficulty } from './xp';
import { daysBetween, weekdayOf, addDays, startOfWeek } from './date';

export type HabitType = 'binary' | 'quantity';
export type Frequency = 'daily' | 'weekdays' | 'custom' | 'times_per_week' | 'as_needed';
export type HabitStatus = 'active' | 'retired' | 'suspended';

/** One day's completion record (presence of the date key in `log` = completed). */
export interface HabitEntry {
  /** Amount logged for quantity habits. */
  amount?: number;
  /** XP earned that day (drives "total points" stats). */
  xp: number;
  /** Gold earned that day — stored so uncompleteHabit can refund the exact amount. */
  gold?: number;
  /** True when a Streak Freeze was used for this day — no XP, but streak not broken. */
  frozen?: boolean;
}

export interface Habit {
  id: string;
  name: string;
  stat: StatId;
  type: HabitType;
  /** Goal amount for quantity habits (e.g. 20 pages). */
  target?: number;
  unit?: string;
  /** Quantity: remove the 150% XP cap (e.g. miles run → endurance per mile). */
  uncapped?: boolean;
  frequency: Frequency;
  /** For 'custom' frequency: weekdays 0(Sun)..6(Sat) the habit is due. */
  days?: number[];
  /** For 'times_per_week': how many completions make a successful week. */
  timesPerWeek?: number;
  difficulty: Difficulty;
  tag?: string;
  /** Lifecycle: active (tracked), retired (hidden, kept), suspended (paused, marked). */
  status: HabitStatus;
  /** Suspended habits auto-resume on/after this date. */
  suspendUntilISO?: string;
  /** Cached current streak (see currentStreak). */
  streak: number;
  /** ISO date the habit was last completed (cached convenience). */
  lastCompletedISO?: string;
  /** Per-day completion history, keyed by ISO date. The source of truth for stats. */
  log: Record<string, HabitEntry>;
  createdISO: string;
  /** Marked as a focus habit for the week — sorted to the top and highlighted. Max 3 per account. */
  focus?: boolean;
}

const DAY_SCHEDULED: Frequency[] = ['daily', 'weekdays', 'custom'];

/** Whether the habit is scheduled (has a planned obligation) on a specific day. */
export function isScheduledOn(habit: Habit, iso: string): boolean {
  switch (habit.frequency) {
    case 'daily':
      return true;
    case 'weekdays': {
      const wd = weekdayOf(iso);
      return wd >= 1 && wd <= 5;
    }
    case 'custom':
      return habit.days?.includes(weekdayOf(iso)) ?? false;
    case 'times_per_week':
    case 'as_needed':
      return false; // no specific planned day — never "missed/red"
  }
}

/** Effective status accounting for an elapsed suspension (auto-resume). */
export function effectiveStatus(habit: Habit, today: string): HabitStatus {
  if (habit.status === 'suspended' && habit.suspendUntilISO && today >= habit.suspendUntilISO) {
    return 'active';
  }
  return habit.status;
}

/** Whether the habit can be logged today (shown & actionable on the dashboard). */
export function isLoggableOn(habit: Habit, today: string): boolean {
  if (effectiveStatus(habit, today) !== 'active') return false;
  return (
    isScheduledOn(habit, today) ||
    habit.frequency === 'times_per_week' ||
    habit.frequency === 'as_needed'
  );
}

export function isCompletedOn(habit: Habit, iso: string): boolean {
  return habit.log[iso] !== undefined;
}

/** Completions logged in the (Sunday-started) week containing `iso`. */
export function weekCompletions(habit: Habit, iso: string): number {
  const start = startOfWeek(iso);
  let n = 0;
  for (let d = 0; d < 7; d++) {
    if (isCompletedOn(habit, addDays(start, d))) n++;
  }
  return n;
}

function weeklyTargetMet(habit: Habit, weekStartIso: string): boolean {
  return weekCompletions(habit, weekStartIso) >= (habit.timesPerWeek ?? 1);
}

const STREAK_MAX_ITERS = 366 * 3;

/**
 * Current streak: consecutive scheduled days completed (day habits); consecutive weeks
 * meeting the target (times_per_week). Not meaningful for as_needed (returns 0).
 */
export function currentStreak(habit: Habit, today: string): number {
  if (habit.frequency === 'as_needed') return 0;

  if (habit.frequency === 'times_per_week') {
    let streak = 0;
    let wk = startOfWeek(today);
    for (let i = 0; i < STREAK_MAX_ITERS && wk >= startOfWeek(habit.createdISO); i++) {
      if (!weeklyTargetMet(habit, wk)) break;
      streak++;
      wk = addDays(wk, -7);
    }
    return streak;
  }

  // Day-scheduled: walk back over scheduled days while they're completed.
  let cursor = today;
  // If today is scheduled but not yet done, the streak runs up to the previous day.
  if (isScheduledOn(habit, cursor) && !isCompletedOn(habit, cursor)) {
    cursor = addDays(cursor, -1);
  }
  let streak = 0;
  for (let i = 0; i < STREAK_MAX_ITERS && cursor >= habit.createdISO; i++) {
    if (!isScheduledOn(habit, cursor)) {
      cursor = addDays(cursor, -1);
      continue;
    }
    if (isCompletedOn(habit, cursor)) {
      // Frozen days bridge the gap (streak not broken) but don't add to the count.
      if (!habit.log[cursor]?.frozen) streak++;
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Returns true if any habit of the given `stat` has a log entry within the last
 * `windowDays` calendar days (inclusive of today). Used to gate Skill Trials (§4.4 / §6.2):
 * a trial only unlocks once the player has logged a real habit of that stat recently.
 * Scans all habits regardless of status — a historical completion is a historical fact.
 */
export function statCompletedWithin(
  habits: Habit[],
  stat: StatId,
  today: string,
  windowDays: number,
): boolean {
  const cutoff = addDays(today, -(windowDays - 1));
  return habits.some((h) => {
    if (h.stat !== stat) return false;
    // Fast path: the cached lastCompletedISO is within the window.
    if (h.lastCompletedISO && h.lastCompletedISO >= cutoff && h.lastCompletedISO <= today)
      return true;
    // Full scan: covers backdated entries not captured by lastCompletedISO.
    return Object.keys(h.log).some((iso) => iso >= cutoff && iso <= today);
  });
}

export interface CompletionResult {
  xp: number;
  recovery: boolean;
}

/**
 * Resolve a completion: XP earned and whether a recovery bonus applied. The store writes
 * the day's log entry and recomputes the streak via currentStreak. Recovery (brief §14)
 * only applies to day-scheduled habits.
 */
export function resolveCompletion(
  habit: Habit,
  todayIso: string,
  opts: { actual?: number } = {},
): CompletionResult {
  const dayScheduled = DAY_SCHEDULED.includes(habit.frequency);
  const gap = habit.lastCompletedISO ? daysBetween(todayIso, habit.lastCompletedISO) : Infinity;
  const recovery = dayScheduled && Number.isFinite(gap) && gap > 1;

  const xp = computeXp({
    difficulty: habit.difficulty,
    type: habit.type,
    actual: opts.actual,
    target: habit.target,
    uncapped: habit.uncapped,
    recovery,
  });

  return { xp, recovery };
}
