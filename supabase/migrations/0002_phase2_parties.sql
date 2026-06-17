-- ============================================================================
-- Phase 2 — Social: parties, members, chat, party quests, leaderboard
-- Run in the Supabase dashboard SQL Editor after 0001. Idempotent where practical.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table if not exists public.parties (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  invite_code text unique not null,
  max_members integer not null default 6,
  created_at  timestamptz not null default now()
);

create table if not exists public.party_members (
  party_id  uuid not null references public.parties (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null default 'member',  -- 'owner' | 'member'
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);
create index if not exists party_members_user_idx on public.party_members (user_id);

create table if not exists public.party_messages (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references public.parties (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  body       text not null check (length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists party_messages_party_idx on public.party_messages (party_id, created_at);

create table if not exists public.party_quests (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references public.parties (id) on delete cascade,
  def        jsonb not null,                 -- reuses the engine ChallengeDef shape
  target     integer not null,
  progress   integer not null default 0,
  status     text not null default 'active', -- 'active' | 'completed' | 'expired'
  ends_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists party_quests_party_idx on public.party_quests (party_id, status);

-- ----------------------------------------------------------------------------
-- Membership helper — SECURITY DEFINER so it bypasses RLS. Using it inside the
-- policies below avoids the classic party_members self-referential RLS recursion.
-- ----------------------------------------------------------------------------
create or replace function public.is_party_member(p_party uuid, p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.party_members
    where party_id = p_party and user_id = p_user
  );
$$;

-- ----------------------------------------------------------------------------
-- RLS — everything is member-scoped. Create/join/quests go through the
-- SECURITY DEFINER RPCs below; direct writes are limited to self-leave and chat.
-- ----------------------------------------------------------------------------
alter table public.parties        enable row level security;
alter table public.party_members  enable row level security;
alter table public.party_messages enable row level security;
alter table public.party_quests   enable row level security;

drop policy if exists parties_member_read   on public.parties;
drop policy if exists parties_owner_update   on public.parties;
create policy parties_member_read on public.parties for select to authenticated
  using (public.is_party_member(id, auth.uid()));
create policy parties_owner_update on public.parties for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists members_member_read on public.party_members;
drop policy if exists members_self_leave  on public.party_members;
create policy members_member_read on public.party_members for select to authenticated
  using (public.is_party_member(party_id, auth.uid()));
create policy members_self_leave on public.party_members for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists messages_member_read   on public.party_messages;
drop policy if exists messages_member_insert on public.party_messages;
create policy messages_member_read on public.party_messages for select to authenticated
  using (public.is_party_member(party_id, auth.uid()));
create policy messages_member_insert on public.party_messages for insert to authenticated
  with check (public.is_party_member(party_id, auth.uid()) and user_id = auth.uid());

drop policy if exists quests_member_read on public.party_quests;
create policy quests_member_read on public.party_quests for select to authenticated
  using (public.is_party_member(party_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- Invite-code generator: 6 chars, no ambiguous glyphs (0/O/1/I removed) so it
-- can be read aloud / copied from chat.
-- ----------------------------------------------------------------------------
create or replace function public.gen_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result   text := '';
  i        integer;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

-- ----------------------------------------------------------------------------
-- create_party: generate a unique code, insert the party + the owner membership
-- atomically. Returns the new party row.
-- ----------------------------------------------------------------------------
create or replace function public.create_party(p_name text)
returns public.parties
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_code  text;
  v_party public.parties;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'party name is required'; end if;

  -- Find a unique code (retry on the rare collision).
  loop
    v_code := public.gen_invite_code();
    exit when not exists (select 1 from public.parties where invite_code = v_code);
  end loop;

  insert into public.parties (name, owner_id, invite_code)
  values (trim(p_name), v_uid, v_code)
  returning * into v_party;

  insert into public.party_members (party_id, user_id, role)
  values (v_party.id, v_uid, 'owner');

  return v_party;
end;
$$;

-- ----------------------------------------------------------------------------
-- join_party: the ONLY path a non-member can touch a party. Validates the code,
-- capacity, and prior membership, then inserts the membership. Clean errors.
-- ----------------------------------------------------------------------------
create or replace function public.join_party(p_code text)
returns public.parties
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_party  public.parties;
  v_count  integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select * into v_party from public.parties
  where invite_code = upper(trim(p_code));
  if not found then raise exception 'no party with that code'; end if;

  if exists (select 1 from public.party_members
             where party_id = v_party.id and user_id = v_uid) then
    raise exception 'already a member';
  end if;

  select count(*) into v_count from public.party_members where party_id = v_party.id;
  if v_count >= v_party.max_members then raise exception 'party is full'; end if;

  insert into public.party_members (party_id, user_id, role)
  values (v_party.id, v_uid, 'member');

  return v_party;
end;
$$;

-- ----------------------------------------------------------------------------
-- leave_party: remove own membership. If the owner leaves, transfer ownership to
-- the next-oldest member; if they were the last member, the party is deleted.
-- ----------------------------------------------------------------------------
create or replace function public.leave_party(p_party uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_is_owner  boolean;
  v_next      uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select (owner_id = v_uid) into v_is_owner from public.parties where id = p_party;
  if v_is_owner is null then raise exception 'no such party'; end if;

  delete from public.party_members where party_id = p_party and user_id = v_uid;

  if v_is_owner then
    select user_id into v_next from public.party_members
    where party_id = p_party order by joined_at asc limit 1;
    if v_next is null then
      delete from public.parties where id = p_party;  -- last one out
    else
      update public.parties set owner_id = v_next where id = p_party;
      update public.party_members set role = 'owner'
        where party_id = p_party and user_id = v_next;
    end if;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- kick_member: owner-only removal of another member.
-- ----------------------------------------------------------------------------
create or replace function public.kick_member(p_party uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.parties where id = p_party and owner_id = v_uid) then
    raise exception 'only the lead can remove members';
  end if;
  if p_user = v_uid then raise exception 'use leave_party to leave'; end if;
  delete from public.party_members where party_id = p_party and user_id = p_user;
end;
$$;

-- ----------------------------------------------------------------------------
-- create_party_quest: owner sets the active shared goal. Expires any previous
-- active quest so there is exactly one at a time.
-- ----------------------------------------------------------------------------
create or replace function public.create_party_quest(
  p_party uuid, p_def jsonb, p_target integer, p_days integer
)
returns public.party_quests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_quest public.party_quests;
begin
  if not exists (select 1 from public.parties where id = p_party and owner_id = v_uid) then
    raise exception 'only the lead can set a party quest';
  end if;

  update public.party_quests set status = 'expired'
    where party_id = p_party and status = 'active';

  insert into public.party_quests (party_id, def, target, ends_at)
  values (p_party, p_def, greatest(p_target, 1), now() + (greatest(p_days, 1) || ' days')::interval)
  returning * into v_quest;

  return v_quest;
end;
$$;

-- ----------------------------------------------------------------------------
-- increment_party_quest: atomically add to the active quest's progress (any
-- member). Marks it completed when it reaches target. Called on habit completion.
-- ----------------------------------------------------------------------------
create or replace function public.increment_party_quest(p_party uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_party_member(p_party, v_uid) then
    raise exception 'not a member of this party';
  end if;
  if p_amount <= 0 then return; end if;

  update public.party_quests
    set progress = least(progress + p_amount, target),
        status   = case when progress + p_amount >= target then 'completed' else status end
    where party_id = p_party and status = 'active';
end;
$$;

grant execute on function
  public.create_party(text),
  public.join_party(text),
  public.leave_party(uuid),
  public.kick_member(uuid, uuid),
  public.create_party_quest(uuid, jsonb, integer, integer),
  public.increment_party_quest(uuid, integer)
  to authenticated;

-- ----------------------------------------------------------------------------
-- Leaderboard: a view over profiles.public_snapshot. security_invoker so the
-- caller's RLS on profiles applies (authenticated can read all profiles).
-- The client filters to a party by joining on member ids for party-scoped boards.
-- ----------------------------------------------------------------------------
create or replace view public.leaderboard
with (security_invoker = on) as
select
  p.id,
  p.username,
  coalesce((p.public_snapshot ->> 'level')::int, 1)               as level,
  coalesce((p.public_snapshot ->> 'totalXp')::numeric, 0)         as total_xp,
  coalesce((p.public_snapshot ->> 'deepestMineFloor')::int, 0)    as deepest_mine,
  coalesce((p.public_snapshot ->> 'deepestForestStage')::int, 0)  as deepest_forest,
  coalesce((p.public_snapshot ->> 'deepestArenaTier')::int, 0)    as deepest_arena,
  p.public_snapshot
from public.profiles p;

grant select on public.leaderboard to authenticated;

-- ----------------------------------------------------------------------------
-- Realtime: allow Postgres-changes broadcasts for chat + quests. (Presence uses
-- the Realtime channel directly and needs no table config.) Guarded so re-running
-- the migration doesn't error on an already-published table.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'party_messages'
  ) then
    alter publication supabase_realtime add table public.party_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'party_quests'
  ) then
    alter publication supabase_realtime add table public.party_quests;
  end if;
end $$;
