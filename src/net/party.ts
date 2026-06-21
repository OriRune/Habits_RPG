import { requireSupabase, supabase } from './supabaseClient';
import type { ChallengeDef } from '@/engine/challenges';

/**
 * Party data access (Phase 2). Thin async wrappers over the Supabase RPCs and
 * member-scoped tables defined in 0002_phase2_parties.sql. No realtime here —
 * see useParty() for presence + live subscriptions. UI state lives in the view.
 */

export interface Party {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  max_members: number;
  created_at: string;
}

export interface PartyMemberRow {
  party_id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
}

export interface ProfileSnapshot {
  id: string;
  username: string;
  public_snapshot: {
    heroName?: string;
    level?: number;
    totalXp?: number;
    levelProgress01?: number;
    classId?: string | null;
    topStats?: string[];
    deepestMineFloor?: number;
    deepestForestStage?: number;
    deepestArenaTier?: number;
    deepestTacticsTier?: number;
    lastActiveISO?: string | null;
    /** 30-day habit completion rate (0–100). Added in Stage 5. */
    habitScore?: number;
  };
}

/** A member joined with their public profile snapshot (merged client-side). */
export interface PartyMember extends PartyMemberRow {
  username: string;
  snapshot: ProfileSnapshot['public_snapshot'];
  /** Active habits shared by this member (empty if they haven't opted in). */
  habits: SharedHabit[];
}

