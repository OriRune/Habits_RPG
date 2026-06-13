// Central game store (Zustand + localStorage persistence).
// Holds all persisted state and orchestrates the pure engine modules.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { type StatId, emptyStatXP } from '@/engine/stats';
import { type Difficulty } from '@/engine/xp';
import {
  type Habit,
  type HabitType,
  type Frequency,
  resolveCompletion,
  isDueOn,
} from '@/engine/habits';
import { toISODate, daysBetween } from '@/engine/date';
import { levelForTotalXp } from '@/engine/leveling';
import { assignClass, classFor, CLASS_UNLOCK_LEVEL } from '@/engine/classes';
import { bossForLevel } from '@/engine/bosses';
import {
  type BattleState,
  type CombatAction,
  deriveCombatant,
  createBattle,
  playerAction,
} from '@/engine/combat';
import { getItem, ITEMS } from '@/engine/items';
import {
  type ActiveChallenge,
  type Reward,
  CHALLENGE_TEMPLATES,
  challengeContribution,
  resolveChallenge,
  isExpired,
} from '@/engine/challenges';
import { type Mood, computeMood } from '@/engine/mood';

export interface Character {
  /** Committed level — only advances by winning a Level-Up Trial. */
  level: number;
  statXp: Record<StatId, number>;
  gold: number;
  energy: number;
  classId: string | null;
  mood: Mood;
}

export interface NewHabitInput {
  name: string;
  stat: StatId;
  type: HabitType;
  target?: number;
  unit?: string;
  frequency: Frequency;
  days?: number[];
  difficulty: Difficulty;
  tag?: string;
}

/** Pending class choice when level-10 stats tie (brief: "if tied, player chooses"). */
export interface PendingClassChoice {
  options: { primary: StatId; secondary: StatId; classId: string }[];
}

export interface GameState {
  habits: Habit[];
  character: Character;
  inventory: Record<string, number>;
  codex: string[];
  challenges: ActiveChallenge[];
  battle: BattleState | null;
  /** Target level the player is currently trying to reach (boss is live or pending). */
  pendingLevelUp: number | null;
  pendingClassChoice: PendingClassChoice | null;
  /** Boss losses per target level, drives anti-frustration scaling. */
  bossLosses: Record<number, number>;
  /** Date -> number of habit completions, powers mood + weekly views. */
  completionLog: Record<string, number>;
  lastActiveISO: string;

  // --- actions ---
  addHabit: (input: NewHabitInput) => void;
  updateHabit: (id: string, patch: Partial<NewHabitInput>) => void;
  removeHabit: (id: string) => void;
  completeHabit: (id: string, actual?: number) => void;

  startBattle: () => void;
  battleAction: (action: CombatAction) => void;
  dismissBattle: () => void;

  chooseClass: (primary: StatId, secondary: StatId) => void;

  startChallenge: (defId: string) => void;
  claimChallenge: (index: number) => void;

  buyItem: (itemKey: string) => void;
  useStreakFreeze: (habitId: string) => void;

  resetGame: () => void;
}

function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function freshCharacter(): Character {
  return {
    level: 1,
    statXp: emptyStatXP(),
    gold: 0,
    energy: 0,
    classId: null,
    mood: 'steady',
  };
}

export function totalXp(statXp: Record<StatId, number>): number {
  return (Object.values(statXp) as number[]).reduce((a, b) => a + b, 0);
}

function applyReward(state: GameState, reward: Reward): void {
  if (reward.gold) state.character.gold += reward.gold;
  if (reward.statXp) {
    for (const [stat, amt] of Object.entries(reward.statXp)) {
      state.character.statXp[stat as StatId] += amt ?? 0;
    }
  }
  if (reward.items) {
    for (const key of reward.items) {
      state.inventory[key] = (state.inventory[key] ?? 0) + 1;
    }
  }
}

/** Recompute mood from the last 7 days of activity. */
function recomputeMood(state: GameState, todayIso: string, recentlyRecovered: boolean): void {
  let completions = 0;
  for (const [iso, n] of Object.entries(state.completionLog)) {
    const ago = daysBetween(todayIso, iso);
    if (ago >= 0 && ago < 7) completions += n;
  }
  // Expected: due habit-days over the same window.
  let expected = 0;
  for (let d = 0; d < 7; d++) {
    const iso = isoDaysAgo(todayIso, d);
    expected += state.habits.filter((h) => isDueOn(h, iso)).length;
  }
  state.character.mood = computeMood(completions, expected, recentlyRecovered);
}

