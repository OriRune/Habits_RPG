# Last Stand — Minigame Analysis

> **Purpose of this document:** A developer-facing overview of the Last Stand minigame as it exists today, written to support an improvement plan. All facts are drawn from the current source files; section 11 flags anything that required inference.

---

## 1. Basic Summary

Last Stand is a reflex-based trial in the Skill Trials system. The player watches for incoming attacks that telegraph their direction (Left, Center, or Right) and presses the matching key or button to block them before they land. It is one of eight daily Skill Trials, each mapped to one of the game's eight stats. Last Stand is the trial for the **HP stat**.

Within the larger game it functions as a repeatable daily challenge. The player earns a score (0–100%), which is converted to a star rating (1–3 ★) and translated into HP stat XP and gold. Daily gating means the reward can only be claimed once per calendar day.

---

## 2. Core Game Loop

### Start
The player opens the Skills tab, selects the Last Stand trial card, reads an intro screen that describes the rules, and presses **Begin Trial**. The game component mounts and the `requestAnimationFrame` loop starts immediately.

### During Play
A fixed set of 16 attacks is pre-generated at component mount. Each attack has a direction (left / center / right) and a scheduled landing time. Attacks appear on screen 1400 ms before they land, and they scale up visually as the landing moment approaches. A 700 ms block window opens 700 ms before landing. The player presses the matching directional button (keyboard or pointer) to block; if no block arrives by the deadline the attack resolves as a hit and deals 14 HP of damage.

The 16 attacks are spread across 8 waves of 2 attacks each, with waves 1200 ms apart within a 2400 ms wave interval. The first attack lands at 1400 ms and the last at ~19 400 ms, giving a total run of about 19–20 seconds assuming the player survives.

### Challenge
Difficulty is introduced entirely through pace and randomness of direction. Two attacks per wave overlap in time, so the player may need to block both directions quickly. Because directions are randomly assigned (uniform 1-in-3 per attack), both attacks in a wave can share a direction; the system handles this by stacking them in time and letting the player hit the button once per attack.

### End
The loop exits on whichever comes first:
- All 16 attacks are resolved (win by survival)
- HP drops to 0 (early exit; future attacks are left unresolved)

### Rewards / Penalties
- **Score:** `blocked / 16` — fraction of total attacks successfully blocked. Unresolved attacks (if the player dies early) simply don't count as blocked; they are not added to the miss count, but the denominator is always 16, so dying early still suppresses the score.
- **Stars:** ≥75% → 3★ · ≥40% → 2★ · <40% → 1★ (from `scoreToStars` in `trials.ts`)
- **Stat XP:** `round((20 + 8 × level) × (0.25 + 0.75 × score))`
- **Gold:** `round((15 + 5 × level) × (0.25 + 0.75 × score))`
- A 25% participation floor guarantees some reward even on a 0% score.
- Results feed into `completeTrial` in the store, which stamps the daily date gate and updates the personal best score.

---

## 3. Player Controls and Interaction

### Input Controls

| Action | Keyboard | On-screen button |
|---|---|---|
| Block Left | `ArrowLeft` or `A` | "← Left" button |
| Block Center | `Space` or `S` | "▲ Center" button |
| Block Right | `ArrowRight` or `D` | "→ Right" button |

All keyboard events call `e.preventDefault()` to suppress browser scrolling. The keyboard handler is attached to `window` with a `keydown` listener. Mouse/touch uses the three `<Button>` components.

### UI Elements

| Element | Description |
|---|---|
| HP bar | Horizontal bar at the top; color-coded green (>60%), amber (30–60%), red (<30%). Label reads "🛡️ Endurance — N%". |
| Attack display | Three columns (left / center / right), each showing a ⚔️ emoji and a directional arrow emoji. The sword scales from 0.6× to 1.0× as the attack approaches. Columns are dimmed to 10% opacity when no attack is incoming. |
| Block buttons | Three `<Button>` elements below the attack display; disabled after game end. |
| Blocked counter | Inline text: "Attacks blocked: X / Y" (of resolved attacks) during play; switches to "N / 16 attacks blocked" on finish. |
| Keyboard hint | Static footer text listing the key bindings. |

