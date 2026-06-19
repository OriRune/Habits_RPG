/**
 * Shared types and pure helpers for the game store.
 *
 * Imports only from engine/ and content/ — never from store/ or net/.
 * This file is the boundary between the store layer and the pure engine:
 * it defines GameState, all sub-interfaces, and all cross-domain helpers
 * so that each store slice can import what it needs without circular deps.
 */

import { type StatId, STAT_IDS, emptyStatXP, getStat } from '@/engine/stats';
import { type Mood, computeMood } from '@/engine/mood';
import { type Difficulty } from '@/engine/xp';
import { type PaletteColors } from '@/engine/palettes';
import {
  type Habit,
  type HabitType,
  type Frequency,
  isScheduledOn,
} from '@/engine/habits';
import { toISODate, daysBetween, weekKey } from '@/engine/date';
import { levelForTotalXp } from '@/engine/leveling';
import {
  allocateStatGains,
  emptyStatLevels,
  POINTS_PER_LEVEL,
  MAX_LEVEL,
  BOSS_GATE_LEVEL,
} from '@/engine/progression';
import { assignClass, classFor, rankStats, CLASS_UNLOCK_LEVEL } from '@/engine/classes';
import {
  type BattleState,
  type CombatAction,
  type Fighter,
  deriveCombatant,
  createBattle,
} from '@/engine/combat';
import { getWeapon } from '@/engine/weapons';
import { type CombatStats } from '@/engine/combatStats';
import { type GearDef, type GearSlot, getGear, aggregateGear } from '@/engine/gear';
import { getRelic, aggregateRelics, rollBoons } from '@/engine/relics';
import {
  type ActiveChallenge,
  type ChallengeDef,
  type ChallengeKind,
  type Reward,
} from '@/engine/challenges';
import { type WeeklyReport, buildWeeklyReport } from '@/engine/weekly';
import { mergeReward, scaleReward, resolveTreasure, merchantOffers } from '@/engine/dungeon';
import { type DungeonRun } from '@/engine/dungeonTypes';
import {
  type MineState,
  type MineTile,
  type Dir,
  MINE_DEATH_KEEP,
} from '@/engine/mining';
import {
  type ForestState,
  type ForestTile,
  splitHaul,
  FOREST_DEATH_KEEP,
} from '@/engine/forest';
import {
  type ArenaState,
  type ArenaSpeed,
  arenaReward,
  damageProgress,
} from '@/engine/arena';
import {
  type HexBattleState,
  type SelectedAction as TacticsAction,
  type TacticsSize,
  type HeroOpts,
  tacticsReward,
} from '@/engine/hexBattle';
import type { Hex } from '@/engine/hex';
import type { Dir as GridDir, Cell as GridCell } from '@/engine/grid';
import { getBiome, bossFor } from '@/engine/biomes';
import { getEncounter, startEncounter } from '@/engine/encounters';
import { enemyFor } from '@/engine/enemies';
import { type TrialId } from '@/engine/trials/trials';

// Re-export TacticsAction so slices don't need a separate hexBattle import.
export type { TacticsAction };

// ---------------------------------------------------------------------------
// Shared interfaces
// ---------------------------------------------------------------------------