function isoDaysAgo(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d - days);
  return toISODate(dt);
}

/** After XP changes, queue a Level-Up Trial if the player is XP-eligible. */
function checkLevelUp(state: GameState): void {
  if (state.pendingLevelUp || state.battle) return;
  const eligible = levelForTotalXp(totalXp(state.character.statXp));
  if (eligible > state.character.level) {
    state.pendingLevelUp = state.character.level + 1;
  }
}

export const useGameStore = create<GameState>()(
  persist(
    (set) => ({
      habits: [],
      character: freshCharacter(),
      inventory: {},
      codex: [],
      challenges: [],
      battle: null,
      pendingLevelUp: null,
      pendingClassChoice: null,
      bossLosses: {},
      completionLog: {},
      lastActiveISO: toISODate(),

      addHabit: (input) =>
        set((s) => ({
          habits: [
            ...s.habits,
            {
              id: uid(),
              streak: 0,
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

      completeHabit: (id, actual) =>
        set((s) => {
          const today = toISODate();
          const habit = s.habits.find((h) => h.id === id);
          if (!habit) return s;
          if (habit.lastCompletedISO === today) return s; // already done today

          const result = resolveCompletion(habit, today, { actual });

          // Deep-ish clone of the slices we mutate.
          const next: GameState = {
            ...s,
            character: { ...s.character, statXp: { ...s.character.statXp } },
            inventory: { ...s.inventory },
            completionLog: { ...s.completionLog },
            habits: s.habits.map((h) =>
              h.id === id
                ? { ...h, streak: result.newStreak, lastCompletedISO: today }
                : h,
            ),
          };

          next.character.statXp[habit.stat] += result.xp;
          next.character.energy += 1;
          next.completionLog[today] = (next.completionLog[today] ?? 0) + 1;
          next.lastActiveISO = today;

          // Advance any active challenges this completion qualifies for.
          next.challenges = s.challenges.map((c) => {
            if (c.status !== 'active') return c;
            if (isExpired(c, today)) return { ...c, status: 'expired' as const };
            const add = challengeContribution(c.def, habit, actual);
            if (add <= 0) return c;
            const progress = c.progress + add;
            const status = progress >= c.def.goal ? ('completed' as const) : c.status;
            return { ...c, progress, status };
          });

          recomputeMood(next, today, result.recovery);
          checkLevelUp(next);
          return next;
        }),

      startBattle: () =>
        set((s) => {
          if (!s.pendingLevelUp || s.battle) return s;
          const target = s.pendingLevelUp;
          const player = deriveCombatant(s.character.statXp);
          const boss = bossForLevel(target);
          const battle = createBattle(player, boss, s.bossLosses[target] ?? 0);
          return { battle };
        }),

      battleAction: (action) =>
        set((s) => {
          if (!s.battle || s.battle.status !== 'active') return s;
          const player = deriveCombatant(s.character.statXp);
          const battle = playerAction(s.battle, player, action);

          // Item used mid-battle: decrement inventory immediately.
          const inventory = { ...s.inventory };
          if (action.kind === 'item' && (inventory[action.itemKey] ?? 0) > 0) {
            inventory[action.itemKey] -= 1;
          }

          return { battle, inventory };
        }),

      dismissBattle: () =>
        set((s) => {
          const battle = s.battle;
          if (!battle) return s;
          const target = s.pendingLevelUp;

          if (battle.status === 'won' && target) {
            const next: GameState = {
              ...s,
              character: { ...s.character, statXp: { ...s.character.statXp } },
              inventory: { ...s.inventory },
              codex: [...s.codex],
              battle: null,
              pendingLevelUp: null,
            };
            next.character.level = target;
            const boss = bossForLevel(target);
            applyReward(next, { gold: boss.rewards.gold, items: boss.rewards.items });

            // Class unlock at the milestone level (brief Section 6).
            if (target >= CLASS_UNLOCK_LEVEL && !next.character.classId) {
              const a = assignClass(next.character.statXp);
              if (a.ambiguous) {
                next.pendingClassChoice = buildClassChoice(next.character.statXp);
              } else {
                next.character.classId = a.classId;
                if (!next.codex.includes(a.classId)) next.codex.push(a.classId);
              }
            }
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

      chooseClass: (primary, secondary) =>
        set((s) => {
          const classId = classFor(primary, secondary);
          const codex = s.codex.includes(classId) ? s.codex : [...s.codex, classId];
          return {
            character: { ...s.character, classId },
            codex,
            pendingClassChoice: null,
          };
        }),

      startChallenge: (defId) =>
        set((s) => {
          const def = CHALLENGE_TEMPLATES.find((d) => d.id === defId);
          if (!def) return s;
          if (s.challenges.some((c) => c.def.id === defId && c.status === 'active')) return s;
          const active: ActiveChallenge = {
            def,
            startISO: toISODate(),
            progress: 0,
            status: 'active',
          };
          return { challenges: [...s.challenges, active] };
        }),

      claimChallenge: (index) =>
        set((s) => {
          const c = s.challenges[index];
          if (!c || (c.status !== 'completed' && c.status !== 'expired')) return s;
          const outcome = resolveChallenge(c);
          const next: GameState = {
            ...s,
            character: { ...s.character, statXp: { ...s.character.statXp } },
            inventory: { ...s.inventory },
            challenges: s.challenges.map((x, i) =>
              i === index ? { ...x, status: 'claimed' as const } : x,
            ),
          };
          if (outcome.reward) applyReward(next, outcome.reward);
          checkLevelUp(next);
          return next;
        }),

      buyItem: (itemKey) =>
        set((s) => {
          const item = getItem(itemKey);
          if (!item || item.price === undefined) return s;
          if (s.character.gold < item.price) return s;
          return {
            character: { ...s.character, gold: s.character.gold - item.price },
            inventory: { ...s.inventory, [itemKey]: (s.inventory[itemKey] ?? 0) + 1 },
          };
        }),

      useStreakFreeze: (habitId) =>
        set((s) => {
          if ((s.inventory['streak_freeze'] ?? 0) <= 0) return s;
          const habit = s.habits.find((h) => h.id === habitId);
          if (!habit) return s;
          // Mark today as "covered" so the streak survives a missed day.
          const today = toISODate();
          return {
            inventory: { ...s.inventory, streak_freeze: s.inventory['streak_freeze'] - 1 },
            habits: s.habits.map((h) =>
              h.id === habitId ? { ...h, lastCompletedISO: today } : h,
            ),
          };
        }),

      resetGame: () =>
        set(() => ({
          habits: [],
          character: freshCharacter(),
          inventory: {},
          codex: [],
          challenges: [],
          battle: null,
          pendingLevelUp: null,
          pendingClassChoice: null,
          bossLosses: {},
          completionLog: {},
          lastActiveISO: toISODate(),
        })),
    }),
    {
      name: 'habits-rpg-save',
      version: 1,
      // Persist data, not action functions (Zustand persists the whole state by
      // default; functions are stable from the creator so this is fine).
    },
  ),
);

function buildClassChoice(statXp: Record<StatId, number>): PendingClassChoice {
  // Offer the distinct top-tier pairings among the tied-highest stats.
  const sorted = (Object.entries(statXp) as [StatId, number][]).sort((a, b) => b[1] - a[1]);
  const topVal = sorted[0][1];
  const tied = sorted.filter(([, v]) => v === topVal).map(([s]) => s);
  const second = sorted.find(([s]) => !tied.includes(s));
  const options: PendingClassChoice['options'] = [];
  for (const p of tied) {
    for (const q of tied) {
      if (p === q) continue;
      options.push({ primary: p, secondary: q, classId: classFor(p, q) });
    }
    if (second) {
      options.push({ primary: p, secondary: second[0], classId: classFor(p, second[0]) });
    }
  }
  return { options };
}

/** Convenience export for the shop view. */
export const SHOP_ITEMS = Object.values(ITEMS).filter((i) => i.price !== undefined);
