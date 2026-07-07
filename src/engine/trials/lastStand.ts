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
 * MINI-10 anti-mash: an empty block (no attack in the window) locks all lanes for
 * this long. Blind mashing whiffs constantly, so it keeps re-triggering the lockout
 * and misses the real attacks; a player who only blocks when an attack is in flight
 * never whiffs and never trips it. Restores read-then-react.
 */
export const MASH_LOCKOUT_MS = 200;

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
  /** ms from run start when the player blocked (only set when result === 'blocked'). */
  blockedAtMs?: number;
}

// ── Reaction-speed scoring ─────────────────────────────────────────────────────

/**
 * Reaction speed factor (0..1) for a blocked attack.
 * 1.0 = blocked the instant the block window opened (landMs − windowMs).
 * 0.0 = blocked exactly at landing (landMs).
 * `windowMs` is the accept window in effect for the attack (see blockWindowForWave);
 * it defaults to SPAWN_AHEAD_MS so any other caller keeps the original behaviour.
 */
export function reactionSpeed(landMs: number, blockMs: number, windowMs: number = SPAWN_AHEAD_MS): number {
  const margin = landMs - blockMs;
  return Math.max(0, Math.min(1, margin / windowMs));
}

/** Speed threshold for "Perfect!" label — reacted within first third of the window. */
export const REACTION_PERFECT = 0.66;
/** Speed threshold for "Good" label — reacted within second third. Below → "Late". */
export const REACTION_GOOD = 0.33;
export type ReactionRating = 'perfect' | 'good' | 'late';

/** Map a reaction speed factor to a display rating. */
export function reactionRating(speed: number): ReactionRating {
  if (speed >= REACTION_PERFECT) return 'perfect';
  if (speed >= REACTION_GOOD) return 'good';
  return 'late';
}

// ── Anti-mash input gate (MINI-10) ─────────────────────────────────────────────

/**
 * Decide whether a block attempt is accepted, given the running lockout deadline.
 * A whiff (no attack matched) starts a MASH_LOCKOUT_MS window; any attempt while
 * the window is open is rejected — including one that WOULD have matched a real
 * attack, which is the whole point: blind mashing can no longer catch every lane
 * at spawn. Attempts during the window do not extend it (a single early press
 * from an honest player costs one window, not a permanent lock).
 *
 * @param lockoutUntil  elapsed-ms deadline before which input is locked (0 = open)
 * @param el            current elapsed ms
 * @param matched       whether an attack was in this lane's window
 * @returns the accept decision and the updated lockout deadline
 */
export function resolveBlockGate(
  lockoutUntil: number,
  el: number,
  matched: boolean,
): { accept: boolean; lockoutUntil: number } {
  if (el < lockoutUntil) return { accept: false, lockoutUntil };
  if (matched) return { accept: true, lockoutUntil };
  return { accept: false, lockoutUntil: el + MASH_LOCKOUT_MS };
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

/**
 * Block window (ms) for a given wave index; clamps to the last entry.
 * The HP stat widens the window by 20 ms per level (more reaction time), but the
 * result stays capped under SPAWN_AHEAD_MS so the accept window never reverts to
 * the old full-1400ms "block anywhere" behaviour.
 */
export function blockWindowForWave(wave: number, hpLevel = 0): number {
  const base = BLOCK_WINDOW_BY_WAVE[Math.min(wave, BLOCK_WINDOW_BY_WAVE.length - 1)];
  return Math.min(SPAWN_AHEAD_MS, base + hpLevel * 20);
}

/**
 * Final score: mean reaction-speed factor across all resolved attacks.
 * `blockSpeeds` contains a speed value (0..1) for each blocked attack;
 * missed attacks contribute 0 implicitly via the `resolved` denominator.
 * Uses resolved count as denominator so dying early doesn't penalise future
 * unplayed attacks — only what the player actually faced is counted.
 */
export function lastStandScore(blockSpeeds: number[], resolved: number): number {
  if (resolved === 0) return 0;
  const sum = blockSpeeds.reduce((a, b) => a + b, 0);
  return Math.min(1, sum / resolved);
}
