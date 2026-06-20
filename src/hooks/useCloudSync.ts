import { useEffect, useRef, useState } from 'react';
import { initAuth, useAuthStore } from '@/net/auth';
import { isBackendConfigured } from '@/net/env';
import { pullCloudSave, startAutoSync, stopAutoSync } from '@/net/cloudSave';
import { syncServerClock } from '@/net/clock';

/**
 * Drives the cloud-save lifecycle off the auth session:
 *  - on startup, wire the Supabase session listener (`initAuth`);
 *  - when a session appears, pull the cloud save then start debounced autosync;
 *  - when it disappears, tear sync down.
 *
 * Returns `cloudReady`: false while the initial pull for the current session is in
 * flight, true once the store reflects the cloud save (or immediately when there
 * is no backend). App uses it to avoid flashing the character-creation screen — or
 * letting a returning user create a duplicate hero — before the save loads.
 */
export function useCloudSync(): { cloudReady: boolean } {
  const session = useAuthStore((s) => s.session);
  const syncingFor = useRef<string | null>(null);
  const [cloudReady, setCloudReady] = useState(!isBackendConfigured());

  useEffect(() => {
    initAuth();
    // Sync server clock once on mount so all daily gating uses server time.
    // No-op when the backend is unconfigured.
    void syncServerClock();
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
      setCloudReady(!isBackendConfigured());
    }
  }, [session]);

  return { cloudReady };
}
