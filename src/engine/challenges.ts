// Challenge system (design brief Section 9). Local, single-player.
// Each challenge follows the brief's template: goal, time limit, eligible habits,
// reward, partial-reward rules. Progress is recomputed from habit logs (not bumped
// incrementally) so every kind — including streak/recovery/class — stays correct.
import type { StatId } from './stats';
import { type Habit, isScheduledOn, isCompletedOn } from './habits';
import { daysBetween, addDays } from './date';

export interface Reward {
  gold?: number;
  statXp?: Partial<Record<StatId, number>>;
  items?: string[];
  /** Crafting materials, keyed by material id (see engine/materials.ts). */
  materials?: Record<string, number>;
  /** Weapon keys awarded (added to owned weapons; see engine/weapons.ts). */
  weapons?: string[];
  /** Gear keys awarded (added to owned gear; see engine/gear.ts). */
  gear?: string[];
}

/**
 * What a challenge measures (brief §9 Challenge Types):
 * - count    — number of qualifying completions
 * - quantity — summed amount logged on quantity habits
 * - streak   — longest run of consecutive days each with a qualifying completion
 * - recovery — qualifying completions made the day after a missed scheduled day (§14)
 * - class    — distinct days in the window with a qualifying completion (e.g. "5 days")
 * - rival    — beat a target snapshotted from last week (single-player "vs. past self")
 */
export type ChallengeKind = 'count' | 'quantity' | 'streak' | 'recovery' | 'class' | 'rival';

export interface ChallengeDef {
  id: string;
  name: string;
  description: string;
  kind: ChallengeKind;
  /** Only count completions for this stat, if set. */
  stat?: StatId;
  /** Only count completions for this tag, if set. */
  tag?: string;
  goal: number;
  durationDays: number;
  reward: Reward;
  /** Optional partial reward granted if progress reaches this fraction of the goal. */
  partial?: { atRatio: number; reward: Reward };
  /** rival only: which metric to accumulate toward the snapshotted goal (default 'count'). */
  accumulate?: 'count' | 'quantity';
  /** Marks a player-authored challenge (built in the challenge builder). */
  custom?: boolean;
}

export interface ActiveChallenge {
  def: ChallengeDef;
  startISO: string;
  progress: number;
  status: 'active' | 'completed' | 'claimed' | 'expired';
}

/** Starter challenge templates (brief Section 9). */
export const CHALLENGE_TEMPLATES: ChallengeDef[] = [
  {
    id: 'scholars_week',
    name: "The Scholar's Week",
    description: 'Read 100 pages total this week.',
    kind: 'quantity',
    stat: 'KN',
    goal: 100,
    durationDays: 7,
    reward: { statXp: { KN: 150 }, gold: 50, items: ['focus_potion'] },
    partial: { atRatio: 0.5, reward: { gold: 50 } },
  },
  {
    id: 'consistency_week',
    name: 'Week of Consistency',
    description: 'Complete 20 habits total this week.',
    kind: 'count',
    goal: 20,
    durationDays: 7,
    reward: { gold: 100, items: ['streak_freeze'] },
    partial: { atRatio: 0.5, reward: { gold: 30 } },
  },
  {
    id: 'iron_week',
    name: 'Iron Week',
    description: 'Complete 5 Strength habits this week.',
    kind: 'count',
    stat: 'ST',
    goal: 5,
    durationDays: 7,
    reward: { statXp: { ST: 80 }, gold: 40 },
    partial: { atRatio: 0.6, reward: { gold: 20 } },
  },
  {
    id: 'unbroken_week',
    name: 'Unbroken',
    description: 'Keep a 7-day completion streak going.',
    kind: 'streak',
    goal: 7,
    durationDays: 9,
    reward: { gold: 80, items: ['streak_freeze'] },
    partial: { atRatio: 0.5, reward: { gold: 30 } },
  },
  {
    id: 'phoenix_week',
    name: 'Phoenix',
    description: 'Bounce back 3 times after a missed day.',
    kind: 'recovery',
    goal: 3,
    durationDays: 7,
    reward: { gold: 60, items: ['focus_potion'] },
    partial: { atRatio: 0.5, reward: { gold: 25 } },
  },
  {
    id: 'sages_devotion',
    name: "Sage's Devotion",
    description: 'Train Wisdom on 5 separate days this week.',
    kind: 'class',
    stat: 'WI',
    goal: 5,
    durationDays: 7,
    reward: { statXp: { WI: 120 }, gold: 50 },
    partial: { atRatio: 0.6, reward: { gold: 20 } },
  },
];

