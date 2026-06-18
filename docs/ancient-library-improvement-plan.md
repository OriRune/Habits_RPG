# Ancient Library — Improvement Plan

Based on: `docs/ancient-library-minigame-analysis.md`

---

## 1. Highest-Priority Improvements

These have the largest impact on player experience for the least implementation cost.

### 1a. Add sound effects — glyph tones + feedback sounds

**What:** Map each of the six glyphs to a distinct musical tone (a pentatonic scale works well — no dissonant intervals, so any combination sounds tolerable). Play a glyph's tone when it lights up during the show phase, and again when the player taps its button. Play a short success chord on round completion and a dull thud/buzz on a wrong tap.

**Why:** This is the single most impactful missing feature. Simon-style memory games fundamentally rely on audio — players naturally encode "fire = high note" alongside the visual. Silence forces pure visual memorisation and makes the trial feel unfinished. The browser AudioContext is already unlocked on entry via `sfxResume()`; the wiring is done, the sounds just aren't there.

**Files involved:**
- `src/lib/sfx.ts` — add `playTone(freq, duration)` or similar helper using the Web Audio API oscillator pattern already established
- `src/components/trials/games/AncientLibrary.tsx` — call tone on `showIndex` advancement (show phase) and on each tap in `handleGlyphTap` (input phase); call success/fail sounds on phase transitions

**Complexity:** Low–medium. The sfx infrastructure already exists.

---

### 1b. Add per-tap feedback during the input phase

**What:** When the player taps a correct glyph, briefly highlight that button (e.g. a 150 ms `bg-gold-bright/40` flash, or a subtle scale-up). Do not wait until the whole sequence is correct to give feedback.

**Why:** Currently, correct taps are invisible. The only signal is the progress circle filling — which is a small, peripheral indicator. Players feel uncertain whether their tap registered, which creates anxiety rather than confidence. Microfeedback per correct tap transforms the input phase from stressful to satisfying.

**Files involved:**
- `src/components/trials/games/AncientLibrary.tsx` — track `lastCorrectIndex` (or a flash timestamp) in local state; apply a conditional CSS class to the just-tapped button for ~150 ms

**Complexity:** Low.

---

### 1c. Extract timing constants to the engine file

**What:** Move the five inline timing magic numbers out of `AncientLibrary.tsx` and into `ancientLibrary.ts` as named exports:

```ts
export const GLYPH_SHOW_MS       = 700;
export const PRE_INPUT_PAUSE_MS  = 400;
export const CORRECT_FLASH_MS    = 800;
export const NEXT_ROUND_DELAY_MS = 900;
export const WRONG_FINISH_MS     = 1000;
```

**Why:** These numbers control the entire rhythm of the minigame. They currently live as unexplained literals in the component, making them invisible to anyone tuning gameplay. Extracting them makes future iteration (e.g. speeding up later rounds) a one-line change rather than a grep-and-replace hunt.

**Files involved:**
- `src/engine/trials/ancientLibrary.ts` — add exports
- `src/components/trials/games/AncientLibrary.tsx` — import and use them

**Complexity:** Trivial. Zero behaviour change; pure readability win.

---

## 2. Gameplay and Mechanics Improvements

### 2a. Soften the difficulty curve — start at length 2

**What:** Change `LIBRARY_START_LENGTH` from 3 to 2, and increase `LIBRARY_MAX_ROUNDS` from 6 to 7. This preserves the maximum sequence length (8) and the 6-round 3★ threshold while adding a genuine warm-up round at length 2.

**Why:** Length 3 in round 1 is already non-trivial for new players. Rounds 1–2 currently feel like "waiting for the real challenge" for experienced players but can catch new players off-guard. A length-2 opener serves as a tutorial round that communicates the mechanic before the player is under pressure.

**Files involved:**
- `src/engine/trials/ancientLibrary.ts` — change `LIBRARY_START_LENGTH = 2`, `LIBRARY_MAX_ROUNDS = 7`
- `src/engine/trials/__tests__/trials.test.ts` — update the `maxLen` assertion (`3 + 6 - 1 = 8` → `2 + 7 - 1 = 8`; max length is unchanged, so most tests pass unmodified)

**Complexity:** Trivial. The component derives sequence length from constants; no logic changes needed.

---

### 2b. Add a single retry ("second chance")

**What:** Give the player one retry per session. On the first wrong tap, instead of immediately finishing, show a "✗ — one chance left" indicator and reset the current round (not the entire run). On a second wrong tap, the trial ends normally. The retry's use should be visually tracked (e.g. a small icon that dims when spent).