### Player Feedback

- Visual: the sword emoji grows toward the player as the deadline approaches. There is no distinct "success" or "failure" animation — a blocked attack simply disappears from the display.
- HP bar shrinks and changes color after a hit; color change is the primary sign that something bad happened.
- No sound effects, screen shake, or flash on hit or block.

### Menus and Overlays

The game runs inside `TrialModal.tsx`, which provides three stages: `intro` → `playing` → `result`. The result screen shows the star rating, percentage score, and a reward breakdown before the player presses "Claim Reward."

---

## 4. Mechanics and Systems

### Attack Generation (`generateAttacks`)

```
TOTAL_WAVES      = 8
ATTACKS_PER_WAVE = 2
WAVE_INTERVAL_MS = 2400
SPAWN_AHEAD_MS   = 1400   (when the sword first appears)
BLOCK_WINDOW_MS  = 700    (earliest the player can block)
```

Landing times (ms from start):
- Wave 0: 1400 ms, 2600 ms
- Wave 1: 3800 ms, 5000 ms
- …
- Wave 7: 18 200 ms, 19 400 ms

Each attack direction is chosen uniformly at random from `['left', 'center', 'right']` using `Math.random()`.

### Blocking Logic (`block` function)

When the player inputs a direction, the function finds the earliest unresolved attack in that direction whose landing time is within `[elapsed − BLOCK_WINDOW_MS, elapsed + BLOCK_WINDOW_MS]`. That attack is marked `'blocked'`. Only one attack per call is blocked (the soonest-landing candidate).

Edge case: the block window extends slightly _after_ the landing time (`elapsed <= landMs + BLOCK_WINDOW_MS`), giving a tiny grace window for late inputs, but the RAF loop's hit-resolution check (`el > landMs + BLOCK_WINDOW_MS`) runs on the same threshold, so the grace is at most one frame wide.

### Damage

Each `'hit'` result deals **14 HP**. Starting HP is 100. Maximum hits before death: floor(100 / 14) = **7 misses** (7 × 14 = 98; 8 × 14 = 112 > 100). To reach 3★ the player must block ≥12 of 16 attacks, meaning they can miss at most 4, well inside the death threshold.

### Win / Loss Conditions

- **Survive:** All 16 attacks resolve (some blocked, some hit). Game ends, `finish(next)` is called.
- **Die:** HP reaches 0 mid-run. Game ends immediately; attacks with `result: null` stay null and are not counted as blocked, pulling down the score.

### Scoring

`score = blocked_attacks / 16`

The denominator is always 16 regardless of whether the player died. This means a player who blocked 8 and died on the 9th miss scores 8/16 = 50%, equivalent to blocking exactly half of all scheduled attacks.

### Difficulty Curve

There is no progressive difficulty. All 16 attacks use the same timing constants, and direction is pure random. The only pressure increase is that the player must sustain focus for the full ~19 seconds.

### Integration with the Larger Game

- **Daily gate:** `trialsClearedOn['last_stand']` is checked against today's ISO date before rewarding. The `settings.repeatMinigames` dev flag bypasses this.
- **Stat:** `HP`. Score flows into `trialReward('HP', score, level)` → returns `{ gold, statXp: { HP: n } }`.
- **Best score:** `bestTrialScore['last_stand']` is updated to the maximum of the stored score and the new score. This is used on the hub card to display stars.
- **Level-up:** `checkLevelUp` is called after `applyReward`; the trial can trigger a level-up.

### Randomization

Direction assignment uses `Math.random()` directly — no seeded RNG, no reproducibility across runs.

---

## 5. Technical Implementation

### Files

| File | Role |
|---|---|
| `src/components/trials/games/LastStand.tsx` | The entire minigame: state, RAF loop, input handler, and render |
| `src/components/trials/TrialModal.tsx` | Shell that hosts all eight trials; handles intro/result stages and reward claim |
| `src/engine/trials/trials.ts` | Trial registry (`TRIALS`, `getTrial`, `scoreToStars`, `trialReward`, `emptyTrialsClearedOn`, `emptyBestTrialScore`) |
| `src/store/useGameStore.ts` | `completeTrial` action; `trialsClearedOn` and `bestTrialScore` state fields |
| `src/engine/trials/__tests__/trials.test.ts` | Tests for `trialReward`, `scoreToStars`, and the TRIALS registry (no Last Stand–specific tests) |

