// Central game store (Zustand + localStorage persistence).
// Holds all persisted state and orchestrates the pure engine modules.
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';

import { emptyStatXP } from '@/engine/stats';
import { rebaseMineRun } from '@/engine/mining';
import { rebaseForestRun } from '@/engine/forest';
import { rebaseArenaRun } from '@/engine/arena';
import { freshTown } from '@/engine/town';
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
import { freshEarningsLedger } from '@/engine/balance';
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
import { createTownSlice } from './slices/townSlice';

// ---- Debounced persist storage (ARCH-07) ------------------------------------
// The default persist path JSON.stringifies the ENTIRE save and writes localStorage
// on every accepted store mutation — 8–20×/sec during minigame runs, and the cost
// grows with save age (habit logs, energyLog, live tile grids). We wrap the write in
// a trailing-debounce so the full serialize+write happens at most once per window.
// Run objects still persist (refresh-resume is intentional — see merge); we only
// coalesce the writes, we do NOT partialize them out.
//
// Data-safety contract — a debounce that drops its final write on tab-close would be
// a Phase-1-class save-loss regression. Two guarantees close that gap:
//   1. flush() runs on `pagehide` and `visibilitychange`→hidden, so the last write
//      always lands before the page goes away (the reliable pair; `beforeunload` is
//      intentionally skipped — it is unreliable on mobile).
//   2. cloudSave reads/writes the localStorage envelope directly (durableEnvelope,
//      pullCloudSave). It calls `flushPersistedSave()` before reading so it never
//      ships a stale envelope, and `cancelPersistedSave()` before it overwrites the
//      envelope with a cloud blob + rehydrate, so a queued stale write can't clobber
//      the freshly-pulled save.
const PERSIST_DEBOUNCE_MS = 1200;

type DebouncedStorage = {
  storage: PersistStorage<GameState>;
  flush: () => void;
  cancel: () => void;
};

function createDebouncedStorage(delayMs: number): DebouncedStorage {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { name: string; value: StorageValue<GameState> } | null = null;

  const flush = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (!pending) return;
    const { name, value } = pending;
    pending = null;
    try {
      localStorage.setItem(name, JSON.stringify(value));
    } catch {
      // Storage full / unavailable (private mode) — best effort, same as the default adapter.
    }
  };

  const cancel = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    pending = null;
  };

  const storage: PersistStorage<GameState> = {
    // Always read straight from localStorage — never a buffered `pending`. The only
    // readers are store init (nothing pending) and cloudSave's post-write rehydrate,
    // which has just written the authoritative envelope to localStorage and cancelled
    // any pending write; both want exactly what is in storage.
    getItem: (name) => {
      const raw = localStorage.getItem(name);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as StorageValue<GameState>;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending = { name, value };
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    removeItem: (name) => {
      if (pending?.name === name) cancel();
      try { localStorage.removeItem(name); } catch { /* ignore */ }
    },
  };

  return { storage, flush, cancel };
}

// Bound to the live singleton store in createGameStore(true). cloudSave imports these
// to keep the localStorage envelope authoritative across the debounce (see contract above).
let boundFlush: () => void = () => {};
let boundCancel: () => void = () => {};
/** Force the trailing-debounced save to localStorage now (e.g. before a cloud read). */
export function flushPersistedSave(): void { boundFlush(); }
/** Drop any queued debounced write WITHOUT flushing (before an authoritative envelope overwrite). */
export function cancelPersistedSave(): void { boundCancel(); }

/**
 * Builds a standalone store instance identical in shape to `useGameStore`.
 * Used by `useGameStore` itself, and by tests that need a pristine reference
 * state (e.g. asserting `resetGame()` deep-equals a freshly created store).
 *
 * `bindGlobalFlush` is set ONLY for the live singleton: it wires that instance's
 * debounced-write flush/cancel to the module-level `flushPersistedSave`/
 * `cancelPersistedSave` exports and registers the tab-close flush listeners. Test
 * instances stay isolated (their own debounce, no global side effects).
 */
