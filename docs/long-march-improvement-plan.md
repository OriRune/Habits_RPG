# Long March — Improvement Plan

Based on `docs/long-march-minigame-analysis.md`.

---

## 1. Highest-Priority Improvements

These are the changes with the highest impact-to-effort ratio. They fix active player confusion or broken design intent.

### 1.1 Fix the distance/score disconnect

**What:** Either remove the Distance counter from the UI, or rewrite `marchScore` to incorporate it. As-is, the UI prominently tracks distance, the end screen says "Covered X leagues," and the score formula ignores it entirely.

**Why it matters:** This is the most confusing thing in the minigame. Players who push hard to maximise distance will earn identical scores to players who walked. It undermines trust in the feedback system and makes Push feel like a trap.

**Recommended fix:** Weight the score 70% on tiles completed + 30% on distance efficiency.
```
maxDistance = MARCH_TILES * 2  // theoretical max (all pushes on clear)
score = 0.7 * (tilesCompleted / MARCH_TILES) + 0.3 * (distance / maxDistance)
```
This makes Push meaningful without making it mandatory.

**Files:** `src/engine/trials/longMarch.ts` (`marchScore` signature and implementation), `src/components/trials/games/LongMarch.tsx` (pass `distance` to `onFinish` or compute inside engine).

---

### 1.2 Break spring-rest dominance

**What:** Currently, `rest` on a spring fully restores stamina to 12 — a free full heal. This creates a hard rule ("always rest on spring") that removes any decision-making from the most interesting tile in the game.

**Why it matters:** Springs are the only tile that rewards the player. Making them a mandatory "rest here" node collapses the decision space from 3 options to 1 whenever a spring appears.

**Recommended fix:** Replace the full-restore with a fixed large bonus (+6) and add a new `drink` pace option that fully restores but costs a turn of distance. Alternatively, cap spring rest at +5 but allow walk/push on a spring to also give a smaller bonus (+2 over the base).

The simplest single-file change: change the spring rest case from `MARCH_MAX_STA` to `6` in `marchStep`. This alone meaningfully opens up the spring decision.

**Files:** `src/engine/trials/longMarch.ts` (`marchStep`, `case 'rest'`), unit tests in `src/engine/trials/__tests__/trials.test.ts`.

---

### 1.3 Tie EN stat level to starting stamina

**What:** Add the player's EN `statLevel` to `MARCH_START_STA` at runtime, so higher EN means more stamina to work with.

**Why it matters:** Every other trial rewards the stat it trains but ignores the player's current investment in it. This severs the thematic feedback loop. A player who has grinded EN for weeks should feel that in the EN trial.

**Recommended fix:** Pass `enLevel` as a prop to `LongMarch` and compute starting stamina as `MARCH_START_STA + Math.floor(enLevel / 3)` (roughly +1 per 3 EN levels). Cap to prevent triviality.

**Files:** `src/components/trials/games/LongMarch.tsx` (add `enLevel` prop, update `useState(MARCH_START_STA)`), `src/components/trials/TrialModal.tsx` (read `character.statLevels.EN` from store, pass down), `src/engine/trials/longMarch.ts` (optionally export a helper `marchStartStamina(enLevel)`).

---

## 2. Gameplay and Mechanics Improvements

### 2.1 Show upcoming terrain (1-tile preview)

**What:** Display the next tile as a face-down or silhouetted card below the current tile. Reveal it fully when it becomes the active tile.

**Why it matters:** With no look-ahead, the player cannot plan stamina management — choosing whether to push or rest now depends entirely on what comes next. One tile of preview turns the game from reactive guessing into genuine resource planning.

**Files:** `src/components/trials/games/LongMarch.tsx` — render `terrain[tileIndex + 1]` with reduced opacity or a "?" label.

---

### 2.2 Add a Hard Mode or daily terrain theme

**What:** Add an optional Hard Mode toggle on the intro screen that uses a different terrain weight table (more rough/mud, fewer springs, shorter stamina). Alternatively, derive the weight table from the current date so each calendar day has a named theme ("Flood Day", "Mountain Pass", etc.).

