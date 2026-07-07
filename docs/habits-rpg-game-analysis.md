# Habits RPG — Technical & Gameplay Overview

> A reliable, evidence-based map of the project as it exists today, written as a
> foundation for future improvement planning. Every claim below is tied to actual
> files/functions in the repo. Where something is ambiguous or could not be
> verified, it is called out explicitly.

_Snapshot basis: branch `feature/multiplayer`, persist store schema version 23,
~54,900 lines of TypeScript/TSX across `src/`, 45 test files._

---

## 1. Purpose of the site

Habits RPG is a **gamified habit tracker wrapped in a fantasy-RPG progression
system**. The player logs real-life habits (exercise, reading, etc.); each
completion grants XP toward eight RPG stats, which drive a character that levels
up, earns a class, equips gear, and spends "energy" on a suite of minigames.

The core thesis (stated in `README.md` and `habits_rpg_gameplay_design.md`) is
that **discipline in real life is the only renewable resource that powers the
game**: completing habits is the sole source of Energy, and Energy gates almost
all the play content. The fantasy layer is the reward/feedback skin on top of a
habit-tracking app.

The project began as a **local-first single-player app** (the `README.md` still
describes it that way) and has since grown an **optional Supabase backend** for
accounts, cloud save, parties, chat, leaderboards, and real-time co-op
minigames. The backend is feature-flagged: with no Supabase env vars, the app
runs exactly as the original offline app.

> ⚠️ **Doc drift:** `README.md` is stale. Its "Not yet built (post-MVP
> backlog)" list — "Dungeon expeditions, party raids, skill trials, crafting …
> and real multiplayer" — describes systems that are **all now implemented**.
> Treat `README.md` as historical, not current.

---

## 2. Core user experience & gameplay loop

The primary loop, traced through the code:

1. **Log habits** (`DashboardView` → `completeHabit` in `useGameStore.ts`). Each
   completion awards stat XP and **+1 Energy** (`completeHabit` adds
   `next.character.energy += 1` for today's completions only).
2. **Stat XP accrues** into `character.statXp` (an "effort ledger"), whose sum
   determines the *eligible* character level (`engine/leveling.ts`).
3. **Level up.** Levels 1→4 advance automatically; level **5+ requires winning a
   turn-based boss fight** (`BOSS_GATE_LEVEL = 5` in `engine/progression.ts`;
   gating logic in `checkLevelUp`). Each level grants 3 stat points distributed
   by recent effort (`allocateStatGains`).
4. **Spend Energy** on minigames (Dungeon, Mine, Forest, Arena, Hex Tactics) and
   **play Skill Trials** (free, once/day). These return gold, materials, items,
   and more stat XP, feeding back into leveling.
5. **Equip/craft/shop** with the loot, increasing combat power for harder
   content.
6. **(Optional, online)** join a **party**, chat, share a **party quest**, climb
   a **leaderboard**, and run **co-op** Mine/Forest/Tactics sessions.
7. **Weekly cadence:** a weekly report modal and rotating challenges create a
   week-over-week rhythm (`engine/weekly.ts`, `checkWeeklyRollover`).

App shell: `src/App.tsx` renders a tab UI (`habits`, `challenges`, `character`,
`skills`, `explore`, `battle`, `inventory`, `party`) with the heavy minigame
overlays code-split via `React.lazy`. Gating order in `App.tsx`: auth (if backend
configured) → character creation (`created` flag) → main app.

---

## 3. How habit logging works

Defined in `engine/habits.ts`; orchestrated by `completeHabit`/`uncompleteHabit`
in `useGameStore.ts`.

- **Habit model** (`Habit` interface): an `id`, a target `stat` (one of 8), a
  `type` (`binary` yes/no or `quantity`), optional `target`/`unit`/`uncapped`, a
  `frequency`, a `difficulty`, an optional `tag`, lifecycle `status`
  (`active`/`retired`/`suspended`), a cached `streak`, and a per-day `log`
  (`Record<isoDate, {amount?, xp}>`) which is the **source of truth** for stats.
- **Frequencies** (`Frequency`): `daily`, `weekdays`, `custom` (specific
  weekdays), `times_per_week` (N completions/week), `as_needed` (never
  "missed"). `isScheduledOn`/`isLoggableOn` decide what shows on the dashboard
  per day.
- **XP** (`engine/xp.ts`): base XP by difficulty (`easy 10 → epic 50`). Quantity
  habits scale by completion ratio, **capped at 150%** unless `uncapped`.
  Completing a day-scheduled habit after a gap grants a **+10% recovery bonus**
  (`resolveCompletion`). Equipped gear can further multiply habit XP
  (`gearXpMultiplier`).
- **Streaks** (`currentStreak`): consecutive scheduled days for day habits;
  consecutive successful weeks for `times_per_week`.
- **Editing the past:** `completeHabit(id, actual, dateISO)` and
  `uncompleteHabit` support back-dated edits. Today-only side effects (Energy,
  mood, weekly rollover) are skipped for past-day edits; XP refunds use the
  exact stored per-day XP value.
- **Lifecycle:** retire (hidden, kept), suspend-until-date (auto-resumes via
  `normalizeHabits`/`effectiveStatus`).
- **Mood + load warning:** `recomputeMood` (last-7-days consistency, in
  `engine/mood.ts`) and `selectHabitLoadWarning` (warns at ≥12 daily habits).

---

## 4. How habit challenges work

Two layers: **local single-player challenges** (`engine/challenges.ts`) and
**multiplayer party quests** (separate; see §5).

Local challenges:
- **`ChallengeDef`** has a `kind`: `count`, `quantity`, `streak`, `recovery`,
  `class` (distinct days), or `rival` (beat a snapshot of last week — "vs. past
  self"). Optional `stat`/`tag` filters narrow eligible habits.
- **Progress is always recomputed from habit logs** (`challengeProgress`), not
  incrementally bumped — so streak/recovery/class stay correct regardless of
  completion order. Recomputed inside `completeHabit`/`uncompleteHabit`.
- **Templates** (`CHALLENGE_TEMPLATES`) ship 6 starters (e.g. "The Scholar's
  Week"). Players can author custom challenges via `ChallengeBuilder.tsx`
  (`createCustomChallenge`), with `suggestReward` auto-balancing rewards by
  `goal × duration × kind weight`.
- **Rewards** (`Reward`): gold, stat XP, items, materials, weapons, gear. A
  `partial` reward can trigger at a fraction of the goal. Applied through
  `applyReward` in the store; claimed via `claimChallenge`.
- **Weekly rotation:** `engine/weekly.ts` (`weeklyRotation`) selects a rotating
  set; `rivalGoal` snapshots last week's tally for rival challenges.

---

## 5. How multiplayer parties work

Implemented in `src/net/party.ts` (data access), `src/hooks/useParty.ts`
(realtime + store), `src/views/PartyView.tsx` and `src/components/party/*` (UI),
backed by `supabase/migrations/0002_phase2_parties.sql`.

- **One party per user** (`getMyParty` reads the single `party_members` row).
  Parties have a name, owner, 6-char human-readable `invite_code`
  (`gen_invite_code`, ambiguous glyphs removed), and `max_members` (default 6).
- **Lifecycle via SECURITY DEFINER RPCs:** `create_party`, `join_party`
  (the only path a non-member can touch a party), `leave_party` (auto-transfers
  ownership or deletes the empty party), `kick_member`. The client wraps these
  in `partyActions` (`useParty.ts`) with friendly error mapping
  (`friendlyJoinError`).
- **Realtime channel `party:{id}`** (`useParty`, mounted once in `App.tsx`):
  - **Presence** — online members + a derived activity label (`deriveActivity`:
    "In the Mine", "In battle", …). Re-broadcast only when the label changes,
    not on every 10 Hz store tick.
  - **Chat** — `party_messages` table with live `INSERT` subscription. System
    lines (joins/leaves/raid events) are encoded with a zero-width prefix
    (`SYSTEM_MSG_PREFIX`) to avoid a schema column.
  - **Party quests** — one active shared goal at a time (`party_quests`).
    `usePartyQuestReporter` increments it atomically on every habit completion
    via the `increment_party_quest` RPC. Per-member contribution amounts are
    tracked in a `contributions` JSONB column so gold rewards credit only
    contributing members (added in migration 0006).
- **Member habit visibility** — `member_habits` table (migration 0007): members
  can opt-in to publishing their active habit names, streaks, and today's
  completion status, readable only by co-party members (not the public snapshot).
- **Leaderboard** — a Postgres `view` over `profiles.public_snapshot`
  (`security_invoker`), scoped to party members or global; sorted by total XP.
  Also exposes `deepestTacticsTier` (migration 0005) and `habitScore`
  (30-day habit completion rate 0–100, migration 0008).
- **Co-op raids** — launched from `CoopRaidPanel` in `PartyView` (Deep Mine,
  Wild Forest, Hex Tactics buttons). See §7 + §15 for the protocol.

RLS is **member-scoped** throughout, with an `is_party_member` SECURITY DEFINER
helper used inside policies to avoid the classic self-referential recursion on
`party_members`.

---

## 6. XP, leveling, stats, items, progression

This is the conceptual heart of the game; rules live in `engine/` and the CLAUDE.md
"Core game concepts" section documents the intent.

**Eight stats** (`engine/stats.ts`): DX, AG, ST, EN, WI, CH, KN, HP. Each habit
maps to exactly one.

**Two distinct XP concepts — important and easy to confuse:**
- `character.statXp` — an **effort ledger**. Its *sum* drives the character
  level via `100 × level^1.5` (`engine/leveling.ts`). It is **not** used
  directly in combat.
- `character.statLevels` — the **actual combat values** (~1–25). Granted as
  discrete points on level-up and **frozen between level-ups**.

**Level-up flow** (`checkLevelUp` → `applyLevelUp` in `useGameStore.ts`):
- Levels 1→4 auto-advance. Level `5+` (`BOSS_GATE_LEVEL`) queues a
  `pendingLevelUp`, cleared only by winning a boss (`startBattle` →
  `dismissBattle`).
- Each level grants `POINTS_PER_LEVEL = 3` points. `allocateStatGains`
  distributes them by *recent* per-stat effort (delta since last level) plus a
  class nudge, using a Sainte-Laguë-style spread; `STAT_CAP = 25`,
  `MAX_LEVEL = 50`.
- **Anti-frustration:** repeated boss losses are tracked in `bossLosses` and
  ease the boss (`createBattle(..., { lossesBefore })`).

**Classes** (`engine/classes.ts`): at level 10 (`CLASS_UNLOCK_LEVEL`), an 8×8
chart maps your two highest stats → a class (e.g. ST primary + AG secondary =
"Warrior"). Ties prompt a player choice (`PendingClassChoice` →
`ClassChoiceModal`). Some classes have advanced upgrades (`ADVANCED_CLASSES`).
Discovered classes fill a `codex`.

**Combat stats** (`engine/combatStats.ts`): Defense/Ward are a *separate*
progression earned in dungeons, not from habits, folded into `deriveCombatant`.

**Items / economy:**
- **Inventory** (`Record<key, qty>`), **materials** (crafting),
  **weapons**/**gear** (owned + equipped). Content in `src/content/*.ts`
  (`items`, `weapons`, `gear`, `materials`, `recipes`, `relics`, `spells`,
  `boons`).
- **Gear slots:** `armor`/`trinket`/`tool` (+ a separate equipped weapon). Gear
  aggregates stat bonuses, defense/ward, and habit-XP multipliers
  (`engine/gear.ts`).
- **Crafting** (`engine/crafting.ts`, `craft` action): recipes consume
  materials/gold to produce gear/items.
- **Shop** (`SHOP_ITEMS`): potions, Streak Freeze, spellbooks, bought with gold.
- **Relics** (`engine/relics.ts`): **run-only** dungeon boons/curses that apply
  on top of gear during a dungeon (`fighterFor`).

**Unlock gates** (constants): dungeons at level 3 (`DUNGEON_UNLOCK_LEVEL`),
trials at level 3 (`TRIALS_UNLOCK_LEVEL`), Arena/Tactics have their own unlock
levels (`ARENA_UNLOCK_LEVEL`, `TACTICS_UNLOCK_LEVEL`).

**Energy** (the universal sink): +1 per habit completion; minigame entry costs
fixed Energy (`DUNGEON_ENERGY_COST = 3`, plus `MINE_/FOREST_/ARENA_/TACTICS_ENERGY_COST`).
Skill Trials are free. Dev setting `unlimitedEnergy` bypasses cost.

---

## 7. The minigames (with single- vs multiplayer status)

There are **five "explore/battle" minigames** plus **eight Skill Trials**. The
co-op wire protocol (`src/net/coop/protocol.ts`) defines exactly three co-op
games: `'mine' | 'forest' | 'tactics'`. Everything else is single-player.

| Minigame | Type | Engine | Multiplayer? |
|---|---|---|---|
| **Dungeon Delve** | Turn-based, branching floor map | `engine/dungeon.ts`, `engine/dungeonMap.ts`, `engine/combat.ts` | **Single-player only** |
| **Deep Mine** | Real-time grid crawler | `engine/mining.ts` (+ shared `engine/crawl.ts`) | **Single + co-op** |
| **Wild Forest** | Real-time grid crawler | `engine/forest.ts` (+ `engine/crawl.ts`) | **Single + co-op** |
| **The Arena** | Real-time hex boss duel | `engine/arena.ts`, `engine/grid.ts` | **Single-player only** |
| **Hex Tactics** | Turn-based hex skirmish | `engine/hexBattle.ts`, `engine/hex.ts` | **Single + co-op** |
| **8 Skill Trials** | Short daily skill games | `engine/trials/*` + `components/trials/games/*` | **Single-player only** |

### Dungeon Delve (`DungeonView`, `engine/dungeon.ts`)
Endless descent: each *floor* is a short paced sequence of *rooms*
(`combat`, `elite`, `boss`, `encounter`, `treasure`, `shrine`, `merchant`,
`rest`) on a branching node map (`generateFloorMap`). Combat uses the turn-based
engine; encounters are DnD-style text events (`engine/encounters.ts`). At each
floor checkpoint you **Bank** (leave with loot) or **Descend** (`rest`/`pressOn`
for a boon, harder & richer). Run-only **relics**/**boons** modify the fighter.
Last 10 runs stored in `dungeonHistory`.

### Deep Mine (`MiningView`/`MineRunOverlay`, `engine/mining.ts`)
Real-time grid crawler driven by `useMiningLoop` (a `requestAnimationFrame`
clock firing store actions: `mineMove`, `mineStrike`, `mineDash`, `mineTick`,
`mineCast`, `mineDescend`). Dig rock/ore for materials, fight cave monsters,
descend for richer floors, manage HP/MP/Stamina, pick in-run boons. Falling
keeps a fraction of the haul (`MINE_DEATH_KEEP`). Run score includes the gold
haul.

### Wild Forest (`ForestView`/`ForestRunOverlay`, `engine/forest.ts`)
The forest twin of the mine (`useForestLoop`): forage nodes, fight beasts (some
start dormant/asleep), activate shrines, advance stages. Shares geometry/stamina/
status/rune helpers from `engine/crawl.ts`.

### The Arena (`ArenaView`/`ArenaOverlay`, `engine/arena.ts`)
Real-time **hex** boss duel (`useArenaLoop`): move, melee/ranged/cast, use
items, dodge telegraphs. Bosses scale by tier; authored layouts, minion variants
(bat/archer), boss glyphs/phase scripts (per recent commits). Adjustable speed
(`arenaSpeed`). Reward scales with how much of the boss was worn down
(`damageProgress`). **No co-op path** — not in the `CoopGame` union.

### Hex Tactics (`TacticsView`/`TacticsOverlay`, `engine/hexBattle.ts`)
Turn-based hex skirmish where **tile height matters** (high ground = more
damage/reach) and **Agility** finally pays off (sets move range + climb height).
Pre-match spell loadout (cap 3, plus always-granted Push/Blink/Cleave),
selectable board size, overwatch/Hold reactions, secondary objectives. Co-op is
event-driven (see §15).

### Skill Trials (`TrialsView`/`TrialModal`, `engine/trials/*`)
Eight stat-specific daily microgames, one per stat, **free, once per calendar
day** (`trialsClearedOn` gate; bypassed by `repeatMinigames` dev setting):
- DX **Lockpicking**, AG **Rooftop Chase**, ST **Armory Break**, EN **Long
  March**, WI **Spirit Grove**, CH **Royal Court**, KN **Ancient Library**, HP
  **Last Stand** (`engine/trials/trials.ts`).
- Each returns a normalized 0..1 score → 1–3 stars (`scoreToStars`) and a reward
  scaled by score + character level, with a 25% participation floor
  (`trialReward`). `completeTrial` stamps the day and records the best score.

---

## 8. How the fantasy RPG theme is implemented

- **Narrative skin on real behavior:** habits are "training," Energy is the
  resource, level-ups are gated by boss "Level-Up Trials," and minigames are
  framed as dungeon delving, mining, foraging, arena duels, and courtly
  intrigue.
- **Visual identity:** parchment/wood/gold "tome" aesthetic via Tailwind theme
  tokens (`tailwind.config.js`, `index.css`, classes like `texture-wood`,
  `parchment-*`, `gold-deep`), display fonts **Cinzel** + **EB Garamond**
  (`@fontsource`, loaded in `main.tsx`). Selectable color **palettes** and dark
  mode (`engine/palettes.ts`, `applyPalette`, `AppearanceSection`).
- **Art:** real pixel-art sprites under `src/assets/sprites/**` (gear, weapons,
  relics, potions, materials) and `src/assets/minigame/**` (tiles, trees,
  ore/boulders), with a **placeholder-art fallback** system
  (`lib/placeholderArt.ts`, `lib/sprites.ts`, `lib/scenes.ts`,
  `lib/minigameArt.ts`) that draws framed SVG placeholders until real art exists.
  `sprites_needed.md` tracks the art backlog.
- **Theming of mechanics:** the 8×8 class chart, mood states, classes codex,
  boss/biome flavor (`engine/biomes.ts`, `engine/bosses.ts`,
  `content/encounters.ts`).

---

## 9. Software, frameworks, libraries, languages, tools

From `package.json`:
- **Language:** TypeScript 5.6 (strict project; `tsc --noEmit` gates the build).
- **UI:** React 18.3 + React DOM.
- **Build/dev:** Vite 5.4 (`@vitejs/plugin-react`), with a `@` → `src` path
  alias (`vite.config.ts`).
- **State:** Zustand 4.5 with `persist` middleware (localStorage).
- **Styling:** Tailwind CSS 3.4 + PostCSS + autoprefixer.
- **Icons:** `lucide-react`. **Fonts:** `@fontsource/cinzel`,
  `@fontsource/eb-garamond`.
- **Backend client (optional):** `@supabase/supabase-js` 2.x.
- **Testing:** Vitest 2.1 (Node environment, `test/setup.ts`).
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) — Node 20, `npm ci`,
  `npm run build` (type-check + build), `npm run test`.
- **Deploy:** Vercel (`vercel.json`: build to `dist`, SPA rewrite to
  `/index.html`).
- **Backend infra:** Supabase (Postgres + Auth + Realtime), schema in
  `supabase/migrations/*.sql` (run manually via the Supabase SQL editor).

No state-management/data-fetching library beyond Zustand; no router (tab state
is a local `useState`); no component library (hand-rolled `components/ui/*`).

---

## 10. Project folder structure

```
HabitsRPG/
├─ index.html, vite.config.ts, tailwind.config.js, postcss.config.js
├─ tsconfig.json, vercel.json, package.json, .env.example
├─ .github/workflows/ci.yml
├─ README.md  (stale), CLAUDE.md, habits_rpg_gameplay_design.md, sprites_needed.md
├─ test/setup.ts
├─ supabase/migrations/         0001..0008 SQL (auth+saves, parties, coop, coop-tactics, tactics-leaderboard, quest-contributions, member-habits, consistency-leaderboard)
├─ docs/                        ~30 design/analysis/improvement-plan markdown files
└─ src/
   ├─ App.tsx, main.tsx, index.css, vite-env.d.ts, colorschemes.txt
   ├─ engine/        Pure game logic (no React/store imports) + __tests__/
   │   └─ trials/    Per-trial pure logic + __tests__/
   ├─ content/       Static data tables (items, weapons, gear, spells, biomes, …)
   ├─ store/         useGameStore.ts (thin shell), selectors.ts, shared.ts, runRng.ts, slices/ (12 domain slices), __tests__/
   ├─ hooks/         RAF loops + cloud/party/coop orchestration hooks
   ├─ net/           Supabase layer (env, client, auth, cloudSave, party, coop/)
   ├─ views/         Tab-level screens
   ├─ components/    Feature-grouped UI (arena, tactics, trials, party, dungeon, …)
   ├─ lib/           cn, sprites/art helpers, sfx, scenes
   └─ assets/        Pixel-art sprites + minigame tiles
```

The architecture is documented in `CLAUDE.md` and is **consistently followed**:
strict layering of engine (pure) → content (data) → store (orchestration) →
hooks (timing) → views/components (UI), with `src/net/` as the only layer
allowed to touch the network/environment.

---

## 11. Purpose of each major file & directory

**Engine (`src/engine/`) — pure, framework-free, unit-tested:**
- `stats.ts`, `xp.ts`, `leveling.ts`, `progression.ts` — the stat/XP/level math.
- `habits.ts`, `challenges.ts`, `weekly.ts` — habit model, challenge kinds,
  weekly report/rotation.
- `classes.ts`, `bosses.ts`, `enemies.ts`, `combat.ts`, `combatStats.ts` —
  classes + turn-based combat.
- `dungeon.ts`, `dungeonMap.ts`, `dungeonTypes.ts`, `biomes.ts`,
  `encounters.ts`, `relics.ts` — Dungeon Delve.
- `crawl.ts` (shared geometry/stamina/status/runes), `crawlBiomes.ts`,
  `mining.ts`, `forest.ts` — the two real-time crawlers.
- `arena.ts`, `grid.ts` — Arena (square grid). `hex.ts`, `hexBattle.ts` — Hex
  Tactics (hex grid).
- `trials/*.ts` — per-trial logic (`lockpicking`, `rooftopChase`, `armoryBreak`,
  `longMarch`, `spiritGrove`, `royalCourt`, `ancientLibrary`, `lastStand`; `trials.ts`
  registry). All 8 trials have a dedicated engine file (Spirit Grove's was added in Phase 7).
- `gear.ts`, `weapons.ts`, `materials.ts`, `crafting.ts`, `items.ts`,
  `spells.ts` — items/equipment systems.
- `date.ts`, `rng.ts` (`mulberry32`, `floorSeed`, `randomSeed`), `mood.ts`,
  `palettes.ts` — utilities.

**Content (`src/content/`):** static data tables feeding the engine (no logic) —
`biomes`, `boons`, `encounters`, `forest`, `gear`, `items`, `materials`,
`mining`, `recipes`, `relics`, `spells`, `trials`, `weapons`.

**Store (`src/store/`):** `useGameStore.ts` (~171 lines) — the thin shell that
assembles the persisted Zustand store (config, `migrate`, `merge`) from 12
domain slices in `src/store/slices/` (habitsSlice, challengesSlice,
dungeonSlice, miningSlice, forestSlice, arenaSlice, tacticsSlice, battleSlice,
economySlice, trialsSlice, coreSlice, settingsSlice; ~2,011 lines total across
all slices). `shared.ts` holds cross-slice helpers; `runRng.ts` holds the
module-scope mutable RNG state. `selectors.ts` — derived read helpers used by
components.

**Hooks (`src/hooks/`):** `useMiningLoop`/`useForestLoop`/`useArenaLoop`/
`useChaseLoop` (RAF clocks, no game state), `useSmoothCamera`, audio hooks
(`useChaseAudio`, `useTacticsAudio`), and the network orchestration hooks
(`useCloudSync`, `useParty`, `useCoopSession`, `useTacticsCoopSession`).

**Net (`src/net/`):** `env.ts` (feature flag), `supabaseClient.ts`, `auth.ts`
(username→synthetic-email auth store), `cloudSave.ts` (debounced CAS cloud
sync), `party.ts` (party RPC wrappers), `coop/protocol.ts` + `coop/session.ts`
(co-op wire format + session store).

**Views (`src/views/`):** one per tab + sub-screens (`DashboardView`,
`CharacterView`, `ChallengesView`, `TrialsView`, `ExploreView` → `DungeonView`/
`MiningView`/`ForestView`, `ArenaView`, `TacticsView`, `BattleView`,
`InventoryView`, `PartyView`, `HistoryView`, `SettingsView`, `CreationView`,
`LoginView`, `GrimoireView`).

**Components (`src/components/`):** feature-grouped UI — `ui/` primitives,
`arena/`, `tactics/`, `trials/games/`, `party/`, `dungeon/`, `mining/`,
`forest/`, `combat/`, `habits/`, `character/`, `history/`, `inventory/`,
`layout/`, `minigame/`, `class/`, `weekly/`, `challenges/`, `settings/`.

---

## 12. How the frontend works

- **Single-page React app** mounted in `main.tsx`; `App.tsx` is the shell.
- **No router:** the active tab is local `useState<Tab>`; minigame/battle
  overlays render on top of the tab based on transient store fields
  (`mining`, `forest`, `arena`, `tactics`, `battle`). History/Settings are local
  modals.
- **Code splitting:** the five heavy overlays are `React.lazy`-loaded so each
  engine chunk loads only when first opened (`App.tsx`). `vite.config.ts` splits
  vendor chunks (`react-vendor`, `supabase-vendor`, `vendor`).
- **State access:** components subscribe to `useGameStore` selectors; derived
  data comes from `store/selectors.ts`. Components contain **no game math** —
  they call store actions, which call pure engine functions.
- **Real-time minigames:** the RAF "loop" hooks hold no state; they read held
  keys/buttons and fire store tick/move actions on a clock. Rules live in the
  engine; timing lives in the hook.
- **Theming:** `applyPalette(resolvePalette(...), dark|light)` runs on
  mount/whenever palette or dark mode changes, rewriting CSS variables.
- **Error containment:** `ExploreView` wraps `DungeonView` in a class
  `DungeonErrorBoundary` with a recovery button.

---

## 13. How the backend works (when present)

The backend is **optional and feature-flagged**. `net/env.ts`
`isBackendConfigured()` checks for `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`.
If absent, `supabaseClient` is `null` and the whole network layer is dormant —
pure single-player. There is **no custom server**: the "backend" is Supabase
(Postgres + Auth + Realtime) plus SQL functions.

Schema (`supabase/migrations/`):
- **0001 — auth + saves:** `profiles` (one per auth user; `username` is both
  login identity and social name; `public_snapshot` jsonb), `saves` (one durable
  blob per user, with a CAS `version` counter), `handle_new_user` signup trigger,
  `username_available`, `server_now`. RLS: profiles readable by any
  authenticated user, writable only by owner; saves strictly owner-only.
- **0002 — parties:** `parties`, `party_members`, `party_messages`,
  `party_quests`, the `is_party_member` helper, member-scoped RLS, the party
  RPCs, the invite-code generator, and the `leaderboard` view. Realtime
  publication added for `party_messages` + `party_quests`.
- **0003 — coop_sessions:** lobby/discovery + shared seed for co-op (per-frame
  sync is **not** in Postgres — it's Realtime Broadcast). Host-owned RLS.
- **0004 — coop tactics:** adds a CHECK constraint enumerating co-op games
  (`mine`/`forest`/`tactics`).
- **0005 — tactics leaderboard:** adds a generated `tactics_tier` column on
  `profiles` (extracted from `public_snapshot.deepestTacticsTier`) and updates
  the `leaderboard` view to expose it.
- **0006 — party quest contributions:** adds a `contributions` JSONB column to
  `party_quests` and redefines `increment_party_quest` to accumulate per-member
  amounts atomically, enabling contribution-gated gold rewards.
- **0007 — member habits:** new `member_habits` table where party members can
  publish their habit list (name, streak, completion status); RLS restricts
  reads to co-party members only.
- **0008 — consistency leaderboard:** adds a generated `habit_score` column on
  `profiles` (extracted from `public_snapshot.habitScore`, the 30-day
  completion rate) and updates the `leaderboard` view to include it.

Server authority is deliberately thin: business logic mostly runs client-side;
the DB enforces ownership/membership via RLS + SECURITY DEFINER RPCs, and
`server_now()` exists as a clock-drift defense (see §19 for caveats).

---

## 14. How data is stored, loaded, updated, shared

**Local (always):** the entire `GameState` is persisted to `localStorage` under
key `habits-rpg-save` via Zustand `persist` (schema **version 23**). The store
mutates ~10 Hz during minigames, so localStorage is the high-frequency cache.
- **`migrate`** runs the versioned upgrade chain (documented inline v2→v23):
  transient run objects are nulled, material keys remapped, challenge `metric`→
  `kind`, `statLevels` derived from old `statXp`, v23 added `claimedPartyQuests`
  tracking, etc.
- **`merge`** deep-merges nested `character`/`settings`/trial records so
  fields added in later versions fall back to defaults, and **preserves an
  in-memory live run** over a stale snapshot on rehydrate.

**Cloud (when signed in):** `net/cloudSave.ts` adds a **separate, debounced**
(10s) sync to the Supabase `saves` table, reusing the exact persist envelope as
the cloud blob (so the client's own `migrate()` runs on pull — the server never
migrates). Concurrency via **compare-and-swap** on `saves.version`: it writes
only if the version still matches what it last pulled; on conflict it re-pulls.
Transient run objects (`battle`/`dungeon`/`mining`/`forest`/`arena`/`tactics`)
are stripped before upload, and **a pull is refused while a run is live**
(`hasActiveRun`) to avoid clobbering an in-progress board. Autosync flushes on
store changes, on a periodic interval, and on tab `visibilitychange`.

**Account-switching guard** (`wipeLocalSave`, `getSaveOwner`/`setSaveOwner`/
`clearSaveOwner` in `net/cloudSave.ts`, wired in `hooks/useCloudSync.ts`):
the cloud-save owner's uid is stamped to a separate `localStorage` key on every
pull. If a different user signs in and attempts a pull, the foreign local save
is wiped first to prevent data leaking across accounts on shared devices.
Sign-out also triggers `wipeLocalSave()` to clear the cache.

**Shared between users:**
- A **public snapshot** (`buildPublicSnapshot`: name, level, total XP, top
  stats, class, deepest mine/forest/arena/tactics tier, habit score, last
  active) is written to `profiles.public_snapshot` on the same cadence — this
  is what parties and the leaderboard read. The full save is never exposed to
  other users.
- **Chat/quests** are normal table rows with realtime subscriptions.
- **Co-op world state** is **never persisted** — it streams peer-to-peer over a
  Realtime Broadcast channel (§15).

---

## 15. Authentication, account, party & multiplayer systems

**Auth (`net/auth.ts`):** username + password over Supabase Auth using a
**synthetic-email pattern** — the user only types a username, mapped to
`username@habitsrpg.local`. No email confirmation, recovery, or OAuth. Client
validates username (3–24 chars, `[a-z0-9_]`) and does a friendly
`username_available` pre-check. `useAuthStore` keeps session state **out** of the
persisted game store; `LoginView` gates the app when a backend is configured.

**Account/save:** see §14 (cloud save with CAS).

**Parties:** see §5.

**Real-time co-op (`src/net/coop/`, hooks `useCoopSession` +
`useTacticsCoopSession`):**
- **Discovery** via the `coop_sessions` table (one shared seed + host + status).
- **Transport** via a Supabase Realtime **Broadcast** channel `coop:{sessionId}`
  — deliberately *not* table writes, to stay within free-tier message budgets
  (`COOP_BROADCAST_HZ = 10`).
- **Mine/Forest authority split** (`protocol.ts`): the **host** owns the
  canonical world (monsters/runes) and broadcasts a `WorldSlice`; **each player**
  owns its own body and broadcasts a `PlayerSlice`; tile changes (digs/gathers)
  are peer-to-peer (`TileSlice`) so nodes vanish for everyone while each player
  keeps their own haul; guest melee is host-resolved (`AttackIntent`). The same
  seed (`mulberry32(floorSeed(...))`) regenerates an identical map on every
  client, including on descent. Stale players time out after
  `COOP_PLAYER_TIMEOUT_MS`; clean exits send a `ByeIntent`.
- **Hex Tactics co-op** is **event-driven** (turn-based, not 10 Hz): guest sends
  `HeroJoin` on connect → host builds the shared board (`beginTacticsCoop`) →
  host broadcasts full `TacticsState` after each resolved action; guests submit
  `TacticsIntent`s the host validates (ownership check) and applies. The host is
  the single authority; guests render the host's state re-keyed to their own
  hero id.

> **Arena is intentionally not co-op** — it's absent from the `CoopGame` union
> and the SQL CHECK constraint.

---

## 16. Important APIs, routes, components, scripts, config, data files

- **No HTTP routes** (SPA). "APIs" are Supabase RPCs (`create_party`,
  `join_party`, `leave_party`, `kick_member`, `create_party_quest`,
  `increment_party_quest`, `username_available`, `server_now`) and direct
  table/Realtime access in `src/net/`.
- **Central module:** `src/store/useGameStore.ts` — every gameplay action.
- **Scripts** (`package.json`): `dev`, `build` (`tsc --noEmit && vite build`),
  `preview`, `test`, `test:watch`, `typecheck`.
- **Config:** `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`,
  `tsconfig.json`, `vercel.json`, `.env.example`, `.github/workflows/ci.yml`.
- **Data/”DB” files:** `supabase/migrations/0001..0008.sql` (the only DB
  schema). All game content data lives in `src/content/*.ts`.
- **Key UI components:** overlays `MineRunOverlay`, `ForestRunOverlay`,
  `ArenaOverlay`, `TacticsOverlay`, `BattleOverlay`; hubs `HubGrid`/`TabBar`;
  party `CoopRaidPanel`/`PartyChat`/`PartyQuestPanel`/`CreateJoinPanel`; trials
  `TrialModal` + `components/trials/games/*`.
- **Notable docs:** `habits_rpg_gameplay_design.md` (the original brief the
  engine is built from), `docs/archived/MULTIPLAYER_PLAN.md` (historical; archived),
  and ~28 per-minigame `*-analysis.md` / `*-improvement-plan.md` files.

---

## 17. Build, deployment, local development

- **Local dev:** `npm install` → `npm run dev` (Vite at `localhost:5173`). Runs
  fully offline with no backend (single-player).
- **Optional backend:** copy `.env.example` → `.env.local`, fill
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, and run the four SQL migrations
  **manually** in the Supabase SQL editor (they're idempotent where practical).
  There is **no migration runner/CLI** — applying SQL is a manual, ordered step.
- **Build:** `npm run build` type-checks (`tsc --noEmit`) then `vite build` to
  `dist/`. **Type errors fail the build** (and CI).
- **CI:** GitHub Actions on push-to-main + all PRs: install → build → test.
- **Deploy:** Vercel, static `dist/` with SPA fallback. Env vars must be set in
  the host for the backend to activate in production.
- **Tests:** `npm test` (Vitest, Node env). 45 test files, concentrated in
  `engine/__tests__` + `store/__tests__` (the pure layers).

---

## 18. Fragile / incomplete / duplicated / confusing / poorly organized parts

- **Store has been split into 12 domain slices** (`src/store/slices/`). The
  former god-module is gone — `useGameStore.ts` is now ~171 lines. The
  `dungeonSlice.ts` (399 lines) and the `miningSlice`/`forestSlice` (~260 lines
  each) are the largest slices and still contain dense orchestration logic, but
  the merge-conflict risk and navigation cost are substantially reduced.
- **Repeated `commitX` boilerplate.** `commitMining`/`commitMineDeath`/
  `commitForest`/`commitForestDeath`/`commitArena`/`commitTactics` share a large
  amount of near-identical clone-and-applyReward-and-checkLevelUp structure that
  could be unified (now spread across their respective slices).
- **Module-scope mutable RNG state** (`mineRng`/`mineBaseSeed`/`forestRng`/
  `forestBaseSeed`) lives in `src/store/runRng.ts` outside the store to stay
  out of the save. It works, but it's hidden global state that can surprise
  (e.g. two runs, tests). The extraction to its own module makes it easier to
  find than before.
- **Two XP concepts (`statXp` ledger vs `statLevels`)** are genuinely
  confusing and a frequent source of "why didn't my stat change" reasoning;
  it's well-commented but conceptually heavy.
- **Stale documentation.** `README.md` claims major systems are unbuilt (§1).
  `net/env.ts`'s comment says the accessors "are unused until [Phase 1]" though
  they're now in use. `coop_sessions.game` comment in 0003 says
  "`'forest'|'arena' reserved" but the final supported set is mine/forest/tactics
  (arena was dropped, forest/tactics added). Onboarding readers will be misled.
- ~~**Trial engine inconsistency.** Seven trials have a dedicated `engine/trials/*.ts`; **Spirit Grove has none**.~~ **Fixed (Phase 7, 2026-06-22):** `src/engine/trials/spiritGrove.ts` now exists; all 8 trials are uniform.
- ~~**Docs sprawl.** `docs/` has ~30 overlapping analysis/plan files (e.g. `rooftop-chase-minigame-analysis.md` *and* `...2.md`). Useful history, but no index; hard to know which is current.~~ **Addressed (2026-06-22):** superseded docs archived to `docs/archived/`; `docs/INDEX.md` added with current/archived markers for every file.
- **`colorschemes.txt` / `sprites_needed.md`** are loose working notes checked
  into source.

---

## 19. Bugs, missing features, placeholder systems, technical debt

These are **observations from reading the code**, not verified at runtime —
treat as leads to confirm, not confirmed defects.

- **Placeholder art is a first-class system, not an accident.**
  `lib/placeholderArt.ts`/`sprites.ts`/`scenes.ts` generate framed-SVG
  placeholders, and `sprites_needed.md` tracks the gap. Many entities still have
  no real sprite. This is the largest "incomplete" surface, by design.
- **`server_now()` is wired up (Phase 6, commit `faa6d19`).** `src/net/clock.ts`
  calls `supabase.rpc('server_now')` on app mount, computes a RTT-compensated
  offset, and stores it via `setClockOffset` in `engine/date.ts`. Every daily/
  weekly gate reads "today" through `toISODate()` → `now()`, so the offset
  automatically applies to `trialsClearedOn`, habit resets, streaks, weekly
  rollover, and challenge expiry — with no per-call-site changes required. Startup
  ordering is also safe: `App.tsx` waits for `clockReady` (a promise-settled flag
  from `useCloudSync`) before the first `normalizeHabits`/`checkWeeklyRollover`
  call. In single-player (no backend) the offset stays 0 and device time is used.
- **Energy/score/XP all live in the client-trusted save.** With CAS cloud sync
  but no server-side validation, the leaderboard and party quests are trivially
  manipulable by editing localStorage. This is the accepted trade-off for a
  friends-and-family app (see `docs/trust-model.md` for the explicit decision).
  Server time hardening (`server_now`) closes the *clock-cheat* vector, not the
  *save-edit* vector.
- **Co-op desync edge cases.** Mine/Forest co-op is host-authoritative for
  monsters but peer-to-peer for tiles, with timeout-based player eviction and
  10 Hz broadcast. Host disconnect mid-run, late joiners after several descents,
  and broadcast loss are the classic fragile spots; the `t`/floor staleness
  guards mitigate but don't eliminate them. Tactics co-op funnels everything
  through a single host authority (more robust) but a host drop strands the
  guest.
- **No automated tests for the network/co-op layer.** Tests cover the pure
  engine and store integration; `src/net/`, the hooks, and components are
  untested. The riskiest distributed code is the least covered.
- **`pendingLevelUp` vs in-dungeon battles.** `checkLevelUp` early-returns when
  `state.battle` is set (a trial boss), and dungeon XP only *flags* a level-up
  to apply after the run (`grantStatXp` comment). This interplay is subtle and a
  likely source of edge-case bugs around leveling mid-dungeon.
- **Single party cap.** `getMyParty` assumes one membership row
  (`maybeSingle()`); the schema's composite PK technically allows multiple, so a
  data anomaly would surface as a runtime fetch error.

---

## 20. Anything else important for planning improvements

- **The layering discipline is the project's biggest asset.** Pure `engine/`
  (deterministic, RNG-injected, unit-tested) + data-only `content/` means rules
  can be changed and tested in isolation, and the network layer is cleanly
  quarantined to `src/net/`. Preserve this when refactoring the store.
- **Determinism via seeded RNG (`mulberry32`/`floorSeed`)** is what makes co-op
  possible without streaming the whole map. Any new co-op content should reuse
  this seed-replication pattern rather than broadcasting world geometry.
- **Feature-flagged backend** means improvements can be staged safely: the app
  must keep working with `isBackendConfigured() === false`. Don't let new
  features hard-depend on Supabase without an offline fallback.
- **The save-migration chain is mature (v22).** Any change to persisted shape
  needs a version bump + `migrate`/`merge` handling; the inline changelog in
  `useGameStore.ts` is the model to follow. Cloud blobs reuse the same envelope,
  so client migration covers cloud too.
- **Performance hot path:** the store mutates ~10 Hz in real-time minigames and
  every mutation triggers subscribers (cloud-save debounce, party presence,
  quest reporter). The code already guards these (debounce, change-detection on
  activity label) — keep new subscribers cheap and gated.
- **Good first improvements (low-risk, high-value):** rewrite `README.md`;
  add a `docs/` index and prune duplicate analysis files; add tests around the
  co-op protocol reducers (they're pure enough to test). _(Already done: store
  split into per-domain slices; `deepestTacticsTier` and `habitScore` added to
  snapshot/leaderboard; `server_now()` wired into daily/weekly gating — Phase 6.)_
- **The design brief (`habits_rpg_gameplay_design.md`) is the canonical spec.**
  Many engine comments cite it by section ("brief §7.2", "Section 14"). Read it
  before changing formulas — the numbers are deliberate and tested against it.

---

### Open questions / unverified items
- ~~Is `server_now()` referenced anywhere in the client?~~ **Resolved** — fully
  wired in `src/net/clock.ts` + `engine/date.ts`; see §19 notes above.
- ~~Is there any server-side anti-cheat intended for the leaderboard, or is the
  trust model deliberately "friends only"?~~ **Resolved** — Option A (friendly
  trust) is the explicit decision; see `docs/trust-model.md`.
- Are the duplicate `docs/*-analysis-2.md` files newer than their `-analysis.md`
  counterparts, or abandoned drafts? Their relative authority is unclear.
- ~~Spirit Grove: is the missing `engine/trials/spiritGrove.ts` intentional (simple enough to live in content) or an inconsistency to fix?~~ **Resolved (Phase 7, 2026-06-22):** `src/engine/trials/spiritGrove.ts` now exists; all 8 trials follow the same engine-file pattern.
- The `member_habits` feature (migration 0007) adds party-visible habit data —
  is the opt-in/opt-out UI implemented in `PartyView`, or is the table populated
  automatically?
