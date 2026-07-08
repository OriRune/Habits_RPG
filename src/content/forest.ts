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

import type { MonsterCombatStats } from '@/engine/crawl';

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
  /**
   * If set, this node only spawns in the named biome band.
   * Omit for band-agnostic nodes (eligible in any band at or above stageMin).
   */
  band?: import('@/engine/crawlBiomes').ForestBandId;
}

export interface ForestBeastDef extends MonsterCombatStats {
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
  /** Prey that flee from the player instead of chasing; deal no contact damage. */
  flees?: boolean;
  /** Override the default 'leather' drop material. */
  dropMaterial?: string;
  /** Override the default drop amount formula [min, max]. */
  dropAmount?: [number, number];
  /**
   * If set, this beast only spawns in the named biome band.
   * Omit for band-agnostic beasts (eligible in any band at or above stageMin).
   */
  band?: import('@/engine/crawlBiomes').ForestBandId;
  /**
   * Band-gate guardian. Excluded from the random spawn pool; placed once by
   * generateForest on the exact stage matching guardianStage.
   */
  isGuardian?: true;
  /** The exact stage this guardian appears on (required when isGuardian is set). */
  guardianStage?: number;
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
  timber_stand: {
    key: 'timber_stand', name: 'Timber Stand', glyph: '🌲', color: '#5a7a3a',
    stageMin: 1, weight: 3, grants: { kind: 'material', material: 'wood', amount: [1, 2] },
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
    stageMin: 1, weight: 1, grants: { kind: 'stamina', amount: [12, 16] },
  },
  ancient_spring: {
    key: 'ancient_spring', name: 'Ancient Spring', glyph: '🌊', color: '#06b6d4',
    stageMin: 4, weight: 0, grants: { kind: 'stamina', amount: [20, 25] },
  },
  // --- Deepwood Grove band (stages 4–7) ---
  glowcap: {
    key: 'glowcap', name: 'Glowcap Mushroom', glyph: '🍄', color: '#a070d0',
    stageMin: 4, weight: 2, band: 'deepwood',
    grants: { kind: 'material', material: 'crystals', amount: [1, 2] },
  },
  // --- Ancient Heart band (stages 8+) ---
  heart_bloom: {
    key: 'heart_bloom', name: 'Heartwood Bloom', glyph: '🌺', color: '#e8a020',
    stageMin: 8, weight: 1.5, band: 'ancient',
    grants: { kind: 'material', material: 'amber_resin', amount: [1, 2] },
  },
};

