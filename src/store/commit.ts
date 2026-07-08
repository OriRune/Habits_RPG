/**
 * Store-side reward + run-commit orchestration (ARCH-10 split from shared.ts).
 *
 * These helpers take/return the hand-written GameState interface: they call the pure engine
 * reward/combat/dungeon rules and write the results back into store state. They stay in the
 * store layer (not the engine) because of that GameState coupling. Re-exported from shared.ts
 * (`export * from './commit'`) so existing '@/store/shared' importers keep resolving.
 */
import { type StatId, STAT_IDS, emptyStatXP } from '@/engine/stats';
import { levelForTotalXp } from '@/engine/leveling';
import {
  allocateStatGains,
  POINTS_PER_LEVEL,
  MINIGAME_XP_ALLOCATION_WEIGHT,
  MAX_LEVEL,
  BOSS_GATE_LEVEL,
} from '@/engine/progression';
import {
  assignClass,
  rankStats,
  CLASS_UNLOCK_LEVEL,
  buildClassChoice,
} from '@/engine/classes';
import {
  type BattleState,
  type CombatAction,
  type Fighter,
  deriveCombatant,
  createBattle,
  playerAction,
} from '@/engine/combat';
import { getWeapon, type WeaponDef } from '@/engine/weapons';
import { type GearDef, getGear, aggregateGear } from '@/engine/gear';
import { asCraftTier, scaleGearDef, scaleWeaponDef } from '@/engine/crafting';
import { getRelic, aggregateRelics } from '@/engine/relics';
import { type Reward } from '@/engine/challenges';
import { mergeReward, resolveTreasure, merchantOffers } from '@/engine/dungeon';
import { townPerks } from '@/engine/town';
import { type DungeonRun } from '@/engine/dungeonTypes';
import { currentRoom } from '@/engine/dungeonRun';
import {
  type MineState,
  MINE_DEATH_KEEP,
  MINE_STASH_KEEP,
  MINE_TOMBSTONE_RECOVER_KEEP,
  isMineSafeBankTile,
} from '@/engine/mining';
import {
  type ForestState,
  FOREST_DEATH_KEEP,
  FOREST_STASH_KEEP,
  isForestSafeBankTile,
} from '@/engine/forest';
import {
  type ArenaState,
  arenaReward,
  damageProgress,
} from '@/engine/arena';
import { type HexBattleState, tacticsReward } from '@/engine/hexBattle';
import { dungeonStamina, splitHaul } from '@/engine/crawl';
import { getBiome, bossFor } from '@/engine/biomes';
import { getEncounter, startEncounter } from '@/engine/encounters';
import { enemyFor } from '@/engine/enemies';
import { toISODate } from '@/engine/date';
import {
  type EarningSource,
  type EarningsLedger,
  freshEarningsLedger,
  CRAWLER_XP_BASE,
  CRAWLER_XP_PER_DEPTH,
  MINIGAME_XP_BASE,
  MINIGAME_XP_PER_TIER,
  MINIGAME_XP_LOSS_FACTOR,
  ARENA_XP_DAMAGE_FLOOR,
  ARENA_XP_DAMAGE_SCALE,
} from '@/engine/balance';
import { type GameState, totalXp } from './gameState';

// ---------------------------------------------------------------------------
// Combat / gear helpers
// ---------------------------------------------------------------------------

/** Equipped gear pieces (skips empty slots), with Forge quality scaling applied.
 *  Absent quality entry ⇒ Normal ⇒ the def is returned as-is (shop/loot items, old saves). */
export function gearFor(state: GameState): GearDef[] {
  return (Object.values(state.equipment) as (string | null)[])
    .map((key) => (key ? getGear(key) : undefined))
    .filter((g): g is GearDef => g !== undefined)
    .map((g) => scaleGearDef(g, asCraftTier(state.gearQuality[g.key])));
}

/** The equipped weapon with Forge quality scaling on `bonus` — the single combat weapon
 *  seam (every battle type resolves its weapon through fighterFor below). Display-only
 *  weapon lookups elsewhere may still call getWeapon raw; combat must come through here. */
export function equippedWeaponDef(state: GameState): WeaponDef {
  const w = getWeapon(state.equippedWeapon);
  return scaleWeaponDef(w, asCraftTier(state.weaponQuality[state.equippedWeapon]));
}

