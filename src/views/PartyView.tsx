import { useEffect, useState } from 'react';
import { Copy, Check, Crown, LogOut, UserX, Circle, ChevronDown, ChevronRight } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';
import { Pickaxe, Trees, Swords } from 'lucide-react';
import { useAuthStore } from '@/net/auth';
import { getLeaderboard, type LeaderboardRow } from '@/net/party';
import { partyActions, usePartyStore } from '@/hooks/useParty';
import { joinCoop, startCoop, useCoopStore } from '@/net/coop/session';
import { CreateJoinPanel } from '@/components/party/CreateJoinPanel';
import { PartyChat } from '@/components/party/PartyChat';
import { PartyQuestPanel } from '@/components/party/PartyQuestPanel';

/** Party tab: create/join when partyless, otherwise the full party screen. */
export function PartyView() {
  const loading = usePartyStore((s) => s.loading);
  const party = usePartyStore((s) => s.party);

  if (loading) {
    return <p className="py-10 text-center font-display text-sm text-on-wood-mid">Loading party…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      {party ? <PartyScreen /> : <CreateJoinPanel />}
    </div>
  );
}

function PartyScreen() {
  const party = usePartyStore((s) => s.party)!;
  const members = usePartyStore((s) => s.members);
  const presence = usePartyStore((s) => s.presence);
  const myId = useAuthStore((s) => s.session?.user?.id);
  const isLead = party.owner_id === myId;

  return (
    <div className="space-y-4">
      <header className="text-center">
        <h1 className="font-display text-2xl font-bold text-gold-bright drop-shadow">{party.name}</h1>
        <p className="mt-0.5 text-xs text-on-wood-mid">
          {members.length} / {party.max_members} members
        </p>
      </header>

      {isLead && <LeadControls />}

      <CoopRaidPanel />

      {/* Roster */}
      <Panel tone="parchment" className="space-y-2 p-4">
        <SectionTitle>Roster</SectionTitle>
        {members.map((m) => (
          <RosterMember
            key={m.user_id}
            member={m}
            myId={myId}
            isLead={isLead}
            online={!!presence[m.user_id]}
            activity={presence[m.user_id]?.activity ?? 'Offline'}
          />
        ))}
      </Panel>

      <PartyQuestPanel isLead={isLead} />
      <PartyChat />
      <Leaderboard />

      <Button
        variant="danger"
        className="flex w-full items-center justify-center gap-2"
        onClick={() => {
          if (confirm('Leave this party?')) void partyActions.leave();
        }}
      >
        <LogOut size={16} /> Leave party
      </Button>
    </div>
  );
}

