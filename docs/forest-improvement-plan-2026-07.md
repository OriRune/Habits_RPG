# Wild Forest — Next-Level Improvement Plan (2026-07)

Based on `docs/forest-minigame-analysis.md`. Companion to
`docs/mining-improvement-plan-2026-07.md` — several phases here are the forest half of a
shared fix; those are marked **[SHARED]** and should land together with (or immediately
after) the matching mine item so the two engines don't drift again.

Same phasing logic as the mine plan: trust/balance fixes first, extensibility refactor
before content variety, graphics/hygiene last.

---

## Phase 0 — Trust & balance fixes

### 0.1 — Show kept-vs-forfeited on the banking overlay
**Closes:** 1.1. **Files:** `src/components/forest/ForestRunOverlay.tsx` (banking panel,
~986-991). Mirror the death panel's two-row kept/lost layout (already built at
~1008-1024) using the existing `splitHaul`/`HaulChips` pair. Add "return to a clearing for
full value" to the Bank & leave tooltip.

### 0.2 — Cap the kill-loot streak term
**Closes:** 1.2. **Files:** `src/engine/forest.ts` (`killBeast`, loot quantity formula
~513-515). Cap `killsThisStage` in the drop-quantity formula (e.g.
`Math.min(killsThisStage, 3)`) rather than letting it accumulate unbounded across a stage.
**[SHARED]** — do this alongside mine plan item 0.3 (same bug shape, forest's is quadratic
so slightly higher priority); use a consistent capping approach across both so the two
loot-quantity formulas don't drift into different shapes again.

### 0.3 — Scale beast HP and contact-hit count with late depth
**Closes:** 1.3. **Files:** `src/engine/forest.ts` (`generateForest` beast spawn — apply a
depth-scaled HP multiplier; `stepBeasts`'s single-toucher-per-i-frame logic ~1342-1349 —
allow more than one adjacent beast to land a hit at high density). **[SHARED]** — do
alongside mine plan item 1.1; same fix shape, same `lateDepthDamageScale` anchor already
shared via `crawl.ts`.

### 0.4 — Fix windup-cancel kiting and dash i-frame stacking
**Closes:** 1.5. **Files:** `src/engine/forest.ts` (windup logic ~1330-1337 — persist
partial windup progress across a brief escape window rather than fully cancelling on any
step away; or give fast beasts like `shadow_lynx`/`amber_stalker` a gap-closing lunge on
windup expiry), `src/engine/crawl.ts` (dash i-frame duration, currently tied 1:1 to
`MINE_IFRAME_MS`/`FOREST_IFRAME_MS` via `tryDash` setting `lastHitAtMs` — shorten to ~400ms
specifically for the dash-grant case so it can't fully cover even a boon-reduced cooldown).
Verify against the analysis doc's AG ≥ 22 + Quick Dash invincibility threshold that the fix
actually closes the window.

### 0.5 — Wire charge and melee boons into ranged combat
**Closes:** 1.7. **Files:** `src/engine/forest.ts` (`act()`'s ranged branch ~1008-1037 —
apply `CHARGE_DAMAGE_MULT` when `charged` is true, and `boonMeleeMult(state.activeBoons)`
to ranged power same as the melee branch does at ~1049-1050). Do this **before** any future
mine work that considers porting ranged combat from forest (mine plan finding 6.d) — no
sense inheriting a half-wired mechanic into a second engine.

### 0.6 — Give shrine dens (and cache/blessing) real stakes
**Closes:** 1.6. **Files:** `src/content/forest.ts` (`SHRINE_EVENTS` — scale `disturbed_den`
to spawn a small pack rather than one beast, band-gated in strength; scale `hunters_cache`
loot by band). `src/engine/forest.ts` (`activateShrine` — spawn logic for a pack instead of
a single guardian key).

### 0.7 — Unlock mobile/touch entry
**Closes:** 3.1. **Files:** `src/views/ForestView.tsx` (`disabled={!canEnter || coarse}`
~115, label ~118-122). **[SHARED]** — identical fix to mine plan item 0.8; do both in the
same pass since it's the same one-line pattern in both view files, and a player who can
enter one crawler on mobile should be able to enter both.

### 0.8 — Fix the `amber_stalker` cadence so it actually functions as designed
**Closes:** 2.3. **Files:** `src/content/forest.ts` (`amber_stalker` entry ~199-204 —
lower `moveCadenceMs` below the player's movement floor for at least burst windows, or add
a short gap-closing dash/lunge to the beast AI). Re-verify against the doc's numbers that
it can now catch a player who doesn't stand still.

---

## Phase 1 — Death-rule consistency (design decision, not a pure bug fix)

### 1.1 — Decide forest's death-recovery story relative to the mine
**Closes:** 1.4 (design note, not a defect). **Files:** none yet — this is a design call
before code. Forest currently has NO death recovery (flat 50% forfeit) while the mine has a
recoverable tombstone; forest's ordering (bank 1.0 > stash 0.8 > death 0.5) is sane, the
mine's is currently inverted (being fixed in mine plan item 0.2). Two options: (a) leave
forest as-is — it's the mode teaching the "correct" lesson, no change needed; (b) add a
forest tombstone for cross-mode consistency, but only with a recovered fraction well below
100% of the lost half so it doesn't reintroduce the mine's inversion. **Recommendation:
(a)** — don't add complexity to fix something that isn't broken; revisit only if
players report the two crawlers' death rules as confusingly inconsistent in practice.

---

## Phase 2 — Extensibility refactor (shared with mine — see mining plan Phase 2)

Do not duplicate mine plan Phase 2's work here. When mine plan items 2.1 (`placeFeatures`
helper) and 2.3 (`splitHaul` relocation) and 2.4 (boon-cache pickup hoist) land, forest's
`generateForest`, forest's own `splitHaul` definition, and `forestSlice.ts`'s boon-tile
branch are the *other half* of each of those changes — not optional follow-ups. Specifically:

