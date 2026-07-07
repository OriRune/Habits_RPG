# Ancient Library — Minigame Analysis (Updated)

> Reflects the current implementation after the improvements described in `docs/archived/ancient-library-improvement-plan.md`.
> Previous analysis snapshot is in git history.

---

## 1. Basic Summary

Ancient Library is the Knowledge (KN) Skill Trial — one of eight daily minigames tied to the game's eight character stats. It is a Simon-style memory game: a sequence of emoji glyphs flashes on screen one at a time, each accompanied by a distinct musical tone, then the player must tap them back in the same order. Each round the sequence grows by one glyph. The trial ends after all seven rounds, on a second wrong tap, or after using the single retry and failing a second time.

Within the larger game, Skill Trials are daily challenges unlocked at player level 3. Each trial awards stat XP and gold. Ancient Library is the exclusive source of KN XP from trials. It can be completed once per calendar day (or replayed freely if the `repeatMinigames` dev setting is on). A skilled run takes roughly 60–90 seconds.

Key characteristics of the current implementation:
- **Seven rounds**, sequence lengths 2–8 (warm-up at length 2, max length 8)
- **Daily-seeded sequence** — same glyphs for all players on a given calendar day
- **Audio feedback** — each glyph has a pentatonic tone; correct/wrong sounds play on round outcomes
- **Single retry** — one wrong tap per session replays the current round instead of ending the trial
- **KN stat integration** — at KN ≥ 5, the show phase double-flashes one back-half glyph; at KN ≥ 10, two glyphs are double-flashed
- **Thematic button colors** — each glyph button has a unique idle tint and a tap-flash highlight

---

## 2. Core Game Loop

### Start

The player navigates to the Skills tab (`tab='skills'`), which renders `TrialsView`. They tap the Ancient Library card (📚, KN Trial). If the trial has already been cleared today, the card is marked "Done" (still tappable if `repeatMinigames` is enabled). Tapping opens `TrialModal` in `intro` stage.

The intro screen shows the trial name, a one-sentence description, a "Begin Trial" button, and (if a previous best exists) the best score with stars and percentage. Pressing the button fires `sfxResume()` to unlock the browser AudioContext, then transitions `TrialModal` to `playing` stage, which mounts `<AncientLibrary onFinish={…} />`.

### Repeating loop per round

1. **Show phase** — glyphs from the master sequence are displayed one at a time. Each glyph is accompanied by its pentatonic tone. Display speed starts at 700 ms/glyph and decreases linearly to 500 ms/glyph by the final round (via `glyphShowMs(round)`). KN hint glyphs are shown twice consecutively. After the last glyph, a 400 ms pause allows transition to input.
2. **Input phase** — the 3×2 glyph button grid activates. A row of filled/empty circles shows progress. Each button tap plays the glyph's tone and flashes the button with its thematic color for 150 ms.
3. **Validate** — each tap is checked immediately.
   - Correct and sequence complete → `correct` phase (800 ms: completed sequence is displayed, `libraryCorrect` sound), then either next round (900 ms delay) or trial finish.
   - Wrong tap, retry available → `wrong` phase (1 s), then the same round replays from the beginning; retry is consumed.
   - Wrong tap, retry exhausted → `wrong` phase (1 s, `libraryWrong` sound), then trial finish.
4. Round counter increments, sequence length increments by 1, loop repeats.

### Challenge / difficulty

Sequence lengths run 2 → 8 across seven rounds. The display speed ramps from 700 ms to 500 ms by the last round. The single retry allows one mistake per session at the cost of replaying the current round. KN stat double-flashes provide passive hints at high stat levels. The player can deliberate as long as they wish during input — there is no time pressure.

### End conditions

- **Fail:** Player taps a wrong glyph with no retry remaining. `phase='wrong'` briefly, then `onFinish(libraryScore(roundsCompleted))` fires.
- **Complete:** Player survives all seven rounds. `onFinish(libraryScore(7))` fires (score = 1.0).

### Outcomes