**Why:** One-strike elimination is harsh, especially when a player is on round 5 of 6 and mis-taps a single glyph in an 8-glyph sequence. A single retry acknowledges that memory games have an element of luck in a way that skill-based trials (Armory Break, Lockpicking) do not. It also extends average session length — a player who failed at round 5 previously would quit; now they try again, staying engaged.

**Design note:** The retry resets only the current round, not `roundsCompleted`. Score is unaffected. If desired, using the retry can be reflected with a cap (e.g. 2★ max if the retry was used) — but this adds complexity; the simpler version (no penalty) is a fine starting point.

**Files involved:**
- `src/engine/trials/ancientLibrary.ts` — no changes needed (pure scoring is unaffected)
- `src/components/trials/games/AncientLibrary.tsx` — add `retriesLeft: number` state (starts at 1); modify the `wrong` branch in `handleGlyphTap` to check `retriesLeft > 0` before deciding whether to retry or finish; add a retry indicator to the UI

**Complexity:** Low–medium. The phase machine already handles round resets; this is a new conditional in the wrong-tap path.

---

### 2c. Gradually increase display speed in later rounds

**What:** Reduce `GLYPH_SHOW_MS` slightly each round. For example:

| Round | Display speed |
|---|---|
| 1–2 | 700 ms |
| 3–4 | 600 ms |
| 5–7 | 500 ms |

**Why:** Fixed 700 ms per glyph means an 8-glyph sequence takes 5.6 seconds of passive watching before the player can act. Speed variation adds a pacing dimension that makes later rounds feel meaningfully different from early rounds, not just "more glyphs at the same speed." It also naturally communicates escalating difficulty.

**Files involved:**
- `src/engine/trials/ancientLibrary.ts` — add a `glyphShowMs(round: number): number` helper
- `src/components/trials/games/AncientLibrary.tsx` — pass `round` into the helper and use the result in the `setTimeout` call

**Complexity:** Low. The timing is already driven by a single `setTimeout` in `useEffect`.

---

## 3. Controls, UI, and Player Feedback Improvements

### 3a. Remove or replace the sequence progress strip

**What:** During the show phase, the strip below the display box renders `•` (past), the current glyph emoji, and `○` (future). This is confusing — past glyphs are hidden, which makes the strip feel like a spoiler shield rather than a progress aid. Replace it with a simple counter: **"Glyph 3 of 5"** inside or below the display box, or remove the strip entirely.

**Why:** The strip reveals the sequence length (which the header already shows) but conceals the actual glyphs, making it neither a memory aid nor a decorative element. New players may try to read it as a hint. Removing it simplifies the visual hierarchy.

**Files involved:**
- `src/components/trials/games/AncientLibrary.tsx` — remove the `phase === 'showing'` strip block (lines 139–147); optionally integrate a text counter into the display box

**Complexity:** Trivial.

---

### 3b. Show the completed sequence on round end

**What:** During the `correct` phase (the 800 ms window after a successful round), display the full sequence the player just completed — all glyphs side by side in the display box.

**Why:** This gives the player a moment of satisfaction ("yes, that's what I remembered") and serves as a brief review before the next, longer sequence begins. It reinforces correct memory encoding.

**Files involved:**
- `src/components/trials/games/AncientLibrary.tsx` — add a `phase === 'correct'` branch to the display box that renders `sequence.map(g => <span>{g}</span>)`

**Complexity:** Trivial.

---

### 3c. Add a close-confirmation prompt

**What:** When the player taps ✕ during `showing` or `input` phase, show a brief inline confirmation ("Abandon run?  Yes / Keep playing") before closing the modal.

**Why:** The close button is in the header, reachable by accident especially on mobile. Closing mid-run silently discards progress without consuming the daily gate — not destructive, but surprising. A confirmation prevents accidental exits and makes the intent explicit.

**Files involved:**
- `src/components/trials/TrialModal.tsx` — intercept the `onClose` call; if `stage === 'playing'`, set a local `confirmingClose` boolean and render inline options before calling `onClose`

**Complexity:** Low.

---

### 3d. Animate the glyph display box transition between glyphs

**What:** Add a brief scale-in or fade-in on each new glyph during the show phase instead of an instant swap.

**Why:** The current display is jarring — glyphs snap in and out with only `animate-pulse` (which loops continuously, not per-glyph). A per-glyph enter animation makes the display feel intentional rather than like a React state flicker. Tailwind's `animate-bounce` on enter, or a CSS keyframe triggered by a key prop change, would work.

**Files involved:**
- `src/components/trials/games/AncientLibrary.tsx` — add `key={showIndex}` to the glyph `<span>` so React remounts it on each advance; add an enter animation class

**Complexity:** Trivial. `key={showIndex}` is a one-line change.

---

## 4. Visual and Audio Polish

### 4a. Define a pentatonic glyph-to-tone mapping

**What:** Establish a fixed frequency for each glyph:

