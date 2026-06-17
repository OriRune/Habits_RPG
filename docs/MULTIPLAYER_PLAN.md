# Plan: Publish HabitsRPG as a Website + Add Multiplayer (Accounts, Parties, Co-op)

## Context

HabitsRPG is today a **100% client-side SPA**: a single Zustand store (`src/store/useGameStore.ts`,
~2150 lines, ~33 top-level state keys + ~42 actions) persisted to browser `localStorage` under the key
`habits-rpg-save`. There is **no backend, auth, router, network code, or env handling** anywhere.

The goal is to (1) publish it as a real website, then (2) make it multiplayer: user accounts, cloud
saves, parties/groups with a party screen, presence, chat, shared/party quests, leaderboards, and
**real-time co-op gameplay in the Mine, Forest, and Arena minigames**.

This is a phased plan. Each phase ships independently and de-risks the next. The **pure engine layer
(`src/engine/`) stays untouched** — it already injects RNG (`RNG = () => number`) and takes time as a
parameter, which is exactly what co-op needs. Decisions locked with the user:

- **Backend:** Supabase (Postgres + Auth + Realtime + Row-Level Security + Storage).
- **Party features:** see each other's progress, chat, shared/party quests, leaderboards, **plus co-op
  Mine/Forest/Arena**.
- **Realtime:** live presence + realtime updates (not just periodic polling).
- **Integrity:** **trust the client** (habits are self-reported; cheating mostly hurts yourself). Co-op
  needs *consistency*, not anti-cheat — solved with host-authoritative simulation, not server validation.

---

## Hosting & free-tier budget

This is a hobby project: **Vercel free tier** for static hosting + **Supabase free tier** for backend.
The plan must live within those limits — a few have real design impact:

- **Supabase Realtime quota** ≈ **2M messages/month** and **~200 concurrent connections** on free tier.
  Phase 2 traffic (presence, chat, quest-progress updates) is low-volume and fits comfortably. The
  expensive part is **co-op broadcast**: a single host streaming a world slice at 15 Hz is ~54k
  messages/hour, so a handful of long sessions would exhaust the monthly quota. **This is the primary
  reason Phase 3 is scoped to a Mine-only MVP with strict message budgeting** (see Phase 3) — and why
  WebRTC data channels are kept as a fallback transport.
- **Supabase project auto-pause:** free-tier projects **pause after ~7 days of inactivity**, adding a
  one-time cold-start delay on the next visit. Acceptable for a low-traffic hobby app; note it so it
  isn't mistaken for a bug.
- **Vercel** static hosting and **Supabase Auth/Postgres** stay well within free limits for this scale.

---

## Phase 0 — Publish single-player (no backend)

Get the current game live first. Pure static hosting.

- **Host:** Vercel or Cloudflare Pages (static `dist/` from `npm run build`). SPA fallback to
  `index.html`.
- **Build optimization** (current bundle is ~609 KB JS + ~1.5 MB bundled fonts):
  - Code-split the three minigame overlays + their engines with `React.lazy` / dynamic `import()` — they
    are currently **statically imported** at `src/App.tsx:14-18` and rendered at `App.tsx:75-78`
    (`MineRunOverlay`, `ForestRunOverlay`, `ArenaOverlay`, `BattleOverlay`) — and/or
    `build.rollupOptions.manualChunks` in `vite.config.ts` (currently no `manualChunks`).
  - Trim `@fontsource` weights to only those used — currently **7 weight/variant imports** in
    `src/main.tsx` (Cinzel 500/600/700, EB Garamond 400/500/600 + 400-italic); consider self-hosted subsets.
- **CI:** add `.github/workflows/ci.yml` running `npm run build` (already gates `tsc --noEmit`) +
  `npm run test` on push/PR. Remote is `github.com/OriRune/Habits_RPG`.
- **Env scaffolding:** introduce `import.meta.env` usage + `.env.example` now (even if unused) so Phase 1
  slots in cleanly: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

**Outcome:** the existing game is publicly playable, still localStorage-only.

