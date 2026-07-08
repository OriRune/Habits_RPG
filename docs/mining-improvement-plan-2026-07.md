# Deep Mine — Next-Level Improvement Plan (2026-07)

Based on `docs/mining-minigame-analysis.md` (rewritten 2026-07 — the old
`docs/archived/mining-improvement-plan.md` is fully closed out, do not resume from it).

Ordered for one-at-a-time implementation. Phase 0 items are independent and can ship in
any order within the phase. Phase 2 (extensibility refactor) is a deliberate prerequisite
for Phase 3 (content variety) — building hazard tiles/vaults/elites against the current
10-step generator would mean writing each one as a bespoke procedure instead of a data
entry. Phase 5 (tests/dedup) can be interleaved earlier by whoever implements each item,
but is listed last since none of it is user-visible.

Each step below names its target files and the specific finding it closes (see the
analysis doc's findings table). **Forest crossover** callouts flag where the change is
shared code by construction, or where the same bug/pattern likely exists in
`src/engine/forest.ts` and should be verified/mirrored — but per the task, forest itself is
not to be modified as part of this plan; those callouts are for a future pass.

---

## Phase 0 — Trust & balance fixes (no architecture changes) — ✅ COMPLETE (2026-07-08)

These are the highest-priority items: they're either visible bugs (player shown the wrong
number) or incentive inversions (the "wrong" play is objectively optimal). All are
isolated, single-file-ish changes.

### ✅ 0.1 — DONE — Show kept-vs-forfeited on the banking overlay
**Closes:** 1.1. **Files:** `src/components/mining/MineRunOverlay.tsx` (banking overlay
block, ~897-921). Mirror the death overlay's kept/lost split (already built at
932-974) using `splitHaul(mine.haul, isMineSafeBankTile(...) ? 1 : MINE_STASH_KEEP)`.
Change the Bank button label to "Bank 80%" when off the entrance tile.

### ✅ 0.2 — DONE — Fix the death-beats-hurry-bank inversion
**Closes:** 1.2. **Files:** `src/engine/mining.ts` (tombstone haul fraction, near
`placeTombstone`), `src/store/commit.ts` (`commitMineDeath`). Reduce the
tombstone-recoverable share of the lost half (e.g. keep 65% of the lost 50%, not 100%), OR
apply a death-path XP penalty using the existing `MINIGAME_XP_LOSS_FACTOR` pattern
(`engine/balance.ts:60`). Verify with the numbers in analysis §1.2 that bank ≥ death in
expectation after the change. **Forest crossover — this is mine-only, confirmed NOT shared:**
forest has no tombstone at all (flat 50% forfeit on death, `commit.ts:683-695`), which
means forest's ladder (bank 1.0 > stash 0.8 > death 0.5) is already sane with no inversion —
the mine's tombstone is what *broke* this ordering, not something forest is missing. Do not
add a forest tombstone to "match" the mine; see
`docs/forest-improvement-plan-2026-07.md` Phase 1 for the explicit design call to leave
forest's death rule as-is.

### ✅ 0.3 — DONE — Dampen kill-loot snowballing
**Closes:** 1.4. **Files:** `src/engine/mining.ts` (`killMonster`, loot quantity formula
~900-912). Cap or square-root the `killsThisFloor` bonus term (e.g.
`Math.sqrt(killsThisFloor)` or a hard cap around +5) so late kills on a full-clear floor
don't snowball past what ore mining pays. **Forest crossover — CONFIRMED, and worse there:**
forest's equivalent `killsThisStage` term (`forest.ts:513-515`) is *cumulative* rather than
per-kill, producing a quadratic drop curve (~324 leather on a stage-10 full clear vs. ~80
gathered materials) — see `docs/forest-improvement-plan-2026-07.md` item 0.2. Use a
consistent capping approach in both so the two loot formulas don't re-diverge.

### ✅ 0.4 — DONE — Un-hard-counter the mine's own trained stat in the magma band
**Closes:** 1.5. **Files:** `src/content/mining.ts` (cinder_wisp / magma_hound entries,
~171-183). Drop `resistTo: ['ST']` from cinder_wisp (keep magma_hound and the colossus
resisting ST so the band still has real texture, just not a 100% band-wide wall).

