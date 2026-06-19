# Rooftop Chase — Minigame Analysis

*Revised June 2026 to reflect improvements implemented in the feature/multiplayer branch. All citations are to production files.*

---

## 1. Basic Summary

Rooftop Chase is a side-scrolling endless runner and one of the eight daily Skill Trials. It is the **Agility (AG)** trial. The player controls a cloaked hero sprinting across the rooftops of a procedurally-generated medieval town at night. The rooftops are at varying heights and separated by lethal gaps; falling into any gap ends the run immediately. After covering 120 world-units (wu), a beast chaser appears behind the hero and closes in at a steady rate. The player must run far enough to score well, using jumps, slides, and dash bursts to navigate obstacles and keep the chaser at bay. A perfect run requires covering 600 wu, which takes roughly 60–120 seconds of clean play.

The trial is registered in `src/engine/trials/trials.ts` as `rooftop_chase` with stat `AG`. It is one of eight trials playable once per calendar day, gated by `trialsClearedOn`. Completing it calls `store.completeTrial('rooftop_chase', score01)`, which applies a reward and updates the best score for the AG trial.

**Post-improvement highlights:** The outer `RooftopChase` component now manages a full run lifecycle with restart support and a result overlay; the inner `RooftopChaseRun` handles all simulation and rendering. Slide, mook-jump, and ledge-catch now all award lead. Prop density ramps across the course. Late-game surges drain real lead. RNG is seeded and exported from the engine.

---

## 2. Core Game Loop

### Start
`initChase(rng)` in `src/engine/trials/rooftopChase.ts:688` generates a 30-building course and returns a fresh `ChaseState`. The `rng` argument is produced by `seededRng(Date.now())` in `useChaseLoop.ts` — a deterministic LCG seeded at mount time, so each run is different but reproducible if the seed is known. The hero begins at distance 0 on a wide grace platform (22 wu, no props, no chaser). The run loop (`useChaseLoop`, `src/hooks/useChaseLoop.ts`) starts a `requestAnimationFrame` loop immediately on mount.

### During play
Every RAF frame the hook calls `stepChase(state, input, dtSec)` — the pure simulation reducer at `rooftopChase.ts:741`. The reducer:

1. Clears all one-frame event flags (`justLanded`, `justStomped`, `justSlideClear`, `justJumpedMook`, `justLedgeCaught`, etc.).
2. Ticks all countdown timers (stumble, slide, dash, stomp flash).
3. Processes edge-triggered input (jump, slide, dash) — each flag is true for exactly one frame.
4. Advances `state.distance` at the current scroll speed (which ramps up over time).
5. Applies semi-implicit Euler gravity to `heroY` and `heroVy`.
6. Resolves landing and ledge-catch logic; sets `justLedgeCaught` on a successful lip grab.
7. Checks `hasFallen()` — a gap fall ends the run immediately.
8. Scans for prop collisions and resolves contact (stomp / stumble / clear); sets `justSlideClear` on a clean lowbar slide, `justJumpedMook` on a non-stomp mook clear.
9. Updates lead (`updateLead`), chain-stomp bonuses, slide-clear gain, mook-jump gain, and — beyond 400 wu — real surge drain.
10. Updates the chaser world position from lead value.
11. Checks terminal conditions (lead ≤ 0 or distance ≥ 600).

The resulting `ChaseState` is set on React state, causing a re-render of `RooftopChaseRun`.

### Challenge escalation
Scroll speed ramps linearly from 4 wu/s at the start to a hard cap of 10 wu/s at 600 wu (`BASE_SPEED = 4`, `SPEED_RAMP = 0.010`, `MAX_SPEED = 10` — `rooftopChase.ts:19–30`). Prop density also ramps: buildings 1–10 have a 50% chance of a prop, buildings 11–20 have 65%, and buildings 21–30 have 80% (`generateCourse`, `rooftopChase.ts:283`). The combination of faster scroll speed and denser obstacles creates a natural difficulty curve throughout the run.

### End conditions
The run ends in one of three ways, and `RooftopChaseRun` detects `state.done` via a per-render effect:
- **Fall:** hero drops into a gap (`hasFallen()` returns true). `justFell = true`; a 650 ms delay allows the fall animation to complete before `onRunDone` is called.
- **Caught:** lead drains to 0. A 450 ms delay allows the chaser pounce animation to play.
- **Win:** distance reaches 600 wu. A 200 ms pause before `onRunDone` is called.

`onRunDone` propagates the result to the outer `RooftopChase`, which displays the result overlay.

### Restart and result
The outer `RooftopChase` manages `runKey` (incremented on restart) and `runResult`. The result overlay shows the outcome label, final distance, star rating (via `scoreToStars`), and two buttons: "Run Again" (increments `runKey`, remounts `RooftopChaseRun` cleanly) and "Accept Score" (calls `onFinish` and hands off to the trial modal). This means the player can attempt the trial multiple times before choosing to submit, without navigating back through the modal UI.

