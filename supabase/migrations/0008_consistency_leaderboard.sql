-- Migration 0008: Consistency leaderboard track (Stage 5.3)
--
-- Adds `habit_score` as a generated stored column on `profiles` for fast ORDER BY,
-- then redefines the `leaderboard` view to include it.
--
-- `habit_score` = the player's 30-day habit completion rate (0–100), computed on the
-- client in `selectHabitScore` and written into `public_snapshot.habitScore` during
-- the cloud-save autosync. The generated column extracts it for index-backed sorting.

alter table public.profiles
  add column if not exists habit_score integer
    generated always as (
      coalesce((public_snapshot ->> 'habitScore')::integer, 0)
    ) stored;

create index if not exists profiles_habit_score_idx on public.profiles (habit_score desc);

-- Redefine the leaderboard view to expose habit_score alongside the existing columns.
-- Mirrors the pattern from 0005_tactics_leaderboard.sql; no security_invoker flag
-- (matches 0005 which dropped it).
create or replace view public.leaderboard as
  select
    p.id,
    p.username,
    coalesce((p.public_snapshot ->> 'level')::integer, 1)             as level,
    coalesce((p.public_snapshot ->> 'totalXp')::bigint, 0)            as total_xp,
    coalesce((p.public_snapshot ->> 'deepestMineFloor')::integer, 0)  as mine_floor,
    coalesce((p.public_snapshot ->> 'deepestForestStage')::integer, 0) as forest_stage,
    coalesce((p.public_snapshot ->> 'deepestArenaTier')::integer, 0)  as arena_tier,
    coalesce((p.public_snapshot ->> 'deepestTacticsTier')::integer, 0) as tactics_tier,
    coalesce((p.public_snapshot ->> 'habitScore')::integer, 0)         as habit_score,
    p.public_snapshot
  from public.profiles p
  where p.public_snapshot is not null;

comment on view public.leaderboard is
  'Public leaderboard — one row per player. Exposes the public_snapshot plus numeric fields for sorting. Tracks: XP (total_xp) and Consistency (habit_score). No sensitive data.';
