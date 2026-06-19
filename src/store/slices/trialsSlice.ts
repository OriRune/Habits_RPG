import type { StateCreator } from 'zustand';
import type { TrialId } from '@/engine/trials/trials';
import {
  getTrial,
  trialReward,
  emptyTrialsClearedOn,
  emptyBestTrialScore,
} from '@/engine/trials/trials';
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
      const def = getTrial(trialId);
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
      checkLevelUp(next);
      return next;
    }),
});