| Glyph | Tone (suggested) |
|---|---|
| 🔥 | C5 (523 Hz) |
| 💧 | D5 (587 Hz) |
| 🌿 | E5 (659 Hz) |
| ⚡ | G5 (784 Hz) |
| 🌙 | A5 (880 Hz) |
| ⭐ | C6 (1047 Hz) |

Play each tone as a short oscillator note (~180 ms, sine wave, short decay) both when the glyph is shown and when the player taps it. Add a two-tone success chord on `correct` and a low descending buzz on `wrong`.

**Why:** This is the audio counterpart of improvement 1a. A pentatonic scale ensures no combination of glyphs in a sequence sounds discordant, even for players with no musical background. The identical tone on show and tap creates an audio confirmation loop without requiring any visual change.

**Files involved:**
- `src/lib/sfx.ts` — add `playNote(freq: number, durationMs: number)` using `AudioContext.createOscillator`
- `src/components/trials/games/AncientLibrary.tsx` — import and call at the appropriate moments

**Complexity:** Medium. Web Audio API oscillator pattern is straightforward; the main work is wiring call sites.

---

### 4b. Polish glyph button idle state

**What:** Give the glyph buttons a faint hover glow using the glyph's thematic color (e.g. 🔥 glows amber on hover, 💧 glows blue). During the show phase, when a glyph is being displayed, dim the corresponding button slightly (to distinguish "watching" from "tapping").

**Why:** The buttons currently look identical and static. Thematic coloring creates a stronger visual identity per glyph, which aids memory (players learn "fire = warm button, top-left"). Dimming during show phase reinforces that the show and input phases are distinct modes.

**Files involved:**
- `src/components/trials/games/AncientLibrary.tsx` — add a color map per glyph and apply conditional classes; dim all buttons during `showing` phase

**Complexity:** Low.

---

### 4c. Style the result screen star rating

**What:** The TrialModal result screen renders stars identically for all trials. For Ancient Library specifically, the `📚` icon and stars could use the parchment/gold palette more intentionally — e.g. a larger decorative book icon, gold stars with a brief scale-in animation on display.

**Why:** The result screen is the emotional payoff moment. A more expressive result animation (even a simple CSS scale-in on the stars) increases satisfaction after a good run.

**Files involved:**
- `src/components/trials/TrialModal.tsx` — the `Stars` component already exists; add a Tailwind `animate-` class and ensure it triggers on mount. This is a shared component, so the change benefits all trials.

**Complexity:** Trivial.

---

## 5. Technical / Code Improvements

### 5a. Extract timing constants (see 1c above — highest priority)

Already covered. This is the most important code quality change.

---

### 5b. Add component-level tests

**What:** Write Vitest + React Testing Library tests for `AncientLibrary.tsx` covering:
- Phase transitions (showing → input → correct → next round)
- Wrong-tap path (input → wrong → done, `onFinish` called with correct score)
- Full completion path (`onFinish` called with score 1.0 after 6 correct rounds)
- `onFinish` not called during show phase even if buttons were somehow tappable

**Why:** The engine functions (`generateSequence`, `libraryScore`) are tested, but the component's phase machine — the actual gameplay logic — has zero test coverage. A bug in `handleGlyphTap` or the `useEffect` timer chain would be invisible until a player hits it.

**Files involved:**
- New: `src/components/trials/games/__tests__/AncientLibrary.test.tsx`

**Complexity:** Medium. React Testing Library with fake timers (`vi.useFakeTimers`) is needed to advance the `setTimeout` chains.

---

### 5c. Seed the RNG from a daily value (optional / future)

**What:** Instead of `generateSequence(Math.random)`, pass a seeded RNG derived from the current ISO date and the player's ID (or a fixed salt). All players would see the same sequence on a given day.

**Why:** This enables a "daily challenge" framing — players can compare their run to others, and a specific sequence can be shared or discussed. It also makes debugging easier (reproducible sequences). If the multiplayer features being developed on this branch matter, a shared daily sequence is a natural social hook.

**Files involved:**
- `src/components/trials/games/AncientLibrary.tsx` — replace `Math.random` with a date-seeded RNG
- `src/engine/trials/ancientLibrary.ts` — already supports injected RNG; no change needed

**Complexity:** Low, once a seeded LCG is available (one already exists in the test file as `seededRng`; promote it to a shared utility).

---

### 5d. Guard against stale `setTimeout` callbacks after component unmount

**What:** The `showing` phase `useEffect` returns a cleanup (`clearTimeout`), which is correct. But the `correct`, `wrong`, and `done` `setTimeout` calls in `handleGlyphTap` do not guard against the component unmounting mid-timeout (e.g. if the player taps ✕ just after completing a round). Add an `isMounted` ref or use an `AbortController`-style pattern to no-op the callback if unmounted.

