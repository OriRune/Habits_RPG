// Dungeon Expeditions (design brief §7.2) — the repeatable Energy sink, reworked into an
// endless descent: a run is a chain of *floors*, each a short paced sequence of rooms ending
// at a checkpoint where you Bank (leave safely) or Descend (a harder, richer floor). Combat
// rooms use the combat engine; encounter rooms are branching text events (engine/encounters.ts);
// biomes/bosses scale with depth (engine/biomes.ts). Pure + deterministic via injected RNG.
import { type RNG } from './combat';
import { MATERIAL_KEYS } from './materials';
import { type Reward } from './challenges';
import { type BiomeDef, isBossDepth } from './biomes';

export const DUNGEON_ENERGY_COST = 3; // brief §7.2: "Dungeon entry = 3 Energy"

export type RoomKind = 'combat' | 'encounter' | 'treasure' | 'boss';

export type DungeonRoom =
  | { type: 'combat' }
  | { type: 'boss' }
  | { type: 'treasure' }
  | { type: 'encounter'; key: string };

/** Header copy for the non-narrative room types (encounters narrate themselves). */
export const ROOM_META: Record<RoomKind, { name: string; description: string }> = {
  combat: { name: 'Combat Room', description: 'A foe blocks the way.' },
  boss: { name: 'Boss Chamber', description: 'A great enemy guards the deeper dark.' },
  treasure: { name: 'Treasure Room', description: 'A glittering hoard — claim it and move on.' },
  encounter: { name: 'Encounter', description: '' },
};

function randomMaterial(rng: RNG): string {
  return MATERIAL_KEYS[Math.floor(rng() * MATERIAL_KEYS.length)];
}

function randomFrom<T>(arr: T[], rng: RNG): T {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle<T>(arr: T[], rng: RNG): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Loot tables — keys must exist in src/content/items.ts and src/content/weapons.ts.
const SPELLBOOK_DROPS = ['spellbook_firebolt', 'spellbook_bless', 'spellbook_dazzle', 'spellbook_hex'];
const WEAPON_DROPS = ['iron_mace', 'short_bow'];

function encounterRoom(biome: BiomeDef, rng: RNG): DungeonRoom {
  const key = biome.encounters.length ? randomFrom(biome.encounters, rng) : 'sealed_door';
  return { type: 'encounter', key };
}

/**
 * Build one floor for the given depth + biome. Boss floors (every 5th depth) are a lead-in
 * encounter then the boss; normal floors are a combat + an encounter (order varied) with a
 * treasure room appearing more often as you go deeper. The checkpoint follows the last room.
 */
export function generateFloor(depth: number, biome: BiomeDef, rng: RNG = Math.random): DungeonRoom[] {
  if (isBossDepth(depth)) {
    return [encounterRoom(biome, rng), { type: 'boss' }];
  }
  const rooms: DungeonRoom[] = shuffle([{ type: 'combat' } as DungeonRoom, encounterRoom(biome, rng)], rng);
  // Richer floors carry a treasure finale; chance climbs with depth.
  if (rng() < 0.4 + depth * 0.05) rooms.push({ type: 'treasure' });
  return rooms;
}

/** Direct loot for a treasure room (no stat check) — scales with depth. */
export function resolveTreasure(depth: number, rng: RNG = Math.random): Reward {
  const gold = 60 + depth * 10 + Math.floor(rng() * 40);
  const materials: Record<string, number> = {};
  const m = randomMaterial(rng);
  materials[m] = 1 + Math.floor(rng() * 2);
  materials['crystals'] = (materials['crystals'] ?? 0) + 1;
  const reward: Reward = { gold, materials };
  if (rng() < 0.5) reward.items = [randomFrom(SPELLBOOK_DROPS, rng)];
  if (rng() < Math.min(0.4, 0.15 + depth * 0.015)) reward.weapons = [randomFrom(WEAPON_DROPS, rng)];
  return reward;
}

/** Merge two rewards (used to accumulate a run's loot across rooms/floors). */
export function mergeReward(a: Reward, b: Reward): Reward {
  const out: Reward = {
    gold: (a.gold ?? 0) + (b.gold ?? 0),
    materials: { ...(a.materials ?? {}) },
    items: [...(a.items ?? []), ...(b.items ?? [])],
    weapons: [...(a.weapons ?? []), ...(b.weapons ?? [])],
    gear: [...(a.gear ?? []), ...(b.gear ?? [])],
  };
  for (const [k, v] of Object.entries(b.materials ?? {})) {
    out.materials![k] = (out.materials![k] ?? 0) + v;
  }
  return out;
}

/** Keep only a share of a reward (loot forfeited when you fall mid-floor). */
export function scaleReward(r: Reward, factor: number): Reward {
  const materials: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.materials ?? {})) {
    const kept = Math.floor(v * factor);
    if (kept > 0) materials[k] = kept;
  }
  return {
    gold: Math.floor((r.gold ?? 0) * factor),
    materials,
    // Discrete drops (items/weapons/gear) are all-or-nothing: lost when you fall.
    items: [],
    weapons: [],
    gear: [],
  };
}