export function gearBonuses(state: GameState) {
  return aggregateGear(gearFor(state));
}

/** The stat-bonus map that applies to the character during a dungeon run: gear + run-only
 *  relics + triggered run-buff + active lowHp relic triggers, all merged additively.
 *  This is the single source of truth for "what the run has done to my stats" — it feeds
 *  combat (via fighterFor) AND, per MINI-27, the encounter/shrine stat checks, so a relic
 *  that promises "+2 WI for this run" actually helps the shrine/skill checks its text names. */
export function runStatBonuses(state: GameState): Partial<Record<StatId, number>> {
  const merged: Partial<Record<StatId, number>> = {};
  const add = (m: Partial<Record<StatId, number>> | undefined) => {
    if (!m) return;
    for (const [stat, n] of Object.entries(m)) merged[stat as StatId] = (merged[stat as StatId] ?? 0) + (n ?? 0);
  };
  add(gearBonuses(state).statBonuses);
  // Run-only relics + persistent run-buff (e.g. onShrine stacking) apply during a dungeon only.
  const relicDefs = (state.dungeon?.relics ?? []).map(getRelic);
  add(aggregateRelics(relicDefs).statBonuses);
  add(state.dungeon?.runBuff);
  // Conditional lowHp triggers — active while hp/maxHp < threshold.
  const hpRatio = (state.dungeon?.hp ?? 0) / Math.max(1, state.dungeon?.maxHp ?? 1);
  for (const def of relicDefs) {
    if (def?.trigger?.type === 'lowHp' && hpRatio < def.trigger.threshold) add(def.trigger.statBonuses);
  }
  return merged;
}

/** Build the acting Fighter from current character state (+ optional in-battle buffs).
 *  Exported so the co-op hook can compute a HeroOpts snapshot for the local player. */
