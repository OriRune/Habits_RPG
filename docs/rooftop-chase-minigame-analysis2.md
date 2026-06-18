# Rooftop Chase — Minigame Analysis

*Based on the current codebase as of June 2026. All citations are to production files.*

---

## 1. Basic Summary

Rooftop Chase is a side-scrolling endless runner and one of the eight daily Skill Trials. It is the **Agility (AG)** trial. The player controls a cloaked hero sprinting across the rooftops of a procedurally-generated medieval town at night. The rooftops are at varying heights and separated by lethal gaps; falling into any gap ends the run immediately. After covering 120 world-units (wu), a beast chaser appears behind the hero and closes in at a steady rate. The player must run far enough to score well, using jumps, slides, and dash bursts to navigate obstacles and keep the chaser at bay. A perfect run requires covering 600 wu, which takes roughly 60–120 seconds of clean play.

The trial is registered in `src/engine/trials/trials.ts` as `rooftop_chase` with stat `AG`. It is one of eight trials playable once per calendar day, gated by `trialsClearedOn`. Completing it calls `store.completeTrial('rooftop_chase', score01)`, which applies a reward and updates the best score for the AG trial.

---

## 2. Core Game Loop

### Start
`initChase(rng)` in `src/engine/trials/rooftopChase.ts:659` generates a 30-building course and returns a fresh `ChaseState`. The hero begins at distance 0 on a wide grace platform (22 wu, no props, no chaser). The run loop (`useChaseLoop`, `src/hooks/useChaseLoop.ts`) starts a `requestAnimationFrame` loop immediately on mount.

### During play
Every RAF frame the hook calls `stepChase(state, input, dtSec)` — the pure simulation reducer at `rooftopChase.ts:709`. The reducer:

1. Ticks all countdown timers (stumble, slide, dash, stomp flash).
2. Processes edge-triggered input (jump, slide, dash) — each flag is true for exactly one frame.
3. Advances `state.distance` at the current scroll speed (which ramps up over time).
4. Applies semi-implicit Euler gravity to `heroY` and `heroVy`.
5. Resolves landing and ledge-catch logic.
6. Checks `hasFallen()` — a gap fall ends the run immediately.
7. Scans for prop collisions and resolves contact (stomp / stumble / clear).
8. Updates the chaser lead (`updateLead`), chain-stomp bonuses, and surge drama.
9. Updates chaser world position from lead value.
10. Checks terminal conditions (lead ≤ 0 or distance ≥ 600).

The resulting `ChaseState` is set on React state, causing a re-render of the `RooftopChase` component (a pure renderer).

### Challenge escalation
Scroll speed ramps linearly from 4 wu/s at the start to a hard cap of 10 wu/s at 600 wu (`BASE_SPEED = 4`, `SPEED_RAMP = 0.010`, `MAX_SPEED = 10` — see `rooftopChase.ts:19–30`). Faster speed means tighter reaction windows for obstacles and shorter effective air time for jumps. The chaser provides continuous time pressure once it activates.

### End conditions
The run ends in one of three ways:
- **Fall:** hero drops into a gap (`hasFallen()` returns true). `justFell` is set; the fall animation plays for 600 ms before `onFinish` is called (`useChaseLoop.ts:97–100`).
- **Caught:** lead drains to 0. `done = true`, "CAUGHT! 🐺" banner is displayed.
- **Win:** distance reaches 600 wu. `done = true`, score = 1.0.

### Reward
The parent component calls `store.completeTrial('rooftop_chase', score01)`. Score is `distance / 600`, clamped to [0, 1]. Star thresholds (defined in the trial reward logic): 1★ below 40%, 2★ at 40%+ (240 wu), 3★ at 75%+ (450 wu).

---

## 3. Player Controls and Interaction

### Input controls

| Action | Keyboard | On-screen button |
|--------|----------|-----------------|
| Jump / double-jump | Space, ArrowUp | ↑ Jump button |
| Slide (duck under lowbar) | ArrowDown, S | ↓ Slide button |
| Dash (speed burst) | Shift (L or R), D | ⚡ Dash button |
| Jump (alt) | Click anywhere on play area | — |