`TrialModal` receives the score and transitions to `result` stage, showing star rating, percentage, reward breakdown, and a "New personal best!" pulse if applicable. The player taps "Continue" which fires `completeTrial(trialId, score01)` in the store, depositing gold + KN XP. A second button ("Return to Trials") closes the modal. The "Done" badge appears on the hub card for the rest of the day. The last-cleared date is shown on the card for previous (non-today) clears.

---

## 3. Player Controls and Interaction

### Input controls

- **Mobile / touch:** Tap glyph buttons. The grid is 3×2, full-width `max-w-xs`, sized for comfortable thumb reach.
- **Desktop / mouse:** Click the same buttons.
- No keyboard input is wired up.

### UI elements

| Element | Appears when | Purpose |
|---|---|---|
| Round counter (`Round X of 7`) | Always | Tracks progress |
| Sequence length indicator (`Sequence: N`) | Always | Shows current target length |
| Glyph display box (80px tall) | Always | Active glyph (animated), completed sequence, feedback icons, or prompt text |
| Progress tracker (circles) | `input` phase | Filled = correct so far, empty = still needed |
| 3×2 glyph button grid | `input` phase | Tap to make choices; thematic idle tint + tap-flash |
| Retry indicator (`✦ 1 retry remaining` / `✦ retry used`) | `input` and `wrong` phases | Shows whether the retry is still available |
| Status text line | Always | Narrates current phase in plain English |

Notable elements removed since the original analysis:
- **Sequence progress strip** — the `•` / glyph / `○` strip that appeared below the display box during show phase has been removed. It added visual noise without aiding memory.

### Feedback given to the player

- **Show phase:** Glyph lights up with a bounce-in animation (`key={showIndex}` triggers remount); its pentatonic tone plays.
- **Tap (any):** The pressed button flashes its thematic color for 150 ms; the glyph's tone plays immediately.
- **Wrong tap:** `libraryWrong` sound (descending buzz) plays; ❌ appears in the display box.
- **Correct round:** `libraryCorrect` sound (ascending chime) plays; completed sequence is displayed side-by-side in the display box; status text "Round N complete! Next round…"
- **Wrong with retry consumed:** Same wrong feedback, then the round replays with "1 retry remaining" dimmed.
- **Trial finished:** 📚 in display box; status text "Completed N of 7 rounds."

### Menus / overlays

`TrialModal` takes over the screen (`fixed inset-0 z-50`). The header shows the trial icon, name, stat label, and a ✕ button. Tapping ✕ during an active run shows an inline "Abandon run? Yes / No" confirmation prompt rather than closing immediately. At any other stage (intro or result) it closes directly.

---

## 4. Mechanics and Systems

### Scoring (`src/engine/trials/ancientLibrary.ts`)

```
score = Math.min(1, roundsCompleted / LIBRARY_MAX_ROUNDS)
```

- 0 rounds = 0.0 (failed on first sequence without using retry, or used retry and failed again on round 1)
- 3 rounds ≈ 0.43
- 7 rounds = 1.0

### Sequence generation

A master sequence of 8 glyphs is generated once at component mount using a daily-seeded LCG (`seededRng(dailySeed(toISODate()))`). All players see the same sequence on a given calendar day. Each round uses a prefix of this master sequence (`masterSeq.slice(0, currentLength)`), so subsequent rounds extend the same chain — the player memorises further into the same sequence each round.

`generateSequence` is deterministic when given a seeded RNG. The daily seed is derived from the ISO date string by stripping hyphens and parsing the result as an integer (e.g. "2026-06-18" → 20260618).

### Glyph set

Six emoji glyphs: 🔥 💧 🌿 ⚡ 🌙 ⭐. Each is mapped to a thematic color (`GLYPH_COLORS`) and a pentatonic tone (`GLYPH_TONES`). Repetition within a sequence is possible and intentional.

### Sequence lengths across rounds

| Round | Sequence length | Display speed |
|---|---|---|
| 1 | 2 | 700 ms/glyph |
| 2 | 3 | 667 ms/glyph |
| 3 | 4 | 633 ms/glyph |
| 4 | 5 | 600 ms/glyph |
| 5 | 6 | 567 ms/glyph |
| 6 | 7 | 533 ms/glyph |
| 7 | 8 | 500 ms/glyph |

