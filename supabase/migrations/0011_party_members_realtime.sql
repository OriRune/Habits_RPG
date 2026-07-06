-- ============================================================================
-- Phase 2 hardening — realtime on party_members so roster changes broadcast (MP-19)
-- Run in the Supabase dashboard SQL Editor after 0010. Idempotent.
--
-- 0002 added party_messages and party_quests to the supabase_realtime publication
-- but not party_members. Without it, a join/leave/kick never reaches other members'
-- clients live — rosters (and the leaderboard set) go stale until each member's next
-- mutation or hourly reload. The client-side listener in useParty.ts calls
-- reloadParty() on any party_members change; this migration makes that change publish.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'party_members'
  ) then
    alter publication supabase_realtime add table public.party_members;
  end if;
end $$;
