# Deep Mine — Next-Level Analysis (2026-07)

This supersedes the prior version of this file. That version is stale: it was written
before a substantial improvement pass, and nearly every gap it listed is now fixed. This
version starts from current source (verified file:line) and looks for what's *actually*
missing, using a design-lens pass and a code-health pass as inputs.

---

## 0. Baseline — what's already excellent (don't re-recommend these)

The mine has absorbed almost the entire prior improvement plan
(`docs/archived/mining-improvement-plan.md`). Confirmed live in current code:

- **Fog of war** with sight radius 4, extended by the Lantern boon and the Homestead
  Watchtower perk (`src/engine/mining.ts:83,327-330`; culled in
  `MineRunOverlay.tsx:471-481,719-722`)
- **Boon cache pickup is deliberate** — standing on the tile shows a prompt; opening it
  requires a Space press, with a skip escape hatch (`miningSlice.ts:166-184,279-284`)
- **Shaft + tombstone directional compass**, guardian weakness/resist badges, a charge
  progress bar, active player-status icons, first-run contextual hints, a guardian
  encounter banner, and biome-crossfaded ambient audio — all in `MineRunOverlay.tsx`
- **Tombstone recovery**: death splits the haul 50/50 and the lost half is recoverable by
  finding the tombstone tile on a later visit (`mining.ts:793-835`, `miningSlice.ts:157-166`)
- **Pickaxe progression is real**: `beginMining` reads the equipped tool-slot gear
  (stone/iron/mithril, `content/gear.ts:100-127`) and deep-band materials (obsidian,
  frost_quartz) craft the upgrades (`content/recipes.ts:98-103`)
- **Haul value counts toward score**, entrance vs. off-tile banking has a "hurry tax"
  (`MINE_STASH_KEEP = 0.8`), spells prefer the faced cell over blind nearest-targeting
  (`mineSpellCaps.preferFaced`), and a mining-stats preview panel sits on the lobby screen
  (`MiningView.tsx`)

The moment-to-moment action loop (move/kite, swing vs. hold-to-charge, dash i-frames,
positional fire/ice/poison runes, boon picks) is coherent and well-paced for floors 1–15.
The issues below are what's left after that pass, plus fresh "next level" ideas.

---

## 1. Balance & economy — fix these first (real bugs / exploits, not polish)

