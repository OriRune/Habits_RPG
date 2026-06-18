// Last Stand trial engine (pure, no React).
// Block incoming wave attacks before they land. Maps to the HP stat.

export const TOTAL_WAVES = 8;
export const ATTACKS_PER_WAVE = 2;
export const WAVE_INTERVAL_MS = 2400;
/** How far ahead (ms) an attack appears on screen before it lands. */
export const SPAWN_AHEAD_MS = 1400;
/** Damage dealt per missed attack. 7 misses survive; 8 kill. */
export const DAMAGE_PER_HIT = 14;
export const STARTING_HP = 100;
/** One-frame grace after landing — covers input lag without being exploitable. */
export const BLOCK_GRACE_MS = 16;

/**
 * Block window (ms before landing) per wave index.
 * Narrows wave 0 → 7 to create a natural difficulty ramp.
 */
export const BLOCK_WINDOW_BY_WAVE: readonly number[] = [750, 720, 690, 660, 620, 580, 540, 500];

export const DIRECTIONS = ['left', 'center', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface Attack {
  id: number;
  dir: Direction;
  /** 0-based wave index; used to look up BLOCK_WINDOW_BY_WAVE. */
  wave: number;
  /** ms from run start when the attack lands. */
  landMs: number;
  result: 'blocked' | 'hit' | null;
}

/**
 * Minimal seeded LCG — same algorithm used across the trial test suite.
 * Pass Date.now() for random production seeds; pass a fixed integer in tests.
 */
export function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

/**
 * Generate the full attack schedule for a run.
 * Each wave always has two attacks with different directions, so every wave
 * presents a genuine two-lane challenge rather than a lucky repeat.
 */
export function generateAttacks(rng: () => number): Attack[] {
  const attacks: Attack[] = [];
  let id = 0;
  for (let wave = 0; wave < TOTAL_WAVES; wave++) {
    const dir0 = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)];
    let dir1: Direction;
    // Re-roll until we get a different direction.
    do { dir1 = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]; } while (dir1 === dir0);

    for (let a = 0; a < ATTACKS_PER_WAVE; a++) {
      const offset = a * (WAVE_INTERVAL_MS / ATTACKS_PER_WAVE);
      attacks.push({
        id: id++,
        dir: a === 0 ? dir0 : dir1,
        wave,
        landMs: wave * WAVE_INTERVAL_MS + offset + SPAWN_AHEAD_MS,
        result: null,
      });
    }
  }
  return attacks;
}

/** Block window (ms) for a given wave index; clamps to the last entry. */
export function blockWindowForWave(wave: number): number {
  return BLOCK_WINDOW_BY_WAVE[Math.min(wave, BLOCK_WINDOW_BY_WAVE.length - 1)];
}

/**
 * Final score: fraction of resolved attacks that were blocked.
 * Uses resolved count as denominator so dying early doesn't penalise future
 * unplayed attacks — only what the player actually faced is counted.
 */
export function lastStandScore(blocked: number, resolved: number): number {
  if (resolved === 0) return 0;
  return Math.min(1, blocked / resolved);
}
