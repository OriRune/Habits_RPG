// Character progression — how level-ups translate effort into stat points.
//
// Stats no longer derive directly from XP. Instead `statXp` is an effort *ledger* whose
// sum drives the character level (see leveling.ts), and each level-up awards a small pool
// of stat points distributed by *recent* per-stat XP (which stats you trained since the last
// level) plus a nudge toward the character's class. Between level-ups, stat values are frozen.
// Pure + deterministic so it can be unit-tested.
import { STAT_IDS, statPoints, type StatId } from './stats';

/** Stat points granted per character level-up. */
export const POINTS_PER_LEVEL = 3;
/** Maximum value any single stat can reach. */
export const STAT_CAP = 25;
/** Soft cap on character level; XP past this no longer raises the level. */
export const MAX_LEVEL = 50;
/** Reaching this level (or higher) requires winning a trial boss; below it is automatic. */
export const BOSS_GATE_LEVEL = 5;
/** Character level at which dungeons become available. */
export const DUNGEON_UNLOCK_LEVEL = 3;
/** Every stat starts here for a new character. */
export const BASE_STAT_LEVEL = 1;

type StatRecord = Record<StatId, number>;

function zeroStats(): StatRecord {
  return STAT_IDS.reduce((acc, id) => {
    acc[id] = 0;
    return acc;
  }, {} as StatRecord);
}

/** A fresh stat-level record with every stat at the base value. */
export function emptyStatLevels(): StatRecord {
  return STAT_IDS.reduce((acc, id) => {
    acc[id] = BASE_STAT_LEVEL;
    return acc;
  }, {} as StatRecord);
}

/**
 * Derive starting stat levels from an existing XP ledger (persist migration for saves made
 * before the rework). Uses the old sqrt curve so veterans keep their relative power, clamped
 * to the cap and floored at the base so untrained stats match a fresh character.
 */
export function statLevelsFromXp(statXp: StatRecord): StatRecord {
  return STAT_IDS.reduce((acc, id) => {
    acc[id] = Math.max(BASE_STAT_LEVEL, Math.min(STAT_CAP, statPoints(statXp[id])));
    return acc;
  }, {} as StatRecord);
}

/**
 * Distribute `pool` stat points across the stats for a single level-up.
 *
 * Each point goes to the stat with the highest *effective* weight that isn't capped, where the
 * raw weight is recent per-stat XP plus a class nudge. The effective weight divides by the
 * points already given to that stat (Sainte-Laguë style), so a pool spreads proportionally
 * across the trained stats rather than dumping everything into one. Falls back to the class
 * stats — then HP — when there's been no recent stat-specific effort at all.
 */
export function allocateStatGains(
  pool: number,
  xpDelta: StatRecord,
  current: StatRecord,
  classFavored: StatId[],
): StatRecord {
  const gains = zeroStats();

  const totalDelta = STAT_IDS.reduce((sum, s) => sum + Math.max(0, xpDelta[s]), 0);
  const nudge = classFavored.length ? Math.max(15, 0.15 * totalDelta) : 0;

  const weight: StatRecord = STAT_IDS.reduce((acc, s) => {
    acc[s] = Math.max(0, xpDelta[s]) + (classFavored.includes(s) ? nudge : 0);
    return acc;
  }, {} as StatRecord);

  // No recent effort and no class direction: seed a fallback so points still land somewhere.
  if (STAT_IDS.every((s) => weight[s] === 0)) {
    const fallback = classFavored.length ? classFavored : (['HP'] as StatId[]);
    for (const s of fallback) weight[s] = 1;
  }

  for (let i = 0; i < pool; i++) {
    let best: StatId | null = null;
    let bestEff = -1;
    for (const s of STAT_IDS) {
      if (current[s] + gains[s] >= STAT_CAP) continue; // capped
      if (weight[s] <= 0) continue;
      const eff = weight[s] / (2 * gains[s] + 1);
      if (eff > bestEff) {
        bestEff = eff;
        best = s;
      }
    }
    if (!best) break; // everything eligible is capped
    gains[best] += 1;
  }

  return gains;
}
