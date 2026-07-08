import type { StateCreator } from 'zustand';
import type { TrialId, TrialBeginResult } from '@/engine/trials/trials';
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
import { applyReward, checkLevelUp, energySpentPatch } from '../shared';
import { townPerks } from '@/engine/town';

export interface TrialsSlice {
  trialsClearedOn: Record<TrialId, string>;
  bestTrialScore: Record<TrialId, number>;
  /**
   * MINI-11: monotonic per-account attempt counter, XOR'd into the daily seed of the
   * deterministic trials (Library, Grove) so abandoning and reopening draws a genuinely
   * fresh challenge instead of replaying the same one. Persisted so a page refresh can't
   * reset it back to a predictable value and reopen the replay exploit.
   */
  trialAttemptNonce: number;
  /**
   * MINI-16: round ids the player has been shown in Spirit Grove. Drafts bias toward
   * unseen rounds so each session stays as fresh as a 15-round pool allows.
   */
  spiritGroveSeen: string[];
  completeTrial: (trialId: TrialId, score01: number) => boolean;
  /**
   * Evaluate the daily-clear / energy / stat gates and, on success, charge 1 energy and
   * bump the attempt nonce. Called when a trial run begins (not on completion). Returns
   * a typed result so the UI can explain a refusal (6.7 — charge energy at Begin).
   */
  beginTrial: (trialId: TrialId) => TrialBeginResult;
  /** Record Spirit Grove round ids as seen (unions + dedups). Called on completion only. */
  markSpiritGroveSeen: (ids: string[]) => void;
}

export const createTrialsSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  TrialsSlice
> = (set, get) => ({
  trialsClearedOn: emptyTrialsClearedOn(),
  bestTrialScore: emptyBestTrialScore(),
  trialAttemptNonce: 0,
  spiritGroveSeen: [],

  beginTrial: (trialId) => {
    const s = get();
    const today = toISODate();
    const clearedToday = !s.settings.repeatMinigames && s.trialsClearedOn[trialId] === today;
    // Homestead Training Yard (practice perk): a trial already cleared today can be replayed for
    // free — no energy, no reward (completeTrial's same-day early-return keeps it reward-safe). It
    // was cleared today, so the daily-clear/energy/stat gates below are all bypassed for this path.
    const practice = clearedToday && townPerks(s.town).trialPractice;
    // Daily-clear gate (skipped by repeatMinigames dev flag; a Training Yard turns it into practice).
    if (clearedToday && !practice) return { ok: false, reason: 'cleared' };
    // Energy gate: 1 energy per trial (§6.1 — ties Trials to the habit→energy loop). Skipped by unlimitedEnergy / practice.
    if (!practice && !s.settings.unlimitedEnergy && s.character.energy < TRIAL_ENERGY_COST) return { ok: false, reason: 'energy' };
    // Stat gate: must have completed a habit of the same stat within the last 7 days (§4.4 / §6.2).
    // Bypassed by repeatMinigames (same dev flag that disables the daily clear gate) and by practice
    // (the trial was already cleared today, so the recency gate already passed today).
    const def = getTrial(trialId);
    if (!practice && !s.settings.repeatMinigames && !statCompletedWithin(s.habits, def.stat, today, 7)) return { ok: false, reason: 'stat' };
    set((st) => {
      // MINI-11: advance the per-attempt nonce so a reopened deterministic trial redraws.
      // 6.7: charge 1 energy HERE (was in completeTrial) — mirrors beginMining's entry debit,
      // so abandoning is no longer free (closes the reroll exploit). A practice replay is free.
      if (practice || st.settings.unlimitedEnergy) return { trialAttemptNonce: st.trialAttemptNonce + 1 };
      return {
        trialAttemptNonce: st.trialAttemptNonce + 1,
        character: { ...st.character, energy: st.character.energy - TRIAL_ENERGY_COST },
        ...energySpentPatch(st, TRIAL_ENERGY_COST),
      };
    });
    return practice ? { ok: true, practice: true } : { ok: true };
  },

  markSpiritGroveSeen: (ids) => set((s) => ({
    spiritGroveSeen: Array.from(new Set([...s.spiritGroveSeen, ...ids])),
  })),

  completeTrial: (trialId, score01) => {
    let banked = false;
    set((s) => {
      const today = toISODate();
      if (!s.settings.repeatMinigames && s.trialsClearedOn[trialId] === today) return s; // already banked today → banked stays false
      banked = true;
      const def = getTrial(trialId);
      const reward = trialReward(def.stat, score01, s.character.level);
      // MINI-16: mastery-mode Spirit Grove (player already has a perfect best) pays a prestige
      // gold bonus, so pushing a perfect run again isn't a strict downgrade vs the harder draft.
      if (trialId === 'spirit_grove' && (s.bestTrialScore['spirit_grove'] ?? 0) >= 1 && reward.gold) {
        reward.gold = Math.round(reward.gold * 1.15);
      }
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
      applyReward(next, reward, 'trial');
      checkLevelUp(next);
      return next;
    });
    return banked;
  },
});
