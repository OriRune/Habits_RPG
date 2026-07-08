/**
 * GameState shape and its sub-interfaces + the simple fresh* initializers.
 *
 * Split out of shared.ts (ARCH-10): this is the *type surface* of the persisted store —
 * GameState (state fields + action signatures), every sub-interface, and the small
 * default/initializer helpers. It imports only engine/ types (no store/net/react), and is
 * re-exported from shared.ts so existing `'@/store/shared'` importers keep resolving.
 */
import { type StatId, emptyStatXP } from '@/engine/stats';
import { type Mood } from '@/engine/mood';
import { type Difficulty } from '@/engine/xp';
import { type PaletteColors } from '@/engine/palettes';
import { type Habit, type HabitType, type Frequency } from '@/engine/habits';
import { emptyStatLevels } from '@/engine/progression';
import { type PendingClassChoice } from '@/engine/classes';
import { type BattleState, type CombatAction } from '@/engine/combat';
import { type CombatStats } from '@/engine/combatStats';
import { type GearSlot } from '@/engine/gear';
import {
  type ActiveChallenge,
  type ChallengeDef,
  type ChallengeKind,
  type Reward,
} from '@/engine/challenges';
import { type WeeklyReport } from '@/engine/weekly';
import { type DungeonRun } from '@/engine/dungeonTypes';
import { type MineState, type MineTile, type Dir } from '@/engine/mining';
import { type ForestState, type ForestTile } from '@/engine/forest';
import { type ArenaState, type ArenaSpeed } from '@/engine/arena';
import {
  type HexBattleState,
  type SelectedAction as TacticsAction,
  type TacticsSize,
  type HeroOpts,
} from '@/engine/hexBattle';
import type { Hex } from '@/engine/hex';
import type { Dir as GridDir, Cell as GridCell } from '@/engine/grid';
import { type TrialId, type TrialBeginResult } from '@/engine/trials/trials';
import { type EarningsLedger, type EnergyLogEntry } from '@/engine/balance';
import { type ForgeBoosts } from '@/engine/crafting/forge';
import { type TownState } from '@/engine/town';

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
  /**
   * Cumulative *minigame-trickle* portion of statXp (the passive per-run XP from Mine/Forest/Arena/
   * Tactics commits). A sub-ledger of statXp — never larger than it. Level-up allocation discounts
   * this slice to MINIGAME_XP_ALLOCATION_WEIGHT so grinding can't dominate stat-point distribution
   * (BAL-09). Does not affect leveling pace. Backfilled to zero on old saves (v30).
   */
  statXpTrickle: Record<StatId, number>;
  /** Snapshot of statXpTrickle at the last level-up (paired with statXpAtLastLevel). */
  statXpTrickleAtLastLevel: Record<StatId, number>;
  gold: number;
  energy: number;
  classId: string | null;
  mood: Mood;
  /** Minigame-gold multiplier (1.0–1.25) earned by keeping habits on-streak (§6.3). */
  habitBonus: number;
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
  /** Opt-in: share active habit names, streaks, and today's status with party members only. */
  shareHabitNames: boolean;
  /** Show the "before adventure" ritual modal when entering a minigame (reviewable Energy sources). */
  showAdventureRitual: boolean;
  /**
   * Show a browser notification at `dailyReminderTime` once per day when a tab is open.
   * Requires Notification permission (prompted on first enable). Foreground-only — no
   * service worker; falls back to an in-app toast if permission is denied.
   */
  dailyReminderEnabled: boolean;
  /** 24-hour HH:MM time string for the daily reminder (e.g. '20:00'). */
  dailyReminderTime: string;
}

