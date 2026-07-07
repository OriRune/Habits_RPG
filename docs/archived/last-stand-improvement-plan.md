# Last Stand — Improvement Plan

> Based on `docs/last-stand-minigame-analysis.md`. All changes are step-by-step and incremental; nothing requires a full rewrite.

---

## 1. Highest-Priority Improvements

These fixes address the issues that most degrade the current experience or introduce the highest maintenance risk.

### 1.1 Add hit and block feedback

**What:** When an attack is blocked, briefly flash the column green and show a small "Blocked!" indicator. When an attack hits, flash the column red, shake the HP bar or show a damage number (e.g. `−14`), and briefly pulse the HP bar color.

**Why:** Right now both outcomes feel identical — the emoji disappears and that's it. Players have no visceral sense of whether they succeeded or failed. This is the single biggest gap in the current experience and costs almost nothing to fix with CSS transitions and a bit of transient state.

**Files:** `LastStand.tsx` — add a `feedbackMap` state (`Record<number, 'blocked' | 'hit'>`) populated on each resolution; clear each entry after ~400 ms. Drive column CSS class and HP bar animation from this map.

---

### 1.2 Fix the score formula when the player dies early

**What:** Change the `finish` function so the denominator is `resolved attacks` rather than `all 16 attacks`.

```ts
// current
onFinish(blocked / finalAttacks.length);  // always 16

// proposed
const resolved = finalAttacks.filter(a => a.result !== null).length;
onFinish(resolved > 0 ? blocked / resolved : 0);
```

**Why:** A player who dies after blocking 6 of 8 resolved attacks scores 6/16 = 37.5% (1★), even though they blocked 75% of everything that actually reached them. This feels deeply unfair and discourages restarting after an early death. The fix gives credit for what the player actually played.

**Files:** `LastStand.tsx` — one line in `finish`.

---

### 1.3 Fix the HP bar label

**What:** Change "🛡️ Endurance" to "❤️ HP" in the HP bar header.

**Why:** The trial stat is HP. "Endurance" is the EN stat and belongs to Long March. This is a small but jarring inconsistency for players who know the stat system.

**Files:** `LastStand.tsx` — one string change.

---

### 1.4 Fix the in-play score display

**What:** Change "Attacks blocked: X / Y" (where Y is resolved count) to "Blocked: X / 16" so the denominator is stable throughout the run.

**Why:** The shifting denominator during play is confusing. Players cannot track their performance toward a target star rating because the number keeps moving.

**Files:** `LastStand.tsx` — the progress `<p>` at the bottom of the render.

---

## 2. Gameplay and Mechanics Improvements

### 2.1 Introduce a difficulty ramp across waves

**What:** Instead of using fixed constants for all 16 attacks, tighten the block window gradually over the course of the run. A simple approach: interpolate `BLOCK_WINDOW_MS` from 750 ms on wave 1 down to 500 ms by wave 8. Optionally also shorten the spawn-ahead warning slightly in the final waves (from 1400 ms to 1100 ms).

**Why:** Currently wave 1 and wave 8 feel identical. There is no sense of escalating pressure. A ramp gives players a learning arc (early waves to internalize timing, late waves to test mastery) and makes the full-score reward feel earned.

**Files:** `LastStand.tsx` — pass the wave index into the block-window check, or pre-bake per-attack `blockWindow` values into the `Attack` interface alongside `landMs`. The latter is cleaner and easier to test.

---

### 2.2 Guarantee direction variety within each wave

**What:** When generating the two attacks per wave, ensure they use different directions at least 80% of the time (or always, as a hard rule for the first 4 waves). A simple implementation: after picking the first direction randomly, re-roll the second if it matches.

**Why:** Two attacks in the same direction in one wave is anticlimactic — the player just presses the same button twice. Two different directions arriving 1200 ms apart is the intended rhythm challenge. Guaranteed variety makes every wave feel meaningful without removing randomness.

**Files:** `LastStand.tsx` — small change to `generateAttacks`.

---

### 2.3 Clarify the block window intent and tighten the late-block grace

**What:** The current block window is `[landMs − 700, landMs + 700]`, meaning a block lands up to 700 ms *after* the attack deadline and still counts. The hit-resolver uses the same threshold, so they race. This should likely be `[landMs − 700, landMs]` — block must arrive before landing — with a small grace of one frame only (to cover input lag).

**Why:** The late-block window undermines the sense that timing matters. If you can block 700 ms after landing, the mechanic stops being a "block it in time" trial. The current behavior may also create a race-condition frame (analysis §9, issue 11) where a block fires the same tick as the hit-resolver.

