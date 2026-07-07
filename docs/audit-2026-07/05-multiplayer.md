# Audit 2026-07 — Multiplayer
**Date run:** 2026-07-06 · **Branch:** feature/multiplayer · **Sections complete before this one:** 01-architecture, 02-habit-core, 03-balance, 04-minigames

**Method note.** Three doc-fact-checker batches (MULTIPLAYER_PLAN shipped-vs-diverged, trust-model claims, game-analysis/plan2 co-op claims) followed by five code-health gap agents: coop reducer+protocol+session, coop hooks, cloudSave CAS, party layer, clock/date seam. Every P0/P1 below was re-verified by hand at the cited lines. This section also discharges two handoffs: **MINI-32** (section 04 — co-op guest attack paths) and **ARCH-24** (section 01 — persisted co-op run vs transient seed); verdicts are in MP-02/MP-11 and MP-12 respectively. The plan2-tracked staleness-guard bug is graded here as MP-03.

## Executive summary

- **Cloud save has a data-loss cluster.** The unconditional startup pull rolls back an entire offline session on a single device (MP-01, P0); a CAS conflict silently discards the losing device's changes while the code comment claims a merge that does not exist (MP-05); sign-out wipes the local save even when the final flush failed offline (MP-07); first sign-in clobbers rich pre-account progress whenever any cloud row exists — and a test asserts the clobber as correct (MP-06).
- **Three hard co-op desyncs, all in the untested glue.** A forest guest's ranged kill diverges permanently because the world merge is intersection-only and can never resurrect a beast (MP-02, P0 — MINI-32 confirmed and upgraded); the Tactics staleness guard compares two machines' unrelated `performance.now()` clocks and freezes the guest's board for the whole match whenever the guest's tab is >10 s older than the host's (MP-03, P0); a host refresh resets the world-slice timestamp epoch so guests drop every subsequent slice (MP-04).
- **Session lifecycle leaks compound each other:** `joined` never resets when a session ends remotely, so a guest is silently auto-subscribed into the party's *next* raid — and if they're mid-solo-run, the new host's world overwrites their solo monsters (MP-08); host tab-close orphans `coop_sessions` rows that resurface as joinable zombie raids (MP-09); a rejoining guest's HeroJoin is a silent no-op and they hang on a null board forever (MP-10).
- **The trust model drifted in both directions.** Migration 0009 quietly added a server-side XP rate-limit trigger the trust-model doc doesn't know about; meanwhile party quests are trivially forgeable three ways (unbounded RPC `contribution`, deadlines never enforced anywhere, uncomplete→recomplete farming) and the clock seam never re-syncs, reopening the spoof vector it exists to close (MP-14/17/18/27).
- **Test coverage is inverted relative to risk:** all 13 pure `reduce.ts` exports are tested, yet every finding above lives in the zero-test orchestration layer — `useCoopSession`, `useTacticsCoopSession`, `useParty`, `useCloudSync`, and `session.ts` have no tests at all (MP-28).

## Prior-doc fact check

| # | Claim | Source doc | Verdict | Evidence |
|---|-------|-----------|---------|----------|
| 1 | Co-op scope: Mine MVP, then Forest + **Arena** (Phase 3.5) | MULTIPLAYER_PLAN §3/3.5 | **diverged** | `protocol.ts:23` union is `'mine'\|'forest'\|'tactics'`; Arena dropped with no in-code rationale; Tactics co-op shipped unplanned |
| 2 | Broadcast: ~8–10 Hz **delta/dirty** slices | MULTIPLAYER_PLAN:249-250 | **diverged** | `COOP_BROADCAST_HZ = 10` (`protocol.ts:132`) ✓, but `buildWorldSlice` (`reduce.ts:439-458`) ships the full monster/beast list every 100 ms; only tiles are event-driven |
| 3 | `engine/rng.ts` (mulberry32); seed threaded into run-start + per-tick actions | MULTIPLAYER_PLAN §3a | **verified** | `rng.ts:16-24`; `miningSlice.ts:67-70` (begin), `:203` (tick via `getMineRng()`); solo defaults to `Math.random` |
| 4 | `stepMonsters`/`stepBeasts` widened to multi-player nearest targeting | MULTIPLAYER_PLAN §3b | **verified** | `mining.ts:1177-1226`, `forest.ts:1248-1259`, shared `floodFieldMulti` (`crawl.ts:114`) |
| 5 | Per-client haul banking; co-op state **separate** from solo run objects | MULTIPLAYER_PLAN:260-261 | **diverged** | Banking is local/trust-client ✓ (`miningSlice.ts:278-285`); but co-op reuses the same `s.mining`/`s.forest` objects — no separate state tree |
| 6 | WebRTC kept as deferred fallback transport | MULTIPLAYER_PLAN | **verified** (never needed) | No WebRTC anywhere in `src/`; Supabase Broadcast only |
| 7 | Server clock closes the clock-cheat vector via `engine/date.ts` | trust-model.md | **verified**, with caveat | `clock.ts:14-26`, `date.ts:17-20`, `App.tsx:106-109`; on fetch failure it **silently** falls back to device time, no retry (`useCloudSync.ts:30-35`) — see MP-17 |
| 8 | RLS owner-only on saves/profiles; party via SECURITY DEFINER RPCs | trust-model.md | **verified** | `0001:23-73`; `0002:69-301`; `0003:24-42` — all seven tables have policies |
| 9 | `increment_party_quest` trusts client contribution | trust-model.md | **verified** | `0006_party_quest_contributions.sql:26` (only guard: `> 0`); one forged call completes any quest |
| 10 | Leaderboard fields client-written, "never computed or capped server-side" | trust-model.md:34 | **stale** | Migration `0009_leaderboard_antimanip.sql:27-89` adds an XP rate-limit trigger + suspect exclusion; surface also grew (mine/forest/arena/tactics depths in 0005, consistency track in 0008) |
| 11 | "No daily limits are enforced server-side" | trust-model.md:36 | **stale** | 0009's 10-min rolling >5,000-XP flag is a server-side (soft) limit; live-deploy status unverified (see Needs manual check) |
| 12 | Tactics co-op flow: HeroJoin → beginTacticsCoop → TacticsIntent → resolveTacticsIntent → full-state rebroadcast | game-analysis:560-566 | **verified** | `useTacticsCoopSession.ts:49-80`; `reduce.ts:338-359`; validation is split: engine enforces turn/range, ownership check is partial (MP-13/23) |
| 13 | 5 s player timeout; `bye` on clean exit; host drop strands guests | game-analysis:558-559,668-674 | **verified** | `protocol.ts:135`; `session.ts:110`; no host-migration code exists anywhere |
| 14 | Co-op world state never persisted | game-analysis:528 | **verified**, with nuance | `useCoopStore` is non-persisted (`session.ts:37-43`); but the run *body* persists like a solo run (no `partialize`) — the orphan is what makes MP-12 possible |
| 15 | Mine/Forest co-op: "host's authoritative HP reconciles contact damage" | game-analysis / MULTIPLAYER_PLAN:252 | **wrong** | Player HP is client-local trust-the-client (`mining.ts:1320-1355` `coopClientStep`); only **monster** HP is host-authoritative |
| 16 | "The most common desync cases have tests" | plan2:856 | **stale/overstated** | All 13 `reduce.ts` exports tested (`reduce.test.ts:10-23`); zero tests for hooks, `session.ts`, or any network-orchestration scenario |
| 17 | Staleness-guard bug at `useTacticsCoopSession.ts:68-71` still reproduces | plan2:1331 | **verified** | Hand-read: guard still compares host `msg.t` against guest `performance.now() - 10_000` — graded here as MP-03 |
| 18 | `coop_sessions.game` comment in 0003 drifted ("'forest'\|'arena' reserved") | game-analysis:634 | **stale** (since fixed) | `0003:14` now reads `'mine'\|'forest'\|'tactics'` and cross-references 0004's CHECK; no drift remains |

