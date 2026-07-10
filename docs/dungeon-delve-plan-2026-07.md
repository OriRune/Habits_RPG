# Dungeon Delve Implementation Plan — July 2026

Expanded from the implementation-plan outline in `docs/dungeon-delve-audit-2026-07.md`, incorporating the verified adversarial correction pass (2026-07-10), the two defects found during verification (DUN-21, DUN-22), and the missing-feature list. All file:line references were verified against source on 2026-07-10.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked/decision needed.

**Sizing:** S = under half a day · M = half to 1.5 days · L = multi-day.

---

## Design decisions (defaults chosen — confirm before the phase that uses them)

- **D1 — Energy contract (Phase 1).** Entry (3⚡) buys floors 1–3. Every descent to floor 4+ costs 1⚡, charged on *both* checkpoint descent buttons (Rest and Press On — both descend). At 0⚡ both descent buttons are disabled with an explanation; **Bank & Leave is always available**. `settings.unlimitedEnergy` bypasses all of it (it already does in the store). No energy is ever recorded as spent unless it was actually deducted.
- **D2 — Route pricing over forced combat (Phase 2).** Keep zero-combat routes legal, but scale expected reward by route danger so the safe route is a deliberate low-yield choice, not a free-loot exploit. (Alternative rejected: forcing ≥1 combat per route reduces build/health agency and fights the room-visibility design.)
- **D3 — Curses stack, and a curse never kills outright (Phase 0).** Duplicate curses are intentional and stack; UI shows `×N`. After clamping, max HP floors at 1 and current HP floors at 1 immediately after a curse is applied — "you feel weaker," never "you drop dead at a shrine." This removes the need for a post-curse defeat check while still fixing DUN-22. Document in `content/relics.ts`.
- **D4 — XP banks immediately (Phase 0).** Stat XP earned mid-run is applied at resolution time (current behavior) and this becomes the documented contract. Consequences: fix DUN-21 so the encounter-death branch also applies its earned XP; the run summary displays "XP already earned" separately from collectible loot.
- **D5 — One `fled` end reason, two verbs (Phase 2).** The new guaranteed non-combat retreat and the probabilistic combat flee both end as `endReason: 'fled'` with the same 60% retention; copy distinguishes "Retreat (guaranteed)" from "Flee (72% chance)". (Alternative: a fourth `retreated` reason — rejected as analytics noise; revisit if retreat behavior needs separate tuning.)
- **D6 — Biome-start unlocks (Phase 3, data-gated).** Deferred until Phase 3 timing data exists. Default direction: defeating a biome boss unlocks an optional expedition start at that biome's first floor (6 or 11) with a small fixed boon package and the same 3⚡ entry; floor-1 starts remain the only source of depth records.

## Cross-cutting engineering rules

- **Persist migrations.** The store persist version is currently 34. Phase 0 and Phase 1 both add fields to `DungeonRun` / `DungeonRunSummary`; if they land in one release, use a **single bump to 35** with one migrate step; otherwise one bump per phase. Backfill for suspended runs and existing history: `endReason = cleared ? 'banked' : (hp <= 0 ? 'defeated' : 'fled')`; `roomsEntered = roomsCleared`; new accounting fields default to `undefined` (render as "—", never fabricate).
- **Timebase.** Any new timestamp (`startedAt`, duration) must route through `src/engine/date.ts::now()`, never `Date.now()`.
- **Copy-from-engine rule (Phase 0 acceptance).** No reward-policy number (60%, 25%, energy costs, flee %) may appear as a hard-coded string in a component; all such copy renders from exported engine constants/helpers.
- **Layering.** New rules go in `src/engine/` (pure, tested in `src/engine/__tests__/`); the slice orchestrates; components render. Simulation harnesses stay deterministic (`resetRunRng()` in `beforeEach`).

---

## Phase 0 — restore trust in the rules

Goal: what the UI says is exactly what the store does, and the engine can no longer enter nonsensical states. All items are S except 0.2 and 0.4.

