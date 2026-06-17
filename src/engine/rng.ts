import type { RNG } from './crawl';

/**
 * Seeded pseudo-random generators implementing the engine's `RNG = () => number`
 * contract (a function returning a float in [0, 1)).
 *
 * Co-op needs every client to regenerate the *same* world from a shared seed
 * (static world-gen parity), so the host ships only a 32-bit seed instead of the
 * whole grid. Single-player keeps passing `Math.random` and is unaffected.
 *
 * `mulberry32` is the same tiny, fast generator the engine test suites already
 * used inline — promoted here so production and tests share one implementation.
 */

/** Mulberry32: a fast 32-bit seeded PRNG. Same seed → same sequence on every machine. */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Alias kept for readability at call sites: build an RNG from a numeric seed. */
export const rngFromSeed = mulberry32;

/** A random 32-bit seed (used by the co-op host to start a session). */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
