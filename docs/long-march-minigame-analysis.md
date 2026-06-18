# Long March — Minigame Analysis

## 1. Basic Summary

Long March is a turn-based resource-management minigame tied to the **Endurance (EN)** stat. It is one of eight Skill Trials — short daily challenges that reward stat XP and gold. The player must march across 16 terrain tiles by choosing a pace for each tile (Rest, Walk, or Push). Stamina is the single limited resource: it costs more to move fast, and terrain can make each step cheaper or more expensive. Running out of stamina ends the march early and reduces the score.

It fits into the larger game as one daily free attempt in the Trials system (`TrialsView`). Completing it (regardless of score) earns EN XP and gold, scaled by performance. The trial is gated behind Level 3 and can only be replayed daily unless the `repeatMinigames` dev setting is on.

---

## 2. Core Game Loop

### Start
- The player opens the Trials hub (`TrialsView`), clicks the Long March card, and sees the `TrialModal` intro screen.
- The intro shows the trial description. Clicking **Begin Trial** advances to the playing stage and unlocks the browser's AudioContext.
- On mount, `LongMarch.tsx` calls `generateTerrain(Math.random)` once via `useMemo`, producing a fixed 16-tile sequence for that run.

### Each Turn
1. The current terrain tile is displayed (emoji + label).
2. The player clicks one of three pace buttons: Rest, Walk, or Push.
3. `marchStep(tile, pace)` is called in the engine to produce a `MarchStepResult` (`distanceDelta`, `staminaDelta`, `message`).
4. Stamina and distance are updated in React state. A log entry is appended.
5. The last log message is shown below the tile card.
6. `tileIndex` advances by 1.

### End Condition
The loop ends when either:
- `stamina ≤ 0` after a step — exhaustion collapse.
- `tileIndex >= MARCH_TILES` (16) — march complete.

### Scoring and Outcome
- `marchScore(tilesCompleted)` = `tilesCompleted / 16`, capped at 1.0.
- `onFinish(score)` is called, advancing the modal to the `result` stage.
- The result screen shows a 1–3 star rating (`scoreToStars`), the numeric score, and the computed gold + EN XP reward.
- The player clicks **Claim Reward**, which calls `completeTrial('long_march', score)` in the store.
- The store records today's date in `trialsClearedOn['long_march']`, updates `bestTrialScore`, applies the reward (`applyReward`), and triggers a level-up check (`checkLevelUp`).

---

## 3. Player Controls and Interaction

### Input Controls
Entirely mouse/touch — three buttons per turn, no keyboard shortcuts, no real-time input.

### UI Elements (top to bottom in `LongMarch.tsx`)
| Element | Purpose |
|---|---|
| Progress bar | `tileIndex / MARCH_TILES` — shows march completion |
| Distance counter | Cumulative `distanceDelta` sum (visual only, not used in score) |
| Stamina bar | Color-coded: green >50%, amber >25%, red ≤25%; shows `stamina / MARCH_MAX_STA` |
| Terrain tile card | Emoji + label for the current tile |
| Log message | Italicised narrative text from the last `marchStep` |
| Pace buttons | Rest / Walk / Push with inline cost/gain hints |
| End message | "You collapsed" or "You completed the march" + distance summary |

The `TrialModal` wrapper adds:
- A header with the trial glyph, name, and stat label.
- An intro card with the full description.
- A result screen (stars, score %, reward breakdown, Claim button).

### Feedback
- Stamina bar changes color as stamina drops.
- Narrative message updates each step.
- Buttons are disabled once `done` is true.
- No sound effects or animations are present in the minigame itself (audio unlock happens in `TrialModal` via `sfxResume()`).

---

## 4. Mechanics and Systems

### Terrain Tiles
Four kinds generated via weighted random (`generateTerrain` in `longMarch.ts`):

| Kind | Weight | Label | Emoji |
|---|---|---|---|
| `clear` | 45% | Clear Path | 🌄 |
| `rough` | 25% | Rough Terrain | 🪨 |
| `mud` | 20% | Muddy Track | 💧 |
| `spring` | 10% | Mountain Spring | ✨ |

