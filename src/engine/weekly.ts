// Weekly loop (design brief Section 2). At each week boundary the player gets a recap
// of the week that just ended and a fresh rotation of challenges to anticipate.
import type { StatId } from './stats';
import { STAT_IDS } from './stats';
import { type Habit, isCompletedOn } from './habits';
import { addDays, weekKey } from './date';
import type { Mood } from './mood';
import { type ChallengeDef, type ActiveChallenge, CHALLENGE_TEMPLATES } from './challenges';

export interface WeeklyReport {
  /** The week that just ended (its starting Sunday). */
  weekKey: string;
  /** Total habit completions logged that week. */
  completions: number;
  xpByStat: Partial<Record<StatId, number>>;
  xpTotal: number;
  topStat: StatId | null;
  bestStreak: { habitName: string; days: number } | null;
  challengesWon: number;
  mood: Mood;
}

/** The 7 ISO dates of the week starting at `weekStart`. */
function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, d) => addDays(weekStart, d));
}

/** Longest run of consecutive completed days for a habit within the given week. */
function longestRunInWeek(habit: Habit, weekStart: string): number {
  let best = 0;
  let run = 0;
  for (const iso of weekDates(weekStart)) {
    if (isCompletedOn(habit, iso)) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/** Build the end-of-week recap for the week starting at `weekStart`. */
export function buildWeeklyReport(
  weekStart: string,
  habits: Habit[],
  completionLog: Record<string, number>,
  challenges: ActiveChallenge[],
  mood: Mood,
): WeeklyReport {
  const dates = weekDates(weekStart);

  let completions = 0;
  for (const iso of dates) completions += completionLog[iso] ?? 0;

  const xpByStat: Partial<Record<StatId, number>> = {};
  let xpTotal = 0;
  for (const h of habits) {
    for (const iso of dates) {
      const entry = h.log[iso];
      if (!entry) continue;
      xpByStat[h.stat] = (xpByStat[h.stat] ?? 0) + entry.xp;
      xpTotal += entry.xp;
    }
  }

  let topStat: StatId | null = null;
  let topVal = 0;
  for (const id of STAT_IDS) {
    const v = xpByStat[id] ?? 0;
    if (v > topVal) {
      topVal = v;
      topStat = id;
    }
  }

  let bestStreak: WeeklyReport['bestStreak'] = null;
  for (const h of habits) {
    const days = longestRunInWeek(h, weekStart);
    if (days > (bestStreak?.days ?? 0)) bestStreak = { habitName: h.name, days };
  }

  const challengesWon = challenges.filter(
    (c) => weekKey(c.startISO) === weekStart && (c.status === 'completed' || c.status === 'claimed'),
  ).length;

  return { weekKey: weekStart, completions, xpByStat, xpTotal, topStat, bestStreak, challengesWon, mood };
}

/** Tiny deterministic string hash (so a week's rotation is stable but rotates across weeks). */
function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * This week's available challenges: a deterministic 3-template subset (seeded by the week
 * key) plus generated class + rival challenges aimed at the player's class stat. The rival
 * goal is a placeholder of 1 — the store freezes the real "beat last week" goal at start.
 */
export function weeklyRotation(weekStart: string, classStat: StatId | null): ChallengeDef[] {
  const seed = hashKey(weekStart);
  const picked: ChallengeDef[] = [];
  const pool = [...CHALLENGE_TEMPLATES];
  const wanted = Math.min(3, pool.length);
  for (let i = 0; i < wanted; i++) {
    const idx = (seed + i * 2654435761) % pool.length;
    picked.push(pool.splice(idx % pool.length, 1)[0]);
  }

  const rival: ChallengeDef = {
    id: 'rival_week',
    name: 'Rival: Past Self',
    description: classStat
      ? `Beat last week's tally of completions.`
      : `Beat last week's total completions.`,
    kind: 'rival',
    stat: classStat ?? undefined,
    goal: 1,
    durationDays: 7,
    reward: { gold: 90, items: ['focus_potion'] },
    partial: { atRatio: 0.5, reward: { gold: 30 } },
  };
  picked.push(rival);

  if (classStat) {
    picked.push({
      id: 'class_week',
      name: 'Class Devotion',
      description: `Train your class stat on 4 separate days this week.`,
      kind: 'class',
      stat: classStat,
      goal: 4,
      durationDays: 7,
      reward: { statXp: { [classStat]: 120 }, gold: 50 },
      partial: { atRatio: 0.5, reward: { gold: 20 } },
    });
  }

  return picked;
}
