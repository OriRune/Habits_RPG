-- Migration 0008: Consistency leaderboard track (Stage 5.3)
--
-- Adds `habit_score` as a generated stored column on `profiles` for fast ORDER BY,
-- then extends the `leaderboard` view to expose it.
--
-- `habit_score` = the player's 30-day habit completion rate (0–100), computed on the
-- client in `selectHabitScore` and written into `public_snapshot.habitScore` during
-- the cloud-save autosync. The generated column extracts it for index-backed sorting.
--
-- CORRECTION (2026-07-06): the original version of this file `create or replace`d the
-- view with RENAMED columns (mine_floor/forest_stage/arena_tier/tactics_tier) and a
-- RETYPED total_xp (numeric → bigint). Both are forbidden by `create or replace view`
-- (ERROR 42P16: cannot change data type of view column), so the view half never
-- applied. Worse, those names don't match the client's `LeaderboardRow`
-- (src/net/party.ts), which reads deepest_mine/deepest_forest/deepest_arena. This
-- version drops + recreates the view with the client's actual column names and simply
-- appends habit_score, so a from-scratch deploy applies cleanly and matches the app.

alter table public.profiles
  add column if not exists habit_score integer
    generated always as (
      coalesce((public_snapshot ->> 'habitScore')::integer, 0)
    ) stored;

create index if not exists profiles_habit_score_idx on public.profiles (habit_score desc);

-- Recreate the leaderboard view with habit_score. drop+create (not create-or-replace)
-- so this is robust regardless of the column shape 0005 left behind. Column names match
-- the client's LeaderboardRow. Kept SECURITY DEFINER (no security_invoker) intentionally:
-- the board must read every player's row across users, which profiles RLS would block.
drop view if exists public.leaderboard;
create view public.leaderboard as
  select
    p.id,
    p.username,
    coalesce((p.public_snapshot ->> 'level')::integer, 1)              as level,
    coalesce((p.public_snapshot ->> 'totalXp')::numeric, 0::numeric)   as total_xp,
    coalesce((p.public_snapshot ->> 'deepestMineFloor')::integer, 0)   as deepest_mine,
    coalesce((p.public_snapshot ->> 'deepestForestStage')::integer, 0) as deepest_forest,
    coalesce((p.public_snapshot ->> 'deepestArenaTier')::integer, 0)   as deepest_arena,
    p.public_snapshot,
    coalesce((p.public_snapshot ->> 'habitScore')::integer, 0)         as habit_score
  from public.profiles p;

comment on view public.leaderboard is
  'Public leaderboard — one row per player. Exposes the public_snapshot plus numeric fields for sorting. Tracks: XP (total_xp) and Consistency (habit_score). No sensitive data.';
