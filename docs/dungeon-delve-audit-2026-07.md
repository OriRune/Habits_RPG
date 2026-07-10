# Dungeon Delve Audit — July 2026

## Executive assessment

Dungeon Delve has a sound roguelite foundation: short branching floors, persistent attrition, readable checkpoints, build-shaping relics, varied encounters, multi-phase bosses, and an explicit bank-or-press-on decision. The mode is substantially more complete than its old placeholder implementation and its pure-engine/store separation is strong.

The current build is not yet trustworthy enough for players to make informed risk decisions. The most important defect is a direct contradiction between the UI and the reward rules: three screens say fleeing keeps everything, while the store keeps only 60% of unbanked gold/materials and destroys all discrete unbanked drops. The post-run heading also calls a successful escape “You Fall.” These are high-impact UX bugs because risk management is the mode’s central decision.

The second major problem is alignment with the habit tracker. Entry correctly costs habit-earned energy, and healthy streaks multiply banked gold, but descent after floor 3 is effectively unlimited when energy reaches zero: the store clamps energy at zero yet continues the run and records energy that was never owned. That permits Dungeon Delve to become a self-contained progression loop instead of a reward for completing real-world habits.

The visual hierarchy is coherent but the scene banners were generated emoji placeholders. This audit replaces all 17 Dungeon Delve room, outcome, and run-state banners with a unified inline-SVG scene system and subtle reduced-motion-safe ambience. Bespoke relic art remains only 50% complete (19 of 38 relics).

Overall rating before the recommended fixes: **good core, weak contract clarity, incomplete habit-loop guardrails, visually functional but under-authored**.

## Scope and method

Reviewed:

- Dungeon engine, map generation, encounters, combat scaling, relics, biomes, rewards, and run lifecycle.
- Zustand dungeon orchestration and persistence seams.
- Entrance, route map, rooms, combat handoff, checkpoints, run summary, audio, and scene/sprite coverage.
- Targeted Dungeon tests, full typecheck, and the full repository test suite.
- Deterministic simulation of 10,000 maps at depths 1, 4, 5, 8, and 10, enumerating every reachable route.
- Existing balance and minigame audits, rechecked against the current implementation rather than accepted as current.

Interactive browser testing is still required before sign-off. The local app is running, but the MCP browser service reported no attached browser instance during this audit pass. Findings that require visual or timing confirmation are explicitly marked “live validation pending.”

## Adversarial correction pass — 2026-07-10

This pass rechecked the audit against the current code. The audit is directionally correct on the largest gameplay defects, but several statements need tighter wording or additional scope. Treat this section as superseding conflicting claims below.

**Verification status (2026-07-10):** every claim in this pass was independently fact-checked against current source with file:line evidence. All claims were confirmed; one needed a correction (DUN-03 — see its bullet). Two new defects were found during verification and added as DUN-21 and DUN-22. Inline "Verified:" notes below record the evidence that changes or sharpens the fix.

### Corrections to this audit

