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

// ─── 2. Stub Supabase ─────────────────────────────────────────────────────────

vi.mock('@/net/supabaseClient', () => {
  // Chainable builder: from().select().eq().eq()
  const chain = {
    select: (_cols: string) => ({
      eq: (_col1: string, _val1: unknown) => ({
        eq: (_col2: string, _val2: unknown) => mockSelect(),
      }),
    }),
  };
  return {
    supabase: { from: (_table: string) => chain },
    requireSupabase: () => ({ from: (_table: string) => chain }),
  };
});

// ─── 3. Import under test ─────────────────────────────────────────────────────

import { getClaimableQuests } from '../party';
import type { PartyQuest } from '../party';

// ─── 4. Test helpers ──────────────────────────────────────────────────────────

beforeEach(() => {
  mockSelect.mockReset();
});

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
