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

**`src/store/useGameStore.ts`** — Single Zustand store with `persist` middleware (localStorage). Holds all serialized game state and every action. Actions orchestrate engine modules: they call pure engine functions and write the results back into state. `src/store/selectors.ts` contains derived read helpers that components use instead of computing values inline.

**`src/hooks/`** — Real-time loop hooks (`useMiningLoop`, `useForestLoop`, `useArenaLoop`, `useSmoothCamera`). These hold *no game state*; they only fire store actions on a `requestAnimationFrame` clock based on held keys/buttons. The timing lives here; the rules live in the engine.

**`src/views/`** — Tab-level React components (`DashboardView`, `DungeonView`, etc.), rendered by `App.tsx` based on a local `tab` state variable. Minigame overlays (`MineRunOverlay`, `ForestRunOverlay`, `ArenaOverlay`, `BattleOverlay`) render on top of the tab content.

**`src/components/`** — Feature-grouped UI components consumed by views.

**`src/lib/`** — Small utilities: `cn.ts` (Tailwind class merging), `sprites.ts` / `minigameArt.ts` / `placeholderArt.ts` (tile/sprite rendering helpers), `scenes.ts` (scene art config).

### Core game concepts

**Stats:** Eight stats — `DX` (Dexterity), `AG` (Agility), `ST` (Strength), `EN` (Endurance), `WI` (Wisdom), `CH` (Charisma), `KN` (Knowledge), `HP` (Hit Points). Each habit maps to one stat.

**XP ledger vs. stat levels:** `character.statXp` is a per-stat *effort ledger* whose sum drives `character.level` (see `engine/leveling.ts`). It is **not** directly used in combat — `character.statLevels` are the actual combat values, granted as discrete points on each level-up (3 points/level, distributed by recent per-stat effort via `engine/progression.ts::allocateStatGains`). Stat levels freeze between level-ups.

**Level-up flow:** Levels 1–4 auto-advance when XP crosses the threshold (`BOSS_GATE_LEVEL = 5`). Level 5 and above queue a `pendingLevelUp` that the player must clear by winning a boss battle (`startBattle` → `dismissBattle` applies `applyLevelUp`).

**Shared dungeon crawl core (`src/engine/crawl.ts`):** Both the Deep Mine and the Wild Forest are real-time grid crawlers. `crawl.ts` exports the shared geometry (BFS `floodField`/`flowStep`, `cameraWindow`, stamina formula, status effect helpers, rune types). `engine/mining.ts` and `engine/forest.ts` each import from it.

**Skill Trials:** Eight daily minigames, one per stat (see `engine/trials/trials.ts`). Each is gated once per calendar day (`trialsClearedOn`). Completions call `store.completeTrial(trialId, score01)` which applies `trialReward` and updates the best score.

**Energy:** Completing any habit awards +1 energy. Minigame entries consume a fixed energy cost (`DUNGEON_ENERGY_COST`, `MINE_ENERGY_COST`, `FOREST_ENERGY_COST`, `ARENA_ENERGY_COST`). The `unlimitedEnergy` dev setting bypasses this.

**Persistence:** All state is in one Zustand store persisted to `localStorage`. `withCharacterDefaults` backfills missing character fields when loading old saves.