Speed is linearly interpolated by `glyphShowMs(round)`. At KN hints, double-flashed positions add one extra step to the schedule (the sequence length itself is unchanged).

### Glyph tones (`GLYPH_TONES` in `ancientLibrary.ts`)

| Glyph | Frequency |
|---|---|
| 🔥 | 523 Hz (C5) |
| 💧 | 587 Hz (D5) |
| 🌿 | 659 Hz (E5) |
| ⚡ | 784 Hz (G5) |
| 🌙 | 880 Hz (A5) |
| ⭐ | 1047 Hz (C6) |

All tones are pentatonic, so any combination within a sequence is non-dissonant.

### Star thresholds (`trials.ts`)

| Stars | Score range | Rounds needed |
|---|---|---|
| ⭐ | < 0.40 | 0–2 |
| ⭐⭐ | 0.40–0.74 | 3–5 |
| ⭐⭐⭐ | ≥ 0.75 | 6–7 |

(Thresholds unchanged; the extra round means 3★ now requires 6 or 7 rounds instead of 5 or 6.)

### Reward formula (`trials.ts`)

```
multiplier = 0.25 + 0.75 * score
statXp     = round((20 + 8 * level) * multiplier)
gold       = round((15 + 5 * level) * multiplier)
```

Unchanged from before. Score-0 still receives 25% of max reward (participation floor).

### Retry system

`retriesLeft` starts at 1. On a wrong tap:
- If `retriesLeft > 0`: decrement to 0, enter `wrong` phase, then after `WRONG_FLASH_MS` reset `showIndex` and `playerInput` and re-enter `showing` phase for the same round.
- If `retriesLeft === 0`: enter `wrong` phase, then call `finish(roundsCompleted)`.

The retry indicator is visible during `input` and `wrong` phases. `roundsCompleted` is not incremented when a retry is used, so the score is unaffected by whether the retry was consumed.

### KN stat integration

`knLevel` is read from `useGameStore(s => s.character.statLevels.KN)`. It is passed to `buildShowSchedule(sequenceLength, knLevel, rng)` which returns the show schedule for the current round. Normally the schedule is `[0, 1, 2, …, length-1]`. With KN hints:
- KN ≥ 5 (`KN_HINT_THRESHOLD`): one position from the back half is chosen at random; a duplicate is inserted immediately after its first occurrence.
- KN ≥ 10 (`KN_HINT_THRESHOLD_2`): two such positions are double-flashed.

Double-flashed positions play their tone twice and display the glyph twice consecutively. The hint applies only to sequences of length 3 or more. The RNG for picking hint positions uses `Math.random` (not the daily seed), so hint positions vary each session.

### Timers

All timers are `setTimeout` chains inside React `useEffect` / `useCallback`. No game clock or time pressure during input phase.

### Win / loss conditions

- **Win:** Complete all seven rounds. Score = 1.0.
- **Loss:** Wrong glyph input after the retry is exhausted. Score = `roundsCompleted / 7`.

---

## 5. Technical Implementation

### File map

| File | Role |
|---|---|
| `src/engine/trials/ancientLibrary.ts` | Pure engine: constants, glyph mappings, `generateSequence`, `libraryScore`, `glyphShowMs`, `buildShowSchedule`, `seededRng`, `dailySeed` |
| `src/components/trials/games/AncientLibrary.tsx` | React component: all gameplay UI and phase-machine state |
| `src/engine/trials/trials.ts` | Trial registry, `trialReward`, `scoreToStars`, daily-reset helpers |
| `src/components/trials/TrialModal.tsx` | Modal shell: intro → playing → result stages; close-confirmation prompt |
| `src/views/TrialsView.tsx` | Skills tab view: trial card grid, best score %, last-cleared date, opens TrialModal |
| `src/lib/sfx.ts` | Web Audio synth: `playNote(freq, durationMs)`, `libraryCorrect` cue, `libraryWrong` cue |
| `src/store/useGameStore.ts` | Zustand store: `trialsClearedOn`, `bestTrialScore`, `completeTrial` action |
| `src/engine/trials/__tests__/trials.test.ts` | Vitest unit tests — 149 tests covering engine functions including all new exports |

