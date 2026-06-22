# Rooftop Chase — Improvement Plan

*Based on `docs/rooftop-chase-minigame-analysis2.md`. References are to production files.*

---

## 1. Highest-Priority Improvements

These are the changes with the highest impact-to-effort ratio. They address the most noticeable gaps in feel, fairness, and usability.

---

### 1A. Fix the slide reward — it's nearly meaningless

**What:** Raise `SLIDE_LEAD_GAIN` from 1 to 4–6 (exact value needs playtest). Optionally add a narrow "precision slide" timing window that awards a larger bonus (e.g., +8) when the player slides with less than half the banner's width still ahead of them.

**Why:** +1 lead against a 4.5/s passive drain is functionally invisible. The slide action has a real cost (the player must commit to it grounded, blocking a jump) but no meaningful reward. This makes lowbar obstacles feel like "don't fail here" rather than "skillfully engage with this." Every other player action — dash (+16), stomp (+9), even just surviving — feels more impactful.

**Files:** `src/engine/trials/rooftopChase.ts` — change `SLIDE_LEAD_GAIN`. If a precision window is added, extend `resolveContact()` to return a richer result type (`'clear-precision'`) and handle it in `stepChase`'s lowbar branch.

---

### 1B. Add an in-game restart button

**What:** When `state.done` is true, show a "Run Again" button inside the component (not requiring the modal to be closed and re-opened). The button should call `useChaseLoop`'s reset path — either reinitializing the hook state or, simpler, unmounting and remounting the component.

**Why:** Currently the only way to retry is to close the TrialModal and re-open it. For a minigame where a run can end in under 10 seconds from a mistimed jump, this friction actively discourages practice. A restart button is standard for every runner-style game in the genre.

**Files:** `src/components/trials/games/RooftopChase.tsx` — render a button in the `state.done` overlay. `src/hooks/useChaseLoop.ts` — expose a `reset()` callback, or wrap the hook state in a `key` prop on the parent. `src/components/trials/TrialModal.tsx` — note that `onFinish` is called once; a restart should not re-call it or re-award the trial reward (the daily gate must still apply).

---

### 1C. Give mook jumps a small reward

**What:** Award +2–3 lead when the hero jumps cleanly over a mook (airborne clear, not a stomp). This is a `'clear'` result from `resolveContact()` when `prop.kind === 'mook'` and the hero is not grounded.

**Why:** Currently, jumping over a mook is a zero-sum interaction — the player spends a jump and gets nothing back. This makes mooks feel identical to hazards (spikes), except hazards at least punish you more symmetrically. A small jump-clear reward differentiates mooks as "jump for free marginal lead, stomp for big lead," giving the stomp decision real strategic texture.

**Files:** `src/engine/trials/rooftopChase.ts` — in `stepChase`'s collision block (around line 880), detect `result === 'clear' && prop.kind === 'mook'` and apply a `MOOK_JUMP_LEAD_GAIN` constant. Consider a matching `justJumpedMook` one-frame flag for feedback. `src/components/trials/games/RooftopChase.tsx` — small "CLEAR!" text flash using that flag.

---

### 1D. Add an in-viewport dash cooldown indicator

**What:** Inside the play area, render a small arc or radial fill around the hero (or a pip row below the speed readout) that shows the dash cooldown draining in real time. This should be visible without looking away from the action.

**Why:** The only existing cooldown indicator is the wipe overlay on the off-screen Dash button. A player focused on the action cannot see it. Dash timing is the most impactful recovery decision in the game; the player needs to know when it becomes available again without breaking their focus on obstacles.

**Files:** `src/components/trials/games/RooftopChase.tsx` — derive `dashCooldownFrac` (already computed as `state.dashCooldownMs / DASH_COOLDOWN_MS`) and render a radial CSS clip or a small arc positioned at `HERO_X_PX`.

---

## 2. Gameplay and Mechanics Improvements

---

### 2A. Ramp obstacle density in the second half

**What:** In `generateCourse()`, increase the prop spawn probability and/or tighten gap widths as building index increases. For example: buildings 0–9 at 50% prop chance, buildings 10–19 at 65%, buildings 20–29 at 80%. Alternatively, widen the gap range in the second half by raising the upper bound from 12 wu toward 14 wu.

