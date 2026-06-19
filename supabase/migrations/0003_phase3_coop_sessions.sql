-- ============================================================================
-- Phase 3 — Co-op Deep Mine: session lobby + seed handshake
-- Run in the Supabase dashboard SQL Editor after 0002. Idempotent where practical.
--
-- This table is ONLY for lobby/discovery and the shared seed. The real-time world
-- sync runs over a Supabase Realtime *Broadcast* channel keyed by the session id
-- (no table writes per frame) — see src/net/coop/. Keeping per-frame traffic off
-- Postgres is what keeps co-op within the free-tier message budget.
-- ============================================================================

create table if not exists public.coop_sessions (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references public.parties (id) on delete cascade,
  game       text not null default 'mine',     -- 'mine'|'forest'|'tactics' (see CHECK in 0004; arena is not co-op)
  seed       bigint not null,                  -- shared map seed (mulberry32)
  host_id    uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'lobby',    -- 'lobby' | 'active' | 'ended'
  created_at timestamptz not null default now(),
  started_at timestamptz
);
create index if not exists coop_sessions_party_idx
  on public.coop_sessions (party_id, status);

alter table public.coop_sessions enable row level security;

-- Party members see their party's sessions; the host owns create/update/delete.
drop policy if exists coop_member_read on public.coop_sessions;
drop policy if exists coop_host_insert on public.coop_sessions;
drop policy if exists coop_host_update on public.coop_sessions;
drop policy if exists coop_host_delete on public.coop_sessions;

create policy coop_member_read on public.coop_sessions for select to authenticated
  using (public.is_party_member(party_id, auth.uid()));

create policy coop_host_insert on public.coop_sessions for insert to authenticated
  with check (host_id = auth.uid() and public.is_party_member(party_id, auth.uid()));

create policy coop_host_update on public.coop_sessions for update to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());

create policy coop_host_delete on public.coop_sessions for delete to authenticated
  using (host_id = auth.uid());

-- Realtime: members react to lobby open / status changes (start/end) live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'coop_sessions'
  ) then
    alter publication supabase_realtime add table public.coop_sessions;
  end if;
end $$;