export interface Character {
  /** Hero name chosen at character creation. */
  name: string;
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

/** Developer "creative mode" switches (Settings → Developer) + appearance. */
export interface GameSettings {
  /** Purchases & crafting ignore their gold cost. */
  unlimitedGold: boolean;
  /** Dungeon entry ignores its energy cost. */
  unlimitedEnergy: boolean;
  /** Player HP/MP/Stamina stay full in combat — you can't die. */
  invincible: boolean;
  /** Selected color palette id (see engine/palettes.ts). 'default' uses the baseline theme. */
  paletteId: string;
  /** The user's last-built/imported custom palette, applied when paletteId === 'custom'. */
  customPalette: PaletteColors | null;
  /** Arena difficulty pace. 'auto' eases low levels and quickens high ones; otherwise fixed. */
  arenaSpeed: ArenaSpeed;
  /** Persisted left-click slot binding for the Arena board (defaults to 'melee'). */
  arenaBindLeft: string;
  /** Persisted right-click slot binding for the Arena board (defaults to 'ranged'). */
  arenaBindRight: string;
  /** Board size for a Hex Tactics skirmish (small 37 / medium 61 / large 127 tiles). */
  tacticsSize: TacticsSize;
  /** Skip the once-per-day gate on Skill Trials so they can be replayed immediately. */
  repeatMinigames: boolean;
  /** Render the app in dark mode (panel surfaces go dark, text goes light). */
  darkMode: boolean;
  /** Enable sound effects and the adaptive tension drone during minigames. */
  soundEnabled: boolean;
}

/** Lightweight record of a completed run — kept in `dungeonHistory` (last 10). */
export interface DungeonRunSummary {
  depth: number;
  cleared: boolean;
  defeated: boolean;
  date: string;
}

// ---------------------------------------------------------------------------
// GameState — the full persisted store shape (state fields + action signatures).
// ---------------------------------------------------------------------------

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
  /** Active Deep Mine run (real-time minigame), or null when not mining. */
  mining: MineState | null;
  /** Deepest mine floor ever reached — a persistent record (mirrors deepestFloor). */
  deepestMineFloor: number;
  /** Personal best run score in the Deep Mine. */
  bestMineScore: number;
  forest: ForestState | null;
  /** Deepest forest stage ever reached — a persistent record (mirrors deepestMineFloor). */
  deepestForestStage: number;
  /** Personal best run score in the Wild Forest. */
  bestForestScore: number;
  /** Active Arena run (real-time hex boss fight), or null when not fighting. */
  arena: ArenaState | null;
  /** Highest boss tier ever defeated in the Arena — a persistent record. */
  deepestArenaTier: number;
  /** Active Hex Tactics skirmish (turn-based hex combat), or null when not fighting. */
  tactics: HexBattleState | null;
  /** Highest tier ever won in Hex Tactics — a persistent record. */
  deepestTacticsTier: number;
  /** ISO date of the last daily clear per Skill Trial, for daily gating ('' = never). */
  trialsClearedOn: Record<TrialId, string>;
  /** Personal best score (0..1) per Skill Trial, for hub star display. */
  bestTrialScore: Record<TrialId, number>;
  /** Target level the player is currently trying to reach (boss is live or pending). */
  pendingLevelUp: number | null;
  pendingClassChoice: PendingClassChoice | null;
  /** Boss losses per target level, drives anti-frustration scaling. */
  bossLosses: Record<number, number>;
  /** Deepest dungeon floor ever reached — a persistent record that gates content. */
  deepestFloor: number;
  /** Last 10 completed Dungeon Delve runs — shown on the entrance screen. */
  dungeonHistory: DungeonRunSummary[];
  /** Date -> number of habit completions, powers mood + weekly views. */
  completionLog: Record<string, number>;
  lastActiveISO: string;
  /** Developer creative-mode switches. */
  settings: GameSettings;
  /** False until the player finishes the character-creation screen (gates onboarding). */
  created: boolean;

  // --- actions ---
  /** Commit the character-creation screen: seed name, starting stat levels, weapon, and spell. */
  createCharacter: (input: {
    name: string;
    allocations: Partial<Record<StatId, number>>;
    weaponKey: string;
    spellKey: string;
  }) => void;
  addHabit: (input: NewHabitInput) => void;
  updateHabit: (id: string, patch: Partial<NewHabitInput>) => void;
  removeHabit: (id: string) => void;
  completeHabit: (id: string, actual?: number, dateISO?: string) => void;
  /** Remove a completion (today or a past day) and refund its XP. */
  uncompleteHabit: (id: string, dateISO?: string) => void;
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
  /** Enter one of the offered next rooms on the floor map. */
  dungeonChoosePath: (nodeId: string) => void;
  dungeonEncounterChoose: (choiceIndex: number) => void;
  dungeonBattleAction: (action: CombatAction) => void;
  dungeonAdvance: () => void;
  dungeonBank: () => void;
  /** Leave the checkpoint for the next floor: 'rest' (partial heal) or 'pressOn' (a boon instead). */
  dungeonDescend: (mode: 'rest' | 'pressOn') => void;
  collectDungeon: () => void;
  /** Pick one of the offered boon relics into the run. */
  chooseBoon: (relicKey: string) => void;
  /** Shrine gamble: 'pray' (stat check → boon or curse), 'offer' (pay HP → guaranteed boon), 'leave'. */
  dungeonShrine: (choice: 'pray' | 'offer' | 'leave') => void;
  /** Buy a merchant offer with the player's gold (then leave the room). */
  dungeonBuy: (offerId: string) => void;
  /** Rest site: 'heal' (restore HP) or 'fortify' (a free tier-1 boon). */
  dungeonRest: (choice: 'heal' | 'fortify') => void;
  /** Leave a non-combat room (merchant) and continue to the next path choice. */
  dungeonLeaveRoom: () => void;

