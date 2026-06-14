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
  isScheduledOn,
  effectiveStatus,
  currentStreak,
} from '@/engine/habits';
import { toISODate, daysBetween } from '@/engine/date';
import { levelForTotalXp } from '@/engine/leveling';
import { assignClass, classFor, CLASS_UNLOCK_LEVEL } from '@/engine/classes';
import { bossForLevel } from '@/engine/bosses';
import {
  type BattleState,
  type CombatAction,
  type Fighter,
  deriveCombatant,
  createBattle,
  playerAction,
} from '@/engine/combat';
import { getWeapon, STARTER_WEAPON, WEAPONS } from '@/engine/weapons';
import { STARTER_SPELLS } from '@/engine/spells';
import { type CombatStats, emptyCombatStats, combatXpForWin } from '@/engine/combatStats';
import { type GearDef, type GearSlot, getGear, aggregateGear, gearXpMultiplier } from '@/engine/gear';
import { getRecipe, canCraft } from '@/engine/crafting';
import { getItem, ITEMS } from '@/engine/items';
import {
  type ActiveChallenge,
  type Reward,
  CHALLENGE_TEMPLATES,
  challengeContribution,
  resolveChallenge,
  isExpired,
} from '@/engine/challenges';
import {
  type DungeonRoom,
  type RoomResolution,
  generateDungeon,
  resolveStatRoom,
  mergeReward,
  DUNGEON_ENERGY_COST,
} from '@/engine/dungeon';
import { enemyFor } from '@/engine/enemies';
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
  uncapped?: boolean;
  frequency: Frequency;
  days?: number[];
  timesPerWeek?: number;
  difficulty: Difficulty;
  tag?: string;
}

/** Pending class choice when level-10 stats tie (brief: "if tied, player chooses"). */
export interface PendingClassChoice {
  options: { primary: StatId; secondary: StatId; classId: string }[];
}

/** An in-progress Dungeon Expedition (brief §7.2). Persisted so a run resumes on reload. */
export interface DungeonRun {
  rooms: DungeonRoom[];
  index: number;
  hp: number;
  maxHp: number;
  /** Mana, persisted across rooms (partial regen each room, full at Rest). */
  mp: number;
  maxMp: number;
  /** Loot accumulated so far; applied on collect. */
  reward: Reward;
  /** Result of the most recent stat/rest room, shown before advancing. */
  lastResult: RoomResolution | null;
  /** Active combat for a combat room (reuses the combat engine). */
  battle: BattleState | null;
  status: 'active' | 'ended';
  /** True when the run reached the end alive (vs. ended by defeat). */
  cleared: boolean;
}

export interface GameState {
  habits: Habit[];
  character: Character;
  inventory: Record<string, number>;
  /** Crafting materials, keyed by material id (see engine/materials.ts). */
  materials: Record<string, number>;
  /** Spells the character knows (combat). Starts with the starter spells. */
  knownSpells: string[];
  /** Equipped weapon key (decides the Attack action's stat + bonus). */
  equippedWeapon: string;
  /** Weapon keys the character owns (equippable). */
  ownedWeapons: string[];
  /** Gear keys the character owns (equippable into the slots below). */
  ownedGear: string[];
  /** Equipped gear per slot (armor/trinket/tool). Weapon is `equippedWeapon` above. */
  equipment: Record<GearSlot, string | null>;
  /** Combat-trained stats (Defense/Ward) — earned in dungeons, not from habits. */
  combatStats: CombatStats;
  codex: string[];
  challenges: ActiveChallenge[];
  battle: BattleState | null;
  dungeon: DungeonRun | null;
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
  retireHabit: (id: string) => void;
  reactivateHabit: (id: string) => void;
  suspendHabit: (id: string, untilISO: string) => void;
  /** Flip any suspensions whose date has passed back to active (call on mount). */
  normalizeHabits: () => void;

  startBattle: () => void;
  battleAction: (action: CombatAction) => void;
  dismissBattle: () => void;

  chooseClass: (primary: StatId, secondary: StatId) => void;

  startChallenge: (defId: string) => void;
  claimChallenge: (index: number) => void;

  buyItem: (itemKey: string) => void;
  useStreakFreeze: (habitId: string) => void;

