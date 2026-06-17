import { useState } from 'react';
import { Plus, LogIn } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';
import { partyActions } from '@/hooks/useParty';

/** Shown when the user isn't in a party: create a new one or join by code. */
export function CreateJoinPanel() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doCreate = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await partyActions.create(name);
    if (!r.ok) setError(r.error);
    setBusy(false);
  };

  const doJoin = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await partyActions.join(code);
    if (!r.ok) setError(r.error);
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <header className="text-center">
        <h1 className="font-display text-2xl font-bold text-gold-bright drop-shadow">Adventuring Party</h1>
        <p className="mt-1 text-sm text-parchment-300">Team up to chat, share quests, and compete.</p>
      </header>

      {error && (
        <p className="rounded-md bg-ember/15 px-3 py-2 text-center text-sm font-semibold text-ember">
          {error}
        </p>
      )}

      <Panel tone="parchment" className="space-y-3 p-5">
        <SectionTitle>Create a Party</SectionTitle>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Party name"
          className="w-full rounded-md border border-gold-deep/50 bg-parchment-100/80 px-3 py-2 font-display text-ink placeholder:text-ink-light/60 focus:border-gold-deep focus:outline-none"
        />
        <Button className="flex w-full items-center justify-center gap-2" disabled={busy} onClick={doCreate}>
          <Plus size={16} /> Create &amp; get invite code
        </Button>
      </Panel>

      <Panel tone="parchment" className="space-y-3 p-5">
        <SectionTitle>Join a Party</SectionTitle>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          placeholder="INVITE CODE"
          className="w-full rounded-md border border-gold-deep/50 bg-parchment-100/80 px-3 py-2 text-center font-display text-lg uppercase tracking-[0.3em] text-ink placeholder:tracking-normal placeholder:text-ink-light/60 focus:border-gold-deep focus:outline-none"
        />
        <Button
          variant="secondary"
          className="flex w-full items-center justify-center gap-2"
          disabled={busy}
          onClick={doJoin}
        >
          <LogIn size={16} /> Join
        </Button>
      </Panel>
    </div>
  );
}
