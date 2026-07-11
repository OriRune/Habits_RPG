// The Deep Mine — a large, scrolling, real-time dungeon minigame.  Pure rules; randomness
// is injected so the engine is fully unit-testable.
//
// The mine is a large procedurally generated cavern (≈33×33 on floor 1, scaling up with
// depth) with impenetrable bedrock walls, sparse clusters of diggable rock, and ore veins
// spread across the open floor.  The player views it through an 11×11 scrolling window
// (see src/components/mining/MineRunOverlay.tsx for the camera).
//
// Combat uses the same damage math as the Arena (src/engine/combat.ts: attackRoll,
// spellDamageRoll, spellHealAmount) with BFS-pathfinding monsters, equipped-weapon attacks,
// and the player's known spell repertoire.  The pickaxe lives in the 'tool' gear slot —
// it's used automatically against rock; the equipped weapon fires against monsters.
//
// Every rule here is a pure function returning a new MineState — the store owns the state
// and a thin loop (src/hooks/useMiningLoop.ts) just decides *when* to call these.
// No React, no store imports → fully unit-testable.

import type { Reward } from './challenges';
import type { StatId } from './stats';
import { mergeReward } from './dungeon';
import { attackRoll } from './combat';
import type { WeaponDef } from './weapons';
import { MINE_ORES, MINE_MONSTERS, MINE_GUARDIAN_FLOORS, MINE_AFFIXES, type MineOreDef, type MineMonsterDef, type MineAffix } from '@/content/mining';
import { BOONS } from '@/content/boons';
import { bandForFloor, MINE_BANDS } from './crawlBiomes';

/** First floor of the deepest (open-ended) band — anchor for late-depth damage scaling. */
const MAGMA_BAND_START = MINE_BANDS[MINE_BANDS.length - 1].depthMin;
import {
  type Dir,
  type RNG,
  type CrawlRune,
  type CrawlStatusEffect,
  type CrawlRingOfFire,
  DIRS,
  randInt,
  floodFieldMulti,
  flowStep,
  adjacent,
  manhattan,
  CRAWL_SPAWN_SAFE_RADIUS,
  pruneStatuses,
  activeStatus,
  applyStatus,
  DOT_TICK_MS,
  RING_HIT_CD_MS,
  STA_REGEN_MS,
  MP_REGEN_MS,
  applyPassiveRegen,
  setTile,
  DASH_BASE_CD_MS,
  STAGGER_MS,
  CHARGE_DAMAGE_MULT,
  dashCooldown,
  moveInterval,
  boonConsolation,
  boonMeleeMult,
  boonDefenseBonus,
  boonYieldMult,
  boonMoveMult,
  boonDashCdMult,
  boonSightBonus,
  rollBoonChoices,
  lateDepthDamageScale,
  pickCandidates,
  placeFeatures,
  crawlCastSpell,
  crawlTriggerRunes,
  crawlCoopClientStep,
  crawlDamageUnitById,
  crawlApplyBoonChoice,
  crawlPickupBoonCache,
  type CrawlSpellCaps,
  type CrawlRuneCaps,
  type CrawlContactCaps,
  type CrawlUnitCaps,
  type CrawlBoonCacheCaps,
} from './crawl';

export type { Dir, RNG } from './crawl';

// ---------------------------------------------------------------------------
// Map constants
// ---------------------------------------------------------------------------

export const MINE_BASE_ROWS = 33;
export const MINE_BASE_COLS = 33;
export const MINE_MAX_ROWS = 57;
export const MINE_MAX_COLS = 57;
/** Base sight radius in tiles — the Lantern boon adds to this via boonSightBonus. */
export const MINE_SIGHT_RADIUS = 4;
/** The map grows by this many cells per floor band. */
const MINE_SCALE_PER_BAND = 4;
/** Floors per growth band. */
const MINE_SCALE_BAND = 4;

/** Run entry gate. */
export const MINE_ENERGY_COST = 2;
/** Fraction of the haul a fallen miner keeps on death; mirrors FOREST_DEATH_KEEP. */
export const MINE_DEATH_KEEP = 0.5;
/** Fraction of the haul kept when end-banking OFF a safe tile (the "hurry tax"); mirrors
 *  FOREST_STASH_KEEP. Full 1.0 banking is only paid on the entrance (see isMineSafeBankTile). */
export const MINE_STASH_KEEP = 0.8;
/** Fraction of the death-forfeited half that a tombstone recovery actually returns. Kept
 *  below 1.0 so a death's total recoverable value (MINE_DEATH_KEEP + this slice of the rest,
 *  and only with the extra effort of a return trip) stays worse than the free, immediate
 *  MINE_STASH_KEEP hurry-bank — otherwise dying is never a worse outcome than banking (0.2). */
export const MINE_TOMBSTONE_RECOVER_KEEP = 0.65;

/** Stamina spent per pick swing (rock / ore). */
const STRIKE_STA_COST = 1;
/** Stamina spent per weapon attack against a monster. Falls back to this if weapon has no sta cost. */
const MELEE_STA_FALLBACK = 2;
/** Invulnerability window after taking a contact hit (ms). */
export const MINE_IFRAME_MS = 800;
/** Vigor crystals scattered roughly every N open floor cells. */
const VIGOR_CRYSTAL_INTERVAL = 80;
/** Spell effect cooldown between separate casts (ms). */
const SPELL_CD_MS = 500;

// ---------------------------------------------------------------------------
// Tile types
// ---------------------------------------------------------------------------

export type MineTileKind =
  | 'floor' | 'rock' | 'ore' | 'bedrock' | 'shaft' | 'entrance' | 'boon' | 'tombstone'
  | 'ice_slide' | 'lava_dot' | 'vault' | 'rich_vein';

/**
 * Lightweight per-kind registry (2.2) — `isWalkable` and the overlay's tile styling both
 * read from this instead of a hardcoded `tile.kind === 'x' || tile.kind === 'y' || ...`
 * chain, so a new tile kind (hazard tiles, a mother-lode vault — Phase 3) is one data
 * entry here instead of an edit to every chain that branches on MineTileKind.
 */
export const MINE_TILE_KINDS: Record<MineTileKind, { walkable: boolean }> = {
  floor:     { walkable: true },
  entrance:  { walkable: true },
  shaft:     { walkable: true },
  boon:      { walkable: true },
  tombstone: { walkable: true },
  ice_slide: { walkable: true },
  lava_dot:  { walkable: true },
  rock:      { walkable: false },
  ore:       { walkable: false },
  vault:     { walkable: false },
  rich_vein: { walkable: false },
  bedrock:   { walkable: false },
};

/** Per-band environmental hazard tile (3.3) — `null` for bands with no hazard yet. */
const BAND_HAZARD_TILE: Record<string, MineTileKind | null> = {
  rocky: null,
  frozen: 'ice_slide',
  magma: 'lava_dot',
};

/** Ward-mitigated damage dealt per lava_dot tick (3.3). */
const LAVA_TICK_DMG = 2;
/** Minimum time between lava_dot ticks while standing on the tile (ms). */
const LAVA_TICK_MS = 1200;

// ---------------------------------------------------------------------------
// Floor layout archetypes (3.2) — vary the drunk-walk carve parameters + cluster
// density per floor so descending doesn't always produce the same-shaped cave.
// ---------------------------------------------------------------------------

export type MineArchetype = 'warren' | 'cavern' | 'sprawl';

export const MINE_ARCHETYPE_NAMES: Record<MineArchetype, string> = {
  warren: 'Corridor Warren',
  cavern: 'Great Cavern',
  sprawl: 'Sprawl',
};

interface MineArchetypeDef {
  /** Fraction of interior cells targeted as open floor. */
  openPct: number;
  /** Drunk-walker count carving the cave. */
  walkers: number;
  /** Multiplier on the baseline rock-cluster count. */
  rockDensityMult: number;
  /** Multiplier on the baseline ore-cluster count. */
  oreDensityMult: number;
}

const MINE_ARCHETYPES: Record<MineArchetype, MineArchetypeDef> = {
  // Tight, choked with rock — fewer walkers carve a lower-open% maze of corridors.
  warren: { openPct: 0.36, walkers: 6, rockDensityMult: 1.3, oreDensityMult: 0.85 },
  // Wide open, sparser rock, richer veins — more walkers carve a higher-open% cavern.
  cavern: { openPct: 0.52, walkers: 16, rockDensityMult: 0.7, oreDensityMult: 1.2 },
  // Today's baseline numbers, kept as the third roll so the mix isn't purely bimodal.
  sprawl: { openPct: 0.45, walkers: 10, rockDensityMult: 1.0, oreDensityMult: 1.0 },
};

function rollArchetype(rng: RNG): MineArchetype {
  const keys = Object.keys(MINE_ARCHETYPES) as MineArchetype[];
  return keys[Math.floor(rng() * keys.length)];
}

/** The entrance is the only safe harbour where a full-value (1.0) end-bank is paid (BAL-12).
 *  Banking anywhere else keeps only MINE_STASH_KEEP, pricing the risk of a long haul out. */
export function isMineSafeBankTile(kind: MineTileKind | undefined): boolean {
  return kind === 'entrance';
}

/**
 * The deepest floor a SOLO run may start on: the deepest guardian boundary the player has
 * already descended PAST (strictly below `deepest`), else floor 1. Reuses the persisted
 * deepestMineFloor as the "guardian beaten" proxy — no new field, no persist bump (BAL-25).
 */
export function unlockedStartFloor(deepest: number): number {
  let start = 1;
  for (const g of Object.keys(MINE_GUARDIAN_FLOORS).map(Number)) {
    if (g < deepest) start = Math.max(start, g);
  }
  return start;
}

export interface MineTile {
  kind: MineTileKind;
  /** Pick swings left before it breaks (rock/ore only). */
  durability?: number;
  /** Original durability at spawn — used to render the HP bar. */
  maxDurability?: number;
  /** Which ore vein this tile holds (ore only — keys MINE_ORES). */
  oreKey?: string;
}

// ---------------------------------------------------------------------------
// Monster type
// ---------------------------------------------------------------------------