### Key Functions

**`generateAttacks(rng)`** (`LastStand.tsx`) — builds the full 16-attack schedule. Called once at component mount via `useRef(generateAttacks(Math.random))` so it is stable across renders.

**`block(dir)`** (`LastStand.tsx`, `useCallback`) — resolves one blocked attack on player input. Reads `elapsedRef.current` and `attacksCopy.current` (refs, not state) to avoid stale closure issues with the RAF loop.

**`finish(finalAttacks)`** (`LastStand.tsx`, `useCallback`) — calculates score and calls `onFinish(score01)`. `onFinish` is provided by `TrialModal`.

**RAF loop** (`useEffect`, single effect, never re-runs) — runs every frame; increments `elapsedRef`; checks whether any attack has passed `landMs + BLOCK_WINDOW_MS` and marks it `'hit'`; applies HP damage; calls `finish` if HP = 0 or all resolved.

**`completeTrial(trialId, score01)`** (`useGameStore.ts`) — stamps the date gate, updates best score, applies reward, runs level-up check.

### State Management

The component uses both `useState` (for render-driven values: `attacks`, `hp`, `elapsed`, `done`) and `useRef` (for values the RAF loop reads without needing a re-render: `attacksCopy`, `hpRef`, `elapsedRef`, `startMs`, `rafRef`). This dual approach avoids stale closure bugs but means the same data lives in two places; `attacksCopy.current` and `attacks` are kept in sync manually after every mutation.

### Data Flow

```
Math.random() → generateAttacks() → attacksRef (ref)
                                  → attacks (state, for render)

RAF tick → elapsed → incoming[] (derived, used in render)
         → detect expired attacks → attacks + hp updated (state + ref)
         → finish() → onFinish(score01) → TrialModal.handleFinish
                                        → stage = 'result'
                                        → store.completeTrial() on claim
```

### Save / Load

No mid-game save. The store persists `trialsClearedOn` and `bestTrialScore` to `localStorage` via Zustand `persist`. If the player closes the tab mid-game, no progress is saved.

### Configuration

All timing constants are module-level `const` values at the top of `LastStand.tsx`. There is no shared constants file or content config for this trial; the trial definition (stat, name, blurb, glyph) lives in `src/engine/trials/trials.ts`.

---

## 6. Software, Libraries, and Tools Used

| Concern | Technology |
|---|---|
| Framework | React 18 (hooks: `useState`, `useEffect`, `useRef`, `useCallback`) |
| Language | TypeScript |
| Build / bundler | Vite |
| Styling | Tailwind CSS v3 (utility classes, custom tokens like `text-ink-muted`, `bg-parchment-300/50`) |
| State management | Zustand with `persist` middleware |
| Rendering | DOM / HTML — no canvas, no WebGL |
| Animation loop | `requestAnimationFrame` (browser native) |
| CSS transitions | `transition-all duration-200` on HP bar width; `scale()` transform on sword emoji |
| Physics | None — purely timed events |
| Audio | None — no SFX in Last Stand. (`sfxResume()` is called by TrialModal on "Begin Trial" to unlock the AudioContext, but Last Stand itself plays no sounds.) |
| RNG | `Math.random()` (non-seeded) |
| Test runner | Vitest |
| UI primitives | `<Button>` from `src/components/ui/Button` |

---

## 7. Assets and Presentation

Last Stand uses no image assets, sprite sheets, canvas art, or audio files. The entire visual presentation is emoji and Tailwind-styled HTML:

- **Incoming attack indicator:** ⚔️ emoji, scaled via inline `transform: scale(...)` driven by attack progress.
- **Directional indicators:** Emoji arrows (⬅️ ⬆️ ➡️) as column labels.
- **HP bar:** A `<div>` with a width percentage; color shifts through three CSS classes.
- **Score feedback:** Plain text.
- **Trial icon / glyph:** 🛡️ (shown in the TrialModal header and result screen).