/** Lightweight record of a completed run — kept in `dungeonHistory` (last 10). */
export interface DungeonRunSummary {
  depth: number;
  cleared: boolean;
  defeated: boolean;
  date: string;
  /** Rooms entered during this run (for the history list). */
  roomsCleared: number;
  /** Number of relics (boons + curses) held at run end. */
  relicCount: number;
  /** Gold banked (post habit-streak multiplier). */
  goldBanked: number;
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
  /** Forge quality tier per crafted gear key (CraftTier 0–3; absent key = Normal). */
  gearQuality: Record<string, number>;
  /** Forge quality tier per crafted weapon key (CraftTier 0–3; absent key = Normal). */
  weaponQuality: Record<string, number>;
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
  /**
   * Tombstone from the miner's most recent death — the lost half of the haul, keyed
   * by the floor number they fell on. Set by commitMineDeath; cleared when recovered.
   * A new death before recovery replaces the previous tombstone.
   */
  mineTombstone: { floor: number; haul: Reward } | null;
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
  /** MINI-11: monotonic attempt counter XOR'd into the deterministic trials' daily seed
   *  so abandon+reopen draws a fresh challenge. Persisted (survives refresh). */
  trialAttemptNonce: number;
  /** MINI-16: Spirit Grove round ids the player has been shown; drafts bias toward unseen. */
  spiritGroveSeen: string[];
  /** Target level the player is currently trying to reach (boss is live or pending). */
  pendingLevelUp: number | null;
  pendingClassChoice: PendingClassChoice | null;
  /** Boss losses per target level, drives anti-frustration scaling. */
  bossLosses: Record<number, number>;
  /** Dungeon floor-boss losses keyed by boss id (`${baseId}_d${depth}`), drives per-fight relief. */
  dungeonBossLosses: Record<string, number>;
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
  /** False until the player dismisses the first-run welcome card on the dashboard. */
  hasSeenWelcome: boolean;
  /** False until the player dismisses or accepts the one-time "enable daily reminder" card. */
  reminderCardDismissed: boolean;
  /** Party quest IDs whose gold reward has already been credited locally (prevents double-credit). */
  claimedPartyQuests: string[];
  /**
   * Cumulative XP/gold/count tallied per earning source since save v25.
   * Drives the balance report in Settings → Developer.
   */
  earnings: EarningsLedger;
  /** Per-day Energy earned/spent (ISO date → {earned, spent}), mirrors completionLog format. */
  energyLog: Record<string, EnergyLogEntry>;
  /** The Homestead — persistent town-builder state (deeds, buildings, decor, labor queue). */
  town: TownState;

  // --- actions ---
  /** Commit the character-creation screen: seed name, starting stat levels, weapon, and spell. */
  dismissWelcome: () => void;
  /** Dismiss the one-time daily-reminder offer card (also called when the offer is accepted). */
  dismissReminderCard: () => void;
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
  /** Mark or unmark a habit as a weekly focus. Capped at MAX_FOCUS_HABITS; ignores if at cap and focus=true. */
  setHabitFocus: (id: string, focus: boolean) => void;
  /** Suspend every active habit whose id is NOT in keepIds, until untilISO. Recovery helper. */
  batchSuspendHabits: (keepIds: Set<string>, untilISO: string) => void;
  /** Flip any suspensions whose date has passed back to active (call on mount). */
  normalizeHabits: () => void;
  /** Merge imported habits by id; recomputes completionLog from the merged set. */
  importHabits: (imported: Habit[]) => void;

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
  /** Retroactively repair the most recent missed scheduled day, bridging a broken streak. */
  useRecoveryElixir: (habitId: string) => void;
  /** Credit the flat party-quest gold reward to this player once; idempotent on the same questId. */
  claimPartyQuestReward: (questId: string, memberCount: number) => void;

