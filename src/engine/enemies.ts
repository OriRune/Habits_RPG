// Dungeon foes for combat rooms. Shaped as BossDef so the combat engine works unchanged.
// Enemies are keyed by id and grouped into biome pools (see content/biomes.ts); each
// carries affinities — `weakTo` (bonus damage) and `resistTo` (reduced damage).
import type { StatId } from './stats';
import type { BossDef } from './bosses';
import type { RNG } from './combat';

export interface EnemyTemplate {
  id: string;
  name: string;
  flavor: string;
  hp: number;
  attack: number;
  defense: number;
  ward: number;
  attackSchool: 'physical' | 'magic';
  weakTo: StatId[];
  resistTo?: StatId[];
}

export const ENEMIES: Record<string, EnemyTemplate> = {
  // --- Catacombs (undead, magic-leaning) ---
  skeleton: { id: 'skeleton', name: 'Skeleton Warrior', flavor: 'Bones held together by spite.', hp: 55, attack: 9, defense: 2, ward: 0, attackSchool: 'physical', weakTo: ['ST', 'WI'], resistTo: ['DX'] },
  wisp: { id: 'wisp', name: 'Wailing Wisp', flavor: 'A drifting spirit that sears the mind.', hp: 40, attack: 10, defense: 0, ward: 4, attackSchool: 'magic', weakTo: ['DX'], resistTo: ['WI'] },
  ghoul: { id: 'ghoul', name: 'Crypt Ghoul', flavor: 'It feeds on the careless and the slow.', hp: 60, attack: 11, defense: 1, ward: 1, attackSchool: 'physical', weakTo: ['WI', 'CH'], resistTo: ['ST'] },

  // --- Overgrown Ruins (beasts) ---
  goblin: { id: 'goblin', name: 'Cave Goblin', flavor: 'A wiry scavenger with a rusted dagger.', hp: 42, attack: 8, defense: 0, ward: 0, attackSchool: 'physical', weakTo: ['ST'] },
  giant_spider: { id: 'giant_spider', name: 'Giant Spider', flavor: 'Too many legs, too many eyes.', hp: 48, attack: 9, defense: 1, ward: 1, attackSchool: 'physical', weakTo: ['DX', 'WI'] },
  dire_wolf: { id: 'dire_wolf', name: 'Dire Wolf', flavor: 'It hunts in the ruins where walls have fallen.', hp: 58, attack: 12, defense: 1, ward: 0, attackSchool: 'physical', weakTo: ['DX'], resistTo: ['CH'] },
  thornling: { id: 'thornling', name: 'Thornling', flavor: 'A bramble given a cruel, grasping will.', hp: 50, attack: 8, defense: 3, ward: 2, attackSchool: 'physical', weakTo: ['WI'], resistTo: ['ST'] },

  // --- Frozen Caverns (elementals) ---
  stone_sentry: { id: 'stone_sentry', name: 'Stone Sentry', flavor: 'A squat guardian of the depths.', hp: 75, attack: 11, defense: 4, ward: 2, attackSchool: 'physical', weakTo: ['WI'], resistTo: ['ST', 'DX'] },
  frost_revenant: { id: 'frost_revenant', name: 'Frost Revenant', flavor: 'Cold radiates from its hollow gaze.', hp: 52, attack: 12, defense: 1, ward: 5, attackSchool: 'magic', weakTo: ['ST'], resistTo: ['WI'] },
  ice_elemental: { id: 'ice_elemental', name: 'Ice Elemental', flavor: 'A churning storm of sleet and shard.', hp: 64, attack: 13, defense: 2, ward: 3, attackSchool: 'magic', weakTo: ['ST', 'DX'], resistTo: ['WI'] },
};

const FALLBACK = ENEMIES.goblin;

/**
 * A scaled dungeon enemy drawn from a biome's pool. Difficulty rises with both the
 * player's level and the run's depth, so deeper floors bite harder.
 */
export function enemyFor(depth: number, level: number, pool: string[], rng: RNG = Math.random): BossDef {
  const id = pool.length ? pool[Math.floor(rng() * pool.length)] : FALLBACK.id;
  const t = ENEMIES[id] ?? FALLBACK;
  const scale = 1 + (level - 1) * 0.18 + (depth - 1) * 0.18;
  return {
    id: `${t.id}_d${depth}`,
    name: t.name,
    flavor: t.flavor,
    baseHp: Math.round(t.hp * scale),
    attack: Math.round(t.attack * scale),
    defense: t.defense + Math.floor(depth / 4) + Math.floor(level / 8),
    ward: t.ward + Math.floor(depth / 5),
    attackSchool: t.attackSchool,
    weakTo: t.weakTo,
    resistTo: t.resistTo,
    rewards: { gold: 0, items: [] },
  };
}
