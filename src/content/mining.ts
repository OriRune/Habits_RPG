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
    key: 'energy_gem', name: 'Energy Gem', glyph: '⚡', color: '#22d3ee',
    floorMin: 1, weight: 0, durability: 1, grants: { kind: 'stamina', amount: [11, 11] },
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
    floorMin: 10, hp: 50, touchDamage: 15, moveCadenceMs: 850, bounty: [20, 35],
    defense: 6, resistTo: ['DX'], weakTo: ['ST'],
  },
  cave_spider: {
    key: 'cave_spider', name: 'Cave Spider', glyph: '🕷️', color: '#6a3a6a',
    floorMin: 4, hp: 14, touchDamage: 8, moveCadenceMs: 400, bounty: [5, 12],
    weakTo: ['DX', 'WI'],
  },
};

export const MINE_ORE_KEYS = Object.keys(MINE_ORES);
export const MINE_MONSTER_KEYS = Object.keys(MINE_MONSTERS);

export function getMineOre(key: string): MineOreDef | undefined {
  return MINE_ORES[key];
}
export function getMineMonster(key: string): MineMonsterDef | undefined {
  return MINE_MONSTERS[key];
}