**Files:** `LastStand.tsx` — change `el <= a.landMs + BLOCK_WINDOW_MS` in the `block` function to `el <= a.landMs + 16` (one frame grace) or simply `el <= a.landMs`.

---

### 2.4 Consider a "combo" or "perfect block" bonus

**What:** If a block lands within the final 200 ms before the attack lands (the "sweet spot"), mark it as a perfect block and count it as 1.25× toward the score (capped at 1.0 total), or show a "Perfect!" label. This is optional but adds a skill ceiling beyond the current binary block/miss.

**Why:** Players who internalize the timing have no way to express mastery beyond a raw block count. A perfect window gives advanced players something to aim for and makes the visual warning more meaningful.

**Files:** `LastStand.tsx` — add a `'perfect'` result type to the `Attack` interface; adjust `finish` scoring.

---

## 3. Controls, UI, and Player Feedback

### 3.1 Show attack progress as a shrinking timer bar, not just emoji scale

**What:** Under each direction column, add a thin horizontal bar that fills from empty to full as the attack approaches its landing time. The existing emoji scale is subtle; a timer bar is explicit and industry-standard for rhythm games.

**Why:** The growing emoji gives a rough sense of urgency but is not precise enough for players to develop consistent timing. A visible countdown bar makes the timing learnable and lets players build muscle memory. This is the most impactful single UI change.

**Files:** `LastStand.tsx` — add a `<div>` per column using `style={{ width: \`${progress * 100}%\` }}` (the `progress` value is already computed in the render).

---

### 3.2 Highlight the active block button when its attack is in the block window

**What:** When an attack's block window is open (`elapsed >= landMs - BLOCK_WINDOW_MS`), apply a glowing or pulsing ring to the matching `<Button>` to prompt the player.

**Why:** The player currently has to read the attack display and map it to the correct button mentally. A visual cue on the button itself reduces that cognitive step, especially for new players.

**Files:** `LastStand.tsx` — derive an `activeDirections: Set<Direction>` from `incoming` + `elapsed`, pass as a prop/class to the button row.

---

### 3.3 Show a countdown before the run starts

**What:** A "3… 2… 1… Go!" countdown (1 second per beat) before the RAF loop begins.

**Why:** The first attack currently appears at 0 ms elapsed (spawn window opens immediately for wave 0, attack 0). Players who click "Begin Trial" and take a moment to orient themselves before looking up can miss the first attack before they realize the game has started.

**Files:** `LastStand.tsx` — add a `'countdown'` phase before `'running'`; delay `startMs.current` initialization until countdown completes.

---

### 3.4 Show final result summary in the component before handing off

**What:** When the game ends (`done === true`), briefly display an end-screen overlay inside the game component (not just the TrialModal result screen) showing "You blocked X / 16 attacks" with a color-coded rating before the modal transitions to the result stage.

**Why:** The transition to the result screen is abrupt. A moment of in-game feedback — before the modal takes over — makes the outcome feel resolved rather than interrupted.

**Files:** `LastStand.tsx` — conditional render when `done` is true; `onFinish` can still be called immediately, or deferred 1.5 s to let the in-game summary display first.

---

## 4. Visual and Audio Polish

### 4.1 Add sound effects

**What:** At minimum three sounds:
- **Block:** A sharp clang or shield-hit sound.
- **Hit:** A dull thud or impact sound.
- **Death / game end:** A collapse or failure chord.

The SFX system (`src/lib/sfx.ts`) is already present in the codebase and `sfxResume()` is called by TrialModal on "Begin Trial," so the AudioContext is ready.

**Why:** Every other polished trial has audio feedback. Last Stand is completely silent. Sound is the highest-bandwidth feedback channel available and it makes block/hit events feel satisfying rather than invisible.

**Files:** `LastStand.tsx` — call the appropriate sfx function on block/hit resolution. Requires adding Last Stand SFX entries to whatever sound registry `sfx.ts` exposes.

---

### 4.2 Animate the sword emoji on block and hit

**What:**
- **Block:** Scale the sword down rapidly (scale 1.0 → 0, ~200 ms) with a green tint.
- **Hit:** Flash the sword red, then scale to 0 (~150 ms).

This can be done with CSS animation classes toggled by the `feedbackMap` from §1.1.

**Why:** The current disappear-on-resolution gives no sense of impact. A block should feel like a parry; a hit should feel like a blow landed. These are cheap CSS transitions, not complex animations.

**Files:** `LastStand.tsx` + Tailwind config or a small `<style>` block for keyframe animations if needed.

---

### 4.3 Add a screen-edge flash on HP loss

**What:** When HP decreases, briefly overlay a semi-transparent red border (or radial vignette) on the outer edge of the game component. Fade out over ~400 ms.

