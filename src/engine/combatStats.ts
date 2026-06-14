// Combat-trained stats (Defense & Ward). Unlike the 8 habit stats, these gain XP from
// winning dungeon fights — never from habits — giving the minigame its own progression.
import { statPoints } from './stats';

export interface CombatStats {
  /** Reduces incoming physical damage. */
  defenseXp: number;
  /** "Magic defense" — reduces incoming magical damage. */
  wardXp: number;
}

export function emptyCombatStats(): CombatStats {
  return { defenseXp: 0, wardXp: 0 };
}

export const COMBAT_STAT_META = {
  defense: { name: 'Defense', glyph: 'D', color: '#7a8590' },
  ward: { name: 'Ward', glyph: 'W', color: '#6a4fb0' },
} as const;

/** Flat damage mitigation a combat stat currently provides (tapers via sqrt). */
export function mitigation(xp: number): number {
  return statPoints(xp);
}

/** Displayed level for a combat stat. */
export function combatLevel(xp: number): number {
  return statPoints(xp);
}

/** XP awarded for winning a dungeon fight, scaled by enemy difficulty. */
export function combatXpForWin(enemyMaxHp: number): number {
  return 12 + Math.round(enemyMaxHp / 6);
}
