// Stat system — the 8 attributes from the design brief (Section 5).
// Pure data + helpers, no React.

export type StatId = 'DX' | 'AG' | 'ST' | 'EN' | 'WI' | 'CH' | 'KN' | 'HP';

export interface StatMeta {
  id: StatId;
  name: string;
  short: string;
  represents: string;
  /** Tailwind-safe hex used for bars/badges (mirrors tailwind.config stat colors). */
  color: string;
}

// Ordered as in the brief's class chart (DX, AG, ST, EN, WI, CH, KN, HP).
export const STATS: StatMeta[] = [
  { id: 'DX', name: 'Dexterity', short: 'DEX', represents: 'Precision, craft, accuracy', color: '#f59e0b' },
  { id: 'AG', name: 'Agility', short: 'AGI', represents: 'Speed, evasion, reaction', color: '#22d3ee' },
  { id: 'ST', name: 'Strength', short: 'STR', represents: 'Power, force', color: '#ef4444' },
  { id: 'EN', name: 'Endurance', short: 'END', represents: 'Stamina, persistence', color: '#84cc16' },
  { id: 'WI', name: 'Wisdom', short: 'WIS', represents: 'Insight, healing, defense', color: '#a78bfa' },
  { id: 'CH', name: 'Charisma', short: 'CHA', represents: 'Influence, leadership', color: '#ec4899' },
  { id: 'KN', name: 'Knowledge', short: 'KNO', represents: 'Study, magic, strategy', color: '#3b82f6' },
  { id: 'HP', name: 'Hit Points', short: 'HP', represents: 'Health, resilience', color: '#10b981' },
];

export const STAT_IDS: StatId[] = STATS.map((s) => s.id);

/**
 * The only stats that can ever carry damage: a weapon's `attackStat` is always ST or DX
 * (see content/weapons.ts) and every damage spell is WI school (see engine/spells.ts
 * SCHOOL_STAT). So any affinity content (`weakTo`/`resistTo`) naming a stat outside this
 * set is dead data — combat can never route a hit through it. Content-lint tests assert
 * every boss/enemy affinity array is a subset of DAMAGE_STATS.
 */
export const DAMAGE_STATS: StatId[] = ['ST', 'DX', 'WI'];

const STAT_BY_ID: Record<StatId, StatMeta> = Object.fromEntries(
  STATS.map((s) => [s.id, s]),
) as Record<StatId, StatMeta>;

export function getStat(id: StatId): StatMeta {
  return STAT_BY_ID[id];
}

/** A fresh per-stat XP record with all stats at 0. */
export function emptyStatXP(): Record<StatId, number> {
  return STAT_IDS.reduce(
    (acc, id) => {
      acc[id] = 0;
      return acc;
    },
    {} as Record<StatId, number>,
  );
}

/**
 * Sqrt taper of XP. Retained only for the combat-trained Defense/Ward mitigations
 * (engine/combatStats.ts), which still progress on their own XP. Habit stats now use the
 * level-based values in engine/progression.ts, not this.
 */
export function statPoints(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp)));
}

/** Combined favored-stat power for a stat-check — sum of the favored stats' levels. */
export function statPower(statLevels: Record<StatId, number>, stats: StatId[]): number {
  return stats.reduce((sum, s) => sum + statLevels[s], 0);
}