### Reward
`store.completeTrial('rooftop_chase', score01)` is only called when the player clicks "Accept Score." Score is `distance / 600`, clamped to [0, 1]. Star thresholds: 1★ below 40%, 2★ at 40%+ (240 wu), 3★ at 75%+ (450 wu).

---

## 3. Player Controls and Interaction

### Input controls

| Action | Keyboard | On-screen button |
|--------|----------|-----------------|
| Jump / double-jump | Space, ArrowUp | ↑ Jump button |
| Slide (duck under lowbar) | ArrowDown, S | ↓ Slide button |
| Dash (speed burst) | Shift (L or R), D | ⚡ Dash button |
| Jump (alt) | Click anywhere on play area | — |

Key auto-repeat is suppressed (`e.repeat` check in `useChaseLoop.ts:59`) so holding Space does not trigger a double-jump.

### UI elements

**Play area** (`VIEW_W = 500px`, `VIEW_H = 260px`): The main viewport. The hero is pinned at `HERO_X_PX = 150px` from the left (30% of view); the world scrolls past. Contains:
- Three parallax background layers (far castle, mid buildings, foreground chimneys).
- Cloud layer: 4 rounded blobs scrolling at 3% of distance (`CLOUD_FACTOR = 0.03`), tiled across two copies of `CLOUD_TILE_W = 500px`.
- `BuildingView` sub-components for each visible roof. Each building now shows a height-change telegraph nub on its right edge: orange (3px wide, 8px tall) if the next building is higher, sky-blue if lower.
- `HeroSprite`, `ChaserSprite`, `HazardSprite`, `MookSprite`, `LowbarSprite` sub-components (all procedural CSS shapes).
- Speed lines behind the hero (purple at normal speed, gold during dash).
- Dust puffs on landing, stomps, dashes, and chaser landings.
- Surge vignette: red `inset box-shadow` pulsing when the beast lunges.
- Slide / Dash state labels (top-left of play area).
- Distance HUD: `[distance]/{CHASE_TARGET_DISTANCE}m` (top-right).
- Speed readout when above 15% of max speed (bottom-right).
- Mute toggle button (top-left).
- "⚠ Something stalks you…" warning when approaching chaser spawn (>70% of 120 wu).
- "CLOSE CALL! ⚡" gold banner on near-miss events.
- **"SLIDE! +5"** flash (sky-blue) when hero clears a lowbar cleanly.
- **"JUMP CLEAR! +3"** flash (green) when hero jumps over a mook without stomping.
- **"GRAB!"** flash (amber) when hero catches a ledge.
- **"STOMP x{n}! ⚔"** flash for stomp chains (font scales: `text-xs` at chain 1, `text-sm` at chain 2+).
- **Dash cooldown pip:** A 28px amber bar directly below the hero sprite, showing cooldown progress; visible only when the chaser is active and the dash is not ready.
- **Opening tip overlay:** Fades in at run start, fades out after 2.5 s and unmounts at 3 s. Text: "Space/↑ Jump · ↓/S Slide · Shift/D Dash."

**Lead bar** (below play area): Shown only when `chaserActive`. A progress bar from red (close) through yellow to green showing the hero's current lead fraction. A 🐺 emoji icon tracks the fill edge. Pulses when lead < 25%. Before chaser spawns, a neutral progress bar shows spawn progress with the label **"Beast in Xm"** (where X = remaining wu to chaser spawn, counted down live).

**Control buttons** (below lead bar): Jump (gold), Slide (blue), Dash (amber). Dash button dims and shows a right-to-left wipe overlay during cooldown. Score percentage shown bottom-left of the button row.

**Result overlay** (appears after run ends, above all other content): Shows:
- Outcome label in color: "ESCAPED!" (green), "CAUGHT!" (red), "FELL!" (blue).
- Final distance vs. 600 wu.
- Star rating (★ in amber for earned stars, dim for unearned).
- Two buttons: "Run Again" (sky-blue, restarts without submitting) and "Accept Score" (gold, submits and returns to modal).

**Instructions text** (top of component): Single line listing all keybindings. Remains visible throughout play.

