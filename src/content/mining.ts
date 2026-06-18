// ============================================================================
//  MINE CONTENT — edit this file to tune ore veins and cave monsters.
// ============================================================================
//
//  Fuels the "Deep Mine" minigame (src/engine/mining.ts). Each entry is
//  `key: { ...fields }` (key + inner `key:` must match, be unique). Copy a block
//  to add, edit to change, delete to remove. Loot yields feed the shared economy
//  (gold + crafting materials in src/content/materials.ts).
//
//  ORES (MINE_ORES)
//  ----------------
//  glyph/color   Stand-in crest until real art exists.
//  floorMin      Earliest mine floor this vein can appear on.
//  weight        Relative spawn chance among eligible veins (higher = commoner).
//  durability    Pick swings needed to break it.
//  grants        What breaking it drops: gold, or a crafting material (random
//                amount within [min, max]).
//
//  MONSTERS (MINE_MONSTERS)
//  ------------------------
//  hp            Health; you chip it with your pick (meleePower per swing).
//  touchDamage   HP you lose when it reaches you (subject to a brief i-frame).
//  moveCadenceMs How often it steps toward you (lower = faster/nastier).
//  bounty        Gold dropped on death (random within [min, max]).
// ============================================================================

export interface MineOreDef {
  key: string;
  name: string;
  glyph: string;
  color: string;
  floorMin: number;
  weight: number;
  durability: number;
  grants:
    | { kind: 'gold'; amount: [number, number] }
    | { kind: 'material'; material: string; amount: [number, number] }
    | { kind: 'stamina'; amount: [number, number] };
  /**
   * If set, this vein only spawns in the named biome band.
   * Omit for band-agnostic ores (eligible in any band at or above floorMin).
   */
  band?: import('@/engine/crawlBiomes').MineBandId;
}

export interface MineMonsterDef {
  key: string;
  name: string;
  glyph: string;
  color: string;
  floorMin: number;
  hp: number;
  touchDamage: number;
  moveCadenceMs: number;
  bounty: [number, number];
  /** Physical defense (reduces weapon damage). Default 0. */
  defense?: number;
  /** Stats this monster takes bonus damage from (×1.25). */
  weakTo?: string[];
  /** Stats this monster resists (×0.6). */
  resistTo?: string[];
  /**
   * If set, this monster only spawns in the named biome band.
   * Omit for band-agnostic monsters (eligible in any band at or above floorMin).
   */
  band?: import('@/engine/crawlBiomes').MineBandId;
  /**
   * Band-gate guardian. Excluded from the random spawn pool; placed once by
   * generateMine on the exact floor matching guardianFloor.
   */
  isGuardian?: true;
  /** The exact floor this guardian appears on (required when isGuardian is set). */
  guardianFloor?: number;
}

export const MINE_ORES: Record<string, MineOreDef> = {
  rubble: {
    key: 'rubble', name: 'Loose Rubble', glyph: '▪', color: '#8a7a6a',
    floorMin: 1, weight: 3, durability: 1, grants: { kind: 'gold', amount: [1, 4] },
  },
  bronze_vein: {
    key: 'bronze_vein', name: 'Bronze Vein', glyph: '⛏', color: '#a06a3a',
    floorMin: 1, weight: 3, durability: 2, grants: { kind: 'material', material: 'bronze_bar', amount: [1, 2] },
  },
  iron_vein: {
    key: 'iron_vein', name: 'Iron Vein', glyph: '⛏', color: '#7a8590',
    floorMin: 3, weight: 2.5, durability: 3, grants: { kind: 'material', material: 'iron_bar', amount: [1, 2] },
  },
  gold_vein: {
    key: 'gold_vein', name: 'Gold Vein', glyph: '❖', color: '#c9a227',
    floorMin: 4, weight: 1.5, durability: 3, grants: { kind: 'gold', amount: [8, 20] },
  },
  crystal_node: {
    key: 'crystal_node', name: 'Crystal Node', glyph: '◆', color: '#6a4fb0',
    floorMin: 6, weight: 1.2, durability: 4, grants: { kind: 'material', material: 'crystals', amount: [1, 2] },
  },
  gemstone_node: {
    key: 'gemstone_node', name: 'Gemstone Node', glyph: '◆', color: '#b8487f',
    floorMin: 10, weight: 0.8, durability: 5, grants: { kind: 'material', material: 'gemstone', amount: [1, 1] },
  },
  energy_gem: {
    // weight: 0 excludes this from the weighted ore pool. It is placed by a dedicated
    // generation step (generateMine step 7) at fixed density (1 per ENERGY_GEM_INTERVAL
    // open floor cells). Any ore with special placement logic should use weight: 0.
    key: 'energy_gem', name: 'Energy Gem', glyph: '⚡', color: '#22d3ee',
    floorMin: 1, weight: 0, durability: 1, grants: { kind: 'stamina', amount: [11, 11] },
  },
  // --- Frozen Depths band (floors 7–14) ---
  frost_quartz_vein: {
    key: 'frost_quartz_vein', name: 'Frost Quartz Vein', glyph: '❄', color: '#60c8e8',
    floorMin: 7, weight: 2, durability: 3, band: 'frozen',
    grants: { kind: 'material', material: 'frost_quartz', amount: [1, 2] },
  },
  // --- Magma Core band (floors 15+) ---
  obsidian_vein: {
    key: 'obsidian_vein', name: 'Obsidian Vein', glyph: '▲', color: '#5a3a7a',
    floorMin: 15, weight: 1.5, durability: 5, band: 'magma',
    grants: { kind: 'material', material: 'obsidian', amount: [1, 2] },
  },
  magma_geode: {
    key: 'magma_geode', name: 'Magma Geode', glyph: '◈', color: '#ff6a00',
    floorMin: 15, weight: 1.2, durability: 4, band: 'magma',
    grants: { kind: 'gold', amount: [25, 50] },
  },
};

