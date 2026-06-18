// The Arena — a real-time boss fight on a square grid (8-direction movement). Where Mine and Forest are
// foraging minigames, this is pure combat: the character's full power (Strength melee, Dexterity
// ranged bolts, Wisdom/Knowledge/Charisma spells, and battle items) driven on a clock instead of
// menus. Fun comes from positioning — every boss blow is telegraphed on the cells it will hit, so
// dodging is stepping off the marked tiles in time. Larger arenas add obstacles (cover) and weak,
// slow minions the boss summons; a per-run speed factor scales the boss/minion clock for difficulty.
//
// Like the other minigames this is a pure engine: every rule returns a new ArenaState and all
// randomness is injected. The store owns the state and a thin loop (src/hooks/useArenaLoop.ts)
// just decides *when* to call these. Damage math is shared with turn-based combat (attackRoll /
// spellDamageRoll / spellHealAmount / variance in src/engine/combat.ts) so the numbers match.
import type { StatId } from './stats';
import type { BossDef, BossPhase } from './bosses';
import type { WeaponDef } from './weapons';
import type { Fighter } from './combat';
import { attackRoll, spellDamageRoll, spellHealAmount, variance } from './combat';
import { getSpell, SCHOOL_STAT, type StatusKey } from './spells';
import { getItem } from './items';
import type { Reward } from './challenges';
import {
  type Cell,
  type Dir,
  DIRS,
  board,
  cellEquals,
  distance,
  line,
  neighbors,
  range,
  step,
  inBoard,
  stepToward,
} from './grid';

export type RNG = () => number;

// --- Tuning ---------------------------------------------------------------------------------
/** Default (medium) board radius. Runs roll small (3) / medium (4) / large (5) per fight. */
export const ARENA_RADIUS = 4;
export const ARENA_ENERGY_COST = 3;
export const ARENA_UNLOCK_LEVEL = 3;
/** Fraction of the earned reward a fallen challenger keeps (the rest is lost). */
export const ARENA_DEATH_KEEP = 0.5;

const ATTACK_CD_MS = 320;
const SPELL_CD_MS = 520;
const ITEM_CD_MS = 700;
const IFRAME_MS = 550;
const STA_REGEN_PER_SEC = 3;
const MP_REGEN_PER_SEC = 1.8; // raised from 1.2 so spells can interleave with attacks
const PROJECTILE_STEP_MS = 60;
const TURN_MS = 1100;
const BASE_ATTACK_STA = 2;

const BOSS_OPENING_GRACE_MS = 1200;
const BOSS_MOVE_CD_MS = 300;
const BOSS_RECOVER_MS = 650;

const MINION_HP_FRAC = 0.18;
const MINION_ATK_FRAC = 0.35;
const MINION_MOVE_CD_MS = 520;
const MINION_HIT_CD_MS = 900;
const MINION_CAP = 4;
const SUMMON_CD_MS = 12000;

const DENSITY_FRAC: Record<ObstacleDensity, number> = { light: 0.06, medium: 0.16, heavy: 0.3 };

// --- New mechanic tuning ---
const RUNE_EXPIRE_MS = 12000;       // untriggered rune lifetime
const FREEZE_DURATION_MS = 3000;    // ice rune freeze duration
const RING_DURATION_MS = 3500;      // ring of fire duration
const RING_HIT_CD_MS = 600;         // ring damage interval per enemy
const POISON_TICK_MS = 1100;        // arena poison DoT tick interval (mirrors TURN_MS)
const POISON_DURATION_MS = 9000;    // 3 ticks worth of poison

interface PatternSpec {
  kind: TelegraphKind;
  windupMs: number;
  dmgMult: number;
}

const PATTERNS: Record<TelegraphKind, PatternSpec> = {
  slam: { kind: 'slam', windupMs: 800, dmgMult: 1.3 },
  line: { kind: 'line', windupMs: 760, dmgMult: 1.05 },
  nova: { kind: 'nova', windupMs: 950, dmgMult: 1.15 },
  volley: { kind: 'volley', windupMs: 860, dmgMult: 0.85 },
};

// --- Types ----------------------------------------------------------------------------------
export type TelegraphKind = 'slam' | 'line' | 'nova' | 'volley';
export type ArenaStatus = 'active' | 'won' | 'ended' | 'banking';
export type ObstacleDensity = 'light' | 'medium' | 'heavy';
export type ArenaSpeed = 'auto' | 'slow' | 'normal' | 'fast';

export interface ArenaStatusEffect {
  key: StatusKey;
  magnitude: number;
  expiresAtMs: number;
  nextTickAtMs?: number;
}

export interface Telegraph {
  id: number;
  kind: TelegraphKind;
  tiles: Cell[];
  startedAtMs: number;
  firesAtMs: number;
  raw: number;
  school: 'physical' | 'magic';
}

export interface Projectile {
  id: number;
  pos: Cell;
  dir: Dir;
  /** Pre-defense damage. Defense is applied on impact (boss: bossDefense; minions: 0). */
  dealt: number;
  nextStepAtMs: number;
}

export interface Minion {
  id: number;
  pos: Cell;
  hp: number;
  maxHp: number;
  attack: number;
  nextMoveMs: number;
  nextHitMs: number;
  frozenUntilMs: number;
  poisonDmg: number;
  poisonNextTickMs: number;
  poisonExpiresMs: number;
}

/** A trap rune placed on a tile, triggered by any unit stepping on it. */
export interface ArenaRune {
  id: number;
  pos: Cell;
  kind: 'fire' | 'ice' | 'poison';
  /** Wisdom-scaled damage dealt on trigger. */
  power: number;
  expiresAtMs: number;
}

export interface ArenaState {
  // Board
  radius: number;
  obstacles: Cell[];

  // Boss (current phase)
  bossId: string;
  bossName: string;
  bossFlavor: string;
  bossPos: Cell;
  bossMaxHp: number;
  bossHp: number;
  bossAttack: number;
  bossDefense: number;
  bossWard: number;
  attackSchool: 'physical' | 'magic';
  weakTo: StatId[];
  resistTo: StatId[];
  phases: BossPhase[];
  phaseIndex: number;
  totalPhases: number;
  bossFrozenUntilMs: number;

