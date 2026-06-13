// Challenge system (design brief Section 9). Local, single-player for the MVP.
// Each challenge follows the brief's template: goal, time limit, eligible habits,
// reward, partial-reward rules.
import type { StatId } from './stats';
import type { Habit } from './habits';
import { daysBetween } from './date';

export interface Reward {
  gold?: number;
  statXp?: Partial<Record<StatId, number>>;
  items?: string[];
}

export type ChallengeMetric = 'count' | 'quantity';

export interface ChallengeDef {
  id: string;
  name: string;
  description: string;
  /** 'count' = number of qualifying completions; 'quantity' = summed amount. */
  metric: ChallengeMetric;
  /** Only count completions for this stat, if set. */
  stat?: StatId;
  /** Only count completions for this tag, if set. */
  tag?: string;
  goal: number;
  durationDays: number;
  reward: Reward;
  /** Optional partial reward granted if progress reaches this fraction of the goal. */
  partial?: { atRatio: number; reward: Reward };
}

export interface ActiveChallenge {
  def: ChallengeDef;
  startISO: string;
  progress: number;
  status: 'active' | 'completed' | 'claimed' | 'expired';
}

/** Starter challenge templates (brief Section 9, incl. "The Scholar's Week"). */
export const CHALLENGE_TEMPLATES: ChallengeDef[] = [
  {
    id: 'scholars_week',
    name: "The Scholar's Week",
    description: 'Read 100 pages total this week.',
    metric: 'quantity',
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
    metric: 'count',
    goal: 20,
    durationDays: 7,
    reward: { gold: 100, items: ['streak_freeze'] },
    partial: { atRatio: 0.5, reward: { gold: 30 } },
  },
  {
    id: 'iron_week',
    name: 'Iron Week',
    description: 'Complete 5 Strength habits this week.',
    metric: 'count',
    stat: 'ST',
    goal: 5,
    durationDays: 7,
    reward: { statXp: { ST: 80 }, gold: 40 },
    partial: { atRatio: 0.6, reward: { gold: 20 } },
  },
];

/** How much a single habit completion contributes to a challenge's progress. */
export function challengeContribution(
  def: ChallengeDef,
  habit: Habit,
  actual: number | undefined,
): number {
  if (def.stat && habit.stat !== def.stat) return 0;
  if (def.tag && habit.tag !== def.tag) return 0;
  if (def.metric === 'count') return 1;
  // quantity: use the entered amount for quantity habits, else count as 1.
  return habit.type === 'quantity' ? (actual ?? 0) : 1;
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
