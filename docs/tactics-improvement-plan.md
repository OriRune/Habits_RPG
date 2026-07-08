# Hex Tactics — Improvement Plan

> Based on analysis in `docs/tactics-minigame-analysis-2.md` (2026-06-18).

> **Status (verified 2026-07-08): 23 of 25 items done.** **5A** (engine split into `src/engine/hexBattle/`) and **5B** (`TacticsOverlay.test.tsx`) are done. **5C** is closed — the goal was met differently via `isTacticsLoadoutSpell()`; no `availableIn` field is planned. Still open: **6C** (flat AG/DX/EN XP split — scheduled in `docs/tactics-audit-2026-07.md` Phase 5) and the partials **2B** ("✓ Acted" chip exists but no "↑ Moved" chip) and **4C** (objective sting reuses the `'victory'` cue) — both scheduled in the audit's Phases 3–4. This plan is now historical; current work tracks against **`docs/tactics-audit-2026-07.md`**.

The minigame's core is solid: the engine is well-tested, the data flow is clean, and the mechanics are coherent. The gaps are mostly surface-level — visual clarity, missing feedback, and a handful of incomplete features that are already partially built. Most improvements here are isolated changes with low blast radius.

---

## 1. Highest-Priority Improvements

These are the changes that most directly degrade the current experience or create player confusion. Fix these first.

---

### 1A. Give every enemy a unique display icon

**What:** Replace the hardcoded `moveset[0].icon` in `TacticsOverlay.tsx` with a dedicated `icon` field drawn from the enemy template definition in `hexBattle.ts`.

**Why it matters:** Right now every enemy shows ⚔️. In a 3-enemy fight you cannot tell which unit is the charger trying to close with you and which is the kiter you should ignore. This undermines the entire archetype system.

**How:**
- Add an `icon: string` field to `EnemyUnit` (and to the enemy template object inside `generateSkirmish`). Assign distinct emoji per template — e.g. 🗡️ charger, 🏹 kiter, 🛡️ holder, 👁️ flanker.
- Update `UnitSprite` in `TacticsOverlay.tsx` to use `enemy.icon` instead of `enemy.moveset[0]?.icon`.

**Files:** `src/engine/hexBattle.ts` (template definitions, `EnemyUnit` type), `src/components/tactics/TacticsOverlay.tsx` (`UnitSprite`).

---

### 1B. Clarify the Push / Blink / Cleave "always granted" display

**What:** The entry screen (`TacticsView.tsx`) shows Push, Blink, and Cleave as locked badges. To a new player this reads as "you don't have these." They are always injected by `generateSkirmish` regardless of loadout.

**Why it matters:** Players avoid wasting loadout slots on these spells — but they also don't use them because the UI implies they're unavailable, which quietly nerfs the player's kit every match.

**How:**
- Rename the badge section from "locked" to "Always Available" or "Granted Free."
- Use a distinct visual treatment (e.g., a dimmed but green border, not a lock icon).
- Add a one-line tooltip: "Always available in every match — not counted against your 3-spell loadout."

**Files:** `src/views/TacticsView.tsx`.

---

### 1C. Fix intent arrow attribution

**What:** Intent arrows currently stack above the player hex. The attacking enemy is not highlighted, so a player looking at 3 intent arrows can't tell which enemy issued which threat.

**Why it matters:** The intent system exists specifically to let the player plan around the enemy phase. If you can't tell which enemy is attacking from where, the telegraphing is ornamental rather than functional.

**How:**
- Render each intent arrow originating from the enemy's current hex (not from the player), with the arrowhead pointing toward the enemy's intended destination or toward the player for attack intents.
- Optionally: tint the attacking enemy's sprite ring when its intent is "attack" to create a visual link between arrow and unit.

**Files:** `src/components/tactics/TacticsOverlay.tsx` (intent arrow rendering, `intentPlan` loop).

---

### 1D. Filter Arena-only spells from the Tactics loadout picker

