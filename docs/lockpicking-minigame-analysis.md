# Lockpicking Minigame — Analysis

## 1. Basic Summary

Lockpicking is a daily Skill Trial tied to the **DX (Dexterity)** stat. It is one of eight trials in the game, each playable once per calendar day, that sit outside the main dungeon/arena gameplay and reward the player with Dexterity XP and gold on completion.

The mechanic is explicitly modelled on Skyrim-style lockpicking: the player rotates a pick around a 180° arc to find a hidden sweet spot, then holds a torque button while the pick is positioned correctly. The cylinder turns proportionally to how close the pick is to the sweet spot; hold it in the right zone long enough and the cylinder reaches 90° (open). Hold against a jam too long and the pick snaps. The player must open three locks of rising difficulty — Novice, Apprentice, Adept — using a budget of six picks.

It fits into the larger game as a lightweight skill-expression minigame that breaks up the habit-logging loop and grants meaningful stat XP without requiring dungeon energy.

---

## 2. Core Game Loop

**Start:** The player opens the Trials view, selects the Lockpicking trial (🔑), reads the intro description in `TrialModal`, and presses "Begin Trial." At that point `generateLocks(Math.random, level)` is called, producing three `LockConfig` objects with randomised sweet spots — one for each lock.

**Core per-lock cycle:**
1. The player rotates the pick left/right across the 0–180° semicircle to search for the sweet spot (visual: pick sweeps around the lock face).
2. The player holds "Turn Lock" (torque). The cylinder eases clockwise toward `allowedTurn * 90°`. The glow on the cylinder shifts from red → orange → amber → yellow-green → green based on `allowedTurn`.
3. **If in the open zone** (`canOpen = true`) and the cylinder reaches 90°, the lock opens with a "CLICK!" flash and the next lock is advanced.
4. **If outside the open zone**, the cylinder jams at its maximum. A shake effect starts (amplitude proportional to jam severity). A `jamTimeRef` accumulates; if it exceeds `breakTime(pickDeg, lock)` (0.55–3.5 seconds), the pick snaps ("SNAP!" flash), one pick is consumed, and the player resets to idle on the same lock.

**End conditions:**
- All 3 locks opened → success; `onFinish` is called with a score ∈ [0.5, 1.0].
- Last pick snapped → failure; `onFinish` is called with a score ∈ [0, 0.3].

**Rewards (via `TrialModal → completeTrial`):** DX stat XP + gold, scaled by score and character level. The trial is gated to one attempt per calendar day (`trialsClearedOn`). A personal-best score is tracked (`bestTrialScore`).

---

## 3. Player Controls and Interaction

### Input Controls

| Action | Keyboard | Pointer | On-screen button |
|---|---|---|---|
| Rotate pick left | `A` / `←` | Mouse move left (aims pick) | ◀ button |
| Rotate pick right | `D` / `→` | Mouse move right (aims pick) | ▶ button |
| Apply torque | `Space` / `↑` (hold) | Left mouse button (hold) | "Turn Lock" button (hold) |

Keyboard moves the pick at `PICK_KEY_SPEED = 90°/sec`. Mouse/pointer directly maps cursor angle to pick angle via `pointerToDeg()`. All pointer events use `setPointerCapture` so drag doesn't escape the lock area.

### UI Elements

- **Lock progress row** (top): three slots labeled Novice / Apprentice / Adept. Active lock shows 🔑, opened locks show ✓ (gold), failed lock shows ✗ (rose).
- **Pick count** (below progress row): six 🗝️ icons, dimmed as picks are used.
- **Lock visual** (center): a 200×200 circular lock plate with an 88px inner cylinder that rotates. The pick sweeps around the center.
- **Hint text** (below lock): short contextual messages when torquing.
- **Instruction line**: "Move pick to search · Hold 'Turn Lock' to apply torque" or "Holding torque… watch the glow."
- **On-screen control buttons** (bottom): ◀, "Turn Lock", ▶ (hidden when done).
- **Key legend** (very bottom): tiny text reminding of keyboard bindings.

### Feedback Given to the Player

