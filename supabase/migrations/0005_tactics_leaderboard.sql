-- ============================================================================
-- Migration 0005 — Expose deepestTacticsTier in the public snapshot
--
-- IMPORTANT: Apply manually in the Supabase dashboard SQL Editor.
--            There is no migration runner in this project; all migrations are
--            cumulative and must be applied in order (0001 → 0005).
--            This migration is additive and idempotent.
--
-- Purpose:
--   The client now records `deepestTacticsTier` (the highest Hex Tactics tier
--   the player has won) in the `public_snapshot` JSONB column on `profiles`,
--   alongside the existing mine/forest/arena depth records.
--
--   This migration:
--     1. Adds a generated/virtual column `tactics_tier` on `profiles` for fast
--        leaderboard sorts without parsing JSONB in the query.
--     2. Updates the `leaderboard` view to include the new column.
--
--   The `public_snapshot` field itself requires no schema change — it is
--   already an unconstrained JSONB column and new clients write the field on
--   every push (see src/net/cloudSave.ts :: buildPublicSnapshot).
--   Old clients that don't yet write the field produce a `null` value, which
--   the coalesce below treats as 0.
-- ============================================================================

-- 1. Add a generated column that extracts deepestTacticsTier from the snapshot.
--    GENERATED ALWAYS AS … STORED re-computes on every update so the column
--    is indexed without an explicit trigger. COALESCE handles rows written by
--    older clients that don't include the field yet.
alter table public.profiles
  add column if not exists tactics_tier integer
    generated always as (
      coalesce(
        (public_snapshot->>'deepestTacticsTier')::integer,
        0
      )
    ) stored;

comment on column public.profiles.tactics_tier is
  'Highest Hex Tactics tier won — extracted from public_snapshot for fast leaderboard sort. Auto-updated on every profile write.';

-- 2. Index for leaderboard ORDER BY tactics_tier DESC (mirrors the mine_floor / forest_stage
--    indexes that already exist for those columns).
create index if not exists profiles_tactics_tier_idx on public.profiles (tactics_tier desc);

-- 3. Refresh the leaderboard view to include the new column.
--    DROP + CREATE is the safest way to evolve a view definition without worrying about
--    column-order constraints; the existing row-level security policy on `profiles`
--    continues to govern read access.
create or replace view public.leaderboard as
  select
    p.id,
    p.username,
    -- Numeric fields extracted from the snapshot for ORDER BY / display:
    coalesce((p.public_snapshot->>'level')::integer, 1)          as level,
    coalesce((p.public_snapshot->>'totalXp')::bigint, 0)         as total_xp,
    coalesce((p.public_snapshot->>'deepestMineFloor')::integer, 0)  as mine_floor,
    coalesce((p.public_snapshot->>'deepestForestStage')::integer, 0) as forest_stage,
    coalesce((p.public_snapshot->>'deepestArenaTier')::integer, 0)  as arena_tier,
    coalesce((p.public_snapshot->>'deepestTacticsTier')::integer, 0) as tactics_tier,
    -- Full snapshot for richer display (username, hero name, top stats, etc.):
    p.public_snapshot
  from public.profiles p
  where p.public_snapshot is not null;

comment on view public.leaderboard is
  'Public leaderboard — one row per player, ordered by the client. Exposes the public_snapshot plus numeric fields extracted for efficient sorting. No sensitive data; row-level security on profiles governs the underlying reads.';
