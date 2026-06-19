# Lockpicking Minigame — Analysis (Updated)

> Reflects the state of the minigame as of commit `0f2ce9e` and the subsequent
> sweet-spot reveal implementation. Supersedes the original report.

---

## 1. Basic Summary

Lockpicking is a daily Skill Trial tied to the **DX (Dexterity)** stat. It is one of eight
trials, each playable once per calendar day, that reward the player with Dexterity XP and
gold outside the main dungeon/arena loop.

The mechanic is modelled on Skyrim-style lockpicking: the player rotates a pick around a
180° arc to find a hidden sweet spot, then holds a torque button while positioned correctly.
The cylinder turns proportionally to how close the pick is to the sweet spot — hold it in the
right zone long enough and the cylinder reaches 90° (open). Hold against a jam too long and
the pick snaps. Three locks of rising difficulty — Novice, Apprentice, Adept — must be
opened with a budget of six picks.

Since the original report, all major planned improvements have been implemented:

- **DX stat level** now widens every lock's sweet-spot zones.
- **Audio** (three synthesised SFX cues) is fully wired.
- **Passive proximity feedback** gives a faint ambient glow during the search phase.
- **Per-pick stress visual** on the pick shaft provides a countdown to snap.
- **Arc tick marks**, hint animation, button sizing, pick reset, "Lock N of 3", and
  the plate pulse on open have all shipped.
- **Post-failure sweet-spot reveal** shows the target zone briefly after all picks are spent.
- The **score formula**, **break-time floors**, and **`lockpick_gloves` description** have
  all been updated to match the new systems.

---

## 2. Core Game Loop

**Start:** The player opens the Trials view, selects Lockpicking (🔑), reads the intro in
`TrialModal` (which now shows their DX level bonus), and presses "Begin Trial."
`sfxResume()` is called to unlock the AudioContext, then `generateLocks(Math.random, level, dxLevel)`
produces three `LockConfig` objects with randomised sweet spots.

**Core per-lock cycle:**

1. The player rotates the pick left/right across the 0–180° semicircle. While the pick is
   within any lock's turn zone — even without torque — the cylinder emits a faint warm gold
   ambient glow (passive proximity feedback).
2. The player holds "Turn Lock." The cylinder eases clockwise toward `allowedTurn × 90°`.
   The cylinder glow interpolates continuously from red → amber → green as `allowedTurn`
   increases. If the pick is jamming, the pick shaft blends toward rose and its lean angle
   increases as `jamTimeRef / breakTime` climbs toward 1.
3. **If in the open zone** (`canOpen = true`) and the cylinder reaches 90°, the lock opens:
   - A green "CLICK!" flash plays (`lock-open` keyframe, 750ms).
   - A gold-green glow burst pulses on the outer plate (`lock-plate-open` keyframe, 600ms).
   - `lockClick` SFX fires.
   - The pick resets to 90° (center) and the next lock begins.
4. **If outside the open zone**, the cylinder jams at its maximum. The plate shakes (amplitude
   proportional to jam severity) and `lockScrape` SFX fires throttled to ≤1 per 350ms. If
   `jamTimeRef` exceeds `breakTime(pickDeg, lock, lockIndex)`, the pick snaps:
   - A red "SNAP!" flash plays (`lock-snap` keyframe, 550ms).
   - `lockSnap` SFX fires.
   - One pick is consumed. If picks remain, the player returns to idle on the same lock.
   - If **all picks are gone**, the `'revealing'` phase begins instead of immediately finishing.

**Revealing phase (new):**
After the final pick snaps and the cylinder springs back to 0, the component enters
`'revealing'` rather than calling `finish()`. A green arc wedge appears on the plate rim
marking the true open zone (`sweetSpotDeg ± openToleranceDeg`) of the failed lock, with a
radial pointer and ★ label. The hint reads "Out of picks!" and the instruction line says
"Here's where the sweet spot was · tap Continue to see your score." After ~1.6 seconds
`finish()` is called automatically, or the player can tap "Continue →" to skip. Pointer
movement and direction buttons are frozen during this phase.

**End conditions:**
- All 3 locks opened → success; `onFinish(score)` called with score ∈ [0.5, 1.0].
- Revealing phase timeout/skip → failure; `onFinish(score)` called with score ∈ [0, 0.3].