export function fighterFor(state: GameState, buffs: Partial<Record<StatId, number>> = {}): Fighter {
  const gear = gearBonuses(state);
  // Fold the run stat bonuses (gear + relics + runBuff + lowHp stat triggers) into the buffs
  // map deriveCombatant understands. Shared with the encounter/shrine path via runStatBonuses.
  const merged: Partial<Record<StatId, number>> = { ...buffs };
  for (const [stat, n] of Object.entries(runStatBonuses(state))) {
    merged[stat as StatId] = (merged[stat as StatId] ?? 0) + (n ?? 0);
  }
  // Defense/ward/maxHp aren't stat bonuses — accumulate them separately from the relic aggregate.
  const relicDefs = (state.dungeon?.relics ?? []).map(getRelic);
  const relicAgg = aggregateRelics(relicDefs);
  const hpRatio = (state.dungeon?.hp ?? 0) / Math.max(1, state.dungeon?.maxHp ?? 1);
  let lowHpDefense = 0;
  for (const def of relicDefs) {
    if (def?.trigger?.type === 'lowHp' && hpRatio < def.trigger.threshold && def.trigger.defense) {
      lowHpDefense += def.trigger.defense;
    }
  }
  const c = deriveCombatant(state.character.statLevels, state.character.level, state.combatStats, merged);
  c.defense += gear.defense + relicAgg.defense + lowHpDefense;
  c.ward += gear.ward + relicAgg.ward;
  c.maxHp += relicAgg.maxHp;
  return { c, weapon: equippedWeaponDef(state) };
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

/**
 * Resolve one player combat turn against `battle`: applies the action, tops up on invincible,
 * and consumes a used item from a cloned inventory. Shared by the level-up trial (`s.battle`) and
 * the dungeon fight (`s.dungeon.battle`) — each slice adapts the returned battle into its own shape.
 */
export function resolveBattleAction(
  battle: BattleState,
  s: GameState,
  action: CombatAction,
): { battle: BattleState; inventory: GameState['inventory'] } {
  let next = playerAction(battle, fighterFor(s, battle.buffs), action);
  if (s.settings.invincible) next = topUpFighter(next);

  const inventory = { ...s.inventory };
  if (action.kind === 'item' && (inventory[action.itemKey] ?? 0) > 0) {
    inventory[action.itemKey] -= 1;
  }
  return { battle: next, inventory };
}

/** The gear/fighter snapshot shared by the mine and forest run openers. */
export interface CrawlerLoadout {
  ownedGear: GameState['ownedGear'];
  equipment: GameState['equipment'];
  fighter: Fighter;
  c: Fighter['c'];
  maxSta: number;
  agLevel: number;
}

/**
 * Shared beginMining/beginForest preamble: grants a starter `stone_pickaxe` when the player has
 * no qualifying tool (`hasTool` decides — the mine wants a pickaxe, the forest any pickaxe/axe),
 * snapshots the acting fighter against the possibly-updated gear, and derives the crawler's larger
 * dungeon stamina plus the AG level that drives dash/move speed. Each caller reads its own tool
 * power (pickaxe vs chop) from the returned `equipment`.
 */
export function crawlerLoadout(
  s: GameState,
  hasTool: (g: GearDef) => boolean,
): CrawlerLoadout {
  let ownedGear = s.ownedGear;
  let equipment = s.equipment;
  const hasAnyTool = ownedGear.some((k) => {
    const g = getGear(k);
    return g != null && hasTool(g);
  });
  if (!hasAnyTool) {
    ownedGear = [...ownedGear, 'stone_pickaxe'];
    if (!equipment.tool) {
      equipment = { ...equipment, tool: 'stone_pickaxe' };
    }
  }

  // Build the snapshot with the (possibly updated) equipment.
  const stateWithGear: GameState = { ...s, ownedGear, equipment };
  const fighter = fighterFor(stateWithGear);
  const { c } = fighter;

  // Dungeon stamina is much larger than battle stamina (50 + EN from gear).
  const gear = gearBonuses(stateWithGear);
  const enBonus = gear.statBonuses.EN ?? 0;
  // Homestead Bathhouse (stamina perk) deepens the crawler stamina reserve at run start (+10).
  const maxSta = dungeonStamina(s.character.statLevels.EN + enBonus) + townPerks(s.town).staminaBonus;
  // AG level for dash cooldown + move speed (gear bonuses included).
  const agBonus = gear.statBonuses.AG ?? 0;
  const agLevel = s.character.statLevels.AG + agBonus;

  return { ownedGear, equipment, fighter, c, maxSta, agLevel };
}

// ---------------------------------------------------------------------------
// Reward / level helpers
// ---------------------------------------------------------------------------

/** Sources whose statXp is passive-grind "trickle" — tracked separately for BAL-09 allocation weighting. */
const TRICKLE_SOURCES: ReadonlySet<EarningSource> = new Set<EarningSource>(['mine', 'forest', 'arena', 'tactics']);

export function applyReward(state: GameState, reward: Reward, source?: EarningSource): void {
  const goldGained = reward.gold ?? 0;
  if (goldGained) state.character.gold += goldGained;
  let xpGained = 0;
  if (reward.statXp) {
    // Passive minigame XP also lands in the trickle sub-ledger so level-up allocation can
    // discount it (BAL-09). Habit/dungeon/trial/challenge/boss XP is full-weight and skips this.
    const isTrickle = source !== undefined && TRICKLE_SOURCES.has(source);
    for (const [stat, amt] of Object.entries(reward.statXp)) {
      const n = amt ?? 0;
      state.character.statXp[stat as StatId] += n;
      if (isTrickle) {
        state.character.statXpTrickle[stat as StatId] =
          (state.character.statXpTrickle[stat as StatId] ?? 0) + n;
      }
      xpGained += n;
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
  // Record in the balance ledger when a source is tagged.
  if (source && state.earnings) {
    state.earnings.xp[source] += xpGained;
    state.earnings.gold[source] += goldGained;
    state.earnings.count[source] += 1;
  }
}

/**
 * Advance to `toLevel`, granting this level's stat points. Points are distributed by the XP
 * earned per stat since the last level-up (recent effort) plus a nudge toward the class's two
 * stats; the snapshot is then reset. Also handles the level-10 class unlock. Mutates `state`.
 */
export function applyLevelUp(state: GameState, toLevel: number): void {
  const ch = state.character;
  // Recent per-stat effort since the last level-up, with the passive minigame-trickle slice
  // re-weighted to MINIGAME_XP_ALLOCATION_WEIGHT (BAL-09). Kept in lockstep with previewNextGains.
  const delta = {} as Record<StatId, number>;
  for (const s of STAT_IDS) {
    const full = ch.statXp[s] - (ch.statXpAtLastLevel[s] ?? 0);
    const trickle = (ch.statXpTrickle?.[s] ?? 0) - (ch.statXpTrickleAtLastLevel?.[s] ?? 0);
    delta[s] = full - (1 - MINIGAME_XP_ALLOCATION_WEIGHT) * trickle;
  }
  const favored = ch.classId ? rankStats(ch.statXp).slice(0, 2) : [];
  const gains = allocateStatGains(POINTS_PER_LEVEL, delta, ch.statLevels, favored);

  ch.statLevels = { ...ch.statLevels };
  for (const s of STAT_IDS) ch.statLevels[s] += gains[s];
  ch.statXpAtLastLevel = { ...ch.statXp };
  ch.statXpTrickleAtLastLevel = { ...(ch.statXpTrickle ?? emptyStatXP()) };
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
    const boss = bossFor(biome, run.depth, state.character.level);
    run.battle = createBattle(fighterFor(state), boss, {
      ...carry,
      lossesBefore: state.dungeonBossLosses[boss.id] ?? 0,
    });
  } else if (room.type === 'encounter') {
    const def = getEncounter(room.key);
    run.encounter = def ? startEncounter(def) : null;
  } else if (room.type === 'treasure') {
    const loot = resolveTreasure(run.depth);
    // MINI-39: a weapon the player already owns would silently vanish in applyReward's dedupe —
    // reroll each owned duplicate into gold so deep treasure rooms never advertise dead loot.
    if (loot.weapons?.length) {
      const kept = loot.weapons.filter((key) => {
        if (state.ownedWeapons.includes(key)) {
          loot.gold = (loot.gold ?? 0) + 30 + 5 * run.depth;
          return false;
        }
        return true;
      });
      if (kept.length) loot.weapons = kept;
      else delete loot.weapons;
    }
    run.roomLoot = loot;
    run.floorReward = mergeReward(run.floorReward, loot);
  } else if (room.type === 'merchant') {
    // Homestead Trading Post (haggle perk) shaves the merchant's asking prices (15%).
    run.merchant = merchantOffers(run.depth, townPerks(state.town).merchantDiscount01);
  }
  // shrine + rest rooms are resolved entirely through their player choices (dungeonShrine/dungeonRest).
}

// ---------------------------------------------------------------------------
// commitRun — shared run-banking helper
// ---------------------------------------------------------------------------

/**
 * Deep-clone the per-source earnings ledger so a reward-recording action can mutate the `xp`,
 * `gold`, and `count` sub-maps without aliasing the previous state's snapshot. Falls back to a
 * fresh (zeroed) ledger when the save predates the earnings feature. Shared by every action that
 * spreads `earnings:` into its `next` state (habit complete/uncomplete, battle, challenge, dungeon).
 */
export function cloneEarnings(ledger: EarningsLedger | undefined): EarningsLedger {
  const base = ledger ?? freshEarningsLedger();
  return {
    ...base,
    xp: { ...base.xp },
    gold: { ...base.gold },
    count: { ...base.count },
  };
}

/**
 * Returns a `{ earnings, energyLog }` partial-state patch for recording a minigame energy spend.
 * Designed for use in begin* handlers that return a partial object: `return { ...patch, character, run }`.
 * No-op (returns {}) when the earnings ledger hasn't been initialized yet.
 */
export function energySpentPatch(
  s: GameState,
  cost: number,
): Partial<Pick<GameState, 'earnings' | 'energyLog'>> {
  if (!s.earnings) return {};
  const iso = toISODate();
  const earnings: EarningsLedger = {
    ...cloneEarnings(s.earnings),
    energySpent: s.earnings.energySpent + cost,
  };
  const existing = s.energyLog[iso] ?? { earned: 0, spent: 0 };
  const energyLog = { ...s.energyLog, [iso]: { earned: existing.earned, spent: existing.spent + cost } };
  return { earnings, energyLog };
}

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
  /** Balance-ledger source tag — passed to applyReward so the reward is attributed. */
  source?: EarningSource;
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
    character: {
      ...state.character,
      statXp: { ...state.character.statXp },
      // Cloned because applyReward writes the trickle sub-ledger in place for minigame sources (BAL-09).
      statXpTrickle: { ...state.character.statXpTrickle },
    },
    inventory: { ...state.inventory },
    ...(state.earnings ? {
      earnings: {
        ...state.earnings,
        xp: { ...state.earnings.xp },
        gold: { ...state.earnings.gold },
        count: { ...state.earnings.count },
      },
    } : {}),
    ...(opts.cloneMaterials
      ? {
          materials: { ...state.materials },
          ownedWeapons: [...state.ownedWeapons],
          ownedGear: [...state.ownedGear],
        }
      : {}),
    ...recordUpdate,
  } as GameState;

  // Apply the habit-streak gold multiplier (§6.3) — scales minigame gold by how many
  // active habits are on a ≥3-day streak. Never affects XP.
  const bonusedReward = {
    ...opts.reward,
    gold: Math.round((opts.reward.gold ?? 0) * state.character.habitBonus),
    statXp: opts.statXp,
  };
  applyReward(next, bonusedReward, opts.source);
  checkLevelUp(next);
  return next;
}