export interface MineMonster {
  id: string;
  key: string;
  r: number;
  c: number;
  hp: number;
  maxHp: number;
  readyAtMs: number;
  /** Frozen until this ms timestamp (ice spell / rune). Default 0 = not frozen. */
  frozenUntilMs?: number;
  /** Ongoing poison DoT damage per tick; 0 / absent when none. */
  poisonDmg?: number;
  poisonNextTickMs?: number;
  poisonExpiresMs?: number;
  /** True when this guardian's band boundary was already crossed in a prior run — a
   *  restart-farmed re-kill, not the player's genuine first clear. Reduces its treasure
   *  and skips the boon choice (see killMonster). */
  isRekillGuardian?: boolean;
  /** Elite affix (3.6) — rolled onto at most one non-guardian spawn per floor past
   *  ELITE_MIN_FLOOR. Absent = a normal monster. */
  affix?: MineAffix;
  /** Guardian-only telegraphed special attack (3.7) — absent when not currently winding
   *  up. Target is rolled from the player's position when the windup starts; the
   *  guardian roots in place (skips its normal move step) until it resolves. */
  special?: { targetR: number; targetC: number; readyAtMs: number };
  /** Guardian-only: earliest time the next special can begin winding up (3.7). */
  specialCooldownUntilMs?: number;
}

// ---------------------------------------------------------------------------
// Combat snapshot (snapshotted from the character at the start of a run)
// ---------------------------------------------------------------------------

