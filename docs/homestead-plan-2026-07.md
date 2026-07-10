# The Homestead — Fix & Improvement Plan (July 2026)

> **Status: COMPLETE (2026-07-10).** All 23 items across Phases 1–5 implemented, tested (town test set 85 → 123 tests; full suite 2,127 green; typecheck clean), and re-verified live in the browser (rotation probes, v37 orphan heal on a seeded pre-fix save, decor place→remove round-trip, charter purchase, tier-scaled perk labels, adjacency prestige). Phase 5 numbers were design-approved as proposed.

Executes the findings of `docs/homestead-audit-2026-07.md` (rev 2, adversarial-review items folded in). Items are ordered by severity and dependency; each names its finding IDs, files, concrete steps, and tests. Phases 1–4 are mechanical fixes safe to implement as specified. **Phase 5 items change game balance and need a design sign-off on the numbers before implementation** *(granted 2026-07-10 — implemented as proposed)*.

Conventions: run `npm run typecheck` and the town test set after every item; the full-suite gate closes each phase. Status markers: `[ ]` todo · `[x]` done · `[~]` in progress.

Town test set:
```bash
npx vitest run src/engine/__tests__/town.test.ts src/store/__tests__/townLabor.test.ts src/store/__tests__/townSlice.test.ts src/components/town/__tests__ src/store/__tests__/persistMigration.test.ts src/engine/__tests__/layering.test.ts
```

---

## Phase 1 — P1 correctness (do first, in this order)

### [x] 1.1 Rotation: one `footprintDims` helper everywhere (TOWN-01, incl. AR-02 surface)
The mirrored art already occupies the transposed footprint; fix the *logic* side to match it everywhere dimensions are derived.
1. **Engine** (`src/engine/town.ts`): export `footprintDims(def: {w,h}, rot?: 0|1): {w,h}` returning swapped dims when `rot === 1`. Use it in:
   - `occupancy()` — both completed buildings (`b.rot`) and queued build projects (`p.rot`) (~lines 150–161)
   - `canPlace()` — stop ignoring `_rot`; rename the param and thread it into bounds/unlocked/overlap checks (~243–256)
   - `queueBuild()` already stores `rot` — no change; `moveBuilding()` — use the *new* `rot` argument's dims (~444–455)
2. **Canvas** (`src/components/town/TownCanvas.tsx`): use `footprintDims` in
   - `buildingAt()` hit-testing (~274)
   - completed-building `sortKey` (~419) and upgrade-ring `ringOffset` (~416)
   - sparkle origin `ringOffset` (~375)
   - queued-project scaffold block: `ringOffset`, `sortKey`, `scaffold` (~471–478) — pass `proj.rot`
3. **View** (`src/views/TownView.tsx`): ghost dims for build *and* move modes (~89–107) — decor never rotates.
4. **Tests** (`src/engine/__tests__/town.test.ts` + `src/components/town/__tests__/`):
   - engine: a rotated 2×3 `queueBuild` at the grid edge respects transposed bounds; `occupancy` of a rotated building covers the transposed cells and only those; `moveBuilding` with a rot change validates the new dims.
   - component: rotated ghost renders the transposed highlight; `buildingAt` resolves taps on the transposed footprint (this is the regression test for the live repro: watchtower-inside-the-fence).
5. **Save-compat note:** existing saves may contain physically-overlapping rotated placements made under the old logic. `occupancy()` is derived, so nothing crashes; do not attempt auto-repair — at worst the player re-moves a building (free).

