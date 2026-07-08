// Hex Tactics — board & match generation: layered elevation tiles, spawn placement, enemy roster,
// optional secondary objectives, and the assembled initial HexBattleState.
import type { Fighter, RNG } from '../combat';
import {
  type Hex,
  hexBoard,
  hexDistance,
  hexEquals,
  hexKey,
  hexNeighbors,
} from '../hex';
import { getSpell } from '../spells';
import { ENEMIES } from '../enemies';
import {
  type EnemyUnit,
  type HexBattleState,
  type PlayerUnit,
  type TacticsObjective,
  type TerrainKind,
  type Tile,
  MAX_ELEVATION,
  OCCLUSION_RISE,
  TACTICS_BOARD_RADIUS,
  TACTICS_GRANTED_SPELLS,
  WAVE_CAP,
  clamp,
  moveTilesFor,
} from './state';
import { computeEnemyThreat } from './geometry';
import { archetypeFor, climbForEnemy, planEnemyIntents } from './ai';

// --- Generation ---------------------------------------------------------------------------------
export interface HeroOpts {
  fighter: Fighter;
  ag: number;
  knownSpells: string[];
  id: string;
  name?: string;
}

export interface GenerateOpts {
  radius?: number;
  enemyCount?: number;
  rng?: RNG;
  /** Co-op hero roster. When provided, overrides the `fighter` / `ag` / `knownSpells` arguments
   *  and generates spawn tiles for all heroes. Enemy count is scaled by hero count. */
  heroes?: HeroOpts[];
}

/** Glyph shown on each terrain kind (consumed by the overlay). */
export const TERRAIN_ICONS: Record<TerrainKind, string> = {
  floor: '',
  cover: '🛡️',
  slow: '🌿',
  hazard: '🔥',
  blocked: '🪨',
};

/**
 * Candidate hero spawn positions along the near (bottom) edge, ordered by preference.
 * Generated for a given radius so each stays on the axial board
 * (`max(|q|, |r|, |-q-r|) <= radius`).
 */
function heroSpawnCandidates(radius: number): Hex[] {
  const candidates: Hex[] = [
    { q: 0,  r: radius },      // center-bottom (always valid)
    { q: -1, r: radius },      // left of center (valid when radius >= 1)
    { q: 0,  r: radius - 1 }, // one row up from center
    { q: -1, r: radius - 1 }, // up-left
    { q: -2, r: radius },      // further left (valid when radius >= 2)
    { q: 1,  r: radius - 1 }, // up-right (max(1, r-1, r-2) — valid for radius >= 2)
  ];
  return candidates.filter(
    (h) => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(-h.q - h.r)) <= radius,
  );
}

/** Enemy-count bonus contributed by board size. Lives in one place so generateSkirmish (enemy
 *  spawns) and tacticsReward (gold scaling) never drift. r3→0, r4→1, r6→4. */
export function tacticsSizeBonus(radius: number): number {
  return radius - 3 + Math.floor((radius - 3) / 2);
}