- **Glow**: cylinder emits a colored box-shadow when torquing, interpolated across five bands (red → green) based on `allowedTurn`. Glow radius also expands (8–26px).
- **Shake**: lock plate translates randomly while jamming; amplitude = `8 * (1 - turn)^0.7` — more violent when further from sweet spot.
- **Flash overlays**: "CLICK!" in emerald pops and fades on unlock (750ms, `lock-open` keyframe). "SNAP!" in rose fires on break (550ms, `lock-snap` keyframe). The whole plate also plays `lock-break` (a violent 0.45s jolt animation) on snap.
- **Pick visual**: the pick turns rose-coloured and shortens to 55% of its length when broken (shows for the 550ms flash window).
- **Hint text** (only when torquing):
  - `'Almost there!'` when `turn > 0.9` and not yet jamming
  - `'Getting warmer…'` when jamming and `turn > 0.65`
  - `'Keep looking…'` when jamming and `turn > 0.3`
  - `'Wrong angle'` when jamming and `turn ≤ 0.3`
  - `'Pick snapped!'` immediately after a break
- **Pick lean**: when turning, the pick visually leans slightly against the cylinder rotation (`cssRot += -cylinderDeg * 0.08`), giving a sense of mechanical stress.

---

## 4. Mechanics and Systems

### Scoring (`engine/trials/lockpicking.ts:lockpickingScore`)

- **Success (all 3 locks opened):** `0.5 + 0.5 * max(0, picksRemaining - 1) / (PICK_BUDGET - 1)`. Score range is [0.5, 1.0]. Using all 6 picks perfectly → 1.0. Opening all 3 locks with only 1 pick remaining → 0.5.
- **Failure (out of picks mid-run):** `0.3 * (locksOpened / 3)`. Score range is [0, 0.3]. One lock opened → ~0.1. Zero locks → 0.

Score maps to stars in `scoreToStars()` (defined in `trials.ts`): presumably <0.4 → 1★, <0.7 → 2★, ≥0.7 → 3★ (exact thresholds should be confirmed in `trials.ts:scoreToStars`).

### The Pick and Sweet Spot

- The pick rotates over `PICK_MIN_DEG = 0` to `PICK_MAX_DEG = 180` degrees.
- Each `LockConfig` has a hidden `sweetSpotDeg` placed in `[20, 160]` (20° margin from edges).
- Two tolerance zones per lock:
  - **Turn zone** (`toleranceDeg`): pick within this range can turn the cylinder at all.
  - **Open zone** (`openToleranceDeg`): pick within this tighter range can fully open the lock.

### Per-Lock Difficulty Progression

| Lock | Base toleranceDeg | Base openToleranceDeg |
|---|---|---|
| 0 — Novice | 22° | 7° |
| 1 — Apprentice | 16° | 5° |
| 2 — Adept | 11° | 3.5° |

### Character Level Scaling

`lockTolerance(lockIndex, level)` widens both zones per level:
- `toleranceDeg += (level - 1) * 0.6`
- `openToleranceDeg += (level - 1) * 0.2`

This makes the sweet spots easier to hit at higher character levels.

**DX stat level does not currently affect the minigame** — only `character.level` is used.

### Cylinder Mechanics

- `allowedTurn(pickDeg, lock)` → 0..1: 1.0 inside open zone, linear falloff to 0 at tolerance edge.
- `targetCylinder = allowedTurn * CYLINDER_OPEN_DEG (90°)`. The cylinder eases toward targetCylinder at `CYLINDER_TURN_SPEED = 180°/sec` (forward) or `CYLINDER_RETURN_SPEED = 240°/sec` (spring back when torque released). Return speed on break is 2.5× normal.

### Break Timer

`breakTime(pickDeg, lock)` maps `allowedTurn` to seconds: `BREAK_TIME_MIN + turn * (BREAK_TIME_MAX - BREAK_TIME_MIN)`. Range: 0.55s (max distance) to 3.5s (edge of open zone). At dead center / open zone you can never break (the lock opens before the timer expires, since torquing at turn=1 drives cylinder to 90° in ≤0.5s).

### Obstacles and Randomization