/** Everything the mine engine needs from the player's character, snapshotted at run start. */
export interface MineSnapshot {
  meleePower: number;
  rangedPower: number;
  damageSpell: number;
  supportSpell: number;
  illusionPower: number;
  defense: number;
  ward: number;
  maxHp: number;
  maxSta: number;
  maxMp: number;
  weapon: WeaponDef;
  knownSpells: string[];
  pickaxePower: number;
  /** Agility level — drives dash cooldown and move speed. */
  agLevel: number;
  /** Active boon keys carried from the previous floor. Optional so callers that
   *  construct a snapshot literal without boons (e.g. beginMining) don't break. */
  activeBoons?: string[];
  /** Homestead Watchtower sight bonus (0 or 1) snapshotted at run start. Optional so
   *  callers without a town perk (or old saves) default to 0. See sightRadiusFor. */
  sightBonus?: number;
  /** Store's cross-run `deepestMineFloor` at run start — used only to tell a genuine
   *  first guardian kill from a restart-farmed re-kill (see MineMonster.isRekillGuardian). */
  deepestMineFloor?: number;
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

export interface MineState {
  floor: number;
  rows: number;
  cols: number;
  tiles: MineTile[][];
  player: { r: number; c: number; facing: Dir };
  // HP / stamina / mana
  hp: number;
  maxHp: number;
  sta: number;
  maxSta: number;
  mp: number;
  maxMp: number;
  // Regen timestamps
  staNextRegenMs: number;
  mpNextRegenMs: number;
  // Combat stats (snapshotted from character)
  meleePower: number;
  rangedPower: number;
  damageSpell: number;
  supportSpell: number;
  illusionPower: number;
  defense: number;
  ward: number;
  weapon: WeaponDef;
  knownSpells: string[];
  pickaxePower: number;
  // Monsters
  monsters: MineMonster[];
  // Loot
  haul: Reward;
  // Status
  status: 'active' | 'ended' | 'banking' | 'choosing';
  lastHitAtMs: number;
  /** Last time a lava_dot tile ticked damage (3.3) — gates the DoT independently of
   *  monster-contact i-frames. Optional so existing hand-built test states default to 0. */
  lastLavaTickMs?: number;
  deepest: number;
  killsThisFloor: number;
  /** Accumulated run score: +10×floor per kill, +100×floor on each descent. */
  score: number;
  // Phase 5: in-run boons
  /** Keys of boons active for this run (empty at floor 1; carried across floors via snapshot). */
  activeBoons: string[];
  /** Keys of the 3 offered boon choices; null when no choice is pending. */
  pendingBoonChoice: string[] | null;
  // Spell effects
  runes: CrawlRune[];
  ringOfFire: CrawlRingOfFire | null;
  ringNextHitMs: Record<string, number>;
  playerStatuses: CrawlStatusEffect[];
  lastSpellMs: number;
  // Running rune ID counter
  nextRuneId: number;
  // Phase 1: dash + AG-derived timing
  /** Timestamp of the last successful dash (ms). Negative = ready immediately. */
  lastDashMs: number;
  /** Dash cooldown computed from AG at run start (ms). */
  dashCooldownMs: number;
  /** Move cadence computed from AG at run start (ms). */
  moveIntervalMs: number;
  /** Agility level snapshot — preserved across floors. */
  agLevel: number;
  /** Position of the descent shaft on the current floor — for the HUD directional indicator. */
  shaftPos?: { r: number; c: number };
  /** This floor's layout archetype (3.2) — re-rolled fresh on every generateMine call
   *  (per-floor, not carried across floors via the snapshot). Optional so hand-built
   *  test states and pre-3.2 persisted runs don't need one; absent reads as 'sprawl'
   *  (today's baseline) wherever it's consumed. */
  archetype?: MineArchetype;
  /** Homestead Watchtower sight bonus (0 or 1), snapshotted at run start and carried
   *  across floors via mineSnapshot. Added by sightRadiusFor. */
  sightBonus?: number;
  /** Store's cross-run `deepestMineFloor` at run start, carried across floors via
   *  mineSnapshot — see MineSnapshot.deepestMineFloor. */
  deepestMineFloor?: number;
  /** Timed rich-vein event (3.5) — position + despawn time of the currently active
   *  vein, or null when none is active this floor. Optional so hand-built test states
   *  default to none. */
  richVein?: { r: number; c: number; expiresAtMs: number } | null;
  /** Whether this floor's once-per-floor rich-vein spawn roll has already happened
   *  (3.5) — prevents re-rolling on every tick. Optional, defaults to "not yet rolled". */
  richVeinRolled?: boolean;
}

/**
 * Re-anchor a persisted run's timestamps for a fresh page session.
 *
 * Every `*Ms` field is stamped from the rAF clock (ms since page load), which
 * restarts near 0 on reload — a rehydrated run would otherwise stall until the
 * new session's clock caught up to the old session's uptime. Cooldowns reset
 * to "ready" (mirroring the fresh-run init values) and transient timed effects
 * (runes, ring of fire, statuses, freezes, DoTs) simply expire: losing a few
 * seconds of buffs on reload beats a stalled run.
 */
export function rebaseMineRun(run: MineState): MineState {
  // A live rich vein's expiresAtMs is stamped on the old session's rAF clock — stale on
  // reload, so it simply expires too (same treatment as runes/ring of fire below).
  const tiles = run.richVein
    ? run.tiles.map((row) =>
        row.map((t) => (t.kind === 'rich_vein' ? { kind: 'floor' as const } : t)),
      )
    : run.tiles;
  return {
    ...run,
    tiles,
    staNextRegenMs: 0,
    mpNextRegenMs: 0,
    lastHitAtMs: -MINE_IFRAME_MS,
    lastLavaTickMs: -LAVA_TICK_MS,
    lastSpellMs: -SPELL_CD_MS,
    lastDashMs: -DASH_BASE_CD_MS,
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    richVein: null,
    monsters: (run.monsters ?? []).map((m) => ({
      ...m,
      readyAtMs: 0,
      frozenUntilMs: undefined,
      poisonDmg: undefined,
      poisonNextTickMs: undefined,
      poisonExpiresMs: undefined,
      special: undefined,
      specialCooldownUntilMs: undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function tileAt(state: MineState, r: number, c: number): MineTile | undefined {
  return state.tiles[r]?.[c];
}

export function isWalkable(tile: MineTile | undefined): boolean {
  return !!tile && MINE_TILE_KINDS[tile.kind].walkable;
}

export function monsterAt(state: MineState, r: number, c: number): MineMonster | undefined {
  return state.monsters.find((m) => m.r === r && m.c === c);
}

export function facedCell(state: MineState): { r: number; c: number } {
  const [dr, dc] = DIRS[state.player.facing];
  return { r: state.player.r + dr, c: state.player.c + dc };
}

export function canDescend(state: MineState): boolean {
  return tileAt(state, state.player.r, state.player.c)?.kind === 'shaft';
}

/**
 * Whether a tap on cell (r, c) should strike rather than walk: a monster to
 * attack or a breakable tile to mine — exactly the kinds `strike` resolves.
 * Bedrock is excluded: facing it is harmless, swinging at it wastes stamina.
 */
export function tapStrikeableAt(state: MineState, r: number, c: number): boolean {
  if (monsterAt(state, r, c)) return true;
  const kind = tileAt(state, r, c)?.kind;
  return kind === 'rock' || kind === 'ore' || kind === 'vault' || kind === 'rich_vein';
}

/** Current sight radius — base plus the Lantern boon and the Watchtower town perk. Mirrors forest.sightRadiusFor. */
export function sightRadiusFor(state: MineState): number {
  return MINE_SIGHT_RADIUS + boonSightBonus(state.activeBoons) + (state.sightBonus ?? 0);
}

/** Nearest monster to the player (for damage-school spells). */
function nearestMonster(state: MineState): MineMonster | null {
  let best: MineMonster | null = null;
  let bestDist = Infinity;
  for (const m of state.monsters) {
    const d = manhattan(m, state.player);
    if (d < bestDist) { bestDist = d; best = m; }
  }
  return best;
}

/** Kill-drop: loot pool scales with floor depth and biome band. */
function monsterLootPool(floor: number): Array<{ kind: 'gold' } | { kind: 'material'; material: string }> {
  const pool: Array<{ kind: 'gold' } | { kind: 'material'; material: string }> = [{ kind: 'gold' }];
  pool.push({ kind: 'material', material: 'bronze_bar' });
  if (floor >= 3) pool.push({ kind: 'material', material: 'iron_bar' });
  if (floor >= 6) pool.push({ kind: 'material', material: 'crystals' });
  if (floor >= 7) pool.push({ kind: 'material', material: 'frost_quartz' }); // frozen band
  if (floor >= 10) pool.push({ kind: 'material', material: 'gemstone' });
  if (floor >= 15) pool.push({ kind: 'material', material: 'obsidian' }); // magma band
  return pool;
}

/** Flat score bonus awarded for killing a band-gate guardian. */
const GUARDIAN_SCORE_BONUS = 500;

/** Guaranteed treasure loot when a band-gate guardian is slain.
 *  A restart-farmed re-kill (see MineMonster.isRekillGuardian) pays a token gold bounty
 *  only — the full material treasure is reserved for the genuine first clear (0.5). */
function guardianTreasure(floor: number, rng: RNG, isRekill: boolean): Reward {
  if (isRekill) return { gold: randInt(15, 30, rng) };
  if (floor <= 7) {
    // Stone Golem: Rocky → Frozen gate; reward previews Frozen-band materials.
    return { gold: randInt(30, 50, rng), materials: { frost_quartz: 3, iron_bar: 2 } };
  }
  // Magma Colossus: Frozen → Magma gate; reward previews Magma-band materials.
  return { gold: randInt(60, 100, rng), materials: { obsidian: 3, frost_quartz: 2 } };
}

/** Depth term added to base node durability so a maxed pick keeps meeting real
 *  resistance at depth instead of one-shotting every vein forever (0.6). */
function depthDurabilityBonus(floor: number): number {
  return Math.floor(floor / 6);
}

function avgNodeDurability(floor: number): number {
  const ores = eligibleOres(floor).filter((o) => o.weight > 0);
  if (ores.length === 0) return 1;
  const bonus = depthDurabilityBonus(floor);
  const totalWeight = ores.reduce((a, o) => a + o.weight, 0);
  return ores.reduce((a, o) => a + (o.durability + bonus) * o.weight, 0) / totalWeight;
}

/** Loot dropped by breaking one ore tile. */
export function oreYield(oreKey: string, rng: RNG): Reward {
  const def = MINE_ORES[oreKey];
  if (!def) return {};
  if (def.grants.kind === 'stamina') return {};
  if (def.grants.kind === 'gold') {
    return { gold: randInt(def.grants.amount[0], def.grants.amount[1], rng) };
  }
  const amt = randInt(def.grants.amount[0], def.grants.amount[1], rng);
  return { materials: { [def.grants.material]: amt } };
}

function eligibleOres(floor: number): MineOreDef[] {
  const bandId = bandForFloor(floor).id;
  return Object.values(MINE_ORES).filter(
    (o) => o.floorMin <= floor && (o.floorMax == null || floor <= o.floorMax) && (!o.band || o.band === bandId),
  );
}

function weightedOre(floor: number, rng: RNG): MineOreDef {
  const pool = eligibleOres(floor).filter((o) => o.weight > 0);
  const total = pool.reduce((a, o) => a + o.weight, 0);
  let roll = rng() * total;
  for (const o of pool) {
    roll -= o.weight;
    if (roll < 0) return o;
  }
  return pool[pool.length - 1];
}

// ---------------------------------------------------------------------------
// Mother lode vault (3.4) — one high-durability special node per floor past
// MOTHER_LODE_MIN_FLOOR, best cracked with charged swings, worth several
// normal veins at once.
// ---------------------------------------------------------------------------

/** First floor a mother lode vault can spawn on. */
const MOTHER_LODE_MIN_FLOOR = 6;
/** Base pick-durability of a vault node (scales gently with depth like ore/rock). */
const MOTHER_LODE_DURABILITY_BASE = 10;
/** Independent ore rolls merged into a vault's break reward. */
const MOTHER_LODE_ORE_ROLLS = 3;

function motherLodeDurability(floor: number): number {
  return MOTHER_LODE_DURABILITY_BASE + depthDurabilityBonus(floor) * 2;
}

/** Loot dropped by breaking a mother lode vault — several ore rolls plus a flat gold
 *  bonus, notably larger than any single vein on the floor. */
function motherLodeYield(floor: number, rng: RNG): Reward {
  let haul: Reward = { gold: randInt(20, 35, rng) + floor * 2 };
  for (let i = 0; i < MOTHER_LODE_ORE_ROLLS; i++) {
    haul = mergeReward(haul, oreYield(weightedOre(floor, rng).key, rng));
  }
  return haul;
}

// ---------------------------------------------------------------------------
// Timed rich vein (3.5) — a fast, richer-than-normal node that appears at most once
// per floor and despawns if not mined within RICH_VEIN_WINDOW_MS. A real bank-vs-greed
// decision: detour for the extra loot, or keep pushing toward the shaft.
// ---------------------------------------------------------------------------

/** First floor a rich vein can appear on. */
const RICH_VEIN_MIN_FLOOR = 3;
/** Chance a rich vein spawns at all on an eligible floor (rolled once, on floor entry). */
const RICH_VEIN_SPAWN_CHANCE = 0.4;
/** How long a spawned rich vein stays mineable before reverting to floor (ms). */
export const RICH_VEIN_WINDOW_MS = 60_000;
/** Pick durability — low on purpose; the decision is "detour for it", not "grind it out". */
const RICH_VEIN_DURABILITY = 2;
/** Independent ore rolls merged into a rich vein's break reward. */
const RICH_VEIN_ORE_ROLLS = 2;

/** Loot dropped by breaking a rich vein — richer than a normal single ore tile. */
function richVeinYield(floor: number, rng: RNG): Reward {
  let haul: Reward = {};
  for (let i = 0; i < RICH_VEIN_ORE_ROLLS; i++) {
    haul = mergeReward(haul, oreYield(weightedOre(floor, rng).key, rng));
  }
  return haul;
}

/** First floor past which a non-guardian spawn can roll an elite affix (3.6). */
const ELITE_MIN_FLOOR = 10;

// ---------------------------------------------------------------------------
// Guardian telegraphed specials (3.7) — one scripted windup-then-slam per guardian.
// The guardian roots in place while winding up; a ground-target zone (drawn by the
// overlay) marks where the slam lands. Stand outside it when the timer expires.
// ---------------------------------------------------------------------------

/** Guardian must have a player within this distance to start winding up. */
const GUARDIAN_SPECIAL_RANGE = 6;
/** Telegraph duration before the slam resolves (ms) — time to read and dodge it. */
const GUARDIAN_SPECIAL_WINDUP_MS = 1800;
/** Cooldown after a slam resolves (hit or miss) before the guardian can wind up again. */
const GUARDIAN_SPECIAL_COOLDOWN_MS = 6000;
/** Manhattan radius of the landing zone around the targeted cell. */
export const GUARDIAN_SPECIAL_BLAST_RADIUS = 1;
/** Raw damage multiplier on the guardian's normal touchDamage. */
const GUARDIAN_SPECIAL_DMG_MULT = 1.8;

/** Per-guardian themed effect applied on a landed slam — reuses the shared
 *  CrawlStatusEffect plumbing rather than a bespoke mechanism. `weaken.magnitude` is a
 *  flat defense reduction (mirrors bless's flat defense bonus); `burn.magnitude` is a
 *  DoT damage-per-tick, ward-mitigated like any other burn/poison. */
const GUARDIAN_SPECIAL_STATUS: Record<string, { key: 'burn' | 'weaken'; magnitude: number; durationMs: number }> = {
  stone_golem: { key: 'weaken', magnitude: 4, durationMs: 3000 },
  magma_colossus: { key: 'burn', magnitude: 3, durationMs: 4500 },
};

/** Weighted monster pick (mirrors weightedOre) — band-native monsters default to a
 *  higher `weight` (3.1) so descending into a new band changes the monster mix, not
 *  just the palette. `pool` must be non-empty. */
function weightedMonster(pool: MineMonsterDef[], rng: RNG): MineMonsterDef {
  const total = pool.reduce((a, m) => a + (m.weight ?? 1), 0);
  let roll = rng() * total;
  for (const m of pool) {
    roll -= m.weight ?? 1;
    if (roll < 0) return m;
  }
  return pool[pool.length - 1];
}

// ---------------------------------------------------------------------------
// Generation — large cave with multi-walker drunk-walk
// ---------------------------------------------------------------------------

/**
 * Connectivity safety net: rock/ore cluster placement (step 5/6) can occasionally wall
 * off a pocket of floor (including, sometimes, the shaft or a boon cache) from the
 * entrance, even though every feature was placed on cells that were floor-reachable
 * *before* those clusters were carved. Denser archetypes (`warren`'s higher rock
 * density, low openPct) raise the odds of this for a given seed. Repair rather than
 * reroll: repeatedly BFS from the entrance through walkable-only tiles; for any
 * still-walkable tile left outside that reachable set, BFS again allowing rock/ore and
 * carve the shortest path back to floor. No-op (single BFS, no carving) on the common
 * fully-connected case.
 */
function ensureConnectivity(
  tiles: MineTile[][],
  start: { r: number; c: number },
): void {
  const rows = tiles.length;
  const cols = tiles[0]?.length ?? 0;
  const DIRS: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const isSolid = (kind: MineTileKind) => kind === 'rock' || kind === 'ore';
  const passable = (r: number, c: number, allowSolid: boolean): boolean => {
    const t = tiles[r]?.[c];
    if (!t) return false;
    if (t.kind === 'bedrock') return false;
    if (!allowSolid && isSolid(t.kind)) return false;
    return true;
  };
  const bfsFrom = (starts: Array<{ r: number; c: number }>, allowSolid: boolean) => {
    const prev = new Map<string, { r: number; c: number } | null>();
    const q: Array<{ r: number; c: number }> = [];
    for (const s of starts) {
      const key = `${s.r},${s.c}`;
      if (!prev.has(key)) {
        prev.set(key, null);
        q.push(s);
      }
    }
    while (q.length > 0) {
      const cur = q.shift()!;
      for (const [dr, dc] of DIRS) {
        const nr = cur.r + dr;
        const nc = cur.c + dc;
        const key = `${nr},${nc}`;
        if (prev.has(key) || !passable(nr, nc, allowSolid)) continue;
        prev.set(key, cur);
        q.push({ r: nr, c: nc });
      }
    }
    return prev;
  };
  // Bounded: each iteration repairs at least one isolated pocket, and the map is small.
  for (let iter = 0; iter < 25; iter++) {
    const reachable = bfsFrom([start], false);
    let target: { r: number; c: number } | null = null;
    for (let r = 0; r < rows && !target; r++) {
      for (let c = 0; c < cols; c++) {
        const t = tiles[r][c];
        if (t.kind !== 'bedrock' && !isSolid(t.kind) && !reachable.has(`${r},${c}`)) {
          target = { r, c };
          break;
        }
      }
    }
    if (!target) return;
    const prev = bfsFrom(Array.from(reachable.keys(), (k) => {
      const [r, c] = k.split(',').map(Number);
      return { r, c };
    }), true);
    const targetKey = `${target.r},${target.c}`;
    if (!prev.has(targetKey)) return; // unreachable even through solid — bail safely
    let cur = prev.get(targetKey) ?? null;
    while (cur) {
      const t = tiles[cur.r][cur.c];
      if (isSolid(t.kind)) tiles[cur.r][cur.c] = { kind: 'floor' };
      cur = prev.get(`${cur.r},${cur.c}`) ?? null;
    }
  }
}

/**
 * Build a fresh cavern for `floor`.  Large, organic shape: start all bedrock, carve open
 * areas with overlapping drunk-walks from the entrance, then scatter sparse rock clusters,
 * ore clusters, vigor crystals, and monsters on the open floor.
 */
export function generateMine(floor: number, snapshot: MineSnapshot, rng: RNG): MineState {
  // Carry boons forward from the snapshot (absent on the very first call from beginMining).
  const activeBoons: string[] = snapshot.activeBoons ?? [];

  const band = Math.floor((floor - 1) / MINE_SCALE_BAND);
  const rows = Math.min(MINE_MAX_ROWS, MINE_BASE_ROWS + band * MINE_SCALE_PER_BAND);
  const cols = Math.min(MINE_MAX_COLS, MINE_BASE_COLS + band * MINE_SCALE_PER_BAND);

  // --- Step 1: start with all bedrock ---
  const floor_: MineTile[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ kind: 'bedrock' as MineTileKind })),
  );

  // Layout archetype (3.2) — drives the carve openness/walker count below plus the
  // rock/ore cluster density multipliers used in steps 5/6.
  const archetype = rollArchetype(rng);
  const archetypeDef = MINE_ARCHETYPES[archetype];

  // --- Step 2: carve open caves with multiple drunk-walkers ---
  // Entrance near the top-centre.
  const startR = 2;
  const startC = Math.floor(cols / 2);

  const carve = (r: number, c: number): void => {
    if (r < 1 || r >= rows - 1 || c < 1 || c >= cols - 1) return;
    if (floor_[r][c].kind === 'floor') return; // already open
    floor_[r][c] = { kind: 'floor' };
    // Widen the corridor slightly by also opening one adjacent random cell
    const side: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const [dr, dc] = side[Math.floor(rng() * 4)];
    const wr = r + dr, wc = c + dc;
    if (wr >= 1 && wr < rows - 1 && wc >= 1 && wc < cols - 1) {
      floor_[wr][wc] = { kind: 'floor' };
    }
  };

  // How many walkers and steps to fill roughly openPct of interior cells (3.2: varies by archetype)
  const interior = (rows - 2) * (cols - 2);
  const targetFloor = Math.round(interior * archetypeDef.openPct);
  const numWalkers = archetypeDef.walkers;
  const stepsPerWalker = Math.ceil((targetFloor * 1.3) / numWalkers);

  // Seed the entrance
  carve(startR, startC);
  carve(startR + 1, startC);

  for (let w = 0; w < numWalkers; w++) {
    // Each new walker starts from an already-open cell to guarantee connectivity
    const openCells: Array<[number, number]> = [];
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (floor_[r][c].kind === 'floor') openCells.push([r, c]);
      }
    }
    let [r, c] = openCells.length > 0
      ? openCells[Math.floor(rng() * openCells.length)]
      : [startR, startC];
    for (let step = 0; step < stepsPerWalker; step++) {
      const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      const [dr, dc] = dirs[Math.floor(rng() * 4)];
      const nr = r + dr, nc = c + dc;
      if (nr >= 1 && nr < rows - 1 && nc >= 1 && nc < cols - 1) {
        r = nr; c = nc;
        carve(r, c);
      }
    }
  }

  // Ensure entrance and a breathing room below it are open
  floor_[startR][startC] = { kind: 'entrance' };
  floor_[startR + 1][startC] = { kind: 'floor' };

  // --- Step 3: BFS to find all reachable open cells from the entrance ---
  const reachable: Set<string> = new Set();
  const bfsQ: Array<[number, number]> = [[startR, startC]];
  reachable.add(`${startR},${startC}`);
  while (bfsQ.length > 0) {
    const [r, c] = bfsQ.shift()!;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
      const nr = r + dr, nc = c + dc;
      const k = `${nr},${nc}`;
      if (reachable.has(k)) continue;
      const t = floor_[nr]?.[nc];
      if (!t || t.kind === 'bedrock') continue;
      reachable.add(k);
      bfsQ.push([nr, nc]);
    }
  }