  // Deep Mine (real-time mining minigame; see src/engine/mining.ts).
  /** Start a run: gate on level/energy, charge energy, generate floor 1. */
  /** `seed` (co-op) makes the map deterministic and shared; omitted = solo (Math.random). */
  beginMining: (seed?: number) => void;
  /** Step/turn the miner one cell. */
  mineMove: (dir: Dir) => void;
  /** Swing the pick at the faced cell (dig rock/ore or hit a monster). */
  mineStrike: () => void;
  /** Charged heavy swing — higher damage, staggers monsters, clears rock faster. */
  mineStrikeCharged: () => void;
  /** Dash in `dir` (AG-gated cooldown; grants brief i-frame). */
  mineDash: (dir: Dir, nowMs: number) => void;
  /** Advance monsters on the loop's clock; commits the haul if the miner falls. */
  /** `coPlayers` (co-op) lets monsters target the nearest of all players. */
  mineTick: (nowMs: number, coPlayers?: ReadonlyArray<{ r: number; c: number }>) => void;
  /** Co-op guest per-tick: advance only own body (regen + contact damage). */
  coopClientTick: (nowMs: number) => void;
  /**
   * Co-op guest: apply the host's authoritative world slice — follow the host's
   * floor (regenerate on descent) and replace monster positions/HP.
   */
  coopApplyWorld: (slice: {
    floor: number;
    monsters: ReadonlyArray<{ id: string; r: number; c: number; hp: number; readyAtMs: number }>;
  }) => void;
  /** Co-op: apply a peer's tile change (shared resource nodes). */
  coopApplyTile: (floor: number, r: number, c: number, tile: MineTile) => void;
  /** Co-op host: resolve a remote player's melee attack on a monster (once). */
  coopApplyRemoteAttack: (monsterId: string, dmg: number) => void;
  /** Descend the shaft to a deeper, richer floor. */
  mineDescend: () => void;
  /** Cast a known spell by key (costs MP). */
  mineCast: (spellKey: string) => void;
  /** Pick a boon from the pending 3-card choice (mine). */
  chooseMineBoon: (key: string) => void;
  /** Pause the run and show the banking summary screen. */
  beginBanking: () => void;
  /** Commit the haul into the economy and close the run (death or confirmed banking). */
  endMining: () => void;

  // Wild Forest (real-time foraging minigame; see src/engine/forest.ts).
  /** Start a run: gate on energy, charge energy, generate stage 1. `seed` shares the map in co-op. */
  beginForest: (seed?: number) => void;
  /** Step/turn the forager one cell (re-lights the fog). */
  forestMove: (dir: Dir) => void;
  /** Act on the faced cell (slash a beast or gather a node). */
  forestAct: () => void;
  /** Charged heavy act — higher damage, staggers beasts, chops trees faster. */
  forestActCharged: () => void;
  /** Dash in `dir` in the forest (AG-gated cooldown; grants brief i-frame + re-lights fog). */
  forestDash: (dir: Dir, nowMs: number) => void;
  /** Advance beasts on the loop's clock; flips the run to 'ended' if the forager falls. */
  /** `coPlayers` (co-op) lets beasts target the nearest of all players. */
  forestTick: (nowMs: number, coPlayers?: ReadonlyArray<{ r: number; c: number }>) => void;
  /** Pause the run and show the banking summary screen (voluntary leave). */
  beginForestBanking: () => void;
  /** Push on through the far tree line into a deeper, richer stage. */
  forestAdvance: () => void;
  /** Cast a known spell in the forest run. */
  forestCast: (spellKey: string) => void;
  /** Activate the shrine the forager is standing on. */
  forestShrine: (nowMs: number) => void;
  /** Co-op guest: apply the host's authoritative forest world — follow stage + beasts. */
  coopApplyForestWorld: (slice: {
    floor: number;
    monsters: ReadonlyArray<{
      id: string;
      r: number;
      c: number;
      hp: number;
      readyAtMs: number;
      asleep?: boolean;
    }>;
  }) => void;
  /** Co-op: apply a peer's forest tile change (shared resource nodes). */
  coopApplyForestTile: (stage: number, r: number, c: number, tile: ForestTile) => void;
  /** Co-op host: resolve a remote player's melee attack on a beast (once). */
  coopApplyForestAttack: (beastId: string, dmg: number) => void;
  /** Co-op guest per-tick: advance only own body (regen + contact damage). */
  coopForestClientTick: (nowMs: number) => void;
  /** Pick a boon from the pending 3-card choice (forest). */
  chooseForestBoon: (key: string) => void;
  /** Commit the haul and close the run — full on confirmed banking, halved on death. */
  endForest: () => void;