Key auto-repeat is suppressed (`e.repeat` check in `useChaseLoop.ts:60`) so holding Space does not trigger a double-jump.

### UI elements

**Play area** (`VIEW_W = 500px`, `VIEW_H = 260px`): The main viewport. The hero is pinned at `HERO_X_PX = 150px` from the left (30% of view); the world scrolls past. Contains:
- Three parallax background layers (far castle, mid buildings, foreground chimneys).
- `BuildingView` sub-components for each visible roof.
- `HeroSprite`, `ChaserSprite`, `HazardSprite`, `MookSprite`, `LowbarSprite` sub-components (all procedural SVG-in-CSS).
- Speed lines (streaks flying left behind the hero, gold during dash).
- Dust puffs on landing, stomps, and chaser landings.
- Surge vignette: red edge glow pulsing when the beast lunges.
- Slide / Dash state labels (top-left of play area).
- Distance HUD: `[distance]/{CHASE_TARGET_DISTANCE}m` (top-right).
- Speed readout when above 15% of max speed (bottom-right).
- Mute toggle button (top-left).
- "⚠ Something stalks you…" warning when approaching chaser spawn (>70% of 120 wu).
- "CLOSE CALL! ⚡" gold banner on near-miss events (low lead + dash or stomp recovery).
- "CAUGHT! 🐺" full-screen overlay when lead hits 0.
- "STOMP x{n}! ⚔" flash for stomp chains.

**Lead bar** (below play area): Shown only when `chaserActive`. A progress bar from red (close) through yellow to green showing the hero's current lead fraction. A 🐺 emoji icon tracks the fill edge. Pulses when lead < 25%. Before chaser spawns, a neutral "Keep running…" bar shows spawn progress.

**Control buttons** (below lead bar): Jump (gold), Slide (blue), Dash (amber). Dash button dims and shows a right-to-left wipe overlay during cooldown. Score percentage shown bottom-left of the button row.

**Instructions text** (top of component): Single line listing all keybindings.

### Player feedback summary
- One-frame event flags in `ChaseState` drive audio cues via `useChaseAudio`.
- Landing triggers a squash animation (`rooftop-land`), dust puff, and land SFX.
- Stomps trigger a flash label, bounce velocity, and stomp SFX.
- Stumbles trigger a 480 ms opacity fade on the hero sprite and stumble SFX.
- Dashes trigger gold speed lines, a "DASH!" label, and dash SFX.
- Chaser surge triggers a red vignette pulse and surge SFX.
- Near-miss (low lead + recovery action) triggers "CLOSE CALL!" + nearMiss SFX.

---

## 4. Mechanics and Systems

### Speed and distance
Scroll speed at any moment: `speedAt(d) = min(10, 4 + 0.010 × d)`. Speed starts at 4 wu/s and reaches the 10 wu/s cap exactly at the 600 wu finish. The `DASH_SPEED_BONUS = 0.4` multiplier applies on top of the current scroll speed during the 380 ms dash window, advancing distance 40% faster.

### Jump physics
- **Gravity:** 32 wu/s² downward.
- **Jump:** `JUMP_VELOCITY = 22 wu/s` upward. Air time ≈ 1.375 s. Apex ≈ 7.6 wu (61 px at 8 px/wu).
- **Double-jump:** `DOUBLE_JUMP_VELOCITY = 18 wu/s` (slightly weaker). Available any time the hero is airborne with `jumpsUsed < 2 (MAX_JUMPS)`.
- **Ledge-catch:** If the hero's leading edge has entered the next building while descending and is within `LEDGE_CATCH_TOL = 2.0 wu` of the surface, the hero is snapped to the roof rather than registering a fall. Prevents frustrating near-misses on tight gap landings (`rooftopChase.ts:346–391`).
- **Landing support:** A hero is considered "grounded" only when `LANDING_SUPPORT_FRAC (25%) × HERO_HITBOX_W (2.2 wu)` = at least 0.55 wu of their hitbox overlaps a building. This prevents edge-clipping bugs while still being forgiving.

### Obstacles (props)

Each building has a 65% chance of holding one prop, placed at least 3 wu from each edge:

| Prop | Appearance | Challenge | Correct response | Wrong response |
|------|-----------|-----------|-----------------|----------------|
| `hazard` (spike post) | Iron post with amber stripe + glowing tip | Must be cleared by being **airborne** | Jump over | −12 lead, 480 ms stumble |
| `mook` (guard) | Armored guard with polearm | Jump over or **stomp** descending onto head | Stomp (best) or jump over | −12 lead, 480 ms stumble |
| `lowbar` (banner) | Swaying cloth banner hung between posts | Must be cleared by **sliding** | Slide under | −12 lead, 480 ms stumble |

Prop distribution (from `generateCourse`, `rooftopChase.ts:260–265`): hazard 40%, mook 35%, lowbar 25%.

Stomped mooks are tracked in `state.defeatedPropIds` and animated out with the `rooftop-mook-defeat` keyframe — they do not re-trigger collisions.

### Chaser and lead

The chaser activates at `CHASER_SPAWN_DISTANCE = 120 wu`. Lead starts at `LEAD_START = 50` (the maximum). Once active:

| Event | Lead delta |
|-------|-----------|
| Passive chaser drain | −4.5 per second |
| Stumble | −12 (instant) |
| Stomp | +9 (+ chain bonus) |
| Dash | +16 (instant) |
| Clean slide (lowbar) | +1 |

Lead is clamped to [0, 50]. When lead reaches 0 the run ends.

**Chain-stomp bonus:** Each consecutive stomp without landing adds `STOMP_CHAIN_BONUS = 2` extra lead on top of the base gain. First stomp: +9. Second: +11. Third: +13. Chain resets on any roof landing (`stompChain` in `ChaseState`).

**Surge drama:** The chaser visually lunges every 40 wu of distance for 1200 ms (`SURGE_INTERVAL_WU`, `SURGE_DURATION_MS`). The lunge is purely visual (a sine-offset on `chaserX`) — it does not reduce actual `state.lead`. The beast icon closes in and recedes over the surge window, creating alarm without punishing the player. Audio fires a surge SFX and drone spike.

**Near-miss:** If the hero dashes or stomps while `lead < NEAR_MISS_LEAD_THRESHOLD (12)`, `justNearMiss` fires for one frame, triggering "CLOSE CALL!" text and a nearMiss SFX.

**Chaser world position:** Derived each frame from `state.lead` via `chaserWorldPos()` (`rooftopChase.ts:430`). The chaser is `(lead / LEAD_MAX) × CHASER_MAX_GAP (28 wu)` behind the hero's foot. When the chaser is over a gap, it follows a parabolic arc between rooftops, scaled by gap width for dramatic leaping visuals.

### Scoring
`chaseScore(distance) = clamp(distance / 600, 0, 1)`. Score is live-updated each frame. On completion, the final score is passed to `store.completeTrial`. Star thresholds from the trials reward system: 3★ ≥ 0.75, 2★ ≥ 0.40, 1★ < 0.40.

### Course generation
`generateCourse(rng, 30)` (`rooftopChase.ts:219`) produces a deterministic sequence of buildings:
- Building 0: grace platform (22 wu wide, flat, no props).
- Buildings 1–29: varied width (10–28 wu), roof elevation stepping ±1 level through `ROOF_LEVELS = [0, 2.5, 5]` wu, with gaps sized 4–12 wu (clamped by `maxClearableGap()` at 85% safety margin, tighter when going uphill).

A different RNG seed each run (`Math.random` in `useChaseLoop.ts:38`) means no two runs have the same layout.