**Why:** HP damage is currently only visible via the HP bar. A peripheral flash makes hits feel physical and urgent without distracting from the center gameplay.

**Files:** `LastStand.tsx` — a positioned `<div>` with opacity driven by a `damageFlash` boolean that resets after a timeout.

---

### 4.4 Replace emoji columns with structured lane layout

**What:** Give each of the three directions its own clearly bounded "lane" column with a visible track. The attack icon travels down the track toward the block zone at the bottom. This is a classic rhythm-game lane design.

**Why:** The current layout is three floating emoji columns with no spatial context. A lane design gives the player an immediate spatial grammar — "attacks come down the lane, I press the button at the bottom" — which is more intuitive and visually readable at a glance.

**Files:** `LastStand.tsx` — restructure the attack display div. This is the largest UI change in this plan and can be deferred; the other polish items are higher ROI.

---

## 5. Technical / Code Improvements

### 5.1 Extract pure logic into `src/engine/trials/lastStand.ts`

**What:** Move the following out of the React component into a pure, framework-free module:
- `generateAttacks(rng)` (attack schedule generation)
- Timing constants (`TOTAL_WAVES`, `WAVE_INTERVAL_MS`, `BLOCK_WINDOW_MS`, `SPAWN_AHEAD_MS`, `DAMAGE_PER_HIT`)
- `lastStandScore(blocked, resolved)` — the score formula
- Any per-wave difficulty parameterization added in §2.1

**Why:** All other trials follow this pattern. Having logic in the component makes it untestable, harder to tweak, and invisible to the engine layer. Extracting it is a prerequisite for adding tests (§5.2) and unblocks stat-scaling integration (§6.1).

**Files:** New file `src/engine/trials/lastStand.ts`. `LastStand.tsx` imports from it instead of defining its own constants.

---

### 5.2 Add unit tests

**What:** Add a `describe('lastStand')` block to `src/engine/trials/__tests__/trials.test.ts` (or a new `lastStand.test.ts`) covering:
- `generateAttacks`: correct count, valid directions, monotonic landing times
- `generateAttacks` is deterministic for a given seeded RNG
- Per-attack timing math (first attack at `SPAWN_AHEAD_MS`, last at expected max)
- `lastStandScore(blocked, resolved)`: correct fraction, clamps to [0, 1], handles zero resolved
- Direction guarantee (§2.2): confirm no two same-direction attacks in the same wave (if that rule is added)
- Per-wave `blockWindow` values (§2.1): confirm window shrinks monotonically across waves

**Why:** Last Stand is the only trial with zero unit tests. Any future mechanic change has no safety net.

**Files:** `src/engine/trials/__tests__/trials.test.ts` or a new `lastStand.test.ts`.

---

### 5.3 Switch to a seeded RNG

**What:** Replace `generateAttacks(Math.random)` with a call using the same seeded LCG pattern used elsewhere in the engine (e.g. `seededRng(Date.now())`).

**Why:** Non-seeded RNG makes attack sequences unreproducible. It prevents testing specific sequences, makes debugging runs impossible to replay, and is inconsistent with every other trial that uses a seeded generator.

**Files:** `LastStand.tsx` (or `lastStand.ts` after §5.1) — add a seed parameter; call site passes `Date.now()` for randomness in production.

---

### 5.4 Consolidate dual state/ref bookkeeping

**What:** Replace the parallel `attacks` (state) + `attacksCopy.current` (ref) pattern with a single `attacksRef.current` as the source of truth for the RAF loop, and schedule a state update via a `version` counter or a `useReducer` to trigger renders only when needed.

**Why:** Maintaining two synchronized copies of the same array is a latent bug waiting to happen. Any future change that forgets to update both will cause silent errors.

**Files:** `LastStand.tsx` — internal refactor, no behavior change. Consider using `useReducer` for all game state to make transitions explicit.

---

## 6. Integration with the Larger Game

### 6.1 Scale block window with HP stat level (optional, future)

**What:** Give the player a modest advantage based on their HP stat level. For example, the block window at base is 650 ms, and each 5 HP stat levels adds 10 ms (capped at 800 ms).

**Why:** The trial currently has no connection to the stat it exercises. Other trials have an implicit difficulty relationship with their stat (higher KN makes the library sequence feel more familiar; higher AG makes the rooftop timing more second-nature). A mechanical link between HP level and block window makes Last Stand feel integrated into the progression system.

**Files:** `LastStand.tsx` (reads HP stat level from store) → `lastStand.ts` (exposes `effectiveBlockWindow(hpLevel)`). Requires §5.1 to be clean first.