### Pace × Terrain Matrix
Resolved by `marchStep(tile, pace)`:

| Pace | Clear | Rough | Mud | Spring |
|---|---|---|---|---|
| **Rest** | +2 sta, 0 dist | +2 sta, 0 dist | +2 sta, 0 dist | +12 sta (full), 0 dist |
| **Walk** | -1 sta, +1 dist | -2 sta, +1 dist | -1 sta, 0 dist | +1 sta, +1 dist |
| **Push** | -3 sta, +2 dist | -4 sta, +2 dist | -3 sta, +1 dist | -1 sta, +2 dist |

Spring on Rest fully restores stamina to `MARCH_MAX_STA` (12). Spring on Walk/Push gives a +2 stamina bonus on top of the base cost, making them cheaper than the equivalent pace on clear terrain.

### Stamina
- Start: 12. Max: 12. (`MARCH_START_STA`, `MARCH_MAX_STA` — both 12.)
- Floored at 0 and capped at `MARCH_MAX_STA` by the component.
- Reaching 0 ends the march immediately.

### Distance
- Accumulated sum of `distanceDelta` across all steps.
- Shown in the UI but **not used in scoring**. It is purely narrative.

### Scoring
`marchScore(tilesCompleted) = min(1, tilesCompleted / 16)`

Score only counts tiles completed (i.e., steps taken), not distance covered. Finishing all 16 tiles gives 1.0 regardless of how much stamina remains or what route was taken.

Star thresholds (from `scoreToStars` in `trials.ts`):
- 3 stars: score ≥ 0.75 (≥ 12 tiles)
- 2 stars: score ≥ 0.40 (≥ 7 tiles)
- 1 star: score < 0.40 (< 7 tiles)

### Reward Scaling (`trialReward` in `trials.ts`)
```
multiplier = 0.25 + 0.75 * score01
EN XP = round((20 + 8 * level) * multiplier)
Gold   = round((15 + 5 * level) * multiplier)
```
A 25% floor means even a zero score (immediate collapse) gives ~25% of the full reward.

### Difficulty and Randomization
- Terrain sequence is fully random each run (seeded from `Math.random` at mount).
- No difficulty scaling across days or attempts — every run uses the same constants.
- Because springs are rare (10%), a bad run with no springs and many rough/mud tiles is noticeably harder.

### Win/Loss
There is no hard fail state — the march always ends with some score (minimum 1/16 if the player collapses on tile 1). A "loss" just means a lower reward.

### Larger-Game Integration
- No character stats (`statLevels`) affect the minigame's mechanics — stamina values and pace costs are flat constants.
- The trial can only be played once per calendar day unless `repeatMinigames` is enabled in dev settings.
- The best score (`bestTrialScore['long_march']`) persists across days and is displayed as stars on the hub card.

---

## 5. Technical Implementation

### Key Files

| File | Role |
|---|---|
| `src/engine/trials/longMarch.ts` | Pure engine: constants, `generateTerrain`, `marchStep`, `marchScore` |
| `src/components/trials/games/LongMarch.tsx` | React component: state machine, rendering, user interaction |
| `src/engine/trials/trials.ts` | Trial registry, `trialReward`, `scoreToStars`, shared constants |
| `src/components/trials/TrialModal.tsx` | Modal shell: intro/playing/result stages, reward claim |
| `src/views/TrialsView.tsx` | Trials hub: 8-card grid, opens `TrialModal` |
| `src/store/useGameStore.ts` | `completeTrial` action (~line 1834), `trialsClearedOn`, `bestTrialScore` |
| `src/engine/trials/__tests__/trials.test.ts` | Unit tests for engine functions |

### Important Functions

