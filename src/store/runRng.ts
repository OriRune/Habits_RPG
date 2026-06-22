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
 *
 * Transient co-op ordering state:
 *   `_mineLastWorldT` / `_forestLastWorldT` — high-water marks for the last
 *   accepted world-slice timestamp (host's `performance.now()`). Used by
 *   `acceptMineWorldT` / `acceptForestWorldT` to drop stale/duplicate world
 *   slices. Reset on every `setMineRun`/`setForestRun` (co-op rejoin / run
 *   begin) so a fresh host clock origin is never blocked by an old high-water
 *   mark.
 */
import type { RNG } from '@/engine/crawl';

let _mineRng: RNG = Math.random;
let _mineBaseSeed: number | undefined;
let _mineLastWorldT: number = -Infinity;
let _forestRng: RNG = Math.random;
let _forestBaseSeed: number | undefined;
let _forestLastWorldT: number = -Infinity;

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
  _mineLastWorldT = -Infinity;
}

/**
 * Staleness guard for mine world slices.
 *
 * Returns `true` (accept) when `t` is missing, non-finite, or strictly greater
 * than the last accepted `t`. Returns `false` (drop) when `t` is a finite number
 * `<= _mineLastWorldT`. Accepting a finite `t` advances the high-water mark.
 *
 * Never compares against local `performance.now()` — only against prior
 * host-produced `t` values, which are reliably monotonic within one session.
 */
export function acceptMineWorldT(t: number | undefined): boolean {
  if (t !== undefined && isFinite(t)) {
    if (t <= _mineLastWorldT) return false;
    _mineLastWorldT = t;
  }
  return true;
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
  _forestLastWorldT = -Infinity;
}

/**
 * Staleness guard for forest world slices.
 * Mirrors `acceptMineWorldT` — see that function's doc for the contract.
 */
export function acceptForestWorldT(t: number | undefined): boolean {
  if (t !== undefined && isFinite(t)) {
    if (t <= _forestLastWorldT) return false;
    _forestLastWorldT = t;
  }
  return true;
}

// ── Test utility ──────────────────────────────────────────────────────────────

/**
 * Restore all module-scope globals to their default values.
 * Call in `beforeEach` for any test suite that exercises beginMining/beginForest
 * so module-scope state cannot leak between test cases.
 */
export function resetRunRng(): void {
  _mineRng = Math.random;
  _mineBaseSeed = undefined;
  _mineLastWorldT = -Infinity;
  _forestRng = Math.random;
  _forestBaseSeed = undefined;
  _forestLastWorldT = -Infinity;
}
