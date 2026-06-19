// Central game store (Zustand + localStorage persistence).
// Holds all persisted state and orchestrates the pure engine modules.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { emptyStatXP } from '@/engine/stats';
import type { Habit } from '@/engine/habits';
import { statLevelsFromXp } from '@/engine/progression';
import { ITEMS } from '@/engine/items';
import { type ChallengeDef, type ChallengeKind } from '@/engine/challenges';
export { type DungeonRun } from '@/engine/dungeonTypes';
export type {
  GameState,
  Character,
  NewHabitInput,
  PendingClassChoice,
  CustomChallengeDraft,
  GameSettings,
  DungeonRunSummary,
} from './shared';
export { fighterFor, withCharacterDefaults, totalXp } from './shared';

import {
  emptyTrialsClearedOn,
  emptyBestTrialScore,
} from '@/engine/trials/trials';
export { TRIALS_UNLOCK_LEVEL } from '@/engine/trials/trials';
import {
  type GameState,
  withCharacterDefaults,
} from './shared';

import { createTrialsSlice } from './slices/trialsSlice';
import { createSettingsSlice } from './slices/settingsSlice';
import { createBattleSlice } from './slices/battleSlice';
import { createHabitsSlice } from './slices/habitsSlice';
import { createEconomySlice } from './slices/economySlice';
import { createChallengesSlice } from './slices/challengesSlice';
import { createCoreSlice } from './slices/coreSlice';
import { createArenaSlice } from './slices/arenaSlice';
import { createTacticsSlice } from './slices/tacticsSlice';
import { createMiningSlice } from './slices/miningSlice';
import { createForestSlice } from './slices/forestSlice';
import { createDungeonSlice } from './slices/dungeonSlice';

