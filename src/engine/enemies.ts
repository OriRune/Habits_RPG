// Dungeon foes for combat rooms. Shaped as BossDef so the combat engine works unchanged.
import type { StatId } from './stats';
import type { BossDef } from './bosses';
import type { RNG } from './combat';

interface EnemyTemplate {
  id: string;
  name: string;
  flavor: string;
  hp: number;
  attack: number;
  defense: number;
  ward: number;
  attackSchool: 'physical' | 'magic';
  weakTo: StatId[];
}

const ENEMIES: EnemyTemplate[] = [
  { id: 'goblin', name: 'Cave Goblin', flavor: 'A wiry scavenger with a rusted dagger.', hp: 40, attack: 7, defense: 0, ward: 0, attackSchool: 'physical', weakTo: ['ST'] },
  { id: 'skeleton', name: 'Skeleton Warrior', flavor: 'Bones held together by spite.', hp: 55, attack: 9, defense: 2, ward: 0, attackSchool: 'physical', weakTo: ['ST', 'WI'] },
  { id: 'giant_spider', name: 'Giant Spider', flavor: 'Too many legs, too many eyes.', hp: 45, attack: 8, defense: 1, ward: 1, attackSchool: 'physical', weakTo: ['DX', 'WI'] },
  { id: 'wisp', name: 'Wailing Wisp', flavor: 'A drifting spirit that sears the mind.', hp: 38, attack: 9, defense: 0, ward: 4, attackSchool: 'magic', weakTo: ['DX'] },
  { id: 'stone_golem', name: 'Stone Sentry', flavor: 'A squat guardian of the depths.', hp: 70, attack: 10, defense: 4, ward: 2, attackSchool: 'physical', weakTo: ['WI'] },
];

/** A scaled dungeon enemy for a combat room. Difficulty rises with level and depth. */
export function enemyFor(roomIndex: number, level: number, rng: RNG = Math.random): BossDef {
  const t = ENEMIES[Math.floor(rng() * ENEMIES.length)];
  const scale = 1 + (level - 1) * 0.25 + roomIndex * 0.1;
  return {
    id: `${t.id}_r${roomIndex}`,
    name: t.name,
    flavor: t.flavor,
    baseHp: Math.round(t.hp * scale),
    attack: Math.round(t.attack * scale),
    defense: t.defense + Math.floor(level / 8),
    ward: t.ward + Math.floor(level / 10),
    attackSchool: t.attackSchool,
    weakTo: t.weakTo,
    rewards: { gold: 0, items: [] },
  };
}
