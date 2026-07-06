/**
 * resetGame must reproduce a pristine store exactly. `resetGame`'s reset
 * object is a hand-maintained field list (coreSlice.ts) — this test builds a
 * second, freshly-created store instance as the reference and compares data
 * fields, so any field a future slice adds but resetGame forgets to reset
 * shows up as a mismatch here instead of leaking stale state into new saves
 * (see ARCH-01).
 *
 * `localStorage.clear()` before each `createGameStore()` call matters: both
 * stores persist under the same name, and the polyfill's synchronous
 * getItem makes zustand's persist `hydrate()` run inline during store
 * construction — without clearing, the `reference` store would rehydrate
 * from whatever `store` just wrote, silently mirroring its (possibly buggy)
 * post-reset state instead of the slices' true initial values.
 */
import { describe, it, expect } from 'vitest';
import { createGameStore, type GameState } from '../useGameStore';

/** Strips action functions, keeping only serializable game data for comparison. */
function dataFields(state: GameState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== 'function') out[key] = value;
  }
  return out;
}

describe('resetGame', () => {
  it('deep-equals a freshly created store after heavy mutation', () => {
    localStorage.clear();
    const store = createGameStore();

    // Mutate broadly across slices, including the fields ARCH-01 found leaking.
    store.getState().addHabit({ name: 'Reset test', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'easy' });
    store.getState().completeHabit(store.getState().habits[0].id);
    store.setState((s) => ({
      character: { ...s.character, gold: 999 },
      ownedGear: ['scholars_lantern'],
      equipment: { armor: null, trinket: 'scholars_lantern', tool: null },
      inventory: { herbs: 5 },
      materials: { iron_bar: 3 },
      deepestFloor: 12,
      claimedPartyQuests: ['quest-1'],
      mineTombstone: { floor: 1, haul: { gold: 10 } },
    }));

    store.getState().resetGame();

    localStorage.clear();
    const reference = createGameStore();
    expect(dataFields(store.getState())).toEqual(dataFields(reference.getState()));
  });
});