// ---------------------------------------------------------------------------
// Reward policy constants — change these to retune balance across all minigames.
// ---------------------------------------------------------------------------

/**
 * Maximum energy a character can hold — a deliberate spend-pacing lever, not just an anti-bug
 * ceiling (BAL-18, decision recorded in item 4.10). At ~2-3 days of typical spend it stops a
 * lapsed player from returning to a huge banked reserve of minigame runs funded by zero fresh
 * habits; energy must be re-earned by keeping habits, which is the whole point of the resource.
 * Clamped at the end of every energy-mutating action. Existing saves above the cap are not force-
 * clamped on load (Option A friendly-trust) — they settle to the cap on their next energy action.
 */
export const MAX_ENERGY = 15;

/**
 * The character's effective energy ceiling: MAX_ENERGY plus the Homestead Granary perk
 * (+2). Every energy grant/clamp reads this so a completed Granary genuinely raises the
 * cap; with no Granary it equals MAX_ENERGY (byte-identical to the pre-Homestead cap).
 */
export function maxEnergyFor(s: Pick<GameState, 'town'>): number {
  return MAX_ENERGY + townPerks(s.town).maxEnergyBonus;
}

// ---------------------------------------------------------------------------
// Per-mode commit wrappers — compute mode-specific opts and delegate to commitRun
// ---------------------------------------------------------------------------

