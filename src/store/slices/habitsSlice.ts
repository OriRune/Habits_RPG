import type { StateCreator } from 'zustand';
import {
  type Habit,
  resolveCompletion,
  effectiveStatus,
  currentStreak,
} from '@/engine/habits';
import { toISODate } from '@/engine/date';
import { challengeProgress, isExpired } from '@/engine/challenges';
import { gearXpMultiplier } from '@/engine/gear';
import type { GameState, NewHabitInput } from '../shared';
import {
  uid,
  gearFor,
  recomputeMood,
  applyWeeklyRollover,
  checkLevelUp,
} from '../shared';

export interface HabitsSlice {
  habits: Habit[];
  completionLog: Record<string, number>;

  addHabit: (input: NewHabitInput) => void;
  updateHabit: (id: string, patch: Partial<NewHabitInput>) => void;
  removeHabit: (id: string) => void;
  retireHabit: (id: string) => void;
  reactivateHabit: (id: string) => void;
  suspendHabit: (id: string, untilISO: string) => void;
  normalizeHabits: () => void;
  completeHabit: (id: string, actual?: number, dateISO?: string) => void;
  uncompleteHabit: (id: string, dateISO?: string) => void;
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
      habits: s.habits.map((h) => (h.id === id ? { ...h, ...patch } : h)),
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

  normalizeHabits: () =>
    set((s) => {
      const today = toISODate();
      let changed = false;
      const habits = s.habits.map((h) => {
        if (h.status === 'suspended' && effectiveStatus(h, today) === 'active') {
          changed = true;
          return { ...h, status: 'active' as const, suspendUntilISO: undefined };
        }
        return h;
      });
      return changed ? { habits } : s;
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

      const next: GameState = {
        ...s,
        character: { ...s.character, statXp: { ...s.character.statXp } },
        inventory: { ...s.inventory },
        completionLog: { ...s.completionLog },
        habits: s.habits.map((h) => {
          if (h.id !== id) return h;
          const updated: Habit = {
            ...h,
            log: { ...h.log, [day]: { amount: actual, xp } },
            lastCompletedISO: !h.lastCompletedISO || day > h.lastCompletedISO ? day : h.lastCompletedISO,
          };
          updated.streak = currentStreak(updated, today);
          return updated;
        }),
      };

      next.character.statXp[habit.stat] += xp;
      next.completionLog[day] = (next.completionLog[day] ?? 0) + 1;

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
      }
      checkLevelUp(next);
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

      const next: GameState = {
        ...s,
        character: { ...s.character, statXp: { ...s.character.statXp } },
        completionLog: { ...s.completionLog },
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

      next.character.statXp[habit.stat] = Math.max(0, next.character.statXp[habit.stat] - entry.xp);
      const count = (next.completionLog[day] ?? 0) - 1;
      if (count > 0) next.completionLog[day] = count;
      else delete next.completionLog[day];

      next.challenges = s.challenges.map((c) => {
        if (c.status !== 'active') return c;
        if (isExpired(c, today)) return { ...c, status: 'expired' as const };
        const progress = challengeProgress(c.def, c.startISO, next.habits, today);
        return { ...c, progress };
      });

      return next;
    }),
});
