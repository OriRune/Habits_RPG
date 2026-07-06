# Audit 2026-07 — Architecture

**Date run:** 2026-07-05 · **Branch:** `feature/multiplayer` · **Sections complete before this one:** none (first section)

Method: fact-checked `docs/habits-rpg-game-analysis.md` + `CLAUDE.md`/`AGENTS.md` against source (4 parallel fact-check agents), then gap-audited four file groups (engine hotspots, store, content/lib, view hotspots) with 4 parallel code-health agents. All P1 candidates and headline drift claims re-verified by hand at the cited lines this session.

## Executive summary

- **The layering discipline broadly holds** — 12 thin slices, `commitRun` unification confirmed (including both death paths), clean import direction, disciplined immutability, and a CI layering guard (`engine/__tests__/layering.test.ts`). One **P1**: `resetGame` omits `ownedGear`/`equipment`, so a wiped save starts the next character with all previous gear (ARCH-01).
- **The biggest structural hazard is the mining/forest twin engines.** ~9 mirrored functions are hand-maintained in both files and have already drifted in three player-visible ways: forest runes never expire, forest `castSpell` skips the known-spells guard, and the two crawlers use different contact-damage mitigation formulas (ARCH-02..06). The same twin-drift pattern repeats in the UI layer (ARCH-14, ARCH-15). Hoisting shared crawler logic into `crawl.ts` is the highest-leverage refactor available.
- **Persistence is the highest-blast-radius risk area:** the full save (habit logs + live run boards) is JSON-serialized to localStorage on every accepted tick (~8–11 Hz during runs, no partialize/throttle) (ARCH-07), and the v2→v27 migrate/merge chain that guards every veteran save has zero direct tests (ARCH-08).
- **The layer contract leaks at the edges the CI guard can't see:** boon effect reducers live in `content/` and are imported *by* the engine (ARCH-11), `engine/palettes.ts` mutates the DOM (ARCH-12), Lockpicking's whole simulation lives in its component (ARCH-13), and `shared.ts` is accreting pure game rules (dungeon room lifecycle, class-choice policy, XP tuning constants) (ARCH-10). The guard only scans `src/engine/` for forbidden *imports* — none of these are caught.
- **The prior analysis doc is directionally sound but several of its complaints are already fixed** (README rewritten, commitX unified, net-layer tests added, env.ts comment corrected), while the doc set has drifted again: persist v23→v27, trials now cost energy, 45→54 test files, `docs/INDEX.md` has broken links and an unindexed file (ARCH-18).

Two corrections to this audit's own brief: there are **12** store slices, not 14; and the "5 untested trials" do have direct coverage via `src/engine/trials/__tests__/trials.test.ts:4-63` — the real untested-logic list is `palettes.ts`, `mood.ts`, `combatStats.ts` (ARCH-12, ARCH-26).

## Prior-doc fact check

