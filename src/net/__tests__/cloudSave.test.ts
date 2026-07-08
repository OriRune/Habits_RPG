/**
 * Tests for src/net/cloudSave.ts — the compare-and-swap (CAS) cloud-save adapter.
 *
 * Strategy:
 *  - `@/net/supabaseClient` is mocked via vi.mock so the tests never hit the network.
 *  - Mock callables are created with vi.hoisted() so they are available inside the
 *    vi.mock factory (which is hoisted to the top of the compiled output).
 *  - `useAuthStore` is a Zustand store — we set state directly.
 *  - `useGameStore.persist.rehydrate` is spied on / mocked to a no-op.
 *  - `stopAutoSync()` resets the module-private `lastPulledVersion` counter between
 *    test cases (the only clean way without re-importing the module each time).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

// ─── 1. Hoist mock functions so they exist before vi.mock runs ───────────────

const mocks = vi.hoisted(() => {
  // In Vitest 2.x vi.fn takes a single function-type generic.
  /** Configurable response for saves SELECT … .maybeSingle() */
  const maybySingleImpl = vi.fn<() => Promise<{ data: unknown; error: unknown }>>();
  /** Configurable response for saves INSERT (receives the insert payload so tests
   *  can assert the pushed envelope). */
  const insertImpl = vi.fn<(payload?: unknown) => Promise<{ data: unknown; error: unknown }>>();
  /** Configurable response for saves UPDATE … .select('version') */
  const updateSelectImpl = vi.fn<() => Promise<{ data: unknown; error: unknown }>>();
  /** Spy capturing the last eq() arg on the CAS update (so we can assert the guard value). */
  const eqSpy = vi.fn<(col: string, val: unknown) => unknown>();

  return { maybySingleImpl, insertImpl, updateSelectImpl, eqSpy };
});

// ─── 2. Stub the Supabase client BEFORE the module under test is loaded ──────

vi.mock('@/net/supabaseClient', () => {
  // Build a chainable query builder.
  const profilesChain = {
    update: (_payload: unknown) => ({
      eq: (_col: string, _val: unknown) => Promise.resolve({ data: null, error: null }),
    }),
  };

  const savesChain = {
    select: (_cols: string) => ({
      eq: (_col: string, _val: unknown) => ({
        maybeSingle: () => mocks.maybySingleImpl(),
      }),
    }),
    insert: (payload: unknown) => mocks.insertImpl(payload),
    update: (_payload: unknown) => ({
      eq: (_col: string, _val: unknown) => ({
        eq: (col: string, val: unknown) => {
          mocks.eqSpy(col, val);
          return {
            select: (_cols: string) => mocks.updateSelectImpl(),
          };
        },
      }),
    }),
  };

  // Stub for the member_habits upsert added in Stage 5.2.
  const memberHabitsChain = {
    upsert: (_payload: unknown) => Promise.resolve({ data: null, error: null }),
  };

  return {
    supabase: {
      from: (table: string) => {
        if (table === 'profiles') return profilesChain;
        if (table === 'member_habits') return memberHabitsChain;
        return savesChain;
      },
    },
  };
});

// The real env module reads `import.meta.env.VITE_SUPABASE_*`, which is unset in the
// test bundle (both ''), so flushOnHide's raw keepalive REST write (9.5) would always
// hit the empty-URL fallback. Give it concrete values so the keepalive path is testable.
vi.mock('@/net/env', () => ({
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  isBackendConfigured: () => true,
}));

// ─── 3. Now import the modules under test (after mocks are registered) ────────

import {
  pushCloudSave,
  pullCloudSave,
  startAutoSync,
  stopAutoSync,
  wipeLocalSave,
  resolveSaveConflict,
  useSaveConflictStore,
  foregroundRepull,
  flushOnHide,
} from '../cloudSave';
import { useAuthStore } from '../auth';
import { useGameStore, cancelPersistedSave } from '@/store/useGameStore';
import { useToastStore } from '@/store/useToastStore';

// ─── 4. Helpers ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'habits-rpg-save';
const OWNER_KEY = 'habits-rpg-owner';
const SYNCED_VERSION_KEY = 'habits-rpg-last-synced-version';
const DIRTY_KEY = 'habits-rpg-dirty';

/** A minimal valid localStorage persist envelope. */
function makeEnvelope(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    state: {
      character: { name: 'Test', level: 1, statXp: {}, statLevels: {} },
      habits: [],
      ...extra,
    },
    version: 22,
  });
}

/** Set up a signed-in user in the auth store. */
function signIn(userId = 'uid-test') {
  useAuthStore.setState({
    status: 'signedIn',
    session: { user: { id: userId } } as Session,
    username: 'Tester',
  });
}

// ─── 5. Tests ─────────────────────────────────────────────────────────────────

