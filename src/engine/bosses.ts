// Level-Up Trial bosses (design brief Sections 4 & 7).
import type { StatId } from './stats';

/** Which minion type this phase summons. */
export type MinionVariant = 'bat' | 'archer';

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
  /** Override the default MP cost for this move (see combat.ts enemyMoveCost). */
  mpCost?: number;
  /** Override the default stamina cost for this move (see combat.ts enemyMoveCost). */
  staCost?: number;
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
  /** Maximum MP for this phase (overrides auto-derived default in combat.ts). */
  maxMp?: number;
  /** Maximum stamina for this phase (overrides auto-derived default in combat.ts). */
  maxSta?: number;
  // ── Arena-specific phase tuning ───────────────────────────────────────────
  /** Override the post-attack recovery delay (ms). Lower = faster attack cadence (enrage). */
  recoverMs?: number;
  /** Extra minions spawned when entering this phase, on top of the board-size default. */
  spawnOnEntry?: number;
  /** Which minion variant is summoned during this phase. */
  minionVariant?: MinionVariant;
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
  /** Emoji glyph rendered on the board. Falls back to '👹' if omitted. */
  glyph?: string;
  /** Optional multi-phase script. If set (and non-empty), overrides baseHp/attack/etc. */
  phases?: BossPhase[];
  /** Maximum MP for single-phase enemies (overrides auto-derived default in combat.ts). */
  maxMp?: number;
  /** Maximum stamina for single-phase enemies (overrides auto-derived default in combat.ts). */
  maxSta?: number;
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
    glyph: '🫧',
    flavor: 'A low, gurgling blob that keeps splitting "later... later...".',
    baseHp: 85,
    attack: 6,
    defense: 1,
    weakTo: ['KN', 'DX'],
    phases: [
      { hp: 85, attack: 6, defense: 1, attackSchool: 'physical', weakTo: ['KN', 'DX'] },
      {
        hp: 40, attack: 9, defense: 0, attackSchool: 'magic',
        weakTo: ['DX'], recoverMs: 500,
        transitionMsg: "The slime surges — 'Now it's urgent!'",
      },
    ],
    rewards: { gold: 100, items: ['healing_potion'] },
  },

  8: {
    id: 'drill_rex',
    name: 'Drill Sergeant Rex',
    glyph: '🪖',
    flavor: 'A relentless taskmaster who mistakes repetition for progress.',
    baseHp: 130,
    attack: 11,
    defense: 2,
    weakTo: ['CH', 'AG'],
    resistTo: ['ST'],
    rewards: { gold: 130, items: [] },
  },

  12: {
    id: 'comfort_blob',
    name: 'The Comfort Blob',
    glyph: '🛋️',
    flavor: 'A warm, shapeless mass that smothers ambition with ease.',
    baseHp: 190,
    attack: 10,
    defense: 4,
    weakTo: ['AG'],
    resistTo: ['ST', 'EN'],
    rewards: { gold: 185, items: ['healing_potion'] },
  },

  15: {
    id: 'anxiety_wraith',
    name: 'The Anxiety Wraith',
    glyph: '👻',
    flavor: 'Its attacks scatter like panicked thoughts — everywhere at once.',
    baseHp: 175,
    attack: 12,
    defense: 1,
    ward: 3,
    attackSchool: 'magic',
    weakTo: ['WI', 'KN'],
    resistTo: ['CH'],
    rewards: { gold: 230, items: [] },
  },

  20: {
    id: 'burnout_golem',
    name: 'The Burnout Golem',
    glyph: '🗿',
    flavor: 'A hulking ash-grey colossus that punishes overexertion.',
    baseHp: 360,
    attack: 18,
    defense: 5,
    weakTo: ['WI', 'EN'],
    phases: [
      { hp: 240, attack: 18, defense: 5, attackSchool: 'physical', weakTo: ['WI', 'EN'] },
      {
        hp: 120, attack: 22, defense: 3, ward: 2, attackSchool: 'magic',
        weakTo: ['WI'], recoverMs: 480,
        transitionMsg: 'The golem shifts to emergency overdrive!',
      },
    ],
    rewards: { gold: 500, items: ['recovery_elixir', 'healing_potion'] },
  },

  25: {
    id: 'mirror_demon',
    name: 'The Mirror Demon',
    glyph: '🪞',
    flavor: 'It shows you what you fear to be.',
    baseHp: 200,
    attack: 15,
    defense: 3,
    ward: 2,
    weakTo: ['KN', 'DX'],
    phases: [
      { hp: 200, attack: 15, defense: 3, ward: 2, attackSchool: 'physical', weakTo: ['KN', 'DX'] },
      {
        hp: 150, attack: 18, defense: 1, ward: 5, attackSchool: 'magic',
        weakTo: ['DX'], recoverMs: 520,
        transitionMsg: 'The Mirror Demon shifts planes — reality warps!',
      },
    ],
    rewards: { gold: 380, items: ['recovery_elixir'] },
  },

  30: {
    id: 'clockwork_tyrant',
    name: 'The Clockwork Tyrant',
    glyph: '⚙️',
    flavor: 'A perfect engine of habit-crushing efficiency.',
    baseHp: 300,
    attack: 17,
    defense: 4,
    weakTo: ['DX', 'EN'],
    phases: [
      { hp: 300, attack: 17, defense: 4, attackSchool: 'physical', weakTo: ['DX', 'EN'] },
      {
        hp: 200, attack: 22, defense: 2, attackSchool: 'magic',
        weakTo: ['DX'], recoverMs: 420, spawnOnEntry: 2,
        transitionMsg: 'OVERCLOCK INITIATED — limiters removed!',
      },
    ],
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
