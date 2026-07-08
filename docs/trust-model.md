# Trust Model

> **Status: decided.** Phase 6 — Online Trust, Server Time, and Fairness  
> Updated: 2026-07-06 (covers migrations through 0012; supersedes the 2026-06-22 revision)

> **Deployment note (2026-07-06):** the live Supabase project had drifted behind the
> repo migrations (the ledger tracked only 0008; several migrations were applied
> out-of-band). Reconciled 2026-07-06 — **all migrations through 0012 are now live**
> (project `rclrnxeazvlqenskaqzv`), verified by introspection. Two hazards handled
> during that deploy, recorded here for a future from-scratch apply:
> 1. **0012 depends on 0006** (its `increment_party_quest` reads the `contributions`
>    column). Applied in order 0006 → 0012.
> 2. **0009's original step-4 view could not be applied as-written** — it *renamed*
>    leaderboard columns (`mine_floor`/`tactics_tier`), which mismatches the client
>    (`LeaderboardRow` reads `deepest_*`) and collides with the live view (`42P16`).
>    A corrected 0009 (trigger + `suspect` column unchanged; view appends only the
>    suspect/not-null filter to 0008's client-correct shape) was applied and the repo
>    0009 file was patched to match. The trigger function also gained
>    `set search_path = public` to match the repo's SECURITY DEFINER convention.

---

## Decision: Option A — Friendly Trust

The app uses **client-trusted saves** with **light server-date validation**.  
The leaderboard and party features are framed as **motivational, not competitive**.  
There is no server-side anti-cheat and no save validation beyond ownership.

This matches the intended social use case: friends and families tracking habits
together. Heavy competitive anti-cheat would add significant backend complexity
for a use case that doesn't require it.

---

## What this means in practice

### What server authority covers

| Vector | Server defends against it? |
|---|---|
| Clock manipulation (set device date forward to trigger daily resets/trials) | **Partly** — `server_now()` is fetched on mount; `engine/date.ts` applies the RTT-compensated offset to every daily/weekly gate (`trialsClearedOn`, habit resets, streaks, weekly rollover, challenge expiry), so changing the device clock does not move the server clock. **Caveats:** the sync runs *once* on mount (a device-clock change *after* sync shifts `now()` 1:1 until reload — MP-17), and if `syncServerClock()` fails the offset stays 0 and `now()` silently falls back to raw device time (MP-16/17). |
| Ownership (reading/writing another user's save) | **Yes** — Supabase RLS restricts `saves` and `profiles` to the owning user. Party/co-op actions go through `SECURITY DEFINER` RPCs that enforce membership. |

### What server authority does NOT cover

| Vector | Status |
|---|---|
| Save editing (edit localStorage / intercept cloud-save write to inflate XP/gold) | **Not defended** — the save is an opaque client blob with CAS version control, but the server does not validate its contents. A motivated user can edit their save directly. |
| Leaderboard field values | **Client-written, soft-guarded.** `total_xp`, `habit_score`, and the per-mode depth records in `public_snapshot` are written by the client and are *not recomputed* server-side. Migration 0009 adds a **soft rate-limit**: a `before update` trigger on `profiles` flags a row `suspect = true` when `totalXp` jumps > 5 000 within a 10-minute window, and the `leaderboard` view excludes suspect rows. It does **not** block the save or revert XP — it only hides the flagged row from the board (an admin clears the flag manually). *Live as of 2026-07-06.* |
| Party quest contributions | **Client-written, deadline-gated.** `increment_party_quest` still trusts the caller's `p_amount`. Migration 0012 adds two guards, but be clear on what each does: the **deadline predicate** (`ends_at`) genuinely rejects progress after a quest expires (+ `expire_stale_party_quests` retires lapsed rows); the **`p_amount` ceiling (1e6)** is only a coarse sanity bound on the un-clamped `contributions` accumulator and an int4-overflow guard — it does **not** prevent quest completion, because `progress` is already `least(progress + p_amount, target)` and quest targets are small (default 50), so a *single* forged in-window call can still complete a quest. That is accepted under friendly trust: party quests are motivational, not competitive. *Live as of 2026-07-06.* |
| Daily XP/completion caps | **Not implemented** — no daily limits are enforced server-side. |

### Leaderboards should be treated as motivational

The leaderboard (party and global) is a social nudge — it helps friends celebrate
each other's progress. It is **not** a fair competition. Future UI copy should
make this framing clear (e.g. "track your party's progress" rather than "compete
for the top rank").

The ranked surface has grown well beyond the original XP column and every field is
client-written: **XP** (`total_xp`, `level`), **per-mode depth records** (mine
floor, forest stage, arena tier, tactics tier — added in 0005), and the
**consistency track** (`habit_score` — added in 0008). The 0009 soft rate-limit
covers XP jumps only; the depth records and habit score have no server-side guard.

---

## Why not Option B (competitive trust)?

Option B would require:
- Server-side habit event logging and validation.
- Server-computed XP/leaderboard fields.
- Daily cap enforcement in a Supabase Edge Function or Postgres trigger.
- Rejection or flagging of suspicious saves.

This is substantial backend work for a scope — friends-and-family habit tracking —
that doesn't require it. Option B only becomes worthwhile if public competitive
leaderboards with real stakes become a core product goal.

---

## Future developers: do not assume this app is cheat-proof

The server-date wiring closes the *clock-cheat* vector only. The save is still
client-trusted. Any feature that relies on the integrity of XP, gold, or
leaderboard data for competitive purposes is building on a foundation that was
never designed to be tamper-resistant. Revisit this document before building
competitive features.