  // Minions
  minions: Minion[];
  minionHp: number;
  minionAttack: number;

  // Player snapshot (derived once at entry, mirrors deriveCombatant fields)
  player: { pos: Cell; facing: Dir };
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  sta: number;
  maxSta: number;
  meleePower: number;
  rangedPower: number;
  damageSpell: number;
  supportSpell: number;
  illusionPower: number;
  defense: number;
  ward: number;
  dodge: number;
  weapon: WeaponDef;
  knownSpells: string[];
  inventory: Record<string, number>;
  buffs: Partial<Record<StatId, number>>;
  playerFrozenUntilMs: number;

  // Live combat objects
  projectiles: Projectile[];
  telegraphs: Telegraph[];
  playerStatuses: ArenaStatusEffect[];
  enemyStatuses: ArenaStatusEffect[];

  // Runes: placed traps that trigger when any unit steps on them
  runes: ArenaRune[];

  // Ring of fire: damages enemies adjacent to the player
  ringOfFire: { expiresAtMs: number; dmg: number } | null;
  /** Per-enemy next-hit clock for ring of fire (boss=0, minion=minion.id). */
  ringNextHitMs: Record<number, number>;

  // Difficulty / modes
  speed: number;
  invincible: boolean;

  // Per-stat usage tallies (incremented by player actions for usage-based XP)
  statUsage: Partial<Record<StatId, number>>;

  // Run-level stats (for the outcome summary)
  damageDealt: number;
  startedAtMs: number;

  // Clocks
  lastTickMs: number;
  lastHitAtMs: number;
  /** Timestamp of the most recent successful dodge (for "Dodge!" UI floater). */
  lastDodgedAtMs: number;
  cooldownUntilMs: number;
  /** Independent cooldown clock for spells — separate from attack cooldown so casts
   *  can interleave with melee/ranged attacks without blocking each other. */
  spellCooldownUntilMs: number;
  itemCooldownUntilMs: number;
  bossNextActionMs: number;
  bossNextMoveMs: number;
  nextSummonMs: number;

  // Reward bookkeeping
  rewardGold: number;
  rewardItems: string[];
  tier: number;

  status: ArenaStatus;
  seq: number;
}

// --- Small helpers --------------------------------------------------------------------------
const cellKey = (h: Cell) => `${h.x},${h.y}`;

function scaled(s: ArenaState, ms: number): number {
  return ms / s.speed;
}

function isBlocked(s: ArenaState, h: Cell): boolean {
  return s.obstacles.some((o) => cellEquals(o, h));
}

// --- BFS flow-field pathfinding (replaces greedy stepAvoiding) --------------------------------

/**
 * BFS from `target` across in-board, non-obstacle cells. Returns a map from cellKey → distance
 * so each chaser can pick the best next step toward the target while routing around wall clusters.
 */