  // Collect reachable interior floor cells (excludes entrance itself)
  const openFloor: Array<[number, number]> = [];
  for (const k of reachable) {
    const [r, c] = k.split(',').map(Number);
    if (floor_[r][c].kind === 'floor') openFloor.push([r, c]);
  }

  // Shuffle so picks are uniform random
  for (let i = openFloor.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [openFloor[i], openFloor[j]] = [openFloor[j], openFloor[i]];
  }

  const takeFloor = (): [number, number] | undefined => openFloor.pop();

  // --- Step 4: shaft down — at the farthest reachable cell from the entrance ---
  // BFS-distance: we want cells deep in the cave (roughly max-distance from start)
  const bfsDist = new Map<string, number>();
  const bfsQ2: Array<[number, number, number]> = [[startR, startC, 0]];
  bfsDist.set(`${startR},${startC}`, 0);
  let farthestCell: [number, number] = [startR, startC];
  let farthestDist = 0;
  while (bfsQ2.length > 0) {
    const [r, c, d] = bfsQ2.shift()!;
    if (d > farthestDist) { farthestDist = d; farthestCell = [r, c]; }
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
      const nr = r + dr, nc = c + dc;
      const k = `${nr},${nc}`;
      if (bfsDist.has(k)) continue;
      const t = floor_[nr]?.[nc];
      if (!t || (t.kind !== 'floor' && t.kind !== 'entrance')) continue;
      bfsDist.set(k, d + 1);
      bfsQ2.push([nr, nc, d + 1]);
    }
  }
  const [shaftR, shaftC] = farthestCell;
  floor_[shaftR][shaftC] = { kind: 'shaft' };
  // Remove from openFloor pool
  const shaftIdx = openFloor.findIndex(([r, c]) => r === shaftR && c === shaftC);
  if (shaftIdx >= 0) openFloor.splice(shaftIdx, 1);

  // --- Step 5: scatter diggable rock clusters near bedrock/walls ---
  const rockDur = (floor <= 2 ? 1 : floor <= 6 ? 2 : 3) + depthDurabilityBonus(floor);
  const rockClusterCount = Math.round((5 + Math.floor(floor / 2)) * archetypeDef.rockDensityMult);
  placeFeatures(openFloor, rockClusterCount, ([cr, cc]) => {
    floor_[cr][cc] = { kind: 'rock', durability: rockDur, maxDurability: rockDur };
    // Add 2-3 adjacent rock cells for a cluster feel
    const clusterSize = 2 + Math.floor(rng() * 2);
    for (let s = 0; s < clusterSize; s++) {
      const adj: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      const [dr, dc] = adj[Math.floor(rng() * 4)];
      const nr = cr + dr, nc = cc + dc;
      if (floor_[nr]?.[nc]?.kind === 'floor') {
        floor_[nr][nc] = { kind: 'rock', durability: rockDur, maxDurability: rockDur };
        const idx = openFloor.findIndex(([r, c]) => r === nr && c === nc);
        if (idx >= 0) openFloor.splice(idx, 1);
      }
    }
  });

  // --- Step 6: ore clusters ---
  const oreClusterCount = Math.min(openFloor.length, Math.round((4 + Math.floor(floor / 2)) * archetypeDef.oreDensityMult));
  const oreDurBonus = depthDurabilityBonus(floor);
  placeFeatures(openFloor, oreClusterCount, ([cr, cc]) => {
    const oreDef = weightedOre(floor, rng);
    const dur = oreDef.durability + oreDurBonus;
    floor_[cr][cc] = { kind: 'ore', oreKey: oreDef.key, durability: dur, maxDurability: dur };
    // Cluster: 1-4 adjacent ore tiles
    const veinSize = 1 + Math.floor(rng() * 3);
    for (let s = 0; s < veinSize; s++) {
      const cell2 = takeFloor();
      if (!cell2) break;
      const [r2, c2] = cell2;
      const oreDef2 = weightedOre(floor, rng);
      const dur2 = oreDef2.durability + oreDurBonus;
      floor_[r2][c2] = { kind: 'ore', oreKey: oreDef2.key, durability: dur2, maxDurability: dur2 };
    }
  });

  // --- Step 6b: band hazard tiles (3.3) — ice_slide (frozen) / lava_dot (magma) ---
  const hazardKind = BAND_HAZARD_TILE[bandForFloor(floor).id];
  if (hazardKind) {
    const hazardCount = Math.min(openFloor.length, Math.round(5 + floor * 0.25));
    placeFeatures(openFloor, hazardCount, ([hr, hc]) => {
      floor_[hr][hc] = { kind: hazardKind };
    });
  }

  // --- Step 6c: mother lode vault (3.4) — one per floor past MOTHER_LODE_MIN_FLOOR ---
  if (floor >= MOTHER_LODE_MIN_FLOOR && openFloor.length > 0) {
    const vaultDur = motherLodeDurability(floor);
    placeFeatures(openFloor, 1, ([vr, vc]) => {
      floor_[vr][vc] = { kind: 'vault', durability: vaultDur, maxDurability: vaultDur };
    }, rng);
  }

  // --- Step 7: vigor crystals (scattered more densely than before) ---
  // Count remaining open floor cells after placements above
  const remainingFloor: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (floor_[r][c].kind === 'floor') remainingFloor.push([r, c]);
    }
  }
  const gemCount = Math.max(1, Math.floor(remainingFloor.length / VIGOR_CRYSTAL_INTERVAL));
  for (let i = remainingFloor.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [remainingFloor[i], remainingFloor[j]] = [remainingFloor[j], remainingFloor[i]];
  }
  for (let gi = 0; gi < gemCount; gi++) {
    const cell = remainingFloor[gi];
    if (!cell) break;
    const [gr, gc] = cell;
    // Only place on still-floor cells (might have been overwritten by ore/rock above)
    if (floor_[gr][gc].kind === 'floor') {
      floor_[gr][gc] = { kind: 'ore', oreKey: 'vigor_crystal', durability: 1, maxDurability: 1 };
    }
  }

  // --- Step 7b: cave mushroom (~1 per 3 floors — rare stamina pickup) ---
  // Reuses the shuffled remainingFloor array, picking a cell after the gem slots so it
  // never overlaps a vigor crystal. weight:0 in MINE_ORES keeps it out of the random pool.
  if (rng() < 0.33) {
    for (let mi = gemCount; mi < remainingFloor.length; mi++) {
      const cell = remainingFloor[mi];
      if (!cell) break;
      const [mr, mc] = cell;
      if (floor_[mr][mc].kind === 'floor') {
        floor_[mr][mc] = { kind: 'ore', oreKey: 'cave_mushroom', durability: 1, maxDurability: 1 };
        break;
      }
    }
  }

  // --- Step 8: monsters ---
  // Spawn safety: candidate cells exclude everything within CRAWL_SPAWN_SAFE_RADIUS of
  // the player's spawn (the entrance), so a fresh floor never opens with a monster
  // already adjacent to a player who hasn't had time to react.
  const mFloor: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = floor_[r][c];
      if ((t.kind === 'floor') && manhattan({ r, c }, { r: startR, c: startC }) > CRAWL_SPAWN_SAFE_RADIUS) {
        mFloor.push([r, c]);
      }
    }
  }
  for (let i = mFloor.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [mFloor[i], mFloor[j]] = [mFloor[j], mFloor[i]];
  }
  const currentBandId = bandForFloor(floor).id;
  const eligibleMon = Object.values(MINE_MONSTERS).filter(
    (m) => !m.isGuardian && m.floorMin <= floor && (!m.band || m.band === currentBandId),
  );
  // Space-bounded uncap: count keeps climbing with floor (deep floors no longer
  // plateau at a flat 10) but never exceeds the placeable spawn cells.
  const monCount = eligibleMon.length === 0 ? 0 : Math.min(mFloor.length, 2 + Math.floor(floor * 0.6));
  // Late-depth HP scaling (1.1) — mirrors the contact-damage scale already applied in
  // stepMonsters, so a maxed-out weapon doesn't keep one-shotting trash forever past
  // the magma band. Guardians are unaffected (placed once, at exactly their own floor).
  const monHpScale = lateDepthDamageScale(floor - MAGMA_BAND_START);
  const monsters: MineMonster[] = [];
  for (let i = 0; i < monCount && i < mFloor.length; i++) {
    const [mr, mc] = mFloor[i];
    const def = weightedMonster(eligibleMon, rng);
    const hp = Math.round(def.hp * monHpScale);
    monsters.push({
      id: `m${floor}-${i}`,
      key: def.key,
      r: mr, c: mc,
      hp, maxHp: hp,
      readyAtMs: 0,
      frozenUntilMs: 0,
      poisonDmg: 0, poisonNextTickMs: 0, poisonExpiresMs: 0,
    });
  }

  // --- Step 8b: elite affix (3.6) — at most one non-guardian spawn per floor past
  // ELITE_MIN_FLOOR gets a random affix and a matching HP bump. ---
  if (floor > ELITE_MIN_FLOOR && monsters.length > 0) {
    const affixKeys = Object.keys(MINE_AFFIXES) as MineAffix[];
    const affix = affixKeys[Math.floor(rng() * affixKeys.length)];
    const idx = Math.floor(rng() * monsters.length);
    const target = monsters[idx];
    const hp = Math.round(target.hp * MINE_AFFIXES[affix].hpMult);
    monsters[idx] = { ...target, affix, hp, maxHp: hp };
  }

  // --- Step 9: band-gate guardian (deterministic, once per boundary floor) ---
  const guardianKey = MINE_GUARDIAN_FLOORS[floor];
  if (guardianKey) {
    const gDef = MINE_MONSTERS[guardianKey];
    if (gDef) {
      // Find a floor cell distant from both the entrance and the shaft.
      const shaftCell = (() => {
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++)
            if (floor_[r][c].kind === 'shaft') return { r, c };
        return { r: rows - 3, c: Math.floor(cols / 2) };
      })();
      const guardianCells = pickCandidates(
        mFloor,
        ([r, c]) =>
          manhattan({ r, c }, { r: startR, c: startC }) > 8 &&
          manhattan({ r, c }, shaftCell) > 4,
      );
      // A restart-farmed re-kill: the player already crossed this guardian's floor
      // boundary in a prior run (see MineSnapshot.deepestMineFloor / 0.5).
      const isRekill = (snapshot.deepestMineFloor ?? 0) > floor;
      placeFeatures(guardianCells, 1, ([gr, gc]) => {
        monsters.push({
          id: `guardian-${floor}`,
          key: guardianKey,
          r: gr, c: gc,
          hp: gDef.hp, maxHp: gDef.hp,
          readyAtMs: 0,
          frozenUntilMs: 0,
          poisonDmg: 0, poisonNextTickMs: 0, poisonExpiresMs: 0,
          isRekillGuardian: isRekill || undefined,
        });
      }, rng);
    }
  }

  // --- Step 10: boon cache (~1-in-3 chance on non-guardian floors) ---
  // Placed on a floor cell far from the entrance and BFS-reachable.
  if (!guardianKey && rng() < 0.34) {
    const allInterior: [number, number][] = [];
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) allInterior.push([r, c]);
    }
    const boonCands = pickCandidates(
      allInterior,
      ([r, c]) =>
        floor_[r][c].kind === 'floor' &&
        manhattan({ r, c }, { r: startR, c: startC }) > 5 &&
        reachable.has(`${r},${c}`),
    );
    placeFeatures(boonCands, 1, ([br, bc]) => {
      floor_[br][bc] = { kind: 'boon' };
    }, rng);
  }

  // Repair any pocket (shaft, boon cache, plain floor) that rock/ore placement
  // accidentally sealed off from the entrance. Runs last so it sees every feature.
  ensureConnectivity(floor_, { r: startR, c: startC });

  return {
    floor,
    rows, cols,
    tiles: floor_,
    player: { r: startR, c: startC, facing: 'down' },
    hp: snapshot.maxHp, maxHp: snapshot.maxHp,
    sta: snapshot.maxSta, maxSta: snapshot.maxSta,
    mp: snapshot.maxMp, maxMp: snapshot.maxMp,
    staNextRegenMs: STA_REGEN_MS,
    mpNextRegenMs: MP_REGEN_MS,
    meleePower: snapshot.meleePower,
    rangedPower: snapshot.rangedPower,
    damageSpell: snapshot.damageSpell,
    supportSpell: snapshot.supportSpell,
    illusionPower: snapshot.illusionPower,
    defense: snapshot.defense,
    ward: snapshot.ward,
    weapon: snapshot.weapon,
    knownSpells: snapshot.knownSpells,
    pickaxePower: snapshot.pickaxePower,
    monsters,
    haul: {},
    status: 'active',
    lastHitAtMs: -MINE_IFRAME_MS,
    lastLavaTickMs: -LAVA_TICK_MS,
    deepest: floor,
    killsThisFloor: 0,
    score: 0,
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    lastSpellMs: -SPELL_CD_MS,
    nextRuneId: 1,
    // Phase 1: dash + speed derived from AG; Phase 5: boon multipliers applied immediately
    lastDashMs: -DASH_BASE_CD_MS,
    dashCooldownMs: Math.round(dashCooldown(snapshot.agLevel) * boonDashCdMult(activeBoons)),
    moveIntervalMs: Math.round(moveInterval(snapshot.agLevel) / boonMoveMult(activeBoons)),
    agLevel: snapshot.agLevel,
    // Phase 5: boons
    activeBoons,
    pendingBoonChoice: null,
    shaftPos: { r: shaftR, c: shaftC },
    sightBonus: snapshot.sightBonus,
    deepestMineFloor: snapshot.deepestMineFloor,
    archetype,
    richVein: null,
    richVeinRolled: false,
  };
}