---

## Phase 1 — Accounts + cloud save (Supabase Auth + Postgres)

Add identity and move the save off the device, with **minimal disruption to the store**.

### Auth model — username + password, no email (synthetic-email pattern)

This is a low-risk app: **username + password only**. No email, no email confirmation, no password
recovery, no OAuth. We still use **Supabase Auth** (not a hand-rolled auth) so that JWT sessions, refresh
tokens, and `auth.uid()`-based RLS all work for free — we just feed it a *synthetic* email.

- **How it works:** the user types a **username** + **password**. The client normalizes the username
  (trim + lowercase) and maps it to a deterministic fake email — `"<normalized>@habitsrpg.local"` — then
  calls Supabase's standard `signUp` / `signInWithPassword({ email, password })`. The user never sees or
  types the synthetic email; it exists only so Supabase has a unique login key. Username uniqueness is
  enforced both by Supabase's unique-email constraint and by the `profiles.username` unique index.
- **Project settings:** **disable email confirmation** ("Confirm email" off) in Supabase Auth so signup is
  instant with no inbox step; disable all OAuth providers. No SMTP / redirect-URL config needed.
- **Cross-device login (the actual question):** credentials live **server-side** in Supabase Auth, not on
  the device. On any computer, the user enters the same username + password → Supabase returns a JWT +
  refresh token that `supabase-js` persists to that device's `localStorage`, so they stay logged in there
  until they sign out. Same account, any number of machines. No password recovery — forgetting it means
  losing the account (acceptable for this app).
- **No recovery / change later:** an authenticated user *can* change their own password via
  `supabase.auth.updateUser({ password })` if we add a small settings control; not required for v1.

### Backend (Supabase)
- **Tables:**
  - `profiles` — `id uuid PK (= auth.uid())`, `username citext UNIQUE` (the login identity **and** the
    social name shown to other players in parties/leaderboards; `citext` for case-insensitive uniqueness),
    `created_at`, `public_snapshot jsonb` (lightweight, party-readable: `{ level, statLevels, classId,
    streaks, lastActiveISO, currentActivity }`). The in-game **hero name stays separate** — it remains the
    existing cosmetic `character.name` (`useGameStore.ts` Character type, set in `createCharacter`), not a
    login credential. A `display_name` column is optional/redundant now that `username` is the social name.
  - `saves` — `user_id uuid PK`, `state jsonb`, `version int` (write-conflict counter for optimistic
    concurrency, not the schema version), `updated_at`. The `state` blob is the durable `GameState` data
    fields **minus the transient run objects** (`battle/dungeon/mining/forest/arena`), mirroring what
    `migrate()` already nulls (`useGameStore.ts` migrate clears them at ~line 2109).
- **RLS:** `saves` — owner-only read/write. `profiles` — owner writes own row; authenticated users read
  `username/public_snapshot` only.
- **Profile row creation:** on signup, pass the chosen username in `signUp`'s `options.data` (user
  metadata); a `handle_new_user` trigger (`SECURITY DEFINER`, on `auth.users` insert) creates the matching
  `profiles` row with that username. Pre-check availability with a `username` lookup before submitting so
  the user gets a clean "name taken" message instead of a constraint error.

### Client
- **New dir `src/net/`** (keep engine/store layering intact): `supabaseClient.ts`, `auth.ts`,
  `cloudSave.ts`.
- **Login gate + flow:** add `<LoginView />` (a sign-in / sign-up toggle, each just **username + password**)
  and gate at the existing seam — `src/App.tsx:55` (`if (!created) return <CreationView />`). Add
  `if (!session) return <LoginView/>;` *above* the `!created` check. No router needed. Full flow:
  **sign up (username + password) → session established → existing `CreationView`** (hero name, stats,
  weapon, spell via the current `createCharacter` action, `useGameStore.ts:917`) **→ `created` → main app**.
  On a new computer the user just signs in and their cloud save + character load — no re-creation.