| # | Claim | Source doc | Verdict | Evidence |
|---|-------|-----------|---------|----------|
| 1 | `useGameStore.ts` is a ~171-line shell over 12 slices (~2,011 ln) | game-analysis §10/§18 | **verified** (counts drifted) | `useGameStore.ts:34-61` — exactly 12 `createXSlice` spreads; now 179 ln shell, 2,265 ln slices |
| 2 | Persist schema version 23, migrate chain v2→v23 | game-analysis §14 | **stale** | `useGameStore.ts:65` — `version: 27`; v24 focus habits, v25 balance ledger, v26 welcome card, v27 mine tombstone |
| 3 | `commitX` boilerplate is duplicated and "could be unified" | game-analysis §18 | **stale** (fixed) | `store/shared.ts:1056` `commitRun`; all 6 wrappers delegate (`shared.ts:1131-1279`); CLAUDE.md's description is current |
| 4 | `runRng.ts` module-scope RNG, tests call `resetRunRng()` | CLAUDE.md | **verified** | `runRng.ts:27-32,101-108`; called in `store.integration.test.ts:68-72` et al. (+2 newer co-op staleness globals) |
| 5 | Components use `selectors.ts` instead of inline derivation | CLAUDE.md | **verified** (with dead exports — ARCH-20) | 187 ln, imported by 9 files incl. DashboardView, InventoryView, BattleScene |
| 6 | Every `src/engine/` file is pure (no React/store/net, no globals) | CLAUDE.md / game-analysis §10 | **wrong** (one file) | Imports clean everywhere (CI-enforced by `layering.test.ts`), but `palettes.ts:419-430` mutates `document.documentElement` |
| 7 | `100×level^1.5`; 3 pts/level; STAT_CAP 25; MAX_LEVEL 50; BOSS_GATE 5 | game-analysis §6 | **verified** | `leveling.ts:11-13`; `progression.ts:12-18`; Sainte-Laguë at `progression.ts:112` |
| 8 | `checkLevelUp` early-returns during battle; dungeon defers boss-gated levels | game-analysis §19 | **verified** | `shared.ts:846-857`; `dungeonSlice.ts:152,244` (auto-levels <5 still apply mid-run, as documented) |
| 9 | `crawl.ts` exports shared geometry/stamina/status/runes to both crawlers | CLAUDE.md | **verified** | `crawl.ts:48-241`; imported at `mining.ts:61-63`, `forest.ts:61-63` |
| 10 | Energy: DUNGEON=3 + MINE/FOREST/ARENA costs; **Skill Trials are free** | CLAUDE.md / game-analysis §6 | **stale** | Trials cost energy now: `trials/trials.ts:104` `TRIAL_ENERGY_COST = 1`, charged at `trialsSlice.ts:36,57`. Current: DUNGEON 3, MINE 2, FOREST 2, ARENA 3, TACTICS 3 (`hexBattle.ts:31`). CLAUDE.md omits both TACTICS and TRIAL costs |
| 11 | All 8 trials have engine files; `trialReward` 25% floor | game-analysis §7 | **verified** | 8 files + `trials.ts` registry; `trials.ts:129-133` |
| 12 | Clock seam: `server_now()` + RTT → `setClockOffset`; App gates on `clockReady` | CLAUDE.md | **verified** | `net/clock.ts:14-25`; `App.tsx:105-109` |
| 13 | cloudSave: 10s debounce, CAS on version, transient strip, pull refused mid-run, owner-switch wipe | game-analysis §14 | **verified** | `cloudSave.ts:23,42,54-57,185-201,116-119`; `useCloudSync.ts:42-52` |
| 14 | Co-op protocol: mine/forest/tactics, 10 Hz, WorldSlice/PlayerSlice/TileSlice/AttackIntent/ByeIntent, 5s timeout | game-analysis §15 | **verified** | `coop/protocol.ts:23,37-90,132,135`; `useCoopSession.ts:141-145` |
| 15 | "No automated tests for the network/co-op layer" | game-analysis §19 | **stale** | `net/coop/__tests__/reduce.test.ts` (657 ln), `net/__tests__/` cloudSave (467), clock (134), party (113). Also `net/coop/reduce.ts` (458 ln) post-dates the doc's architecture map. Still true: zero tests under `src/hooks/` |
| 16 | `env.ts` has a stale "unused until Phase 1" comment | game-analysis §18 | **stale** (fixed) | `env.ts:1-13` rewritten; no "unused" wording remains |
| 17 | README is stale ("Not yet built" lists shipped systems) | game-analysis §1 | **stale** (fixed) | README fully rewritten — "What's built" covers all five minigames, trials, crafting, dev tools, multiplayer (README.md:27-118) |
| 18 | `docs/INDEX.md` has markers for every file | game-analysis §18 | **stale** (drifted again) | See ARCH-18: audit charter unindexed; two links point at pre-archive paths; one file mis-sectioned |
| 19 | App shell: 8 tabs, lazy overlays, auth→creation→app, DungeonErrorBoundary | game-analysis §2/§12 | **verified** | `App.tsx:37-51,54,113-124,135-142`; `ExploreView.tsx:9-32,77-79` |
| 20 | 10 Hz subscribers are guarded (debounce / activity-label diff / quest delta) | game-analysis §20 | **verified** | `cloudSave.ts:232-245`; `useParty.ts:201-210,272-281` |
| 21 | 45 test files | game-analysis header | **stale** | 54 now (37 engine/__tests__, 2 engine root, 2 trials, 5 store, 4 net, 3 lib, 1 components) |
| 22 | ~54,900 lines of TS/TSX in src/ | game-analysis header | **stale** | ~63,100 lines across 263 files (+15%) |

## Findings

### [ARCH-01] resetGame leaks ownedGear and equipment into the next character (P1, confidence: high)
- **Area:** src/store/slices/coreSlice.ts
- **Observation:** The `resetGame` reset object (`coreSlice.ts:157-200`) enumerates every other GameState field — inventory, materials, weapons, combatStats, codex, tombstone, `claimedPartyQuests` — but omits `ownedGear` and `equipment` (declared at `economySlice.ts:17-18,43-44`). Verified by hand this session.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** A fresh start keeps all previously crafted/purchased armor, trinkets, and tools — including habit-XP-multiplying gear — corrupting new-character balance and leaking state across characters on a shared device.
- **Recommendation:** Add `ownedGear: [], equipment: { armor: null, trinket: null, tool: null }` to the reset object, and add a test asserting reset state deep-equals initial slice state (which also catches future omissions in this hand-maintained list).

