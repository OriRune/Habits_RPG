// Hex Tactics — a turn-based tactical skirmish on the flat-top hex grid (src/engine/hex.ts).
// Where the Arena is real-time, this is deliberate: the player's single character (their real
// stat levels) faces 2–5 AI foes on a board where every tile has an elevation (Z) and a terrain
// type. High ground hits harder and shoots farther; Agility — otherwise unused in any minigame —
// drives how far you move and how high you can climb in a turn (plus the dodge it already grants).
//
// Like the other minigames this is a pure engine: every rule returns a NEW HexBattleState and all
// randomness is injected. The store owns the state; a thin overlay calls these. Damage math is the
// shared turn-based combat (attackRoll / spellDamageRoll / spellHealAmount / variance in
// src/engine/combat.ts) with elevation/cover folded into `power`/`defense` before the roll, so the
// numbers feel identical to the rest of the game.
import type { StatId } from './stats';
import type { Fighter, RNG } from './combat';
import type { EnemyMove } from './bosses';
import { attackRoll, spellDamageRoll, spellHealAmount, variance } from './combat';
import { getSpell, SCHOOL_STAT, type StatusKey } from './spells';
import type { WeaponDef } from './weapons';
import { ENEMIES } from './enemies';
import type { Reward } from './challenges';
import {
  type Hex,
  hexBoard,
  hexDistance,
  hexEquals,
  hexKey,
  hexLineBetween,
  hexNeighbors,
} from './hex';

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
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Tiles a unit may move in one turn: 2 base + 1 per 4 AG, capped at 6. */
export function moveTilesFor(ag: number): number {
  return Math.min(6, 2 + Math.floor(ag / 4));
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
}

export interface EnemyUnit {
  id: number;
  templateId: string;
  name: string;
  icon: string;
  /** AI movement/behavior archetype — drives the per-archetype scoring in bestMoveFor(). */
  aiArchetype: AIArchetype;
  hex: Hex;
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
  complete: boolean;
  failed: boolean;
}

export interface HexBattleState {
  radius: number;
  tiles: Record<string, Tile>;
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
  knownSpells: string[];
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
}

// --- Small helpers ------------------------------------------------------------------------------
export function tileAt(s: HexBattleState, h: Hex): Tile | undefined {
  return s.tiles[hexKey(h)];
}

function elevationAt(s: HexBattleState, h: Hex): number {
  return tileAt(s, h)?.elevation ?? 0;
}

function coverAt(s: HexBattleState, h: Hex): number {
  return tileAt(s, h)?.terrain === 'cover' ? COVER_DEFENSE : 0;
}

/** Hex keys occupied by a living unit, excluding the one currently at `exclude`. */
function occupiedKeys(s: HexBattleState, exclude?: Hex): Set<string> {
  const set = new Set<string>();
  if (s.player.hp > 0) set.add(hexKey(s.player.hex));
  for (const e of s.enemies) if (e.hp > 0) set.add(hexKey(e.hex));
  if (exclude) set.delete(hexKey(exclude));
  return set;
}

export function enemyAt(s: HexBattleState, h: Hex): EnemyUnit | undefined {
  return s.enemies.find((e) => e.hp > 0 && hexEquals(e.hex, h));
}

function hasStatus(unit: { statuses: UnitStatus[] }, key: StatusKey): UnitStatus | undefined {
  return unit.statuses.find((st) => st.key === key);
}

function weakenFactor(unit: { statuses: UnitStatus[] }): number {
  const w = hasStatus(unit, 'weaken');
  return w ? 1 - w.magnitude : 1;
}

function blessFlat(unit: { statuses: UnitStatus[] }): number {
  const b = hasStatus(unit, 'bless');
  return b ? b.magnitude : 0;
}

function applyUnitStatus(list: UnitStatus[], status: UnitStatus): void {
  const existing = list.find((x) => x.key === status.key);
  if (existing) {
    existing.turns = Math.max(existing.turns, status.turns);
    existing.magnitude = Math.max(existing.magnitude, status.magnitude);
  } else {
    list.push({ ...status });
  }
}