- **`auth.ts` helpers (`src/net/`):** `signUp(username, password)` / `signIn(username, password)` that do
  the username→synthetic-email mapping in one place, plus `signOut()` and a session listener
  (`supabase.auth.onAuthStateChange`) feeding the store's session state.
- **Cloud-save adapter — critical perf note:** the store mutates ~10 Hz during minigame ticks. Do **not**
  write to Supabase on every change. Keep the existing Zustand `persist` → `localStorage` as the
  high-frequency local cache, and add a **separate debounced sync** (`cloudSave.ts`): push the durable
  save (strip transient run objects) to `saves` every ~10–30 s and on `visibilitychange`/`beforeunload`.
  On login, **pull** the cloud save; if a local `habits-rpg-save` exists and is newer/unsynced, offer a
  one-time import/merge.
- **Optimistic concurrency (multi-device/tab safety):** with the save in the cloud, two open tabs or
  devices can clobber each other (naive last-write-wins). Use the `saves.version int` column as a
  compare-and-swap guard: remember the `version` last pulled, write with `where version = <pulled>` and
  bump it; on a mismatch (someone else wrote first), re-pull and re-merge before retrying. This is
  separate from the `migrate()` schema version — it is a write-conflict counter.
- **Server "today":** since we trust the client, daily resets stay client-driven via
  `toISODate()` (`src/engine/date.ts`), but fetch server time once on load to anchor "today" and avoid
  accidental clock drift. Reuse existing `toISODate`/`weekKey` — only the *source* of "now" changes.
- **Public snapshot sync:** derive from existing selectors (`src/store/selectors.ts` —
  `selectTotalXp`, `selectLevelProgress`, `selectTopStats`) on a throttle and upsert to
  `profiles.public_snapshot`. This lets party members see progress without reading each other's full save.

**Outcome:** users sign in; progress follows them across devices.

---

## Phase 2 — Social: profiles, parties, presence, chat, quests, leaderboards

### Tables (Supabase)
- `parties` — `id`, `name`, `owner_id` (the "lead"), `invite_code` (short, unique, **human-typeable** —
  e.g. 6 chars, uppercase, ambiguous chars like `0/O/1/I` removed so it can be read aloud / copied from a
  chat message), `max_members`, `created_at`.
- `party_members` — `(party_id, user_id) PK`, `role` (owner/member), `joined_at`.
- `party_messages` — `id`, `party_id`, `user_id`, `body`, `created_at`.
- `party_quests` — `id`, `party_id`, `def jsonb`, `target int`, `progress int`, `status`, `ends_at`.
  Reuse the existing challenge shape (`ChallengeDef`/`ActiveChallenge` from `src/engine/challenges`) as
  the basis for `def` so the engine's progress logic can be reused.
- **Leaderboards:** a Postgres **view** over `profiles.public_snapshot` (total XP, deepest Mine/Forest/
  Arena, best trial scores) — no extra write path. Global + party-scoped (join on `party_members`).
- **RLS:** `parties` and all `party_*` rows are readable/writable only by **members** of that party. This
  creates a deliberate chicken-and-egg (a newcomer isn't a member yet, so plain `SELECT`/`INSERT` is
  blocked) — solved by routing create/join through `SECURITY DEFINER` RPCs that run with elevated rights
  and enforce the rules themselves:
  - **`create_party(name)`** → generates a unique `invite_code`, inserts the `parties` row with
    `owner_id = auth.uid()`, and inserts the caller's `party_members` row as `owner`, atomically; returns
    the new party + code. (Avoids the owner's own first-membership chicken-and-egg too.)
  - **`join_party(code)`** → looks up the party by `invite_code`, checks it exists and `member count <
    max_members`, then inserts the caller's `party_members` row as `member`; returns the party (or a clean
    error: bad code / full / already a member). This is the **only** path a non-member can touch a party.
  - **`leave_party()` / `kick_member(user_id)`** (owner-only) for membership management; quest-progress
    increments stay a `SECURITY DEFINER` RPC for atomicity.

