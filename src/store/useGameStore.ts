// Central game store (Zustand + localStorage persistence).
// Holds all persisted state and orchestrates the pure engine modules.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { type StatId, STAT_IDS, emptyStatXP, getStat } from '@/engine/stats';
import { type PaletteColors } from '@/engine/palettes';
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
import { levelForTotalXp, cumulativeXpToReach } from '@/engine/leveling';
import {
  allocateStatGains,
  creationStatLevels,
  emptyStatLevels,
  statLevelsFromXp,
  POINTS_PER_LEVEL,
  MAX_LEVEL,
  BOSS_GATE_LEVEL,
  DUNGEON_UNLOCK_LEVEL,
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
import { getRelic, aggregateRelics, rollBoons, rollCurse } from '@/engine/relics';
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
  type MerchantOffer,
  resolveTreasure,
  merchantOffers,
  mergeReward,
  scaleReward,
  DUNGEON_ENERGY_COST,
} from '@/engine/dungeon';
import { type FloorMap, generateFloorMap } from '@/engine/dungeonMap';
import {
  type MineState,
  type MineTile,
  type Dir,
  generateMine,
  mineSnapshot,
  tryMove,
  tryDash as mineTryDash,
  strike,
  stepMonsters,
  coopClientStep,
  damageMonsterById,
  descend,
  castSpell as minecastSpellFn,
  applyBoonChoice as applyMineBoonChoice,
  MINE_ENERGY_COST,
  MINE_DEATH_KEEP,
} from '@/engine/mining';
import { dungeonStamina, type RNG } from '@/engine/crawl';
import { rollBoonChoices } from '@/content/boons';
import { MINE_MONSTERS } from '@/content/mining';
import { FOREST_BEASTS } from '@/content/forest';
import { mulberry32, floorSeed } from '@/engine/rng';
import {
  type ForestState,
  applyBoonChoice as applyForestBoonChoice,
  type ForestTile,
  generateForest,
  forestSnapshot,
  tryMove as forestTryMove,
  tryDash as forestTryDash,
  act as forestActFn,
  castSpell as forestCastSpellFn,
  stepBeasts,
  advance as forestAdvanceFn,
  activateShrine as forestActivateShrine,
  damageBeastById,
  coopClientStep as forestCoopClientStep,
  splitHaul,
  FOREST_ENERGY_COST,
  FOREST_DEATH_KEEP,
} from '@/engine/forest';
import {
  type ArenaState,
  createArena,
  arenaMove as arenaMoveFn,
  arenaAct as arenaActFn,
  arenaMelee as arenaMeleeFn,
  arenaRanged as arenaRangedFn,
  arenaCast as arenaCastFn,
  arenaUseItem as arenaUseItemFn,
  arenaTick as arenaTickFn,
  arenaReward,
  damageProgress,
  rollArenaSetup,
  arenaSpeedFactor,
  type ArenaSpeed,
  ARENA_ENERGY_COST,
  ARENA_UNLOCK_LEVEL,
} from '@/engine/arena';
import {
  type HexBattleState,
  type SelectedAction as TacticsAction,
  type TacticsSize,
  TACTICS_SIZE_RADIUS,
  generateSkirmish,
  selectAction as tacticsSelectFn,
  movePlayer as tacticsMoveFn,
  playerAttack as tacticsAttackFn,
  playerCastSpell as tacticsCastFn,
  endPlayerTurn as tacticsEndTurnFn,
  tacticsReward,
  TACTICS_ENERGY_COST,
  TACTICS_UNLOCK_LEVEL,
} from '@/engine/hexBattle';
import type { Hex } from '@/engine/hex';
import type { Dir as GridDir, Cell as GridCell } from '@/engine/grid';
import { biomeForDepth, getBiome, bossFor } from '@/engine/biomes';
import {
  type EncounterRunState,
  getEncounter,
  startEncounter,
  chooseEncounter,
  checkChance,
} from '@/engine/encounters';
import { enemyFor } from '@/engine/enemies';
import { type Mood, computeMood } from '@/engine/mood';
import {
  type TrialId,
  getTrial,
  trialReward,
  emptyTrialsClearedOn,
  emptyBestTrialScore,
} from '@/engine/trials/trials';
export { TRIALS_UNLOCK_LEVEL } from '@/engine/trials/trials';

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

/** An in-progress Dungeon Expedition (brief §7.2) — an endless descent through floors.
 *  Persisted so a run resumes on reload. */
export interface DungeonRun {
  /** Current floor number (1-based); drives biome + difficulty scaling. */
  depth: number;
  biomeKey: string;
  /** The current floor's branching room map. */
  map: FloorMap;
  /** The room currently being resolved, or null when choosing the next path / at floor start. */
  nodeId: string | null;
  /** Node ids the player may enter next (the branching choice); empty while inside a room. */
  choices: string[];
  /** Ordered ids of rooms entered this floor (for the map UI). */
  path: string[];
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
  /** Run-only relic keys (boons + curses), applied to dungeon fights like gear. */
  relics: string[];
  /** Three boon keys offered to the player (floor clear / shrine / elite); null when none pending. */
  pendingBoon: string[] | null;
  /** Wares offered in a merchant room (null outside one). */
  merchant: MerchantOffer[] | null;
}

/** Share of the current floor's loot kept when you fall mid-floor (the rest is forfeit). */
const FLOOR_LOSS_KEEP = 0.25;

/** Boon tiers unlock with how deep you've gone: tier 2 from depth 4, tier 3 from depth 10. */
function boonMaxTier(depth: number, deepest: number): number {
  const d = Math.max(depth, deepest);
  if (d >= 10) return 3;
  if (d >= 4) return 2;
  return 1;
}

/** Offer three boon choices on a run (press-on / shrine / elite). No-op if the pool is empty. */
function offerBoon(run: DungeonRun, maxTier: number): void {
  const choices = rollBoons(3, run.relics, maxTier);
  run.pendingBoon = choices.length ? choices : null;
}

/**
 * Resolve the current room: carry the given resources, then either present the next path
 * choices or reach the floor checkpoint when the node is terminal. Shared by combat, encounters,
 * and the new room types (shrine/merchant/rest). Pure: returns a fresh run.
 */
function resolveCurrentNode(run: DungeonRun, hp: number, mp: number, sta: number): DungeonRun {
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
  /** Board size for a Hex Tactics skirmish (small 37 / medium 61 / large 127 tiles). */
  tacticsSize: TacticsSize;
  /** Skip the once-per-day gate on Skill Trials so they can be replayed immediately. */
  repeatMinigames: boolean;
  /** Render the app in dark mode (panel surfaces go dark, text goes light). */
  darkMode: boolean;
  /** Enable sound effects and the adaptive tension drone during minigames. */
  soundEnabled: boolean;
}

