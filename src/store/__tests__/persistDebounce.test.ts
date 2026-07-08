/**
 * Regression tests for the trailing-debounce persist storage (ARCH-07).
 *
 * The default persist path JSON.stringified the entire save and wrote localStorage
 * on every accepted store mutation (8–20×/sec during minigame runs). We now coalesce
 * those into a single trailing write per ~1.2 s window. The data-safety contract is:
 *   - a mutation does NOT hit localStorage synchronously (the whole point);
 *   - `flushPersistedSave()` forces the pending write out immediately — this is what
 *     the tab-close (`pagehide`/`visibilitychange`) listeners and cloudSave's
 *     pre-read call rely on, so the last write is never lost;
 *   - `cancelPersistedSave()` drops the queued write WITHOUT flushing — so cloudSave's
 *     authoritative envelope overwrites (pull / keep-cloud / wipe) can't be clobbered
 *     by a late-firing stale write.
 *
 * Without the debounce the first assertion (no synchronous write) fails; without the
 * flush the tab-close guarantee is gone; without cancel the wipe/pull races resurface.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore, createGameStore, flushPersistedSave, cancelPersistedSave } from '../useGameStore';

const KEY = 'habits-rpg-save';

function persistedState(): Record<string, unknown> | null {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw).state as Record<string, unknown>) : null;
}

describe('persist debounce (ARCH-07)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Settle any write queued by import-time hydration or a prior test, then start
    // each test from an empty envelope with no pending timer.
    flushPersistedSave();
    localStorage.clear();
  });

  afterEach(() => {
    cancelPersistedSave();
    vi.useRealTimers();
  });

  it('does not write to localStorage synchronously on a mutation, then lands after the debounce window', () => {
    useGameStore.setState({ reminderCardDismissed: true });

    // The write is trailing-debounced — nothing in storage yet.
    expect(localStorage.getItem(KEY)).toBeNull();

    // After the window elapses the coalesced write lands.
    vi.advanceTimersByTime(1300);
    expect(persistedState()?.reminderCardDismissed).toBe(true);
  });

  it('coalesces a burst of mutations into a single trailing write of the final value', () => {
    for (let i = 0; i < 10; i++) useGameStore.setState({ trialAttemptNonce: i });

    // No mid-burst writes — this is the tick-rate serialize storm ARCH-07 removes.
    expect(localStorage.getItem(KEY)).toBeNull();

    vi.advanceTimersByTime(1300);
    expect(persistedState()?.trialAttemptNonce).toBe(9);
  });

  it('flushPersistedSave writes the pending state immediately (tab-close / pre-cloud-read guarantee)', () => {
    useGameStore.setState({ reminderCardDismissed: true });
    expect(localStorage.getItem(KEY)).toBeNull();

    flushPersistedSave();

    // Landed without advancing timers — the pagehide/visibilitychange listeners and
    // cloudSave's durableEnvelope() rely on exactly this.
    expect(persistedState()?.reminderCardDismissed).toBe(true);
  });

  it('cancelPersistedSave drops the queued write so an authoritative overwrite is not clobbered', () => {
    useGameStore.setState({ trialAttemptNonce: 7 });

    cancelPersistedSave();
    vi.advanceTimersByTime(5000);

    // The debounced write was discarded — storage stays as the caller left it.
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a fresh mutation after a flush schedules a new write (the flush does not disarm future writes)', () => {
    useGameStore.setState({ reminderCardDismissed: true });
    flushPersistedSave();
    expect(persistedState()?.reminderCardDismissed).toBe(true);

    localStorage.clear();
    useGameStore.setState({ trialAttemptNonce: 3 });
    expect(localStorage.getItem(KEY)).toBeNull(); // debounced again
    vi.advanceTimersByTime(1300);
    expect(persistedState()?.trialAttemptNonce).toBe(3);
  });

  // MUST stay last in this describe: it creates a second bound store, which rebinds
  // the module-level flush/cancel exports to that instance. No test may follow it.
  it('registers tab-close flush listeners that land the pending write (pagehide + visibilitychange→hidden)', () => {
    // The node test env has no window/document, so createGameStore(true) normally
    // skips the listeners. Stub minimal EventTargets so the real registration runs,
    // then dispatch the lifecycle events a browser fires when a tab is hidden/closed.
    const realWin = (globalThis as { window?: unknown }).window;
    const realDoc = (globalThis as { document?: unknown }).document;
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    (globalThis as { window?: unknown }).window = win;
    (globalThis as { document?: unknown }).document = doc;
    try {
      localStorage.clear();
      const store = createGameStore(true); // registers pagehide + visibilitychange on the stubs

      // pagehide flushes the buffered write.
      store.setState({ trialAttemptNonce: 42 });
      expect(localStorage.getItem(KEY)).toBeNull(); // still only buffered
      win.dispatchEvent(new Event('pagehide'));
      expect(persistedState()?.trialAttemptNonce).toBe(42);

      // visibilitychange only flushes when the page is actually hidden.
      localStorage.clear();
      store.setState({ trialAttemptNonce: 43 });
      doc.visibilityState = 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
      expect(localStorage.getItem(KEY)).toBeNull(); // still visible → no flush
      doc.visibilityState = 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
      expect(persistedState()?.trialAttemptNonce).toBe(43);
    } finally {
      if (realWin === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = realWin;
      if (realDoc === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = realDoc;
    }
  });
});