### Player feedback summary
- One-frame event flags in `ChaseState` drive all audio cues via `useChaseAudio`.
- Landing triggers a squash animation (`rooftop-land`), dust puff, and land SFX.
- Stomps trigger a flash label (scaling with chain count), bounce velocity, and stomp SFX.
- Stumbles trigger a 480 ms opacity fade on the hero sprite and stumble SFX.
- Dashes trigger gold speed lines, a "DASH!" label, and dash SFX.
- Chaser surge triggers a red vignette pulse and surge SFX.
- Near-miss (low lead + recovery action) triggers "CLOSE CALL!" + nearMiss SFX.
- **New:** Clean slide triggers "SLIDE! +5" flash and `dodge` SFX.
- **New:** Mook jump-over triggers "JUMP CLEAR! +3" flash and `dodge` SFX.
- **New:** Ledge catch triggers "GRAB!" flash and `ledgeCatch` SFX (descending triangle tone + noise burst).
- **New:** Win plays a dedicated `chaseWin` SFX (5-note C-major ascending run with a sustained chord), replacing the generic `win` cue.

---

## 4. Mechanics and Systems

### Speed and distance
Scroll speed at any moment: `speedAt(d) = min(10, 4 + 0.010 × d)`. Speed starts at 4 wu/s and reaches the 10 wu/s cap exactly at the 600 wu finish. The `DASH_SPEED_BONUS = 0.4` multiplier applies on top during the 380 ms dash window, advancing distance 40% faster.

### Jump physics
- **Gravity:** 32 wu/s² downward.
- **Jump:** `JUMP_VELOCITY = 22 wu/s` upward. Air time ≈ 1.375 s. Apex ≈ 7.6 wu (61 px at 8 px/wu).
- **Double-jump:** `DOUBLE_JUMP_VELOCITY = 18 wu/s` (slightly weaker). Available any time the hero is airborne with `jumpsUsed < 2 (MAX_JUMPS)`.
- **Ledge-catch:** If the hero's leading edge has entered the next building while descending and is within `LEDGE_CATCH_TOL = 2.0 wu` of the surface, the hero is snapped to the roof rather than registering a fall. Fires `justLedgeCaught = true` for one frame. The renderer plays the `ledgeCatch` SFX and shows the "GRAB!" flash label (`rooftopChase.ts:874`).
- **Landing support:** A hero is considered "grounded" only when `LANDING_SUPPORT_FRAC (25%) × HERO_HITBOX_W (2.2 wu)` = at least 0.55 wu of hitbox overlaps a building. This prevents edge-clipping bugs while staying forgiving.

### Obstacles (props)

Each qualifying building (width ≥ 8 wu) has a chance of holding one prop, placed at least 3 wu from each edge. **Prop probability now ramps with building index:** 50% for buildings 1–10, 65% for buildings 11–20, 80% for buildings 21–30 (`generateCourse`, `rooftopChase.ts:283`).

| Prop | Appearance | Correct response | Wrong response |
|------|-----------|-----------------|----------------|
| `hazard` (spike post) | Iron post, amber stripe, glowing tip | Jump over (airborne) | −12 lead, 480 ms stumble |
| `mook` (guard) | Armored guard with polearm | Stomp (best) or jump over | −12 lead, 480 ms stumble |
| `lowbar` (banner) | Swaying cloth banner | Slide under | −12 lead, 480 ms stumble |

Prop distribution (from `generateCourse`): hazard 40%, mook 35%, lowbar 25% (unchanged).

**Mook interactions now have two distinct outcomes:**
- **Stomp** (descending onto mook head): `result = 'stomp'` → +STOMP_LEAD_GAIN + chain bonus, bounce. `justStomped = true`.
- **Jump-over** (airborne, non-stomping): `result = 'clear'` → +`MOOK_JUMP_LEAD_GAIN = 3` lead. `justJumpedMook = true`.

Stomped mooks are tracked in `state.defeatedPropIds` and animated out with the `rooftop-mook-defeat` keyframe — they do not re-trigger collisions.

### Chaser and lead

The chaser activates at `CHASER_SPAWN_DISTANCE = 120 wu`. Lead starts at `LEAD_START = 50` (the maximum). Once active:

| Event | Lead delta |
|-------|-----------|
| Passive chaser drain | −4.5 per second |
| Stumble | −12 (instant) |
| Stomp | +9 (+ chain bonus) |
| Dash | +16 (instant) |
| **Clean slide (lowbar)** | **+5** *(was +1)* |
| **Jump over mook (non-stomp)** | **+3** *(new)* |
| **Surge beyond 400 wu** | **−3 per surge** *(new)* |

Lead is clamped to [0, 50]. When lead reaches 0, the run ends.

**Chain-stomp bonus:** Each consecutive stomp without landing adds `STOMP_CHAIN_BONUS = 2` extra lead on top of the base gain. First stomp: +9. Second: +11. Third: +13. Chain resets on any roof landing. `stompFlashMs` scales with the chain — the flash duration is `500 + 150 × stompChain` ms, and the flash text grows to `text-sm` at chain ≥ 2.

