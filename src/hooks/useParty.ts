import { useEffect } from 'react';
import { create } from 'zustand';
import { supabase } from '@/net/supabaseClient';
import { useAuthStore } from '@/net/auth';
import { useGameStore } from '@/store/useGameStore';
import {
  createParty,
  createPartyQuest,
  getActiveQuest,
  getClaimableQuests,
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
import type { ChallengeDef, ChallengeKind } from '@/engine/challenges';
import type { StatId } from '@/engine/stats';

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

  // Offline catch-up: credit gold for any completed quests the player contributed to
  // but may have missed while offline. claimPartyQuestReward is idempotent on the same id.
  const myId = useAuthStore.getState().session?.user?.id;
  if (myId) {
    const claimable = await getClaimableQuests(party.id, myId);
    const claim = useGameStore.getState().claimPartyQuestReward;
    for (const q of claimable) {
      claim(q.id, members.length);
    }
  }
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
  send: async (body: string): Promise<ApiResult<null>> => {
    const party = usePartyStore.getState().party;
    if (!party) return { ok: false, error: 'no party' };
    return sendMessage(party.id, body); // realtime INSERT appends it
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
    // Depend on the user id, not the session object: TOKEN_REFRESHED (~hourly) mints a
    // new session identity with the same user, which would otherwise re-run the full
    // reload and churn presence/realtime for the whole party (MP-20).
  }, [session?.user?.id]);

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
        (payload) => {
          // Credit gold when the quest flips to completed and this user contributed.
          if (payload.eventType !== 'DELETE') {
            const q = payload.new as PartyQuest;
            if (q.status === 'completed' && userId && (q.contributions?.[userId] ?? 0) > 0) {
              const memberCount = usePartyStore.getState().members.length;
              useGameStore.getState().claimPartyQuestReward(q.id, memberCount);
            }
          }
          void getActiveQuest(partyId).then((quest) => usePartyStore.setState({ quest }));
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'party_members', filter: `party_id=eq.${partyId}` },
        () => {
          // A join/leave/kick changes the roster (and the leaderboard set); pull the
          // full snapshot so every member sees it live instead of only after their own
          // next mutation or the next reload (MP-19).
          void reloadParty();
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
    // Same as above: resubscribing the channel on every hourly token refresh drops
    // realtime messages during the gap — key on the stable user id instead (MP-20).
  }, [partyId, session?.user?.id]);
}

/**
 * Pure helper: compute a monotonically-increasing metric from the provided state
 * based on the party quest kind.
 *
 *  count    — total habit completions across all days (original v1 behaviour)
 *  class    — total completions of habits whose stat matches `questStat`
 *  quantity — total amount logged across all quantity habits (sum of h.log[*].amount)
 *
 * Falls back to `count` for any unrecognised kind.
 * Exported for unit testing without store coupling.
 */
export function computeQuestTotal(
  habits: import('@/engine/habits').Habit[],
  completionLog: Record<string, number>,
  kind: ChallengeKind | null,
  questStat: StatId | null,
): number {
  if (kind === 'class' && questStat) {
    return habits
      .filter((h) => h.stat === questStat)
      .reduce((total, h) => total + Object.keys(h.log).length, 0);
  }
  if (kind === 'quantity') {
    return habits.reduce(
      (total, h) => total + Object.values(h.log).reduce((s, e) => s + (e.amount ?? 0), 0),
      0,
    );
  }
  // 'count' (default): sum of completionLog values across all days.
  return Object.values(completionLog).reduce((a, b) => a + b, 0);
}

/**
 * Read the relevant metric from the current game store based on the quest kind.
 * Used inside usePartyQuestReporter's subscription callback.
 */
export function totalCompletionsByKind(kind: ChallengeKind | null, questStat: StatId | null): number {
  const { habits, completionLog } = useGameStore.getState();
  return computeQuestTotal(habits, completionLog, kind, questStat);
}

/**
 * Delta to report to the party-quest RPC given the previous high-water baseline and
 * the current metric. Only positive movement counts — a decrease (uncompleteHabit)
 * reports nothing (MP-14). Exported for unit testing without store coupling.
 */
export function questDeltaToReport(prev: number, now: number): number {
  return now > prev ? now - prev : 0;
}

/**
 * The next baseline after observing `now`: a high-water mark that never decreases, so
 * a complete→uncomplete→complete cycle reports one net completion, not two (MP-14).
 */
export function nextQuestBaseline(prev: number, now: number): number {
  return Math.max(prev, now);
}

/**
 * Reports habit completions toward the active party quest. Mounted once in App.
 * The delta computation is kind-aware (count / class / quantity), allowing party
 * quests beyond the original v1 'count' kind. The atomic RPC is unchanged —
 * it accepts any integer delta.
 */
export function usePartyQuestReporter(): void {
  const partyId = usePartyStore((s) => s.party?.id ?? null);
  const questActive = usePartyStore((s) => s.quest?.status === 'active');
  const questKind = usePartyStore((s) => (s.quest?.def?.kind as ChallengeKind) ?? null);
  const questStat = usePartyStore((s) => (s.quest?.def?.stat as StatId | undefined) ?? null);

  useEffect(() => {
    if (!partyId || !questActive) return;
    let prev = totalCompletionsByKind(questKind, questStat);
    let hydrating = false;
    // A cloud re-pull (pullCloudSave → persist.rehydrate) replaces the whole store, and
    // the subscribe below fires DURING that setState — before onFinishHydration. Suppress
    // sends while hydrating, then re-baseline to the rehydrated total, so cloud totals
    // ahead of the local baseline aren't miscounted as fresh contributions (MP-14a).
    const unHydrate = useGameStore.persist.onHydrate(() => {
      hydrating = true;
    });
    const unFinish = useGameStore.persist.onFinishHydration(() => {
      prev = totalCompletionsByKind(questKind, questStat);
      hydrating = false;
    });
    const unsub = useGameStore.subscribe(() => {
      if (hydrating) return;
      const now = totalCompletionsByKind(questKind, questStat);
      const delta = questDeltaToReport(prev, now);
      if (delta > 0) void incrementPartyQuest(partyId, delta);
      // High-water mark: an uncomplete lowers `now` but not the baseline (MP-14b).
      prev = nextQuestBaseline(prev, now);
    });
    return () => {
      unHydrate();
      unFinish();
      unsub();
    };
  }, [partyId, questActive, questKind, questStat]);
}