/** The first N floors reached each calendar day pay a gold bonus (3.8). */
export const MINE_DAILY_BONUS_FLOORS = 10;
/** Gold multiplier applied while the day's bonus-floor budget isn't exhausted. */
export const MINE_DAILY_BONUS_MULT = 1.5;

/**
 * The first MINE_DAILY_BONUS_FLOORS floors reached each calendar day pay
 * MINE_DAILY_BONUS_MULT× gold (3.8) — an early-play nudge that tapers off across the day,
 * not a permanent multiplier. "Floors reached" is approximated by the run's ending depth
 * (`run.deepest`) rather than a precise per-descent ledger — simple and store-only, and
 * good enough for a soft engagement nudge rather than a hard economy lever.
 */
function applyMineDailyBonus(
  state: GameState,
  run: MineState,
  reward: Reward,
): { reward: Reward; mineDailyBonus: { date: string; floorsUsed: number } } {
  const today = toISODate();
  const current = state.mineDailyBonus?.date === today ? state.mineDailyBonus : { date: today, floorsUsed: 0 };
  const bonused: Reward = current.floorsUsed < MINE_DAILY_BONUS_FLOORS
    ? { ...reward, gold: Math.round((reward.gold ?? 0) * MINE_DAILY_BONUS_MULT) }
    : reward;
  return {
    reward: bonused,
    mineDailyBonus: { date: today, floorsUsed: Math.min(MINE_DAILY_BONUS_FLOORS, current.floorsUsed + run.deepest) },
  };
}

