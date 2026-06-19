# Long March — Minigame Analysis

_Reflects the current state of the minigame as of the improvement pass documented in `docs/long-march-improvement-plan.md` (steps 1–15 implemented)._

---

## 1. Basic Summary

Long March is a turn-based resource-management minigame tied to the **Endurance (EN)** stat. It is one of eight Skill Trials — short daily challenges that reward stat XP and gold. The player marches across 16 terrain tiles by choosing a pace for each one (Rest, Walk, or Push). Stamina is the single limited resource: moving fast costs more, and terrain makes each step cheaper or more expensive. Running out of stamina ends the march early and reduces the score.

The player's EN stat level now affects gameplay directly: `marchStartStamina(enLevel)` grants up to +6 starting stamina above the 12-point base, tying the main game's progression loop to the trial's mechanics.

It fits into the larger game as a daily free attempt in the Trials system (`TrialsView`). Completing it earns EN XP and gold scaled by performance. The trial is gated behind Level 3 and can only be replayed daily unless the `repeatMinigames` dev setting is on.

---

## 2. Core Game Loop

### Start
- The player opens the Trials hub (`TrialsView`), clicks the Long March card, and sees the `TrialModal` intro screen.
- The intro shows the trial description plus an EN stat callout: "Endurance Lv.X — grants +N starting stamina (M total)." If EN is below Lv. 3, the callout nudges the player toward earning the bonus.
- Clicking **Begin Trial** advances to the playing stage and unlocks the browser's AudioContext via `sfxResume()`.
- On mount, `LongMarch.tsx` calls `generateTerrain(Math.random)` once via `useState` initializer, producing a fixed 16-tile sequence for that run.

### Each Turn
1. The 16-tile terrain strip shows completed tiles, the current tile (highlighted), the next tile (dimly revealed), and future tiles as neutral dots.
2. The current terrain tile is displayed as a larger card (emoji + label) with a fade-in animation.
3. The player clicks one of three pace buttons: Rest, Walk, or Push. Each button shows live, terrain-adjusted cost/gain hints derived from the `PACE_COSTS` table.
4. `marchStep(tile, pace)` is called in the engine to produce a `MarchStepResult` (`distanceDelta`, `staminaDelta`, `message`).
5. Stamina, distance, and the narrative message are updated in React state. `tileIndex` advances by 1.
6. A synthesized sound cue fires (footstep, crunch, exhale, or water chime depending on pace and terrain kind).

### End Condition
The loop ends when either:
- `stamina ≤ 0` after a step — exhaustion collapse (💀, rose text, `marchCollapse` sfx).
- `tileIndex >= MARCH_TILES` (16) — march complete (🏆, emerald text, `marchComplete` sfx).

### Retry
After a run ends, a **March Again** button resets all component state and generates a new terrain, allowing replays without closing the modal.

### Scoring and Outcome
- `marchScore(tilesCompleted, distance)` = `0.7 * (tilesCompleted / 16) + 0.3 * (distance / 32)` (capped per component at 1.0).
  - Tile completion drives 70% of the score; distance efficiency drives 30%. A player who rests every tile and completes all 16 scores 0.70; one who pushes hard can reach 1.0.
- `onFinish(score)` is called, advancing the modal to the `result` stage.
- The result screen shows 1–3 stars (`scoreToStars`), the numeric score, the computed EN XP + gold reward, and a "✨ New personal best!" badge if the score exceeds the stored best.
- The player clicks **Continue** and then **Return to Trials**. On Continue, `completeTrial('long_march', score)` is called in the store, which records `trialsClearedOn`, updates `bestTrialScore`, applies the reward (`applyReward`), and triggers a level-up check (`checkLevelUp`).

---

## 3. Player Controls and Interaction

### Input Controls
Entirely mouse/touch — three buttons per turn, no keyboard shortcuts, no real-time input.

