/**
 * Tests for src/net/party.ts — getClaimableQuests contributor filter.
 *
 * Strategy:
 *  - `@/net/supabaseClient` is mocked so no network calls are made.
 *  - `getClaimableQuests` filters its result set purely in JS (no server-side logic
 *    is required), so we can drive it by controlling what the SELECT mock returns.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── 1. Hoist mock ────────────────────────────────────────────────────────────

const mockSelect = vi.hoisted(() =>
  vi.fn<() => Promise<{ data: unknown; error: unknown }>>(),
);
const mockMessages = vi.hoisted(() =>
  vi.fn<() => Promise<{ data: unknown; error: unknown }>>(),
);
const mockOrder = vi.hoisted(() => vi.fn());
const mockRpc = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: null, error: null })));

// ─── 2. Stub Supabase ─────────────────────────────────────────────────────────

vi.mock('@/net/supabaseClient', () => {
  // Chainable builder covering both from().select().eq().eq() (getClaimableQuests)
  // and from().select().eq().order().limit() (getMessages).
  const chain = {
    select: (_cols: string) => ({
      eq: (_col1: string, _val1: unknown) => ({
        eq: (_col2: string, _val2: unknown) => mockSelect(),
        order: (col: string, opts: unknown) => {
          mockOrder(col, opts);
          return { limit: (_n: number) => mockMessages() };
        },
      }),
    }),
  };
  return {
    supabase: { from: (_table: string) => chain, rpc: mockRpc },
    requireSupabase: () => ({ from: (_table: string) => chain, rpc: mockRpc }),
  };
});

// ─── 3. Import under test ─────────────────────────────────────────────────────

import { getClaimableQuests, getMessages, expireStaleQuests, incrementPartyQuest } from '../party';
import type { PartyQuest, PartyMessage } from '../party';

// ─── 4. Test helpers ──────────────────────────────────────────────────────────

beforeEach(() => {
  mockSelect.mockReset();
  mockMessages.mockReset();
  mockOrder.mockReset();
  mockRpc.mockClear();
});

function makeMessage(id: string, created_at: string): PartyMessage {
  return { id, party_id: 'party-1', user_id: 'u', body: id, created_at };
}

function makeQuest(
  id: string,
  contributions: Record<string, number>,
): PartyQuest {
  return {
    id,
    party_id: 'party-1',
    def: {} as PartyQuest['def'],
    target: 10,
    progress: 10,
    status: 'completed',
    ends_at: null,
    contributions,
  };
}

// ─── 5. Tests ─────────────────────────────────────────────────────────────────

describe('getClaimableQuests', () => {
  it('returns quests where the given user has a positive contribution', async () => {
    const questA = makeQuest('q-a', { 'user-1': 3, 'user-2': 0 });
    const questB = makeQuest('q-b', { 'user-1': 1 });
    mockSelect.mockResolvedValueOnce({ data: [questA, questB], error: null });

    const result = await getClaimableQuests('party-1', 'user-1');

    expect(result).toHaveLength(2);
    expect(result.map((q) => q.id)).toContain('q-a');
    expect(result.map((q) => q.id)).toContain('q-b');
  });

  it('excludes quests where the user has zero contributions', async () => {
    const quest = makeQuest('q-zero', { 'user-1': 0 });
    mockSelect.mockResolvedValueOnce({ data: [quest], error: null });

    const result = await getClaimableQuests('party-1', 'user-1');

    expect(result).toHaveLength(0);
  });

  it('excludes quests where the user has no contributions entry', async () => {
    const quest = makeQuest('q-absent', { 'user-2': 5 }); // user-1 not present
    mockSelect.mockResolvedValueOnce({ data: [quest], error: null });

    const result = await getClaimableQuests('party-1', 'user-1');

    expect(result).toHaveLength(0);
  });

  it('excludes non-contributor from mixed-membership result', async () => {
    const questA = makeQuest('q-contributed', { 'user-1': 2, 'user-2': 1 });
    const questB = makeQuest('q-not-contributed', { 'user-2': 4 }); // user-1 absent
    const questC = makeQuest('q-zero-contrib', { 'user-1': 0, 'user-2': 3 });
    mockSelect.mockResolvedValueOnce({ data: [questA, questB, questC], error: null });

    const result = await getClaimableQuests('party-1', 'user-1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('q-contributed');
  });

  it('returns empty when supabase response data is null', async () => {
    mockSelect.mockResolvedValueOnce({ data: null, error: null });

    const result = await getClaimableQuests('party-1', 'user-1');

    expect(result).toHaveLength(0);
  });
});

describe('getMessages (MP-15)', () => {
  it('queries newest-first and returns them in chronological order', async () => {
    // The DB query is DESCENDING (newest first); getMessages reverses to chronological
    // so the chat pane renders oldest→newest and scrolls to the latest.
    const descending = [
      makeMessage('m3', '2026-01-03'),
      makeMessage('m2', '2026-01-02'),
      makeMessage('m1', '2026-01-01'),
    ];
    mockMessages.mockResolvedValueOnce({ data: descending, error: null });

    const result = await getMessages('party-1');

    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('returns empty when supabase response data is null', async () => {
    mockMessages.mockResolvedValueOnce({ data: null, error: null });
    expect(await getMessages('party-1')).toEqual([]);
  });
});

// Guards the client↔migration-0012 RPC contract: the function names and argument
// shapes here must match the SQL in supabase/migrations/0012_party_quest_predicates.sql.
describe('quest RPC wrappers (MP-18, MP-27)', () => {
  it('expireStaleQuests calls expire_stale_party_quests with the party id', async () => {
    await expireStaleQuests('party-1');
    expect(mockRpc).toHaveBeenCalledWith('expire_stale_party_quests', { p_party: 'party-1' });
  });

  it('incrementPartyQuest calls increment_party_quest with party id and amount', async () => {
    await incrementPartyQuest('party-1', 3);
    expect(mockRpc).toHaveBeenCalledWith('increment_party_quest', { p_party: 'party-1', p_amount: 3 });
  });

  it('incrementPartyQuest short-circuits on a non-positive amount (never hits the RPC)', async () => {
    await incrementPartyQuest('party-1', 0);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