### [x] 1.2 Demolish-with-queued-upgrade: guard + heal (TOWN-02)
1. **Engine** (`src/engine/town.ts::demolish`): return `{ town, refundMaterials: {} }` unchanged when `town.queue.some(p => p.buildingId === buildingId)` — mirror the `moveBuilding` guard at :447.
2. **UI** (`src/components/town/TownBuildingCard.tsx`): disable the Demolish button while `activeProject` exists (same pattern as Move, :140) and extend the existing "Cancel the upgrade before moving this building" hint (:158-162) to cover demolish.
3. **Heal existing saves** (`src/store/useGameStore.ts`): bump persist to **v37** with a migration that removes any `kind: 'upgrade'` project whose `buildingId` no longer resolves to a building, refunding its escrowed materials — the escrow is `def.tiers[target?.tier]`, but with the target gone use `def.tiers` lookup by... the tier is unrecoverable, so refund `tiers[0].materials` (documented as best-effort) into `state.materials`. Add a case to `src/store/__tests__/persistMigration.test.ts`.
4. **Slice test** (`src/store/__tests__/townSlice.test.ts`): `townDemolish` on a building with a queued upgrade is a no-op (wallet and queue unchanged) — this also closes part of the TOWN-10 slice-wiring gap.

### [x] 1.3 Exact-amount labor clawback (TOWN-04, incl. AR-03 difficulty-edit variant)
1. **Type** (`src/engine/habits.ts`): add optional `lastLaborGrant?: { dateISO: string; amount: number }` beside `lastLaborGrantISO` (:65). Keep the old field for backward reads; new writes set both (the ISO field remains the cheap "granted today?" marker other code reads).
2. **Grant path** (`src/store/slices/habitsSlice.ts`): today the marker is stamped *before* `applyLabor` runs (:217) and `credited` is computed after (:309). Restructure so the habit's `lastLaborGrant = { dateISO: day, amount: credited }` is written after the town update inside the same `set()` — the `updated` habit object is already in `next.habits`, so patch it there.
3. **Credited must be the true banked+applied delta** (folds in the TOWN-05 computation): compute `credited = (bankAfter - bankBefore) + (queueAppliedAfter - queueAppliedBefore)` instead of the `laborToday` delta — this makes the stored amount correct under both the day cap and the bank cap, and fixes the day-rollover negative (TOWN-11) as a side effect. Keep `receipt.townCapReached` keyed off "attempted but credited 0 due to day cap"; add `receipt.bankFull` for "credited 0 (or partial) due to bank cap".
4. **Clawback path** (:430-432): claw back `habit.lastLaborGrant?.amount` when `lastLaborGrant.dateISO === day`; fall back to the legacy `laborFor(habit.difficulty)` only when the new field is absent (pre-migration completions). Do not clear the marker (HABIT-04 idiom unchanged).
5. **Tests** (`src/store/__tests__/townLabor.test.ts`): (a) complete at 23/24 cap → uncomplete removes exactly 1; (b) complete easy → edit difficulty to epic → uncomplete removes exactly 1; (c) complete epic → edit to easy → uncomplete removes exactly 6; (d) legacy-save fallback still claws the nominal rate.

### [x] 1.4 Phase gate
Full town test set + `npm run typecheck` + full `npm run test`. Manual replay of the two live repros from the audit (rotated Training Yard + watchtower probe; demolish-during-upgrade) confirming both are now impossible.

---

## Phase 2 — Receipt truthfulness & feedback (P2/P3 cluster)

### [x] 2.1 Bank-full visibility (TOWN-05; credited math already fixed in 1.3)
- `src/store/slices/habitsSlice.ts` receipt copy (~:340-344): when `receipt.bankFull`, append the plan-promised line **"bank full — start a project"** (parallel to the existing "town cap reached").
- Test: full bank (200) + empty queue + completion → toast contains the hint and no `+N 🔨`.

### [x] 2.2 Day-rollover receipt & chip (TOWN-11, TOWN-12)
- TOWN-11 is fixed by 1.3's delta computation; add the regression test anyway: laborISO = yesterday, laborToday = 24 → first completion today shows `+N 🔨` with the correct N.
- `src/views/TownView.tsx:206-209`: render `town.laborISO === toISODate() ? town.laborToday : 0` in the "Labor today" chip. Component test with a stale-ISO fixture.