**Why it matters:** The minigame has a single fixed difficulty. Once a player knows the optimal strategy it never changes. A hard mode or daily theme gives experienced players a reason to return and makes the daily trial feel fresh.

**Files:** `src/engine/trials/longMarch.ts` — add an `options` param to `generateTerrain` accepting alternate weights; `src/components/trials/games/LongMarch.tsx` — expose the toggle; `src/components/trials/TrialModal.tsx` — pass the option in.

---

### 2.3 Keep only the last log message in state

**What:** Replace the `log: LogEntry[]` array with a single `lastMessage: string` field.

**Why it matters:** The full log array grows to 16+ entries but only `log[log.length - 1].message` is ever rendered. The `LogEntry` type, the array spread, and the interface exist purely to serve a display that shows one string. This is the clearest example of over-engineering in the component.

**Files:** `src/components/trials/games/LongMarch.tsx` — remove `LogEntry` interface, replace `useState<LogEntry[]>([])` with `useState('')`, update `choosePace` to `setLastMessage(result.message)`.

---

## 3. Controls, UI, and Player Feedback Improvements

### 3.1 Color-coded pace buttons by risk

**What:** Apply a consistent visual language to the three pace buttons: Rest = green/safe, Walk = neutral/blue, Push = amber/warning. Currently all three use generic `Button` variants (`secondary`, default, `danger`), making "danger" feel like a negative action rather than a high-risk/high-reward choice.

**Why it matters:** The existing "danger" variant on Push signals "don't click this," which is the wrong read. A player should feel that Push is bold, not bad.

**Files:** `src/components/trials/games/LongMarch.tsx` — adjust `variant` props or add explicit `className` overrides on the pace buttons.

---

### 3.2 Show the outcome delta on each button (live stamina preview)

**What:** Display the projected stamina after each choice on the button itself, updating when terrain changes. E.g., on a rough tile: "Walk (-2 sta → 10 remaining)".

**Why it matters:** Right now the buttons show static hints ("−1 stamina, +1 progress") that are only accurate for clear terrain. On rough tiles, Walk actually costs −2 but the button says −1. Players who read the hints are given wrong information.

**Files:** `src/components/trials/games/LongMarch.tsx` — call `marchStep(tile, pace)` for each pace at render time (read-only, no state change) and display the resulting `staminaDelta` and `distanceDelta` inline on each button.

---

### 3.3 Add a visual terrain strip (progress map)

**What:** Render a horizontal row of 16 small tile icons below the progress bar — completed tiles shown as their emoji, the current tile highlighted, future tiles as neutral dots or `?`.

**Why it matters:** Spatial representation of march progress makes the 16-tile run feel like a journey rather than a counter incrementing. It also gives the upcoming-terrain preview (§2.1) a natural home.

**Files:** `src/components/trials/games/LongMarch.tsx` — map `terrain` array to a row of small icons; conditionally reveal based on `tileIndex`.

---

### 3.4 Add an in-component retry button on completion

**What:** When `done === true`, show a "March Again" button that resets state to initial values and generates a new terrain.

**Why it matters:** Currently the only way to replay is to close the modal and reopen the card. For players with `repeatMinigames` enabled (or on first clear), this adds unnecessary friction.

**Files:** `src/components/trials/games/LongMarch.tsx` — a reset function that calls `setTileIndex(0)`, `setStamina(MARCH_START_STA)`, `setDistance(0)`, `setLastMessage('')`, `setDone(false)`, and generates a new terrain. Note: terrain must move out of `useMemo` into state for this to work, since `useMemo` doesn't re-run on demand.

---

### 3.5 Distinguish the end state clearly

**What:** When the march ends from exhaustion, show a distinct visual from a successful completion — different emoji, different color treatment, maybe a brief screen-shake class. Currently both states render a plain text paragraph.

