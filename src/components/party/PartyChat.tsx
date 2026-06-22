import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { SectionTitle } from '@/components/ui/Divider';
import { useAuthStore } from '@/net/auth';
import { isSystemMessage, systemMessageText } from '@/net/party';
import { partyActions, usePartyStore } from '@/hooks/useParty';

/** Live party chat: history + a send box. New messages arrive via realtime. */
export function PartyChat() {
  const messages = usePartyStore((s) => s.messages);
  const members = usePartyStore((s) => s.members);
  const myId = useAuthStore((s) => s.session?.user?.id);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const nameFor = (userId: string) =>
    members.find((m) => m.user_id === userId)?.username ?? '???';

  // Keep the latest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft('');
    await partyActions.send(body);
    setSending(false);
  };

  return (
    <Panel tone="parchment" className="flex h-80 flex-col space-y-3 p-4">
      <SectionTitle>Chat</SectionTitle>

      <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <p className="py-4 text-center text-xs italic text-ink-muted">No messages yet — say hello!</p>
        )}
        {messages.map((m) => {
          if (isSystemMessage(m.body)) {
            return (
              <div key={m.id} className="py-0.5 text-center">
                <span className="text-[11px] italic text-ink-muted">{systemMessageText(m.body)}</span>
              </div>
            );
          }
          const mine = m.user_id === myId;
          return (
            <div key={m.id} className={mine ? 'text-right' : 'text-left'}>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gold-deep">
                {mine ? 'You' : nameFor(m.user_id)}
              </span>
              <p
                className={
                  'inline-block max-w-[85%] break-words rounded-md px-2 py-1 text-sm ' +
                  (mine ? 'bg-gold-bright/20 text-ink' : 'bg-wood-900/10 text-ink')
                }
              >
                {m.body}
              </p>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
          placeholder="Message your party…"
          className="flex-1 rounded-md border border-gold-deep/50 bg-parchment-100/80 px-3 py-2 text-sm text-ink placeholder:text-ink-light/60 focus:border-gold-deep focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          aria-label="Send"
          className="rounded-md border border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep px-3 text-wood-900 disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </form>
    </Panel>
  );
}