| Function | File | What it does |
|---|---|---|
| `generateTerrain(rng)` | `longMarch.ts` | Produces a 16-element `TerrainTile[]` via weighted random |
| `marchStep(tile, pace)` | `longMarch.ts` | Returns `{ distanceDelta, staminaDelta, message }` for one turn |
| `marchScore(tilesCompleted)` | `longMarch.ts` | Maps tile count to 0–1 score |
| `choosePace(pace)` | `LongMarch.tsx` | Event handler: calls engine, updates state, checks end |
| `trialReward(stat, score01, level)` | `trials.ts` | Computes gold + statXp reward |
| `scoreToStars(score01)` | `trials.ts` | Maps score to 1–3 stars |
| `completeTrial(trialId, score01)` | `useGameStore.ts` | Persists result, applies reward, triggers level check |

### State Management
All runtime state lives in the `LongMarch` component (React `useState`):
- `terrain` — fixed `TerrainTile[]` from `useMemo`
- `tileIndex` — current tile (0–16)
- `stamina` — current stamina (0–12)
- `distance` — accumulated distance (cosmetic)
- `log` — array of `LogEntry` (only last entry is rendered)
- `done` — boolean; prevents further input

The modal's `stage` (`intro | playing | result`) and `score` live in `TrialModal`.

Persistent state in the store:
- `trialsClearedOn['long_march']` — ISO date string of last clear
- `bestTrialScore['long_march']` — highest score (0–1)

### Data Flow
```
User clicks pace button
  → choosePace(pace)         [LongMarch.tsx]
  → marchStep(tile, pace)    [longMarch.ts — pure, no side effects]
  → setState(...)            [React state update]
  → if done: onFinish(score) [prop callback]
  → TrialModal.handleFinish  [sets stage = 'result']
  → User clicks Claim
  → completeTrial(id, score) [Zustand store action]
  → applyReward + checkLevelUp [store side effects]
```

### Save/Load
The store uses Zustand `persist` to localStorage. `trialsClearedOn` and `bestTrialScore` are part of the persisted root state. There is no trial-specific migration — missing keys are backfilled by `withCharacterDefaults` at load time.

### Configuration
All numeric constants live in `longMarch.ts`:
```typescript
MARCH_TILES     = 16   // total tiles per run
MARCH_START_STA = 12   // starting stamina
MARCH_MAX_STA   = 12   // stamina ceiling
```

Terrain weights are an inline array in `generateTerrain`. Star thresholds are in `scoreToStars` in `trials.ts`. Reward formula constants are inline in `trialReward`.

---

## 6. Software, Libraries, and Tools Used

| Concern | Technology |
|---|---|
| Language | TypeScript |
| Framework | React 18 |
| Build tool | Vite |
| State management | Zustand (with `persist` middleware → localStorage) |
| Styling | Tailwind CSS (custom design tokens: `gold-*`, `parchment-*`, `ink-*`, `wood-*`) |
| UI components | Custom (`Button`, `Panel`, `SectionTitle`) in `src/components/ui/` |
| Testing | Vitest |
| Rendering | DOM — no canvas, no WebGL |
| Animation | CSS transitions (`transition-all duration-300`) on bars |
| Physics/collision | None |
| Audio | `src/lib/sfx.ts` (`sfxResume` called at trial start, but Long March itself plays no sounds) |
| Icons | Lucide React (used in `TrialsView`; not directly in `LongMarch.tsx`) |
| Routing | None — tab switching via local `useState` in `App.tsx` |

---

## 7. Assets and Presentation

### Visuals
- All terrain "art" is a single emoji character rendered at `text-2xl` inside a parchment-colored card. No sprite sheets, no canvas tiles.
- The minigame has no background art — it sits on the modal's `bg-wood-900/95` dark backdrop.
- Pace buttons are standard `Button` components with inline emoji labels (`😴`, `🚶`, `💨`).
- The progress bar and stamina bar are CSS div fills with `transition-all duration-300`.
- The stamina bar uses three color states: emerald (healthy), amber (caution), rose (critical).

### Animations
No bespoke animations. The bar transitions are purely CSS width changes.

### Sound
None during gameplay. `sfxResume()` is called when the trial starts (to unlock the AudioContext for other trials that do use sounds), but Long March fires no sound effects.

