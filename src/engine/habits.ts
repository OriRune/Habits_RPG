// Habit model + completion/scheduling logic (design brief Sections 2, 3, 14, 18).
import type { StatId } from './stats';
import { computeXp, type Difficulty } from './xp';
import { weekdayOf, addDays, startOfWeek } from './date';

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
  /**
   * ISO date the +1 completion energy was last granted for this habit. Lives on the habit
   * (not the deletable log entry) so it survives an uncomplete — blocking a same-day
   * complete→spend→uncomplete→re-complete from minting fresh energy (HABIT-04/HABIT-16).
   * Never cleared on uncomplete.
   */
  lastEnergyGrantISO?: string;
  /**
   * ISO date labor was last granted to the Homestead for this habit. Uses its OWN marker
   * (not the energy one — labor has no full-energy gate), living on the habit so it survives
   * an uncomplete: a same-day complete→uncomplete→re-complete cannot re-mint labor (HABIT-04).
   * Never cleared on uncomplete.
   */
  lastLaborGrantISO?: string;
  /**
   * The streak-milestone bonus last paid out for this habit (day-scheduled only). Lets
   * uncomplete claw back the exact gold/freezes and blocks a same-day re-mint of the
   * milestone (deferred from item 3.4). Never cleared on uncomplete.
   */
  lastMilestoneGrant?: { dateISO: string; gold: number; freezes: number };
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
 * The most recent *past* scheduled+active day that is unlogged (and unfrozen) — the day a
 * Recovery Elixir would repair to bridge a broken streak. Walks back exactly like
 * currentStreak (skipping unscheduled days; frozen/completed days are fine), returning the
 * ISO date at the first real break. Returns undefined if there's no such miss within
 * `createdISO`, or for frequencies without a per-day schedule.
 */
export function mostRecentMissedScheduledDay(habit: Habit, today: string): string | undefined {
  if (!DAY_SCHEDULED.includes(habit.frequency)) return undefined;
  if (effectiveStatus(habit, today) !== 'active') return undefined;

  let cursor = today;
  // Mirror currentStreak: today scheduled-but-not-yet-done is "pending", not a miss.
  if (isScheduledOn(habit, cursor) && !isCompletedOn(habit, cursor)) {
    cursor = addDays(cursor, -1);
  }
  for (let i = 0; i < STREAK_MAX_ITERS && cursor >= habit.createdISO; i++) {
    if (!isScheduledOn(habit, cursor)) {
      cursor = addDays(cursor, -1);
      continue;
    }
    // A logged day (completed or frozen) bridges; the first unlogged scheduled day is the miss.
    if (isCompletedOn(habit, cursor)) {
      cursor = addDays(cursor, -1);
    } else {
      return cursor;
    }
  }
  return undefined;
}

/**
 * True for frequencies with a per-calendar-day schedule (daily/weekdays/custom), where a
 * single completion advances the streak by exactly one day. times_per_week counts *weeks*
 * (and holds across extra same-week logs); as_needed has no streak.
 */
export function isDayScheduled(habit: Habit): boolean {
  return DAY_SCHEDULED.includes(habit.frequency);
}

/** A streak-milestone celebration: the day count reached and the reward granted. */
export interface StreakMilestone {
  days: number;
  gold: number;
  freezes: number;
}

/**
 * If `newStreak` exactly hits a celebrated milestone (7 / 30 / 100 days), return its reward,
 * else null. A single completion increments a streak by at most 1, so exact equality is the
 * crossing test — no double-fire, no skipped milestone. Callers should only invoke this for a
 * live (same-day) completion, not a backdated fill.
 */
export function streakMilestone(newStreak: number): StreakMilestone | null {
  switch (newStreak) {
    case 7:
      return { days: 7, gold: 25, freezes: 0 };
    case 30:
      return { days: 30, gold: 100, freezes: 1 };
    case 100:
      return { days: 100, gold: 500, freezes: 1 };
    default:
      return null;
  }
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
  opts: { actual?: number; level?: number } = {},
): CompletionResult {
  const dayScheduled = DAY_SCHEDULED.includes(habit.frequency);
  // Recovery applies only when a genuinely *scheduled* day was actually missed in the gap
  // between the last completion and now — not merely because calendar days elapsed. A Mon/Wed/Fri
  // habit always has a multi-day gap yet misses nothing; the old `gap > 1` test handed it a
  // permanent 1.1× (HABIT-05). `mostRecentMissedScheduledDay` walks the schedule (bridging
  // frozen/completed days; today's own entry isn't written yet so it's treated as pending) and
  // returns the most recent unlogged scheduled day. We require a `lastCompletedISO` (a first-ever
  // completion isn't a "recovery") and that the miss falls strictly *after* it — a miss predating
  // the last completion was already recovered from.
  const last = habit.lastCompletedISO;
  const missedDay = last ? mostRecentMissedScheduledDay(habit, todayIso) : undefined;
  const recovery = dayScheduled && last !== undefined && missedDay !== undefined && missedDay > last;

  const xp = computeXp({
    difficulty: habit.difficulty,
    type: habit.type,
    actual: opts.actual,
    target: habit.target,
    uncapped: habit.uncapped,
    recovery,
    level: opts.level,
  });

  return { xp, recovery };
}

// ---------------------------------------------------------------------------
// Habit-streak minigame-gold multiplier (§6.3)
// ---------------------------------------------------------------------------

/**
 * The raw counts behind the streak-bonus multiplier: how many habits are streak-tracked
 * (active, scheduled) and how many of those are on a healthy (streak ≥ 3) run. Surfaced to the
 * UI so the streak-bonus chip can show "N of M habits on streak" alongside the multiplier.
 * as_needed habits are excluded — they never break streak.
 */
export function habitBonusCounts(habits: Habit[]): { tracked: number; healthy: number } {
  const tracked = habits.filter((h) => h.status === 'active' && h.frequency !== 'as_needed');
  const healthy = tracked.filter((h) => h.streak >= 3).length;
  return { tracked: tracked.length, healthy };
}

/**
 * The habit-streak minigame-gold multiplier (1.0–1.25) from the current active habits.
 * healthy = fraction of tracked habits with streak ≥ 3.
 * Bonus tiers: ≥100% → 1.25, ≥75% → 1.15, ≥50% → 1.10, else → 1.0.
 */
export function habitStreakBonus(habits: Habit[]): number {
  const { tracked, healthy } = habitBonusCounts(habits);
  if (tracked === 0) return 1;
  const frac = healthy / tracked;
  return frac >= 1 ? 1.25 : frac >= 0.75 ? 1.15 : frac >= 0.5 ? 1.1 : 1;
}