/** Build a single self-contained skirmish: a layered board + the hero(es) vs scaled foes. */
export function generateSkirmish(
  fighter: Fighter,
  ag: number,
  tier: number,
  knownSpells: string[],
  opts: GenerateOpts = {},
): HexBattleState {
  const rng = opts.rng ?? Math.random;

  // Build the hero roster: use opts.heroes if provided (co-op), otherwise a single hero.
  const heroes: HeroOpts[] = opts.heroes ?? [{ fighter, ag, knownSpells, id: 'p0' }];
  const heroCount = heroes.length;

  // Expand board radius for co-op so it isn't cramped.
  const baseRadius = opts.radius ?? TACTICS_BOARD_RADIUS;
  const radius = heroCount > 1 ? Math.max(baseRadius, baseRadius + (heroCount - 1)) : baseRadius;
  const board = hexBoard(radius);

  // Assign hero spawn positions near the bottom edge (each must be distinct and on-board).
  const spawnCandidates = heroSpawnCandidates(radius);
  const heroSpawns: Hex[] = heroes.map((_, i) => spawnCandidates[Math.min(i, spawnCandidates.length - 1)]);

  // Enemy count scales with tier, board size, AND number of heroes.
  const sizeBonus = tacticsSizeBonus(radius); // r3→0, r4→1, r6→4
  const heroScale = heroCount > 1 ? heroCount : 1;
  const enemyCount = clamp(
    opts.enemyCount ?? Math.round((2 + Math.floor(tier / 5) + sizeBonus) * heroScale),
    2,
    8 * heroScale,
  );
  const enemyPool = Object.keys(ENEMIES);

  // Waves (audit D6): field at most WAVE_CAP up front; the rest of the roster arrives as
  // reinforcements every WAVE_EVERY_TURNS (see endPlayerTurn). Damage-per-turn against the
  // one-action hero grows ~quadratically with simultaneous foes, so high tiers/big boards
  // sustain pressure over time instead of bursting.
  const fieldedCount = Math.min(enemyCount, WAVE_CAP);

  // Use the first hero's spawn as the BFS origin for connectivity/tile generation.
  const primarySpawn = heroSpawns[0];

  // Retry generation until the board is connected and we can place every fielded unit.
  let tiles: Record<string, Tile> = {};
  let enemySpawns: Hex[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    tiles = genTiles(board, primarySpawn, rng, attempt >= 6 /* drop walls on late attempts */);
    enemySpawns = pickEnemySpawns(tiles, board, primarySpawn, radius, fieldedCount);
    if (enemySpawns.length === fieldedCount && spawnsConnected(tiles, primarySpawn, enemySpawns)) break;
  }
  // Force all spawn tiles to be plain, standable floor.
  for (const h of [...heroSpawns, ...enemySpawns]) {
    tiles[hexKey(h)] = { hex: h, elevation: 0, terrain: 'floor' };
  }
  // Lower any tile that would tower over the tiles behind it (keeps the iso view readable).
  clampOcclusion(tiles, board);

  const scale = 1 + (tier - 1) * 0.07;
  let seq = 1;
  const buildEnemy = (hex: Hex): EnemyUnit => {
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
      prevHex: { ...hex },
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
      turnsOutOfReach: 0,
    } satisfies EnemyUnit;
  };
  const enemies: EnemyUnit[] = enemySpawns.map(buildEnemy);
  // Roster overflow waits off-board; endPlayerTurn places each wave at spawn time, so the
  // origin hex here is a placeholder.
  const reinforcements: EnemyUnit[] = Array.from(
    { length: enemyCount - fieldedCount },
    () => buildEnemy({ q: 0, r: 0 }),
  );

  // Build player unit(s) — one per hero in the roster.
  const buildHeroUnit = (h: HeroOpts, spawnHex: Hex): PlayerUnit => {
    const { c, weapon: w } = h.fighter;
    const heroSpells = [...new Set([...TACTICS_GRANTED_SPELLS, ...h.knownSpells])].filter((k) => {
      const m = getSpell(k)?.mechanic;
      return !m || m === 'blink' || m === 'push' || m === 'cleave';
    });
    return {
      id: h.id,
      name: h.name,
      hex: { ...spawnHex },
      hp: c.maxHp,
      maxHp: c.maxHp,
      mp: c.maxMp,
      maxMp: c.maxMp,
      sta: c.maxSta,
      maxSta: c.maxSta,
      movesLeft: moveTilesFor(h.ag),
      hasActed: false,
      overwatch: false,
      ag: h.ag,
      meleePower: c.meleePower,
      rangedPower: c.rangedPower,
      damageSpell: c.damageSpell,
      supportSpell: c.supportSpell,
      illusionPower: c.illusionPower,
      defense: c.defense,
      ward: c.ward,
      dodge: c.dodge,
      statuses: [],
      knownSpells: heroSpells,
      weapon: w,
    };
  };

  const players: PlayerUnit[] = heroes.map((h, i) => buildHeroUnit(h, heroSpawns[i]));
  // s.player always points to the active (first) hero so existing single-player code paths
  // continue to work. clone() will maintain this alias by reference.
  const activeHeroId = players[0].id;
  const player = players[0];

  // --- Optional secondary objective (~65% of matches) -------------------------------------------
  // Swift budgets count the WHOLE force (fielded + waves) so reinforcements don't turn the
  // objective into an automatic miss.
  const objective: TacticsObjective | null = rng() < 0.65
    ? rollObjective(tiles, board, primarySpawn, enemySpawns, enemyCount, radius, rng)
    : null;
  const objectiveMsg = objective ? ` Bonus objective: ${objective.label}.` : '';
  const heroCountMsg = heroCount > 1 ? `${heroCount} heroes face ` : '';
  const waveMsg = reinforcements.length > 0 ? ` More approach from the edges (${reinforcements.length} in reserve).` : '';

  // State-level knownSpells/weapon stay for backward compatibility (solo, persisted saves).
  // They are set from the first/active hero so the overlay still works before
  // the per-hero fields are read.
  const firstHeroSpells = players[0].knownSpells ?? [];
  const firstHeroWeapon = players[0].weapon ?? heroes[0].fighter.weapon;

  const s: HexBattleState = {
    radius,
    tiles,
    player,
    players: heroCount > 1 ? players : undefined,
    activeHeroId: heroCount > 1 ? activeHeroId : undefined,
    enemies,
    reinforcements: reinforcements.length > 0 ? reinforcements : undefined,
    enemyForceMaxHp: [...enemies, ...reinforcements].reduce((sum, e) => sum + e.maxHp, 0),
    turn: 'player',
    selected: null,
    reachable: [],
    targetable: [],
    effects: [],
    log: [`A skirmish begins — ${heroCountMsg}${enemies.length} foe${enemies.length === 1 ? '' : 's'}.${waveMsg}${objectiveMsg}`],
    status: 'active',
    tier,
    // Arena-only mechanics (runes, ring-of-fire, old teleport) aren't modelled on the tactics grid.
    // The new positional mechanics (blink, push, cleave) ARE always available — they form the
    // core of the positioning system regardless of what spellbooks the player has found.
    knownSpells: firstHeroSpells,
    weapon: firstHeroWeapon,
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
