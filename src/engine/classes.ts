// Class system (design brief Section 6).
// At level 10 a character's class is derived from its two highest stats:
// row = highest (primary), column = second-highest (secondary).
import { STAT_IDS, type StatId } from './stats';

/** Full 8×8 class chart, transcribed verbatim from the brief. */
export const CLASS_CHART: Record<StatId, Record<StatId, string>> = {
  DX: { DX: 'Duelist', AG: 'Illusionist', ST: 'Pirate', EN: 'Trapper', WI: 'Magician', CH: 'Rogue', KN: 'Artist', HP: 'Craftsman' },
  AG: { DX: 'Thief', AG: 'Acrobat', ST: 'Ninja', EN: 'Skirmisher', WI: 'Windwalker', CH: 'Daredevil', KN: 'Saboteur', HP: 'Escape Artist' },
  ST: { DX: 'Knight', AG: 'Warrior', ST: 'Strongman', EN: 'Barbarian', WI: 'Paladin', CH: 'Samurai', KN: 'Martial Artist', HP: 'Juggernaut' },
  EN: { DX: 'Ranger', AG: 'Trailblazer', ST: 'Vanguard', EN: 'Sentinel', WI: 'Wilder', CH: 'Spy', KN: 'Scout', HP: 'Mountain Man' },
  WI: { DX: 'Healer', AG: 'Mystic', ST: 'Monk', EN: 'Druid', WI: 'Sage', CH: 'Shaman', KN: 'Seer', HP: 'Battle Monk' },
  CH: { DX: 'Bard', AG: 'Performer', ST: 'General', EN: 'Field Marshal', WI: 'Philosopher', CH: 'Lord', KN: 'Pyromancer', HP: 'Ardent' },
  KN: { DX: 'Sorcerer', AG: 'Warlock', ST: 'Battle Mage', EN: 'Field Mage', WI: 'Wizard', CH: 'Mage', KN: 'Scholar', HP: 'Alchemist' },
  HP: { DX: 'Guardian', AG: 'Wardancer', ST: 'Soldier', EN: 'Fortress', WI: 'Crusader', CH: 'Warlord', KN: 'Cleric', HP: 'Tank' },
};

/** Advanced classes unlocked at higher levels (brief Section 6). */
export const ADVANCED_CLASSES: Record<string, string> = {
  Rogue: 'Shadowblade',
  Bard: 'Maestro',
  Knight: 'Champion',
  Wizard: 'Archmage',
  Tank: 'Ironwall',
  Healer: 'Saint',
  Ninja: 'Phantom',
  Druid: 'Verdant Oracle',
};

/** Level at which the Adventurer receives their first class (brief Section 6). */
export const CLASS_UNLOCK_LEVEL = 10;

export function classFor(primary: StatId, secondary: StatId): string {
  return CLASS_CHART[primary][secondary];
}

export function advancedClassFor(baseClass: string): string | undefined {
  return ADVANCED_CLASSES[baseClass];
}

/** Stats sorted by XP descending; ties broken by canonical STAT_IDS order. */
export function rankStats(statXp: Record<StatId, number>): StatId[] {
  return [...STAT_IDS].sort((a, b) => {
    const diff = statXp[b] - statXp[a];
    if (diff !== 0) return diff;
    return STAT_IDS.indexOf(a) - STAT_IDS.indexOf(b);
  });
}

export interface ClassAssignment {
  primary: StatId;
  secondary: StatId;
  classId: string;
  /** True when XP ties make the top-two ambiguous — caller should let the player choose. */
  ambiguous: boolean;
}

/**
 * Derive a class from per-stat XP. Returns the canonical top-two pairing plus an
 * `ambiguous` flag set when ties at the first- or second-place boundary mean the
 * brief's "if tied, player chooses" rule applies.
 */
export function assignClass(statXp: Record<StatId, number>): ClassAssignment {
  const ranked = rankStats(statXp);
  const primary = ranked[0];
  const secondary = ranked[1];

  const firstVal = statXp[primary];
  const secondVal = statXp[secondary];
  // Ambiguous if more than one stat shares the top value, or more than one
  // (non-primary) stat shares the second value.
  const tiedForFirst = STAT_IDS.filter((s) => statXp[s] === firstVal).length > 1;
  const tiedForSecond =
    STAT_IDS.filter((s) => s !== primary && statXp[s] === secondVal).length > 1;

  return {
    primary,
    secondary,
    classId: classFor(primary, secondary),
    ambiguous: tiedForFirst || tiedForSecond,
  };
}
