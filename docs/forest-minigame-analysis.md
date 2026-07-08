# Wild Forest — Next-Level Analysis (2026-07)

This supersedes the prior version of this file, which claimed a mid-run stash mechanic
"was not implemented" — it exists end-to-end (`forestStash`, see §0). Same treatment as
`docs/mining-minigame-analysis.md`: verified against current source, cross-checked against
that report's findings since the two crawlers share most of their infrastructure via
`src/engine/crawl.ts`.

---

## 0. Baseline — what's already excellent

The moment-to-moment loop (fog + sleeping-beast ambush + gather + kite + push/stash/bank)
is genuinely good, and in one specific way **ahead of the mine**: forest has a real
three-tier haul ladder — full value on entrance/clearing tiles, an explicit mid-run
`forestStash()` action (80%, clearing-only, run continues — `forestSlice.ts:201-209`,
`commit.ts:654-677`), and a 50% death forfeit. This is a genuine risk decision the mine
audit found missing. Also confirmed live and working: ranged bow scanning (`rangedScan`,
line-of-sight shot resolution), sleeping/ambush beast AI (`asleep`, aggro radius, windup
telegraph), the 3-outcome shrine event system (cache/blessing/den, with den correctly
gated off for co-op guests), fleeing-prey beasts (deer/rabbit — no contact damage, faster
than the player, premium drops), guardian ceremonies at stages 4 and 8, and a strong
71-test engine suite (`forest.test.ts`) that covers all of the above — meaningfully
stronger test coverage than the mine currently has.

---

## 1. Balance & economy

**1.1 — Banking summary shows the full haul while off-tile banking silently pays 80%.**
The "Haul Secured" panel renders the full `forest.haul` (`ForestRunOverlay.tsx:986-991`),
but `commitForest` applies `splitHaul(haul, 0.8)` whenever the player isn't on an
entrance/clearing tile (`commit.ts:627-632`; `forest.ts:121-124`). Player movement is
locked once banking starts, so the shown-vs-paid gap is guaranteed for any off-tile bank.
Nothing in the UI discloses the safe-tile rule. **Fix:** mirror the death panel's kept/lost
split on the banking panel; add "return to a clearing for full value" to the button tooltip.

**1.2 — Kill-loot is quadratic and drowns the mode's own gathering identity.** Drop
quantity is `round(maxHp/10) + killsThisStage` (`forest.ts:513-515`) — a *cumulative*
counter, so k predator kills on one stage yield roughly `2k + k(k-1)/2` leather. A
stage-10 full clear nets ~324 leather vs. ~80 gathered materials from actual nodes — combat
outproduces gathering by ~4× and grows quadratically while node yield grows linearly.
**This is the same class of bug as the mine's `killsThisFloor` term (mine plan item 0.3),
but worse in shape** (mine's scales roughly linearly per kill; forest's compounds every
kill within a stage). **Fix:** cap the streak term (e.g. `min(killsThisStage, 3)`) or use
per-species diminishing returns; shift surplus value into node yields/prey drops.

**1.3 — Threat plateaus at stage 33 while reward keeps climbing — unbounded farm per
2-energy entry.** Beast HP never scales with depth (`generateForest` uses `def.hp`
verbatim); only touch damage ramps, capped at 2× (`crawl.ts:296-298`, reached at stage 33).
Contact resolves at most one hit per 800ms i-frame window regardless of adjacent-beast
count (`forest.ts:1342-1349`). No new species past stage 12, no guardian past stage 8, no
band past stage 8 — but per-stage node/wanderer/room counts keep climbing with stage
number. A deep farm stage (20+) nets ~500-600g + ~350 leather per ~10 minutes,
indefinitely, off one entry. **Same underlying issue as mine plan item 1.1 — confirmed
present in forest too**, with the same fix shape (scale beast HP with late depth; allow
more than one contact hit when multiple beasts are adjacent).