**Rewards (via `TrialModal → completeTrial`):** DX stat XP + gold, scaled by score and
character level. One attempt per calendar day. Personal best tracked in `bestTrialScore`.
The result screen shows "Picks saved: N / 6 🗝️" after a successful run, derived from the
score using the inverse of the linear formula.

---

## 3. Player Controls and Interaction

### Input Controls

| Action | Keyboard | Pointer | On-screen button |
|---|---|---|---|
| Rotate pick left | `A` / `←` | Mouse/touch moves pick angle | ◀ button (h-12 w-12) |
| Rotate pick right | `D` / `→` | Mouse/touch moves pick angle | ▶ button (h-12 w-12) |
| Apply torque | `Space` / `↑` (hold) | Left button hold on lock area | "Turn Lock" button (hold) |
| Skip reveal | — | Tap anywhere on Turn Lock | "Continue →" button (during revealing) |

Keyboard moves the pick at `PICK_KEY_SPEED = 90°/sec`. Mouse/pointer directly maps cursor
angle to pick angle via `pointerToDeg()` using `atan2`. All pointer events use
`setPointerCapture` so drags don't escape the lock area. During `'revealing'`,
`handlePointerMove` is guarded early-out and the ◀/▶ buttons are `disabled` with
`opacity: 0.2`.

### UI Elements

- **Lock progress row** (top): three slots labeled Novice / Apprentice / Adept. Active lock
  shows 🔑; opened locks show ✓ (gold); failed lock shows ✗ (rose).
- **"Lock N of 3" label**: one line of small text below the progress row, shown while not
  done.
- **Pick count**: six 🗝️ icons, dimmed as picks are used.
- **Lock visual** (center): a 200×200 circular plate containing an 88px inner cylinder.
  Five SVG components render inside it: `Keyhole`, `TensionWrench`, `ArcTicks`,
  `SweetSpotReveal` (conditional), and `LockPick`.
- **Arc tick marks** (`ArcTicks`): five SVG line ticks at 0°, 45°, 90°, 135°, 180° on
  the plate rim. The 90° (center) tick is slightly brighter.
- **Sweet-spot reveal** (`SweetSpotReveal`): visible only in `'revealing'` phase. SVG green
  arc wedge + radial line + ★ at the failed lock's true open zone. Fades in via `hint-pop`.
- **Hint text** (below lock): animates on change via `key={hint}` React remount +
  `hint-pop` keyframe (scale 0.82 → 1.07 → 1, 180ms).
- **Instruction line**: contextual three-state text covering normal play, torque-held, and
  the reveal phase.
- **On-screen control buttons**: ◀ (48×48px), "Turn Lock" / "Continue →", ▶ (48×48px).
  Relabelled and functional-semantically changed during reveal.

### Feedback Given to the Player

- **Passive proximity glow**: faint warm gold box-shadow on the cylinder when
  `idleProximity > 0` (i.e., when the pick is anywhere in the turn zone) and torque is not
  active. Scales `0 0 4–12px 2–5px rgba(200,160,40,0–0.18)` proportionally to `allowedTurn`.
- **Active warmth glow**: continuous red → amber → green interpolation while torquing;
  glow radius expands 8–26px. Three-stop linear blend via `warmthGlowColor(warmth)`.
- **Shake**: plate translates randomly while jamming; amplitude = `8 × (1−turn)^0.7`.
- **Pick stress visual**: shaft color blends zinc→rose and lean angle increases by
  `stressRatio × 4°` as the jam timer fills toward `breakTime`. Shaft gets a red glow ring
  when `stressRatio > 0.3`.
- **Flash overlays**: "CLICK!" (emerald, `lock-open` 750ms) on unlock. "SNAP!" (rose,
  `lock-snap` 550ms) on break.
- **Plate pulse** (`lock-plate-open` 600ms, gold→green→out box-shadow): fires on the
  outer plate when a lock opens.
- **`lock-break`** (0.45s jolt animation on the plate) continues to fire on snap.
- **Hint text changes** with animation:
  - `'Almost there!'` when `turn > 0.9` and not jamming.
  - `'Getting warmer…'` when jamming and `turn > 0.65`.
  - `'Keep looking…'` when jamming and `turn > 0.3`.
  - `'Wrong angle'` when jamming and `turn ≤ 0.3`.
  - `'Pick snapped!'` on entering `'breaking'` phase.
  - `'Out of picks!'` on entering `'revealing'` phase.
