# The Homestead Audit — July 2026

> **Resolution status (2026-07-10):** every finding below (TOWN-01 – TOWN-20) has been **fixed** — including the Phase 5 balance changes (tier-scaled perks, open-ended charters, adjacency prestige, building-prestige deed gates) after design sign-off. Execution record: [`homestead-plan-2026-07.md`](./homestead-plan-2026-07.md) (all 23 items checked, each fix landed with regression tests and was re-verified in a live browser playtest). This document is preserved as the pre-fix analysis; file:line citations reference the pre-fix tree.

**Verification status (2026-07-10, rev 2):** every code claim below was verified against the **uncommitted working tree on top of commit `7129378`** (the tree carries in-progress dungeon-phase changes — none touch town files). Baseline before auditing: the six town-specific test files (`engine/__tests__/town.test.ts`, `store/__tests__/townLabor.test.ts`, `store/__tests__/townSlice.test.ts`, `components/town/__tests__/{TownView,TownCanvas,iso}.test.*`) pass 66/66; the wider town-adjacent set adding `persistMigration.test.ts` + `layering.test.ts` passes 85/85 across 8 files; `npm run typecheck` clean. The three highest-severity defects (TOWN-01, TOWN-02, TOWN-05) were additionally **reproduced live** in a browser playtest against `npm run dev` using a throwaway guest save. Findings a subagent reported but that verification disproved were corrected or dropped (see "Corrections"). An adversarial review pass (Codex) subsequently challenged seven points; **all seven were verified and are folded into the findings below** — see the addendum's resolution notes.

---

## Executive assessment

The Homestead is architecturally the healthiest minigame in the codebase: a genuinely pure engine reducer (`src/engine/town.ts`, 480 lines, no clock/RNG/store imports), a slice that faithfully mirrors the `craft()` validate→subtract escrow idiom, a renderer that honors the party-visit freeze (reads only the `town` payload), and broad, pointed engine tests. The habit→labor loop ties progression to real habit logging more tightly than any other system — labor is live-only, once per habit per day, and hard-capped at 24/day (energy can be hoarded; labor cannot) — and the reward receipt ("+11 XP · +1⚡ · +1 🔨") makes the payoff legible at the exact moment a habit is logged. That guarantee is narrower than "unfarmable", though: difficulty edits between complete and uncomplete desync the clawback (TOWN-04), and throwaway habits can fill the daily cap — the cap bounds the damage, not the honesty.

The defects cluster in two places. First, two P1 correctness holes the tests never reach: **rotation renders a transposed footprint** (a rotated building's art covers cells it doesn't own, and its real cells look like empty grass — both directions reproduced live), and **demolishing a building with a queued upgrade orphans the project** — the orphan is invisible, uncancellable, blocks the only build slot ("Build queue is full" on every Place button), and silently eats labor forever; a live playtest soft-locked the mode in four clicks. Second, a design-economics gap: perks are flat across tiers, so ~94% of all building gold (29,100g of 30,950g) buys nothing but prestige and art, the build-order decision has one right answer (Mason first), and after ~39k gold (ceiling incl. maxed decor) the mode's sink role simply ends, re-opening the BAL-05 hole it was built to close. A third, smaller cluster is reachability: decor removal is implemented end-to-end in engine and store but has no UI entry point at all (TOWN-19).

**Overall: strong foundation, two must-fix P1 bugs, and a mid-game economy that needs one more design pass to keep the sink alive past month two.**

---

## Scope and method

- **Code read:** `src/engine/town.ts`, `src/content/townBuildings.ts` + `townDecor.ts`, `src/store/slices/townSlice.ts`, the labor pipeline in `src/store/slices/habitsSlice.ts` (grant ~299–315, clawback ~430), `src/components/town/*` (`iso.ts`, `TownCanvas.tsx`, `townArt.tsx`, `TownBuildPanel.tsx`, `TownBuildingCard.tsx`), `src/views/TownView.tsx`, `src/views/ExploreView.tsx` wiring, selectors, persist migration, `src/net/cloudSave.ts`.
- **Fact-check pass:** claims of `docs/homestead-development-plan.md`, `docs/habits-rpg-improvement-plan3.md` Phase 10, and `docs/INDEX.md` verified against source (two doc-fact-checker subagents).
- **Specialist passes:** one code-health audit and one game-design/economy audit (subagents), findings adversarially re-verified in the main session before inclusion.
- **Live playtest:** Playwright against the dev server — placement/rotate/confirm flow, demolish-during-upgrade, habit completion → labor receipt, queue-full states, deed/build panel gating. Screen-geometry probes used the real `iso.ts` projection via module import, so cell-level claims are exact, not eyeballed.
- **Baseline:** `npx vitest run` on the 6 town test files (66/66 green) and `npm run typecheck` (clean) before any claims were made.

Severity scale (audit charter): **P0** data loss / crash / desync · **P1** significant defect or design flaw degrading the core loop · **P2** tech debt / missing tests / meaningful friction · **P3** polish / cosmetic / speculative.

---

## Current loop

Habits → labor (live completions only, difficulty-scaled 1/2/4/6, once per habit per day, capped 24/day) → banked (cap 200) → drained into the active project(s) (queue depth 1; 2 with Keep tier III) → building completes → prestige + a light perk → prestige gates deeds (pure-gold 500/1,500/4,000) → more land → more buildings. Gold + materials are charged up front at queue time (escrow); labor is the pacing currency. Perks feed back into the other modes at eight seams (sight, stamina, merchant discount, trial practice, energy cap, labor discount, Forge sweet-zone, queue slots).

## What already works

