import { create } from 'zustand';
import { supabase } from './supabaseClient';
import { useAuthStore } from './auth';
import { useGameStore, type GameState } from '@/store/useGameStore';
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
      setSaveOwner(uid);
      await pushCloudSave();
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
          await pushCloudSave();
          return;
        }
        conflictStash = { cloudEnvelope: data.state, cloudVersion };
        useSaveConflictStore.setState({ conflict: { local: localSummary, cloud: cloudSummary } });
        return;
      }
    }
    lastPulledVersion = cloudVersion;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data.state));
    await useGameStore.persist.rehydrate();
    // Local now mirrors cloud@cloudVersion (the rehydrate itself marked dirty; undo that).
    setLastSyncedVersion(cloudVersion);
    clearDirty();
  } else {
    // No cloud save yet (new account). The foreign-save guard above already wiped any
    // stale data from a different account; import whatever local state remains (fresh
    // or pristine single-player progress) into this account's cloud row.
    lastPulledVersion = null;
    await pushCloudSave();
  }
  // Record that this uid now owns the local cache so subsequent pulls / account
  // switches can detect a foreign-owned save and reset before adopting it.
  setSaveOwner(uid);
}

/**
 * Push the durable save to the cloud with optimistic-concurrency CAS. Safe to call
 * repeatedly; the autosync debounces it. On a version conflict it re-pulls (the
 * other device's write wins) rather than clobbering.
 */
export async function pushCloudSave(): Promise<void> {
  if (!supabase) return;
  const uid = currentUserId();
  if (!uid) return;
  const env = durableEnvelope();
  if (!env) return;
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
        return;
      }
      console.warn('[cloudSave] insert failed:', error.message);
      return;
    }
    lastPulledVersion = 1;
    setLastSyncedVersion(1);
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
      return;
    }
    if (!data || data.length === 0) {
      // Someone else wrote first — re-pull to adopt their version, then let the
      // next debounce push merged local changes on top.
      console.info('[cloudSave] version conflict; re-pulling.');
      await pullCloudSave();
      return;
    }
    lastPulledVersion = next;
    setLastSyncedVersion(next);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stash.cloudEnvelope));
    await useGameStore.persist.rehydrate();
    setLastSyncedVersion(stash.cloudVersion);
    clearDirty();
    setSaveOwner(uid);
  } else {
    // Sync markers are recorded only by a successful push — if it fails (e.g.
    // offline), nothing is stamped and the next launch re-raises the choice
    // rather than pulling the old row over the kept local save. Ownership is
    // stamped by the next launch's normal pull once the markers exist.
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
  // No DOM under the Vitest 'node' environment — skip the visibility flush there.
  if (typeof document !== 'undefined') {
    visibilityHandler = () => {
      if (document.visibilityState === 'hidden') void pushCloudSave();
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
