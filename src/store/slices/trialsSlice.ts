import type { StateCreator } from 'zustand';
import type { TrialId } from '@/engine/trials/trials';
import {
  getTrial,
  trialReward,
  emptyTrialsClearedOn,
  emptyBestTrialScore,
  TRIAL_ENERGY_COST,
} from '@/engine/trials/trials';
import { statCompletedWithin } from '@/engine/habits';
import { toISODate } from '@/engine/date';
import type { GameState } from '../shared';
import { applyReward, checkLevelUp } from '../shared';

export interface TrialsSlice {
  trialsClearedOn: Record<TrialId, string>;
  bestTrialScore: Record<TrialId, number>;
  completeTrial: (trialId: TrialId, score01: number) => void;
}

export const createTrialsSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  TrialsSlice
> = (set) => ({
  trialsClearedOn: emptyTrialsClearedOn(),
  bestTrialScore: emptyBestTrialScore(),

  completeTrial: (trialId, score01) =>
    set((s) => {
      const today = toISODate();
      if (!s.settings.repeatMinigames && s.trialsClearedOn[trialId] === today) return s;
      // Energy gate: 1 energy per trial (§6.1 — ties Trials to the habit→energy loop).
      const free = s.settings.unlimitedEnergy;
      if (!free && s.character.energy < TRIAL_ENERGY_COST) return s;
      const def = getTrial(trialId);
      // Stat gate: must have completed a habit of the same stat within the last 7 days (§4.4 / §6.2).
      // Bypassed by repeatMinigames (same dev flag that disables the daily clear gate).
      if (!s.settings.repeatMinigames && !statCompletedWithin(s.habits, def.stat, today, 7)) return s;
      const reward = trialReward(def.stat, score01, s.character.level);
      const next: GameState = {
        ...s,
        character: { ...s.character, statXp: { ...s.character.statXp } },
        inventory: { ...s.inventory },
        materials: { ...s.materials },
        ownedWeapons: [...s.ownedWeapons],
        ownedGear: [...s.ownedGear],
        trialsClearedOn: { ...s.trialsClearedOn, [trialId]: today },
        bestTrialScore: {
          ...s.bestTrialScore,
          [trialId]: Math.max(s.bestTrialScore[trialId] ?? 0, Math.max(0, Math.min(1, score01))),
        },
      };
      applyReward(next, reward);
      if (!free) next.character.energy -= TRIAL_ENERGY_COST;
      checkLevelUp(next);
      return next;
    }),
});
