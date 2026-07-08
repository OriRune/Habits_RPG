import { create } from 'zustand';
import { supabase } from './supabaseClient';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';
import { useAuthStore } from './auth';
import { useGameStore, flushPersistedSave, cancelPersistedSave, type GameState } from '@/store/useGameStore';
import { useToastStore } from '@/store/useToastStore';
import { selectLevelProgress, selectTopStats, selectTotalXp, selectHabitScore, isHabitDoneToday } from '@/store/selectors';
import type { SharedHabit } from './party';

/**
 * Cloud-save adapter (Phase 1).
 *
 * The high-frequency local cache stays the Zustand `persist` → localStorage path
 * (the store mutates ~10 Hz during minigames). This module adds a SEPARATE,
 * debounced sync to Supabase: it reuses the exact localStorage persist envelope
 * (`{ state, version }`) as the cloud blob, so the client's own versioned
 * `migrate()` runs on pull — the server never migrates.
 *
 * Concurrency: `saves.version` is a compare-and-swap counter (NOT the schema
 * version inside the blob). We remember the version we last pulled and write only
 * if it still matches; on a mismatch another device wrote first, so we re-pull.
 */

const STORAGE_KEY = 'habits-rpg-save';
const OWNER_KEY = 'habits-rpg-owner';
const SYNCED_VERSION_KEY = 'habits-rpg-last-synced-version';
const DIRTY_KEY = 'habits-rpg-dirty';
const DEBOUNCE_MS = 10_000;

/** Which account uid owns the current local save (null = unowned / never signed in). */
function getSaveOwner(): string | null { return localStorage.getItem(OWNER_KEY); }
function setSaveOwner(uid: string): void { localStorage.setItem(OWNER_KEY, uid); }
function clearSaveOwner(): void { localStorage.removeItem(OWNER_KEY); }

/**
 * The CAS version at which local and cloud last agreed, persisted so it survives
 * a relaunch (unlike `lastPulledVersion`). Together with the dirty flag it lets
 * startup detect "cloud is unchanged but local has unsynced progress" and push
 * instead of pulling — otherwise an offline session is silently rolled back.
 */
