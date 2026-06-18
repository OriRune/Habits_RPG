# Deep Mine — Improvement Plan

Based on `docs/mining-minigame-analysis.md`.

---

## 1. Highest-Priority Improvements

These have the largest impact on whether the minigame feels worth playing. Fix these before polishing anything else.

---

### 1.1 Add fog of war

**What:** Limit the player's visible viewport to a radius around the player (e.g., 4–5 tiles) with tiles outside that radius darkened or fully hidden. The full 11×11 window stays for rendering, but unlit cells render as dark/opaque.

**Why it matters:** The minigame currently has zero exploration tension. Monsters are always visible before they can reach you, the shaft is visible across the map, and nothing is ever discovered. Fog of war is the single biggest lever for making the mine feel like a dungeon rather than a spreadsheet.

**Files involved:**
- `src/engine/mining.ts` — add a `revealedTiles: Set<string>` field to `MineState` and update it in `tryMove`/`tryDash`. Alternatively compute visibility dynamically in the renderer (no state needed if it's pure distance from player position).
- `src/components/mining/MineRunOverlay.tsx` — in the tile render loop, check if a cell is within the sight radius and darken/hide it. The `CrawlPalette.ambient` color can be the fog base color so it's band-tinted.
- `src/content/boons.ts` — the `lantern` boon already has a `sightBonus` field. Wire it into the sight-radius calculation so it applies in the mine, not just the forest.

**Approach:** Start simple — anything beyond radius 4 from the player renders as a black overlay. Add previously-revealed tile memory (dimmed rather than black) in a second pass.

---

### 1.2 Make boon cache pickup interactive

**What:** Replace the passive step-through trigger with an explicit interaction. The boon cache tile should show a prompt ("Press [Space] to open") when the player stands on it, and the choice panel only opens when they press Strike/interact — not on footstep.

**Why it matters:** Currently a player sprinting through a corridor mid-combat can accidentally trigger the boon choice overlay, freezing all action at the worst possible moment. There is also no anticipatory moment before the choice — it just appears. Both the accident risk and the loss of a satisfying "open the chest" beat are fixable together.

**Files involved:**
- `src/hooks/useMiningLoop.ts` — when the player is standing on a `boon` tile, the strike action should call a new store action (e.g., `openBoonCache()`) instead of swinging. Or add a dedicated key/button.
- `src/store/useGameStore.ts` — add `openBoonCache()` action: checks `tileAt(state, player.r, player.c)?.kind === 'boon'`, clears the tile to `floor`, rolls choices, sets `status: 'choosing'`.
- `src/components/mining/MineRunOverlay.tsx` — add an "Open Cache" prompt badge when the player is standing on a boon tile.

---

### 1.3 Surface guardian weaknesses in the UI

**What:** When a guardian (Stone Golem, Magma Colossus) is on the floor, show a small badge — icon + weak stat label — somewhere in the HUD or on the monster's HP bar.

**Why it matters:** The Stone Golem has defense 6 and 50 HP, and is weak to ST. A player using a WI-heavy build has no way to know they're fighting uphill unless they already know the bestiary. The game already has weakness data in `MINE_MONSTERS`; it just isn't shown.

**Files involved:**
- `src/content/mining.ts` — `MineMonsterDef.weakTo` already holds the data.
- `src/components/mining/MineRunOverlay.tsx` — add a "⚠ Weak: ST" badge on the monster HP bar when the monster is a guardian (`isGuardian: true`). Could also show resistances (`resistTo`).

---

### 1.4 Add a shaft directional indicator

**What:** When the shaft is not in the player's current viewport, show a subtle directional arrow or compass indicator on the HUD edge pointing toward it.

**Why it matters:** The shaft is placed at the farthest BFS cell from the entrance, which means it can be anywhere in a 57×57 map. First-time players wander aimlessly for minutes. This is the single fastest UX fix for new-player confusion.

**Files involved:**
- `src/components/mining/MineRunOverlay.tsx` — find the shaft tile position (it's unique per floor), compute direction from player, render an arrow badge on the viewport edge. No engine changes needed.
- `src/engine/mining.ts` — optionally store `shaftPos: { r, c }` on `MineState` so the overlay doesn't need to scan the tile grid every render.

---

### 1.5 Wire pickaxe upgrades through the tool slot

**What:** Instead of always auto-granting `stone_pickaxe`, read the character's equipped tool from the gear slot at run entry. Different pickaxes should have different `pickaxePower` values, letting gear progression matter in the mine.

**Why it matters:** The gear system already has a `tool` slot and `pickaxePower` exists on the snapshot. Auto-granting the same stone pickaxe every run severs the connection between character progression and mining effectiveness — the mine's primary activity. This is a one-line fix to `beginMining` with outsized progression feel impact.

**Files involved:**
- `src/store/useGameStore.ts` — `beginMining()`: instead of hard-coding `stone_pickaxe`, read `character.gear.tool` or similar; fall back to `stone_pickaxe` if none is equipped.
- Gear/weapon content files — ensure higher-tier pickaxes are defined with escalating `pickaxePower` values.

---

## 2. Gameplay and Mechanics Improvements

---

### 2.1 Give damage spells a facing/directional option

**What:** Instead of always targeting `nearestMonster()`, at minimum let the player manually aim spells at a monster they are facing, or let rune placement affect a 3-tile radius rather than just the exact faced cell.

**Why it matters:** Spell use currently requires no positioning decisions — you cast and the engine picks the target. Rune placement is the only spatial spell, and it requires the player to predict a monster's exact future position on one tile. Even a "cast hits monsters in a line" or "cast targets faced cell and adjacent" change would make spell loadout feel like a real choice.

**Files involved:**
- `src/engine/mining.ts` — `castSpell`: replace `nearestMonster(s)` with a check of `facedCell(s)` first, then fall back to nearest. For area spells, iterate over adjacent cells.
- No control changes needed; the player already faces a direction before casting.

---

### 2.2 Add a small haul-recovery mechanic on death

**What:** Add a "tombstone" tile on the floor where the player died during the current session. Returning to that floor (if re-entering the mine) and reaching the tombstone recovers the lost 50% haul.

**Why it matters:** A flat 50% haul loss on death feels punitive without a recovery path. A tombstone mechanic makes death feel like a setback with agency rather than just a penalty screen. This is a well-established roguelike convention (Nethack, Spelunky).

**Files involved:**
- `src/engine/mining.ts` — on death, optionally record `{ floor, r, c, lostHaul }` in state.
- `src/store/useGameStore.ts` — persist the tombstone data between runs; on `beginMining`, if a tombstone exists for any floor, place it on the generated map when that floor is reached.
- `src/components/mining/MineRunOverlay.tsx` — render tombstone tile (skull glyph + glow).

---

### 2.3 Soften the floor 7 difficulty spike

**What:** Introduce a floor 6 "warning" encounter — a weaker mini-boss or an elite monster with partial guardian traits — so the jump from Cave Spider (floor 4–6) to Stone Golem (floor 7, defense 6, 50 HP) is less abrupt. Alternatively, reduce the Stone Golem's defense from 6 to 4.

**Why it matters:** The Stone Golem is 2–3× tougher than any preceding enemy and the player has no warning. For characters without high ST, it is a grind-to-stalemate that can drain all stamina. The Frozen band's new content (Ice Crawlers) is gated behind beating the Golem, so many players may never see it.

**Files involved:**
- `src/content/mining.ts` — tune `stone_golem` stats (defense, HP) or add a `floor 6` elite non-guardian monster.
- `src/engine/mining.ts` — generation already has a guardian slot for specific floors; a "sub-guardian" could reuse the same slot with `isGuardian: false`.

---

### 2.4 Include haul value in the run score

**What:** When the player banks a run, add the gold-equivalent value of collected materials to the final score. Even a rough 1:1 mapping (1 gold = 1 score point per material unit) is better than the current score ignoring all ore yield.

**Why it matters:** The mine's defining activity is resource extraction, but the score formula only rewards combat and depth. A player who spends 10 minutes methodically mining every iron and crystal vein scores less than one who sprints to the shaft without mining anything. Score should reinforce the intended playstyle.

**Files involved:**
- `src/store/useGameStore.ts` — `endMining()`: compute haul value and add to final score before updating `bestMineScore`.
- `src/content/materials.ts` — define material gold-equivalent values if not already present.

---

### 2.5 Add a partial stamina restore item

**What:** Introduce a rare consumable (e.g., "Cave Mushroom") as a map pickup — distinct from energy gems — that restores 30–50% of max stamina. Place 0–1 per floor via the existing generation step 7 logic.

**Why it matters:** After floor 7, the only stamina recovery mid-floor is the +1 from breaking ores, passive regen (1/1200 ms), and the +25% on descent. A rare floor-item pickup gives players a risk/reward reason to explore the map rather than rushing the shaft.

**Files involved:**
- `src/content/mining.ts` — add `cave_mushroom` ore entry with `grants: { kind: 'stamina', amount: [30, 50] }` and `weight: 0` (placed specially, not in random ore pool).
- `src/engine/mining.ts` — add a mushroom placement pass in `generateMine`, similar to energy gems but rarer (1 per 3 floors on average).

---

## 3. Controls, UI, and Player Feedback Improvements

---

### 3.1 Show "you lost X" on the death screen

**What:** The death overlay should display both the haul being kept (50%) and the haul that was lost (50%), side by side. Something like: "Recovered: 8 gold, 2 iron_bar / Lost: 8 gold, 2 iron_bar."

**Why it matters:** Currently the death overlay shows only the final haul. Players have no visceral feedback for the cost of dying, which undercuts the tension of risk management in deeper floors.

**Files involved:**
- `src/store/useGameStore.ts` — before halving the haul in `endMining()`, store the full pre-death haul in a temporary field or pass it to the overlay.
- `src/components/mining/MineRunOverlay.tsx` — update the death overlay panel to display both values.

---

### 3.2 Add a first-run tooltip sequence

**What:** On a player's very first mine run (detected via `deepestMineFloor === 0`), show brief contextual tooltips: one on the shaft tile when it first comes into view ("Shaft — descend to go deeper"), one when standing on a boon cache ("Boon cache — open for a permanent buff"), and one on first monster contact ("You took damage — use [Shift] to dash and gain brief immunity").

**Why it matters:** There is currently zero in-run guidance. The controls, auto-context strike, charge mechanic, and boon system are all non-obvious. Even three tooltips would sharply reduce first-run frustration.

**Files involved:**
- `src/components/mining/MineRunOverlay.tsx` — track a `shownHints: Set<string>` in local component state; render dismissible tooltips.
- `src/store/useGameStore.ts` — read `deepestMineFloor === 0` as the trigger gate.

---

### 3.3 Add a charge-progress indicator

**What:** When the player holds the strike button, show a small filling progress bar or segmented pip indicator above the player (or on the Mine button) that fills across the 2 swing intervals needed for a charged strike.

**Why it matters:** The charge mechanic is currently completely invisible. Players discover it accidentally (or not at all). The Overcharge boon reduces the count to 1 interval, but without a charge indicator, that boon's effect is equally invisible.

**Files involved:**
- `src/hooks/useMiningLoop.ts` — expose the current charge count (0, 1, 2) as a value that the overlay can read. A simple `useRef` or store field works.
- `src/components/mining/MineRunOverlay.tsx` — render a 2-pip charge indicator above the player avatar when a strike key is held.

---

### 3.4 Indicate active status effects on the player

**What:** Show small icons for active player statuses (bless, etc.) somewhere on the HUD. Currently `playerStatuses` exists on `MineState` but nothing in the UI renders its contents.

**Why it matters:** If a support spell applies `bless`, the player has no way to know it is active or when it expires. The mechanic is silently invisible, making support spells feel like they may have bugged out.

**Files involved:**
- `src/components/mining/MineRunOverlay.tsx` — add a row of status icons below the HP bar, reading `mining.playerStatuses` with expiry timers.

---

### 3.5 Improve the HUD haul tally readability

**What:** The current haul tally shows all materials in a compact strip. Add a subtle "total gold equivalent" or simply expand the display on wider screens, and add an icon per material type instead of raw text.

**Why it matters:** The haul is the primary motivation for playing the mine. Making it more legible and satisfying to glance at (colorful ore icons, not just "+2 iron_bar") reinforces the loop of "mine ore, accumulate haul, bank it."

**Files involved:**
- `src/components/mining/MineRunOverlay.tsx` — HUD haul section.
- `src/lib/minigameArt.ts` — `mineOreSprite()` already maps ore keys to art; use those icons in the tally.

---

## 4. Visual and Audio Polish

---

### 4.1 Add biome-specific ambient audio

**What:** Play a looping ambient sound track per biome band: dripping water for Rocky Caverns, a cold wind drone for Frozen Depths, crackling lava/rumble for Magma Core. Cross-fade on band transition.

**Why it matters:** The visual atmosphere (palette, dust motes, sparkles) changes between bands, but if audio stays static (or silent), the band shift feels cosmetic. Even a simple ambient loop per band would make descending to the Frozen Depths feel like a meaningful tonal shift.

**Files involved:**
- `src/lib/sfx.ts` — add ambient loop playback and cross-fade helpers.
- `src/store/useGameStore.ts` or `src/hooks/useMiningLoop.ts` — trigger band change detection on `bandForFloor(state.floor)` and call the sfx helper.

---

### 4.2 Animate the boon cache tile

**What:** Give the boon cache tile (`kind: 'boon'`) a pulsing golden glow animation — distinct from the static `✦` it currently renders — so it reads as "important interactable" from a distance rather than just another floor decoration.

**Why it matters:** Currently, boon caches look visually similar to rune traps (`✦` glyph). Players should be able to spot one from across the viewport and feel drawn to it.

**Files involved:**
- `src/index.css` — add a `@keyframes boon-pulse` animation (scale + brightness cycle).
- `src/components/mining/MineRunOverlay.tsx` — apply the animation class to boon tiles.

---

### 4.3 Differentiate the shaft tile more clearly

**What:** The shaft tile currently renders with the band's accent color glow. Give it a unique visual treatment: a downward-pointing animated arrow, a distinct dark void appearance, or a subtle particle falling-into-darkness effect.

**Why it matters:** First-time players often do not recognize the shaft as the floor exit. A more unique visual language solves this without requiring a tutorial message.

**Files involved:**
- `src/components/mining/MineRunOverlay.tsx` — shaft tile render case.
- `src/index.css` — optional CSS animation for the shaft.

---

### 4.4 Add audio feedback for key events

**What:** Verify and fill gaps in sound-effect coverage for: ore break, rock break, monster hit, player hit, monster death, boon pickup, descent, and death. The SFX system exists (`src/lib/sfx.ts`) but it is unclear which of these events currently have audio.

**Why it matters:** Each of these events already has a visual pop/floater. Adding matching audio makes the physicality of the mine feel complete. Ore-break feedback in particular reinforces the satisfying "chip chip crack" rhythm that makes mining feel good.

**Files involved:**
- `src/lib/sfx.ts` — add/verify sound events.
- `src/store/useGameStore.ts` — call the appropriate sfx in `mineStrike`, `mineTick`, `endMining`.

---

### 4.5 Add a guardian encounter cue

**What:** When the player first enters a floor containing a guardian (floor 7 or 15), play a distinctive ambient audio sting and optionally display a brief center-screen flash ("A guardian stirs…") to signal that this floor is different.

**Why it matters:** The Stone Golem and Magma Colossus appear without warning. A brief encounter cue primes the player for a harder fight and gives the guardian status weight.

**Files involved:**
- `src/components/mining/MineRunOverlay.tsx` — detect `monsters.some(m => MINE_MONSTERS[m.key]?.isGuardian)` on floor load and show a one-time banner.
- `src/lib/sfx.ts` — guardian encounter audio sting.

---

## 5. Technical / Code Improvements

---

### 5.1 Split MineRunOverlay.tsx into sub-components

**What:** Break the ~955-line `MineRunOverlay.tsx` into focused sub-components:
- `MineTileGrid` — the scrolling viewport and tile rendering
- `MineHUD` — HP/stamina/MP gauges, haul tally, floor/band label
- `MineSpellBar` — the 4-spell ability bar
- `MineBoonChoicePanel` — the 3-card boon overlay
- `MineDeathOverlay` / `MineBankingOverlay` — end-state screens

**Why it matters:** A 955-line component is hard to navigate, test, or safely modify. Each overlay panel has independent state and rendering logic that does not need to coexist in one file. Splitting also makes adding new HUD elements (fog, status icons, charge bar) surgical rather than grep-and-hope.

**Files involved:**
- `src/components/mining/MineRunOverlay.tsx` — refactor into the above.
- No engine or store changes needed; this is purely a React component restructuring.

---

### 5.2 Store shaft position on MineState

**What:** Add `shaftPos: { r: number; c: number }` to `MineState` and populate it during `generateMine`.

**Why it matters:** The overlay currently would need to scan the entire tile grid to find the shaft for the directional indicator (improvement 1.4). With `shaftPos` on state, the overlay reads one field. This also makes the shaft position available to any future logic (e.g., auto-path hints, co-op sync).

**Files involved:**
- `src/engine/mining.ts` — record `shaftPos` in `generateMine` step 4 and in the returned `MineState`.
- `src/engine/mining.ts` — update `descend()` to carry no shaft data (next floor generates its own).

---

### 5.3 Document the energy gem weight:0 pattern

**What:** The `energy_gem` ore has `weight: 0`, which excludes it from the weighted random ore pool. It is placed by a dedicated generation step (step 7) using its own density formula (`ENERGY_GEM_INTERVAL = 80`). Add a short comment in `MINE_ORES` explaining this and why `weight: 0` is correct.

**Why it matters:** Any developer adding a new "utility ore" (see improvement 2.5 — Cave Mushroom) will see `weight: 0` and either be confused or follow the pattern without understanding why. A one-line comment prevents a silent bug.

**Files involved:**
- `src/content/mining.ts` — comment on `energy_gem` entry.

---

### 5.4 Verify Overcharge boon wiring in useMiningLoop

**What:** Confirm that `boonChargeReduce(activeBoons)` from `src/content/boons.ts` is actually subtracted from `CHARGE_SWING_COUNT` in `useMiningLoop.ts`. The boon is defined and the reducer is exported, but the analysis could not confirm the loop hook consumes it.

**Why it matters:** If the wiring is missing, the Overcharge boon does nothing, which is a silent bug that would only surface if a player noticed their charge timing was unchanged after picking the boon.

**Files involved:**
- `src/hooks/useMiningLoop.ts` — find the charge count comparison and ensure `CHARGE_SWING_COUNT - boonChargeReduce(activeBoons)` is used. The hook needs to read `mining.activeBoons` from the store.

---

### 5.5 Add a unit test for boon effects on run state

**What:** Add test cases to `src/engine/__tests__/mining.test.ts` covering: (a) `applyBoonChoice` correctly updates `moveIntervalMs` and `dashCooldownMs`; (b) `strike` with `iron_arm` boon produces higher damage than without; (c) `vein_sense` boon doubles the ore yield from `strike`.

**Why it matters:** Boon effects are pure functions (`boonMeleeMult`, `boonYieldMult`, etc.) applied inside engine functions. They are currently untested. A bug in a boon effect could affect an entire run silently.

**Files involved:**
- `src/engine/__tests__/mining.test.ts`

---

### 5.6 Audit the monster tick for unnecessary BFS rebuilds

**What:** `stepMonsters` calls `floodFieldMulti` once per 120 ms tick, even when no monster has moved (the early-return `if (!changed && result === s) return state` path). Check whether the BFS can be cached and only invalidated when the tile grid changes (e.g., a rock is broken or a monster moves).

**Why it matters:** For a 57×57 map with 10 monsters, a BFS rebuild every 120 ms is 8+ rebuilds per second. On mobile devices this could cause jank, especially combined with the React render loop. This is a performance audit, not a guaranteed fix.

**Files involved:**
- `src/engine/mining.ts` — `stepMonsters`; possibly add a `lastTileChangeMs` field to `MineState`.
- `src/hooks/useMiningLoop.ts` — pass the pre-built field as an argument if caching is moved to the hook layer.

---

## 6. Integration with the Larger Game

---

### 6.1 Make mine depth visible on the character overview

**What:** Display `deepestMineFloor` on the character sheet or dashboard alongside the existing best-score display. Ideally show the current biome band name too (e.g., "Deepest: Floor 9 — Frozen Depths").

**Why it matters:** `deepestMineFloor` and `bestMineScore` are tracked but only shown on the `MiningView` lobby screen. A player who hasn't visited the mine recently has no reminder of their progress. Surfacing this on the dashboard gives the mine narrative continuity in the larger game loop.

**Files involved:**
- `src/views/CharacterView.tsx` or `src/views/DashboardView.tsx` — read `deepestMineFloor` from the store.
- `src/engine/crawlBiomes.ts` — use `bandForFloor()` to derive the band name.

---

### 6.2 Tie mine-specific materials to crafting recipes

**What:** Ensure that frost quartz, obsidian, and magma geode gold have downstream uses in the crafting system (recipes, gear upgrades) that are visible to the player before they have farmed those materials.

**Why it matters:** Players need a reason to push past floor 7 beyond score. If frost quartz has no visible use in the crafting UI, it feels like pointless inventory clutter rather than a goal. This is a content/design audit, not just a code task.

**Files involved:**
- `src/content/materials.ts` — ensure `frost_quartz`, `obsidian` are defined.
- Gear/recipe content files — ensure at least one visible recipe requires each deep-band material.

---

### 6.3 Surface which character stats improve mine performance

**What:** On the `MiningView` lobby screen, add a brief "Your Mining Stats" panel showing: current `meleePower` (pickaxe speed), `agLevel` (move/dash speed), `defense` (damage reduction), and `maxHp`/`maxSta`. Frame it as "how this character performs in the mine."

**Why it matters:** The mine snapshots character stats, but players have no feedback loop showing them which habits to prioritize for a better mine run. Showing the snapshot values on the lobby screen creates a direct visible link between the habit-leveling loop and mine performance.

**Files involved:**
- `src/views/MiningView.tsx` — read the relevant snapshot values from the store and display them.
- `src/store/selectors.ts` — expose a `mineSnapshotPreview()` selector that computes the same values `beginMining` would snapshot.

---

## 7. Suggested Implementation Order

Ordered by impact-per-effort, with dependencies noted.

| Step | Improvement | Effort | Impact |
|---|---|---|---|
| 1 | **1.5** Wire pickaxe upgrades through the tool slot | Low | High — one-line fix in `beginMining` |
| 2 | **5.4** Verify Overcharge boon wiring | Low | Medium — silent bug risk |
| 3 | **5.3** Document energy gem weight:0 | Trivial | Low — code hygiene |
| 4 | **1.3** Surface guardian weaknesses in HUD | Low | High — reduces floor 7 frustration |
| 5 | **1.4** Shaft directional indicator | Low | High — biggest new-player navigation fix |
| 6 | **3.1** Show "you lost X" on death screen | Low | Medium — consequence clarity |
| 7 | **3.3** Charge progress indicator | Low | High — makes charge mechanic discoverable |
| 8 | **3.4** Show active player status effects | Low | Medium — support spell feedback |
| 9 | **4.2** Animate boon cache tile | Low | Medium — interactable legibility |
| 10 | **4.3** Differentiate shaft tile | Low | Medium — navigation clarity |
| 11 | **1.2** Make boon cache pickup interactive | Medium | High — removes accidental trigger, adds satisfying moment |
| 12 | **5.2** Add `shaftPos` to MineState | Low | Low (enables 1.4) |
| 13 | **6.3** Mining stats panel on lobby screen | Low | High — closes habit loop ↔ mine loop |
| 14 | **5.5** Unit tests for boon effects | Medium | Medium — regression safety before boon changes |
| 15 | **3.2** First-run tooltip sequence | Medium | High — new player onboarding |
| 16 | **2.3** Soften floor 7 spike (Golem tuning) | Low | High — reduces run-ending wall |
| 17 | **2.1** Directional/facing spell targeting | Medium | Medium — tactical depth |
| 18 | **4.4** Audit and fill SFX coverage | Medium | High — audio completeness |
| 19 | **4.1** Biome ambient audio | Medium | Medium — atmosphere |
| 20 | **4.5** Guardian encounter cue | Low | Medium — boss encounter weight |
| 21 | **2.4** Include haul value in score | Low | Medium — score reflects full playstyle |
| 22 | **5.1** Split MineRunOverlay.tsx | High | Low (short-term) / High (long-term maintainability) |
| 23 | **1.1** Fog of war | High | Very High — biggest single gameplay upgrade |
| 24 | **2.5** Cave Mushroom stamina pickup | Medium | Medium — resource economy breathing room |
| 25 | **2.2** Tombstone haul-recovery mechanic | High | Medium — reduces death sting |
| 26 | **6.2** Audit crafting recipes for deep-band materials | Medium | High — closes the "why go deep?" loop |
| 27 | **3.5** Improve HUD haul tally with icons | Medium | Low — polish |
| 28 | **6.1** Mine depth on character/dashboard view | Low | Medium — narrative continuity |
| 29 | **5.6** BFS performance audit | Medium | Low (unless profiling shows issues) |

### Recommended first sprint (1–2 sessions)
Steps 1–10 above: all low-effort, high-visible-impact changes that can be done independently. Together they significantly improve legibility (guardian weaknesses, shaft indicator, charge bar, status effects) and fix the boon-cache accident risk groundwork. None require architectural changes.

### Recommended second sprint
Steps 11–20: the interactivity overhaul (boon cache pickup, first-run hints), the floor 7 balance pass, SFX audit, and the lobby stats panel. These close the most important feedback loops between the mine and the larger game.

### Fog of war (step 23) as its own milestone
Fog of war is the highest-impact single change but also the most likely to surface design follow-on questions (how big is the reveal radius, does it persist across floors, does the Lantern boon work in the mine). Treat it as its own milestone after the earlier sprints have stabilized the rest of the experience.