### [x] 0.1 Land the uncommitted scene-art work (S)
The DUN-13 scene system exists only in the working tree (`src/components/dungeon/DungeonSceneArt.tsx`, `src/components/dungeon/__tests__/`, small `SceneArt.tsx` + `index.css` edits). Run its tests + typecheck, commit as its own commit before anything else builds on these files.

### [x] 0.2 `DungeonEndReason` as the single source of truth (M) — DUN-03
- `src/engine/dungeonTypes.ts`: add `endReason?: 'banked' | 'fled' | 'defeated'` to `DungeonRun` (optional for save-compat; treat absence via the backfill derivation).
- `src/engine/dungeonRun.ts:61-73`: `finishRun` takes a reason instead of a raw factor and stamps `endReason`; `dungeonBank` stamps `'banked'`.
- `src/store/gameState.ts:141-152`: add `endReason` to `DungeonRunSummary`; keep `defeated` populated for old readers; `collectDungeon` (`dungeonSlice.ts:353-354`) copies the run's reason instead of re-deriving from `hp`.
- History rows (`DungeonView.tsx:171-172`) and the summary heading (`:216`) read `endReason`.
- Persist migrate: backfill per the cross-cutting rule (suspended active run + history entries).
- Tests: store tests asserting each of bank / combat-flee / combat-death / encounter-death / boss-loss stamps the right reason; migration test for a v34 save with a suspended run.

### [x] 0.3 Centralize retention policy + exact preview (M) — DUN-01, DUN-09
- `src/engine/dungeonRun.ts`: export `DUNGEON_RETENTION = { fled: 0.6, defeated: 0.25 }`; replace the `0.6` literal (`dungeonSlice.ts:220`) and `FLOOR_LOSS_KEEP` (`dungeonSlice.ts:34`, used `:162/:227/:231`) with it.
- New pure helper `previewRetainedReward(run, reason)` returning `{ kept, lost }` per category (gold, each material, items, weapons, gear) with **exact** quantities. Implement by calling the same `scaleReward` (`src/engine/dungeon.ts:118-132`) that `finishRun` uses, so preview and outcome cannot drift — including `Math.floor` rounding small stacks to zero.
- Tests: property-style test that `previewRetainedReward(...).kept` equals the `floorReward` actually merged by `finishRun` for both reasons, across gold/materials/items/weapons/gear, including a 1-quantity material that floors to 0.

### [x] 0.4 Truthful copy everywhere + flee odds (M) — DUN-01, DUN-03, DUN-09
- Replace the three "keeps everything" passages in `DungeonView.tsx` (entrance, checkpoint, escaped summary) with copy rendered from 0.3's helper, e.g. "Flee: keep all banked loot + 60% of this floor's gold and materials; this floor's items are lost." Show exact per-category totals at checkpoint and in the combat-flee context (the HUD loss panel is Phase 4 polish; the numbers land now).
- Summary heading by `endReason`: `banked` → "Spoils Banked!" (`dungeon:cleared` art), `fled` → "You Escape" (`dungeon:retreat` art), `defeated` → "You Fall..." (`combat:defeat` art); distinct accent colors.
- Combat flee button in dungeon battles shows live odds from `deriveCombatant().flee` (`src/engine/combat.ts:56`), e.g. "Flee (72%)", plus one line: "If it fails, the enemy attacks." (`BattleScene.tsx:811-814` currently shows a bare label; thread as a prop so Arena/boss battles can opt in later.)
- Fix checkpoint heal label to show clamped actual healing ("+12 HP", not "+40%") — DUN-17.
- Tests: component tests asserting copy contains the engine-derived numbers (not literals); heading/art per reason.

