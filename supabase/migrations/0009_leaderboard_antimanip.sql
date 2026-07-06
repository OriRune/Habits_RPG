-- Migration 0009: Leaderboard anti-manipulation rate limiting (Stage 7.5)
--
-- Adds a soft guard against unrealistically large XP gains between cloud-save
-- syncs. A trigger on the `profiles` table compares the new `totalXp` value to
-- the last known value; if the gain exceeds SUSPECT_XP_THRESHOLD within
-- SUSPECT_WINDOW_SECS seconds, the row is flagged as `suspect = true` and
-- excluded from the leaderboard view.
--
-- This is a soft guard — it does not block saves or revert XP. It only removes
-- suspect players from the visible leaderboard. A human admin can clear the flag
-- manually (set suspect = false) after review.
--
-- Threshold rationale: 5 000 XP requires ~250 normal-difficulty completions or
-- ~17 full trial sweeps. In a 10-second debounce window that is practically
-- impossible through legitimate play.
--
-- APPLIED LIVE 2026-07-06 (project rclrnxeazvlqenskaqzv). CORRECTION: the original
-- step-4 below `create or replace`d the view with RENAMED columns
-- (mine_floor/forest_stage/arena_tier/tactics_tier) and a RETYPED total_xp
-- (numeric → bigint) — both forbidden by `create or replace view` (ERROR 42P16) and
-- mismatched against the client's LeaderboardRow (deepest_mine/deepest_forest/
-- deepest_arena). Step 4 now matches 0008's client-correct shape and only appends the
-- suspect + not-null filter, so it applies cleanly on top of 0008 and matches the app.

-- 1. Add tracking columns to profiles.
alter table public.profiles
  add column if not exists suspect boolean not null default false,
  add column if not exists last_known_xp bigint not null default 0,
  add column if not exists last_xp_checked_at timestamptz not null default now();

-- 2. Create the anti-manipulation trigger function.
create or replace function public.check_xp_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_xp       bigint;
  v_old_xp       bigint;
  v_delta        bigint;
  v_elapsed_secs float;

  -- A gain of more than 5 000 XP is suspicious regardless of window.
  SUSPECT_XP_THRESHOLD constant bigint    := 5000;
  -- Only apply the rate-limit within a short observation window (10 minutes).
  -- Gains that accumulate over hours of legitimate play are not flagged.
  SUSPECT_WINDOW_SECS  constant float     := 600;
begin
  -- Extract totalXp from the new public_snapshot JSONB.
  v_new_xp := coalesce((new.public_snapshot ->> 'totalXp')::bigint, 0);
  v_old_xp := coalesce(old.last_known_xp, 0);
  v_delta   := v_new_xp - v_old_xp;

  -- Only inspect increases (XP should be monotonic; decreases are ignored).
  if v_delta > 0 then
    v_elapsed_secs := extract(epoch from (now() - old.last_xp_checked_at));

    if v_delta > SUSPECT_XP_THRESHOLD and v_elapsed_secs < SUSPECT_WINDOW_SECS then
      new.suspect := true;
    end if;
  end if;

  -- Always update the tracking columns so the next sync has a fresh baseline.
  new.last_known_xp       := v_new_xp;
  new.last_xp_checked_at  := now();

  return new;
end;
$$;

-- 3. Attach the trigger to profile updates (only fires when public_snapshot changes).
drop trigger if exists trg_check_xp_rate_limit on public.profiles;
create trigger trg_check_xp_rate_limit
  before update of public_snapshot on public.profiles
  for each row
  execute function public.check_xp_rate_limit();

-- 4. Redefine the leaderboard view to exclude suspect rows. Column names/types/order
--    match 0008 (the client's LeaderboardRow); this only appends the suspect filter.
create or replace view public.leaderboard as
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
  from public.profiles p
  where p.public_snapshot is not null
    and p.suspect = false;   -- exclude flagged rows

comment on view public.leaderboard is
  'Public leaderboard — one row per player. Excludes suspect (XP rate-limit flagged) rows and null snapshots. Tracks XP (total_xp) and Consistency (habit_score). No sensitive data.';
