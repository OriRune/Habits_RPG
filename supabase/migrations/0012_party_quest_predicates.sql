-- Migration 0012: Party quest server-side predicates (deadline + amount ceiling)
-- Findings MP-18, MP-27 (docs/audit-2026-07/05-multiplayer.md).
--
-- Two anti-abuse predicates on the shared party-quest surface, sized for the
-- friendly-trust model (docs/trust-model.md) — coarse guards, not full anti-cheat:
--
--   MP-18: `ends_at` was set at quest creation (0002) but never enforced —
--          `increment_party_quest` accepted progress for any 'active' row forever.
--          Fix: (a) reject progress past the deadline in the RPC's UPDATE predicate,
--               (b) `expire_stale_party_quests()` lazily flips past-deadline rows to
--                   'expired' (there is no pg_cron in this project — the client calls
--                   it on reload, mirroring 0002's lazy expire-previous-quest pattern).
--
--   MP-27: `increment_party_quest` had no ceiling on `p_amount`. Fix: clamp it to a
--          coarse sanity bound (1e6) — far above any legitimate reporter delta
--          (count/class ~1, quantity = raw log amounts) but below int4 overflow, so
--          a forged absurd value can't overflow `progress + p_amount` or poison the
--          `contributions` accumulator. `progress` itself is already target-clamped.
--
-- Builds on 0006's contribution-accumulation shape (authoritative definition).
-- Idempotent (create or replace); safe to re-run.
--
-- DEPLOY ORDER — 0006 must be live first. This function references the
-- `party_quests.contributions` column added by 0006. As of 2026-07-06 the live DB
-- has NOT applied 0006, so applying THIS migration alone would create the function
-- but make every call fail at runtime (`column contributions does not exist`),
-- breaking party-quest progress. Apply 0006 then 0012. See docs/trust-model.md.

-- 1. Redefine increment_party_quest with the deadline predicate + amount ceiling.
create or replace function public.increment_party_quest(p_party uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  -- Coarse sanity bound, NOT a gameplay cap. `progress` is already clamped to
  -- `target` by the least() below, so this exists only to bound the un-clamped
  -- `contributions` accumulator and to keep `progress + p_amount` clear of int4
  -- overflow. It is set far above any realistic single reporter delta — count/class
  -- quests report ~1 per completion, and quantity quests report raw log amounts
  -- (steps, minutes) that never approach 1e6 (see useParty.ts computeQuestTotal).
  MAX_QUEST_INCREMENT constant integer := 1000000;
begin
  if not public.is_party_member(p_party, v_uid) then
    raise exception 'not a member of this party';
  end if;
  if p_amount <= 0 then return; end if;
  -- MP-27: clamp rather than reject so a forged absurd value is bounded while any
  -- legitimate contribution (well under the ceiling) passes through untouched.
  if p_amount > MAX_QUEST_INCREMENT then
    p_amount := MAX_QUEST_INCREMENT;
  end if;

  update public.party_quests
    set progress      = least(progress + p_amount, target),
        status        = case when progress + p_amount >= target then 'completed' else status end,
        contributions = jsonb_set(
          contributions,
          array[v_uid::text],
          to_jsonb(coalesce((contributions ->> v_uid::text)::int, 0) + p_amount),
          true
        )
    where party_id = p_party
      and status = 'active'
      and (ends_at is null or ends_at > now());  -- MP-18: no progress past the deadline
end;
$$;

-- 2. Lazy deadline expiry: flip past-deadline active quests to 'expired' so they
--    stop accepting progress and disappear from getActiveQuest for every member.
--    Membership-gated; called from the client reload path (useParty.reloadParty).
create or replace function public.expire_stale_party_quests(p_party uuid)
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
  update public.party_quests
    set status = 'expired'
    where party_id = p_party
      and status = 'active'
      and ends_at is not null
      and ends_at <= now();
end;
$$;