/** Bank a finished mine run's haul into the economy, clear the run, and reconcile level. */
export function commitMining(state: GameState, run: MineState): GameState {
  // Full 1.0 payout only on a safe tile (the entrance); banking off-tile keeps MINE_STASH_KEEP
  // so a full-value end-bank is worth trekking back for (BAL-12). Mirrors commitMineDeath's split.
  const rawReward = isMineSafeBankTile(run.tiles[run.player.r]?.[run.player.c]?.kind)
    ? run.haul
    : splitHaul(run.haul, MINE_STASH_KEEP).kept;
  const { reward, mineDailyBonus } = applyMineDailyBonus(state, run, rawReward);
  // Include gold haul in the final score so resource-gathering builds score alongside kills.
  const finalScore = run.score + (reward.gold ?? 0);
  // Trickle is split across both trained stats so total stat-XP stays modest (§5.4).
  const trickle = CRAWLER_XP_BASE + CRAWLER_XP_PER_DEPTH * run.deepest;
  const banked = commitRun(state, {
    runField: 'mining', reward,
    statXp: { ST: Math.ceil(trickle / 2), EN: Math.floor(trickle / 2) },
    deepestField: 'deepestMineFloor', deepestValue: run.deepest,
    scoreField: 'bestMineScore', scoreValue: finalScore, cloneMaterials: true, source: 'mine',
  });
  return { ...banked, mineDailyBonus };
}

/**
 * Bank only the kept half of a fallen miner's haul (the rest is forfeit to the rock) and clear
 * the run. Mirrors commitForestDeath; the overlay shows the split beforehand.
 * The forfeited portion is saved as a tombstone the player can recover on a future run.
 */
export function commitMineDeath(state: GameState, run: MineState): GameState {
  const { kept, lost } = splitHaul(run.haul, MINE_DEATH_KEEP);
  const { reward, mineDailyBonus } = applyMineDailyBonus(state, run, kept);
  // Include kept gold in the final score even on death (mirrors commitMining).
  const finalScore = run.score + (reward.gold ?? 0);
  const trickle = CRAWLER_XP_BASE + CRAWLER_XP_PER_DEPTH * run.deepest;
  const banked = commitRun(state, {
    runField: 'mining', reward,
    statXp: { ST: Math.ceil(trickle / 2), EN: Math.floor(trickle / 2) },
    deepestField: 'deepestMineFloor', deepestValue: run.deepest,
    scoreField: 'bestMineScore', scoreValue: finalScore, cloneMaterials: true, source: 'mine',
  });
  // Only MINE_TOMBSTONE_RECOVER_KEEP of the lost half is actually recoverable — a full
  // 100%-recoverable tombstone would make death's eventual total (kept + all of lost)
  // beat the free, immediate MINE_STASH_KEEP hurry-bank, inverting the risk ladder (0.2).
  const recoverable = splitHaul(lost, MINE_TOMBSTONE_RECOVER_KEEP).kept;
  const hasRecoverable = (recoverable.gold ?? 0) > 0 || Object.keys(recoverable.materials ?? {}).length > 0;
  return {
    ...banked,
    mineDailyBonus,
    mineTombstone: hasRecoverable ? { floor: run.deepest, haul: recoverable } : banked.mineTombstone,
  };
}

/** Bank a finished forest run's haul into the economy, clear the run, and reconcile level. */
export function commitForest(state: GameState, run: ForestState): GameState {
  // Full 1.0 payout only on a safe tile (entrance/clearing); banking off-tile keeps
  // FOREST_STASH_KEEP so a full-value end-bank beats repeated mid-run stashing (BAL-12).
  const reward = isForestSafeBankTile(run.tiles[run.player.r]?.[run.player.c]?.kind)
    ? run.haul
    : splitHaul(run.haul, FOREST_STASH_KEEP).kept;
  // Include gold haul in the final score so resource-gathering builds score alongside kills (mirrors commitMining).
  const finalScore = run.score + (reward.gold ?? 0);
  // The run's gold/materials, plus a Dexterity/Endurance trickle split across both stats (§5.4).
  const trickle = CRAWLER_XP_BASE + CRAWLER_XP_PER_DEPTH * run.deepest;
  return commitRun(state, {
    runField: 'forest', reward,
    statXp: { DX: Math.ceil(trickle / 2), EN: Math.floor(trickle / 2) },
    deepestField: 'deepestForestStage', deepestValue: run.deepest,
    scoreField: 'bestForestScore', scoreValue: finalScore, cloneMaterials: true, source: 'forest',
  });
}

/**
 * Mid-run haul stash — banks 80% of the current haul into the economy immediately and resets the
 * run's haul to empty so the player can press deeper with a clean slate.  The run itself keeps
 * going (`status` stays `'active'`).  The 20% forfeit is the "hurry tax" that makes full banking
 * at run end (100%) more valuable than repeated stashing.
 *
 * Only callable when standing on a clearing tile (gated by the store action, not here).
 * No-op if the haul is already empty.
 */
