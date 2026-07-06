import { supabase } from './supabaseClient';
import { setClockOffset } from '@/engine/date';

/**
 * Fetch the server's current time via `server_now()` (epoch ms) and cache the
 * offset from device time — subsequent `now()` calls in `engine/date.ts` apply
 * it automatically. useCloudSync calls this on mount and re-syncs on tab-visible
 * and hourly, so a device-clock change mid-session gets re-anchored (MP-17).
 *
 * No-op when the backend is unconfigured (supabase is null), so single-player
 * behaviour is completely unchanged.
 *
 * `server_now` is granted to `anon`, so this can run before the user signs in.
 */
export async function syncServerClock(): Promise<void> {
  if (!supabase) return;
  const before = Date.now();
  const { data, error } = await supabase.rpc('server_now');
  if (error || data == null) {
    console.warn('[clock] server_now failed:', error?.message);
    return;
  }
  // Compensate for half the round-trip so the offset reflects server time at
  // the midpoint of the request, not the moment we received the response.
  const rtt = Date.now() - before;
  // A malformed payload must never poison the offset (MP-16): a non-numeric
  // value would make now() emit Invalid Dates and persist "NaN-NaN-NaN" keys
  // into every daily/weekly gate, and a falsy coercion ('' / true / []) would
  // yield epoch ~0 and persist "1970-01-01" keys. Coercion (not typeof) because
  // PostgREST may serialize int8 as a JSON string; the floor is Sep 2001 —
  // any real server_now is far above it.
  const serverNow = Number(data);
  if (!Number.isFinite(serverNow) || serverNow < 1e12) {
    console.warn('[clock] server_now returned an implausible payload:', data);
    return;
  }
  setClockOffset(serverNow - before - rtt / 2);
}
