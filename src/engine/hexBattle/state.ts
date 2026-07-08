// Hex Tactics — shared state shape, tuning constants, and small pure helpers.
// This is the base module of the hexBattle package: it imports only engine siblings and holds
// the HexBattleState type graph plus the low-level helpers (elevation/cover/status/clone) that the
// geometry / combat / ai / turns / generation modules build on. No behavior lives here beyond the
// AG / elevation formulas and unit bookkeeping.
import type { StatId } from '../stats';
import type { EnemyMove } from '../bosses';
import { getSpell, type StatusKey } from '../spells';
import type { WeaponDef } from '../weapons';
import { type Hex, hexDistance, hexEquals, hexKey } from '../hex';

// --- Tuning -------------------------------------------------------------------------------------
export const TACTICS_ENERGY_COST = 3;
export const TACTICS_UNLOCK_LEVEL = 4;
export const TACTICS_BOARD_RADIUS = 3; // 37-hex board (Small)

/** Board size options for the skirmish. */
export type TacticsSize = 'small' | 'medium' | 'large';
/** Map each size to a board radius: Small 37 tiles, Medium 61, Large 127. */
export const TACTICS_SIZE_RADIUS: Record<TacticsSize, number> = { small: 3, medium: 4, large: 6 };
/** Flat defense/ward a unit gains while standing on a `cover` tile. */
export const COVER_DEFENSE = 3;
/** Damage taken at the end of a unit's turn while standing on a `hazard` tile. */
export const HAZARD_DMG = 4;
/** Base reach of a damage/illusion spell (before any height bonus). */
export const SPELL_RANGE = 4;
/** Max elevation value a tile can have. */
export const MAX_ELEVATION = 3;
/**
 * Max a tile's elevation may exceed the tile(s) directly behind it (toward the camera's back).
 * Keeps the iso view readable: a front column can be a cliff/tower at the back of the board (where
 * nothing sits behind it) but can't tower over and hide the tiles farther back. The renderer keeps
 * column height proportional to tile size so this limit guarantees the back tile's top stays visible.
 */
export const OCCLUSION_RISE = 2;
/** Stagger between queued animation effects so an enemy phase reads sequentially. */
export const EFFECT_STAGGER_MS = 450;
/** Default per-action animation length. */
const EFFECT_DURATION_MS = 420;
/** Duration of the CSS slide animation when an enemy moves to a new tile. Must be ≤ EFFECT_STAGGER_MS. */
export const MOVE_ANIM_MS = 300;
/** Stamina restored to the player at the start of each new turn after the enemy phase. */
export const STA_REGEN_PER_TURN = 2;
/** Consecutive out-of-reach enemy turns before a chasing enemy (charger/flanker) lunges. */
export const LUNGE_AFTER_TURNS = 2;
/**
 * Positional spells that are always available in Tactics regardless of the player's
 * inventory. They form the core of the positioning system (FF Tactics pattern: baseline
 * abilities don't require loot discovery).
 */
export const TACTICS_GRANTED_SPELLS = ['push', 'blink', 'cleave'] as const;

/**
 * Returns true for spells that belong in the pre-match loadout picker — i.e. standard
 * damage/support spells the player can choose to bring (cap: 3). Excludes:
 *   - The three always-granted positional spells (they're free on top of the loadout).
 *   - Arena-only mechanics (rune, ring-of-fire, teleport) — already filtered in generateSkirmish.
 *   - Any spell with a non-standard `mechanic` field (blink / push / cleave handle above).
 */
export function isTacticsLoadoutSpell(key: string): boolean {
  if ((TACTICS_GRANTED_SPELLS as readonly string[]).includes(key)) return false;
  const spell = getSpell(key);
  if (!spell) return false;
  // Spells with a mechanic override (blink/push/cleave/rune/etc.) are handled elsewhere.
  return spell.mechanic === undefined;
}

// --- AG / elevation formulas (the load-bearing rules; stat levels are ~1–25) --------------------
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Tiles a unit may move in one turn: 2 base + 1 per 4 AG, capped at 7 (reached at AG 20).
 *  BAL-23: the cap was 6 (hit at AG 16), leaving the top ~⅕ of AG investment dead in Tactics. */