### Key functions

**`generateSequence(rng)`** (`ancientLibrary.ts`)
Produces a master sequence of `LIBRARY_START_LENGTH + LIBRARY_MAX_ROUNDS - 1 = 8` glyphs. Pure function, deterministic given a seeded RNG.

**`libraryScore(roundsCompleted)`** (`ancientLibrary.ts`)
Maps completed rounds to a 0–1 score (`roundsCompleted / LIBRARY_MAX_ROUNDS`). Clamped at 1.

**`glyphShowMs(round)`** (`ancientLibrary.ts`)
Returns display speed in ms for the given 0-based round. Linearly interpolates from `GLYPH_SHOW_MS_BASE` (700) to `GLYPH_SHOW_MS_MIN` (500) across `LIBRARY_MAX_ROUNDS - 1` steps.

**`buildShowSchedule(sequenceLength, knLevel, rng)`** (`ancientLibrary.ts`)
Returns the ordered index schedule for the show phase. Normally `[0, 1, …, length-1]`. With KN hints, inserts duplicate indices for back-half positions (one at KN ≥ 5, two at KN ≥ 10). Requires sequenceLength ≥ 3 for a hint to be inserted.

**`seededRng(seed)`** (`ancientLibrary.ts`)
LCG returning a `() => number` function (values in [0, 1)). Used for deterministic daily sequences.

**`dailySeed(isoDate)`** (`ancientLibrary.ts`)
Converts "YYYY-MM-DD" to a stable integer seed by stripping hyphens: `"2026-06-18"` → `20260618`.

**`playNote(freq, durationMs)`** (`sfx.ts`)
Plays a sine-wave oscillator at `freq` Hz for `durationMs` ms (default 200). Used by the component to play per-glyph tones during show and input phases.

**`AncientLibrary({ onFinish })`** (`AncientLibrary.tsx`)
The entire minigame. On mount: `masterSeq` fixed via `useMemo` from daily seed; `showSchedule` recomputed per round via `useMemo` from `buildShowSchedule`. Phase machine:
- `showing` → driven by `useEffect` + `setTimeout` advancing `showIndex`; tone plays per `showIndex` change
- `input` → `handleGlyphTap` validates each tap; plays tone and flashes button immediately; handles retry or finish
- `correct` / `wrong` → brief visual pause with sound, then `finish()` or `startRound(round + 1)`
- `done` → `onFinish` called with final score

**`completeTrial(trialId, score01)`** (`useGameStore.ts`)
Store action. Guards double-claiming same day (unless `repeatMinigames`). Calls `trialReward`, applies reward, calls `checkLevelUp`.

### State management

All gameplay state is local `useState` in `AncientLibrary.tsx`:

```ts
masterSeq:       Glyph[]          // fixed at mount via useMemo (daily seed)
round:           number           // 0-based round index
phase:           Phase            // 'showing' | 'input' | 'wrong' | 'correct' | 'done'
showIndex:       number           // position in showSchedule currently displayed
playerInput:     Glyph[]          // player's entries so far this round
roundsCompleted: number           // successful rounds (used for score)
retriesLeft:     number           // 1 at start, set to 0 after first wrong tap
flashGlyph:      Glyph | null     // set on tap, cleared after TAP_FLASH_MS (150 ms)
mounted:         RefObject<bool>  // unmount guard; set true on mount, false on unmount
showSchedule:    number[]         // per-round glyph index order (from buildShowSchedule)
```

Store is read once (`knLevel`) and written once (`completeTrial` on claim).

### Data flow