export interface PartyMessage {
  id: string;
  party_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export interface PartyQuest {
  id: string;
  party_id: string;
  def: ChallengeDef;
  target: number;
  progress: number;
  status: 'active' | 'completed' | 'expired';
  ends_at: string | null;
  /** Per-user completion contribution counts, keyed by user_id (added in migration 0006). */
  contributions: Record<string, number>;
}

/** One row of a member's habit visibility (published to `member_habits` when opted in). */
export interface SharedHabit {
  name: string;
  streak: number;
  doneToday: boolean;
}

export interface LeaderboardRow {
  id: string;
  username: string;
  level: number;
  total_xp: number;
  deepest_mine: number;
  deepest_forest: number;
  deepest_arena: number;
  /** 30-day habit completion rate (0–100); 0 for users who haven't synced yet. */
  habit_score: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** The single party the current user belongs to (this app caps users at one party). */
export async function getMyParty(): Promise<Party | null> {
  if (!supabase) return null;
  const { data: uid } = await supabase.auth.getUser();
  const userId = uid.user?.id;
  if (!userId) return null;

  const { data: membership } = await supabase
    .from('party_members')
    .select('party_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) return null;

  const { data: party } = await supabase
    .from('parties')
    .select('*')
    .eq('id', membership.party_id)
    .maybeSingle();
  return (party as Party) ?? null;
}

export async function createParty(name: string): Promise<ApiResult<Party>> {
  try {
    const { data, error } = await requireSupabase().rpc('create_party', { p_name: name });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data as Party };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function joinParty(code: string): Promise<ApiResult<Party>> {
  try {
    const { data, error } = await requireSupabase().rpc('join_party', {
      p_code: code.trim().toUpperCase(),
    });
    if (error) return { ok: false, error: friendlyJoinError(error.message) };
    return { ok: true, data: data as Party };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function friendlyJoinError(msg: string): string {
  if (/no party with that code/i.test(msg)) return "No party with that code.";
  if (/already a member/i.test(msg)) return "You're already in this party.";
  if (/party is full/i.test(msg)) return 'That party is full.';
  return msg;
}

export async function leaveParty(partyId: string): Promise<ApiResult<null>> {
  const { error } = await requireSupabase().rpc('leave_party', { p_party: partyId });
  return error ? { ok: false, error: error.message } : { ok: true, data: null };
}

export async function kickMember(partyId: string, userId: string): Promise<ApiResult<null>> {
  const { error } = await requireSupabase().rpc('kick_member', {
    p_party: partyId,
    p_user: userId,
  });
  return error ? { ok: false, error: error.message } : { ok: true, data: null };
}

export async function renameParty(partyId: string, name: string): Promise<ApiResult<null>> {
  const { error } = await requireSupabase()
    .from('parties')
    .update({ name: name.trim() })
    .eq('id', partyId);
  return error ? { ok: false, error: error.message } : { ok: true, data: null };
}

/** Members of a party joined with their public profile snapshots and opt-in habit visibility. */
export async function getMembers(partyId: string): Promise<PartyMember[]> {
  if (!supabase) return [];
  const { data: members } = await supabase
    .from('party_members')
    .select('*')
    .eq('party_id', partyId);
  if (!members || members.length === 0) return [];

  const ids = members.map((m) => (m as PartyMemberRow).user_id);
  const [{ data: profiles }, { data: habitRows }] = await Promise.all([
    supabase.from('profiles').select('id, username, public_snapshot').in('id', ids),
    supabase.from('member_habits').select('user_id, habits').in('user_id', ids),
  ]);

  const byId = new Map((profiles ?? []).map((p) => [p.id, p as ProfileSnapshot]));
  const habitsByUser = new Map(
    ((habitRows ?? []) as { user_id: string; habits: SharedHabit[] }[]).map((r) => [r.user_id, r.habits]),
  );
  return (members as PartyMemberRow[]).map((m) => ({
    ...m,
    username: byId.get(m.user_id)?.username ?? '???',
    snapshot: byId.get(m.user_id)?.public_snapshot ?? {},
    habits: habitsByUser.get(m.user_id) ?? [],
  }));
}

/**
 * Completed party quests that the given user contributed to (offline catch-up).
 * Returns all `completed` quests where the user has a contributions entry.
 */
export async function getClaimableQuests(partyId: string, userId: string): Promise<PartyQuest[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('party_quests')
    .select('*')
    .eq('party_id', partyId)
    .eq('status', 'completed');
  const rows = (data as PartyQuest[]) ?? [];
  return rows.filter((q) => (q.contributions?.[userId] ?? 0) > 0);
}

export async function getMessages(partyId: string, limit = 100): Promise<PartyMessage[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('party_messages')
    .select('*')
    .eq('party_id', partyId)
    .order('created_at', { ascending: true })
    .limit(limit);
  return (data as PartyMessage[]) ?? [];
}

export async function sendMessage(partyId: string, body: string): Promise<ApiResult<null>> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'empty message' };
  const { data: uid } = await requireSupabase().auth.getUser();
  const { error } = await requireSupabase()
    .from('party_messages')
    .insert({ party_id: partyId, user_id: uid.user?.id, body: trimmed.slice(0, 500) });
  return error ? { ok: false, error: error.message } : { ok: true, data: null };
}

/**
 * Zero-width marker that flags a chat row as a system event line (e.g. joins/leaves).
 * Avoids a schema column — the full sentence (incl. the actor's name) is baked into
 * the body so existing members don't need a fresh member list to render it.
 */
export const SYSTEM_MSG_PREFIX = '​';

export function isSystemMessage(body: string): boolean {
  return body.startsWith(SYSTEM_MSG_PREFIX);
}

export function systemMessageText(body: string): string {
  return body.slice(SYSTEM_MSG_PREFIX.length);
}

/** Post a system event line (e.g. "Orion has joined the party"), authored by the acting user. */
export async function sendSystemMessage(partyId: string, text: string): Promise<void> {
  if (!supabase) return;
  const { data: uid } = await supabase.auth.getUser();
  await supabase
    .from('party_messages')
    .insert({ party_id: partyId, user_id: uid.user?.id, body: (SYSTEM_MSG_PREFIX + text).slice(0, 500) });
}

export async function getActiveQuest(partyId: string): Promise<PartyQuest | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('party_quests')
    .select('*')
    .eq('party_id', partyId)
    .eq('status', 'active')
    .maybeSingle();
  return (data as PartyQuest) ?? null;
}

export async function createPartyQuest(
  partyId: string,
  def: ChallengeDef,
  target: number,
  days: number,
): Promise<ApiResult<PartyQuest>> {
  const { data, error } = await requireSupabase().rpc('create_party_quest', {
    p_party: partyId,
    p_def: def,
    p_target: target,
    p_days: days,
  });
  return error ? { ok: false, error: error.message } : { ok: true, data: data as PartyQuest };
}

export async function incrementPartyQuest(partyId: string, amount: number): Promise<void> {
  if (!supabase || amount <= 0) return;
  await supabase.rpc('increment_party_quest', { p_party: partyId, p_amount: amount });
}

/** Global leaderboard, or party-scoped when `memberIds` is provided.
 *  `track` controls the sort column: 'xp' (default) or 'consistency' (habit_score). */
export async function getLeaderboard(
  memberIds?: string[],
  track: 'xp' | 'consistency' = 'xp',
): Promise<LeaderboardRow[]> {
  if (!supabase) return [];
  const orderCol = track === 'consistency' ? 'habit_score' : 'total_xp';
  let query = supabase
    .from('leaderboard')
    .select('*')
    .order(orderCol, { ascending: false })
    .limit(50);
  if (memberIds && memberIds.length > 0) query = query.in('id', memberIds);
  const { data } = await query;
  return (data as LeaderboardRow[]) ?? [];
}