export function moveTilesFor(ag: number): number {
  return Math.min(7, 2 + Math.floor(ag / 4));
}

/** Max elevation a unit may *ascend* in a single step: 1 base + 1 per 8 AG, capped at 3. Descents are free. */
export function climbFor(ag: number): number {
  return Math.min(MAX_ELEVATION, 1 + Math.floor(ag / 8));
}

/** Damage multiplier from height advantage. `dz = attackerZ − targetZ`. ±12% per level, clamped ±36%. */
export function heightDamageMult(dz: number): number {
  return clamp(1 + 0.12 * dz, 0.64, 1.36);
}

/** Extra ranged/spell reach from height advantage: +1 tile per level up, max +2. */
export function heightRangeBonus(dz: number): number {
  return clamp(dz, 0, 2);
}

// --- Types --------------------------------------------------------------------------------------
export type TerrainKind = 'floor' | 'cover' | 'slow' | 'hazard' | 'blocked';

export interface Tile {
  hex: Hex;
  elevation: number; // 0..MAX_ELEVATION
  terrain: TerrainKind;
}

export interface UnitStatus {
  key: StatusKey;
  turns: number;
  magnitude: number;
}

export interface PlayerUnit {
  hex: Hex;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  sta: number;
  maxSta: number;
  movesLeft: number; // tiles remaining this turn
  hasActed: boolean; // one attack/spell per turn
  /** When true, the player has Held their action to fire a one-shot reaction during the enemy phase.
   *  Cleared automatically when the reaction fires or at the start of the next player turn. */
  overwatch: boolean;
  ag: number; // raw Agility — drives movement & climb
  // Frozen combat snapshot (mirrors deriveCombatant fields)
  meleePower: number;
  rangedPower: number;
  damageSpell: number;
  supportSpell: number;
  illusionPower: number;
  defense: number;
  ward: number;
  dodge: number;
  statuses: UnitStatus[];
  /** Hero ID: 'p0' for single-player, or the Supabase user ID in co-op. */
  id?: string;
  /** Display name shown next to the hero sprite in co-op (undefined = "You" in log messages). */
  name?: string;
  /** Per-hero spell loadout for co-op. When set, takes precedence over `state.knownSpells`. */
  knownSpells?: string[];
  /** Per-hero weapon snapshot for co-op. When set, takes precedence over `state.weapon`. */
  weapon?: WeaponDef;
  /** Multi-hero turn sequencing: set to true once this hero calls endPlayerTurn this round.
   *  Cleared at the start of each new player turn along with hasActed/overwatch. */
  endedTurn?: boolean;
}

/** AI movement/behavior archetype — drives the per-archetype scoring in bestMoveFor(). Lives here
 *  because it is a field on the persisted EnemyUnit shape; ./ai re-exports it as the public name. */
export type AIArchetype = 'charger' | 'kiter' | 'holder' | 'flanker';

export interface EnemyUnit {
  id: number;
  templateId: string;
  name: string;
  icon: string;
  /** AI movement/behavior archetype — drives the per-archetype scoring in bestMoveFor(). */
  aiArchetype: AIArchetype;
  hex: Hex;
  /**
   * The tile this enemy occupied at the start of the most recent enemy phase.
   * The overlay holds the sprite here until the 'move' effect fires, producing a
   * visible one-at-a-time slide instead of all enemies snapping to their final
   * positions simultaneously. Optional so old persisted saves don't crash.
   */
  prevHex?: Hex;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  ward: number;
  attackSchool: 'physical' | 'magic';
  weakTo: StatId[];
  resistTo: StatId[];
  range: number; // 1 = melee, >1 = ranged/caster
  moveTiles: number;
  climb: number;
  statuses: UnitStatus[];
  /** Weighted move pool from the enemy template. Basic attack only when absent. */
  moveset?: EnemyMove[];
  /** Transient defense bonus from a guard move; resets at the start of the enemy's next turn. */
  guardBonus: number;
  /**
   * Consecutive enemy turns a chasing enemy (charger/flanker) has ended still outside attack reach. Reaching 2 earns a
   * one-turn double-move lunge (see enemyAct) so a bow player can't kite it damage-free forever.
   * Optional/read-defaulted (`?? 0`) so an old persisted mid-fight tolerates the new field.
   */
  turnsOutOfReach?: number;
}

