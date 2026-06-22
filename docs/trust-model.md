# Trust Model

> **Status: decided.** Phase 6 — Online Trust, Server Time, and Fairness  
> Updated: 2026-06-22

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
| Clock manipulation (set device date forward to trigger daily resets/trials) | **Yes** — `server_now()` is fetched on mount; `engine/date.ts` applies the RTT-compensated offset to every daily/weekly gate (`trialsClearedOn`, habit resets, streaks, weekly rollover, challenge expiry). Changing the device clock does not move the server clock. |
| Ownership (reading/writing another user's save) | **Yes** — Supabase RLS restricts `saves` and `profiles` to the owning user. Party/co-op actions go through `SECURITY DEFINER` RPCs that enforce membership. |

### What server authority does NOT cover

| Vector | Status |
|---|---|
| Save editing (edit localStorage / intercept cloud-save write to inflate XP/gold) | **Not defended** — the save is an opaque client blob with CAS version control, but the server does not validate its contents. A motivated user can edit their save directly. |
| Leaderboard accuracy | **Not defended** — `total_xp` and `habit_score` in `public_snapshots` are written by the client. They are never computed or capped server-side. |
| Party quest contributions | **Not defended** — `increment_party_quest` trusts the `contribution` value from the client. |
| Daily XP/completion caps | **Not implemented** — no daily limits are enforced server-side. |

### Leaderboards should be treated as motivational

The leaderboard (party and global) is a social nudge — it helps friends celebrate
each other's progress. It is **not** a fair competition. Future UI copy should
make this framing clear (e.g. "track your party's progress" rather than "compete
for the top rank").

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