function getLastSyncedVersion(): number | null {
  const raw = localStorage.getItem(SYNCED_VERSION_KEY);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function setLastSyncedVersion(v: number): void { localStorage.setItem(SYNCED_VERSION_KEY, String(v)); }
function clearLastSyncedVersion(): void { localStorage.removeItem(SYNCED_VERSION_KEY); }

/** Bumped on every store mutation; lets a push clear the dirty flag only when no mutation raced it. */
let dirtyGen = 0;

function isDirty(): boolean { return localStorage.getItem(DIRTY_KEY) !== null; }
function markDirty(): void {
  dirtyGen++;
  localStorage.setItem(DIRTY_KEY, '1');
}
function clearDirty(): void { localStorage.removeItem(DIRTY_KEY); }

// Mark dirty on every mutation from module load — before autosync starts and
// regardless of network state — so the NEXT launch knows local has changes the
// cloud never saw, even if every push this session failed.
if (supabase) {
  useGameStore.subscribe(() => markDirty());
}

// ---- First-sign-in save conflict (MP-06) -------------------------------------

/** What each side holds, shown in the keep-local vs keep-cloud dialog. */
export type SaveConflictSummary = {
  local: { level: number; habitCount: number; lastActiveISO: string | null };
  cloud: { level: number; habitCount: number; lastActiveISO: string | null };
};

/**
 * Pending first-sign-in conflict: this browser has never synced (no owner tag,
 * no sync marker), the local save has real progress, and the account already
 * has a cloud row with real progress. Neither side is applied until the player
 * chooses — closing the tab just re-detects the conflict on the next launch.
 */
export const useSaveConflictStore = create<{ conflict: SaveConflictSummary | null }>(() => ({
  conflict: null,
}));

/** The cloud row held back while the conflict dialog is open. */
let conflictStash: { cloudEnvelope: unknown; cloudVersion: number } | null = null;

function summarizeSaveState(state: Record<string, unknown> | null | undefined) {
  const character = (state?.character ?? null) as { level?: number } | null;
  const habits = state?.habits;
  return {
    level: typeof character?.level === 'number' ? character.level : 1,
    habitCount: Array.isArray(habits) ? habits.length : 0,
    lastActiveISO: typeof state?.lastActiveISO === 'string' ? state.lastActiveISO : null,
  };
}

/** A save worth protecting: the player has leveled up or created any habit. */
function isNonTrivialSummary(s: { level: number; habitCount: number }): boolean {
  return s.level > 1 || s.habitCount > 0;
}

/**
 * Reset the in-memory store to fresh-game state, then remove the localStorage save
 * and the owner tag. Call on sign-out so a shared browser is left clean and the next
 * account always starts from the cloud (or a genuine pristine state). Saves no
 * account ever adopted (null owner) are left untouched — see the body comment.
 */
export function wipeLocalSave(): void {
  // A pending first-sign-in conflict dies with the session — clear it regardless,
  // or a stale conflict would block startAutoSync on the next sign-in.
  conflictStash = null;
  useSaveConflictStore.setState({ conflict: null });
  // An UNOWNED save was never adopted by any account (e.g. the session expired
  // while the first-sign-in conflict dialog was still open). Wiping it here would
  // be MP-06's data loss through a side door — leave it; the next sign-in
  // re-detects and re-raises the choice. (resetGame would also clobber it: the
  // persist middleware immediately rewrites localStorage with the fresh state.)
  if (getSaveOwner() === null) return;
  useGameStore.getState().resetGame();
  // resetGame schedules a trailing-debounced write of the fresh state (ARCH-07);
  // cancel it so the removeItem below stays final and the wiped key is not re-created.
  cancelPersistedSave();
  localStorage.removeItem(STORAGE_KEY);
  clearSaveOwner();
  clearLastSyncedVersion();
  clearDirty();
}

// Transient run objects are not durable — mirror what migrate() nulls.
const TRANSIENT_KEYS = ['battle', 'dungeon', 'mining', 'forest', 'arena', 'tactics'] as const;

type PersistEnvelope = { state: Record<string, unknown>; version: number };

/** The CAS counter from the row we last read/wrote; null = no cloud row yet. */
let lastPulledVersion: number | null = null;

/**
 * Returns true when any transient minigame run is currently in progress.
 * A rehydrate during a live run would overwrite the in-memory board with
 * a stale snapshot, ejecting the player or resetting the match to turn 1.
 */
function hasActiveRun(): boolean {
  const s = useGameStore.getState();
  return !!(s.battle || s.dungeon || s.mining || s.forest || s.arena || s.tactics);
}

function currentUserId(): string | null {
  return useAuthStore.getState().session?.user?.id ?? null;
}

/** Read the localStorage persist envelope and strip transient run objects. */
function durableEnvelope(): PersistEnvelope | null {
  // The persist write is trailing-debounced (ARCH-07); flush any queued write first
  // so the cloud push never ships a stale (up to ~1.2 s old) envelope.
  flushPersistedSave();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  let env: PersistEnvelope;
  try {
    env = JSON.parse(raw) as PersistEnvelope;
  } catch {
    return null;
  }
  if (!env?.state) return null;
  for (const k of TRANSIENT_KEYS) env.state[k] = null;
  return env;
}

function buildPublicSnapshot(s: GameState) {
  const progress = selectLevelProgress(s);
  return {
    username: useAuthStore.getState().username,
    heroName: s.character.name,
    level: s.character.level,
    totalXp: selectTotalXp(s),
    levelProgress01: progress.ratio,
    classId: s.character.classId ?? null,
    topStats: selectTopStats(s).slice(0, 3),
    deepestMineFloor: s.deepestMineFloor ?? 0,
    deepestForestStage: s.deepestForestStage ?? 0,
    deepestArenaTier: s.deepestArenaTier ?? 0,
    deepestTacticsTier: s.deepestTacticsTier ?? 0,
    lastActiveISO: s.lastActiveISO ?? null,
    /** 30-day habit consistency rate (0–100) for the Consistency leaderboard track. */
    habitScore: selectHabitScore(s),
  };
}

/**
 * Pull the cloud save into the live store. Reuses the persist machinery: write the
 * blob to localStorage, then `rehydrate()` so the store's migrate()/merge() run.
 * If no cloud row exists yet and a local save is present, imports local → cloud.
 */
export async function pullCloudSave(): Promise<void> {
  if (!supabase) return;
  // Never rehydrate the store while a minigame run is in progress — it would
  // clobber the live in-memory board with a stale cloud snapshot, resetting or
  // ejecting the player mid-match.  The CAS conflict that triggered this re-pull
  // will be resolved on the next push once the run has finished and the store is safe to overwrite.
  if (hasActiveRun()) return;
  const uid = currentUserId();
  if (!uid) return;

  // If the local save was written by a DIFFERENT account, wipe it before we pull.
  // A null owner means the save is never-signed-in single-player progress: trivial
  // ones are silently adopted by the first account that claims it; ones with real
  // progress raise the MP-06 conflict dialog below instead.
  const owner = getSaveOwner();
  if (owner !== null && owner !== uid) {
    useGameStore.getState().resetGame();
    // The sync markers belonged to the previous owner's save; a fresh account must
    // never see "dirty local at the same version" and push this wiped state upward.
    clearLastSyncedVersion();
    clearDirty();
  }

  const { data, error } = await supabase
    .from('saves')
    .select('state, version')
    .eq('user_id', uid)
    .maybeSingle();

  if (error) {
    console.warn('[cloudSave] pull failed:', error.message);
    return;
  }

  if (data) {
    // Re-check after the network round-trip — a dungeon/mining/arena run may have
    // started while we were awaiting Supabase.  Overwriting localStorage + calling
    // rehydrate() here would clobber the live in-memory board even though merge()
    // tries to preserve it (race: current.dungeon is still null during rehydrate).
    if (hasActiveRun()) return;
    const cloudVersion = data.version as number;
    // Cloud row is exactly what we last synced, but local has unsynced changes
    // (e.g. an offline session whose pushes all failed): pulling would roll those
    // changes back, so push local up instead. A genuinely newer cloud row (another
    // device won a CAS race) never matches lastSyncedVersion and still pulls.
    // If the local envelope is gone (storage evicted) there is nothing to protect —
    // fall through to the pull so the cloud copy is restored.
    if (cloudVersion === getLastSyncedVersion() && isDirty() && durableEnvelope() !== null) {
      lastPulledVersion = cloudVersion;
      // Ownership is stamped by the push's success arm, same as every other path.
      await doPushCloudSave();
      return;
    }
    // First sign-in on this browser (never synced: no owner tag, no sync marker)
    // with real pre-account progress, and the account already has a cloud row —
    // never silently pick a side (MP-06). If the cloud row is a fresh untouched
    // save, keeping local loses nothing, so push local up; otherwise hold both
    // sides and ask the player. Nothing is applied, owned, or stamped until the
    // choice lands, so closing the tab re-raises the choice on the next launch.
    const localEnv = durableEnvelope();
    if (owner === null && getLastSyncedVersion() === null && localEnv !== null) {
      const localSummary = summarizeSaveState(localEnv.state);
      if (isNonTrivialSummary(localSummary)) {
        const cloudEnv = data.state as PersistEnvelope | null;
        const cloudSummary = summarizeSaveState(cloudEnv?.state);
        if (!isNonTrivialSummary(cloudSummary)) {
          lastPulledVersion = cloudVersion;
          // Adoption happens in the push's success arm — a failed push stamps
          // nothing, so the next launch simply retries this branch.
          await doPushCloudSave();
          return;
        }
        conflictStash = { cloudEnvelope: data.state, cloudVersion };
        useSaveConflictStore.setState({ conflict: { local: localSummary, cloud: cloudSummary } });
        return;
      }
    }
    // If this device had synced before AND holds unsynced changes, applying the
    // cloud row ROLLS THOSE CHANGES BACK (another device won the CAS race or
    // wrote while we were offline past our marker). Capture that before the
    // apply — the rehydrate below re-marks dirty — and tell the player after.
    const rolledBack = isDirty() && getLastSyncedVersion() !== null && durableEnvelope() !== null;
    lastPulledVersion = cloudVersion;
    // Drop any queued debounced persist write before we overwrite the envelope with
    // the cloud blob (ARCH-07) — otherwise a late-firing stale write could clobber
    // the freshly-pulled save that rehydrate() is about to read.
    cancelPersistedSave();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data.state));
    await useGameStore.persist.rehydrate();
    // Local now mirrors cloud@cloudVersion (the rehydrate itself marked dirty; undo that).
    setLastSyncedVersion(cloudVersion);
    clearDirty();
    if (rolledBack) {
      useToastStore.getState().pushToast({
        text: 'Another device updated this account — unsynced changes on this device were rolled back.',
        ttlMs: 8000,
      });
    }
  } else {
    // No cloud save yet (new account). The foreign-save guard above already wiped any
    // stale data from a different account; import whatever local state remains (fresh
    // or pristine single-player progress) into this account's cloud row. Stamp
    // ownership only once the import lands — an owner-stamped save that never
    // reached the cloud would be wiped without warning on a non-interactive
    // session loss; unstamped, the next launch just retries the import. (On a
    // 23505 the adoption re-pull stamps ownership itself.)
    lastPulledVersion = null;
    if (!(await doPushCloudSave())) return;
  }
  // Record that this uid now owns the local cache so subsequent pulls / account
  // switches can detect a foreign-owned save and reset before adopting it.
  setSaveOwner(uid);
}