### Player-stat integration
No character stats directly affect Rooftop Chase physics. The trial is a pure skill challenge. The stat connection is thematic (AG trial) and economic (the reward feeds back into the character's AG progression and XP).

---

## 5. Technical Implementation

### File map

| File | Role |
|------|------|
| `src/engine/trials/rooftopChase.ts` | Pure sim engine (1006 lines). All constants, types, course generation, physics, collision, lead, and the `stepChase` reducer. No React, no store. |
| `src/hooks/useChaseLoop.ts` | RAF clock hook (118 lines). Owns the timing loop, keyboard event listeners, and edge-triggered input buffer. Calls `stepChase` each frame. Calls `onFinish` on run end. |
| `src/hooks/useChaseAudio.ts` | Audio side-effect hook (107 lines). Reads one-frame flags from `ChaseState` and fires Web Audio cues each frame. Drives the adaptive tension drone. |
| `src/components/trials/games/RooftopChase.tsx` | Pure renderer component (979 lines). Reads `ChaseState` from the loop hook and renders everything. Contains all sprite sub-components and parallax logic. |
| `src/components/trials/TrialModal.tsx` | Modal shell. Routes `trialId === 'rooftop_chase'` to `<RooftopChase onFinish={onFinish} />`. Applies `max-w-xl` (vs. `max-w-sm` for other trials) to accommodate the 500 px wide viewport. |
| `src/engine/trials/trials.ts` | Trial registry. Defines `rooftop_chase` with `stat: 'AG'`, name, blurb, and glyph. |
| `src/engine/__tests__/rooftopChase.test.ts` | Unit test suite (711 lines). Tests initChase, stepChase (physics, jumps, dash, chaser, scoring, stomp chains, ledge-catch, event flag hygiene). |
| `src/engine/trials/__tests__/trials.test.ts` | Shared trials test suite. Contains `rooftopChase` describe block at line 267. |
| `src/index.css` | CSS keyframe animations (lines 403–488). All `rooftop-*` keyframes. Respects `prefers-reduced-motion`. |
| `src/lib/sfx.ts` | Shared Web Audio SFX library. Provides `play(cue)`, `startDrone()`, `stopDrone()`, `spikeDrone()`, `setDroneIntensity()`. |

### Key functions

**`initChase(rng)`** — Returns a blank `ChaseState` with a procedurally generated course. The `rng` parameter is `Math.random` in production (different layout each run).

**`stepChase(state, input, dtSec)`** — The core pure reducer. Takes the current state, one frame of edge-triggered input, and the delta time (capped at 50 ms in the hook). Returns a new `ChaseState`. Does not mutate its argument. Returns the same object reference immediately when `state.done` is true.

**`generateCourse(rng, count)`** — Produces the array of `Building` objects. Enforces gap safety margins via `maxClearableGap()`. Props are placed with 3 wu margin from each building edge.

**`hasFallen(buildings, heroLeftX, heroY, heroVy)`** — Determines whether the hero has plunged irrecoverably into a gap. Uses `supportingBuilding` (≥25% overlap) plus the ledge-catch path via `touchingBuilding`.

**`resolveContact(heroY, heroVy, sliding, prop, roofY)`** — Classifies a prop collision as `stomp`, `stumble`, or `clear`. Pure switch on prop kind and hero state.

**`chaserWorldPos(heroFootX, lead, buildings)`** — Derives the chaser's screen-ready world coordinates from `lead`. Returns `{ x, y, airborne }` with parabolic arc interpolation over gaps.

**`useChaseLoop(onFinish)`** — Mounts once. Runs the RAF loop, handles keyboard events, and returns `{ state, controls }`.

### State management

All simulation state lives in `ChaseState` — a plain serializable struct. The hook holds it in a `stateRef` (updated every frame without triggering React) and a `renderState` (set via `useState` once per frame to drive re-renders). There is no mid-run communication with the Zustand store; the store is only touched at run end via `onFinish → completeTrial`.

One-frame event flags (`justLanded`, `justStomped`, `justDashed`, etc.) are cleared at the top of every `stepChase` call and re-set only if the event occurs that frame. This makes them safe to edge-detect in `useChaseAudio` with simple `if (state.justX && !prevX.current)` guards.

### Data flow

```
useChaseLoop (RAF) ──stepChase──▶ stateRef ──setRenderState──▶ renderState
                                                                      │
                                               RooftopChase.tsx ◀─────┘
                                               useChaseAudio.ts ◀─────┘
```

### Save / load
No in-progress save. If the player closes the modal mid-run, the run is lost. Completed trial scores are persisted through `store.completeTrial`, which writes to `trialsClearedOn` and the best-score record in the Zustand store (localStorage-backed).

### Configuration constants
All tuning lives as named exports at the top of `rooftopChase.ts` (lines 10–155). Every constant is individually exported, enabling direct test assertions. Comments on each constant document the design intent and any prior rebalance history (e.g., `STOMP_LEAD_GAIN` raised from 4 to 9 in Phase 3).

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
| Asset pipeline | None — all art is procedural (CSS shapes + inline SVG-style divs) |
| Third-party libraries | None specific to this minigame |

---

## 7. Assets and Presentation

### Visual style
Dark medieval-fantasy night scene. The sky grades from near-black deep blue at the top through purple to a warm horizon tint (`skyBottom` varies with distance, computed from scroll speed). A moon hangs in the upper-right with a bloom glow.

### Background layers (parallax)
Three tiled layers scroll at different rates past the hero:
- **Far (6% scroll rate):** Castle silhouette with crenellated towers, drawn as absolute-positioned divs from the `CASTLE_TOWERS` data array. Deep purple-black.
- **Mid (22% scroll rate):** Smaller building ridgeline with pitched roofs drawn from `MID_BUILDINGS`. Dark plum gradient.
- **Foreground decorations (135% scroll rate):** Brick chimneys from the `CHIMNEYS` array, scrolling faster than the hero for a near-depth effect.

### Sprites (all procedural CSS)
- **HeroSprite** (`RooftopChase.tsx:105`): 24×38 px (standing), 34×18 px (sliding). Purple cloak, auburn tunic, leather boots. Legs animate with `rooftop-leg-f/b` keyframes; body bobs with `rooftop-run`. Squash-and-stretch on landing (`rooftop-land`). Fall tumble (`rooftop-fall`). Opacity 35% while stumbling.
- **ChaserSprite** (`RooftopChase.tsx:217`): 38×30 px. Dark beast — all near-black gradients with four animated claws. Eyes glow orange (`cc5500`) normally, shift to brighter red (`ff3300`) with a stronger `box-shadow` when `danger` is true (lead < 25%). Tilts forward 18° when airborne over a gap.
- **HazardSprite** (`RooftopChase.tsx:270`): Iron spike post, dark metal with an amber-orange stripe band and glowing triangular tip. `drop-shadow` filter adds ambient glow. Width scales with `widthPx` (the prop's world width in pixels).
- **MookSprite** (`RooftopChase.tsx:308`): 26×42 px armored guard. Blue-grey plate armor, helmet with red eye slits, polearm. Animated out with `rooftop-mook-defeat` on stomp.
- **LowbarSprite** (`RooftopChase.tsx:342`): Two wooden posts with a swaying cloth banner between them. Banner skews with `rooftop-banner` keyframe. Width scales.
- **BuildingView** (inline in `RooftopChase.tsx`): Per-building facade with parapet, mortar-joint stone walls, arched windows (1–3 per building), and wrought-iron lanterns on some roofs.

### Particle effects
- **Dust puffs:** Circular amber div with `rooftop-dust` keyframe (fade-up and scale). Spawn on hero landing (`justLanded`), stomp (`justStomped`), dash start (`justDashed`), and chaser landing (falling-edge on `chaserAirborne`).
- **Speed lines / streaks:** Horizontal gradient divs behind the hero, animated with `rooftop-streak` (normal) or `rooftop-dash` (dash, wider and gold). Streak count and opacity scale with current speed fraction.

### Screen effects
- **Surge vignette:** `inset box-shadow` on the play area, red, scaled by `surgeFlash` (a lerped value from `state.surgeMs`).

### Audio (all synthesized)
All sound is generated via the Web Audio API in `src/lib/sfx.ts`. No audio files exist. Cues fired during the chase:

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
| `win` | Distance reaches 600 wu |

**Adaptive tension drone:** Starts on chaser activation, stops on run end. Intensity driven by `1 - (lead / LEAD_MAX)` each frame — drone is quietest at full lead, loudest when nearly caught. `spikeDrone()` briefly raises intensity during surges regardless of actual lead.

---

## 8. Current Player Experience

### What works well

**Feel and momentum.** The speed ramp gives a genuine sense of escalating danger. Reaching high speeds late in a run feels earned and exciting. The dash and stomp are tactile; the SFX, speed lines, and dust puffs make each action feel punchy.

**Chaser theatrics.** The surge system is well-designed: it creates alarm without actually penalizing skilled play. The beast's parabolic leaps over gaps look dramatic. The eye-glow shift to danger-red at low lead is a subtle but effective visual cue.

**Ledge-catch forgiveness.** The `LEDGE_CATCH_TOL = 2.0 wu` window means slightly mistimed jumps that clip a roof lip still land safely. This avoids the frustrating "clearly on the building but registered as a fall" failure mode common in this genre.

**Chain-stomp rewards.** Consecutive stomps in mid-air chain together for increasing lead gains. A skilled player bouncing across a building full of guards can recover significant lead, creating a high-skill reward path alongside the simpler dash.

**Audio tension arc.** The drone that scales with lead — from silent at full lead to intense when nearly caught — is a strong design choice. Players feel the escalating danger without looking at the lead bar.

**Clean architecture.** The pure `stepChase` reducer with one-frame event flags makes the engine easy to test and reason about. `useChaseAudio` is isolated cleanly. The component has no game logic.

### What feels unfinished or awkward

**Slide is weak.** The slide rewards +1 lead for a clean banner clear, which is nearly imperceptible compared to the chaser's 4.5/s drain. Sliding under a lowbar feels more like "didn't fail" than a meaningful action. There is no visual or audio payoff for a clean slide comparable to what a stomp or dash delivers.

**Mook jumping (non-stomp) is dead interaction.** If the hero jumps over a mook without stomping, nothing happens — no reward, no acknowledgment. This makes mooks feel like spikes with extra steps unless the player is actively trying to chain stomps.

**No telegraph for building heights.** The hero must react to rooftop elevation changes as they arrive. There is no visual indicator of what the next building's height will be (e.g., an arrow, a different roofline color, or a camera pan). At high speeds, upward steps can be particularly punishing because a flat-trajectory jump undershoots.

**Dash cooldown feedback is subtle.** The cooldown wipe on the button is only visible when looking at the button panel below the play area. While playing, the player's eyes are on the action; they can't easily tell when dash is ready again without glancing down. There is no HUD element inside the play area for dash cooldown state.

**Opening grace period is uncommunicated.** The "Keep running…" bar before the chaser appears doesn't explain that the player is in a safe zone. New players may not realize they have 120 wu to learn movement before the pressure begins.

**No death variety.** All falls trigger the same outcome — the run ends. There is no catch mechanic or brief scramble opportunity, making gap deaths feel abrupt. "Caught" (lead = 0) and "fell" are different outcomes but the distinction is not shown clearly on the result screen.

---

## 9. Known Issues or Weak Points

**Slide lead reward is disproportionately small.** `SLIDE_LEAD_GAIN = 1` vs. the chaser draining 4.5/s. Even at base speed with a 2 wu lowbar, a clean slide takes under a second, netting +1 against a ~4 loss window. The lowbar obstacle is essentially a speed bump with a mild punishment for failure, not a genuine reward opportunity.

**No difficulty tiers.** The course is the same statistical difficulty on the first attempt and the hundredth. There is no mechanic that ramps obstacle density or gap width beyond the implicit pressure from increasing scroll speed. A skilled player quickly finds a reliable playbook (jump hazards, stomp mooks, slide lowbars) and the challenge becomes purely a question of execution speed.

**Prop variety ceiling.** Only three prop types exist. After a few runs, the player has seen every challenge. There is no equivalent of the Arena's named-boss variants, mook subtypes, or the Ancient Library's different puzzle categories.

**No restart mechanism.** When a run ends (fall or caught), the modal must be dismissed and re-opened to try again. There is no in-game restart button. Repeated attempts require navigating the UI between tries.

**Surge is purely cosmetic after discovery.** Once a player understands the surge doesn't drain real lead, it loses psychological impact. The theatrical effect stops being alarming.

**`Math.random` as RNG.** The run uses `Math.random` directly (`useChaseLoop.ts:38`). This is not seeded and cannot be replayed exactly. If a bug is reported, it cannot be reproduced with a seed. (Low practical priority but worth noting.)

**Test suite uses state injection for chain-stomp.** The chain-stomp counter tests in `rooftopChase.test.ts:493–527` verify the counter exists and is correctly typed, but do not fully integration-test a stomped-mook sequence because crafting the exact mid-air position is complex. The tests note this limitation inline.

**No mobile touch support for slide.** The on-screen Slide button works, but swipe-down gestures (a natural mobile input for "duck") are not mapped.

---

## 10. Improvement Opportunities

**Slide reward tuning.** Increase `SLIDE_LEAD_GAIN` significantly (e.g., to 4–6) so a clean lowbar clear is a meaningful lead recovery, not a rounding error. Or introduce a "skillful clear" window where timing the slide precisely awards bonus lead.

**Jump-over mooks reward.** Award a small lead gain (e.g., +2–3) for jumping cleanly over a mook without stomping. This gives the interaction meaning even when a stomp isn't attempted.

**Obstacle variety expansion.** Add new prop types or mook sub-variants. Possibilities: a moving guard that must be timed, a gap-spanning banner requiring a jump-and-slide, an elevated hazard requiring a higher-arc jump.

**Height-change telegraphing.** Show a subtle visual cue (color shift on the next rooftop, a small up/down arrow, or a slight camera tilt) when the next building is significantly higher or lower. This gives players information to react to rather than memorize.

**In-viewport dash cooldown indicator.** Add a small cooldown pip or ring inside the play area near the hero (similar to the Arena's action indicators) so players can track dash availability without looking away.

**In-game restart button.** Show a "Try Again" button when the run ends (within the play area or below the lead bar) to reduce friction for repeat attempts.

**Surge escalation over distance.** Make surges drain a small amount of real lead in the later portion of a run (beyond 400 wu). This maintains the drama's impact for experienced players.

**Variable building density.** Increase obstacle prop probability and reduce gap safety margins in the second half of the run to create a natural difficulty ramp beyond just scroll speed.

**Seeded RNG via a parameter.** Pass a seed to `initChase` rather than using `Math.random` directly, enabling reproducible runs and easier bug reporting.

**Mobile swipe-down for slide.** Map touch swipe-down to the slide action for mobile play.

---

## 11. Questions and Unknowns

**How does `trialReward` scale with score?** The reward formula for `completeTrial` is referenced in the store but not analyzed here. It is unclear whether the reward curve is linear, stepped by star count, or something else — and whether that curve is well-tuned for the typical Rooftop Chase score distribution.

**What score does an average first-time player achieve?** There is no telemetry visible in the codebase. Without this, it is unknown whether the 2★ threshold (240 wu, 40%) is appropriately challenging or too easy/hard for new players.

**Is the building count (30) always sufficient?** A perfect run reaches approximately building 24 by 600 wu. The comment in `generateCourse` states this with a "comfortable margin," but this margin has not been verified for all seeded courses. At low speeds (early run) the player covers less distance per building, so the layout is sampled more densely at the start. It is worth verifying that no seed produces a course where the 30th building is reached before 600 wu.

**What happens if the player completes the trial more than once per day?** The daily gate is enforced in the store/TrialModal layer. It is unclear from the engine alone whether re-entry is blocked before or after the `RooftopChase` component mounts — and whether a second completion overwrites or ignores the prior score.

**Are there any accessibility concerns beyond `prefers-reduced-motion`?** The minigame is keyboard/tap driven. Color alone is used to communicate lead danger (green → yellow → red). There may be color-blind accessibility gaps in the lead bar color coding and the chaser eye-glow danger indicator.

**Why is `HERO_HITBOX_W` imported into `RooftopChase.tsx` but immediately voided?** The comment says it's "imported to keep the renderer and engine in sync." The actual pixel math in the renderer uses `PX_PER_WU` and manually-tuned offsets rather than referencing `HERO_HITBOX_W`. This suggests the renderer and engine may drift if hitbox width is ever changed without updating the `HERO_X_PX - 3` offset and visual sprite widths.
