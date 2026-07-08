/**
 * Cross-domain barrel + a few pure store-side helpers for the game store.
 *
 * The bulk of what used to live here was split out along its seams (ARCH-10):
 *   - GameState + sub-interfaces + fresh* initializers → ./gameState (re-exported here)
 *   - reward/commit orchestration (fighterFor, applyReward, commitRun, wrappers…) → ./commit
 *     (re-exported here)
 *   - engine RULES (dungeon-run lifecycle, class-choice, habit-streak bonus, XP constants)
 *     → src/engine/ (dungeonRun, classes, habits, balance) — imported DIRECTLY by consumers,
 *     not re-exported here (the class-choice TYPE is the lone exception, re-exported below).
 * This file still hosts the small cross-domain helpers that don't fit those seams (mood/date,
 * custom-challenge description, class-stat, weekly rollover). Imports only from engine/ and
 * store/ — no net/ or react.
 */

import { type StatId, getStat } from '@/engine/stats';
import { computeMood } from '@/engine/mood';
import {
  type Habit,
  isScheduledOn,
  habitStreakBonus,
} from '@/engine/habits';
import { daysBetween, weekKey, addDays } from '@/engine/date';
import { rankStats, type PendingClassChoice } from '@/engine/classes';
// Re-export the class-choice type (now owned by engine/classes) so existing importers
// ('@/store/shared' → coreSlice, useGameStore re-export) keep resolving.
export type { PendingClassChoice };
import { buildWeeklyReport } from '@/engine/weekly';

// ---------------------------------------------------------------------------
// GameState shape + sub-interfaces + fresh* initializers (moved to ./gameState).
// Re-exported here so existing '@/store/shared' importers keep resolving; also
// imported below for local use by the helpers that stay in this file.
// ---------------------------------------------------------------------------
export type {
  Character,
  NewHabitInput,
  CustomChallengeDraft,
  GameSettings,
  DungeonRunSummary,
  GameState,
} from './gameState';
export { uid, freshCharacter, withCharacterDefaults, totalXp, freshSettings } from './gameState';
import type { Character, GameState, CustomChallengeDraft } from './gameState';


// ---------------------------------------------------------------------------
// Mood / date utilities
// ---------------------------------------------------------------------------

/** Recompute mood from the last 7 days of activity. */
export function recomputeMood(state: GameState, todayIso: string, recentlyRecovered: boolean): void {
  let completions = 0;
  for (const [iso, n] of Object.entries(state.completionLog)) {
    const ago = daysBetween(todayIso, iso);
    if (ago >= 0 && ago < 7) completions += n;
  }
  // Expected: scheduled habit-days over the same window (weekly/as-needed don't count,
  // so they never drag mood down).
  let expected = 0;
  for (let d = 0; d < 7; d++) {
    const iso = addDays(todayIso, -d);
    expected += state.habits.filter((h) => isScheduledOn(h, iso)).length;
  }
  state.character.mood = computeMood(completions, expected, recentlyRecovered);
}

/**
 * Recompute the habit-streak minigame-gold multiplier from the current active habits.
 * Mutates `character` in place (the store-side adapter — the multiplier RULE lives in
 * engine/habits.ts::habitStreakBonus). Called after any streak change and on app mount.
 */
export function recomputeHabitBonus(character: Character, habits: Habit[]): void {
  character.habitBonus = habitStreakBonus(habits);
}

// ---------------------------------------------------------------------------
// Challenge / class helpers
// ---------------------------------------------------------------------------

/** Auto-generated description for a custom challenge when the player leaves it blank. */
export function describeDraft(draft: CustomChallengeDraft): string {
  const where = draft.stat ? ` ${getStat(draft.stat).name}` : '';
  const span = `in ${draft.durationDays} day${draft.durationDays === 1 ? '' : 's'}`;
  switch (draft.kind) {
    case 'streak':
      return `Keep a ${draft.goal}-day${where} streak.`;
    case 'recovery':
      return `Bounce back ${draft.goal} times after a missed day.`;
    case 'class':
      return `Train${where || ' a stat'} on ${draft.goal} separate days ${span}.`;
    case 'quantity':
      return `Log ${draft.goal}${where} total ${span}.`;
    case 'rival':
      return `Beat last week's${where} tally.`;
    default:
      return `Complete ${draft.goal}${where} habits ${span}.`;
  }
}

/** The stat that anchors class challenges/rotation — the class's primary stat, or null pre-class. */
export function classStatOf(state: GameState): StatId | null {
  return state.character.classId ? rankStats(state.character.statXp)[0] : null;
}

/**
 * If the calendar has crossed into a new week, build the recap for the week we're leaving
 * and advance the sentinel. Mutates `state` in place (no-op within the same week).
 */
export function applyWeeklyRollover(state: GameState, todayIso: string): void {
  const current = weekKey(todayIso);
  if (current === state.lastWeekKey) return;
  state.pendingReport = buildWeeklyReport(
    state.lastWeekKey,
    state.habits,
    state.completionLog,
    state.challenges,
    state.character.mood,
  );
  state.lastWeekKey = current;
}

// ---------------------------------------------------------------------------
// Reward + run-commit orchestration (moved to ./commit — see ARCH-10). These take/return
// GameState, so they stay store-side. Re-exported so '@/store/shared' importers keep resolving.
// ---------------------------------------------------------------------------
export * from './commit';
