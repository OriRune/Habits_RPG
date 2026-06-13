// Leveling math (design brief Section 4).
// Character level is derived from total XP summed across all stats.
// Pure functions — unit tested against the brief's worked table.

/**
 * XP increment required to go from `level` to `level + 1`.
 * Brief: "XP required for next level = 100 × Level^1.5".
 *
 * Worked table (rounded): 1->100, 2->283, 3->520, 4->800, 5->1118, 10->3162, 20->8944.
 */
export function xpForNextLevel(level: number): number {
  return Math.round(100 * Math.pow(level, 1.5));
}

/**
 * Cumulative total XP needed to *reach* a given level from scratch.
 * Level 1 requires 0 XP; each subsequent level adds xpForNextLevel(prev).
 */
export function cumulativeXpToReach(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) {
    total += xpForNextLevel(l);
  }
  return total;
}

/** Highest level whose cumulative XP requirement is satisfied by `totalXp`. */
export function levelForTotalXp(totalXp: number): number {
  let level = 1;
  while (cumulativeXpToReach(level + 1) <= totalXp) {
    level++;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP earned beyond the start of the current level. */
  intoLevel: number;
  /** XP increment needed to reach the next level. */
  neededForNext: number;
  /** 0..1 progress toward the next level. */
  ratio: number;
}

export function levelProgress(totalXp: number): LevelProgress {
  const level = levelForTotalXp(totalXp);
  const start = cumulativeXpToReach(level);
  const neededForNext = xpForNextLevel(level);
  const intoLevel = totalXp - start;
  return {
    level,
    intoLevel,
    neededForNext,
    ratio: neededForNext > 0 ? intoLevel / neededForNext : 0,
  };
}