### UI Elements (top to bottom in `LongMarch.tsx`)
| Element | Purpose |
|---|---|
| Progress bar | `tileIndex / MARCH_TILES` with a distance-leagues counter on the right |
| Terrain strip | 16 small cells: completed = dimmed emoji, current = full emoji with ring, next = faint emoji, future = neutral dot |
| Stamina bar | Color-coded: emerald >50%, amber >25%, rose ≤25% with `animate-pulse`; shows `stamina / startStamina` |
| Terrain tile card | Emoji + label for the current tile; `key={tileIndex}` triggers `animate-fade-in` on each advance |
| Narrative message | Italicised text from the last `marchStep`, terrain- and pace-specific |
| Pace buttons | Rest / Walk / Push with live terrain-adjusted cost hints (e.g., rough Walk shows "−2 sta, +1 dist") |
| End screen | 💀 collapse or 🏆 completion, a leagues/tiles summary, and a "March Again" retry button |

The `TrialModal` wrapper adds:
- A header with the trial glyph, name, and stat label.
- An intro card with the full description and an EN stat bonus callout (Long March-specific).
- A result screen (stars, score %, reward breakdown, personal-best badge, Claim/Return buttons).

### Feedback
- Terrain strip updates each step, making progress spatial rather than just numeric.
- Stamina bar color shifts from emerald → amber → rose as stamina depletes; pulse added at ≤25%.
- Tile card fades in on each terrain advance.
- Narrative message updates each step with pace- and terrain-specific flavour text.
- Synthesized sound cues fire per step (see §7).
- Buttons show live stamina deltas from the `PACE_COSTS` table, so rough-terrain Walk correctly shows −2 rather than −1.

### Button Colors
Color is used to communicate risk, not to warn against a choice:
- **Rest** — emerald (safe recovery)
- **Walk** — gold gradient (default forward movement)
- **Push** — amber (bold, high-risk/high-reward)

---

## 4. Mechanics and Systems

### Terrain Tiles
Four kinds generated via weighted random (`generateTerrain` in `longMarch.ts`). Weights are exported as `TERRAIN_WEIGHTS`:

| Kind | Weight | Label | Emoji |
|---|---|---|---|
| `clear` | 45% | Clear Path | 🌄 |
| `rough` | 25% | Rough Terrain | 🪨 |
| `mud` | 20% | Muddy Track | 💧 |
| `spring` | 10% | Mountain Spring | ✨ |

### Pace × Terrain Matrix
Resolved via `PACE_COSTS` (exported data table in `longMarch.ts`; `marchStep` is now a lookup, not a nested switch):

| Pace | Clear | Rough | Mud | Spring |
|---|---|---|---|---|
| **Rest** | +2 sta, 0 dist | +2 sta, 0 dist | +2 sta, 0 dist | **+6 sta**, 0 dist |
| **Walk** | -1 sta, +1 dist | -2 sta, +1 dist | -1 sta, 0 dist | **+3 sta**, +1 dist |
| **Push** | -3 sta, +2 dist | -4 sta, +2 dist | -3 sta, +1 dist | **+1 sta**, +2 dist |

Spring rest grants a large +6 bonus (not a full restore), deliberately opening up the spring decision: rest gives safety, walk nets +3 stamina plus distance, push nets +1 plus more distance. No choice is strictly dominant.

### Stamina
- Start: `marchStartStamina(enLevel)` = `min(18, 12 + floor(enLevel / 3))`. Base is 12; EN Lv. 3 grants 13, Lv. 6 grants 14, up to a cap of 18 at Lv. 18+.
- Max: `MARCH_MAX_STA = 12` (base ceiling; starting above 12 is possible via EN level).
- Floored at 0 and capped at `MARCH_MAX_STA` by the component.
- Reaching 0 ends the march immediately.

### Distance
- Accumulated sum of `distanceDelta` across all steps.
- Now contributes 30% of the score (see Scoring below). Shown in the progress bar header.
- Theoretical maximum: `MARCH_MAX_DISTANCE = 32` (all Push on Clear tiles; exported constant).