### [x] 2.3 Celebrate queue-time instant completions (TOWN-13)
- `src/store/slices/townSlice.ts:67,88`: `settleProjects` results are discarded. Capture `completed` and expose it — simplest repo-idiomatic route: move the toast to the callers (`TownView.confirmPlacement`, `TownBuildingCard.handleUpgrade`) by comparing `town.buildings` length/tier before→after, matching the `buyDeed` verify idiom; or add a `lastCompleted` transient the view toasts from. Prefer the compare-in-caller approach — no new state.
- Test: queue a build with `laborBank >= laborNeed` → "🏗️ … complete!" toast fires.

### [x] 2.4 Verify-idiom success toasts (TOWN-14)
- `src/views/TownView.tsx:150-165` and `src/components/town/TownBuildingCard.tsx:65-81`: compare relevant state before/after the action (the `buyDeed` pattern at `TownView.tsx:167-172`) before toasting "queued/placed/moved/demolished/cancelled".
- Test: a no-op action (e.g. unaffordable queueBuild forced through) produces no success toast.

### [x] 2.5 Phase gate
Town test set + typecheck; manual: complete a habit at each edge (cap, bank-full, new day) and read the toasts.

---

## Phase 3 — Reachability, validation unification, copy (P2/P3)

### [x] 3.1 Decor removal UI (TOWN-19)
- `src/components/town/TownCanvas.tsx`: add decor hit-testing (`decorAt(r,c)` over decor footprints) and an `onDecorTap` prop — keep the payload discipline (props only, no store reads).
- `src/views/TownView.tsx`: on decor tap (when not placing), open a small decor card — name, art, "Remove (50% materials back)" behind a confirm; call `townRemoveDecor(r, c)` with the verify-idiom toast from 2.4.
- Tests: component (tap decor → card → remove empties `town.decor`) + slice (`townRemoveDecor` refunds floored 50% materials; no-op on empty cell) — closes the remaining TOWN-10 slice gap.

### [x] 3.2 Shared placement validation (TOWN-09)
- `src/engine/town.ts`: export reason-returning `canPlaceDecor(town, def, r, c)` (caps + bounds + locked + occupied) and `canMoveBuilding(town, buildingId, r, c, rot)`; both built on `footprintDims` from 1.1.
- `src/views/TownView.tsx:29-45`: delete `footprintOk`; the ghost, slice actions, and panel all consume the engine functions.
- Tests: engine reason coverage for both new functions (incl. the global `TOWN_DECOR_CAP=60` case — currently untested per TOWN-10).

### [x] 3.3 Deed vs prestige placement reason (TOWN-20)
- `src/engine/town.ts`: `PlaceReason` gains `'deed'`; `unlockMet` (or `canPlace`) distinguishes which gate failed. `src/views/TownView.tsx:47-54`: add `deed: 'Needs another land deed'` to `PLACE_REASON`.
- Update the existing `canPlace` deed-gate test to expect `'deed'`; fix the stale "40 gate" comment at `TownView.test.tsx:53`.

### [x] 3.4 Copy & doc corrections (TOWN-15, TOWN-16)
- `src/views/ExploreView.tsx:113`: replace "and, in a later update, grant light perks" with present-tense copy naming a perk or two.
- `src/components/town/TownBuildingCard.tsx:14`: delete the stale "Perk wiring lands in M5" comment line.
- `docs/habits-rpg-improvement-plan3.md:248`: v33 → v34 (and note v37 from 1.2 when it lands).
- Keep-first decision (TOWN-16.1): **recommend accepting reality** — delete "mandatory first project" from `townBuildings.ts:68` and `homestead-development-plan.md:122` rather than enforcing it (enforcement adds a `PlaceReason` and tutorial friction for no stated design benefit; the Keep is already the obvious cheap first pick). If design disagrees, the alternative is a `'keep_first'` reason in `canPlace`.
- `src/engine/town.ts:60-61`: reword "guarded in town.test.ts" → name `layering.test.ts`; **and** widen the layering guard's scan from `src/net/coop/**` to `src/net/**` (one glob change in `layering.test.ts:146-173`).

