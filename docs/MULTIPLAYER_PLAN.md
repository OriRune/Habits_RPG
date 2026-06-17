# Plan: Publish HabitsRPG as a Website + Add Multiplayer (Accounts, Parties, Co-op)

## Context

HabitsRPG is today a **100% client-side SPA**: a single Zustand store (`src/store/useGameStore.ts`,
~2100 lines, ~32 top-level state keys + ~60 actions) persisted to browser `localStorage` under the key
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

## Phase 0 — Publish single-player (no backend)

Get the current game live first. Pure static hosting.

- **Host:** Vercel or Cloudflare Pages (static `dist/` from `npm run build`). SPA fallback to
  `index.html`.
- **Build optimization** (current bundle is ~609 KB JS + ~1.5 MB bundled fonts):
  - Code-split the three minigame overlays + their engines with `React.lazy` / dynamic `import()`
    (`MineRunOverlay`, `ForestRunOverlay`, `ArenaOverlay`, `BattleOverlay` in `src/App.tsx`), and/or
    `build.rollupOptions.manualChunks` in `vite.config.ts`.
  - Trim `@fontsource` weights to only those used; consider self-hosted subsets.
- **CI:** add `.github/workflows/ci.yml` running `npm run build` (already gates `tsc --noEmit`) +
  `npm run test` on push/PR. Remote is `github.com/OriRune/Habits_RPG`.
- **Env scaffolding:** introduce `import.meta.env` usage + `.env.example` now (even if unused) so Phase 1
  slots in cleanly: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

**Outcome:** the existing game is publicly playable, still localStorage-only.

---

## Phase 1 — Accounts + cloud save (Supabase Auth + Postgres)

Add identity and move the save off the device, with **minimal disruption to the store**.

### Backend (Supabase)
- **Auth:** email/password + at least one OAuth provider (Google).
- **Tables:**
  - `profiles` — `id uuid PK (= auth.uid())`, `username` (unique), `display_name`, `created_at`,
    `public_snapshot jsonb` (lightweight, party-readable: `{ level, statLevels, classId, streaks,
    lastActiveISO, currentActivity }`).
  - `saves` — `user_id uuid PK`, `state jsonb`, `version int`, `updated_at`. The `state` blob is the
    durable `GameState` data fields **minus the transient run objects** (`battle/dungeon/mining/forest/
    arena`), mirroring what `migrate()` already nulls (`useGameStore.ts` migrate at ~line 2069).
- **RLS:** `saves` — owner-only read/write. `profiles` — owner writes own row; authenticated users read
  `username/display_name/public_snapshot` only.

### Client
- **New dir `src/net/`** (keep engine/store layering intact): `supabaseClient.ts`, `auth.ts`,
  `cloudSave.ts`.
- **Login gate:** add `<LoginView />` and gate at the existing seam — `src/App.tsx:55`
  (`if (!created) return <CreationView />`). Pattern: `if (!session) return <LoginView/>;` *above* the
  `!created` check. No router needed for this.
- **Cloud-save adapter — critical perf note:** the store mutates ~10 Hz during minigame ticks. Do **not**
  write to Supabase on every change. Keep the existing Zustand `persist` → `localStorage` as the
  high-frequency local cache, and add a **separate debounced sync** (`cloudSave.ts`): push the durable
  save (strip transient run objects) to `saves` every ~10–30 s and on `visibilitychange`/`beforeunload`.
  On login, **pull** the cloud save; if a local `habits-rpg-save` exists and is newer/unsynced, offer a
  one-time import/merge.
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
- `parties` — `id`, `name`, `owner_id`, `invite_code` (short unique), `max_members`, `created_at`.
- `party_members` — `(party_id, user_id) PK`, `role` (owner/member), `joined_at`.
- `party_messages` — `id`, `party_id`, `user_id`, `body`, `created_at`.
- `party_quests` — `id`, `party_id`, `def jsonb`, `target int`, `progress int`, `status`, `ends_at`.
  Reuse the existing challenge shape (`ChallengeDef`/`ActiveChallenge` from `src/engine/challenges`) as
  the basis for `def` so the engine's progress logic can be reused.
- **Leaderboards:** a Postgres **view** over `profiles.public_snapshot` (total XP, deepest Mine/Forest/
  Arena, best trial scores) — no extra write path. Global + party-scoped (join on `party_members`).
- **RLS:** all `party_*` rows readable/writable only by members of that party; quest progress increments
  via a `SECURITY DEFINER` RPC to keep increments atomic.

### Realtime (Supabase Realtime)
- **Presence:** one channel per party → online members + `currentActivity` (e.g. "in the Mine").
- **Postgres Changes:** subscribe to `party_messages` inserts (chat) and `party_quests` updates (shared
  progress bar updates live).
- Party quest progress: each member's habit completions call an RPC to increment the active party quest;
  the update broadcasts to all members.

### Client (`src/views/PartyView.tsx` + `src/components/party/`)
- New **Party** tab in `TabBar` (nav is a single `tab` useState in `App.tsx` — additive).
- Party screen: member roster with live presence + `public_snapshot` stats/streaks, chat panel, active
  party quest with combined progress, leaderboard tab.
- **Invite links** → add **`react-router-dom`** here (first real need): `/join/:inviteCode` and the OAuth
  redirect callback. Map existing tabs to routes or keep tab state and add only these two routes.

**Outcome:** parties exist, members see each other live, chat, share goals, and compete on leaderboards.

---

## Phase 3 — Co-op Mine / Forest / Arena (host-authoritative)