export type Turn = 'player' | 'enemy';

export type SelectedAction =
  | { kind: 'move' }
  | { kind: 'attack' }
  | { kind: 'spell'; spellKey: string }
  | null;

export interface TacticalEffect {
  id: number;
  /** 'melee' | 'arrow' | 'spell:<key>' | 'floater' — the overlay maps this to a CSS animation. */
  kind: string;
  from: Hex;
  to: Hex;
  /** Relative offset (ms) from the start of this resolution batch, for cascading animations. */
  startedAtMs: number;
  durationMs: number;
  /** Text to display for 'floater' effects (damage number, heal amount). */
  label?: string;
  /** Color class for 'floater' effects. */
  color?: 'dmg-player' | 'dmg-enemy' | 'heal' | 'status';
  /** For 'move' effects: the enemy whose sprite should slide from `from` to `to`. */
  enemyId?: number;
}

export type HexBattleStatus = 'active' | 'won' | 'lost';

/** Predicted action for one enemy on their next turn, used to telegraph intent to the player. */
export interface EnemyIntent {
  enemyId: number;
  /** Where the enemy plans to move (equals current hex if staying put). */
  moveTo: Hex;
  /** Whether this enemy will be in attack range after their planned move. */
  willAttack: boolean;
  /** Short action label from the most likely moveset entry. */
  attackLabel: string;
  /** Emoji icon for the planned action. */
  attackIcon: string;
  /** True when this move uses the catch-up lunge budget (see lungePending) — telegraphed so the
   *  danger overlay and intent badge never under-predict the one situation the lunge exists for. */
  lunge?: boolean;
}

/** Pre-commit damage/heal estimate for the hover preview — min and max bracket the actual roll. */
export interface AttackPreview {
  min: number;
  max: number;
  /** dz = attacker elevation − target elevation. */
  dz: number;
  heightMult: number;
  mitigation: number;
  coverBonus: number;
  guardBonus: number;
  lethal: boolean;
  weak: boolean;
  resist: boolean;
  /** True when this is a healing preview (support spells). */
  isHeal?: boolean;
  /** True when the swing will be exhausted (stamina below the weapon's cost — ×0.5 damage). */
  exhausted?: boolean;
}

/**
 * Optional per-match bonus objective — appears in ~65% of skirmishes and pays extra gold when
 * the player wins *and* meets the condition. Losing the match also voids the objective regardless.
 *
 * beacon  — Hold the Beacon: keep a designated centre tile enemy-free for `target` consecutive
 *           player turns. `progress` counts the current streak; resets when an enemy stands there.
 * swift   — Swift Strike: win within `target` turns. `complete` is set at match-end when won.
 * flawless — Unscathed: never drop below `target`% HP. `failed` is set the moment HP falls under;
 *           `progress` tracks the lowest HP% seen (for display).
 */
export type TacticsObjectiveKind = 'beacon' | 'swift' | 'flawless';

export interface TacticsObjective {
  kind: TacticsObjectiveKind;
  label: string;
  desc: string;
  /** Numeric threshold: beacon=streak needed (5), swift=turn budget, flawless=HP% floor (50). */
  target: number;
  /** Running tracker: beacon=current streak, swift=unused, flawless=lowest HP% seen (starts 100). */
  progress: number;
  /** Beacon only: the designated tile that must stay clear. */
  beaconHex?: Hex;
  /**
   * Beacon only (MINI-24): set true the first time an enemy breaches the beacon, so a decisive
   * win that clears the board without ever ceding the tile still earns the objective (whereas a
   * win after the beacon was contested does not get it for free). Optional — absent reads falsy.
   */
  beaconBroken?: boolean;
  complete: boolean;
  failed: boolean;
}