  equipWeapon: (weaponKey: string) => void;
  buyWeapon: (weaponKey: string) => void;
  buyGear: (gearKey: string) => void;
  learnFromSpellbook: (itemKey: string) => void;
  craft: (recipeKey: string, score01?: number, boosts?: ForgeBoosts) => void;
  /** Re-forge an owned, below-Masterwork gear/weapon: gold sink + 1 anchor material (§5). */
  reforge: (recipeKey: string, score01: number, boosts?: ForgeBoosts) => void;
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
  /** `startFloor` (co-op) pins the shared floor; omitted = solo deeper-start (BAL-25). */
  beginMining: (seed?: number, startFloor?: number) => void;
  /** Step/turn the miner one cell. */
  mineMove: (dir: Dir) => void;
  /** Swing the pick at the faced cell (dig rock/ore or hit a monster). */
  mineStrike: () => void;
  /** Charged heavy swing — higher damage, staggers monsters, clears rock faster.
   *  `nowMs` is the caller's rAF-clock timestamp — same timebase as mineTick. */
  mineStrikeCharged: (nowMs: number) => void;
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
    /** Host clock (ms) when produced — used by the staleness guard; ignored by the reducer. */
    t?: number;
    floor: number;
    monsters: ReadonlyArray<{ id: string; r: number; c: number; hp: number; readyAtMs: number }>;
  }) => void;
  /** Co-op: apply a peer's tile change (shared resource nodes). */
  coopApplyTile: (floor: number, r: number, c: number, tile: MineTile) => void;
  /** Co-op: apply a host's one-shot changed-tiles snapshot when joining mid-run (MP-25). */
  coopApplyTileSnapshot: (floor: number, entries: ReadonlyArray<{ r: number; c: number; tile: MineTile }>) => void;
  /** Co-op host: resolve a remote player's melee attack on a monster (once). */
  coopApplyRemoteAttack: (monsterId: string, dmg: number) => void;
  /** Descend the shaft to a deeper, richer floor. */
  mineDescend: () => void;
  /** Cast a known spell by key (costs MP). `nowMs` is the caller's rAF-clock timestamp. */
  mineCast: (spellKey: string, nowMs: number) => void;
  /** Pick a boon from the pending 3-card choice (mine). */
  chooseMineBoon: (key: string) => void;
  /** Dismiss the boon panel without picking (mine) — escape hatch if no option appeals (or none exist). */
  skipMineBoon: () => void;
  /** Pause the run and show the banking summary screen. */
  beginBanking: () => void;
  /** Commit the haul into the economy and close the run (death or confirmed banking). */
  endMining: () => void;

  // Wild Forest (real-time foraging minigame; see src/engine/forest.ts).
  /** Start a run: gate on energy, charge energy, generate stage 1. `seed` shares the map in co-op. */
  /** `startStage` (co-op) pins the shared stage; omitted = solo deeper-start (BAL-25). */
  beginForest: (seed?: number, startStage?: number) => void;
  /** Step/turn the forager one cell (re-lights the fog). */
  forestMove: (dir: Dir) => void;
  /** Act on the faced cell (slash a beast or gather a node).
   *  `nowMs` is the caller's rAF-clock timestamp — same timebase as forestTick. */
  forestAct: (nowMs: number) => void;
  /** Charged heavy act — higher damage, staggers beasts, chops trees faster.
   *  `nowMs` is the caller's rAF-clock timestamp — same timebase as forestTick. */
  forestActCharged: (nowMs: number) => void;
  /** Dash in `dir` in the forest (AG-gated cooldown; grants brief i-frame + re-lights fog). */
  forestDash: (dir: Dir, nowMs: number) => void;
  /** Advance beasts on the loop's clock; flips the run to 'ended' if the forager falls. */
  /** `coPlayers` (co-op) lets beasts target the nearest of all players. */
  forestTick: (nowMs: number, coPlayers?: ReadonlyArray<{ r: number; c: number }>) => void;
  /** Pause the run and show the banking summary screen (voluntary leave). */
  beginForestBanking: () => void;
  /** Stash 80% of the current haul into the economy mid-run. Only works on clearing tiles. */
  forestStash: () => void;
  /** Push on through the far tree line into a deeper, richer stage. */
  forestAdvance: () => void;
  /** Cast a known spell in the forest run. `nowMs` is the caller's rAF-clock timestamp. */
  forestCast: (spellKey: string, nowMs: number) => void;
  /**
   * Activate the shrine the forager is standing on.
   * `allowDenSpawn` — false for co-op guests so the den beast only lives in the host's world.
   */
  forestShrine: (nowMs: number, allowDenSpawn?: boolean) => void;
  /** Co-op guest: apply the host's authoritative forest world — follow stage + beasts. */
  coopApplyForestWorld: (slice: {
    /** Host clock (ms) when produced — used by the staleness guard; ignored by the reducer. */
    t?: number;
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
  /** Co-op: apply a host's one-shot changed-tiles snapshot when joining mid-run (MP-25). */
  coopApplyForestTileSnapshot: (stage: number, entries: ReadonlyArray<{ r: number; c: number; tile: ForestTile }>) => void;
  /** Co-op host: resolve a remote player's melee attack on a beast (once). */
  coopApplyForestAttack: (beastId: string, dmg: number) => void;
  /** Co-op guest per-tick: advance only own body (regen + contact damage). */
  coopForestClientTick: (nowMs: number) => void;
  /** Pick a boon from the pending 3-card choice (forest). */
  chooseForestBoon: (key: string) => void;
  /** Dismiss the boon panel without picking (forest) — escape hatch if no option appeals (or none exist). */
  skipForestBoon: () => void;
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
  beginTactics: (loadout?: string[], chosenTier?: number) => void;
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
  completeTrial: (trialId: TrialId, score01: number) => boolean;
  /**
   * 6.7: evaluate the daily-clear / energy / stat gates and, on success, charge 1 energy and
   * bump the attempt nonce (MINI-11). Called when a trial run begins (not on completion).
   */
  beginTrial: (trialId: TrialId) => TrialBeginResult;
  /** MINI-16: record Spirit Grove round ids as seen (unions + dedups). Called on completion only. */
  markSpiritGroveSeen: (ids: string[]) => void;

  // Developer testing tools (Settings → Developer). Jump straight to level-locked content.
  /** Direct level jump: seed statXp to match `target` so all level gates open at once. */
  devSetLevel: (target: number) => void;
  /** Set the deepest dungeon floor reached (unlocks Merchant/Elite/Tier-3 relic rooms). */
  devSetDeepestFloor: (n: number) => void;
  /** Open a Level-Up Trial boss fight for `level` immediately. */
  devSpawnTrial: (level: number) => void;
  /** Strip the current class so it can be reassigned. */
  devClearClass: () => void;
  /** Fill energy to the cap (for testing economy without Unlimited Energy). */
  devFillEnergy: () => void;
  /** Add a specific gold amount (for testing shop/craft flows). */
  devAddGold: (amount: number) => void;
  /** Rewind the week sentinel so the next checkWeeklyRollover fires immediately. */
  devForceWeeklyRollover: () => void;
  /** Reset the earnings ledger and energy log in isolation (no full game reset needed). */
  devResetEarnings: () => void;

  // The Homestead (town-builder; see src/engine/town.ts). All charge gold+materials at queue time.
  /** Queue a new building at (r,c): validate placement, escrow cost, drain banked labor. */
  townQueueBuild: (key: string, r: number, c: number, rot?: 0 | 1) => void;
  /** Queue an upgrade of an existing building to its next tier (escrow cost). */
  townQueueUpgrade: (buildingId: string) => void;
  /** Cancel a queued project: 100% materials refund, 0% gold, applied labor forfeited. */
  townCancelProject: (projectId: string) => void;
  /** Buy the next land deed (pure gold), gated on prestige and deeds < 3. */
  townBuyDeed: () => void;
  /** Place a decor prop at (r,c): charge gold+materials, roll a cosmetic variant. */
  townPlaceDecor: (key: string, r: number, c: number) => void;
  /** Remove the decor at (r,c): refund 50% of its materials. */
  townRemoveDecor: (r: number, c: number) => void;
  /** Demolish a building: refund 50% of cumulative tier materials, 0% gold (Keep is undemolishable). */
  townDemolish: (buildingId: string) => void;
  /** Relocate a building (free); blocked while a project targets it. */
  townMoveBuilding: (buildingId: string, r: number, c: number, rot?: 0 | 1) => void;

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
    statXpTrickle: emptyStatXP(),
    statXpTrickleAtLastLevel: emptyStatXP(),
    gold: 0,
    energy: 0,
    classId: null,
    mood: 'steady',
    habitBonus: 1,
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
    shareHabitNames: false,
    showAdventureRitual: true,
    dailyReminderEnabled: false,
    dailyReminderTime: '20:00',
  };
}