The hardest phase, but the code is well-shaped for it. All three engines (`src/engine/mining.ts`,
`forest.ts`, `arena.ts`, shared `crawl.ts`) already take `RNG = () => number` and a `now` timestamp as
parameters and contain **zero internal `Math.random()`** — so deterministic shared worlds need only a
seed, and enemy AI is concentrated in **one tick function per game** (`stepMonsters` / `stepBeasts` /
`arenaTick`), making host-authoritative simulation natural.

### 3a. Deterministic seeding (engine seams already exist)
- Add **one PRNG util** `src/engine/rng.ts` (e.g. `mulberry32(seed): () => number`) implementing the
  existing `RNG` contract (`crawl.ts:16`, `arena.ts:35`). **No engine signatures change.**
- Thread a shared `seed` into the run starts, replacing the `Math.random` passed today:
  `beginMining` (~`useGameStore.ts:1733`), `beginForest` (~1839), `beginArena` (~1938), and the per-tick
  rng args. Host generates the seed; clients receive it → identical worlds.

### 3b. Multi-player simulation
- Enemy targeting currently assumes one player — `floodField(s.player, …)` at `mining.ts:938`,
  `forest.ts:1114`, `arena.ts:1053`. Extend the tick to accept **all player positions** and pick target
  by nearest-player (or per-enemy aggro). This is a contained engine change behind the existing function
  boundaries; keep single-player behavior when only one player is present.
- Contact damage / i-frames stay **per-player** (`lastHitAtMs` already per-player in each `*State`).

### 3c. Netcode (Supabase Realtime Broadcast)
- **New `src/net/coop/` module + `src/hooks/useCoopSession.ts`.** Do not put net state in the engine.
- **`coop_sessions` table:** `id`, `party_id`, `game ('mine'|'forest'|'arena')`, `seed`, `host_id`,
  `status`, `started_at`. Lobby + seed handshake.
- **Authority model — host-authoritative:**
  - **Host** owns canonical world (enemies, runes, projectiles, ring-of-fire, boss) and runs the single
    tick function with the seeded rng, broadcasting the **world slice** at ~10–15 Hz over a Broadcast
    channel keyed by session id.
  - **Each client** owns only its own player; broadcasts its **small per-player slice** — already grouped
    in each `*State`: `player {r,c/pos, facing}`, `hp/sta/mp`, `playerStatuses`, queued actions. Local
    movement is client-predicted; host's authoritative HP reconciles contact damage.
  - Forest fog (`seen`) stays client-local.
- **Shared clock:** ms timestamps (`expiresAtMs`, `readyAtMs`, `nextTickAtMs`) must align between peers →
  use a host-relative clock offset rather than each machine's raw `performance.now()`. The loop hooks
  (`useMiningLoop`/`useForestLoop`/`useArenaLoop`) keep driving cadence; only the `now` source changes.
- **Rewards:** on run end each client applies its own `haul` to its own save (trust-client). Co-op state
  lives separate from the single-player run objects so solo play is unaffected.
- **Lifecycle:** lobby → seed handshake → start → handle disconnects (host migration or graceful end).

**Outcome:** party members raid the Mine/Forest/Arena together in real time.

---

## Layering / files (respect existing architecture)

- `src/engine/` — unchanged except **add** `src/engine/rng.ts` and widen the three tick functions to
  accept multiple player positions. Stays pure/framework-free.
- `src/net/` — **new**: Supabase client, auth, cloud save, presence, co-op netcode. The store calls into
  it; the engine never imports it.
- `src/store/useGameStore.ts` — add auth/session state, debounced cloud sync, co-op session slice. Reuse
  existing `selectors.ts` for public snapshots and `migrate()`'s transient-stripping logic for what to
  persist remotely.
- `src/views/` + `src/components/party/` — `LoginView`, `PartyView`, co-op lobby/overlay.
- `vite.config.ts` / `.env` / CI — Phase 0/1.

---

## Key risks & mitigations

- **Cloud-save write storms** (store mutates ~10 Hz): debounced/throttled cloud sync + strip transient
  run objects; localStorage remains the high-frequency cache. *(Phase 1 — most important non-co-op risk.)*
- **Co-op consistency:** host-authoritative + seeded PRNG avoids brittle lockstep RNG reconciliation.
- **Clock skew in co-op:** host-relative clock offset for all ms-timestamp fields.
- **Multi-player enemy targeting:** contained change at the three `floodField(s.player…)` sites; preserve
  single-player path.
- **Save migration:** mirror the existing versioned `migrate()` discipline (v2–v15) server-side; one-time
  localStorage → cloud import on first login.

---

## Verification

- **Phase 0:** `npm run build` + `npm run test` green in CI; deployed URL loads and plays single-player;
  bundle/font sizes reduced (check `dist/` output).
- **Phase 1:** sign up → create character → reload on a second browser/device → progress restored from
  cloud; confirm Supabase `saves` row updates only on the debounce interval (not every tick) via dashboard
  logs; existing engine tests still pass.
- **Phase 2:** two test accounts → one creates a party, other joins via invite link → both see each
  other's live presence + stats; chat delivers in realtime; a party quest's progress bar updates for both
  when one logs a habit; leaderboard view ranks both.
- **Phase 3:** two clients join a co-op Mine session → assert **identical generated map** from the shared
  seed (log/compare tile grids); both players visible and moving in realtime; an enemy chases the nearest
  player; a kill resolves once (host-authoritative) and each player banks their own haul. Add engine unit
  tests: `mulberry32` determinism, and `generateMine/Forest/createArena` producing identical output for a
  fixed seed. Repeat smoke test for Forest and Arena.
- **Throughout:** `npm run test` (Vitest) stays green — engine changes are additive and seed-deterministic,
  so existing tests pass by passing a fixed seed where they previously relied on `Math.random`.