- The requested filename `dungeon-delver-audit-2027-07.md` does not exist in `docs/`. The current reviewed file is `dungeon-delve-audit-2026-07.md`.
- DUN-01 is correct, but the retention model has two separate loss factors: combat flee keeps 60% of current-floor gold/materials; death keeps 25%. Both lose current-floor discrete drops. The audit should call out both constants, not only the flee contradiction. Verified: the flee factor is a bare literal `0.6` at `src/store/slices/dungeonSlice.ts:220`; death uses `FLOOR_LOSS_KEEP = 0.25` (`dungeonSlice.ts:34`, used at `:162`, `:227`, `:231`); `scaleReward` (`src/engine/dungeon.ts:118-132`) applies `Math.floor` to gold and each material and unconditionally zeroes items, weapons, and gear. Retention applies only to the current floor's `floorReward` — previously banked loot is never touched (`src/engine/dungeonRun.ts:61-73`, note `finishRun` lives here, not in `dungeon.ts`).
- DUN-02 is correct and applies to both checkpoint descent buttons. `dungeonDescend('rest')` and `dungeonDescend('pressOn')` both charge after floor 3, both clamp energy at zero, and both record one spent energy even when zero was owned. Verified at `dungeonSlice.ts:299-343`: `chargeEnergy = depth > 3 && !s.settings.unlimitedEnergy` (`:305`), no energy-sufficiency guard on either variant, `Math.max(0, energy - 1)` clamp (`:338`), unconditional `energySpentPatch(s, 1)` (`:339`). Note `settings.unlimitedEnergy` is already honored during descent — the defect is solely the zero-energy clamp-and-continue and the fictional spend record.
- DUN-03 is correct, but the underlying data-model problem is broader than copy. `DungeonRun.cleared` is overloaded as “banked safely” versus “anything else,” so the UI and history infer fled/defeated from `hp`. Add an explicit end reason rather than continuing to derive state from `cleared` plus `hp`. Verified with one correction: the persisted history summary (`DungeonRunSummary`, `src/store/gameState.ts:141-152`) already stores an explicit `defeated: boolean`, computed once at `collectDungeon()` as `!run.cleared && run.hp <= 0` (`dungeonSlice.ts:353-354`), and history rows read that stored field (`DungeonView.tsx:171-172`). It is the live `DungeonRun` (`dungeonTypes.ts:43-45`) that lacks an end reason, and the summary heading (`DungeonView.tsx:216`) that collapses fled into “You Fall...” even though the body text below it branches correctly on `hp > 0`. The underlying signal everywhere is still only `hp <= 0`.
- DUN-05 is correct. The type comment in `src/engine/dungeonTypes.ts` also incorrectly says `roomsCleared` means “entered (and resolved),” while `src/store/slices/dungeonSlice.ts` increments it before room resolution. Verified: comment at `dungeonTypes.ts:60`; increment at `dungeonSlice.ts:121` inside `dungeonChoosePath`, before `enterRoom` and any outcome.
- DUN-06 is correct for `DungeonView`. The ritual modal already honors `settings.unlimitedEnergy`, but it is unreachable from the disabled Dungeon entrance button when energy is zero. Verified: `canEnter = unlocked && energy >= DUNGEON_ENERGY_COST` (`DungeonView.tsx:125`) gates the button (`:184`); the modal is `AdventureRitualModal` (`src/components/minigame/AdventureRitualModal.tsx:37`), which computes `unlimitedEnergy || energy >= energyCost` correctly.
- DUN-07 is correct. The actual merchant room uses the Homestead discount via `merchantOffers(run.depth, townPerks(...).merchantDiscount01)`, while `FloorMap` previews `merchantOffers(depth)` with no discount. Verified: `FloorMap.tsx:184` vs `src/store/commit.ts:417`.
- DUN-08 is confirmed at the code level (live visual repro still pending). Verified: the edge-measuring `useLayoutEffect` at `FloorMap.tsx:68-111` intentionally reruns on every render, but no `ResizeObserver` or window `resize` listener exists anywhere in `src/components/dungeon/`, so viewport/CSS layout changes that don't trigger a React render leave connectors stale.
- DUN-13’s “implemented in this audit” claim is true for current code: `DungeonSceneArt` covers the 17 used Dungeon scene keys and tests assert coverage. Verified: `SUPPORTED_SCENES` at `DungeonSceneArt.tsx:3-9` lists exactly 17 keys and `__tests__/DungeonSceneArt.test.tsx:6-12` asserts `hasDungeonSceneArt` for each. Note this work is **uncommitted working-tree changes** (`DungeonSceneArt.tsx`, its tests, plus small `SceneArt.tsx`/`index.css` edits) — it must be committed before further work builds on it. The audit should still avoid implying that live visual QA is complete.
- DUN-14 is correct: there are 38 relic definitions and 19 relic PNGs. The missing list is accurate against the current `src/assets/sprites/relics/` directory. Verified: `src/content/relics.ts:18-68` (12 tier-1, 15 tier-2, 7 tier-3, 4 curses); the 19-name missing list matches exactly.
- DUN-18 is partially corrected in current code: the compact tray buttons and `RunBuffs` rows key by `key:index`; however, the relic modal still keys `RelicDetail` rows by `relic.key`, so duplicate curses still produce duplicate keys there. The engine-risk portion is also broader than max HP: repeated negative stat curses can push combat-derived HP, MP, stamina, flee chance, and stat powers into nonsensical ranges because derived combatant values are not clamped after relic aggregation. Verified: `rollCurse` (`src/engine/relics.ts:96-99`) has no owned-exclusion, unlike `rollBoons` (`:83-93`); `fighterFor` (`src/store/commit.ts:148-152`) adds `relicAgg.maxHp` with no floor; `deriveCombatant` (`src/engine/combat.ts:50-62`) has upper caps on dodge/flee only, no lower floors anywhere; the modal key is at `RelicTray.tsx:70`.
- The verification-status section should not be treated as current proof. This review did not rerun the full suite, and the document still describes unfixed P1/P2 defects as present in current code.