## Findings

### [MP-01] Startup cloud pull unconditionally overwrites local state — an offline session is silently rolled back (P0, confidence: high)
- **Area:** src/net/cloudSave.ts, src/hooks/useCloudSync.ts
- **Observation:** Every launch with a session runs `pullCloudSave()` (`useCloudSync.ts:37-44`; `syncingFor` is a ref, reset each app start). When a cloud row exists, the pull overwrites localStorage and rehydrates with **no** local-vs-cloud recency comparison (`cloudSave.ts:132-140`). `lastPulledVersion` (`cloudSave.ts:47`) is module-memory only; nothing persisted records "local has changes not yet pushed". Push failures are swallowed (`cloudSave.ts:192-194`) and the visibility flush uses a plain fetch that a tab close can abort (`cloudSave.ts:251-254`).
- **Prior-doc status:** contradicts MULTIPLAYER_PLAN:127 ("if a local `habits-rpg-save` … is newer/unsynced, offer a one-time import/merge" — no such check shipped); not covered by trust-model.md.
- **Impact:** Play offline (or lose connectivity so the final push fails), close the tab, relaunch → the pull restores the older cloud row and deterministically destroys the entire offline session. Single device; no second device required. This is the worst-case failure for a habit tracker: the user did the habits, logged them, and the app forgets.
- **Recommendation:** Persist a `lastSyncedVersion` (plus a dirty flag) beside the save; on startup, if `cloud.version === lastSyncedVersion` and local differs, **push** local instead of pulling. Anything fancier (field-wise merge) can wait; this one check removes the deterministic loss.

### [MP-02] Forest guest ranged kills diverge permanently — the world merge is intersection-only and can never resurrect a beast (P0, confidence: high)
- **Area:** src/net/coop/reduce.ts, src/hooks/useForestLoop.ts, src/net/coop/protocol.ts
- **Observation:** MINI-32's reducer-side verdict. A guest's ranged attack falls through to local `forestAct`, killing the beast on the guest's local copy with local loot (`useForestLoop.ts:193-200`, `forest.ts:899-931` — verified in section 04). The world merge keeps only entities present in **both** lists: `current.beasts.filter((b) => byId.has(b.id))` (`reduce.ts:218-219`; mine mirror `reduce.ts:121-122` with the policy stated outright at `:120` — "New host monsters not present locally are ignored"). `WorldSliceInput` (`reduce.ts:56-69`) doesn't even carry `key`/`maxHp`, so the reducer *structurally cannot* rebuild a beast the guest killed locally, even though the wire format has `key` (`protocol.ts:28`).
- **Prior-doc status:** confirms and upgrades MINI-32 (section 04, P2 pending this verdict); charter grades desync at P0.
- **Impact:** The beast stays dead on the guest and alive on the host and other guests for the rest of the stage — permanent world divergence during normal play, no refresh or packet loss needed. The guest keeps the local loot while the host can kill the same beast again: limited-spawn loot duplication under client trust.
- **Recommendation:** Two halves: (a) hook — route guest ranged kills through the AttackIntent path like melee; (b) reducer — widen `WorldSliceInput` to include `key`/`maxHp` and make the merge host-authoritative (rebuild from the slice, matching local entries by id, re-instantiating host-alive entities missing locally). (b) also heals any future one-sided divergence, whatever causes it.