**What:** Spells with `mechanic: 'rune-fire'`, `'rune-ice'`, `'rune-poison'`, `'ring-of-fire'`, and `'teleport'` have no handler in `playerCastSpell()` in `hexBattle.ts`. If a player owns these spellbooks they silently appear in the loadout picker and do nothing when cast.

**Why it matters:** Silent no-ops that cost MP are demoralizing and confusing. A player will waste their action thinking the spell misfired.

**How:**
- In `TacticsView.tsx`, filter out any spell key whose `mechanic` value is not handled by the tactics engine. The simplest approach: maintain an explicit `TACTICS_ALLOWED_MECHANICS` set (`undefined | 'push' | 'blink' | 'cleave'`) and exclude everything else from the picker.
- Alternatively, add a `tacticsOnly: true` or `arenaOnly: true` flag to `SpellDef` in `src/engine/spells.ts` and filter on that.

**Files:** `src/views/TacticsView.tsx`, `src/engine/spells.ts` (type), `src/content/spells.ts` (flag values).

---

## 2. Gameplay and Mechanics Improvements

---

### 2A. Scale enemy count with board size

**What:** Large boards (radius 6, 127 tiles) currently spawn the same number of enemies as Small (radius 3, 37 tiles). Large matches become a long walk to find 2 enemies in a wide-open space.

**Why it matters:** Board size is a meaningful player choice on the entry screen. Right now it only changes time-per-match (via travel distance), not tactical density. Large should feel like a larger engagement.

**How:**
- In `generateSkirmish`, add a `radiusScale` multiplier to enemy count: e.g., `baseCount × (radius / 3)`, clamped to a reasonable max (5–6 enemies).
- Ensure spawns are distributed around the perimeter, not clustered.

**Files:** `src/engine/hexBattle.ts` (`generateSkirmish`, enemy spawn logic).

---

### 2B. Add a visible "action used" state to the action bar

**What:** After the player attacks or casts, the Strike and spell buttons gray out — but the overall state is easy to miss. Players frequently try to click grayed-out buttons or end their turn early without realizing they haven't moved.

**Why it matters:** Turn structure is the heartbeat of a tactics game. Players need to always know: have I moved? have I acted? what can I still do?

**How:**
- In `TacticsOverlay.tsx`, add a small "✓ Acted" chip below the attack section when `player.hasActed === true`.
- Add a "↑ Moved" chip when `player.movesLeft < initialMoves` (or moved at least once this turn).
- These can be purely visual — no new engine state needed.

**Files:** `src/components/tactics/TacticsOverlay.tsx` (action bar section).

---

### 2C. Show the objective reward before the match starts

**What:** The secondary objective (+60% gold, guaranteed potion) is currently revealed only once the match has begun via the objective banner. The entry screen shows nothing about it.

**Why it matters:** Players can't factor it into their loadout choice. A player bringing mend for sustain would make different choices if they knew a Flawless objective was possible.

**How:**
- On the entry screen (`TacticsView.tsx`), add a line: "~65% chance of a bonus objective — completing it adds +60% gold and a healing potion."
- No logic change needed; this is purely informational text.

**Files:** `src/views/TacticsView.tsx`.

---

### 2D. Expose the objective reward prominently when it's active

**What:** The objective banner is visible but small. Players mid-combat focus on the board and often don't notice it until they've already failed the condition.

**Why it matters:** Secondary objectives are opt-in pressure. Players who don't notice them won't engage. Players who do notice too late feel cheated.

**How:**
- On turn 1 (when `objective` is first set), flash a brief full-width banner ("Bonus Objective: Hold the Beacon for 5 turns — +60% gold") before fading to the normal objective strip.
- Can be implemented as a `useState` fade-out triggered on mount of the overlay when `objective !== null`.

**Files:** `src/components/tactics/TacticsOverlay.tsx`.

---

### 2E. Stamina regeneration — make it visible and legible

**What:** The exact amount of Stamina restored at end of each enemy phase is not documented in a named constant. Players can't predict whether they'll have enough stamina for next turn's attack.

