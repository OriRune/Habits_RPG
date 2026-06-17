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
}

export type Turn = 'player' | 'enemy';

export type SelectedAction =
  | { kind: 'move' }
  | { kind: 'attack' }
  | { kind: 'spell'; spellKey: string }
  | null;

export interface TacticalEffect {
  id: number;
  /** 'melee' | 'arrow' | 'spell:<key>' — the overlay maps this to a CSS keyframe. */
  kind: string;
  from: Hex;
  to: Hex;
  /** Relative offset (ms) from the start of this resolution batch, for cascading animations. */
  startedAtMs: number;
  durationMs: number;
}

export type HexBattleStatus = 'active' | 'won' | 'lost';

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
    if (spell.school === 'support') return []; // self-cast, no target needed
    return living
      .filter((e) => {
        const dz = pz - elevationAt(s, e.hex);
        return hexDistance(p, e.hex) <= SPELL_RANGE + heightRangeBonus(dz) && hasLineOfSight(s, p, e.hex);
      })
      .map((e) => e.hex);
  }
  return [];
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

/** Resolve the player's weapon attack against a targeted enemy. */
export function playerAttack(state: HexBattleState, target: Hex, rng: RNG = Math.random): HexBattleState {
  if (state.turn !== 'player' || state.status !== 'active' || state.player.hasActed) return state;
  if (!computeTargetable(state, { kind: 'attack' }).some((h) => hexEquals(h, target))) return state;
  const s = clone(state);
  const enemy = enemyAt(s, target)!;
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
    enemy.defense + coverAt(s, enemy.hex),
    rng,
  );
  enemy.hp -= dealt;
  const push = effectPusher(s);
  push(ranged ? 'arrow' : 'melee', s.player.hex, enemy.hex);
  const tag = weak ? ' — weak to it!' : resist ? ' — resisted' : '';
  const hz = dz > 0 ? ' (high ground)' : dz < 0 ? ' (uphill)' : '';
  s.log.push(`You hit ${enemy.name} for ${dealt}${tag}${hz}${full ? '' : ' (exhausted)'}.`);
  s.player.hasActed = true;
  finishPlayerAction(s);
  return s;
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

  const needsTarget = spell.school !== 'support';
  if (needsTarget && (!target || !computeTargetable(state, { kind: 'spell', spellKey }).some((h) => hexEquals(h, target!)))) {
    return state;
  }

  const s = clone(state);
  s.player.mp -= spell.mpCost;
  const schoolStat = SCHOOL_STAT[spell.school];
  const push = effectPusher(s);

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
    const tag = weak ? ' — super effective!' : resist ? ' — resisted' : '';
    s.log.push(`${spell.name} sears ${enemy.name} for ${dealt}${tag}.`);
  } else if (spell.school === 'support') {
    if (spell.power > 0) {
      const heal = spellHealAmount(spell.power, s.player.supportSpell);
      const gained = Math.min(heal, s.player.maxHp - s.player.hp);
      s.player.hp += gained;
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

  s.turn = 'player';
  s.player.movesLeft = moveTilesFor(s.player.ag);
  s.player.hasActed = false;
  s.selected = null;
  recomputeHighlights(s);
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

// --- Enemy AI -----------------------------------------------------------------------------------
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
  // Already able to strike? Attack without moving.
  if (enemyInRange(s, enemy)) {
    enemyAttack(s, enemy, rng, push);
    return;
  }
  // Otherwise step toward the player via a climb-aware search (NOT stepToward, which ignores
  // climb/occupancy and gets stuck on walls), then attack if the move brought the player in range.
  const costs = reachableCosts(s, enemy.hex, enemy.moveTiles, enemy.climb);
  let bestHex = enemy.hex;
  let bestDist = hexDistance(enemy.hex, s.player.hex);
  let bestCost = 0;
  for (const { hex, cost } of costs.values()) {
    const d = hexDistance(hex, s.player.hex);
    if (d < bestDist || (d === bestDist && cost < bestCost)) {
      bestDist = d;
      bestHex = hex;
      bestCost = cost;
    }
  }
  if (!hexEquals(bestHex, enemy.hex)) {
    enemy.hex = { ...bestHex };
  } else {
    s.log.push(`${enemy.name} holds its ground.`);
  }
  if (enemyInRange(s, enemy)) enemyAttack(s, enemy, rng, push);
}

function enemyAttack(s: HexBattleState, enemy: EnemyUnit, rng: RNG, push: ReturnType<typeof effectPusher>): void {
  push(enemy.range > 1 ? 'arrow' : 'melee', enemy.hex, s.player.hex);
  // Blind foes may flail and miss.
  if (hasStatus(enemy, 'blind') && rng() < 0.4) {
    s.log.push(`${enemy.name} is blinded and misses!`);
    return;
  }
  // Player evasion (Agility-derived dodge).
  if (rng() < s.player.dodge) {
    s.log.push(`You dodge ${enemy.name}'s attack!`);
    return;
  }
  const dz = elevationAt(s, enemy.hex) - elevationAt(s, s.player.hex);
  let dmg = variance(enemy.attack * heightDamageMult(dz) * weakenFactor(enemy), rng);
  const mit = (enemy.attackSchool === 'magic' ? s.player.ward : s.player.defense) + coverAt(s, s.player.hex);
  dmg = Math.max(1, dmg - mit);
  dmg = Math.max(1, dmg - blessFlat(s.player));
  const dealt = Math.round(dmg);
  s.player.hp -= dealt;
  s.log.push(`${enemy.name} hits you for ${dealt}.`);
}

function checkOutcome(s: HexBattleState): void {
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  if (s.enemies.length === 0) {
    s.status = 'won';
  } else if (s.player.hp <= 0) {
    s.player.hp = 0;
    s.status = 'lost';
  }
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
    const firstIcon = tmpl.moveset?.[0]?.icon ?? '👹';
    return {
      id: seq++,
      templateId: tmpl.id,
      name: tmpl.name,
      icon: firstIcon,
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
      climb: 1,
      statuses: [],
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
    log: [`A skirmish begins — ${enemies.length} foes stand against you.`],
    status: 'active',
    tier,
    // Mechanic spells (runes / ring / blink) have bespoke semantics we don't model on the grid yet.
    knownSpells: knownSpells.filter((k) => !getSpell(k)?.mechanic),
    weapon,
    seq,
  };
  return s;
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
  return reward;
}