```
TrialsView → opens TrialModal(trialId='ancient_library')
  TrialModal: intro → playing (mounts AncientLibrary)
    AncientLibrary plays; calls onFinish(score01)
  TrialModal: transitions to result stage (local score/stars/reward state)
  Player taps "Continue" then "Return to Trials"
    → store.completeTrial('ancient_library', score01) [on first Continue click]
      → trialReward(KN, score01, level) → Reward
      → applyReward(state, reward) → gold + KN XP
      → checkLevelUp(state)
      → trialsClearedOn['ancient_library'] = today
      → bestTrialScore['ancient_library'] = max(prev, score01)
```

### Save/load behavior

`trialsClearedOn` and `bestTrialScore` are persisted in `localStorage` via Zustand's `persist` middleware. Initialized by `emptyTrialsClearedOn()` / `emptyBestTrialScore()` if not present; back-filled by the migration in `useGameStore.ts` for saves predating schema v15.

### Configuration

All tuning constants are exported from `ancientLibrary.ts`:

```ts
GLYPHS               = ['🔥','💧','🌿','⚡','🌙','⭐']
LIBRARY_START_LENGTH = 2      // sequence length in round 1
LIBRARY_MAX_ROUNDS   = 7      // rounds 1–7, sequence lengths 2–8
GLYPH_SHOW_MS_BASE   = 700    // ms per glyph in round 1
GLYPH_SHOW_MS_MIN    = 500    // ms per glyph in the final round
PRE_INPUT_PAUSE_MS   = 400    // pause after last glyph before input opens
CORRECT_FLASH_MS     = 800    // duration of correct-phase window
NEXT_ROUND_DELAY_MS  = 900    // delay from correct flash to next round start
WRONG_FLASH_MS       = 1000   // duration of wrong-phase window
TAP_FLASH_MS         = 150    // duration of button tap highlight
KN_HINT_THRESHOLD    = 5      // KN level for first double-flash hint
KN_HINT_THRESHOLD_2  = 10     // KN level for second double-flash hint
GLYPH_TONES          = { per-glyph Hz map }
GLYPH_COLORS         = { per-glyph hex color map }
```

No gameplay timing or tuning values remain as literals in the component.

---

## 6. Software, Libraries, and Tools Used

| Concern | Solution |
|---|---|
| Language | TypeScript |
| Framework | React 18 (hooks only — `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`) |
| Build tool | Vite |
| State management | Zustand with `persist` middleware (localStorage) |
| Styling | Tailwind CSS with custom design tokens (parchment, gold-deep, gold-bright, ink, wood) |
| Rendering | DOM / HTML only — no canvas |
| Animation | CSS (`animate-bounce` triggered via `key={showIndex}`, `active:scale-95`, inline style transitions) |
| Timers | Native `setTimeout` / `clearTimeout` |
| Audio | Web Audio API via `src/lib/sfx.ts` — `playNote(freq)` for glyph tones, `sfx.play('libraryCorrect')` / `sfx.play('libraryWrong')` for outcome sounds |
| Testing | Vitest — 149 tests across engine functions (no component-level tests; React Testing Library not installed) |
| Assets | None — all visuals are emoji and CSS |

---

## 7. Assets and Presentation

### Visuals

The minigame is entirely text and CSS. Visual elements:

- **Glyphs:** Six emoji at `text-5xl` (active display, animated with bounce-in), `text-2xl` (input tracker, completed sequence), and `text-2xl` (buttons)
- **Feedback icons:** ❌ (wrong) and 📚 (done) at `text-4xl`; ✅ replaced by the completed sequence display during the correct phase
- **Thematic button colors:** Each button has a faint idle tint (`GLYPH_COLORS[g]` at 10% opacity) and a bright tap flash (55% opacity) with a matching border color. Colors are defined in `GLYPH_COLORS` — amber for 🔥, blue for 💧, green for 🌿, yellow for ⚡, purple for 🌙, cream for ⭐
- **Glyph bounce animation:** `key={showIndex}` on the active glyph `<span>` causes React to remount it on each advance, triggering a 0.25 s single-iteration `animate-bounce`
- **Parchment theme:** `bg-parchment-100/70`, `border-gold-deep/30`, `font-display` — matches the broader Skills tab aesthetic
- **Retry indicator:** A `✦` symbol and label that dims (opacity-25) when the retry is consumed
- **Input progress:** Filled glyphs + `○` placeholders for remaining positions during the input phase