export function stashForest(state: GameState, run: ForestState): GameState {
  const { kept } = splitHaul(run.haul, FOREST_STASH_KEEP);
  const hasLoot = (kept.gold ?? 0) > 0 || Object.keys(kept.materials ?? {}).length > 0;
  if (!hasLoot) return state;

  const next: GameState = {
    ...state,
    character: {
      ...state.character,
      statXp: { ...state.character.statXp },
      // Trickle sub-ledger cloned defensively — stashForest applies rewards under a trickle source (BAL-09).
      statXpTrickle: { ...state.character.statXpTrickle },
    },
    inventory: { ...state.inventory },
    materials: { ...state.materials },
    ownedWeapons: [...state.ownedWeapons],
    ownedGear: [...state.ownedGear],
    // Reset the run's haul to empty; the 20% "lost" fraction is simply forfeited.
    forest: { ...run, haul: {} },
  };
  // Mirror commitRun's habit-streak gold multiplier so stashed gold scales with streak bonus.
  applyReward(next, { ...kept, gold: Math.round((kept.gold ?? 0) * state.character.habitBonus) }, 'forest');
  return next;
}

/**
 * Bank only the kept half of a fallen forager's haul (the rest is forfeit to the wild) and clear
 * the run. Mirrors commitForest but for the death path; the overlay shows the split beforehand.
 */
export function commitForestDeath(state: GameState, run: ForestState): GameState {
  const { kept } = splitHaul(run.haul, FOREST_DEATH_KEEP);
  // Include kept gold in the final score even on death (mirrors commitMineDeath).
  const finalScore = run.score + (kept.gold ?? 0);
  // The trek still earns its Dexterity/Endurance trickle split across both stats (§5.4).
  const trickle = CRAWLER_XP_BASE + CRAWLER_XP_PER_DEPTH * run.deepest;
  return commitRun(state, {
    runField: 'forest', reward: kept,
    statXp: { DX: Math.ceil(trickle / 2), EN: Math.floor(trickle / 2) },
    deepestField: 'deepestForestStage', deepestValue: run.deepest,
    scoreField: 'bestForestScore', scoreValue: finalScore, cloneMaterials: true, source: 'forest',
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
  const budget = Math.round(
    (MINIGAME_XP_BASE + MINIGAME_XP_PER_TIER * run.tier) *
    (ARENA_XP_DAMAGE_FLOOR + ARENA_XP_DAMAGE_SCALE * damageProgress(run)),
  );
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
    cloneMaterials: false, source: 'arena',
  });
}

/**
 * The stat-XP split a finished Hex Tactics run will bank. Exported so the overlay's end-screen
 * card shows exactly the numbers commitTactics is about to apply — one function, no drift.
 */
export function tacticsStatXp(run: HexBattleState): Partial<Record<StatId, number>> {
  const won = run.status === 'won';
  const trickle = Math.round(
    (MINIGAME_XP_BASE + MINIGAME_XP_PER_TIER * run.tier) * (won ? 1 : MINIGAME_XP_LOSS_FACTOR),
  );
  // Split trickle across three stats — AG-forward (§5.4). Remainders go to AG then DX.
  const each = Math.floor(trickle / 3);
  const rem = trickle - each * 3; // 0, 1, or 2
  return { AG: each + (rem > 0 ? 1 : 0), DX: each + (rem > 1 ? 1 : 0), EN: each };
}

/**
 * Bank a finished Hex Tactics skirmish and close it. A win pays scaled gold (tacticsReward) and
 * records the tier; either outcome earns an Agility-forward Agility/Dexterity/Endurance trickle —
 * Tactics is the mode that finally rewards mobility, so its XP leans on AG.
 */
export function commitTactics(state: GameState, run: HexBattleState): GameState {
  const won = run.status === 'won';
  return commitRun(state, {
    runField: 'tactics', reward: tacticsReward(run),
    statXp: tacticsStatXp(run),
    deepestField: 'deepestTacticsTier', deepestValue: run.tier, gateOnWin: won,
    // Tactics wins now award a material bundle (BAL-10) — clone so applyReward's in-place
    // `state.materials[key] += …` never aliases a shared snapshot object.
    cloneMaterials: true, source: 'tactics',
  });
}
