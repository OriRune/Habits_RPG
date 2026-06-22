// Habit health checks — detect patterns that suggest a habit needs adjustment.
// Pure functions: no React, no store imports, fully unit-testable.
import {
  type Habit,
  isScheduledOn,
  isCompletedOn,
  effectiveStatus,
} from './habits';
import { addDays, weekdayOf } from './date';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HabitWarningCode =
  | 'repeated_misses'      // scheduled but missed multiple times recently
  | 'target_too_high'      // quantity habit with many partial completions
  | 'always_completed'     // trivially easy — always done
  | 'weekday_weekend_gap'  // consistent on weekdays but weak on weekends
  | 'unused_weeks'         // no completions in several weeks
  | 'stat_overloaded';     // account-level: many habits on one stat

export type HabitActionCode =
  | 'lower_target'
  | 'change_frequency'
  | 'change_difficulty'
  | 'suspend'
  | 'retire'
  | 'mark_focus'
  | 'edit';

export interface HabitWarning {
  code: HabitWarningCode;
  message: string;
  suggestedActions: HabitActionCode[];
}

// ---------------------------------------------------------------------------
// Per-habit health check
// ---------------------------------------------------------------------------

/** Minimum days a habit must exist before reporting health warnings. */
const MIN_AGE_DAYS = 7;
/** Look-back window for miss / partial / weekday-gap analysis. */
const WINDOW_DAYS = 28;
/** Threshold: repeated misses in window. */
const MISS_THRESHOLD = 4;
/** Threshold: partial completions in window. */
const PARTIAL_THRESHOLD = 3;
/** Threshold: weeks without a completion. */
const UNUSED_WEEKS = 3;
/** Threshold: "always easy" — never missed in the window. */
const ALWAYS_DONE_MIN = 12; // at least this many scheduled days to flag

/**
 * Return health warnings for a single habit. Returns [] when the habit is too
 * new to have meaningful data, or is suspended/retired.
 */
export function habitHealth(habit: Habit, today: string): HabitWarning[] {
  if (effectiveStatus(habit, today) !== 'active') return [];

  const start = habit.createdISO;
  const ageFloor = addDays(today, -(MIN_AGE_DAYS - 1));
  if (start > ageFloor) return []; // too new

  const windowStart = addDays(today, -(WINDOW_DAYS - 1));
  const warnings: HabitWarning[] = [];

  if (habit.frequency === 'as_needed') {
    // Only flag unusedness for as_needed
    return checkUnused(habit, today);
  }

  if (habit.frequency === 'times_per_week') {
    // Just check unused for non-day-scheduled
    return checkUnused(habit, today);
  }

  // Day-scheduled habits: full analysis
  let scheduledCount = 0;
  let missedCount = 0;
  let partialCount = 0;
  let weekdayDone = 0, weekdayScheduled = 0;
  let weekendDone = 0, weekendScheduled = 0;

  for (let d = 0; d < WINDOW_DAYS; d++) {
    const day = addDays(windowStart, d);
    if (!isScheduledOn(habit, day)) continue;
    if (effectiveStatus(habit, day) !== 'active') continue;
    const wd = weekdayOf(day);
    const isWeekend = wd === 0 || wd === 6;
    scheduledCount++;
    if (isWeekend) weekendScheduled++;
    else weekdayScheduled++;

    const entry = habit.log[day];
    if (!entry) {
      missedCount++;
    } else {
      if (isWeekend) weekendDone++;
      else weekdayDone++;
      if (habit.type === 'quantity' && entry.amount !== undefined && habit.target) {
        if (entry.amount < habit.target) partialCount++;
      }
    }
  }

  // Repeated misses
  if (missedCount >= MISS_THRESHOLD) {
    warnings.push({
      code: 'repeated_misses',
      message: `"${habit.name}" was missed ${missedCount} times in the last 4 weeks. It may need to be easier or less frequent.`,
      suggestedActions: ['change_frequency', 'change_difficulty', 'suspend', 'mark_focus'],
    });
  }

  // Target too high (many partials)
  if (habit.type === 'quantity' && partialCount >= PARTIAL_THRESHOLD) {
    warnings.push({
      code: 'target_too_high',
      message: `"${habit.name}" is often partially completed — the target may be too high.`,
      suggestedActions: ['lower_target'],
    });
  }

  // Always easy (zero misses, many scheduled)
  if (scheduledCount >= ALWAYS_DONE_MIN && missedCount === 0) {
    warnings.push({
      code: 'always_completed',
      message: `"${habit.name}" has been completed every time — great streak! Consider raising the difficulty for more XP.`,
      suggestedActions: ['change_difficulty'],
    });
  }

  // Weekday/weekend gap
  if (
    weekdayScheduled >= 5 &&
    weekendScheduled >= 4 &&
    weekdayScheduled > 0 &&
    weekendScheduled > 0
  ) {
    const weekdayRate = weekdayDone / weekdayScheduled;
    const weekendRate = weekendDone / weekendScheduled;
    if (weekdayRate >= 0.8 && weekendRate <= 0.4) {
      warnings.push({
        code: 'weekday_weekend_gap',
        message: `"${habit.name}" is consistent on weekdays but missed most weekends. Consider a weekday-only schedule.`,
        suggestedActions: ['change_frequency', 'edit'],
      });
    }
  }

  // Unused for weeks (no completions in WINDOW_DAYS)
  if (scheduledCount > 0 && missedCount === scheduledCount) {
    const unusedWeeksCheck = checkUnused(habit, today);
    warnings.push(...unusedWeeksCheck);
  }

  return warnings;
}