No enemies or external hazards. The only obstacle is the hidden sweet spot placement and the narrow open zone on harder locks. Sweet spots are randomly placed via `Math.random` (unseeded) on each session start.

### Win / Loss Conditions

- **Win**: `locksOpened >= NUM_LOCKS (3)` — triggered in the RAF loop when the cylinder reaches 90° on the final lock.
- **Loss**: `picksRemaining <= 0` after a snap — triggered in the jam branch when `jamTimeRef.current > breakTime(...)`.

---

## 5. Technical Implementation

### Files

| File | Role |
|---|---|
| `src/engine/trials/lockpicking.ts` | Pure engine: constants, types, `generateLocks`, `allowedTurn`, `canOpen`, `breakTime`, `lockpickingScore` |
| `src/components/trials/games/Lockpicking.tsx` | React component: all rendering, RAF game loop, input handling (687 lines) |
| `src/engine/trials/trials.ts` | Trial registry — defines `'lockpicking'` entry with stat, name, glyph, blurb |
| `src/components/trials/TrialModal.tsx` | Modal shell: intro → playing → result flow; routes to `<Lockpicking />` |
| `src/store/useGameStore.ts` | `completeTrial(trialId, score01)` action: daily gate, reward, best-score update |
| `src/index.css` | CSS keyframes: `lock-break`, `lock-open`, `lock-snap` |
| `src/content/gear.ts` | `lockpick_gloves` gear item (+5 DX) |
| `src/content/recipes.ts` | Recipe for lockpick_gloves |
| `src/engine/trials/__tests__/trials.test.ts` | Unit tests for all engine functions (lines 137–235) |

### State Management

The component uses a **dual state + refs** pattern common across this codebase: React state (`useState`) drives re-renders; mutable refs (`useRef`) are read directly inside the RAF loop to avoid stale closures. The refs mirror all values that the loop needs: `pickDegRef`, `cylinderDegRef`, `torqueHeldRef`, `pickKeyDirRef`, `jamTimeRef`, `phaseRef`, `currentLockRef`, `picksRemainingRef`, `locksOpenedRef`.

The `phase` state machine drives the RAF loop branches:
- `idle` — torque not held; cylinder springs back; pick can move freely.
- `turning` — torque held; cylinder drives toward `targetCylinder`; jam and open checks active.
- `breaking` — pick snapped; cylinder springs back at 2.5× speed; brief flash/animation; returns to `idle`.
- `opening` — lock opening; cylinder sweeps to 90° at 2.5× speed; on completion either advances to next lock or calls `finish()`.
- `done` — RAF loop exits; `onFinish(score)` already called.

### RAF Loop

A single `requestAnimationFrame` loop in a `useEffect` (deps: `[phase === 'done', finish]`). The loop caps `dt` at 50ms to prevent large jumps after tab blur. It dispatches on `phaseRef.current` each frame.

### Data Flow

```
generateLocks(Math.random, level)  ──► locks.current (ref, stable for session)
                                         │
RAF loop ──► reads pickDegRef, torqueHeldRef
          ──► calls allowedTurn / canOpen / breakTime
          ──► updates cylinderDegRef, jamTimeRef
          ──► calls setCylinderDeg / setShakeX / setWarmth / setPhase / setHint
                         │
React render ──► CSS transforms (cylinder rotate, plate translate)
              ──► warmthGlowColor(warmth) → box-shadow
              ──► conditional flash overlays / pick broken visual
                         │
onFinish(score) ──► TrialModal.handleFinish
                ──► completeTrial(trialId, score) ──► Zustand store
                ──► setStage('result')
```

### Save / Load Behavior

No mid-session save. On completion, `completeTrial` in `useGameStore.ts` persists:
- `trialsClearedOn['lockpicking']` = today's ISO date (daily gate)
- `bestTrialScore['lockpicking']` = max(old, new)
- Applies XP / gold reward, triggers level-up check

---

## 6. Software, Libraries, and Tools Used