- **All 8 perk seams are wired and live** — verified at each consumer: `sightBonus` snapshotted into mine/forest runs (`miningSlice.ts:125`, `forestSlice.ts:122`), `staminaBonus` at dungeon run start (`commit.ts:233`), `merchantDiscount01` in dungeon offers **including the FloorMap preview** (`commit.ts:425`, `DungeonView.tsx:507`, `FloorMap.tsx:291` — the old DUN-07 preview gap is fixed in the working tree), `trialPractice` (`trialsSlice.ts:60`), `maxEnergyBonus` (`commit.ts:586`), `laborDiscount01` at queue time (`town.ts:276`), `forgeSweetBonus` (`ForgeMinigame.tsx:113` → `engine/crafting/forge.ts`), `queueSlots` (`town.ts:229/255/308/357`).
- **The visit-freeze boundary holds**: `TownCanvas` destructures only `{ town, onCellTap, onBuildingTap, ghost }` (`TownCanvas.tsx:214`), grep of `src/net/` finds zero town references, and `layering.test.ts:146-173` guards `src/net/coop/**` against importing `engine/town`.
- **Labor/energy decoupling is correct**: labor uses its own `lastLaborGrantISO` marker (`habitsSlice.ts:206`) so it still grants on an energy-capped day; backdated logs grant neither; HABIT-04 re-mint protection carries over.
- **Persistence is right**: town migration is **v34** (`useGameStore.ts:258` — `migrate` backfills `p.town ?? freshTown()`, `merge` nested-defaults it), and `town` is deliberately absent from `TRANSIENT_KEYS` (`cloudSave.ts:131`) so it rides the cloud blob.
- **The escrow idiom is consistent**: nothing mutates until all checks pass; `unlimitedGold` frees gold only, materials always charged — uniform across build/upgrade/decor/deed (`townSlice.ts:52-129`).
- **`iso.ts` is not copy-paste of `tactics/iso.ts`** — square-diamond vs hex-axial projection; the shared part is ~15 lines of idiom, justified divergence.
- **Zero-buildings regression guard** (`townLabor.test.ts:113-149`) proves six of the eight perk seams fall back byte-identically to pre-Homestead behavior with an empty town (the other two are covered only by struct equality — see TOWN-10).
- The plan's pacing example holds as shipped: a 4-normal-habit day (8 labor) finishes a tier-I building (15 labor) in ~2 days, as `homestead-development-plan.md:359` intended.

---

## Findings

### [TOWN-01] Rotated buildings render on a transposed footprint — art and collision disagree (P1, confidence: high — reproduced live)
- **Area:** `src/components/town/TownCanvas.tsx` + `src/engine/town.ts`
- **Observation:** The rotation render is `scale(-1,1)` about the anchor's base point (`TownCanvas.tsx:414,422`). In the diamond projection, mirroring x maps cell offset (dr,dc) → (dc,dr), so a rotated 2×3 building's art lands exactly on the **transposed** 3×2 footprint. Meanwhile every logical check uses unswapped `def.w/def.h`: `canPlace` ignores its `_rot` param entirely (`town.ts:248`), `occupancy` (`town.ts:154`), tap hit-testing `buildingAt` (`TownCanvas.tsx:274`), and the ghost preview (`TownView.tsx:107`). Affects both rotatable buildings — Training Yard and Manor, both 2×3 (`townBuildings.ts:115,165`).
- **Live repro:** placed a rotated Training Yard at (5,6): DOM measurement shows its art bounding box spans world x∈[−32,128] — precisely the transposed footprint {rows 5–6, cols 6–8} — while occupancy reserves {rows 5–7, cols 6–7} (x∈[−64,96]). A Watchtower then placed at (5,8) **renders inside the yard's fence**; a Bathhouse anchored at the visually empty grass at (7,6) is refused with "Space is occupied".
- **Prior-doc status:** not covered by any prior doc; zero test coverage of `rot` anywhere.
- **Impact:** overlapping art, taps on a rotated building's visible half miss it, phantom-blocked grass tiles. Every rotated placement quietly corrupts the board's visual truth.
- **Full fix surface (per adversarial review AR-02, verified):** the drift is not only engine collision vs completed art. Queued build scaffolds ignore `proj.rot` entirely — `ringOffset(def.w, def.h)`, `sortKey(proj.r, proj.c, def.w, def.h)`, and `scaffold(def.w, def.h)` at `TownCanvas.tsx:471-478`; completed-building upgrade rings and sparkle origins also use unrotated `ringOffset(def.w, def.h)` (`TownCanvas.tsx:375, 416`); and the ghost uses unrotated dims in all build/move paths (`TownView.tsx:89-107`).
- **Recommendation:** add one shared `footprintDims(def, rot)` helper (`{w: def.h, h: def.w}` when `rot === 1`) and use it **everywhere footprint dimensions are derived**: engine `occupancy`/`canPlace`/`moveBuilding`, canvas `buildingAt`/`sortKey`/`ringOffset`/`scaffold` (completed buildings *and* queued projects *and* sparkles), and the `TownView` ghost. The mirrored render already matches the transposed footprint, so the art itself can stay. Add an end-to-end rot test (queue rotated → scaffold/ring placement → settle → occupancy/tap/move).