function checkUnused(habit: Habit, today: string): HabitWarning[] {
  // No completions in last UNUSED_WEEKS weeks
  const cutoff = addDays(today, -(UNUSED_WEEKS * 7));
  const hasRecent = Object.keys(habit.log).some((d) => d >= cutoff && d <= today);
  if (!hasRecent && habit.createdISO <= cutoff) {
    return [
      {
        code: 'unused_weeks',
        message: `"${habit.name}" hasn't been logged in over ${UNUSED_WEEKS} weeks. Consider suspending or retiring it.`,
        suggestedActions: ['suspend', 'retire'],
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Account-level health checks
// ---------------------------------------------------------------------------

export interface AccountWarning {
  code: 'high_load' | 'stat_overloaded';
  message: string;
}

/**
 * Account-level health checks: too many daily habits, or too many habits on one stat.
 * Returns [] when everything looks fine.
 */
export function accountHealth(habits: Habit[], today: string): AccountWarning[] {
  const warnings: AccountWarning[] = [];
  const active = habits.filter((h) => effectiveStatus(h, today) === 'active');

  const daily = active.filter((h) => h.frequency === 'daily').length;
  if (daily >= 12) {
    warnings.push({
      code: 'high_load',
      message: `You have ${daily} daily habits. Consider making some weekly or optional.`,
    });
  }

  // Stat concentration: flag if any stat has 4+ daily habits
  const statCounts: Record<string, number> = {};
  for (const h of active.filter((h) => h.frequency === 'daily')) {
    statCounts[h.stat] = (statCounts[h.stat] ?? 0) + 1;
  }
  for (const [stat, count] of Object.entries(statCounts)) {
    if (count >= 4) {
      warnings.push({
        code: 'stat_overloaded',
        message: `${count} daily habits are mapped to ${stat}. Spreading habits across stats grows your hero more evenly.`,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Recovery state
// ---------------------------------------------------------------------------

export type RecoveryReason = 'long_absence' | 'low_weekly_rate' | 'many_misses';

export interface RecoveryState {
  struggling: boolean;
  reason?: RecoveryReason;
}

/** Number of days without any completion before flagging a long absence. */
const ABSENCE_DAYS = 5;
/** Weekly completion rate below which recovery is suggested. */
const STRUGGLE_RATE = 0.3;

/**
 * Determine whether the account is in a "struggling" state that warrants the recovery flow.
 * Pure — based only on habit logs and today's date.
 */
export function recoveryState(habits: Habit[], today: string): RecoveryState {
  // Long absence: no completion at all in the last ABSENCE_DAYS days
  const absenceCutoff = addDays(today, -(ABSENCE_DAYS - 1));
  const hasRecentCompletion = habits.some((h) =>
    Object.keys(h.log).some((d) => d >= absenceCutoff && d <= today),
  );
  if (!hasRecentCompletion) {
    // Only flag if there are active habits (otherwise the user just started)
    const hasActive = habits.some((h) => h.status === 'active');
    if (hasActive) {
      return { struggling: true, reason: 'long_absence' };
    }
  }

  // Low weekly completion rate over the last 2 weeks
  const window14 = addDays(today, -13);
  let scheduled14 = 0;
  let completed14 = 0;
  for (const h of habits) {
    if (h.status === 'retired' || h.frequency === 'as_needed') continue;
    for (let d = 0; d < 14; d++) {
      const day = addDays(window14, d);
      if (day > today) break;
      if (h.frequency === 'times_per_week') continue; // skip for simplicity
      if (isScheduledOn(h, day) && effectiveStatus(h, day) === 'active') {
        scheduled14++;
        if (isCompletedOn(h, day)) completed14++;
      }
    }
  }
  if (scheduled14 >= 7 && completed14 / scheduled14 < STRUGGLE_RATE) {
    return { struggling: true, reason: 'low_weekly_rate' };
  }

  return { struggling: false };
}