### Scoring
```
tileScore = min(1, tilesCompleted / MARCH_TILES)
distScore = min(1, distance / MARCH_MAX_DISTANCE)
marchScore = 0.7 * tileScore + 0.3 * distScore
```
Completing all 16 tiles with zero distance (rest every tile) scores exactly 0.70. Finishing with high distance can push the score to 1.0. Partial completions that reached many leagues still earn meaningful credit.

Star thresholds (`scoreToStars` in `trials.ts`):
- 3 stars: score ≥ 0.75
- 2 stars: score ≥ 0.40
- 1 star: score < 0.40

### Reward Scaling (`trialReward` in `trials.ts`)
```
multiplier = 0.25 + 0.75 * score01
EN XP = round((20 + 8 * level) * multiplier)
Gold   = round((15 + 5 * level) * multiplier)
```
A 25% floor means even an immediate collapse gives ~25% of the full reward.

### Difficulty and Randomization
- Terrain sequence is random each run (seeded from `Math.random` at mount).
- No difficulty scaling across days or attempts — constants are fixed.
- Terrain strip reveals only 1 tile of lookahead (the next tile), preserving meaningful uncertainty. Full route is not disclosed.

### Win/Loss
No hard fail state — the march always ends with some score (minimum ~1/16 tiles if the player collapses on tile 1, plus any distance earned). A "loss" means a lower reward.

### Larger-Game Integration
- EN `statLevels` now affects starting stamina via `marchStartStamina(enLevel)`, read from the store in `TrialModal` and passed as a prop.
- The trial can only be played once per calendar day unless `repeatMinigames` is enabled.
- `bestTrialScore['long_march']` persists across days and is displayed as stars on the hub card.

---

## 5. Technical Implementation

### Key Files

| File | Role |
|---|---|
| `src/engine/trials/longMarch.ts` | Pure engine: constants, `PACE_COSTS`, `generateTerrain`, `marchStep`, `marchScore`, `marchStartStamina` |
| `src/components/trials/games/LongMarch.tsx` | React component: state machine, terrain strip, SFX calls, rendering, user interaction |
| `src/engine/trials/trials.ts` | Trial registry, `trialReward`, `scoreToStars`, shared constants |
| `src/components/trials/TrialModal.tsx` | Modal shell: intro/playing/result stages, EN callout, personal-best badge, reward claim |
| `src/views/TrialsView.tsx` | Trials hub: 8-card grid, opens `TrialModal` |
| `src/store/useGameStore.ts` | `completeTrial` action, `trialsClearedOn`, `bestTrialScore` |
| `src/lib/sfx.ts` | SFX engine; Long March cues: `marchRest`, `marchWalk`, `marchPush`, `marchSpring`, `marchCollapse`, `marchComplete` |
| `src/engine/trials/__tests__/trials.test.ts` | Unit tests for engine functions |

### Important Functions

| Function | File | What it does |
|---|---|---|
| `generateTerrain(rng)` | `longMarch.ts` | Produces a 16-element `TerrainTile[]` via weighted random from `TERRAIN_WEIGHTS` |
| `marchStep(tile, pace)` | `longMarch.ts` | Returns `{ distanceDelta, staminaDelta, message }` via `PACE_COSTS` lookup |
| `marchScore(tilesCompleted, distance)` | `longMarch.ts` | 70/30 weighted score (0–1); both params required |
| `marchStartStamina(enLevel)` | `longMarch.ts` | Returns starting stamina for a given EN stat level |
| `choosePace(pace)` | `LongMarch.tsx` | Event handler: calls engine, updates state, fires SFX, checks end |
| `reset()` | `LongMarch.tsx` | Resets all component state and generates new terrain for retry |
| `trialReward(stat, score01, level)` | `trials.ts` | Computes gold + statXp reward |
| `scoreToStars(score01)` | `trials.ts` | Maps score to 1–3 stars |
| `completeTrial(trialId, score01)` | `useGameStore.ts` | Persists result, applies reward, triggers level check |

### Exported Engine Constants