// ---- Push coalescing (MP-26) --------------------------------------------------

/** The push currently on the wire, if any. */
let pushInFlight: Promise<boolean> | null = null;
/** At most one follow-up push queued behind the in-flight one. */
let pushQueued: Promise<boolean> | null = null;

/**
 * Public push entry point. The debounce, 30 s interval, visibility flush, and
 * sign-out flush can fire concurrently, and two overlapping pushes would read
 * the same CAS version — the loser's "conflict" re-pull then rolls back every
 * change made between the two envelope reads, on a single device (MP-26).
 * Callers arriving while a push is on the wire share ONE queued follow-up that
 * re-reads the envelope when it runs, so late mutations still get flushed
 * (the sign-out flush relies on that). Return semantics: see doPushCloudSave.
 */
export function pushCloudSave(): Promise<boolean> {
  if (!pushInFlight) {
    pushInFlight = doPushCloudSave()
      .catch((err) => {
        // Never leave a rejected promise cached — sync would brick until reload.
        console.warn('[cloudSave] push failed:', err);
        return false;
      })
      .finally(() => {
        pushInFlight = null;
      });
    return pushInFlight;
  }
  if (!pushQueued) {
    pushQueued = pushInFlight.then(() => {
      pushQueued = null; // pushInFlight's .finally already cleared it → fresh push
      return pushCloudSave();
    });
  }
  return pushQueued;
}