export interface HexBattleState {
  radius: number;
  tiles: Record<string, Tile>;
  /** The active/local hero. In single-player this is the sole hero; in co-op it is the hero
   *  controlled by this client. Always kept in sync with the matching entry in `players[]`. */
  player: PlayerUnit;
  enemies: EnemyUnit[];
  turn: Turn;
  selected: SelectedAction;
  /** Highlight caches recomputed by selectAction / movePlayer (derived, not source of truth). */
  reachable: Hex[];
  targetable: Hex[];
  /** Transient animation queue, rebuilt each resolver call and drained by the overlay. */
  effects: TacticalEffect[];
  log: string[];
  status: HexBattleStatus;
  tier: number;
  /** Spell loadout for the active hero (state-level for backward compat; co-op uses player.knownSpells). */
  knownSpells: string[];
  /** Weapon for the active hero (state-level for backward compat; co-op uses player.weapon). */
  weapon: WeaponDef;
  seq: number;
  /** All board tiles the player could be attacked from on the enemy's next turn (danger zone). */
  threatHexes: Hex[];
  /** Predicted intent for each living enemy this upcoming enemy turn (for UI telegraph). */
  intentPlan: EnemyIntent[];
  /** Optional bonus challenge for this skirmish (null ~35% of the time). */
  objective: TacticsObjective | null;
  /** Number of player turns completed (starts at 1 for the player's first turn). */
  turnCount: number;
  /** Total max HP of the enemy force AS SPAWNED, captured by generateSkirmish. checkOutcome
   *  removes slain enemies from `enemies`, so this frozen denominator lets the retreat/loss
   *  reward credit kills, not just chip damage on survivors (MINI-23). Optional: legacy in-flight
   *  runs from before this field lack it and fall back to a survivors-only metric. */
  enemyForceMaxHp?: number;
  /** Dev-settings invincibility (mirrors ArenaState.invincible): heroes take no attack/hazard/DoT
   *  damage and are topped up each turn. Set by beginTactics at match start; never set in co-op. */
  invincible?: boolean;
  /** Full hero roster (1 in single-player, N in co-op). Populated by generateSkirmish.
   *  Engine functions fall back to [player] when this is absent for backward compat. */
  players?: PlayerUnit[];
  /** ID of the hero controlled by this client (matches player.id). */
  activeHeroId?: string;
}

// --- Small helpers ------------------------------------------------------------------------------
export function tileAt(s: HexBattleState, h: Hex): Tile | undefined {
  return s.tiles[hexKey(h)];
}

export function elevationAt(s: HexBattleState, h: Hex): number {
  return tileAt(s, h)?.elevation ?? 0;
}

export function coverAt(s: HexBattleState, h: Hex): number {
  return tileAt(s, h)?.terrain === 'cover' ? COVER_DEFENSE : 0;
}

/** Hex keys occupied by a living unit, excluding the one currently at `exclude`. */
export function occupiedKeys(s: HexBattleState, exclude?: Hex): Set<string> {
  const set = new Set<string>();
  const heroes = (s.players && s.players.length > 0) ? s.players : [s.player];
  for (const p of heroes) if (p.hp > 0) set.add(hexKey(p.hex));
  for (const e of s.enemies) if (e.hp > 0) set.add(hexKey(e.hex));
  if (exclude) set.delete(hexKey(exclude));
  return set;
}

/** All living heroes. Falls back to [s.player] when players[] is absent (single-player / old tests). */
export function livingHeroes(s: HexBattleState): PlayerUnit[] {
  const all = (s.players && s.players.length > 0) ? s.players : [s.player];
  return all.filter((p) => p.hp > 0);
}

/** The living hero nearest to `from` by hex distance. Falls back to s.player when unambiguous. */
export function nearestHero(s: HexBattleState, from: Hex): PlayerUnit {
  const alive = livingHeroes(s);
  if (alive.length === 0) return s.player;
  if (alive.length === 1) return alive[0];
  return alive.reduce(
    (best, h) => (hexDistance(from, h.hex) < hexDistance(from, best.hex) ? h : best),
    alive[0],
  );
}

