// Dungeon Expeditions (design brief §7.2). The first repeatable minigame and the sink
// for Energy. Pure run-generation + stat-room resolution; randomness is injected so runs
// are deterministically testable. Combat rooms are handled by the existing combat engine.
import { statPower, type StatId } from './stats';
import { type RNG } from './combat';
import { MATERIAL_KEYS } from './materials';
import { type Reward } from './challenges';

export const DUNGEON_ENERGY_COST = 3; // brief §7.2: "Dungeon entry = 3 Energy"

export type RoomType = 'combat' | 'trap' | 'puzzle' | 'negotiation' | 'survival' | 'treasure' | 'rest';

/** Favored stats per room (brief §7.2 table). Empty = no check (rest). */
export const ROOM_FAVORED: Record<RoomType, StatId[]> = {
  combat: ['ST', 'HP', 'EN'],
  trap: ['DX', 'AG'],
  puzzle: ['KN', 'WI'],
  negotiation: ['CH', 'WI'],
  survival: ['EN', 'HP'],
  treasure: ['DX', 'KN'],
  rest: [],
};

export const ROOM_META: Record<RoomType, { name: string; verb: string; description: string }> = {
  combat: { name: 'Combat Room', verb: 'Fight', description: 'A foe blocks the way.' },
  trap: { name: 'Trap Room', verb: 'Disarm', description: 'Blades and tripwires line the hall.' },
  puzzle: { name: 'Puzzle Room', verb: 'Solve', description: 'An ancient riddle bars the door.' },
  negotiation: { name: 'Negotiation Room', verb: 'Parley', description: 'A wary guardian demands words, not steel.' },
  survival: { name: 'Survival Room', verb: 'Endure', description: 'Harsh conditions test your grit.' },
  treasure: { name: 'Treasure Room', verb: 'Loot', description: 'A glittering hoard — if you can claim it.' },
  rest: { name: 'Rest Room', verb: 'Rest', description: 'A quiet alcove to catch your breath.' },
};

/** Difficulty threshold (favored-stat power) at which a room is an even-odds check. */
const ROOM_THRESHOLD: Record<RoomType, number> = {
  combat: 0, // handled by combat engine
  trap: 12,
  puzzle: 12,
  negotiation: 10,
  survival: 12,
  treasure: 14,
  rest: 0,
};

export interface DungeonRoom {
  type: RoomType;
}

export interface RoomResolution {
  outcome: 'success' | 'partial' | 'fail';
  /** Negative = HP lost, positive = HP healed. */
  hpDelta: number;
  reward: Reward;
  message: string;
}

const STAT_ROOM_POOL: RoomType[] = ['trap', 'puzzle', 'negotiation', 'survival'];

/**
 * Build a Standard Delve: ~4 rooms with guaranteed pacing — a stat challenge, a combat,
 * a rest, and a treasure finale. Deterministic via the injected RNG.
 */
export function generateDungeon(rng: RNG = Math.random): DungeonRoom[] {
  const first = STAT_ROOM_POOL[Math.floor(rng() * STAT_ROOM_POOL.length)];
  return [{ type: first }, { type: 'combat' }, { type: 'rest' }, { type: 'treasure' }];
}

function randomMaterial(rng: RNG): string {
  return MATERIAL_KEYS[Math.floor(rng() * MATERIAL_KEYS.length)];
}

function randomFrom<T>(arr: T[], rng: RNG): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Loot tables — keys must exist in src/content/items.ts and src/content/weapons.ts.
const SPELLBOOK_DROPS = ['spellbook_firebolt', 'spellbook_bless', 'spellbook_dazzle', 'spellbook_hex'];
const WEAPON_DROPS = ['iron_mace', 'short_bow'];

/** Heal granted by a rest room. */
export function restHeal(maxHp: number): number {
  return Math.round(maxHp * 0.4);
}

/**
 * Resolve a non-combat room as a favored-stat check. Returns the outcome, an HP delta,
 * and any reward (treasure rooms are richer). Rest rooms always heal.
 */
export function resolveStatRoom(
  room: DungeonRoom,
  statXp: Record<StatId, number>,
  maxHp: number,
  rng: RNG = Math.random,
  /** Flat per-stat bonuses (e.g. from equipped gear) added to the favored-stat power. */
  bonuses: Partial<Record<StatId, number>> = {},
): RoomResolution {
  if (room.type === 'rest') {
    const heal = restHeal(maxHp);
    return { outcome: 'success', hpDelta: heal, reward: {}, message: `You rest and recover ${heal} HP.` };
  }

  const favored = ROOM_FAVORED[room.type];
  const power = statPower(statXp, favored) + favored.reduce((s, st) => s + (bonuses[st] ?? 0), 0);
  const threshold = ROOM_THRESHOLD[room.type];
  const successChance = Math.min(0.95, Math.max(0.05, 0.3 + (power - threshold) * 0.04));

  const r = rng();
  const outcome: RoomResolution['outcome'] =
    r < successChance ? 'success' : r < successChance + 0.25 ? 'partial' : 'fail';

  const isTreasure = room.type === 'treasure';
  const meta = ROOM_META[room.type];

  if (outcome === 'success') {
    const gold = isTreasure ? 80 + Math.floor(rng() * 40) : 25 + Math.floor(rng() * 15);
    const materials: Record<string, number> = { [randomMaterial(rng)]: isTreasure ? 2 : 1 };
    if (isTreasure) materials['crystals'] = (materials['crystals'] ?? 0) + 1;
    const reward: Reward = { gold, materials };
    // Treasure rooms can drop a spellbook (and rarely a weapon).
    if (isTreasure) {
      if (rng() < 0.5) reward.items = [randomFrom(SPELLBOOK_DROPS, rng)];
      if (rng() < 0.15) reward.weapons = [randomFrom(WEAPON_DROPS, rng)];
    }
    return { outcome, hpDelta: 0, reward, message: `${meta.verb} succeeds! You claim the spoils.` };
  }

  if (outcome === 'partial') {
    const gold = isTreasure ? 40 : 10;
    return { outcome, hpDelta: -6, reward: { gold }, message: `A near miss — you scrape by, a little worse for wear.` };
  }

  // fail
  const damage = 10 + Math.floor(threshold / 2);
  return { outcome, hpDelta: -damage, reward: {}, message: `It goes badly. You take ${damage} damage.` };
}

/** Merge two rewards (used to accumulate a run's loot across rooms). */
export function mergeReward(a: Reward, b: Reward): Reward {
  const out: Reward = {
    gold: (a.gold ?? 0) + (b.gold ?? 0),
    materials: { ...(a.materials ?? {}) },
    items: [...(a.items ?? []), ...(b.items ?? [])],
  };
  for (const [k, v] of Object.entries(b.materials ?? {})) {
    out.materials![k] = (out.materials![k] ?? 0) + v;
  }
  return out;
}
