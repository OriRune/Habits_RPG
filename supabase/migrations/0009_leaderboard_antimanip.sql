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
-- Live-Supabase verification is required before enabling in production; this
-- migration is included in the repo as the authoritative DB artifact.
--
-- Threshold rationale: 5 000 XP requires ~250 normal-difficulty completions or
-- ~17 full trial sweeps. In a 10-second debounce window that is practically
-- impossible through legitimate play.

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

-- 4. Redefine the leaderboard view to exclude suspect rows.
--    Replaces the 0008 definition; all columns are identical.
create or replace view public.leaderboard as
  select
    p.id,
    p.username,
    coalesce((p.public_snapshot ->> 'level')::integer, 1)              as level,
    coalesce((p.public_snapshot ->> 'totalXp')::bigint, 0)             as total_xp,
    coalesce((p.public_snapshot ->> 'deepestMineFloor')::integer, 0)   as mine_floor,
    coalesce((p.public_snapshot ->> 'deepestForestStage')::integer, 0) as forest_stage,
    coalesce((p.public_snapshot ->> 'deepestArenaTier')::integer, 0)   as arena_tier,
    coalesce((p.public_snapshot ->> 'deepestTacticsTier')::integer, 0) as tactics_tier,
    coalesce((p.public_snapshot ->> 'habitScore')::integer, 0)         as habit_score,
    p.public_snapshot
  from public.profiles p
  where p.public_snapshot is not null
    and p.suspect = false;   -- exclude flagged rows

comment on view public.leaderboard is
  'Public leaderboard — one row per player. Excludes rows flagged as suspect by the XP rate-limit trigger. Exposes public_snapshot plus numeric fields for sorting. Tracks: XP (total_xp) and Consistency (habit_score). No sensitive data.';