| Export | Value | Purpose |
|---|---|---|
| `MARCH_TILES` | 16 | Total tiles per run |
| `MARCH_START_STA` | 12 | Base starting stamina |
| `MARCH_MAX_STA` | 12 | Stamina ceiling during a run |
| `MARCH_MAX_DISTANCE` | 32 | Theoretical maximum distance (used in score denominator) |
| `PACE_COSTS` | Record table | All 12 pace × terrain combinations; exported for live button hints |
| `TERRAIN_WEIGHTS` | `[TerrainKind, number][]` | Weighted distribution for terrain generation; exported for tuning/reuse |

### State Management
All runtime state lives in the `LongMarch` component (React `useState`):
- `terrain` — `TerrainTile[]` from `useState` initializer (moved from `useMemo` to support retry)
- `tileIndex` — current tile (0–16)
- `stamina` — current stamina (0–`MARCH_MAX_STA`)
- `distance` — accumulated distance leagues
- `lastMessage` — single `string` (replaced the former `LogEntry[]` array)
- `done` — boolean; prevents further input
- `collapsed` — boolean; distinguishes exhaustion from completion in the end screen

The modal holds `stage` (`intro | playing | result`), `score`, `claimed`, and `isNewBest`. `prevBest` is read from the store before any `completeTrial` call so the comparison is against the pre-run best.

### Data Flow
```
User clicks pace button
  → choosePace(pace)                  [LongMarch.tsx]
  → marchStep(tile, pace)             [longMarch.ts — pure, no side effects]
  → setState(stamina, distance, ...)  [React state updates]
  → sfxPlay(cue)                      [sfx.ts — Web Audio synthesis]
  → if done: onFinish(score)          [prop callback — marchScore(newTile, newDist)]
  → TrialModal.handleFinish           [sets isNewBest, stage = 'result']
  → User clicks Continue/Return
  → completeTrial(id, score)          [Zustand store action]
  → applyReward + checkLevelUp        [store side effects]
```

### SFX Precedence in `choosePace`
One cue fires per step using this priority chain:
```
if (finished && exhausted)       → 'marchCollapse'
else if (finished)               → 'marchComplete'
else if (tile.kind === 'spring') → 'marchSpring'   (any pace on a spring)
else if (pace === 'rest')        → 'marchRest'
else if (pace === 'walk')        → 'marchWalk'
else                             → 'marchPush'
```

### Save/Load
The Zustand store uses `persist` to localStorage. `trialsClearedOn` and `bestTrialScore` are part of the persisted root state. Missing keys are backfilled by `withCharacterDefaults` at load time.

---

## 6. Software, Libraries, and Tools Used

| Concern | Technology |
|---|---|
| Language | TypeScript |
| Framework | React 18 |
| Build tool | Vite |
| State management | Zustand (with `persist` middleware → localStorage) |
| Styling | Tailwind CSS (custom tokens: `gold-*`, `parchment-*`, `ink-*`, `wood-*`, `emerald-*`, `amber-*`, `rose-*`) |
| UI components | Raw `<button>` elements with custom Tailwind classes (no shared `Button` component in the game component itself) |
| Testing | Vitest |
| Rendering | DOM — no canvas, no WebGL |
| Animation | `animate-fade-in` keyframe (custom, defined in `tailwind.config.js`); `animate-pulse` (Tailwind built-in); `transition-all duration-300` on bars |
| Audio | `src/lib/sfx.ts` — 6 Long March cues synthesized via Web Audio (`marchRest`, `marchWalk`, `marchPush`, `marchSpring`, `marchCollapse`, `marchComplete`) |
| Icons | Lucide React (used in `TrialsView`; not directly in `LongMarch.tsx`) |
| Routing | None — tab switching via local `useState` in `App.tsx` |

---

## 7. Assets and Presentation

