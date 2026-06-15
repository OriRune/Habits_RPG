// ============================================================================
//  FOREST CONTENT — edit this file to tune gatherable nodes and forest beasts.
// ============================================================================
//
//  Fuels the "Wild Forest" minigame (src/engine/forest.ts). Each entry is
//  `key: { ...fields }` (key + inner `key:` must match, be unique). Copy a block
//  to add, edit to change, delete to remove. Loot yields feed the shared economy
//  (gold + crafting materials in src/content/materials.ts) — the forest is the
//  source of herbs (flower bushes), cloth (flax/cotton) and leather (beasts).
//
//  NODES (FOREST_NODES) — gathered instantly with one action (no durability)
//  ------------------------------------------------------------------------
//  glyph/color   Stand-in crest until real art exists.
//  stageMin      Earliest forest stage this node can appear on.
//  weight        Relative spawn chance among eligible nodes (higher = commoner).
//                Weight 0 = never in the random pool (placed specially, e.g. springs).
//  grants        What gathering it yields: gold, a crafting material (random
//                amount within [min, max]), or a stamina refill.
//
//  BEASTS (FOREST_BEASTS) — aggressive animals; drop leather when defeated
//  ----------------------------------------------------------------------
//  hp            Health; you chip it with your blade (meleePower per slash).
//  touchDamage   HP you lose when it reaches you (subject to a brief i-frame).
//  moveCadenceMs How often it steps toward you once woken (lower = faster).
//  aggroRadius   It lies dormant/hidden until you come this close (Manhattan),
//                then it wakes and gives chase (the ambush).
//  bounty        Gold dropped on death (random within [min, max]).
// ============================================================================

export interface ForestNodeDef {
  key: string;
  name: string;
  glyph: string;
  color: string;
  stageMin: number;
  weight: number;
  grants:
    | { kind: 'gold'; amount: [number, number] }
    | { kind: 'material'; material: string; amount: [number, number] }
    | { kind: 'stamina'; amount: [number, number] };
}

export interface ForestBeastDef {
  key: string;
  name: string;
  glyph: string;
  color: string;
  stageMin: number;
  hp: number;
  touchDamage: number;
  moveCadenceMs: number;
  aggroRadius: number;
  bounty: [number, number];
}

export const FOREST_NODES: Record<string, ForestNodeDef> = {
  berry_forage: {
    key: 'berry_forage', name: 'Wild Forage', glyph: '🍄', color: '#b06a3a',
    stageMin: 1, weight: 3, grants: { kind: 'gold', amount: [1, 5] },
  },
  flower_bush: {
    key: 'flower_bush', name: 'Flower Bush', glyph: '🌸', color: '#d96aa0',
    stageMin: 1, weight: 3, grants: { kind: 'material', material: 'herbs', amount: [1, 2] },
  },
  flax_plant: {
    key: 'flax_plant', name: 'Flax & Cotton', glyph: '🌾', color: '#c9b34f',
    stageMin: 1, weight: 3, grants: { kind: 'material', material: 'cloth_roll', amount: [1, 2] },
  },
  crystal_find: {
    key: 'crystal_find', name: 'Buried Crystals', glyph: '◆', color: '#6a4fb0',
    stageMin: 4, weight: 1, grants: { kind: 'material', material: 'crystals', amount: [1, 1] },
  },
  spring: {
    key: 'spring', name: 'Cool Spring', glyph: '💧', color: '#22d3ee',
    stageMin: 1, weight: 0, grants: { kind: 'stamina', amount: [11, 11] },
  },
};

export const FOREST_BEASTS: Record<string, ForestBeastDef> = {
  wild_boar: {
    key: 'wild_boar', name: 'Wild Boar', glyph: '🐗', color: '#8a6a4a',
    stageMin: 1, hp: 8, touchDamage: 4, moveCadenceMs: 620, aggroRadius: 3, bounty: [1, 4],
  },
  gray_wolf: {
    key: 'gray_wolf', name: 'Gray Wolf', glyph: '🐺', color: '#7a8590',
    stageMin: 2, hp: 12, touchDamage: 6, moveCadenceMs: 440, aggroRadius: 4, bounty: [3, 8],
  },
  forest_bear: {
    key: 'forest_bear', name: 'Forest Bear', glyph: '🐻', color: '#6a4a2a',
    stageMin: 5, hp: 24, touchDamage: 12, moveCadenceMs: 520, aggroRadius: 3, bounty: [9, 16],
  },
};

export const FOREST_NODE_KEYS = Object.keys(FOREST_NODES);
export const FOREST_BEAST_KEYS = Object.keys(FOREST_BEASTS);

export function getForestNode(key: string): ForestNodeDef | undefined {
  return FOREST_NODES[key];
}
export function getForestBeast(key: string): ForestBeastDef | undefined {
  return FOREST_BEASTS[key];
}