**1.4 — No death recovery, unlike the mine.** `commitForestDeath` discards the forfeited
half outright (`commit.ts:683-695`) — there is no forest equivalent of the mine's
recoverable tombstone. **Cross-check finding:** this actually means forest's death-vs-bank
incentive ordering is *sane* (bank 1.0 > stash/off-tile-bank 0.8 > death 0.5, no inversion)
— the mine's EV inversion (mine plan item 1.2) exists specifically *because* its tombstone
makes death's effective value 1.0, not because recoverability is bad. The real issue here
is asymmetry: the two twin modes teach opposite lessons about what death means. **Fix:**
if a forest tombstone is added for parity/consistency, tune its recovered fraction well
below 100% of the lost half (learn from the mine's mistake) so it doesn't reintroduce the
inversion forest currently avoids.

**1.5 — Windup-cancel kiting plus dash i-frame stacking make damage effectively opt-in.**
Adjacency starts a 360ms windup that's cancelled by stepping away (`forest.ts:1330-1337`);
player move/act cadence comfortably outpaces every beast's attack cadence, so
hit-and-step-out defeats everything, guardians included, damage-free. Separately, `tryDash`
grants 800ms i-frames on every dash (`forest.ts:986`), and at AG ≥ 22 with the Quick Dash
boon, dash cooldown drops to ≤ the i-frame window — **100% i-frame uptime by dashing on
cooldown, permanent invincibility**. Ironically AG, the mode's headline stat, is the
invincibility stat. **Fix:** give windup a brief carry-over across one escape (or a
gap-closing lunge on windup expiry for faster beasts); shorten dash i-frames to ~400ms so
they can't be chained back-to-back at any AG value.

**1.6 — Shrine "danger" outcome is positive EV, so the event delivers no real decision.**
Cache/blessing/den are well-telegraphed (color-coded), but under 1.5's kiting, a Disturbed
Den's spawned bear is just ~14g + 3-20 walking loot, and Forest Blessing saves at most 1-2
mitigated hits given the 800ms contact cap. The forest's flagship variety mechanic — the
thing meant to give it more texture than the mine's plain boon caches — currently reduces
to "always press Act." **Fix:** scale den encounters (a pack, not one beast) and cache loot
by band so skip-vs-activate is a genuine risk read.

**1.7 — Ranged combat, forest's one mechanical edge over the mine, is itself half-wired.**
The ranged branch of `act()` never reads the `charged` parameter and never applies
`boonMeleeMult` (`forest.ts:1008-1037` vs. the melee branch at `:1049-1050`) — yet the
charge bar fills and fires for bow users, and Iron Arm/Overcharge are still offered in
forest boon rolls for a build they silently do nothing for. **This matters for the mine
plan too:** mine's report (finding 6.d) suggested porting forest's `rangedScan` into the
mine as a parity feature — but forest's own ranged implementation needs its charge/boon
wiring fixed *first*, or the mine would inherit the same bug on day one.

**1.8 — EN is advertised as a key entry stat but almost never binds.** The lobby surfaces
"EN — stamina pool" (`ForestView.tsx:106-110`), but stamina regen (~50/min) comfortably
outpaces spend even during a full farming stage (~144 spent over ~10 min), and movement is
free. Players investing in EN for the forest get nothing felt from it. **Related to, but
distinct from, the mine's stamina-goes-irrelevant-at-depth finding (mine plan item 0.6/1.7)
— both crawlers under-use their stamina economy, for different mechanical reasons.**

---

## 2. Gameplay depth & variety

**2.1 — Biome bands are spawn-table filters plus palette, same as the mine.** Deepwood
adds exactly one beast + one node; Ancient adds two + one; no band-specific rule (sight,
hazard, weather) exists. `alpha_boar` (stage-3 trash) spawns at equal weight all the way
into Ancient Heart with no band restriction. "Reaching the Deepwood" is currently a tint,
not a play-style shift.

**2.2 — `generateForest` has the same extensibility ceiling as `generateMine`.** One
~325-line hand-rolled function (maze-carve → dead-end nodes → clearing rooms → wall trees
→ wanderers → guardian) with sequential comment-delimited sections and no reusable
placement primitive — mirrors mining.ts's structure closely enough that **the shared
`crawl.ts` placement helper proposed in the mine plan (item 2.1) should be designed to
serve both generators**, not just the mine's.

**2.3 — `amber_stalker`'s stated design purpose doesn't hold up numerically.** Its comment
claims a "sub-300ms cadence [that] outruns the player, so deep stages can no longer be
strolled through untouched" (`content/forest.ts:198-199`), but at 250ms/step vs. the
player's 100-150ms/step (and free, unlimited-stamina movement), the stalker cannot actually
catch a player who doesn't stand still. The one late-depth lethality mechanism doesn't
function as designed — compounds 1.3's farmability.

---

## 3. Controls / UX

**3.1 — Mobile is hard-locked out, identical to the mine.** `ForestView.tsx:115`:
`disabled={!canEnter || coarse}`, "Best played on desktop" — despite complete, working
touch controls (`ForestControls.tsx`: D-pad, charge-aware Act button, Dash, a full spell
row) and touch-charge support already wired. **Confirmed identical to the mine's finding
3.1 — both of the app's cheapest energy sinks are currently desktop-only.**

---

## 4. Graphics & presentation

Trees and floor tiles have solid dedicated art coverage (16 tree variants). Node sprites
cover 4 of 9 keys — notably, the two **band-signature** nodes (glowcap, heart_bloom) that
are supposed to signal "you've reached a new biome" fall back to plain glyphs, undercutting
2.1's already-thin band identity. **All beasts, including both guardians, render as plain
emoji** — identical gap to the mine, where the boss-tier encounters get no more visual
weight than trash mobs.

---

## 5. Code health (shared with the mine — see mining plan Phase 2/5 for the shared fixes)

All of the following were independently confirmed present in forest by the code-health
audit, matching the mine's equivalent findings one-for-one:

- **Boon-cache pickup duplicated** — forest's copy lives in `forestSlice.ts:139-163`
  (`forestMove`), structurally identical to the mine's `mineStrike` branch, differing only
  in trigger (walk-onto vs. deliberate strike).
- **`splitHaul` is forest's own function** (`forest.ts:1403`) that mine cross-imports —
  forest's own call sites: `commit.ts:632,655,684`; `ForestRunOverlay.tsx:360`;
  `forest.test.ts:13,447-462`.
- **`useForestLoop.ts` (306 lines) / `useMiningLoop.ts` (282 lines) are near-duplicate** —
  plus a real API drift baked into the duplication: forest's `chargeProgressRef` is a bare
  `number` (0-1), mine's is an `{active, swings, max}` object. A shared hook would need to
  pick one shape.
- **A per-cell hash exists three times, not two** — forest's copy is actually *named*
  (`tileJitter`, `ForestRunOverlay.tsx:100-104`), and **`src/lib/minigameArt.ts` already has
  its own `cellHash` at line 24** — so any canonicalization should target the existing
  `minigameArt.ts` copy, not a new shared file.
- **Forest already has the `HaulChips`/`rewardChips` pattern mine lacks**
  (`ForestRunOverlay.tsx:175-198`, signature `{ reward: Reward; empty: string }`) — this is
  the one item where forest is the source of truth and mine should copy it verbatim.
- **The sta/mp regen block is tripled**, not doubled — `crawl.ts:851-855`
  (already shared, coop-client path), `mining.ts:1120-1124` (`stepMonsters`), and
  `forest.ts:1205-1210` (`stepBeasts`) all hand-roll the same 4 lines.
- **`ForestBeastDef` doesn't extend `MonsterCombatStats`**, same as `MineMonsterDef` — and
  additionally, forest's `weakTo`/`resistTo` are typed as bare `string[]` rather than
  `StatId[]`, so a typo'd stat key would silently no-op at runtime with no compiler warning.
- **Full-grid tile clone on every act()** — `forest.ts:1090` (chop) and `:1108` (gather),
  same pattern and same fix as the mine's `strike()`.
- **A forest-only duplication, not shared with mine**: the `isOnShrine` branch is
  copy-pasted twice *within* `useForestLoop.ts` itself (charged-act path
  `:174-185` and normal-act path `:218-229`) — a shrine-broadcast bugfix currently needs
  two edits in one file, and this exists independent of any future mine/forest hook merge.

---

## Findings index

| # | Finding | Severity |
|---|---|---|
| 1.1 | Banking summary shows untaxed haul | P1 |
| 1.2 | Quadratic kill-loot dominates gathering | P1 |
| 1.3 | Unbounded late-stage farm (threat plateau) | P1 |
| 1.4 | No death recovery (asymmetric with mine — see cross-check) | — (design note) |
| 1.5 | Kiting + dash-stacking → build-enabled invincibility | P2 |
| 1.6 | Shrine den outcome is positive EV, no real decision | P2 |
| 1.7 | Ranged combat charge/boons not wired | P2 |
| 1.8 | EN stat barely binds | P3 |
| 2.1 | Biome bands are palette-only | P2 |
| 2.2 | `generateForest` extensibility ceiling | P3 (shared fix w/ mine) |
| 2.3 | `amber_stalker` can't actually catch the player | P3 |
| 3.1 | Mobile hard-locked (confirmed identical to mine) | P2 (high leverage) |
| 4 | Band-signature nodes + all beasts lack dedicated art | — |
| 5.* | Code-health items (all confirmed shared w/ mine, see §5) | P2/P3 |