**Why it matters:** The emotional difference between "you made it" and "you collapsed" is significant. The UI currently treats them as near-identical.

**Files:** `src/components/trials/games/LongMarch.tsx` — branch the end-state render on `stamina <= 0` vs. full completion.

---

## 4. Visual and Audio Polish

### 4.1 Sound effects

**What:** Add three short sound cues: a steady footstep on Walk, a heavier crunch on Push, and a water/chime sound on spring. On collapse, play an exhaustion sound.

**Why it matters:** Long March is completely silent. Sound is the fastest way to make a turn-based click game feel alive. The SFX infrastructure already exists in `src/lib/sfx.ts` — this is wiring, not plumbing.

**Files:** `src/lib/sfx.ts` (add sound IDs if not present), `src/components/trials/games/LongMarch.tsx` (`choosePace` — fire the appropriate SFX after resolving the step).

---

### 4.2 Tile transition animation

**What:** When `tileIndex` advances, slide or fade the terrain card out and the new one in. A simple CSS keyframe (`animate-slide-in-from-right`) or a Tailwind `transition` with a key change on the card element is sufficient.

**Why it matters:** Currently the tile card snaps to the new content with no transition. A brief 150ms slide makes the pace choices feel like forward motion.

**Files:** `src/components/trials/games/LongMarch.tsx` — add `key={tileIndex}` to the tile card div and a Tailwind animation class. May need a new keyframe in `tailwind.config.js` if one doesn't exist.

---

### 4.3 Stamina bar pulse at critical levels

**What:** When stamina drops to ≤3 (25%), add a subtle pulse animation to the stamina bar.

**Why it matters:** The color change from amber to red is already present, but the pulse creates urgency without requiring the player to watch the number — it's a peripheral cue.

**Files:** `src/components/trials/games/LongMarch.tsx` — add a conditional `animate-pulse` or similar Tailwind class to the stamina bar fill div.

---

## 5. Technical / Code Improvements

### 5.1 Accept an optional RNG seed in `generateTerrain`

**What:** Change the signature from `generateTerrain(rng: () => number)` to `generateTerrain(rng?: () => number)` with a default of `Math.random`, and ensure tests always pass a seeded RNG.

**Why it matters:** The existing tests already use a `seededRng()` helper, so the pattern is established. Making this the default for tests and optional for production ensures deterministic test coverage without changing the production behavior.

**Files:** `src/engine/trials/longMarch.ts` — default parameter; `src/engine/trials/__tests__/trials.test.ts` — already correct.

---

### 5.2 Extract terrain weights to a named constant

**What:** Move the inline `weights` array in `generateTerrain` to a named export `TERRAIN_WEIGHTS` (or a config object) at the top of the file.

**Why it matters:** The weights are currently buried inside the function body. Tuning them requires reading past the function signature and type imports. A named constant at the top makes balance tweaking and the Hard Mode feature (§2.2) trivial to implement.

**Files:** `src/engine/trials/longMarch.ts` only.

---

### 5.3 Co-locate pace costs as data, not switch logic

**What:** The `marchStep` function is a nested `switch` with inline arithmetic for each pace × terrain combination. This is correct but opaque to tune. Extract the cost table to a data structure:
```typescript
const PACE_TERRAIN: Record<MarchPace, Record<TerrainKind, { sta: number; dist: number }>> = { ... }
```
Then `marchStep` becomes a lookup + narrative selector.

**Why it matters:** The pace × terrain matrix is the core balance lever of the minigame. As-is, changing mud's Walk penalty requires finding it nested inside two switch cases. A data table makes the balance immediately readable and comparable across terrain types.

**Files:** `src/engine/trials/longMarch.ts` — refactor `marchStep`. No behavior change required during the refactor.

---

### 5.4 Document `marchScore` contract on the `distance` parameter

**What:** If distance is added to the scoring formula (§1.1), `marchScore` should accept both `tilesCompleted` and `distance` as named params and be documented with the formula. If distance is intentionally excluded, add a short comment explaining why.