/**
 * Push the durable save to the cloud with optimistic-concurrency CAS. On a
 * version conflict it re-pulls (the other device's write wins) rather than
 * clobbering. Internal: external callers go through pushCloudSave() above;
 * pullCloudSave's import/keep-local branches call this directly BOTH because
 * they cannot overlap another push (autosync is not armed during them) AND
 * because going through the coalescer from inside an in-flight push (push →
 * conflict re-pull → push) would await our own promise and deadlock.
 *
 * Returns true only when THIS call landed the local envelope in the cloud row —
 * false on any error, missing session, or version conflict (the re-pull adopted
 * the other device's row instead). With no local envelope there is nothing that
 * could be lost, so that path returns true. Callers that destroy local state
 * afterwards (sign-out) must check this instead of assuming the flush worked.
 */
async function doPushCloudSave(): Promise<boolean> {
  if (!supabase) return false;
  const uid = currentUserId();
  if (!uid) return false;
  const env = durableEnvelope();
  if (!env) return true;
  // If a mutation lands while the write is in flight, dirtyGen moves and the
  // dirty flag survives for the next push/launch instead of being lost.
  const genAtRead = dirtyGen;

  const snapshot = buildPublicSnapshot(useGameStore.getState());

  if (lastPulledVersion === null) {
    // First write for this account — insert a fresh row.
    const { error } = await supabase
      .from('saves')
      .insert({ user_id: uid, state: env, version: 1 });
    if (error) {
      // A row already exists (e.g. created on another device between pull and push):
      // adopt it instead of failing.
      if (error.code === '23505') {
        await pullCloudSave();
        return false;
      }
      console.warn('[cloudSave] insert failed:', error.message);
      return false;
    }
    lastPulledVersion = 1;
    setLastSyncedVersion(1);
    // Invariant: owner set ⟺ this account's cloud row contains this save. A
    // deferred first sync (keep-local/import whose immediate push failed but a
    // later autosync push landed) must adopt here, or the save stays unowned —
    // dodging the sign-out wipe and account-switch reset forever.
    if (getSaveOwner() === null) setSaveOwner(uid);
    if (dirtyGen === genAtRead) clearDirty();
  } else {
    const next = lastPulledVersion + 1;
    const { data, error } = await supabase
      .from('saves')
      .update({ state: env, version: next, updated_at: new Date().toISOString() })
      .eq('user_id', uid)
      .eq('version', lastPulledVersion) // compare-and-swap guard
      .select('version');
    if (error) {
      console.warn('[cloudSave] update failed:', error.message);
      return false;
    }
    if (!data || data.length === 0) {
      // Someone else wrote first — adopt their version. There is NO merge: the
      // re-pull REPLACES local state, and pullCloudSave surfaces the rollback
      // notice to the player. If a run is active the re-pull is guard-blocked;
      // the rollback (and its notice) then land on the next successful pull.
      console.info('[cloudSave] version conflict; re-pulling.');
      await pullCloudSave();
      return false;
    }
    lastPulledVersion = next;
    setLastSyncedVersion(next);
    // Same adopt-on-success invariant as the insert arm above.
    if (getSaveOwner() === null) setSaveOwner(uid);
    if (dirtyGen === genAtRead) clearDirty();
  }

  // Piggyback the party-readable snapshot on the same cadence as the save push.
  await supabase
    .from('profiles')
    .update({ public_snapshot: snapshot })
    .eq('id', uid);

  // Push opt-in habit visibility to the party-scoped member_habits table.
  // When the toggle is off, an empty array is upserted so disabling the setting
  // immediately clears shared data for party members (no stale data lingers).
  const gs = useGameStore.getState();
  const habitData: SharedHabit[] = gs.settings.shareHabitNames
    ? gs.habits
        .filter((h) => h.status === 'active')
        .map((h) => ({ name: h.name, streak: h.streak, doneToday: isHabitDoneToday(h) }))
    : [];
  await supabase
    .from('member_habits')
    .upsert({ user_id: uid, habits: habitData, updated_at: new Date().toISOString() });

  return true;
}