**Why:** This is a low-probability but real React warning source. If the player closes the modal during the 800 ms `correct` pause, the `startRound` or `finish` callback fires on an unmounted component. React 18 does not throw, but it sets state on a ghost, which can produce `console.error` noise and occasionally confusing re-renders if the modal is reopened quickly.

**Files involved:**
- `src/components/trials/games/AncientLibrary.tsx` — add a `const mounted = useRef(true)` ref; set `mounted.current = false` in a cleanup `useEffect`; gate all deferred `setPhase` / `finish` calls with `if (!mounted.current) return`

**Complexity:** Low.

---

## 6. Integration with the Larger Game

### 6a. Let KN stat level influence gameplay

**What:** At KN stat level ≥ a threshold (e.g. 5), grant the player a passive "Scholarly Memory" benefit: one glyph in each sequence is briefly double-flashed (shown twice in a row) during the show phase, calling attention to it. At KN ≥ 10, a second glyph gets this treatment.

**Why:** Currently the KN stat has zero influence on Ancient Library. This breaks the RPG loop: levelling KN by doing habits should make the KN trial easier. The double-flash benefit is subtle enough not to trivialise the trial but meaningful enough to feel like a reward.

**Files involved:**
- `src/components/trials/games/AncientLibrary.tsx` — read `useGameStore(s => s.character.statLevels.KN)`; pass a `knLevel` prop or read it inline; modify the show-phase `useEffect` to insert a repeated display step at the appropriate index
- `src/engine/trials/ancientLibrary.ts` — optionally add a `scholarlyHintIndices(seq, knLevel, rng)` helper that returns the indices to double-flash

**Complexity:** Medium. The show-phase `useEffect` drives off `showIndex`; adding "pause and replay glyph N" requires a small state machine extension, but the core approach is straightforward.

---

### 6b. Surface the best score more clearly on the hub card

**What:** The `bestTrialScore['ancient_library']` is already stored. On the TrialsView card, show the best score as a percentage below the star rating ("Best: 83%") instead of just stars.

**Why:** Stars have low resolution (three states). A percentage gives players a concrete improvement target and makes the daily re-attempt feel purposeful ("I got 67% last time, I want 83% today").

**Files involved:**
- `src/views/TrialsView.tsx` — read `bestTrialScore[t.id]` and render `Math.round(score * 100)%` on each card

**Complexity:** Trivial. The data is already in the store.

---

### 6c. Show the last-cleared date on the hub card

**What:** Display "Last cleared: today" or "Last cleared: Jun 15" on the card for completed trials.

**Why:** Players returning after a break don't know which trials they've done recently (aside from the "Done" badge for today). A date label helps them plan their session.

**Files involved:**
- `src/views/TrialsView.tsx` — read `trialsClearedOn[t.id]` and format it

**Complexity:** Trivial.

---

## 7. Suggested Implementation Order

Work in this order to get the most impact early and keep changes isolated and reviewable.

| Step | Change | Impact | Effort |
|---|---|---|---|
| 1 | Extract timing constants to `ancientLibrary.ts` (§1c, §5a) | Code quality | Trivial |
| 2 | Add `key={showIndex}` glyph animation (§3d) | Polish | Trivial |
| 3 | Remove the sequence progress strip (§3a) | UX clarity | Trivial |
| 4 | Show completed sequence during `correct` phase (§3b) | Satisfaction | Trivial |
| 5 | Per-tap button flash on correct input (§1b) | Core feedback | Low |
| 6 | Add glyph tones + success/fail sounds (§1a, §4a) | Core experience | Medium |
| 7 | Change `LIBRARY_START_LENGTH = 2`, `LIBRARY_MAX_ROUNDS = 7` (§2a) | Difficulty curve | Trivial |
| 8 | Speed up display in later rounds (§2c) | Pacing | Low |
| 9 | Add single retry per session (§2b) | Fairness | Medium |
| 10 | Guard unmount stale timers (§5d) | Stability | Low |
| 11 | Add component tests (§5b) | Test coverage | Medium |
| 12 | KN stat → double-flash hint (§6a) | RPG integration | Medium |
| 13 | Thematic button coloring (§4b) | Polish | Low |
| 14 | Best-score percentage on hub card (§6b) | Meta clarity | Trivial |
| 15 | Last-cleared date on hub card (§6c) | Meta clarity | Trivial |
| 16 | Close-confirmation prompt (§3c) | Safety | Low |
| 17 | Daily-seeded RNG (§5c) | Social/future | Low |

Steps 1–6 are the core improvement pass. Steps 7–11 deepen the gameplay and stabilise the code. Steps 12–17 are polish and integration work that can be scheduled independently.