describe('cloudSave', () => {
  beforeEach(() => {
    // Reset the module-private lastPulledVersion = null
    stopAutoSync();

    // Reset mock call history
    mocks.maybySingleImpl.mockReset();
    mocks.insertImpl.mockReset();
    mocks.updateSelectImpl.mockReset();
    mocks.eqSpy.mockReset();

    // Default: no active runs in the game store
    useGameStore.setState({ mining: null, forest: null, arena: null, tactics: null, battle: null, dungeon: null });

    // Sign in
    signIn();

    // Provide a valid save envelope so durableEnvelope() succeeds
    localStorage.setItem(STORAGE_KEY, makeEnvelope());
    // Clear the owner tag so each test starts clean
    localStorage.removeItem(OWNER_KEY);
    // Clear the MP-01 sync markers — the setState above already marked dirty via
    // the module-level subscription, so this must come after it.
    localStorage.removeItem(SYNCED_VERSION_KEY);
    localStorage.removeItem(DIRTY_KEY);
    // Clear any MP-06 conflict left by a prior test — wipeLocalSave clears the
    // module-private conflictStash too (with OWNER_KEY already null it returns
    // before touching the store or STORAGE_KEY).
    wipeLocalSave();
    useSaveConflictStore.setState({ conflict: null });
    // Clear MP-05 rollback notices left by a prior test
    useToastStore.setState({ toasts: [] });

    // Stub out rehydrate so pullCloudSave doesn't try to rehydrate the store
    vi.spyOn(useGameStore.persist, 'rehydrate').mockResolvedValue(undefined);

    // The persist write is now trailing-debounced (ARCH-07); the setState above
    // queued one. Drop it so durableEnvelope()'s flush can't later overwrite the
    // STORAGE_KEY envelope this beforeEach set up directly.
    cancelPersistedSave();
  });

  // ─── durableEnvelope ─────────────────────────────────────────────────────

  describe('durableEnvelope (via pushCloudSave)', () => {
    it('nulls all TRANSIENT_KEYS in the inserted state', async () => {
      // TRANSIENT_KEYS enumerated from cloudSave.ts — every live run object durableEnvelope() nulls.
      const TRANSIENT_KEYS = ['battle', 'dungeon', 'mining', 'forest', 'arena', 'tactics'] as const;

      // Put a save that contains every transient key as a non-null object.
      const envelope = makeEnvelope({
        mining: { floor: 3 },
        forest: { stage: 2 },
        arena: { tier: 1 },
        tactics: { turnCount: 4 },
        battle: { round: 2 },
        dungeon: { depth: 1 },
      });
      localStorage.setItem(STORAGE_KEY, envelope);

      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });

      await pushCloudSave();

      // Capture the payload actually handed to insert — durableEnvelope() strips
      // transients from the in-memory copy before this call. The row's `state`
      // column holds the full persist envelope ({ state, version }), so the game
      // state lives at payload.state.state.
      expect(mocks.insertImpl).toHaveBeenCalledTimes(1);
      const payload = mocks.insertImpl.mock.calls[0][0] as {
        state: { state: Record<string, unknown> };
      };
      for (const k of TRANSIENT_KEYS) {
        expect(payload.state.state[k]).toBeNull();
      }
      // Durable fields survive.
      expect(payload.state.state['character']).toBeTruthy();

      // localStorage itself is only read, never rewritten by the push.
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as { state: Record<string, unknown> };
      expect(parsed.state['mining']).toEqual({ floor: 3 });
    });

    it('strips TRANSIENT_KEYS: if pull adopts remote save, transients are absent on push', async () => {
      // Setup: no local save (so insert fails with no localStorage data edge isn't hit),
      // but instead focus on round-trip: insert succeeds, then pull returns state without
      // transients, which localStorage adopts.
      const remoteState = {
        character: { name: 'Remote', level: 5, statXp: {}, statLevels: {} },
        habits: [],
        mining: null,
        forest: null,
      };
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: remoteState, version: 3 },
        error: null,
      });

      await pullCloudSave();

      // After pull, localStorage should contain the remote state (stringified)
      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!) as { mining: unknown };
      expect(parsed.mining).toBeNull();
    });
  });

  // ─── pushCloudSave — first write (insert path) ───────────────────────────

  describe('pushCloudSave — insert path (lastPulledVersion null)', () => {
    it('inserts with version=1 on the first push', async () => {
      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });

      await pushCloudSave();

      expect(mocks.insertImpl).toHaveBeenCalledTimes(1);
    });

    it('on insert unique-violation (23505) → falls back to pullCloudSave', async () => {
      mocks.insertImpl.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value' },
      });
      // The fallback pull will call maybySingle
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: { character: { name: 'X', level: 1, statXp: {}, statLevels: {} }, habits: [] }, version: 1 },
        error: null,
      });

      await pushCloudSave();

      // Insert was attempted, then pull was triggered (maybySingle called)
      expect(mocks.insertImpl).toHaveBeenCalledTimes(1);
      expect(mocks.maybySingleImpl).toHaveBeenCalledTimes(1);
    });

    it('on non-23505 insert error → logs and returns without pulling', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      mocks.insertImpl.mockResolvedValueOnce({
        data: null,
        error: { code: '42P01', message: 'relation does not exist' },
      });

      await pushCloudSave();

      expect(mocks.insertImpl).toHaveBeenCalledTimes(1);
      expect(mocks.maybySingleImpl).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[cloudSave]'), expect.any(String));

      warnSpy.mockRestore();
    });
  });

  // ─── pushCloudSave — update / CAS path ───────────────────────────────────

  describe('pushCloudSave — update/CAS path (lastPulledVersion set)', () => {
    /** Helper: prime lastPulledVersion = 1 via a successful insert. */
    async function primeLastPulledVersion() {
      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });
      await pushCloudSave();
      mocks.insertImpl.mockReset();
      mocks.updateSelectImpl.mockReset();
    }

    it('CAS succeeds — update with matching version bumps lastPulledVersion', async () => {
      await primeLastPulledVersion();

      mocks.updateSelectImpl.mockResolvedValueOnce({
        data: [{ version: 2 }],
        error: null,
      });

      // Profiles update needs to succeed too
      await pushCloudSave();

      // Update was the path taken (insert not called again)
      expect(mocks.insertImpl).not.toHaveBeenCalled();
      expect(mocks.updateSelectImpl).toHaveBeenCalledTimes(1);
      // The CAS eq guard should have been version=1
      expect(mocks.eqSpy).toHaveBeenCalledWith('version', 1);
    });

    it('CAS conflict — update returns empty data → triggers re-pull', async () => {
      await primeLastPulledVersion();

      // Empty data array = another device wrote first
      mocks.updateSelectImpl.mockResolvedValueOnce({ data: [], error: null });
      // The re-pull calls maybySingle
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: { character: { name: 'OtherDevice', level: 2, statXp: {}, statLevels: {} }, habits: [] }, version: 2 },
        error: null,
      });

      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

      await pushCloudSave();

      expect(mocks.updateSelectImpl).toHaveBeenCalledTimes(1);
      expect(mocks.maybySingleImpl).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('conflict'));

      infoSpy.mockRestore();
    });

    it('CAS conflict — update returns null data → treats as conflict, re-pulls', async () => {
      await primeLastPulledVersion();

      mocks.updateSelectImpl.mockResolvedValueOnce({ data: null, error: null });
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: { character: { name: 'Remote2', level: 3, statXp: {}, statLevels: {} }, habits: [] }, version: 3 },
        error: null,
      });

      await pushCloudSave();

      expect(mocks.maybySingleImpl).toHaveBeenCalledTimes(1);
    });
  });

  // ─── pullCloudSave ────────────────────────────────────────────────────────

  describe('pullCloudSave', () => {
    // The beforeEach local save is TRIVIAL (level 1, no habits) — silently adopting
    // the cloud row is safe and intended. The non-trivial case raises a conflict
    // dialog instead; see the 'first sign-in conflict (MP-06)' block.
    it('applies remote save to localStorage and calls rehydrate (trivial local)', async () => {
      const remoteState = {
        character: { name: 'Cloud', level: 10, statXp: {}, statLevels: {} },
        habits: [],
      };
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: remoteState, version: 5 },
        error: null,
      });

      await pullCloudSave();

      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!) as typeof remoteState;
      expect(parsed).toEqual(remoteState);
      expect(useGameStore.persist.rehydrate).toHaveBeenCalled();
      expect(useSaveConflictStore.getState().conflict).toBeNull();
    });

    it('when no cloud row exists → falls back to pushCloudSave (insert path)', async () => {
      mocks.maybySingleImpl.mockResolvedValueOnce({ data: null, error: null });
      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });

      await pullCloudSave();

      // pull found nothing → insert was triggered
      expect(mocks.insertImpl).toHaveBeenCalledTimes(1);
    });

    it('hasActiveRun() blocks the pull (returns early without network call)', async () => {
      // Simulate a mining run in progress — cast through unknown since we only need a non-null value
      const gs = useGameStore.getState();
      useGameStore.setState({ ...gs, mining: { floor: 3 } as typeof gs.mining });

      await pullCloudSave();

      expect(mocks.maybySingleImpl).not.toHaveBeenCalled();
    });

    it('post-roundtrip hasActiveRun() guard aborts pull if a run starts mid-await', async () => {
      // Before the network call: no active run → guard at cloudSave.ts:109 passes.
      // During the SELECT await: a mining run starts (e.g. user tapped "Enter Mine").
      // After the SELECT resolves: guard at cloudSave.ts:137 fires → no rehydrate.
      const gs = useGameStore.getState();
      mocks.maybySingleImpl.mockImplementationOnce(async () => {
        // Side-effect: inject an active run *inside* the async boundary so the
        // pre-network guard (line 109) passed but the post-roundtrip guard (line 137)
        // will now see an active run.
        useGameStore.setState({ ...gs, mining: { floor: 1 } as typeof gs.mining });
        return {
          data: { state: { character: { name: 'Cloud', level: 1, statXp: {}, statLevels: {} }, habits: [] }, version: 5 },
          error: null,
        };
      });

      await pullCloudSave();

      // SELECT was called (pre-network guard passed), but rehydrate was aborted.
      expect(mocks.maybySingleImpl).toHaveBeenCalledTimes(1);
      expect(useGameStore.persist.rehydrate).not.toHaveBeenCalled();
    });

    it('pull error → logs and returns without rehydrating', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: null,
        error: { message: 'network error' },
      });

      await pullCloudSave();

      expect(useGameStore.persist.rehydrate).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[cloudSave]'), expect.any(String));

      warnSpy.mockRestore();
    });
  });

  // ─── account-switch safety (owner tracking) ──────────────────────────────

  describe('account-switch safety', () => {
    it('wipeLocalSave removes STORAGE_KEY, OWNER_KEY, and the sync markers from localStorage', () => {
      localStorage.setItem(STORAGE_KEY, makeEnvelope());
      localStorage.setItem(OWNER_KEY, 'uid-test');
      localStorage.setItem(SYNCED_VERSION_KEY, '5');
      localStorage.setItem(DIRTY_KEY, '1');

      wipeLocalSave();

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem(OWNER_KEY)).toBeNull();
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBeNull();
      expect(localStorage.getItem(DIRTY_KEY)).toBeNull();
    });

    it('pullCloudSave stamps OWNER_KEY with the current uid after a successful pull', async () => {
      // No prior owner (pristine single-player progress or first sign-in)
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: { character: { name: 'Cloud', level: 1, statXp: {}, statLevels: {} }, habits: [] }, version: 1 },
        error: null,
      });

      await pullCloudSave();

      expect(localStorage.getItem(OWNER_KEY)).toBe('uid-test');
    });

    it('pullCloudSave stamps OWNER_KEY even when no cloud row exists (falls back to push)', async () => {
      // New account — no cloud save yet; pull falls back to insert
      mocks.maybySingleImpl.mockResolvedValueOnce({ data: null, error: null });
      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });

      await pullCloudSave();

      expect(localStorage.getItem(OWNER_KEY)).toBe('uid-test');
    });

    it('foreign-owner guard: resetGame is called when OWNER_KEY belongs to a different user', async () => {
      // A different user's uid is stored as the owner
      localStorage.setItem(OWNER_KEY, 'some-other-user');
      // Spy AFTER beforeEach's setState so we're on the current state object
      const resetSpy = vi.spyOn(useGameStore.getState(), 'resetGame').mockImplementation(() => {});

      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: { character: { name: 'Cloud', level: 1, statXp: {}, statLevels: {} }, habits: [] }, version: 1 },
        error: null,
      });

      await pullCloudSave();

      expect(resetSpy).toHaveBeenCalledTimes(1);
      // Owner is updated to the current authenticated user after the pull
      expect(localStorage.getItem(OWNER_KEY)).toBe('uid-test');

      resetSpy.mockRestore();
    });

    it('same-owner: resetGame is NOT called when OWNER_KEY matches the current uid', async () => {
      localStorage.setItem(OWNER_KEY, 'uid-test'); // same as signIn()
      const resetSpy = vi.spyOn(useGameStore.getState(), 'resetGame').mockImplementation(() => {});

      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: { character: { name: 'Cloud', level: 1, statXp: {}, statLevels: {} }, habits: [] }, version: 1 },
        error: null,
      });

      await pullCloudSave();

      expect(resetSpy).not.toHaveBeenCalled();

      resetSpy.mockRestore();
    });
  });

  // ─── MP-01: startup push-not-pull (offline session must not be rolled back) ─

  describe('startup push-not-pull (MP-01)', () => {
    const remoteData = () => ({
      data: { state: { character: { name: 'StaleCloud', level: 1, statXp: {}, statLevels: {} }, habits: [] }, version: 5 },
      error: null,
    });

    it('dirty local + cloud unchanged since last sync → pushes local instead of pulling', async () => {
      localStorage.setItem(OWNER_KEY, 'uid-test');
      localStorage.setItem(SYNCED_VERSION_KEY, '5');
      localStorage.setItem(DIRTY_KEY, '1'); // offline session left unsynced changes
      const localEnvelope = localStorage.getItem(STORAGE_KEY);

      mocks.maybySingleImpl.mockResolvedValueOnce(remoteData());
      mocks.updateSelectImpl.mockResolvedValueOnce({ data: [{ version: 6 }], error: null });

      await pullCloudSave();

      // The stale cloud row was NOT applied — local survived.
      expect(useGameStore.persist.rehydrate).not.toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEY)).toBe(localEnvelope);
      // A CAS push went up instead, guarded on the matching version.
      expect(mocks.updateSelectImpl).toHaveBeenCalledTimes(1);
      expect(mocks.eqSpy).toHaveBeenCalledWith('version', 5);
      // Successful push advances the marker and clears the dirty flag.
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBe('6');
      expect(localStorage.getItem(DIRTY_KEY)).toBeNull();
    });

    it('dirty local but cloud is NEWER than last sync → still pulls (other device won)', async () => {
      localStorage.setItem(OWNER_KEY, 'uid-test');
      localStorage.setItem(SYNCED_VERSION_KEY, '3'); // cloud moved 3 → 5 on another device
      localStorage.setItem(DIRTY_KEY, '1');

      mocks.maybySingleImpl.mockResolvedValueOnce(remoteData());

      await pullCloudSave();

      expect(useGameStore.persist.rehydrate).toHaveBeenCalled();
      expect(mocks.updateSelectImpl).not.toHaveBeenCalled();
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBe('5');
      expect(localStorage.getItem(DIRTY_KEY)).toBeNull();
    });

    it('cloud unchanged but local NOT dirty → pulls normally', async () => {
      localStorage.setItem(OWNER_KEY, 'uid-test');
      localStorage.setItem(SYNCED_VERSION_KEY, '5');

      mocks.maybySingleImpl.mockResolvedValueOnce(remoteData());

      await pullCloudSave();

      expect(useGameStore.persist.rehydrate).toHaveBeenCalled();
      expect(mocks.updateSelectImpl).not.toHaveBeenCalled();
    });

    it('markers set but local envelope missing → pulls (nothing local to protect)', async () => {
      localStorage.setItem(OWNER_KEY, 'uid-test');
      localStorage.setItem(SYNCED_VERSION_KEY, '5');
      localStorage.setItem(DIRTY_KEY, '1');
      localStorage.removeItem(STORAGE_KEY); // save evicted; sidecars survived

      mocks.maybySingleImpl.mockResolvedValueOnce(remoteData());

      await pullCloudSave();

      // Must restore the cloud copy, not prime a push of a blank save.
      expect(useGameStore.persist.rehydrate).toHaveBeenCalled();
      expect(mocks.updateSelectImpl).not.toHaveBeenCalled();
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(remoteData().data.state);
    });

    it('any store mutation sets the persisted dirty flag (module-level subscription)', () => {
      expect(localStorage.getItem(DIRTY_KEY)).toBeNull();

      useGameStore.setState({ mining: null });

      expect(localStorage.getItem(DIRTY_KEY)).toBe('1');
    });

    it('a failed push leaves the dirty flag and sync marker untouched', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      localStorage.setItem(DIRTY_KEY, '1');

      mocks.insertImpl.mockResolvedValueOnce({
        data: null,
        error: { code: '42P01', message: 'relation does not exist' },
      });

      await pushCloudSave();

      expect(localStorage.getItem(DIRTY_KEY)).toBe('1');
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBeNull();

      warnSpy.mockRestore();
    });

    it('a mutation racing an in-flight push keeps the dirty flag set', async () => {
      // Prime lastPulledVersion = 1 via a successful insert.
      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });
      await pushCloudSave();

      mocks.updateSelectImpl.mockImplementationOnce(async () => {
        // A habit gets logged while the CAS update is on the wire.
        useGameStore.setState({ mining: null });
        return { data: [{ version: 2 }], error: null };
      });

      await pushCloudSave();

      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBe('2');
      expect(localStorage.getItem(DIRTY_KEY)).toBe('1'); // racing change still unsynced
    });

    it('foreign-owner sign-in clears the markers — a wiped save is never pushed over the new account', async () => {
      localStorage.setItem(OWNER_KEY, 'some-other-user');
      localStorage.setItem(SYNCED_VERSION_KEY, '5'); // previous owner's marker matches the cloud row
      localStorage.setItem(DIRTY_KEY, '1');
      const resetSpy = vi.spyOn(useGameStore.getState(), 'resetGame').mockImplementation(() => {});

      mocks.maybySingleImpl.mockResolvedValueOnce(remoteData());

      await pullCloudSave();

      // Pulled the new account's cloud row rather than pushing the reset state up.
      expect(useGameStore.persist.rehydrate).toHaveBeenCalled();
      expect(mocks.updateSelectImpl).not.toHaveBeenCalled();

      resetSpy.mockRestore();
    });
  });

  // ─── MP-06: first sign-in conflict (pre-account progress vs existing row) ──

  describe('first sign-in conflict (MP-06)', () => {
    const nonTrivialLocal = () =>
      makeEnvelope({
        character: { name: 'Local', level: 5, statXp: {}, statLevels: {} },
        lastActiveISO: '2026-07-01',
      });

    const nonTrivialCloudRow = (version = 5) => ({
      data: {
        state: JSON.parse(
          makeEnvelope({
            character: { name: 'Cloud', level: 10, statXp: {}, statLevels: {} },
            lastActiveISO: '2026-07-03',
          }),
        ) as Record<string, unknown>,
        version,
      },
      error: null,
    });

    /** Seed non-trivial local + non-trivial cloud and run the startup pull. */
    async function triggerConflict() {
      const localEnvelope = nonTrivialLocal();
      localStorage.setItem(STORAGE_KEY, localEnvelope);
      const row = nonTrivialCloudRow();
      mocks.maybySingleImpl.mockResolvedValueOnce(row);
      await pullCloudSave();
      return { localEnvelope, row };
    }

    it('real progress on both sides → raises the dialog and applies nothing', async () => {
      const { localEnvelope } = await triggerConflict();

      expect(useGameStore.persist.rehydrate).not.toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEY)).toBe(localEnvelope);
      expect(localStorage.getItem(OWNER_KEY)).toBeNull();
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBeNull();
      expect(mocks.insertImpl).not.toHaveBeenCalled();
      expect(mocks.updateSelectImpl).not.toHaveBeenCalled();
      expect(useSaveConflictStore.getState().conflict).toEqual({
        local: { level: 5, habitCount: 0, lastActiveISO: '2026-07-01' },
        cloud: { level: 10, habitCount: 0, lastActiveISO: '2026-07-03' },
      });
    });

    it('unanswered dialog: a relaunch re-detects the conflict, still applying nothing', async () => {
      const { localEnvelope } = await triggerConflict();
      mocks.maybySingleImpl.mockResolvedValueOnce(nonTrivialCloudRow());

      await pullCloudSave(); // simulated next launch

      expect(useGameStore.persist.rehydrate).not.toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEY)).toBe(localEnvelope);
      expect(useSaveConflictStore.getState().conflict).not.toBeNull();
    });

    it('keep-cloud adopts the held-back cloud row exactly like a normal pull', async () => {
      const { row } = await triggerConflict();

      await resolveSaveConflict('keep-cloud');

      expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(row.data.state));
      expect(useGameStore.persist.rehydrate).toHaveBeenCalled();
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBe('5');
      expect(localStorage.getItem(DIRTY_KEY)).toBeNull();
      expect(localStorage.getItem(OWNER_KEY)).toBe('uid-test');
      expect(useSaveConflictStore.getState().conflict).toBeNull();
      // A user-chosen adoption is not a rollback — no notice.
      expect(useToastStore.getState().toasts).toEqual([]);
    });

    it('keep-local CAS-pushes local over the stashed cloud version', async () => {
      const { localEnvelope } = await triggerConflict();
      mocks.updateSelectImpl.mockResolvedValueOnce({ data: [{ version: 6 }], error: null });

      await resolveSaveConflict('keep-local');

      expect(mocks.updateSelectImpl).toHaveBeenCalledTimes(1);
      expect(mocks.eqSpy).toHaveBeenCalledWith('version', 5);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(localEnvelope);
      expect(useGameStore.persist.rehydrate).not.toHaveBeenCalled();
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBe('6');
      expect(localStorage.getItem(DIRTY_KEY)).toBeNull();
      expect(useSaveConflictStore.getState().conflict).toBeNull();
      // Ownership is stamped because the push landed (MP-07's success signal).
      expect(localStorage.getItem(OWNER_KEY)).toBe('uid-test');
    });

    it('keep-local with a failed push stamps nothing — the choice re-raises next launch', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { localEnvelope } = await triggerConflict();
      mocks.updateSelectImpl.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });

      await resolveSaveConflict('keep-local');

      expect(localStorage.getItem(STORAGE_KEY)).toBe(localEnvelope);
      expect(localStorage.getItem(OWNER_KEY)).toBeNull();
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBeNull();

      warnSpy.mockRestore();
    });

    it('a later successful autosync push completes a failed keep-local — markers AND ownership stamped', async () => {
      // The cross-item drift the phase audit caught: sync markers were stamped by
      // any successful push, but ownership only by the immediate one — leaving a
      // fully-synced, permanently unowned save that dodges the sign-out wipe.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await triggerConflict();
      mocks.updateSelectImpl.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
      await resolveSaveConflict('keep-local'); // immediate push fails; nothing stamped

      // Back online: the next (autosync-style) push lands.
      mocks.updateSelectImpl.mockResolvedValueOnce({ data: [{ version: 6 }], error: null });
      await pushCloudSave();

      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBe('6');
      expect(localStorage.getItem(OWNER_KEY)).toBe('uid-test'); // adopted on success

      warnSpy.mockRestore();
    });

    it('non-trivial local + fresh untouched cloud row → keeps local automatically, no dialog', async () => {
      const localEnvelope = nonTrivialLocal();
      localStorage.setItem(STORAGE_KEY, localEnvelope);
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: JSON.parse(makeEnvelope()) as Record<string, unknown>, version: 5 },
        error: null,
      });
      mocks.updateSelectImpl.mockResolvedValueOnce({ data: [{ version: 6 }], error: null });

      await pullCloudSave();

      expect(useSaveConflictStore.getState().conflict).toBeNull();
      expect(useGameStore.persist.rehydrate).not.toHaveBeenCalled();
      expect(mocks.updateSelectImpl).toHaveBeenCalledTimes(1);
      expect(mocks.eqSpy).toHaveBeenCalledWith('version', 5);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(localEnvelope);
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBe('6');
      expect(localStorage.getItem(OWNER_KEY)).toBe('uid-test'); // stamped on push success
    });

    it('a device that has synced before (marker present) never re-raises the dialog', async () => {
      localStorage.setItem(SYNCED_VERSION_KEY, '6'); // e.g. keep-local push succeeded last session
      localStorage.setItem(STORAGE_KEY, nonTrivialLocal());
      mocks.maybySingleImpl.mockResolvedValueOnce(nonTrivialCloudRow(6));

      await pullCloudSave();

      expect(useSaveConflictStore.getState().conflict).toBeNull();
      expect(useGameStore.persist.rehydrate).toHaveBeenCalled();
    });

    it('session loss while the dialog is pending leaves the unowned local save intact', async () => {
      const { localEnvelope } = await triggerConflict();

      wipeLocalSave(); // what useCloudSync runs on session loss

      // The never-adopted save survives; only the conflict state is cleared so a
      // stale conflict cannot block startAutoSync on the next sign-in.
      expect(localStorage.getItem(STORAGE_KEY)).toBe(localEnvelope);
      expect(useSaveConflictStore.getState().conflict).toBeNull();
    });

    it('autosync stays off while the dialog is pending', async () => {
      await triggerConflict();
      mocks.insertImpl.mockResolvedValue({ data: null, error: null });

      vi.useFakeTimers();
      try {
        startAutoSync();
        useGameStore.setState({ mining: null }); // would schedule a debounced push
        await vi.advanceTimersByTimeAsync(40_000); // past debounce (10s) and interval (30s)
      } finally {
        vi.useRealTimers();
      }

      expect(mocks.insertImpl).not.toHaveBeenCalled();
      expect(mocks.updateSelectImpl).not.toHaveBeenCalled();
    });
  });

  // ─── MP-26: overlapping push triggers coalesce ─────────────────────────────

  describe('push coalescing (MP-26)', () => {
    it('overlapping pushes run sequentially with fresh CAS versions instead of self-conflicting', async () => {
      // Prime lastPulledVersion = 1.
      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });
      await pushCloudSave();

      // First CAS update stays on the wire until the other callers have piled in.
      let releaseFirst!: (v: { data: unknown; error: unknown }) => void;
      mocks.updateSelectImpl.mockImplementationOnce(
        () => new Promise((res) => { releaseFirst = res; }),
      );
      mocks.updateSelectImpl.mockResolvedValueOnce({ data: [{ version: 3 }], error: null });

      const p1 = pushCloudSave();
      const p2 = pushCloudSave();
      const p3 = pushCloudSave();
      expect(p2).toBe(p3); // waiters share one queued follow-up

      releaseFirst({ data: [{ version: 2 }], error: null });
      await expect(p1).resolves.toBe(true);
      await expect(p2).resolves.toBe(true);

      // Two writes total (in-flight + one coalesced trailing), CAS-guarded on
      // version 1 then 2. Pre-fix, all three read version 1 concurrently and the
      // losers' "conflict" re-pulls rolled local state back.
      expect(mocks.updateSelectImpl).toHaveBeenCalledTimes(2);
      expect(mocks.eqSpy.mock.calls).toEqual([
        ['version', 1],
        ['version', 2],
      ]);
      expect(mocks.maybySingleImpl).not.toHaveBeenCalled(); // no conflict re-pull
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBe('3');
    });
  });

  // ─── MP-05: visible rollback notice when another device wins ──────────────

  describe('rollback notice (MP-05)', () => {
    const hasRollbackToast = () =>
      useToastStore.getState().toasts.some((t) => /rolled back/i.test(t.text));

    it('CAS conflict re-pull surfaces the rollback notice', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      // Prime a synced device: insert lands → lastSynced '1', dirty cleared.
      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });
      await pushCloudSave();
      // Local mutation since the sync → dirty.
      useGameStore.setState({ mining: null });
      // Next push loses the CAS race; the re-pull adopts the other device's row.
      mocks.updateSelectImpl.mockResolvedValueOnce({ data: [], error: null });
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: JSON.parse(makeEnvelope()) as Record<string, unknown>, version: 2 },
        error: null,
      });

      await pushCloudSave();

      expect(hasRollbackToast()).toBe(true);
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBe('2');
      expect(localStorage.getItem(DIRTY_KEY)).toBeNull();

      infoSpy.mockRestore();
    });

    it('startup pull that reverts unsynced local progress surfaces the notice', async () => {
      localStorage.setItem(OWNER_KEY, 'uid-test');
      localStorage.setItem(SYNCED_VERSION_KEY, '3'); // synced before…
      localStorage.setItem(DIRTY_KEY, '1'); // …with changes the cloud never saw
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: JSON.parse(makeEnvelope()) as Record<string, unknown>, version: 5 },
        error: null,
      });

      await pullCloudSave();

      expect(hasRollbackToast()).toBe(true);
    });

    it('no notice on a first sign-in adoption (device never synced)', async () => {
      localStorage.setItem(DIRTY_KEY, '1'); // dirty, but no sync marker → nothing of this account reverted
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: JSON.parse(makeEnvelope()) as Record<string, unknown>, version: 5 },
        error: null,
      });

      await pullCloudSave();

      expect(useToastStore.getState().toasts).toEqual([]);
    });

    it('no notice on a clean pull (nothing unsynced to lose)', async () => {
      localStorage.setItem(OWNER_KEY, 'uid-test');
      localStorage.setItem(SYNCED_VERSION_KEY, '3');
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: JSON.parse(makeEnvelope()) as Record<string, unknown>, version: 5 },
        error: null,
      });

      await pullCloudSave();

      expect(useToastStore.getState().toasts).toEqual([]);
    });
  });

  // ─── MP-07: pushCloudSave reports success/failure ─────────────────────────

  describe('pushCloudSave return value (MP-07)', () => {
    it('returns true when the first-write insert lands', async () => {
      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });

      await expect(pushCloudSave()).resolves.toBe(true);
    });

    it('returns false on a non-23505 insert error', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mocks.insertImpl.mockResolvedValueOnce({
        data: null,
        error: { code: '42P01', message: 'relation does not exist' },
      });

      await expect(pushCloudSave()).resolves.toBe(false);

      warnSpy.mockRestore();
    });

    it('returns false on insert 23505 (adopted the concurrent row instead of pushing)', async () => {
      mocks.insertImpl.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value' },
      });
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: JSON.parse(makeEnvelope()) as Record<string, unknown>, version: 1 },
        error: null,
      });

      await expect(pushCloudSave()).resolves.toBe(false);
    });

    it('returns true when the CAS update lands', async () => {
      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });
      await pushCloudSave(); // prime lastPulledVersion = 1
      mocks.updateSelectImpl.mockResolvedValueOnce({ data: [{ version: 2 }], error: null });

      await expect(pushCloudSave()).resolves.toBe(true);
    });

    it('returns false on a CAS version conflict (the other device won)', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });
      await pushCloudSave(); // prime lastPulledVersion = 1
      mocks.updateSelectImpl.mockResolvedValueOnce({ data: [], error: null });
      mocks.maybySingleImpl.mockResolvedValueOnce({
        data: { state: JSON.parse(makeEnvelope()) as Record<string, unknown>, version: 2 },
        error: null,
      });

      await expect(pushCloudSave()).resolves.toBe(false);

      infoSpy.mockRestore();
    });

    it('returns false on a CAS update error', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });
      await pushCloudSave(); // prime lastPulledVersion = 1
      mocks.updateSelectImpl.mockResolvedValueOnce({ data: null, error: { message: 'network error' } });

      await expect(pushCloudSave()).resolves.toBe(false);

      warnSpy.mockRestore();
    });

    it('no-row branch: a failed import insert leaves the save unowned (retries next launch)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mocks.maybySingleImpl.mockResolvedValueOnce({ data: null, error: null });
      mocks.insertImpl.mockResolvedValueOnce({
        data: null,
        error: { code: '42P01', message: 'relation does not exist' },
      });

      await pullCloudSave();

      expect(localStorage.getItem(OWNER_KEY)).toBeNull();
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBeNull();

      warnSpy.mockRestore();
    });

    it('returns true when there is no local envelope (nothing that could be lost)', async () => {
      localStorage.removeItem(STORAGE_KEY);

      await expect(pushCloudSave()).resolves.toBe(true);
      expect(mocks.insertImpl).not.toHaveBeenCalled();
      expect(mocks.updateSelectImpl).not.toHaveBeenCalled();
    });
  });

  // ─── Foreground re-pull (item 9.4) ───────────────────────────────────────
  // pullCloudSave's select() → maybeSingle() (mocks.maybySingleImpl) is the first
  // await in the function, so it fires synchronously when foregroundRepull does not
  // short-circuit — asserting on its call count tells us whether the pull ran.

  describe('foreground re-pull (9.4)', () => {
    it('pulls when local is clean', async () => {
      mocks.maybySingleImpl.mockResolvedValue({ data: null, error: null });
      // No cloud row → the pull imports local via an insert; stub it so the
      // (unawaited) background pull resolves instead of leaving a rejection.
      mocks.insertImpl.mockResolvedValue({ data: null, error: null });
      // beforeEach cleared DIRTY_KEY, so local is clean here.
      foregroundRepull();
      expect(mocks.maybySingleImpl).toHaveBeenCalledTimes(1);
      await new Promise((r) => setTimeout(r, 0)); // let the background pull settle
    });

    it('skips the pull when local is dirty (never rolls back unsynced edits on a wake)', () => {
      localStorage.setItem(DIRTY_KEY, '1');
      mocks.maybySingleImpl.mockResolvedValue({ data: null, error: null });
      foregroundRepull();
      expect(mocks.maybySingleImpl).not.toHaveBeenCalled();
    });

    it('skips the pull while a first-sign-in conflict is pending', () => {
      useSaveConflictStore.setState({
        conflict: {
          local: { level: 1, habitCount: 0, lastActiveISO: null },
          cloud: { level: 2, habitCount: 0, lastActiveISO: null },
        },
      });
      mocks.maybySingleImpl.mockResolvedValue({ data: null, error: null });
      foregroundRepull();
      expect(mocks.maybySingleImpl).not.toHaveBeenCalled();
    });
  });

  // ─── Durable log-and-lock flush (item 9.5) ───────────────────────────────

  describe('durable log-and-lock flush (9.5)', () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));

    /** Seed the module-private lastPulledVersion to 1 via a first-write insert push. */
    async function seedVersion1() {
      mocks.insertImpl.mockResolvedValueOnce({ data: null, error: null });
      await pushCloudSave(); // lastPulledVersion: null → 1; clears dirty; stamps owner
    }

    /** Sign in with an access token so the keepalive REST write can authenticate. */
    function signInWithToken() {
      useAuthStore.setState({
        status: 'signedIn',
        session: { user: { id: 'uid-test' }, access_token: 'test-token' } as Session,
        username: 'Tester',
      });
    }

    it('sends a CAS-guarded keepalive PATCH with the auth headers when dirty', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ version: 2 }] });
      vi.stubGlobal('fetch', fetchMock);
      signInWithToken();
      await seedVersion1();
      localStorage.setItem(DIRTY_KEY, '1'); // a fresh edit made after the last sync

      flushOnHide();

      // fetch fires synchronously (before the response await), so we can assert now.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/rest/v1/saves');
      expect(url).toContain('user_id=eq.uid-test');
      expect(url).toContain('version=eq.1'); // CAS guard = last-pulled version
      expect(url).toContain('select=version');
      expect(opts.method).toBe('PATCH');
      expect(opts.keepalive).toBe(true);
      const headers = opts.headers as Record<string, string>;
      expect(headers.apikey).toBe('anon-key');
      expect(headers.Authorization).toBe('Bearer test-token');
      expect(headers.Prefer).toBe('return=representation');
      const bodyObj = JSON.parse(opts.body as string) as { version: number; state: unknown };
      expect(bodyObj.version).toBe(2); // next = base + 1
      expect(bodyObj.state).toBeTruthy();

      // On a confirming response the markers advance and dirty clears.
      await tick();
      expect(localStorage.getItem(SYNCED_VERSION_KEY)).toBe('2');
      expect(localStorage.getItem(DIRTY_KEY)).toBeNull();

      vi.unstubAllGlobals();
    });

    it('does nothing when local is clean (no unsynced edits)', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ version: 2 }] });
      vi.stubGlobal('fetch', fetchMock);
      signInWithToken();
      await seedVersion1(); // this clears the dirty flag

      flushOnHide();

      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('falls back to the ordinary push for an oversized (>64 KiB) save', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ version: 2 }] });
      vi.stubGlobal('fetch', fetchMock);
      signInWithToken();
      await seedVersion1();
      // A save whose serialized envelope blows past the ~64 KiB keepalive cap.
      localStorage.setItem(STORAGE_KEY, makeEnvelope({ blob: 'x'.repeat(80_000) }));
      localStorage.setItem(DIRTY_KEY, '1');
      mocks.updateSelectImpl.mockResolvedValue({ data: [{ version: 2 }], error: null });

      flushOnHide();

      // No keepalive write; the CAS update path (updateSelectImpl) carries it instead.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.updateSelectImpl).toHaveBeenCalled();
      await tick();
      vi.unstubAllGlobals();
    });
  });
});