/** The player power-stat snapshot a fresh floor is generated from. */
export function mineSnapshot(state: MineState): MineSnapshot {
  return {
    meleePower: state.meleePower,
    rangedPower: state.rangedPower,
    damageSpell: state.damageSpell,
    supportSpell: state.supportSpell,
    illusionPower: state.illusionPower,
    defense: state.defense,
    ward: state.ward,
    maxHp: state.maxHp,
    maxSta: state.maxSta,
    maxMp: state.maxMp,
    weapon: state.weapon,
    knownSpells: state.knownSpells,
    pickaxePower: state.pickaxePower,
    agLevel: state.agLevel,
    activeBoons: state.activeBoons,
    sightBonus: state.sightBonus,
    deepestMineFloor: state.deepestMineFloor,
  };
}

/** Descend the shaft into a richer, deeper floor — carries HP/sta/mp/haul/score forward. */
export function descend(state: MineState, rng: RNG): MineState {
  if (!canDescend(state) || state.status !== 'active') return state;
  const nextFloor = state.floor + 1;
  const next = generateMine(nextFloor, mineSnapshot(state), rng);
  return {
    ...next,
    hp: state.hp,
    sta: Math.min(state.maxSta, state.sta + Math.round(state.maxSta * 0.25)), // partial refill
    mp: Math.min(state.maxMp, state.mp + Math.round(state.maxMp * 0.25)),
    haul: state.haul,
    deepest: Math.max(state.deepest, nextFloor),
    score: state.score + 100 * nextFloor,
  };
}

/**
 * Place a tombstone tile on a random reachable floor cell away from the entrance.
 * Called by the store when a run begins/descends on a floor that has a saved tombstone.
 * The tile is walkable (player can step on it) and is recovered via mineStrike.
 */