  // The Arena (real-time hex boss fight; see src/engine/arena.ts).
  /** Start a fight: gate on level/energy, charge energy, snapshot the fighter vs a level-scaled boss. */
  beginArena: () => void;
  /** Step the challenger one cell (also sets facing for aiming). */
  arenaMove: (dir: GridDir) => void;
  /** Context attack on the loop's clock: melee if the boss is adjacent, else a ranged bolt. Optional dir pre-sets facing. */
  arenaAct: (nowMs: number, dir?: GridDir) => void;
  /** Explicit melee swing (only lands adjacent). Optional dir pre-sets facing. */
  arenaMelee: (nowMs: number, dir?: GridDir) => void;
  /** Explicit ranged bolt down the facing line. Optional dir pre-sets facing. */
  arenaRanged: (nowMs: number, dir?: GridDir) => void;
  /** Cast a known spell (MP-gated). Optional dir pre-sets facing; target used for rune placement. */
  arenaCast: (spellKey: string, nowMs: number, opts?: { dir?: GridDir; target?: GridCell }) => void;
  /** Use a battle item (instant heal/buff). */
  arenaUseItem: (itemKey: string, nowMs: number) => void;
  /** Advance the boss/telegraph/projectile/status clock; flips to 'won' or 'ended' on resolution. */
  arenaTick: (nowMs: number) => void;
  /** Retreat — end the fight early and show the banking summary (keeps the earned share). */
  beginArenaBanking: () => void;
  /** Commit the reward and close the fight — full on a win, partial on retreat/death. */
  endArena: () => void;

  // Hex Tactics (turn-based hex skirmish; see src/engine/hexBattle.ts).
  /** Start a skirmish: gate on level/energy, charge energy, snapshot the fighter vs scaled foes.
   *  `loadout` is the optional pre-match spell selection (max 3). Omitting it uses all known spells. */
  beginTactics: (loadout?: string[]) => void;
  /** Select the active action (move / attack / spell) and refresh movement & target highlights. */
  tacticsSelect: (action: TacticsAction) => void;
  /** Move the player to a highlighted reachable tile. */
  tacticsMove: (to: Hex) => void;
  /** Resolve the player's weapon attack against a targeted enemy hex. */
  tacticsAttack: (target: Hex) => void;
  /** Cast a known spell; `target` is required for damage/illusion spells, ignored for support. */
  tacticsCast: (spellKey: string, target: Hex | null) => void;
  /** End the player's turn — runs the enemy phase, then restores the player. */
  tacticsEndTurn: () => void;
  /** Arm an overwatch stance and end the player's turn. A one-shot reaction fires on the first
   *  enemy that steps into weapon range during the enemy phase; unused stances expire next turn. */
  tacticsHold: () => void;
  /** Commit the reward and close the skirmish (gold + stat XP on a win, effort trickle either way). */
  endTactics: () => void;
  /** Co-op: replace local tactics with the host's authoritative state (guests call this on every broadcast). */
  coopApplyTactics: (state: HexBattleState) => void;
  /** Co-op host: begin a shared skirmish with a full hero roster. `heroes[0]` is the local (host) hero.
   *  `seed` seeds the generator so the map layout is reproducible across sessions. */
  beginTacticsCoop: (opts: { heroes: HeroOpts[]; seed?: number }) => void;

  updateSettings: (patch: Partial<GameSettings>) => void;

  /**
   * Complete a Skill Trial for today. If already cleared today: no-op.
   * Otherwise stamps the date, updates the best score, and grants the trial's reward.
   */
  completeTrial: (trialId: TrialId, score01: number) => void;

  // Developer testing tools (Settings → Developer). Jump straight to level-locked content.
  /** Direct level jump: seed statXp to match `target` so all level gates open at once. */
  devSetLevel: (target: number) => void;
  /** Set the deepest dungeon floor reached (unlocks Merchant/Elite/Tier-3 relic rooms). */
  devSetDeepestFloor: (n: number) => void;
  /** Open a Level-Up Trial boss fight for `level` immediately. */
  devSpawnTrial: (level: number) => void;
  /** Strip the current class so it can be reassigned. */
  devClearClass: () => void;