### Overall Style and Mood
Clean and minimal. Thematically appropriate (boots glyph 🥾, medieval terrain labels), but visually sparse — closer to a card UI than an illustrated minigame. The parchment/wood color palette from the main game is present.

---

## 8. Current Player Experience

### What Works
- **Clarity**: The three options and their costs are immediately obvious from the button labels. New players can start playing without reading anything.
- **Decision loop**: Each turn presents a genuine trade-off — the spring/rest interaction and the mud penalty give the terrain variety some real teeth.
- **Low pressure**: Being a turn-based click game makes it accessible and playable at any pace.
- **Participation reward**: The 25% floor on rewards means a bad run doesn't feel punishing.

### What Feels Weak
- **No tension or feedback**: There are no sounds, no animations, and no visual flair on individual pace choices. Clicking "Push" on rough terrain feels the same as clicking "Walk" on clear — only the text log confirms anything happened.
- **Distance is a false metric**: The UI prominently displays "Distance" but the score formula ignores it entirely. Players who optimize for distance may be confused when their score doesn't reflect it.
- **Stamina math is very learnable**: After a few runs, a player can see that 12 starting stamina with -3 per push means at most 4 consecutive pushes before collapse. The optimal strategy (walk most tiles, push on clear, rest before springs) becomes mechanical quickly.
- **No visible terrain preview**: The player sees only the current tile. There is no look-ahead, making risk management guesswork rather than planning.
- **16 tiles feels long for a "trial"**: Each run takes a meaningful number of clicks. Compared to some other trials (Lockpicking, Armory Break) that can resolve in seconds, Long March feels like a grind.
- **Log only shows the last message**: All previous step messages are discarded visually. The narrative flavour accumulates in state but is invisible, so the thematic writing effort is mostly wasted.

### Pacing
Fine for the first run; becomes repetitive quickly. The optimal strategy stabilizes fast and there is no run-to-run variance in decision difficulty beyond terrain luck.

---

## 9. Known Issues or Weak Points

1. **Distance score disconnect**: `distance` is accumulated and shown in the final summary ("Covered X leagues") but `marchScore` only counts `tilesCompleted`. Two runs with the same tile count but different distances receive identical scores — and the UI implies otherwise.

2. **No stat integration**: Character EN stat level (`statLevels.EN`) has zero effect on the minigame. The EN trial rewards EN XP but ignores the player's current EN investment entirely. This breaks the thematic loop ("your Endurance makes you better at Endurance tasks").

3. **Spring rest is strictly dominant**: On a spring tile, `rest` gives full stamina restoration (12). Choosing `walk` or `push` on a spring is almost never correct unless the player is already at max stamina. This creates a hard "always rest on spring" rule that reduces decision space.

4. **No audio**: The minigame is completely silent. Most other trials in the suite also appear audio-light, but the absence is noticeable.

5. **Terrain sequence not seeded**: `generateTerrain(Math.random)` is called inside `useMemo` with no external seed. The terrain changes every time the component mounts. If the modal is closed and reopened, a new terrain is generated — but this is invisible to the player (no "new run" message).

6. **Stamina cap = start**: `MARCH_START_STA === MARCH_MAX_STA = 12`. This means a spring rest at full health wastes the tile's benefit entirely. There is no overflow or buffer — a full restore on a non-depleted player is just wasted RNG.

7. **Log array grows unboundedly**: `log` state is a growing array, but only `log[log.length - 1].message` is ever rendered. The array is never trimmed and holds all 16+ entries in memory (minor, but unnecessary).

8. **No retry within session**: After a run ends (either collapse or completion), there is no in-component retry button. The player must go back through `TrialModal → TrialsView → open card again` to replay (unless `repeatMinigames` is on).

9. **No difficulty curve across the game's lifespan**: The minigame has the same constants at Level 1 and Level 50. Only the reward value scales with level.

---

## 10. Improvement Opportunities