**1.1 — Banking overlay shows the wrong number.** `commitMining` only pays the full haul
on the entrance tile; anywhere else it keeps `MINE_STASH_KEEP = 0.8` and forfeits the rest
(`commit.ts:586-593`; `mining.ts:96-99,120-122`). But the "Haul Secured" banking overlay
displays the **full, un-taxed** haul regardless of tile (`MineRunOverlay.tsx:897-921`), and
nothing in the lobby, HUD, or button copy mentions the entrance rule. A player is shown one
number and banked another. **Fix:** show kept vs. forfeited on the banking screen (mirror
the death overlay's split) and change the button label to "Bank 80%" off-tile.

**1.2 — Dying is better than hurry-banking.** Off-entrance banking keeps 80% once. Dying
keeps 50% *plus* stores the other 50% as a recoverable tombstone — 100% expected value
across two visits, with **no other penalty** (same XP trickle formula, deepest-floor record
still updates, no gear/energy loss; `commit.ts:589-591` vs. `609-624`). A player who can't
reach the entrance is strictly better off walking into a monster than pressing Bank.
**Fix:** decay the tombstone-recoverable fraction (e.g. 60–70% of the lost half) or apply a
death-path XP penalty (the app already has `MINIGAME_XP_LOSS_FACTOR` for Arena/Tactics,
`engine/balance.ts:60`) so bank ≥ death everywhere.

**1.3 — Reward is unbounded past ~floor 20 while threat plateaus.** Monster HP never
scales past the magma band (`mining.ts:640-651` uses raw `def.hp`); only touch damage
ramps, capped at 2× (`crawl.ts:293-298`). Contact damage is hard-capped at one hit per
800ms no matter how many monsters are adjacent (`mining.ts:1186-1201`), while monster
*count* keeps climbing uncapped with floor (`mining.ts:636-638`). At floor 22 that's
~15 cinder wisps (bounty 55–90g each) for near-zero attrition against an endgame build —
roughly 1,000g+ per floor, per 2-energy entry, for as long as the player wants to farm.
**Fix:** scale monster HP with late depth (not just touch damage), and let 2–3 adjacent
monsters land contact hits instead of one per i-frame window.

**1.4 — Killing dominates the mode's own name-verb at depth.** Kill loot quantity is
`round(swingsToKill / avgNodeDurability) + killsThisFloor` (`mining.ts:900-912`) — the
`killsThisFloor` term grows every kill on the same floor, so a full clear snowballs (10th
kill on a floor drops ~11 units from a pool that includes obsidian/gemstone at depth).
Combined with 1.3, optimal deep play is "stand in a corridor and harvest the monster
stream," and ore mining becomes early-game-only flavor. **Fix:** cap or square-root the
`killsThisFloor` bonus; shift some value into deep ore (larger yields, a rare "mother
lode" node — see §4).

**1.5 — The magma band resists the mine's own trained stat.** All three magma monsters
(hound, cinder wisp, colossus) have `resistTo: ['ST'], weakTo: ['WI']`
(`content/mining.ts:171-190`); resist multiplies weapon damage ×0.6. But the mine's run XP
trickle is granted as ST/EN (`commit.ts:595-599`) and the lobby literally advertises
"Strike power" (`MiningView.tsx:86-89`). A Wisdom caster kills the Magma Colossus roughly
3× faster than a ST build that the mode itself trains. **Fix:** drop `resistTo: ['ST']`
from at least one magma monster (cinder wisp is the natural pick) so ST builds are slowed,
not hard-countered.

**1.6 — Guardian-floor restarts are a repeatable treasure farm.** Once a guardian floor is
cleared, solo re-entry starts *at* that floor (`unlockedStartFloor`, `mining.ts:124-135`),
and `generateMine` re-places the guardian every time (`mining.ts:654-685`). Each Colossus
kill guarantees 60–100g + 3 obsidian + 2 frost_quartz plus a boon choice — a far better
obsidian source than actually mining obsidian veins (~9% spawn weight,
`content/mining.ts:126-130`). **Fix:** reduced guaranteed treasure (or gold instead of
materials) on a guardian re-kill after the boundary floor has already been cleared once.

**1.7 — Node durability goes stale while pick power keeps climbing.** Rock durability caps
at 3 from floor 7 on; max ore durability is 5 (`mining.ts:540`, `content/mining.ts:101-135`).
Effective pick power is tool power (1/2/3) + `floor(meleePower/8)`
(`mining.ts:992-998`) — a ST 24 + mithril character one-shots every node in the game.
Mining is also stamina-neutral (broken ore refunds +1 sta), so charge, durability bars, and
stamina all go dead for the mode's core activity at depth. **Fix:** scale durability with
floor (`durability + floor/6`), or add "hardened" high-durability variants at depth.

**1.8 — No HP recovery in an entire run for non-caster builds.** `descend` refills 25%
sta/mp but carries HP unchanged (`mining.ts:781-786`); the only heals are support spells,
Vitality's one-time +20, and the 15hp boon-consolation. Pure ST/EN builds — exactly what
the mine's own XP trickle produces — play a pure attrition countdown. **Fix:** make the
rare cave mushroom (already ~1-per-3-floors, `mining.ts:603-616`) restore some HP alongside
stamina.

---

## 2. Gameplay depth & variety

**2.1 — Every monster is the same BFS chaser with different numbers**, guardians
included: flow-field step toward the player, stop when adjacent, contact damage
(`mining.ts:1146-1201`). The `CrawlUnit` doc even notes `asleep`/`windupUntilMs`/`flees`
are forest-only fields (`crawl.ts:514-519`) — the mine never uses them. Every fight asks
the same question; guardians are HP sponges that can be kited indefinitely, so band gates
are gear checks, not skill checks. This is the single biggest source of moment-to-moment
repetitiveness.

**2.2 — Biome bands are ~85% palette swap.** Band-agnostic ores/monsters stay eligible
everywhere (`eligibleOres` filter, `mining.ts:387-392`); at floor 8, frost-quartz is only
~12% of vein weight, and the frozen band adds exactly one new monster (ice_crawler) to a
pool otherwise shared with Rocky Caverns. Descending into "Frozen Depths" mostly means
blue rocks with the same spawn table — the mode's own milestone hint
("defeat the Golem to enter the Frozen Depths," `MiningView.tsx:17`) over-promises.

**2.3 — One generator, one floor archetype.** Every floor is the same 45%-open drunk-walk
cave, scaled up in size only (+4 cells per 4 floors, `mining.ts:84-87,418-420`). There is
no special-room, vault, or hazard-tile vocabulary — `MineTileKind` has 8 entries total and
none are hazards (`mining.ts:116`). By floor 10 the player has seen every spatial situation
the mine can produce; all novelty comes from bigger numbers, not new shapes.

---

## 3. Controls / UX

**3.1 — Mobile is hard-locked out despite full working touch controls.** The lobby
button is `disabled={!canEnter || coarse}` with the label "Best played on desktop"
(`MiningView.tsx:105-115`) — but `MineControls.tsx` implements a complete D-pad,
charge-aware Mine button, and Dash button, the touch-charge path is wired
(`useMiningLoop.ts:33-35,272-275`), and the board scales via `FitToWidth`. For a
habit-tracking app — a phone-first category — the flagship crawler is unreachable on
mobile by a single boolean, and the touch-control investment is currently dead code on the
only path that would use it. **This is probably the single highest-leverage fix in this
whole report.**

**3.2 — Space is overloaded on the shaft tile.** Standing on the shaft, Space always
descends — both normal and charged strike branches check `canDescend` first
(`useMiningLoop.ts:175-176,199-200`). A player mashing attack while retreating across the
shaft gets yanked to a fresh floor mid-fight; a monster standing next to the shaft can't be
fought from it. **Fix:** only auto-descend when no monster occupies the faced cell.

**3.3 — Fog of war and the always-on shaft compass work against each other.** Fog hides
tiles/monsters beyond sight radius, but the compass shows shaft direction from the moment
the floor loads (`shaftPos` is set at generation, `mining.ts:749`, read immediately at
`MineRunOverlay.tsx:289-304`). A depth-rusher can dash straight along the arrow through
unexplored fog, skipping caches, mushrooms, and ore — fog ends up hiding loot, not the
objective, which is backwards for a crawler. **Fix:** only reveal the compass after the
shaft has entered sight once (the "shaft spotted" hint plumbing already tracks this,
`MineRunOverlay.tsx:231-246`).

**3.4 — "Energy Gem" collides with the app's real energy currency.** The gem restores
*stamina* (`content/mining.ts:105-111`), and the stamina gauge uses the same ⚡ Zap icon as
the lobby's habit-earned energy cost line. New players reasonably expect the glowing gem to
refund the currency that gated their run entry. **Fix:** rename + distinct icon.

---

## 4. Graphics & presentation

The renderer is pure DOM/CSS (no canvas/WebGL) with a genuinely well-built hand-authored
CSS "paperdoll" avatar (`CrawlerAvatar.tsx`) and rich procedural tile texturing
(cracks/pebbles/specks via cell-hashed gradients). But dedicated sprite art coverage is
thin: `minigameArt.ts:89-111` shows only iron/crystal/gemstone/bronze ores and one
opportunistic reuse (cave mushroom ← forest toadstool) have real art; **rubble,
stone_lode, gold_vein, frost_quartz, obsidian, and magma_geode all fall back to CSS glyphs**,
and **every single monster — including both guardians — renders as a plain emoji**
(`MineRunOverlay.tsx:735`). The player avatar also doesn't visually reflect equipped
gear tier (stone/iron/mithril pick all look identical) and has no distinct attack-swing
frame. Band differentiation is currently palette + ambient SFX only — a hazard-tile system
(§5) would also read as a real visual signature per band, not just a tint.

---

## 5. New ideas — genuinely more fun, scoped to a habit game's short-session budget

- **Floor modifiers** (~1-in-4 floors): "Gas pocket: sight −1, ore +50%," "Cave-in: shaft
  closes in 90s" — one-line additions to generation, large variety per minute played.
- **Elite affixes**: 1 spawn per floor past 10 (armored / swift / venomous, 3× bounty) —
  reuses existing status-effect plumbing.
- **Band hazard tiles**: frozen ice-slide cells (interacts with dash i-frames in an
  interesting way), magma lava-DoT cells partly hidden by fog.
- **"Mother lode" vault**: a high-durability wall hiding a large ore cache, visible as a
  glow through fog — finally gives charged mining (not just charged combat) a payoff.
- **Timed "rich vein" event**: a golden vein that decays after 60s — a real bank-vs-greed
  decision inside the session length a 2-energy entry already implies.
- **Per-day first-descent bonus**: the first N floors reached each day pay +50%, pushing
  value toward short daily sessions and away from marathon farming (also helps §1.3).
- **Guardian specials**: one telegraphed AoE per guardian (golem ground-slam, colossus
  lava trail) so band gates become a skill check, not purely a gear check.

---

## 6. Code health (affects how cheaply everything above can be built)

- **`generateMine` is the extensibility bottleneck.** A 340-line hand-numbered 10-step
  imperative procedure (`mining.ts:414-752`); adding one new tile kind touches the
  `MineTileKind` union, `isWalkable`, a new generation step, and two ternary chains in
  `MineRunOverlay.tsx` — 4+ edit sites per concept, with no registry the way ores/monsters
  get (`MINE_ORES`/`MINE_MONSTERS`). **This should be refactored before §2/§5 content work**,
  not after — it's the difference between "one data entry" and "a bespoke procedural step"
  for every future hazard/vault/elite.
- **Boon-cache pickup is duplicated** between `miningSlice.ts:167-184` and
  `forestSlice.ts:143-161` instead of living in `crawl.ts` alongside its sibling
  `crawlApplyBoonChoice` — the same class of drift that caused the MINI-01 P0 soft-lock.
- **`splitHaul` lives in `forest.ts`** but mine imports it (`MineRunOverlay.tsx:6`,
  `commit.ts`, `mining.test.ts:26`) — breaks the "engines only share via `crawl.ts`" rule
  the recent boon-reducer hoist established.
- **`useMiningLoop.ts`/`useForestLoop.ts` are ~85% line-for-line identical** (key handling,
  charge-hold math, coop tile-diff broadcasting) — unhoisted, and has already caused one
  real cross-file bug that needed a hand-sync patch.
- **Two real coverage gaps at the store level**: the tombstone recovery merge
  (`miningSlice.ts:157-166`) and the boon-cache *happy-path* transition (only the
  exhausted-pool edge case is tested, `store.integration.test.ts:1496-1510`) — both are
  haul-correctness or soft-lock-class paths with no regression net.
- Minor, cheap: `cellHash` duplicated verbatim in both overlays; mine hand-repeats haul-row
  JSX three times where forest already has a `HaulChips` wrapper (**forest is ahead here —
  mine should copy forest's pattern**, not the reverse); a 6-line regen block duplicated a
  third time; `strike()`/`placeTombstone()` full-grid-clone a single tile mutation on every
  swing (cheap to narrow to a row-only clone); `MonsterCombatStats` is a documented-but-
  unenforced shared contract; a couple of dead aliases (`MINE_ROWS`/`MINE_COLS`,
  redundant `guardianFloor` field).

---

## Findings index (for the implementation plan)

| # | Finding | Severity |
|---|---|---|
| 1.1 | Banking overlay shows untaxed haul | P1 |
| 1.2 | Death beats hurry-bank (EV inversion) | P1 |
| 1.3 | Unbounded late-floor reward vs. flat threat | P1 |
| 1.4 | Kill-loot dominates ore mining at depth | P1 |
| 1.5 | Magma band hard-counters the mine's trained stat | P2 |
| 1.6 | Guardian-restart treasure farm | P2 |
| 1.7 | Node durability stale past floor 7 | P2 |
| 1.8 | No HP recovery for non-caster builds | P2 |
| 2.1 | Zero monster behavioral variety | P2 |
| 2.2 | Biome bands are palette swaps | P2 |
| 2.3 | Single floor-generation archetype | P2 |
| 3.1 | Mobile hard-locked despite working touch controls | P2 (high leverage) |
| 3.2 | Space overloaded on shaft tile | P3 |
| 3.3 | Compass undercuts fog-of-war tension | P3 |
| 3.4 | Energy-gem/energy-currency icon collision | P3 |
| 4 | Thin sprite coverage, no gear-reflecting avatar | — |
| 6.a | `generateMine` extensibility bottleneck | P3 (high leverage) |
| 6.b | Boon-cache pickup duplicated (store layer) | P2 |
| 6.c | `splitHaul` cross-engine import | P2 |
| 6.d | `useMiningLoop`/`useForestLoop` ~85% duplicated | P2 |
| 6.e | Tombstone + boon happy-path store tests missing | P2 (risk) |
| 6.f | Misc small dedup (cellHash, HaulChips, regen, tile-clone perf) | P3 |