### New defects found during verification (2026-07-10)

- **DUN-21 (P2): encounter death silently discards earned stat XP.** In `dungeonEncounterChoose`, `statXpPatch` is computed at `dungeonSlice.ts:158`, but the death early-return at `:162` (`return { dungeon: finishRun(...) }`) omits it, unlike the surviving path (`:183-186`) which spreads it into state. The XP (and any triggered level-up) from the final failed check is lost. Whichever XP contract is chosen (see assumptions above), this branch must be made consistent with it.
- **DUN-22 (P2, companion to DUN-18): a curse can drive max HP to zero or negative without ending the run.** After an encounter- or shrine-granted curse recomputes max HP (unclamped per DUN-18), `next.hp = Math.min(hp, newMax)` (`dungeonSlice.ts:173-181`, `:416-422`) has no floor and the `hp <= 0` defeat check earlier in the same function is not re-evaluated post-curse. A curse-stacked run can continue in path-choice/checkpoint state with a broken HP bar until the next battle tick notices `playerHp <= 0`. Engine clamps (DUN-18 fix) plus an explicit post-curse defeat re-check are both required.

### Gameplay assumptions the audit under-specifies

- Flee is not guaranteed. Combat flee is a probabilistic combat action based on Agility, capped at 90%. Verified formula: `flee = Math.min(0.9, 0.4 + AG × 0.03)` (`src/engine/combat.ts:56`) — note the 40% base floor even at 0 AG. On failure the action is wasted and the enemy takes its normal turn (`combat.ts:552-574`); no extra penalty. The flee chance is displayed nowhere in the combat UI (`BattleScene.tsx:811-814`). The audit copy discusses “Flee now” outcomes but should also require the UI to show flee chance and the cost of a failed flee attempt.
- Merchant purchases spend persistent gold immediately and can add persistent inventory immediately. That is probably acceptable, but the audit should decide whether mid-run purchases are intentionally outside the bank/floor-loot retention model and communicate that separately from loot loss.
- XP is granted immediately during a live dungeon run, before `collectDungeon()`. Verified: combat wins and encounter checks spread `grantStatXp` patches into state at resolution time (`dungeonSlice.ts:158`, `:253-255`, `:285`; `grantStatXp` at `src/store/commit.ts:350-369` even runs `checkLevelUp` synchronously), while `collectDungeon()` (`:345-384`) only applies `bankedReward`. If a player abandons a suspended ended run without collecting, the stat XP has already been applied while the reward collection remains pending. The audit should require an explicit contract for whether XP is banked immediately or collected at summary time. See also DUN-21: the encounter-death branch is the one path inconsistent with immediate banking.
- Death/flee retention uses `Math.floor`, so small material stacks can round to zero. Any preview helper must show exact retained/lost quantities per material, not just percentages.
- Dungeon path generation guarantees at least one combat node per normal-floor map, not combat exposure per route. Verified: `usedCombat` is a map-wide flag with a layer-0 fallback (`src/engine/dungeonMap.ts:87-110`); the in-code comment at `:105` accurately states floor-wide scope, so this is a design gap, not a comment error. Boss floors converge every route on the single boss node (`:81-85`, `:118`). If the design keeps visible room types, route pricing should be considered a rules-level requirement, not just UI polish.
- Boss relief only modifies the boss fight after repeated boss losses. It does not reduce the traversal time to reach another boss attempt, does not help non-boss deaths, and does not account for low-energy failed attempts.