export function enemyAt(s: HexBattleState, h: Hex): EnemyUnit | undefined {
  return s.enemies.find((e) => e.hp > 0 && hexEquals(e.hex, h));
}

export function hasStatus(unit: { statuses: UnitStatus[] }, key: StatusKey): UnitStatus | undefined {
  return unit.statuses.find((st) => st.key === key);
}

/** Chasers are the melee "close-to-engage" archetypes that participate in the catch-up lunge. */
export function isChaser(e: EnemyUnit): boolean {
  return e.aiArchetype === 'charger' || e.aiArchetype === 'flanker';
}

/** True when this enemy will lunge on its next activation (kept out of reach ≥ LUNGE_AFTER_TURNS).
 *  Lives here (not ./ai) so the threat/intent predictors in ./geometry and ./ai share one truth —
 *  the danger overlay under-predicting a lunge is exactly the drift this helper exists to prevent. */
export function lungePending(e: EnemyUnit): boolean {
  return isChaser(e) && (e.turnsOutOfReach ?? 0) >= LUNGE_AFTER_TURNS;
}

/** Movement budget for this enemy's next activation, including the one-turn lunge bonus. */
export function moveBudgetFor(e: EnemyUnit): number {
  return lungePending(e) ? e.moveTiles * 2 + 1 : e.moveTiles;
}

export function weakenFactor(unit: { statuses: UnitStatus[] }): number {
  const w = hasStatus(unit, 'weaken');
  // Clamp: CH-scaled weaken magnitude (illusionBoost) is the first fraction-status bonus that can
  // stack toward/past 1.0, and this factor multiplies straight into rawPower at several call sites
  // before any downstream Math.max — a negative multiplier would flip damage. (BAL-07)
  return w ? Math.max(0, 1 - w.magnitude) : 1;
}

export function blessFlat(unit: { statuses: UnitStatus[] }): number {
  const b = hasStatus(unit, 'bless');
  return b ? b.magnitude : 0;
}

export function applyUnitStatus(list: UnitStatus[], status: UnitStatus): void {
  const existing = list.find((x) => x.key === status.key);
  if (existing) {
    existing.turns = Math.max(existing.turns, status.turns);
    existing.magnitude = Math.max(existing.magnitude, status.magnitude);
  } else {
    list.push({ ...status });
  }
}

function cloneUnit(p: PlayerUnit): PlayerUnit {
  return { ...p, hex: { ...p.hex }, statuses: p.statuses.map((st) => ({ ...st })) };
}

export function clone(s: HexBattleState): HexBattleState {
  // Deep-copy the players array (if present) and alias player to the active entry so that
  // mutations to s.player.* also propagate to s.players[i].* (same object reference).
  let players: PlayerUnit[] | undefined;
  let player: PlayerUnit;
  if (s.players && s.players.length > 0) {
    players = s.players.map(cloneUnit);
    player = players.find((p) => p.id === s.activeHeroId) ?? players[0];
  } else {
    players = undefined;
    player = cloneUnit(s.player);
  }
  return {
    ...s,
    player,
    players,
    enemies: s.enemies.map((e) => ({ ...e, hex: { ...e.hex }, statuses: e.statuses.map((st) => ({ ...st })) })),
    effects: [],
    reachable: [...s.reachable],
    targetable: [...s.targetable],
    log: [...s.log],
    threatHexes: [...s.threatHexes],
    intentPlan: s.intentPlan.map((i) => ({ ...i, moveTo: { ...i.moveTo } })),
    // tiles are immutable after generation — safe to share by reference.
  };
}

/** Returns a pusher that stamps effects with an increasing stagger so they cascade visually. */
export function effectPusher(s: HexBattleState) {
  let clock = 0;
  return (kind: string, from: Hex, to: Hex, dur = EFFECT_DURATION_MS, enemyId?: number) => {
    s.effects.push({ id: s.seq++, kind, from: { ...from }, to: { ...to }, startedAtMs: clock, durationMs: dur, enemyId });
    clock += EFFECT_STAGGER_MS;
  };
}