### Visuals
- All terrain "art" is a single emoji character rendered at `text-2xl` inside a parchment-colored card. No sprite sheets, no canvas tiles.
- The 16-cell terrain strip renders each tile as a `text-[10px]` emoji in a flex row, with distinct opacity and ring treatment per state.
- The minigame has no background art — it sits on the modal's `bg-wood-900/95` dark backdrop.
- Pace buttons are custom-colored raw `<button>` elements: emerald (Rest), gold gradient (Walk), amber (Push).
- The progress bar and stamina bar are CSS div fills with `transition-all duration-300`.
- The stamina bar uses three color states (emerald / amber / rose) and gains `animate-pulse` at ≤25%.

### Animations
- **Tile card fade-in**: `animate-fade-in` (0.18s ease-out, 4px Y slide). Triggered by `key={tileIndex}` on the tile card, which forces React to remount the element on each advance.
- **Stamina pulse**: `animate-pulse` applied conditionally to the stamina bar fill when `staminaPct ≤ 25`.
- Bar width transitions: CSS `transition-all duration-300`.

### Sound
Six synthesized cues, all built from Web Audio oscillators and filtered noise (zero asset files):

| Cue | Sound Design |
|---|---|
| `marchRest` | Soft lowpass noise exhale + quiet low sine decay (~0.25s) |
| `marchWalk` | Short triangle thud + muffled bandpass noise tick (~0.13s) |
| `marchPush` | Heavier triangle crunch + grittier bandpass noise (~0.19s) |
| `marchSpring` | Two rising sine chimes (880→1320, 1320→1980 Hz) + highpass droplet sparkle (~0.24s) |
| `marchCollapse` | Descending sawtooth (230→46 Hz) + fading lowpass noise (~0.50s) |
| `marchComplete` | Five-note ascending sine arpeggio (E–G#–C–E–A, 0.08s stagger) |

The AudioContext is unlocked from the "Begin Trial" button gesture in `TrialModal.tsx` (`void sfxResume()`). `play()` silently no-ops if muted or not yet resumed.

### Overall Style and Mood
Clean and minimal with meaningful polish layer. The parchment/wood palette is consistent with the main game. Sound and animation elevate the pace-choice rhythm from a plain click UI into something that reads as a physical march.

---

## 8. Current Player Experience

### What Works
- **Clarity**: Three options with live, terrain-accurate costs are immediately readable. New players can start without instruction.
- **Genuine spring decisions**: Spring rest (+6) is a meaningful recovery, but walk (+3 stamina + distance) and push (+1 stamina + more distance) are now viable alternatives rather than clearly wrong choices.
- **Distance matters**: The score formula's 30% distance weight makes Push a real strategic option instead of a trap. Players who push hard are rewarded.
- **EN investment feedback**: Higher EN levels grant more starting stamina, creating a visible connection between the main game's progression and the trial's difficulty.
- **Spatial progress**: The 16-tile terrain strip makes each run feel like a journey with a start and an end, not a counter ticking up.
- **Restartability**: "March Again" enables immediate retry without modal round-trips.
- **Feedback density**: Sound, animation, terrain-accurate button hints, and a pulse on critical stamina all work in parallel — there's something happening on every click.

### What Feels Weaker
- **Strategy stabilizes quickly**: The stamina math is learnable within a few runs. Once a player understands the PACE_COSTS table mentally, the decision space narrows toward a near-optimal playbook. The only variance is terrain luck.
- **16 tiles can feel long**: Compared to faster trials (Lockpicking, Armory Break), Long March requires more clicks for a single run. The retry button helps, but the time-per-run is still the highest in the suite.
- **No difficulty curve across the game's lifespan**: Constants are fixed. At Level 1 and Level 50 the terrain weights, costs, and structure are identical. Only the reward value scales.
- **1-tile preview is still narrow**: The terrain strip reveals only the next tile. Players who want meaningful route planning would benefit from 2 tiles of lookahead, but the single-tile choice was made deliberately to preserve difficulty.

### Pacing
Better than before the improvement pass. The retry button, sound effects, and tile animation reduce friction and add rhythm. Still repetitive across many sessions — the optimal strategy is discoverable and stable, which limits long-term replayability.

---

## 9. Known Issues and Remaining Weak Points

1. **Strategy stabilizes fast**: The PACE_COSTS table is simple enough that an attentive player can memorize optimal behavior within a few runs (rest on non-spring when stamina < 6; push on clear when > 6; walk on mud always). No randomization or difficulty escalation within a run changes this.

2. **No difficulty curve**: The minigame has the same constants at all character levels. EN stat investment affects starting stamina but not the terrain distribution or cost table. An endgame player (EN Lv. 18, starting with 18 stamina) will find the 16-tile run nearly trivial.

3. **Score formula is hidden**: The 70/30 split is not visible to the player. The UI shows tiles and leagues but doesn't explain how they combine into the score. A player might still be confused about whether to push or complete all tiles for a better star rating.

4. **Terrain strip sizing is tight**: 16 cells in `max-w-xs` (~320px) gives ~20px per cell. At `text-[10px]` this works, but on very narrow screens or when font scaling is in effect, the strip may crowd. The `overflow-x-auto` safety net means it can scroll rather than break, but that is not ideal UX.

5. **`MARCH_MAX_STA` doesn't match high-EN starts**: A player with EN Lv. 18 starts with 18 stamina but is capped at `MARCH_MAX_STA = 12` during the run. Spring rest (+6) and non-spring rest (+2) can therefore never push stamina above 12 even if the player started with more. This makes the bonus stamina feel weaker mid-run than it is at the start.

---

## 10. Remaining Improvement Opportunities

### Mechanics
- **Hard Mode / daily terrain theme** (§2.2 of improvement plan): Alternate terrain weight tables (more rough/mud, fewer springs) for experienced players, or a date-derived daily theme ("Flood Day", "Mountain Pass"). Engine support is straightforward — `generateTerrain` already accepts a configurable `rng`; an `options` param with alternate `TERRAIN_WEIGHTS` is the only addition needed in `longMarch.ts`.
- **Align `MARCH_MAX_STA` with the EN-bonus maximum**: Consider raising `MARCH_MAX_STA` to 18 so that a high-EN player's starting advantage carries into run management (springs can refill more of their bar).
- **2-tile lookahead as a Hard Mode OFF toggle**: Revealing the next two tiles would add route-planning depth without requiring new terrain logic.

### Integration
- **Streak indicator on the Trials hub** (§6.3): Track consecutive days completed, show a flame or counter badge on the hub card. Requires `trialStreak: Record<TrialId, number>` in the store — the largest remaining integration change.

### Presentation
- **Score formula tooltip**: A small "?" on the score display in the result screen explaining the 70/30 formula would close the loop for players who notice the distance counter.

---

## 11. Questions and Unknowns

1. **Should `MARCH_MAX_STA` be decoupled from `MARCH_START_STA`?** The EN bonus creates a meaningful gap (start 18, cap at 12 mid-run) that may be confusing. Raising the cap alongside the bonus, or removing the in-run cap entirely, would make the EN stat investment feel more consistent throughout a run.

2. **Are terrain weights intentionally untuned for Hard Mode?** The current 45/25/20/10 split produces runs with 0 springs ~17% of the time across 16 tiles (0.9^16 ≈ 0.19). That's a non-trivial "no recovery available" scenario. A Hard Mode table with even lower spring frequency (5%) would push this to ~44% — worthwhile to playtest before shipping.

3. **What should the daily terrain theme system look like?** The plan proposes deriving weights from the current date. This is straightforward technically but requires defining the named themes and their balance targets first.

4. **Is the score formula's 70/30 split the right balance?** It was chosen to reward tile completion while making distance meaningful. With the spring changes (+1/+3 stamina on spring walk/push), pushing through springs is now safer, potentially making high-distance runs more common. Worth re-evaluating star thresholds if the average score distribution shifts noticeably.

5. **What happens to existing `bestTrialScore` values under the new formula?** Old scores were computed with `marchScore(tilesCompleted)` (tile-only). A score of 1.0 stored before the improvement pass could represent a full completion that earned no distance credit. Those scores remain in localStorage and may over- or under-represent the player's relative standing under the new formula, but there is no migration path without a store version bump.
