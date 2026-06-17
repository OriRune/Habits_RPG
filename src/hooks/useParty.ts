import { useEffect } from 'react';
import { create } from 'zustand';
import { supabase } from '@/net/supabaseClient';
import { useAuthStore } from '@/net/auth';
import { useGameStore } from '@/store/useGameStore';
import {
  createParty,
  createPartyQuest,
  getActiveQuest,
  getLeaderboard,
  getMembers,
  getMessages,
  getMyParty,
  incrementPartyQuest,
  joinParty,
  kickMember,
  leaveParty,
  renameParty,
  sendMessage,
  type ApiResult,
  type LeaderboardRow,
  type Party,
  type PartyMember,
  type PartyMessage,
  type PartyQuest,
} from '@/net/party';
import type { ChallengeDef } from '@/engine/challenges';

/**
 * Party state + realtime orchestration (Phase 2).
 *
 * `usePartyStore` holds the current party snapshot so any component can read it.
 * `useParty()` is mounted once at the App level (not inside the Party tab) so
 * presence + live updates persist while the user roams other tabs. `partyActions`
 * are the mutation entry points components call.
 */

interface PartyState {
  loading: boolean;
  party: Party | null;
  members: PartyMember[];
  messages: PartyMessage[];
  quest: PartyQuest | null;
  leaderboard: LeaderboardRow[];
  /** Online members keyed by user_id → their current activity label. */
  presence: Record<string, { activity: string }>;
}

const INITIAL: PartyState = {
  loading: true,
  party: null,
  members: [],
  messages: [],
  quest: null,
  leaderboard: [],
  presence: {},
};

export const usePartyStore = create<PartyState>(() => INITIAL);

/** Re-fetch the full party snapshot (party → members → messages → quest → board). */
export async function reloadParty(): Promise<void> {
  const party = await getMyParty();
  if (!party) {
    usePartyStore.setState({ ...INITIAL, loading: false });
    return;
  }
  const [members, messages, quest] = await Promise.all([
    getMembers(party.id),
    getMessages(party.id),
    getActiveQuest(party.id),
  ]);
  const leaderboard = await getLeaderboard(members.map((m) => m.user_id));
  usePartyStore.setState({ loading: false, party, members, messages, quest, leaderboard });
}

export const partyActions = {
  reload: reloadParty,
  create: async (name: string): Promise<ApiResult<Party>> => {
    const r = await createParty(name);
    if (r.ok) await reloadParty();
    return r;
  },
  join: async (code: string): Promise<ApiResult<Party>> => {
    const r = await joinParty(code);
    if (r.ok) await reloadParty();
    return r;
  },
  leave: async (): Promise<void> => {
    const party = usePartyStore.getState().party;
    if (party) await leaveParty(party.id);
    await reloadParty();
  },
  kick: async (userId: string): Promise<void> => {
    const party = usePartyStore.getState().party;
    if (party) await kickMember(party.id, userId);
    await reloadParty();
  },
  rename: async (name: string): Promise<void> => {
    const party = usePartyStore.getState().party;
    if (party) await renameParty(party.id, name);
    await reloadParty();
  },
  send: async (body: string): Promise<void> => {
    const party = usePartyStore.getState().party;
    if (party) await sendMessage(party.id, body); // realtime INSERT appends it
  },
  createQuest: async (def: ChallengeDef, target: number, days: number): Promise<void> => {
    const party = usePartyStore.getState().party;
    if (party) await createPartyQuest(party.id, def, target, days);
    await reloadParty();
  },
};

/** Human-readable current activity, derived from the game store's transient runs. */
function deriveActivity(): string {
  const s = useGameStore.getState();
  if (s.mining) return 'In the Mine';
  if (s.forest) return 'In the Forest';
  if (s.arena) return 'In the Arena';
  if (s.battle) return 'In battle';
  return 'Online';
}

/**
 * Mounted once in App. Loads the party on sign-in and maintains a per-party
 * realtime channel: presence (online + activity), live chat inserts, and live
 * quest-progress updates.
 */
export function useParty(): void {
  const session = useAuthStore((s) => s.session);
  const partyId = usePartyStore((s) => s.party?.id ?? null);

  useEffect(() => {
    if (session) void reloadParty();
    else usePartyStore.setState({ ...INITIAL, loading: false });
  }, [session]);

  useEffect(() => {
    if (!partyId || !supabase) return;
    const sb = supabase; // capture the narrowed (non-null) client for the closures
    const userId = session?.user?.id;
    const username = useAuthStore.getState().username;
    const channel = sb.channel(`party:${partyId}`, {
      config: { presence: { key: userId ?? 'anon' } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, Array<{ activity?: string }>>;
        const presence: Record<string, { activity: string }> = {};
        for (const key of Object.keys(state)) {
          presence[key] = { activity: state[key][0]?.activity ?? 'Online' };
        }
        usePartyStore.setState({ presence });
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'party_messages', filter: `party_id=eq.${partyId}` },
        (payload) => {
          const msg = payload.new as PartyMessage;
          usePartyStore.setState((s) =>
            s.messages.some((m) => m.id === msg.id) ? s : { messages: [...s.messages, msg] },
          );
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'party_quests', filter: `party_id=eq.${partyId}` },
        () => {
          void getActiveQuest(partyId).then((quest) => usePartyStore.setState({ quest }));
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ user_id: userId, username, activity: deriveActivity() });
        }
      });

    // Re-broadcast presence only when the activity label actually changes
    // (the store mutates ~10 Hz in minigames — don't track every tick).
    let lastActivity = deriveActivity();
    const unsub = useGameStore.subscribe(() => {
      const next = deriveActivity();
      if (next !== lastActivity) {
        lastActivity = next;
        void channel.track({ user_id: userId, username, activity: next });
      }
    });

    return () => {
      unsub();
      void sb.removeChannel(channel);
    };
  }, [partyId, session]);
}

/** Sum of net habit completions across all days — monotonic up on each completion. */
function totalCompletions(): number {
  return Object.values(useGameStore.getState().completionLog).reduce((a, b) => a + b, 0);
}

/**
 * Reports habit completions toward the active party quest. Mounted once in App.
 * Counts any completion (the v1 party quest is a 'count' goal); the atomic RPC
 * increments server-side and broadcasts the new progress to all members.
 */
export function usePartyQuestReporter(): void {
  const partyId = usePartyStore((s) => s.party?.id ?? null);
  const questActive = usePartyStore((s) => s.quest?.status === 'active');

  useEffect(() => {
    if (!partyId || !questActive) return;
    let prev = totalCompletions();
    const unsub = useGameStore.subscribe(() => {
      const now = totalCompletions();
      if (now > prev) void incrementPartyQuest(partyId, now - prev);
      prev = now;
    });
    return unsub;
  }, [partyId, questActive]);
}