  equipWeapon: (weaponKey: string) => void;
  buyWeapon: (weaponKey: string) => void;
  learnFromSpellbook: (itemKey: string) => void;
  craft: (recipeKey: string) => void;
  equipGear: (gearKey: string) => void;
  unequipGear: (slot: GearSlot) => void;

  startDungeon: () => void;
  dungeonResolveRoom: () => void;
  dungeonBattleAction: (action: CombatAction) => void;
  dungeonAdvance: () => void;
  collectDungeon: () => void;

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
  if (reward.materials) {
    for (const [key, amt] of Object.entries(reward.materials)) {
      state.materials[key] = (state.materials[key] ?? 0) + (amt ?? 0);
    }
  }
  if (reward.weapons) {
    for (const key of reward.weapons) {
      if (!state.ownedWeapons.includes(key)) state.ownedWeapons.push(key);
    }
  }
  if (reward.gear) {
    for (const key of reward.gear) {
      if (!state.ownedGear.includes(key)) state.ownedGear.push(key);
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
  // Expected: scheduled habit-days over the same window (weekly/as-needed don't count,
  // so they never drag mood down).
  let expected = 0;
  for (let d = 0; d < 7; d++) {
    const iso = isoDaysAgo(todayIso, d);
    expected += state.habits.filter((h) => isScheduledOn(h, iso)).length;
  }
  state.character.mood = computeMood(completions, expected, recentlyRecovered);
}

function isoDaysAgo(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d - days);
  return toISODate(dt);
}

/** Equipped gear pieces (skips empty slots). */
function gearFor(state: GameState): GearDef[] {
  return (Object.values(state.equipment) as (string | null)[])
    .map((key) => (key ? getGear(key) : undefined))
    .filter((g): g is GearDef => g !== undefined);
}

function gearBonuses(state: GameState) {
  return aggregateGear(gearFor(state));
}

/** Build the acting Fighter from current character state (+ optional in-battle buffs). */
function fighterFor(state: GameState, buffs: Partial<Record<StatId, number>> = {}): Fighter {
  const gear = gearBonuses(state);
  // Fold gear stat bonuses into the buffs map deriveCombatant already understands.
  const merged: Partial<Record<StatId, number>> = { ...buffs };
  for (const [stat, n] of Object.entries(gear.statBonuses)) {
    merged[stat as StatId] = (merged[stat as StatId] ?? 0) + (n ?? 0);
  }
  const c = deriveCombatant(state.character.statXp, state.combatStats, merged);
  c.defense += gear.defense;
  c.ward += gear.ward;
  return { c, weapon: getWeapon(state.equippedWeapon) };
}

/** Set up the run's current room — spawns a seeded combat for combat rooms. */
function enterRoom(run: DungeonRun, state: GameState): void {
  const room = run.rooms[run.index];
  run.lastResult = null;
  if (room.type === 'combat') {
    const fighter = fighterFor(state);
    run.battle = createBattle(fighter, enemyFor(run.index, state.character.level), {
      startingHp: run.hp,
      startingMp: run.mp,
    });
  } else {
    run.battle = null;
  }
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
      materials: {},
      knownSpells: [...STARTER_SPELLS],
      equippedWeapon: STARTER_WEAPON,
      ownedWeapons: [STARTER_WEAPON],
      ownedGear: [],
      equipment: { armor: null, trinket: null, tool: null },
      combatStats: emptyCombatStats(),
      codex: [],
      challenges: [],
      battle: null,
      dungeon: null,
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

      completeHabit: (id, actual) =>
        set((s) => {
          const today = toISODate();
          const habit = s.habits.find((h) => h.id === id);
          if (!habit) return s;
          if (habit.log[today] !== undefined) return s; // already done today
          if (effectiveStatus(habit, today) !== 'active') return s; // retired/suspended

          const result = resolveCompletion(habit, today, { actual });
          // Equipped gear can boost XP for matching habits (tag/stat perks).
          const xp = Math.round(result.xp * gearXpMultiplier(gearFor(s), habit));

          // Deep-ish clone of the slices we mutate.
          const next: GameState = {
            ...s,
            character: { ...s.character, statXp: { ...s.character.statXp } },
            inventory: { ...s.inventory },
            completionLog: { ...s.completionLog },
            habits: s.habits.map((h) => {
              if (h.id !== id) return h;
              const updated: Habit = {
                ...h,
                log: { ...h.log, [today]: { amount: actual, xp } },
                lastCompletedISO: today,
              };
              updated.streak = currentStreak(updated, today);
              return updated;
            }),
          };

          next.character.statXp[habit.stat] += xp;
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
          const boss = bossForLevel(target);
          const battle = createBattle(fighterFor(s), boss, { lossesBefore: s.bossLosses[target] ?? 0 });
          return { battle };
        }),

      battleAction: (action) =>
        set((s) => {
          if (!s.battle || s.battle.status !== 'active') return s;
          const battle = playerAction(s.battle, fighterFor(s, s.battle.buffs), action);

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
              materials: { ...s.materials },
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
            materials: { ...s.materials },
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

      equipWeapon: (weaponKey) =>
        set((s) => {
          if (!s.ownedWeapons.includes(weaponKey)) return s;
          return { equippedWeapon: weaponKey };
        }),

      buyWeapon: (weaponKey) =>
        set((s) => {
          const weapon = WEAPONS[weaponKey];
          if (!weapon || weapon.price === undefined) return s;
          if (s.ownedWeapons.includes(weaponKey)) return s;
          if (s.character.gold < weapon.price) return s;
          return {
            character: { ...s.character, gold: s.character.gold - weapon.price },
            ownedWeapons: [...s.ownedWeapons, weaponKey],
          };
        }),

      learnFromSpellbook: (itemKey) =>
        set((s) => {
          const item = getItem(itemKey);
          const spellKey = item?.effect.learnsSpell;
          if (!spellKey || (s.inventory[itemKey] ?? 0) <= 0) return s;
          const inventory = { ...s.inventory, [itemKey]: s.inventory[itemKey] - 1 };
          const knownSpells = s.knownSpells.includes(spellKey)
            ? s.knownSpells
            : [...s.knownSpells, spellKey];
          return { inventory, knownSpells };
        }),

      craft: (recipeKey) =>
        set((s) => {
          const recipe = getRecipe(recipeKey);
          if (!recipe || !canCraft(recipe, s.materials, s.character.gold)) return s;
          const materials = { ...s.materials };
          for (const [key, qty] of Object.entries(recipe.materials)) {
            materials[key] = (materials[key] ?? 0) - qty;
          }
          const gold = s.character.gold - (recipe.gold ?? 0);
          const { kind, key } = recipe.result;
          const next: Partial<GameState> = { materials, character: { ...s.character, gold } };
          if (kind === 'gear') {
            next.ownedGear = s.ownedGear.includes(key) ? s.ownedGear : [...s.ownedGear, key];
          } else if (kind === 'weapon') {
            next.ownedWeapons = s.ownedWeapons.includes(key) ? s.ownedWeapons : [...s.ownedWeapons, key];
          } else {
            next.inventory = { ...s.inventory, [key]: (s.inventory[key] ?? 0) + 1 };
          }
          return next;
        }),

      equipGear: (gearKey) =>
        set((s) => {
          const gear = getGear(gearKey);
          if (!gear || !s.ownedGear.includes(gearKey)) return s;
          return { equipment: { ...s.equipment, [gear.slot]: gearKey } };
        }),

      unequipGear: (slot) =>
        set((s) => ({ equipment: { ...s.equipment, [slot]: null } })),

      startDungeon: () =>
        set((s) => {
          if (s.dungeon || s.character.energy < DUNGEON_ENERGY_COST) return s;
          const rooms = generateDungeon();
          const { c } = fighterFor(s);
          const run: DungeonRun = {
            rooms,
            index: 0,
            hp: c.maxHp,
            maxHp: c.maxHp,
            mp: c.maxMp,
            maxMp: c.maxMp,
            reward: {},
            lastResult: null,
            battle: null,
            status: 'active',
            cleared: false,
          };
          enterRoom(run, s);
          return {
            character: { ...s.character, energy: s.character.energy - DUNGEON_ENERGY_COST },
            dungeon: run,
          };
        }),

      dungeonResolveRoom: () =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active' || run.lastResult) return s;
          const room = run.rooms[run.index];
          if (room.type === 'combat') return s; // resolved via combat, not a stat check

          const res = resolveStatRoom(room, s.character.statXp, run.maxHp, Math.random, gearBonuses(s).statBonuses);
          const hp = Math.max(0, Math.min(run.maxHp, run.hp + res.hpDelta));
          // Rest rooms also restore Mana to full.
          const mp = room.type === 'rest' ? run.maxMp : run.mp;
          const next: DungeonRun = {
            ...run,
            hp,
            mp,
            reward: mergeReward(run.reward, res.reward),
            lastResult: res,
          };
          if (hp <= 0) {
            next.status = 'ended';
            next.cleared = false;
          }
          return { dungeon: next };
        }),

      dungeonBattleAction: (action) =>
        set((s) => {
          const run = s.dungeon;
          if (!run || !run.battle || run.battle.status !== 'active') return s;
          const battle = playerAction(run.battle, fighterFor(s, run.battle.buffs), action);

          const inventory = { ...s.inventory };
          if (action.kind === 'item' && (inventory[action.itemKey] ?? 0) > 0) {
            inventory[action.itemKey] -= 1;
          }
          return { dungeon: { ...run, battle }, inventory };
        }),

      dungeonAdvance: () =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active') return s;
          const room = run.rooms[run.index];

          let hp = run.hp;
          let mp = run.mp;
          let combatStats: CombatStats | null = null;

          if (room.type === 'combat') {
            const b = run.battle;
            if (!b || b.status === 'active') return s; // can't leave mid-fight
            if (b.status === 'fled') {
              // Escaped: a safe retreat, keep the loot gathered so far.
              return { dungeon: { ...run, status: 'ended', cleared: false, hp: b.playerHp } };
            }
            if (b.status === 'lost') {
              return { dungeon: { ...run, status: 'ended', cleared: false, hp: 0 } };
            }
            // Won: carry HP/MP forward and train a combat stat (caster → Ward, else Defense).
            hp = b.playerHp;
            mp = b.playerMp;
            const xp = combatXpForWin(b.bossMaxHp);
            combatStats =
              b.attackSchool === 'magic'
                ? { ...s.combatStats, wardXp: s.combatStats.wardXp + xp }
                : { ...s.combatStats, defenseXp: s.combatStats.defenseXp + xp };
          } else if (!run.lastResult) {
            return s; // stat room not yet resolved
          }

          // Partial mana regen when pressing onward.
          mp = Math.min(run.maxMp, mp + Math.round(run.maxMp * 0.15));

          const nextIndex = run.index + 1;
          const next: DungeonRun = { ...run, index: nextIndex, hp, mp, battle: null, lastResult: null };
          if (nextIndex >= run.rooms.length) {
            next.status = 'ended';
            next.cleared = true;
          } else {
            enterRoom(next, combatStats ? { ...s, combatStats } : s);
          }
          return combatStats ? { dungeon: next, combatStats } : { dungeon: next };
        }),

      collectDungeon: () =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'ended') return s;
          const next: GameState = {
            ...s,
            character: { ...s.character, statXp: { ...s.character.statXp } },
            inventory: { ...s.inventory },
            materials: { ...s.materials },
            dungeon: null,
          };
          applyReward(next, run.reward); // gold/materials/items only — dungeons grant no XP
          return next;
        }),

      resetGame: () =>
        set(() => ({
          habits: [],
          character: freshCharacter(),
          inventory: {},
          materials: {},
          knownSpells: [...STARTER_SPELLS],
          equippedWeapon: STARTER_WEAPON,
          ownedWeapons: [STARTER_WEAPON],
          combatStats: emptyCombatStats(),
          codex: [],
          challenges: [],
          battle: null,
          dungeon: null,
          pendingLevelUp: null,
          pendingClassChoice: null,
          bossLosses: {},
          completionLog: {},
          lastActiveISO: toISODate(),
        })),
    }),
    {
      name: 'habits-rpg-save',
      version: 4,
      // v2: cleared stale battle/dungeon for the combat rework.
      // v3: habits gained status/log + new frequency/scoring fields.
      // v4: material set revamp — remap old material keys to the new ones so accrued
      //     materials survive; new equipment fields fall back to defaults on merge.
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
        return { ...p, habits, materials, battle: null, dungeon: null } as GameState;
      },
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