function clone(s: HexBattleState): HexBattleState {
  return {
    ...s,
    player: {
      ...s.player,
      hex: { ...s.player.hex },
      statuses: s.player.statuses.map((st) => ({ ...st })),
    },
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
function effectPusher(s: HexBattleState) {
  let clock = 0;
  return (kind: string, from: Hex, to: Hex, dur = EFFECT_DURATION_MS) => {
    s.effects.push({ id: s.seq++, kind, from: { ...from }, to: { ...to }, startedAtMs: clock, durationMs: dur });
    clock += EFFECT_STAGGER_MS;
  };
}

// --- Movement: reachable tiles (Dijkstra with climb + slow cost) --------------------------------
/** Map of reachable hex keys → { hex, cost }, respecting budget, climb limit, terrain & occupancy. */
function reachableCosts(
  s: HexBattleState,
  from: Hex,
  budget: number,
  climb: number,
): Map<string, { hex: Hex; cost: number }> {
  const out = new Map<string, { hex: Hex; cost: number }>();
  const best = new Map<string, number>();
  const occupied = occupiedKeys(s, from);
  best.set(hexKey(from), 0);
  // Small budgets → a simple cost-bounded BFS with relaxation suffices.
  let frontier: Array<{ hex: Hex; cost: number }> = [{ hex: from, cost: 0 }];
  while (frontier.length) {
    const next: Array<{ hex: Hex; cost: number }> = [];
    for (const cur of frontier) {
      for (const n of hexNeighbors(cur.hex)) {
        const key = hexKey(n);
        const tile = s.tiles[key];
        if (!tile || tile.terrain === 'blocked') continue;
        if (occupied.has(key)) continue;
        if (tile.elevation - elevationAt(s, cur.hex) > climb) continue; // ascent gate (descents free)
        const stepCost = tile.terrain === 'slow' ? 2 : 1;
        const cost = cur.cost + stepCost;
        if (cost > budget) continue;
        if (best.has(key) && best.get(key)! <= cost) continue;
        best.set(key, cost);
        out.set(key, { hex: n, cost });
        next.push({ hex: n, cost });
      }
    }
    frontier = next;
  }
  return out;
}

/** Tiles the unit at `from` can move to with the given budget & climb (excludes the start tile). */
export function computeReachable(s: HexBattleState, from: Hex, budget: number, climb: number): Hex[] {
  return [...reachableCosts(s, from, budget, climb).values()].map((v) => v.hex);
}

// --- Line of sight ------------------------------------------------------------------------------
/** Clear shot from `a` to `b`? Blocked by `blocked` terrain, a living unit, or a ridge taller than both ends. */
export function hasLineOfSight(s: HexBattleState, a: Hex, b: Hex): boolean {
  const line = hexLineBetween(a, b);
  const maxEnd = Math.max(elevationAt(s, a), elevationAt(s, b));
  const occupied = occupiedKeys(s); // both endpoints may hold units; we only check interior tiles
  for (let i = 1; i < line.length - 1; i++) {
    const h = line[i];
    const key = hexKey(h);
    const tile = s.tiles[key];
    if (!tile) continue;
    if (tile.terrain === 'blocked') return false;
    if (tile.elevation > maxEnd) return false; // a higher ridge between the two ends blocks the shot
    if (occupied.has(key)) return false; // a unit stands in the way
  }
  return true;
}

// --- Targeting ----------------------------------------------------------------------------------
/** Enemy-occupied hexes the selected action can legally hit this turn. */
export function computeTargetable(s: HexBattleState, action: SelectedAction): Hex[] {
  if (!action || s.turn !== 'player' || s.status !== 'active' || s.player.hasActed) return [];
  const p = s.player.hex;
  const pz = elevationAt(s, p);
  const living = s.enemies.filter((e) => e.hp > 0);

  if (action.kind === 'attack') {
    if (s.weapon.ranged) {
      const range = s.weapon.range ?? 1;
      return living
        .filter((e) => {
          const dz = pz - elevationAt(s, e.hex);
          return hexDistance(p, e.hex) <= range + heightRangeBonus(dz) && hasLineOfSight(s, p, e.hex);
        })
        .map((e) => e.hex);
    }
    // Melee: any adjacent living enemy (climb does not gate an attack).
    return living.filter((e) => hexDistance(p, e.hex) === 1).map((e) => e.hex);
  }

  if (action.kind === 'spell') {
    const spell = getSpell(action.spellKey);
    if (!spell) return [];
    // Blink: target any open (non-blocked, unoccupied) tile within 2 steps.
    if (spell.mechanic === 'blink') {
      const occ = occupiedKeys(s);
      return Object.values(s.tiles)
        .filter((t) => {
          if (t.terrain === 'blocked') return false;
          if (occ.has(hexKey(t.hex))) return false;
          const d = hexDistance(p, t.hex);
          return d >= 1 && d <= 2;
        })
        .map((t) => t.hex);
    }
    // Cleave / support: self-cast, no target tile needed.
    if (spell.mechanic === 'cleave' || spell.school === 'support') return [];
    // All other spells (damage / illusion / push): target living enemies in range.
    return living
      .filter((e) => {
        const dz = pz - elevationAt(s, e.hex);
        return hexDistance(p, e.hex) <= SPELL_RANGE + heightRangeBonus(dz) && hasLineOfSight(s, p, e.hex);
      })
      .map((e) => e.hex);
  }
  return [];
}

// --- Attack / spell preview (pure, no RNG consumed, no state mutation) --------------------------

/** Pre-commit damage estimate for a weapon attack. Returns null if the attack isn't legal. */
export function previewPlayerAttack(state: HexBattleState, target: Hex): AttackPreview | null {
  if (state.player.hasActed || state.turn !== 'player' || state.status !== 'active') return null;
  const enemy = enemyAt(state, target);
  if (!enemy) return null;
  const p = state.player;
  const pz = elevationAt(state, p.hex);
  const dz = pz - elevationAt(state, enemy.hex);
  const hMult = heightDamageMult(dz);
  const ranged = !!state.weapon.ranged;
  const basePower = (ranged ? p.rangedPower : p.meleePower) * hMult * weakenFactor(p);
  const coverBonus = coverAt(state, enemy.hex);
  const mitigation = enemy.defense + coverBonus + enemy.guardBonus;
  const base = basePower + state.weapon.bonus;
  const weak = enemy.weakTo.includes(state.weapon.attackStat);
  const resist = enemy.resistTo.includes(state.weapon.attackStat);
  const weakMult = weak ? 1.25 : resist ? 0.6 : 1;
  const minDmg = Math.max(1, Math.round(base * 0.85 * weakMult) - mitigation);
  return {
    min: minDmg,
    max: Math.max(1, Math.round(base * 1.15 * weakMult) - mitigation),
    dz, heightMult: hMult, mitigation, coverBonus, guardBonus: enemy.guardBonus,
    lethal: minDmg >= enemy.hp, weak, resist,
  };
}

/** Pre-commit damage/heal estimate for a spell cast. Returns null for illusion spells (status only). */
export function previewSpell(state: HexBattleState, key: string, target: Hex | null): AttackPreview | null {
  if (state.player.hasActed || state.turn !== 'player' || state.status !== 'active') return null;
  const spell = getSpell(key);
  if (!spell || state.player.mp < spell.mpCost) return null;

  // Positional mechanics don't produce a numeric preview — overlay shows a text hint instead.
  if (spell.mechanic === 'blink' || spell.mechanic === 'cleave' || spell.mechanic === 'push') return null;

  if (spell.school === 'support') {
    const raw = spellHealAmount(spell.power, state.player.supportSpell);
    const gained = Math.min(raw, state.player.maxHp - state.player.hp);
    return { min: gained, max: gained, dz: 0, heightMult: 1, mitigation: 0, coverBonus: 0, guardBonus: 0, lethal: false, weak: false, resist: false, isHeal: true };
  }
  if (spell.school === 'illusion' || !target) return null;

  const enemy = enemyAt(state, target);
  if (!enemy) return null;
  const p = state.player;
  const dz = elevationAt(state, p.hex) - elevationAt(state, enemy.hex);
  const hMult = heightDamageMult(dz);
  const casterPower = p.damageSpell * hMult * weakenFactor(p);
  const base = spell.power + casterPower * 1.2;
  const schoolStat = SCHOOL_STAT[spell.school];
  const weak = enemy.weakTo.includes(schoolStat) || enemy.weakTo.includes('WI');
  const resist = enemy.resistTo.includes(schoolStat) || enemy.resistTo.includes('WI');
  const weakMult = weak ? 1.25 : resist ? 0.6 : 1;
  const coverBonus = coverAt(state, enemy.hex);
  const mit = enemy.ward + coverBonus;
  const minDmg = Math.max(1, Math.round(base * 0.85 * weakMult) - mit);
  return {
    min: minDmg,
    max: Math.max(1, Math.round(base * 1.15 * weakMult) - mit),
    dz, heightMult: hMult, mitigation: mit, coverBonus, guardBonus: 0,
    lethal: minDmg >= enemy.hp, weak, resist,
  };
}

function recomputeHighlights(s: HexBattleState): void {
  if (s.turn !== 'player' || s.status !== 'active') {
    s.reachable = [];
    s.targetable = [];
    return;
  }
  if (s.selected?.kind === 'move' && s.player.movesLeft > 0) {
    s.reachable = computeReachable(s, s.player.hex, s.player.movesLeft, climbFor(s.player.ag));
    s.targetable = [];
  } else if (s.selected?.kind === 'attack' || s.selected?.kind === 'spell') {
    s.reachable = [];
    s.targetable = computeTargetable(s, s.selected);
  } else {
    s.reachable = [];
    s.targetable = [];
  }
}

// --- Player actions -----------------------------------------------------------------------------
/** Select an action (move / attack / spell) and refresh the highlight caches. */
export function selectAction(state: HexBattleState, action: SelectedAction): HexBattleState {
  const s = clone(state);
  s.selected = action;
  recomputeHighlights(s);
  return s;
}

/** Move the player to a reachable tile. Costs movement but never the action. */
export function movePlayer(state: HexBattleState, to: Hex): HexBattleState {
  if (state.turn !== 'player' || state.status !== 'active') return state;
  const costs = reachableCosts(state, state.player.hex, state.player.movesLeft, climbFor(state.player.ag));
  const dest = costs.get(hexKey(to));
  if (!dest) return state; // illegal move — ignore
  const s = clone(state);
  s.player.hex = { ...to };
  s.player.movesLeft -= dest.cost;
  s.selected = { kind: 'move' };
  recomputeHighlights(s);
  return s;
}

/**
 * Core strike resolution: compute damage, drain stamina, push effects and log onto `s`.
 * Mutates `s` directly (caller holds the clone). Does NOT set `hasActed` or call
 * `finishPlayerAction` — those are the caller's responsibility so this can be reused for
 * both normal attacks and overwatch reaction shots.
 */
function resolvePlayerStrike(s: HexBattleState, enemy: EnemyUnit, rng: RNG): void {
  const pz = elevationAt(s, s.player.hex);
  const dz = pz - elevationAt(s, enemy.hex);
  const ranged = !!s.weapon.ranged;
  const rawPower = (ranged ? s.player.rangedPower : s.player.meleePower) * heightDamageMult(dz) * weakenFactor(s.player);
  const full = s.player.sta >= s.weapon.staminaCost;
  s.player.sta = Math.max(0, s.player.sta - s.weapon.staminaCost);
  const { dealt, weak, resist } = attackRoll(
    rawPower,
    s.weapon.bonus,
    s.weapon.attackStat,
    enemy.weakTo,
    enemy.resistTo,
    full,
    enemy.defense + coverAt(s, enemy.hex) + enemy.guardBonus,
    rng,
  );
  enemy.hp -= dealt;
  const push = effectPusher(s);
  push(ranged ? 'arrow' : 'melee', s.player.hex, enemy.hex);
  s.effects.push({ id: s.seq++, kind: 'floater', from: enemy.hex, to: enemy.hex, startedAtMs: EFFECT_STAGGER_MS + 60, durationMs: 900, label: String(dealt), color: 'dmg-enemy' });
  const tag = weak ? ' — weak to it!' : resist ? ' — resisted' : '';
  const hz = dz > 0 ? ' (high ground)' : dz < 0 ? ' (uphill)' : '';
  s.log.push(`You hit ${enemy.name} for ${dealt}${tag}${hz}${full ? '' : ' (exhausted)'}${enemy.guardBonus > 0 ? ' (guarding)' : ''}.`);
}

/** Resolve the player's weapon attack against a targeted enemy. */
export function playerAttack(state: HexBattleState, target: Hex, rng: RNG = Math.random): HexBattleState {
  if (state.turn !== 'player' || state.status !== 'active' || state.player.hasActed) return state;
  if (!computeTargetable(state, { kind: 'attack' }).some((h) => hexEquals(h, target))) return state;
  const s = clone(state);
  const enemy = enemyAt(s, target)!;
  resolvePlayerStrike(s, enemy, rng);
  s.player.hasActed = true;
  finishPlayerAction(s);
  return s;
}

/**
 * Returns true if the enemy at `enemyHex` is within the player's weapon reach from their current
 * position, accounting for height bonus and line-of-sight (ranged weapons only). This bypasses the
 * `hasActed` gate so it can be used during the enemy phase for overwatch reactions.
 */
function inAttackReach(s: HexBattleState, enemyHex: Hex): boolean {
  const p = s.player.hex;
  const pz = elevationAt(s, p);
  if (s.weapon.ranged) {
    const range = s.weapon.range ?? 1;
    const dz = pz - elevationAt(s, enemyHex);
    return hexDistance(p, enemyHex) <= range + heightRangeBonus(dz) && hasLineOfSight(s, p, enemyHex);
  }
  return hexDistance(p, enemyHex) === 1;
}

/**
 * Hold action: arm a one-shot overwatch reaction and end the player's turn.
 * If an enemy moves into weapon reach during the enemy phase, the reaction fires automatically —
 * one shot only, then the stance clears. Move-then-Hold is allowed; attack-then-Hold is not.
 * An unused stance expires at the start of the next player turn.
 */
export function holdOverwatch(state: HexBattleState, rng: RNG = Math.random): HexBattleState {
  if (state.turn !== 'player' || state.status !== 'active' || state.player.hasActed) return state;
  const s = clone(state);
  s.player.overwatch = true;
  s.player.hasActed = true;
  s.log.push('You take an overwatch stance, ready to fire on the first enemy that enters range.');
  return endPlayerTurn(s, rng);
}

/** Resolve a spell cast. `target` is required for damage/illusion spells, ignored for support. */
export function playerCastSpell(
  state: HexBattleState,
  spellKey: string,
  target: Hex | null,
  rng: RNG = Math.random,
): HexBattleState {
  if (state.turn !== 'player' || state.status !== 'active' || state.player.hasActed) return state;
  if (!state.knownSpells.includes(spellKey)) return state;
  const spell = getSpell(spellKey);
  if (!spell || state.player.mp < spell.mpCost) return state;

  // Cleave and blink are self-targeting (no enemy hex needed); push targets an enemy like illusion.
  const needsTarget = spell.school !== 'support' && spell.mechanic !== 'cleave';
  if (needsTarget && (!target || !computeTargetable(state, { kind: 'spell', spellKey }).some((h) => hexEquals(h, target!)))) {
    return state;
  }
  // Blink requires a valid destination tile even though it is school:support.
  if (spell.mechanic === 'blink' && (!target || !computeTargetable(state, { kind: 'spell', spellKey }).some((h) => hexEquals(h, target!)))) {
    return state;
  }

  const s = clone(state);
  s.player.mp -= spell.mpCost;
  const schoolStat = SCHOOL_STAT[spell.school];
  const push = effectPusher(s);

  // --- Tactics positional mechanics (handled before school branching) ---
  if (spell.mechanic === 'blink') {
    push(`spell:${spell.key}`, s.player.hex, target!);
    s.player.hex = { ...target! };
    s.player.movesLeft = 0;
    s.log.push(`You blink to a nearby position.`);
    s.player.hasActed = true;
    finishPlayerAction(s);
    return s;
  }
  if (spell.mechanic === 'cleave') {
    const adjacent = s.enemies.filter((e) => e.hp > 0 && hexDistance(s.player.hex, e.hex) === 1);
    if (adjacent.length === 0) {
      s.log.push(`Cleave — no adjacent targets.`);
    } else {
      for (const e of adjacent) {
        const rawPower = s.player.meleePower * weakenFactor(s.player);
        const { dealt, weak } = attackRoll(rawPower, spell.power, s.weapon.attackStat, e.weakTo, e.resistTo, true, e.defense + coverAt(s, e.hex), rng);
        e.hp -= dealt;
        push('melee', s.player.hex, e.hex);
        s.effects.push({ id: s.seq++, kind: 'floater', from: e.hex, to: e.hex, startedAtMs: EFFECT_STAGGER_MS + 60, durationMs: 900, label: String(dealt), color: 'dmg-enemy' });
        s.log.push(`Cleave hits ${e.name} for ${dealt}${weak ? ' (weak!)' : ''}.`);
      }
    }
    s.player.hasActed = true;
    finishPlayerAction(s);
    return s;
  }
  if (spell.mechanic === 'push') {
    const enemy = enemyAt(s, target!);
    if (!enemy) return state;
    const dir = computePushDir(s.player.hex, enemy.hex);
    push(`spell:${spell.key}`, s.player.hex, enemy.hex);
    const landing = applyPush(s, enemy, dir, 2);
    const landTerrain = tileAt(s, landing)?.terrain;
    if (landTerrain === 'hazard') {
      const bonus = HAZARD_DMG * 2;
      enemy.hp -= bonus;
      s.effects.push({ id: s.seq++, kind: 'floater', from: landing, to: landing, startedAtMs: EFFECT_STAGGER_MS * 2, durationMs: 900, label: String(bonus), color: 'dmg-enemy' });
      s.log.push(`${spell.name} hurls ${enemy.name} into a hazard for ${bonus} bonus damage!`);
    } else {
      s.log.push(`${spell.name} flings ${enemy.name} back!`);
    }
    s.player.hasActed = true;
    finishPlayerAction(s);
    return s;
  }

  if (spell.school === 'damage') {
    const enemy = enemyAt(s, target!)!;
    const dz = elevationAt(s, s.player.hex) - elevationAt(s, enemy.hex);
    const power = s.player.damageSpell * heightDamageMult(dz) * weakenFactor(s.player);
    const { dealt, weak, resist } = spellDamageRoll(
      spell.power,
      power,
      schoolStat,
      enemy.weakTo,
      enemy.resistTo,
      enemy.ward + coverAt(s, enemy.hex),
      rng,
    );
    enemy.hp -= dealt;
    if (spell.status) applyUnitStatus(enemy.statuses, { ...spell.status });
    push(`spell:${spell.key}`, s.player.hex, enemy.hex);
    s.effects.push({ id: s.seq++, kind: 'floater', from: enemy.hex, to: enemy.hex, startedAtMs: EFFECT_STAGGER_MS + 60, durationMs: 900, label: String(dealt), color: 'dmg-enemy' });
    const tag = weak ? ' — super effective!' : resist ? ' — resisted' : '';
    s.log.push(`${spell.name} sears ${enemy.name} for ${dealt}${tag}.`);
  } else if (spell.school === 'support') {
    if (spell.power > 0) {
      const heal = spellHealAmount(spell.power, s.player.supportSpell);
      const gained = Math.min(heal, s.player.maxHp - s.player.hp);
      s.player.hp += gained;
      s.effects.push({ id: s.seq++, kind: 'floater', from: s.player.hex, to: s.player.hex, startedAtMs: EFFECT_STAGGER_MS + 60, durationMs: 900, label: `+${gained}`, color: 'heal' });
      s.log.push(`${spell.name} restores ${gained} HP.`);
    }
    if (spell.status) {
      applyUnitStatus(s.player.statuses, { ...spell.status });
      s.log.push(`${spell.name} wraps you in a protective ward.`);
    }
    push(`spell:${spell.key}`, s.player.hex, s.player.hex);
  } else {
    // illusion — debuff a foe, duration boosted by Charisma (mirrors combat.ts)
    const enemy = enemyAt(s, target!)!;
    if (spell.status) {
      const boosted = { ...spell.status, turns: spell.status.turns + Math.floor(s.player.illusionPower / 8) };
      applyUnitStatus(enemy.statuses, boosted);
    }
    push(`spell:${spell.key}`, s.player.hex, enemy.hex);
    s.log.push(`${spell.name} bewilders ${enemy.name}.`);
  }

  s.player.hasActed = true;
  finishPlayerAction(s);
  return s;
}

function finishPlayerAction(s: HexBattleState): void {
  checkOutcome(s);
  if (s.status === 'active') {
    s.selected = null;
    recomputeHighlights(s);
  } else {
    s.reachable = [];
    s.targetable = [];
  }
}

/** End the player's turn: tick the player's effects, run the enemy phase, then restore the player. */
export function endPlayerTurn(state: HexBattleState, rng: RNG = Math.random): HexBattleState {
  if (state.turn !== 'player' || state.status !== 'active') return state;
  const s = clone(state);

  applyDoTAndDecay(s, s.player, 'You', true);
  checkOutcome(s);
  if (s.status !== 'active') {
    s.reachable = [];
    s.targetable = [];
    return s;
  }

  s.turn = 'enemy';
  enemyTurn(s, rng);
  if (s.status !== 'active') {
    s.reachable = [];
    s.targetable = [];
    return s;
  }

  // End of enemy phase: hazard/DoT ticks for the foes, then restore the player.
  for (const e of s.enemies) applyDoTAndDecay(s, e, e.name, false);
  checkOutcome(s);
  if (s.status !== 'active') {
    s.reachable = [];
    s.targetable = [];
    return s;
  }

  // --- Objective evaluations (after the enemy phase, before handing control back) ---------------
  if (s.objective && !s.objective.complete && !s.objective.failed) {
    const obj = s.objective;
    if (obj.kind === 'beacon' && obj.beaconHex) {
      const enemyOnBeacon = s.enemies.some((e) => hexEquals(e.hex, obj.beaconHex!));
      if (enemyOnBeacon) {
        obj.progress = 0; // streak broken
      } else {
        obj.progress++;
        if (obj.progress >= obj.target) obj.complete = true;
      }
    } else if (obj.kind === 'flawless') {
      const pct = (s.player.hp / s.player.maxHp) * 100;
      if (pct < obj.target) {
        obj.failed = true;
      } else {
        obj.progress = Math.min(obj.progress, pct);
      }
    }
    // swift is finalised in checkOutcome when the match ends, not per-turn.
  }

  s.turnCount++;
  s.turn = 'player';
  s.player.movesLeft = moveTilesFor(s.player.ag);
  s.player.hasActed = false;
  s.player.overwatch = false; // expire any unused stance (reaction never fired)
  s.selected = null;
  recomputeHighlights(s);
  // Compute intent/threat for the upcoming turn so the UI can telegraph enemy plans.
  s.threatHexes = computeEnemyThreat(s);
  s.intentPlan = planEnemyIntents(s);
  return s;
}

function applyDoTAndDecay(
  s: HexBattleState,
  unit: { hex: Hex; hp: number; statuses: UnitStatus[] },
  name: string,
  isPlayer: boolean,
): void {
  const tile = tileAt(s, unit.hex);
  if (tile?.terrain === 'hazard') {
    unit.hp -= HAZARD_DMG;
    s.log.push(`${name} ${isPlayer ? 'are' : 'is'} scorched by the hazard for ${HAZARD_DMG}.`);
  }
  for (const st of unit.statuses) {
    if (st.key === 'burn' || st.key === 'poison') {
      const d = Math.max(1, Math.round(st.magnitude));
      unit.hp -= d;
      s.log.push(`${name} ${isPlayer ? 'suffer' : 'suffers'} ${d} ${st.key} damage.`);
    }
  }
  unit.statuses = unit.statuses.map((st) => ({ ...st, turns: st.turns - 1 })).filter((st) => st.turns > 0);
}

// --- Push helpers -------------------------------------------------------------------------------

const HEX_DIRS: Hex[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

function computePushDir(from: Hex, to: Hex): Hex {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  let best = HEX_DIRS[0];
  let bestDot = -Infinity;
  for (const d of HEX_DIRS) {
    const dot = dq * d.q + dr * d.r;
    if (dot > bestDot) { bestDot = dot; best = d; }
  }
  return best;
}

function applyPush(s: HexBattleState, enemy: EnemyUnit, dir: Hex, tiles: number): Hex {
  let cur = { ...enemy.hex };
  for (let i = 0; i < tiles; i++) {
    const next = { q: cur.q + dir.q, r: cur.r + dir.r };
    const tile = tileAt(s, next);
    if (!tile || tile.terrain === 'blocked') {
      const dmg = HAZARD_DMG;
      enemy.hp -= dmg;
      s.effects.push({ id: s.seq++, kind: 'floater', from: cur, to: cur, startedAtMs: Math.round(EFFECT_STAGGER_MS * 1.5), durationMs: 800, label: String(dmg), color: 'dmg-enemy' });
      s.log.push(`${enemy.name} crashes into a wall for ${dmg}!`);
      break;
    }
    if (s.enemies.some((e) => e.id !== enemy.id && e.hp > 0 && hexEquals(e.hex, next))) break;
    cur = next;
    if (tile.terrain === 'hazard') break; // stop in the hazard (takes bonus damage after)
  }
  enemy.hex = { ...cur };
  return cur;
}

// --- Enemy AI -----------------------------------------------------------------------------------

/** Weighted-random move selection — mirrors the dungeon combat engine's pickEnemyMove. */
function pickMove(moveset: EnemyMove[] | undefined, rng: RNG): EnemyMove | null {
  if (!moveset || moveset.length === 0) return null;
  const total = moveset.reduce((a, m) => a + (m.weight ?? 1), 0);
  let r = rng() * total;
  for (const m of moveset) {
    r -= m.weight ?? 1;
    if (r < 0) return m;
  }
  return moveset[moveset.length - 1];
}

function mostLikelyMove(moveset: EnemyMove[]): EnemyMove | null {
  if (moveset.length === 0) return null;
  return moveset.reduce((best, m) => ((m.weight ?? 1) > (best.weight ?? 1) ? m : best), moveset[0]);
}

// --- Archetype-scored AI movement ---------------------------------------------------------------

export type AIArchetype = 'charger' | 'kiter' | 'holder' | 'flanker';

/** Visual and descriptive metadata for each AI archetype. Used by the overlay for ring colors,
 *  legend chips, and hover/intent tooltips. */
export const ARCHETYPE_INFO: Record<AIArchetype, { label: string; blurb: string; color: string }> = {
  charger: { label: 'Charger', blurb: 'Closes fast, ignores danger', color: '#ef4444' },
  kiter:   { label: 'Kiter',   blurb: 'Stays at range, seeks high ground', color: '#38bdf8' },
  holder:  { label: 'Holder',  blurb: 'Digs in, guards its position', color: '#f59e0b' },
  flanker: { label: 'Flanker', blurb: 'Circles to a new angle', color: '#a855f7' },
};

function archetypeFor(templateId: string): AIArchetype {
  switch (templateId) {
    case 'dire_wolf': case 'goblin': case 'ghoul': case 'ice_elemental': return 'charger';
    case 'wisp': case 'frost_revenant': return 'kiter';
    case 'stone_sentry': case 'thornling': return 'holder';
    case 'skeleton': case 'giant_spider': return 'flanker';
    default: return 'charger';
  }
}

function computeFlankBonus(s: HexBattleState, self: EnemyUnit, candidate: Hex): number {
  const others = s.enemies.filter((e) => e.hp > 0 && e.id !== self.id);
  if (others.length === 0) return 0;
  const dq = s.player.hex.q - candidate.q;
  const dr = s.player.hex.r - candidate.r;
  const len = Math.sqrt(dq * dq + dr * dr);
  if (len === 0) return 0;
  let avgQ = 0, avgR = 0;
  for (const o of others) {
    const ox = s.player.hex.q - o.hex.q;
    const oy = s.player.hex.r - o.hex.r;
    const ol = Math.sqrt(ox * ox + oy * oy);
    if (ol > 0) { avgQ += ox / ol; avgR += oy / ol; }
  }
  const al = Math.sqrt(avgQ * avgQ + avgR * avgR);
  if (al === 0) return 0;
  const dot = (dq / len) * (avgQ / al) + (dr / len) * (avgR / al);
  return (1 - dot) / 2;
}

function scoreMoveTile(s: HexBattleState, enemy: EnemyUnit, candidate: Hex, arch: AIArchetype): number {
  const dist = hexDistance(candidate, s.player.hex);
  const elevGain = elevationAt(s, candidate) - elevationAt(s, enemy.hex);
  const terrain = tileAt(s, candidate)?.terrain;
  if (terrain === 'hazard') return -1000;
  const coverBonus = terrain === 'cover' ? 1 : 0;

  switch (arch) {
    case 'charger':
      return -dist * 3 + elevGain * 1.5 + coverBonus;
    case 'kiter': {
      const preferred = Math.max(1, enemy.range);
      const tooClose = dist < 2 ? -25 : 0;
      return -Math.abs(dist - preferred) * 4 + elevGain * 3 + tooClose + coverBonus;
    }
    case 'holder': {
      const distFromSelf = hexDistance(candidate, enemy.hex);
      return -dist * 1 - distFromSelf * 3 + elevGain * 1;
    }
    case 'flanker': {
      const flank = computeFlankBonus(s, enemy, candidate);
      return -dist * 2 + flank * 5 + elevGain * 1 + coverBonus;
    }
  }
}

export function bestMoveFor(s: HexBattleState, enemy: EnemyUnit): Hex {
  // Use the pre-baked archetype stored on the unit (avoids a redundant lookup).
  const arch = enemy.aiArchetype;
  // Kiters always evaluate movement (they want optimal range, not just "any range").
  if (arch !== 'kiter' && enemyInRange(s, enemy)) return enemy.hex;
  const costs = reachableCosts(s, enemy.hex, enemy.moveTiles, enemy.climb);
  let best = enemy.hex;
  let bestScore = scoreMoveTile(s, enemy, enemy.hex, arch);
  for (const { hex } of costs.values()) {
    const sc = scoreMoveTile(s, enemy, hex, arch);
    if (sc > bestScore) { bestScore = sc; best = hex; }
  }
  return best;
}

export function climbForEnemy(archetype: string | undefined, tier: number): number {
  const base = archetype === 'beast' || archetype === 'elemental' ? 2 : 1;
  return Math.min(MAX_ELEVATION, base + Math.floor(tier / 10));
}

function enemyTurn(s: HexBattleState, rng: RNG): void {
  const push = effectPusher(s);
  for (const enemy of s.enemies) {
    if (enemy.hp <= 0) continue;
    if (hasStatus(enemy, 'freeze')) {
      s.log.push(`${enemy.name} is frozen and cannot act.`);
      continue;
    }
    enemyAct(s, enemy, rng, push);
    checkOutcome(s);
    if (s.status !== 'active') return;

    // Overwatch reaction: fires once on the first enemy that ends its move in the player's
    // attack reach. The stance clears after the shot regardless of whether it kills.
    if (s.player.overwatch && enemy.hp > 0 && inAttackReach(s, enemy.hex)) {
      s.log.push(`Overwatch! You snap a reaction shot at ${enemy.name}.`);
      resolvePlayerStrike(s, enemy, rng);
      s.player.overwatch = false;
      checkOutcome(s);
      if (s.status !== 'active') return;
    }
  }
}

/** Range at which `enemy` can strike the player, accounting for height (ranged foes only). */
function enemyEffectiveRange(s: HexBattleState, enemy: EnemyUnit): number {
  if (enemy.range <= 1) return 1;
  const dz = elevationAt(s, enemy.hex) - elevationAt(s, s.player.hex);
  return enemy.range + heightRangeBonus(dz);
}

function enemyInRange(s: HexBattleState, enemy: EnemyUnit): boolean {
  const dist = hexDistance(enemy.hex, s.player.hex);
  if (dist > enemyEffectiveRange(s, enemy)) return false;
  return enemy.range <= 1 || hasLineOfSight(s, enemy.hex, s.player.hex);
}

function enemyAct(s: HexBattleState, enemy: EnemyUnit, rng: RNG, push: ReturnType<typeof effectPusher>): void {
  enemy.guardBonus = 0;
  const arch = enemy.aiArchetype;
  // Non-kiters attack immediately when already in range; kiters always reassess position.
  if (arch !== 'kiter' && enemyInRange(s, enemy)) {
    enemyAttack(s, enemy, rng, push);
    return;
  }
  const bestHex = bestMoveFor(s, enemy);
  if (!hexEquals(bestHex, enemy.hex)) {
    enemy.hex = { ...bestHex };
  } else {
    s.log.push(`${enemy.name} holds its ground.`);
  }
  if (enemyInRange(s, enemy)) enemyAttack(s, enemy, rng, push);
}

function enemyAttack(s: HexBattleState, enemy: EnemyUnit, rng: RNG, push: ReturnType<typeof effectPusher>): void {
  push(enemy.range > 1 ? 'arrow' : 'melee', enemy.hex, s.player.hex);
  if (hasStatus(enemy, 'blind') && rng() < 0.4) {
    s.log.push(`${enemy.name} is blinded and misses!`);
    return;
  }
  if (rng() < s.player.dodge) {
    s.log.push(`You dodge ${enemy.name}'s attack!`);
    return;
  }

  const move = pickMove(enemy.moveset, rng);
  const kind = move?.kind ?? 'attack';
  const dz = elevationAt(s, enemy.hex) - elevationAt(s, s.player.hex);
  const hMult = heightDamageMult(dz);
  const mit = (enemy.attackSchool === 'magic' ? s.player.ward : s.player.defense) + coverAt(s, s.player.hex);
  const bless = blessFlat(s.player);

  if (kind === 'guard') {
    enemy.guardBonus = move?.bonus ?? 4;
    s.log.push(`${enemy.name} ${move?.label ?? 'braces defensively'} (+${enemy.guardBonus} defense).`);
    return;
  }

  const baseMult = kind === 'heavy' ? (move?.mult ?? 1.6) : 1.0;
  const hits = kind === 'multi' ? Math.max(1, move?.hits ?? 2) : 1;

  let totalDealt = 0;
  for (let i = 0; i < hits; i++) {
    let dmg = variance(enemy.attack * baseMult * hMult * weakenFactor(enemy), rng);
    dmg = Math.max(1, dmg - mit);
    dmg = Math.max(1, dmg - bless);
    totalDealt += Math.round(dmg);
  }

  s.player.hp -= totalDealt;
  s.effects.push({ id: s.seq++, kind: 'floater', from: s.player.hex, to: s.player.hex, startedAtMs: EFFECT_STAGGER_MS + 60, durationMs: 900, label: `-${totalDealt}`, color: 'dmg-player' });

  if (kind === 'drain') {
    const healed = Math.round(totalDealt * (move?.drainRatio ?? 0.5));
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + healed);
    s.log.push(`${enemy.name} ${move?.label ?? 'drains your life'} for ${totalDealt}${healed > 0 ? `, healing ${healed}` : ''}.`);
  } else if (kind === 'inflict') {
    if (move?.inflictKey) {
      applyUnitStatus(s.player.statuses, { key: move.inflictKey as StatusKey, turns: move.inflictTurns ?? 2, magnitude: move.inflictMag ?? 1 });
      s.effects.push({ id: s.seq++, kind: 'floater', from: s.player.hex, to: s.player.hex, startedAtMs: EFFECT_STAGGER_MS * 2, durationMs: 800, label: move.inflictKey, color: 'status' });
    }
    s.log.push(`${enemy.name} ${move?.label ?? 'strikes you'} for ${totalDealt}.`);
  } else if (kind === 'heavy') {
    s.log.push(`${enemy.name} ${move?.label ?? 'lands a heavy blow'} for ${totalDealt}!`);
  } else if (kind === 'multi' && hits > 1) {
    s.log.push(`${enemy.name} ${move?.label ?? 'attacks rapidly'} for ${totalDealt} (${hits} hits).`);
  } else {
    s.log.push(`${enemy.name} hits you for ${totalDealt}.`);
  }
}

function checkOutcome(s: HexBattleState): void {
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  if (s.enemies.length === 0) {
    s.status = 'won';
    // Finalise objectives that can only be evaluated at match end.
    if (s.objective && !s.objective.failed) {
      const obj = s.objective;
      if (obj.kind === 'swift') {
        obj.complete = s.turnCount <= obj.target;
        if (obj.complete) s.log.push(`Swift Strike complete — won in ${s.turnCount} turn${s.turnCount === 1 ? '' : 's'}!`);
      } else if (obj.kind === 'flawless') {
        obj.complete = !obj.failed;
        if (obj.complete) s.log.push('Unscathed! HP never dropped below 50%.');
      } else if (obj.kind === 'beacon' && obj.complete) {
        s.log.push('Beacon held! Bonus gold awarded.');
      }
    }
  } else if (s.player.hp <= 0) {
    s.player.hp = 0;
    s.status = 'lost';
  }
}

// --- Enemy intent + threat zone (pure, used for UI telegraph and danger overlay) ----------------

export function planEnemyIntents(state: HexBattleState): EnemyIntent[] {
  const pz = elevationAt(state, state.player.hex);
  return state.enemies
    .filter((e) => e.hp > 0)
    .map((enemy) => {
      if (hasStatus(enemy, 'freeze')) {
        return { enemyId: enemy.id, moveTo: enemy.hex, willAttack: false, attackLabel: 'frozen in place', attackIcon: '❄️' };
      }
      const moveTo = bestMoveFor(state, enemy);
      const ez = elevationAt(state, moveTo);
      const effRange = enemy.range <= 1 ? 1 : enemy.range + heightRangeBonus(ez - pz);
      const willAttack = hexDistance(moveTo, state.player.hex) <= effRange &&
        (enemy.range <= 1 || hasLineOfSight(state, moveTo, state.player.hex));
      const move = enemy.moveset ? mostLikelyMove(enemy.moveset) : null;
      return {
        enemyId: enemy.id,
        moveTo,
        willAttack,
        attackLabel: move?.label ?? 'attacks',
        attackIcon: move?.icon ?? (enemy.range > 1 ? '🏹' : '⚔️'),
      };
    });
}

export function computeEnemyThreat(state: HexBattleState): Hex[] {
  const threatened = new Set<string>();
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0 || hasStatus(enemy, 'freeze')) continue;
    const positions = [enemy.hex, ...computeReachable(state, enemy.hex, enemy.moveTiles, enemy.climb)];
    for (const from of positions) {
      const fromZ = elevationAt(state, from);
      for (const tile of Object.values(state.tiles)) {
        if (tile.terrain === 'blocked') continue;
        const tKey = hexKey(tile.hex);
        if (threatened.has(tKey)) continue;
        const dz = fromZ - tile.elevation;
        const effectiveRange = enemy.range <= 1 ? 1 : enemy.range + heightRangeBonus(dz);
        if (hexDistance(from, tile.hex) > effectiveRange) continue;
        if (enemy.range > 1 && !hasLineOfSight(state, from, tile.hex)) continue;
        threatened.add(tKey);
      }
    }
  }
  return [...threatened].map((k) => state.tiles[k].hex);
}

