// Dungeon foes for combat rooms. Shaped as BossDef so the combat engine works unchanged.
// Enemies are keyed by id and grouped into biome pools (see content/biomes.ts); each
// carries affinities — `weakTo` (bonus damage) and `resistTo` (reduced damage).
import type { StatId } from './stats';
import type { BossDef, EnemyMove } from './bosses';
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
  /** Visual archetype used by Phase 2 battle-stage art. */
  archetype?: 'undead' | 'beast' | 'elemental' | 'construct';
  /** Move pool telegraphed during combat. Omit for a plain basic-attack foe. */
  moveset?: EnemyMove[];
}

// HP/attack are tuned to the level-based stat scale (attack = stat level + weapon bonus,
// typically ~6–14 for an on-level fighter). enemyFor scales these up with depth + level.
export const ENEMIES: Record<string, EnemyTemplate> = {
  // --- Catacombs (undead, magic-leaning) ---
  skeleton: {
    id: 'skeleton', name: 'Skeleton Warrior',
    flavor: 'Bones held together by spite.',
    hp: 34, attack: 7, defense: 2, ward: 0,
    attackSchool: 'physical', weakTo: ['ST', 'WI'], resistTo: ['DX'],
    archetype: 'undead',
    moveset: [
      { kind: 'attack', weight: 3, label: 'swings its rusted blade', icon: '⚔️' },
      { kind: 'heavy',  weight: 1, mult: 1.8, label: 'winds up a crushing overhead blow', icon: '💥' },
      { kind: 'guard',  weight: 1, bonus: 3,  label: 'locks its bones into a defensive stance', icon: '🛡️' },
    ],
  },
  wisp: {
    id: 'wisp', name: 'Wailing Wisp',
    flavor: 'A drifting spirit that sears the mind.',
    hp: 26, attack: 7, defense: 0, ward: 3,
    attackSchool: 'magic', weakTo: ['DX'], resistTo: ['WI'],
    archetype: 'undead',
    moveset: [
      { kind: 'attack',  weight: 2, label: 'lashes out with spectral energy', icon: '⚔️' },
      { kind: 'inflict', weight: 2, inflictKey: 'blind',  inflictTurns: 2, inflictMag: 1,    label: 'wails shrilly, clouding your sight', icon: '🌀' },
      { kind: 'inflict', weight: 1, inflictKey: 'weaken', inflictTurns: 2, inflictMag: 0.25, label: 'saps your will to fight', icon: '⬇️' },
    ],
  },
  ghoul: {
    id: 'ghoul', name: 'Crypt Ghoul',
    flavor: 'It feeds on the careless and the slow.',
    hp: 38, attack: 8, defense: 1, ward: 1,
    attackSchool: 'physical', weakTo: ['WI', 'CH'], resistTo: ['ST'],
    archetype: 'undead',
    moveset: [
      { kind: 'attack',  weight: 2, label: 'lunges with raking claws', icon: '⚔️' },
      { kind: 'drain',   weight: 2, drainRatio: 0.4, label: 'latches on and drains your life', icon: '🩸' },
      { kind: 'inflict', weight: 1, inflictKey: 'weaken', inflictTurns: 2, inflictMag: 0.2, label: 'saps your vitality', icon: '⬇️' },
    ],
  },

  // --- Overgrown Ruins (beasts) ---
  goblin: {
    id: 'goblin', name: 'Cave Goblin',
    flavor: 'A wiry scavenger with a rusted dagger.',
    hp: 26, attack: 6, defense: 0, ward: 0,
    attackSchool: 'physical', weakTo: ['ST'],
    archetype: 'beast',
    moveset: [
      { kind: 'attack', weight: 3, label: 'stabs with its rusty dagger', icon: '⚔️' },
      { kind: 'multi',  weight: 2, hits: 2, label: 'flurries with rapid dirty strikes', icon: '🗡️' },
    ],
  },
  giant_spider: {
    id: 'giant_spider', name: 'Giant Spider',
    flavor: 'Too many legs, too many eyes.',
    hp: 30, attack: 7, defense: 1, ward: 1,
    attackSchool: 'physical', weakTo: ['DX', 'WI'],
    archetype: 'beast',
    moveset: [
      { kind: 'attack',  weight: 2, label: 'bites with its venomous fangs', icon: '⚔️' },
      { kind: 'inflict', weight: 2, inflictKey: 'poison', inflictTurns: 3, inflictMag: 3, label: 'injects venom', icon: '☠️' },
      { kind: 'multi',   weight: 1, hits: 2, label: 'lunges in a frenzy of legs and fangs', icon: '🗡️' },
    ],
  },
  dire_wolf: {
    id: 'dire_wolf', name: 'Dire Wolf',
    flavor: 'It hunts in the ruins where walls have fallen.',
    hp: 36, attack: 9, defense: 1, ward: 0,
    attackSchool: 'physical', weakTo: ['DX'], resistTo: ['CH'],
    archetype: 'beast',
    moveset: [
      { kind: 'attack', weight: 2, label: 'mauls with savage jaws', icon: '⚔️' },
      { kind: 'multi',  weight: 2, hits: 3, label: 'savages with rapid bites', icon: '🗡️' },
      { kind: 'heavy',  weight: 1, mult: 1.7, label: 'leaps with its full weight', icon: '💥' },
    ],
  },
  thornling: {
    id: 'thornling', name: 'Thornling',
    flavor: 'A bramble given a cruel, grasping will.',
    hp: 32, attack: 6, defense: 2, ward: 2,
    attackSchool: 'physical', weakTo: ['WI'], resistTo: ['ST'],
    archetype: 'construct',
    moveset: [
      { kind: 'attack',  weight: 2, label: 'lashes with thorned vines', icon: '⚔️' },
      { kind: 'guard',   weight: 2, bonus: 4, label: 'hardens its bark into a shell', icon: '🛡️' },
      { kind: 'inflict', weight: 1, inflictKey: 'poison', inflictTurns: 2, inflictMag: 2, label: 'drives venomous spines into you', icon: '☠️' },
    ],
  },

  // --- Frozen Caverns (elementals / constructs) ---
  stone_sentry: {
    id: 'stone_sentry', name: 'Stone Sentry',
    flavor: 'A squat guardian of the depths.',
    hp: 46, attack: 8, defense: 3, ward: 2,
    attackSchool: 'physical', weakTo: ['WI'], resistTo: ['ST', 'DX'],
    archetype: 'construct',
    moveset: [
      { kind: 'attack', weight: 2, label: 'smashes with a stone fist', icon: '⚔️' },
      { kind: 'guard',  weight: 3, bonus: 5, label: 'fortifies its stone shell', icon: '🛡️' },
      { kind: 'heavy',  weight: 1, mult: 2.0, label: 'charges with full momentum', icon: '💥' },
    ],
  },
  frost_revenant: {
    id: 'frost_revenant', name: 'Frost Revenant',
    flavor: 'Cold radiates from its hollow gaze.',
    hp: 32, attack: 9, defense: 1, ward: 4,
    attackSchool: 'magic', weakTo: ['ST'], resistTo: ['WI'],
    archetype: 'undead',
    moveset: [
      { kind: 'attack',  weight: 2, label: 'strikes with an icy touch', icon: '⚔️' },
      { kind: 'inflict', weight: 2, inflictKey: 'freeze',  inflictTurns: 1, inflictMag: 1,    label: 'breathes a blast of freezing air', icon: '❄️' },
      { kind: 'inflict', weight: 1, inflictKey: 'weaken',  inflictTurns: 2, inflictMag: 0.25, label: 'saps your warmth and strength', icon: '⬇️' },
    ],
  },
  ice_elemental: {
    id: 'ice_elemental', name: 'Ice Elemental',
    flavor: 'A churning storm of sleet and shard.',
    hp: 40, attack: 9, defense: 2, ward: 3,
    attackSchool: 'magic', weakTo: ['ST', 'DX'], resistTo: ['WI'],
    archetype: 'elemental',
    moveset: [
      { kind: 'attack',  weight: 2, label: 'buffets with a wave of sleet', icon: '⚔️' },
      { kind: 'heavy',   weight: 2, mult: 1.8, label: 'charges a concentrated shard storm', icon: '💥' },
      { kind: 'inflict', weight: 1, inflictKey: 'weaken', inflictTurns: 2, inflictMag: 0.3, label: 'drains heat from your muscles', icon: '⬇️' },
    ],
  },
};