**Why it matters:** Stamina is a tactical resource but currently feels like an opaque meter that just refills "somewhat." Predictable resource regeneration enables planning.

**How:**
- Audit the restore logic in `endPlayerTurn` in `hexBattle.ts`. Extract the regen value into a named constant (`STA_REGEN_PER_TURN`).
- Show the regen amount as a small tooltip or label on the Stamina gauge ("↺ +X/turn").

**Files:** `src/engine/hexBattle.ts` (constant + restore block), `src/components/tactics/TacticsOverlay.tsx` (`Gauge` component for Sta).

---

## 3. Controls, UI, and Player Feedback Improvements

---

### 3A. Per-unit archetype tooltip on hover

**What:** Enemy units currently show their archetype only via a colored ring that requires knowing the legend. No in-place tooltip explains the behavior.

**Why it matters:** New players learn the legend once, forget it, and spend time re-reading it. A hover tooltip on the unit removes that friction permanently.

**How:**
- In `UnitSprite` within `TacticsOverlay.tsx`, add a `title` attribute or a small hover popover that reads: "Charger — closes with you each turn" / "Kiter — stays at range" / etc.
- Can be a simple CSS tooltip (no library needed) since the board is DOM-overlaid.

**Files:** `src/components/tactics/TacticsOverlay.tsx` (`UnitSprite`).

---

### 3B. In-match spell reference

**What:** Once the match starts, there is no way to see what a loaded spell does. The player must remember the description from the entry screen.

**Why it matters:** Players who pick up a new spell (e.g. `hex`) will forget its effect mid-fight and either waste MP or avoid using it.

**How:**
- Add a hover tooltip on each spell button in the action bar showing the `description` field from `SpellDef` and its MP cost.
- The description string is already on the `SpellDef` object available to `TacticsOverlay`.

**Files:** `src/components/tactics/TacticsOverlay.tsx` (spell action buttons).

---

### 3C. Terrain glyphs on tiles

**What:** Terrain type is communicated only via tile fill color. A player unfamiliar with the color scheme has no idea what a slightly-yellow tile does.

**Why it matters:** Cover, slow, and hazard tiles are tactically important. Their effect should be readable without prior knowledge or consulting the guide.

**How:**
- Render a small centered text node inside each non-floor tile in the SVG: `🛡` on cover, `🌿` on slow, `🔥` on hazard, `🪨` on blocked.
- Size the glyph small enough to not obscure units (e.g., `font-size: 10px`, offset to lower tile corner).

**Files:** `src/components/tactics/TacticsOverlay.tsx` (tile SVG rendering loop).

---

### 3D. Retreat confirmation dialog

**What:** The Retreat button exits the match immediately and counts as a loss. There is no confirmation step.

**Why it matters:** A misclick on Retreat during a winning match is unrecoverable. The current gold reward (40% of win value) is not shown before retreating, so players don't know the consequence.

**How:**
- On Retreat click, show an inline confirmation prompt: "Retreat and collect partial rewards? [Confirm / Stay]".
- Show the partial gold amount in the prompt (computable from `tacticsReward` with a forced `won=false` preview).

**Files:** `src/components/tactics/TacticsOverlay.tsx` (Retreat button handler).

---

### 3E. Slow down the enemy phase visually

**What:** All enemy actions resolve instantly — 3 enemies move and attack in a single frame. The player cannot follow what happened.

**Why it matters:** The enemy phase is when the game's most consequential decisions happen. If it's unreadable, the player can't learn from enemy behavior.

**How:**
- `hexBattle.ts` already produces an `effects[]` queue with `startedAtMs` and `durationMs`. The overlay already staggers animations via `EFFECT_STAGGER_MS = 450ms`. The issue is that unit position updates immediately rather than waiting for the move animation.
- The cleanest fix without architectural change: during the enemy phase, render each enemy at an interpolated position between their old and new hex using the effect timestamps. This requires storing `prevHex` on `EnemyUnit` and reading it in `TacticsOverlay`.
- Alternatively: add a `enemyMoveDelay` stagger so each enemy's actions start 450ms after the previous.