// --- Generation ---------------------------------------------------------------------------------
export interface GenerateOpts {
  radius?: number;
  enemyCount?: number;
  rng?: RNG;
}

/** Glyph shown on each terrain kind (consumed by the overlay). */
export const TERRAIN_ICONS: Record<TerrainKind, string> = {
  floor: '',
  cover: '🛡️',
  slow: '🌿',
  hazard: '🔥',
  blocked: '🪨',
};

/** Build a single self-contained skirmish: a layered board + the player vs scaled foes. */
export function generateSkirmish(
  fighter: Fighter,
  ag: number,
  tier: number,
  knownSpells: string[],
  opts: GenerateOpts = {},
): HexBattleState {
  const rng = opts.rng ?? Math.random;
  const radius = opts.radius ?? TACTICS_BOARD_RADIUS;
  const board = hexBoard(radius);
  const playerSpawn: Hex = { q: 0, r: radius };

  // Bigger boards spawn more foes so they don't feel sparse (still scaled by character tier).
  const sizeBonus = radius - 3 + Math.floor((radius - 3) / 2); // r3→0, r4→1, r6→4
  const enemyCount = clamp(opts.enemyCount ?? 2 + Math.floor(tier / 5) + sizeBonus, 2, 8);
  const enemyPool = Object.keys(ENEMIES);

  // Retry generation until the board is connected and we can place every unit.
  let tiles: Record<string, Tile> = {};
  let enemySpawns: Hex[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    tiles = genTiles(board, playerSpawn, rng, attempt >= 6 /* drop walls on late attempts */);
    enemySpawns = pickEnemySpawns(tiles, board, playerSpawn, radius, enemyCount);
    if (enemySpawns.length === enemyCount && spawnsConnected(tiles, playerSpawn, enemySpawns)) break;
  }
  // Force spawn tiles to be plain, standable floor.
  for (const h of [playerSpawn, ...enemySpawns]) {
    tiles[hexKey(h)] = { hex: h, elevation: hexEquals(h, playerSpawn) ? 0 : Math.min(1, elevationOf(tiles, h)), terrain: 'floor' };
  }
  // Lower any tile that would tower over the tiles behind it (keeps the iso view readable).
  clampOcclusion(tiles, board);

  const { c, weapon } = fighter;
  const scale = 1 + (tier - 1) * 0.07;
  let seq = 1;
  const enemies: EnemyUnit[] = enemySpawns.map((hex) => {
    const tmpl = ENEMIES[enemyPool[Math.floor(rng() * enemyPool.length)]];
    const hp = Math.max(1, Math.round(tmpl.hp * scale));
    // Prefer the template's dedicated glyph; fall back to the first moveset icon so the
    // board shows a meaningful sprite even for templates that haven't been given one yet.
    const unitIcon = tmpl.glyph ?? tmpl.moveset?.[0]?.icon ?? '👹';
    return {
      id: seq++,
      templateId: tmpl.id,
      name: tmpl.name,
      icon: unitIcon,
      aiArchetype: archetypeFor(tmpl.id),
      hex: { ...hex },
      hp,
      maxHp: hp,
      attack: Math.max(1, Math.round(tmpl.attack * scale)),
      defense: tmpl.defense + Math.floor(tier / 8),
      ward: tmpl.ward + Math.floor(tier / 8),
      attackSchool: tmpl.attackSchool,
      weakTo: [...tmpl.weakTo],
      resistTo: [...(tmpl.resistTo ?? [])],
      range: tmpl.attackSchool === 'magic' ? 3 : 1,
      moveTiles: 3 + Math.max(0, radius - 4), // keep pace on large boards
      climb: climbForEnemy(tmpl.archetype, tier),
      statuses: [],
      moveset: tmpl.moveset ? [...tmpl.moveset] : undefined,
      guardBonus: 0,
    } satisfies EnemyUnit;
  });

  const player: PlayerUnit = {
    hex: { ...playerSpawn },
    hp: c.maxHp,
    maxHp: c.maxHp,
    mp: c.maxMp,
    maxMp: c.maxMp,
    sta: c.maxSta,
    maxSta: c.maxSta,
    movesLeft: moveTilesFor(ag),
    hasActed: false,
    overwatch: false,
    ag,
    meleePower: c.meleePower,
    rangedPower: c.rangedPower,
    damageSpell: c.damageSpell,
    supportSpell: c.supportSpell,
    illusionPower: c.illusionPower,
    defense: c.defense,
    ward: c.ward,
    dodge: c.dodge,
    statuses: [],
  };

  // --- Optional secondary objective (~65% of matches) -------------------------------------------
  const objective: TacticsObjective | null = rng() < 0.65
    ? rollObjective(tiles, board, playerSpawn, enemySpawns, enemies.length, radius, rng)
    : null;
  const objectiveMsg = objective ? ` Bonus objective: ${objective.label}.` : '';

  const s: HexBattleState = {
    radius,
    tiles,
    player,
    enemies,
    turn: 'player',
    selected: null,
    reachable: [],
    targetable: [],
    effects: [],
    log: [`A skirmish begins — ${enemies.length} foes stand against you.${objectiveMsg}`],
    status: 'active',
    tier,
    // Arena-only mechanics (runes, ring-of-fire, old teleport) aren't modelled on the tactics grid.
    // The new positional mechanics (blink, push, cleave) ARE always available — they form the
    // core of the positioning system regardless of what spellbooks the player has found.
    knownSpells: [...new Set([...TACTICS_GRANTED_SPELLS, ...knownSpells])].filter((k) => {
      const m = getSpell(k)?.mechanic;
      return !m || m === 'blink' || m === 'push' || m === 'cleave';
    }),
    weapon,
    seq,
    threatHexes: [],
    intentPlan: [],
    objective,
    turnCount: 1,
  };
  s.threatHexes = computeEnemyThreat(s);
  s.intentPlan = planEnemyIntents(s);
  return s;
}

