// Level-Up Trial bosses (design brief Sections 4 & 7).
import type { StatId } from './stats';

export interface BossDef {
  id: string;
  name: string;
  flavor: string;
  baseHp: number;
  attack: number;
  /** Flat damage reduction applied to the player's physical hits. */
  defense: number;
  /** Flat reduction applied to the player's magical (spell) hits. */
  ward?: number;
  /** Whether the foe's own attacks are physical (vs. player Defense) or magical (vs. Ward). */
  attackSchool?: 'physical' | 'magic';
  /** Stats the boss is weak to — actions powered by these deal bonus damage. */
  weakTo: StatId[];
  rewards: { gold: number; items: string[] };
}

/** Named bosses from the brief, keyed by the level tier they guard. */
export const NAMED_BOSSES: Record<number, BossDef> = {
  5: {
    id: 'procrastination_slime',
    name: 'The Procrastination Slime',
    flavor: 'A low, gurgling blob that keeps splitting "later... later...".',
    baseHp: 120,
    attack: 8,
    defense: 1,
    weakTo: ['KN', 'DX'],
    rewards: { gold: 100, items: ['healing_potion'] },
  },
  20: {
    id: 'burnout_golem',
    name: 'The Burnout Golem',
    flavor: 'A hulking ash-grey colossus that punishes overexertion.',
    baseHp: 600,
    attack: 26,
    defense: 6,
    weakTo: ['WI', 'EN'],
    rewards: { gold: 500, items: ['recovery_elixir', 'healing_potion'] },
  },
};

/**
 * Boss for a level-up trial at the given target level. Uses a named boss when the
 * tier matches, otherwise a generic boss scaled by level (brief Section 8 scaling).
 */
export function bossForLevel(targetLevel: number): BossDef {
  const named = NAMED_BOSSES[targetLevel];
  if (named) return named;

  const t = targetLevel;
  return {
    id: `trial_l${t}`,
    name: `Trial Guardian (Lv ${t})`,
    flavor: 'A manifestation of the challenge between you and your next level.',
    baseHp: 80 + t * 14,
    attack: 6 + Math.round(t * 1.1),
    defense: Math.floor(t / 6),
    weakTo: [],
    rewards: { gold: 40 + t * 8, items: t % 3 === 0 ? ['healing_potion'] : [] },
  };
}