### ✅ 0.5 — DONE — Reduce the guardian-restart treasure farm
**Closes:** 1.6. **Files:** `src/engine/mining.ts` (`killMonster`'s guardian branch,
`guardianTreasure`). Track whether this is a first-ever kill of that guardian
(`deepestMineFloor` already crossed this boundary → treat as a re-kill) and pay reduced/gold-
only treasure on re-kills, keeping the boon choice and full reward on the genuine first kill.

### ✅ 0.6 — DONE — Scale node durability with depth
**Closes:** 1.7. **Files:** `src/engine/mining.ts` (rock durability formula ~540, ore
`durability` fields in `src/content/mining.ts`). Add a depth term, e.g.
`durability = baseDurability + Math.floor(floor / 6)`, so a maxed pick still meaningfully
swings more than once on deep nodes. Add/extend a unit test in `mining.test.ts` asserting
durability increases with floor.

### ✅ 0.7 — DONE — Cave mushroom restores some HP
**Closes:** 1.8. **Files:** `src/content/mining.ts` (`cave_mushroom` entry — currently
`grants: { kind: 'stamina', amount: [30, 30] }`). Either add a second grant type or make
this ore restore a HP amount alongside stamina (check `MineOreDef['grants']` union in
`content/mining.ts:35-38` — may need a new `kind: 'stamina+hp'` variant or a small hardcoded
special-case in `strike()`'s stamina-restore branch, ~`mining.ts:1039-1043`).

### ✅ 0.8 — DONE — Unlock mobile/touch entry
**Closes:** 3.1 (highest-leverage single fix in this plan). **Files:**
`src/views/MiningView.tsx` (`disabled={!canEnter || coarse}` line ~107, button label
~110-114). Replace the hard `coarse` disable with a dismissible warning (reuse the pattern
from `AdventureRitualModal` if there's a "confirm anyway" affordance, or a simple inline
note) so touch players can still enter. **Forest crossover — CONFIRMED (2026-07 forest
audit):** `ForestView.tsx:115` has the byte-identical gate and label. Do both fixes in the
same pass (see `docs/forest-improvement-plan-2026-07.md` item 0.7) — a player who can enter
one crawler on mobile should be able to enter both.

### ✅ 0.9 — DONE — Don't hijack combat with auto-descend on the shaft
**Closes:** 3.2. **Files:** `src/hooks/useMiningLoop.ts` (both `canDescend(run) && ...`
checks, ~175-176 and ~199-200). Add `&& !facedMonsterId(run)` (or equivalent "no monster in
the faced cell") to the auto-descend condition so Space still attacks a monster you're
facing even while standing on the shaft; the explicit Descend button remains unconditional.

### ✅ 0.10 — DONE — Rename the stamina pickup / differentiate its icon
**Closes:** 3.4. **Files:** `src/content/mining.ts` (`energy_gem` → e.g. `vigor_crystal`,
update `key`/`name`; check for other references via grep on `energy_gem`),
`MineRunOverlay.tsx` (stamina gauge icon, ~381 — swap `Zap` for a distinct lucide icon,
e.g. `Flame` or `BatteryCharging`, keeping `Zap` reserved for the real energy currency).

### ✅ 0.11 — DONE — Delay the shaft compass until first sighted
**Closes:** 3.3. **Files:** `src/components/mining/MineRunOverlay.tsx` (`shaftDir`
computation ~304, and the existing "shaft spotted" hint tracking ~228-246 — reuse
`shaftWasOffscreenRef`/a similar "have I seen it yet" flag rather than computing `compassTo`
unconditionally from `mine.shaftPos`).

---

## Phase 1 — Late-floor scaling (slightly broader, still isolated) — ✅ COMPLETE (2026-07-08)

### ✅ 1.1 — DONE — Scale monster HP and contact-hit count with late depth
**Closes:** 1.3. **Files:** `src/engine/mining.ts` (monster spawn in `generateMine`
~640-651: apply a depth-scaled HP multiplier similar to `lateDepthDamageScale`;
`stepMonsters`'s single-toucher-per-i-frame logic ~1186-1201: allow more than one adjacent
monster to land a hit when monster density is high). Re-run the analysis doc's floor-22
farm-rate numbers after the change to confirm gold/energy is no longer unbounded.
**Forest crossover — CONFIRMED:** `stepBeasts` (`forest.ts:1342-1349`) has the identical
single-toucher-per-i-frame cap, and beast HP never scales with stage either — same fix
shape applies (see `docs/forest-improvement-plan-2026-07.md` item 0.3). Both use the same
`lateDepthDamageScale` anchor from `crawl.ts`, so implement once conceptually and apply to
both call sites.

---

## Phase 2 — Extensibility refactor (prerequisite for Phase 3) — ✅ COMPLETE (2026-07-08)

Do this before Phase 3. It's framed as a code-health item but it's the difference between
"one data entry" and "a bespoke 30-line procedure" for every hazard/vault/elite in Phase 3.

### ✅ 2.1 — DONE — Extract a shared candidate-picking/placement helper
**Closes:** 6.a. **Files:** `src/engine/crawl.ts` (new export, e.g.
`placeFeatures(candidates, count, rng, place)` plus a `pickCandidates(tiles, filterFn)`
helper), `src/engine/mining.ts` (`generateMine` steps 5/6/9/10 — rock clusters, ore
clusters, guardian placement, boon cache — rewritten to call the shared helper). **Forest
crossover:** `generateForest` in `forest.ts` has the identical shape for its own steps;
this is genuinely shared code, so the crawl.ts helper should be designed generically enough
for forest to adopt in its own follow-up (not modifying forest.ts in this plan, just
designing the helper so it isn't mine-specific).

### ✅ 2.2 — DONE — Add a lightweight tile-kind registry
**Closes:** 6.a (continued). **Files:** `src/engine/mining.ts` (`MineTileKind` union,
`isWalkable`), `src/components/mining/MineRunOverlay.tsx` (tile-style ternary chain
~491-518, icon ternary ~540-554). Introduce something like `MINE_TILE_KINDS: Record<MineTileKind, { walkable: boolean; renderHint: ... }>` so `isWalkable` and the overlay read from
data instead of a hardcoded kind-name chain. This is what makes Phase 3's new tile kinds
(ice-slide, lava-DoT, mother-lode vault) additive instead of invasive.

### ✅ 2.3 — DONE — Move `splitHaul` into `crawl.ts`
**Closes:** 6.c. **Files:** `src/engine/forest.ts` (remove definition, ~1403),
`src/engine/crawl.ts` (add it — it only touches the shared `Reward` shape), update imports
in `MineRunOverlay.tsx:6`, `store/commit.ts:44-49`, `mining.test.ts:26`. **Complete
call-site list (corrected from forest-side audit)** — forest's own 5 sites also need
updating in the same change: `commit.ts:632,655,684` (`commitForest`/`stashForest`/
`commitForestDeath`), `ForestRunOverlay.tsx:360` (death-screen split),
`forest.test.ts:13,447-462`. Small, mechanical, but unblocks mine's engine surface being
self-contained — and touches forest by construction, so do it as one change, not two.

### ✅ 2.4 — DONE — Hoist boon-cache pickup into `crawl.ts`
**Closes:** 6.b. **Files:** `src/engine/crawl.ts` (new `crawlPickupBoonCache(state, game,
rng, caps)` mirroring the existing `crawlApplyBoonChoice` caps pattern),
`src/store/slices/miningSlice.ts` (`mineStrike`'s boon-tile branch ~167-184, replaced with
a thin engine call). **Forest crossover:** `forestSlice.ts`'s identical branch
(~143-161) is the other half of this duplication — the whole point of hoisting is so both
slices call the same reducer; do the mine wrapper here, leave forest's slice call-site
change for a follow-up since forest itself isn't in scope.

---

## Phase 3 — Content variety (now cheap thanks to Phase 2) — ✅ COMPLETE (2026-07-08)

### ✅ 3.1 — DONE — Rebalance band-exclusive spawn weighting
**Closes:** 2.2. **Files:** `src/content/mining.ts` (ore/monster `weight` fields).
Triple the spawn weight of band-native ores/monsters within their own band, and/or gate
floor-1 ores (rubble, bronze_vein, stone_lode) out of the pool past floor ~12 so descending
into a new band feels materially different, not just visually.

### 3.2 — Add 2-3 floor layout archetypes ✅ DONE — (2026-07-08)
**Closes:** 2.3. **Files:** `src/engine/mining.ts` (`generateMine` steps 1-2 — the
drunk-walk carve parameters). Parameterize walker count / target-open-percentage /
cluster density per an archetype roll (e.g. "corridor warren" = fewer walkers, lower open%;
"great cavern" = more walkers, a maze-like rock core in the center). Reuses the existing
carver; no new algorithm.

### 3.3 — Band hazard tiles ✅ DONE — (2026-07-08)
**Closes:** §5 new-ideas (hazard tiles), builds on 2.2. **Files:**
`src/engine/mining.ts` (new `MineTileKind` entries: `ice_slide`, `lava_dot`; movement/DoT
handling in `tryMove`/`stepMonsters` or a new tick), `MineRunOverlay.tsx` (render cases —
should now be additive thanks to Phase 2.2's registry). Frozen band: stepping onto
`ice_slide` continues the player 1-2 extra cells in the same direction (interacts with dash
i-frames). Magma band: `lava_dot` tiles apply a ward-mitigated DoT per tick, partially
hidden by fog.

### 3.4 — "Mother lode" vault ✅ DONE — (2026-07-08)
**Closes:** §5 new-ideas, addresses 1.7's charge-mining relevance. **Files:**
`src/engine/mining.ts` (`generateMine` — one high-durability special tile per floor past a
threshold depth, visible through fog as a glow per `MineRunOverlay.tsx`). Breaking it (best
attempted with charged swings) yields a notably larger ore/gold cache than a normal vein.

### 3.5 — Timed "rich vein" event ✅ DONE — (2026-07-08)
**Closes:** §5 new-ideas. **Files:** `src/engine/mining.ts` (a floor-level timer field on
`MineState`, a special ore tile that despawns/reverts after ~60s if not mined),
`MineRunOverlay.tsx` (visual countdown/pulse). Creates a real bank-vs-greed decision inside
one delve.

### 3.6 — Elite monster affixes ✅ DONE — (2026-07-08)
**Closes:** §5 new-ideas, partially addresses 2.1. **Files:** `src/engine/mining.ts`
(monster spawn step — roll one "elite" per floor past 10: armored = +defense, swift =
faster `moveCadenceMs`, venomous = poison on contact), `content/mining.ts` (affix
definitions or a multiplier table), `MineRunOverlay.tsx` (visual tell — e.g. a colored
outline — so an elite reads as different before contact).

### 3.7 — Guardian telegraphed specials ✅ DONE — (2026-07-08)
**Closes:** 2.1 (guardians specifically). **Files:** `src/engine/mining.ts`
(`stepMonsters` — add a guardian-only windup/special-attack branch; reuse
`CrawlStatusEffect`/DoT plumbing for the effect itself), `MineRunOverlay.tsx` (telegraph
visual — e.g. a ground-target indicator before the golem's slam lands). Scope to one
special per guardian; this is the highest-effort item in Phase 3 and can slip to a later
pass if time is short.

### ✅ 3.8 — DONE — Per-day first-descent bonus
**Closes:** §5 new-ideas, helps 1.3's farmability. **Files:** `src/store/commit.ts`
(`commitMining` — check a persisted `lastMineBonusDate`/floors-reached-today field against
`engine/date.ts::now()`), `src/store` (new persisted field, bump `persist` version if
needed per the store's migration convention). The first N floors reached each calendar day
pay +50%; subsequent floors that day pay normally.

---

## Phase 4 — Graphics/presentation polish — ✅ COMPLETE (2026-07-08)

### 4.1 — Dedicated sprite art for remaining ores and guardians ✅ DONE — (2026-07-08, via procedural SVG, not PNGs)
**Closes:** §4. **Files:** `src/lib/minigameArt.ts` (`MINE_ORE_ART`/`MINE_MATERIAL_ART`
maps — add entries for rubble, stone_lode, gold_vein, frost_quartz, obsidian, magma_geode),
plus new art assets for at least the two guardians (highest visual ROI — they're the boss
encounters and currently render as plain emoji like every trash mob).

### 4.2 — Gear-reflecting avatar + attack animation ✅ DONE — (2026-07-08)
**Closes:** §4. **Files:** `src/components/minigame/CrawlerAvatar.tsx`. Vary the tool-head
color/shape by equipped tier (stone/iron/mithril — the `PALETTE.miner.toolHead` value is
already a single hardcoded color, easy to parameterize), and add a brief swing animation
keyframe triggered on strike (check `index.css`'s existing `crawler-*` keyframes for the
pattern to extend).

### 4.3 — Visually distinct hazard tiles ✅ DONE — (2026-07-08, delivered as part of 3.3)
**Closes:** §4, depends on 3.3. **Files:** `MineRunOverlay.tsx`. Give `ice_slide` and
`lava_dot` (from 3.3) a rendering treatment distinct from existing rock/ore tiles so they
read as hazards at a glance, not just palette variants.

---

## Phase 5 — Code hygiene / tests ✅ COMPLETE (2026-07-08)

Can be interleaved earlier by whoever implements each Phase 0-2 item that touches the same
code, but listed here as a clean final pass for anything left over.

### 5.1 — Extract a shared `useCrawlLoop` hook ✅ DONE — (2026-07-08)
**Closes:** 6.d. **Files:** new `src/hooks/useCrawlLoop.ts` (generic caps-based hook
mirroring `crawl.ts`'s engine-side caps pattern — state selector, move/act/dash/cast/tick
actions, faced/ranged-unit id getters for coop targeting, tile-broadcast diff getter),
`src/hooks/useMiningLoop.ts` (become a thin instantiation). **Forest crossover — confirmed,
with an API-drift wrinkle:** `useForestLoop.ts` is the other ~85%-identical twin, but its
`chargeProgressRef` is a bare `number` (0-1) while mine's is an `{active, swings, max}`
object (`useMiningLoop.ts` return type) — the shared hook's charge-progress shape needs to
be designed to satisfy both overlays (mine's charge-pip UI reads `swings`/`max` directly),
not assumed to already match. The hook must be designed so forest can adopt it in a
follow-up, even though this plan only converts mine's side.

### 5.2 — Store-level regression tests for the two untested risk paths ✅ DONE — (2026-07-08)
**Closes:** 6.e. **Files:** `src/store/__tests__/store.integration.test.ts`. Add: (a) a
test standing the player on a tombstone tile with a set `mineTombstone`, calling
`mineStrike()`, asserting the haul merges and `mineTombstone` clears; (b) a test driving
`mineStrike()` on a boon tile with `activeBoons: []` asserting `status === 'choosing'` and
`pendingBoonChoice.length === 3` (the happy path — only the exhausted-pool edge case is
currently covered).

### 5.3 — Small dedup / perf cleanups ✅ DONE — (2026-07-08)
**Closes:** 6.f. **Files:** canonicalize the per-cell hash — **correction: there isn't just
one duplicate to fix, there are three copies.** `src/lib/minigameArt.ts:24` already exports
a `cellHash`; `MineRunOverlay.tsx:37-41` has its own `cellHash`; forest's copy is *named*
`tileJitter` (`ForestRunOverlay.tsx:100-104`, not unnamed/inlined as first assumed) with the
same hash body. Point both overlays at the existing `minigameArt.ts` export instead of
inventing a new shared file. Promote a `HaulChips`/`rewardChips` component pair into
`src/components/minigame/` — **forest already has this exact pattern**
(`ForestRunOverlay.tsx:175-198`, signature `{ reward: Reward; empty: string }`); **port it
into mine as-is**, not the other way around. Extract a `crawlRegen`/`applyPassiveRegen`
helper in `crawl.ts` — this block is actually **tripled**, not doubled: `stepMonsters`
(mine), `stepBeasts` (forest, `forest.ts:1205-1210`), and the already-shared
`crawlCoopClientStep`; the fix should collapse all three. Narrow `strike()`/
`placeTombstone()`'s full-grid tile clone to a row-only clone — **forest's `act()` has the
identical pattern** at `forest.ts:1090,1108` and should get the same fix, ideally via one
shared `setTile` helper in `crawl.ts` used by both. Either make
`MineMonsterDef`/`ForestBeastDef` actually `extends MonsterCombatStats` or delete the
unused interface — **forest's version has an extra wrinkle**: its `weakTo`/`resistTo` are
typed as bare `string[]` rather than `StatId[]`, so a typo'd stat key currently type-checks
and silently no-ops at runtime; fix both defs' typing together. Drop the dead
`MINE_ROWS`/`MINE_COLS` aliases (update the one test that uses them).

---

## Forest crossover summary (updated 2026-07 — fully verified against a matching forest audit)

The Wild Forest received the same two-agent audit treatment (see
`docs/forest-minigame-analysis.md` and `docs/forest-improvement-plan-2026-07.md`). Every
row below that was previously a "verify"/"likely" guess is now confirmed one way or the
other with file:line evidence; two turned out to be genuinely twin-*asymmetric*, not
twin-*shared* — flagged accordingly. Forest implementation remains out of scope for this
plan; this table just records the verified relationship.

| Mine item | Forest status (confirmed) |
|---|---|
| 0.2 death > hurry-bank inversion | **NOT shared — mine-only, confirmed.** Forest has no tombstone; its ladder (bank 1.0 > stash 0.8 > death 0.5) is already sane. Do not port a tombstone into forest to "match" the mine — see forest plan Phase 1. |
| 0.3 kill-loot snowball | **Confirmed, and worse in forest.** `killsThisStage` is cumulative there, producing a quadratic drop curve (~324 leather/stage-10-clear vs. ~80 gathered). See forest plan 0.2. |
| 0.8 mobile lockout | **Confirmed identical.** `ForestView.tsx:115`, same `coarse` disable, same label text. See forest plan 0.7. |
| 1.1 monster HP/contact-hit plateau at depth | **Confirmed identical.** `stepBeasts` (`forest.ts:1342-1349`) has the same single-toucher-per-i-frame cap and flat beast HP. See forest plan 0.3. |
| 2.1 `placeFeatures` extensibility helper | **Confirmed shared shape.** `generateForest` (~325 lines) mirrors `generateMine`'s hand-numbered structure closely enough to share the helper. See forest plan 2.1. |
| 2.3 `splitHaul` relocation | **Call-site list corrected** — forest's 5 sites are `commit.ts:632,655,684`, `ForestRunOverlay.tsx:360`, `forest.test.ts:13,447-462`. See forest plan 2.2. |
| 2.4 boon-cache pickup hoist | **Confirmed identical duplication.** `forestSlice.ts:139-163` (`forestMove`) — same shape, different trigger (walk-onto vs. mine's deliberate strike). See forest plan 2.3. |
| 5.1 `useCrawlLoop` hook | **Confirmed, plus an API drift found:** forest's `chargeProgressRef` is a bare `number`; mine's is an `{active,swings,max}` object — the shared hook must reconcile this, not assume parity. See forest plan (noted, conversion itself not yet scoped there). |
| 5.3 `HaulChips` | **Reverse direction, confirmed** — forest already has `rewardChips`/`HaulChips` (`ForestRunOverlay.tsx:175-198`, exact signature `{reward: Reward; empty: string}`); mine should copy forest's existing pattern verbatim. See forest plan 5.2. |
| 5.3 `cellHash` | **Correction: three copies, not two.** `minigameArt.ts:24` already has one; forest's is named `tileJitter` (not unnamed as first assumed). Canonicalize at the existing `minigameArt.ts` export. See forest plan 5.3. |
| 5.3 `MonsterCombatStats` | **Confirmed, plus a typing gap:** `ForestBeastDef`'s `weakTo`/`resistTo` are bare `string[]`, not `StatId[]` — a typo'd stat silently no-ops with no compiler warning. See forest plan 5.5. |
| 5.3 regen block | **Correction: tripled, not doubled** — `stepMonsters` (mine), `stepBeasts` (`forest.ts:1205-1210`), and the already-shared `crawlCoopClientStep`. See forest plan 5.4. |
| §4 sprite coverage | **Confirmed similar gaps** — all forest beasts (incl. both guardians) are plain emoji; the two band-signature nodes (glowcap, heart_bloom) also lack art, undercutting forest's own band-identity problem. See forest plan 4.1. |
| *(new)* "mine could adopt forest's ranged-weapon combat path for parity" — raised informally during the mine code-health audit, not a numbered finding in the mine analysis doc | **Correction — don't port yet.** Forest's own ranged branch doesn't apply the charge multiplier or melee boons (`forest.ts:1008-1037`); fix forest plan item 0.5 first, or mine would inherit the same bug on day one. |