/**
 * Pick and initialise one random secondary objective. Returns null if no suitable beacon
 * tile can be found (very rare on dense boards) — caller falls back to no objective.
 */
function rollObjective(
  tiles: Record<string, Tile>,
  board: Hex[],
  playerSpawn: Hex,
  enemySpawns: Hex[],
  enemyCount: number,
  radius: number,
  rng: RNG,
): TacticsObjective {
  const center: Hex = { q: 0, r: 0 };
  const kind = rng() < 0.33 ? 'beacon' : rng() < 0.5 ? 'swift' : 'flawless';

  if (kind === 'beacon') {
    // Pick the standable floor tile closest to the board centre that isn't a spawn.
    const spawnKeys = new Set([hexKey(playerSpawn), ...enemySpawns.map(hexKey)]);
    const candidate = board
      .filter((h) => {
        const t = tiles[hexKey(h)];
        return t?.terrain === 'floor' && !spawnKeys.has(hexKey(h));
      })
      .sort((a, b) => hexDistance(a, center) - hexDistance(b, center))[0];

    // Fall back to swift when the board is too sparse for a beacon tile.
    if (!candidate) {
      return {
        kind: 'swift', label: 'Swift Strike',
        desc: `Defeat all enemies within ${enemyCount + radius} turns.`,
        target: enemyCount + radius, progress: 0, complete: false, failed: false,
      };
    }
    return {
      kind: 'beacon', label: 'Hold the Beacon',
      desc: 'Keep the marked tile clear of enemies for 5 consecutive turns.',
      target: 5, progress: 0, beaconHex: { ...candidate }, complete: false, failed: false,
    };
  }

  if (kind === 'swift') {
    const budget = enemyCount + radius;
    return {
      kind: 'swift', label: 'Swift Strike',
      desc: `Defeat all enemies within ${budget} turns.`,
      target: budget, progress: 0, complete: false, failed: false,
    };
  }

  // flawless
  return {
    kind: 'flawless', label: 'Unscathed',
    desc: 'Win without dropping below 50% HP.',
    target: 50, progress: 100, complete: false, failed: false,
  };
}

