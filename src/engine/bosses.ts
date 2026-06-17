// Level-Up Trial bosses (design brief Sections 4 & 7).
import type { StatId } from './stats';

// ---------------------------------------------------------------------------
// Enemy movesets — drive the combat AI so foes do more than a single attack.
// ---------------------------------------------------------------------------

export type EnemyMoveKind =
  | 'attack'   // basic swing (current default behavior)
  | 'heavy'    // powerful telegraphed hit (mult × attack, harder to dodge)
  | 'multi'    // rapid flurry of N small hits
  | 'guard'    // brace defensively — raises physical damage-reduction until next turn
  | 'inflict'  // apply a status effect to the player (burn/poison/weaken/blind/freeze)
  | 'drain'    // hit + heal self for a fraction of damage dealt
  | 'enrage';  // permanently buff own attack

/**
 * A single move in a foe's moveset. The combat engine executes the queued move and
 * then picks the next one, so the player always sees what's coming next (telegraphed intent).
 * Add moves to `BossPhase.moveset` (multi-phase) or `BossDef.moveset` (single-phase).
 */
export interface EnemyMove {
  kind: EnemyMoveKind;
  /** Relative weight for random selection (default 1). */
  weight?: number;
  /** Short label shown in the intent display ("winds up a heavy blow", "readies venom"…). */
  label: string;
  /** Emoji icon shown next to the intent label. */
  icon?: string;
  // --- per-kind parameters (all optional; sensible defaults are used when absent) ---
  /** 'heavy': attack multiplier (default 1.6). */
  mult?: number;
  /** 'multi': number of hits (default 2). */
  hits?: number;
  /** 'inflict': which status to apply (burn | poison | weaken | blind | freeze). */
  inflictKey?: string;
  /** 'inflict': how many turns the status lasts (default 3). */
  inflictTurns?: number;
  /** 'inflict': status magnitude — DoT damage/turn for burn|poison, fraction for weaken (0–1), 1 for blind|freeze. */
  inflictMag?: number;
  /** 'drain': fraction of damage dealt that heals the enemy (default 0.5). */
  drainRatio?: number;
  /** 'guard': physical defense bonus added until the foe's next turn (default 4). */
  bonus?: number; // also used for 'enrage' (attack bonus, default 3)
}

/** One stage of a multi-phase fight. When a boss has phases, defeating one HP bar
 *  advances to the next (new HP/stats/mechanics) instead of ending the battle. */
export interface BossPhase {
  hp: number;
  attack: number;
  defense: number;
  ward?: number;
  attackSchool?: 'physical' | 'magic';
  weakTo: StatId[];
  /** Stats the foe resists — actions powered by these deal reduced damage. */
  resistTo?: StatId[];
  /** Line shown when the fight enters this phase (omit for the opening phase). */
  transitionMsg?: string;
  /**
   * The foe's move pool for this phase. Weighted-random selection telegraphs the next
   * move to the player before each turn. Omit for a plain basic-attack foe.
   */
  moveset?: EnemyMove[];
}

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
  /** Stats the boss resists — actions powered by these deal reduced damage. */
  resistTo?: StatId[];
  /** Optional multi-phase script. If set (and non-empty), overrides baseHp/attack/etc. */
  phases?: BossPhase[];
  /**
   * Move pool for single-phase enemies (passed through to the synthetic phase in createBattle).
   * For multi-phase enemies, set `moveset` per phase instead.
   */
  moveset?: EnemyMove[];
  rewards: { gold: number; items: string[] };
}

/** Named bosses from the brief, keyed by the level tier they guard. */
export const NAMED_BOSSES: Record<number, BossDef> = {
  5: {
    id: 'procrastination_slime',
    name: 'The Procrastination Slime',
    flavor: 'A low, gurgling blob that keeps splitting "later... later...".',
    baseHp: 85,
    attack: 6,
    defense: 1,
    weakTo: ['KN', 'DX'],
    rewards: { gold: 100, items: ['healing_potion'] },
  },
  20: {
    id: 'burnout_golem',
    name: 'The Burnout Golem',
    flavor: 'A hulking ash-grey colossus that punishes overexertion.',
    baseHp: 360,
    attack: 18,
    defense: 5,
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
    baseHp: 55 + t * 8,
    attack: 4 + Math.round(t * 0.7),
    defense: Math.floor(t / 8),
    weakTo: [],
    rewards: { gold: 40 + t * 8, items: t % 3 === 0 ? ['healing_potion'] : [] },
  };
}