export const useGameStore = create<GameState>()(
  persist(
    (set, get, api) => ({
      ...createTrialsSlice(set, get, api),
      ...createSettingsSlice(set, get, api),
      ...createBattleSlice(set, get, api),
      ...createHabitsSlice(set, get, api),
      ...createEconomySlice(set, get, api),
      ...createChallengesSlice(set, get, api),
      ...createCoreSlice(set, get, api),
      ...createArenaSlice(set, get, api),
      ...createTacticsSlice(set, get, api),
      ...createMiningSlice(set, get, api),
      ...createForestSlice(set, get, api),
      ...createDungeonSlice(set, get, api),
    }),
    {
      name: 'habits-rpg-save',
      version: 22,
      // v2: cleared stale battle/dungeon for the combat rework.
      // v3: habits gained status/log + new frequency/scoring fields.
      // v4: material set revamp — remap old material keys to the new ones so accrued
      //     materials survive; new equipment fields fall back to defaults on merge.
      // v5: dungeon reshaped into the endless-descent model — clear any in-progress run
      //     (dungeon: null below); all other save data is preserved.
      // v6: challenges gained `kind` (replacing `metric`) + the weekly loop. Backfill
      //     kind from the old metric; lastWeekKey/pendingReport/customChallenges fall back
      //     to initializer defaults on merge.
      // (developer `settings` added later — a new top-level field, also defaulted on merge.)
      // v7: stats rework — derive `statLevels` from the existing statXp ledger (old sqrt curve,
      //     so veterans keep their power) and snapshot `statXpAtLastLevel` to current statXp.
      // v8: dungeon relics — new DungeonRun fields (relics/pendingBoon); clear any in-progress
      //     run (dungeon: null below) so it regenerates with the new shape.
      // v9: branching floor map — DungeonRun swapped rooms/index for map/nodeId/choices/path;
      //     again cleared (dungeon: null) so an in-progress run regenerates.
      // v10: new room types (shrine/merchant/elite/rest) + DungeonRun.merchant; cleared so an
      //      in-progress run regenerates with the richer room variety.
      // v11: character-creation onboarding — any existing save already has a hero, so stamp
      //      `created: true` to skip the creation screen (new saves default to false).
      // v12: Deep Mine minigame — new top-level `mining`/`deepestMineFloor`; `mining` is cleared
      //      below (no in-progress run survives the upgrade) and `deepestMineFloor` defaults via merge.
      // v13: Wild Forest minigame — new top-level `forest`/`deepestForestStage`; `forest` is cleared
      //      below (no in-progress run survives the upgrade) and `deepestForestStage` defaults via merge.
      // v14: Arena minigame — new top-level `arena`/`deepestArenaTier`; `arena` is cleared below
      //      (no in-progress fight survives the upgrade) and `deepestArenaTier` defaults via merge.
      // v15: Skill Trials — new top-level `trialsClearedOn`/`bestTrialScore`; both default to
      //      their empty records via merge (no daily clears survive the upgrade — fair reset).
      // v16: Delve Phase 1 — BattleState gained enemyIntent/enemyGuardBonus/enemyEnrageBonus;
      //      clear any in-progress dungeon run so it regenerates with the new combat shape.
      // v17: Hex Tactics minigame — new top-level `tactics`/`deepestTacticsTier`; `tactics` is
      //      cleared below (no in-progress skirmish survives the upgrade) and `deepestTacticsTier`
      //      defaults via merge.
      // v18: Mine death penalty + run scoring — new scalar fields `bestMineScore`/`bestForestScore`
      //      default to 0 via merge; MineState and ForestState gained `score` but active runs are
      //      cleared below (mining: null, forest: null) so no migration of run-level `score` needed.
      // v19: In-run boons — MineState/ForestState gained `activeBoons`/`pendingBoonChoice`/
      //      `status:'choosing'`, but active runs are cleared (mining/forest → null) so no
      //      run-level migration needed; no new top-level persisted fields.
      // v20: Tactics Tier 2 — HexBattleState gained `objective`/`turnCount`/`overwatch` and
      //      PlayerUnit gained `overwatch`; active skirmish cleared (tactics → null) so no
      //      run-level migration needed.
      // v21: Co-op Hex Tactics — HexBattleState gained `players[]`/`activeHeroId`; active
      //      skirmish cleared (tactics → null) so no run-level migration needed.
      // v22: Dungeon run history — new `dungeonHistory` array (defaults to []); `deepestFloor`
      //      now also reset on character wipe (no migration needed — existing deepestFloor kept).
      migrate: (persisted: unknown) => {
        const p = (persisted ?? {}) as Partial<GameState>;
        const habits = (p.habits ?? []).map((h) => {
          const log: Habit['log'] = h.log ?? {};
          if (h.lastCompletedISO && log[h.lastCompletedISO] === undefined) {
            log[h.lastCompletedISO] = { xp: 0 };
          }
          return { ...h, status: h.status ?? 'active', log } as Habit;
        });
        const RENAME: Record<string, string> = { iron: 'iron_bar', cloth: 'cloth_roll', herb: 'herbs', essence: 'crystals' };
        const materials: Record<string, number> = {};
        for (const [key, qty] of Object.entries(p.materials ?? {})) {
          const k = RENAME[key] ?? key;
          materials[k] = (materials[k] ?? 0) + (qty as number);
        }
        const challenges = (p.challenges ?? []).map((c) => {
          const def = c.def as ChallengeDef & { metric?: ChallengeKind };
          if (def.kind) return c;
          return { ...c, def: { ...def, kind: def.metric ?? 'count' } as ChallengeDef };
        });
        const character = p.character
          ? {
              ...p.character,
              statLevels: p.character.statLevels ?? statLevelsFromXp(p.character.statXp ?? emptyStatXP()),
              statXpAtLastLevel: p.character.statXpAtLastLevel ?? { ...(p.character.statXp ?? emptyStatXP()) },
            }
          : p.character;
        return { ...p, habits, materials, challenges, character, battle: null, dungeon: null, mining: null, forest: null, arena: null, tactics: null, created: true, trialsClearedOn: p.trialsClearedOn ?? emptyTrialsClearedOn(), bestTrialScore: p.bestTrialScore ?? emptyBestTrialScore(), dungeonHistory: p.dungeonHistory ?? [] } as GameState;
      },
      // Deep-merge the nested `character`/`settings` objects so fields added in later versions
      // (e.g. statLevels) always fall back to their defaults instead of being dropped by the
      // default shallow merge — which would replace the whole object and crash the UI.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<GameState>;
        return {
          ...current,
          ...p,
          // If a rehydrate fires while a transient run is live in memory (e.g. from
          // a cloud-save CAS-conflict re-pull), preserve the in-progress run rather
          // than overwriting it with a stale snapshot from storage.  At startup all
          // transient fields are null in `current`, so this is a no-op on first load.
          battle:  current.battle  ?? p.battle  ?? null,
          dungeon: current.dungeon ?? p.dungeon ?? null,
          mining:  current.mining  ?? p.mining  ?? null,
          forest:  current.forest  ?? p.forest  ?? null,
          arena:   current.arena   ?? p.arena   ?? null,
          tactics: current.tactics ?? p.tactics ?? null,
          character: withCharacterDefaults(p.character),
          settings: { ...current.settings, ...(p.settings ?? {}) },
          trialsClearedOn: { ...emptyTrialsClearedOn(), ...(p.trialsClearedOn ?? {}) },
          bestTrialScore: { ...emptyBestTrialScore(), ...(p.bestTrialScore ?? {}) },
        };
      },
    },
  ),
);

/** Convenience export for the shop view. */
export const SHOP_ITEMS = Object.values(ITEMS).filter((i) => i.price !== undefined);
