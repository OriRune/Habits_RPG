/**
 * Module-scope RNG globals for Deep Mine and Wild Forest runs.
 *
 * Kept outside the Zustand store (and outside the serialized save) so the PRNG
 * state does not bloat localStorage and does not need to survive a page refresh.
 * In co-op play the host seeds these from the session negotiation; every client
 * receives the same seed so their local simulations stay byte-identical.
 *
 * Step 2 of the store slice decomposition: the 4 `let`s that previously lived
 * at module scope in `useGameStore.ts` now live here behind typed accessors.
 * Consumers import the getters/setters; nothing imports this file from `engine/`.
 *
 * Testing note: call `resetRunRng()` in `beforeEach` for any test suite that
 * exercises `beginMining` or `beginForest`, so the module-scope state cannot
 * leak between test cases.
 */
import type { RNG } from '@/engine/crawl';

let _mineRng: RNG = Math.random;
let _mineBaseSeed: number | undefined;
let _forestRng: RNG = Math.random;
let _forestBaseSeed: number | undefined;

// ---- Deep Mine ---------------------------------------------------------------

export function getMineRng(): RNG {
  return _mineRng;
}
export function getMineBaseSeed(): number | undefined {
  return _mineBaseSeed;
}
/** Call from `beginMining` to seed (or reset) the mine RNG stream. */
export function setMineRun(rng: RNG, seed?: number): void {
  _mineRng = rng;
  _mineBaseSeed = seed;
}

// ---- Wild Forest -------------------------------------------------------------

export function getForestRng(): RNG {
  return _forestRng;
}
export function getForestBaseSeed(): number | undefined {
  return _forestBaseSeed;
}
/** Call from `beginForest` to seed (or reset) the forest RNG stream. */
export function setForestRun(rng: RNG, seed?: number): void {
  _forestRng = rng;
  _forestBaseSeed = seed;
}

// ── Test utility ──────────────────────────────────────────────────────────────

/**
 * Restore all four globals to their default values (Math.random / undefined).
 * Call in `beforeEach` for any test suite that exercises beginMining/beginForest
 * so module-scope state cannot leak between test cases.
 */
export function resetRunRng(): void {
  _mineRng = Math.random;
  _mineBaseSeed = undefined;
  _forestRng = Math.random;
  _forestBaseSeed = undefined;
}