**Surge drama:** The chaser visually lunges every 40 wu of distance for 1200 ms (`SURGE_INTERVAL_WU`, `SURGE_DURATION_MS`). The lunge is a sine-offset on `chaserX`. **Beyond `SURGE_REAL_DRAIN_START = 400 wu`**, each surge also drains `SURGE_REAL = 3` lead — making late-game surges genuinely threatening rather than purely theatrical (`rooftopChase.ts:987`).

**Near-miss:** If the hero dashes or stomps while `lead < NEAR_MISS_LEAD_THRESHOLD (12)`, `justNearMiss` fires for one frame, triggering "CLOSE CALL!" text and a nearMiss SFX.

**Chaser world position:** Derived each frame from `state.lead` via `chaserWorldPos()` (`rooftopChase.ts:430`). The chaser is `(lead / LEAD_MAX) × CHASER_MAX_GAP (28 wu)` behind the hero's foot. When over a gap, it follows a parabolic arc between rooftops for dramatic leaping visuals.

### Scoring
`chaseScore(distance) = clamp(distance / 600, 0, 1)`. Score is live-updated each frame. On completion, the final score is passed through `onRunDone → RooftopChase → onFinish → store.completeTrial`. Star thresholds from the trials reward system: 3★ ≥ 0.75, 2★ ≥ 0.40, 1★ < 0.40.

### Course generation
`generateCourse(rng, 30)` (`rooftopChase.ts:243`) produces a deterministic sequence of buildings:
- Building 0: grace platform (22 wu wide, flat, no props).
- Buildings 1–29: varied width (10–28 wu), roof elevation stepping ±1 level through `ROOF_LEVELS = [0, 2.5, 5]` wu, with gaps sized 4–12 wu (clamped by `maxClearableGap()` at 85% safety margin). Prop probability ramps from 50% to 80% across the course.

RNG is now the `seededRng` function exported from `rooftopChase.ts:173`. The seed (`Date.now()`) is fixed at mount time (`useChaseLoop.ts:37`), so a run is deterministic from the moment it starts.