/**
 * Apply the player's first-sign-in conflict choice (MP-06). keep-cloud adopts the
 * held-back cloud row exactly like a normal pull; keep-local CAS-pushes the local
 * save over the row it was stashed against. If another device bumped the row while
 * the dialog was open, the push's conflict re-pull re-detects and re-raises the
 * dialog with fresh cloud data instead of guessing.
 */
export async function resolveSaveConflict(choice: 'keep-local' | 'keep-cloud'): Promise<void> {
  const stash = conflictStash;
  conflictStash = null;
  useSaveConflictStore.setState({ conflict: null });
  if (!stash) return;
  const uid = currentUserId();
  if (!uid) return;

  lastPulledVersion = stash.cloudVersion;
  if (choice === 'keep-cloud') {
    // See the pull path: cancel the debounced write before overwriting the envelope.
    cancelPersistedSave();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stash.cloudEnvelope));
    await useGameStore.persist.rehydrate();
    setLastSyncedVersion(stash.cloudVersion);
    clearDirty();
    setSaveOwner(uid);
  } else {
    // Ownership and sync markers are stamped only by a SUCCESSFUL push (its
    // success arm). If this one fails, a later autosync push completes the
    // choice and adopts; if every push fails all session, nothing is stamped
    // and the next launch re-raises the choice rather than pulling the old
    // row over the kept local save.
    await pushCloudSave();
  }
  startAutoSync();
}

// ---- Autosync lifecycle -----------------------------------------------------

let unsubscribeStore: (() => void) | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityHandler: (() => void) | null = null;

function schedulePush(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void pushCloudSave();
  }, DEBOUNCE_MS);
}

/**
 * Foreground re-pull (item 9.4). On `visibilitychange→visible` a resumed phone
 * would otherwise keep showing stale state — `pullCloudSave` runs only at
 * startup/sign-in and on a push CAS conflict, so a backgrounded PWA stays stale
 * until its next push happens to lose the CAS race. Pull the latest cloud row
 * when the app returns to the foreground, but ONLY when local is clean:
 *  - `isDirty()` → skip. Pulling with unsynced local edits would take the
 *    dirty-but-cloud-moved rollback branch inside `pullCloudSave` and surface the
 *    "another device rolled you back" toast for a routine wake (e.g. a habit
 *    ticked offline). That rollback notice must stay reserved for a genuine
 *    multi-device conflict detected by the background push path, not fire just
 *    because the screen woke up. The unsynced edits reach the cloud via the next
 *    debounced/interval push instead.
 *  - a pending first-sign-in conflict → skip (a pull mid-dialog would silently
 *    resolve MP-06 before the player chose), mirroring startAutoSync's guard.
 * `pullCloudSave` itself already no-ops with no session and during an active run.
 */
export function foregroundRepull(): void {
  if (!supabase) return;
  if (isDirty()) return;
  if (useSaveConflictStore.getState().conflict) return;
  void pullCloudSave();
}