- **SFX**:
  - `lockScrape` — metallic bandpass noise burst during jam, throttled ≤1 per 350ms.
  - `lockClick` — triangle + noise + sine chord on `'opening'` phase entry.
  - `lockSnap` — square + bandpass burst on `'breaking'` phase entry.
- **Pick lean**: `cssRot += −cylinderDeg × 0.08` simulates mechanical stress against
  the cylinder.

---

## 4. Mechanics and Systems

### Scoring (`engine/trials/lockpicking.ts:lockpickingScore`)

- **Success (all 3 locks opened):** `0.5 + 0.5 × picksRemaining / PICK_BUDGET`.
  Score range [0.5, 1.0]. Zero picks remaining → 0.5; full budget remaining → 1.0.
  The formula is linear across the full pick budget — each saved pick is worth the same.
- **Failure (out of picks mid-run):** `0.3 × (locksOpened / 3)`. Score range [0, 0.3].

Score maps to stars via `scoreToStars()` in `trials.ts`.

The result screen derives "Picks saved" from the score via the inverse formula:
`Math.round((score − 0.5) × 2 × PICK_BUDGET)` — no second parameter is needed on `onFinish`.

### The Pick and Sweet Spot

- Pick rotates over `PICK_MIN_DEG = 0` to `PICK_MAX_DEG = 180` degrees.
- Each `LockConfig` has a hidden `sweetSpotDeg` placed in `[20, 160]` (20° margin from
  edges).
- Two tolerance zones per lock:
  - **Turn zone** (`toleranceDeg`): any pick position within this range turns the cylinder.
  - **Open zone** (`openToleranceDeg`): must be within this tighter range to reach 90°.
- `allowedTurn()` returns 1.0 inside the open zone, falls off linearly to 0 at the turn
  zone edge, and is 0 outside.

### Per-Lock Difficulty Progression

| Lock | Base toleranceDeg | Base openToleranceDeg |
|---|---|---|
| 0 — Novice | 22° | 7° |
| 1 — Apprentice | 16° | 5° |
| 2 — Adept | 11° | 3.5° |

### Character Level Scaling

`lockTolerance(lockIndex, level, dxLevel)` widens both zones per level:
- `toleranceDeg += (level − 1) × 0.6`
- `openToleranceDeg += (level − 1) × 0.2`

### DX Stat Level Scaling (new)

`lockTolerance()` now accepts an optional `dxLevel` parameter and applies additive bonuses:
- `toleranceDeg += dxLevel × LEVEL_DX_TOLERANCE_BONUS` (0.3°/DX level)
- `openToleranceDeg += dxLevel × LEVEL_DX_OPEN_BONUS` (0.1°/DX level)

Both bonuses are additive with the character-level bonus. `generateLocks()` passes `dxLevel`
through to every `lockTolerance()` call. `Lockpicking.tsx` reads
`character.statLevels?.DX ?? 0` from the store and passes it to `generateLocks()`.

The TrialModal intro screen shows the computed Adept lock tolerances at the player's current
DX level (matching the Long March / Endurance tooltip pattern). `lockpick_gloves` description
now explicitly calls out the trial connection.

### Cylinder Mechanics

Unchanged from original. `targetCylinder = allowedTurn × CYLINDER_OPEN_DEG (90°)`.
Forward speed: `CYLINDER_TURN_SPEED = 180°/sec`. Return speed: `CYLINDER_RETURN_SPEED =
240°/sec`. On `'breaking'` or `'opening'`: 2.5× speed.

### Break Timer (`engine/trials/lockpicking.ts:breakTime`)

Per-lock minimum break times replace the old single scalar:

| Lock | BREAK_TIME_MIN_PER_LOCK |
|---|---|
| 0 — Novice | 0.55s |
| 1 — Apprentice | 0.65s |
| 2 — Adept | 0.80s |

`breakTime(pickDeg, lock, lockIndex)` maps `allowedTurn` to seconds:
`min[lockIndex] + turn × (BREAK_TIME_MAX − min[lockIndex])`. Range per lock: 0.55–3.5s,
0.65–3.5s, 0.80–3.5s. Harder locks give slightly more time at maximum distance, giving the
player a realistic reaction window before the first snap. `lockIndex` is now a required
parameter — all call sites pass `currentLockRef.current`.

### Pick Reset Between Locks

On lock advance (opening-phase completion), `pickDegRef.current` and `setPickDeg` are both
reset to `90` (center) before entering the next lock's idle phase. This ensures each lock
starts from a neutral position regardless of where the previous pick ended up.