### Missing gameplay/features to consider

- Add a non-combat retreat action available at path choice, treasure, shrine, rest, merchant, encounter, and checkpoint screens. Use the same previewed retention policy as combat flee, but distinguish guaranteed retreat from probabilistic combat flee.
- Add a persistent “run contract” panel: entry cost, post-floor-3 descent cost, flee chance, flee retention, defeat retention, what is already banked, what is currently exposed, and whether merchant purchases are permanent.
- Add danger/reward route analysis in the engine, not just presentational labels. Expose route danger, expected reward class, and combat count ranges without revealing exact RNG outcomes.
- Add engine clamps for combatant derivation after all gear/relic/run-buff modifiers. Minimums should exist for max HP, max MP, max stamina, attack powers, defense/ward, dodge, and flee chance.
- Add an explicit shrine result state. Shrine failure currently resolves immediately to the next path after adding a curse, making curse acquisition too easy to miss. Verified: the `'pray'` failure branch (`dungeonSlice.ts:406-423`) applies `rollCurse()` and falls through to `resolveCurrentNode` like every other branch; `ShrineRoom.tsx` has no outcome panel. Nuance: the curse is not fully silent — it appears in the always-visible relic tray (`RunBuffs` groups it under “Curses”) on the very next screen; the missing piece is a dedicated result moment naming the curse and its effect.
- Add run abandonment/recovery semantics. A persisted active dungeon can be left suspended indefinitely; the audit should define whether that is intended, whether a player can voluntarily abandon it from the entrance/explore shell, and what retention policy applies.
- Add per-run accounting fields: energy actually spent, floors paid for, XP granted, gold/materials/items retained, gold/materials/items lost, merchant gold spent, and duration. Without this, balance decisions around Dungeon versus habits are mostly guesswork.
- Add accessibility requirements to the path map: keyboard route selection, screen-reader labels that include room kind and availability, and non-color-only path/choice indicators.

## Current loop

1. Reach character level 3.
2. Spend 3 energy earned from habit completions.
3. Choose one visible room per map layer.
4. Resolve combat, encounters, treasure, shrines, merchants, rests, and elites while HP persists.
5. At each floor checkpoint, bank and leave, heal 40% and descend, or keep current HP and descend with a boon.
6. Fight a multi-phase boss every fifth floor; biomes rotate every five floors and cycle after floor 15.
7. Collect banked rewards with the habit-streak gold multiplier.

The loop is legible and has meaningful systems. Its weakest point is that the route choice is more presentation than strategy: room types are fully disclosed, route difficulty is not summarized, and over half of sampled normal-floor maps allow a route with no combat at all.

## What already works

- **Risk structure:** banked versus current-floor loot and persistent HP create a clear push-your-luck frame.
- **Resource continuity:** HP, MP, and stamina carry between rooms appropriately; MP partially regenerates and checkpoint behavior is explained.
- **Build variety:** 38 relic definitions, tier gates, curses, triggered effects, gear, spells, weapon affinities, and distinct physical/magical mitigation support multiple builds.
- **Encounter relevance:** stat checks use gear, relics, run buffs, and depth scaling. Successful checks grant stat-specific XP.
- **Boss identity:** authored multi-phase bosses have different schools, movesets, weaknesses, and phase transitions.
- **Anti-frustration:** boss losses are tracked and fed into the shared battle relief system.
- **Habit connection:** habits are the source of energy, and healthy habit streaks multiply Dungeon gold.
- **Architecture:** engine rules remain framework-free; the store is orchestration; UI components consume explicit actions.
- **Recovery:** invalid encounter content falls back to a Continue action instead of soft-locking the run.
- **Touch viability:** the mode is turn-based and tap-driven, unlike the real-time crawlers.

