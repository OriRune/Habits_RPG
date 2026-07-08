import type { StateCreator } from 'zustand';
import {
  type HexBattleState,
  type SelectedAction as TacticsAction,
  type TacticsSize,
  type HeroOpts,
  TACTICS_SIZE_RADIUS,
  generateSkirmish,
  selectAction as tacticsSelectFn,
  movePlayer as tacticsMoveFn,
  playerAttack as tacticsAttackFn,
  playerCastSpell as tacticsCastFn,
  endPlayerTurn as tacticsEndTurnFn,
  holdOverwatch as tacticsHoldFn,
  TACTICS_ENERGY_COST,
  TACTICS_UNLOCK_LEVEL,
} from '@/engine/hexBattle';
import { mulberry32 } from '@/engine/rng';
import { MAX_LEVEL } from '@/engine/progression';
import type { Hex } from '@/engine/hex';
import { applyTacticsState } from '@/net/coop/reduce';
import type { GameState } from '../shared';
import { fighterFor, commitTactics, energySpentPatch } from '../shared';

export type { TacticsSize, HeroOpts };

export interface TacticsSlice {
  tactics: HexBattleState | null;
  deepestTacticsTier: number;

  beginTactics: (loadout?: string[], chosenTier?: number) => void;
  tacticsSelect: (action: TacticsAction) => void;
  tacticsMove: (to: Hex) => void;
  tacticsAttack: (target: Hex) => void;
  tacticsCast: (spellKey: string, target: Hex | null) => void;
  tacticsEndTurn: () => void;
  tacticsHold: () => void;
  endTactics: () => void;
  coopApplyTactics: (state: HexBattleState) => void;
  beginTacticsCoop: (opts: { heroes: HeroOpts[]; seed?: number }) => void;
}

export const createTacticsSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  TacticsSlice
> = (set) => ({
  tactics: null,
  deepestTacticsTier: 0,

  beginTactics: (loadout, chosenTier) =>
    set((s) => {
      const free = s.settings.unlimitedEnergy;
      if (s.tactics || s.character.level < TACTICS_UNLOCK_LEVEL) return s;
      if (!free && s.character.energy < TACTICS_ENERGY_COST) return s;
      // Player-chosen difficulty tier, clamped to [unlock, character.level]; default = level.
      const tier = Math.max(TACTICS_UNLOCK_LEVEL, Math.min(s.character.level, chosenTier ?? s.character.level));
      const tactics = generateSkirmish(fighterFor(s), s.character.statLevels.AG, tier, loadout ?? s.knownSpells, {
        radius: TACTICS_SIZE_RADIUS[s.settings.tacticsSize],
        rng: Math.random,
      });
      // Dev invincibility, arena-style: captured at match start (solo only — never in co-op,
      // where the state broadcasts to other players).
      if (s.settings.invincible) tactics.invincible = true;
      return {
        character: {
          ...s.character,
          energy: free ? s.character.energy : s.character.energy - TACTICS_ENERGY_COST,
        },
        tactics,
        ...(free ? {} : energySpentPatch(s, TACTICS_ENERGY_COST)),
      };
    }),

  tacticsSelect: (action) =>
    set((s) => (s.tactics && s.tactics.status === 'active' ? { tactics: tacticsSelectFn(s.tactics, action) } : s)),

  tacticsMove: (to) =>
    set((s) => {
      if (!s.tactics || s.tactics.status !== 'active') return s;
      const tactics = tacticsMoveFn(s.tactics, to, s.tactics.activeHeroId);
      return tactics === s.tactics ? s : { tactics };
    }),

  tacticsAttack: (target) =>
    set((s) => {
      if (!s.tactics || s.tactics.status !== 'active') return s;
      const tactics = tacticsAttackFn(s.tactics, target, Math.random, s.tactics.activeHeroId);
      return tactics === s.tactics ? s : { tactics };
    }),

  tacticsCast: (spellKey, target) =>
    set((s) => {
      if (!s.tactics || s.tactics.status !== 'active') return s;
      const tactics = tacticsCastFn(s.tactics, spellKey, target, Math.random, s.tactics.activeHeroId);
      return tactics === s.tactics ? s : { tactics };
    }),

  tacticsEndTurn: () =>
    set((s) => {
      if (!s.tactics || s.tactics.status !== 'active') return s;
      const tactics = tacticsEndTurnFn(s.tactics, Math.random, s.tactics.activeHeroId);
      return tactics === s.tactics ? s : { tactics };
    }),

  tacticsHold: () =>
    set((s) => {
      if (!s.tactics || s.tactics.status !== 'active') return s;
      const tactics = tacticsHoldFn(s.tactics, Math.random, s.tactics.activeHeroId);
      return tactics === s.tactics ? s : { tactics };
    }),

  endTactics: () => set((s) => (s.tactics ? commitTactics(s, s.tactics) : s)),

  coopApplyTactics: (incoming) =>
    set((cur) => ({
      tactics: applyTacticsState(cur.tactics, incoming, incoming.activeHeroId ?? ''),
    })),

  beginTacticsCoop: ({ heroes, seed }) =>
    set((s) => {
      if (s.tactics) return s;
      const tier = Math.max(TACTICS_UNLOCK_LEVEL, Math.min(MAX_LEVEL, s.character.level));
      const tactics = generateSkirmish(fighterFor(s), s.character.statLevels.AG, tier, s.knownSpells, {
        radius: TACTICS_SIZE_RADIUS[s.settings.tacticsSize],
        rng: seed !== undefined ? mulberry32(seed) : Math.random,
        heroes,
      });
      return { tactics };
    }),
});