### Revealing Phase

A new terminal phase `'revealing'` was added to the `Phase` union. It is entered only on
terminal failure (all picks spent, cylinder returned to 0 in the breaking branch). During
this phase:
- The RAF loop does not run (it exits early for `'revealing'` in the same guard as `'done'`).
- A `useEffect` keyed on `phase === 'revealing'` sets a 1600ms timeout that calls `finish()`.
- `SweetSpotReveal` renders on the plate, and controls are frozen except "Continue →".

---

## 5. Technical Implementation

### Files

| File | Role |
|---|---|
| `src/engine/trials/lockpicking.ts` | Pure engine: constants, types, `generateLocks`, `allowedTurn`, `canOpen`, `breakTime` (now takes `lockIndex`), `lockpickingScore` |
| `src/components/trials/games/Lockpicking.tsx` | React component: all rendering, phase state machine, RAF loop, input handling (~790 lines) |
| `src/engine/trials/trials.ts` | Trial registry — defines `'lockpicking'` entry with stat, name, glyph, blurb |
| `src/components/trials/TrialModal.tsx` | Modal shell: intro → playing → result; DX tooltip on intro; "Picks saved" on result |
| `src/store/useGameStore.ts` | `completeTrial(trialId, score01)`: daily gate, reward, best-score update |
| `src/lib/sfx.ts` | Web Audio synthesiser: `lockScrape`, `lockClick`, `lockSnap` cues added |
| `src/index.css` | CSS keyframes: `lock-break`, `lock-open`, `lock-snap`, `hint-pop` (new), `lock-plate-open` (new) |
| `src/content/gear.ts` | `lockpick_gloves` — description updated to name trial benefit |
| `src/content/recipes.ts` | Recipe for lockpick_gloves (unchanged) |
| `src/engine/trials/__tests__/trials.test.ts` | Unit tests: updated for new `breakTime` signature, new score formula, new `lockTolerance` DX parameter |

### Phase State Machine

```
idle ──[torque held]──► turning ──[cylinder ≥ 90° + canOpen]──► opening ──► (next lock / finish)
  ▲                          │
  └──[torque released]       └──[jam timer expired]──► breaking
                                                            │
                                      [picks > 0] ◄────────┤────────► [picks = 0]
                                           │                                │
                                         idle                           revealing
                                                                            │
                                                                    [timeout / Continue]
                                                                            │
                                                                          done
```

`phaseRef.current` is the authoritative value read inside the RAF loop; `phase` (React state)
drives `useEffect` re-runs and render conditions.

### State and Refs

**New state added:**
- `idleProximity` (number 0–1): passive proximity signal, set each idle frame.
- `stressRatio` (number 0–1): jam fraction; drives pick stress visual.
- `platePulse` (boolean): triggers `lock-plate-open` animation on open.

**New ref added:**
- `lastScrapeRef` (number): timestamp of last `lockScrape` play, for throttling.

All pre-existing refs (`pickDegRef`, `cylinderDegRef`, `torqueHeldRef`, `pickKeyDirRef`,
`jamTimeRef`, `phaseRef`, `currentLockRef`, `picksRemainingRef`, `locksOpenedRef`) unchanged.

### RAF Loop

Single `requestAnimationFrame` loop in a `useEffect`. Dependencies:
`[phase === 'done' || phase === 'revealing', finish]`. The loop exits early for both `'done'`
and `'revealing'` — the revealing useEffect owns its own timer and does not use RAF. `dt` is
capped at 50ms.

### Data Flow

```
generateLocks(Math.random, level, dxLevel) ──► locks.current (stable ref)
                                                      │
RAF loop ──► reads pickDegRef, torqueHeldRef, currentLockRef
          ──► calls allowedTurn / canOpen / breakTime(deg, lock, lockIndex)
          ──► sets idleProximity / stressRatio / cylinderDegRef / jamTimeRef / phaseRef
          ──► calls setCylinderDeg / setShakeX / setWarmth / setPhase / setHint
                         │
React render ──► cylinder rotate transform + warmthGlowColor glow
              ──► passive gold ambient glow when idleProximity > 0
              ──► LockPick stressRatio → shaft color + lean
              ──► ArcTicks (always), SweetSpotReveal (revealing only)
              ──► flash overlays / plate animations
                         │
onFinish(score) ──► TrialModal.handleFinish
                ──► completeTrial(trialId, score) ──► Zustand store
                ──► setStage('result') — derives picksRemaining from score for display
```

