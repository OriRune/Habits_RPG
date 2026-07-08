import type { StateCreator } from 'zustand';
import type { BattleState, CombatAction } from '@/engine/combat';
import { createBattle } from '@/engine/combat';
import { bossForLevel } from '@/engine/bosses';
import type { GameState } from '../shared';
import {
  fighterFor,
  resolveBattleAction,
  cloneEarnings,
  applyReward,
  applyLevelUp,
  checkLevelUp,
} from '../shared';
import { freshEarningsLedger } from '@/engine/balance';

export interface BattleSlice {
  battle: BattleState | null;
  startBattle: () => void;
  battleAction: (action: CombatAction) => void;
  dismissBattle: () => void;
}

export const createBattleSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  BattleSlice
> = (set) => ({
  battle: null,

  startBattle: () =>
    set((s) => {
      if (!s.pendingLevelUp || s.battle) return s;
      const target = s.pendingLevelUp;
      const boss = bossForLevel(target);
      const battle = createBattle(fighterFor(s), boss, { lossesBefore: s.bossLosses[target] ?? 0 });
      return { battle };
    }),

  battleAction: (action) =>
    set((s) => {
      if (!s.battle || s.battle.status !== 'active') return s;
      return resolveBattleAction(s.battle, s, action);
    }),

  dismissBattle: () =>
    set((s) => {
      const battle = s.battle;
      if (!battle) return s;
      const target = s.pendingLevelUp;

      if (battle.status === 'won' && target) {
        const baseEarnings = s.earnings ?? freshEarningsLedger();
        const next: GameState = {
          ...s,
          character: { ...s.character, statXp: { ...s.character.statXp } },
          inventory: { ...s.inventory },
          materials: { ...s.materials },
          earnings: cloneEarnings(baseEarnings),
          codex: [...s.codex],
          battle: null,
          pendingLevelUp: null,
        };
        const boss = bossForLevel(target);
        applyReward(next, { gold: boss.rewards.gold, items: boss.rewards.items }, 'boss');
        applyLevelUp(next, target);
        checkLevelUp(next);
        return next;
      }

      if (battle.status === 'lost' && target) {
        return {
          battle: null,
          bossLosses: { ...s.bossLosses, [target]: (s.bossLosses[target] ?? 0) + 1 },
        };
      }
      return { battle: null };
    }),
});