export const MINE_MONSTERS: Record<string, MineMonsterDef> = {
  cave_slug: {
    key: 'cave_slug', name: 'Cave Slug', glyph: '🐛', color: '#5e8a2e',
    floorMin: 1, hp: 8, touchDamage: 4, moveCadenceMs: 950, bounty: [1, 4],
    weakTo: ['ST'],
  },
  rock_biter: {
    key: 'rock_biter', name: 'Rock Biter', glyph: '👹', color: '#9c3a25',
    floorMin: 3, hp: 18, touchDamage: 7, moveCadenceMs: 700, bounty: [4, 9],
    defense: 2, weakTo: ['DX'],
  },
  deep_lurker: {
    key: 'deep_lurker', name: 'Deep Lurker', glyph: '🦇', color: '#6a4fb0',
    floorMin: 6, hp: 28, touchDamage: 10, moveCadenceMs: 520, bounty: [10, 18],
    defense: 1, resistTo: ['ST'], weakTo: ['WI'],
  },
  stone_golem: {
    key: 'stone_golem', name: 'Stone Golem', glyph: '🪨', color: '#8a7a6a',
    floorMin: 7, hp: 50, touchDamage: 15, moveCadenceMs: 850, bounty: [20, 35],
    defense: 6, resistTo: ['DX'], weakTo: ['ST'],
    isGuardian: true, guardianFloor: 7,
  },
  cave_spider: {
    key: 'cave_spider', name: 'Cave Spider', glyph: '🕷️', color: '#6a3a6a',
    floorMin: 4, hp: 14, touchDamage: 8, moveCadenceMs: 400, bounty: [5, 12],
    weakTo: ['DX', 'WI'],
  },
  // --- Frozen Depths band (floors 7–14) ---
  ice_crawler: {
    key: 'ice_crawler', name: 'Ice Crawler', glyph: '🦞', color: '#60c8e8',
    floorMin: 7, hp: 22, touchDamage: 9, moveCadenceMs: 450, bounty: [8, 16],
    band: 'frozen', weakTo: ['ST'], resistTo: ['WI'],
  },
  // --- Magma Core band (floors 15+) ---
  magma_hound: {
    key: 'magma_hound', name: 'Magma Hound', glyph: '🐕', color: '#ff6a00',
    floorMin: 15, hp: 38, touchDamage: 16, moveCadenceMs: 580, bounty: [20, 38],
    defense: 3, band: 'magma', resistTo: ['ST'], weakTo: ['WI'],
  },
  // --- Band-gate guardians (placed once per run; excluded from random pool) ---
  magma_colossus: {
    key: 'magma_colossus', name: 'Magma Colossus', glyph: '🌋', color: '#ff4400',
    floorMin: 15, hp: 70, touchDamage: 20, moveCadenceMs: 900, bounty: [40, 70],
    defense: 5, band: 'magma', resistTo: ['ST'], weakTo: ['WI'],
    isGuardian: true, guardianFloor: 15,
  },
};

export const MINE_ORE_KEYS = Object.keys(MINE_ORES);
export const MINE_MONSTER_KEYS = Object.keys(MINE_MONSTERS);

/** Maps exact guardian floor → monster key. Consumed by generateMine for deterministic placement. */
export const MINE_GUARDIAN_FLOORS: Record<number, string> = {
  7: 'stone_golem',
  15: 'magma_colossus',
};

export function getMineOre(key: string): MineOreDef | undefined {
  return MINE_ORES[key];
}
export function getMineMonster(key: string): MineMonsterDef | undefined {
  return MINE_MONSTERS[key];
}