| Concern | Technology |
|---|---|
| Framework | React 18 |
| Language | TypeScript |
| Build tool | Vite |
| State management | Zustand (with `persist` middleware → localStorage) |
| Styling | Tailwind CSS (custom design tokens for wood/parchment/gold palette) |
| Game loop | `requestAnimationFrame` (manual RAF inside `useEffect`) |
| Rendering | HTML divs + inline CSS transforms for lock/cylinder; SVG for keyhole and tension wrench |
| Animation | CSS `@keyframes` (lock-break, lock-open, lock-snap) defined in `src/index.css` |
| Audio | **None** — `sfxResume()` is called by TrialModal on "Begin Trial" (to unlock AudioContext) but `Lockpicking.tsx` has no SFX calls |
| Testing | Vitest |
| Third-party libs | None beyond the above |
| Asset pipeline | Vite static asset import (PNG for gear sprite only, not used in gameplay) |

---

## 7. Assets and Presentation

### Visuals — All Procedural

There are no sprite sheets or bitmap images used during play. Every visual element is constructed from HTML + CSS + SVG:

- **Lock plate** (`Lockpicking.tsx:538-548`): 200×200 circular `div`, radial gradient `#4a3a22 → #1c1208`, `4px solid` gold border, drop shadow. Shakes via inline `transform: translate(shakeX, shakeY)` and the `lock-break` CSS animation.
- **Decorative inner ring**: thin circular border at 10px inset.
- **Cylinder** (`Lockpicking.tsx:560-578`): 88×88 circular `div`, darker radial gradient, rotates via `transform: rotate(-cylinderDeg deg)`. Receives the warmth glow as `box-shadow`.
- **Keyhole** (`Keyhole` component): SVG with a filled circle + trapezoid polygon + ellipse cap — classic keyhole shape in near-black `#100a03`.
- **Tension wrench** (`TensionWrench` component): SVG L-shaped metal tool (two rects + highlight) hanging below the cylinder, rotating with it.
- **Pick** (`LockPick` component): vertical `div` stack — gradient shaft (zinc-400 → zinc-200), a small rotated tip div, an amber wood-tone grip handle at the bottom. When broken: shaft turns rose, shortens to 55%, tip/handle hidden.
- **Flash overlays**: absolutely positioned text nodes inside the cylinder div. "CLICK!" (`text-emerald-300`, green glow) and "SNAP!" (`text-rose-400`, red glow), each running a CSS keyframe animation.

### Warmth Glow System

Five discrete color bands interpolated by `warmthGlowColor(warmth)`:
- 0.95+ → `rgba(74,222,128,0.95)` (green)
- 0.70+ → `rgba(163,230,53,0.8)` (yellow-green)
- 0.45+ → `rgba(234,179,8,0.75)` (amber)
- 0.20+ → `rgba(251,146,60,0.65)` (orange)
- below → `rgba(239,68,68,0.5)` (red)

Glow radius also expands: `8 + warmth * 18` pixels.

### CSS Animations (`src/index.css:363-387`)

- `lock-break` (0.45s): translate + rotate jolt — simulates mechanical shock when pick snaps.
- `lock-open` (0.75s): "CLICK!" text scale-in → scale-out + fade.
- `lock-snap` (0.55s): "SNAP!" text scale-in → fade with slight upward drift.

### Audio

None currently implemented in this minigame.

### Gear Sprite

`src/assets/sprites/gear/lockpick_gloves.png` — 4KB pixel-art gloves icon. Used only in the inventory/armory UI, not during gameplay.

### Overall Style and Mood

Dark medieval fantasy. Warm amber/gold tones on deep brown wood textures suggest a tavern or thieves' guild setting. The procedural visuals are cohesive with the game's parchment-and-wood design language. The glow system gives a "hot/cold" game feel that reads immediately.

---

## 8. Current Player Experience

### What Works Well

- **The glow feedback is intuitive.** Players quickly learn the red-to-green colour arc means "move the pick this way." It doesn't need a tutorial.
- **Flash effects are punchy.** "CLICK!" and "SNAP!" are satisfying micro-moments; the shake on jamming feels physical.
- **Three-lock structure provides pacing.** The Novice → Adept difficulty ramp within a single run gives the trial shape without requiring a separate difficulty selection.
- **Controls are solid.** Mouse, keyboard, and touch all work; pointer capture prevents drag-escape bugs.
- **Clean engine/component separation.** All logic lives in `lockpicking.ts` with no React coupling; the component only drives rendering and input.
- **Test coverage.** Every engine function is exercised with boundary cases.