export function createGameStore(bindGlobalFlush = false) {
  const debounced = createDebouncedStorage(PERSIST_DEBOUNCE_MS);
  if (bindGlobalFlush) {
    boundFlush = debounced.flush;
    boundCancel = debounced.cancel;
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', debounced.flush);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') debounced.flush();
      });
    }
  }
  return create<GameState>()(
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
      ...createTownSlice(set, get, api),
    }),
    {
      name: 'habits-rpg-save',
      version: 36,
      storage: debounced.storage,
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
      // v23: Party quest rewards — new `claimedPartyQuests` array (defaults to []) tracks
      //      quest IDs already credited locally, preventing double-credit across sessions.
      // v24: Focus habits — new `focus?: boolean` field on Habit (defaults to false/undefined
      //      for existing habits; capped at MAX_FOCUS_HABITS per account).
      // v25: Balance ledger — new `earnings` (EarningsLedger, zeroed) and `energyLog` ({}) fields
      //      track per-source XP/gold and per-day energy earned/spent from this version onward.
      // v26: First-run welcome card — new `hasSeenWelcome` boolean (false on fresh saves, stamped
      //      true on existing saves so veterans are never shown the card).
      // v27: Mine tombstone — new `mineTombstone` field (null on existing saves; set on death).
      // v28: Daily-reminder offer card — new `reminderCardDismissed` boolean (false on existing
      //      saves via merge, so veterans see the card once after a missed day if reminders are off).
      // v29: Economy-integrity markers — new optional Habit fields `lastEnergyGrantISO` and
      //      `lastMilestoneGrant` gate the once-per-day energy/milestone grants (HABIT-04/16 + the
      //      3.4 milestone claw-back). Absent on existing habits → treated as "not yet granted", so
      //      the first post-upgrade completion behaves exactly as before; no backfill needed.
      // v30: Minigame-trickle allocation ledger (BAL-09) — new Character fields `statXpTrickle` and
      //      `statXpTrickleAtLastLevel` let level-ups discount passive minigame XP when distributing
      //      stat points. Both backfill to zero on existing saves, so all accrued XP counts as
      //      full-weight until the next post-upgrade minigame run — no retroactive penalty. Leveling
      //      pace (driven by total statXp) is unchanged.
      // v31: Trial retry integrity (MINI-11) — new top-level `trialAttemptNonce` (monotonic
      //      counter XOR'd into the daily seed of the deterministic trials so abandon+reopen
      //      draws a fresh challenge). Backfills to 0 on existing saves via merge; a scalar,
      //      so the default `...p` merge carries it — no explicit merge line needed.
      // v32: Spirit Grove recall bias (MINI-16) — new top-level `spiritGroveSeen` (round ids the
      //      player has been shown; drafts bias toward unseen). Backfills to [] on existing saves;
      //      an array carried by the default merge, so no explicit merge line needed.
      // v33: Forge quality tiers (Phase 8, M1) — new top-level `gearQuality`/`weaponQuality`
      //      records (item key → CraftTier 0-3; absent key reads as Normal, so every existing
      //      item keeps its exact stats). Both backfill to {} via the default merge from the
      //      slice initial state — no explicit merge/migrate lines needed (v31/v32 precedent).
      // v34: The Homestead (Phase 10, M1) — new top-level `town` (`freshTown()` on existing
      //      saves via explicit migrate + nested-default merge, trialsClearedOn idiom, because
      //      TownState is a growing object whose later-version fields must backfill). The
      //      optional Habit field `lastLaborGrantISO` (M2) is absent ⇒ not yet granted — v29
      //      idiom, no backfill. NOT added to cloudSave TRANSIENT_KEYS: town rides the blob.
      // v35: Deep Mine daily first-descent bonus (3.8) — new top-level `mineDailyBonus`
      //      (`{date, floorsUsed} | null`) backfills to null on existing saves via merge — a
      //      simple nullable object, mineTombstone-idiom, no nested-default merge needed.
      // v36: Tactics bestiary (entry-screen "How to play") — new top-level `tacticsSeenFoes`
      //      (enemy templateIds the player has faced). Backfills to [] on existing saves via
      //      the default merge — spiritGroveSeen/v32 idiom, no explicit merge line needed.
      migrate: (persisted: unknown) => {
        const p = (persisted ?? {}) as Partial<GameState>;
        const habits = (p.habits ?? []).map((h) => {
          const log: Habit['log'] = h.log ?? {};
          if (h.lastCompletedISO && log[h.lastCompletedISO] === undefined) {
            log[h.lastCompletedISO] = { xp: 0 };
          }
          return { ...h, status: h.status ?? 'active', focus: h.focus ?? false, log } as Habit;
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
              // v30: zero-init the trickle sub-ledger — past XP counts full-weight (no retroactive penalty).
              statXpTrickle: p.character.statXpTrickle ?? emptyStatXP(),
              statXpTrickleAtLastLevel: p.character.statXpTrickleAtLastLevel ?? emptyStatXP(),
            }
          : p.character;
        return { ...p, habits, materials, challenges, character, battle: null, dungeon: null, mining: null, forest: null, arena: null, tactics: null, created: true, hasSeenWelcome: true, trialsClearedOn: p.trialsClearedOn ?? emptyTrialsClearedOn(), bestTrialScore: p.bestTrialScore ?? emptyBestTrialScore(), dungeonHistory: p.dungeonHistory ?? [], claimedPartyQuests: p.claimedPartyQuests ?? [], earnings: p.earnings ?? freshEarningsLedger(), energyLog: p.energyLog ?? {}, mineTombstone: p.mineTombstone ?? null, mineDailyBonus: p.mineDailyBonus ?? null, reminderCardDismissed: p.reminderCardDismissed ?? false, trialAttemptNonce: p.trialAttemptNonce ?? 0, spiritGroveSeen: p.spiritGroveSeen ?? [], town: p.town ?? freshTown() } as GameState;
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
          // Mine/forest/arena run timestamps are rAF-clock values (ms since page
          // load), so a run adopted from storage carries the *previous* session's
          // uptime — rebase them or the run stalls until the new clock catches up.
          mining:  current.mining  ?? (p.mining ? rebaseMineRun(p.mining) : null),
          forest:  current.forest  ?? (p.forest ? rebaseForestRun(p.forest) : null),
          arena:   current.arena   ?? (p.arena ? rebaseArenaRun(p.arena) : null),
          tactics: current.tactics ?? p.tactics ?? null,
          character: withCharacterDefaults(p.character),
          settings: { ...current.settings, ...(p.settings ?? {}) },
          trialsClearedOn: { ...emptyTrialsClearedOn(), ...(p.trialsClearedOn ?? {}) },
          bestTrialScore: { ...emptyBestTrialScore(), ...(p.bestTrialScore ?? {}) },
          town: { ...freshTown(), ...(p.town ?? {}) },
        };
      },
    },
  ),
  );
}

export const useGameStore = createGameStore(true);

/** Convenience export for the shop view. */
export const SHOP_ITEMS = Object.values(ITEMS).filter((i) => i.price !== undefined);
