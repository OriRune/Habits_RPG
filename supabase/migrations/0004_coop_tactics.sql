-- ============================================================================
-- Phase 3 — Co-op Hex Tactics: widen the coop_sessions game column
-- Run in the Supabase dashboard SQL Editor after 0003. Idempotent.
--
-- The `game` column is `text` with no CHECK constraint (by design — the
-- application layer validates values). This migration adds an explicit
-- CHECK constraint that enumerates all supported games to date, making invalid
-- values visible at the DB level rather than silently stored.
-- ============================================================================

alter table public.coop_sessions
  drop constraint if exists coop_sessions_game_check;

alter table public.coop_sessions
  add constraint coop_sessions_game_check
  check (game in ('mine', 'forest', 'tactics'));

comment on column public.coop_sessions.game is
  'Co-op game mode: ''mine'' (Deep Mine), ''forest'' (Wild Forest), ''tactics'' (Hex Tactics).';
