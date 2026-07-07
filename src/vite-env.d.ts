/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Supabase project URL (Phase 1+). Empty/undefined in pure single-player builds. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase public anon key (Phase 1+). Empty/undefined in pure single-player builds. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
