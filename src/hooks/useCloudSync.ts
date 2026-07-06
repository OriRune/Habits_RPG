import { useEffect, useRef, useState } from 'react';
import { initAuth, useAuthStore } from '@/net/auth';
import { isBackendConfigured } from '@/net/env';
import { pullCloudSave, startAutoSync, stopAutoSync, wipeLocalSave } from '@/net/cloudSave';
import { syncServerClock } from '@/net/clock';

/**
 * Drives the cloud-save lifecycle off the auth session:
 *  - on startup, wire the Supabase session listener (`initAuth`);
 *  - when a session appears, pull the cloud save then start debounced autosync;
 *  - when it disappears, tear sync down.
 *
 * Returns:
 *  - `cloudReady`: false while the initial pull for the current session is in
 *    flight, true once the store reflects the cloud save (or immediately when
 *    there is no backend). App uses it to avoid flashing the character-creation
 *    screen before the save loads.
 *  - `clockReady`: false until `syncServerClock()` has settled (resolved or
 *    rejected), true immediately when there is no backend. App gates the first
 *    `normalizeHabits`/`checkWeeklyRollover` call on this so the daily/weekly
 *    evaluation always uses server time rather than the raw device clock.
 */
export function useCloudSync(): { cloudReady: boolean; clockReady: boolean } {
  const session = useAuthStore((s) => s.session);
  const syncingFor = useRef<string | null>(null);
  const [cloudReady, setCloudReady] = useState(!isBackendConfigured());
  // Start ready when there is no backend (device clock is all we have anyway).
  const [clockReady, setClockReady] = useState(!isBackendConfigured());

  useEffect(() => {
    initAuth();
    // Sync server clock on mount so all daily gating uses server time.
    // No-op when the backend is unconfigured — clockReady starts true in that case.
    void syncServerClock().finally(() => setClockReady(true));
    // Re-sync when the tab becomes visible and hourly (MP-17): a device-clock
    // change or NTP correction after the mount sync would otherwise shift every
    // daily/weekly boundary 1:1 for the rest of the session — the exact spoof
    // vector the server-clock seam exists to close.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncServerClock();
    };
    document.addEventListener('visibilitychange', onVisible);
    const resyncId = setInterval(() => void syncServerClock(), 60 * 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(resyncId);
    };
  }, []);

  useEffect(() => {
    const uid = session?.user?.id ?? null;
    if (uid && syncingFor.current !== uid) {
      syncingFor.current = uid;
      setCloudReady(false);
      void pullCloudSave()
        .then(startAutoSync)
        .finally(() => setCloudReady(true));
    } else if (!uid && syncingFor.current) {
      syncingFor.current = null;
      stopAutoSync();
      // Clear the local save so a shared browser is left clean and the next
      // sign-in always pulls fresh from the cloud instead of seeing leftover data.
      // SettingsView flushes a final pushCloudSave() before signOut() and warns
      // the user when that flush fails (offline / conflict), so reaching this
      // wipe means either the cloud copy is current or the loss was confirmed.
      // Saves never adopted by any account survive it (see wipeLocalSave).
      wipeLocalSave();
      setCloudReady(!isBackendConfigured());
    }
  }, [session]);

  return { cloudReady, clockReady };
}