function elevationOf(tiles: Record<string, Tile>, h: Hex): number {
  return tiles[hexKey(h)]?.elevation ?? 0;
}

/**
 * The tile directly behind another in the iso projection: the `up` neighbour `{0,-1}`, which shares
 * the same screen column (`axialToPixel.x` depends only on `q`). A tall tile occludes this column
 * behind it, so capping the rise against the `up` neighbour keeps the whole back column visible.
 * Side neighbours (up-left / up-right) sit in offset columns and stay readable, so cliffs and towers
 * facing sideways are left untouched.
 */
const BEHIND_DIR: Hex = { q: 0, r: -1 };

/**
 * Clamp elevations so no tile rises more than OCCLUSION_RISE above the tile directly behind it.
 * Processed back-to-front (ascending `r`) so each tile's behind-neighbour is already final, giving a
 * stable single pass. Back-edge tiles (nothing behind them) keep their height — that's how cliffs and
 * towers survive at the back without hiding anything.
 */
function clampOcclusion(tiles: Record<string, Tile>, board: Hex[]): void {
  const order = [...board].sort((a, b) => a.r - b.r);
  for (const h of order) {
    const t = tiles[hexKey(h)];
    const b = tiles[hexKey({ q: h.q + BEHIND_DIR.q, r: h.r + BEHIND_DIR.r })];
    if (b && t.elevation > b.elevation + OCCLUSION_RISE) {
      t.elevation = b.elevation + OCCLUSION_RISE;
    }
  }
}