**Mood:** Minimal and functional. The emoji approach gives a quick visual read of direction and urgency but has no animated polish — no particle effects, no impact flash, no damage number pop, no musical beat, no shake on hit.

---

## 8. Current Player Experience

### What Works

- **Clear concept:** The three-direction block mechanic is immediately legible. New players understand what to do from the description and the visual layout.
- **Keyboard controls are well-chosen:** WASD / arrows are natural for left/center/right blocking and map to the directional arrows on screen.
- **Short session:** ~19 seconds is fast; the trial never overstays its welcome.
- **No confusing state:** The HP bar gives a continuous progress signal; the blocked counter gives a running score.

### What Feels Weak

- **No hit feedback.** When an attack lands, the sword emoji disappears and the HP bar shrinks slightly, but there is no hit flash, screen shake, sound effect, or damage number. Miss events feel invisible, which makes it hard to tell what just happened.
- **No block confirmation.** A successful block also just removes the emoji. There is no "shield parry" animation, particle burst, or satisfying sound. Both outcomes (block and hit) feel the same.
- **Flat difficulty.** All 16 attacks arrive at the same pace with the same timing constants. There is no ramp — wave 1 and wave 8 feel identical. Experienced players may find it trivially easy once the timing is internalized.
- **Random direction with no strategy.** Both attacks in a wave can be the same direction, potentially making the wave trivially easy or requiring the same button twice. Alternatively, two different directions can arrive 1200 ms apart, which feels fine. There is no deliberate choreography.
- **The HP bar label says "🛡️ Endurance"** but the trial stat is HP. Minor flavor inconsistency.
- **Score display during play is confusing.** "Attacks blocked: X / Y" where Y is resolved attacks (not 16) means the denominator changes during play, making it hard to track performance.
- **Dying early is doubly punishing.** A player who dies on the 8th miss has blocked some attacks but scores `blocked / 16`, counting 8+ unplayed attacks against them. A player who barely survives with 8 misses gets the same score but can at least try to block the remaining 8.

### Pacing