/**
 * Durable log-and-lock flush (item 9.5). The `visibilitychange→hidden` flush is
 * the last chance to save a habit logged right before the phone locks, but a
 * plain `await supabase.from('saves').update(...)` is an ordinary fetch a frozen
 * or killed tab can abort mid-flight. This sends the same CAS-guarded `saves`
 * write as `doPushCloudSave`'s update arm, but via a raw `fetch(..., {
 * keepalive: true })` so the browser guarantees delivery even after the tab is
 * discarded. Notes:
 *  - `navigator.sendBeacon` can't set an `Authorization` header, and the `saves`
 *    RLS requires `auth.uid() = user_id`, so beacon can't authenticate — keepalive
 *    fetch is the only viable durable path.
 *  - Chromium caps a keepalive request body at ~64 KiB. A large save would be
 *    rejected outright, so oversized envelopes and the no-known-version /
 *    no-token cases fall back to the ordinary (non-keepalive) `pushCloudSave` —
 *    best-effort, same as before this item.
 *  - Markers (`lastPulledVersion`/synced-version/dirty) are advanced only when the
 *    write's response confirms it landed (`select=version` returns our row). If the
 *    tab is killed before the response arrives the keepalive request still reaches
 *    the server, but our markers stay put; the next sync's CAS re-pull reconciles
 *    (state is identical, so no data is lost — at worst one spurious rollback toast).
 *  - Skips the best-effort `profiles`/`member_habits` piggyback writes to keep the
 *    keepalive payload small and focused on the durable save.
 * Exported so the visibility handler (and tests) can invoke it directly without a
 * DOM `visibilitychange` dispatch.
 */
export function flushOnHide(): void {
  if (!supabase) return;
  const uid = currentUserId();
  if (!uid) return;
  if (!isDirty()) return; // nothing unsynced to flush
  // No known CAS baseline (never pulled this session) → can't build the compare-and-swap
  // guard; fall back to the ordinary insert/update path. Rare on hide (a session has
  // almost always pulled first).
  if (lastPulledVersion === null) {
    void pushCloudSave();
    return;
  }
  const token = useAuthStore.getState().session?.access_token;
  if (!token || !SUPABASE_URL) {
    void pushCloudSave();
    return;
  }
  const env = durableEnvelope();
  if (!env) return;

  const base = lastPulledVersion;
  const next = base + 1;
  const body = JSON.stringify({ state: env, version: next, updated_at: new Date().toISOString() });
  const bytes = typeof Blob !== 'undefined' ? new Blob([body]).size : body.length;
  if (bytes > 60_000) {
    // Over the keepalive cap — the browser would reject it. Best-effort ordinary push.
    void pushCloudSave();
    return;
  }

  const genAtRead = dirtyGen;
  // CAS guard replicated in the query string: only overwrite the row we last saw.
  const url =
    `${SUPABASE_URL}/rest/v1/saves` +
    `?user_id=eq.${uid}&version=eq.${base}&select=version`;
  void fetch(url, {
    method: 'PATCH',
    keepalive: true,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body,
  })
    .then(async (res) => {
      if (!res.ok) return;
      const rows = (await res.json()) as Array<{ version: number }>;
      if (rows.length === 0) return; // CAS conflict — another device won; leave dirty for next pull
      lastPulledVersion = next;
      setLastSyncedVersion(next);
      if (getSaveOwner() === null) setSaveOwner(uid);
      if (dirtyGen === genAtRead) clearDirty();
    })
    .catch(() => {});
}

/** Begin debounced background sync. Call after a successful pull on login. */
export function startAutoSync(): void {
  if (!supabase || unsubscribeStore) return;
  // Never sync while a first-sign-in conflict is unresolved — a debounced push
  // would silently resolve it as keep-local before the player chose.
  if (useSaveConflictStore.getState().conflict) return;

  // Push (debounced) whenever durable state changes.
  unsubscribeStore = useGameStore.subscribe(() => schedulePush());

  // Safety-net periodic flush in case nothing triggered the debounce.
  intervalId = setInterval(() => void pushCloudSave(), DEBOUNCE_MS * 3);

  // Flush when the tab is backgrounded/closed (more reliable than beforeunload).
  // The hidden flush uses a keepalive write (flushOnHide, item 9.5) so a habit
  // logged right before the screen locks survives the tab being frozen/killed.
  // No DOM under the Vitest 'node' environment — skip the visibility flush there.
  if (typeof document !== 'undefined') {
    visibilityHandler = () => {
      if (document.visibilityState === 'hidden') flushOnHide();
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
}

/** Tear down sync (on sign-out). */
export function stopAutoSync(): void {
  unsubscribeStore?.();
  unsubscribeStore = null;
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;
  lastPulledVersion = null;
}