### [TOWN-02] Demolishing a building with a queued upgrade orphans the project — invisible, uncancellable, soft-locks the build queue (P1, confidence: high — reproduced live)
- **Area:** `src/engine/town.ts` + `src/components/town/TownBuildingCard.tsx`
- **Observation:** `demolish()` has no guard against a queued upgrade targeting the building (`town.ts:426-441`), unlike `moveBuilding` which blocks exactly this (`town.ts:447`). The UI matches: only Move is disabled during an upgrade (`TownBuildingCard.tsx:140`); Demolish stays enabled (`:148-156`). The orphaned project then: (a) holds the only queue slot, (b) absorbs labor — `applyLabor` drains `queue[0..slots)` blindly (`town.ts:359`), (c) settles as a silent no-op (`town.ts:411` maps over buildings and matches nothing), and (d) if cancelled would refund `tiers[0]` materials instead of the escrowed tier because of the `find(...)?.tier ?? 0` fallback (`town.ts:333`). Worse, the orphan is **unreachable in the UI**: the upgrade's progress ring is keyed to the (now deleted) building and the only Cancel button lives in that building's card.
- **Live repro:** queued a Training Yard upgrade (30 labor), demolished the yard — toast cheerfully said "Training Yard demolished", the project remained in `queue` targeting a dead id, every Place button in the build panel became disabled with "Build queue is full", and a subsequent habit completion drained +1 labor into the ghost (`laborApplied: 1`). The mode is soft-locked until 30 labor is ground into nothing.
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** escrowed gold + materials + up to a week of labor silently destroyed; the entire build system locks with no visible cause or escape.
- **Recommendation:** in `demolish()`, return the town unchanged when `town.queue.some(p => p.buildingId === buildingId)` (mirror the `moveBuilding` guard); also disable the Demolish button while `activeProject` exists. Consider a defensive sweep in `settleProjects` that drops upgrade projects whose target no longer exists *with a refund*, to heal existing saves.

### [TOWN-03] Perks are flat across tiers — 94% of building gold buys only prestige, and past deed 3 buys nothing at all (P1 design, confidence: high)
- **Area:** `src/engine/town.ts:217-232` + `src/content/townBuildings.ts`
- **Observation:** `townPerks` reads only the *presence* of `def.perk`, never the tier — the sole tier check in the whole perk system is the Keep's ≥ III queue slot (`town.ts:229`). Computed from the catalog: tier-I gold = 100 + 150 + 8×200 = **1,850g** of the **30,950g** building total, so 29,100g (94%) of building spend grants zero function. The deed gates don't force tier IIIs either: Keep I–II (65) plus seven medium tier-IIs (7×40 = 280) reaches 345 prestige ≥ the final gate of 320 (`townBuildings.ts:61`), leaving all tier-IIIs (21,400g — 58% of the whole town) motivated by nothing but art.
- **Prior-doc status:** `homestead-development-plan.md` locked "light, non-resource perks" but never decided flat-vs-scaling; plan3 10.5 shipped flat.
- **Impact:** a rational player stops spending at ~15k gold; the flagship BAL-05 sink half-closes and the wallet resumes unbounded growth much earlier than the catalog's cost curve implies.
- **Recommendation:** scale one number per perk with tier (e.g. sight +1/+1/+2 · stamina +5/+10/+15 · haggle 5/10/15% · granary +1/+2/+3 · mason 5/10/15% · forge +0.02/+0.03/+0.04). Pure data + `townPerks` change; stays inside the plan's "≤ one boon increment" power budget at tier III.

### [TOWN-04] Labor clawback removes the wrong amount — daily-cap clamp AND difficulty edits both desync it (P2, confidence: high)
- **Area:** `src/store/slices/habitsSlice.ts:430-432` + `src/engine/town.ts:375-395` + `habitsSlice.ts:84-95`
- **Observation:** The clawback recomputes the amount as `laborFor(habit.difficulty)` at uncomplete time (`habitsSlice.ts:431`) instead of using what was actually credited. Two ways this desyncs:
  1. **Daily-cap clamp:** the grant marker is stamped whenever `grantLabor` is true (`:217`) even if `applyLabor` credited less than the nominal rate (day-cap clamp, `town.ts:353`). At 23/24 cap, an epic completion credits 1; uncompleting removes 6 — 5 of them earned by other habits. Because the marker survives (HABIT-04 idiom), re-completing grants nothing back: the loss is permanent.
  2. **Difficulty edits (adversarial review AR-03, verified):** `updateHabit` passes the patch through with only `type` stripped, so difficulty is freely editable between complete and uncomplete (`habitsSlice.ts:84-90`). Complete as `easy` (+1), edit to `epic`, uncomplete (−6): 5 labor stolen from the bank/other habits. Complete as `epic` (+6), edit to `easy`, uncomplete (−1): 5 labor kept — farmable, though bounded: `laborToday` moves with the same wrong amounts, so total banked labor still cannot exceed the 24/day cap; the exploit lets easy habits fill the cap, not exceed it.
  Contrast the energy path, which decrements exactly the 1 it granted (`:419-424`), and the milestone path, which stores the granted amount and claws back exactly that (`:437-444`).
- **Prior-doc status:** the engine docstring documents the *completed-project* leak as accepted (`town.ts:374`); both desyncs above are distinct, undocumented, and bidirectional.
- **Impact:** honest undos destroy other habits' labor; dishonest edit-cycling inflates easy habits to epic rates. Both erode the receipt's trustworthiness at the core of the habit loop.
- **Recommendation:** follow the `lastMilestoneGrant` idiom — store `lastLaborGrant: { dateISO, amount }` on the habit using the `credited` value already computed at `habitsSlice.ts:309`, claw back exactly that stored amount, and keep reading the legacy `lastLaborGrantISO` for saves written before the change.

### [TOWN-05] At the labor-bank cap the toast over-reports and the promised "bank full" hint never shipped (P2, confidence: high)
- **Area:** `src/engine/town.ts:355` + `src/store/slices/habitsSlice.ts:309-312`
- **Observation:** `credited` is computed from the `laborToday` delta, but the bank clamp at `TOWN_LABOR_BANK_CAP = 200` is separate and silent (`town.ts:355`). With a full bank and no drainable project, the receipt still shows "+N 🔨" while the labor evaporates — and the overflow still consumes daily-cap headroom. `homestead-development-plan.md:28` and `:414` both specify a *"bank full — start a project"* HUD hint; grep of `src/` finds no such copy anywhere.
- **Prior-doc status:** contradicts the dev plan's locked overflow handling (hint promised, not shipped).
- **Impact:** the reward receipt — the mode's core habit-loop payoff — lies by omission precisely when a checked-out player is losing weeks of labor.
- **Recommendation:** compute credited from the bank + queue delta, and ship the one-line "bank full — start a project" toast variant next to the existing "town cap reached" copy (`habitsSlice.ts:343`).

