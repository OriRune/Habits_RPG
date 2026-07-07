import type { StateCreator } from 'zustand';
import {
  type Habit,
  resolveCompletion,
  effectiveStatus,
  currentStreak,
} from '@/engine/habits';
import { habitGold } from '@/engine/xp';
import { toISODate } from '@/engine/date';
import { challengeProgress, isExpired } from '@/engine/challenges';
import { gearXpMultiplier } from '@/engine/gear';
import type { GameState, NewHabitInput } from '../shared';
import {
  uid,
  gearFor,
  recomputeMood,
  recomputeHabitBonus,
  applyWeeklyRollover,
  checkLevelUp,
  MAX_ENERGY,
} from '../shared';
import { freshEarningsLedger } from '@/engine/balance';

/** Max number of habits that can be simultaneously marked as focus. */
export const MAX_FOCUS_HABITS = 3;

export interface HabitsSlice {
  habits: Habit[];
  completionLog: Record<string, number>;

  addHabit: (input: NewHabitInput) => void;
  updateHabit: (id: string, patch: Partial<NewHabitInput>) => void;
  removeHabit: (id: string) => void;
  retireHabit: (id: string) => void;
  reactivateHabit: (id: string) => void;
  suspendHabit: (id: string, untilISO: string) => void;
  /** Mark or unmark a habit as a weekly focus. Capped at MAX_FOCUS_HABITS; ignores if at cap and focus=true. */
  setHabitFocus: (id: string, focus: boolean) => void;
  /** Suspend every active habit whose id is NOT in keepIds, until untilISO. Recovery helper. */
  batchSuspendHabits: (keepIds: Set<string>, untilISO: string) => void;
  normalizeHabits: () => void;
  completeHabit: (id: string, actual?: number, dateISO?: string) => void;
  uncompleteHabit: (id: string, dateISO?: string) => void;
  /**
   * Merge an imported habit array into the live habits by id.
   * Replaces existing habits with the same id and appends new ones.
   * Recomputes `completionLog` from scratch over the merged set to prevent drift.
   */
  importHabits: (imported: Habit[]) => void;
}

