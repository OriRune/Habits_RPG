import { supabase } from './supabaseClient';
import { setClockOffset } from '@/engine/date';

/**
 * Fetch the server's current time via `server_now()` (epoch ms) and cache the
 * offset from device time. One call per session is enough — subsequent `now()`
 * calls in `engine/date.ts` will apply the offset automatically.
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
  setClockOffset(Number(data) - before - rtt / 2);
}
