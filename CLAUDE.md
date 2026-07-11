# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # Type-check then build (tsc --noEmit && vite build)
npm run test         # Run all Vitest tests once
npm run test:watch   # Vitest in watch mode
npm run typecheck    # Type-check only (no emit)
```

Run a single test file:
```bash
npx vitest run src/engine/__tests__/habits.test.ts
```

## Architecture

This is a habit-tracking RPG: players log real-life habits to earn XP, level up a character, and spend energy on minigames. The stack is React 18 + TypeScript + Vite + Zustand + Tailwind CSS.

### Layer separation

**`src/engine/`** — Pure, framework-free game logic. Every file here exports plain functions and types with no React or store imports. This is where all rules live (XP formulas, combat resolution, dungeon generation, etc.). Tests go in `src/engine/__tests__/`.

**`src/content/`** — Static data definitions (item tables, encounter scripts, biome configs, gear, recipes, etc.). These feed the engine and store but contain no logic.

**`src/store/useGameStore.ts`** — A thin (~180-line) shell that composes **13 feature slices** (`src/store/slices/*.ts`: core, habits, economy, challenges, battle, dungeon, mining, forest, arena, tactics, trials, town, settings) into one Zustand store with `persist` middleware (localStorage, via a trailing-debounced storage adapter). Holds all serialized game state and every action; actions orchestrate engine modules (call pure engine functions, write results back into state). `src/store/shared.ts` is a barrel of cross-slice helpers that also re-exports `src/store/gameState.ts` (the `GameState` type surface + fresh-state initializers) and `src/store/commit.ts` (reward/run-commit orchestration). `src/store/selectors.ts` contains derived read helpers that components use instead of computing values inline.

**`src/hooks/`** — Real-time loop hooks (`useMiningLoop`, `useForestLoop`, `useArenaLoop`, `useSmoothCamera`). These hold *no game state*; they only fire store actions on a `requestAnimationFrame` clock based on held keys/buttons and board taps. The timing lives here; the rules live in the engine. Mine and Forest are both thin caps instantiations of the shared `useCrawlLoop` (forest-only seams — shrines, ranged intents/tap-aim — enter through optional caps).

**`src/net/`** — Supabase layer: `env.ts` (feature flags), `auth.ts` (session store), `clock.ts` (server-time sync), `cloudSave.ts` (CAS cloud sync), `party.ts` (realtime presence/chat/quests), `coop/` (co-op broadcast for Mine/Forest/Tactics — the shared decision/reducer logic lives in `net/coop/reduce.ts`). This is the only layer that reads env vars or calls the network.

**`src/store/runRng.ts`** — Transient PRNG state for active minigame runs. Kept *outside* the Zustand store and localStorage intentionally (see file docstring) — it does not need to survive a page refresh, and keeping it out of the save avoids bloat. Tests must call `resetRunRng()` in `beforeEach`.

**`src/views/`** — Tab-level React components (`DashboardView`, `DungeonView`, etc.), rendered by `App.tsx` based on a local `tab` state variable. Minigame overlays (`MineRunOverlay`, `ForestRunOverlay`, `ArenaOverlay`, `BattleOverlay`) render on top of the tab content.

**`src/components/`** — Feature-grouped UI components consumed by views.

**`src/lib/`** — Small utilities: `cn.ts` (Tailwind class merging), `sprites.ts` / `minigameArt.ts` / `placeholderArt.ts` (tile/sprite rendering helpers), `scenes.ts` (scene art config), `palettes.ts` (`applyPalette` — the `:root` CSS-variable DOM write, kept here so `engine/palettes.ts` stays DOM-free), `sfx.ts` (Web Audio cues).

### Core game concepts

**Stats:** Eight stats — `DX` (Dexterity), `AG` (Agility), `ST` (Strength), `EN` (Endurance), `WI` (Wisdom), `CH` (Charisma), `KN` (Knowledge), `HP` (Hit Points). Each habit maps to one stat.

**XP ledger vs. stat levels:** `character.statXp` is a per-stat *effort ledger* whose sum drives `character.level` (see `engine/leveling.ts`). It is **not** directly used in combat — `character.statLevels` are the actual combat values, granted as discrete points on each level-up (3 points/level, distributed by recent per-stat effort via `engine/progression.ts::allocateStatGains`). Stat levels freeze between level-ups.

**Level-up flow:** Levels 1–4 auto-advance when XP crosses the threshold (`BOSS_GATE_LEVEL = 5`). Level 5 and above queue a `pendingLevelUp` that the player must clear by winning a boss battle (`startBattle` → `dismissBattle` applies `applyLevelUp`).

**Shared dungeon crawl core (`src/engine/crawl.ts`):** Both the Deep Mine and the Wild Forest are real-time grid crawlers. `crawl.ts` exports the shared geometry (BFS `floodFieldMulti`/`flowStep`, `cameraWindow`, stamina formula, status effect helpers, rune types) plus the hoisted shared crawler logic — spell/rune resolution and the boon effect reducers (`engine/crawl.ts::rollBoonChoices` et al.). `engine/mining.ts` and `engine/forest.ts` each import from it.

**Skill Trials:** Eight daily minigames, one per stat (see `engine/trials/trials.ts`). Each is gated once per calendar day (`trialsClearedOn`). Completions call `store.completeTrial(trialId, score01)` which applies `trialReward` and updates the best score.

**Energy:** Completing any habit awards +1 energy. Every mode entry consumes a fixed energy cost, all bypassed by the `unlimitedEnergy` dev setting: Dungeon Delve `DUNGEON_ENERGY_COST = 3`, Deep Mine `MINE_ENERGY_COST = 2`, Wild Forest `FOREST_ENERGY_COST = 2`, Arena `ARENA_ENERGY_COST = 3`, Hex Tactics `TACTICS_ENERGY_COST = 3`, and each Skill Trial `TRIAL_ENERGY_COST = 1` (trials are no longer free — the once-per-day gate still applies). **The Homestead has NO energy cost** — it is not a run; it is fuelled by *labor*, a separate currency granted once per habit per day (difficulty-scaled, `TOWN_LABOR_DAILY_CAP = 24`/day).

**Persistence:** All state is in one Zustand store persisted to `localStorage`. `withCharacterDefaults` backfills missing character fields when loading old saves.

**Server time / clock seam:** `src/engine/date.ts::now()` is the single chokepoint for "what time is it right now" — every daily/weekly gate (`toISODate`, `weekKey`, streaks, trial resets, weekly rollover, challenge expiry) routes through it. `src/net/clock.ts::syncServerClock()` fetches `server_now()` from Supabase with RTT compensation and calls `setClockOffset(ms)` to shift `now()`. `App.tsx` gates the startup `normalizeHabits()`/`checkWeeklyRollover()` calls on `clockReady` so the first evaluation uses server time. Trust model: **Option A — friendly trust** (client-trusted saves, server clock for anti-spoof, no save validation). See `docs/trust-model.md`.

**The Homestead (`town` slice):** A persistent isometric town-builder (not a run) — the repeatable gold + material sink. Rules live in `src/engine/town.ts` (pure reducer: placement incl. rotation via `footprintDims`, labor pipeline, prestige, perks, refunds); catalogs in `src/content/townBuildings.ts` + `townDecor.ts`; renderer in `src/components/town/` (`iso.ts` projection, `TownCanvas.tsx`, `townArt.tsx` procedural SVG). Placing/upgrading a building charges gold + materials up front, then completes via habit-earned *labor*; completed buildings grant light, non-resource perks that **scale with tier** (`perkValues` — sight, stamina, merchant discount, trial practice, +energy cap, labor discount, +queue slot, Forge sweet-zone) and *prestige*. Decor beside a completed building earns +1 adjacency prestige. **Deed/charter gates read `buildingPrestigeOf` only** (decor never buys land); the three land deeds are followed by open-ended, land-free *charters* at doubling cost — the endless pure-gold sink. Labor grants stamp the exact credited amount on the habit (`lastLaborGrant`) so uncomplete claws back precisely that. `town` is persistent state (persist v34 intro, v37 orphan-project heal; `freshTown()` on old saves) and rides the cloud blob (not in `TRANSIENT_KEYS`). Forward-compat: the future read-only party-visit payload is `TownState` verbatim (`v: 1`) — see the freeze doc block in `engine/town.ts`.

**Minigame run completion:** All four real-time minigames (Mine, Forest, Arena, Tactics) share a single `commitRun(state, opts)` helper in `src/store/commit.ts` (re-exported via `src/store/shared.ts`) — banks rewards, clears active run, updates depth records, applies the habit-streak gold multiplier, calls `applyReward` and `checkLevelUp`. Each mode has a thin wrapper (`commitMining`, `commitArena`, etc.). Dungeon Delve uses a separate `finishRun` helper (intentional — its flow is turn-based, not real-time).