### What Feels Confusing or Awkward

- **No feedback during the search phase.** While idle (not torquing), the player gets zero indication they are near or far from the sweet spot. The entire discovery process is "blindly hold torque, observe glow, release, adjust, repeat" — there's no passive warmth signal when simply moving the pick. This makes the early search feel random rather than skilled.
- **Hints are only text, only when torquing.** "Keep looking…" vs. "Getting warmer…" are easy to miss during play, especially on small screens. The hint line sits below the lock but gets no animation emphasis to draw the eye.
- **No visual reference points on the arc.** The 180° arc has no tick marks, zone indicators, or position readout. Players can't develop positional intuition or communicate sweet spot angles.
- **DX stat doesn't matter.** The trial is supposed to train Dexterity, but the actual difficulty reduction only uses `character.level`. A high-DX low-level player has no advantage over a low-DX same-level player.
- **No audio.** The scratching of a pick against tumblers, the satisfying click of an opening lock, and the snap of a breaking pick are all missing — these are the most iconic sound moments of the genre this mechanic is drawn from.

### What Feels Polished

- The warmth glow system is smooth and well-calibrated.
- The pick-lean effect (`-cylinderDeg * 0.08`) is a small but effective touch of physical realism.
- The broken-pick visual (rose, shortened, glowing) reads clearly without text.
- The RAF loop architecture is robust — dt-capping prevents jank after tab switches.

### What Feels Unfinished

- Audio is entirely absent.
- No pick position reset between locks — the pick stays wherever it ended up when the previous lock opened, which creates an accidental head-start advantage on the next lock.
- Score only rewards pick efficiency, not speed; a very slow but careful player scores identically to a fast precise one.

### Pacing

For a daily trial, the session length feels appropriate — typically 30–90 seconds. Losing all picks on the 3rd lock after a clean run on the first two is genuinely tense. However, if a player is consistently unlucky with sweet spot placement near pick edges, the experience can feel unfair rather than skilful.

### Difficulty

At low character levels the Adept lock (11° tolerance, 3.5° open zone) requires precise search, especially since the arc gives no positional feedback. The level scaling helps but is subtle — at level 10 the Adept lock only widens to ~16.4°/5.3°. For a new player the difficulty wall may feel steep without understanding why the pick keeps snapping.

---

## 9. Known Issues or Weak Points

1. **DX stat level unused.** `character.statLevels.DX` is never read by the minigame. The trial rewards DX XP and is thematically DX-gated but doesn't use it in difficulty calculation. See `Lockpicking.tsx:188` — only `character.level` is selected from the store.

2. **No audio.** `Lockpicking.tsx` does not import or call anything from `src/lib/sfx.ts`. `TrialModal` calls `sfxResume()` on "Begin Trial" to warm the AudioContext, which implies audio is planned but not yet wired.

3. **Unseeded RNG.** `generateLocks(Math.random, level)` uses the browser's `Math.random`. Each run is a fresh draw — there's no way to replay the same layout, compare runs fairly, or detect unusual luck. Other parts of the game may use a seeded RNG.

4. **No passive proximity feedback.** The warmth glow only activates when torque is held. During the search phase the player has no way to know they are 5° from the sweet spot vs. 70° away.

5. **Pick position not reset between locks.** `pickDegRef.current` is not reset when advancing to the next lock (see the `nextOpened >= NUM_LOCKS` else branch in the RAF loop at `Lockpicking.tsx:307-316`). This is a minor design inconsistency — consecutive sweet spots could be clustered together or the carry-over could accidentally help or hurt.

6. **Hint is only visible during torque.** The "Pick snapped!" hint (which sets `hint` in the `breaking` phase) is cleared again as soon as the cylinder finishes returning and phase reverts to `idle` (line 279). On fast hardware this could clear before the player reads it, though the SNAP flash is still visible.