## Findings

### P1 — fix before further content work

#### DUN-01: Flee reward copy contradicts the implemented loss policy

**Evidence:** `DungeonView.tsx` says fleeing “keeps everything” at the entrance, checkpoint, and escaped-run summary. `dungeonSlice.ts` calls `finishRun(..., 0.6)` on flee. `scaleReward` keeps 60% of unbanked gold/material quantities and removes every unbanked item, weapon, and gear drop.

**Impact:** Players cannot evaluate the central risk/reward choice. A player can flee specifically to protect a rare drop and lose it despite three assurances that it is safe.

**Fix:** Define a single exported `DUNGEON_RETENTION` policy and a pure `previewRetainedReward` helper. Render exact “Flee now” and “Fall now” outcomes from that helper everywhere. Recommended copy: “Flee: keep all banked loot plus 60% of this floor’s gold and materials; lose this floor’s items.”

#### DUN-02: Descent continues at zero energy and records fictional spend

**Evidence:** after entering depth 4+, `dungeonDescend` always proceeds, sets energy to `Math.max(0, energy - 1)`, then calls `energySpentPatch(..., 1)` even if the player had zero energy.

**Impact:** A single 3-energy entry can still fund unlimited floors, XP, combat-stat training, and loot. The analytics ledger can report more energy spent than the player possessed. This weakens the primary habit → energy → play loop.

**Fix:** Choose and expose a real contract. Recommended: entry buys floors 1–3; every later floor costs 1 energy; Press On is disabled at zero energy while Bank & Leave remains available. Do not record spend unless it was actually deducted. Show the future cost at the entrance and checkpoint.

#### DUN-03: Escapes are presented as failures

**Evidence:** every non-banked run uses the heading “You Fall...” even when `dungeon.hp > 0` and the body correctly identifies a retreat.

**Impact:** Successful risk management feels like defeat, and recent-history terminology (“Fled”) conflicts with the summary.

**Fix:** replace the boolean outcome model with `endReason: 'banked' | 'fled' | 'defeated'`. Use distinct art, heading, explanation, color, and analytics for each.

#### DUN-04: Normal-floor combat is avoidable much more often than the generator comment implies

**Evidence:** generation guarantees that at least one node is combat, not that each root-to-terminal route contains combat. A deterministic 10,000-map simulation found:

| Depth | Maps with a zero-combat route | Share of all routes with zero combat | Mean danger rooms per route |
|---:|---:|---:|---:|
| 1 | 54.1% | 22.9% | 1.13 |
| 4 | 54.1% | 22.9% | 1.13 |
| 8 | 47.0% | 18.4% | 1.25 |

Boss floors correctly have no zero-combat route.

**Impact:** because room types are visible, rational players can frequently take treasure/rest/encounter routes and avoid the system that supplies most danger. Route choice becomes “spot the free path,” not a nuanced risk decision.

**Fix:** guarantee at least one danger node on every normal-floor route, or explicitly price routes by risk. The better design is to show Low/Medium/High danger and scale loot accordingly; a safe utility route can remain valid if it has materially lower expected reward.

### P2 — high-value quality and correctness work

#### DUN-05: `roomsCleared` counts rooms entered

The counter increments before the room resolves. A room in which the player flees or dies is reported as cleared. Rename the field to `roomsEntered` or increment `roomsCleared` only after successful resolution; ideally track both.

#### DUN-06: Unlimited-energy mode is blocked by the entrance UI

The store honors `settings.unlimitedEnergy`, but `DungeonView` computes `canEnter` only from current energy. At zero energy the UI disables the button even though `startDungeon` would permit entry.