function floodField(target: Cell, radius: number, obstacles: Cell[]): Map<string, number> {
  const blocked = new Set(obstacles.map(cellKey));
  const dist = new Map<string, number>();
  const queue: Cell[] = [target];
  dist.set(cellKey(target), 0);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(cellKey(cur))!;
    for (const dir of DIRS) {
      const n = step(cur, dir);
      const k = cellKey(n);
      if (!inBoard(n, radius) || blocked.has(k) || dist.has(k)) continue;
      dist.set(k, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

/**
 * Pick the best next step for a chaser using the flow field.
 * `occupied` prevents stepping onto the player/other units as an immediate move.
 */
function flowStep(from: Cell, field: Map<string, number>, radius: number, blocked: Set<string>): Cell | null {
  let best: Cell | null = null;
  let bestD = Infinity;
  for (const dir of DIRS) {
    const n = step(from, dir);
    const k = cellKey(n);
    if (!inBoard(n, radius) || blocked.has(k)) continue;
    const d = field.get(k) ?? Infinity;
    if (d < bestD) { bestD = d; best = n; }
  }
  return bestD < (field.get(cellKey(from)) ?? Infinity) ? best : null;
}

function blockedKeys(s: ArenaState, occupants: Cell[]): Set<string> {
  const set = new Set<string>();
  for (const o of s.obstacles) set.add(cellKey(o));
  for (const o of occupants) set.add(cellKey(o));
  return set;
}

// --- Status helpers -------------------------------------------------------------------------
function activeStatus(list: ArenaStatusEffect[], key: StatusKey, now: number): ArenaStatusEffect | undefined {
  return list.find((x) => x.key === key && x.expiresAtMs > now);
}

function applyArenaStatus(
  list: ArenaStatusEffect[],
  status: { key: StatusKey; turns: number; magnitude: number },
  now: number,
): void {
  const expiresAtMs = now + status.turns * TURN_MS;
  const existing = list.find((x) => x.key === status.key);
  if (existing) {
    existing.expiresAtMs = Math.max(existing.expiresAtMs, expiresAtMs);
    existing.magnitude = Math.max(existing.magnitude, status.magnitude);
    if (status.key === 'burn' && existing.nextTickAtMs == null) existing.nextTickAtMs = now + TURN_MS;
    if (status.key === 'poison' && existing.nextTickAtMs == null) existing.nextTickAtMs = now + POISON_TICK_MS;
  } else {
    list.push({
      key: status.key,
      magnitude: status.magnitude,
      expiresAtMs,
      nextTickAtMs: status.key === 'burn' ? now + TURN_MS : status.key === 'poison' ? now + POISON_TICK_MS : undefined,
    });
  }
}

// --- Setup rolls (size / obstacles), speed -------------------------------------------------
export interface ArenaSetup {
  radius: number;
  density: ObstacleDensity;
  startMinions: number;
}

export function rollArenaSetup(tier: number, rng: RNG = Math.random): ArenaSetup {
  const sr = rng();
  const smallP = Math.max(0.15, 0.45 - tier * 0.03);
  const largeP = Math.min(0.5, 0.1 + tier * 0.03);
  const radius = sr < smallP ? 3 : sr > 1 - largeP ? 5 : 4;

  const dr = rng();
  const lightP = Math.max(0.2, 0.5 - tier * 0.025);
  const heavyP = Math.min(0.45, 0.08 + tier * 0.025);
  const density: ObstacleDensity = dr < lightP ? 'light' : dr > 1 - heavyP ? 'heavy' : 'medium';

  const startMinions = radius >= 5 ? 2 : radius >= 4 ? 1 : 0;
  return { radius, density, startMinions };
}

export function arenaSpeedFactor(setting: ArenaSpeed, level: number): number {
  switch (setting) {
    case 'slow': return 0.85;
    case 'fast': return 1.2;
    case 'normal': return 1.0;
    case 'auto':
    default:
      return Math.max(0.85, Math.min(1.2, 0.8 + (level - ARENA_UNLOCK_LEVEL) * 0.02));
  }
}

function genObstacles(radius: number, density: ObstacleDensity, rng: RNG, start: Cell[], boss: Cell): Cell[] {
  const cells = board(radius);
  const target = Math.floor(cells.length * DENSITY_FRAC[density]);
  if (target <= 0) return [];
  const excluded = new Set<string>();
  for (const h of [...start, boss]) {
    excluded.add(cellKey(h));
    for (const n of neighbors(h)) excluded.add(cellKey(n));
  }
  const pool = cells.filter((h) => !excluded.has(cellKey(h)));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, target).map((h) => ({ ...h }));
}

// --- Phase / boss / minion setup ------------------------------------------------------------
function phaseList(boss: BossDef): BossPhase[] {
  return boss.phases && boss.phases.length > 0
    ? boss.phases
    : [
        {
          hp: boss.baseHp,
          attack: boss.attack,
          defense: boss.defense,
          ward: boss.ward,
          attackSchool: boss.attackSchool,
          weakTo: boss.weakTo,
          resistTo: boss.resistTo,
        },
      ];
}

function applyArenaPhase(s: ArenaState, phase: BossPhase): void {
  s.bossMaxHp = phase.hp;
  s.bossHp = phase.hp;
  s.bossAttack = phase.attack;
  s.bossDefense = phase.defense;
  s.bossWard = phase.ward ?? 0;
  s.attackSchool = phase.attackSchool ?? 'physical';
  s.weakTo = phase.weakTo;
  s.resistTo = phase.resistTo ?? [];
}

function occupiedKeys(s: ArenaState): Set<string> {
  const set = new Set<string>([cellKey(s.bossPos), cellKey(s.player.pos)]);
  for (const m of s.minions) set.add(cellKey(m.pos));
  for (const o of s.obstacles) set.add(cellKey(o));
  return set;
}

function spawnMinion(s: ArenaState, now: number, rng: RNG): void {
  if (s.minions.length >= MINION_CAP) return;
  const occ = occupiedKeys(s);
  let spot = neighbors(s.bossPos).find((h) => inBoard(h, s.radius) && !occ.has(cellKey(h)));
  if (!spot) {
    const free = board(s.radius).filter((h) => !occ.has(cellKey(h)) && distance(h, s.player.pos) >= 2);
    if (free.length === 0) return;
    spot = free[Math.floor(rng() * free.length)];
  }
  s.minions.push({
    id: s.seq++,
    pos: { ...spot },
    hp: s.minionHp,
    maxHp: s.minionHp,
    attack: s.minionAttack,
    nextMoveMs: now + scaled(s, MINION_MOVE_CD_MS),
    nextHitMs: now + scaled(s, MINION_HIT_CD_MS),
    frozenUntilMs: 0,
    poisonDmg: 0,
    poisonNextTickMs: 0,
    poisonExpiresMs: 0,
  });
}

export function createArena(
  fighter: Fighter,
  boss: BossDef,
  opts: {
    knownSpells: string[];
    inventory: Record<string, number>;
    tier: number;
    startMs?: number;
    rng?: RNG;
    radius?: number;
    density?: ObstacleDensity;
    startMinions?: number;
    speed?: number;
    invincible?: boolean;
  },
): ArenaState {
  const { c, weapon } = fighter;
  const phases = phaseList(boss);
  const startMs = opts.startMs ?? 0;
  const rng = opts.rng ?? Math.random;
  const radius = opts.radius ?? ARENA_RADIUS;
  const speed = opts.speed ?? 1;
  const playerStart: Cell = { x: 0, y: radius };
  const bossStart: Cell = { x: 0, y: -radius };
  const inventory: Record<string, number> = {};
  for (const [key, n] of Object.entries(opts.inventory)) {
    const item = getItem(key);
    if (item && item.context === 'battle' && n > 0) inventory[key] = n;
  }
  const s: ArenaState = {
    radius,
    obstacles: genObstacles(radius, opts.density ?? 'light', rng, [playerStart], bossStart),
    bossId: boss.id,
    bossName: boss.name,
    bossFlavor: boss.flavor,
    bossPos: bossStart,
    bossMaxHp: 0,
    bossHp: 0,
    bossAttack: 0,
    bossDefense: 0,
    bossWard: 0,
    attackSchool: 'physical',
    weakTo: [],
    resistTo: [],
    phases,
    phaseIndex: 0,
    totalPhases: phases.length,
    bossFrozenUntilMs: 0,
    minions: [],
    minionHp: Math.max(1, Math.round(phases[0].hp * MINION_HP_FRAC)),
    minionAttack: Math.max(1, Math.round(phases[0].attack * MINION_ATK_FRAC)),
    player: { pos: { ...playerStart }, facing: 'up' },
    hp: c.maxHp,
    maxHp: c.maxHp,
    mp: c.maxMp,
    maxMp: c.maxMp,
    sta: c.maxSta,
    maxSta: c.maxSta,
    meleePower: c.meleePower,
    rangedPower: c.rangedPower,
    damageSpell: c.damageSpell,
    supportSpell: c.supportSpell,
    illusionPower: c.illusionPower,
    defense: c.defense,
    ward: c.ward,
    dodge: c.dodge,
    weapon,
    knownSpells: [...opts.knownSpells],
    inventory,
    buffs: {},
    playerFrozenUntilMs: 0,
    projectiles: [],
    telegraphs: [],
    playerStatuses: [],
    enemyStatuses: [],
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    speed,
    invincible: opts.invincible ?? false,
    statUsage: {},
    damageDealt: 0,
    startedAtMs: startMs,
    lastTickMs: startMs,
    lastHitAtMs: -Infinity,
    lastDodgedAtMs: -Infinity,
    cooldownUntilMs: 0,
    spellCooldownUntilMs: 0,
    itemCooldownUntilMs: 0,
    bossNextActionMs: startMs + BOSS_OPENING_GRACE_MS,
    bossNextMoveMs: startMs + BOSS_OPENING_GRACE_MS,
    nextSummonMs: startMs + SUMMON_CD_MS / speed,
    rewardGold: boss.rewards.gold,
    rewardItems: [...boss.rewards.items],
    tier: opts.tier,
    status: 'active',
    seq: 1,
  };
  applyArenaPhase(s, phases[0]);
  for (let i = 0; i < (opts.startMinions ?? 0); i++) spawnMinion(s, startMs, rng);
  return s;
}

function clone(s: ArenaState): ArenaState {
  return {
    ...s,
    player: { ...s.player, pos: { ...s.player.pos } },
    bossPos: { ...s.bossPos },
    minions: s.minions.map((m) => ({ ...m, pos: { ...m.pos } })),
    projectiles: s.projectiles.map((p) => ({ ...p, pos: { ...p.pos } })),
    telegraphs: s.telegraphs.map((t) => ({ ...t, tiles: t.tiles.map((h) => ({ ...h })) })),
    playerStatuses: s.playerStatuses.map((x) => ({ ...x })),
    enemyStatuses: s.enemyStatuses.map((x) => ({ ...x })),
    runes: s.runes.map((r) => ({ ...r, pos: { ...r.pos } })),
    ringOfFire: s.ringOfFire ? { ...s.ringOfFire } : null,
    ringNextHitMs: { ...s.ringNextHitMs },
    buffs: { ...s.buffs },
    inventory: { ...s.inventory },
    statUsage: { ...s.statUsage },
  };
}

export function damageProgress(s: ArenaState): number {
  const cleared = s.phaseIndex;
  const current = s.bossMaxHp > 0 ? 1 - Math.max(0, s.bossHp) / s.bossMaxHp : 0;
  return Math.max(0, Math.min(1, (cleared + current) / s.totalPhases));
}

function resolveBossDown(s: ArenaState, now: number, rng: RNG): void {
  if (s.phaseIndex < s.phases.length - 1) {
    s.phaseIndex += 1;
    applyArenaPhase(s, s.phases[s.phaseIndex]);
    // Recompute minion stats from the new phase so later-phase minions scale correctly.
    s.minionHp = Math.max(1, Math.round(s.phases[s.phaseIndex].hp * MINION_HP_FRAC));
    s.minionAttack = Math.max(1, Math.round(s.phases[s.phaseIndex].attack * MINION_ATK_FRAC));
    s.enemyStatuses = [];
    s.telegraphs = [];
    s.projectiles = [];
    s.bossPos = { x: 0, y: -s.radius };
    s.bossFrozenUntilMs = 0;
    s.bossNextActionMs = now + BOSS_OPENING_GRACE_MS;
    s.bossNextMoveMs = now + BOSS_OPENING_GRACE_MS;
    const summons = s.radius >= 5 ? 2 : s.radius >= 4 ? 1 : 0;
    for (let i = 0; i < summons; i++) spawnMinion(s, now, rng);
  } else {
    s.bossHp = 0;
    s.status = 'won';
  }
}

// --- Multi-enemy damage application ---------------------------------------------------------
type EnemyRef = { kind: 'boss' } | { kind: 'minion'; id: number };

function enemyAt(s: ArenaState, h: Cell): EnemyRef | null {
  if (cellEquals(h, s.bossPos)) return { kind: 'boss' };
  const m = s.minions.find((mm) => cellEquals(mm.pos, h));
  return m ? { kind: 'minion', id: m.id } : null;
}

function hurtEnemy(s: ArenaState, ref: EnemyRef, dmg: number, now: number, rng: RNG): void {
  s.damageDealt += dmg;
  if (ref.kind === 'boss') {
    s.bossHp -= dmg;
    if (s.bossHp <= 0) resolveBossDown(s, now, rng);
  } else {
    const m = s.minions.find((x) => x.id === ref.id);
    if (!m) return;
    m.hp -= dmg;
    if (m.hp <= 0) s.minions = s.minions.filter((x) => x.id !== ref.id);
  }
}

// --- Player actions -------------------------------------------------------------------------

/** Step one cell in a direction. Respects player freeze (`playerFrozenUntilMs` vs `lastTickMs`). */
export function arenaMove(state: ArenaState, dir: Dir): ArenaState {
  if (state.status !== 'active') return state;
  const s = clone(state);
  s.player.facing = dir;
  // Use lastTickMs as a proxy for now — within 90 ms of real time, good enough for freeze.
  if (state.playerFrozenUntilMs > state.lastTickMs) return s;
  const next = step(s.player.pos, dir);
  if (inBoard(next, s.radius) && !isBlocked(s, next)) s.player.pos = next;
  return s;
}

/** Melee swing — hits the faced adjacent enemy (or nearest adjacent if not faced). Optional dir pre-sets facing. */
export function arenaMelee(state: ArenaState, now: number, rng: RNG = Math.random, dir?: Dir): ArenaState {
  if (state.status !== 'active' || now < state.cooldownUntilMs) return state;
  const s = clone(state);
  if (dir) s.player.facing = dir;
  const faced = step(s.player.pos, s.player.facing);
  let target = enemyAt(s, faced);
  if (!target) {
    if (distance(s.player.pos, s.bossPos) <= 1) target = { kind: 'boss' };
    else {
      const adj = s.minions.filter((m) => distance(s.player.pos, m.pos) <= 1);
      if (adj.length > 0) target = { kind: 'minion', id: adj[0].id };
    }
  }
  if (!target) return state;
  const bonus = s.weapon.attackStat === 'ST' ? s.weapon.bonus : 0;
  const staCost = s.weapon.attackStat === 'ST' ? s.weapon.staminaCost : BASE_ATTACK_STA;
  const full = s.sta >= staCost;
  s.sta = Math.max(0, s.sta - staCost);
  const isBoss = target.kind === 'boss';
  const { dealt } = attackRoll(
    s.meleePower, bonus, 'ST', isBoss ? s.weakTo : [], isBoss ? s.resistTo : [], full, isBoss ? s.bossDefense : 0, rng,
  );
  hurtEnemy(s, target, dealt, now, rng);
  s.cooldownUntilMs = now + ATTACK_CD_MS;
  // Usage tracking for usage-based XP
  s.statUsage.ST = (s.statUsage.ST ?? 0) + 1;
  s.statUsage.EN = (s.statUsage.EN ?? 0) + 1;
  return s;
}

/** Fire a ranged bolt. Optional dir pre-sets facing. */
export function arenaRanged(state: ArenaState, now: number, rng: RNG = Math.random, dir?: Dir): ArenaState {
  if (state.status !== 'active' || now < state.cooldownUntilMs) return state;
  const s = clone(state);
  if (dir) s.player.facing = dir;
  const bonus = s.weapon.attackStat === 'DX' ? s.weapon.bonus : 0;
  const staCost = s.weapon.attackStat === 'DX' ? s.weapon.staminaCost : BASE_ATTACK_STA;
  const full = s.sta >= staCost;
  s.sta = Math.max(0, s.sta - staCost);
  // Store pre-defense damage so the correct target's defense can be applied on impact.
  const { dealt } = attackRoll(
    s.rangedPower, bonus, 'DX', s.weakTo, s.resistTo, full, 0, rng,
  );
  s.projectiles.push({
    id: s.seq++,
    pos: step(s.player.pos, s.player.facing),
    dir: s.player.facing,
    dealt,
    nextStepAtMs: now + PROJECTILE_STEP_MS,
  });
  s.cooldownUntilMs = now + ATTACK_CD_MS;
  // Usage tracking for usage-based XP
  s.statUsage.DX = (s.statUsage.DX ?? 0) + 1;
  s.statUsage.EN = (s.statUsage.EN ?? 0) + 1;
  return s;
}

/** Context attack (space/Act). Optional dir pre-sets facing. */
export function arenaAct(state: ArenaState, now: number, rng: RNG = Math.random, dir?: Dir): ArenaState {
  if (state.weapon.attackStat === 'DX') return arenaRanged(state, now, rng, dir);
  const enemyAdjacent =
    distance(state.player.pos, state.bossPos) <= 1 ||
    state.minions.some((m) => distance(state.player.pos, m.pos) <= 1);
  return enemyAdjacent ? arenaMelee(state, now, rng, dir) : arenaRanged(state, now, rng, dir);
}

function nearestEnemy(s: ArenaState): EnemyRef {
  let best: EnemyRef = { kind: 'boss' };
  let bestD = distance(s.player.pos, s.bossPos);
  for (const m of s.minions) {
    const d = distance(s.player.pos, m.pos);
    if (d < bestD) { bestD = d; best = { kind: 'minion', id: m.id }; }
  }
  return best;
}

/**
 * Clamp a desired rune target cell to an adjacent (Chebyshev ≤ 1), in-board, non-obstacle cell.
 * Falls back to the player's faced adjacent tile if the request is out of range or blocked.
 */
function clampRuneTarget(s: ArenaState, desired: Cell | undefined, rng: RNG): Cell | null {
  const faced = step(s.player.pos, s.player.facing);
  const candidate = desired ?? faced;
  // Clamp to adjacent if too far.
  const clamped = distance(candidate, s.player.pos) <= 1 ? candidate : step(s.player.pos, stepToward(s.player.pos, candidate));
  if (inBoard(clamped, s.radius) && !isBlocked(s, clamped)) return clamped;
  // Fall back to any adjacent non-blocked cell.
  const opts = neighbors(s.player.pos).filter((n) => inBoard(n, s.radius) && !isBlocked(s, n));
  if (opts.length === 0) return null;
  return opts[Math.floor(rng() * opts.length)];
}

/**
 * Preview where a rune will land for a desired cell without randomness.
 * Returns null if the resolved cell is blocked or out of board (random fallback skipped — UI can
 * show nothing in that case rather than an unpredictable highlight).
 */
export function previewRuneTarget(s: ArenaState, desired: Cell): Cell | null {
  const clamped = distance(desired, s.player.pos) <= 1 ? desired : step(s.player.pos, stepToward(s.player.pos, desired));
  if (inBoard(clamped, s.radius) && !isBlocked(s, clamped)) return clamped;
  return null;
}

/** Cast a known spell. Optional dir pre-sets facing; optional target is used for rune placement. */
export function arenaCast(
  state: ArenaState,
  spellKey: string,
  now: number,
  rng: RNG = Math.random,
  opts?: { dir?: Dir; target?: Cell },
): ArenaState {
  if (state.status !== 'active' || now < state.spellCooldownUntilMs) return state;
  if (!state.knownSpells.includes(spellKey)) return state;
  const spell = getSpell(spellKey);
  if (!spell || state.mp < spell.mpCost) return state;
  const s = clone(state);
  if (opts?.dir) s.player.facing = opts.dir;
  s.mp -= spell.mpCost;
  s.spellCooldownUntilMs = now + SPELL_CD_MS;
  const schoolStat = SCHOOL_STAT[spell.school];
  // Usage tracking (damage/rune/ring scale with WI; support with KN; illusion with CH)
  if (spell.school === 'damage' || spell.mechanic === 'rune-fire' || spell.mechanic === 'rune-ice'
      || spell.mechanic === 'rune-poison' || spell.mechanic === 'ring-of-fire') {
    s.statUsage.WI = (s.statUsage.WI ?? 0) + 1;
  } else if (spell.school === 'support' || spell.mechanic === 'teleport') {
    s.statUsage.KN = (s.statUsage.KN ?? 0) + 1;
  } else {
    // illusion school
    s.statUsage.CH = (s.statUsage.CH ?? 0) + 1;
  }

  // --- Rune placement mechanics ---
  if (spell.mechanic === 'rune-fire' || spell.mechanic === 'rune-ice' || spell.mechanic === 'rune-poison') {
    const kind = spell.mechanic.slice(5) as 'fire' | 'ice' | 'poison';
    const pos = clampRuneTarget(s, opts?.target, rng);
    if (pos) {
      const { dealt } = spellDamageRoll(spell.power, s.damageSpell, schoolStat, [], [], 0, rng);
      s.runes.push({ id: s.seq++, pos, kind, power: dealt, expiresAtMs: now + RUNE_EXPIRE_MS });
    }
    return s;
  }

  // --- Ring of fire ---
  if (spell.mechanic === 'ring-of-fire') {
    const dmg = Math.max(2, Math.round(spell.power + s.damageSpell * 0.5));
    s.ringOfFire = { expiresAtMs: now + RING_DURATION_MS, dmg };
    s.ringNextHitMs = {};
    return s;
  }

  // --- Teleport ---
  if (spell.mechanic === 'teleport') {
    const occ = occupiedKeys(s);
    const candidates = board(s.radius).filter((h) => {
      const d = distance(h, s.player.pos);
      return d >= 3 && d <= 5 && !occ.has(cellKey(h));
    });
    if (candidates.length > 0) {
      s.player.pos = { ...candidates[Math.floor(rng() * candidates.length)] };
    }
    return s;
  }

  // --- Standard spell schools ---
  if (spell.school === 'damage') {
    const target = nearestEnemy(s);
    const isBoss = target.kind === 'boss';
    const { dealt } = spellDamageRoll(
      spell.power, s.damageSpell, schoolStat,
      isBoss ? s.weakTo : [], isBoss ? s.resistTo : [], isBoss ? s.bossWard : 0, rng,
    );
    hurtEnemy(s, target, dealt, now, rng);
    if (spell.status && isBoss) applyArenaStatus(s.enemyStatuses, spell.status, now);
  } else if (spell.school === 'support') {
    if (spell.power > 0) {
      const heal = spellHealAmount(spell.power, s.supportSpell);
      s.hp = Math.min(s.maxHp, s.hp + heal);
    }
    if (spell.status) applyArenaStatus(s.playerStatuses, spell.status, now);
  } else if (spell.status) {
    const boosted = { ...spell.status, turns: spell.status.turns + Math.floor(s.illusionPower / 8) };
    applyArenaStatus(s.enemyStatuses, boosted, now);
  }
  return s;
}

function applyStatBuff(s: ArenaState, stat: StatId, val: number): void {
  s.buffs[stat] = (s.buffs[stat] ?? 0) + val;
  switch (stat) {
    case 'ST': s.meleePower += val; break;
    case 'DX': s.rangedPower += val; break;
    case 'WI': s.damageSpell += val; break;
    case 'KN': s.supportSpell += val; s.maxMp += val * 3; s.mp += val * 3; break;
    case 'CH': s.illusionPower += val; break;
    case 'EN': s.maxSta += val; s.sta += val; break;
    case 'HP': s.maxHp += val * 7; s.hp += val * 7; break;
    case 'AG': s.dodge = Math.min(0.4, s.dodge + val * 0.02); break;
  }
}

export function arenaUseItem(state: ArenaState, itemKey: string, now: number): ArenaState {
  if (state.status !== 'active' || now < state.itemCooldownUntilMs) return state;
  if ((state.inventory[itemKey] ?? 0) <= 0) return state;
  const item = getItem(itemKey);
  if (!item || item.context !== 'battle') return state;
  const s = clone(state);
  s.inventory[itemKey] -= 1;
  if (item.effect.healHp) s.hp = Math.min(s.maxHp, s.hp + item.effect.healHp);
  if (item.effect.buff) {
    for (const [stat, val] of Object.entries(item.effect.buff)) {
      if (val) applyStatBuff(s, stat as StatId, val);
    }
  }
  s.itemCooldownUntilMs = now + ITEM_CD_MS;
  return s;
}

// --- The clock: projectiles, telegraphs, minions, statuses, boss AI -------------------------
function mitigatedBossHit(s: ArenaState, raw: number, school: 'physical' | 'magic', now: number): number {
  let dmg = raw;
  const weaken = activeStatus(s.enemyStatuses, 'weaken', now);
  if (weaken) dmg *= 1 - weaken.magnitude;
  const mit = school === 'magic' ? s.ward : s.defense;
  dmg = Math.max(1, dmg - mit);
  const bless = activeStatus(s.playerStatuses, 'bless', now);
  if (bless) dmg = Math.max(1, dmg - bless.magnitude);
  return Math.max(1, Math.round(dmg));
}

function strikePlayer(s: ArenaState, raw: number, school: 'physical' | 'magic', now: number, rng: RNG): void {
  if (s.invincible) return;
  if (now - s.lastHitAtMs < IFRAME_MS) return;
  if (rng() < s.dodge) {
    s.lastDodgedAtMs = now;
    s.statUsage.AG = (s.statUsage.AG ?? 0) + 1;
    return;
  }
  const dealt = mitigatedBossHit(s, raw, school, now);
  s.hp -= dealt;
  s.lastHitAtMs = now;
  if (s.hp <= 0) { s.hp = 0; s.status = 'ended'; }
}

function stepProjectiles(s: ArenaState, now: number, rng: RNG): void {
  const survivors: Projectile[] = [];
  for (const p of s.projectiles) {
    let done = false;
    while (now >= p.nextStepAtMs && !done) {
      if (isBlocked(s, p.pos) || !inBoard(p.pos, s.radius)) { done = true; break; }
      const here = enemyAt(s, p.pos);
      if (here) {
        // Apply the correct target's defense. Minions have no separate defense stat.
        const dmg = here.kind === 'boss' ? Math.max(1, p.dealt - s.bossDefense) : p.dealt;
        hurtEnemy(s, here, dmg, now, rng);
        done = true;
        break;
      }
      p.pos = step(p.pos, p.dir);
      p.nextStepAtMs += PROJECTILE_STEP_MS;
    }
    if (!done && s.status === 'active') survivors.push(p);
  }
  s.projectiles = survivors;
}

function resolveTelegraphs(s: ArenaState, now: number, rng: RNG): void {
  const pending: Telegraph[] = [];
  for (const t of s.telegraphs) {
    if (now < t.firesAtMs) { pending.push(t); continue; }
    if (t.tiles.some((h) => cellEquals(h, s.player.pos))) strikePlayer(s, t.raw, t.school, now, rng);
  }
  s.telegraphs = pending;
}

/** Trigger any runes that a unit just stepped onto. Called after every unit movement. */
function triggerRunes(s: ArenaState, now: number, rng: RNG): void {
  if (s.runes.length === 0) return;
  const triggered = new Set<number>();

  const fireRune = (rune: ArenaRune, target: 'player' | EnemyRef) => {
    triggered.add(rune.id);
    if (target === 'player') {
      if (!s.invincible) strikePlayer(s, rune.power, 'magic', now, rng);
      if (rune.kind === 'poison') applyArenaStatus(s.playerStatuses, { key: 'poison', turns: 3, magnitude: Math.round(rune.power * 0.25) }, now);
    } else {
      hurtEnemy(s, target, rune.power, now, rng);
      if (rune.kind === 'fire') {
        if (target.kind === 'boss') applyArenaStatus(s.enemyStatuses, { key: 'burn', turns: 2, magnitude: Math.round(rune.power * 0.3) }, now);
      } else if (rune.kind === 'ice') {
        if (target.kind === 'boss') {
          s.bossFrozenUntilMs = now + FREEZE_DURATION_MS;
          applyArenaStatus(s.enemyStatuses, { key: 'freeze', turns: 3, magnitude: 1 }, now);
        } else {
          const m = s.minions.find((x) => x.id === target.id);
          if (m) m.frozenUntilMs = now + FREEZE_DURATION_MS;
        }
      } else if (rune.kind === 'poison') {
        const poisonMag = Math.round(rune.power * 0.25);
        if (target.kind === 'boss') {
          applyArenaStatus(s.enemyStatuses, { key: 'poison', turns: 3, magnitude: poisonMag }, now);
        } else {
          const m = s.minions.find((x) => x.id === target.id);
          if (m) { m.poisonDmg = poisonMag; m.poisonNextTickMs = now + POISON_TICK_MS; m.poisonExpiresMs = now + POISON_DURATION_MS; }
        }
      }
    }
  };

  for (const rune of s.runes) {
    if (triggered.has(rune.id)) continue;
    if (cellEquals(rune.pos, s.player.pos)) { fireRune(rune, 'player'); continue; }
    if (cellEquals(rune.pos, s.bossPos)) { fireRune(rune, { kind: 'boss' }); continue; }
    for (const m of s.minions) {
      if (!triggered.has(rune.id) && cellEquals(rune.pos, m.pos)) {
        fireRune(rune, { kind: 'minion', id: m.id });
        break;
      }
    }
  }
  s.runes = s.runes.filter((r) => !triggered.has(r.id) && r.expiresAtMs > now);
}

/** Apply ring-of-fire damage to enemies adjacent to the player (if the ring is active). */
function tickRingOfFire(s: ArenaState, now: number, rng: RNG): void {
  if (!s.ringOfFire || now >= s.ringOfFire.expiresAtMs) { s.ringOfFire = null; return; }
  const { dmg } = s.ringOfFire;
  // Boss
  if (distance(s.bossPos, s.player.pos) <= 1) {
    const nextHit = s.ringNextHitMs[0] ?? 0;
    if (now >= nextHit) {
      hurtEnemy(s, { kind: 'boss' }, dmg, now, rng);
      s.ringNextHitMs[0] = now + RING_HIT_CD_MS;
    }
  }
  // Minions
  for (const m of s.minions) {
    if (distance(m.pos, s.player.pos) <= 1) {
      const nextHit = s.ringNextHitMs[m.id] ?? 0;
      if (now >= nextHit) {
        hurtEnemy(s, { kind: 'minion', id: m.id }, dmg, now, rng);
        s.ringNextHitMs[m.id] = now + RING_HIT_CD_MS;
      }
    }
  }
}

function stepMinions(s: ArenaState, now: number, field: Map<string, number>, rng: RNG): void {
  for (const m of s.minions) {
    // Poison DoT
    if (m.poisonDmg > 0 && now < m.poisonExpiresMs && now >= m.poisonNextTickMs) {
      m.hp -= m.poisonDmg;
      m.poisonNextTickMs += POISON_TICK_MS;
      if (m.hp <= 0) { s.minions = s.minions.filter((x) => x.id !== m.id); continue; }
    }
    if (now < m.frozenUntilMs) continue; // frozen — skip move and attack
    if (now >= m.nextMoveMs) {
      if (distance(m.pos, s.player.pos) > 1) {
        const others = s.minions.filter((o) => o.id !== m.id).map((o) => o.pos);
        const blocked = blockedKeys(s, [s.bossPos, s.player.pos, ...others]);
        const next = flowStep(m.pos, field, s.radius, blocked);
        if (next) m.pos = next;
      }
      m.nextMoveMs = now + scaled(s, MINION_MOVE_CD_MS);
    }
    if (distance(m.pos, s.player.pos) <= 1 && now >= m.nextHitMs) {
      strikePlayer(s, variance(m.attack, rng), 'physical', now, rng);
      m.nextHitMs = now + scaled(s, MINION_HIT_CD_MS);
      if (s.status !== 'active') return;
    }
  }
}

function tickStatuses(s: ArenaState, now: number, rng: RNG): void {
  const bossBurn = activeStatus(s.enemyStatuses, 'burn', now);
  if (bossBurn && bossBurn.nextTickAtMs != null && now >= bossBurn.nextTickAtMs) {
    s.bossHp -= Math.round(bossBurn.magnitude);
    bossBurn.nextTickAtMs += TURN_MS;
    if (s.bossHp <= 0) resolveBossDown(s, now, rng);
  }
  const bossPoison = activeStatus(s.enemyStatuses, 'poison', now);
  if (bossPoison && bossPoison.nextTickAtMs != null && now >= bossPoison.nextTickAtMs) {
    s.bossHp -= Math.round(bossPoison.magnitude);
    bossPoison.nextTickAtMs += POISON_TICK_MS;
    if (s.bossHp <= 0) resolveBossDown(s, now, rng);
  }
  if (s.status === 'active' && !s.invincible) {
    const playerBurn = activeStatus(s.playerStatuses, 'burn', now);
    if (playerBurn && playerBurn.nextTickAtMs != null && now >= playerBurn.nextTickAtMs) {
      s.hp -= Math.round(playerBurn.magnitude);
      playerBurn.nextTickAtMs += TURN_MS;
      if (s.hp <= 0) { s.hp = 0; s.status = 'ended'; }
    }
    const playerPoison = activeStatus(s.playerStatuses, 'poison', now);
    if (playerPoison && playerPoison.nextTickAtMs != null && now >= playerPoison.nextTickAtMs) {
      s.hp -= Math.round(playerPoison.magnitude);
      playerPoison.nextTickAtMs += POISON_TICK_MS;
      if (s.hp <= 0) { s.hp = 0; s.status = 'ended'; }
    }
  }
  s.enemyStatuses = s.enemyStatuses.filter((x) => x.expiresAtMs > now);
  s.playerStatuses = s.playerStatuses.filter((x) => x.expiresAtMs > now);
}

function telegraphTiles(kind: TelegraphKind, s: ArenaState, rng: RNG): Cell[] {
  const target = s.player.pos;
  switch (kind) {
    case 'slam':
      return range(target, 1).filter((h) => inBoard(h, s.radius));
    case 'nova':
      return range(s.bossPos, 2).filter((h) => inBoard(h, s.radius) && !cellEquals(h, s.bossPos));
    case 'line': {
      const dir = stepToward(s.bossPos, target);
      const tiles: Cell[] = [];
      for (const h of line(s.bossPos, dir, s.radius * 2)) {
        if (!inBoard(h, s.radius) || isBlocked(s, h)) break;
        tiles.push(h);
      }
      return tiles;
    }
    case 'volley': {
      const pool = range(target, 2).filter((h) => inBoard(h, s.radius));
      const tiles: Cell[] = [target];
      for (let i = 0; i < 3 && pool.length > 0; i++) {
        const idx = Math.floor(rng() * pool.length);
        tiles.push(pool.splice(idx, 1)[0]);
      }
      return tiles;
    }
  }
}

function chooseKind(dist: number, rng: RNG): TelegraphKind {
  const roll = rng();
  if (dist <= 1) return roll < 0.7 ? 'nova' : 'slam';
  if (dist <= 3) return roll < 0.5 ? 'slam' : 'line';
  return roll < 0.5 ? 'line' : 'volley';
}

function bossThink(s: ArenaState, now: number, field: Map<string, number>, rng: RNG): void {
  if (s.bossFrozenUntilMs > now) return; // frozen — can't act or move
  if (s.telegraphs.length > 0) return;
  if (now < s.bossNextActionMs) {
    if (now >= s.bossNextMoveMs && distance(s.bossPos, s.player.pos) > 1) {
      const blocked = blockedKeys(s, [s.player.pos, ...s.minions.map((m) => m.pos)]);
      const next = flowStep(s.bossPos, field, s.radius, blocked);
      if (next) s.bossPos = next;
      s.bossNextMoveMs = now + scaled(s, BOSS_MOVE_CD_MS);
    }
    return;
  }
  const blind = activeStatus(s.enemyStatuses, 'blind', now);
  if (blind && rng() < 0.4) {
    s.bossNextActionMs = now + scaled(s, BOSS_RECOVER_MS);
    return;
  }
  const kind = chooseKind(distance(s.bossPos, s.player.pos), rng);
  const spec = PATTERNS[kind];
  const windup = scaled(s, spec.windupMs);
  s.telegraphs.push({
    id: s.seq++,
    kind,
    tiles: telegraphTiles(kind, s, rng),
    startedAtMs: now,
    firesAtMs: now + windup,
    raw: variance(s.bossAttack * spec.dmgMult, rng),
    school: s.attackSchool,
  });
  s.bossNextActionMs = now + windup + scaled(s, BOSS_RECOVER_MS);
  s.bossNextMoveMs = now + windup;
}

export function arenaTick(state: ArenaState, now: number, rng: RNG = Math.random): ArenaState {
  if (state.status !== 'active') return state;
  const s = clone(state);
  const dt = Math.max(0, Math.min(250, now - s.lastTickMs));
  s.lastTickMs = now;

  s.sta = Math.min(s.maxSta, s.sta + (dt / 1000) * STA_REGEN_PER_SEC);
  s.mp = Math.min(s.maxMp, s.mp + (dt / 1000) * MP_REGEN_PER_SEC);

  stepProjectiles(s, now, rng);
  if (s.status === 'won') return s;
  resolveTelegraphs(s, now, rng);
  // Build BFS field once; shared by boss + all minions.
  const field = floodField(s.player.pos, s.radius, s.obstacles);
  if (s.status === 'active') stepMinions(s, now, field, rng);
  if (s.status === 'active') triggerRunes(s, now, rng);
  if (s.status === 'active') tickRingOfFire(s, now, rng);
  if (s.status === 'active') tickStatuses(s, now, rng);
  if (s.status !== 'active') return s;

  if (s.radius >= 5 && now >= s.nextSummonMs) {
    spawnMinion(s, now, rng);
    s.nextSummonMs = now + scaled(s, SUMMON_CD_MS);
  }

  bossThink(s, now, field, rng);

  if (s.invincible) {
    s.hp = s.maxHp;
    s.mp = s.maxMp;
    s.sta = s.maxSta;
  }
  return s;
}

export function arenaReward(s: ArenaState): Reward {
  if (s.status === 'won') return { gold: s.rewardGold, items: [...s.rewardItems] };
  const keep = s.status === 'ended' ? ARENA_DEATH_KEEP : 1;
  const gold = Math.floor(s.rewardGold * damageProgress(s) * keep);
  return gold > 0 ? { gold } : {};
}