### Realtime (Supabase Realtime)
- **Presence:** one channel per party → online members + `currentActivity` (e.g. "in the Mine").
- **Postgres Changes:** subscribe to `party_messages` inserts (chat) and `party_quests` updates (shared
  progress bar updates live).
- Party quest progress: each member's habit completions call an RPC to increment the active party quest;
  the update broadcasts to all members.

### Client (`src/views/PartyView.tsx` + `src/components/party/`)
- New **Party** tab in `TabBar` (nav is a single `tab` useState in `App.tsx` — additive).
- **When not in a party**, the Party tab shows two actions:
  - **Create a party** → name it, calls `create_party(name)`; the creator becomes the **lead** (owner) and
    sees the generated **invite code** with a copy button to share offline / over chat / etc.
  - **Join a party** → a text field to type the code, calls `join_party(code)`; on success they enter the
    party screen, on failure they get a clear message (bad code / party full / already a member).
- **When in a party**, the Party tab shows the **party screen**: the member roster with each member's
  `public_snapshot` stats/streaks + live presence (online + `currentActivity`), the chat panel, the active
  party quest with combined progress, and the leaderboard tab. The **lead** additionally sees the invite
  code, a rename control, and kick/leave controls; members see a leave control.
- **Invite links (optional convenience):** add **`react-router-dom`** here (first real need) for a
  `/join/:inviteCode` route that just pre-fills the same `join_party` flow — the **typed code is the
  primary path** (codes are shared offline, per the requirement); the link is a nicety, not required. Map
  existing tabs to routes or keep tab state and add just this one route. (No OAuth callback route — auth is
  username/password only.)

**Outcome:** parties exist, members see each other live, chat, share goals, and compete on leaderboards.

---

## Phase 3 — Co-op **Deep Mine** MVP (host-authoritative)

The hardest phase, deliberately scoped to **one game (the Deep Mine)** for the MVP because of the
free-tier Realtime budget (see Hosting & free-tier budget). **Forest and Arena are Phase 3.5 / stretch** —
they reuse the *exact same* pattern, so proving it on the Mine first de-risks them. The code is well-shaped
for this: all three engines (`src/engine/mining.ts`, `forest.ts`, `arena.ts`, shared `crawl.ts`) already
take `RNG = () => number` and a `now` timestamp as parameters and contain **zero internal `Math.random()`**,
and enemy AI is concentrated in **one tick function per game** (`stepMonsters` / `stepBeasts` /
`arenaTick`), making host-authoritative simulation natural.

**Why both a shared seed *and* host-authority?** They cover different things and together avoid the hardest
multiplayer pitfalls:
- **Shared seed = static world-gen parity (bandwidth).** Each client regenerates the *same map/layout*
  locally from the seed instead of the host shipping the whole grid.
- **Host-authority = dynamic entities (consistency).** Only the host runs the tick (enemies, runes,
  projectiles, boss), so there is **no need for lockstep RNG reconciliation and no cross-machine
  floating-point determinism requirement** for the ongoing simulation — those classic co-op headaches
  simply don't arise.

### 3a. Deterministic seeding (engine seams already exist)
- Add **one PRNG util** `src/engine/rng.ts` (e.g. `mulberry32(seed): () => number`) implementing the
  existing `RNG` contract (`crawl.ts:16`, `arena.ts:35`). **No engine signatures change.** (The test
  suites already use a local `mulberry32`/`rngFrom` — promote that into the engine.)
- Thread a shared `seed` into **both** the run start **and every per-tick** store action — today they all
  pass `Math.random` directly:
  - run start: `beginMining` → `generateMine(…, Math.random)` (`useGameStore.ts:1733`).
  - per tick: `mineTick` → `stepMonsters(…, Math.random)` (`useGameStore.ts:1776`).
  - For the MVP only the Mine sites change; the Forest/Arena sites (`beginForest:1839`/`stepBeasts:1882`,
    `beginArena:1938`/`arenaTick:2002`) follow in Phase 3.5. Note `arenaTick` already defaults
    `rng = Math.random` while `stepMonsters`/`stepBeasts` require an explicit arg, so the seeded PRNG must
    be supplied at the **store-action** call sites regardless.
  - Host generates the seed; clients receive it → identical maps.

