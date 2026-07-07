# Wild Forest Improvement Plan

Based on: `docs/forest-minigame-analysis.md`

> **Archived 2026-07-05.** Verified against source: all of Phase 1–2 and most of Phase 3–5 are implemented (charge feedback, shrine telegraphing, exit visibility, spell HUD, free-direction dash, guardian HP bar, boon deal animation, adaptive drone, haul stashing, stage-3 ramp). Left undone as optional/housekeeping: **5.1** (split `ForestRunOverlay` into sub-components), **5.2** (extract VFX state to a hook), **5.4** (control-loop tests), **6.3** (forest-specific daily trial). Partial: **2.4** (boon preview still shows static text, no computed stat delta) and **4.2** (band tint applied to tile floors but not to the ambient FX layer). None of these block play; revisit only if code-quality debt in `ForestRunOverlay.tsx` becomes a problem.

---

## 1. Highest-Priority Improvements

These have the biggest impact on moment-to-moment feel and are blocking a polished experience. Do these first.

---

### 1.1 Charge Attack Visual Feedback

**What:** Add a visible charge indicator so players can see the 480 ms hold window filling before the charged hit fires.

**Why it matters:** Right now, charged swings are invisible — players cannot tell if they held long enough, too long, or not at all. The mechanic exists but is nearly undiscoverable. Without feedback, the highest-skill move in the minigame goes unused.

**Options (pick one):**
- Glow ring that expands on the player tile as the hold progresses, completes at full charge.
- Player sprite tint (amber/red) that brightens over the 480 ms window.
- A small charge bar in the HUD next to the Stamina gauge.

**Files involved:**
- `src/hooks/useForestLoop.ts` — expose `chargeCount` or a `chargeProgress` float (0–1) to the overlay.
- `src/components/forest/ForestRunOverlay.tsx` — read the charge progress and render the visual.

---

### 1.2 Shrine Outcome Telegraphing

**What:** Give each shrine type a visual tell before the player activates it, so the Disturbed Den event cannot kill a player by surprise.

**Why it matters:** All three shrine outcomes share the same activation gesture. The Disturbed Den spawns a guardian beast directly on the player with no counterplay. This is the one place in the minigame where instant death is entirely opaque, which feels unfair rather than challenging.

**Implementation:**
- Each shrine tile stores its type in `ForestTile`. Use it to show a distinct icon or color: gold bag for Cache, star for Blessing, skull for Disturbed Den.
- Alternatively, show a one-step confirmation prompt ("A den stirs beneath your feet — investigate?") before the beast spawns.

**Files involved:**
- `src/content/forest.ts` — shrine type definitions.
- `src/engine/forest.ts` — `generateForest()` places shrines; `forestShrine()` resolves them.
- `src/components/forest/ForestRunOverlay.tsx` — tile rendering for shrines.

---

### 1.3 Exit Tile Visibility

**What:** Make the stage exit tile visually unmistakable — a distinct sprite, glow, or border that reads clearly at a glance.

**Why it matters:** On large late-game maps (up to 57×57), players spend meaningful time hunting the exit after clearing the guardian. There is no reason for this to be friction. The exit is earned; finding it should not be a chore.

**Implementation:**
- Add an exit tile sprite (archway, portal, or glowing border effect) to `src/lib/minigameArt.ts`.
- In `ForestRunOverlay.tsx`, render exit tiles with a pulsing CSS glow or distinct icon overlaid on the tile.

**Files involved:**
- `src/lib/minigameArt.ts` — register exit sprite.
- `src/components/forest/ForestRunOverlay.tsx` — exit tile render case.

---

### 1.4 Spell Slot HUD

**What:** Add a small hotbar to the HUD showing the player's 4 spell slots with icons, keybindings (1–4), and MP costs.

**Why it matters:** Spells are a significant system (runes, ring of fire, teleport, healing) that most players will never use because there is no UI indication that they exist or how to activate them. This is especially critical for new players.

**Implementation:**
- Add a row of 4 spell chips to the HUD, below or beside the MP gauge.
- Each chip shows the spell icon, key label, and MP cost. Gray out chips when MP is insufficient.
- No new engine work required — spell definitions and MP cost are already available.

**Files involved:**
- `src/components/forest/ForestRunOverlay.tsx` — HUD section.
- Spell definitions (already loaded into `ForestState` character snapshot).

---

## 2. Gameplay and Mechanics Improvements

---

### 2.1 Free-Direction Dash