### Save / Load Behavior

Unchanged. On completion, `completeTrial` persists:
- `trialsClearedOn['lockpicking']` = today's ISO date.
- `bestTrialScore['lockpicking']` = max(old, new).
- Applies XP / gold reward, triggers level-up check.

---

## 6. Software, Libraries, and Tools Used

| Concern | Technology |
|---|---|
| Framework | React 18 |
| Language | TypeScript |
| Build tool | Vite |
| State management | Zustand (with `persist` middleware → localStorage) |
| Styling | Tailwind CSS (custom wood/parchment/gold design tokens) |
| Game loop | `requestAnimationFrame` (manual RAF inside `useEffect`) |
| Rendering | HTML divs + inline CSS transforms; SVG for keyhole, tension wrench, arc ticks, and sweet-spot reveal |
| Animation | CSS `@keyframes` in `src/index.css` (five total: `lock-break`, `lock-open`, `lock-snap`, `hint-pop`, `lock-plate-open`) |
| Audio | Web Audio API via `src/lib/sfx.ts` synthesiser — three cues: `lockScrape`, `lockClick`, `lockSnap` |
| Testing | Vitest |
| Third-party libs | None |

---

## 7. Assets and Presentation

### Visuals — All Procedural

No sprite sheets or bitmaps during play. Every element is HTML + CSS + SVG.

- **Lock plate**: 200×200 circular `div`, radial gradient `#4a3a22 → #1c1208`, gold border,
  drop shadow. Shakes via `translate(shakeX, shakeY)`. Hosts `lock-break` on snap,
  `lock-plate-open` on open.
- **Decorative inner ring**: 1px circular border at 10px inset.
- **Arc tick marks** (`ArcTicks` component): SVG `<line>` elements at 0°/45°/90°/135°/180°
  on the plate rim. Center (90°) tick is 2px wide and slightly brighter.
- **Cylinder**: 88×88 circular `div`, darker radial gradient, rotates via
  `rotate(−cylinderDeg deg)`. Receives both the active warmth glow and the passive proximity
  glow as `box-shadow` (mutually exclusive, priority: active > passive).
- **Keyhole** (`Keyhole`): SVG circle + trapezoid + ellipse in near-black `#100a03`.
- **Tension wrench** (`TensionWrench`): SVG L-shaped tool (two rects + highlight) that
  rotates with the cylinder.
- **Pick** (`LockPick`): vertical `div` stack — gradient shaft, rotated tip, amber handle.
  Three visual states: neutral (zinc gradient), stressed (zinc→rose lerp by `stressRatio`,
  lean += `stressRatio × 4°`, red glow), broken (rose, 55% height, glowing, tip/handle
  hidden).
- **Flash overlays**: "CLICK!" (`lock-open`, emerald) and "SNAP!" (`lock-snap`, rose).
  Both are absolutely positioned inside the plate div.
- **Sweet-spot reveal** (`SweetSpotReveal`): SVG arc wedge (green, `openToleranceDeg` wide)
  + radial pointer line + ★ text at `sweetSpotDeg` on the plate rim. Animated in with
  `hint-pop 0.3s`. Visible only during `'revealing'` phase.

### Warmth Glow System

`warmthGlowColor(warmth)` is now a **continuous 3-stop linear interpolation**:

| warmth | Color |
|---|---|
| 0.0 | `rgba(239, 68, 68, 0.50)` — red |
| 0.5 | `rgba(234, 179, 8, 0.75)` — amber |
| 1.0 | `rgba(74, 222, 128, 0.95)` — green |

`r`, `g`, `b`, and `a` are individually lerped between the two nearest anchors. No visible
color jumps. Glow radius: `8 + warmth × 18` pixels.

### CSS Animations (`src/index.css`)

- `lock-break` (0.45s): translate + rotate jolt on snap.
- `lock-open` (0.75s): "CLICK!" scale-in → scale-out + fade.
- `lock-snap` (0.55s): "SNAP!" scale-in → fade + drift.
- `hint-pop` (0.18s, new): hint text scale 0.82 → 1.07 → 1 on change.
- `lock-plate-open` (0.6s, new): outer plate box-shadow pulses gold→green→out on lock open.

### Audio (`src/lib/sfx.ts`)

Three synthesised cues use the shared `_noise()` and `_osc()` helpers:

