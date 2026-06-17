/**
 * Typed access to the Vite-injected environment.
 *
 * `src/net/` is the only layer allowed to touch the network / environment — the
 * pure engine never imports from here, and the store calls into `src/net/` rather
 * than reading `import.meta.env` directly. These accessors are scaffolding for
 * Phase 1 (Supabase auth + cloud save); they are unused until then.
 *
 * Values come from `.env.local` in dev (see `.env.example`) and from the host's
 * build-time env vars in CI/production. Only `VITE_`-prefixed vars are exposed to
 * the client bundle by Vite.
 */

/** The Supabase project URL, or `''` if unconfigured. */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? '';

/** The Supabase public anon key, or `''` if unconfigured. */
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/**
 * Whether the backend is configured. When `false`, the app runs in pure
 * single-player / localStorage mode (Phase 0 behavior) and the network layer
 * stays dormant — no client is created, no auth gate is shown.
 */
export const isBackendConfigured = (): boolean =>
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
