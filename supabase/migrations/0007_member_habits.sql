-- Migration 0007: Party-scoped habit visibility (Stage 5.2)
--
-- Creates `member_habits` — a table where members can opt-in to publishing
-- their active habit names, streaks, and today's completion status.
--
-- RLS restricts reads to co-party members only (the join resolves at most one
-- shared party, since users are capped at one party). This is intentionally
-- NOT stored in public_snapshot (which is readable by all authenticated users).

create table if not exists public.member_habits (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  habits     jsonb not null default '[]'::jsonb,  -- SharedHabit[] = [{ name, streak, doneToday }]
  updated_at timestamptz not null default now()
);

alter table public.member_habits enable row level security;

-- Owner may insert/update/delete their own row.
create policy member_habits_owner_write on public.member_habits
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Readable only by users who share a party with the row's owner.
-- The self-join on party_members resolves co-membership.
create policy member_habits_party_read on public.member_habits
  for select
  using (
    exists (
      select 1
      from public.party_members me
      join public.party_members them
        on me.party_id = them.party_id
      where me.user_id  = auth.uid()
        and them.user_id = member_habits.user_id
    )
  );