- `lockScrape` — bandpass noise + triangle oscillator (220 Hz); suggests pick on tumblers.
- `lockClick` — triangle + bandpass noise + sine (380/760 Hz); mechanical click of opening.
- `lockSnap` — square + bandpass noise (520 Hz); sharp crack of a breaking pick.

All three are zero-asset — no audio files. `TrialModal` still calls `sfxResume()` on "Begin
Trial" to guarantee the AudioContext is resumed before the first in-game sound.

### Gear Sprite

`src/assets/sprites/gear/lockpick_gloves.png` — used in inventory/armory UI only.

### Overall Style and Mood

Dark medieval fantasy. Warm amber/gold tones on deep brown procedural textures. The
red-to-green warmth glow, gold plate border, and "CLICK!" / "SNAP!" moments all read as
belonging to the same visual language as the rest of the game.

---

## 8. Current Player Experience

### What Works Well

- **The warmth glow is now smooth.** The continuous three-stop interpolation eliminates the
  color-band jumps from the original. Players feel the warmth meter as a true gradient.
- **Passive proximity glow gives the search phase shape.** Players can rotate the pick and
  watch the cylinder for a faint warm gleam to guide them toward the zone — the search is now
  a skill, not a guess.
- **Audio makes every event land harder.** The scraping SFX during a jam, the click on open,
  and the snap on break bring the Skyrim-lockpicking feel through. The throttling (350ms
  minimum between scrape sounds) prevents the effect from becoming noise.
- **The revealing phase teaches on failure.** Players who exhaust all six picks see exactly
  where the sweet spot was for ~1.6s before the result screen appears. This converts
  frustration into learning.
- **Pick stress gives a snap countdown.** The shaft color shift and increasing lean angle
  warn the player before the timer expires, giving skilled players a second signal alongside
  the shake effect.
- **DX stat investment is now meaningful.** The DX level bonus (0.3°/level on turn zone,
  0.1°/level on open zone) creates a tangible mechanical connection between levelling DX and
  succeeding at this trial. The `lockpick_gloves` (+5 DX) are now explicitly useful here.
- **Flash effects, plate pulse, and hint animation all layer well.** On a successful open,
  the "CLICK!" text, the plate glow burst, and the lockClick sound arrive as a
  coordinated micro-celebration. Nothing fires alone.
- **Structural improvements:** pick resets to center on lock advance; per-lock break-time
  floors are calibrated to difficulty; score formula rewards efficiency linearly.

### What Feels Confusing or Awkward

- **No speed component to scoring.** A very slow but methodical player scores identically to
  a fast precise one. This is a minor concern for a daily trial but could feel slightly flat
  to skilled players who clear all three locks in 20 seconds.
- **The "Out of picks!" revealing phase hint is easy to miss.** The hint appears below the
  lock and the instruction text below that — players who are looking at the green wedge on
  the plate may not read either line before tapping "Continue →."
- **No end-game difficulty ceiling.** At high DX + high character level, the Adept lock's
  zones widen substantially. There is no mechanism to keep the trial challenging at late-game
  levels beyond random sweet spot placement.
- **Unseeded RNG.** `generateLocks(Math.random, level, dxLevel)` uses browser `Math.random`.
  Runs are non-reproducible and unverifiable. This is low-impact for a daily trial, but a
  seeded daily layout would allow fairer score comparisons.

### What Feels Polished

- Every interactive event now has audio.
- The pick lean, stress color, and glow form a coherent stress vocabulary.
- Arc tick marks give the player a spatial vocabulary ("it was just left of center").
- The "Picks saved: N / 6 🗝️" result line closes the feedback loop on pick efficiency.
- The DX tooltip on the intro screen makes the stat → difficulty connection explicit before
  play begins.

### Pacing

Unchanged. For a daily trial, 30–90 seconds is appropriate. The revealing phase adds at most
~1.6 seconds on a full-failure run, which is unobtrusive.

---

## 9. Known Issues or Weak Points

1. **Unseeded RNG.** `generateLocks` still uses `Math.random`. Each run is a fresh draw;
   there is no daily-seed option and no replay capability. This is the main remaining
   technical gap from the improvement plan.

2. **No end-game difficulty scaling.** The level and DX bonuses accumulate without a cap.
   At very high combined level+DX, the turn zone may become wide enough that the trial
   becomes trivially easy. No playtesting data exists yet to determine at what thresholds
   this becomes a problem.