**Why:** Currently the only difficulty escalation beyond building 0 is the scrolling speed ramp. The course difficulty is statistically flat — the same prop density from building 1 to building 29. A player who survives to building 20 faces the same obstacle cadence as one who just started building 2, just faster. A density ramp makes the second half feel genuinely harder, not just quicker.

**Files:** `src/engine/trials/rooftopChase.ts` — `generateCourse()` (line 219). The building index `i` is available in the loop; key the prop chance and gap ceiling to `i / BUILDING_COUNT`.

---

### 2B. Make surges cost real lead in the late game

**What:** After distance 400 wu, reduce `SURGE_VISUAL_OFFSET` and introduce a small real lead drain on surge (e.g., −2 to −4). Before 400 wu, keep surges purely theatrical. This is a one-constant change with a distance threshold guard.

**Why:** Once a player understands surges are zero-impact, the tension evaporates. The drama is wasted on experienced players. A late-game surge that has real consequence rewards those who study the system while still being learner-friendly in the opening half.

**Files:** `src/engine/trials/rooftopChase.ts` — in the surge block of `stepChase` (~line 929), add `if (newDist > SURGE_REAL_DRAIN_START) newLead -= SURGE_REAL_DRAIN`. Export the threshold as a tunable constant.

---

### 2C. Introduce a second mook subtype — the Crossbowman