### [MP-03] Tactics staleness guard compares two machines' `performance.now()` — guest board freezes for the entire match (P0, confidence: high)
- **Area:** src/hooks/useTacticsCoopSession.ts
- **Observation:** `if (cur && (msg as TacticsState).t < performance.now() - 10_000) return;` (`useTacticsCoopSession.ts:69-70`). `msg.t` is stamped on the **host** (`:125`, host page-uptime ms); the comparison is against the **guest's** page uptime — two unrelated clocks. The guard never reads a timestamp from current state (`HexBattleState` has no `t`; it exists only on the message envelope, `protocol.ts:105`). Failure envelope is binary per pairing: if the guest's page loaded >10 s before the host's, the first `tactics-state` applies (`cur` is null — `beginRun` no-ops for tactics, `session.ts:70`), then **every subsequent broadcast is dropped**. If the guest's tab is younger, the guard is inert (drops nothing).
- **Prior-doc status:** tracked as a known bug in plan2:1331 ("Real bug", unresolved) — the severity grade, exact failure envelope, and fix shape are new.
- **Impact:** In the common case — guest already in the app, host refreshes then hosts — the guest sees the initial board snapshot frozen forever while their intents still reach and mutate the host's real game: total one-way desync of a whole match.
- **Recommendation:** Delete the wall-clock comparison and use the monotonic high-water-mark pattern the mine/forest slices already use (`runRng.ts:59-65`): track last-applied `msg.t`, drop only `t <= lastApplied`, reset on channel subscribe.

