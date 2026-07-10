// Dungeon Expeditions (design brief §7.2) — the repeatable Energy sink, reworked into an
// endless descent: a run is a chain of *floors*, each a short paced sequence of rooms ending
// at a checkpoint where you Bank (leave safely) or Descend (a harder, richer floor). Combat
// rooms use the combat engine; encounter rooms are branching text events (engine/encounters.ts);
// biomes/bosses scale with depth (engine/biomes.ts). Pure + deterministic via injected RNG.
import { type RNG } from './combat';
import { MATERIAL_KEYS } from './materials';
import { type Reward } from './challenges';

export const DUNGEON_ENERGY_COST = 3; // brief §7.2: "Dungeon entry = 3 Energy"

/** Entry covers this many floors; every descent past them costs `DUNGEON_DESCENT_COST`.
 *  The energy contract (plan D1): a run must stay funded by habit-earned energy — at zero
 *  energy the only checkpoint option is Bank & Leave. All descent copy renders from these. */
export const DUNGEON_FREE_FLOORS = 3;
export const DUNGEON_DESCENT_COST = 1;

/** Floors between region bosses — a boss every 5th floor caps its biome. */
const BIOME_SPAN = 5;

/**
 * Does descending TO `nextDepth` cost energy? Entry covers the run's first
 * `DUNGEON_FREE_FLOORS` floors *counting from where the expedition started* (decision D6:
 * a floor-6 start covers 6–8), so deep starts keep the same contract as floor-1 runs.
 */
export function descentCharged(nextDepth: number, startDepth: number = 1): boolean {
  return nextDepth - startDepth + 1 > DUNGEON_FREE_FLOORS;
}

/**
 * Expedition start floors unlocked (plan 3.2, decision D6): floor 1 always; each biome's
 * first floor (6, 11, 16…) once that biome's *previous* boss (5, 10, 15…) has been slain.
 * `deepestFloor >= start` grants legacy credit — saves from before boss-kill tracking
 * proved the kill by descending past it. Unlocks are contiguous by construction (you
 * cannot fight boss 10 without passing boss 5).
 */
export function expeditionStarts(deepestFloor: number, bossesSlain: number[]): number[] {
  const starts = [1];
  for (let bossDepth = BIOME_SPAN; ; bossDepth += BIOME_SPAN) {
    const start = bossDepth + 1;
    if (bossesSlain.includes(bossDepth) || deepestFloor >= start) starts.push(start);
    else break;
  }
  return starts;
}

/** Gold paid for a plain combat win — ≈ half a treasure room's base (resolveTreasure: 60+depth*10). */
export function combatRoomGold(depth: number): number {
  return 30 + depth * 5;
}

/** Gold for a floor-boss win — the marquee payout of a floor, well above a plain room. */
export function bossRoomGold(depth: number): number {
  return 100 + depth * 50;
}

export type RoomKind =
  | 'combat'
  | 'encounter'
  | 'treasure'
  | 'boss'
  | 'elite'
  | 'shrine'
  | 'merchant'
  | 'rest';

export type DungeonRoom =
  | { type: 'combat' }
  | { type: 'boss' }
  | { type: 'treasure' }
  | { type: 'encounter'; key: string }
  | { type: 'elite' }
  | { type: 'shrine' }
  | { type: 'merchant' }
  | { type: 'rest' };

/** Header copy for the non-narrative room types (encounters narrate themselves). */
export const ROOM_META: Record<RoomKind, { name: string; description: string }> = {
  combat: { name: 'Combat Room', description: 'A foe blocks the way.' },
  boss: { name: 'Boss Chamber', description: 'A great enemy guards the deeper dark.' },
  treasure: { name: 'Treasure Room', description: 'A glittering hoard — claim it and move on.' },
  encounter: { name: 'Encounter', description: '' },
  elite: { name: 'Elite Foe', description: 'A dangerous champion — beat it for a guaranteed boon.' },
  shrine: { name: 'Shrine', description: 'An old altar hums with power. Make an offering — or don’t.' },
  merchant: { name: 'Wandering Merchant', description: 'A hooded trader deals in the deep.' },
  rest: { name: 'Campfire', description: 'A safe hollow to recover or attune your relics.' },
};

function randomMaterial(rng: RNG): string {
  return MATERIAL_KEYS[Math.floor(rng() * MATERIAL_KEYS.length)];
}

function randomFrom<T>(arr: T[], rng: RNG): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Loot tables — keys must exist in src/content/items.ts and src/content/weapons.ts.
const SPELLBOOK_DROPS = ['spellbook_firebolt', 'spellbook_bless', 'spellbook_dazzle', 'spellbook_hex'];
const WEAPON_DROPS = ['iron_mace', 'short_bow'];

/** A wandering-merchant offer (bought with the player's gold mid-run). */
export interface MerchantOffer {
  id: string;
  label: string;
  cost: number;
  kind: 'heal' | 'potion' | 'boon';
  potionKey?: string;
}

/**
 * The merchant's wares for a floor — a heal, a potion, and a relic, priced by depth.
 * `discount01` is the Homestead Trading Post haggle perk (0 or 0.15); each price is
 * scaled by (1 − discount01) and floored at 1g. Default 0 keeps the un-perked prices.
 */
export function merchantOffers(depth: number, discount01: number = 0): MerchantOffer[] {
  const price = (base: number) => Math.max(1, Math.round(base * (1 - discount01)));
  return [
    { id: 'heal', label: 'Tend your wounds — restore 40% HP', cost: price(18 + depth * 4), kind: 'heal' },
    { id: 'potion', label: 'A Healing Potion for the road', cost: price(24 + depth * 5), kind: 'potion', potionKey: 'healing_potion' },
    { id: 'boon', label: 'A relic from the pack', cost: price(45 + depth * 9), kind: 'boon' },
  ];
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