export const createHabitsSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  HabitsSlice
> = (set) => ({
  habits: [],
  completionLog: {},

  addHabit: (input) =>
    set((s) => ({
      habits: [
        ...s.habits,
        {
          id: uid(),
          status: 'active',
          streak: 0,
          log: {},
          createdISO: toISODate(),
          ...input,
        },
      ],
    })),

  updateHabit: (id, patch) =>
    set((s) => ({
      habits: s.habits.map((h) => {
        if (h.id !== id) return h;
        // type is immutable post-creation — changing it would invalidate historical log entries.
        const { type: _ignored, ...safePatch } = patch;
        const updated: Habit = { ...h, ...safePatch };
        // Recompute streak: a frequency/days change shifts which days are "scheduled".
        updated.streak = currentStreak(updated, toISODate());
        return updated;
      }),
    })),

  removeHabit: (id) =>
    set((s) => ({ habits: s.habits.filter((h) => h.id !== id) })),

  retireHabit: (id) =>
    set((s) => ({
      habits: s.habits.map((h) =>
        h.id === id ? { ...h, status: 'retired' as const, suspendUntilISO: undefined } : h,
      ),
    })),

  reactivateHabit: (id) =>
    set((s) => ({
      habits: s.habits.map((h) =>
        h.id === id ? { ...h, status: 'active' as const, suspendUntilISO: undefined } : h,
      ),
    })),

  suspendHabit: (id, untilISO) =>
    set((s) => ({
      habits: s.habits.map((h) =>
        h.id === id ? { ...h, status: 'suspended' as const, suspendUntilISO: untilISO } : h,
      ),
    })),

  setHabitFocus: (id, focus) =>
    set((s) => {
      const focusCount = s.habits.filter((h) => h.focus && h.id !== id).length;
      if (focus && focusCount >= MAX_FOCUS_HABITS) return s; // cap reached
      return {
        habits: s.habits.map((h) => (h.id === id ? { ...h, focus } : h)),
      };
    }),

  batchSuspendHabits: (keepIds, untilISO) =>
    set((s) => ({
      habits: s.habits.map((h) => {
        if (keepIds.has(h.id)) return h;
        if (h.status !== 'active') return h;
        return { ...h, status: 'suspended' as const, suspendUntilISO: untilISO };
      }),
    })),

  normalizeHabits: () =>
    set((s) => {
      const today = toISODate();
      let changed = false;
      const habits = s.habits.map((h) => {
        let updated = h;
        // Auto-resume suspended habits whose date has passed.
        if (h.status === 'suspended' && effectiveStatus(h, today) === 'active') {
          changed = true;
          updated = { ...updated, status: 'active' as const, suspendUntilISO: undefined };
        }
        // Backfill fields that may be absent on habits loaded from old saves.
        if (updated.focus === undefined) {
          changed = true;
          updated = { ...updated, focus: false };
        }
        return updated;
      });
      // Always recompute habitBonus on mount so loaded saves have a current multiplier.
      const character = { ...s.character };
      recomputeHabitBonus(character, habits);
      const bonusChanged = character.habitBonus !== s.character.habitBonus;
      if (!changed && !bonusChanged) return s;
      return { habits, character };
    }),

  completeHabit: (id, actual, dateISO) =>
    set((s) => {
      const today = toISODate();
      const day = dateISO ?? today;
      const isToday = day === today;
      const habit = s.habits.find((h) => h.id === id);
      if (!habit) return s;
      if (habit.log[day] !== undefined) return s;
      if (effectiveStatus(habit, day) !== 'active') return s;

      const result = resolveCompletion(habit, day, { actual });
      const xp = Math.round(result.xp * gearXpMultiplier(gearFor(s), habit));
      const gold = habitGold(habit.difficulty);

      const baseEarnings = s.earnings ?? freshEarningsLedger();
      const next: GameState = {
        ...s,
        character: { ...s.character, statXp: { ...s.character.statXp } },
        inventory: { ...s.inventory },
        completionLog: { ...s.completionLog },
        earnings: {
          ...baseEarnings,
          xp: { ...baseEarnings.xp },
          gold: { ...baseEarnings.gold },
          count: { ...baseEarnings.count },
        },
        energyLog: { ...s.energyLog },
        habits: s.habits.map((h) => {
          if (h.id !== id) return h;
          const updated: Habit = {
            ...h,
            log: { ...h.log, [day]: { amount: actual, xp, gold } },
            lastCompletedISO: !h.lastCompletedISO || day > h.lastCompletedISO ? day : h.lastCompletedISO,
          };
          updated.streak = currentStreak(updated, today);
          return updated;
        }),
      };

      next.character.statXp[habit.stat] += xp;
      next.character.gold += gold;
      next.completionLog[day] = (next.completionLog[day] ?? 0) + 1;

      // Record to earnings ledger.
      next.earnings.xp['habit'] += xp;
      next.earnings.gold['habit'] += gold;
      next.earnings.count['habit'] += 1;

      next.challenges = s.challenges.map((c) => {
        if (c.status !== 'active') return c;
        if (isExpired(c, today)) return { ...c, status: 'expired' as const };
        const progress = challengeProgress(c.def, c.startISO, next.habits, today);
        const status = progress >= c.def.goal ? ('completed' as const) : c.status;
        return { ...c, progress, status };
      });

      if (isToday) {
        next.character.energy += 1;
        next.lastActiveISO = today;
        recomputeMood(next, today, result.recovery);
        applyWeeklyRollover(next, today);
        // Record energy earned today.
        next.earnings.energyEarned += 1;
        const todayEntry = next.energyLog[today] ?? { earned: 0, spent: 0 };
        next.energyLog[today] = { earned: todayEntry.earned + 1, spent: todayEntry.spent };
      }
      recomputeHabitBonus(next.character, next.habits);
      checkLevelUp(next);
      // Defensive ceiling: clamp energy regardless of code path (§4.3).
      next.character.energy = Math.max(0, Math.min(next.character.energy, MAX_ENERGY));
      return next;
    }),

  uncompleteHabit: (id, dateISO) =>
    set((s) => {
      const today = toISODate();
      const day = dateISO ?? today;
      const habit = s.habits.find((h) => h.id === id);
      if (!habit) return s;
      const entry = habit.log[day];
      if (entry === undefined) return s;

      const baseEarnings = s.earnings ?? freshEarningsLedger();
      const next: GameState = {
        ...s,
        character: { ...s.character, statXp: { ...s.character.statXp } },
        completionLog: { ...s.completionLog },
        earnings: {
          ...baseEarnings,
          xp: { ...baseEarnings.xp },
          gold: { ...baseEarnings.gold },
          count: { ...baseEarnings.count },
        },
        energyLog: { ...s.energyLog },
        habits: s.habits.map((h) => {
          if (h.id !== id) return h;
          const log = { ...h.log };
          delete log[day];
          const updated: Habit = { ...h, log };
          const keys = Object.keys(log).filter((k) => k <= today).sort();
          updated.lastCompletedISO = keys.length ? keys[keys.length - 1] : undefined;
          updated.streak = currentStreak(updated, today);
          return updated;
        }),
      };

      const refundXp = entry.xp ?? 0;
      const refundGold = entry.gold ?? 0;
      next.character.statXp[habit.stat] = Math.max(0, next.character.statXp[habit.stat] - refundXp);
      // Refund the gold stored on the entry (exact amount, so difficulty edits don't matter).
      next.character.gold = Math.max(0, next.character.gold - refundGold);
      const count = (next.completionLog[day] ?? 0) - 1;
      if (count > 0) next.completionLog[day] = count;
      else delete next.completionLog[day];

      // Reverse earnings ledger (clamp at 0 to guard against corrupt saves).
      next.earnings.xp['habit'] = Math.max(0, next.earnings.xp['habit'] - refundXp);
      next.earnings.gold['habit'] = Math.max(0, next.earnings.gold['habit'] - refundGold);
      next.earnings.count['habit'] = Math.max(0, next.earnings.count['habit'] - 1);

      // Refund the +1 energy that completeHabit awarded on today's completion.
      // Frozen days never awarded energy, so skip the refund for them.
      if (day === today && !entry.frozen && next.character.energy > 0) {
        next.character.energy -= 1;
        next.earnings.energyEarned = Math.max(0, next.earnings.energyEarned - 1);
        const todayEntry = next.energyLog[today] ?? { earned: 0, spent: 0 };
        next.energyLog[today] = { earned: Math.max(0, todayEntry.earned - 1), spent: todayEntry.spent };
      }

      next.challenges = s.challenges.map((c) => {
        if (c.status !== 'active') return c;
        if (isExpired(c, today)) return { ...c, status: 'expired' as const };
        const progress = challengeProgress(c.def, c.startISO, next.habits, today);
        return { ...c, progress };
      });

      recomputeHabitBonus(next.character, next.habits);
      // Defensive ceiling: mirrors completeHabit clamp (§4.3); purely defensive on uncomplete.
      next.character.energy = Math.max(0, Math.min(next.character.energy, MAX_ENERGY));
      return next;
    }),

  importHabits: (imported) =>
    set((s) => {
      // Merge by id: replace existing habits that share an id, append new ones.
      const byId = new Map(s.habits.map((h) => [h.id, h]));
      for (const h of imported) byId.set(h.id, h);
      const habits = [...byId.values()];
      // Recompute completionLog from the merged habit set to prevent drift.
      // Each habit.log entry represents one completion on that ISO date.
      const completionLog: Record<string, number> = {};
      for (const h of habits) {
        for (const iso of Object.keys(h.log)) {
          completionLog[iso] = (completionLog[iso] ?? 0) + 1;
        }
      }
      const character = { ...s.character };
      recomputeHabitBonus(character, habits);
      return { habits, completionLog, character };
    }),
});