### Audio

All sounds are synthesized via the Web Audio API in `sfx.ts` — no audio files:

- **Per-glyph tone** (`playNote`): ~200 ms sine-wave oscillator at the glyph's pentatonic frequency. Plays on every glyph shown during the show phase, and again on every button tap during input.
- **`libraryCorrect`**: Two-note ascending chime (659 Hz → 880 Hz, then 880 Hz → 1320 Hz). Plays on successful round completion.
- **`libraryWrong`**: Short descending triangle oscillator (280 Hz → 130 Hz) plus a low-pass noise burst. Plays on wrong tap.

`sfxResume()` is called when "Begin Trial" is tapped to unlock the AudioContext under browser autoplay policy.

### Overall style and mood

Scholarly / arcane. The parchment background, gold borders, and glyph set (🌿 🌙 ⭐) reinforce a fantasy-library aesthetic. The pentatonic tones give the trial a musical, contemplative feel rather than an action-game one. The experience is quiet but no longer silent.

---

## 8. Current Player Experience

### What works well

- **Clarity of rules:** The Simon mechanic is universally understood. The intro description is accurate. No tutorial needed.
- **Audio-visual pairing:** Each glyph has both a color identity and a tone. Players naturally encode "fire = amber button = low tone." This multi-channel encoding aids memorisation significantly over a visual-only experience.
- **Warm-up round:** The length-2 opener is fast and low-stakes, communicating the mechanic before pressure begins.
- **Retry fairness:** The single retry absorbs the harshest frustration (mis-tap on an 8-glyph sequence at round 6) without removing challenge. The retry indicator keeps the player informed of its status.
- **Per-tap immediacy:** Tone + color flash on every tap makes each press feel registered and responsive, removing the anxiety of "did that count?"
- **Correct-phase review:** Seeing the completed sequence during the 800 ms correct window gives a brief satisfaction moment and a preview of what gets extended next round.
- **Speed ramp:** The display speed decreasing from 700 ms to 500 ms adds a meaningful pacing element to later rounds without changing the core mechanic.
- **KN integration:** At high KN levels, the double-flash hint makes the RPG investment feel relevant to the trial itself.
- **Visual structure:** Round counter, sequence-length indicator, input tracker, and retry indicator give the player all needed context without clutter.
- **Hub card meta info:** Best score (stars + %) and last-cleared date give players a concrete target when returning the next day.
- **Close-button safety:** The abandon confirmation prompt prevents accidental run exits on mobile.

### What still feels thin

- **No visual escalation between rounds.** The parchment box, button grid, and status line look and feel identical in round 1 and round 7. There is no building tension — no color shift, no ambient sound change, no animation that signals "you're deep in a run now."
- **No keyboard input.** Desktop players are mouse-only. Arrow keys, number keys, or letter bindings (e.g. F/W/G/L/M/S for the six glyphs) would make the trial more natural on desktop.
- **Early rounds still feel easy.** Length 2 at round 1 is very quick. Players with high KN will find the first 3 rounds trivial. There is no adaptive difficulty.

### Pacing

At round 7, displaying 8 glyphs takes 4.0 seconds of passive watching (8 × 500 ms), down from the original 5.6 s fixed pace. The 400 ms pre-input pause adds to this. The reduction is noticeable and makes late rounds feel snappier. KN double-flash adds roughly one glyph-worth of time per hint.

### Difficulty fairness

The difficulty is well-defined and fair. The sequence grows predictably; the glyph set is fixed and small; the retry acknowledges the one-tap-to-ruin-everything problem; the KN stat provides meaningful passive assistance. A player who fails at round 6 after using their retry will feel the loss was earned rather than arbitrary.

---

## 9. Known Issues or Weak Points

1. **No component-level test coverage.** The phase machine, retry logic, KN hint integration, and `onFinish` callback path are all exercised only by playing the game. All new engine functions (`glyphShowMs`, `buildShowSchedule`, `seededRng`, `dailySeed`) are tested in `trials.test.ts` (149 tests total), but the React component has no automated tests. Adding them requires React Testing Library, which is not in `package.json`.