### 3b. Multi-player simulation (Mine only for MVP)
- Enemy targeting currently assumes one player — `floodField(s.player, …)` at `mining.ts:938` (Forest
  `forest.ts:1114` / Arena `arena.ts:1053` get the same change in Phase 3.5). Extend `stepMonsters` to
  accept **all player positions** and pick target by nearest-player (or per-enemy aggro). This is a
  contained engine change behind the existing function boundary; keep single-player behavior unchanged
  when only one player is present.
- Contact damage / i-frames stay **per-player** (`lastHitAtMs` already per-player in `MineState`).

### 3c. Netcode (Supabase Realtime Broadcast)
- **New `src/net/coop/` module + `src/hooks/useCoopSession.ts`.** Do not put net state in the engine.
- **`coop_sessions` table:** `id`, `party_id`, `game` (`'mine'` for the MVP; `'forest'|'arena'` reserved
  for 3.5), `seed`, `host_id`, `status`, `started_at`. Lobby + seed handshake.
- **Authority model — host-authoritative:**
  - **Host** owns canonical world (enemies, runes, projectiles, boss) and runs `stepMonsters` with the
    seeded rng, broadcasting the **world slice** over a Broadcast channel keyed by session id.
  - **Each client** owns only its own player; broadcasts its **small per-player slice** — already grouped
    in `MineState`: `player {r,c, facing}`, `hp/sta/mp`, `playerStatuses`, queued actions. Local movement
    is client-predicted; host's authoritative HP reconciles contact damage.
- **Message budgeting (free-tier critical):** broadcast Hz is the dominant cost. Target **~8–10 Hz**, not
  15, and send **delta/dirty slices** (only changed enemies/tiles) rather than the full world each frame.
  Record the per-session message estimate (host Hz × seconds × parties) and check it against the ~2M/month
  ceiling before enabling co-op broadly. Forest fog (`seen`) — relevant in 3.5 — stays client-local.
- **Flagged decision (deferred): transport.** If Supabase Broadcast proves too quota-heavy or too laggy
  for the Mine's real-time feel, switch the in-session transport to **WebRTC data channels** (peer-to-peer,
  off the Realtime message quota, lower latency), keeping Supabase only for signaling/lobby. Decide after
  measuring the MVP — not a commitment up front.
- **Shared clock:** ms timestamps (`expiresAtMs`, `readyAtMs`, `nextTickAtMs`) must align between peers →
  use a host-relative clock offset rather than each machine's raw `performance.now()`. `useMiningLoop`
  keeps driving cadence; only the `now` source changes.
- **Rewards:** on run end each client applies its own `haul` to its own save (trust-client). Co-op state
  lives separate from the single-player run objects so solo play is unaffected.
- **Lifecycle:** lobby → seed handshake → start → handle disconnects (host migration or graceful end).

**Outcome:** party members raid the **Deep Mine** together in real time.

---

## Phase 3.5 — Co-op Forest & Arena (stretch)

Once Mine co-op is proven (consistency holds, message budget fits the free tier), apply the **identical
pattern** to the other two games — they were built the same way:
- Add seeded PRNG at their store-action sites (`beginForest:1839`/`stepBeasts:1882`,
  `beginArena:1938`/`arenaTick:2002`).
- Widen `stepBeasts`/`arenaTick` targeting (`forest.ts:1114`, `arena.ts:1053`) to accept all player
  positions, same as `stepMonsters`.
- Reuse `src/net/coop/` and `useCoopSession`; set `coop_sessions.game` to `'forest'`/`'arena'`.
- Forest adds client-local fog (`seen`); Arena is the most latency-sensitive (click-to-aim spells,
  projectiles) — strongest candidate for the WebRTC transport if Broadcast latency disappoints.

**Outcome:** all three minigames are co-op.

---

## Layering / files (respect existing architecture)