function freshSettings(): GameSettings {
  return {
    unlimitedGold: false,
    unlimitedEnergy: false,
    invincible: false,
    paletteId: 'default',
    customPalette: null,
    arenaSpeed: 'auto',
    tacticsSize: 'small',
    repeatMinigames: false,
    darkMode: false,
    soundEnabled: true,
  };
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
  /** Start a skirmish: gate on level/energy, charge energy, snapshot the fighter vs scaled foes. */
  beginTactics: () => void;
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
  /** Commit the reward and close the skirmish (gold + stat XP on a win, effort trickle either way). */
  endTactics: () => void;

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

function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function freshCharacter(): Character {
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

/** Bank a finished mine run's haul into the economy, clear the run, and reconcile level. */
function commitMining(state: GameState, run: MineState): GameState {
  const next: GameState = {
    ...state,
    character: { ...state.character, statXp: { ...state.character.statXp } },
    inventory: { ...state.inventory },
    materials: { ...state.materials },
    ownedWeapons: [...state.ownedWeapons],
    ownedGear: [...state.ownedGear],
    mining: null,
    deepestMineFloor: Math.max(state.deepestMineFloor, run.deepest),
    bestMineScore: Math.max(state.bestMineScore, run.score),
  };
  // The run's gold/materials, plus a modest Strength/Endurance trickle for the labour.
  const trickle = 4 + 3 * run.deepest;
  applyReward(next, { ...run.haul, statXp: { ST: trickle, EN: trickle } });
  checkLevelUp(next);
  return next;
}

/**
 * Bank only the kept half of a fallen miner's haul (the rest is forfeit to the rock) and clear
 * the run. Mirrors commitForestDeath; the overlay shows the split beforehand.
 */
function commitMineDeath(state: GameState, run: MineState): GameState {
  const { kept } = splitHaul(run.haul, MINE_DEATH_KEEP);
  const next: GameState = {
    ...state,
    character: { ...state.character, statXp: { ...state.character.statXp } },
    inventory: { ...state.inventory },
    materials: { ...state.materials },
    ownedWeapons: [...state.ownedWeapons],
    ownedGear: [...state.ownedGear],
    mining: null,
    deepestMineFloor: Math.max(state.deepestMineFloor, run.deepest),
    bestMineScore: Math.max(state.bestMineScore, run.score),
  };
  // The dig still earns its Strength/Endurance trickle — only the haul is docked.
  const trickle = 4 + 3 * run.deepest;
  applyReward(next, { ...kept, statXp: { ST: trickle, EN: trickle } });
  checkLevelUp(next);
  return next;
}

/** Bank a finished forest run's haul into the economy, clear the run, and reconcile level. */
function commitForest(state: GameState, run: ForestState): GameState {
  const next: GameState = {
    ...state,
    character: { ...state.character, statXp: { ...state.character.statXp } },
    inventory: { ...state.inventory },
    materials: { ...state.materials },
    ownedWeapons: [...state.ownedWeapons],
    ownedGear: [...state.ownedGear],
    forest: null,
    deepestForestStage: Math.max(state.deepestForestStage, run.deepest),
    bestForestScore: Math.max(state.bestForestScore, run.score),
  };
  // The run's gold/materials, plus a modest Dexterity/Endurance trickle for the foraging trek.
  const trickle = 4 + 3 * run.deepest;
  applyReward(next, { ...run.haul, statXp: { DX: trickle, EN: trickle } });
  checkLevelUp(next);
  return next;
}

/**
 * Bank only the kept half of a fallen forager's haul (the rest is forfeit to the wild) and clear
 * the run. Mirrors commitForest but for the death path; the overlay shows the split beforehand.
 */
function commitForestDeath(state: GameState, run: ForestState): GameState {
  const { kept } = splitHaul(run.haul, FOREST_DEATH_KEEP);
  const next: GameState = {
    ...state,
    character: { ...state.character, statXp: { ...state.character.statXp } },
    inventory: { ...state.inventory },
    materials: { ...state.materials },
    ownedWeapons: [...state.ownedWeapons],
    ownedGear: [...state.ownedGear],
    forest: null,
    deepestForestStage: Math.max(state.deepestForestStage, run.deepest),
    bestForestScore: Math.max(state.bestForestScore, run.score),
  };
  // The trek still earns its Dexterity/Endurance trickle — only the haul is docked.
  const trickle = 4 + 3 * run.deepest;
  applyReward(next, { ...kept, statXp: { DX: trickle, EN: trickle } });
  checkLevelUp(next);
  return next;
}

/**
 * Bank a finished Arena fight's reward into the economy and close it. A win pays the full boss
 * reward (gold + items) and records the tier; a retreat/death pays the earned share (computed by
 * arenaReward). Either way the bout earns a small Strength/Dexterity/Endurance trickle scaled by
 * how much of the boss was worn down.
 */
function commitArena(state: GameState, run: ArenaState): GameState {
  const won = run.status === 'won';
  const next: GameState = {
    ...state,
    character: { ...state.character, statXp: { ...state.character.statXp } },
    inventory: { ...state.inventory },
    arena: null,
    deepestArenaTier: won ? Math.max(state.deepestArenaTier, run.tier) : state.deepestArenaTier,
  };
  // Distribute XP across whichever stats the player actually used in this run.
  // Budget scales with tier and how much of the boss was worn down (same as before).
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
  applyReward(next, { ...arenaReward(run), statXp });
  checkLevelUp(next);
  return next;
}

/**
 * Bank a finished Hex Tactics skirmish and close it. A win pays scaled gold (tacticsReward) and
 * records the tier; either outcome earns an Agility-forward Agility/Dexterity/Endurance trickle —
 * Tactics is the mode that finally rewards mobility, so its XP leans on AG.
 */
function commitTactics(state: GameState, run: HexBattleState): GameState {
  const won = run.status === 'won';
  const next: GameState = {
    ...state,
    character: { ...state.character, statXp: { ...state.character.statXp } },
    inventory: { ...state.inventory },
    tactics: null,
    deepestTacticsTier: won ? Math.max(state.deepestTacticsTier, run.tier) : state.deepestTacticsTier,
  };
  const trickle = Math.round((4 + run.tier) * (won ? 1 : 0.4));
  applyReward(next, { ...tacticsReward(run), statXp: { AG: trickle, DX: trickle, EN: trickle } });
  checkLevelUp(next);
  return next;
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

/** The room payload of the node currently being resolved (null at a path choice / floor start). */
function currentRoom(run: DungeonRun) {
  return run.nodeId ? run.map.nodes[run.nodeId]?.room ?? null : null;
}

/** Set up the run's current room — seeds combat/boss fights, encounters, and the new room types. */
function enterRoom(run: DungeonRun, state: GameState): void {
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
 * Award habit stat XP (dungeon wins / passed checks) into the ledger, then reconcile levels.
 * Returns just the fields a `set` patch needs. Safe to call mid-dungeon: auto-levels apply
 * immediately and a queued trial is only flagged (taken after the run, since the trial uses
 * `battle` while the dungeon uses `dungeon.battle`).
 */
function grantStatXp(
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

/**
 * RNG stream for the current Deep Mine run. Defaults to `Math.random` (solo play,
 * unchanged). For co-op, `beginMining(seed)` swaps in a seeded `mulberry32` so the
 * host and every client regenerate an identical map; the same stream then drives
 * the host's per-tick monster simulation. Held at module scope (not in MineState)
 * so it stays out of the serialized/persisted save.
 */
let mineRng: RNG = Math.random;

/**
 * The co-op run's base seed (undefined in solo play). Each floor's map is generated
 * from `mulberry32(floorSeed(mineBaseSeed, floor))` so floor N is byte-identical on
 * every client regardless of how much `mineRng` diverged on earlier floors — this is
 * what lets a guest follow the host's descent onto the same map.
 */
let mineBaseSeed: number | undefined;

/** Wild Forest run RNG + base seed — the forest analog of mineRng/mineBaseSeed. */
let forestRng: RNG = Math.random;
let forestBaseSeed: number | undefined;

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
      mining: null,
      deepestMineFloor: 0,
      bestMineScore: 0,
      forest: null,
      deepestForestStage: 0,
      bestForestScore: 0,
      arena: null,
      deepestArenaTier: 0,
      tactics: null,
      deepestTacticsTier: 0,
      trialsClearedOn: emptyTrialsClearedOn(),
      bestTrialScore: emptyBestTrialScore(),
      pendingLevelUp: null,
      pendingClassChoice: null,
      bossLosses: {},
      deepestFloor: 0,
      completionLog: {},
      lastActiveISO: toISODate(),
      settings: freshSettings(),
      created: false,

      createCharacter: ({ name, allocations, weaponKey, spellKey }) =>
        set((s) => {
          const weapon = WEAPONS[weaponKey] ? weaponKey : STARTER_WEAPON;
          const spells = [...STARTER_SPELLS];
          if (spellKey && !spells.includes(spellKey)) spells.push(spellKey);
          return {
            character: {
              ...s.character,
              name: name.trim() || 'Adventurer',
              statLevels: creationStatLevels(allocations),
            },
            equippedWeapon: weapon,
            ownedWeapons: [weapon],
            knownSpells: spells,
            created: true,
          };
        }),

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
          if (habit.log[day] !== undefined) return s; // already done that day
          if (effectiveStatus(habit, day) !== 'active') return s; // retired/suspended that day

          const result = resolveCompletion(habit, day, { actual });
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
                log: { ...h.log, [day]: { amount: actual, xp } },
                // Only advance lastCompletedISO when this is the latest completion.
                lastCompletedISO: !h.lastCompletedISO || day > h.lastCompletedISO ? day : h.lastCompletedISO,
              };
              updated.streak = currentStreak(updated, today); // always relative to real today
              return updated;
            }),
          };

          next.character.statXp[habit.stat] += xp;
          // Keep the per-day completion count accurate for the edited day (drives heatmap/mood history).
          next.completionLog[day] = (next.completionLog[day] ?? 0) + 1;

          // Recompute every active challenge's progress from the updated logs.
          next.challenges = s.challenges.map((c) => {
            if (c.status !== 'active') return c;
            if (isExpired(c, today)) return { ...c, status: 'expired' as const };
            const progress = challengeProgress(c.def, c.startISO, next.habits, today);
            const status = progress >= c.def.goal ? ('completed' as const) : c.status;
            return { ...c, progress, status };
          });

          // Today-only side effects: not moved by editing a past day.
          if (isToday) {
            next.character.energy += 1;
            next.lastActiveISO = today;
            recomputeMood(next, today, result.recovery);
            applyWeeklyRollover(next, today); // completing on a new week surfaces the recap
          }
          checkLevelUp(next); // total-XP based, valid for retro completions too
          return next;
        }),

      uncompleteHabit: (id, dateISO) =>
        set((s) => {
          const today = toISODate();
          const day = dateISO ?? today;
          const habit = s.habits.find((h) => h.id === id);
          if (!habit) return s;
          const entry = habit.log[day];
          if (entry === undefined) return s; // nothing to undo

          const next: GameState = {
            ...s,
            character: { ...s.character, statXp: { ...s.character.statXp } },
            completionLog: { ...s.completionLog },
            habits: s.habits.map((h) => {
              if (h.id !== id) return h;
              const log = { ...h.log };
              delete log[day];
              const updated: Habit = { ...h, log };
              // Most recent remaining completion on/before today, else undefined.
              const keys = Object.keys(log).filter((k) => k <= today).sort();
              updated.lastCompletedISO = keys.length ? keys[keys.length - 1] : undefined;
              updated.streak = currentStreak(updated, today);
              return updated;
            }),
          };

          // Refund the exact XP stored for that day (already includes gear multiplier).
          next.character.statXp[habit.stat] = Math.max(0, next.character.statXp[habit.stat] - entry.xp);
          const count = (next.completionLog[day] ?? 0) - 1;
          if (count > 0) next.completionLog[day] = count;
          else delete next.completionLog[day];

          // Recompute active challenges from the reduced logs.
          next.challenges = s.challenges.map((c) => {
            if (c.status !== 'active') return c;
            if (isExpired(c, today)) return { ...c, status: 'expired' as const };
            const progress = challengeProgress(c.def, c.startISO, next.habits, today);
            return { ...c, progress };
          });

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
          if (s.dungeon || s.character.level < DUNGEON_UNLOCK_LEVEL) return s;
          if (!freeEnergy && s.character.energy < DUNGEON_ENERGY_COST) return s;
          const { c } = fighterFor(s);
          const biome = biomeForDepth(1);
          const map = generateFloorMap(1, biome, Math.random, { deepest: s.deepestFloor });
          const run: DungeonRun = {
            depth: 1,
            biomeKey: biome.key,
            map,
            nodeId: null,
            choices: map.layers[0],
            path: [],
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
            relics: [],
            pendingBoon: null,
            merchant: null,
          };
          return {
            character: {
              ...s.character,
              energy: freeEnergy ? s.character.energy : s.character.energy - DUNGEON_ENERGY_COST,
            },
            dungeon: run,
          };
        }),

      dungeonChoosePath: (nodeId) =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active' || run.nodeId !== null || !run.choices.includes(nodeId)) return s;
          const next: DungeonRun = { ...run, nodeId, choices: [], path: [...run.path, nodeId] };
          enterRoom(next, s);
          return { dungeon: next };
        }),

      dungeonEncounterChoose: (choiceIndex) =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active' || !run.encounter || run.encounter.done) return s;
          const room = currentRoom(run);
          if (room?.type !== 'encounter') return s;
          const def = getEncounter(room.key);
          if (!def) return s;

          const checkedStat = def.nodes[run.encounter.nodeId]?.choices?.[choiceIndex]?.stat;
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

          // Passing a stat check exercises that stat — award habit XP toward the character level.
          const statXpPatch =
            checkedStat && encState.lastOutcome === 'success' ? grantStatXp(s, { [checkedStat]: 10 }) : null;

          if (hp <= 0) {
            // Fell during the encounter — forfeit most of the floor's loot.
            return { dungeon: finishRun({ ...run, encounter: encState, mp, sta, floorReward }, false, 0, FLOOR_LOSS_KEEP) };
          }
          return {
            dungeon: { ...run, encounter: encState, hp, mp, sta, floorReward },
            ...(statXpPatch ?? {}),
          };
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
          const node = run.nodeId ? run.map.nodes[run.nodeId] : null;
          const room = node?.room;
          if (!node || !room) return s;

          let hp = run.hp;
          let mp = run.mp;
          let sta = run.sta;
          let combatStats: CombatStats | null = null;
          let statXpPatch: ReturnType<typeof grantStatXp> | null = null;

          let workingRun = run;
          let eliteWin = false;

          if (room.type === 'combat' || room.type === 'boss' || room.type === 'elite') {
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
            // Also award habit stat XP toward the character level: the attack stat you fight with,
            // plus HP for enduring the fight.
            const winXp = 8 + Math.round(b.bossMaxHp / 10);
            const atkStat = getWeapon(s.equippedWeapon).attackStat;
            const toAtk = Math.round(winXp * 0.6);
            statXpPatch = grantStatXp(s, { [atkStat]: toAtk, HP: winXp - toAtk });
            if (room.type === 'elite') {
              // Elites drop bonus gold and guarantee a boon.
              eliteWin = true;
              workingRun = { ...run, floorReward: mergeReward(run.floorReward, { gold: 40 + run.depth * 12 }) };
            }
          } else if (room.type === 'encounter') {
            if (!run.encounter || !run.encounter.done) return s; // encounter not finished
          }
          // treasure rooms loot on entry (enterRoom) — advancing just moves on.

          const next = resolveCurrentNode(workingRun, hp, mp, sta);
          if (eliteWin) offerBoon(next, boonMaxTier(next.depth, s.deepestFloor));
          return {
            dungeon: next,
            ...(combatStats ? { combatStats } : {}),
            ...(statXpPatch ?? {}),
          };
        }),

      dungeonBank: () =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active' || !run.atCheckpoint) return s;
          // Floor loot was locked into bankedReward at the checkpoint; just end safely.
          return { dungeon: { ...run, status: 'ended', cleared: true } };
        }),

      dungeonDescend: (mode) =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active' || !run.atCheckpoint) return s;
          const depth = run.depth + 1;
          const deepestFloor = Math.max(s.deepestFloor, depth);
          const biome = biomeForDepth(depth);
          const map = generateFloorMap(depth, biome, Math.random, { deepest: s.deepestFloor });
          // Mana + Stamina reset between floors; HP is the run's attrition currency and carries.
          const next: DungeonRun = {
            ...run,
            depth,
            biomeKey: biome.key,
            map,
            nodeId: null,
            choices: map.layers[0],
            path: [],
            atCheckpoint: false,
            floorReward: {},
            roomLoot: null,
            battle: null,
            encounter: null,
            mp: run.maxMp,
            sta: run.maxSta,
          };
          if (mode === 'rest') {
            // Rest: recover some HP, forgo this checkpoint's boon.
            next.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * 0.4));
          } else {
            // Press On: keep your wounds, take a boon instead.
            offerBoon(next, boonMaxTier(depth, deepestFloor));
          }
          return { dungeon: next, deepestFloor };
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

      chooseBoon: (relicKey) =>
        set((s) => {
          const run = s.dungeon;
          if (!run || !run.pendingBoon || !run.pendingBoon.includes(relicKey)) return s;
          const next: DungeonRun = { ...run, relics: [...run.relics, relicKey], pendingBoon: null };
          // Recompute maxHp so a +maxHp relic raises the gauge now (and grant the gained HP).
          const newMax = fighterFor({ ...s, dungeon: next }).c.maxHp;
          const gained = Math.max(0, newMax - run.maxHp);
          next.maxHp = newMax;
          next.hp = Math.min(newMax, run.hp + gained);
          return { dungeon: next };
        }),

      dungeonShrine: (choice) =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active' || currentRoom(run)?.type !== 'shrine') return s;
          let next: DungeonRun = { ...run };
          if (choice === 'pray') {
            // A check of your best spiritual stat: success blesses you, failure curses you.
            const power = Math.max(s.character.statLevels.WI, s.character.statLevels.CH);
            if (Math.random() < checkChance(power, 6)) {
              offerBoon(next, boonMaxTier(next.depth, s.deepestFloor));
            } else {
              const curse = rollCurse();
              if (curse) {
                next.relics = [...run.relics, curse];
                const newMax = fighterFor({ ...s, dungeon: next }).c.maxHp;
                next.maxHp = newMax;
                next.hp = Math.min(next.hp, newMax);
              }
            }
          } else if (choice === 'offer') {
            const cost = Math.round(run.maxHp * 0.25);
            if (run.hp <= cost) return s; // can't pay the toll
            next.hp = run.hp - cost;
            offerBoon(next, boonMaxTier(next.depth, s.deepestFloor));
          }
          // 'leave' = no effect. In every case, resolve the room and present the next path.
          return { dungeon: resolveCurrentNode(next, next.hp, next.mp, next.sta) };
        }),

      dungeonBuy: (offerId) =>
        set((s) => {
          const run = s.dungeon;
          if (!run || !run.merchant) return s;
          const offer = run.merchant.find((o) => o.id === offerId);
          if (!offer) return s;
          const free = s.settings.unlimitedGold;
          if (!free && s.character.gold < offer.cost) return s;
          const next: DungeonRun = { ...run, merchant: run.merchant.filter((o) => o.id !== offerId) };
          const patch: Partial<GameState> = {
            character: { ...s.character, gold: free ? s.character.gold : s.character.gold - offer.cost },
          };
          if (offer.kind === 'heal') {
            next.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * 0.4));
          } else if (offer.kind === 'potion' && offer.potionKey) {
            patch.inventory = { ...s.inventory, [offer.potionKey]: (s.inventory[offer.potionKey] ?? 0) + 1 };
          } else if (offer.kind === 'boon') {
            offerBoon(next, boonMaxTier(next.depth, s.deepestFloor));
          }
          return { dungeon: next, ...patch };
        }),

      dungeonRest: (choice) =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active' || currentRoom(run)?.type !== 'rest') return s;
          const next: DungeonRun = { ...run };
          if (choice === 'heal') {
            next.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * 0.4));
          } else {
            const choices = rollBoons(3, run.relics, 1); // a modest tier-1 boon
            next.pendingBoon = choices.length ? choices : null;
          }
          return { dungeon: resolveCurrentNode(next, next.hp, next.mp, next.sta) };
        }),

      dungeonLeaveRoom: () =>
        set((s) => {
          const run = s.dungeon;
          if (!run || run.status !== 'active' || currentRoom(run)?.type !== 'merchant') return s;
          return { dungeon: resolveCurrentNode(run, run.hp, run.mp, run.sta) };
        }),

      completeTrial: (trialId, score01) =>
        set((s) => {
          const today = toISODate();
          if (!s.settings.repeatMinigames && s.trialsClearedOn[trialId] === today) return s;
          const def = getTrial(trialId);
          const reward = trialReward(def.stat, score01, s.character.level);
          const next: GameState = {
            ...s,
            character: { ...s.character, statXp: { ...s.character.statXp } },
            inventory: { ...s.inventory },
            materials: { ...s.materials },
            ownedWeapons: [...s.ownedWeapons],
            ownedGear: [...s.ownedGear],
            trialsClearedOn: { ...s.trialsClearedOn, [trialId]: today },
            bestTrialScore: {
              ...s.bestTrialScore,
              [trialId]: Math.max(s.bestTrialScore[trialId] ?? 0, Math.max(0, Math.min(1, score01))),
            },
          };
          applyReward(next, reward);
          checkLevelUp(next);
          return next;
        }),

      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      devSetLevel: (target) =>
        set((s) => {
          const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(target)));
          // Seed statXp to exactly the total this level requires, spread across the stats,
          // so the derived level (and the XP bar) stays consistent and no trial is queued.
          const total = cumulativeXpToReach(level);
          const per = Math.floor(total / STAT_IDS.length);
          const remainder = total - per * STAT_IDS.length;
          const statXp = emptyStatXP();
          STAT_IDS.forEach((id, i) => {
            statXp[id] = per + (i === 0 ? remainder : 0);
          });
          return {
            character: {
              ...s.character,
              level,
              statXp,
              statXpAtLastLevel: { ...statXp },
            },
            pendingLevelUp: null,
          };
        }),

      devSetDeepestFloor: (n) =>
        set(() => ({ deepestFloor: Math.max(0, Math.floor(n)) })),

      devSpawnTrial: (level) =>
        set((s) => {
          if (s.battle) return s;
          const target = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
          const boss = bossForLevel(target);
          const battle = createBattle(fighterFor(s), boss, { lossesBefore: s.bossLosses[target] ?? 0 });
          return { pendingLevelUp: target, battle };
        }),

      devClearClass: () =>
        set((s) => ({ character: { ...s.character, classId: null } })),

      // --- Deep Mine (real-time mining minigame) ---
      beginMining: (seed?: number) =>
        set((s) => {
          // Seed the run's RNG: shared mulberry32 for co-op, Math.random for solo.
          mineRng = seed !== undefined ? mulberry32(seed) : Math.random;
          mineBaseSeed = seed;
          const free = s.settings.unlimitedEnergy;
          if (s.mining) return s;
          if (!free && s.character.energy < MINE_ENERGY_COST) return s;

          // Grant the stone_pickaxe if the player has no mining tool yet
          let ownedGear = s.ownedGear;
          let equipment = s.equipment;
          const hasMiningTool = ownedGear.some((k) => {
            const g = getGear(k);
            return g?.mining != null;
          });
          if (!hasMiningTool) {
            ownedGear = [...ownedGear, 'stone_pickaxe'];
            if (!equipment.tool) {
              equipment = { ...equipment, tool: 'stone_pickaxe' };
            }
          }

          // Build the snapshot with the (possibly updated) equipment
          const stateWithGear: typeof s = { ...s, ownedGear, equipment };
          const fighter = fighterFor(stateWithGear);
          const { c } = fighter;

          // Dungeon stamina is much larger than battle stamina (50 + EN from gear)
          const gear = gearBonuses(stateWithGear);
          const enBonus = gear.statBonuses.EN ?? 0;
          const maxSta = dungeonStamina(s.character.statLevels.EN + enBonus);

          // Pickaxe power from equipped tool gear
          const toolKey = equipment.tool;
          const toolGear = toolKey ? getGear(toolKey) : undefined;
          const pickaxePower = toolGear?.mining?.power ?? 0;
          // AG level for dash cooldown + move speed (gear bonuses included via fighter)
          const agBonus = (gearBonuses(stateWithGear).statBonuses.AG ?? 0);
          const agLevel = s.character.statLevels.AG + agBonus;

          const mining = generateMine(
            1,
            {
              meleePower: c.meleePower,
              rangedPower: c.rangedPower,
              damageSpell: c.damageSpell,
              supportSpell: c.supportSpell,
              illusionPower: c.illusionPower,
              defense: c.defense,
              ward: c.ward,
              maxHp: c.maxHp,
              maxSta,
              maxMp: c.maxMp,
              weapon: fighter.weapon,
              knownSpells: s.knownSpells,
              pickaxePower,
              agLevel,
            },
            // Floor 1 from the per-floor seed (co-op) so every client matches; solo
            // falls back to the live mineRng (Math.random).
            seed !== undefined ? mulberry32(floorSeed(seed, 1)) : mineRng,
          );
          return {
            character: {
              ...s.character,
              energy: free ? s.character.energy : s.character.energy - MINE_ENERGY_COST,
            },
            ownedGear,
            equipment,
            mining,
          };
        }),

      mineMove: (dir) =>
        set((s) => {
          if (!s.mining || s.mining.status !== 'active') return s;
          const mining = tryMove(s.mining, dir);
          // Boon cache pickup: walking onto a 'boon' tile triggers the choice panel.
          if (mining !== s.mining) {
            const { r, c } = mining.player;
            if (mining.tiles[r]?.[c]?.kind === 'boon') {
              const tiles = mining.tiles.map((row) => row.slice());
              tiles[r][c] = { kind: 'floor' };
              const choices = rollBoonChoices('mine', mining.activeBoons, mineRng);
              return {
                mining: {
                  ...mining,
                  tiles,
                  pendingBoonChoice: choices,
                  status: 'choosing' as const,
                },
              };
            }
          }
          return mining !== s.mining ? { mining } : s;
        }),

      mineStrike: () =>
        set((s) =>
          s.mining && s.mining.status === 'active' ? { mining: strike(s.mining, mineRng) } : s,
        ),

      mineStrikeCharged: () =>
        set((s) =>
          s.mining && s.mining.status === 'active'
            ? { mining: strike(s.mining, mineRng, Date.now(), true) }
            : s,
        ),

      mineDash: (dir, nowMs) =>
        set((s) =>
          s.mining && s.mining.status === 'active'
            ? { mining: mineTryDash(s.mining, dir, nowMs) }
            : s,
        ),

      mineTick: (nowMs, coPlayers) =>
        set((s) => {
          if (!s.mining || s.mining.status !== 'active') return s;
          const mining = stepMonsters(s.mining, nowMs, mineRng, coPlayers);
          if (mining === s.mining) return s;
          return { mining };
        }),

      coopClientTick: (nowMs) =>
        set((s) => {
          if (!s.mining || s.mining.status !== 'active') return s;
          const mining = coopClientStep(s.mining, nowMs);
          if (mining === s.mining) return s;
          return { mining };
        }),

      coopApplyWorld: (slice) =>
        set((s) => {
          if (!s.mining) return s;
          let mining = s.mining;

          // Follow the host's descent: when the host has moved to a deeper floor,
          // regenerate that floor from its per-floor seed (identical to the host's),
          // carrying our own hp/haul and clamped sta/mp forward.
          if (slice.floor !== mining.floor && mineBaseSeed !== undefined) {
            const next = generateMine(
              slice.floor,
              mineSnapshot(mining),
              mulberry32(floorSeed(mineBaseSeed, slice.floor)),
            );
            mining = {
              ...next,
              hp: mining.hp,
              sta: Math.min(next.maxSta, mining.sta),
              mp: Math.min(next.maxMp, mining.mp),
              haul: mining.haul,
              deepest: Math.max(mining.deepest, slice.floor),
            };
          }

          const byId = new Map(slice.monsters.map((m) => [m.id, m]));
          // Update positions/HP from the host; drop monsters the host has killed.
          // New host monsters absent locally are ignored — the seeded maps match.
          const merged = mining.monsters
            .filter((m) => byId.has(m.id))
            .map((m) => {
              const sl = byId.get(m.id)!;
              return { ...m, r: sl.r, c: sl.c, hp: sl.hp, readyAtMs: sl.readyAtMs };
            });
          // Phase 5: detect guardian kill on the host side so this guest can trigger its
          // own boon choice.  A guardian is gone when its id was present locally and is
          // absent from the host's monster list.
          const hostMonsterIds = new Set(slice.monsters.map((m) => m.id));
          const guardianJustKilled =
            mining.status === 'active' &&
            !mining.pendingBoonChoice &&
            mining.monsters.some(
              (m) => MINE_MONSTERS[m.key]?.isGuardian && !hostMonsterIds.has(m.id),
            );
          if (guardianJustKilled) {
            const choices = rollBoonChoices('mine', mining.activeBoons, mineRng);
            return { mining: { ...mining, monsters: merged, pendingBoonChoice: choices, status: 'choosing' as const } };
          }
          return { mining: { ...mining, monsters: merged } };
        }),

      coopApplyTile: (floor, r, c, tile) =>
        set((s) => {
          // Apply a peer's dig (rock/ore → floor, or durability decay) so resource
          // nodes vanish for everyone. Ignore events from a floor we've left.
          if (!s.mining || s.mining.floor !== floor) return s;
          const cur = s.mining.tiles[r]?.[c];
          if (!cur || cur === tile) return s;
          const tiles = s.mining.tiles.map((row) => row.slice());
          tiles[r][c] = tile;
          return { mining: { ...s.mining, tiles } };
        }),

      coopApplyRemoteAttack: (monsterId, dmg) =>
        set((s) => {
          if (!s.mining || s.mining.status !== 'active') return s;
          const mining = damageMonsterById(s.mining, monsterId, dmg, mineRng);
          if (mining === s.mining) return s;
          return { mining };
        }),

      mineDescend: () =>
        set((s) => {
          if (!s.mining || s.mining.status !== 'active') return s;
          // Generate the next floor from its per-floor seed (co-op parity); solo uses
          // the live stream. Independent of mineRng divergence on earlier floors.
          const nextFloor = s.mining.floor + 1;
          const genRng =
            mineBaseSeed !== undefined ? mulberry32(floorSeed(mineBaseSeed, nextFloor)) : mineRng;
          const mining = descend(s.mining, genRng);
          if (mining === s.mining) return s;
          return { mining, deepestMineFloor: Math.max(s.deepestMineFloor, mining.deepest) };
        }),

      mineCast: (spellKey: string) =>
        set((s) => {
          if (!s.mining || s.mining.status !== 'active') return s;
          const mining = minecastSpellFn(s.mining, spellKey, Date.now(), mineRng);
          if (mining === s.mining) return s;
          return { mining };
        }),

      chooseMineBoon: (key: string) =>
        set((s) => {
          if (!s.mining || s.mining.status !== 'choosing') return s;
          const mining = applyMineBoonChoice(s.mining, key);
          return mining !== s.mining ? { mining } : s;
        }),

      beginBanking: () =>
        set((s) =>
          s.mining && s.mining.status === 'active'
            ? { mining: { ...s.mining, status: 'banking' as const } }
            : s,
        ),

      // Death forfeits half the haul; a confirmed bank keeps it all.
      endMining: () =>
        set((s) =>
          !s.mining
            ? s
            : s.mining.status === 'ended'
              ? commitMineDeath(s, s.mining)
              : commitMining(s, s.mining),
        ),

      // --- Wild Forest (real-time foraging minigame) ---
      beginForest: (seed?: number) =>
        set((s) => {
          // Seed the run's RNG: shared mulberry32 for co-op, Math.random for solo.
          forestRng = seed !== undefined ? mulberry32(seed) : Math.random;
          forestBaseSeed = seed;
          const free = s.settings.unlimitedEnergy;
          if (s.forest) return s;
          if (!free && s.character.energy < FOREST_ENERGY_COST) return s;

          // Grant the stone_pickaxe (toolkit) if the player has no tool yet
          let ownedGear = s.ownedGear;
          let equipment = s.equipment;
          const hasAnyTool = ownedGear.some((k) => {
            const g = getGear(k);
            return g?.chopping != null || g?.mining != null;
          });
          if (!hasAnyTool) {
            ownedGear = [...ownedGear, 'stone_pickaxe'];
            if (!equipment.tool) {
              equipment = { ...equipment, tool: 'stone_pickaxe' };
            }
          }

          const stateWithGear: typeof s = { ...s, ownedGear, equipment };
          const fighter = fighterFor(stateWithGear);
          const { c } = fighter;
          const gear = gearBonuses(stateWithGear);
          const enBonus = gear.statBonuses.EN ?? 0;
          const maxSta = dungeonStamina(s.character.statLevels.EN + enBonus);

          // Chopping power from equipped tool gear
          const toolKey = equipment.tool;
          const toolGear = toolKey ? getGear(toolKey) : undefined;
          const chopPower = toolGear?.chopping?.power ?? 0;
          // AG level for dash cooldown + move speed
          const agBonusF = (gearBonuses(stateWithGear).statBonuses.AG ?? 0);
          const agLevelF = s.character.statLevels.AG + agBonusF;

          const forest = generateForest(
            1,
            {
              meleePower: c.meleePower,
              rangedPower: c.rangedPower,
              damageSpell: c.damageSpell,
              supportSpell: c.supportSpell,
              illusionPower: c.illusionPower,
              defense: c.defense,
              ward: c.ward,
              maxHp: c.maxHp,
              maxSta,
              maxMp: c.maxMp,
              weapon: fighter.weapon,
              knownSpells: s.knownSpells,
              chopPower,
              agLevel: agLevelF,
            },
            // Stage 1 from the per-stage seed (co-op parity); solo uses live forestRng.
            seed !== undefined ? mulberry32(floorSeed(seed, 1)) : forestRng,
          );
          return {
            character: {
              ...s.character,
              energy: free ? s.character.energy : s.character.energy - FOREST_ENERGY_COST,
            },
            ownedGear,
            equipment,
            forest,
          };
        }),

      forestMove: (dir) =>
        set((s) => {
          if (!s.forest || s.forest.status !== 'active') return s;
          const forest = forestTryMove(s.forest, dir);
          // Boon cache pickup: walking onto a 'boon' tile triggers the choice panel.
          if (forest !== s.forest) {
            const { r, c } = forest.player;
            if (forest.tiles[r]?.[c]?.kind === 'boon') {
              const tiles = forest.tiles.map((row) => row.slice());
              tiles[r][c] = { kind: 'trail' };
              const choices = rollBoonChoices('forest', forest.activeBoons, forestRng);
              return {
                forest: {
                  ...forest,
                  tiles,
                  pendingBoonChoice: choices,
                  status: 'choosing' as const,
                },
              };
            }
          }
          return forest !== s.forest ? { forest } : s;
        }),

      forestAct: () =>
        set((s) =>
          s.forest && s.forest.status === 'active' ? { forest: forestActFn(s.forest, forestRng) } : s,
        ),

      forestActCharged: () =>
        set((s) =>
          s.forest && s.forest.status === 'active'
            ? { forest: forestActFn(s.forest, forestRng, Date.now(), true) }
            : s,
        ),

      forestDash: (dir, nowMs) =>
        set((s) =>
          s.forest && s.forest.status === 'active'
            ? { forest: forestTryDash(s.forest, dir, nowMs) }
            : s,
        ),

      forestTick: (nowMs, coPlayers) =>
        set((s) => {
          if (!s.forest || s.forest.status !== 'active') return s;
          const forest = stepBeasts(s.forest, nowMs, forestRng, coPlayers);
          if (forest === s.forest) return s;
          // Death flips status to 'ended' but doesn't commit — the overlay shows the forfeit
          // first, then endForest banks the kept half (mirrors the mine's banking flow).
          return { forest };
        }),

      beginForestBanking: () =>
        set((s) =>
          s.forest && s.forest.status === 'active'
            ? { forest: { ...s.forest, status: 'banking' as const } }
            : s,
        ),

      forestAdvance: () =>
        set((s) => {
          if (!s.forest || s.forest.status !== 'active') return s;
          // Next stage from its per-stage seed (co-op parity); solo uses forestRng.
          const nextStage = s.forest.stage + 1;
          const genRng =
            forestBaseSeed !== undefined ? mulberry32(floorSeed(forestBaseSeed, nextStage)) : forestRng;
          const forest = forestAdvanceFn(s.forest, genRng);
          if (forest === s.forest) return s;
          return { forest, deepestForestStage: Math.max(s.deepestForestStage, forest.deepest) };
        }),

      forestCast: (spellKey: string) =>
        set((s) => {
          if (!s.forest || s.forest.status !== 'active') return s;
          const forest = forestCastSpellFn(s.forest, spellKey, Date.now(), forestRng);
          if (forest === s.forest) return s;
          return { forest };
        }),

      forestShrine: (nowMs: number) =>
        set((s) => {
          if (!s.forest || s.forest.status !== 'active') return s;
          const forest = forestActivateShrine(s.forest, nowMs, forestRng);
          if (forest === s.forest) return s;
          return { forest };
        }),

      chooseForestBoon: (key: string) =>
        set((s) => {
          if (!s.forest || s.forest.status !== 'choosing') return s;
          const forest = applyForestBoonChoice(s.forest, key);
          return forest !== s.forest ? { forest } : s;
        }),

      // --- Co-op Forest (mirrors the mine's coop actions) ---
      coopApplyForestWorld: (slice) =>
        set((s) => {
          if (!s.forest) return s;
          let forest = s.forest;

          // Follow the host's advance: regenerate the host's stage from its per-stage
          // seed, carrying our own hp/haul and clamped sta/mp forward.
          if (slice.floor !== forest.stage && forestBaseSeed !== undefined) {
            const next = generateForest(
              slice.floor,
              forestSnapshot(forest),
              mulberry32(floorSeed(forestBaseSeed, slice.floor)),
            );
            forest = {
              ...next,
              hp: forest.hp,
              sta: Math.min(next.maxSta, forest.sta),
              mp: Math.min(next.maxMp, forest.mp),
              haul: forest.haul,
              deepest: Math.max(forest.deepest, slice.floor),
            };
          }

          const byId = new Map(slice.monsters.map((m) => [m.id, m]));
          const merged = forest.beasts
            .filter((b) => byId.has(b.id))
            .map((b) => {
              const sl = byId.get(b.id)!;
              // Carry the host's `asleep` so a woken beast shows its HP bar on the guest.
              return {
                ...b,
                r: sl.r,
                c: sl.c,
                hp: sl.hp,
                readyAtMs: sl.readyAtMs,
                asleep: sl.asleep ?? b.asleep,
              };
            });
          // Phase 5: detect guardian kill on the host side so this guest can trigger boon.
          const hostBeastIds = new Set(slice.monsters.map((m) => m.id));
          const guardianJustKilled =
            forest.status === 'active' &&
            !forest.pendingBoonChoice &&
            forest.beasts.some(
              (b) => FOREST_BEASTS[b.key]?.isGuardian && !hostBeastIds.has(b.id),
            );
          if (guardianJustKilled) {
            const choices = rollBoonChoices('forest', forest.activeBoons, forestRng);
            return { forest: { ...forest, beasts: merged, pendingBoonChoice: choices, status: 'choosing' as const } };
          }
          return { forest: { ...forest, beasts: merged } };
        }),

      coopApplyForestTile: (stage, r, c, tile) =>
        set((s) => {
          if (!s.forest || s.forest.stage !== stage) return s;
          const cur = s.forest.tiles[r]?.[c];
          if (!cur || cur === tile) return s;
          const tiles = s.forest.tiles.map((row) => row.slice());
          tiles[r][c] = tile as ForestTile;
          return { forest: { ...s.forest, tiles } };
        }),

      coopApplyForestAttack: (beastId, dmg) =>
        set((s) => {
          if (!s.forest || s.forest.status !== 'active') return s;
          const forest = damageBeastById(s.forest, beastId, dmg, forestRng);
          if (forest === s.forest) return s;
          return { forest };
        }),

      coopForestClientTick: (nowMs) =>
        set((s) => {
          if (!s.forest || s.forest.status !== 'active') return s;
          const forest = forestCoopClientStep(s.forest, nowMs);
          if (forest === s.forest) return s;
          return { forest };
        }),

      // Death forfeits half the haul; a confirmed bank keeps it all.
      endForest: () =>
        set((s) =>
          !s.forest
            ? s
            : s.forest.status === 'ended'
              ? commitForestDeath(s, s.forest)
              : commitForest(s, s.forest),
        ),

      // --- The Arena (real-time hex boss fight) ---
      beginArena: () =>
        set((s) => {
          const free = s.settings.unlimitedEnergy;
          if (s.arena || s.character.level < ARENA_UNLOCK_LEVEL) return s;
          if (!free && s.character.energy < ARENA_ENERGY_COST) return s;
          const tier = Math.max(ARENA_UNLOCK_LEVEL, Math.min(MAX_LEVEL, s.character.level));
          const setup = rollArenaSetup(tier, Math.random);
          const arena = createArena(fighterFor(s), bossForLevel(tier), {
            knownSpells: s.knownSpells,
            inventory: s.inventory,
            tier,
            startMs: performance.now(),
            rng: Math.random,
            radius: setup.radius,
            density: setup.density,
            startMinions: setup.startMinions,
            speed: arenaSpeedFactor(s.settings.arenaSpeed, s.character.level),
            invincible: s.settings.invincible,
          });
          return {
            character: {
              ...s.character,
              energy: free ? s.character.energy : s.character.energy - ARENA_ENERGY_COST,
            },
            arena,
          };
        }),

      arenaMove: (dir) =>
        set((s) =>
          s.arena && s.arena.status === 'active' ? { arena: arenaMoveFn(s.arena, dir) } : s,
        ),

      arenaAct: (nowMs, dir) =>
        set((s) => {
          if (!s.arena || s.arena.status !== 'active') return s;
          const arena = arenaActFn(s.arena, nowMs, Math.random, dir);
          return arena === s.arena ? s : { arena };
        }),

      arenaMelee: (nowMs, dir) =>
        set((s) => {
          if (!s.arena || s.arena.status !== 'active') return s;
          const arena = arenaMeleeFn(s.arena, nowMs, Math.random, dir);
          return arena === s.arena ? s : { arena };
        }),

      arenaRanged: (nowMs, dir) =>
        set((s) => {
          if (!s.arena || s.arena.status !== 'active') return s;
          const arena = arenaRangedFn(s.arena, nowMs, Math.random, dir);
          return arena === s.arena ? s : { arena };
        }),

      arenaCast: (spellKey, nowMs, opts) =>
        set((s) => {
          if (!s.arena || s.arena.status !== 'active') return s;
          const arena = arenaCastFn(s.arena, spellKey, nowMs, Math.random, opts);
          return arena === s.arena ? s : { arena };
        }),

      arenaUseItem: (itemKey, nowMs) =>
        set((s) => {
          if (!s.arena || s.arena.status !== 'active') return s;
          const arena = arenaUseItemFn(s.arena, itemKey, nowMs);
          return arena === s.arena ? s : { arena };
        }),

      arenaTick: (nowMs) =>
        set((s) => {
          if (!s.arena || s.arena.status !== 'active') return s;
          const arena = arenaTickFn(s.arena, nowMs, Math.random);
          return arena === s.arena ? s : { arena };
        }),

      beginArenaBanking: () =>
        set((s) =>
          s.arena && s.arena.status === 'active'
            ? { arena: { ...s.arena, status: 'banking' as const } }
            : s,
        ),

      endArena: () => set((s) => (s.arena ? commitArena(s, s.arena) : s)),

      beginTactics: () =>
        set((s) => {
          const free = s.settings.unlimitedEnergy;
          if (s.tactics || s.character.level < TACTICS_UNLOCK_LEVEL) return s;
          if (!free && s.character.energy < TACTICS_ENERGY_COST) return s;
          const tier = Math.max(TACTICS_UNLOCK_LEVEL, Math.min(MAX_LEVEL, s.character.level));
          const tactics = generateSkirmish(fighterFor(s), s.character.statLevels.AG, tier, s.knownSpells, {
            radius: TACTICS_SIZE_RADIUS[s.settings.tacticsSize],
            rng: Math.random,
          });
          return {
            character: {
              ...s.character,
              energy: free ? s.character.energy : s.character.energy - TACTICS_ENERGY_COST,
            },
            tactics,
          };
        }),

      tacticsSelect: (action) =>
        set((s) => (s.tactics && s.tactics.status === 'active' ? { tactics: tacticsSelectFn(s.tactics, action) } : s)),

      tacticsMove: (to) =>
        set((s) => {
          if (!s.tactics || s.tactics.status !== 'active') return s;
          const tactics = tacticsMoveFn(s.tactics, to);
          return tactics === s.tactics ? s : { tactics };
        }),

      tacticsAttack: (target) =>
        set((s) => {
          if (!s.tactics || s.tactics.status !== 'active') return s;
          const tactics = tacticsAttackFn(s.tactics, target, Math.random);
          return tactics === s.tactics ? s : { tactics };
        }),

      tacticsCast: (spellKey, target) =>
        set((s) => {
          if (!s.tactics || s.tactics.status !== 'active') return s;
          const tactics = tacticsCastFn(s.tactics, spellKey, target, Math.random);
          return tactics === s.tactics ? s : { tactics };
        }),

      tacticsEndTurn: () =>
        set((s) => {
          if (!s.tactics || s.tactics.status !== 'active') return s;
          const tactics = tacticsEndTurnFn(s.tactics, Math.random);
          return tactics === s.tactics ? s : { tactics };
        }),

      endTactics: () => set((s) => (s.tactics ? commitTactics(s, s.tactics) : s)),

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
          mining: null,
          deepestMineFloor: 0,
          bestMineScore: 0,
          forest: null,
          deepestForestStage: 0,
          bestForestScore: 0,
          arena: null,
          deepestArenaTier: 0,
          tactics: null,
          deepestTacticsTier: 0,
          trialsClearedOn: emptyTrialsClearedOn(),
          bestTrialScore: emptyBestTrialScore(),
          pendingLevelUp: null,
          pendingClassChoice: null,
          bossLosses: {},
          completionLog: {},
          lastActiveISO: toISODate(),
          settings: freshSettings(),
          created: false,
        })),
    }),
    {
      name: 'habits-rpg-save',
      version: 19,
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
        return { ...p, habits, materials, challenges, character, battle: null, dungeon: null, mining: null, forest: null, arena: null, tactics: null, created: true, trialsClearedOn: p.trialsClearedOn ?? emptyTrialsClearedOn(), bestTrialScore: p.bestTrialScore ?? emptyBestTrialScore() } as GameState;
      },
      // Deep-merge the nested `character`/`settings` objects so fields added in later versions
      // (e.g. statLevels) always fall back to their defaults instead of being dropped by the
      // default shallow merge — which would replace the whole object and crash the UI.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<GameState>;
        return {
          ...current,
          ...p,
          character: withCharacterDefaults(p.character),
          settings: { ...current.settings, ...(p.settings ?? {}) },
          trialsClearedOn: { ...emptyTrialsClearedOn(), ...(p.trialsClearedOn ?? {}) },
          bestTrialScore: { ...emptyBestTrialScore(), ...(p.bestTrialScore ?? {}) },
        };
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