### [x] 0.5 Engine clamps + curse-safety (M) — DUN-18, DUN-22
- New `clampCombatant(c)` in `src/engine/combat.ts`, applied at the end of `deriveCombatant` (`:50-62`) and after the relic adjustments in `fighterFor` (`src/store/commit.ts:148-152`): `maxHp ≥ 1`, `maxMp ≥ 0`, `maxSta ≥ 0`, attack/spell powers ≥ 0, `defense`/`ward` ≥ 0, `dodge ∈ [0, cap]`, `flee ∈ [0.05, 0.9]`.
- Post-curse application (`dungeonSlice.ts:173-181`, `:416-422`): after recompute, floor `maxHp` at 1 and `hp` at 1 per D3.
- Fix the relic modal key: `RelicTray.tsx:70` → `key={`${relic.key}:${i}`}` (matches `:56` and `RunBuffs.tsx:67`); render stacked duplicates as one row with `×N`.
- Document curse stacking in `src/content/relics.ts` (D3); leave `rollCurse` (`src/engine/relics.ts:96-99`) non-excluding on purpose, with a comment saying so.
- Tests: repeated `brittle_bones` through shrine and encounter paths keeps `maxHp ≥ 1` and the run alive; flee floor with stacked AG curses; duplicate-curse render test on the modal.

### [x] 0.6 Encounter-death XP consistency (S) — DUN-21
`dungeonSlice.ts:162`: spread `...(statXpPatch ?? {})` into the death early-return, matching the surviving path (`:183-186`), per D4. Test: a fatal encounter check still grants the checked stat's XP and can trigger a level-up.

### [x] 0.7 `roomsEntered` vs `roomsCleared` (S) — DUN-05
Add `roomsEntered` (incremented where `roomsCleared` is today, `dungeonSlice.ts:121`); move the `roomsCleared` increment to successful resolution (combat win, encounter resolved, treasure/shrine/rest/merchant completed). Fix the comment at `dungeonTypes.ts:60`. Migrate: `roomsEntered = roomsCleared`. Tests: flee/death leaves `roomsCleared` behind `roomsEntered`.

### [x] 0.8 Honor `unlimitedEnergy` at the entrance (S) — DUN-06
`DungeonView.tsx:125`: `canEnter = unlocked && (unlimitedEnergy || energy >= DUNGEON_ENERGY_COST)` — matching `AdventureRitualModal.tsx:37` and `startDungeon`. Test: 0-energy + dev flag renders an enabled button.

### [x] 0.9 Merchant preview parity (S) — DUN-07
Pass `townPerks(state.town).merchantDiscount01` into `FloorMap` (`FloorMap.tsx:184`), same as `commit.ts:417`. **Investigate first:** if `merchantOffers` stock is RNG-dependent, the preview's *items* can differ from the room's roll even with matching prices — in that case label the preview "sample stock" (or show a price range) rather than implying a promise. Test: preview prices equal room prices at a fixed depth/discount.

### Phase 0 acceptance
No policy number is hard-coded in a component; every end reason and reward category is store-tested; a curse-stacked run can never show a dead-but-walking HP bar; full suite + typecheck green.

---

## Phase 1 — reconnect play to habits and bound sessions

Goal: the habit → energy → bounded expedition loop is enforced and visible. Depends on 0.2/0.3.