### [ARCH-02] Forest runes never expire (drift from mine) (P2, confidence: high)
- **Area:** src/engine/forest.ts
- **Observation:** Mine prunes runes on lifetime: `mining.ts:1161` keeps only `r.expiresAtMs > nowMs`. Forest sets `expiresAtMs: nowMs + 30000` (`forest.ts:1055`) but its survivor filter checks only `!triggered.has(r.id)` (`forest.ts:1234-1236`) — `expiresAtMs` is never read anywhere in forest.ts. Verified by hand.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** Forest rune traps are permanent for the stage — free damage and a growing `runes` array in persisted state; diverges silently from the mine's 30 s design.
- **Recommendation:** Add `&& r.expiresAtMs > nowMs` to the forest survivor filter (and run the filter even when `triggered.size === 0`). Root cause is ARCH-06.

### [ARCH-03] Forest castSpell missing the knownSpells guard (drift from mine) (P2, confidence: high)
- **Area:** src/engine/forest.ts
- **Observation:** `mining.ts:949` rejects unknown spells (`if (!state.knownSpells.includes(spellKey)) return state;`); forest's `castSpell` (`forest.ts:1036-1042`) checks status/cooldown/MP only — no ownership check. Verified by hand.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** Any spell key reaching the store action casts in the forest (dev tools, co-op intents, future UI bugs); the engine invariant is enforced in one crawler only.
- **Recommendation:** Add the same one-line guard at the top of forest `castSpell`.