**What:** Add a new `PropKind`: `'crossbowman'`. A crossbowman cannot be stomped (he's prone behind cover) and cannot simply be jumped over. The player must slide past him. This creates a second obstacle requiring slide, but distinguishable from the lowbar by visual form.

**Why:** Currently slide only counters lowbars, which hang at head height. A second slide-required obstacle type makes the slide verb feel like a genuine skill rather than a single-use workaround. It also breaks the simple mental model of "hazard = jump, mook = stomp, lowbar = slide" to create occasional judgment calls.

**Files:** `src/engine/trials/rooftopChase.ts` — add `'crossbowman'` to `PropKind`, update `resolveContact()` to treat it like `'lowbar'` (slide to clear, stumble otherwise), update `generateCourse()` to include it in the prop distribution. `src/components/trials/games/RooftopChase.tsx` — add `CrossbowmanSprite` sub-component.

---

### 2D. Add a brief "near-fall" ledge-catch visual

**What:** When the hero triggers the ledge-catch path (`lipCatch` in `stepChase`, line 781), set a new one-frame flag `justLedgeCaught`. In the renderer, show a brief screen shake or a "GRAB!" text flash.

**Why:** Ledge-catches happen frequently on tight gaps and currently produce no feedback. The player doesn't know whether they landed cleanly or barely made it. Surfacing this moment rewards players who consciously push their jump timing and makes near-misses feel dramatic rather than invisible.

**Files:** `src/engine/trials/rooftopChase.ts` — add `justLedgeCaught: boolean` to `ChaseState`; set it in the landing block. `src/components/trials/games/RooftopChase.tsx` — small flash text or screen-edge glow triggered by the flag.

---

## 3. Controls, UI, and Player Feedback Improvements

---

### 3A. Communicate the grace period

**What:** Change the pre-chaser "Keep running…" progress bar label to something that contextualizes the safe window: e.g., "Safety window — {n}m remaining" or "Beast is still far away…". Add a brief instructional overlay on the first second of the run (fade-in/fade-out) listing the three controls.

**Why:** New players don't know the opening 120 wu is a safe zone. They may spend it anxiously rather than learning the movement system. Surfacing this — even implicitly — lets them treat the opening as a practice corridor.

**Files:** `src/components/trials/games/RooftopChase.tsx` — update the pre-chaser bar's `<p>` label and add a timed overlay state (e.g., `showOpeningTip` fades after 3 s using `useEffect`).

---

### 3B. Clearer result screen

**What:** When `state.done` is true, show a result card inside the play area (or below it) that distinguishes the three outcomes: **"Escaped!"** (score = 1.0), **"Caught!"** (lead = 0), **"Fell!"** (gap death). Include the distance reached, star rating, and the restart button (from 1B). The current state shows only "CAUGHT! 🐺" — falls show nothing, and wins are not distinguished.

**Why:** Players need closure on what happened and why. Falls and catches feel identical in outcome but are mechanically different failures. Seeing "Fell at 312 m — try for 3★ at 450 m" is far more motivating than a modal that just closes.

**Files:** `src/components/trials/games/RooftopChase.tsx` — replace the single "CAUGHT!" overlay with a conditional that branches on `state.justFell`, `state.lead <= 0`, and `state.score >= 1`. Add distance, star count, and restart button.

---

### 3C. Telegraph upcoming building height changes

**What:** When the next visible building is at a different `roofY` than the current one, tint its leading edge lightly (warm orange for up, cool blue for down) or show a small arrow above the hero's path. This should be a renderer-only change — the data is already in `state.buildings` and `state.distance`.

**Why:** At high scroll speeds (8–10 wu/s), an unexpected elevation step gives the player very little time to adjust their jump arc. A visual cue one building ahead reduces cheap deaths from height changes and moves the difficulty from "surprised by geometry" to "correctly reading the course."

**Files:** `src/components/trials/games/RooftopChase.tsx` — in `BuildingView` or the main render body, compare `building.roofY` to the previous building's `roofY` and conditionally apply a border tint or a small icon above the gap.

---

### 3D. Show stomp chain count more prominently

**What:** When `stompChain >= 2`, replace the in-viewport "STOMP x{n}!" text with a larger, animated label. Make the chain count visible for longer (extend `stompFlashMs` proportional to chain depth, e.g., base 500 ms + 200 ms per chain count).

**Why:** The chain-stomp bonus is one of the most satisfying high-skill interactions, but the feedback is a small `text-xs` label that disappears quickly. Players attempting a stomp chain deserve a more emphatic payoff. Making the chain count visually impressive also teaches players the system exists.

**Files:** `src/components/trials/games/RooftopChase.tsx` — update the stomp flash div (line 844); scale font size with `stompChain`. `src/engine/trials/rooftopChase.ts` — optionally extend `stompFlashMs` initialization in `stepChase` based on `stompChain`.

---

### 3E. Add swipe-down gesture for slide on touch devices

**What:** In `useChaseLoop`'s `useEffect` keyboard handler, also attach `touchstart` / `touchend` event listeners. A swipe-down gesture (touch Y delta > 30 px downward in < 200 ms) triggers `slide()`. Tap triggers `jump()`.

**Why:** The on-screen Slide button exists but requires a deliberate button press while also managing jump timing. On mobile, swipe-down is a natural "duck" gesture. The current click-anywhere-to-jump already acknowledges touch as a primary input; slide deserves an equally natural touch gesture.

**Files:** `src/hooks/useChaseLoop.ts` — add `touchstart`/`touchend` listeners alongside the existing `keydown` listener.

---

## 4. Visual and Audio Polish

---

### 4A. Slide action needs a visual payoff

**What:** When `activeSlideFinal` is true and the hero clears a lowbar (`result === 'clear'`), spawn a dust burst (wider than the landing puff) and add a brief "slide streak" — a low horizontal line trailing behind the hero. Currently clearing a banner produces no visual feedback.

**Why:** The slide is the only action in the game with zero visual payoff on success. Jumps produce dust on landing. Stomps produce a flash. Dashes produce speed lines. A slide clear deserves equivalent juice to make the action feel rewarding rather than empty.

**Files:** `src/engine/trials/rooftopChase.ts` — the `justSlideClear` flag concept (or reuse `justLanded` path for dust). `src/components/trials/games/RooftopChase.tsx` — spawn a wider horizontal dust puff on slide clear; add a brief low-horizon streak in the existing streak system when `activeSlideFinal` is true.

---

### 4B. Animate the mook jump-clear

**What:** When the hero jumps over a mook cleanly (the new `justJumpedMook` flag from improvement 1C), play a small "dodge" particle (a few sparks or a shield flash over the mook's head) and a short audio cue (lighter than a stomp — a whoosh).

**Why:** If a jump-clear earns lead (improvement 1C), it needs commensurate feedback so the player understands what happened. Without feedback, the reward would be invisible and the interaction would feel random.

**Files:** `src/components/trials/games/RooftopChase.tsx` — small particle over the mook's screen position on `justJumpedMook`. `src/lib/sfx.ts` — a `'dodge'` or `'swipe'` cue (synthesized, light).

---

### 4C. Animate the chaser's "caught" pounce

**What:** When `state.done && state.lead <= 0`, instead of just a "CAUGHT! 🐺" text overlay, move the ChaserSprite to overlap the hero's position with a brief lunge animation (translate right, scale up) over 400 ms before the text fades in. The physics for this is purely visual — `chaserXPx` is already computed from the world position.

**Why:** The "caught" ending is dramatic but currently shows only a text label. A chaser that visibly lunges onto the hero is far more viscerally satisfying (and alarming). This is a renderer-only change; no engine work needed.

**Files:** `src/components/trials/games/RooftopChase.tsx` — on `state.done && lead <= 0`, CSS-animate the ChaserSprite div's `left` to `HERO_X_PX` over ~400 ms. A CSS keyframe (`rooftop-pounce`) in `src/index.css`.

---

### 4D. Activate the unused cloud layer

**What:** The `rooftop-cloud` keyframe is defined in `src/index.css:482` but no cloud elements exist in the renderer. Add 2–3 semi-transparent cloud divs drifting slowly across the mid-sky. These can be simple rounded rectangles; they should scroll at a rate between the far castle (6%) and mid buildings (22%).

**Why:** The sky is currently static except for the moon. A drifting cloud layer adds depth and life to the background without any gameplay impact. The keyframe is already written — this is just rendering it.

**Files:** `src/components/trials/games/RooftopChase.tsx` — add a cloud layer div (positioned in the sky band, `top: 20–80px`) with 2–3 cloud divs using `rooftop-cloud` animation at staggered delays and durations.

---

### 4E. Differentiate the "win" audio

**What:** Add a triumphant riff or fanfare after `sfx.play('win')` — distinct from the generic win cue. If a per-minigame win sound is impractical in `sfx.ts`, a short ascending arpeggio synthesized inline in `useChaseAudio` on `state.done && state.score >= 1` would suffice.

**Why:** Completing a full 600 wu run is a significant achievement. The current `win` cue is shared across trials. A unique chase-specific fanfare makes the accomplishment feel earned and distinct.

**Files:** `src/hooks/useChaseAudio.ts` — on the win condition, play an additional `sfx` call or synthesize a short arpeggiated tone chain. `src/lib/sfx.ts` — add `'chaseWin'` if a dedicated cue is preferred.

---

## 5. Technical / Code Improvements

---

### 5A. Replace `Math.random` with a seeded RNG

**What:** Change `useChaseLoop.ts:38` from `initChase(Math.random)` to `initChase(seededRng(Date.now()))` where `seededRng` is a simple LCG already used in the test suite (`rooftopChase.test.ts:41`). Store the seed in the hook's state ref and expose it (e.g., log it, or pass it to the result screen) so a problematic run can be reproduced.

**Why:** `Math.random` cannot be replayed. If a player reports "I fell on what should have been a safe building," the course cannot be reproduced for debugging. A seeded RNG costs nothing at runtime and is a strict improvement. The test infrastructure already has a `seededRng` helper — it just needs to be promoted to `src/engine/trials/rooftopChase.ts` or a shared utility.

**Files:** `src/hooks/useChaseLoop.ts` — replace `Math.random` with `seededRng(Date.now())`. Extract `seededRng` from `rooftopChase.test.ts` into `src/engine/trials/rooftopChase.ts` or `src/lib/rng.ts`.

---

### 5B. Document and guard the `HERO_HITBOX_W` renderer dependency

**What:** The renderer currently imports `HERO_HITBOX_W` and immediately voids it (`void _HERO_HITBOX_W`) with a comment that it's "imported to keep the renderer and engine in sync." But the actual pixel offset (`HERO_X_PX - 3`) is a manually tuned magic number. Replace the magic `3` with a derived constant: `const HERO_SPRITE_X = HERO_X_PX - Math.round((HERO_SPRITE_W - HERO_HITBOX_W * PX_PER_WU) / 2)` and add a comment explaining the alignment arithmetic.

**Why:** If `HERO_HITBOX_W` is changed in the engine, the renderer will silently misalign the sprite with the hitbox until someone notices artifacts during play. Making the pixel offset a derived constant catches this automatically and removes the need for the `void` hack.

**Files:** `src/components/trials/games/RooftopChase.tsx` — lines 798–802. Replace `HERO_X_PX - 3` with a derived constant; remove the `void _HERO_HITBOX_W` line.

---

### 5C. Strengthen chain-stomp integration tests

**What:** The existing test for chain-stomp (`rooftopChase.test.ts:494–527`) tests the counter type and reset semantics but notes that a "full integration via a crafted mid-air stomp sequence is complex." Build a controlled two-building course with a mook at a known position and step the simulation through a jump → stomp → land sequence to verify `stompChain` increments and resets correctly, and that `newLead` includes the chain bonus.

**Why:** The chain-stomp logic (lines 904–927 in `stepChase`) involves an interaction between `justStomped`, `state.stompChain`, `chainBonus`, and `justLanded`. The current tests validate each piece in isolation but not the interaction. A regression in the chain reset would be invisible until a player noticed broken chain bonuses.

**Files:** `src/engine/__tests__/rooftopChase.test.ts` — add a new `describe('stepChase — chain-stomp integration')` block with a controlled course and a full stomp-chain sequence.

---

### 5D. Promote `PropKind` to support extension

**What:** `PropKind` is currently a union of three string literals (`'hazard' | 'mook' | 'lowbar'`). `resolveContact()` uses an explicit `if/else` chain. Before adding new prop types (improvement 2C), refactor `resolveContact()` to use a lookup table or strategy map keyed by `PropKind`, so adding a new kind requires only a new entry rather than an `else if` branch. Add a compile-time exhaustiveness check.

**Why:** Adding a fourth or fifth prop type inside the current `resolveContact` structure requires reading and modifying the same branching logic each time, risking regressions to existing kinds. A lookup map makes extension safe and the logic readable at a glance.

**Files:** `src/engine/trials/rooftopChase.ts` — `resolveContact()` (line 493). Refactor to a `Record<PropKind, (args) => ContactResult>` lookup. Add a `satisfies` or exhaustive switch so TypeScript errors on missing entries.

---

### 5E. Extract the parallax art data to a `const` module

**What:** `CASTLE_TOWERS`, `MID_BUILDINGS`, and `CHIMNEYS` are large `ReadonlyArray` literals defined at the top of `RooftopChase.tsx` (lines 68–101). They have nothing to do with game logic or React and make the component file harder to read. Move them to `src/lib/minigameArt.ts` or a new `src/content/rooftopArt.ts`.

**Why:** `RooftopChase.tsx` is 979 lines. The art data arrays account for ~35 lines of noise in what should be a renderer component. Separating them improves readability and makes the art data easier to iterate on without navigating past component logic.

**Files:** Create `src/content/rooftopArt.ts`; move the three arrays. Update `RooftopChase.tsx` import.

---

## 6. Integration with the Larger Game

---

### 6A. Verify and tune the reward curve

**What:** Read `store.completeTrial` and the `trialReward` function to understand how the AG reward scales with the 0–1 score. Check whether the median expected score (roughly 40–60% for a new player) produces a meaningful reward, and whether 3★ (75%, 450 wu) is achievable within a reasonable number of daily attempts.

**Why:** The analysis notes this is an unknown. If the reward curve is flat or front-loaded, players have little incentive to improve beyond a bare pass. If it's back-loaded (most reward only near a perfect score), new players are underrewarded for genuine progress.

**Files:** `src/store/useGameStore.ts` — `completeTrial` action. Adjust the reward formula or the star thresholds if needed.

---

### 6B. Show AG stat impact on the trial card

**What:** On the trial hub card for Rooftop Chase, display the player's current AG stat level alongside the best score. Optionally, show a tooltip explaining that AG governs movement speed and evasion in other parts of the game.

**Why:** Players who understand that a high AG score feeds into character progression are more motivated to replay the trial and improve. Currently the stat connection is implicit; making it visible creates a reward loop that bridges the minigame and the larger RPG.

**Files:** `src/views/TrialsView.tsx` — the trial card component. Pull `character.statLevels.AG` from the store selector.

---

### 6C. Add a daily countdown on the trial card after completion

**What:** After the player completes the Rooftop Chase trial for the day, replace the "Play" button with a disabled state showing "Next run in: {hours}h {minutes}m" (derived from `trialsClearedOn` + 24 h vs. `Date.now()`).

**Why:** Currently a completed trial shows a generic locked state with no countdown. Players who want to plan their daily session around the trial reset have no information about when it becomes available.

**Files:** `src/views/TrialsView.tsx` or the trial card component. Derive the countdown from `trialsClearedOn[trialId]`.

---

## 7. Suggested Implementation Order

Organized into four phases by risk and dependency. Each phase can be shipped independently.

---

### Phase A — Quick wins (low risk, high visibility)
*Estimated scope: 1–2 sessions.*

1. **1A** — Raise `SLIDE_LEAD_GAIN` to 5 and playtest. One-line constant change; fast to tune.
2. **1C** — Add mook jump-clear lead gain and `justJumpedMook` flag. Extends `resolveContact()` with one new return path.
3. **1D** — Add in-viewport dash cooldown indicator. Renderer-only change, no engine touch.
4. **3A** — Improve pre-chaser bar label and add brief opening tip overlay. Text and simple timed state only.

---

### Phase B — Feedback and result quality (medium effort, high impact on retention)
*Estimated scope: 1–2 sessions.*

5. **1B** — Add in-game restart button. Requires deciding mount/unmount strategy; touch `TrialModal.tsx` for daily gate interaction.
6. **3B** — Build a proper result screen with outcome labels, distance, and star count.
7. **3D** — Improve stomp chain feedback (larger text, longer flash duration).
8. **4A** — Add slide visual payoff (dust burst + low streak on banner clear).

---

### Phase C — Depth and difficulty (engine changes, needs testing)
*Estimated scope: 2–3 sessions.*

9. **2A** — Ramp obstacle density per building index in `generateCourse()`.
10. **2B** — Add late-game surge real lead drain with distance threshold guard.
11. **2D** — Add ledge-catch `justLedgeCaught` flag and visual flash.
12. **3C** — Height-change telegraph in `BuildingView` (renderer-only, uses existing building data).
13. **5C** — Write chain-stomp integration tests before the next engine change.

---

### Phase D — Polish and code health (low urgency, high long-term value)
*Estimated scope: 1–2 sessions.*

14. **5A** — Replace `Math.random` with seeded RNG; expose seed on result screen for debugging.
15. **5B** — Fix the `HERO_HITBOX_W` voided-import and derive the sprite offset constant.
16. **5D** — Refactor `resolveContact()` to the lookup-table pattern before adding new prop types.
17. **5E** — Extract parallax art data to `src/content/rooftopArt.ts`.
18. **4D** — Activate the cloud layer (the keyframe is already written).

---

### Phase E — Content expansion and integration (requires Phase D foundations)
*Estimated scope: 2–3 sessions.*

19. **2C** — Add the `'crossbowman'` prop type using the refactored `resolveContact()` from 5D.
20. **4C** — Animate the chaser pounce on "caught" ending.
21. **4E** — Add a distinct chase-win audio fanfare.
22. **4B** — Animate the mook jump-clear with a dodge particle.
23. **3E** — Touch swipe-down for slide on mobile.
24. **6A** — Audit and tune the reward curve.
25. **6B / 6C** — Add AG stat display and daily countdown to the trial card.

---

### Items to defer or skip

- **Full course redesign / hand-authored layouts:** The procedural generator produces varied, fair courses. Authoring fixed layouts (like Arena does) would be significant effort for marginal gain in a run-based game where variety is a feature.
- **Canvas or WebGL rendering:** The CSS-div renderer is performant at 60 fps and easy to modify. No evidence of performance problems.
- **Networked leaderboards / multiplayer:** Out of scope for a daily solo trial.