const FALLBACK = ENEMIES.goblin;

/**
 * A scaled dungeon enemy drawn from a biome's pool. Difficulty rises with both the
 * player's level and the run's depth, so deeper floors bite harder.
 */
export function enemyFor(
  depth: number,
  level: number,
  pool: string[],
  rng: RNG = Math.random,
  elite = false,
): BossDef {
  const id = pool.length ? pool[Math.floor(rng() * pool.length)] : FALLBACK.id;
  const t = ENEMIES[id] ?? FALLBACK;
  const scale = (1 + (level - 1) * 0.07 + (depth - 1) * 0.14) * (elite ? 1.45 : 1);
  return {
    id: `${t.id}_d${depth}${elite ? '_elite' : ''}`,
    name: elite ? `Elite ${t.name}` : t.name,
    flavor: t.flavor,
    baseHp: Math.round(t.hp * scale),
    attack: Math.round(t.attack * (elite ? scale * 0.9 : scale)),
    defense: t.defense + Math.floor(depth / 4) + Math.floor(level / 8) + (elite ? 1 : 0),
    ward: t.ward + Math.floor(depth / 5),
    attackSchool: t.attackSchool,
    weakTo: t.weakTo,
    resistTo: t.resistTo,
    moveset: t.moveset, // pass through the enemy's move pool
    rewards: { gold: 0, items: [] },
  };
}
