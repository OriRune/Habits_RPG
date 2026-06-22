// Daily summary engine — computes the dashboard's command-center data from raw state.
// Pure functions: no React, no store imports, fully unit-testable.
import {
  type Habit,
  isCompletedOn,
  isLoggableOn,
  isScheduledOn,
  currentStreak,
} from './habits';
import { addDays, startOfWeek } from './date';

// ---------------------------------------------------------------------------
// Weekly completion rate
// ---------------------------------------------------------------------------

/**
 * Fraction (0–1) of scheduled-habit obligations met this week (Sunday-to-today).
 * Only counts day-scheduled habits (daily/weekdays/custom) and times_per_week habits
 * as a whole-week unit. as_needed habits are excluded.
 */
export function weeklyCompletionRate(habits: Habit[], today: string): number {
  const ws = startOfWeek(today);
  let scheduled = 0;
  let completed = 0;

  for (const h of habits) {
    if (h.status === 'retired') continue;
    if (h.frequency === 'as_needed') continue;

    if (h.frequency === 'times_per_week') {
      const target = h.timesPerWeek ?? 1;
      let done = 0;
      for (let d = 0; d < 7; d++) {
        const day = addDays(ws, d);
        if (day > today) break;
        if (isCompletedOn(h, day)) done++;
      }
      scheduled += target;
      completed += Math.min(done, target);
    } else {
      // daily / weekdays / custom
      for (let d = 0; d < 7; d++) {
        const day = addDays(ws, d);
        if (day > today) break;
        if (isScheduledOn(h, day)) {
          scheduled++;
          if (isCompletedOn(h, day)) completed++;
        }
      }
    }
  }

  return scheduled > 0 ? completed / scheduled : 0;
}

// ---------------------------------------------------------------------------
// Daily summary
// ---------------------------------------------------------------------------

export interface TopStreak {
  habitId: string;
  habitName: string;
  streak: number;
  stat: string;
}

export type RecommendedActionKind =
  | 'finish_focus'
  | 'start_today'
  | 'energy_ready'
  | 'streak_at_risk'
  | 'struggling'
  | 'load_warning'
  | 'all_done';

export interface RecommendedAction {
  kind: RecommendedActionKind;
  message: string;
  /** Habit id if the action targets a specific habit. */
  targetHabitId?: string;
}

export interface DailySummary {
  /** Number of habits completed today. */
  completedToday: number;
  /** Number of habits scheduled today that are not yet done. */
  pendingToday: number;
  /** Total habits scheduled today. */
  scheduledToday: number;
  /**
   * Energy earned today from habit completions — count of habits with a log entry on `today`.
   * Each habit completion awards +1 energy (habitsSlice), so this equals the count.
   */
  energyEarnedToday: number;
  /** Fraction 0–1 of scheduled obligations met this week. */
  weeklyCompletionRate: number;
  /** Top streaks (up to 3), descending, ignoring zero streaks. */
  topStreaks: TopStreak[];
  /** Habits with focus=true, in order. */
  focusHabits: Habit[];
  /** Pending focus habits (focus=true and not done today). */
  pendingFocusHabits: Habit[];
  /** Habits that are scheduled today, not done, and have a streak > 0 (streak at risk). */
  atRiskHabits: Habit[];
  /** Single highest-priority recommended action, or null when nothing needs attention. */
  recommendedAction: RecommendedAction | null;
}

export interface DashboardOptions {
  /** Current energy total — used to compute the "energy ready" suggestion. */
  currentEnergy: number;
  /** Minimum energy needed to play any minigame — used for "energy ready" suggestion. */
  minMinigameCost: number;
  /** Whether the account-level daily load is high. */
  loadWarning: boolean;
  /** Whether the user appears to be struggling (for the recovery CTA). */
  struggling: boolean;
}

/**
 * Build the daily summary from the full habit list and today's ISO date.
 * Pure — no I/O, no side effects.
 */
