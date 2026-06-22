// Habit history derivations (Phase 2): heatmap cells, per-habit stats, and chart series.
// Pure read-only functions over a habit's `log`; unit-tested.
import {
  type Habit,
  isScheduledOn,
  effectiveStatus,
  isCompletedOn,
  weekCompletions,
} from './habits';
import { addDays, startOfWeek, weekdayOf } from './date';

export type CellState = 'green' | 'yellow' | 'red' | 'gray' | 'future' | 'none';

const DAY_FREQS: Habit['frequency'][] = ['daily', 'weekdays', 'custom'];
const MAX_DAYS = 366 * 6;

/** Whether a completed entry counts as a full success (target hit for quantity). */
function isSuccess(habit: Habit, iso: string): boolean {
  const entry = habit.log[iso];
  if (!entry) return false;
  if (habit.type === 'quantity') return (entry.amount ?? 0) >= (habit.target ?? 1);
  return true;
}

/** Heatmap colour for one calendar day. */
export function dayCell(habit: Habit, iso: string, today: string): CellState {
  if (iso > today) return 'future';
  if (iso < habit.createdISO) return 'none';
  if (isCompletedOn(habit, iso)) {
    if (habit.type === 'quantity') return isSuccess(habit, iso) ? 'green' : 'yellow';
    return 'green';
  }
  // Not completed: never shame a paused/retired habit, and only "miss" scheduled days.
  if (effectiveStatus(habit, today) !== 'active') return 'gray';
  return isScheduledOn(habit, iso) ? 'red' : 'gray';
}

export interface HabitStats {
  totalDays: number;
  longestStreak: number;
  /** 0..100, or null when there's no meaningful denominator (as_needed / no data yet). */
  successPct: number | null;
  totalPoints: number;
}

export function habitStats(habit: Habit, today: string): HabitStats {
  const dates = Object.keys(habit.log);
  const totalDays = dates.length;
  const totalPoints = dates.reduce((sum, d) => sum + (habit.log[d].xp ?? 0), 0);

  let longestStreak = 0;
  let successPct: number | null = null;

  if (habit.frequency === 'times_per_week') {
    // Consecutive successful weeks; successPct over completed (past) weeks.
    let run = 0;
    let weeks = 0;
    let successWeeks = 0;
    const currentWeek = startOfWeek(today);
    let ws = startOfWeek(habit.createdISO);
    for (let i = 0; i < MAX_DAYS && ws <= currentWeek; i++) {
      const met = weekCompletions(habit, ws) >= (habit.timesPerWeek ?? 1);
      if (met) {
        run++;
        longestStreak = Math.max(longestStreak, run);
      } else {
        run = 0;
      }
      if (ws < currentWeek) {
        weeks++;
        if (met) successWeeks++;
      }
      ws = addDays(ws, 7);
    }
    successPct = weeks > 0 ? Math.round((successWeeks / weeks) * 100) : null;
  } else if (habit.frequency === 'as_needed') {
    // Longest run of consecutive calendar days completed.
    let run = 0;
    let day = habit.createdISO;
    for (let i = 0; i < MAX_DAYS && day <= today; i++) {
      if (isCompletedOn(habit, day)) {
        run++;
        longestStreak = Math.max(longestStreak, run);
      } else {
        run = 0;
      }
      day = addDays(day, 1);
    }
  } else if (DAY_FREQS.includes(habit.frequency)) {
    // Day-scheduled: streak over scheduled days; successPct = success ÷ scheduled.
    let run = 0;
    let scheduled = 0;
    let successes = 0;
    let day = habit.createdISO;
    for (let i = 0; i < MAX_DAYS && day <= today; i++) {
      if (isScheduledOn(habit, day)) {
        scheduled++;
        if (isCompletedOn(habit, day)) {
          run++;
          longestStreak = Math.max(longestStreak, run);
          if (isSuccess(habit, day)) successes++;
        } else {
          run = 0;
        }
      }
      day = addDays(day, 1);
    }
    successPct = scheduled > 0 ? Math.round((successes / scheduled) * 100) : null;
  }

  return { totalDays, longestStreak, successPct, totalPoints };
}

/**
 * Account-wide habit-completion rate (0–100) over the last `windowDays` calendar
 * days (inclusive). Counts day-scheduled and times_per_week habits; as_needed habits
 * are excluded (no meaningful denominator). Retired habits are excluded entirely.
 * Returns 0 when there are no schedulable habits in the window.
 */
export function consistencyScore(habits: Habit[], today: string, windowDays = 30): number {
  const windowStart = addDays(today, -(windowDays - 1));
  const todayWeek = startOfWeek(today);
  let scheduled = 0;
  let successes = 0;

  for (const habit of habits) {
    if (habit.status === 'retired') continue;
    if (habit.frequency === 'as_needed') continue;

    const habitStart = habit.createdISO > windowStart ? habit.createdISO : windowStart;

    if (habit.frequency === 'times_per_week') {
      // Walk complete (past) weeks only — the current week is still in progress.
      let ws = startOfWeek(habitStart);
      while (ws < todayWeek) {
        if (addDays(ws, 6) >= windowStart) {
          const target = habit.timesPerWeek ?? 1;
          scheduled += target;
          successes += Math.min(weekCompletions(habit, ws), target);
        }
        ws = addDays(ws, 7);
      }
    } else {
      // daily / weekdays / custom
      let day = habitStart;
      while (day <= today) {
        const st = effectiveStatus(habit, day);
        if (st === 'active' && isScheduledOn(habit, day)) {
          scheduled++;
          if (isCompletedOn(habit, day)) successes++;
        }
        day = addDays(day, 1);
      }
    }
  }

  return scheduled > 0 ? Math.round((successes / scheduled) * 100) : 0;
}