### [TOWN-06] No repeatable sink survives town completion — BAL-05 re-opens after ~37k gold (P2 design, confidence: high)
- **Area:** economy-wide; `src/content/townBuildings.ts:56`, `src/store/slices/townSlice.ts:104`
- **Observation:** Full-town spend ceiling, computed from the catalog: buildings 30,950g (Keep 7,700 + Watchtower 2,050 + 8 mediums × 2,650) + deeds 6,000 + decor max 2,300 (the priciest 60-slot mix) = **39,250g**. Deeds are exactly three one-shots (`deeds >= 3` hard stop, `townSlice.ts:104`). Raw total labor is 1,165; on the dominant Mason-first route (TOWN-07) the discounted total is ~1,060, so the town takes **~106–177 days** at a realistic 6–10 labor/day (raw: 117–194); a cap-saturating player finishes in ~44–49. Against the balance audit's 300–900g/day faucets, the wallet outgrows the sink the whole time. After deed 3 the only repeatable spends are decor (10–80g, hard-capped at 60 items) — demolish-rebuild is correctly unprofitable (0% gold refund).
- **Prior-doc status:** partially contradicts the BAL-05 framing in `homestead-development-plan.md` §1 — the deeds were pitched as "repeatable-scaling" gold targets but shipped as three one-shots.
- **Impact:** the mode is a one-time campaign, not a standing sink; end-state players return to post-scarcity in 2–6 months.
- **Recommendation:** add a repeatable prestige-scaled spend at the existing seam — e.g. deed 4+ at escalating cost (one array extension + removing the hard stop), or "festival" events (~500g × festivals held) granting a day of cosmetic town fx.

### [TOWN-07] Mason-first is numerically dominant, flattening the one real decision (P2 design, confidence: high)
- **Area:** `src/engine/town.ts:275-277` + catalog
- **Observation:** Mason's Guild tier I costs 200g + 15 labor and discounts all subsequently queued labor by 10% (`snapLaborNeed`, applied at queue time). Queued-after savings ≈ 0.10 × ~1,050 remaining labor ≈ **105 labor — 7× its own cost**, i.e. ~10–17 real days saved. No other perk affects town progression itself.
- **Impact:** every informed player opens Keep I → Mason I; "which building first?" — the mode's central choice — has one right answer.
- **Recommendation:** scale the discount with tier (5/10/15%) so rushing Mason III competes with wanting QoL perks now, and/or let a couple of other perks touch the town loop (e.g. Granary banks +25 labor cap per tier).

### [TOWN-08] Placement is mechanically inert and the queue gives ~one decision per week (P2 design, confidence: high)
- **Area:** `src/engine/town.ts:148-168` (occupancy is the only positional read in the engine)
- **Observation:** No adjacency, connectivity, or district rule exists anywhere; where you put a building is purely cosmetic. Queue depth is 1 (2 with Keep III); tier-III projects need 55 labor ≈ 5.5–9 days at realistic rates — one decision, then nothing to do or decide between completions.
- **Impact:** between queue picks the Homestead is a passive progress bar; the "visibly under-construction town" hook carries all engagement. Acceptable for a calm sink, but there's no reason to open the tab on days 2–6 of a project.
- **Recommendation:** one light positional rule is enough to make placement a puzzle — e.g. decor adjacent to a completed building grants +1 prestige, or cobble-path-connected buildings shave 5% off their next upgrade's labor.

### [TOWN-09] TownView re-implements engine placement validation — and the rotation fix must remember it (P2, confidence: high)
- **Area:** `src/views/TownView.tsx:29-45`
- **Observation:** `footprintOk` re-derives bounds + locked + occupied from `occupancy`/`inUnlockedLand` instead of an engine-exported `canPlaceDecor`/`canMove`; unlike `placeDecor` it also skips the decor caps (harmless today only because the panel pre-gates them). Two validation paths that can drift — TOWN-01's `dims()` fix has to be applied in both or the ghost and the engine will disagree.
- **Recommendation:** export reason-returning `canPlaceDecor`/`canMoveBuilding` from `engine/town.ts` and have the ghost, the slice, and the panel share them.