**What:** Decouple dash direction from the player's facing direction. The dash should fire in the direction the player is currently pressing (or holding), not the last tile they walked toward.

**Why it matters:** Dash-as-escape-tool requires the player to be facing away from danger, which is often impossible when a beast is chasing from behind. The current mechanic punishes the player for turning to look at the threat. Free-direction dash (press Shift + direction key, or dash fires in the held movement direction) preserves the cooldown risk/reward while removing an unfair constraint.

**Implementation:**
- In `useForestLoop.ts`, capture the current held direction at the moment Shift is pressed and pass it to `forestDash(dir, nowMs)`.
- No engine changes needed — `tryDash()` already accepts a `(dr, dc)` parameter.

**Files involved:**
- `src/hooks/useForestLoop.ts` — change dash direction resolution logic.

---

### 2.2 Mid-Run Banking (Partial Haul Safety)

**What:** Allow the player to "cache" a portion of their haul at designated safe points (e.g., clearings, shrines) mid-run, so that portion is safe from the death penalty.

**Why it matters:** The 50% death penalty on long runs creates a single cliff with no intermediate safety. After 6+ stages of gathering, one bad contact hit ends in losing half of everything. A caching mechanic gives skilled players a reason to press deeper while giving cautious players a meaningful decision point rather than a binary "go deep or leave."

**Options:**
- **Simple:** Add a "Cache Haul" action at shrine tiles that banking-commits the current haul at 80% value (slightly penalized to incentivize full banking).
- **Deeper:** Add a Waypoint item or Boon that enables caching once per run.

**Files involved:**
- `src/engine/forest.ts` — add `cacheHaul()` function; modify `splitHaul()` to exclude cached items.
- `src/store/useGameStore.ts` — add `forestCacheHaul()` action; persist cached haul separately.
- `src/components/forest/ForestRunOverlay.tsx` — surface the cache action in the shrine interaction.

---

### 2.3 Stage 1–3 Ramp Improvement

**What:** Add a light difficulty ramp within the Thicket band (Stages 1–3) so the early game is less empty and the Stage 4 guardian is less of an abrupt spike.

**Why it matters:** Currently, Stages 1–3 are low-density and low-threat. The first guardian fight at Stage 4 arrives with no prior introduction to fast, dangerous beasts. Players who reach Stage 4 for the first time are likely unprepared.

**Options:**
- Introduce a mini-boss variant of an existing Thicket beast at Stage 3 (e.g., an Alpha Boar — same AI, higher HP and damage, drops extra loot). No new system needed; just a new entry in `content/forest.ts`.
- Gradually scale beast aggro radius or move cadence across Stages 1–3 using the existing stage number.

**Files involved:**
- `src/content/forest.ts` — add Stage 3 variant beast or tune band-gate thresholds.
- `src/engine/forest.ts` — `generateForest()` beast placement logic.

---

### 2.4 Boon Choice Preview

**What:** Show the numerical effect of each boon on the player's current stats when they hover/focus a boon card during the guardian kill choice.

**Why it matters:** Choices like "Iron Arm" or "Stone Skin" are named but abstract. Players choosing between boons cannot evaluate them without knowing their current stats. Showing "Melee: 18 → 23" or "+5 Defense" turns a guess into a real decision.

**Implementation:**
- Pass the current character snapshot into the boon panel.
- For each boon in the choice, compute and display the before/after delta for the affected stat.

**Files involved:**
- `src/components/forest/ForestRunOverlay.tsx` — boon choice panel rendering.
- `src/content/boons.ts` — boon effect definitions (already structured as multipliers).

---

### 2.5 Clarify the Score Formula

**What:** Define `bestForestScore` as a clear, communicated formula and display it during and after the run.

**Why it matters:** The score is tracked but unexplained. Players cannot optimize for something they cannot measure. Defining the formula (e.g., `stages × 100 + haul_value + beast_kills × 5`) turns it into a meaningful progression target.

**Implementation:**
- Confirm or define the formula in `forest.ts` / `useGameStore.endForest()`.
- Add a live score estimate to the HUD during the run.
- Show final score prominently on the banking and death summary overlays.

**Files involved:**
- `src/engine/forest.ts` or `src/store/useGameStore.ts` — define/document scoring formula.
- `src/components/forest/ForestRunOverlay.tsx` — HUD score display, summary overlays.

---

## 3. Controls, UI, and Player Feedback Improvements

---

### 3.1 Act Context Indicator

**What:** Before the player presses Act, show a small label or icon near the Act button (and on the adjacent tile) indicating what the next Act will do: `Attack`, `Harvest`, or `Chop`.