### 2.1 — Adopt the shared placement helper in `generateForest`
**Closes:** 2.2. **Depends on:** mine plan item 2.1. **Files:** `src/engine/forest.ts`
(`generateForest`'s clearing-room/wanderer/guardian placement sections, ~640-845) rewritten
to call the same `placeFeatures`/`pickCandidates` helper added to `crawl.ts` for the mine.

### 2.2 — Move `splitHaul`'s definition and update forest's call sites
**Closes:** shared code-health item. **Depends on:** mine plan item 2.3. **Files:**
`src/engine/forest.ts` (remove the definition at ~1403), and update its own 5 call sites:
`commit.ts:632,655,684`, `ForestRunOverlay.tsx:360`, `forest.test.ts:13,447-462`, to import
from `crawl.ts` instead.

### 2.3 — Route forest's boon-cache pickup through the shared reducer
**Closes:** shared code-health item. **Depends on:** mine plan item 2.4. **Files:**
`src/store/slices/forestSlice.ts` (`forestMove`'s boon-tile branch, ~143-161) replaced with
a call to the `crawlPickupBoonCache` reducer added to `crawl.ts` for the mine, keeping only
forest's own trigger condition (walk-onto, vs. mine's deliberate-strike trigger).

---

## Phase 3 — Content variety

### 3.1 — Give biome bands mechanical identity, not just palette
**Closes:** 2.1. **Files:** `src/content/forest.ts` (add a `band` restriction to
`alpha_boar` so it stops spawning past Thicket), `src/engine/forest.ts`
(`sightRadiusFor`/generation — Deepwood: -1 base sight; Ancient: an ambient hazard).
**[SHARED design pattern]** — mirrors mine plan item 3.1/3.3; keep the "one rule per band"
scope consistent between the two reports so band identity reads the same way across both
crawlers (a player who's learned "Frozen Depths has ice hazards" should find "Deepwood has
reduced sight" an equally legible kind of signature, not a different design language).

### 3.2 — New ideas, scoped like the mine's
The mine plan's §5 new-ideas list (floor modifiers, elite affixes, timed rich-node events,
per-day first-descent bonus) applies equally well to forest's stage structure once Phase 2
lands — not re-specified here in full; treat as a shared backlog once the extensibility
refactor makes both generators cheap to extend.

---

## Phase 4 — Graphics/presentation polish

### 4.1 — Prioritize art for guardians and band-signature nodes
**Closes:** §4. **Files:** `src/lib/minigameArt.ts` (add `glowcap`, `heart_bloom` node
sprites — these are the two tiles meant to signal "you're in a new biome," currently
undercutting Phase 3.1's band-identity work by falling back to plain glyphs), plus art for
`grove_sentinel` and `ancient_guardian` (both currently plain emoji, same gap as the mine's
guardians).

---

## Phase 5 — Code hygiene / tests

### 5.1 — Collapse the in-file shrine-branch duplication
**Closes:** analysis §5 (forest-only finding, not shared with mine). **Files:**
`src/hooks/useForestLoop.ts` — extract a local `fireAct(charged: boolean)` closure that
both the charge-trigger branch (~174-185) and the `actQueued` branch (~218-229) call,
collapsing the advance/attack/shrine/gather priority chain to one copy within this file.
Do this regardless of whether/when the cross-engine `useCrawlLoop` hook (mine plan 5.1)
lands — it's a same-file fix either way.

### 5.2 — Port `HaulChips`/`rewardChips` into a shared location
**Closes:** analysis §5. **Files:** `ForestRunOverlay.tsx:175-198` is the source of truth —
move `rewardChips`/`HaulChips` into `src/components/minigame/` unchanged, update forest's
own imports, and this becomes the same component mine plan item 5.3 ports into
`MineRunOverlay.tsx`. Do this once, shared, rather than copy-pasting into mine.

### 5.3 — Canonicalize the per-cell hash at its existing home
**Closes:** analysis §5 (correction to mine plan item 5.3's original wording — do not
create a new `src/lib/proceduralArt.ts`; `src/lib/minigameArt.ts:24` already has a
`cellHash`). **Files:** `ForestRunOverlay.tsx`'s `tileJitter` (~100-104) and
`MineRunOverlay.tsx`'s `cellHash` (~37-41) both replaced with imports from
`minigameArt.ts`'s existing export (rename/merge as needed if the existing one isn't
byte-identical).

### 5.4 — Extract the tripled regen block
**Closes:** analysis §5. **Depends on/shared with:** mine plan item 5.3. **Files:**
`src/engine/crawl.ts` (new `applyPassiveRegen<T extends CrawlRunState>(s, nowMs): T`),
called from `stepBeasts` (`forest.ts:1205-1210`) in addition to `stepMonsters`
(`mining.ts:1120-1124`) and the already-shared `crawlCoopClientStep`.

### 5.5 — Type `ForestBeastDef` against `MonsterCombatStats`
**Closes:** analysis §5. **Files:** `src/content/forest.ts` (`ForestBeastDef` — either
`extends MonsterCombatStats` with `weakTo`/`resistTo` typed as `StatId[]` instead of bare
`string[]`, or drop the misleading "extended by" doc comment in `crawl.ts:301-315`).
**[SHARED]** — bundle with the identical `MineMonsterDef` fix (mine plan item 5.3).

### 5.6 — Narrow the full-grid tile clone in `act()`
**Closes:** analysis §5. **Files:** `src/engine/forest.ts:1090,1108` (chop/gather branches
of `act()`). **[SHARED]** — same fix as mine plan item 5.3's `strike()`/`placeTombstone()`
narrowing; do both with the same helper if one gets extracted (e.g. a `setTile` helper in
`crawl.ts`).

---

## Cross-check corrections applied to the mining plan

While auditing forest, these forest findings required going back and correcting
`docs/mining-minigame-analysis.md` / `docs/mining-improvement-plan-2026-07.md` (see that
plan's own "cross-check corrections" section for the authoritative record):

- Mobile lockout (mine plan 0.8): **confirmed**, not just "likely" — forest has the
  identical gate.
- Late-depth threat plateau (mine plan 1.1): **confirmed** present in forest too.
- Kill-loot snowball (mine plan 0.3): **confirmed** present in forest, and worse-shaped
  (quadratic vs. mine's roughly-linear term) — raises this fix's priority in both plans.
- Death-vs-bank inversion (mine plan 0.2): **forest does NOT have this problem** — it was
  a "verify" item in the mine plan that turned out to be twin-*asymmetric*, not
  twin-*shared*. Forest's lack of a tombstone is what keeps its incentive ladder sane;
  the mine's tombstone is what broke it. Do not "fix" forest to match the mine here.
- `splitHaul` relocation (mine plan 2.3): call-site list corrected/completed using forest's
  own audit (see forest plan item 2.2 above for the precise list).
- `cellHash` dedup (mine plan 5.3): corrected — a third copy already exists at
  `minigameArt.ts:24`; canonicalize there rather than inventing a new shared file, and
  forest's copy is named (`tileJitter`), not unnamed as originally reported.
- `useMiningLoop`/`useForestLoop` hook merge (mine plan 5.1): noted API drift —
  forest's `chargeProgressRef` is a bare number, mine's is an object — the shared hook
  design needs to reconcile this, not assume either shape is already common.
