// Real pixel-art for the Forest & Mine minigames. Floor tiles and decor sprites live in
// src/assets/minigame/{tiles,cave_forest} and are auto-registered by basename below. Helpers
// map a tile kind / node key / ore key (and a stable per-cell variant) to an image URL, or
// return undefined so the overlay falls back to its existing glyph/icon. Drop a new PNG into
// the right folder and it's available here — no edits needed.

const modules = import.meta.glob('@/assets/minigame/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** basename (no extension) -> url, e.g. 'oak_1' -> '/assets/oak_1-hash.png'. */
const ART: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [path, url] of Object.entries(modules)) {
    const base = path.split('/').pop()!.replace(/\.png$/, '');
    map[base] = url;
  }
  return map;
})();

/** Look up a single sprite by basename. */
export function art(name: string): string | undefined {
  return ART[name];
}

/** Stable 0..1 hash for a cell, so a tile's chosen variant never reshuffles between renders. */
function cellHash(r: number, c: number): number {
  let h = (Math.imul(r, 73856093) ^ Math.imul(c, 19349663)) >>> 0;
  h ^= h >>> 13;
  return (h % 1000) / 1000;
}

/** Deterministically pick one basename from a pool for cell (r,c); undefined if none resolve. */
function cellVariant(pool: string[], r: number, c: number): string | undefined {
  const present = pool.filter((n) => ART[n]);
  if (present.length === 0) return undefined;
  return ART[present[Math.floor(cellHash(r, c) * present.length)]];
}

// --- Forest -------------------------------------------------------------------

/** Thicket walls — a varied mix of trees (the maze reads as dense wood). */
const FOREST_TREES = [
  'oak_1', 'oak_2', 'oak_3',
  'pine_1', 'pine_2', 'pine_3', 'pine_4',
  'green_maple_1', 'red_maple_1', 'yellow_maple_1',
  'foreboding_oak_1', 'foreboding_pine_1', 'foreboding_pine_2', 'foreboding_pine_3',
  'dead_oak', 'dead_pine',
];
const FOREST_DIRT = ['tile_dirt_1', 'tile_dirt_2'];
const FOREST_GRASS = ['tile_grass_1', 'tile_grass_2'];

/** A tree sprite for a thicket cell (the impassable maze wall). */
export function forestThicketTree(r: number, c: number): string | undefined {
  return cellVariant(FOREST_TREES, r, c);
}

/** The floor tile under a walkable forest cell (grass in clearings, dirt elsewhere). */
export function forestFloorTile(kind: string, r: number, c: number): string | undefined {
  if (kind === 'clearing') return cellVariant(FOREST_GRASS, r, c);
  return cellVariant(FOREST_DIRT, r, c);
}

/** Decor sprite for a gatherable node, or undefined (e.g. spring → keep its glyph). */
const FOREST_NODE_ART: Record<string, string> = {
  flower_bush: 'flower_bush_1',
  flax_plant: 'cotton_plant',
  berry_forage: 'toadstool',
  crystal_find: 'cave_crystal_1',
};
export function forestNodeSprite(nodeKey: string): string | undefined {
  const name = FOREST_NODE_ART[nodeKey];
  return name ? ART[name] : undefined;
}

// --- Mine ---------------------------------------------------------------------

const MINE_BOULDERS = ['boulder_1', 'boulder_2_jagged', 'boulder_3_brown'];
const MINE_FLOORS = ['tile_cave_floor_1', 'tile_cave_floor_2'];

/** A boulder sprite for a diggable rock wall. */
export function mineRockSprite(r: number, c: number): string | undefined {
  return cellVariant(MINE_BOULDERS, r, c);
}

/** The cave-floor tile under a walkable mine cell. */
export function mineFloorTile(r: number, c: number): string | undefined {
  return cellVariant(MINE_FLOORS, r, c);
}

/** Decor sprite for an ore vein, or undefined (rubble/gold/gemstone/energy → keep their icon). */
const MINE_ORE_ART: Record<string, string> = {
  iron_vein: 'iron_ore_1',
  crystal_node: 'cave_crystal_1',
  gemstone_node: 'cave_crystal_2',
  bronze_vein: 'copper_ore_1', // closest match — no dedicated bronze art
  cave_mushroom: 'toadstool',   // reuses the forest berry node sprite
};
export function mineOreSprite(oreKey: string): string | undefined {
  const name = MINE_ORE_ART[oreKey];
  return name ? ART[name] : undefined;
}

/**
 * Icon sprite for a haul material key (iron_bar, crystals, etc.), or undefined.
 * Falls back to a colored chip + name in the overlay when undefined.
 */
const MINE_MATERIAL_ART: Record<string, string> = {
  iron_bar: 'iron_ore_1',
  crystals: 'cave_crystal_1',
  gemstone: 'cave_crystal_2',
  bronze_bar: 'copper_ore_1',
  frost_quartz: 'cave_crystal_1', // closest match — no dedicated frost art
  obsidian: 'boulder_1',         // closest match — dark boulder reads as obsidian
};
export function mineMaterialIcon(materialKey: string): string | undefined {
  const name = MINE_MATERIAL_ART[materialKey];
  return name ? ART[name] : undefined;
}