- `src/engine/` — unchanged except **add** `src/engine/rng.ts` and widen `stepMonsters` to accept
  multiple player positions (the other two tick functions follow in Phase 3.5). Stays pure/framework-free.
- `src/net/` — **new**: Supabase client, auth, cloud save, presence, co-op netcode. The store calls into
  it; the engine never imports it.
- `src/store/useGameStore.ts` — add auth/session state, debounced cloud sync, co-op session slice. Reuse
  existing `selectors.ts` for public snapshots and `migrate()`'s transient-stripping logic for what to
  persist remotely.
- `src/views/` + `src/components/party/` — `LoginView`, `PartyView`, co-op lobby/overlay.
- `vite.config.ts` / `.env` / CI — Phase 0/1.

---

## Key risks & mitigations

- **Free-tier Realtime quota** (~2M msgs/month): the single biggest co-op constraint — mitigated by the
  Mine-only MVP, ~8–10 Hz delta broadcast, per-session budgeting, and WebRTC as a deferred fallback.
  *(See Hosting & free-tier budget.)*
- **Cloud-save write storms** (store mutates ~10 Hz): debounced/throttled cloud sync + strip transient
  run objects; localStorage remains the high-frequency cache. *(Phase 1 — most important non-co-op risk.)*
- **Multi-device save clobber:** optimistic concurrency via the `saves.version` compare-and-swap; re-pull
  and merge on conflict.
- **Co-op consistency:** host-authoritative + seeded PRNG avoids brittle lockstep RNG reconciliation
  **and** removes any cross-machine floating-point determinism requirement (only the host simulates).
- **Clock skew in co-op:** host-relative clock offset for all ms-timestamp fields.
- **Multi-player enemy targeting:** contained change at the `floodField(s.player…)` site in `mining.ts`
  (Forest/Arena in 3.5); preserve the single-player path.
- **Save migration:** **no server-side migration** — `saves.state` is opaque `jsonb`; the client pulls it
  and runs the existing versioned `migrate()` (now at **v16**, `useGameStore.ts:2051`) on load, exactly as
  it does today against localStorage. The server's `version` column is for **optimistic concurrency**
  (compare-and-swap), not migration. One-time localStorage → cloud import on first login.

---

## Verification

- **Phase 0:** `npm run build` + `npm run test` green in CI; deployed URL loads and plays single-player;
  bundle/font sizes reduced (check `dist/` output).
- **Phase 1:** sign up with a username + password → create character → on a **second browser/device, sign
  in with the same username + password** → character and progress restored from cloud; a wrong password is
  rejected, and a duplicate username is refused at signup; confirm Supabase `saves` row updates only on the
  debounce interval (not every tick) via dashboard logs; with two tabs open, confirm the `version`
  compare-and-swap prevents one tab from silently clobbering the other (the stale writer re-pulls/merges);
  existing engine tests still pass.
- **Phase 2:** two test accounts → one **creates and names a party** (becomes lead, gets an invite code)
  → the other **types that code into "Join a party"** and joins → both appear on the party screen with each
  other's stats + live presence; a wrong code and a full party are both rejected with clear messages; chat
  delivers in realtime; a party quest's progress bar updates for both when one logs a habit; leaderboard
  view ranks both; the lead can kick a member and a member can leave.
- **Phase 3 (Mine MVP):** two clients join a co-op Mine session → assert **identical generated map** from
  the shared seed (log/compare tile grids); both players visible and moving in realtime; an enemy chases
  the nearest player; a kill resolves once (host-authoritative) and each player banks their own haul.
  Measure actual Realtime message volume for a session and extrapolate against the ~2M/month ceiling. Add
  engine unit tests: `mulberry32` determinism, and `generateMine` producing identical output for a fixed
  seed.
- **Phase 3.5:** repeat the Mine smoke test for Forest and Arena; add `generateForest`/`createArena`
  fixed-seed determinism tests.
- **Throughout:** `npm run test` (Vitest) stays green — engine changes are additive and seed-deterministic,
  so existing tests pass by passing a fixed seed where they previously relied on `Math.random`.