### [MP-04] Host refresh resets the world-slice timestamp epoch — guests drop every new slice and their world freezes (P1, confidence: high)
- **Area:** src/net/coop/reduce.ts, src/store/runRng.ts
- **Observation:** `buildWorldSlice` stamps `t: performance.now()` (`reduce.ts:444`), whose origin resets on the host's page reload. The guest's high-water mark (`runRng.ts:59-65,86-92`) is only reset by `setMineRun`/`setForestRun` — which a *staying* guest never calls. `runRng.ts:57` documents the assumption ("reliably monotonic within one session"); host refresh + rejoin of the still-active session row violates it.
- **Prior-doc status:** not covered by any prior doc; sibling of MP-03 (same root class: `performance.now()` treated as a shared clock).
- **Impact:** After a host reload mid-run, every new slice carries `t` near 0 while the guest's mark holds the old host's uptime (minutes-to-hours) — the guest drops all world slices; monsters freeze (guests don't simulate them) until the new host's uptime outgrows the old mark.
- **Recommendation:** Stamp slices with `Date.now()` (monotonic across reloads on one machine), or add a session epoch that resets the guards on (re)join.

### [MP-05] CAS conflict silently discards the losing device's local changes; the code comment claims a merge that doesn't exist (P1, confidence: high)
- **Area:** src/net/cloudSave.ts
- **Observation:** On version conflict the code re-pulls (`cloudSave.ts:195-200`), and `pullCloudSave` replaces localStorage and rehydrates (`:132-140`) — after which the local changes no longer exist. The comment at `:196-197` ("let the next debounce push merged local changes on top") describes behavior that is not implemented. Only signal is `console.info`. Compound case: conflict during an active run → pull is guard-blocked (`:109,137`) → run ends and `commitRun` banks rewards → next push conflicts again → pull now succeeds and wipes the just-banked run.
- **Prior-doc status:** contradicts the code's own documentation; section 01 verified the CAS mechanics but not the conflict-path semantics.
- **Impact:** With two devices on one account, the slower device silently loses everything since its last pull — including a whole finished minigame run — and the player just sees state snap backwards.
- **Recommendation:** Minimum: fix the comment and surface a visible "another device won; progress reverted" notice. Better: before re-pulling, field-wise max-merge the monotonic fields (statXp, gold deltas, deepest-records) or keep-newer by `lastActiveISO`.

### [MP-06] First sign-in clobbers a rich pre-account local save whenever any cloud row exists — and a test asserts the clobber (P1, confidence: high)
- **Area:** src/net/cloudSave.ts, src/net/__tests__/cloudSave.test.ts
- **Observation:** A null owner skips the foreign-save wipe (`cloudSave.ts:116-119` — pristine saves are "adopted by the first account that claims it"), but adoption only happens in the *no-cloud-row* branch (`:141-147`); with a cloud row present, `:132-140` overwrites local unconditionally. `cloudSave.test.ts:317` asserts this as correct behavior, locking the data-loss path in.
- **Prior-doc status:** contradicts MULTIPLAYER_PLAN:126-127 (one-time import/merge offer); not covered elsewhere.
- **Impact:** Weeks of unauthenticated single-player progress destroyed by signing into an account that has any cloud row (created earlier on another device, or a stale fresh row).
- **Recommendation:** When owner is null, the local envelope is non-trivial (level > 1 or habits exist), and a cloud row exists: prompt keep-local vs keep-cloud, or at minimum keep the newer by `lastActiveISO`.

### [MP-07] Sign-out wipes the local save even when the final flush failed (P1, confidence: high)
- **Area:** src/views/SettingsView.tsx, src/hooks/useCloudSync.ts, src/net/cloudSave.ts
- **Observation:** `handleSignOut` awaits `pushCloudSave()` then `signOut()` (`SettingsView.tsx:62-66`), but `pushCloudSave` returns `void` and swallows every failure (`cloudSave.ts:179,192-194`). On session loss `useCloudSync.ts:45-53` calls `wipeLocalSave()` unconditionally; its comment (`:50-51`, "nothing is lost — the cloud copy is untouched") is untrue offline or on any push error/CAS conflict (where the re-pull is also guard-blocked during a run).
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** Sign out while offline → everything since the last successful push is permanently deleted.
- **Recommendation:** Make `pushCloudSave` return success/failure; on failure, confirm with the user before wiping (or skip the wipe for a failed-flush sign-out).

### [MP-08] `joined` never resets when a session ends remotely — guests are auto-attached to the party's next raid, and an active solo run gets overwritten (P1, confidence: high)
- **Area:** src/net/coop/session.ts, src/hooks/useCoopSession.ts, src/views/PartyView.tsx
- **Observation:** `setSession(null)` doesn't touch `joined` (`session.ts:56-58`); the only `setJoined(false)` is inside `leaveCoop` (`:114`). When the host ends the session, guests receive `setSession(null)` via the lobby listener (`useCoopSession.ts:62-64`), and the auto-leave subscription early-returns forever on `!session` (`:161`) — `joined` stays true. When any member later creates a new session, `sessionId` goes non-null with `joined` still true, and the transport effect (`:79-82`) subscribes without the player ever clicking Join. If they're in a solo mine/forest run at that moment, the 100 ms interval broadcasts their solo slices into the session (`:133-139`) and, as a non-host, incoming world slices overwrite their solo monsters with a different seed's world (`:105-109`).
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** Stale "You're in a raid" UI (`PartyView.tsx:179-184`) at best; cross-session state contamination of a live solo run at worst.
- **Recommendation:** Reset `joined` whenever the session disappears or its id changes (compare against the previous id inside `setSession`, preserving the host's own `startCoop` ordering).

### [MP-09] Host tab-close orphans `coop_sessions` rows; dead sessions resurface as joinable zombie raids (P1, confidence: high)
- **Area:** src/net/coop/session.ts
- **Observation:** No `beforeunload`/`pagehide` handler calls `leaveCoop`/`endCoopSession` (grep: only TacticsOverlay's confirm prompt and cloudSave's save flush exist). `endCoopSession` is called solely from `leaveCoop` (`session.ts:113`). `getActiveCoopSession` (`:118-128`) selects any `lobby|active` row, newest first, with no age cutoff.
- **Prior-doc status:** not covered; adjacent to game-analysis's host-disconnect item but a distinct lobby-layer defect.
- **Impact:** Host closes the tab mid-raid → the row stays `active` forever → the panel offers a hostless raid (guests join a world where monsters never move). When the host later creates a second session and *that* one ends, discovery returns the old orphan and the dead raid resurfaces as joinable.
- **Recommendation:** Smallest: in discovery, if `session.host_id === myId && !joined`, reap the orphan (`endCoopSession`). Belt-and-braces: a `started_at` age cutoff in `getActiveCoopSession` (server-side interval filter).

### [MP-10] HeroJoin onto an existing board is a silent no-op — rejoining and second guests hang forever on a null board (P1, confidence: high)
- **Area:** src/hooks/useTacticsCoopSession.ts, src/store/slices/tacticsSlice.ts
- **Observation:** The host's hero-join handler relies on the store subscription firing after `beginTacticsCoop` to broadcast the initial state (`useTacticsCoopSession.ts:61-63`), but `beginTacticsCoop` returns the same state when `s.tactics` exists (`tacticsSlice.ts:119`) → no mutation → no broadcast → the joining guest never receives anything. Triggers: guest refreshes mid-fight and rejoins; a second guest joins (board was built for `[host, firstGuest]`; a later state re-keys to the *host's* hero when the joiner's id isn't in `players`, `reduce.ts:311-313`); Supabase reconnect re-fires SUBSCRIBED → guest re-sends HeroJoin → same no-op, so a guest who missed states during a blip is never resynced.
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** Any Tactics rejoin/reconnect path dead-ends with the guest waiting on a board that will never arrive.
- **Recommendation:** In the hero-join handler, when `store.tactics` already exists, explicitly send the current `tactics-state` instead of calling `beginTacticsCoop`. (True late-join-as-new-hero is a feature; the resend fixes rejoin and reconnect today.)

### [MP-11] Guest attack intents carry raw client-computed damage; the host applies it with zero validation (P1, confidence: high)
- **Area:** src/net/coop/reduce.ts, src/net/coop/protocol.ts, src/hooks/useMiningLoop.ts
- **Observation:** MINI-32's melee half, confirmed reducer-side. `AttackIntent` carries client-computed `dmg` on the wire (`protocol.ts:61-66`; ×1.75 charged multiplier computed inline in the guest hook, `useMiningLoop.ts:164-166,190-192`); `applyMineRemoteAttack` passes it straight to `damageMonsterById` with only a `status !== 'active'` guard (`reduce.ts:171-179`; forest mirror `:271-279`) — no attackRoll variance, no affinity/defense, no stamina cost, no clamp.
- **Prior-doc status:** confirms MINI-32 (section 04); monster HP stays host-authoritative so all clients converge — trust/balance, not desync, hence P1 rather than P0.
- **Impact:** Guests hit through guardian defense stamina-free with deterministic damage; a buggy or modified client one-shots anything.
- **Recommendation:** Replace `dmg` with `{ charged: boolean }` and compute damage host-side from the guest's slice-known stats; interim: clamp `dmg` to a sane per-hit ceiling in the two apply functions.

### [MP-12] `joinCoop` keeps an orphaned persisted run — same-floor slices then merge across different maps (P1, confidence: high)
- **Area:** src/store/slices/miningSlice.ts, src/net/coop/session.ts, src/net/coop/reduce.ts
- **Observation:** ARCH-24's reducer-side verdict. `beginMining` calls `setMineRun(seed…)` *before* the `if (s.mining) return s` guard (`miningSlice.ts:67-73`; forest identical), so joining with a persisted orphan run keeps the old map but re-seeds the RNG/baseSeed; `joinCoop` then proceeds unconditionally (`session.ts:94-100`). If the host's floor differs, the floor-regen branch (`reduce.ts:101-106`) regenerates from the correct seed — self-heals. If the floors *match*, no regen occurs; monster ids collide across seeds (`m${floor}-${i}`, `mining.ts:565`) and the merge (`reduce.ts:117-126`) teleports old-map monsters onto host-map coordinates — walls, unreachable monsters, permanent divergence inside a "shared" session.
- **Prior-doc status:** confirms and completes ARCH-24 (section 01, P3 pending this verdict); upgrade justified by the corruption class.
- **Impact:** A refreshed player rejoining (or joining a new raid while holding an orphaned run) can silently corrupt the shared world with no diagnostic.
- **Recommendation:** In `joinCoop`, clear any existing run before `beginRun` — or make `beginMining`/`beginForest` replace the run whenever an explicit `seed` is passed.

### [MP-13] Guest Tactics attacks are validated against the host's anchored hero — silently dropped once the host has acted, and range-checked from the wrong hex (P1, confidence: high)
- **Area:** src/engine/hexBattle.ts (reached only via src/net/coop/reduce.ts)
- **Observation:** `playerAttack` checks the acting hero's `hasActed` correctly (`hexBattle.ts:696-697`), but the targetable check at `:698` runs on `state` **before** the re-anchor at `:701-703` — and `computeTargetable` reads the anchored `s.player.hex` and bails on `s.player.hasActed` (`:485-486`). `playerCastSpell` has the same shape (`:770` per agent trace). `resolveTacticsIntent` passes intents straight through (`reduce.ts:338-359`).
- **Prior-doc status:** not covered by any prior doc; the co-op path is the only way `heroId ≠ activeHeroId` occurs.
- **Impact:** (a) Once the host's hero has acted, `computeTargetable` returns `[]` and every guest attack/targeted-cast intent is silently dropped for the rest of the turn — to the guest it looks like their clicks do nothing. (b) When the host's hero hasn't acted, range/LoS validate from the *host's* position, accepting geometrically impossible guest attacks (resolved afterward from the guest's hex).
- **Recommendation:** Hoist the re-anchor above the targetable check in `playerAttack`/`playerCastSpell`, or pass the acting hero into `computeTargetable`. Engine-file change, but co-op-only in effect.

### [MP-14] Party-quest reporter double-counts on cloud rehydrate and on uncomplete→recomplete (P1, confidence: high)
- **Area:** src/hooks/useParty.ts
- **Observation:** The reporter baselines `prev` once at effect mount and sends `now - prev` on every store change (`useParty.ts:272-281`). Two holes: (a) `pullCloudSave` rehydrates the whole store (`cloudSave.ts:140`) — at sign-in racing `reloadParty`, and mid-session on any CAS re-pull — so cloud totals exceeding the local baseline are sent as fresh contributions (after an account switch the delta is the account's lifetime completion count, instantly completing the quest); (b) when the metric *decreases* (`uncompleteHabit`), `prev` is lowered to `now` (`:278`), so complete→uncomplete→complete sends +2 for one net completion — repeatable farming. The docstring's "monotonically-increasing metric" premise is false on both counts.
- **Prior-doc status:** extends trust-model's "party quest contributions not defended" from the RPC-forgery angle to two honest-client paths; not covered elsewhere.
- **Impact:** Party quests inflate or complete spuriously without anyone cheating; combined with MP-18 (no deadline) the quest system's numbers are effectively decorative.
- **Recommendation:** Re-baseline `prev` in an `onFinishHydration` callback without sending, and use a high-water mark (`prev = Math.max(prev, now)`).

### [MP-15] Chat loads the oldest 100 messages, not the newest (P1, confidence: high)
- **Area:** src/net/party.ts
- **Observation:** `getMessages` orders `created_at` **ascending** with `limit(100)` (`party.ts:209-217`) — the first 100 rows ever inserted for the party.
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** Once a party's history exceeds 100 messages, every load shows only ancient history; recent backlog is invisible and live inserts append after months-old messages. For an active party this breaks chat outright.
- **Recommendation:** Order descending, `limit(100)`, then reverse client-side.

### [MP-16] Clock offset accepts non-numeric `server_now` — a NaN offset would poison date keys into the save (P2, confidence: high)
- **Area:** src/net/clock.ts
- **Observation:** `setClockOffset(Number(data) - before - rtt / 2)` (`clock.ts:25`); the guard at `:18` only rejects null. A non-numeric payload (e.g. an ISO string if the RPC contract ever changes) yields `NaN` → `now()` produces Invalid Dates → `toISODate()` returns `"NaN-NaN-NaN"`, which gating code persists into `lastCompletedISO`/`lastWeekKey`.
- **Prior-doc status:** not covered; latent (requires a contract change), which keeps it P2 despite the save-corruption blast radius.
- **Impact:** One malformed response corrupts every daily/weekly gate in the save until manually repaired.
- **Recommendation:** `if (!Number.isFinite(t)) return;` — one line, plus a test.

### [MP-17] The clock syncs exactly once — device-clock changes after load shift `now()` 1:1, reopening the spoof vector the seam exists to close (P2, confidence: high)
- **Area:** src/net/clock.ts, src/hooks/useCloudSync.ts
- **Observation:** `syncServerClock()` has one call site, on mount (`useCloudSync.ts:34`); no visibilitychange or interval re-sync exists. `now()` = device time + fixed offset (`date.ts:17-19`). The gate-bypass grep sweep was otherwise clean — every daily/weekly gate routes through the seam.
- **Prior-doc status:** contradicts trust-model.md's implication that the clock-cheat vector is closed; the doc describes sync-at-mount accurately but doesn't consider post-sync clock changes.
- **Impact:** (a) Cheat: sync at load, set the device clock +1 day, re-clear trials/streaks the same real day. (b) Honest harm: an OS/NTP correction after sync inverts the offset error, shifting midnight boundaries mid-session.
- **Recommendation:** Re-sync on `visibilitychange` (visible) and hourly; both are one-line additions to the mount effect.

### [MP-18] Party quest deadlines are fiction — `ends_at` is never read or enforced anywhere (P2, confidence: high)
- **Area:** supabase/migrations, src/net/party.ts
- **Observation:** `ends_at` is set at creation (`0002:271`, server-side `now() + days` — good) and then never consulted: `increment_party_quest` updates any `status='active'` row with no deadline predicate (`0006:28-37`), the only active→expired transition is quest replacement (`0002:267-268`), `getActiveQuest` filters status only (`party.ts:255-262`), and no UI displays or checks it. Found independently by both the party and clock agents.
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** A "7-day" quest accepts progress and completes weeks later; combined with MP-14 the quest loop has neither integrity nor urgency.
- **Recommendation:** Add `and (ends_at is null or ends_at > now())` to the RPC's UPDATE; flip past-deadline rows to `expired` in the reload path; show the deadline in `PartyQuestPanel`.

### [MP-19] No realtime on `party_members` — kicked members keep a live session and rosters go stale for everyone (P2, confidence: high)
- **Area:** src/hooks/useParty.ts, supabase/migrations/0002, src/components/party/PartyChat.tsx
- **Observation:** The hook subscribes to presence, `party_messages`, and `party_quests` only (`useParty.ts:161-199`); `party_members` isn't in the realtime publication (`0002:341-349`). A kicked member stays subscribed, appears in presence, their chat inserts fail silently (send result discarded at `useParty.ts:117-120`; `PartyChat.tsx:31-32` clears the draft regardless), and quest RPCs throw unhandled rejections. Remaining members see the roster change only after their own next mutation (or the hourly token-refresh reload, MP-20).
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** Kicks don't visibly work; messages vanish without error; stale rosters.
- **Recommendation:** Add `party_members` to the publication + a listener calling `reloadParty()`; surface `sendMessage` failures (restore draft + toast).

### [MP-20] Every hourly token refresh tears down the party channel and refetches everything (P2, confidence: high)
- **Area:** src/net/auth.ts, src/hooks/useParty.ts
- **Observation:** `onAuthStateChange` applies every event including TOKEN_REFRESHED (`auth.ts:76`), producing a new `session` object identity ~hourly; `useParty.ts:147-150` (full `reloadParty` on `[session]`) and `:216` (channel resubscribe on `[partyId, session]`) both churn on it.
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** Hourly presence flicker party-wide, a realtime gap during resubscribe (missed messages), and a 5-query refetch per member per hour.
- **Recommendation:** Depend on `session?.user?.id`, not the session object, in both effects.

### [MP-21] Backgrounded host: guests get a frozen world at 1 Hz, then falsely evict the host after ~5 minutes (P2, confidence: medium)
- **Area:** src/hooks/useMiningLoop.ts, src/hooks/useCoopSession.ts
- **Observation:** The rAF loop bails on `document.hidden` (`useMiningLoop.ts:109`), so the host's monster sim stops instantly on alt-tab; the broadcast `setInterval` (`useCoopSession.ts:133-147`) is browser-throttled to ~1 Hz hidden — still inside the 5 s timeout — until intensive throttling (~5 min) reduces it below `COOP_PLAYER_TIMEOUT_MS` and guests' `pruneStalePlayers` evicts the "present" host with a departure toast; on foreground the host pops back as "joined the raid".
- **Prior-doc status:** not covered; browser-throttling specifics are runtime behavior (hence medium confidence — see Needs manual check).
- **Impact:** Any host alt-tab gives guests a threat-free farmable world (monsters frozen, digging still works) plus phantom leave/join toasts.
- **Recommendation:** Host stamps slices with a `hostPaused` flag when hidden (or guests treat a stale world-`t` as "host paused" and show a banner); exclude the host from eviction messaging while world slices still arrive.

### [MP-22] Every host UI selection click broadcasts the full Tactics state, whose unbounded log grows each message all fight (P2, confidence: high)
- **Area:** src/hooks/useTacticsCoopSession.ts, src/store/slices/tacticsSlice.ts, src/engine/hexBattle.ts
- **Observation:** `tacticsSelect` produces a new `tactics` reference (`tacticsSlice.ts:72-73`); the broadcast subscription fires on any reference change (`useTacticsCoopSession.ts:121-126`), sending the complete `HexBattleState` — including the `log`, which nothing caps.
- **Prior-doc status:** not covered; compounds fact-check row 2 (full-world broadcasting) on the free-tier budget the plan called the primary constraint.
- **Impact:** Selection clicks (not just actions) ship full, linearly growing snapshots; long fights inflate every message.
- **Recommendation:** Skip broadcasts where only selection/highlight fields changed; strip or tail-slice `log` from the wire state.

### [MP-23] A Tactics intent with an unknown/stale `heroId` falls back to acting as the host's hero (P2, confidence: high)
- **Area:** src/engine/hexBattle.ts, src/net/coop/reduce.ts, src/hooks/useTacticsCoopSession.ts
- **Observation:** Every intent entry point resolves `state.players?.find((p) => p.id === heroId) ?? state.player` (`hexBattle.ts:639,696,739,761,905`); `resolveTacticsIntent` does no membership check (`reduce.ts:338-359`); the hook guard only blocks `heroId === host userId` (`useTacticsCoopSession.ts:79`) and never cross-checks `msg.heroId === msg.userId`.
- **Prior-doc status:** extends the fact-check row 12 validation nuance.
- **Impact:** A stale or malformed heroId (roster changed, client bug) executes as the *host's* hero — e.g., a spoofed or accidental `endTurn` ends the host's turn. Friendly-trust keeps this P2, but it's an accident vector, not just abuse.
- **Recommendation:** One guard at the top of `resolveTacticsIntent`: reject intents whose `heroId` isn't in `tactics.players`.

### [MP-24] No protocol or app version anywhere on the wire or the session row (P2, confidence: high)
- **Area:** src/net/coop/protocol.ts, src/net/coop/session.ts
- **Observation:** `CoopMessage` has no version field (`protocol.ts:124`); `createCoopSession` inserts only party/seed/host/game/status/started_at (`session.ts:141`); `joinCoop` checks nothing (`session.ts:94-100`).
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** Host and guest on different app versions share a seed but run different `generateMine` code → different maps with colliding monster-id formats → the MP-12 corruption class, silently, with no way to diagnose.
- **Recommendation:** Add a `PROTOCOL_VERSION` const, store it on the session row, refuse joins on mismatch with a coop notice.

### [MP-25] Mid-run joiners get a pristine floor — no tile snapshot or replay exists (P2, confidence: high)
- **Area:** src/net/coop/protocol.ts, src/net/coop/session.ts
- **Observation:** `joinCoop` transfers only the seed (`session.ts:94-100`); WorldSlice covers monsters only (`protocol.ts:38-45`); TileSlice is fire-and-forget peer broadcast (`protocol.ts:74-82`) with nothing persisted or replayed. Also noted by the hooks agent: tiles dug during a guest's network blip diverge permanently — the 10 Hz world slice heals monsters, nothing heals tiles.
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** A late joiner sees ore the host already harvested (re-farmable → per-node duplication, same class as MP-02's dupe) and solid rock where the host carved corridors (host avatar renders inside walls).
- **Recommendation:** Host sends a one-shot changed-tiles snapshot for the current floor when a new PlayerSlice userId appears (`applyPlayerSlice` already returns `isNew`, `reduce.ts:370-380`).

### [MP-26] Three uncoordinated push triggers can self-conflict and roll back ~10 s of local changes with no second device (P2, confidence: high)
- **Area:** src/net/cloudSave.ts
- **Observation:** Debounce, 30 s interval, and visibility flush each call `pushCloudSave()` with no in-flight guard (`cloudSave.ts:232-254`); two overlapping pushes read the same `lastPulledVersion`, the loser's CAS "conflict" re-pull rehydrates from the winner's snapshot, discarding store changes made between the two envelope reads.
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** Occasional unexplained rollback of recent edits on a single device.
- **Recommendation:** Module-level in-flight promise; coalesce concurrent calls.

### [MP-27] trust-model.md is stale in both directions — undocumented server-side defense, undocumented new exposure (P2, confidence: high)
- **Area:** docs/trust-model.md, supabase/migrations
- **Observation:** The doc (2026-06-22) predates migrations 0006–0009. It doesn't know: (a) `0009_leaderboard_antimanip.sql:27-89` adds an XP rate-limit trigger (>5,000 XP per 10-min window → `suspect` flag, excluded from the leaderboard view) — contradicting "never computed or capped server-side"; (b) the leaderboard surface grew (per-mode depth records in 0005, consistency track in 0008); (c) one forged `increment_party_quest` call instantly completes any quest (`0006:26-29`); (d) the clock seam's silent device-time fallback and one-shot sync (MP-17).
- **Prior-doc status:** the finding *is* the doc drift.
- **Impact:** "Revisit this document before building competitive features" is the doc's own instruction — and it's already out of date on exactly those surfaces.
- **Recommendation:** Refresh trust-model.md: document 0009 (and whether it's live — see Needs manual check), the enlarged leaderboard surface, and the party-quest forgery paths; state Option A still holds for *saves* while quest/leaderboard surfaces now warrant the small server-side guards (MP-18's deadline predicate, a `p_amount` ceiling).

### [MP-28] Net-layer test coverage is inverted relative to risk: the pure reducer is 100% covered, the orchestration where every bug lives has zero tests (P2, confidence: high)
- **Area:** src/hooks/, src/net/coop/session.ts, src/net/__tests__/
- **Observation:** All 13 `reduce.ts` exports are tested (`reduce.test.ts:10-23`). Untested: `useCoopSession`, `useTacticsCoopSession`, `useParty`, `useCloudSync` (no `src/hooks/__tests__/` exists), and `session.ts` (no test file). Scenario gaps in existing suites: `cloudSave.test.ts`'s transient-strip test asserts nothing about the pushed payload (its own comment admits it, `:140-174`); no test covers offline-newer-local precedence, sign-out-flush-failure ordering, concurrent-push coalescing, a host-`t` epoch reset, a locally-dead beast present in a host slice, or a wrong-floor slice with undefined baseSeed. Ranked highest-value targets (converging across three agents): (1) `useTacticsCoopSession` message handler (MP-03/MP-10 both live there); (2) `session.ts` lifecycle (MP-08/MP-09); (3) `useCoopSession` message routing; (4) cloudSave conflict/offline scenarios (MP-01/05/07); (5) `usePartyQuestReporter` delta loop (MP-14).
- **Prior-doc status:** confirms plan2's open "co-op desync integration tests" item and sharpens it into a ranked list; supersedes plan2:856's "most common desync cases have tests" framing (stale — see fact-check row 16).
- **Impact:** Every P0/P1 in this section would have been catchable by a plain unit test of the hooks' message handlers with fabricated messages — the layer boundary put all the risk on the untested side.
- **Recommendation:** Start with the two pure-logic wins: extract the tactics message handler into a testable function, and test `session.ts` state transitions directly. Integration-style channel mocks can follow.

### [MP-29] Co-op lifecycle polish batch (P3, confidence: high)
- **Area:** src/hooks/useCoopSession.ts, src/net/coop/
- **Observation:** (a) `send` is published and the 10 Hz interval starts before the channel reports SUBSCRIBED (`useCoopSession.ts:126-133`) — first ~1 s of slices dropped; the tactics hook does it correctly (`useTacticsCoopSession.ts:94-96`). (b) The discovery refetch callback lacks the `active` guard the initial fetch has (`useCoopSession.ts:63` vs `:54-56`) — a party-switch race can write a stale session. (c) A late PlayerSlice after `bye` resurrects the ghost with a spurious join toast (`reduce.ts:370-391`, no tombstone; self-heals in ≤5 s). (d) `WorldSlice.status` is built and typed but never read by any consumer — dead wire weight (`reduce.ts:447`, `protocol.ts:43`). (e) `'lobby'` status is dead (`session.ts:21` vs `:141` always inserting `'active'`), and `joinCoop` never checks `status`. (f) The floor-regen branch is guarded by `baseSeed !== undefined` but the monster merge runs regardless (`reduce.ts:101,117-125`) — unreachable today, one refactor from MP-12-class corruption; add a `slice.floor !== current.floor → return` guard.
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** Races and dead weight; each small, together they make the transport harder to reason about.
- **Recommendation:** Fix (a)/(b)/(f) as one-liners; delete or consume the dead fields in (d)/(e); (c) optional tombstone set.

### [MP-30] Party/chat polish batch (P3, confidence: high)
- **Area:** src/net/party.ts, src/hooks/useParty.ts, src/net/cloudSave.ts
- **Observation:** (a) System messages are forgeable: the ZWSP prefix (`party.ts:235`) isn't stripped from user bodies (`trim()` doesn't remove U+200B), so a member can render authorless "X was kicked" lines. (b) Messages inserted between the history fetch and channel subscribe are missed until next reload (`useParty.ts:70-76` vs `:152-199`); no client rate limit beyond a `sending` flag and a 500-char slice. (c) The final session snapshot can be lost on quit — the visibility flush has no keepalive semantics, and the CAS-conflict path returns before the profiles update (`cloudSave.ts:195-209,251-254`).
- **Prior-doc status:** not covered; all consistent with the friendly-trust framing.
- **Impact:** Chat spoofing, occasional missing message, briefly stale party snapshot.
- **Recommendation:** Strip leading ZWSP on send; re-fetch messages once on SUBSCRIBED; keepalive/sendBeacon for the hidden flush.

### [MP-31] Clock/persistence polish batch (P3, confidence: high)
- **Area:** src/net/clock.ts, src/store/slices/, src/net/cloudSave.ts, tests
- **Observation:** (a) Slice initial state evaluates `weekKey(toISODate())`/`toISODate()` at module load, before clock sync (`challengesSlice.ts:47`, `coreSlice.ts:68`) — affects brand-new saves only. (b) Nothing records "synced vs device-time fallback" for the UI; degraded trust is invisible (`clock.ts:18-21`, `useCloudSync.ts:34`). (c) Client-device timestamps are written to shared DB columns (`cloudSave.ts:187`, `session.ts:141`) instead of Postgres defaults; `coop_sessions.started_at` is never used to age out crashed hosts' rows (feeds MP-09). (d) An RLS-rejected UPDATE returns 0 rows and is logged as a CAS conflict — a misconfigured client would loop pull→push forever with a misleading log (`cloudSave.ts:195-200`). (e) `store.integration.test.ts:186` derives "today" in UTC while the store gates on local day — flaky near midnight in non-UTC zones. (f) `clock.test.ts` never exercises the RTT-compensation term (instant mock), the `supabase === null` branch, or non-finite payloads (MP-16's vector).
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** Observability and hygiene gaps around the seams that MP-01/09/16/17 show are load-bearing.
- **Recommendation:** Fold (b) into a small Settings indicator; let Postgres default the timestamps; distinct log after N consecutive CAS conflicts; fix the test-time derivations alongside MP-16's test.

## Cross-cutting verdicts

**Trust model (the brief's question: does Option A still hold?)** Yes for saves — client-trusted saves with CAS remain the right call for friends-and-family scale, and no finding here argues for save validation. But the *shared* surfaces have outgrown the doc: party quests are forgeable by honest clients (MP-14) and by one RPC call (fact-check row 9), deadlines don't exist in practice (MP-18), the leaderboard surface tripled (row 10), and the clock seam's guarantee is weaker than documented (MP-17). Recommendation, not redesign: keep Option A, add the three cheap server-side predicates (quest deadline, `p_amount` ceiling, the 0009 trigger confirmed live), and refresh trust-model.md (MP-27).

**Plan vs. shipped.** The engine-side plan (seeded RNG, multi-player targeting, host-authoritative monsters) shipped essentially as designed and is the healthiest part of the stack. The divergences that matter: full-world broadcasting instead of deltas (the plan's own primary free-tier risk, compounded by MP-22), player HP quietly becoming client-local rather than host-reconciled (fact-check row 15 — fine under friendly trust, but the docs claim otherwise), and Arena co-op silently dropped while Tactics shipped unplanned — the latter with the thinnest transport layer and both of this section's P0 desync classes adjacent to it.

**Open-item dispositions.** Plan2's "co-op staleness guard" bug → graded MP-03 (P0), fix shape specified; close the plan2 row in favor of this finding. Plan2's "co-op desync integration tests" → still open, superseded by MP-28's ranked list. MINI-32 → resolved: split into MP-02 (P0) + MP-11 (P1); section 04's P2 grade is superseded. ARCH-24 → resolved: confirmed and upgraded into MP-12 (P1). game-analysis's stale migration-comment bullet (row 18) → formally closed, fixed in source.

## Needs manual check

- **Is migration 0009 applied to the live Supabase project?** Its own header says "Live-Supabase verification is required before enabling in production." If not deployed, fact-check rows 10–11 revert to "verified" and MP-27's (a) becomes aspirational. (confidence: low)
- **Browser throttling envelope for MP-21** — the 1 Hz hidden-timer and ~5-min intensive-throttling thresholds are Chromium documented behavior, not observed in this app; the eviction timing needs a two-client playtest. (confidence: medium)
- **Supabase Realtime delivery semantics** — per-sender ordering within a channel (assumed by the monotonic-`t` guards) and whether the SUBSCRIBED callback re-fires on auto-reconnect (MP-10's reconnect trigger, MP-29a's drop window) are SDK runtime behaviors; verify with a forced reconnect. (confidence: medium)
- **Free-tier message budget** — full-slice broadcasting (rows 2, MP-22) against the ~2M msgs/month ceiling is modeled, not measured; the plan's own verification step (measure a session, extrapolate) was never run. (confidence: low)
- **`channel.send` before SUBSCRIBED** — whether early sends are dropped or queued by supabase-js determines MP-29a's real impact. (confidence: low)