**Why it matters:** `act()` resolves priority internally (beast > node > tree) but the player has no read on it. Pressing Act and getting an unexpected result (attacking air because a beast was adjacent you didn't see, or harvesting when you wanted to fight) breaks the flow.

**Implementation:**
- Each tick, compute the pending act type from the current `ForestState` and player position.
- Display the result as a label beside the Act button in the HUD or as a subtle tile highlight on the target tile.

**Files involved:**
- `src/engine/forest.ts` — expose a `pendingActType()` helper (pure, no side effects).
- `src/components/forest/ForestRunOverlay.tsx` — read pending act type and render label.
- `src/components/forest/ForestControls.tsx` — update touch button label.

---

### 3.2 Touch Spell Buttons

**What:** Add 4 spell buttons to the mobile touch control layout.

**Why it matters:** Spell casting (keys 1–4) is completely inaccessible on mobile/tablet. `ForestControls.tsx` exists precisely for touch input parity, but spells are missing from it.

**Implementation:**
- Add a row of small circular spell buttons below or beside the Act/Dash buttons.
- Each button dispatches `forestCast(spellKey)` on press.
- Gray out buttons with insufficient MP.

**Files involved:**
- `src/components/forest/ForestControls.tsx` — add spell button row.
- `src/components/forest/ForestRunOverlay.tsx` — pass spell state (MP, spell definitions) to controls.

---

### 3.3 Beast HP Bars Uniformity

**What:** Show HP bars on all beasts that have taken any damage, not just specific conditions. Ensure guardians show HP bars from full health (they are boss-tier and deserve a health bar from the start of the fight).

**Why it matters:** Knowing how close a beast is to death is important tactical information, especially for guardians where the kill triggers a boon choice. Currently HP bars appear only when damaged — guardians should have a persistent, prominent HP bar during their fight.

**Files involved:**
- `src/components/forest/ForestRunOverlay.tsx` — beast rendering logic, HP bar condition.

---

### 3.4 Ranged Shot Feedback

**What:** Extend the ranged shot tracer visibility (currently 0.18 s) and add a brief impact flash on the target tile when the shot lands.

**Why it matters:** The arrow tracer is too brief to register consciously. Ranged combat currently lacks the tactile punch of melee. A slightly longer tracer (0.3–0.4 s) and a small impact spark on the target make the shot feel like it connected.

**Files involved:**
- `src/components/forest/ForestRunOverlay.tsx` — tracer duration, add impact flash VFX entry.

---

## 4. Visual and Audio Polish

---

### 4.1 Wire Adaptive Drone to Threat Level

**What:** Actively call `setDroneIntensity()` from `ForestRunOverlay` based on the number and proximity of predator beasts, and ensure `startDrone`/`stopDrone` are called correctly on run start/end.

**Why it matters:** The adaptive drone system is implemented in `src/lib/sfx.ts` but it is unclear whether it is wired to live game state in the overlay. If it is not, the minigame is silently missing its primary tension-building tool.

**Implementation:**
- On each render (or in a `useEffect` on `forestState`), compute a threat score: count predators within a radius, weight by HP and proximity.
- Call `sfx.setDroneIntensity(threatScore / maxExpected)` normalized to 0–1.

**Files involved:**
- `src/components/forest/ForestRunOverlay.tsx` — add drone intensity update effect.
- `src/lib/sfx.ts` — verify `startDrone`, `stopDrone`, `setDroneIntensity` API.

---

### 4.2 Band-Tiered Atmosphere

**What:** Shift the ambient visual atmosphere as the player descends into Deepwood and Ancient Heart bands — darker palette, different god-ray colors, denser mist, altered pollen color.

**Why it matters:** Each band is narratively distinct (Thicket → Deepwood → Ancient Heart) but visually the minigame currently uses the same green/brown atmosphere throughout. Even a subtle shift in color palette reinforces the sense of going deeper.

**Implementation:**
- Add a `bandTheme` object per band (Thicket: green/gold god rays, Deepwood: blue/indigo, Ancient: purple/amber).
- Pass current stage into the overlay and derive the theme. Apply theme colors to god rays, mist gradient, torch glow tint, and pollen mote color.
- Pure CSS/style changes; no engine work.

**Files involved:**
- `src/components/forest/ForestRunOverlay.tsx` — ambient effect style parameterization.

---

### 4.3 Boon Card Animation

**What:** Animate the boon choice panel with a brief deal-in animation (cards slide/fade in from center, staggered by 80–100 ms each).

**Why it matters:** The boon choice is a highlight moment — the reward for a guardian kill. It deserves a brief ceremony. A deal animation costs very little implementation time and significantly increases perceived polish.

**Implementation:**
- Add `@keyframes` slide-up or fade-in with `animation-delay` staggered per card.
- A 3-card deal-in taking ~300 ms total is enough.

**Files involved:**
- `src/components/forest/ForestRunOverlay.tsx` — boon panel JSX + `src/index.css` for keyframes.

---

### 4.4 Guardian Entry Moment

**What:** When the player enters a stage containing a guardian, add a brief visual cue: a roar VFX (screen flash or shake), the guardian's beast tile briefly highlighted, and an audio cue.

**Why it matters:** Currently the guardian appears as just another beast on the map. Given that killing it is the main progression gate, it deserves an "arrival announcement" so players know what they are looking for.

**Implementation:**
- On `generateForest()` completion, if a guardian is placed, flag `guardianPresent: true` in `ForestState`.
- The overlay detects this on first render of the stage and plays a brief intro: screen shake, distant growl SFX (`sfx.enemyDeath` pitched down, or a new cue), guardian tile glow for 2 s.

**Files involved:**
- `src/engine/forest.ts` — set `guardianPresent` flag in generated state.
- `src/components/forest/ForestRunOverlay.tsx` — intro effect on stage entry.
- `src/lib/sfx.ts` — optionally add a `sfx.guardianRoar` cue.

---

## 5. Technical / Code Improvements

---

### 5.1 Split ForestRunOverlay into Sub-components

**What:** Break `ForestRunOverlay.tsx` (~1146 lines) into focused sub-components.

**Why it matters:** The file mixes board rendering, VFX management, HUD, overlay panels (boon choice, banking, death), and ambient effects in a single component. It is difficult to navigate, test, or modify any one part without risk of affecting another.

**Suggested split:**
| Component | Responsibility |
|-----------|---------------|
| `ForestBoard.tsx` | Tile grid, beast rendering, rune/ring rendering, fog of war |
| `ForestHUD.tsx` | HP/Sta/MP gauges, haul chips, depth label, spell hotbar |
| `ForestVFX.tsx` (or hook) | Damage floaters, loot floaters, harvest pops, dash ring, screen shake state |
| `ForestBoonPanel.tsx` | Guardian boon choice UI |
| `ForestSummaryPanel.tsx` | Death and banking summary overlays |
| `ForestRunOverlay.tsx` | Root compositor only — mounts the above, provides context |

**Files involved:**
- `src/components/forest/ForestRunOverlay.tsx` — decompose.
- New files in `src/components/forest/`.

---

### 5.2 Extract VFX State to a Hook

**What:** Move damage floaters, loot floaters, harvest pops, and dash ring state into a `useForestVFX()` hook.

**Why it matters:** VFX state is currently mixed with render state in the overlay component. Extracting it makes the main component smaller, makes VFX logic testable, and makes it easier to add new effects without touching the render tree.

**Files involved:**
- `src/components/forest/ForestRunOverlay.tsx` — extract VFX state.
- New `src/hooks/useForestVFX.ts`.

---

### 5.3 Verify and Enforce Co-op Shrine Authoritativeness

**What:** Audit `forestShrine()` in `useGameStore.ts` to confirm shrine outcome RNG is resolved exclusively by the host and broadcast to guests, not computed independently on each client.

**Why it matters:** Shrine outcomes include a Disturbed Den (spawns a beast) and a Cache (drops items). If both clients resolve this independently with their local RNG, they will desync — one player may have a beast appear while the other gets gold. This is a correctness bug, not just a polish issue.

**Implementation:**
- If the shrine outcome is currently local: resolve it on the host, send the outcome type as part of the co-op tile broadcast, and have the guest apply the resolved outcome.

**Files involved:**
- `src/store/useGameStore.ts` — `forestShrine()` and co-op broadcast methods.
- `src/engine/forest.ts` — `forestShrine()` engine function.

---

### 5.4 Add Control Loop Tests

**What:** Add unit tests for the key input-handling logic in `useForestLoop.ts`: charge detection timing, co-op action routing, and act priority resolution.

**Why it matters:** `useForestLoop.ts` contains the most complex timing logic in the minigame but has no test coverage. The charge detection (count-based with boon modification) and co-op host/guest branching are both bug-prone and hard to verify manually.

**Implementation:**
- Extract pure timing logic from the hook into testable functions where possible.
- Test charge count threshold, AG-scaled move interval computation, and act priority helper.

**Files involved:**
- `src/hooks/useForestLoop.ts` — identify extractable pure logic.
- New `src/engine/__tests__/forestLoop.test.ts`.

---

### 5.5 Document Score Formula

**What:** Add a single comment block in `endForest()` (or a named constant) that states the scoring formula explicitly.

**Why it matters:** `bestForestScore` is updated in `endForest()` but it is not obvious from reading the code what the formula is. Future changes to loot or stage structure may silently break the intended scoring without anyone noticing because the expected behavior is undocumented.

**Files involved:**
- `src/store/useGameStore.ts` — `endForest()` action.

---

## 6. Integration with the Larger Game

---

### 6.1 Material-to-Crafting Legibility

**What:** In `ForestView.tsx` (the entrance screen), add a brief note listing what materials are available at each band tier and what they are used for in crafting.

**Why it matters:** Players need a reason to press deeper. "Reach Depth 4 for crystals (used in Tier 2 gear)" is a concrete pull. Without this, the depth milestones ("Reach Depth 2 for Gray Wolves") give no reason to care beyond abstract discovery.

**Files involved:**
- `src/views/ForestView.tsx` — milestone hint text.
- `src/content/forest.ts` — node type/band mapping for reference.

---

### 6.2 AG and EN Stat Display at Entry

**What:** Show the player's current AG and EN stat values (and their effect) on the `ForestView` entrance screen, similar to how other minigames surface relevant stats at entry.

**Why it matters:** AG and EN directly affect move speed, dash cooldown, and stamina pool — all of which define the forest play experience. Surfacing this at entry reinforces the habit-tracking → stat → minigame feedback loop, which is the core value proposition of the game.

**Files involved:**
- `src/views/ForestView.tsx` — stat display section.
- `src/store/selectors.ts` — read AG, EN stat levels.

---

### 6.3 Forest-Specific Daily Trial

**What:** Add an optional daily challenge tied to Wild Forest (e.g., "Reach Stage 5 in a single run" or "Collect 20 herbs") that plugs into the existing Skill Trials system.

**Why it matters:** Every other stat has a daily trial. AG (the primary forest stat) currently has its trial through a different minigame. A forest-based daily challenge would make the habit loop more direct: log an AG habit → earn energy → do the forest daily trial.

**Note:** This is a longer-term feature. It requires a trial definition in `src/content/trials.ts` and a score hook in `endForest()`. Flag for a future planning session.

**Files involved:**
- `src/content/trials.ts` — add forest trial definition.
- `src/store/useGameStore.ts` — `endForest()` trial completion check.
- `src/engine/trials/` — trial logic if the trial has custom rules.

---

## 7. Suggested Implementation Order

Work in this order to front-load player-facing impact and keep each step independently shippable.

### Phase 1 — Critical feel fixes (do first, high impact / low risk)
1. **1.1** Charge attack visual feedback
2. **1.3** Exit tile visibility
3. **1.4** Spell slot HUD
4. **3.1** Act context indicator

### Phase 2 — Safety and fairness
5. **1.2** Shrine outcome telegraphing
6. **2.1** Free-direction dash
7. **3.3** Guardian HP bar from full health

### Phase 3 — Depth and discovery
8. **2.4** Boon choice stat preview
9. **2.5** Score formula clarification + live HUD display
10. **3.2** Touch spell buttons
11. **6.1** Material-to-crafting legibility at entry
12. **6.2** AG / EN stat display at entry

### Phase 4 — Polish and atmosphere
13. **4.1** Wire adaptive drone to threat level
14. **4.2** Band-tiered atmosphere
15. **4.3** Boon card deal animation
16. **4.4** Guardian entry moment
17. **3.4** Ranged shot feedback

### Phase 5 — Mechanics depth
18. **2.2** Mid-run haul banking / caching
19. **2.3** Stage 1–3 ramp improvement (Alpha Boar or Stage 3 mini-boss)

### Phase 6 — Code quality
20. **5.1** Split ForestRunOverlay into sub-components
21. **5.2** Extract VFX state to a hook
22. **5.3** Verify co-op shrine authoritativeness
23. **5.4** Add control loop tests
24. **5.5** Document score formula

### Phase 7 — Longer-term
25. **6.3** Forest-specific daily trial

---

*Phases 1–3 can ship together as a single "Forest Polish" update and would meaningfully improve the experience for new and returning players. Phases 4–5 build on a solid base. Phase 6 is housekeeping that reduces maintenance burden over time.*
