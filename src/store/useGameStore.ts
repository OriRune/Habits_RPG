// Central game store (Zustand + localStorage persistence).
// Holds all persisted state and orchestrates the pure engine modules.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { type StatId, STAT_IDS, emptyStatXP, getStat } from '@/engine/stats';
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
import { toISODate, daysBetween, weekKey, addDays } from '@/engine/date';
import { levelForTotalXp } from '@/engine/leveling';
import {
  allocateStatGains,
  emptyStatLevels,
  statLevelsFromXp,
  POINTS_PER_LEVEL,
  MAX_LEVEL,
  BOSS_GATE_LEVEL,
} from '@/engine/progression';
import { assignClass, classFor, rankStats, CLASS_UNLOCK_LEVEL } from '@/engine/classes';
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
  type ChallengeDef,
  type ChallengeKind,
  type Reward,
  CHALLENGE_TEMPLATES,
  challengeProgress,
  resolveChallenge,
  suggestReward,
  rivalGoal,
  isExpired,
} from '@/engine/challenges';
import { type WeeklyReport, buildWeeklyReport, weeklyRotation } from '@/engine/weekly';
import {
  type DungeonRoom,
  generateFloor,
  resolveTreasure,
  mergeReward,
  scaleReward,
  DUNGEON_ENERGY_COST,
} from '@/engine/dungeon';
import { biomeForDepth, getBiome, bossFor } from '@/engine/biomes';
import {
  type EncounterRunState,
  getEncounter,
  startEncounter,
  chooseEncounter,
} from '@/engine/encounters';
import { enemyFor } from '@/engine/enemies';
import { type Mood, computeMood } from '@/engine/mood';