### [x] 3.5 Hygiene (TOWN-18)
- `src/views/DungeonView.tsx:507`: replace the inline `townPerks(useGameStore.getState().town)` with `useGameStore(selectTownPerks).merchantDiscount01` (or a narrow `selectMerchantDiscount`).
- `src/components/town/townArt.tsx`: un-export the in-module-only primitives (`isoBox`, `prism`, `roofGable`, `dome`, `spire`, `silo`, `fence`).

### [x] 3.6 Phase gate
Town test set + typecheck + full `npm run test` (the DungeonView and layering changes reach beyond town files).

---

## Phase 4 — Test-debt closure (TOWN-10 remainder)

### [x] 4.1 Canvas gesture math
`src/components/town/__tests__/TownCanvas.test.tsx`: `cellAt` round-trip through a non-identity view transform (pan + zoom, verify `cellFromPoint` inverse), `zoomAnchored` keeps the anchor fixed, tap-vs-drag threshold (`movedRef <= 8`).

### [x] 4.2 Seam-level zero-buildings baselines
`src/store/__tests__/townLabor.test.ts`: with `freshTown()`, `snapLaborNeed` equals the raw catalog labor (laborDiscount01 baseline) and a second `queueBuild` is refused (queueSlots baseline) — upgrading the two perks currently covered only by struct equality.

### [x] 4.3 Day-boundary completion test
One test driving `completeHabit` across a `laborISO` boundary (covers 1.3/2.2 permanently).

---

## Phase 5 — Design & economy changes (NEEDS DESIGN SIGN-OFF on numbers first)

*Each of these is a deliberate balance change. Implement only after the numbers are approved; all are data + small engine edits.*

### [x] 5.1 Tier-scaling perks (TOWN-03) — the highest-leverage change
- Proposed: sight +1/+1/+2 · stamina +5/+10/+15 · haggle 5/10/15% · granary +1/+2/+3 · mason 5/10/15% · forge +0.02/+0.03/+0.04 · practice unchanged (boolean).
- Implementation: add per-tier values to `TownBuildingDef` (e.g. `perkByTier: number[]`), switch `townPerks` from presence-checks to tier-indexed reads, update `PERK_LABEL`/card copy to show current→next values. Update the zero-buildings baseline tests and the perk-seam integration assertions.
- Ripple check: `maxEnergyFor` clamp, dungeon stamina display, mine/forest sight snapshot — all take the number as-is; re-run their suites.

### [x] 5.2 Repeatable end-state sink (TOWN-06)
- Proposed: deed 4+ at escalating cost (`TOWN_DEED_COSTS` becomes open-ended: next = last × 2, prestige gate +120 per step, each deed past 3 grants no land but a cosmetic banner tier / prestige) **or** festivals. Pick one; deeds-4+ is the smaller diff but touches `gridSizeFor`'s clamp — if land stops at 24×24, later deeds must be explicitly land-free.
### [x] 5.3 Mason curve (TOWN-07): 5/10/15% by tier (folds into 5.1's data shape).
### [x] 5.4 One positional rule (TOWN-08): recommend "decor adjacent to a completed building grants +1 prestige" — pure `prestigeOf` change, no new state, visit-payload untouched.
### [x] 5.5 Decor prestige policy (TOWN-17): decide whether deed gates count building prestige only. If 5.4 ships, revisit — adjacency decor becomes earned prestige and the bypass matters less.

---

## Suggested-but-unscheduled (from the audit's improvement lists)
Construction-event variable rewards · "raised by" plaques (`TownProject` counter — note: changes the frozen visit payload shape, so gate behind a `v` bump) · weekly labor summary · Trading Post III shop discount · deep-band stone node · pre-run perk chips in other modes.

## Verification (end of Phases 1–4)
1. Full suite green + typecheck.
2. Browser playtest replaying every audit repro: rotated placement (ghost, scaffold ring, tap, adjacent placement both directions), demolish-during-upgrade (button disabled), decor place→remove round-trip, habit complete/uncomplete at cap and bank-full edges, day-rollover chip and receipt.
3. Load a pre-fix save (with an orphaned project if available) → v37 migration heals it and refunds materials.
4. `git grep "in a later update" src/` returns nothing.