3. **"Out of picks!" hint competes for attention with the reveal.** During `'revealing'`,
   the most visually interesting element is the green wedge on the plate, but the
   instructional text is below the lock. Players may skip before reading either the hint or
   the instruction line.

4. **Picks-saved derivation assumes clean inversion.** `TrialModal` derives picksRemaining
   from score using `Math.round((score − 0.5) × 2 × PICK_BUDGET)`. This rounds correctly for
   integer pick counts but would produce unexpected results if `lockpickingScore` were ever
   changed to produce non-integer-corresponding values. The derivation is a workaround for
   keeping `onFinish` typed as `(score: number)` — a dedicated metadata parameter would be
   cleaner but would require touching all eight trial components or the shared
   `GameComponent` switch.

5. **Flash timer constants are still magic numbers.** The `750`ms and `550`ms flash durations
   in the phase-transition `useEffect` (lines ~357-371 of `Lockpicking.tsx`) are not
   extracted to named constants. Low priority, but noted in the improvement plan.

---

## 10. Improvement Opportunities

These are the remaining items from the original plan that were not yet implemented.

### High value

- **Seeded daily RNG.** Implement a `useDailySeed()` utility (e.g., hash of today's ISO date
  to a deterministic PRNG) in `src/lib/` and supply it to `generateLocks()`. Gives all
  players the same layout each day and enables genuine score comparisons. `generateLocks`
  already accepts any `() => number` RNG — the hook is the only missing piece.

- **End-game difficulty ceiling.** Consider capping the combined level+DX tolerance bonus,
  or introducing a "difficulty tier" above a combined threshold, to keep the Adept lock
  challenging at late-game progression. Alternatively, document the intended late-game
  difficulty as a design decision.

### Medium value

- **Speed / time bonus.** A small, capped score bonus for fast completions would reward
  skilled play without penalizing careful players. Requires a session timer and an update to
  `lockpickingScore()`.

- **Promote flash timer durations to constants.** Extract `750` and `550` from the
  phase-transition `useEffect` into named constants (`FLASH_UNLOCK_MS`, `FLASH_SNAP_MS`) at
  the top of `Lockpicking.tsx` or in `lockpicking.ts`. Zero gameplay impact; improves
  maintainability if timings are tuned.

- **Clean up the picks-saved derivation.** If another trial's `onFinish` ever needs to pass
  secondary metadata, it would be worth establishing a proper optional metadata shape —
  e.g., `onFinish(score: number, meta?: { picksRemaining?: number })` — and removing the
  inverse-formula trick.

### Low value / nice to have

- **Arc zone band indicator.** A very faint arc segment on the plate rim could show the
  width of the turn zone in real-time while torquing, giving the player a spatial sense of
  how narrow the Adept lock's zone is compared to Novice. This would require rendering the
  zone relative to the hidden `sweetSpotDeg`, so it would only be accurate as a "current
  zone" display, not a reveal — an interesting design tradeoff.

- **Hint text during the reveal.** A brief annotation on the reveal overlay (e.g., "You were
  X° away") would add learning value beyond just showing the wedge. Would require computing
  the closest approach during the failed attempt and storing it.

---

## 11. Questions and Unknowns

1. **Is there a planned difficulty ceiling for high-level characters?** At what combined
   level+DX does the Adept lock stop being meaningfully challenging, and is that outcome
   acceptable as a late-game reward?

2. **Is a seeded daily layout in scope?** `generateLocks` already supports it. A daily seed
   would enable score comparisons across players and sessions. Is this a design goal?

3. **Should `onFinish` eventually carry optional metadata?** The current inverse-formula
   workaround for "Picks saved" is pragmatic but fragile. If a future trial also needs to
   surface a secondary metric on the result screen, the workaround pattern will compound.
   Is it worth establishing a metadata parameter now?

4. **`scoreToStars` thresholds** — defined in `src/engine/trials/trials.ts` but not
   player-facing. Are the thresholds the same for all eight trials? Are they calibrated to
   the current lockpicking score distribution (where a 6-pick-perfect run = 1.0 and 0-picks
   remaining = 0.5)?

5. **Should the pick budget scale with difficulty or character level?** `PICK_BUDGET = 6` is
   fixed regardless of character progression. As zones widen at higher levels, six picks
   becomes generous. Is this intentional, or should the budget tighten at higher levels to
   preserve the trial's challenge ceiling?