export function buildDailySummary(
  habits: Habit[],
  today: string,
  opts: DashboardOptions,
): DailySummary {
  const activeLoggable = habits.filter((h) => isLoggableOn(h, today));

  const completedToday = activeLoggable.filter((h) => isCompletedOn(h, today)).length;
  const pendingToday = activeLoggable.filter((h) => !isCompletedOn(h, today)).length;
  const scheduledToday = activeLoggable.length;

  // Energy earned today = habit completions logged on today across all active habits
  const energyEarnedToday = habits.filter(
    (h) => h.status !== 'retired' && isCompletedOn(h, today),
  ).length;

  const rate = weeklyCompletionRate(habits, today);

  // Top streaks
  const withStreaks = habits
    .filter((h) => h.status === 'active' && h.streak > 0)
    .map((h) => ({ habitId: h.id, habitName: h.name, streak: h.streak, stat: h.stat }))
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 3);

  const focusHabits = habits.filter((h) => h.focus && h.status === 'active');
  const pendingFocusHabits = focusHabits.filter((h) => !isCompletedOn(h, today));

  const atRiskHabits = activeLoggable.filter(
    (h) => !isCompletedOn(h, today) && currentStreak(h, today) > 0,
  );

  const action = buildRecommendedAction({
    pendingFocusHabits,
    pendingToday,
    completedToday,
    atRiskHabits,
    currentEnergy: opts.currentEnergy,
    minMinigameCost: opts.minMinigameCost,
    loadWarning: opts.loadWarning,
    struggling: opts.struggling,
    scheduledToday,
  });

  return {
    completedToday,
    pendingToday,
    scheduledToday,
    energyEarnedToday,
    weeklyCompletionRate: rate,
    topStreaks: withStreaks,
    focusHabits,
    pendingFocusHabits,
    atRiskHabits,
    recommendedAction: action,
  };
}

// ---------------------------------------------------------------------------
// Recommended action (priority-ordered)
// ---------------------------------------------------------------------------

function buildRecommendedAction(opts: {
  pendingFocusHabits: Habit[];
  pendingToday: number;
  completedToday: number;
  atRiskHabits: Habit[];
  currentEnergy: number;
  minMinigameCost: number;
  loadWarning: boolean;
  struggling: boolean;
  scheduledToday: number;
}): RecommendedAction | null {
  // 1. Recovery / struggling — highest empathy priority
  if (opts.struggling) {
    return {
      kind: 'struggling',
      message: "Things feel tough right now — let's simplify. Pick 1–3 habits to keep this week.",
    };
  }

  // 2. Incomplete focus habit
  if (opts.pendingFocusHabits.length > 0) {
    const first = opts.pendingFocusHabits[0];
    return {
      kind: 'finish_focus',
      message: `Finish your focus habit: "${first.name}"`,
      targetHabitId: first.id,
    };
  }

  // 3. Nothing done yet today (and there is something to do)
  if (opts.completedToday === 0 && opts.scheduledToday > 0) {
    return {
      kind: 'start_today',
      message: "Log one habit to start building today's momentum.",
    };
  }

  // 4. Streak at risk (has a streak and is not done today)
  if (opts.atRiskHabits.length > 0) {
    const h = opts.atRiskHabits[0];
    return {
      kind: 'streak_at_risk',
      message: `"${h.name}" streak is at risk — log it before the day ends.`,
      targetHabitId: h.id,
    };
  }

  // 5. Enough energy for a minigame
  if (opts.completedToday > 0 && opts.currentEnergy >= opts.minMinigameCost) {
    return {
      kind: 'energy_ready',
      message: `You've earned ${opts.currentEnergy} energy — enough to start an adventure!`,
    };
  }

  // 6. Load warning
  if (opts.loadWarning) {
    return {
      kind: 'load_warning',
      message: 'Your habit load is high. Consider making some habits weekly instead of daily.',
    };
  }

  // 7. All done
  if (opts.scheduledToday > 0 && opts.pendingToday === 0) {
    return {
      kind: 'all_done',
      message: 'All habits complete — well done, hero!',
    };
  }

  return null;
}
