import { create } from 'zustand';
import { supabase } from '../supabaseClient';
import { useGameStore } from '@/store/useGameStore';
import { useAuthStore } from '@/net/auth';
import { sendSystemMessage } from '@/net/party';
import { randomSeed } from '@/engine/rng';
import type { CoopGame, CoopMessage, PlayerSlice } from './protocol';

/**
 * Co-op session lobby/discovery (Phase 3). The `coop_sessions` row holds only the
 * shared seed + host + status; the per-frame world sync runs over Broadcast (see
 * useCoopSession). This module is the data access + the shared client-side store.
 */

export interface CoopSession {
  id: string;
  party_id: string;
  game: CoopGame;
  seed: number;
  host_id: string;
  status: 'lobby' | 'active' | 'ended';
}

interface CoopState {
  /** The active session for my party (if any). */
  session: CoopSession | null;
  /** Whether THIS client has joined the session's run (opened the channel). */
  joined: boolean;
  /** Other players' latest slices, keyed by user_id. */
  remotePlayers: Record<string, PlayerSlice & { lastSeen: number }>;
  /** Set by the transport hook: broadcast a message on the session channel. */
  send: ((msg: CoopMessage) => void) | null;
  /** Transient join/leave toasts shown in the run overlay (auto-expire). */
  notices: { id: number; text: string }[];
}

export const useCoopStore = create<CoopState>(() => ({
  session: null,
  joined: false,
  remotePlayers: {},
  send: null,
  notices: [],
}));

let noticeSeq = 0;

/** Push a transient co-op toast (join/leave); it auto-clears after a few seconds. */
export function pushCoopNotice(text: string): void {
  const id = ++noticeSeq;
  useCoopStore.setState((s) => ({ notices: [...s.notices, { id, text }] }));
  setTimeout(() => {
    useCoopStore.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
  }, 4000);
}

export function setSession(session: CoopSession | null): void {
  useCoopStore.setState({ session });
}

export function setJoined(joined: boolean): void {
  useCoopStore.setState({ joined });
  if (!joined) useCoopStore.setState({ remotePlayers: {} });
}

/** Begin the local run for a co-op game from the shared seed.
 *  Tactics is a no-op here — the host awaits HeroJoin before building the board. */
function beginRun(game: CoopGame, seed: number): void {
  if (game === 'forest') useGameStore.getState().beginForest(seed);
  else if (game === 'mine') useGameStore.getState().beginMining(seed);
  // 'tactics': board is built after HeroJoin (see useTacticsCoopSession).
}

/** Human label for a co-op game. */
export function coopGameName(game: CoopGame): string {
  if (game === 'forest') return 'Wild Forest';
  if (game === 'tactics') return 'Hex Tactics';
  return 'Deep Mine';
}

/** Host a co-op run (mine or forest): create the session with a fresh seed and enter locally. */
export async function startCoop(partyId: string, game: CoopGame): Promise<CoopSession | null> {
  const seed = randomSeed();
  const session = await createCoopSession(partyId, seed, game);
  if (!session) return null;
  setSession(session);
  beginRun(game, seed);
  setJoined(true);
  const username = useAuthStore.getState().username ?? 'A raider';
  void sendSystemMessage(partyId, `${username} started a ${coopGameName(game)} raid`);
  return session;
}

/** Join an existing co-op run: regenerate the host's map from the shared seed. */
export function joinCoop(session: CoopSession): void {
  setSession(session);
  beginRun(session.game, session.seed);
  setJoined(true);
  const username = useAuthStore.getState().username ?? 'A raider';
  void sendSystemMessage(session.party_id, `${username} joined the raid`);
}

/** Leave the co-op run (host also ends the session for everyone). */
export async function leaveCoop(isHost: boolean): Promise<void> {
  const { session, send } = useCoopStore.getState();
  if (session) {
    const place = coopGameName(session.game);
    const username = useAuthStore.getState().username ?? 'A raider';
    const myId = useAuthStore.getState().session?.user?.id ?? 'anon';
    // Snappy departure notice for peers (the stale-player timeout is the fallback).
    send?.({ type: 'bye', userId: myId, username });
    void sendSystemMessage(session.party_id, `${username} has retreated from the ${place}`);
  }
  if (isHost && session) await endCoopSession(session.id);
  setJoined(false);
}

/** The active (lobby/active) co-op session for a party, if one exists. */
export async function getActiveCoopSession(partyId: string): Promise<CoopSession | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('coop_sessions')
    .select('*')
    .eq('party_id', partyId)
    .in('status', ['lobby', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as CoopSession) ?? null;
}

/** Host a new Mine co-op session with a shared seed; returns the row. */
export async function createCoopSession(
  partyId: string,
  seed: number,
  game: CoopGame = 'mine',
): Promise<CoopSession | null> {
  if (!supabase) return null;
  const { data: uid } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('coop_sessions')
    .insert({ party_id: partyId, seed, host_id: uid.user?.id, game, status: 'active', started_at: new Date().toISOString() })
    .select('*')
    .single();
  if (error) {
    console.warn('[coop] createSession failed:', error.message);
    return null;
  }
  return data as CoopSession;
}

/** Host ends the session (e.g. on leaving the run). */
export async function endCoopSession(sessionId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('coop_sessions').update({ status: 'ended' }).eq('id', sessionId);
}