### [ARCH-04] Mine and forest use different contact-damage mitigation formulas (P2, confidence: high)
- **Area:** src/engine/mining.ts, src/engine/forest.ts
- **Observation:** Mine: `raw - s.defense - (bless ? bless.magnitude : 0) - boonDefenseBonus(...)` (`mining.ts:1264`) — defense always applies, bless adds its magnitude. Forest: `raw - (bless ? s.defense : 0) - s.ward - boonDefenseBonus(...)` (`forest.ts:1408-1409`, repeated in `coopClientStep` at `forest.ts:1475-1476`) — defense only counts while blessed, bless magnitude is unused, and ward (magic mitigation) reduces physical contact damage. Forest carries a comment (`forest.ts:1406-1407`) claiming the bless-gating is deliberate, so this is a documented-on-one-side design fork, not a plain typo. Verified by hand.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** Defense/ward behave oppositely in the two crawlers; players can't form a correct mental model, and balance tuning of either stat lands differently per mode. At minimum an undocumented balance fork; feed to section 03.
- **Recommendation:** Decide the intended rule once (mine's matches the arena convention), document it, and apply it in a single hoisted helper (ARCH-06). Flag for the balance section rather than silently "fixing" either side.

### [ARCH-05] Dead `newOccupied` set — monsters/beasts can stack on one cell per tick (P2, confidence: high)
- **Area:** src/engine/mining.ts, src/engine/forest.ts
- **Observation:** Both step functions build and maintain a `newOccupied` set (`mining.ts:1230,1249-1250`; `forest.ts:1338,1364-1365`) that is never read; the per-unit `blocked` set (`mining.ts:1241-1244`, `forest.ts:1349-1352`) uses only pre-move positions, so two units can choose the same destination in the same tick.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** Overlapping monsters: `monsterAt`/`beastAt` find only the first, hiding the second unit's HP bar and doubling the contact threat from one cell.
- **Recommendation:** Check `newOccupied` in the blocked test (the set was clearly built for exactly this) — or delete it if stacking is accepted behavior.

### [ARCH-06] mining.ts/forest.ts are hand-maintained twins; ~9 mirrored functions should be hoisted into crawl.ts (P2, confidence: high)
- **Area:** src/engine/mining.ts, src/engine/forest.ts, src/engine/crawl.ts
- **Observation:** Near-identical pairs: `tryMove` (`mining.ts:747` / `forest.ts:829`), `tryDash` (764/845), `castSpell` (947/1036, ~145 ln each ~90% identical), `triggerRunes` (1098/1177), `coopClientStep` (1328/1453), `damageMonsterById`/`damageBeastById` (1362/1431), `applyBoonChoice` (1390/1616, character-identical modulo types), `guardianTreasure` (279-289/377-388), boon yield-scaling block (903-915/1015-1026). Neither file needs a hexBattle-style split — both are cohesive — the problem is dual maintenance.
- **Prior-doc status:** game-analysis §10 documents the shared `crawl.ts` core but not that the remaining duplication has begun drifting.
- **Impact:** Every crawler change is written twice; ARCH-02, -03, -04 (and UI-side ARCH-14/15 drift) are the drift this has already produced. This is the highest-leverage refactor in the engine.
- **Recommendation:** Hoist genericized versions into `crawl.ts` parameterized over a minimal `CrawlerLike` interface (tiles/isWalkable/unitAt/damageUnit). Start with the character-identical ones (`applyBoonChoice`, `coopClientStep`, `damageXById`), then `castSpell`/`triggerRunes` (which resolves ARCH-02/03 structurally).

### [ARCH-07] Full save serialized to localStorage at tick rate during minigame runs (P2, confidence: high)
- **Area:** src/store/useGameStore.ts
- **Observation:** The persist config (`useGameStore.ts:47-175`) has name/version/migrate/merge only — no `partialize`, no throttled storage adapter. Live run objects (battle, dungeon, mining incl. the full tile grid, forest, arena, tactics) are persisted, and the loop hooks fire state-changing ticks every 90–120 ms (`useArenaLoop.ts:45` TICK_MS=90; `useMiningLoop.ts:23` / `useForestLoop.ts:22` =120 ms) plus per-keypress actions.
- **Prior-doc status:** game-analysis §20 notes the 10 Hz store mutation and that *subscribers* are guarded, but never observes that the persist middleware itself serializes the whole save every tick.
- **Impact:** 8–20 `JSON.stringify`-the-entire-save + localStorage writes per second during runs; cost grows linearly with save age (habit logs, completionLog, energyLog). Main-thread jank risk on low-end devices; also the mechanism that makes ARCH-24 possible.
- **Recommendation:** Wrap the storage in a trailing-debounce (1–2 s) writer — the safer seam, since the merge logic (`useGameStore.ts:158-167`) shows run persistence for refresh-resume is intentional; partializing runs out would change that behavior.

### [ARCH-08] The migrate/merge chain (v2→v27) has zero direct tests (P2, confidence: high)
- **Area:** src/store/useGameStore.ts
- **Observation:** `migrate` (`useGameStore.ts:121-148`: habit-log backfill, material rename map, challenge kind backfill, run-clearing, v25–v27 defaults) and `merge` (`:153-172`: live-run-beats-stale-snapshot) have no test coverage — grep of `store/__tests__/` finds none; only the `withCharacterDefaults` sub-helper is tested (`store.integration.test.ts:74-103`).
- **Prior-doc status:** game-analysis §20 praises the migration chain as "mature" but doesn't note it's untested.
- **Impact:** Highest-blast-radius untested code in the project: a regression corrupts every veteran save on the next version bump, and cloud blobs reuse the same envelope so the damage syncs. P0-class failure mode, P2 as a coverage gap.
- **Recommendation:** Add fixture tests: representative v3/v6/v24-era persisted JSON through the exported `migrate`, asserting output shape; one test for merge's live-run preservation rule.

### [ARCH-09] Elite-win branch in dungeonAdvance discards the earnedXp accumulation (P2, confidence: high)
- **Area:** src/store/slices/dungeonSlice.ts
- **Observation:** `dungeonSlice.ts:245` folds `atkShare + hpShare` into `workingRun.earnedXp`; the elite branch at `:249` then rebuilds from the *original* run — `workingRun = { ...run, floorReward: ... }` — dropping that update. Verified by hand.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** Elite wins undercount the run's `earnedXp`, so `collectDungeon` (`dungeonSlice.ts:347-348`) under-reports dungeon XP in the balance ledger. Character statXp is unaffected (granted via `statXpPatch` separately) — ledger-only, but it feeds the balance report the section-03 audit will rely on.
- **Recommendation:** Spread `...workingRun` instead of `...run` at `dungeonSlice.ts:249`.

### [ARCH-10] shared.ts is accreting pure game rules that belong in engine/ (P2, confidence: high)
- **Area:** src/store/shared.ts
- **Observation:** Not a god-module (no actions, engine-only imports, header contract at `shared.ts:4` honored), but three modules share one 1,279-line file: ~42% GameState type declarations (100-534); commit orchestration (995-1102, 1131-1279); and pure rules — `recomputeHabitBonus` tier policy (696-702), `buildClassChoice` (733-750), the whole dungeon room lifecycle `boonMaxTier`/`offerBoon`/`resolveCurrentNode`/`enterRoom`/`finishRun` (891-984), `fighterFor` aggregation rules (608-648), and XP tuning constants `CRAWLER_XP_*`/`MINIGAME_XP_*`/`ARENA_XP_*` (1112-1128).
- **Prior-doc status:** contradicts game-analysis §18's framing — the commitX unification it asked for is done; the residual issue is rules-in-store, which it didn't flag.
- **Impact:** Balance tuning and dungeon-room rules live outside the engine, invisible to engine tests and to anyone auditing "the rules" in `src/engine/`. Twelve slices import from the file, so edits have wide compile impact.
- **Recommendation:** Mechanical split along existing seams: `gameState.ts` (types + fresh* initializers), engine moves (`buildClassChoice`→`engine/classes`, `recomputeHabitBonus`→engine, dungeon room lifecycle→`engine/dungeonRun`, XP constants→`engine/balance`), and a store-side `commit.ts` for commitRun + wrappers + applyReward/checkLevelUp. No behavior change required.

### [ARCH-11] Boon effect logic lives in the content layer and the CI layering guard can't see it (P2, confidence: high)
- **Area:** src/content/boons.ts, src/engine/__tests__/layering.test.ts
- **Observation:** `content/boons.ts:70-126` exports seven stacking reducers (`boonMeleeMult`, `boonDefenseBonus`, `boonYieldMult`, …) and `boons.ts:137-152` a Fisher-Yates `rollBoonChoices`; `engine/mining.ts:33` and `engine/forest.ts:33` import these *from content*, inverting the "content is data-only" contract. The layering guard (`layering.test.ts:29-37`) only scans `src/engine/**` for forbidden import specifiers — it catches neither logic-in-content nor DOM/global access (which is how ARCH-12 also slips through).
- **Prior-doc status:** contradicts game-analysis §10's "architecture is consistently followed".
- **Impact:** Boon stacking semantics (multiplicative vs. additive) are game balance living in the data layer; the guard gives false confidence that layering is fully enforced.
- **Recommendation:** Move the reducers + `rollBoonChoices` to `engine/crawl.ts` (which already owns `CrawlBoon`/RNG types), leaving only the `BOONS` table in content. Extend `layering.test.ts` with two cheap checks: content files contain no non-type engine imports/function exports beyond tables, and engine files don't reference `document`/`window`/`localStorage`.

### [ARCH-12] engine/palettes.ts mutates the DOM; its real color math is untested (P2, confidence: high)
- **Area:** src/engine/palettes.ts
- **Observation:** `applyPalette` (`palettes.ts:419-430`) reads `document.documentElement` and calls `root.style.setProperty/removeProperty` — the only genuine purity violation in `src/engine/` (import-level purity is clean everywhere, CI-enforced). The same file holds substantial untested logic: `hexToRgb` (:97), `rgbToHsl` (:122), `hslToRgb` (:149), `luminance` (:190), `deriveThemeVars` (:208), `parseHexInput` (:387) — no test file.
- **Prior-doc status:** contradicts CLAUDE.md's "every file here exports plain functions… no React or store imports" purity framing (imports are clean; globals are not).
- **Impact:** DOM dependency blocks straightforward Node testing of the one untested engine module with real algorithms (color-space math, user-input hex parsing).
- **Recommendation:** Move `applyPalette` to `src/lib/` (it's a rendering effect, like sprites.ts); add a small round-trip test for `deriveThemeVars`/`parseHexInput`.

### [ARCH-13] Lockpicking's simulation rules live in the component, not the engine (P2, confidence: high)
- **Area:** src/components/trials/games/Lockpicking.tsx, src/engine/trials/lockpicking.ts
- **Observation:** The component's rAF loop implements the state machine — jam accumulation (`Lockpicking.tsx:518`), pick-break rule (:536), pick-budget decrement (:544-546), fail marking (:549-555), lock progression/open condition (:571-576) — while `engine/trials/lockpicking.ts` (126 ln) holds only constants and parameter functions. Contrast RooftopChase: 1,119-line engine + `useChaseLoop`, component renders only.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** The only trial whose rules are untestable without mounting a component; violates "timing in hooks, rules in engine" and is the top item in the component untested-risk ranking.
- **Recommendation:** Extract a pure `stepLockpick(state, input, dt)` reducer into the engine file and a thin `useLockpickLoop` hook; keep the component render-only.

### [ARCH-14] MineRunOverlay owns game-rule fragments its Forest twin gets from the engine (P2, confidence: high)
- **Area:** src/components/mining/MineRunOverlay.tsx, src/engine/mining.ts
- **Observation:** (a) Sight/fog radius — including the Lantern boon's entire in-Mine effect — is a component constant: `MINE_SIGHT_RADIUS = 4` (`MineRunOverlay.tsx:30`), `sightR = MINE_SIGHT_RADIUS + boonSightBonus(...)` (:443), fog culling (:625, :871-874). Forest gets this from the engine (`sightRadiusFor`, `forest.ts:286-290`). `engine/mining.ts` has no sight concept at all. (b) The mine death screen recomputes the death-split by hand (`MineRunOverlay.tsx:1117-1122`) while Forest calls engine `splitHaul` (`ForestRunOverlay.tsx:522`) — rounding currently matches, so display equals what's banked (`shared.ts:1154`), but only by coincidence of both flooring.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** Any engine-side feature needing mine sight (aggro, co-op fog sync) forks the rule; a change to `splitHaul` rounding or the tombstone split makes the death screen display amounts that differ from what's actually banked.
- **Recommendation:** Add `sightRadiusFor(state: MineState)` to `engine/mining.ts` mirroring forest, and replace the inline death-split block with `splitHaul(mine.haul, MINE_DEATH_KEEP)`.

### [ARCH-15] Crawler overlays share ~450-550 lines of copy-paste with confirmed drift (P2, confidence: high)
- **Area:** src/components/forest/ForestRunOverlay.tsx, src/components/mining/MineRunOverlay.tsx
- **Observation:** Byte-identical or near-identical pairs (Forest/Mine lines): `Gauge` (174-187/107-122), cell-hash (96-100/33-37, byte-identical), the ~150-line state-diff FX effect (270-413/223-383), charge-bar rAF (442-454/177-191), camera+movers block (234-241,496-515/165-173,475-492), remote-player renderer (985-1007/918-944), boon-choice panel (1124-1146/1093-1114), spell bar (1217-1242/1162-1188), co-op guest gating (222-231/152-163). Confirmed drift: ARCH-14's two items, the torch-glow radius ignoring the Lantern bonus (`MineRunOverlay.tsx:721` hardcodes `4.2 * CELL` while fog uses `sightR`; Forest derives both from `sightRadiusFor`, `ForestRunOverlay.tsx:518`), and Mine's FX effect plays per-hit/kill combat SFX (:248,:257,:311,:333) while Forest plays none.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md — the engine got `crawl.ts`; the UI never got the equivalent extraction.
- **Impact:** Shotgun surgery on every crawler UI change; drift is no longer hypothetical.
- **Recommendation:** Extract in payoff order under `components/minigame/`: `useCrawlRunFx(run, refs)` (the diff effect), then shared `<CrawlGauge>`, `<BoonChoicePanel>`, `<RemoteCrawlers>`, `<CrawlSpellBar>`. Fix the torch-glow radius to `(sightR + 0.5) * CELL` en route.

### [ARCH-16] TacticsOverlay shows weak/resist indicators from the wrong weapon in co-op (P2, confidence: high)
- **Area:** src/components/tactics/TacticsOverlay.tsx
- **Observation:** The per-hero loadout is `const weapon = tactics.player.weapon ?? tactics.weapon` (`TacticsOverlay.tsx:247`), used for the attack label (:330) and firing range (:257) — but `activeAttackStat` at :345 reads `tactics.weapon.attackStat` (state-level weapon), which feeds the weak/resist arrows (:668-673).
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** In co-op, a hero carrying a different weapon than the host-state default sees incorrect weakness/resistance hints — misleading tactical information in the mode where it matters most. Solo is unaffected (the two sources coincide).
- **Recommendation:** Change `:345` to `weapon.attackStat`. Cross-reference for section 05 (co-op correctness).

### [ARCH-17] No graph-integrity test for the 2,226-line hand-edited encounter table (P2, confidence: high)
- **Area:** src/content/encounters.ts, src/engine/__tests__/content.test.ts
- **Observation:** `encounters.ts` is 100% pure data (zero functions — verified) whose header invites hand-editing, but `content.test.ts:38-49` asserts only "at least one node and a title"; nothing checks that every `start`/`go`/`goSuccess`/`goFail` target resolves. An external validation script run during this audit found the graph currently all-OK — this is a gap, not a live defect.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** A typo'd node id ships silently and dead-ends an encounter at runtime.
- **Recommendation:** Add one `it` iterating `ENCOUNTERS`, asserting `e.nodes[e.start]` and every choice target exist, and that stat-checks carry both `goSuccess` and `goFail`.

### [ARCH-18] Doc set has drifted again: INDEX.md broken links, CLAUDE.md/AGENTS.md stale on energy and store shape (P3, confidence: high)
- **Area:** docs/INDEX.md, CLAUDE.md, AGENTS.md
- **Observation:** INDEX.md: `docs/audit-2026-07/00-audit-charter.md` is unindexed; `:36` and `:42` link `./dungeon-delve-improvement-plan.md` and `./mining-improvement-plan.md` which now live in `docs/archived/` (broken links, absent from the Archived table); `:101` lists `developer-tools-analysis.md` under Archived though the file sits in `docs/` root. CLAUDE.md/AGENTS.md: state "Skill Trials are free" implicitly by omission and list only DUNGEON/MINE/FOREST/ARENA energy costs — `TACTICS_ENERGY_COST = 3` (`hexBattle.ts:31`) and `TRIAL_ENERGY_COST = 1` (`trials/trials.ts:104`) are missing; neither mentions the 12-slice store decomposition or `net/coop/reduce.ts`. README.md:23 says "~52 test files" (actual: 54) — minor.
- **Prior-doc status:** game-analysis §18's docs-sprawl complaint was addressed and has partially regressed.
- **Impact:** Onboarding docs mislead on the energy economy (feeds section 02/03 assumptions) and the store architecture.
- **Recommendation:** Fix the four INDEX entries; update CLAUDE.md/AGENTS.md energy paragraph and store description. (This audit's section docs should be added to INDEX at synthesis time per the charter.)

### [ARCH-19] Dead exports across engine, store, content, and lib (P3, confidence: high)
- **Area:** cross-cutting
- **Observation:** Zero-reference exports (grep-verified, tests included): `crawl.ts:29` `sign`, `crawl.ts:81` single-source `floodField` (superseded by `floodFieldMulti`), `crawl.ts:276` `facedCell` (both crawlers define their own); selectors `selectDashboardHabits` (:44), `isHabitSuspended` (:66), `selectWeekProgress` (:71), `selectConsistencyTrend` (:148), `selectDayOfWeek` (:153), `selectDungeonMilestone` (:170); `content/mining.ts:191-196` `getMineOre`/`getMineMonster`; `content/forest.ts:244-248` `getForestNode`/`getForestBeast`; `habitTemplates.ts:11` `CATEGORY_STAT_SUGGESTIONS`; `sprites.ts:52` `bossCrest`; `minigameArt.ts:24` `art()`; 7 auto-registered but unreachable `dirt_path_*.png` tiles.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** Dead surface misleads readers about what the view layer actually uses; crawl's `facedCell` is also a missed dedup target for ARCH-06.
- **Recommendation:** Delete the dead exports; for the six selectors, first apply ARCH-20 (three of them should gain consumers instead of dying).

### [ARCH-20] Dungeon milestone table exists in three places; components bypass existing selectors (P3, confidence: high)
- **Area:** src/views/DungeonView.tsx, src/store/selectors.ts
- **Observation:** `DungeonView.tsx:33-39` hard-codes the 5/8/10 milestone thresholds that `DUNGEON_MILESTONES`/`selectDungeonMilestone` already encode (`selectors.ts:158-170` — whose docstring admits it "mirrors the inline milestoneHint logic"); a third copy lives in engine/dungeonMap weights. `AccountSummary.tsx:23` and `DayOfWeekChart.tsx:12` call `consistencyTrend`/`dayOfWeekBreakdown` from the engine directly instead of the corresponding selectors.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** Milestone-table drift risk; the selector layer's purpose is undermined when views recompute or sidestep it.
- **Recommendation:** Point DungeonView/AccountSummary/DayOfWeekChart at the existing selectors; then prune the remaining truly-dead ones per ARCH-19.

### [ARCH-21] Minor store-layer duplication: battle actions, earnings clone, crawler begin preamble, date arithmetic (P3, confidence: high)
- **Area:** src/store/
- **Observation:** (a) `battleAction` (`battleSlice.ts:39-50`) and `dungeonBattleAction` (`dungeonSlice.ts:183-195`) are copy-paste identical (playerAction + invincible top-up + item decrement) differing only in which field holds the battle. (b) The earnings-ledger deep-clone block appears 6× (`habitsSlice.ts:177-182,244-249`; `battleSlice.ts:65-70`; `challengesSlice.ts:80-85`; `dungeonSlice.ts:337-342`; `shared.ts:1075-1081`). (c) `beginMining` (`miningSlice.ts:76-124`) and `beginForest` (`forestSlice.ts:74-121`) near-duplicate ~45 lines of tool-grant/fighter-snapshot/stamina derivation. (d) `shared.ts:665-669` `isoDaysAgo` ≡ `addDays(iso, -d)` (`engine/date.ts:77-81`).
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md (its commitX complaint was fixed; these are the residuals).
- **Impact:** A fix to item consumption or invincibility in one fight type silently misses the other; the rest is mechanical debt.
- **Recommendation:** `resolveBattleAction` helper in shared.ts; `cloneEarnings(ledger)`; shared `crawlerLoadout(s, kind)`; delete `isoDaysAgo`.

### [ARCH-22] sfx.ts: mine ambient started while muted stays silent after unmute; band ids untyped; stateful audio untested (P3, confidence: medium)
- **Area:** src/lib/sfx.ts
- **Observation:** `sfx.ts:1195` ramps ambient gain to `_muted ? 0.0001 : AMB_GAIN` even though all output already routes through `_masterGain` (zeroed by `setMuted`, `sfx.ts:1063-1072`) — if `startMineAmbient` fires while muted, the ambient's own gain pins at 0.0001 and unmuting only restores master gain, leaving ambience inaudible until the next band change. Also `_buildAmbient` (`sfx.ts:331-343`) branches on raw `'frozen'`/`'magma'` strings with a silent `rocky` default rather than the canonical `MineBandId` type. sfx.ts is the only lib file with real state machines (drone/ambient lifecycles) and has zero tests; otherwise the module is cohesive and all audio consumers route through its API (no duplication found).
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** Minor audio defect (mute → enter mine → unmute → no ambience); a fourth band would silently get rocky-cave audio.
- **Recommendation:** Ramp to `AMB_GAIN` unconditionally (master gain owns mute); type the band parameter as `MineBandId` (type-only import).

### [ARCH-23] SPELLBOOK_KEYS in sprites.ts drifted from the items table — 5 of 9 spellbooks miss the tome sprite (P3, confidence: high)
- **Area:** src/lib/sprites.ts, src/content/items.ts
- **Observation:** `sprites.ts:145-150` hardcodes 4 spellbook keys; `items.ts:88-161` now defines 9 (adds `fire_rune`, `ice_rune`, `poison_rune`, `ring_of_fire`, `chaotic_blink`), which fall through to the generic crest — contradicting the file's own "no edits here" promise (`sprites.ts:129`).
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** Cosmetic inconsistency; textbook duplicated-constant drift.
- **Recommendation:** Derive the list from the items table (`Object.values(ITEMS).filter(i => i.kind === 'spellbook')` via `@/engine/items`).

### [ARCH-24] Persisted co-op run + transient RNG seed diverge after refresh (P3, confidence: medium)
- **Area:** src/store/useGameStore.ts, src/store/runRng.ts, src/store/slices/miningSlice.ts
- **Observation:** `merge` preserves a live mining/forest run across reload (`useGameStore.ts:164-165`), but the run's seed lives only in `runRng.ts` module scope (:27-32) and resets to `Math.random`/undefined on refresh; `mineDescend` then falls back to `getMineRng()` (`miningSlice.ts:243-245`) instead of the per-floor seed.
- **Prior-doc status:** adjacent to game-analysis §19's co-op desync lead, but this specific persistence/seed mismatch is new.
- **Impact:** A refreshed client resuming a seeded co-op run generates divergent floors if the session reattaches. Solo unaffected. **Hand to section 05** for reducer-level analysis.
- **Recommendation:** Smallest change: clear (or flag solo-only) a seeded run on rehydrate; alternatively persist the base seed alongside the run (a single number).

### [ARCH-25] Engine micro-issues: stray Date.now, duplicated spell branch, untested mood/combatStats (P3, confidence: high)
- **Area:** src/engine/
- **Observation:** (a) `forest.ts:923` stamps a ranged-shot tracer with `Date.now()` although `act()` receives `nowMs` — the only injected-time leak found. (b) `mining.ts:1019-1034` has byte-identical `if/else` arms for burn/poison (forest already uses the collapsed form at `forest.ts:1105-1110`). (c) Untested real logic outside palettes (ARCH-12): `mood.ts:18-31` `computeMood` (6 branch outcomes feeding the dashboard via `shared.ts:685`) and `combatStats.ts:32,45` `combatXpForWin`/`dungeonCombatStatXp` (drive dungeon progression via `dungeonSlice.ts:235-243`) have no direct assertions. The audit brief's "5 untested trials" is wrong — `trials/__tests__/trials.test.ts:4-63` exercises all five; `gear.ts`/`bosses.ts`/`enemies.ts`/`stats.ts` are covered indirectly (crafting/biomes/content/combat tests); `weapons`/`items`/`spells`/`materials`/`palettes`-data/`dungeonTypes` are data-only.
- **Prior-doc status:** not covered by habits-rpg-game-analysis.md
- **Impact:** Determinism nit; edit-divergence bait; two small table-testable modules unguarded.
- **Recommendation:** Use `nowMs` at forest.ts:923; collapse the burn/poison branch; add table tests for `computeMood` and the two combatStats formulas.

## Needs manual check

Low-confidence items requiring runtime inspection or a playtest; not presented as fact above.

- **localStorage write cost at tick rate (ARCH-07):** the 8–20 writes/sec figure is derived from tick constants, not profiled. Worth a quick Performance-tab check on a year-old save before investing in the debounce wrapper. (confidence: low)
- **Mine ambient mute repro (ARCH-22):** the code path reads as described, but the mute→enter-mine→unmute sequence hasn't been exercised in a browser. (confidence: low)
- **TacticsOverlay wrong-weapon indicators (ARCH-16):** impact requires a co-op session where a guest hero's weapon differs from `tactics.weapon`; solo behavior masks it. Reproduce in section 05's co-op pass. (confidence: medium for the code defect, low for player-visible impact)
- **Co-op refresh seed divergence (ARCH-24):** needs two clients + a mid-run refresh to confirm; the reducer/staleness guards may coincidentally mask it. Section 05 should own this. (confidence: low)
- **Forest per-hit/kill SFX absence (ARCH-15):** Mine plays combat SFX from its FX effect; Forest plays none and no forest hit cues exist in sfx.ts — unclear whether this is a deliberate soundscape choice (forest has the drone) or an omission. Ask Orion during the section-02 interview or a playtest. (confidence: low)
- **Monster stacking frequency (ARCH-05):** the dead `newOccupied` set is certain; how often two units actually pick the same destination in real play (and whether players notice) is not. (confidence: low for player impact)