/** Whether a habit is eligible for a challenge (stat/tag filters). */
export function habitMatches(def: ChallengeDef, habit: Habit): boolean {
  if (def.stat && habit.stat !== def.stat) return false;
  if (def.tag && habit.tag !== def.tag) return false;
  return true;
}

/** A day's quantity contribution from one habit (entered amount, else 1 for binary). */
function dayAmount(habit: Habit, iso: string): number {
  const entry = habit.log[iso];
  if (entry === undefined) return 0;
  return habit.type === 'quantity' ? (entry.amount ?? 0) : 1;
}

/** Inclusive list of ISO dates in the challenge window, capped at today. */
function windowDates(startISO: string, durationDays: number, todayIso: string): string[] {
  const out: string[] = [];
  for (let d = 0; d < durationDays; d++) {
    const iso = addDays(startISO, d);
    if (daysBetween(todayIso, iso) < 0) break; // future day — stop
    out.push(iso);
  }
  return out;
}

/** Whether any eligible habit was completed on `iso`. */
function anyMatchCompletedOn(def: ChallengeDef, habits: Habit[], iso: string): boolean {
  return habits.some((h) => habitMatches(def, h) && isCompletedOn(h, iso));
}

/**
 * Current progress for a challenge, computed from the habits' logs across its window.
 * Recompute-from-source keeps streak/recovery/class honest regardless of completion order.
 */
export function challengeProgress(
  def: ChallengeDef,
  startISO: string,
  habits: Habit[],
  todayIso: string,
): number {
  const days = windowDates(startISO, def.durationDays, todayIso);
  const eligible = habits.filter((h) => habitMatches(def, h));

  switch (def.kind) {
    case 'count':
      return days.reduce(
        (sum, iso) => sum + eligible.reduce((n, h) => n + (isCompletedOn(h, iso) ? 1 : 0), 0),
        0,
      );
    case 'quantity':
      return days.reduce(
        (sum, iso) => sum + eligible.reduce((n, h) => n + dayAmount(h, iso), 0),
        0,
      );
    case 'rival': {
      const quantity = def.accumulate === 'quantity';
      return days.reduce(
        (sum, iso) =>
          sum + eligible.reduce((n, h) => n + (quantity ? dayAmount(h, iso) : isCompletedOn(h, iso) ? 1 : 0), 0),
        0,
      );
    }
    case 'class':
      // Distinct days with an eligible completion.
      return days.reduce((n, iso) => n + (anyMatchCompletedOn(def, habits, iso) ? 1 : 0), 0);
    case 'streak': {
      // Longest run of consecutive qualifying days within the window.
      let best = 0;
      let run = 0;
      for (const iso of days) {
        if (anyMatchCompletedOn(def, habits, iso)) {
          run += 1;
          if (run > best) best = run;
        } else {
          run = 0;
        }
      }
      return best;
    }
    case 'recovery': {
      // Completions made the day after a missed *scheduled* day for that habit (§14).
      let count = 0;
      for (const iso of days) {
        const prev = addDays(iso, -1);
        for (const h of eligible) {
          if (isCompletedOn(h, iso) && isScheduledOn(h, prev) && !isCompletedOn(h, prev)) count++;
        }
      }
      return count;
    }
  }
}

export function isExpired(active: ActiveChallenge, todayIso: string): boolean {
  return daysBetween(todayIso, active.startISO) >= active.def.durationDays;
}