export interface Character {
  /** Committed level. Levels 1→4 advance automatically; 5+ require a Level-Up Trial win. */
  level: number;
  /** Effort ledger — habits/challenges/dungeons add XP; its sum drives the character level. */
  statXp: Record<StatId, number>;
  /** Actual stat values used by combat and checks. Granted on level-up, frozen between. */
  statLevels: Record<StatId, number>;
  /** Snapshot of statXp at the last level-up, so a level-up can see recent per-stat effort. */
  statXpAtLastLevel: Record<StatId, number>;
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

/** Player-authored challenge form (challenge builder). Reward is auto-suggested unless overridden. */
export interface CustomChallengeDraft {
  name: string;
  description?: string;
  kind: ChallengeKind;
  stat?: StatId;
  tag?: string;
  goal: number;
  durationDays: number;
}

/** An in-progress Dungeon Expedition (brief §7.2) — an endless descent through floors.
 *  Persisted so a run resumes on reload. */
export interface DungeonRun {
  /** Current floor number (1-based); drives biome + difficulty scaling. */
  depth: number;
  biomeKey: string;
  /** The current floor's rooms. */
  rooms: DungeonRoom[];
  index: number;
  hp: number;
  maxHp: number;
  /** Mana + Stamina, persisted across rooms; restored to full at each checkpoint. */
  mp: number;
  maxMp: number;
  sta: number;
  maxSta: number;
  /** Loot locked in at the last checkpoint — safe even if you fall. */
  bankedReward: Reward;
  /** Loot gathered on the current floor — partly forfeit if you fall mid-floor. */
  floorReward: Reward;
  /** Active branching text encounter (encounter rooms). */
  encounter: EncounterRunState | null;
  /** Loot revealed in a treasure room, shown before continuing. */
  roomLoot: Reward | null;
  /** Active combat for a combat/boss room (reuses the combat engine). */
  battle: BattleState | null;
  /** True between floors: the player chooses to Bank & Leave or Descend Deeper. */
  atCheckpoint: boolean;
  status: 'active' | 'ended';
  /** True when the run ended by banking (vs. ended by defeat). */
  cleared: boolean;
}

/** Share of the current floor's loot kept when you fall mid-floor (the rest is forfeit). */
const FLOOR_LOSS_KEEP = 0.25;

/** Developer "creative mode" switches (Settings → Developer). All off in normal play. */
export interface GameSettings {
  /** Purchases & crafting ignore their gold cost. */
  unlimitedGold: boolean;
  /** Dungeon entry ignores its energy cost. */
  unlimitedEnergy: boolean;
  /** Player HP/MP/Stamina stay full in combat — you can't die. */
  invincible: boolean;
}

function freshSettings(): GameSettings {
  return { unlimitedGold: false, unlimitedEnergy: false, invincible: false };
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
  /** Player-authored challenge templates (challenge builder). */
  customChallenges: ChallengeDef[];
  /** weekKey of the last processed week — the rollover sentinel for the weekly loop. */
  lastWeekKey: string;
  /** Set on week rollover; the weekly recap modal shows it, then it's dismissed. */
  pendingReport: WeeklyReport | null;
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
  /** Developer creative-mode switches. */
  settings: GameSettings;

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
  createCustomChallenge: (draft: CustomChallengeDraft, rewardOverride?: Reward) => void;
  deleteCustomChallenge: (id: string) => void;
  /** Detect a week boundary and surface the weekly report (call on mount). */
  checkWeeklyRollover: () => void;
  dismissWeeklyReport: () => void;

  buyItem: (itemKey: string) => void;
  useStreakFreeze: (habitId: string) => void;

  equipWeapon: (weaponKey: string) => void;
  buyWeapon: (weaponKey: string) => void;
  learnFromSpellbook: (itemKey: string) => void;
  craft: (recipeKey: string) => void;
  equipGear: (gearKey: string) => void;
  unequipGear: (slot: GearSlot) => void;

  startDungeon: () => void;
  dungeonEncounterChoose: (choiceIndex: number) => void;
  dungeonBattleAction: (action: CombatAction) => void;
  dungeonAdvance: () => void;
  dungeonBank: () => void;
  dungeonDescend: () => void;
  collectDungeon: () => void;

  updateSettings: (patch: Partial<GameSettings>) => void;

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
    statLevels: emptyStatLevels(),
    statXpAtLastLevel: emptyStatXP(),
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
  const c = deriveCombatant(state.character.statLevels, state.character.level, state.combatStats, merged);
  c.defense += gear.defense;
  c.ward += gear.ward;
  return { c, weapon: getWeapon(state.equippedWeapon) };
}

/** Set up the run's current room — seeds combat/boss fights and branching encounters. */
function enterRoom(run: DungeonRun, state: GameState): void {
  const room = run.rooms[run.index];
  run.battle = null;
  run.encounter = null;
  run.roomLoot = null;
  const biome = getBiome(run.biomeKey);
  if (room.type === 'combat') {
    run.battle = createBattle(fighterFor(state), enemyFor(run.depth, state.character.level, biome.enemies), {
      startingHp: run.hp,
      startingMp: run.mp,
      startingSta: run.sta,
    });
  } else if (room.type === 'boss') {
    run.battle = createBattle(fighterFor(state), bossFor(biome, run.depth, state.character.level), {
      startingHp: run.hp,
      startingMp: run.mp,
      startingSta: run.sta,
    });
  } else if (room.type === 'encounter') {
    const def = getEncounter(room.key);
    run.encounter = def ? startEncounter(def) : null;
  } else if (room.type === 'treasure') {
    const loot = resolveTreasure(run.depth);
    run.roomLoot = loot;
    run.floorReward = mergeReward(run.floorReward, loot);
  }
}

/** Finalize an ended run: bank the survivable share of floor loot (keepFactor 1 = all). */
function finishRun(run: DungeonRun, cleared: boolean, hp: number, keepFactor: number): DungeonRun {
  const kept = keepFactor >= 1 ? run.floorReward : scaleReward(run.floorReward, keepFactor);
  return {
    ...run,
    hp,
    status: 'ended',
    cleared,
    bankedReward: mergeReward(run.bankedReward, kept),
    floorReward: {},
    battle: null,
    encounter: null,
  };
}

/** Auto-generated description for a custom challenge when the player leaves it blank. */
function describeDraft(draft: CustomChallengeDraft): string {
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
function classStatOf(state: GameState): StatId | null {
  return state.character.classId ? rankStats(state.character.statXp)[0] : null;
}

/**
 * If the calendar has crossed into a new week, build the recap for the week we're leaving
 * and advance the sentinel. Mutates `state` in place (no-op within the same week).
 */
function applyWeeklyRollover(state: GameState, todayIso: string): void {
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

/** Creative-mode invincibility: keep the player's resources full and prevent a loss. */
function topUpFighter(b: BattleState): BattleState {
  return {
    ...b,
    playerHp: b.playerMaxHp,
    playerMp: b.playerMaxMp,
    playerSta: b.playerMaxSta,
    status: b.status === 'lost' ? 'active' : b.status,
  };
}

/**
 * Advance to `toLevel`, granting this level's stat points. Points are distributed by the XP
 * earned per stat since the last level-up (recent effort) plus a nudge toward the class's two
 * stats; the snapshot is then reset. Also handles the level-10 class unlock. Mutates `state`.
 */
function applyLevelUp(state: GameState, toLevel: number): void {
  const ch = state.character;
  const delta = {} as Record<StatId, number>;
  for (const s of STAT_IDS) delta[s] = ch.statXp[s] - (ch.statXpAtLastLevel[s] ?? 0);
  const favored = ch.classId ? rankStats(ch.statXp).slice(0, 2) : [];
  const gains = allocateStatGains(POINTS_PER_LEVEL, delta, ch.statLevels, favored);

  ch.statLevels = { ...ch.statLevels };
  for (const s of STAT_IDS) ch.statLevels[s] += gains[s];
  ch.statXpAtLastLevel = { ...ch.statXp };
  ch.level = Math.min(MAX_LEVEL, toLevel);

  // Class unlock at the milestone level (brief Section 6).
  if (ch.level >= CLASS_UNLOCK_LEVEL && !ch.classId) {
    const a = assignClass(ch.statXp);
    if (a.ambiguous) {
      state.pendingClassChoice = buildClassChoice(ch.statXp);
    } else {
      ch.classId = a.classId;
      if (!state.codex.includes(a.classId)) state.codex.push(a.classId);
    }
  }
}

/**
 * Reconcile committed level with XP. Levels below BOSS_GATE_LEVEL advance automatically;
 * reaching that level (or higher) queues a Level-Up Trial the player must win. No-op during a
 * live trial battle.
 */
function checkLevelUp(state: GameState): void {
  if (state.battle) return;
  const eligible = Math.min(MAX_LEVEL, levelForTotalXp(totalXp(state.character.statXp)));
  while (state.character.level < eligible) {
    const next = state.character.level + 1;
    if (next >= BOSS_GATE_LEVEL) {
      if (!state.pendingLevelUp) state.pendingLevelUp = next;
      return;
    }
    applyLevelUp(state, next);
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
      customChallenges: [],
      lastWeekKey: weekKey(toISODate()),
      pendingReport: null,
      battle: null,
      dungeon: null,
      pendingLevelUp: null,
      pendingClassChoice: null,
      bossLosses: {},
      completionLog: {},
      lastActiveISO: toISODate(),
      settings: freshSettings(),

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

          // Recompute every active challenge's progress from the updated logs.
          next.challenges = s.challenges.map((c) => {
            if (c.status !== 'active') return c;
            if (isExpired(c, today)) return { ...c, status: 'expired' as const };
            const progress = challengeProgress(c.def, c.startISO, next.habits, today);
            const status = progress >= c.def.goal ? ('completed' as const) : c.status;
            return { ...c, progress, status };
          });

          recomputeMood(next, today, result.recovery);
          applyWeeklyRollover(next, today); // completing on a new week surfaces the recap
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
          let battle = playerAction(s.battle, fighterFor(s, s.battle.buffs), action);
          if (s.settings.invincible) battle = topUpFighter(battle);

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
            const boss = bossForLevel(target);
            applyReward(next, { gold: boss.rewards.gold, items: boss.rewards.items });
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
          const today = toISODate();
          // Resolve from the full pool: this week's rotation, custom challenges, then base templates.
          const pool = [
            ...weeklyRotation(weekKey(today), classStatOf(s)),
            ...s.customChallenges,
            ...CHALLENGE_TEMPLATES,
          ];
          const def = pool.find((d) => d.id === defId);
          if (!def) return s;
          if (s.challenges.some((c) => c.def.id === defId && c.status === 'active')) return s;
          // Rival goal is frozen at start: beat last week's qualifying tally (vs. past self).
          const frozen: ChallengeDef =
            def.kind === 'rival'
              ? { ...def, goal: rivalGoal(def.stat, s.habits, addDays(weekKey(today), -7)) }
              : def;
          const active: ActiveChallenge = { def: frozen, startISO: today, progress: 0, status: 'active' };
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

      createCustomChallenge: (draft, rewardOverride) =>
        set((s) => {
          const goal = Math.max(1, Math.round(draft.goal));
          const durationDays = Math.max(1, Math.round(draft.durationDays));
          const base = { kind: draft.kind, goal, durationDays, stat: draft.stat };
          const def: ChallengeDef = {
            id: `custom_${uid()}`,
            name: draft.name.trim() || 'Custom Challenge',
            description: draft.description?.trim() || describeDraft(draft),
            kind: draft.kind,
            stat: draft.stat,
            tag: draft.tag,
            goal,
            durationDays,
            reward: rewardOverride ?? suggestReward(base),
            custom: true,
          };
          return { customChallenges: [...s.customChallenges, def] };
        }),

      deleteCustomChallenge: (id) =>
        set((s) => ({ customChallenges: s.customChallenges.filter((d) => d.id !== id) })),

      checkWeeklyRollover: () =>
        set((s) => {
          const today = toISODate();
          if (weekKey(today) === s.lastWeekKey) return s;
          const next: GameState = { ...s };
          applyWeeklyRollover(next, today);
          return next;
        }),

      dismissWeeklyReport: () => set((s) => (s.pendingReport ? { pendingReport: null } : s)),

      buyItem: (itemKey) =>
        set((s) => {
          const item = getItem(itemKey);
          if (!item || item.price === undefined) return s;
          const free = s.settings.unlimitedGold;
          if (!free && s.character.gold < item.price) return s;
          return {
            character: { ...s.character, gold: free ? s.character.gold : s.character.gold - item.price },
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
          const free = s.settings.unlimitedGold;
          if (!free && s.character.gold < weapon.price) return s;
          return {
            character: { ...s.character, gold: free ? s.character.gold : s.character.gold - weapon.price },
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
          const freeGold = s.settings.unlimitedGold;
          if (!recipe || !canCraft(recipe, s.materials, freeGold ? Infinity : s.character.gold)) return s;
          const materials = { ...s.materials };
          for (const [key, qty] of Object.entries(recipe.materials)) {
            materials[key] = (materials[key] ?? 0) - qty;
          }
          const gold = freeGold ? s.character.gold : s.character.gold - (recipe.gold ?? 0);
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
          const freeEnergy = s.settings.unlimitedEnergy;
          if (s.dungeon || (!freeEnergy && s.character.energy < DUNGEON_ENERGY_COST)) return s;
          const { c } = fighterFor(s);
          const biome = biomeForDepth(1);
          const run: DungeonRun = {
            depth: 1,
            biomeKey: biome.key,
            rooms: generateFloor(1, biome),
            index: 0,
            hp: c.maxHp,
            maxHp: c.maxHp,
            mp: c.maxMp,
            maxMp: c.maxMp,
            sta: c.maxSta,
            maxSta: c.maxSta,
            bankedReward: {},
            floorReward: {},
            encounter: null,
            roomLoot: null,
            battle: null,
            atCheckpoint: false,
            status: 'active',
            cleared: false,
          };
          enterRoom(run, s);
          return {
            character: {
              ...s.character,
              energy: freeEnergy ? s.character.energy : s.character.energy - DUNGEON_ENERGY_COST,
            },
            dungeon: run,
          };
        }),

      dungeonEncounterChoose: (choiceIndex) =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active' || !run.encounter || run.encounter.done) return s;
          const room = run.rooms[run.index];
          if (room.type !== 'encounter') return s;
          const def = getEncounter(room.key);
          if (!def) return s;

          const { state: encState, step } = chooseEncounter(
            run.encounter,
            def,
            choiceIndex,
            s.character.statLevels,
            gearBonuses(s).statBonuses,
          );
          const inv = s.settings.invincible;
          const hp = inv ? run.maxHp : Math.max(0, Math.min(run.maxHp, run.hp + step.hpDelta));
          const mp = inv ? run.maxMp : Math.max(0, Math.min(run.maxMp, run.mp + step.mpDelta));
          const sta = inv ? run.maxSta : Math.max(0, Math.min(run.maxSta, run.sta + step.staDelta));
          const floorReward = mergeReward(run.floorReward, step.reward);

          if (hp <= 0) {
            // Fell during the encounter — forfeit most of the floor's loot.
            return { dungeon: finishRun({ ...run, encounter: encState, mp, sta, floorReward }, false, 0, FLOOR_LOSS_KEEP) };
          }
          return { dungeon: { ...run, encounter: encState, hp, mp, sta, floorReward } };
        }),

      dungeonBattleAction: (action) =>
        set((s) => {
          const run = s.dungeon;
          if (!run || !run.battle || run.battle.status !== 'active') return s;
          let battle = playerAction(run.battle, fighterFor(s, run.battle.buffs), action);
          if (s.settings.invincible) battle = topUpFighter(battle);

          const inventory = { ...s.inventory };
          if (action.kind === 'item' && (inventory[action.itemKey] ?? 0) > 0) {
            inventory[action.itemKey] -= 1;
          }
          return { dungeon: { ...run, battle }, inventory };
        }),

      dungeonAdvance: () =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active' || run.atCheckpoint) return s;
          const room = run.rooms[run.index];

          let hp = run.hp;
          let mp = run.mp;
          let sta = run.sta;
          let combatStats: CombatStats | null = null;

          if (room.type === 'combat' || room.type === 'boss') {
            const b = run.battle;
            if (!b || b.status === 'active') return s; // can't leave mid-fight
            if (b.status === 'fled') {
              // Escaped alive — a clean retreat keeps everything gathered so far.
              return { dungeon: finishRun(run, false, b.playerHp, 1) };
            }
            if (b.status === 'lost') {
              return { dungeon: finishRun(run, false, 0, FLOOR_LOSS_KEEP) };
            }
            // Won: carry HP/MP/Sta forward and train a combat stat (caster → Ward, else Defense).
            hp = b.playerHp;
            mp = b.playerMp;
            sta = b.playerSta;
            const xp = combatXpForWin(b.bossMaxHp);
            combatStats =
              b.attackSchool === 'magic'
                ? { ...s.combatStats, wardXp: s.combatStats.wardXp + xp }
                : { ...s.combatStats, defenseXp: s.combatStats.defenseXp + xp };
          } else if (room.type === 'encounter') {
            if (!run.encounter || !run.encounter.done) return s; // encounter not finished
          }
          // treasure rooms loot on entry (enterRoom) — advancing just moves on.

          // Partial mana regen when pressing onward (full restore happens at checkpoints).
          mp = Math.min(run.maxMp, mp + Math.round(run.maxMp * 0.15));

          const nextIndex = run.index + 1;
          const next: DungeonRun = { ...run, index: nextIndex, hp, mp, sta, battle: null, encounter: null, roomLoot: null };

          if (nextIndex >= run.rooms.length) {
            // Floor cleared → checkpoint: lock in loot and restore HP/MP/Stamina fully.
            next.atCheckpoint = true;
            next.bankedReward = mergeReward(next.bankedReward, next.floorReward);
            next.floorReward = {};
            next.hp = next.maxHp;
            next.mp = next.maxMp;
            next.sta = next.maxSta;
          } else {
            enterRoom(next, combatStats ? { ...s, combatStats } : s);
          }
          return combatStats ? { dungeon: next, combatStats } : { dungeon: next };
        }),

      dungeonBank: () =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active' || !run.atCheckpoint) return s;
          // Floor loot was locked into bankedReward at the checkpoint; just end safely.
          return { dungeon: { ...run, status: 'ended', cleared: true } };
        }),

      dungeonDescend: () =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active' || !run.atCheckpoint) return s;
          const depth = run.depth + 1;
          const biome = biomeForDepth(depth);
          const next: DungeonRun = {
            ...run,
            depth,
            biomeKey: biome.key,
            rooms: generateFloor(depth, biome),
            index: 0,
            atCheckpoint: false,
            floorReward: {},
            roomLoot: null,
            battle: null,
            encounter: null,
          };
          enterRoom(next, s);
          return { dungeon: next };
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
            ownedWeapons: [...s.ownedWeapons],
            ownedGear: [...s.ownedGear],
            dungeon: null,
          };
          applyReward(next, run.bankedReward); // gold/materials/items/weapons/gear — no XP
          return next;
        }),

      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

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
          customChallenges: [],
          lastWeekKey: weekKey(toISODate()),
          pendingReport: null,
          battle: null,
          dungeon: null,
          pendingLevelUp: null,
          pendingClassChoice: null,
          bossLosses: {},
          completionLog: {},
          lastActiveISO: toISODate(),
          settings: freshSettings(),
        })),
    }),
    {
      name: 'habits-rpg-save',
      version: 7,
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
        return { ...p, habits, materials, challenges, character, battle: null, dungeon: null } as GameState;
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