---

### 6.2 Surface personal best on the hub card

**What:** Ensure the hub card for Last Stand shows the player's best star rating (already tracked in `bestTrialScore['last_stand']` in the store). Verify this is actually displayed — the analysis confirms the data is stored but did not confirm whether the hub card renders it.

**Why:** The best score display is a motivation loop: players see their current rating and want to improve it. If the hub card already shows it, this is a no-op. If not, it's a small integration gap worth closing.

**Files:** Wherever trial hub cards are rendered (likely `src/components/` or `src/views/` — the hub card component was not found in the current analysis and should be verified). Reads `useGameStore(s => s.bestTrialScore['last_stand'])`.

---

### 6.3 Play a SFX on daily gate enforcement

**What:** If the player tries to open Last Stand when it is already cleared today, show a clear "Cleared today — come back tomorrow" message and optionally a short locked-state chime, rather than silently opening the intro screen.

**Why:** The daily gate is enforced by the store (no-op if already cleared), but the player experience of accidentally entering a cleared trial is undefined from the analysis. Surfacing the gate state clearly prevents confusion.

**Files:** Wherever the trial is opened from the hub (likely a `TrialsView` or `SkillsView` component); compare `trialsClearedOn['last_stand']` to today's date before opening `TrialModal`.

---

## 7. Suggested Implementation Order

Work in passes so each pass produces a shippable, test-able state.

### Pass 1 — Immediate Fixes (low effort, high impact)
These can all be done in a single session. No new files needed.

1. Fix HP bar label: "🛡️ Endurance" → "❤️ HP" (`LastStand.tsx`)
2. Fix in-play score display: `X / Y` → `X / 16` (`LastStand.tsx`)
3. Fix score formula on death: `blocked / 16` → `blocked / resolved` (`LastStand.tsx`)
4. Clarify block window: close at `landMs` (not `landMs + BLOCK_WINDOW_MS`) (`LastStand.tsx`)

### Pass 2 — Core Feedback (medium effort, transformative impact)
These make the game feel like a game.

5. Add `feedbackMap` transient state for block/hit events (`LastStand.tsx`)
6. Drive column flash (green on block, red on hit) from `feedbackMap` (`LastStand.tsx`)
7. Show HP damage number popup on hit (`LastStand.tsx`)
8. Add a screen-edge red flash on HP loss (`LastStand.tsx`)

### Pass 3 — Timing and Controls
These improve readability without changing the core feel.

9. Add per-column timer bar (§3.1) — visual countdown to landing (`LastStand.tsx`)
10. Highlight active block button when window opens (§3.2) (`LastStand.tsx`)
11. Add a 3-2-1 countdown before the run starts (§3.3) (`LastStand.tsx`)

### Pass 4 — Engine Extraction and Tests
Prerequisite for safe future changes.

12. Extract `lastStand.ts` engine module with constants and pure functions (§5.1)
13. Add seeded RNG (§5.3)
14. Write unit tests (§5.2)
15. Consolidate state/ref pattern (§5.4)

### Pass 5 — Difficulty and Mechanics
These change the game design; do them after the engine is clean.

16. Guarantee direction variety within waves (§2.2) — small change to `generateAttacks`
17. Add difficulty ramp: tighten block window across waves (§2.1)

### Pass 6 — Audio and Visual Polish
These can slot in alongside any other pass.

18. Add SFX: block clang, hit thud, death chord (§4.1)
19. Animate sword emoji on block/hit (§4.2)

### Pass 7 — Integration and Stretch Goals
Do these last; they require the engine to be stable.

20. Scale block window with HP stat level (§6.1)
21. Verify hub card shows best score (§6.2)
22. Daily gate UX (§6.3)
23. Lane layout redesign (§4.4) — largest visual change, lowest priority

---

## Summary

| Pass | Items | Effort | Expected Impact |
|---|---|---|---|
| 1 — Immediate fixes | 4 | 30 min | Removes confusing/wrong information |
| 2 — Core feedback | 4 | 2–3 h | Makes the game feel responsive and alive |
| 3 — Timing/Controls | 3 | 2 h | Makes timing readable and learnable |
| 4 — Engine/Tests | 4 | 2–3 h | Makes the code safe to change |
| 5 — Difficulty | 2 | 1 h | Adds a skill arc |
| 6 — Audio/FX | 2 | 1–2 h | Adds juice and satisfaction |
| 7 — Integration | 4 | 2–4 h | Deepens the game-loop connection |

Passes 1–3 can be done entirely within `LastStand.tsx`. Pass 4 is the only one that creates a new file. Nothing here requires touching the store, the reward system, or any other trial.