#### DUN-07: Merchant route preview ignores the player’s discount

`FloorMap` calls `merchantOffers(depth)` without the Trading Post discount. The actual room uses the discount. The preview can therefore advertise prices that differ from the prices shown one tap later.

#### DUN-08: Route-map connectors are not resize-aware

Connector coordinates are measured after React renders, but there is no `ResizeObserver` or resize listener. Viewport changes, orientation changes, font swaps, and containing-layout changes can leave lines detached from nodes until another state render. Live validation pending.

#### DUN-09: Loss exposure is not quantified in the HUD

The HUD shows banked loot and current-floor loot, but not the exact retained/lost totals for flee or defeat. Since item loss is all-or-nothing while currency loss is fractional, the generic warning is inadequate even after its copy is corrected.

#### DUN-10: No general retreat action exists outside combat

Banking is checkpoint-only and fleeing is combat-only. A player who must stop during a treasure, encounter, shrine, rest, merchant, or path decision must either leave the run suspended or continue until combat/checkpoint. Add a persistent “Retreat from expedition” action using the same clearly previewed flee policy and a confirmation dialog.

#### DUN-11: Boss progression asks players to replay every shallow floor

Unlocks occur at depths 5, 8, and 10, but each expedition restarts at floor 1. This strengthens roguelite build-up, yet it also makes repeated boss attempts and late-biome access increasingly slow. Anti-frustration boss relief reduces combat difficulty but not the time tax. Live timing validation is needed before choosing between a checkpoint-start system and shorter floors.

**Recommendation:** after defeating a biome boss, unlock an optional expedition start at the beginning of that biome, priced appropriately and seeded with a small fixed starter boon package. Preserve floor-1 starts for record runs.

#### DUN-12: Dungeon XP can compete with the habit system’s authority

Combat immediately grants attack-stat and HP XP; successful checks grant their checked stat XP; Dungeon XP is full-weight for level-up stat allocation. That makes the mode useful and satisfying, but it also lets play determine both leveling pace and stat direction. The energy loophole amplifies this substantially.

**Recommendation:** fix the energy contract first and instrument XP per energy/time before adding a cap. If Dungeon still supplies more than roughly one-third of routine weekly level XP for a habit-active player, discount Dungeon XP for stat-allocation weighting rather than deleting the reward.

#### DUN-18: Repeated curses can produce duplicate React keys and unbounded negative run stats

`rollCurse` does not exclude held curses, so duplicates intentionally stack. The Relic modal keys entries only by relic key, producing duplicate React keys. More importantly, repeated `brittle_bones` penalties are added directly to max HP without a minimum clamp; the shrine and encounter curse paths can therefore leave an active run with non-positive max HP in a sufficiently long run.

**Fix:** key repeated relic UI by key plus occurrence index; decide and document whether curses stack; clamp derived max HP and combat stats to engine-safe minima; add repeated-curse tests around shrine, encounter, fighter construction, and persistence.

#### DUN-19: The persistent HUD grows linearly and duplicates relic information

`RelicTray` renders every relic icon, then `RunBuffs` renders every relic again as a full row. A normal deep run gains at least one checkpoint boon per pressed-on floor plus room boons, so the HUD can push the route map below the fold. Triggered relics with an empty static `effect` also render a row with no right-side effect token.

**Fix:** keep a compact, capped icon tray plus one aggregated stat line in the HUD; move the complete per-relic list and trigger descriptions into the existing modal. Live mobile-height validation pending.

### P3 — polish and long-tail depth

#### DUN-13: Scene art was placeholder-only

The scene registry was empty, so every Dungeon banner used a generated emoji card. This audit implements authored inline-SVG art for all 17 used Dungeon room/outcome/state keys, with biome tint compatibility and ambient glow/dust/flame animation disabled under reduced motion.

#### DUN-14: Relic art is only half complete

There are 38 relic definitions and 19 bespoke PNGs. The remaining 19 use generated crests:

`padded_jerkin`, `runed_band`, `bone_ward`, `frost_mantle`, `aegis_charm`, `windrunner_sash`, `gilded_mask`, `shadow_mantle`, `verdant_sigil`, `twin_sage`, `bloodied_fang`, `desperate_ward`, `shrine_stone`, `worldroot_heart`, `dragon_scale`, `soulbound_crown`, `frostbitten_edge`, `dull_blade`, `clouded_mind`.

Prioritize triggered relics, tier-3 relics, and curses because they need the strongest recognition in decision screens.

#### DUN-15: Infinite depth cycles authored content

After floor 15, the three biomes repeat with larger numbers. Endless scaling exists, but new discovery does not. Add biome mutators, enemy affixes, encounter variants, and boss modifiers before adding a fourth raw biome; these multiply existing content more efficiently.

#### DUN-16: Route choice lacks compact strategic comparison

Players see room icons and connections but not estimated danger, likely reward category, current-build synergy, or rooms remaining. Add a tap/hover detail card and one-line route summary. Avoid revealing exact RNG outcomes.

#### DUN-17: Checkpoint healing labels show nominal rather than actual healing

“Rest (+40% HP)” can overstate the gain near full health. Display the clamped amount, e.g. `+12 HP`, so the boon-versus-rest decision is exact.

#### DUN-20: Shrine failure feedback is too easy to miss

A failed prayer adds a curse and immediately advances to the next route choice. There is no dedicated outcome panel naming the curse; the player must notice a new relic icon/audio cue. Add a short shrine result state before advancing, with the curse name, art, and exact effect.

## Visual and interaction review

### Implemented in this audit

- Replaced emoji scene placeholders with a cohesive dark-stone SVG language.
- Added distinct subjects for entrance, checkpoint/campfire, treasure, shrine, merchant, encounter, combat/elite/boss, victory, defeat, clear, and retreat.
- Preserved biome tint overlays.
- Added slow glow, dust, and flame motion only; no animation communicates required state.
- Added `prefers-reduced-motion` handling.
- Added coverage and accessible-SVG tests.

### Remaining visual priorities

1. Complete triggered, tier-3, and curse relic sprites.
2. Give each biome a distinct map frame/background treatment, not only a translucent tint.
3. Add an explicit current-node marker and danger/reward treatment to the floor map.
4. Give banked versus exposed loot stronger containers and loss-preview colors.
5. Validate 320–400 px layouts, especially encounter buttons with multiple right-side tags. Live validation pending.
6. Validate focus order, keyboard activation, screen-reader names, and contrast in all palettes.

## Habit-tracker alignment

The desired relationship should be:

`complete real habit → earn energy / maintain streak → take a bounded expedition → receive satisfying feedback → return to habits`

The current relationship becomes, after depth 3:

`complete three habits once → enter expedition → continue even at zero energy → earn XP and loot indefinitely`

Recommended guardrails:

- Enforce and display the post-depth-3 energy cost.
- Keep Bank & Leave permanently available at checkpoints.
- Put the streak multiplier on the entrance and checkpoint loot forecast, not only the final collection screen.
- On collection, provide a direct “Back to today’s habits” action and show how many energy points the run consumed.
- Track run duration, floors, XP, gold, and energy as product metrics. Balance by XP/energy and XP/minute, not raw payout alone.
- Do not add daily quests that require Dungeon play; the game should reward habits with play, not turn play into another obligation.

## Recommended gameplay direction

Keep Dungeon Delve as the thoughtful, turn-based mode: approximately 2–4 minutes per floor, a meaningful checkpoint every floor, and a 12–20 minute default expedition. Its identity should be informed risk management rather than reflex execution.

The highest-value design change is route pricing. Every route should communicate a tradeoff:

- **Danger route:** combat/elite density, highest gold/XP/boon potential.
- **Fortune route:** treasure/encounter variance, medium danger, item potential.
- **Recovery route:** rest/merchant/shrine utility, lowest direct payout.