### Mechanics
- **Tie EN stat level to stamina**: Give the player +1 starting stamina per EN stat level point, or reduce pace costs, so that EN investment tangibly affects performance.
- **Show upcoming terrain**: Display the next 1–3 tiles as a preview (face-down or silhouetted) so the player can plan ahead and make push/rest decisions strategically rather than reactively.
- **Make distance matter**: Either incorporate distance into the score formula (e.g., `score = 0.5 * (tilesCompleted / MARCH_TILES) + 0.5 * (distance / maxPossibleDistance)`) or remove the distance display to stop misleading players.
- **Nerf spring rest dominance**: Cap spring rest at "restore 6 stamina" or make rest give a smaller bonus (+1) on spring but a unique special action (e.g., "Drink" that fully restores) so the decision space opens up.
- **Add a "Shortcut" pace**: A fourth option (e.g., Scout — skip tile for -0 stamina, 0 distance) that trades distance for stamina preservation, adding a third axis to decisions.

### Feedback and Presentation
- **Sound effects**: A footstep cadence per pace, a splash on mud, a water sound on spring, a gasp on exhaustion.
- **Tile transition animation**: Slide or fade the terrain card when advancing to a new tile.
- **Show full step log**: Display the last 3–4 messages scrolling, so the narrative flavour is visible.
- **Visual terrain map**: A small horizontal strip showing all 16 tiles (completed = revealed, upcoming = hidden) so progress has a spatial feel.

### Difficulty Curve
- **Introduce a Hard mode**: More rough/mud tiles, less rest recovery, or an optional time constraint for bonus score.
- **Per-day terrain themes**: "Mountain Day" (more rough), "Flood Day" (more mud), etc., giving the daily trial more identity.

### Code Quality
- **Remove the `log` array or cap it**: Since only the last message is rendered, store only the last message in state rather than a growing array.
- **Extract constants to a config object**: The inline terrain weights in `generateTerrain` and the spring special-case logic in `marchStep` are scattered; grouping them into a data table would make tuning easier.
- **Seed the RNG**: Accept an optional seed for `generateTerrain` so tests and replays can be deterministic without relying on `Math.random`.

### Integration
- **Best-score improvement feedback**: On the result screen, if the player beat their previous best score, call it out explicitly.
- **Streak tracking**: Track consecutive days completed across all trials (not just Long March) and show a streak counter on the hub.

---

## 11. Questions and Unknowns

1. **Is distance intended to factor into scoring?** The current formula ignores it, but the UI surface area given to it (progress bar label, final summary line) suggests it may have been intended to matter at some point.

2. **Why are `MARCH_START_STA` and `MARCH_MAX_STA` both 12 and identical?** Is there a design reason the player can't start below max? If starting below max was intended, it would give springs more value earlier.

3. **Are terrain weights tuned intentionally?** The 45/25/20/10 split was apparently chosen, but there is no comment or design doc reference for it. Springs at 10% means some runs will have 0 springs across all 16 tiles, dramatically increasing difficulty — is that the intended variance?

4. **Is there a planned audio pass for the Trials system?** The `sfxResume` call exists in `TrialModal`, but no sound IDs are used in Long March or most other trials. Is this scaffolding for future sounds?

5. **Does the `distance` variable have a future use?** It is tracked in state, written to the final message, but not used in score or rewards. Is it a leftover from an earlier scoring formula, or is it intended for a future leaderboard or flavor system?

6. **Should EN stat level affect Long March?** All other stats are used in combat via `statLevels`, but no trial currently reads `statLevels`. Was this a deliberate design choice (trials are skill-based, not stat-gated) or an oversight?

7. **Is there a maximum achievable distance?** The theoretical max (all push on clear tiles = 2 × 16 = 32 distance, minus mud penalties and rough terrain choices) isn't documented anywhere. Knowing this would inform whether distance could be incorporated into scoring meaningfully.

8. **What happens to `bestTrialScore` if the scoring formula changes?** Old scores would remain in localStorage and could produce misleading star ratings under a new formula. Is there a migration path?
