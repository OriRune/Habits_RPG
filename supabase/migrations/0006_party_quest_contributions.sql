-- Migration 0006: Party quest per-member contribution tracking (Stage 5.1)
--
-- Adds a `contributions` JSONB column to `party_quests` so the incremental
-- habit completions from each member are tracked separately. This enables the
-- client to credit the flat gold reward only to contributing members.
--
-- Also redefines `increment_party_quest` to accumulate the caller's contribution
-- atomically alongside the progress and status updates.

alter table public.party_quests
  add column if not exists contributions jsonb not null default '{}'::jsonb;

-- Redefine the RPC to accumulate contributions alongside the existing progress clamp.
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
    set progress      = least(progress + p_amount, target),
        status        = case when progress + p_amount >= target then 'completed' else status end,
        contributions = jsonb_set(
          contributions,
          array[v_uid::text],
          to_jsonb(coalesce((contributions ->> v_uid::text)::int, 0) + p_amount),
          true
        )
    where party_id = p_party and status = 'active';
end;
$$;
