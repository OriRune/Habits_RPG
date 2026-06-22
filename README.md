# Habits RPG

A gamified habit tracker wrapped in a fantasy RPG progression system. Log
real-life habits to earn XP, level up your character, spend Energy on minigames,
and optionally play with friends in real-time co-op.

Built from [`habits_rpg_gameplay_design.md`](./habits_rpg_gameplay_design.md).
Architecture and contribution rules: [`CLAUDE.md`](./CLAUDE.md).
Full doc index: [`docs/INDEX.md`](./docs/INDEX.md).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
npm test           # run the Vitest suite (Node env, ~45 test files)
npm run typecheck  # tsc --noEmit only
```

## What's built

### Core loop
- **Habits** — yes/no or quantity habits, each tied to one of 8 RPG stats
  (DX/AG/ST/EN/WI/CH/KN/HP), with difficulty, frequency, tags, and suspension.
- **XP & stats** — habit completions grant stat XP (quantity scales by %, capped
  at 150%; recovery bonus after a missed day; gear multipliers apply).
- **Leveling** — total XP drives eligible level (`100 × level^1.5`). Levels 1–4
  auto-advance; level 5+ requires winning a boss battle (anti-frustration scaling
  on repeated losses).
- **Classes** — at level 10 your two highest stats pick from an 8×8 class chart
  (ties prompt a choice). Discovered classes fill a **Class Codex**.
- **Challenges** — weekly challenges (count/streak/rival/etc.), custom-authored
  challenges with auto-balanced rewards, weekly rotation.
- **Economy** — gold, materials, crafting, gear (armor/trinket/tool), weapons,
  spells, and a shop.
- **Mood & load warning** — 7-day consistency mood tracker; warns at ≥12 active
  daily habits.

### Minigames (spend Energy earned from habits)
| Minigame | Type | Co-op? |
|---|---|---|
| **Dungeon Delve** | Turn-based branching floor descent | No |
| **Deep Mine** | Real-time grid crawler, dig ore, fight monsters | Yes |
| **Wild Forest** | Real-time grid crawler, forage, fight beasts | Yes |
| **The Arena** | Real-time hex boss duel | No |
| **Hex Tactics** | Turn-based hex skirmish with height advantage | Yes |

### Skill Trials
Eight stat-specific daily microgames (free, once per calendar day):
Lockpicking (DX), Rooftop Chase (AG), Armory Break (ST), Long March (EN),
Spirit Grove (WI), Royal Court (CH), Ancient Library (KN), Last Stand (HP).
Score 1–3 stars; rewards scale with score and character level.

### Optional multiplayer backend (Supabase)
When `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set, the app adds:
- **Accounts** — username/password auth (synthetic-email pattern, no email
  address required). Account-switching guard wipes local save before pulling a
  different user's cloud save, preventing data leaks on shared devices.
- **Cloud save** — debounced compare-and-swap sync to Supabase; localStorage is
  always the fast path; transient run state is never uploaded.
- **Parties** — create/join (6-char invite code), party chat, shared party
  quests with per-member contribution tracking (gold rewards only go to
  contributing members), kick/rename controls, presence labels ("In the Mine",
  "In battle", …).
- **Member habit visibility** — party members can opt-in to publishing their
  active habit names, streaks, and daily completion status, visible only to
  co-party members.
- **Leaderboard** — party or global, sorted by total XP, deepest dungeon/mine/
  forest/arena/tactics floors, or 30-day habit consistency score.
- **Real-time co-op** — Broadcast-channel sync for Deep Mine, Wild Forest, and
  Hex Tactics (mine/forest = 10 Hz host-authoritative; tactics = event-driven).

Without env vars the app is fully functional as a single-player, offline,
localStorage-only app — no account, no server.

## Architecture

```
src/
  engine/        Pure, framework-free game rules (deterministic, RNG-injected)
  engine/__tests__/  Unit tests for all engine modules
  content/       Static data tables (items, weapons, gear, spells, biomes, …)
  store/         Thin Zustand shell + 12 domain slices; selectors
  store/__tests__/   Store integration tests
  hooks/         RAF timing loops (mining/forest/arena/chase) + network hooks
  net/           Supabase layer — env, auth, cloudSave, party, coop/
  views/         Tab-level React screens
  components/    Feature-grouped UI components
  lib/           Utilities: Tailwind class merging, sprite/art helpers, SFX
  assets/        Pixel-art sprites + minigame tiles
```

Strict layering: `engine` (pure) → `content` (data) → `store` (orchestration)
→ `hooks` (timing) → `views`/`components` (UI), with `net/` as the only layer
that reads the environment or calls the network.

Tech: React 18, TypeScript 5.6, Vite 5.4, Zustand 4.5, Tailwind 3.4, Vitest 2.1,
Supabase (optional).

## Backend setup (optional)

1. Copy `.env.example` → `.env.local` and fill in your Supabase URL + anon key.
2. Apply the SQL migrations **manually** in the Supabase dashboard SQL editor, in
   order: `supabase/migrations/0001` → `0002` → … → `0008`.
   (There is no migration runner — apply each file once.)
3. `npm run dev` — the auth gate and multiplayer features will activate.

## Deploy

Vercel, static `dist/` with SPA rewrite (`vercel.json`). Set the two
`VITE_SUPABASE_*` env vars in Vercel's project settings to enable the backend.