**Files:** `src/engine/hexBattle.ts` (`EnemyUnit` type, `enemyAct`), `src/components/tactics/TacticsOverlay.tsx` (unit position rendering).

---

## 4. Visual and Audio Polish

---

### 4A. Distinct enemy icons (prerequisite: improvement 1A)

Already covered in 1A. Once each enemy has a unique icon, the additional visual polish is:
- Add a subtle glow or shadow behind the emoji to separate it from the tile background.
- Size the player icon slightly larger than enemy icons to maintain visual hierarchy.

---

### 4B. Idle pulse on alive enemy units

**What:** All units are static between actions. There is no visual indication that an enemy is "alive and waiting" vs. a dead unit that hasn't been cleared.

**Why it matters:** In a crowded board, it's easy to mistake a dead enemy (opacity-faded in the current code?) for a live one.

**How:**
- Apply a slow `opacity: 0.9 → 1.0` CSS pulse animation (`tactics-idle-pulse`) to live enemy unit sprites.
- Dead enemies already receive reduced opacity in `TacticsOverlay`. The pulse cleanly distinguishes them.

**Files:** `src/components/tactics/TacticsOverlay.tsx` (unit sprite CSS), global CSS (new `@keyframes`).

---

### 4C. Objective-completion audio sting

**What:** There is no audio feedback when a secondary objective is completed. The banner updates silently.

**Why it matters:** Objective completion is a moment worth celebrating. A sting reinforces that the player did something right.

**How:**
- In `useTacticsAudio.ts`, detect when `objective.completed` transitions from `false` to `true` between state snapshots (similar to how `enemyDeath` is detected via alive count delta).
- Fire a `'objectiveComplete'` sound cue on that transition.

**Files:** `src/hooks/useTacticsAudio.ts`.

---

### 4D. Visual consistency: elevation numbers vs. glyph overlap

**What:** When the player is in move mode, elevation indicators (▲ + number) appear on each tile. On small boards these can overlap unit sprites, making both hard to read.

**How:**
- Offset the elevation indicator to the upper-left corner of the tile (currently centered).
- Use a semi-transparent background chip behind the number to ensure contrast against any tile color.

**Files:** `src/components/tactics/TacticsOverlay.tsx` (elevation text rendering in move mode).

---

## 5. Technical and Code Improvements

---

### 5A. Split `hexBattle.ts` into sub-modules

**What:** At ~1,520 lines, `hexBattle.ts` contains AI logic, combat resolution, board generation, spell handling, turn management, and reward calculation in a single file.

**Why it matters:** Any new feature (new AI archetype, new spell mechanic, new terrain type) requires navigating the whole file. The current test file (`hexBattle.test.ts`) is already 700 lines and imports from one monolithic module.

**Suggested split:**
```
src/engine/hexBattle/
  index.ts          — re-exports the public surface (no logic)
  state.ts          — HexBattleState type, constants, helper types
  geometry.ts       — computeReachable, hasLineOfSight, computeTargetable
  combat.ts         — playerAttack, playerCastSpell, holdOverwatch, previewPlayerAttack
  ai.ts             — bestMoveFor, enemyTurn, enemyAct, enemyAttack, scoreMoveTile
  turns.ts          — endPlayerTurn, applyDoTAndDecay, checkOutcome, planEnemyIntents
  generation.ts     — generateSkirmish, rollObjective, buildEnemyRoster
  rewards.ts        — tacticsReward, commitTactics helper
```

**Approach:** Keep the public API identical (all current exports re-exported from `index.ts`). Migrate one section at a time, running `npm run test` after each. No behavior changes.

**Files:** `src/engine/hexBattle.ts` → `src/engine/hexBattle/` (new directory), `src/engine/__tests__/hexBattle.test.ts` (update imports).