function genTiles(board: Hex[], playerSpawn: Hex, rng: RNG, noWalls: boolean): Record<string, Tile> {
  const tiles: Record<string, Tile> = {};
  // Base: flat floor everywhere.
  for (const hex of board) tiles[hexKey(hex)] = { hex, elevation: 0, terrain: 'floor' };
  // Layered elevation: plateaus that decay outward into slopes; more on larger boards.
  const radius = Math.max(...board.map((h) => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r))));
  const plateaus = 1 + Math.floor(radius / 3) + (rng() < 0.5 ? 1 : 0);
  for (let p = 0; p < plateaus; p++) {
    const center = board[Math.floor(rng() * board.length)];
    const height = 1 + Math.floor(rng() * MAX_ELEVATION); // 1..3
    const spread = 1 + Math.floor(rng() * 2); // 1..2
    for (const hex of board) {
      const d = hexDistance(center, hex);
      if (d <= spread) {
        const key = hexKey(hex);
        tiles[key].elevation = clamp(Math.max(tiles[key].elevation, height - d), 0, MAX_ELEVATION);
      }
    }
  }
  // Terrain roll (player spawn stays floor).
  for (const hex of board) {
    if (hexEquals(hex, playerSpawn)) continue;
    const t = tiles[hexKey(hex)];
    const r = rng();
    if (r < 0.7) t.terrain = 'floor';
    else if (r < 0.82) t.terrain = 'cover';
    else if (r < 0.9) t.terrain = 'slow';
    else if (r < 0.96) t.terrain = 'hazard';
    else if (!noWalls) {
      t.terrain = 'blocked';
      t.elevation = MAX_ELEVATION; // walls read as tall
    }
  }
  return tiles;
}

