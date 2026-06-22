import type { StateCreator } from 'zustand';
import {
  type ActiveChallenge,
  type ChallengeDef,
  type Reward,
  CHALLENGE_TEMPLATES,
  resolveChallenge,
  suggestReward,
  rivalGoal,
} from '@/engine/challenges';
import { weeklyRotation } from '@/engine/weekly';
import { toISODate, weekKey, addDays } from '@/engine/date';
import type { WeeklyReport } from '@/engine/weekly';
import type { GameState, CustomChallengeDraft } from '../shared';
import {
  uid,
  describeDraft,
  classStatOf,
  applyWeeklyRollover,
  applyReward,
  checkLevelUp,
} from '../shared';
import { freshEarningsLedger } from '@/engine/balance';

export interface ChallengesSlice {
  challenges: ActiveChallenge[];
  customChallenges: ChallengeDef[];
  lastWeekKey: string;
  pendingReport: WeeklyReport | null;

  startChallenge: (defId: string) => void;
  claimChallenge: (index: number) => void;
  createCustomChallenge: (draft: CustomChallengeDraft, rewardOverride?: Reward) => void;
  deleteCustomChallenge: (id: string) => void;
  checkWeeklyRollover: () => void;
  dismissWeeklyReport: () => void;
}

export const createChallengesSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  ChallengesSlice
> = (set) => ({
  challenges: [],
  customChallenges: [],
  lastWeekKey: weekKey(toISODate()),
  pendingReport: null,

  startChallenge: (defId) =>
    set((s) => {
      const today = toISODate();
      const pool = [
        ...weeklyRotation(weekKey(today), classStatOf(s)),
        ...s.customChallenges,
        ...CHALLENGE_TEMPLATES,
      ];
      const def = pool.find((d) => d.id === defId);
      if (!def) return s;
      if (s.challenges.some((c) => c.def.id === defId && c.status === 'active')) return s;
      const frozen: ChallengeDef =
        def.kind === 'rival'
          ? { ...def, goal: rivalGoal(def.stat, s.habits, addDays(weekKey(today), -7)) }
          : def;
      const active: ActiveChallenge = { def: frozen, startISO: today, progress: 0, status: 'active' };
      return { challenges: [...s.challenges, active] };
    }),

  claimChallenge: (index) =>
    set((s) => {
      const c = s.challenges[index];
      if (!c || (c.status !== 'completed' && c.status !== 'expired')) return s;
      const outcome = resolveChallenge(c);
      const baseEarnings = s.earnings ?? freshEarningsLedger();
      const next: GameState = {
        ...s,
        character: { ...s.character, statXp: { ...s.character.statXp } },
        inventory: { ...s.inventory },
        materials: { ...s.materials },
        earnings: {
          ...baseEarnings,
          xp: { ...baseEarnings.xp },
          gold: { ...baseEarnings.gold },
          count: { ...baseEarnings.count },
        },
        challenges: s.challenges.map((x, i) =>
          i === index ? { ...x, status: 'claimed' as const } : x,
        ),
      };
      if (outcome.reward) applyReward(next, outcome.reward, 'challenge');
      checkLevelUp(next);
      return next;
    }),

  createCustomChallenge: (draft, rewardOverride) =>
    set((s) => {
      const goal = Math.max(1, Math.round(draft.goal));
      const durationDays = Math.max(1, Math.round(draft.durationDays));
      const base = { kind: draft.kind, goal, durationDays, stat: draft.stat };
      const def: ChallengeDef = {
        id: `custom_${uid()}`,
        name: draft.name.trim() || 'Custom Challenge',
        description: draft.description?.trim() || describeDraft(draft),
        kind: draft.kind,
        stat: draft.stat,
        tag: draft.tag,
        goal,
        durationDays,
        reward: rewardOverride ?? suggestReward(base),
        custom: true,
      };
      return { customChallenges: [...s.customChallenges, def] };
    }),

  deleteCustomChallenge: (id) =>
    set((s) => ({ customChallenges: s.customChallenges.filter((d) => d.id !== id) })),

  checkWeeklyRollover: () =>
    set((s) => {
      const today = toISODate();
      if (weekKey(today) === s.lastWeekKey) return s;
      const next: GameState = { ...s };
      applyWeeklyRollover(next, today);
      return next;
    }),

  dismissWeeklyReport: () => set((s) => (s.pendingReport ? { pendingReport: null } : s)),
});

