import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import { isBackendConfigured } from './env';

/**
 * Username + password auth over Supabase Auth, using the synthetic-email pattern:
 * the user only ever types a username, which we map to a deterministic fake email
 * so Supabase has a unique login key. The user never sees this email.
 *
 * No email confirmation, no recovery, no OAuth (project is configured that way).
 */

const SYNTHETIC_EMAIL_DOMAIN = 'habitsrpg.local';

/** Normalize a typed username: trim + lowercase. This is the canonical key. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Map a username to its deterministic synthetic email (the Supabase login key). */
function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/** Basic client-side validation mirroring what a friendly form should enforce. */
export function validateUsername(username: string): string | null {
  const u = normalizeUsername(username);
  if (u.length < 3) return 'Username must be at least 3 characters.';
  if (u.length > 24) return 'Username must be at most 24 characters.';
  if (!/^[a-z0-9_]+$/.test(u)) return 'Use only letters, numbers, and underscores.';
  return null;
}

export type AuthResult = { ok: true } | { ok: false; error: string };

/**
 * Auth/session state, kept OUT of the persisted game store (supabase-js owns its
 * own token storage). Components read `status`/`session` to gate the app.
 */
interface AuthStore {
  /** 'loading' until the initial session check resolves, then signed in/out. */
  status: 'loading' | 'signedIn' | 'signedOut';
  session: Session | null;
  /** Username of the signed-in user (from the synthetic email's local part). */
  username: string | null;
}

export const useAuthStore = create<AuthStore>(() => ({
  status: isBackendConfigured() ? 'loading' : 'signedOut',
  session: null,
  username: null,
}));

function usernameFromSession(session: Session | null): string | null {
  const email = session?.user?.email ?? '';
  const local = email.split('@')[0];
  return local || null;
}

function applySession(session: Session | null): void {
  useAuthStore.setState({
    session,
    username: usernameFromSession(session),
    status: session ? 'signedIn' : 'signedOut',
  });
}

/**
 * Wire the session listener and resolve the initial session. Call once at startup.
 * No-op when the backend is unconfigured (pure single-player mode).
 */
export function initAuth(): void {
  if (!supabase) return;
  supabase.auth.getSession().then(({ data }) => applySession(data.session));
  supabase.auth.onAuthStateChange((_event, session) => applySession(session));
}

export async function signUp(username: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: 'Backend not configured.' };
  const invalid = validateUsername(username);
  if (invalid) return { ok: false, error: invalid };
  if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };

  const normalized = normalizeUsername(username);

  // Friendly pre-check so the user sees "name taken" instead of a raw constraint error.
  const { data: available, error: checkError } = await supabase.rpc('username_available', {
    name: normalized,
  });
  if (checkError) return { ok: false, error: checkError.message };
  if (available === false) return { ok: false, error: 'That username is already taken.' };

  const { error } = await supabase.auth.signUp({
    email: usernameToEmail(username),
    password,
    // The signup trigger reads this to create the profiles row with the username.
    options: { data: { username: normalized } },
  });
  if (error) {
    // Unique-email constraint races the pre-check; surface it cleanly.
    if (/already registered|already exists/i.test(error.message)) {
      return { ok: false, error: 'That username is already taken.' };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function signIn(username: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: 'Backend not configured.' };
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  if (error) {
    // Supabase returns a generic message for bad creds — keep it user-friendly.
    if (/invalid login credentials/i.test(error.message)) {
      return { ok: false, error: 'Wrong username or password.' };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}