This retains player agency without allowing an obviously dominant free-loot route.

## Implementation plan

> **Superseded (2026-07-10):** the full itemized implementation plan now lives in `docs/dungeon-delve-plan-2026-07.md`, incorporating the verified adversarial corrections, DUN-21/DUN-22, and the missing-feature list above. The phase outline below is retained as a summary only.

### Phase 0 — restore trust in the rules (small, first)

1. Add `DungeonEndReason` and replace `cleared: boolean` as the presentation source of truth.
2. Centralize bank/flee/defeat retention constants and reward-preview math in the engine.
3. Render exact retention copy and totals at entrance, HUD retreat confirmation, checkpoint, and summary.
4. Fix `roomsCleared` semantics.
5. Honor `unlimitedEnergy` in `canEnter`.
6. Pass the merchant discount into route previews.
7. Add store tests for every end reason and reward category.

Acceptance: no reward-policy prose is hard-coded independently of engine values; gold, materials, items, weapons, and gear are covered by tests.

### Phase 1 — reconnect play to habits and bound sessions

1. Enforce 1 energy per floor after floor 3; never clamp-and-continue.
2. Disable Press On at insufficient energy and explain why; never disable Bank & Leave.
3. Record only energy actually deducted.
4. Show total run energy and streak-adjusted gold at checkpoints and summary.
5. Add “Return to habits” after collection.
6. Add telemetry/report fields for duration, floors, XP, gold, and energy.

Acceptance: a zero-energy character cannot enter a paid floor; accounting equals actual deductions; a normal run has a clear stopping point.

### Phase 2 — make paths strategically interesting

1. Add pure route-analysis helpers for danger and reward category.
2. Either guarantee danger on every route or reduce reward on danger-free paths.
3. Add route summary/detail UI and an explicit current-node marker.
4. Add a general retreat action with an exact loss preview.
5. Tune room weights from simulation plus observed play data.

Acceptance: no route is dominant across health/build states; simulation invariants and map reachability tests remain deterministic.

### Phase 3 — progression and boss pacing

1. Time first clear, repeat clear, first boss attempt, and repeat boss attempt.
2. Decide whether cleared biomes unlock expedition starting points.
3. Tune boss scaling and relief using win rate and turns-to-kill by level/build.
4. Add biome mutators/affixes for floors 16+.
5. Reassess Dungeon XP allocation weight after the energy fix.

Acceptance targets: first biome boss win rate 45–65% on first informed attempt; repeat attempt reaches the boss in under 10 minutes; no single weapon/stat profile dominates.

### Phase 4 — finish the visual layer

1. Complete the 19 missing relic assets in priority order.
2. Add biome-specific SVG map frames and ambient layers.
3. Add exposed-loot loss visualization and richer checkpoint transitions.
4. Run mobile, reduced-motion, contrast, keyboard, and screen-reader passes.
5. Add screenshot regression coverage for entrance, path, each special room, checkpoint, flee, defeat, and banked summary.

## Verification status

- Targeted Dungeon/map/scene/content/balance tests: **50 passed**.
- TypeScript typecheck after SVG integration: **passed**.
- Production build: **passed**.
- Full repository suite after the concurrent Tactics work settled: **81 files / 1,954 tests passed**.
- Live MCP browser playtest: **pending browser attachment**.

## Live playtest checklist before sign-off

- Fresh level-3 entry at desktop and 390 px mobile width.
- One run through combat, encounter, treasure, shrine, rest, and merchant.
- Bank, flee, encounter death, and combat death summaries.
- Depth-4 energy transition at 1 energy and 0 energy.
- First floor-5 boss attempt, loss, retry, and phase transition.
- Reload/resume at path choice, active room, boon modal, checkpoint, and ended summary.
- Reduced-motion and sound-disabled behavior.
- Keyboard-only path, combat, modal, and summary navigation.
- SVG scene clipping, tinting, animation, and contrast in every palette.