The opening 1.4 seconds are dead time (first attack hasn't appeared yet). After that it moves at a steady pace. No crescendo, no rest beats.

### Difficulty Fairness

The 700 ms block window is reasonably generous for keyboard input. The 1400 ms visual warning should give ample reaction time. The main failure mode is losing focus, not reaction-time failure. 3★ (≥75% = 12/16 blocked) is achievable in a first run; 100% requires consistent focus for 19 seconds.

---

## 9. Known Issues and Weak Points

### Design

1. **No difficulty ramp.** 8 waves all feel the same. No tempo increase, no tightening timing window, no additional attacks per wave in later rounds.
2. **Purely random direction** with no designed choreography means runs feel arbitrary rather than challenging. Two attacks in the same direction in one wave is anti-climactic; two different directions 1200 ms apart is routine.
3. **Score formula is punishing on death.** Dying early inflates the miss count because unplayed attacks count against the denominator of 16.
4. **No feedback on hit or block.** Visual and audio feedback are both absent for the two most important game events.
5. **HP bar label ("Endurance") conflicts with the trial stat (HP).** The label is likely an artifact of early design when this was a different stat.

### Technical

6. **All logic lives in the React component.** Unlike Lockpicking, Rooftop Chase, Armory Break, Long March, and Ancient Library — each of which has a dedicated pure-function engine file in `src/engine/trials/` — Last Stand has no `src/engine/trials/lastStand.ts`. The timing constants and attack generation logic are untestable without mounting the component.
7. **No tests.** The `trials.test.ts` file covers other trials' engine functions but has no Last Stand cases. There are no timing, scoring, or edge-case tests.
8. **Non-seeded RNG.** `generateAttacks(Math.random)` is called at mount. Runs are non-reproducible, which makes debugging and testing harder.
9. **Dual state/ref bookkeeping.** `attacks` (state) and `attacksCopy.current` (ref) are kept in sync by hand. A desync bug (forgetting to update one) would cause subtle rendering or logic errors.
10. **Score display denominator shifts.** "Attacks blocked: X / Y" uses resolved count as Y, which changes during play. Players may read it as "X out of 16" and be confused when Y is less.
11. **Block timing grace window edge case.** The block window check (`el <= a.landMs + BLOCK_WINDOW_MS`) and the hit-resolution check (`el > a.landMs + BLOCK_WINDOW_MS`) share the same threshold. In a frame where both fire simultaneously (unlikely but theoretically possible), the RAF loop resolves first and could mark an attack 'hit' before the input handler's block fires. Input priority is not guaranteed.
12. **No mid-run save.** Closing the tab abandons progress silently.

---

## 10. Improvement Opportunities

### Controls and Feedback
- Add a brief flash (green/gold) on the button or attack column when a block lands successfully.
- Add a red flash, screen shake, or damage number popup when an attack hits.
- Add distinct sound effects: a clang/thud for a block, a different thud for a hit, and a shield-break sound on death.

### Mechanics and Difficulty
- Introduce a difficulty ramp: tighten `BLOCK_WINDOW_MS` (e.g., 700 → 550 → 400) or increase attacks per wave in later waves.
- Design wave choreography intentionally — e.g., guarantee both attacks in a wave use different directions, or create deliberate "combo" sequences rather than pure random.
- Fix the score-on-death formula so that unresolved attacks are excluded from the denominator (i.e., `blocked / resolved`), making early death less of a double penalty.

### Visuals
- Animate the sword emoji on block (scale down, fade) and hit (flash red then disappear).
- Add a directional "danger zone" glow on columns when an attack is close to landing.
- Optionally replace emoji with a small canvas or SVG for more expressive animations.

### Code Quality
- Extract timing constants and `generateAttacks` into `src/engine/trials/lastStand.ts` as pure, testable functions (following the pattern of the other trials).
- Add Vitest tests for attack generation, block timing edge cases, damage calculation, and scoring.
- Switch from `Math.random()` to a seeded RNG (the pattern used in other trial engine files) for reproducibility.
- Remove the dual state/ref pattern by committing to a single ref-based state for the RAF loop and driving renders from a single source.

### Presentation
- Fix the HP bar label: change "🛡️ Endurance" to "❤️ HP" to match the trial's stat.
- Fix the score display during play to show `X / 16` rather than `X / <resolved_count>`.

### Integration
- Consider linking the `BLOCK_WINDOW_MS` or number of attacks to the player's HP stat level, giving higher-level characters a slightly easier trial or a richer wave count as a progression signal.

---

## 11. Questions and Unknowns

1. **Is the HP bar label ("Endurance") intentional?** It may reflect an earlier design where Last Stand was an Endurance (EN) trial. Worth confirming which stat it should display.

2. **Should a player who dies early be scored on `blocked / resolved` or `blocked / 16`?** The current `blocked / 16` formula is harsher on death. The design intent is unclear.

3. **Is the `BLOCK_WINDOW_MS` grace-on-landing intended?** The window closes at `landMs + BLOCK_WINDOW_MS`, which gives a 700 ms window after landing, not before. If the design intent is "block before it lands," the check should be `el >= landMs - BLOCK_WINDOW_MS && el <= landMs`.

    Re-reading the code: the visible sword appears at `landMs - SPAWN_AHEAD_MS`, the block window opens at `landMs - BLOCK_WINDOW_MS`, and closes at `landMs + BLOCK_WINDOW_MS`. So a 1400 ms total window is available but only 700 ms of it is visible "warning" time before the attack officially lands. The 700 ms after landing acts as a hidden late-block window. Whether this is intentional lenience or an off-by-one is unclear.

4. **Is there any plan for a hard-mode or scaling variant?** No evidence in the current codebase; the stat-level integration opportunity (mentioned in §10) may or may not fit the game's design.

5. **Why does Last Stand have no dedicated engine file?** Other trials have `src/engine/trials/lockpicking.ts`, `rooftopChase.ts`, etc. Last Stand skips this layer. Was it intentionally simple, or was it never refactored?

6. **Is SFX supposed to play in Last Stand?** `sfxResume()` is called by `TrialModal` before entering any trial (to unlock the AudioContext), but Last Stand itself plays no sounds. If sound effects were planned but not implemented, that is a missing feature.