### Player-stat integration
No character stats directly affect Rooftop Chase physics. The trial is a pure skill challenge. The stat connection is thematic (AG trial) and economic (the reward feeds back into the character's AG progression and XP).

---

## 5. Technical Implementation

### File map

| File | Role |
|------|------|
| `src/engine/trials/rooftopChase.ts` | Pure sim engine (1058 lines). All constants, types, course generation, physics, collision, lead, and the `stepChase` reducer. Exports `seededRng`. No React, no store. |
| `src/hooks/useChaseLoop.ts` | RAF clock hook (108 lines). Owns the timing loop, keyboard event listeners, and edge-triggered input buffer. Calls `stepChase` each frame. Stops the RAF loop when `state.done`; does **not** call any callback — the component watches `state.done`. |
| `src/hooks/useChaseAudio.ts` | Audio side-effect hook (105 lines). Reads one-frame flags from `ChaseState` and fires Web Audio cues each frame. Drives the adaptive tension drone. Handles `dodge`, `ledgeCatch`, and `chaseWin` cues. |
| `src/components/trials/games/RooftopChase.tsx` | Run lifecycle manager + renderer (1093 lines). Two exported layers: outer `RooftopChase` (manages `runKey`, result overlay, submit/restart) and inner `RooftopChaseRun` (hooks + all game rendering). |
| `src/components/trials/TrialModal.tsx` | Modal shell. Routes `trialId === 'rooftop_chase'` to `<RooftopChase onFinish={onFinish} />`. Applies `max-w-xl` to accommodate the 500 px wide viewport. |
| `src/engine/trials/trials.ts` | Trial registry. Defines `rooftop_chase` with `stat: 'AG'`, name, blurb, and glyph. |
| `src/engine/__tests__/rooftopChase.test.ts` | Unit test suite (787 lines, 79 tests). Tests initChase, stepChase (physics, jumps, dash, chaser, scoring, stomp chains, chain-reset-on-landing, ledge-catch, new event flag hygiene for `justSlideClear`/`justJumpedMook`/`justLedgeCaught`). |
| `src/engine/trials/__tests__/trials.test.ts` | Shared trials test suite. Contains `rooftopChase` describe block. |
| `src/index.css` | CSS keyframe animations (lines 431–526). All `rooftop-*` keyframes including `rooftop-pounce` and `rooftop-slide-streak` (added). Respects `prefers-reduced-motion`. |
| `src/lib/sfx.ts` | Shared Web Audio SFX library. Provides `play(cue)`, `startDrone()`, `stopDrone()`, `spikeDrone()`, `setDroneIntensity()`. Chase-specific cues: `dodge`, `ledgeCatch`, `chaseWin` (all new). |

### Key functions

**`seededRng(seed)`** (`rooftopChase.ts:173`) — Exported LCG factory. Returns a `() => number` in [0, 1). Used by `initChase` and exported so `useChaseLoop` and the test suite share the same implementation.

**`initChase(rng)`** (`rooftopChase.ts:688`) — Returns a blank `ChaseState` with a procedurally generated course. All three new flags (`justSlideClear`, `justJumpedMook`, `justLedgeCaught`) are initialized to `false`.

**`stepChase(state, input, dtSec)`** (`rooftopChase.ts:741`) — The core pure reducer. Returns a new `ChaseState`. Returns the same object reference immediately when `state.done` is true. Sets all six new one-frame flags in the appropriate paths.

**`generateCourse(rng, count)`** (`rooftopChase.ts:243`) — Produces the array of `Building` objects. Enforces gap safety margins. Prop probability now three-tiered: 50%/65%/80% by building index.

**`hasFallen(buildings, heroLeftX, heroY, heroVy)`** — Determines whether the hero has plunged irrecoverably into a gap. Uses `supportingBuilding` (≥25% overlap) plus the ledge-catch path via `touchingBuilding`.

**`resolveContact(heroY, heroVy, sliding, prop, roofY)`** — Classifies a prop collision as `stomp`, `stumble`, or `clear`. Now uses a `switch` with a TypeScript `never` exhaustiveness guard on `prop.kind`, preventing silent misses when new prop types are added.

**`chaserWorldPos(heroFootX, lead, buildings)`** — Derives the chaser's screen-ready world coordinates from `lead`. Returns `{ x, y, airborne }` with parabolic arc interpolation over gaps.

**`useChaseLoop()`** (`useChaseLoop.ts:32`) — No longer accepts an `onFinish` callback. Mounts once. Runs the RAF loop, handles keyboard events, and returns `{ state, controls }`. The RAF loop stops on `state.done` without side effects — the component is responsible for detecting completion and deciding when to submit.

### Component split: outer and inner

**`RooftopChase` (outer)** (`RooftopChase.tsx:1026`): Manages `runKey` and `runResult` state. Renders `<RooftopChaseRun key={runKey} onRunDone={setRunResult} />`. When `runResult` is non-null, overlays the result panel. "Run Again" increments `runKey` (remounts the inner component, fresh hooks, fresh RNG seed). "Accept Score" calls `onFinish(runResult.score)`.

**`RooftopChaseRun` (inner)** (`RooftopChase.tsx:440`): Mounts `useChaseLoop()` and `useChaseAudio()`. Runs all game rendering. Watches `state.done` via a per-render effect; calls `onRunDone` (via a stable ref to avoid stale closures) after an outcome-appropriate delay (650 ms / 450 ms / 200 ms for fell / caught / win).

### State management

All simulation state lives in `ChaseState` — a plain serializable struct. The hook holds it in a `stateRef` (updated every frame without triggering React) and a `renderState` (set via `useState` once per frame to drive re-renders). There is no mid-run communication with the Zustand store; the store is only touched at run end via `onFinish → completeTrial`.

One-frame event flags (`justLanded`, `justStomped`, `justSlideClear`, `justJumpedMook`, `justLedgeCaught`, etc.) are cleared at the top of every `stepChase` call and re-set only if the event occurs that frame. This makes them safe to edge-detect in `useChaseAudio` and the render layer with simple `if (state.justX && !prevX.current)` guards.

### Data flow

```
useChaseLoop (RAF) ──stepChase──▶ stateRef ──setRenderState──▶ renderState
                                                                      │
                                          RooftopChaseRun.tsx  ◀─────┘
                                          useChaseAudio.ts     ◀─────┘
                                                │
                                     onRunDone (after delay)
                                                │
                                        RooftopChase (outer)
                                                │
                                    result overlay / onFinish
```

### Save / load
No in-progress save. If the player closes the modal mid-run, the run is lost. Completed trial scores are persisted through `store.completeTrial`, which writes to `trialsClearedOn` and the best-score record in the Zustand store (localStorage-backed). Because `completeTrial` is a no-op if the trial was already cleared today, only the first "Accept Score" submission per day affects the stored score.

### Configuration constants
All tuning lives as named exports at the top of `rooftopChase.ts` (lines 10–155). Every constant is individually exported, enabling direct test assertions. Notable recent additions: `MOOK_JUMP_LEAD_GAIN = 3`, `SURGE_REAL_DRAIN_START = 400`, `SURGE_REAL_DRAIN = 3`. `SLIDE_LEAD_GAIN` raised from `1` to `5`.

---

## 6. Software, Libraries, and Tools Used

| Category | Technology |
|----------|-----------|
| Framework | React 18 |
| Language | TypeScript |
| Build tool | Vite |
| State management | Zustand (store); plain `useState` / `useRef` (in-run) |
| Styling | Tailwind CSS + inline `style` props |
| Animation | CSS `@keyframes` in `src/index.css`; React `style.animation` strings |
| Rendering | Browser DOM (no canvas, no WebGL) |
| Physics | Custom Euler integrator in pure TypeScript |
| Audio | Web Audio API via `src/lib/sfx.ts` (synthesized; no audio files) |
| Testing | Vitest |
| Asset pipeline | None — all art is procedural (CSS shapes and inline-style divs) |
| Third-party libraries | None specific to this minigame |

---

## 7. Assets and Presentation

### Visual style
Dark medieval-fantasy night scene. The sky grades from near-black deep blue at the top through purple to a warm horizon tint (`skyBottom` varies with scroll speed). A moon hangs in the upper-right with a bloom glow. A cloud layer of four soft-edged blobs adds atmospheric depth at a 3% parallax rate.

### Background layers (parallax)

| Layer | Scroll rate | Content |
|-------|------------|---------|
| Far (6%) | Castle silhouette (`CASTLE_TOWERS` array) | Deep purple-black |
| Mid (22%) | Smaller building ridgeline (`MID_BUILDINGS`) | Dark plum gradient |
| Clouds (3%) | 4 rounded blobs (`CLOUDS` array) | Semi-transparent purple-white |
| Foreground (135%) | Brick chimneys (`CHIMNEYS`) | Near-depth scroll overshoot |

### Sprites (all procedural CSS)
- **HeroSprite** (`RooftopChase.tsx:113`): 24×38 px standing, 34×18 px sliding. Purple cloak, auburn tunic, leather boots. Legs animate with `rooftop-leg-f/b` keyframes; body bobs with `rooftop-run`. Squash on landing (`rooftop-land`). Fall tumble (`rooftop-fall`). Opacity 35% while stumbling. **Sliding form now emits a streak:** a 26×16 px left-trailing gradient div with the `rooftop-slide-streak` keyframe (opacity 0 → 0.65 → 0, scaleX 0.2 → 1 → 1, translateX drift). This fires fresh on each slide because React unmounts/remounts `HeroSprite` when `sliding` toggles.
- **ChaserSprite** (`RooftopChase.tsx:214`): 38×30 px. Dark beast with four animated claws. Eyes glow orange normally, shift brighter red with stronger `box-shadow` at `danger` (lead < 25%). Tilts 18° forward when airborne over a gap. **New: `pouncing` prop** — when `state.done && lead <= 0`, plays `rooftop-pounce` animation (translateX + scale + rotate arc, 0.5 s ease-in forwards), freezing claw animations during the pounce.
- **HazardSprite** (`RooftopChase.tsx:301`): Iron spike post with amber stripe and glowing triangular tip. `drop-shadow` filter adds ambient glow. Width scales with prop width.
- **MookSprite** (`RooftopChase.tsx:319`): 26×42 px armored guard. Blue-grey plate armor, helmet with red eye slits, polearm. Animated out with `rooftop-mook-defeat` on stomp.
- **LowbarSprite** (`RooftopChase.tsx:353`): Two wooden posts with a swaying cloth banner (`rooftop-banner` keyframe). Width scales.
- **BuildingView** (`RooftopChase.tsx:384`): Per-building facade with parapet, mortar-joint stone tile pattern (animated background-position for scroll parallax), arched windows, and eave drips at each side. **New: `nextRoofY` prop** — when the next building's roofY differs from the current building's, a colored nub (4px wide, 8px tall) is rendered on the right edge of the rooftop cap: **orange** (`#f97316`) when the next building is higher, **sky-blue** (`#38bdf8`) when lower. This gives players an advance visual warning of upcoming elevation changes.

### Particle effects
- **Dust puffs:** Circular amber div with `rooftop-dust` keyframe. Spawn on hero landing (`justLanded`), stomp (`justStomped`), dash start (`justDashed`), and chaser landing (falling-edge on `chaserAirborne`).
- **Speed lines / streaks:** Horizontal gradient divs behind the hero, animated with `rooftop-streak` (normal) or `rooftop-dash` (dash, wider and gold). Streak count and opacity scale with current speed fraction.
- **Slide streak:** Horizontal gradient div inside `HeroSprite`'s sliding form, using `rooftop-slide-streak` keyframe.

### Screen effects
- **Surge vignette:** `inset box-shadow` on the play area, red, scaled by `surgeFlash` (a lerped value from `state.surgeMs`).
- **Chaser pounce:** `rooftop-pounce` keyframe on `ChaserSprite` when caught (`pouncing` prop).
- **Dash cooldown pip:** 28×3 px amber bar below the hero sprite, fills left-to-right as cooldown recovers.

### CSS keyframes (all in `src/index.css`, lines 431–526)
`rooftop-run`, `rooftop-leg-f`, `rooftop-leg-b`, `rooftop-cloak`, `rooftop-land`, `rooftop-chaser`, `rooftop-claws-f`, `rooftop-claws-b`, `rooftop-banner`, `rooftop-dust`, `rooftop-streak`, `rooftop-dash`, `rooftop-mook-defeat`, `rooftop-fall`, `rooftop-cloud`, **`rooftop-pounce`** (new), **`rooftop-slide-streak`** (new). All suppressed by `[class*="rooftop-"] { animation: none !important; }` under `prefers-reduced-motion`.

### Audio (all synthesized)
All sound is generated via the Web Audio API in `src/lib/sfx.ts`. No audio files. Cues fired during the chase:

| Cue | Trigger |
|-----|---------|
| `jump` | First jump from ground |
| `doubleJump` | Mid-air second jump |
| `land` | Hero lands on a roof |
| `stomp` | Successful stomp on a mook |
| `dash` | Dash activated |
| `stumble` | Hero hits an obstacle wrong |
| `fall` | Hero drops into a gap |
| `growl` | Chaser first activates |
| `surge` | Chaser surge begins |
| `nearMiss` | Recovery action at low lead |
| **`dodge`** | **Clean mook jump-over or clean lowbar slide** *(new)* |
| **`ledgeCatch`** | **Hero catches a roof lip** *(new)* |
| **`chaseWin`** | **Distance reaches 600 wu** *(replaces generic `win`)* |

**Adaptive tension drone:** Starts on chaser activation, stops on run end. Intensity driven by `1 - (lead / LEAD_MAX)` each frame. `spikeDrone()` briefly raises intensity during surges.

---

## 8. Current Player Experience

### What works well

**Feel and momentum.** The speed ramp gives a genuine sense of escalating danger. Reaching high speeds late in a run feels earned and exciting. The dash and stomp are tactile; the SFX, speed lines, and dust puffs make each action feel punchy.

**All three obstacle types now offer meaningful reward.** Sliding under a lowbar now awards +5 lead — comparable to blocking roughly one second of chaser drain. Jumping over a mook without stomping awards +3. Together with the stomp chain (+9 to +13+) and dash (+16), every successful interaction gives the player a measurable lead benefit.

**Chaser theatrics.** The surge system creates alarm without penalizing skilled play. The beast's parabolic leaps over gaps look dramatic. Eye-glow at low lead is a subtle but effective cue. Late-game surges (beyond 400 wu) now also drain real lead, maintaining their impact for experienced players.

**Prop density ramp.** The early 50% building fill feels approachable; the late-game 80% density makes the final stretch feel genuinely hectic. This creates a natural arc without requiring separate difficulty modes.

**Height telegraph.** The colored nub on each building's right edge gives players a one-building advance warning of elevation changes. Orange means jump higher, blue means a lower landing is coming. At high speeds, this makes the difference between a reactive stumble and a planned response.

**Restart without modal navigation.** The result overlay's "Run Again" button remounts the inner component with a new seed immediately. Players who fall early or get caught can attempt again in under a second.

**Opening tip overlay.** New players see the controls prominently at run start — then the tip fades before the action gets intense (at the 120 wu chaser spawn, the hero is well past the 3 s tip window).

**In-viewport dash cooldown.** The pip below the hero lets players track dash availability without looking at the button panel. It only appears when the chaser is active (when it matters most) and when the dash is not ready.

**Audio tension arc.** The drone scaling with lead is a strong design choice. The new `chaseWin` fanfare (ascending 5-note run with sustained chord) distinguishes a successful escape from a generic win cue.

**Ledge-catch acknowledgment.** The `justLedgeCaught` flag drives both a "GRAB!" flash and a distinct SFX (`ledgeCatch`) — a descending triangle tone that sounds like a clutch grip. Previously, a successful ledge-catch was silent.

**Chain-stomp visual scaling.** The stomp flash label grows with the chain counter and stays on screen longer for high chains, proportionally acknowledging a skilled streak.

**Clean architecture.** The pure `stepChase` reducer with one-frame event flags remains easy to test and reason about. `useChaseAudio` is isolated cleanly. The outer/inner component split is clear: one manages lifecycle, one manages rendering.

### What feels unfinished or awkward

**No death variety.** All falls trigger the same outcome instantly. There is no catch mechanic or brief scramble opportunity, making gap deaths feel abrupt — though the result overlay now at least shows "FELL!" vs. "CAUGHT!" distinctly.

**Surge is still cosmetic before 400 wu.** The early game's surges have no mechanical weight. Experienced players know to ignore them until the distance threshold.

**Prop variety ceiling.** Only three prop types exist. After a few runs, the player has seen every challenge pattern. There is no equivalent of the Arena's named-boss variants or the Ancient Library's different puzzle categories.

**No mobile touch slide gesture.** The on-screen Slide button works, but swipe-down (natural mobile input for "duck") is not mapped.

---

## 9. Known Issues or Weak Points

**No difficulty tiers.** The course is the same statistical difficulty on the first attempt and the hundredth. The prop density ramp improves the arc, but there is no mechanic equivalent to the Arena's phase progression or the Lockpicking's tumbler complexity scaling. A skilled player settles into a reliable execution pattern across runs.

**Prop variety ceiling.** Only three prop types exist. After a few runs, the player has seen every challenge. There is no equivalent of the Arena's named-boss subtypes, mook variants, or the Ancient Library's different puzzle categories.

**Surge is cosmetic before 400 wu.** The early game's surges carry no mechanical penalty. Once players understand this, surges lose psychological impact until the late-game drain kicks in. A graduated approach (small drain starting earlier) could close this gap.

**No mobile swipe-down for slide.** The Slide button works on touch, but swipe-down — a natural mobile gesture for "duck" — is not bound. This makes mobile play less ergonomic.

**Reward curve not verified.** The `trialReward` formula's interaction with the Rooftop Chase score distribution is not analyzed in the engine. It is unclear whether a typical ~300 wu run (50%, 2★) generates a proportionate AG reward vs. a 3★ performance.

**Test suite chain-stomp integration is still partially injection-based.** The chain-stomp tests in the updated `rooftopChase.test.ts` verify flag hygiene and chain-reset-on-landing via physics injection (setting `heroY`, `prevHeroY`, `heroVy`). The full stomped-mook collision path (mid-air descent onto a mook prop) is not integration-tested due to the complexity of crafting the exact position state. The tests note this inline.

---

## 10. Remaining Improvement Opportunities

*(Items implemented in the recent session are omitted. This section covers only what remains.)*

**Obstacle variety expansion.** Add new prop types or mook sub-variants. Possible additions: a moving guard requiring timing, a low-overhead hazard requiring jump-and-slide, an elevated spike requiring a higher-arc jump. This is the highest remaining impact improvement — current prop variety is fully explored after a few runs.

**Mobile swipe-down for slide.** Map touch swipe-down to the slide action in `useChaseLoop.ts`'s keyboard handler or via a `onTouchStart`/`onTouchEnd` listener on the play area div. Low effort, high payoff for mobile players.

**Reward curve audit (AG stat display).** Verify that the `trialReward` formula produces appropriate AG gains for the Rooftop Chase score distribution. Consider adding the player's current AG trial best score to the TrialsView tile so players know what they're aiming to beat.

**Daily countdown on TrialsView.** Show a per-trial countdown to daily reset on already-cleared trials, so players know when they can re-attempt.

**Art data extraction.** The `CASTLE_TOWERS`, `MID_BUILDINGS`, `CHIMNEYS`, and `CLOUDS` arrays are inline constants in `RooftopChase.tsx`. These could move to a shared `src/lib/scenes.ts` or adjacent data file, consistent with how other minigames handle their art config. Low priority but improves readability.

**Graduated surge penalty.** Instead of a hard threshold at 400 wu, linearly ramp the surge lead drain from 0 at 200 wu to the full 3 per surge at 600 wu. This gives experienced players a smoother escalation rather than a step-change.

---

## 11. Questions and Unknowns

**What score does an average first-time player achieve?** There is no telemetry visible in the codebase. Without this, it is unknown whether the 2★ threshold (240 wu, 40%) is appropriately challenging or too easy/hard for new players. The improved feedback (flash labels, height telegraph, tip overlay) should help first runs, but the optimal threshold cannot be determined without play data.

**Is the building count (30) always sufficient?** A perfect run reaches approximately building 24 by 600 wu. The comment in `generateCourse` states this with "a comfortable margin," but this margin has not been verified across all seeds. With the increased late-game prop density (80% for buildings 21+), building width constraints mean more buildings may be prop-free — it is worth verifying that building 30 is never reached before 600 wu in any seeded run.

**What happens on a second daily completion?** The daily gate is enforced in `TrialModal`'s `handleFinish`. `store.completeTrial` is a no-op if the trial is already cleared today (returns early without updating the best score). The "Accept Score" button in the result overlay still calls `onFinish`, which still invokes `completeTrial` — the no-op behavior is correct but not communicated to the player. A locked "Already submitted today" state on the "Accept Score" button could make this clearer.

**Are there color-blind accessibility gaps?** The lead bar uses red/yellow/green color to communicate danger, and the height telegraph uses orange/blue. The chaser's eye-glow shifts color at low lead. These are all color-only cues with no shape or pattern fallback. This may be an issue for players with red-green or blue-yellow color deficiencies.

**Seeded RNG traceability.** The seed is `Date.now()` at mount — it is not surfaced to the player or stored anywhere. A bug tied to a specific course layout cannot be reproduced. Logging the seed to the console in development builds would be a low-cost improvement for debugging.