  resetGame: () => void;
}

// ---------------------------------------------------------------------------
// Simple initializers
// ---------------------------------------------------------------------------

export function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function freshCharacter(): Character {
  return {
    name: 'Adventurer',
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

/** Backfill any character fields missing from a persisted save (defends nested persist merges). */
export function withCharacterDefaults(c: Partial<Character> | undefined): Character {
  return { ...freshCharacter(), ...(c ?? {}) };
}

export function totalXp(statXp: Record<StatId, number>): number {
  return (Object.values(statXp) as number[]).reduce((a, b) => a + b, 0);
}

export function freshSettings(): GameSettings {
  return {
    unlimitedGold: false,
    unlimitedEnergy: false,
    invincible: false,
    paletteId: 'default',
    customPalette: null,
    arenaSpeed: 'auto',
    arenaBindLeft: 'melee',
    arenaBindRight: 'ranged',
    tacticsSize: 'small',
    repeatMinigames: false,
    darkMode: false,
    soundEnabled: true,
  };
}

// ---------------------------------------------------------------------------
// Combat / gear helpers
// ---------------------------------------------------------------------------

/** Equipped gear pieces (skips empty slots). */
export function gearFor(state: GameState): GearDef[] {
  return (Object.values(state.equipment) as (string | null)[])
    .map((key) => (key ? getGear(key) : undefined))
    .filter((g): g is GearDef => g !== undefined);
}

export function gearBonuses(state: GameState) {
  return aggregateGear(gearFor(state));
}

/** Build the acting Fighter from current character state (+ optional in-battle buffs).
 *  Exported so the co-op hook can compute a HeroOpts snapshot for the local player. */
export function fighterFor(state: GameState, buffs: Partial<Record<StatId, number>> = {}): Fighter {
  const gear = gearBonuses(state);
  // Fold gear stat bonuses into the buffs map deriveCombatant already understands.
  const merged: Partial<Record<StatId, number>> = { ...buffs };
  for (const [stat, n] of Object.entries(gear.statBonuses)) {
    merged[stat as StatId] = (merged[stat as StatId] ?? 0) + (n ?? 0);
  }
  // Run-only relics apply on top of gear during a dungeon (and nowhere else).
  const relicDefs = (state.dungeon?.relics ?? []).map(getRelic);
  const relicAgg = aggregateRelics(relicDefs);
  for (const [stat, n] of Object.entries(relicAgg.statBonuses)) {
    merged[stat as StatId] = (merged[stat as StatId] ?? 0) + (n ?? 0);
  }
  const c = deriveCombatant(state.character.statLevels, state.character.level, state.combatStats, merged);
  c.defense += gear.defense + relicAgg.defense;
  c.ward += gear.ward + relicAgg.ward;
  c.maxHp += relicAgg.maxHp;
  return { c, weapon: getWeapon(state.equippedWeapon) };
}

/** Creative-mode invincibility: keep the player's resources full and prevent a loss. */
export function topUpFighter(b: BattleState): BattleState {
  return {
    ...b,
    playerHp: b.playerMaxHp,
    playerMp: b.playerMaxMp,
    playerSta: b.playerMaxSta,
    status: b.status === 'lost' ? 'active' : b.status,
  };
}

// ---------------------------------------------------------------------------
// Mood / date utilities
// ---------------------------------------------------------------------------

export function isoDaysAgo(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d - days);
  return toISODate(dt);
}

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
    const iso = isoDaysAgo(todayIso, d);
    expected += state.habits.filter((h) => isScheduledOn(h, iso)).length;
  }
  state.character.mood = computeMood(completions, expected, recentlyRecovered);
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