export const FOREST_BEASTS: Record<string, ForestBeastDef> = {
  // --- Fleeing prey (drop premium loot; deal no contact damage; faster than the player) ---
  forest_deer: {
    key: 'forest_deer', name: 'Forest Deer', glyph: '🦌', color: '#a9805a',
    stageMin: 1, hp: 8, touchDamage: 0, moveCadenceMs: 150, aggroRadius: 4, bounty: [2, 6],
    flees: true, weakTo: ['DX'], dropMaterial: 'game_meat', dropAmount: [1, 2],
  },
  wild_rabbit: {
    key: 'wild_rabbit', name: 'Wild Rabbit', glyph: '🐇', color: '#c9b79a',
    stageMin: 1, hp: 5, touchDamage: 0, moveCadenceMs: 130, aggroRadius: 3, bounty: [1, 3],
    flees: true, weakTo: ['DX'], dropMaterial: 'pelt', dropAmount: [1, 1],
  },
  // --- Predators (pursue and strike the player) ---
  wild_boar: {
    key: 'wild_boar', name: 'Wild Boar', glyph: '🐗', color: '#8a6a4a',
    stageMin: 1, hp: 10, touchDamage: 4, moveCadenceMs: 620, aggroRadius: 3, bounty: [1, 4],
    weakTo: ['ST'],
  },
  gray_wolf: {
    key: 'gray_wolf', name: 'Gray Wolf', glyph: '🐺', color: '#7a8590',
    stageMin: 2, hp: 14, touchDamage: 6, moveCadenceMs: 400, aggroRadius: 4, bounty: [3, 8],
    weakTo: ['DX'],
  },
  forest_spider: {
    key: 'forest_spider', name: 'Forest Spider', glyph: '🕷', color: '#4a3a6a',
    stageMin: 3, hp: 12, touchDamage: 5, moveCadenceMs: 350, aggroRadius: 3, bounty: [2, 6],
    weakTo: ['DX', 'WI'],
  },
  forest_bear: {
    key: 'forest_bear', name: 'Forest Bear', glyph: '🐻', color: '#6a4a2a',
    stageMin: 5, hp: 30, touchDamage: 14, moveCadenceMs: 520, aggroRadius: 3, bounty: [9, 18],
    defense: 2, weakTo: ['ST'],
  },
  dire_wolf: {
    key: 'dire_wolf', name: 'Dire Wolf', glyph: '🐺', color: '#4a5060',
    stageMin: 7, hp: 22, touchDamage: 10, moveCadenceMs: 320, aggroRadius: 5, bounty: [10, 20],
    weakTo: ['WI'], resistTo: ['DX'],
  },
  ancient_guardian: {
    key: 'ancient_guardian', name: 'Ancient Guardian', glyph: '🌳', color: '#2a6a3a',
    stageMin: 8, hp: 55, touchDamage: 18, moveCadenceMs: 600, aggroRadius: 2, bounty: [20, 35],
    defense: 5, resistTo: ['DX'], weakTo: ['ST'],
    isGuardian: true, guardianStage: 8,
  },
  // --- Stage 3 elite (ramps difficulty before the first guardian fight at Stage 4) ---
  alpha_boar: {
    key: 'alpha_boar', name: 'Alpha Boar', glyph: '🐗', color: '#5a3010',
    stageMin: 3, hp: 22, touchDamage: 8, moveCadenceMs: 480, aggroRadius: 4, bounty: [6, 12],
    weakTo: ['ST'],
  },
  // --- Band-gate guardians (placed once per run; excluded from random pool) ---
  grove_sentinel: {
    key: 'grove_sentinel', name: 'Grove Sentinel', glyph: '🦁', color: '#5a8a3a',
    stageMin: 4, hp: 40, touchDamage: 12, moveCadenceMs: 550, aggroRadius: 2, bounty: [14, 28],
    defense: 2, resistTo: ['DX'], weakTo: ['ST'],
    isGuardian: true, guardianStage: 4,
  },
  // --- Deepwood Grove band (stages 4–7) ---
  shadow_lynx: {
    key: 'shadow_lynx', name: 'Shadow Lynx', glyph: '🐈', color: '#6a4a9a',
    stageMin: 4, hp: 18, touchDamage: 9, moveCadenceMs: 300, aggroRadius: 4, bounty: [6, 14],
    band: 'deepwood', weakTo: ['DX'], resistTo: ['ST'],
  },
  // --- Ancient Heart band (stages 8+) ---
  grove_wraith: {
    key: 'grove_wraith', name: 'Grove Wraith', glyph: '👻', color: '#c8a030',
    stageMin: 8, hp: 28, touchDamage: 12, moveCadenceMs: 420, aggroRadius: 5, bounty: [14, 28],
    band: 'ancient', defense: 2, weakTo: ['WI'], resistTo: ['DX'],
    dropMaterial: 'amber_resin', dropAmount: [1, 2],
  },
  // Deep-ancient sprinter (stages 12+): sub-300ms cadence outruns the player, so
  // deep stages can no longer be strolled through untouched.
  amber_stalker: {
    key: 'amber_stalker', name: 'Amber Stalker', glyph: '🐆', color: '#e8a020',
    stageMin: 12, hp: 26, touchDamage: 13, moveCadenceMs: 250, aggroRadius: 5, bounty: [40, 60],
    band: 'ancient', flees: false, weakTo: ['WI'], resistTo: ['DX'],
  },
};

// ============================================================================
//  SHRINE EVENTS — activatable once per clearing-centre shrine (stand on it, Act)
// ============================================================================

export type ShrineEventKind = 'cache' | 'blessing' | 'den';

export interface ShrineEventDef {
  key: string;
  name: string;
  glyph: string;
  color: string;
  weight: number;
  kind: ShrineEventKind;
  /** 'cache' — instant loot reward */
  loot?: { gold?: [number, number]; material?: string; amount?: [number, number] };
  /** 'blessing' — temporary player status applied via applyStatus */
  buff?: { status: 'bless'; magnitude: number; turns: number };
  /** 'den' — spawns an awake guardian beast adjacent */
  guardianKey?: string;
}

export const SHRINE_EVENTS: Record<string, ShrineEventDef> = {
  hunters_cache: {
    key: 'hunters_cache', name: "Hunter's Cache", glyph: '📦', color: '#caa05a',
    weight: 3, kind: 'cache',
    loot: { gold: [10, 25], material: 'game_meat', amount: [1, 3] },
  },
  forest_blessing: {
    key: 'forest_blessing', name: 'Forest Blessing', glyph: '✨', color: '#7fd6a0',
    weight: 2, kind: 'blessing',
    buff: { status: 'bless', magnitude: 4, turns: 8 },
  },
  disturbed_den: {
    key: 'disturbed_den', name: 'Disturbed Den', glyph: '🕳', color: '#b05a5a',
    weight: 2, kind: 'den',
    guardianKey: 'forest_bear',
  },
};

export const FOREST_NODE_KEYS = Object.keys(FOREST_NODES);
export const FOREST_BEAST_KEYS = Object.keys(FOREST_BEASTS);

/** Maps exact guardian stage → beast key. Consumed by generateForest for deterministic placement. */
export const FOREST_GUARDIAN_STAGES: Record<number, string> = {
  4: 'grove_sentinel',
  8: 'ancient_guardian',
};