function RosterMember({
  member: m,
  myId,
  isLead,
  online,
  activity,
}: {
  member: ReturnType<typeof usePartyStore.getState>['members'][number];
  myId: string | undefined;
  isLead: boolean;
  online: boolean;
  activity: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasHabits = m.habits.length > 0;

  return (
    <div className="border-b border-gold-deep/15 last:border-0">
      <div className="flex items-center gap-3 py-1.5">
        <Circle
          size={9}
          className={online ? 'fill-jewel-green text-jewel-green' : 'fill-ink-light/40 text-ink-light/40'}
          aria-label={online ? 'online' : 'offline'}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-display text-sm font-bold text-ink">
              {m.username}
              {m.user_id === myId && <span className="text-ink-muted"> (you)</span>}
            </span>
            {m.role === 'owner' && <Crown size={13} className="shrink-0 text-gold-deep" />}
          </div>
          <div className="text-[11px] text-ink-muted">
            Lv {m.snapshot.level ?? 1}
            {m.snapshot.classId ? ` · ${m.snapshot.classId}` : ''} · {online ? activity : 'Offline'}
          </div>
        </div>
        {hasHabits && (
          <button
            onClick={() => setExpanded((x) => !x)}
            className="shrink-0 text-ink-muted hover:text-ink"
            aria-label={expanded ? 'Collapse habits' : 'Show habits'}
          >
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        )}
        {isLead && m.user_id !== myId && (
          <button
            onClick={() => void partyActions.kick(m.user_id)}
            className="shrink-0 text-ink-light hover:text-ember"
            aria-label={`Remove ${m.username}`}
          >
            <UserX size={16} />
          </button>
        )}
      </div>
      {expanded && hasHabits && (
        <div className="mb-2 ml-5 space-y-0.5 rounded-md border border-gold-deep/20 bg-parchment-100/50 p-2">
          {m.habits.map((h, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span
                className={h.doneToday ? 'text-jewel-green' : 'text-ink-muted'}
                title={h.doneToday ? 'Done today' : 'Not yet done'}
              >
                {h.doneToday ? '✓' : '○'}
              </span>
              <span className="flex-1 truncate text-ink">{h.name}</span>
              {h.streak > 0 && (
                <span className="shrink-0 text-ink-muted">🔥 {h.streak}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CoopRaidPanel() {
  const party = usePartyStore((s) => s.party)!;
  const members = usePartyStore((s) => s.members);
  const myId = useAuthStore((s) => s.session?.user?.id);
  const session = useCoopStore((s) => s.session);
  const joined = useCoopStore((s) => s.joined);
  const [busy, setBusy] = useState(false);

  // A live session someone else started that I haven't joined yet.
  const canJoin = session && session.status === 'active' && session.host_id !== myId && !joined;
  const hostName = session ? members.find((m) => m.user_id === session.host_id)?.username : null;
  const gameLabel =
    session?.game === 'forest' ? 'Wild Forest' : session?.game === 'tactics' ? 'Hex Tactics' : 'Deep Mine';
  const GameIcon = session?.game === 'forest' ? Trees : session?.game === 'tactics' ? Swords : Pickaxe;

  return (
    <Panel tone="parchment" className="space-y-3 p-4">
      <SectionTitle>Co-op Raid</SectionTitle>
      {joined ? (
        <p className="text-center text-xs italic text-ink-muted">
          {session?.game === 'tactics'
            ? "You're in a Hex Tactics co-op — the battle window is open."
            : `You're in a ${gameLabel} raid — the run window is open.`}
        </p>
      ) : canJoin ? (
        <div className="space-y-2">
          <p className="text-sm text-ink">
            <span className="font-bold text-gold-deep">{hostName ?? 'A member'}</span>
            {session?.game === 'tactics' ? ` is starting a ${gameLabel} skirmish.` : ` is raiding the ${gameLabel}.`}
          </p>
          <Button
            className="flex w-full items-center justify-center gap-2"
            disabled={busy}
            onClick={() => session && joinCoop(session)}
          >
            <GameIcon size={16} /> {session?.game === 'tactics' ? 'Join the skirmish' : 'Join the raid'}
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs text-ink-muted">
            Start a shared run — everyone dives the same map together in real time.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Button
              className="flex items-center justify-center gap-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await startCoop(party.id, 'mine');
                setBusy(false);
              }}
            >
              <Pickaxe size={16} /> Deep Mine
            </Button>
            <Button
              className="flex items-center justify-center gap-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await startCoop(party.id, 'forest');
                setBusy(false);
              }}
            >
              <Trees size={16} /> Wild Forest
            </Button>
            <Button
              className="flex items-center justify-center gap-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await startCoop(party.id, 'tactics');
                setBusy(false);
              }}
            >
              <Swords size={16} /> Hex Tactics
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

function LeadControls() {
  const party = usePartyStore((s) => s.party)!;
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(party.name);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(party.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is shown for manual copy */
    }
  };

  return (
    <Panel tone="parchment" className="space-y-3 p-4">
      <SectionTitle>Lead Controls</SectionTitle>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-muted">Invite code</span>
        <button
          onClick={copyCode}
          className="flex items-center gap-2 rounded-md border border-gold-deep/50 bg-parchment-100/70 px-3 py-1.5 font-display text-lg font-bold tracking-[0.3em] text-gold-deep hover:bg-parchment-100"
        >
          {party.invite_code}
          {copied ? <Check size={15} className="text-jewel-green" /> : <Copy size={15} />}
        </button>
      </div>

      {renaming ? (
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={40}
            className="flex-1 rounded-md border border-gold-deep/50 bg-parchment-100/80 px-3 py-1.5 text-sm text-ink focus:border-gold-deep focus:outline-none"
          />
          <Button
            onClick={async () => {
              await partyActions.rename(newName);
              setRenaming(false);
            }}
          >
            Save
          </Button>
          <Button variant="secondary" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="secondary" className="w-full" onClick={() => setRenaming(true)}>
          Rename party
        </Button>
      )}
    </Panel>
  );
}

function Leaderboard() {
  const partyBoard = usePartyStore((s) => s.leaderboard);
  const myId = useAuthStore((s) => s.session?.user?.id);
  const [scope, setScope] = useState<'party' | 'global'>('party');
  const [track, setTrack] = useState<'xp' | 'consistency'>('xp');
  const [globalBoard, setGlobalBoard] = useState<LeaderboardRow[]>([]);
  const [globalConsistencyBoard, setGlobalConsistencyBoard] = useState<LeaderboardRow[]>([]);

  useEffect(() => {
    if (scope === 'global' && track === 'xp' && globalBoard.length === 0) {
      void getLeaderboard(undefined, 'xp').then(setGlobalBoard);
    }
    if (scope === 'global' && track === 'consistency' && globalConsistencyBoard.length === 0) {
      void getLeaderboard(undefined, 'consistency').then(setGlobalConsistencyBoard);
    }
  }, [scope, track, globalBoard.length, globalConsistencyBoard.length]);

  // Party boards: sorted client-side by the chosen track (already loaded).
  const sortedPartyBoard =
    track === 'consistency'
      ? [...partyBoard].sort((a, b) => (b.habit_score ?? 0) - (a.habit_score ?? 0))
      : partyBoard;

  const rows =
    scope === 'party'
      ? sortedPartyBoard
      : track === 'consistency'
        ? globalConsistencyBoard
        : globalBoard;

  return (
    <Panel tone="parchment" className="space-y-2 p-4">
      <SectionTitle>Leaderboard</SectionTitle>
      {/* Scope row */}
      <div className="flex gap-2">
        {(['party', 'global'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={
              'flex-1 rounded-md py-1 font-display text-xs uppercase tracking-wider transition-colors ' +
              (scope === s ? 'bg-gold-bright/20 text-gold-deep' : 'text-ink-muted hover:text-ink')
            }
          >
            {s}
          </button>
        ))}
      </div>
      {/* Track row */}
      <div className="flex gap-2">
        {([['xp', 'XP'], ['consistency', 'Consistency']] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTrack(t)}
            className={
              'flex-1 rounded-md py-0.5 font-display text-[11px] uppercase tracking-wider transition-colors ' +
              (track === t ? 'bg-parchment-300/60 text-ink' : 'text-ink-muted/60 hover:text-ink-muted')
            }
          >
            {label}
          </button>
        ))}
      </div>
      <ol className="space-y-1">
        {rows.map((r, i) => (
          <li
            key={r.id}
            className={
              'flex items-center gap-2 text-sm' +
              (r.id === myId ? ' font-semibold' : '')
            }
          >
            <span className="w-5 text-right font-display font-bold tabular-nums text-gold-deep">
              {i + 1}
            </span>
            <span className={`flex-1 truncate ${r.id === myId ? 'text-gold-deep' : 'text-ink'}`}>
              {r.username}
            </span>
            <span className="text-[11px] text-ink-muted">Lv {r.level}</span>
            {track === 'consistency' ? (
              <span className="w-16 text-right tabular-nums text-ink-muted">
                {(r.habit_score ?? 0)}%
              </span>
            ) : (
              <span className="w-16 text-right tabular-nums text-ink-muted">
                {Math.round(r.total_xp).toLocaleString()} XP
              </span>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="py-2 text-center text-xs italic text-ink-muted">No data yet.</li>
        )}
      </ol>
    </Panel>
  );
}