export function placeTombstone(state: MineState, rng: RNG): MineState {
  const { rows, cols } = state;
  // Find the entrance tile to measure distance from the start position.
  let entR = 2, entC = Math.floor(cols / 2);
  outer: for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (state.tiles[r]?.[c]?.kind === 'entrance') { entR = r; entC = c; break outer; }
    }
  }
  // Collect floor cells that are far enough from the entrance to feel "hidden".
  const cands: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = state.tiles[r]?.[c];
      if (tile?.kind === 'floor' && manhattan({ r, c }, { r: entR, c: entC }) > 5) {
        cands.push([r, c]);
      }
    }
  }
  if (cands.length === 0) return state;
  const [tr, tc] = cands[Math.floor(rng() * cands.length)];
  const tiles = setTile(state.tiles, tr, tc, { kind: 'tombstone' });
  return { ...state, tiles };
}

/**
 * MINI-31: find the tombstone tile on the current floor, if any. The tombstone is
 * only encoded as a tile kind (there is no `tombstonePos` on state), so the overlay
 * compass has to scan for it. Returns null when this floor holds no tombstone.
 */
export function findTombstone(state: MineState): { r: number; c: number } | null {
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.tiles[r]?.[c]?.kind === 'tombstone') return { r, c };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Player movement + dash (Phase 1)
// ---------------------------------------------------------------------------

/** Frozen-band hazard (3.3): landing on ice_slide keeps the player sliding up to 2 more
 *  cells in the same direction, stopping at the first non-ice, unwalkable, or occupied
 *  cell. Shared by tryMove and tryDash so a dash onto ice slides just as far. */
function slideOnIce(state: MineState, r: number, c: number, dir: Dir): { r: number; c: number } {
  const [dr, dc] = DIRS[dir];
  let cr = r;
  let cc = c;
  for (let i = 0; i < 2; i++) {
    if (tileAt(state, cr, cc)?.kind !== 'ice_slide') break;
    const nr = cr + dr;
    const nc = cc + dc;
    if (!isWalkable(tileAt(state, nr, nc)) || monsterAt(state, nr, nc)) break;
    cr = nr;
    cc = nc;
  }
  return { r: cr, c: cc };
}

/** Turn to face `dir`; step into the cell if walkable and unoccupied. */
export function tryMove(state: MineState, dir: Dir): MineState {
  if (state.status !== 'active') return state;
  const [dr, dc] = DIRS[dir];
  const r = state.player.r + dr;
  const c = state.player.c + dc;
  const blocked = !isWalkable(tileAt(state, r, c)) || !!monsterAt(state, r, c);
  if (blocked) return { ...state, player: { ...state.player, facing: dir } };
  const dest = slideOnIce(state, r, c, dir);
  return { ...state, player: { r: dest.r, c: dest.c, facing: dir } };
}

/**
 * Dash in `dir` — skips 1 or 2 cells (2 if clear, else 1), consuming the dash
 * cooldown and briefly granting i-frame immunity by setting `lastHitAtMs`.
 * No-ops when on cooldown or when there's nowhere to land.
 */
export function tryDash(state: MineState, dir: Dir, nowMs: number): MineState {
  if (state.status !== 'active') return state;
  const cd = state.dashCooldownMs ?? DASH_BASE_CD_MS;
  if (nowMs - (state.lastDashMs ?? -cd) < cd) return state;

  const [dr, dc] = DIRS[dir];
  let destR = state.player.r;
  let destC = state.player.c;

  // Prefer 2-cell dash; fall back to 1 if blocked.
  for (let steps = 2; steps >= 1; steps--) {
    const r = state.player.r + dr * steps;
    const c = state.player.c + dc * steps;
    if (isWalkable(tileAt(state, r, c)) && !monsterAt(state, r, c)) {
      destR = r;
      destC = c;
      break;
    }
  }

  if (destR === state.player.r && destC === state.player.c) return state;

  const dest = slideOnIce(state, destR, destC, dir);
  return {
    ...state,
    player: { r: dest.r, c: dest.c, facing: dir },
    lastDashMs: nowMs,
    lastHitAtMs: nowMs, // i-frame: no contact damage for MINE_IFRAME_MS after the dash
  };
}

// ---------------------------------------------------------------------------
// Player attack (auto-context: weapon vs monster, pickaxe vs rock)
// ---------------------------------------------------------------------------

function killMonster(state: MineState, mon: MineMonster, rng: RNG): MineState {
  const def = MINE_MONSTERS[mon.key];
  const isGuardian = !!def?.isGuardian;
  const isRekill = isGuardian && !!mon.isRekillGuardian;
  let drop: Reward;
  if (isGuardian) {
    drop = guardianTreasure(state.floor, rng, isRekill);
  } else {
    // Guaranteed bounty gold on every kill (mirrors forest killBeast).
    const bounty = def ? randInt(def.bounty[0], def.bounty[1], rng) : 0;
    // Capped so a long full-clear floor doesn't snowball kill-loot past what mining pays (0.3).
    const killBonus = Math.min(5, state.killsThisFloor + 1);
    // Loot quantity scales with the swings the kill *would* take with the wielded
    // weapon's attack stat (DX weapons fire on rangedPower, else meleePower).
    const atkPower = state.weapon.attackStat === 'DX' ? state.rangedPower : state.meleePower;
    const swingsToKill = Math.ceil(mon.maxHp / Math.max(1, atkPower));
    const qty = Math.max(1, Math.round(swingsToKill / avgNodeDurability(state.floor)) + killBonus);
    const pool = monsterLootPool(state.floor);
    const pick = pool[Math.floor(rng() * pool.length)];
    // Pool pick (gold-or-material) is a bonus roll on top of the guaranteed bounty.
    const bonus: Reward = pick.kind === 'gold' ? { gold: qty } : { materials: { [pick.material]: qty } };
    drop = mergeReward(bonus, bounty > 0 ? { gold: bounty } : {});
  }
  const afterKill: MineState = {
    ...state,
    monsters: state.monsters.filter((m) => m.id !== mon.id),
    haul: mergeReward(state.haul, drop),
    killsThisFloor: state.killsThisFloor + 1,
    score: state.score + 10 * state.floor + (isGuardian && !isRekill ? GUARDIAN_SCORE_BONUS : 0),
  };
  // Guardian kill: offer a boon choice (pauses the run via 'choosing' status).
  // An exhausted pool rolls [] — grant a consolation instead; entering
  // 'choosing' with zero options would soft-lock the run. Re-kills skip the boon
  // choice entirely (0.5) — free permanent boons on every guardian-restart farm
  // would undermine the point of the reduced re-kill treasure above.
  if (isGuardian && !isRekill) {
    const choices = rollBoonChoices('mine', afterKill.activeBoons, rng);
    if (choices.length === 0) return boonConsolation(afterKill);
    return { ...afterKill, pendingBoonChoice: choices, status: 'choosing' };
  }
  return afterKill;
}

/**
 * Co-op client helper: the id of the monster in the cell the player faces, or
 * null. A guest uses this to send a melee attack-intent to the host (which
 * resolves the damage authoritatively) instead of damaging its local copy.
 */
export function facedMonsterId(state: MineState): string | null {
  const { r, c } = facedCell(state);
  return monsterAt(state, r, c)?.id ?? null;
}

/**
 * Swing at the faced cell.  Auto-context: monster → weapon attack; rock/ore → pickaxe mining.
 *
 * @param nowMs  Current timestamp (ms); required for charged-swing stagger timing.
 * @param charged  If true, applies {@link CHARGE_DAMAGE_MULT} and staggers hit monsters briefly.
 */