### [x] 1.1 Enforce the descent cost (S–M) — DUN-02
In `dungeonDescend` (`dungeonSlice.ts:299-343`): when `chargeEnergy && s.character.energy < 1`, return unchanged (no-op guard, same pattern as `startDungeon`'s guard at `:72`). Remove the clamp-and-continue; `energySpentPatch` now only ever runs after a real deduction. Applies to both `'rest'` and `'pressOn'` (both descend); `dungeonBank` untouched. Tests: 0-energy descent is a no-op for both variants; 1-energy descent deducts and records exactly 1; `unlimitedEnergy` still free.

### [x] 1.2 Cost transparency at entrance and checkpoint (S)
Entrance: "3⚡ covers floors 1–3 · each deeper floor costs 1⚡". Checkpoint: show "Descend — 1⚡ (you have N)" on both descent buttons; at 0⚡ disable both with "Out of energy — complete a habit, or bank and leave." Never disable Bank & Leave. Copy renders from the engine constants (0.3 rule).

### [x] 1.3 Honest per-run accounting (M)
- `DungeonRun`: add `startedAt` (via `engine/date.ts::now()`) and `energySpent` (incremented only on real deductions: entry + charged descents).
- `DungeonRunSummary` (`gameState.ts:141`): add `energySpent`, `xpGranted` (total, from summing the run's `grantStatXp` patches — track a running total on the run), `goldLost`/`materialsLost` (from 0.3's preview at finish time), `merchantGoldSpent` (accumulate in `dungeonBuy`, `dungeonSlice.ts:451-471`), `durationMs`.
- Persist migrate per the cross-cutting rule (same bump as 0.2 if co-released).
- Tests: a scripted run's summary equals actual deductions/losses; suspended-run backfill.

### [x] 1.4 Streak multiplier where decisions happen (S)
Show the streak-adjusted banked-gold forecast (`habitBonus`, currently only at `DungeonView.tsx:259-260`) at the entrance and checkpoint: "Banked: 84g → **101g** with your streak ×1.2". Reuse `StreakBonusChip`.

### [x] 1.5 Close the loop after collection (S)
On the collection screen: "This run: N⚡ spent · X XP · Y floors · MM:SS" (from 1.3) and a "Back to today's habits" action that switches to the Dashboard tab. (Tab state is local to `App.tsx` — thread a `onGoToHabits` callback or lift via existing navigation pattern; check how other views switch tabs first.)

### [x] 1.6 Balance report surface (S)
No server telemetry (local-first): add a selector in `src/store/selectors.ts` aggregating dungeon history — XP/energy, XP/minute, gold/energy, average floors — surfaced in the dev/settings panel. This is the instrument DUN-12 and Phase 3 decisions read from.

### Phase 1 acceptance
A 0-energy character cannot start a paid floor by any path; recorded spend equals actual deductions in all tests; entrance/checkpoint/summary all show cost, streak forecast, and totals; a normal run has a visible stopping point.

---

## Phase 2 — make paths strategically interesting

Goal: route choice is a priced decision, retreat is always possible, and the map UI carries the information. Depends on 0.2/0.3.

### [x] 2.1 Pure route-analysis helpers (M) — DUN-04, DUN-16
In `src/engine/dungeonMap.ts`: `enumerateRoutes(map)` (maps are small — layer widths ~2–3, exhaustive enumeration is cheap), `routeDanger(map, route)` (count of combat/elite nodes), and `classifyRoute(...)` → `{ danger: 'low'|'medium'|'high', rewardClass, dangerRoomRange }`. No RNG outcomes revealed. Deterministic tests, including the existing 10k-map simulation harness re-run to characterize the new distributions.

### [x] 2.2 Route pricing (M–L) — DUN-04, per D2 — *landed: `DANGER_REWARD_FACTORS` = [0.6, 0.85, 1, 1.1, 1.2] by realized path danger, applied to treasure + combat/elite/boss gold; sim (18.5k routes): low routes earn 43% of a danger route, high ≈ 3.0× low*
Scale floor reward rolls by realized danger: rooms resolved on a route carrying more danger yield richer treasure/gold rolls; a zero-danger route yields roughly 40–60% of a danger route's expected value (tune via simulation). Implemented in the engine (reward-roll factor from 2.1's classification of the player's chosen edges so far), never in the UI. Acceptance via simulation: across health/build states, no route class strictly dominates expected value per unit of risk; zero-combat routes remain viable but visibly poorer.

### [x] 2.3 Route UI (M) — DUN-16
Per-route danger chips (Low/Med/High + expected reward class) from 2.1, a tap/hover detail card (rooms remaining, danger room range), an explicit current-node marker, and non-color-only differentiation (icons/patterns). Reuses `FloorMap`.

### [x] 2.4 General retreat action (M) — DUN-10, per D5
- Store: `dungeonRetreat()` — valid whenever no battle is active (path choice, treasure, encounter *before committing*, shrine, rest, merchant, checkpoint); calls `finishRun(run, 'fled')` with the same retention as combat flee.
- UI: persistent "Retreat" in the run HUD; confirmation dialog rendering 0.3's exact `{kept, lost}` preview; copy distinguishes guaranteed retreat from probabilistic combat flee.
- This also resolves the abandonment gap: a suspended run is no longer the only way to stop mid-floor. (Suspended runs themselves remain legal — resume works today; no expiry added.)
- Tests: retreat from each eligible state stamps `fled` and matches the preview; retreat is unavailable mid-battle.

### [x] 2.5 Shrine result state (S–M) — DUN-20
Add a result step to the shrine flow instead of the shared fall-through at `dungeonSlice.ts:448`: store a `shrineResult` on the run (or a generic `roomResult`), render a panel in `ShrineRoom.tsx` naming the outcome — on failure the curse's name, art, and exact effect — with a Continue button that then calls `resolveCurrentNode`. Reduced-motion safe. Tests: failure surfaces the rolled curse before path choice.

### [x] 2.6 Resize-aware connectors (S) — DUN-08
Attach a `ResizeObserver` on the `FloorMap` container (and a `window` resize fallback) that re-triggers the measurement effect (`FloorMap.tsx:68-111`), e.g. via a bump-state. Live-validate the original repro (orientation change / font swap).

### [x] 2.7 Room-weight tuning (S, ongoing) — *characterized (route shares: 23% low / 44% medium / 33% high); weights left unchanged, combat fallback kept; revisit with 1.6's observed-play data*
Re-tune generation weights using the simulation plus 1.6's observed-play report. Keep the map-wide combat fallback (`dungeonMap.ts:105-110`) as a floor.

### Phase 2 acceptance
Simulation shows no dominant route; retreat preview equals retained outcome exactly; shrine failure is impossible to miss; map invariants/tests stay deterministic.

---

## Phase 3 — progression and boss pacing (data-gated)

Goal: repeated boss attempts and late biomes stop taxing time disproportionately. Blocked on 1.3/1.6 data; decisions here should not be pre-committed.

### [x] 3.1 Measure (S)
From 1.6's report: median time to first floor-5 boss attempt, repeat-attempt time, win rates by level/build, XP per energy and per minute. Add whatever fields 1.3 missed.
*Landed: summaries now record `startDepth`, `level`, `bossesFought`, `bossesSlain`; the Settings readout adds median run time, boss win rate, and dungeon XP share.*

### [x] 3.2 Biome-start unlocks (M–L) — DUN-11, per D6
If repeat-attempt time exceeds ~10 minutes: implement optional starts at floors 6/11 after that biome's boss is defeated — same 3⚡ entry, small fixed starter boon package (no relics that trivialize builds), depth records restricted to floor-1 starts. Entrance UI gains a start-point selector.
*Landed on direct go-ahead (2026-07-10) without the timing gate: `expeditionStarts` (boss-kill tracked in `dungeonBossesSlain`, legacy credit via `deepestFloor`), one starter boon pick, entry covers the run's first 3 floors (`descentCharged`), floor-1-only depth records, entrance selector.*

### [~] 3.3 Boss scaling and relief tuning (M) — *instrumented (boss win rate + median run time in the Settings readout); number changes wait for real-play data now that 3.2 fixed traversal cost*
Tune with 3.1 data toward: first-boss win rate 45–65% on first informed attempt; relief (`combat.ts:156,192-196` — HP-only easing, threshold 3, cap 40%) reviewed once traversal time is fixed, since relief currently cannot compensate for time cost.

### [x] 3.4 Biome mutators for floors 16+ (L) — DUN-15 — *first slice landed: per-cycle mutators (Sunless/Echoing/Hollow) scale enemies/bosses + pay a gold premium, named in the depth header; design + follow-ups (affixes, encounter variants, boss modifiers) in `docs/dungeon-biome-mutators-2026-07.md`*
Content multipliers before new biomes: enemy affixes, encounter variants, boss modifiers, biome mutator per cycle. Engine + content work; design doc first.

### [~] 3.5 Reassess Dungeon XP weight (S–M) — DUN-12 — *instrumented: the readout shows Dungeon's share of all XP; apply the weighting discount only if it exceeds ~⅓ in real play*
Only after 1.1 lands: if Dungeon supplies > ~⅓ of routine weekly level XP for a habit-active player (per 1.6), discount Dungeon XP for stat-allocation *weighting* (`engine/progression.ts::allocateStatGains` input), not the reward itself.

---

## Phase 4 — finish the visual layer

Goal: art and accessibility catch up to the rules. Independent of Phases 2–3 except 4.3 (needs 0.3).

### [x] 4.1 Remaining 19 relic sprites (L, batchable) — DUN-14
Priority: curses first (`dull_blade`, `clouded_mind` — `brittle_bones`/`leaden_weight`/`cracked_idol` exist), then triggered/tier-3 (`worldroot_heart`, `dragon_scale`, `soulbound_crown`, `frostbitten_edge`, `desperate_ward`, `shrine_stone`, `bloodied_fang`, `twin_sage`), then tier-1/2 armor/trinkets (`padded_jerkin`, `runed_band`, `bone_ward`, `frost_mantle`, `aegis_charm`, `windrunner_sash`, `gilded_mask`, `shadow_mantle`, `verdant_sigil`). Match the existing PNG style in `src/assets/sprites/relics/`.
*Landed: all 19 generated via `scripts/relic-sprites/` (SVG art → resvg at 32px native → NN ×4 to 128px, matching the pixel style); registry coverage pinned in `spriteRegistry.test.ts`; art-tracking docs updated to 38/38.*

### [ ] 4.2 Biome-distinct map treatment (M)
Per-biome SVG frame/background for `FloorMap` beyond the translucent tint, consistent with the `DungeonSceneArt` language.

### [ ] 4.3 Banked vs exposed loot visualization (M) — DUN-09
Distinct containers for banked (safe, cool tones) vs current-floor (exposed, warm/warning tones) loot in the HUD; loss-preview coloring driven by 0.3's helper.

### [ ] 4.4 HUD restructure (M) — DUN-19
Capped compact relic tray (e.g. 8 + "+N") plus one aggregated stat line; full per-relic list, trigger descriptions, and `×N` stacks live in the modal only; triggered relics with empty static `effect` get their trigger text instead of an empty token. Validate on a 640px-height viewport.

### [ ] 4.5 Accessibility pass (M)
Keyboard route selection and activation on `FloorMap`; SR labels including room kind + availability; focus order through modals/summary; contrast in all palettes; reduced-motion re-verification.

### [ ] 4.6 Regression + live sign-off (M)
Screenshot coverage for entrance, path, each special room, checkpoint, flee, defeat, banked summary. Then execute the audit's live playtest checklist (§ "Live playtest checklist before sign-off") — including the depth-4 transitions at 1⚡/0⚡ that exercise 1.1.

---

## Suggested execution order

1. **0.1** (commit working tree) → **0.2 + 0.3** together (they share the `finishRun` signature change) → **0.4–0.9** in any order (all small, parallelizable).
2. **1.1–1.3** together (one persist bump with 0.2 if co-released), then 1.4–1.6.
3. **2.1 → 2.2/2.3** (analysis before pricing/UI), 2.4–2.6 parallel, 2.7 trailing.
4. Phase 3 waits for real usage data from 1.6. Phase 4 can interleave anytime after Phase 0.

Every item lands with its tests in the same commit; run `npm run typecheck` and the targeted vitest files per item, full suite at each phase close.
