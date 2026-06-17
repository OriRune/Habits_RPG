import { useState } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';
import { signIn, signUp } from '@/net/auth';

/**
 * Sign-in / sign-up gate, shown by App when there is no session (and the backend
 * is configured). Username + password only — no email, no recovery, no OAuth. On
 * success the session listener flips the gate; this view just submits.
 */
export function LoginView() {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result =
      mode === 'signIn' ? await signIn(username, password) : await signUp(username, password);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    if (mode === 'signUp') {
      // With "Confirm email" off, signUp also establishes a session — the gate
      // flips automatically. If a project still requires confirmation, prompt to sign in.
      setNotice('Account created! Signing you in…');
    }
    // Leave `busy` true: the auth listener will swap this view out on success.
  };

  const toggle = () => {
    setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'));
    setError(null);
    setNotice(null);
  };

  return (
    <div className="texture-wood flex min-h-full items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-5">
        <header className="text-center">
          <h1 className="font-display text-3xl font-bold text-gold-bright drop-shadow">HabitsRPG</h1>
          <p className="mt-1 text-sm text-parchment-300">
            {mode === 'signIn' ? 'Welcome back, adventurer.' : 'Begin your legend.'}
          </p>
        </header>

        <Panel tone="parchment" className="space-y-4 p-5">
          <SectionTitle>{mode === 'signIn' ? 'Sign In' : 'Create Account'}</SectionTitle>

          <form onSubmit={submit} className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Username
              </span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={24}
                placeholder="orion"
                className="w-full rounded-md border border-gold-deep/50 bg-parchment-100/80 px-3 py-2 font-display text-ink placeholder:text-ink-light/60 focus:border-gold-deep focus:outline-none"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                placeholder="••••••••"
                className="w-full rounded-md border border-gold-deep/50 bg-parchment-100/80 px-3 py-2 font-display text-ink placeholder:text-ink-light/60 focus:border-gold-deep focus:outline-none"
              />
            </label>

            {error && <p className="text-sm font-semibold text-ember">{error}</p>}
            {notice && <p className="text-sm font-semibold text-jewel-green">{notice}</p>}

            <Button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2">
              {mode === 'signIn' ? <LogIn size={16} /> : <UserPlus size={16} />}
              {busy ? 'Please wait…' : mode === 'signIn' ? 'Sign In' : 'Create Account'}
            </Button>
          </form>

          <p className="text-center text-xs text-ink-muted">
            {mode === 'signIn' ? 'No account yet?' : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={toggle}
              className="font-semibold text-gold-deep underline-offset-2 hover:underline"
            >
              {mode === 'signIn' ? 'Create one' : 'Sign in'}
            </button>
          </p>
        </Panel>

        <p className="text-center text-[11px] text-parchment-300/70">
          No email needed. Your progress syncs to this account across devices.
          <br />
          There is no password recovery — keep it safe.
        </p>
      </div>
    </div>
  );
}