export function strike(state: MineState, rng: RNG, nowMs = 0, charged = false): MineState {
  if (state.status !== 'active') return state;
  const { r, c } = facedCell(state);

  // --- Monster in the way: weapon attack ---
  const mon = monsterAt(state, r, c);
  if (mon) {
    const def = MINE_MONSTERS[mon.key];
    const staCost = state.weapon.staminaCost ?? MELEE_STA_FALLBACK;
    if (state.sta < 1) return state; // need at least 1 sta
    const full = state.sta >= staCost;
    const basePower = state.weapon.attackStat === 'DX' ? state.rangedPower : state.meleePower;
    // Charged swing and Iron Arm boon multiply attack power.
    const boonMult = boonMeleeMult(state.activeBoons);
    const power = charged ? basePower * CHARGE_DAMAGE_MULT * boonMult : basePower * boonMult;
    const { dealt } = attackRoll(
      power,
      state.weapon.bonus,
      state.weapon.attackStat,
      (def?.weakTo ?? []) as StatId[],
      (def?.resistTo ?? []) as StatId[],
      full,
      (def?.defense ?? 0) + (mon.affix ? MINE_AFFIXES[mon.affix].defenseBonus ?? 0 : 0),
      rng,
    );
    const newSta = Math.max(0, state.sta - staCost);
    const newHp = mon.hp - dealt;
    if (newHp <= 0) {
      return killMonster({ ...state, sta: newSta }, mon, rng);
    }
    // Charged hit staggers the monster (brief freeze).
    const updatedMonsters = state.monsters.map((m) => {
      if (m.id !== mon.id) return m;
      if (charged && nowMs > 0) return { ...m, hp: newHp, frozenUntilMs: nowMs + STAGGER_MS };
      return { ...m, hp: newHp };
    });
    return { ...state, sta: newSta, monsters: updatedMonsters };
  }

  // --- Rock, ore, a mother lode vault, or a timed rich vein: pickaxe mining ---
  const tile = tileAt(state, r, c);
  if (!tile || (tile.kind !== 'rock' && tile.kind !== 'ore' && tile.kind !== 'vault' && tile.kind !== 'rich_vein')) return state;
  if (state.sta <= 0) return state;

  // ST-scaled mining: +1 effective pick power per 8 Strength levels.
  const stBonus = Math.floor(state.meleePower / 8);
  const basePick = state.pickaxePower > 0 ? state.pickaxePower : 1;
  // Charged swing also boosts mining speed — rounds up so even tier-1 rock is cleared in 1 swing.
  const effectivePick = charged
    ? Math.ceil((basePick + stBonus) * CHARGE_DAMAGE_MULT)
    : basePick + stBonus;
  const dur = (tile.durability ?? 1) - effectivePick;
  let haul = state.haul;
  const oreBroke = dur <= 0 && tile.kind === 'ore';

  if (dur <= 0) {
    if (tile.kind === 'ore' && tile.oreKey) {
      const yieldResult = oreYield(tile.oreKey, rng);
      // Vein Sense boon: double ore quantity.
      const yMult = boonYieldMult(state.activeBoons);
      if (yMult !== 1) {
        const scaled: typeof yieldResult = {};
        if (yieldResult.gold) scaled.gold = Math.round(yieldResult.gold * yMult);
        if (yieldResult.materials) {
          scaled.materials = Object.fromEntries(
            Object.entries(yieldResult.materials).map(([k, v]) => [k, Math.round((v ?? 0) * yMult)]),
          );
        }
        haul = mergeReward(haul, scaled);
      } else {
        haul = mergeReward(haul, yieldResult);
      }
    } else if (tile.kind === 'vault') {
      haul = mergeReward(haul, motherLodeYield(state.floor, rng));
    } else if (tile.kind === 'rich_vein') {
      haul = mergeReward(haul, richVeinYield(state.floor, rng));
    }
  }
  const tiles = setTile(state.tiles, r, c, dur <= 0 ? { kind: 'floor' } : { ...tile, durability: dur });

  // Breaking a rock always yields stone (scales with hardness), plus a 20% bonus ore chance.
  if (dur <= 0 && tile.kind === 'rock') {
    const maxDur = tile.maxDurability ?? 1;
    const stoneAmt = randInt(maxDur, Math.min(3, maxDur + 1), rng);
    haul = mergeReward(haul, { materials: { stone: stoneAmt } });
    const bonusPool = eligibleOres(state.floor).filter((o) => o.weight > 0);
    if (bonusPool.length > 0 && rng() < 0.2) {
      const bonusDef = bonusPool[Math.floor(rng() * bonusPool.length)];
      haul = mergeReward(haul, oreYield(bonusDef.key, rng));
    }
  }

  // Stamina restore from special ores (vigor crystal) or a small +1 for any broken ore
  const staDef = oreBroke && tile.oreKey ? MINE_ORES[tile.oreKey] : undefined;
  const staGrant = staDef?.grants.kind === 'stamina' ? staDef.grants : undefined;
  const staRestore = staGrant ? staGrant.amount[0] : oreBroke ? 1 : 0;
  const newSta = Math.min(state.maxSta, state.sta - STRIKE_STA_COST + staRestore);
  // Cave mushroom also restores a chunk of HP alongside stamina (0.7).
  const hpRestore = staGrant?.hpAmount ? staGrant.hpAmount[0] : 0;
  const newHp = hpRestore > 0 ? Math.min(state.maxHp, state.hp + hpRestore) : state.hp;
  // Mining out the active rich vein clears its timer — nothing left to expire.
  const richVein = tile.kind === 'rich_vein' && dur <= 0 ? null : state.richVein;

  return { ...state, sta: newSta, hp: newHp, tiles, haul, richVein };
}

// ---------------------------------------------------------------------------
// Spell casting
// ---------------------------------------------------------------------------

// Callback bag wiring the mine's concrete state/monster/content into the shared
// crawl.ts generics (ARCH-06 twin hoist).
const mineUnitCaps: CrawlUnitCaps<MineState, MineMonster> = {
  unitsOf: (s) => s.monsters,
  withUnits: (s, units) => ({ ...s, monsters: units }),
  killUnit: killMonster,
};
const mineSpellCaps: CrawlSpellCaps<MineState, MineMonster> = {
  ...mineUnitCaps,
  isWalkableAt: (s, r, c) => isWalkable(tileAt(s, r, c)),
  unitAt: monsterAt,
  nearestUnit: nearestMonster,
  unitDef: (m) => MINE_MONSTERS[m.key],
  preferFaced: true,
};
const mineRuneCaps: CrawlRuneCaps<MineState, MineMonster> = {
  ...mineUnitCaps,
  iframeMs: MINE_IFRAME_MS,
};
const mineContactCaps: CrawlContactCaps<MineState, MineMonster> = {
  unitsOf: (s) => s.monsters,
  // MINI-17: a frozen/staggered monster can't bite.
  canStrike: (m, nowMs) => !(m.frozenUntilMs && nowMs < m.frozenUntilMs),
  contactRaw: (m, s) => Math.round((MINE_MONSTERS[m.key]?.touchDamage ?? 1) * lateDepthDamageScale(s.floor - MAGMA_BAND_START)),
  defenseBonus: boonDefenseBonus,
  iframeMs: MINE_IFRAME_MS,
};

export function castSpell(state: MineState, spellKey: string, nowMs: number, rng: RNG): MineState {
  return crawlCastSpell(state, spellKey, nowMs, rng, mineSpellCaps);
}

// ---------------------------------------------------------------------------
// Boon cache pickup (2.4)
// ---------------------------------------------------------------------------

const mineBoonCacheCaps: CrawlBoonCacheCaps<MineState, MineTile> = {
  tilesOf: (s) => s.tiles,
  withTiles: (s, tiles) => ({ ...s, tiles }),
  emptyTile: { kind: 'floor' },
};

/** Open the boon cache at (r, c) — clears the tile, rolls a choice (or consolation). */
export function pickupBoonCache(state: MineState, r: number, c: number, rng: RNG): MineState {
  return crawlPickupBoonCache(state, r, c, 'mine', rng, mineBoonCacheCaps);
}

// ---------------------------------------------------------------------------
// Rune triggers (called after any unit moves)
// ---------------------------------------------------------------------------

function triggerRunes(state: MineState, nowMs: number, rng: RNG): MineState {
  return crawlTriggerRunes(state, nowMs, rng, mineRuneCaps);
}

// ---------------------------------------------------------------------------
// Monster tick: BFS move + DoT + contact damage
// ---------------------------------------------------------------------------

/**
 * Advance the entire monster clock by one tick:
 *   1. DoT ticks (poison / burn — tracked on the monster).
 *   2. BFS move toward the player, routing around walls and each other.
 *   3. Contact damage to the player (with i-frame gating) from adjacent monsters.
 *   4. Ring-of-fire damage to any monster adjacent to the player.
 *   5. Trigger any runes stepped on by a moving monster.
 */
