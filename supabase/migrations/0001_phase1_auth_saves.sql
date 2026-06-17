-- ============================================================================
-- Phase 1 — Accounts + cloud save
-- Run this in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Idempotent where practical, so re-running is safe.
-- ============================================================================

-- citext gives case-insensitive uniqueness for usernames ("Orion" == "orion").
create extension if not exists citext;

-- ----------------------------------------------------------------------------
-- profiles: one row per auth user. `username` is BOTH the login identity (mapped
-- to a synthetic email by the client) AND the social name shown to other players.
-- `public_snapshot` is a lightweight, party-readable blob (level/stats/activity);
-- the full save lives in `saves`, never exposed to other users.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  username        citext unique not null,
  public_snapshot jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Any authenticated user may read username + public_snapshot (for parties/leaderboards).
drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- A user may update only their own row (e.g. public_snapshot). Insert is handled
-- by the signup trigger below, not by the client.
drop policy if exists "profiles updatable by owner" on public.profiles;
create policy "profiles updatable by owner"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ----------------------------------------------------------------------------
-- saves: one durable game blob per user. `state` is the opaque Zustand persist
-- envelope ({ state, version }) MINUS transient run objects — the client runs its
-- own versioned migrate() on load, so the server never migrates. `version` here is
-- an OPTIMISTIC-CONCURRENCY counter (compare-and-swap), unrelated to the schema
-- version inside the blob.
-- ----------------------------------------------------------------------------
create table if not exists public.saves (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null,
  version    integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.saves enable row level security;

-- Owner-only: a user can only ever see or write their own save.
drop policy if exists "saves owner read"   on public.saves;
drop policy if exists "saves owner insert" on public.saves;
drop policy if exists "saves owner update" on public.saves;

create policy "saves owner read"
  on public.saves for select to authenticated
  using (user_id = auth.uid());

create policy "saves owner insert"
  on public.saves for insert to authenticated
  with check (user_id = auth.uid());

create policy "saves owner update"
  on public.saves for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- handle_new_user: on signup, create the matching profile row using the username
-- the client passed in signUp options.data. SECURITY DEFINER so it can insert past
-- RLS. Runs inside the auth.users insert transaction.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- username_available: anonymous pre-check so signup can show a clean "name taken"
-- message before submitting. SECURITY DEFINER + granted to anon so the (not-yet
-- authenticated) signup form can call it without exposing the profiles table.
-- ----------------------------------------------------------------------------
create or replace function public.username_available(name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where username = name::citext
  );
$$;

grant execute on function public.username_available(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- server_now: single source of truth for "today" so client clock drift can't
-- shift daily resets. Returns server time in epoch milliseconds.
-- ----------------------------------------------------------------------------
create or replace function public.server_now()
returns bigint
language sql
stable
as $$
  select (extract(epoch from now()) * 1000)::bigint;
$$;

grant execute on function public.server_now() to anon, authenticated;