2. **Wrong-phase status text edge case.** The status text during the `wrong` phase checks `retriesLeft` after it has already been decremented (when a retry fires, `retriesLeft` is set to 0 before the `wrong` phase renders). The condition `retriesLeft === 0 && roundsCompleted === 0` correctly catches "failed on first round, retry used up," but the plain `retriesLeft === 0` branch also matches the state during a retry (not just a final failure). In practice the displayed text is "Retrying…" either way, but the logic is not maximally clear.

3. **No keyboard input.** Glyph buttons are mouse/touch only. Desktop players have no keyboard alternative.

4. **No visual escalation.** Nothing in the visual presentation changes between round 1 and round 7. The experience is uniform in appearance even as the cognitive challenge grows.

5. **KN hint RNG is not daily-seeded.** The master sequence is reproducible per day, but which glyph positions get double-flashed varies each session (uses `Math.random`). This is a minor inconsistency — a player reloading the page will see different hint positions.

6. **No undo during input.** Once a glyph is tapped, it cannot be corrected short of using the retry. This is standard for Simon games but worth noting as a design constraint.

---

## 10. Remaining Improvement Opportunities

### High value

**Component-level tests (requires React Testing Library)**
Phase transitions, the retry path, and the `onFinish` callback path are untested at the React layer. A test suite using `vi.useFakeTimers()` to advance `setTimeout` chains would catch regressions in the phase machine. Currently blocked by RTL not being installed.

**Keyboard input for desktop**
Map the six glyphs to keyboard keys (e.g. `1–6`, or initials `F W G L M S`). The `handleGlyphTap` function already encapsulates all tap logic — adding a `useEffect` keydown listener that calls it would be a small addition. This would meaningfully improve the desktop experience.

### Medium value

**Visual escalation across rounds**
Add some signal that distinguishes early rounds from late rounds — e.g. a subtle border color shift, a glyph display box shadow that deepens each round, or a round-progress fill bar. Currently the visual experience is completely flat across all seven rounds.

**Daily-seeded KN hint positions**
For consistency with the daily-seeded master sequence, the hint positions selected by `buildShowSchedule` could also be derived from a deterministic seed (e.g. `dailySeed(toISODate()) + round`). This would make the entire trial reproducible per day.

### Low value / polish

**Animated result stars**
The `Stars` component in `TrialModal` renders identically for all trials. A brief scale-in animation on display would add a satisfying payoff moment. This is a shared component; any change benefits all eight trials.

**Refined button layout**
The 3×2 grid places glyphs in fixed positions. There is no design pressure behind which glyph occupies which cell. Arranging them by tone (ascending left-to-right, low-to-high) would reinforce the audio-spatial mapping players build over time.

---

## 11. Questions and Unknowns

1. **Is the one-retry limit the final design?** The current implementation is one retry per session with no score penalty. A cap (e.g. 2★ max if the retry was used) is possible but was not implemented. Whether a penalty should apply is an open design question.

2. **Should adaptive difficulty exist?** Players with high KN levels will find early rounds trivial. The double-flash hints are a passive benefit, not a difficulty increase. Whether there is a desire for the trial to self-adjust (e.g. skip early rounds for experienced players, or increase glyph set size at high KN) is undefined.

3. **Does the daily gate clear at midnight local time or UTC?** `toISODate()` uses the client's local date. Players crossing midnight locally get an early reset; players in certain timezones may notice the gate resets at an unexpected hour. This affects all trials, not just Ancient Library.

4. **Is a thematic visual upgrade planned?** The parchment/emoji presentation is functional but minimal. A more elaborate presentation (animated runes, scroll motif, glowing sigils) is not on any roadmap but would meaningfully differentiate the trial visually from the other seven.

5. **Should KN hints also appear during the input phase?** Currently the double-flash only affects the show phase. A hint during input (e.g. briefly pulsing the button of the expected next glyph at high KN levels) would be a stronger benefit — but might trivialise the trial at high levels.