export function stepMonsters(
  state: MineState,
  nowMs: number,
  rng: RNG,
  /**
   * Co-op only: positions of the OTHER players sharing this run. Monsters then
   * chase the nearest of all players. Contact damage / i-frames stay against
   * `state.player` (each client simulates its own body), so passing `[]` (the
   * default) preserves single-player behavior exactly.
   */
  coPlayers: ReadonlyArray<{ r: number; c: number }> = [],
): MineState {
  if (state.status !== 'active') return state;

  let s = applyPassiveRegen(state, nowMs);

  // --- Timed rich vein (3.5): one spawn roll per floor, on the first real-clock tick
  // after entry (generateMine has no nowMs to stamp an absolute expiry with) ---
  if (!s.richVeinRolled) {
    s = { ...s, richVeinRolled: true };
    if (s.floor >= RICH_VEIN_MIN_FLOOR && rng() < RICH_VEIN_SPAWN_CHANCE) {
      const allCells: Array<[number, number]> = [];
      for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) allCells.push([r, c]);
      const candidates = pickCandidates(
        allCells,
        ([r, c]) => s.tiles[r][c].kind === 'floor' && manhattan({ r, c }, s.player) > 4,
      );
      if (candidates.length > 0) {
        const [vr, vc] = candidates[Math.floor(rng() * candidates.length)];
        const tiles = setTile(s.tiles, vr, vc, { kind: 'rich_vein', durability: RICH_VEIN_DURABILITY, maxDurability: RICH_VEIN_DURABILITY });
        s = { ...s, tiles, richVein: { r: vr, c: vc, expiresAtMs: nowMs + RICH_VEIN_WINDOW_MS } };
      }
    }
  }
  if (s.richVein && nowMs >= s.richVein.expiresAtMs) {
    const { r: vr, c: vc } = s.richVein;
    const tiles = s.tiles[vr]?.[vc]?.kind === 'rich_vein' ? setTile(s.tiles, vr, vc, { kind: 'floor' }) : s.tiles;
    s = { ...s, tiles, richVein: null };
  }

  // --- Monster DoT ticks ---
  let monsters = s.monsters.map((m) => {
    const pdmg = m.poisonDmg ?? 0;
    const pnext = m.poisonNextTickMs ?? 0;
    const pexp = m.poisonExpiresMs ?? 0;
    if (pdmg <= 0 || nowMs < pnext || nowMs >= pexp) return m;
    const newHp = m.hp - pdmg;
    if (newHp <= 0) return { ...m, hp: 0 }; // kills resolved below
    return { ...m, hp: newHp, poisonNextTickMs: pnext + DOT_TICK_MS };
  });
  // Remove monsters killed by DoT and add their loot
  let sSoFar: MineState = { ...s, monsters };
  for (const m of monsters) {
    if (m.hp <= 0) sSoFar = killMonster(sSoFar, m, rng);
  }
  if (sSoFar.status !== 'active') return sSoFar;
  s = sSoFar;
  monsters = s.monsters;

  // --- BFS flow field toward the nearest player (all players in co-op) ---
  const players = coPlayers.length > 0 ? [s.player, ...coPlayers] : [s.player];
  const field = floodFieldMulti(
    players,
    s.rows,
    s.cols,
    (r, c) => isWalkable(tileAt(s, r, c) as MineTile | undefined),
  );

  // --- Move each monster ---
  let changed = false;
  const newOccupied = new Set<string>(monsters.map((m) => `${m.r},${m.c}`));

  const movedMonsters = monsters.map((m) => {
    const def = MINE_MONSTERS[m.key];
    if (!def || nowMs < m.readyAtMs) return m;
    if (m.frozenUntilMs && nowMs < m.frozenUntilMs) return m;
    // 3.7: a guardian roots in place while winding up its telegraphed special.
    if (m.special) return m;

    // Don't move if already adjacent to any player (just attack in contact phase)
    if (players.some((p) => adjacent(m, p))) return m;

    // Per-monster blocked set: other monsters + every player's cell
    const blocked = new Set<string>(players.map((p) => `${p.r},${p.c}`));
    for (const other of monsters) {
      if (other.id !== m.id) blocked.add(`${other.r},${other.c}`);
    }
    // ARCH-05: also block cells already claimed by monsters that moved earlier this
    // tick, so two monsters can't path onto the same free cell in one step.
    for (const k of newOccupied) blocked.add(k);

    const next = flowStep({ r: m.r, c: m.c }, field, blocked);
    if (!next) return m;

    newOccupied.delete(`${m.r},${m.c}`);
    newOccupied.add(`${next.r},${next.c}`);
    changed = true;
    const cadenceMult = m.affix ? MINE_AFFIXES[m.affix].moveCadenceMult ?? 1 : 1;
    return { ...m, r: next.r, c: next.c, readyAtMs: nowMs + Math.round(def.moveCadenceMs * cadenceMult) };
  });

  let hp = s.hp;
  let lastHitAtMs = s.lastHitAtMs;
  let playerStatuses = s.playerStatuses;

  // --- 3.7 guardian telegraphed specials: resolve a landed slam, or start winding up
  // a new one. Independent of the normal contact i-frame — it's a distinct, dodgeable
  // threat, not a graze the iframe exists to prevent chain-stacking of. ---
  const guardedMonsters = movedMonsters.map((m) => {
    const def = MINE_MONSTERS[m.key];
    if (!def?.isGuardian) return m;
    if (m.special) {
      if (nowMs < m.special.readyAtMs) return m; // still winding up
      changed = true;
      const inBlast =
        manhattan({ r: s.player.r, c: s.player.c }, { r: m.special.targetR, c: m.special.targetC }) <=
        GUARDIAN_SPECIAL_BLAST_RADIUS;
      if (inBlast) {
        const scale = lateDepthDamageScale(s.floor - MAGMA_BAND_START);
        const raw = Math.round(def.touchDamage * GUARDIAN_SPECIAL_DMG_MULT * scale);
        const dealt = Math.max(1, raw - s.defense - boonDefenseBonus(s.activeBoons));
        hp = Math.max(0, hp - dealt);
        lastHitAtMs = nowMs;
        const statusDef = GUARDIAN_SPECIAL_STATUS[m.key];
        if (statusDef) {
          playerStatuses = applyStatus(
            playerStatuses,
            { key: statusDef.key, magnitude: statusDef.magnitude, durationMs: statusDef.durationMs },
            nowMs,
          );
        }
      }
      return { ...m, special: undefined, specialCooldownUntilMs: nowMs + GUARDIAN_SPECIAL_COOLDOWN_MS };
    }
    if ((m.specialCooldownUntilMs ?? 0) > nowMs) return m;
    if (manhattan({ r: s.player.r, c: s.player.c }, { r: m.r, c: m.c }) > GUARDIAN_SPECIAL_RANGE) return m;
    changed = true;
    return { ...m, special: { targetR: s.player.r, targetC: s.player.c, readyAtMs: nowMs + GUARDIAN_SPECIAL_WINDUP_MS } };
  });

  // --- Contact damage from adjacent monsters (one hit per i-frame window, more at depth) ---
  if (nowMs - s.lastHitAtMs >= MINE_IFRAME_MS) {
    // MINI-17: a frozen/staggered monster can't bite — parity with the forest (forest.ts),
    // which is what gives the charge verb's 500ms stagger its defensive value in the mine.
    const touchers = guardedMonsters.filter((m) => !(m.frozenUntilMs && nowMs < m.frozenUntilMs) && adjacent(m, s.player));
    if (touchers.length > 0) {
      const scale = lateDepthDamageScale(s.floor - MAGMA_BAND_START);
      // A swarm could otherwise be tanked risk-free by only ever taking one hit per
      // i-frame window regardless of density. Deep floors (scale ramps 1→2) let up to
      // 3 adjacent monsters land a hit at once instead of a hard cap of exactly 1 (1.1).
      const maxTouchers = 1 + Math.floor((scale - 1) * 2);
      const bless = activeStatus(s.playerStatuses, 'bless', nowMs);
      // 3.7 stone golem special: a landed slam leaves the player staggered/exposed —
      // weaken subtracts from effective defense the same way bless adds to it.
      const weaken = activeStatus(s.playerStatuses, 'weaken', nowMs);
      const landedTouchers = touchers.slice(0, maxTouchers);
      let dealt = 0;
      for (const toucher of landedTouchers) {
        const def = MINE_MONSTERS[toucher.key];
        const raw = Math.round((def?.touchDamage ?? 1) * scale);
        dealt += Math.max(1, raw - s.defense - (bless ? bless.magnitude : 0) + (weaken ? weaken.magnitude : 0) - boonDefenseBonus(s.activeBoons));
      }
      hp = Math.max(0, hp - dealt);
      lastHitAtMs = nowMs;
      changed = true;
      // 3.6 venomous affix: a landed hit also poisons the player.
      const venomous = landedTouchers.find((m) => m.affix === 'venomous');
      if (venomous) {
        const { magnitude, durationMs } = MINE_AFFIXES.venomous.poisonOnContact!;
        playerStatuses = applyStatus(playerStatuses, { key: 'poison', magnitude, durationMs }, nowMs);
      }
    }
  }

  // --- Player DoT statuses (3.6 venomous poison, 3.7 magma colossus burn) — ward-mitigated
  // like lava DoT below. Both keys share the same nextTickAtMs semantics (see applyStatus).
  for (const dotKey of ['poison', 'burn'] as const) {
    const dot = activeStatus(playerStatuses, dotKey, nowMs);
    if (dot && nowMs >= (dot.nextTickAtMs ?? 0)) {
      hp = Math.max(0, hp - Math.max(1, dot.magnitude - s.ward));
      playerStatuses = playerStatuses.map((x) => (x.key === dotKey ? { ...x, nextTickAtMs: nowMs + DOT_TICK_MS } : x));
      changed = true;
    }
  }

  // --- Lava DoT (3.3, magma band hazard tile) — gated independently of monster i-frames ---
  let lastLavaTickMs = s.lastLavaTickMs ?? -LAVA_TICK_MS;
  if (tileAt(s, s.player.r, s.player.c)?.kind === 'lava_dot' && nowMs - lastLavaTickMs >= LAVA_TICK_MS) {
    hp = Math.max(0, hp - Math.max(1, LAVA_TICK_DMG - s.ward));
    lastLavaTickMs = nowMs;
    changed = true;
  }

  // --- Ring of fire ---
  let ringOfFire = s.ringOfFire;
  let ringNextHitMs = s.ringNextHitMs;
  let ringMonsters = guardedMonsters;
  if (ringOfFire && nowMs < ringOfFire.expiresAtMs) {
    ringMonsters = ringMonsters.map((m) => {
      if (!adjacent(m, s.player)) return m;
      const nextHit = ringNextHitMs[m.id] ?? 0;
      if (nowMs < nextHit) return m;
      const newHp = m.hp - ringOfFire!.dmg;
      ringNextHitMs = { ...ringNextHitMs, [m.id]: nowMs + RING_HIT_CD_MS };
      changed = true;
      if (newHp <= 0) return { ...m, hp: 0 };
      return { ...m, hp: newHp };
    });
    // Kill ring-of-fire dead monsters
    let ringSoFar: MineState = { ...s, monsters: ringMonsters, hp, lastHitAtMs, lastLavaTickMs, ringNextHitMs, playerStatuses };
    for (const m of ringMonsters) {
      if (m.hp <= 0) ringSoFar = killMonster(ringSoFar, m, rng);
    }
    if (ringSoFar.status !== 'active') return ringSoFar;
    s = ringSoFar;
    ringMonsters = s.monsters;
  } else if (ringOfFire && nowMs >= ringOfFire.expiresAtMs) {
    ringOfFire = null;
    changed = true;
  }

  // --- Rune triggers ---
  let result: MineState = {
    ...s,
    monsters: ringMonsters,
    hp,
    lastHitAtMs,
    lastLavaTickMs,
    ringOfFire,
    ringNextHitMs,
    playerStatuses: pruneStatuses(playerStatuses, nowMs),
  };
  result = triggerRunes(result, nowMs, rng);

  if (!changed && result === s) return state; // idle tick: skip re-render
  return { ...result, status: result.hp <= 0 ? 'ended' : result.status };
}

// ---------------------------------------------------------------------------
// Co-op helpers (Phase 3). The host runs stepMonsters (above) authoritatively;
// these support the client side and host-resolved remote attacks.
// ---------------------------------------------------------------------------

/**
 * Client-side per-tick step for a co-op guest. Monsters are positioned by the
 * host (applied separately), so this does NOT move monsters, run runes, or resolve
 * monster kills (all host-authoritative). It only advances the LOCAL player's own
 * body: stamina/mp regen, status expiry, and contact damage from any adjacent
 * monster (each client owns its own HP under trust-the-client). Mirrors the regen
 * + contact-damage blocks of {@link stepMonsters}.
 */
export function coopClientStep(state: MineState, nowMs: number): MineState {
  return crawlCoopClientStep(state, nowMs, mineContactCaps);
}

/**
 * Host-side: apply a remote player's attack to a monster by id, so that a kill
 * resolves exactly once on the authoritative host (loot is granted to the host's
 * `haul`; remote players bank their own ore/kills client-side under trust-client).
 */
export function damageMonsterById(
  state: MineState,
  monsterId: string,
  dmg: number,
  rng: RNG,
): MineState {
  return crawlDamageUnitById(state, monsterId, dmg, rng, mineUnitCaps);
}

// ---------------------------------------------------------------------------
// Phase 5: boon choice resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the player's boon pick: appends the chosen key to `activeBoons`,
 * clears `pendingBoonChoice`, restores `status:'active'`, and immediately
 * recomputes `moveIntervalMs`/`dashCooldownMs` so the speed boon is felt on
 * the current floor (not only after the next descent).
 * No-ops if no choice is pending or the key is not in the offered set.
 */
export function applyBoonChoice(state: MineState, key: string): MineState {
  return crawlApplyBoonChoice(state, key, { getBoon: (k) => BOONS[k], boonMoveMult, boonDashCdMult });
}
