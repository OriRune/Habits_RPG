# Lockpicking Minigame — Improvement Plan

Based on `docs/lockpicking-minigame-analysis.md`.

---

## 1. Highest-Priority Improvements

These are the changes that most immediately affect whether the minigame feels finished and fair.

### 1.1 Add Sound Effects

**What:** Wire three SFX to the lock events: a metallic scraping sound during jamming, a satisfying click on lock open, and a sharp snap on pick break.

**Why:** `Lockpicking.tsx` doesn't import `sfx.ts` at all, despite `TrialModal` calling `sfxResume()` before every trial in anticipation of audio. The absence is the single biggest polish gap — this mechanic is explicitly modelled on Skyrim's lockpicking, where the audio is iconic. Without it the visual feedback (glow, shake, CLICK/SNAP) lands at about half impact.

**Files involved:** `src/lib/sfx.ts`, `src/components/trials/games/Lockpicking.tsx`. Add scratch/scrape sound triggered while `isJamming` is true (throttled so it doesn't re-trigger every frame), a click on phase transition to `'opening'`, and a snap on transition to `'breaking'`.

---

### 1.2 Add Passive Proximity Feedback During Search

**What:** Give the player some indication they are near the sweet spot while rotating the pick (not just while holding torque). The most practical approach: a very subtle visual cue on the pick or lock when within the turn zone — for example, a faint ambient glow on the cylinder, or a slight wobble/vibration on the pick itself.

**Why:** Currently the entire discovery loop is "hold torque → check glow → release → move → repeat." There is zero feedback during the rotation phase. Finding the sweet spot feels random rather than skilful, especially on the tightest lock (11° turn zone on Adept at level 1). A passive signal transforms the search from luck to skill.

**Files involved:** `src/components/trials/games/Lockpicking.tsx`. During the idle phase, compute `allowedTurn(pickDegRef.current, lock)` each frame and apply a very low-opacity ambient glow or a small transform oscillation on the pick element when the value is non-zero. Keep it subtle enough that it's a hint rather than a giveaway.

---

### 1.3 Wire DX Stat Level into Difficulty

**What:** In `lockTolerance()`, factor in the character's `statLevels.DX` alongside or instead of `character.level`. A reasonable formula: use `character.level` for the base scaling (as now) and add a smaller bonus from `statLevels.DX` on top.

**Why:** The trial awards DX XP and is described as a Dexterity trial, but a high-DX character has absolutely no mechanical advantage in it. This breaks the core progression promise — that grinding a stat makes related activities easier. The fix is small (one constant + one parameter change) and has meaningful design impact.

**Files involved:**
- `src/engine/trials/lockpicking.ts` — add a `dxLevel` parameter to `lockTolerance()` and `generateLocks()`; add a `LEVEL_DX_BONUS` constant (suggest `0.3°` per DX level for tolerance, `0.1°` for open tolerance — smaller than the character-level bonus so it's additive, not dominant).
- `src/components/trials/games/Lockpicking.tsx` — read `character.statLevels.DX` from the store alongside `character.level` and pass both to `generateLocks()`.

---

### 1.4 Fix the CSS Comment Typo

**What:** `src/index.css:381` reads `\* Lockpicking — pick-break flash...` instead of `/* Lockpicking — pick-break flash...`. The opening delimiter is malformed.

**Why:** Low-effort fix, should not be left in. Browsers may silently handle it but linters and tools may flag it.

**Files involved:** `src/index.css:381` — replace `\*` with `/*`.

---

## 2. Gameplay and Mechanics Improvements

### 2.1 Reset Pick Position Between Locks

**What:** When transitioning from one lock to the next (the `nextOpened >= NUM_LOCKS` else-branch in the RAF loop), reset `pickDegRef.current` and `setPickDeg` to a neutral position (e.g., 90° — dead center).

**Why:** The pick currently carries over its exact angle from the previous lock. This is almost certainly accidental. It creates an inconsistent starting state: a player whose pick happens to be near the next lock's sweet spot gets an unearned head-start. Resetting to center is the most defensible default and is consistent with how most lockpicking implementations behave.

**Files involved:** `src/components/trials/games/Lockpicking.tsx` — two-line change in the opening-phase branch (around line 307).

---

### 2.2 Show the Sweet Spot Briefly After All Picks Are Exhausted

**What:** When the final pick snaps and `finish()` is called with a failure score, briefly animate the lock plate to reveal where the sweet spot was (e.g., a small indicator mark at the correct degree on the arc, fading after ~1.5 seconds).

**Why:** Without this, failure teaches nothing. Players can lose three Adept locks in a row and still have no idea whether they were 5° away or 80° away. A brief post-failure reveal converts frustration into learning and makes the next attempt feel more intentional.

**Files involved:** `src/components/trials/games/Lockpicking.tsx` — add a `showSweetSpot` boolean state that triggers on `finish()` with failure; render a small marker on the lock plate's edge at the correct angle for the current lock.

---

### 2.3 Tune the Score Formula

**What:** The current success-branch formula is `0.5 + 0.5 * max(0, picksRemaining - 1) / (budget - 1)`. With PICK_BUDGET=6, using 2 picks gives a score of `0.5 + 0.5 * (4/5) = 0.9`, but using 5 picks gives only `0.5 + 0.5 * (0/5) = 0.5`. This means any "not-perfect" run compresses into 0.5–0.9, and the difference between using 2 vs. 4 picks is only 0.2 score points (0.9 vs. 0.7). Consider a slightly more linear curve: `0.5 + 0.5 * picksRemaining / budget`. This gives a more meaningful spread (1 pick left = 0.58, 3 left = 0.75, 6 left = 1.0) and removes the awkward "last pick doesn't count" bias.

**Why:** The star thresholds matter. If 2-star requires ≥0.5 and 3-star requires ≥0.7, the current formula means spending 4 of your 6 picks still gives 3 stars, making pick conservation feel un-rewarded.

**Files involved:** `src/engine/trials/lockpicking.ts:lockpickingScore()` — one-line change to the `pickFraction` calculation. Update the corresponding test in `src/engine/trials/__tests__/trials.test.ts`.

---

### 2.4 Consider a Break-Time Floor on the Adept Lock

**What:** `BREAK_TIME_MIN = 0.55` seconds applies to all locks at max distance from the sweet spot. On the Adept lock with its 11° turn zone, a player can easily be at maximum distance (full jam) and snap a pick before they even register the glow has turned red. Consider either a per-lock `breakTimeMin` constant (e.g., `[0.55, 0.65, 0.80]`) or a universal increase to 0.70–0.75s.

**Why:** The Adept lock's narrower turn zone means the player more frequently lands at extreme jam, and the 0.55s floor is the same as on the Novice lock. A slightly longer floor on harder locks would give players a realistic window to react before the snap.

**Files involved:** `src/engine/trials/lockpicking.ts` — replace `BREAK_TIME_MIN` scalar with a `BREAK_TIME_MIN_PER_LOCK` tuple; update `breakTime()` signature to take `lockIndex`. Update call sites in `Lockpicking.tsx` and tests.

---

## 3. Controls, UI, and Player Feedback Improvements

### 3.1 Add Visual Reference Points to the Pick Arc

**What:** Render a subtle arc or tick system around the lock plate's inner rim to give the player a positional frame of reference. The simplest version: three or four evenly spaced tick marks on the outer edge of the lock plate, like a compass rose, letting players describe and remember positions ("I need to go left from the 12 o'clock mark").

**Why:** The 180° arc is currently featureless. Players cannot communicate sweet spot positions to themselves or others, and cannot build positional memory across sessions. Even three tick marks would let a player note "it was at the left quarter" and adjust on the next attempt.

**Files involved:** `src/components/trials/games/Lockpicking.tsx` — add a short SVG ring or a few positioned `div` markers inside the lock plate element. No engine changes needed.

---

### 3.2 Emphasize the Hint Text

**What:** Give hint text a brief CSS pulse or scale-in animation each time it changes. Currently the hint sits in a static `<span>` and is easy to miss, especially while watching the glow.

**Why:** The hints are the primary guided feedback system during torque. "Almost there!" is genuinely useful information that players consistently miss because there's nothing drawing the eye to the hint line.

**Files involved:** `src/components/trials/games/Lockpicking.tsx` — add a `key={hint}` to the hint `<span>` to trigger React's re-mount on change, pair it with a short CSS `@keyframes hint-pop` (scale 1.15 → 1 over 150ms) defined in `src/index.css`.

---

### 3.3 Increase Mobile Button Size and Spacing

**What:** The ◀ and ▶ buttons are 44×44px (`h-11 w-11`). Increase to 48×48px (`h-12 w-12`) and add a slightly wider gap between them and the "Turn Lock" button.

**Why:** During an active jam, the player needs to release torque and quickly re-position the pick. On mobile this requires precise simultaneous taps on small targets under time pressure. A marginal size increase reduces mis-taps at low cost.

**Files involved:** `src/components/trials/games/Lockpicking.tsx` — change `h-11 w-11` to `h-12 w-12` on the ◀ and ▶ buttons (lines ~659, ~674).

---

### 3.4 Show a "Locks Remaining" Count Alongside the Lock Row

**What:** Below the Novice/Apprentice/Adept row, add a small text line like "Lock 2 of 3" or simply make the current lock label more visually prominent (bolder, slightly larger) so the player always knows where they are in the run.

**Why:** A new player who isn't reading the small label text can genuinely lose track of which lock they are on, especially after a fast CLICK/advance. The current active indicator (🔑 icon) is small.

**Files involved:** `src/components/trials/games/Lockpicking.tsx` — minor JSX change to the lock progress row (around line 497).

---

## 4. Visual and Audio Polish

### 4.1 Smooth the Warmth Glow Interpolation

**What:** Replace the five hard-coded `warmthGlowColor()` threshold bands with a continuous interpolation. One approach: define three anchor colors (red at 0, amber at 0.5, green at 1.0) and linearly interpolate `r`, `g`, `b` between them based on `warmth`.

**Why:** There are currently visible color jumps at warmth thresholds 0.20, 0.45, 0.70, and 0.95. The jumps undermine the "smooth hot/cold" metaphor — players notice a pop rather than a gradient shift. A continuous function is also cleaner code.

**Files involved:** `src/components/trials/games/Lockpicking.tsx` — rewrite `warmthGlowColor()` (currently lines 45–51) to interpolate rather than threshold. No engine or store changes.

---

### 4.2 Add a Pick-Stress Visual During Torque

**What:** As `jamTimeRef` accumulates, progressively bend or color-shift the pick toward rose/red, giving a visual countdown to the snap. The pick already leans slightly against the cylinder rotation; increase this lean as `jamTimeRef / breakTime` approaches 1.

**Why:** Currently the only snap warning is the shake effect and hint text. A visual state on the pick itself (bending, reddening) creates more immediate dread and gives skilled players a secondary signal to release torque before breaking.

**Files involved:** `src/components/trials/games/Lockpicking.tsx` — expose a `stressRatio` prop to `LockPick`, compute it from `jamTimeRef.current / breakTime(...)`, and use it to lerp the shaft color and/or increase the lean offset in `cssRot`.

---

### 4.3 Add a Brief Glow Burst on Lock Open

**What:** When a lock opens, flash the entire lock plate with a gold/green radial glow pulse (in addition to the existing "CLICK!" text overlay). A 300–400ms CSS animation that quickly expands a radial gradient outward from the cylinder would read as a satisfying unlock release.

**Why:** The "CLICK!" text overlay is functional but the lock plate itself has no celebratory state. A plate-level glow burst would make each open feel more impactful and give the eye somewhere to look during the 750ms flash window.

**Files involved:** `src/index.css` — add a `@keyframes lock-plate-open` animation; `src/components/trials/games/Lockpicking.tsx` — apply it to the outer plate `div` when `flashType === 'unlock'`.

---

## 5. Technical and Code Improvements

### 5.1 Extract a `usePickRNG` Hook or Accept an RNG Parameter

**What:** `Lockpicking.tsx` passes `Math.random` directly to `generateLocks()`. This is already the right API shape — `generateLocks` accepts an `rng` function. Document this intentional seeding interface and, if a seeded daily layout is ever wanted, the hook is the right place to supply it without touching the component.

**Why:** The engine already supports arbitrary RNG; the component just doesn't take advantage of it. Adding a note or thin wrapper here preserves the option for seeded daily puzzles (same layout for all players on a given day) without requiring a component rewrite.

**Files involved:** `src/components/trials/games/Lockpicking.tsx` line 191 — no code change required; add a comment explaining the RNG parameter exists. If daily seeding is pursued, add a `useDailySeed()` utility in `src/lib/` that hashes today's ISO date to a seeded PRNG.

---

### 5.2 Cap Passive Proximity Reads in the RAF Loop

**What:** If passive proximity feedback (improvement 1.2) is added, ensure that `allowedTurn()` during the idle phase is only computed once per RAF frame and not duplicated across multiple render-path calls.

**Why:** The RAF loop already calls `allowedTurn` in the turning branch. Adding it to the idle branch is fine performance-wise (it's trivial math), but the value should be stored in a local variable and reused rather than computed twice in the same frame.

**Files involved:** `src/components/trials/games/Lockpicking.tsx` — minor refactor of the idle/turning branch to hoist the `allowedTurn()` call above the `torqueHeldRef` check.

---

### 5.3 Extract `LOCK_LABELS` and Flash Timings to Constants

**What:** The `LOCK_LABELS = ['Novice', 'Apprentice', 'Adept']` array and the flash durations (`750`, `550` ms in the phase-transition `useEffect`) are magic values embedded in the component. Move `LOCK_LABELS` to `lockpicking.ts` (it belongs with `NUM_LOCKS`) and promote the flash durations to named constants in the same file or at the top of `Lockpicking.tsx`.

**Why:** If the number or labels of locks ever changes, the component currently has to be edited in multiple unrelated spots. Keeping them with the engine constants makes that change atomic.

**Files involved:** `src/engine/trials/lockpicking.ts`, `src/components/trials/games/Lockpicking.tsx`.

---

### 5.4 Guard the `doneRef` Early-Exit More Defensively

**What:** `finish()` is called from two code paths — the opening-phase completion and the zero-picks break path. Both paths check `doneRef.current` before proceeding (the `useCallback` guard). However, there is a small window in which a `'breaking'` frame could theoretically call `finish()` while an `'opening'` frame hasn't yet updated `doneRef` because the RAF callbacks share a frame. Add an explicit `phaseRef.current === 'done'` guard at the top of the RAF loop body as a secondary gate.

**Why:** The current code has `if (phaseRef.current === 'done') return;` at the start of `loop()`, which is the right guard, but it relies on `phaseRef` being updated synchronously inside the loop (it is — `phaseRef.current = 'done'` is set in `finish()`). This is safe as written but fragile to future refactors. The existing pattern is fine; document it with a one-line comment.

**Files involved:** `src/components/trials/games/Lockpicking.tsx` — add a brief inline comment near the `doneRef` guard in `finish()`.

---

## 6. Integration with the Larger Game

### 6.1 Make Lockpick Gloves Actually Affect the Trial

**What:** The `lockpick_gloves` gear item (`src/content/gear.ts`) grants `+5 DX`. Since DX now affects trial difficulty (improvement 1.3), the gloves will passively make lockpicking easier when equipped. No additional work is needed if 1.3 is implemented — but add a tooltip note to the gloves description: "Easier lockpicking." to make the connection visible to the player.

**Why:** Currently the gloves provide an abstract +5 DX with no named use case. Calling out lockpicking in the description creates a tangible reward loop: forge the gloves → equip them → have more room for error in the trial.

**Files involved:** `src/content/gear.ts` — update `lockpick_gloves.description`.

---

### 6.2 Show DX Stat Level on the Trial Intro Screen

**What:** In `TrialModal.tsx`, the Long March trial already shows an Endurance level bonus tooltip on the intro screen (lines 120–131). Add a similar contextual note to the lockpicking intro showing how the character's DX level widens the sweet spot, so players understand the connection before playing.

**Why:** The Long March precedent shows this pattern is already established. The lockpicking trial is the one other case where a stat level directly affects difficulty, so it warrants the same treatment.

**Files involved:** `src/components/trials/TrialModal.tsx` — add a conditional block in the `'intro'` stage for `trialId === 'lockpicking'` that reads `character.statLevels.DX` and shows the computed bonus.

---

### 6.3 Add a "Picks Saved" Stat to the Result Screen

**What:** After a successful run, show "Picks saved: N" on the result screen alongside the score, to reinforce what efficient play looks like.

**Why:** The current result screen shows only score percentage and stars. Players don't intuitively know that pick efficiency is the scoring axis. Naming the metric teaches it.

**Files involved:** `src/components/trials/TrialModal.tsx` — the `handleFinish` callback currently only receives a `score`. To show picks saved, `Lockpicking.tsx` would need to pass this as a separate value — either change the `onFinish` signature to `(score: number, meta?: { picksUsed?: number })` or derive it from the score (less clean). The cleaner path is to extend `onFinish`.

---

## 7. Suggested Implementation Order

Group changes by effort and independence so each step ships a complete, playable improvement.

### Step 1 — Quick wins (1–2 hours, zero gameplay risk)
1. Fix the CSS comment typo (`src/index.css:381`).
2. Increase mobile button size from `h-11 w-11` → `h-12 w-12`.
3. Add `key={hint}` to the hint span + `@keyframes hint-pop` animation.
4. Show "Lock N of 3" label beneath the progress row.
5. Reset pick position to 90° on lock advance.

### Step 2 — Audio (2–4 hours, self-contained)
6. Wire scrape, click, and snap SFX in `Lockpicking.tsx`. Can be done independently of all other changes — no engine or store modifications.

### Step 3 — Feedback polish (2–3 hours)
7. Smooth `warmthGlowColor()` to continuous interpolation.
8. Add passive proximity glow during idle phase (faint ambient cylinder glow when `allowedTurn > 0`).
9. Add pick-stress visual (lean + color shift as jam timer fills).

### Step 4 — Core mechanics (3–5 hours, requires test updates)
10. Wire DX stat level into `lockTolerance()` — add parameter, update constants, update `Lockpicking.tsx` store selector, update tests.
11. Tune break-time floor per lock (per-lock `BREAK_TIME_MIN` tuple).
12. Revise score formula; update tests.

### Step 5 — Larger-game integration (1–2 hours)
13. Update `lockpick_gloves` description.
14. Add DX level tooltip to the lockpicking trial intro screen (matching Long March pattern).
15. Extend `onFinish` to carry picks-used metadata; add "Picks saved" to result screen.

### Step 6 — Post-failure reveal and arc markers (2–3 hours)
16. Sweet spot reveal on failure — shows where to aim, teaches the mechanic.
17. Tick marks or arc segments on the lock plate for positional reference.

### Step 7 — Visual celebration (1–2 hours)
18. Gold glow burst on lock-open (plate-level animation).
19. Document the RNG interface and note where a daily-seed hook would plug in.

---

**Total estimated effort: ~15–22 hours of focused implementation.** Steps 1–3 alone would make the minigame feel substantially more polished. Steps 4–5 make it feel meaningfully integrated with the RPG layer. Steps 6–7 are the final coat of paint.
