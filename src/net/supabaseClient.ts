import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isBackendConfigured } from './env';

/**
 * The single Supabase client for the app, or `null` when the backend is not
 * configured (no env vars) — in that case the app runs in pure single-player /
 * localStorage mode and nothing here is touched.
 *
 * `src/net/` is the only layer that imports this. The engine never does; the
 * store calls into `src/net/` rather than reaching for the client directly.
 *
 * `supabase-js` persists the JWT + refresh token to this device's localStorage
 * and auto-refreshes, so a signed-in user stays signed in across reloads.
 */
export const supabase: SupabaseClient | null = isBackendConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // No email links / OAuth redirects in this app (username+password only),
        // so there is no URL session to detect.
        detectSessionInUrl: false,
      },
    })
  : null;

/** Narrowing helper: returns the client or throws if the backend is unconfigured. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  }
  return supabase;
}