**Why it matters:** The current absence of any comment on `marchScore` means the distance-is-ignored behavior looks like an oversight to anyone reading the file cold.

**Files:** `src/engine/trials/longMarch.ts`.

---

## 6. Integration with the Larger Game

### 6.1 Display best score improvement on result screen

**What:** In `TrialModal`'s result stage, read `bestTrialScore['long_march']` from the store *before* calling `completeTrial`, and if the new score exceeds it, show "New personal best!" alongside the stars.

**Why it matters:** The best score persists to the hub card as stars, but the player has no in-moment feedback that they improved. This closes the loop.

**Files:** `src/components/trials/TrialModal.tsx` — read `bestTrialScore[trialId]` before the result is claimed; compare against `score` and render a badge if improved.

---

### 6.2 Surface EN stat level in the intro screen

**What:** On the Long March intro card (inside `TrialModal`), show the player's current EN stat level alongside a line like "Your Endurance (Lv. 4) grants +1 starting stamina."

**Why it matters:** Once EN level affects stamina (§1.3), the player needs to know this relationship exists. Surfacing it on the intro screen connects the main game's progression system to the trial's mechanics visibly.

**Files:** `src/components/trials/TrialModal.tsx` — add an EN stat callout to the intro stage for `long_march`; or add a generic "stat bonus" line driven by a helper in `longMarch.ts`.

---

### 6.3 Consider a "streak" indicator on the Trials hub

**What:** Track consecutive days on which Long March (or any trial) was completed, and show a flame or counter badge on the hub card.

**Why it matters:** The daily habit loop is the core of HabitsRPG. A streak indicator ties the Trials system directly to that loop and creates a soft daily-return incentive.

**Files:** `src/store/useGameStore.ts` (add `trialStreak: Record<TrialId, number>` and `lastStreakDate`), `src/views/TrialsView.tsx` (render streak badge on cards), `src/engine/trials/trials.ts` (helper to compute streak validity).

This is the largest integration change; treat it as optional/deferred.

---

## 7. Suggested Implementation Order

Work roughly in this order to avoid churn and build on stable ground:

| Step | Change | Effort | Section |
|---|---|---|---|
| 1 | Fix distance/score disconnect (remove distance display OR update formula) | Small | §1.1 |
| 2 | Break spring-rest dominance (cap spring rest at +6) | Trivial | §1.2 |
| 3 | Replace log array with single last-message string | Trivial | §2.3 |
| 4 | Extract terrain weights to named constant | Trivial | §5.2 |
| 5 | Fix button stamina hints to reflect current terrain | Small | §3.2 |
| 6 | Co-locate pace costs as a data table | Small | §5.3 |
| 7 | Tie EN stat level to starting stamina | Small | §1.3 |
| 8 | Add in-component retry button | Small | §3.4 |
| 9 | Distinguish exhaustion vs. completion end state | Small | §3.5 |
| 10 | Add stamina bar pulse at critical levels | Trivial | §4.3 |
| 11 | Color-code pace buttons correctly | Trivial | §3.1 |
| 12 | Add tile transition animation | Small | §4.2 |
| 13 | Add 1-tile terrain preview | Small | §2.1 |
| 14 | Add visual terrain strip | Medium | §3.3 |
| 15 | Sound effects | Medium | §4.1 |
| 16 | Surface EN stat on intro screen | Small | §6.2 |
| 17 | Best-score improvement badge on result | Small | §6.1 |
| 18 | Seed `generateTerrain` for test determinism | Trivial | §5.1 |
| 19 | Hard Mode / daily terrain theme | Medium | §2.2 |
| 20 | Streak indicator on hub | Large | §6.3 |

**Steps 1–6** are pure cleanup and correctness fixes — low risk, high payoff, no new features.  
**Steps 7–13** are core gameplay improvements that make the minigame noticeably more fun.  
**Steps 14–18** are polish that elevate the experience once the mechanics are solid.  
**Steps 19–20** are new features; tackle them after the foundation is stable.