export type ChartRange = 'week' | 'month' | 'year';

export function rangeStart(today: string, range: ChartRange): string {
  const days = range === 'week' ? 6 : range === 'month' ? 29 : 364;
  return addDays(today, -days);
}

/** Daily amounts over [startIso, endIso] for quantity charts (0 on un-logged days). */
export function series(habit: Habit, startIso: string, endIso: string): { date: string; amount: number }[] {
  const out: { date: string; amount: number }[] = [];
  let d = startIso;
  for (let i = 0; i < MAX_DAYS && d <= endIso; i++) {
    const e = habit.log[d];
    out.push({ date: d, amount: e?.amount ?? (e ? 1 : 0) });
    d = addDays(d, 1);
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface HeatCell {
  iso: string;
  state: CellState;
}
export interface HeatWeek {
  weekStart: string;
  cells: HeatCell[];
  /** Month name shown above the column when the month changes. */
  monthLabel?: string;
}

/**
 * Completion breakdown by weekday (0=Sun..6=Sat) over the last `windowDays` calendar days.
 * Only day-scheduled habits (daily / weekdays / custom) are counted — times_per_week and
 * as_needed return false from `isScheduledOn` so they are naturally excluded. Retired
 * habits are skipped.
 */
export function dayOfWeekBreakdown(
  habits: Habit[],
  today: string,
  windowDays = 84,
): { weekday: number; scheduled: number; completed: number }[] {
  const buckets = Array.from({ length: 7 }, (_, wd) => ({ weekday: wd, scheduled: 0, completed: 0 }));
  const windowStart = addDays(today, -(windowDays - 1));

  for (const habit of habits) {
    if (habit.status === 'retired') continue;
    const start = habit.createdISO > windowStart ? habit.createdISO : windowStart;
    let day = start;
    for (let i = 0; i < MAX_DAYS && day <= today; i++) {
      if (effectiveStatus(habit, day) === 'active' && isScheduledOn(habit, day)) {
        const wd = weekdayOf(day);
        buckets[wd].scheduled++;
        if (isCompletedOn(habit, day)) buckets[wd].completed++;
      }
      day = addDays(day, 1);
    }
  }

  return buckets;
}

/**
 * Account-wide habit completion rate (0–100) per week over the last `weeks` Sunday-started
 * weeks. Day-scheduled habits are included; times_per_week habits are counted only for
 * complete past weeks; as_needed and retired habits are excluded.
 * The current (in-progress) week uses partial data up to today.
 */
export function consistencyTrend(
  habits: Habit[],
  today: string,
  weeks = 12,
): { weekStart: string; pct: number }[] {
  const result: { weekStart: string; pct: number }[] = [];
  const currentWeek = startOfWeek(today);
  let ws = addDays(currentWeek, -7 * (weeks - 1));

  for (let w = 0; w < weeks; w++) {
    const weekEnd = addDays(ws, 6);
    const clampedEnd = weekEnd <= today ? weekEnd : today;
    let scheduled = 0;
    let completed = 0;

    for (const habit of habits) {
      if (habit.status === 'retired') continue;

      if (habit.frequency === 'times_per_week') {
        // Only count fully-past weeks
        if (weekEnd < today && habit.createdISO <= weekEnd) {
          const target = habit.timesPerWeek ?? 1;
          scheduled += target;
          completed += Math.min(weekCompletions(habit, ws), target);
        }
      } else if (habit.frequency !== 'as_needed') {
        const habitStart = habit.createdISO > ws ? habit.createdISO : ws;
        let day = habitStart;
        for (let i = 0; i < MAX_DAYS && day <= clampedEnd; i++) {
          if (effectiveStatus(habit, day) === 'active' && isScheduledOn(habit, day)) {
            scheduled++;
            if (isCompletedOn(habit, day)) completed++;
          }
          day = addDays(day, 1);
        }
      }
    }

    result.push({ weekStart: ws, pct: scheduled > 0 ? Math.round((completed / scheduled) * 100) : 0 });
    ws = addDays(ws, 7);
  }

  return result;
}

/** Last `weeks` Sunday-started weeks ending with today's week, as heatmap columns. */
export function heatmapWeeks(habit: Habit, today: string, weeks = 26): HeatWeek[] {
  const out: HeatWeek[] = [];
  let ws = addDays(startOfWeek(today), -7 * (weeks - 1));
  let prevMonth = '';
  for (let w = 0; w < weeks; w++) {
    const cells: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const iso = addDays(ws, d);
      cells.push({ iso, state: dayCell(habit, iso, today) });
    }
    const mm = ws.slice(5, 7);
    const monthLabel = mm !== prevMonth ? MONTHS[Number(mm) - 1] : undefined;
    prevMonth = mm;
    out.push({ weekStart: ws, cells, monthLabel });
    ws = addDays(ws, 7);
  }
  return out;
}