### [TOWN-10] Test gaps sit exactly where the defects are (P2, confidence: high)
- **Area:** test suite
- **Observation:** Zero coverage of: rotation end-to-end (where TOWN-01 lives); `TownCanvas` gesture math (pan/pinch/`zoomAnchored`/tap-vs-drag threshold/`cellAt` inverse projection — the most intricate interactive code in scope; existing tests are render-smoke only); slice wiring for `townDemolish`/`townMoveBuilding`/`townRemoveDecor` (`townSlice.test.ts` covers only queueBuild/buyDeed/cancel — TOWN-02's demolish path was never exercised at the slice level); the global `TOWN_DECOR_CAP = 60` (only the per-type cap is tested, `town.test.ts:287`); a `laborISO` day-boundary crossing through `completeHabit` (TOWN-11); and seam-level zero-buildings baselines for `laborDiscount01` and `queueSlots` (only struct-equality covered, `townLabor.test.ts:116-119`).
- **Recommendation:** when fixing TOWN-01/02/04, land each fix with the missing test tier; add one `cellAt` round-trip property test through a non-identity view transform.

### [TOWN-11] First labor grant after a day rollover computes a negative `credited` and suppresses the receipt line (P3, confidence: high)
- **Area:** `src/store/slices/habitsSlice.ts:304-312`
- **Observation:** `laborBefore = next.town.laborToday` is read before `applyLabor` resets the counter for the new day (`town.ts:352-354`). After a 24-labor day, the next morning's first completion computes `credited = 2 − 24 = −22` → neither "+N 🔨" nor "town cap reached" renders (`:342-343`), and `receipt.labor` goes negative.
- **Impact:** cosmetic (banking is correct), but it deletes the labor line from the first receipt of every active day — the loop's most habit-reinforcing moment.
- **Recommendation:** `const laborBefore = next.town.laborISO === today ? next.town.laborToday : 0;`.

### [TOWN-12] "Labor today N/24" chip shows a stale day's count until the first town action (P3, confidence: high — reproduced live)
- **Area:** `src/views/TownView.tsx:206-209`
- **Observation:** The chip renders `town.laborToday` raw with no `laborISO === today` check. Live: a save with `laborISO` two days old displayed "Labor today 2/24" on load; it corrected to 0/24 only after the next `applyLabor` call.
- **Impact:** after a maxed day it reads 24/24 the next morning — telling the player their habits earn nothing today, the exact wrong message.
- **Recommendation:** gate on `town.laborISO === toISODate() ? town.laborToday : 0` (same guard as TOWN-11's fix).

### [TOWN-13] A project completed instantly by banked labor celebrates nothing (P3, confidence: high — observed live)
- **Area:** `src/store/slices/townSlice.ts:67,88`
- **Observation:** The queue-time drain path discards `settleProjects`'s `completed` return (`const { town } = settleProjects(applyLabor(queued, 0, ...))`), while the habit path toasts each completion (`habitsSlice.ts:360-367`). Live: queuing a build with bank ≥ cost completed it with no toast at all.
- **Recommendation:** capture `completed` in the two queue actions and surface it the same way.

### [TOWN-14] Success toasts fire unconditionally on actions that can no-op (P3, confidence: high)
- **Area:** `src/views/TownView.tsx:150-165`, `src/components/town/TownBuildingCard.tsx:65-81`
- **Observation:** "queued"/"placed"/"moved"/"demolished" toasts push without checking the action took effect; the slice actions can silently no-op (affordability re-check, caps, guards). `buyDeed` already does the right before/after comparison (`TownView.tsx:167-172`). TOWN-02's live repro showed the cost: "Training Yard demolished" while the queue kept a dead project.
- **Recommendation:** apply the buyDeed compare idiom to the other toast sites.

### [TOWN-15] Shipped-feature copy still says perks are coming "in a later update" (P3, confidence: high — observed live)
- **Area:** `src/views/ExploreView.tsx:113`, `src/components/town/TownBuildingCard.tsx:14`
- **Observation:** The Explore "How to play" guide reads "Completed buildings raise your prestige and, in a later update, grant light perks" — all seven perks are live (see "What already works"). The building-card header comment likewise says "Perk wiring lands in M5" while the card itself renders "· active".
- **Impact:** the guide undersells the mode's strongest selling point — cross-mode perks — to exactly the players deciding whether to invest.
- **Recommendation:** one-line copy fix; delete the stale comment.

### [TOWN-16] Doc/code drift bundle (P3, confidence: high)
- **Area:** docs + comments
- **Observation:**
  1. "The Keep — **mandatory first project**" (`homestead-development-plan.md:122`, echoed in `townBuildings.ts:68`) is enforced nowhere — `canPlace` has no Keep rule and the live build panel offers every unlocked building on an empty town. May be a deliberate cut, but code comment and plan both still state it.
  2. plan3 item 10.1 says persist **v33**; the town migration is **v34** (`useGameStore.ts:258`; v33 is the Forge quality-tier migration). `INDEX.md` is correct.
  3. `town.ts:60-61` claims the no-net-import invariant is "guarded in town.test.ts" — that file only guards JSON round-trip; the source-scan guard lives in `layering.test.ts:146-173` and scopes `src/net/coop/**`, not all of `src/net/` (grep of the whole directory is currently clean).
- **Recommendation:** decide Keep-first (enforce or delete the claim), fix the plan3 line, and either widen the layering guard to `src/net/**` or soften the comment.

### [TOWN-17] Decor can buy the first deed gate with zero labor (P3 design, confidence: high)
- **Area:** `src/engine/town.ts:462-469`, `src/content/townDecor.ts`
- **Observation:** Decor grants prestige with no labor cost. Max decor prestige under the caps is 110 — enough to clear the deed-1 gate (100) in one rich sitting: the cheapest catalog route to 100 is ≈1,660g + ~110 stone + ~25 wood (10 wells + 10 statues + 5 fountains + 35 one-prestige props), bypassing the "prestige is the labor-capped pacing lever" intent (`townBuildings.ts:57-60`). Gates 2 (200) and 3 (320) still require buildings, so the bypass is bounded.
- **Recommendation:** if week-2 pacing matters, count only building prestige toward deed gates (one line in `townBuyDeed`); otherwise accept and note it.

### [TOWN-18] Selector drift and dead exports (P3, confidence: high)
- **Area:** `src/store/selectors.ts:42-44`, `src/views/DungeonView.tsx:507`, `src/components/town/townArt.tsx`
- **Observation:** `selectTownPerks` has zero non-test consumers, while `DungeonView.tsx:507` computes `townPerks(useGameStore.getState().town)` inline in render — a non-reactive read that goes stale until an unrelated re-render (the `ForgeMinigame.tsx:113` `useRef` snapshot, by contrast, is deliberate run-start semantics). `townArt.tsx` exports several primitives (`isoBox`, `prism`, `roofGable`, `dome`, `spire`, `silo`, `fence`) used only in-module.
- **Recommendation:** use `useGameStore(selectTownPerks)` in DungeonView; un-export the module-private art primitives.

### [TOWN-19] Decor removal is implemented end-to-end but unreachable in the UI (P2, confidence: high — found by adversarial review AR-04, verified)
*(Numbered after TOWN-18 for ID stability — severity-wise this sits with the P2s.)*
- **Area:** `src/views/TownView.tsx`, `src/components/town/TownCanvas.tsx`
- **Observation:** The engine supports `removeDecor()` with a 50% material refund (`town.ts:472-479`) and the store exposes `townRemoveDecor()` (`townSlice.ts:131-136`), but no view or component ever calls it — grep finds the action only in the slice and the `GameState` type. `TownCanvas` exposes only `onCellTap`/`onBuildingTap` (decor isn't tappable as an object), and `TownView` wires building taps only.
- **Impact:** decor is permanent for players: a mis-placed 2×2 fountain occupies four cells forever, the 60-prop global cap can be filled with no recovery, and the refund path documented in the in-game guide is dead code. Also blocks TOWN-17's mitigation (players who decor-rush a gate can never reclaim the cells).
- **Recommendation:** make decor tappable (extend `TownCanvas` hit-testing to decor footprints) and open a small decor card with a Remove-with-confirm action calling `townRemoveDecor`; cover with a component test and a slice test (the action currently has zero regression protection).

### [TOWN-20] Deed-gate placement failures report as "Prestige too low" (P3, confidence: high — found by adversarial review AR-06, verified)
- **Area:** `src/engine/town.ts:254`, `src/views/TownView.tsx:47-54`, `src/components/town/__tests__/TownView.test.tsx:53`
- **Observation:** `PlaceReason` has no deed-specific value — any `unlockMet()` failure returns `'prestige'` (`town.ts:254`), which the ghost error path renders as "Prestige too low" (`TownView.tsx:52`). The Manor's gate is a *deed*, not prestige. Today the build panel's separate `gateNote()` pre-blocks these ("Needs deed 2"), so the wrong copy is latent — but the panel and engine are two validation paths that can drift (see TOWN-09). Adjacent: the test comment at `TownView.test.tsx:53` still says the first deed gate is 40; it was retuned to 100 in M6.
- **Impact:** latent misleading copy if a deed-gated building ever reaches placement mode (stale UI state, dev tools, future unlock changes).
- **Recommendation:** split the reason into `'deed' | 'prestige'` (one line in `unlockMet`/`canPlace`, one entry in `PLACE_REASON`), assert both in the `canPlace` tests, and fix the stale test comment while there.

---

## Economy snapshot (computed from the catalogs)

| Quantity | Value |
|---|---|
| Total building gold (all tiers) | 30,950g (tier-I only: 1,850g) — raw catalog total |
| Deeds | 6,000g (500 / 1,500 / 4,000, one-shot ×3) |
| Decor (60 slots, priciest mix) | 2,300g max (10 each of fountain/statue/well/cart/banner/lamppost); full-town ceiling ≈ **39,250g** |
| Total labor for a full town | 1,165 raw (Keep 265, Watchtower 100, 8 mediums × 100) · ~1,060 on the dominant Mason-first route |
| Days to full town (Mason route) | ~177 @ 6 labor/day · ~106 @ 10/day · ~44 @ cap (24/day) — raw-catalog: 194 / 117 / 49 |
| Daily cap reachability | needs 12 normal or 4 epic completions/day — an anti-spam guard, not a target |
| Materials (all buildings, excl. decor) | stone 341 · wood 273 · iron_bar 20 · gemstone 19 · amber_resin 12 · obsidian 10 · frost_quartz 5 — maxed decor adds up to ~130 stone / ~40 wood |
| Prestige ceiling | buildings 945 + decor 110 (60-slot max); deed gates 100/200/320 |
| Perk cost-efficiency standouts | Bathhouse +10 stamina ≈ +18% at EN 5 for 200g (strong) · Watchtower +1 sight ≈ +49% visible area (strong) · Mason saves ~105 labor (dominant, TOWN-07) · Granary +2 cap matters only at hoard-cap (weak) · Chapel/Manor pure prestige (honest taxes) |

The material sink is real: 341 stone ≈ 20–35 thorough mine runs — BAL-16 is genuinely closed for stone/wood. One integration wrinkle: `stone_lode` stops spawning past floor 12 (`content/mining.ts:125`) while Keep IV alone wants 28 stone, so end-tier construction pushes players back to shallow re-runs.

---

## Gameplay improvement suggestions

*(Ideas, not defects — grouped by the audit's three asks.)*

### More fun
- **Tier-scaling perks** (TOWN-03's fix is also the single biggest fun lever): every upgrade becomes a purchase instead of a tax.
- **One positional mechanic** (TOWN-08): adjacency prestige for decor beside completed buildings, or path-connected buildings getting a small labor rebate — turns the empty grid into a light puzzle without touching the visit-freeze payload.
- **Construction events as variable reward:** a small chance (~5%) that a labor grant counts double, with a toast ("the crew found their rhythm!"). One hook at the existing `habitsSlice.ts:303` grant site; adds the variable-ratio beat the loop currently lacks.
- **A repeatable end-state spend** (TOWN-06): deed 4+ at escalating cost, or prestige-scaled festivals with a day of cosmetic fx.
- **Earlier second queue slot:** Keep III arrives ~week 5+; moving the second slot earlier (Keep II) lets short and long projects interleave and doubles decision frequency in the mid-game.

### Better support for the habit-forming goal
- **Make the labor receipt always exactly true** — the fixes for TOWN-04/05/11 together. The receipt is the mode's contract with the player; every discrepancy spends trust the habit loop needs.
- **"Raised by" plaques:** count the habit completions whose labor built each building (one counter on `TownProject`, shown in the building card). The town becomes a literal monument to logged habits — the mode's core fantasy, currently implicit.
- **Weekly labor summary** ("your habits raised 54 🔨 this week — Bathhouse II is 80% framed") to bridge the multi-day dead zone between queue decisions and give lapsing players a comeback hook.
- **Bank-full nudge** (TOWN-05's hint) so idle labor never silently evaporates on someone whose habits are still succeeding.

### Better integration with the rest of the game
- **Trading Post tier III extends the 15% discount to the main shop** — makes one weak perk matter daily and gives the tier ladder a marquee reward.
- **Deep-band stone:** extend `stone_lode` past mine floor 12 at low weight (or add a rare deep node) so Keep III/IV construction doesn't force regression to shallow floors.
- **Surface town perks at their point of use:** a one-line "Homestead: +10 stamina · 15% merchant discount" chip on dungeon/mine/forest entry screens — the perks are live (TOWN-15) but nearly invisible, so they buy no motivation.
- **Party visits (already frozen as M6/plan3 10.6):** the payload discipline has been maintained — worth prioritizing, since a visitable town multiplies the value of every cosmetic sink above.

---

## Needs manual check
- **Touch feel** of pan/pinch/zoom and the 44px tap targets on a real phone — the desktop playtest only exercised mouse + synthetic gestures (confidence: n/a, untestable here).
- **Completion sparkle when the tab is closed:** `TownCanvas`'s tier-diff sparkle only fires while the canvas is mounted; a project completed from the Quests tab celebrates via toast only. Whether that's enough ceremony is a design call.
- **`setPointerCapture` robustness:** `onPointerDown` calls `setPointerCapture?.()` which throws `NotFoundError` for non-active pointer ids (observed with synthetic events only — no evidence any real device hits this; noting for completeness).

## Corrections applied during verification
- A game-design subagent reported the Smithy's `forgeSweetBonus` as "dead data — no Forge exists." **Wrong:** the Forge lives at `src/engine/crafting/forge.ts` and consumes the perk via `ForgeMinigame.tsx:113` (the agent globbed `engine/forge*.ts` and missed the subdirectory). The Smithy perk is live and correctly snapshotted.
- The same agent claimed the dev plan's pacing example ("a 4-habit day ≈ 12 labor") drifted from shipped rates. The plan's actual worked example (`homestead-development-plan.md:359` — tier-I building in ~2 days on a 4-habit day) **holds** with shipped numbers (4 normal habits = 8 labor/day; 15-labor tier-I ≈ 2 days).
- The old DUN-07 note (merchant discount missing from the FloorMap preview) is **fixed** in the current working tree (`FloorMap.tsx:291`) — cited here so the dungeon audit's ledger can be updated.

---

## Adversarial review addendum (Codex, 2026-07-10)

> **Resolution (2026-07-10, same day):** all seven review items were independently re-verified against the code and **all seven are correct**; each has been folded into the audit body above. Disposition: **AR-01** → verification header rewritten (real HEAD `7129378`, both test-set baselines defined; the 85/8 run was reproduced). **AR-02** → merged into TOWN-01 as "Full fix surface" (scaffold/ring/sortKey/sparkle/ghost all confirmed unrotated). **AR-03** → merged into TOWN-04 (difficulty-edit desync confirmed via `updateHabit`'s pass-through patch; farmability noted as bounded by the 24/day cap since `laborToday` moves with the same wrong amounts). **AR-04** → new finding TOWN-19 (zero callers confirmed by grep). **AR-05** → economy table and TOWN-03/06/17 recomputed (decor max 2,300g, ceiling 39,250g, prestige set 345 not 330, Mason-route ~1,060 labor / 106–177 days; TOWN-17's cheapest-to-100 route recomputed at ≈1,660g — the reviewer's "max-prestige mix" costing 2,300g is the priciest such mix, not the cheapest). **AR-06** → new finding TOWN-20. **AR-07** → executive assessment reworded to the narrower true guarantee. The original review text is preserved below unedited.

This pass treated the audit text as untrusted and re-checked it against the current working tree. Current local baseline: `git rev-parse --short HEAD` is `7129378`; `docs/homestead-audit-2026-07.md` is untracked in this checkout; `npx.cmd vitest run src/engine/__tests__/town.test.ts src/store/__tests__/townLabor.test.ts src/store/__tests__/townSlice.test.ts src/components/town/__tests__/TownCanvas.test.tsx src/components/town/__tests__/TownView.test.tsx src/components/town/__tests__/iso.test.ts src/store/__tests__/persistMigration.test.ts src/engine/__tests__/layering.test.ts` passes **85 tests across 8 files**; `npm.cmd run typecheck` is clean. I did not re-run the claimed browser playtest.

### [AUDIT-AR-01] The verification header is stale and over-specific
- **Area:** audit metadata
- **Observation:** The header says every claim was verified at commit `0767589`, with 66 town-related tests across 6 files. In this checkout the HEAD is `7129378`, the audit file is untracked, and the town-adjacent verification set is 85 tests across 8 files if component, migration, and layering tests are included. The document may have meant a narrower subset, but it does not define that subset.
- **Impact:** The audit presents stronger reproducibility than it currently provides. A future implementer cannot tell whether the findings were verified against the present tree, the named older commit, or an uncommitted local state.
- **Recommendation:** Replace the header with the exact current commit or explicitly say "verified against an uncommitted local tree"; list the actual commands and file set used for the baseline.

### [AUDIT-AR-02] TOWN-01's proposed rotation fix is incomplete for queued builds and overlays
- **Area:** `src/views/TownView.tsx`, `src/components/town/TownCanvas.tsx`, `src/engine/town.ts`
- **Observation:** The audit correctly identifies completed-building rotation drift, but its recommendation understates the surface. Queued build scaffolds ignore `proj.rot` entirely: `TownCanvas.tsx:471-478` uses `ringOffset(def.w, def.h)`, `sortKey(proj.r, proj.c, def.w, def.h)`, and `scaffold(def.w, def.h)` with no rotation handling. Completed-building progress rings and sparkle origins also use unrotated `ringOffset(def.w, def.h)` (`TownCanvas.tsx:375`, `:416`). The placement ghost uses unrotated dimensions in all build/move paths (`TownView.tsx:89-107`).
- **Impact:** A "logic-only" rotation fix can still leave rotated projects visually wrong during construction, with progress rings and painter order attached to the wrong footprint. The bug is not only collision vs completed art.
- **Recommendation:** Introduce one shared `footprintDims(def, rot)` helper and use it for engine occupancy/validation, ghost dimensions, completed/build-project sort keys, ring offsets, and queued scaffold footprint. Keep the art mirror if desired, but all footprint-derived overlays must use the same rotated dimensions.

### [AUDIT-AR-03] TOWN-04 misses the difficulty-edit version of the same labor-clawback bug
- **Area:** `src/store/slices/habitsSlice.ts`, `src/engine/habits.ts`
- **Observation:** The audit focuses on daily-cap over-clawback, but the amount is also wrong whenever a habit's difficulty changes between completion and uncompletion. `updateHabit` allows difficulty edits (`habitsSlice.ts:84`), completion grants `laborFor(habit.difficulty)` at that moment (`habitsSlice.ts:306`), and uncompletion claws back `laborFor(habit.difficulty)` from the current habit object (`habitsSlice.ts:431`). Complete as `easy`, edit to `epic`, then uncomplete: 1 labor was granted and 6 are removed. Complete as `epic`, edit to `easy`, then uncomplete: 6 were granted and only 1 is removed.
- **Impact:** This is both player-hostile and farmable, depending on edit direction. It also weakens the executive claim that labor "cannot be farmed around habits"; the marker stores only the date, not the earned amount.
- **Recommendation:** Store the exact labor amount granted for the completion, either on the log entry or in a `lastLaborGrant` object parallel to `lastMilestoneGrant`, and claw back that stored amount only.

### [AUDIT-AR-04] Decor removal exists in engine/store but is unreachable in the UI
- **Area:** `src/engine/town.ts`, `src/store/slices/townSlice.ts`, `src/views/TownView.tsx`, `src/components/town/TownCanvas.tsx`
- **Observation:** The engine supports `removeDecor()` (`town.ts:472-479`) and the store exposes `townRemoveDecor()` (`townSlice.ts:131-136`), but `rg` finds no view/component caller. `TownCanvas` exposes only `onCellTap` and `onBuildingTap` (`TownCanvas.tsx:49-52`), and `TownView` wires building taps only (`TownView.tsx:218-219`).
- **Impact:** Decor is effectively permanent for players. A mistaken fountain can occupy four cells forever, the 60-prop cap can be filled with no recovery path, and the documented 50% material refund path is dead UI.
- **Recommendation:** Add decor hit-testing and a small decor management card with remove confirmation. Cover it with a component test and a slice test, because `townRemoveDecor` currently has no user-facing protection against regression.

### [AUDIT-AR-05] Several economy numbers are wrong or mix raw and rational-player pacing
- **Area:** economy snapshot and TOWN-03/TOWN-06/TOWN-17
- **Observation:** Decor max spend is understated. With `TOWN_DECOR_CAP = 60`, per-type cap 10, and catalog prices in `townDecor.ts:31-40`, the highest 60-slot decor spend is **2,300g** (10 each of fountain, statue, well, cart, banner, lamppost), not `<= ~1,900g`. The same mix is also the max-prestige mix: 110 prestige for **2,300g + 130 stone + 40 wood**, not "~1,900g + ~100 stone." The full-town spend ceiling is therefore about **39,250g**, not capped below 39k. Separately, "Keep I-II plus seven medium tier-IIs reaches 330 prestige" is arithmetically off: it is 65 + 7 * 40 = **345**. Finally, the "117-194 days" labor duration uses raw 1,165 labor even though the audit also says Mason-first is dominant; Mason I-first reduces the remaining queue costs to about **1,059 labor**, or roughly 106-177 days at 10-6 labor/day.
- **Impact:** The conclusions mostly survive, but the numbers are not audit-grade. TOWN-17's decor-bypass cost is materially higher than stated, while TOWN-06's full-town duration is materially lower for the dominant build order.
- **Recommendation:** Recompute the economy table from the catalog in a checked script and state whether values are raw catalog totals, max-player-spend totals, or rational-route estimates.

### [AUDIT-AR-06] Unlock failure reasons conflate deed gates with prestige gates
- **Area:** `src/engine/town.ts`, `src/components/town/__tests__/TownView.test.tsx`
- **Observation:** `PlaceReason` has no deed-specific reason, and any `unlockMet()` failure returns `'prestige'` (`town.ts:255`). The test named "rejects a deed-gated building below the deed requirement" already expects `{ reason: 'prestige' }`. The UI panel has its own `gateNote()` and can say "Needs deed N", but the placement ghost/error path cannot. There is adjacent drift in `TownView.test.tsx:53`, whose comment still says the first deed gate is 40 after the code retuned it to 100.
- **Impact:** If a deed-gated building ever reaches placement mode through stale UI state, dev tools, or future unlock changes, the player sees "Prestige too low" for a land-deed failure. The duplicated validation paths make this easy to preserve accidentally.
- **Recommendation:** Split unlock failures into `'deed'` and `'prestige'`, or return a structured reason from shared engine validation. Update the stale test comment while touching this area.

### [AUDIT-AR-07] The anti-farming claim is too broad
- **Area:** executive assessment / current loop assumptions
- **Observation:** The daily cap prevents unlimited labor, but the system is not immune to farming "around habits." Difficulty is editable before completion, new throwaway habits can be created and completed up to the 24/day cap, and the clawback marker blocks exact correction after same-day uncomplete/recomplete. These are not all Homestead-specific defects, but they contradict the audit's strong statement that Homestead progression "cannot be farmed around habits."
- **Impact:** The design claim should be softened. The actual guarantee is narrower: labor is live-only, per habit per day, and day-capped.
- **Recommendation:** Reword the claim and, if the stronger guarantee is desired, consider freezing reward difficulty per scheduled habit/day or adding friction around same-day habit creation/editing before reward grant.