function pickEnemySpawns(
  tiles: Record<string, Tile>,
  board: Hex[],
  playerSpawn: Hex,
  radius: number,
  count: number,
): Hex[] {
  // Candidates: standable tiles on the far side of the board, farthest-first.
  const candidates = board
    .filter((h) => {
      const t = tiles[hexKey(h)];
      return t.terrain !== 'blocked' && t.elevation <= 1 && hexDistance(h, playerSpawn) >= radius;
    })
    .sort((a, b) => hexDistance(b, playerSpawn) - hexDistance(a, playerSpawn));
  const chosen: Hex[] = [];
  for (const h of candidates) {
    if (chosen.length >= count) break;
    if (chosen.every((c) => hexDistance(c, h) >= 2)) chosen.push(h);
  }
  return chosen;
}

function spawnsConnected(tiles: Record<string, Tile>, start: Hex, spawns: Hex[]): boolean {
  const seen = new Set<string>([hexKey(start)]);
  let frontier = [start];
  while (frontier.length) {
    const next: Hex[] = [];
    for (const cur of frontier) {
      for (const n of hexNeighbors(cur)) {
        const key = hexKey(n);
        const t = tiles[key];
        if (!t || t.terrain === 'blocked' || seen.has(key)) continue;
        seen.add(key);
        next.push(n);
      }
    }
    frontier = next;
  }
  return spawns.every((h) => seen.has(hexKey(h)));
}

// --- Reward -------------------------------------------------------------------------------------
/** Gold reward for a won skirmish; nothing on loss. Stat XP is added by the store on commit. */
export function tacticsReward(state: HexBattleState): Reward {
  if (state.status !== 'won') return {};
  const gold = Math.round(40 * (1 + state.tier * 0.15));
  const reward: Reward = { gold };
  if (state.tier >= 8) reward.items = ['healing_potion'];
  // Completed secondary objective adds +60% gold and guarantees a healing potion.
  if (state.objective?.complete) {
    reward.gold = Math.round(gold * 1.6);
    reward.items = ['healing_potion'];
  }
  return reward;
}