export interface ChallengeOutcome {
  /** Full reward if the goal was met, else the partial reward if its threshold was hit. */
  reward: Reward | null;
  met: boolean;
  partial: boolean;
}

/** Resolve what reward an active challenge yields at its current progress. */
export function resolveChallenge(active: ActiveChallenge): ChallengeOutcome {
  const { def, progress } = active;
  if (progress >= def.goal) {
    return { reward: def.reward, met: true, partial: false };
  }
  if (def.partial && progress >= def.goal * def.partial.atRatio) {
    return { reward: def.partial.reward, met: false, partial: true };
  }
  return { reward: null, met: false, partial: false };
}

/** Effort weight per kind — normalizes wildly different goal scales into a fair reward. */
const KIND_WEIGHT: Record<ChallengeKind, number> = {
  count: 1,
  quantity: 0.12,
  streak: 2,
  recovery: 2.5,
  class: 2,
  rival: 1,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Bounds every challenge reward is held to. suggestReward stays inside them by construction;
 * hand-edited custom overrides are forced into them by clampReward, so a trivial (count-1,
 * 1-day) challenge can't mint arbitrary XP/gold off a single completion (HABIT-01).
 */
export const REWARD_GOLD_BOUNDS: readonly [number, number] = [20, 300];
export const REWARD_STATXP_BOUNDS: readonly [number, number] = [30, 400];

/**
 * Suggested, auto-balanced reward for a challenge (used by the builder). Scales gold +
 * a stat-XP grant by goal × duration × kind weight, clamped so tiny goals can't mint huge rewards.
 */
export function suggestReward(def: Pick<ChallengeDef, 'kind' | 'goal' | 'durationDays' | 'stat'>): Reward {
  const difficulty = Math.max(1, def.goal) * (def.durationDays / 7) * KIND_WEIGHT[def.kind];
  const gold = Math.round(clamp(difficulty * 4, REWARD_GOLD_BOUNDS[0], REWARD_GOLD_BOUNDS[1]));
  const reward: Reward = { gold };
  if (def.stat)
    reward.statXp = {
      [def.stat]: Math.round(clamp(difficulty * 6, REWARD_STATXP_BOUNDS[0], REWARD_STATXP_BOUNDS[1])),
    };
  return reward;
}

/**
 * Clamp a (possibly hand-edited) reward's gold and stat-XP to the same auto-balanced bounds
 * suggestReward enforces — the fix for HABIT-01, where the builder's "Edit reward" path only
 * floored values at 0, letting a custom challenge grant e.g. 999999. Other reward fields are
 * preserved untouched (the custom-challenge builder only edits gold and stat-XP).
 */
export function clampReward(reward: Reward): Reward {
  const clamped: Reward = { ...reward };
  if (reward.gold !== undefined) {
    clamped.gold = Math.round(clamp(reward.gold, REWARD_GOLD_BOUNDS[0], REWARD_GOLD_BOUNDS[1]));
  }
  if (reward.statXp) {
    const statXp: Partial<Record<StatId, number>> = {};
    for (const key of Object.keys(reward.statXp) as StatId[]) {
      const v = reward.statXp[key];
      if (v !== undefined) {
        statXp[key] = Math.round(clamp(v, REWARD_STATXP_BOUNDS[0], REWARD_STATXP_BOUNDS[1]));
      }
    }
    clamped.statXp = statXp;
  }
  return clamped;
}

/**
 * Goal for a "rival vs. past self" challenge: beat last week's qualifying count for `stat`
 * (the week starting at `lastWeekKey`), so the bar is always your own prior performance.
 */
export function rivalGoal(stat: StatId | undefined, habits: Habit[], lastWeekKey: string): number {
  let count = 0;
  for (let d = 0; d < 7; d++) {
    const iso = addDays(lastWeekKey, d);
    for (const h of habits) {
      if ((!stat || h.stat === stat) && isCompletedOn(h, iso)) count++;
    }
  }
  return Math.max(1, count + 1);
}