export function buildClassChoice(statXp: Record<StatId, number>): PendingClassChoice {
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
// Reward / level helpers
// ---------------------------------------------------------------------------

export function applyReward(state: GameState, reward: Reward): void {
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

/**
 * Advance to `toLevel`, granting this level's stat points. Points are distributed by the XP
 * earned per stat since the last level-up (recent effort) plus a nudge toward the class's two
 * stats; the snapshot is then reset. Also handles the level-10 class unlock. Mutates `state`.
 */
export function applyLevelUp(state: GameState, toLevel: number): void {
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
export function checkLevelUp(state: GameState): void {
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

/**
 * Award habit stat XP (dungeon wins / passed checks) into the ledger, then reconcile levels.
 * Returns just the fields a `set` patch needs. Safe to call mid-dungeon: auto-levels apply
 * immediately and a queued trial is only flagged (taken after the run, since the trial uses
 * `battle` while the dungeon uses `dungeon.battle`).
 */
export function grantStatXp(
  s: GameState,
  gains: Partial<Record<StatId, number>>,
): Pick<GameState, 'character' | 'pendingLevelUp' | 'pendingClassChoice' | 'codex'> {
  const temp: GameState = {
    ...s,
    character: { ...s.character, statXp: { ...s.character.statXp } },
    codex: [...s.codex],
  };
  for (const [stat, amt] of Object.entries(gains)) {
    temp.character.statXp[stat as StatId] += amt ?? 0;
  }
  checkLevelUp(temp);
  return {
    character: temp.character,
    pendingLevelUp: temp.pendingLevelUp,
    pendingClassChoice: temp.pendingClassChoice,
    codex: temp.codex,
  };
}

// ---------------------------------------------------------------------------
// Dungeon helpers
// ---------------------------------------------------------------------------

/** Boon tiers unlock with how deep you've gone: tier 2 from depth 4, tier 3 from depth 10. */
export function boonMaxTier(depth: number, deepest: number): number {
  const d = Math.max(depth, deepest);
  if (d >= 10) return 3;
  if (d >= 4) return 2;
  return 1;
}

/** Offer three boon choices on a run (press-on / shrine / elite). No-op if the pool is empty. */
export function offerBoon(run: DungeonRun, maxTier: number): void {
  const choices = rollBoons(3, run.relics, maxTier);
  run.pendingBoon = choices.length ? choices : null;
}

/**
 * Resolve the current room: carry the given resources, then either present the next path
 * choices or reach the floor checkpoint when the node is terminal. Shared by combat, encounters,
 * and the new room types (shrine/merchant/rest). Pure: returns a fresh run.
 */
export function resolveCurrentNode(run: DungeonRun, hp: number, mp: number, sta: number): DungeonRun {
  const node = run.nodeId ? run.map.nodes[run.nodeId] : null;
  // Partial mana regen when pressing onward (full restore happens at checkpoints).
  const regenMp = Math.min(run.maxMp, mp + Math.round(run.maxMp * 0.15));
  const next: DungeonRun = {
    ...run,
    nodeId: null,
    hp,
    mp: regenMp,
    sta,
    battle: null,
    encounter: null,
    roomLoot: null,
    merchant: null,
  };
  if (!node || node.to.length === 0) {
    // Floor cleared → checkpoint. HP carries over (attrition); the Rest/Press-On/Bank choice and
    // any MP/Stamina restore happen at the checkpoint (dungeonDescend). No free full heal.
    next.choices = [];
    next.atCheckpoint = true;
    next.bankedReward = mergeReward(next.bankedReward, next.floorReward);
    next.floorReward = {};
  } else {
    next.choices = node.to;
  }
  return next;
}

/** The room payload of the node currently being resolved (null at a path choice / floor start). */
export function currentRoom(run: DungeonRun) {
  return run.nodeId ? run.map.nodes[run.nodeId]?.room ?? null : null;
}

/** Set up the run's current room — seeds combat/boss fights, encounters, and the new room types. */
export function enterRoom(run: DungeonRun, state: GameState): void {
  const room = currentRoom(run);
  run.battle = null;
  run.encounter = null;
  run.roomLoot = null;
  run.merchant = null;
  if (!room) return;
  const biome = getBiome(run.biomeKey);
  const carry = { startingHp: run.hp, startingMp: run.mp, startingSta: run.sta };
  if (room.type === 'combat') {
    run.battle = createBattle(fighterFor(state), enemyFor(run.depth, state.character.level, biome.enemies), carry);
  } else if (room.type === 'elite') {
    run.battle = createBattle(fighterFor(state), enemyFor(run.depth, state.character.level, biome.enemies, Math.random, true), carry);
  } else if (room.type === 'boss') {
    run.battle = createBattle(fighterFor(state), bossFor(biome, run.depth, state.character.level), carry);
  } else if (room.type === 'encounter') {
    const def = getEncounter(room.key);
    run.encounter = def ? startEncounter(def) : null;
  } else if (room.type === 'treasure') {
    const loot = resolveTreasure(run.depth);
    run.roomLoot = loot;
    run.floorReward = mergeReward(run.floorReward, loot);
  } else if (room.type === 'merchant') {
    run.merchant = merchantOffers(run.depth);
  }
  // shrine + rest rooms are resolved entirely through their player choices (dungeonShrine/dungeonRest).
}

/** Finalize an ended run: bank the survivable share of floor loot (keepFactor 1 = all). */
export function finishRun(run: DungeonRun, cleared: boolean, hp: number, keepFactor: number): DungeonRun {
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

// ---------------------------------------------------------------------------
// commitRun — shared run-banking helper
// ---------------------------------------------------------------------------

export type CommitRunField = 'mining' | 'forest' | 'arena' | 'tactics';
export type CommitDeepestField =
  | 'deepestMineFloor'
  | 'deepestForestStage'
  | 'deepestArenaTier'
  | 'deepestTacticsTier';
export type CommitScoreField = 'bestMineScore' | 'bestForestScore';

export interface CommitRunOpts {
  /** The store field to null out (the run object). */
  runField: CommitRunField;
  /** Pre-computed haul/reward to apply (the caller splits haul on death paths). */
  reward: Reward;
  /** Per-stat XP granted by this run (trickle + optional usage-weighted amounts). */
  statXp: Partial<Record<StatId, number>>;
  /** Which persistent-record field to update (deepest floor/stage/tier reached). */
  deepestField: CommitDeepestField;
  /** The value to compare against the current record (e.g. run.deepest). */
  deepestValue: number;
  /**
   * When defined, the record update is gated: `true` → update, `false` → keep.
   * Absent (undefined) → always update (mine/forest never gate on won).
   */
  gateOnWin?: boolean;
  /** Optional best-score record to update (mine/forest only). */
  scoreField?: CommitScoreField;
  scoreValue?: number;
  /**
   * `true` for mine/forest: clone materials, ownedWeapons, ownedGear so
   * applyReward can mutate them. `false` for arena/tactics which don't award
   * materials or weapons.
   */
  cloneMaterials?: boolean;
}

/**
 * Shared one-stop finisher for all four run types. Banks the reward, clears the
 * active run, updates persistent records, and reconciles level. The six
 * per-mode commit functions are thin wrappers that pre-compute their reward/statXp
 * and delegate here — all policy is preserved exactly; only the boilerplate is shared.
 */
export function commitRun(state: GameState, opts: CommitRunOpts): GameState {
  const updateDeepest = opts.gateOnWin === undefined || opts.gateOnWin;

  // Build the record-update fragment using computed keys.
  const recordUpdate: Partial<GameState> = {
    [opts.runField]: null,
    [opts.deepestField]: updateDeepest
      ? Math.max(state[opts.deepestField], opts.deepestValue)
      : state[opts.deepestField],
  };
  if (opts.scoreField !== undefined && opts.scoreValue !== undefined) {
    recordUpdate[opts.scoreField] = Math.max(state[opts.scoreField], opts.scoreValue);
  }

  const next: GameState = {
    ...state,
    character: { ...state.character, statXp: { ...state.character.statXp } },
    inventory: { ...state.inventory },
    ...(opts.cloneMaterials
      ? {
          materials: { ...state.materials },
          ownedWeapons: [...state.ownedWeapons],
          ownedGear: [...state.ownedGear],
        }
      : {}),
    ...recordUpdate,
  } as GameState;

  applyReward(next, { ...opts.reward, statXp: opts.statXp });
  checkLevelUp(next);
  return next;
}

// ---------------------------------------------------------------------------
// Per-mode commit wrappers — compute mode-specific opts and delegate to commitRun
// ---------------------------------------------------------------------------

/** Bank a finished mine run's haul into the economy, clear the run, and reconcile level. */
export function commitMining(state: GameState, run: MineState): GameState {
  // Include gold haul in the final score so resource-gathering builds score alongside kills.
  const finalScore = run.score + (run.haul.gold ?? 0);
  const trickle = 4 + 3 * run.deepest;
  return commitRun(state, {
    runField: 'mining', reward: run.haul, statXp: { ST: trickle, EN: trickle },
    deepestField: 'deepestMineFloor', deepestValue: run.deepest,
    scoreField: 'bestMineScore', scoreValue: finalScore, cloneMaterials: true,
  });
}

/**
 * Bank only the kept half of a fallen miner's haul (the rest is forfeit to the rock) and clear
 * the run. Mirrors commitForestDeath; the overlay shows the split beforehand.
 */
export function commitMineDeath(state: GameState, run: MineState): GameState {
  const { kept } = splitHaul(run.haul, MINE_DEATH_KEEP);
  // Include kept gold in the final score even on death (mirrors commitMining).
  const finalScore = run.score + (kept.gold ?? 0);
  const trickle = 4 + 3 * run.deepest;
  return commitRun(state, {
    runField: 'mining', reward: kept, statXp: { ST: trickle, EN: trickle },
    deepestField: 'deepestMineFloor', deepestValue: run.deepest,
    scoreField: 'bestMineScore', scoreValue: finalScore, cloneMaterials: true,
  });
}

/** Bank a finished forest run's haul into the economy, clear the run, and reconcile level. */
export function commitForest(state: GameState, run: ForestState): GameState {
  // The run's gold/materials, plus a modest Dexterity/Endurance trickle for the foraging trek.
  const trickle = 4 + 3 * run.deepest;
  return commitRun(state, {
    runField: 'forest', reward: run.haul, statXp: { DX: trickle, EN: trickle },
    deepestField: 'deepestForestStage', deepestValue: run.deepest,
    scoreField: 'bestForestScore', scoreValue: run.score, cloneMaterials: true,
  });
}

/**
 * Bank only the kept half of a fallen forager's haul (the rest is forfeit to the wild) and clear
 * the run. Mirrors commitForest but for the death path; the overlay shows the split beforehand.
 */
export function commitForestDeath(state: GameState, run: ForestState): GameState {
  const { kept } = splitHaul(run.haul, FOREST_DEATH_KEEP);
  // The trek still earns its Dexterity/Endurance trickle — only the haul is docked.
  const trickle = 4 + 3 * run.deepest;
  return commitRun(state, {
    runField: 'forest', reward: kept, statXp: { DX: trickle, EN: trickle },
    deepestField: 'deepestForestStage', deepestValue: run.deepest,
    scoreField: 'bestForestScore', scoreValue: run.score, cloneMaterials: true,
  });
}

/**
 * Bank a finished Arena fight's reward into the economy and close it. A win pays the full boss
 * reward (gold + items) and records the tier; a retreat/death pays the earned share (computed by
 * arenaReward). Either way the bout earns a small Strength/Dexterity/Endurance trickle scaled by
 * how much of the boss was worn down.
 */
export function commitArena(state: GameState, run: ArenaState): GameState {
  const won = run.status === 'won';
  // Distribute XP across whichever stats the player actually used in this run.
  // Budget scales with tier and how much of the boss was worn down.
  const budget = Math.round((4 + run.tier) * (0.4 + 0.6 * damageProgress(run)));
  const usage = run.statUsage;
  const totalUsage = (Object.values(usage) as number[]).reduce((sum, n) => sum + n, 0);
  let statXp: Partial<Record<StatId, number>>;
  if (totalUsage > 0) {
    statXp = {};
    for (const [stat, count] of Object.entries(usage) as [StatId, number][]) {
      if (count > 0) statXp[stat] = Math.max(1, Math.round((count / totalUsage) * budget));
    }
  } else {
    // Fallback: player entered but dealt no actions — still reward ST as default
    statXp = { ST: budget };
  }
  return commitRun(state, {
    runField: 'arena', reward: arenaReward(run), statXp,
    deepestField: 'deepestArenaTier', deepestValue: run.tier, gateOnWin: won,
    cloneMaterials: false,
  });
}

/**
 * Bank a finished Hex Tactics skirmish and close it. A win pays scaled gold (tacticsReward) and
 * records the tier; either outcome earns an Agility-forward Agility/Dexterity/Endurance trickle —
 * Tactics is the mode that finally rewards mobility, so its XP leans on AG.
 */
export function commitTactics(state: GameState, run: HexBattleState): GameState {
  const won = run.status === 'won';
  const trickle = Math.round((4 + run.tier) * (won ? 1 : 0.4));
  return commitRun(state, {
    runField: 'tactics', reward: tacticsReward(run), statXp: { AG: trickle, DX: trickle, EN: trickle },
    deepestField: 'deepestTacticsTier', deepestValue: run.tier, gateOnWin: won,
    cloneMaterials: false,
  });
}