7. **`lock-snap` CSS comment typo** (`\*` instead of `/*`): `src/index.css:381` reads `\* Lockpicking — pick-break flash: red text pops then fades */` — the opening `/*` is malformed. The browser may silently parse it anyway, but it should be fixed.

8. **Glow uses five hard-coded threshold bands** rather than a smooth gradient. There are noticeable jumps between warmth bands (e.g., at 0.70 the glow shifts from orange to yellow-green abruptly), which slightly undermines the "smooth warmth" metaphor.

9. **Score formula gives 0.5 for 1-pick success.** A player who opens all 3 locks while burning 5 of their 6 picks gets the same score as one who barely passes with 1 pick left — both land at 0.5 exactly. The intended floor is fine, but the distribution of scores in the [0.5, 1.0] range may compress too quickly toward low-efficiency play.

---

## 10. Improvement Opportunities

- **Add SFX:** Pick scraping on tumblers (idle ambient during jam), cylinder click on open, sharp snap on break. These are the signature sounds of the genre and their absence is the most noticeable gap.
- **Passive warmth feedback during search:** A subtle vibration on the pick (or a very faint ambient glow on the lock plate) when the pick is within the turn zone could make the search phase feel less random.
- **Wire DX stat level into difficulty:** Replace or supplement `character.level` with `statLevels.DX` to make the DX stat progression feel meaningful to this trial specifically.
- **Visual arc reference points:** Light tick marks or an arc band indicator to give the player a spatial frame of reference and help them develop positional intuition.
- **Reset pick position between locks:** Or explicitly carry it over by design and make it a feature (the next lock benefits from your last position), but one or the other should be deliberate.
- **Smoother glow interpolation:** Blend the five warmth color bands into a continuous CSS gradient rather than hard thresholds to eliminate color jumps.
- **Speed/time component to scoring:** Currently only pick efficiency matters. A small time bonus (capped) would reward fast execution without penalizing careful players too heavily.
- **Post-failure sweet spot reveal:** Briefly flash the sweet spot position after all picks are exhausted to give training feedback and reduce frustration.
- **Hint emphasis:** Animate the hint text (brief pulse or color pop) so it's harder to miss during an active torque session.
- **Fix CSS comment typo** on `lock-snap` keyframe in `src/index.css:381`.
- **Seeded RNG option:** Use a seeded generator so layouts can be reproduced for testing or score comparisons.
- **Mobile button sizing:** The ◀/▶ buttons are 44×44px — at the low end of comfortable touch targets, especially during the stressful jam window. Consider 48×48 or wider.

---

## 11. Questions and Unknowns

1. **Is DX stat level intentionally excluded from difficulty?** The trial awards DX XP, which should eventually make the trial easier. Is there a plan to connect `statLevels.DX` to `lockTolerance`, or is the current `character.level`-only scaling deliberate?

2. **What is the intended difficulty calibration by level?** At what character level should a median player reliably 3-star the Adept lock? The current constants haven't been playtested with explicit level targets documented.

3. **Is the PICK_BUDGET of 6 fixed regardless of level?** There's no level-scaling on `PICK_BUDGET`. Is this intentional, or should higher difficulty characters get fewer picks to compensate for the wider tolerances?

4. **Is audio planned?** `TrialModal` calls `sfxResume()` before every trial, suggesting audio is expected. Is there a backlog item for lockpicking SFX, or was the call added prophylactically for all trials?

5. **Should the pick position reset between locks?** The current behaviour (carry-over) seems accidental. What's the intended design?

6. **Should sweet spots be seeded?** The current `Math.random` gives fully non-reproducible runs. Is a seeded daily layout (same seed for all players on a given calendar day, for example) in scope?

7. **`scoreToStars` threshold values** — the exact cutoffs are defined in `src/engine/trials/trials.ts` but not cited in any player-facing UI. What are the star thresholds, and are they consistent across all eight trials?

8. **Is the `lock-snap` CSS comment typo** (`\*` instead of `/*` on `src/index.css:381`) causing any visible rendering difference, or is it harmless?

9. **What does a 3-star run feel like at end-game level?** At very high character levels, the tolerance zones widen substantially. Is there a difficulty ceiling to prevent the minigame from becoming trivial?