---

### 5B. Add integration tests for `TacticsOverlay`

**What:** The largest UI component in the minigame has zero automated test coverage. Bugs in action selection, hover preview, or end-turn flow would only be caught manually.

**Why it matters:** `TacticsOverlay.tsx` is 880 lines and handles all user interaction. A regression introduced by any future feature work would be invisible until someone plays the game.

**Suggested test cases (Vitest + React Testing Library or similar):**
- Render overlay with a minimal `HexBattleState` fixture → assert player gauges display.
- Click a reachable tile → assert `tacticsMove` store action is called with correct hex.
- Click Strike → hover enemy tile → assert `PreviewBadge` appears with correct values.
- Click End Turn → assert `tacticsEndTurn` is called.
- Win state → assert victory message renders and `endTactics` is called.

**Files:** New `src/components/tactics/__tests__/TacticsOverlay.test.tsx`.

---

### 5C. Tag arena-only spell mechanics in `SpellDef`

**What:** As noted in issue 1D, `SpellDef` in `src/engine/spells.ts` has no way to express which game modes a spell supports. The type currently allows any spell to appear in any context.

**How:**
- Add `availableIn?: ('arena' | 'tactics')[]` to `SpellDef`. Default (absent) = both.
- Mark rune and ring-of-fire spells as `availableIn: ['arena']`.
- Mark Push, Blink, Cleave as `availableIn: ['tactics']`.
- Use this field to filter both the Tactics loadout picker and (eventually) the Arena spell bar.

**Files:** `src/engine/spells.ts` (type), `src/content/spells.ts` (values), `src/views/TacticsView.tsx` (filter).

---

### 5D. Document Stamina regeneration as a named constant

**What:** The Stamina restore value in `endPlayerTurn` is either a magic number or derived inline. It should be a named constant at the top of `hexBattle.ts` alongside `COVER_DEFENSE`, `HAZARD_DMG`, etc.

**Why it matters:** Tuning stamina regen is a balance lever that should be as easy to adjust as `COVER_DEFENSE = 3`. Buried math is invisible to balance passes.

**Files:** `src/engine/hexBattle.ts`.

---

### 5E. No-match save warning

**What:** Closing the browser or navigating away during a match silently loses the run. There is no warning.

**How:**
- Add a `beforeunload` event listener in `TacticsOverlay` (via `useEffect`) that fires only when `tactics !== null` and `tactics.status === 'active'`. Show the browser's native "Leave site? Changes may not be saved" dialog.
- This is a two-line change and covers the common accidental-close case.

**Files:** `src/components/tactics/TacticsOverlay.tsx`.

---

## 6. Integration with the Larger Game

---

### 6A. Show `deepestTacticsTier` on the Dashboard or character sheet

**What:** The player's personal record is tracked (`deepestTacticsTier` in the store) but never surfaced outside the Tactics entry screen.

**Why it matters:** Visible progression creates motivation to push to higher tiers. It also gives the player a sense of mastery relative to their other minigame records.

**How:**
- Add a "Tactics Record: Tier X" stat row to the character sheet or the stats panel on the Dashboard, alongside other minigame bests.

**Files:** `src/store/useGameStore.ts` (selector), whichever Dashboard or character sheet component displays stat records.

---

### 6B. Ensure AG investment is legible as a Tactics benefit

**What:** Agility (AG) is the stat that directly powers Tactics — it determines move range and climb. But the habit-to-stat mapping means players may not know their AG habits improve their Tactics performance.

**Why it matters:** The habit-XP loop is the core of the larger game. Players should feel that building AG makes Tactics matches easier. Currently this connection is only visible on the Tactics entry screen (which shows the formulas) — not on the habit logging screen where the behavior happens.

**How:**
- On the habit completion confirmation (or the Dashboard stat display), add a small tooltip or label to the AG stat: "Increases Tactics move range and climb."
- No engine change needed.

**Files:** `src/components/` (whichever component renders the stat list or habit reward summary).

