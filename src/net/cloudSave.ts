import { supabase } from './supabaseClient';
import { useAuthStore } from './auth';
import { useGameStore, type GameState } from '@/store/useGameStore';
import { selectLevelProgress, selectTopStats, selectTotalXp } from '@/store/selectors';

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
const DEBOUNCE_MS = 10_000;

// Transient run objects are not durable — mirror what migrate() nulls.
const TRANSIENT_KEYS = ['battle', 'dungeon', 'mining', 'forest', 'arena'] as const;

type PersistEnvelope = { state: Record<string, unknown>; version: number };

/** The CAS counter from the row we last read/wrote; null = no cloud row yet. */
let lastPulledVersion: number | null = null;

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
    lastActiveISO: s.lastActiveISO ?? null,
  };
}

/**
 * Pull the cloud save into the live store. Reuses the persist machinery: write the
 * blob to localStorage, then `rehydrate()` so the store's migrate()/merge() run.
 * If no cloud row exists yet and a local save is present, imports local → cloud.
 */
export async function pullCloudSave(): Promise<void> {
  if (!supabase) return;
  const uid = currentUserId();
  if (!uid) return;

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
    lastPulledVersion = data.version as number;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data.state));
    await useGameStore.persist.rehydrate();
  } else {
    // No cloud save yet (new account). Keep local and import it on the next push.
    lastPulledVersion = null;
    await pushCloudSave();
  }
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
  }

  // Piggyback the party-readable snapshot on the same cadence as the save push.
  await supabase
    .from('profiles')
    .update({ public_snapshot: snapshot })
    .eq('id', uid);
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

  // Push (debounced) whenever durable state changes.
  unsubscribeStore = useGameStore.subscribe(() => schedulePush());

  // Safety-net periodic flush in case nothing triggered the debounce.
  intervalId = setInterval(() => void pushCloudSave(), DEBOUNCE_MS * 3);

  // Flush when the tab is backgrounded/closed (more reliable than beforeunload).
  visibilityHandler = () => {
    if (document.visibilityState === 'hidden') void pushCloudSave();
  };
  document.addEventListener('visibilitychange', visibilityHandler);
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