---

### 6C. Consider Tactics XP flowing to DX more intentionally

**What:** Tactics rewards flat XP to AG, DX, and EN regardless of how the match was played. A player who used only melee attacks shouldn't necessarily earn DX (ranged/dexterity) XP.

**Why it matters:** The habit system's core design is that effort in a domain earns XP in the related stat. Tactics is the only minigame that awards XP to stats the player didn't express — it slightly undermines the stat specialization system.

**How (minimal):**
- Track `meleeActionsUsed` and `rangedActionsUsed` during the match (already implicit via weapon `attackStat`).
- If weapon is `'ST'` melee, award XP to AG/ST/EN. If `'DX'` ranged, award AG/DX/EN.
- This is a small change to `tacticsReward()` in `hexBattle.ts` and `commitTactics` in the store.

**Files:** `src/engine/hexBattle.ts` (`HexBattleState` — add action counters; `tacticsReward`), `src/store/useGameStore.ts` (`commitTactics`).

---

## 7. Suggested Implementation Order

The items above are grouped here by effort and independence. Each batch can be done in a single sitting without depending on the batch after it.

### Batch 1 — Quick wins (1–2 hours total, no design risk)
These are all isolated, safe changes with immediate visible impact:

1. **1B** — Fix "always granted" spell display in `TacticsView.tsx`
2. **2C** — Add objective reward info to entry screen (`TacticsView.tsx`)
3. **3B** — Add spell tooltips to action bar buttons
4. **3D** — Add Retreat confirmation dialog
5. **5E** — Add `beforeunload` warning for mid-match navigation
6. **5D** — Document Stamina regen as a named constant

### Batch 2 — Visual clarity (2–4 hours, isolated UI changes)
Each change is a self-contained tweak to `TacticsOverlay.tsx` or the SVG render loop:

7. **1A** — Unique enemy display icons (requires engine type change + overlay update)
8. **3A** — Archetype tooltip on enemy unit hover
9. **3C** — Terrain glyphs on tiles
10. **2B** — "Acted / Moved" state chips in action bar
11. **4D** — Elevation number offset to avoid sprite overlap

### Batch 3 — Tactical feedback (3–5 hours, moderate coordination)
These improve the core play loop and require touching both engine and UI:

12. **1C** — Fix intent arrow attribution (re-anchor arrows from enemy hex)
13. **2D** — Flash objective banner on turn 1
14. **3E** — Slow down / stagger enemy phase animations
15. **4B** — Idle pulse on alive enemy units
16. **2E** — Surfacing stamina regen value in the UI

### Batch 4 — Bugs and completeness (2–3 hours, moderate risk)
These fix real bugs or incomplete features:

17. **1D** — Filter arena-only spells from Tactics loadout
18. **5C** — Add `availableIn` field to `SpellDef`
19. **2A** — Scale enemy count with board radius
20. **4C** — Objective-completion audio sting (`useTacticsAudio.ts`)

### Batch 5 — Code health (4–8 hours, no user-visible change)
Safe to do any time, but worth batching to minimize churn:

21. **5A** — Split `hexBattle.ts` into sub-modules
22. **5B** — Add `TacticsOverlay` integration tests

### Batch 6 — Larger game integration (variable, depends on Dashboard structure)
Do last — these touch parts of the codebase outside the Tactics module:

23. **6A** — Surface `deepestTacticsTier` on Dashboard/character sheet
24. **6B** — AG tooltip on habit/stat screen
25. **6C** — Stat-weighted Tactics XP distribution

---

### What to skip (for now)

- **Destructible terrain / fire spread** — fun, but a significant engine change for marginal tactical gain.
- **Mid-match save / checkpoint** — the matches are short enough that saving is low-value effort relative to implementation complexity.
- **Second action per turn** — the current "move + act" system works well. Changing the action budget would require rebalancing all enemy stats and difficulty.
- **Elite enemy variants** — good for tier 10+, but the base experience should be improved first.
