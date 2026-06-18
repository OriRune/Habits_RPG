# Spirit Grove — Minigame Analysis (Updated)

*Reflects the codebase state after the improvements implemented in the spirit-grove improvement plan.*

---

## 1. Basic Summary

Spirit Grove is the **Wisdom (WI) Skill Trial** — one of eight daily minigames in the HabitsRPG Skill Trials system. The player reads a short mystical "omen" (a one-sentence nature vignette) and selects which of four named blessings best matches what the omen is describing. Five rounds are played per session, drawn from a pool of 15 and organized into a difficulty ramp.

It fits into the larger game as a **daily habit-reinforcement loop**: completing a trial earns Wisdom XP and gold, contributing to character leveling. Trials are gated once per calendar day and unlock at character level 3 (`TRIALS_UNLOCK_LEVEL = 3` in `src/engine/trials/trials.ts`). Spirit Grove requires no energy to play.

Thematically it is the quietest trial — no timers, no real-time input, no fail state. It is a comprehension and inference puzzle dressed in low-fantasy nature lore, testing whether the player can read symbolic description and identify the correct conceptual match.

---

## 2. Core Game Loop

### Start
The player opens the Skills tab and taps the Spirit Grove hub card (`🌿 Spirit Grove`). `TrialModal` (`src/components/trials/TrialModal.tsx`) renders a full-screen overlay. The **intro stage** shows the trial description and a "Begin Trial" button. Tapping "Begin Trial" calls `sfxResume()` (to unlock the browser AudioContext) and transitions to the `playing` stage.

On component mount, `prepareRounds()` selects 5 rounds from the 15-round pool using a difficulty-tier draw (1 easy + 2 medium + 2 hard), then sorts them in that order so the session ramps from easier to harder. Each round is paired with a shuffled display order for its four choices. The result is memoized for the full session via `useMemo`.

### Each Round
1. The player sees a **Round X of 5** counter and a five-symbol **○ ○ ○ ○ ○** progress tracker.
2. A parchment box labeled **"Omen"** displays one sentence of nature description.
3. Below are **four choice buttons** in shuffled order, each showing a `[1]`–`[4]` key hint, a blessing name in bold, and an optional italic clue in smaller text.
4. The player clicks a button or presses a number key (1–4).
5. All buttons are immediately disabled. The **correct answer always highlights emerald** (`scale-[1.02]`, green border and background, a faint shadow). The wrong button highlights rose if the player chose it.
6. A **feedback strip** appears below the choices containing the round's explanation text and a "Tap to continue →" prompt. Tapping it (or waiting 700 ms) advances to the next round.

### End
After round 5, `onFinish(correctCount / 5)` is called. `TrialModal` transitions to the **result stage**, which shows a star rating, percentage score, and reward breakdown. A **"Claim Reward"** button calls `completeTrial(trialId, score)` in the store. After claiming, the button swaps to **"Return to Trials"**.

### Outcomes
- **Score:** `correctCount / 5` → 0.0, 0.2, 0.4, 0.6, 0.8, or 1.0
- **Stars:** 0–1/5 = 1 star, 2–3/5 = 2 stars, 4–5/5 = 3 stars (all tiers reachable)
- **Rewards:** WI XP + gold, both scaling with character level and score
- **No fail state:** the player always completes all 5 rounds regardless of answers

---

## 3. Player Controls and Interaction

### Input Controls
- **Mouse click / touch tap** on choice buttons
- **Number keys 1–4** select the corresponding displayed choice (registered via `keydown` listener on `window`)
- **Tap feedback strip** to skip the 700 ms transition pause and advance immediately

### UI Elements
| Element | Description |
|---|---|
| Round counter | `"Round X of 5"` in `font-display`, top-left |
| Progress tracker | Five animated `<span>` elements: `○` (pending), `✓` (correct, emerald), `✗` (wrong, rose) — newly added symbols scale to `scale-110` on reveal |
| Omen box | Parchment card with italic omen text |
| Choice buttons | 4 full-width buttons, shuffled per session, each with `[N]` key hint, blessing name, optional clue |
| Feedback strip | Appears after selection: explanation text (italic) + "Tap to continue →" — tappable to skip timer |
| Result summary | Emoji, narrative message, `"X / 5 omens read correctly"` |
| Per-round recap | 5 cards showing omen, correct answer, player's chosen answer (if wrong), and explanation |
| TrialModal header | Trial name (`Spirit Grove`), stat label (`Wisdom Trial`), close button |
| TrialModal result | Star rating, score %, reward table (WI XP + gold), Claim / Return buttons |

### Feedback Given to the Player
- **Immediate on click:** correct button turns emerald and scales up (`scale-[1.02]`); wrong button turns rose — same render cycle
- **Correct answer always revealed:** even on a wrong guess, the correct choice highlights green
- **Audio:** `sfx.play('groveCorrect')` (soft ascending two-tone shimmer) or `sfx.play('groveWrong')` (quiet descending triangle pulse) fires on every selection
- **Explanation:** a one-sentence explanation of why the correct answer is right appears in the feedback strip immediately after selection
- **Progress tracker animation:** newly revealed `✓`/`✗` symbols animate to `scale-110` via `transition-all duration-300`
- **Per-round recap:** the result view lists every round with the omen, correct answer, what the player chose (if wrong), and the explanation — so all learning is surfaced at the end
- **Star rating + percentage** in `TrialModal`'s result stage
- **Reward preview:** gold and WI XP amounts shown before claiming

### Accessibility
- `role="group"` and `aria-label="Choose a blessing"` on the choice container
- `aria-label` on each button: `"N. Blessing Name — clue text"`
- `aria-pressed` reflects the current selection state

---

## 4. Mechanics and Systems

### Scoring
Score is a normalized float: `correctCount / 5`.
Possible values: 0.0, 0.2, 0.4, 0.6, 0.8, 1.0.

**Star thresholds** (`scoreToStars` in `src/engine/trials/trials.ts:106`):
- ≥ 0.75 → 3 stars (4/5 or 5/5)
- ≥ 0.40 → 2 stars (2/5 or 3/5)
- < 0.40 → 1 star (0/5 or 1/5)

All three tiers are reachable with 5 rounds. Previously, at 3 rounds, the 2-star tier was mathematically unreachable (0.67 fell into 3-star, 0.33 into 1-star).

### Choices and Correct Answers
Each round has exactly 4 choices. One is correct (`correctIndex`). **The display order of choices is shuffled per session** via `fisherYatesShuffle` in `prepareRounds`, stored as `displayOrder: number[]` per `PreparedRound`. Players cannot memorize button positions across sessions.

### Round Selection and Difficulty
The 15-round pool is split into three tiers (`difficulty: 'easy' | 'medium' | 'hard'` on `SpiritGroveRound` in `src/content/trials.ts`). Each session draws **1 easy + 2 medium + 2 hard**, then presents them in that order so the session ramps from lower to higher inference demands.

- **Easy:** omen maps almost directly to the correct blessing; the clue clinches it; distractors are clearly wrong
- **Medium:** omen requires one inference step (symbolic association, cultural reference, understanding emphasis); one distractor is plausible
- **Hard:** omen is genuinely ambiguous; two or three choices seem reasonable; the correct answer requires close reading of the specific phrasing

### Timers
No countdown timer exists inside the game. The only timing element is `ROUND_TRANSITION_MS = 700` ms — the feedback pause before auto-advancing. This can be cut short by tapping the feedback strip.

### Randomization
- **Round selection:** `fisherYatesShuffle` (Fisher-Yates) is applied within each difficulty tier before taking the draw. The 5 selected rounds are then sorted by difficulty for the session ramp.
- **Choice order:** `fisherYatesShuffle` is applied to each round's choices independently, producing a unique `displayOrder` per session.

### Win / Loss Conditions
- **Win:** not applicable — all 5 rounds are always played
- **Loss:** not applicable — no fail state or early exit

### Reward Scaling (`trialReward` in `src/engine/trials/trials.ts:124`)
```
multiplier = 0.25 + 0.75 * score01   // floor at 25% for participation
statXp     = round((20 + 8 * level) * multiplier)
gold       = round((15 + 5 * level) * multiplier)
```
At level 5, perfect score: 60 WI XP + 40 gold. At level 5, zero score: 15 WI XP + 10 gold. Reward granularity increased with 5 rounds — there are now 6 distinct reward levels instead of 4.

### Larger-Game Integration
- Character `level` scales reward magnitude but does not affect difficulty
- Earned WI XP feeds into `character.statXp.WI`, contributing to total XP and level-up progression
- The player's current WI stat level (`character.statLevels.WI`) is not referenced inside Spirit Grove — difficulty does not scale with it
- `bestTrialScore['spirit_grove']` is stored and displayed as a star rating on the hub card in `TrialsView.tsx`

---

## 5. Technical Implementation

### Files

| File | Role |
|---|---|
| `src/components/trials/games/SpiritGrove.tsx` | Main game component: all round state, rendering, interaction |
| `src/components/trials/TrialModal.tsx` | Modal wrapper: intro/playing/result stages, reward claim |
| `src/engine/trials/trials.ts` | Trial registry, `scoreToStars`, `trialReward`, `getTrial` |
| `src/content/trials.ts` | `SPIRIT_GROVE_ROUNDS` (15 rounds), `SPIRIT_GROVE_ROUND_COUNT`, interfaces |
| `src/lib/sfx.ts` | `groveCorrect` and `groveWrong` cue definitions |
| `src/store/useGameStore.ts` | `completeTrial` action; `trialsClearedOn`, `bestTrialScore` state |
| `src/views/TrialsView.tsx` | Skills hub: trial cards with best-score star display |

### Key Types (`SpiritGrove.tsx`)

```typescript
interface PreparedRound {
  round: SpiritGroveRound;
  displayOrder: number[]; // displayOrder[displayPos] = originalChoiceIndex
}

interface RoundResult {
  correct: boolean;
  chosenDisplay: number; // display-position index the player clicked
}
```

### Key Functions

**`fisherYatesShuffle<T>(arr: T[]): T[]`** — `SpiritGrove.tsx:40`
Proper Fisher-Yates in-place shuffle. Used for both tier-level round selection and per-round choice ordering.

**`prepareRounds(pool)` — `SpiritGrove.tsx:49`**
Replaces the old `pickRounds`. Filters the pool into three difficulty tiers, shuffles each tier, draws `1 + 2 + 2`, pads if any tier is short, then attaches a shuffled `displayOrder` to each selected round. Returns `PreparedRound[]` sorted easy → medium → hard.

**`choose(displayIdx)` — `SpiritGrove.tsx:97`**
Core interaction handler wrapped in `useCallback`. Guards against double-selection and post-completion clicks. Maps the clicked display position back to the canonical choice index via `displayOrder[displayIdx]`, checks correctness, updates all state, plays a sound cue, stores an `advance` closure in `advanceFnRef`, and starts a `ROUND_TRANSITION_MS` timer to call it.

**`skipTransition()` — `SpiritGrove.tsx:92`**
Cancels the pending timer and immediately calls the stored advance closure from `advanceFnRef`. Called by the feedback strip's `onClick`.

**`scoreToStars(score01)` — `src/engine/trials/trials.ts:106`**
Unchanged. Thresholds at 0.75 and 0.40 now produce all three outcomes with 5-round granularity.

**`trialReward(stat, score01, level)` — `src/engine/trials/trials.ts:124`**
Unchanged formula. More distinct reward levels now that scores have 6 possible values instead of 4.

### State Management

All SpiritGrove state is **local React state** inside `SpiritGrove.tsx`:

| Variable | Type | Meaning |
|---|---|---|
| `prepared` | `PreparedRound[]` | The 5 selected and ordered rounds (memoized) |
| `roundIndex` | `number` | Current round (0–4) |
| `selectedDisplay` | `number \| null` | Display-position index of the player's choice |
| `correctCount` | `number` | Running correct-answer count |
| `results` | `RoundResult[]` | Per-round history used in the recap |
| `showFeedback` | `boolean` | Whether the feedback strip / explanation is visible |
| `done` | `boolean` | True after all 5 rounds complete |
| `timerRef` | `useRef` | Holds the pending `setTimeout` ID for cleanup and skip |
| `advanceFnRef` | `useRef` | Holds the pending advance closure for skip-tap |

The `advanceFnRef` pattern allows the skip-tap handler to fire the same closure that the timer would fire, capturing the correct `newCorrect`, `isFinal`, and `onFinish` values from the `choose` call without needing to re-derive them from state.

### Data Flow
```
content/trials.ts            → SPIRIT_GROVE_ROUNDS (15 rounds, static)
SpiritGrove (useMemo)        → prepareRounds() → prepared[] (5 PreparedRounds)
Player input (click / key)   → choose(displayIdx) → state updates + timer
choose() final round         → advanceFnRef → onFinish(score01)
TrialModal.handleFinish      → setScore, setStage('result')
Player taps "Claim Reward"   → completeTrial(trialId, score01)
useGameStore.completeTrial   → applyReward, checkLevelUp, persist to localStorage
```

### Save / Load Behavior
- **Persisted:** `trialsClearedOn['spirit_grove']` (ISO date, local timezone) and `bestTrialScore['spirit_grove']` (float 0..1) via Zustand's `persist` middleware to `localStorage`
- **Not persisted:** all in-session state — mid-run progress is lost on modal close

### Configuration
- `SPIRIT_GROVE_ROUND_COUNT = 5` — `src/content/trials.ts` (bottom of Spirit Grove section)
- `ROUND_TRANSITION_MS = 700` — `src/components/trials/games/SpiritGrove.tsx:12`
- `TRIALS_UNLOCK_LEVEL = 3` — `src/engine/trials/trials.ts:101`
- Reward formula constants are inline in `trialReward()`
- `settings.repeatMinigames` — dev flag in the store that bypasses the daily gate

### Dev-Mode Content Guard
A module-level block at `SpiritGrove.tsx:30` iterates `SPIRIT_GROVE_ROUNDS` on import and throws a descriptive error if any round's `correctIndex` is out of bounds. Eliminated by Vite's tree-shaking in production builds.

---

## 6. Software, Libraries, and Tools Used

| Layer | Technology |
|---|---|
| Framework | React 18 (functional components, hooks) |
| Language | TypeScript |
| Build tool | Vite |
| State management | Zustand with `persist` middleware (localStorage) |
| Styling | Tailwind CSS with custom design tokens (`parchment`, `gold-deep`, `ink`, `wood`, `emerald`, `rose`) |
| Rendering | DOM/CSS — no canvas, no WebGL |
| Animation | Tailwind `transition-all duration-200/300`, `scale-[1.02]`, `scale-110` — no animation library |
| Audio | `src/lib/sfx.ts` — zero-asset Web Audio API synthesizer. Spirit Grove uses `groveCorrect` and `groveWrong` one-shot cues. |
| UI components | Custom `<Button>` component (`src/components/ui/Button.tsx`) in TrialModal |
| Asset pipeline | No external assets; all visuals are emoji, Tailwind utility classes, and synthesized audio |

---

## 7. Assets and Presentation

### Visuals
Spirit Grove uses **no custom sprites, images, or canvas rendering**. The visual presentation is built from:
- **Tailwind utility classes** with custom design tokens
- **Emoji:** `🌿` (hub card, result modal glyph), `✨`, `🍂` (result feedback)
- **Unicode symbols:** `○ ✓ ✗` for the animated progress tracker
- **CSS transitions:** `transition-all duration-200` on choice buttons, `transition-all duration-300` on progress tracker symbols, `scale-[1.02]` subtle lift on the revealed correct button

### Color Language
| State | Styling |
|---|---|
| Correct button reveal | `border-emerald-500 bg-emerald-50 text-emerald-800 scale-[1.02] shadow-sm shadow-emerald-200/60` |
| Wrong button reveal | `border-rose-400 bg-rose-50 text-rose-800` |
| Unchosen after pick | `opacity-50` with muted parchment border |
| Default (no pick yet) | `border-gold-deep/40 bg-parchment-100/70` with gold hover brightening |
| Omen box | `bg-parchment-100/70 border-gold-deep/30` |
| Feedback strip | `bg-parchment-200/50 border-gold-deep/20` |
| Recap — correct round | `border-emerald-500/40 bg-emerald-50/50` |
| Recap — wrong round | `border-rose-400/40 bg-rose-50/50` |

### Typography
- Labels and headings: `font-display` (Cinzel or similar fantasy font)
- Omen text: `text-sm italic text-ink`
- Clue text: `text-xs opacity-60` — subdued, secondary
- Explanation text: `text-xs italic text-ink-muted`
- Key hint badges: `text-[10px] font-mono select-none`

### Audio
Two one-shot synthesized cues defined in `src/lib/sfx.ts`:
- **`groveCorrect`:** two sine tones at 440→660 Hz and 880→1100 Hz, rising over ~450 ms. Soft, nature-calm.
- **`groveWrong`:** a triangle wave descending from 260→140 Hz over ~300 ms. Quiet, acknowledgment-only — not harsh.

Neither cue plays if the AudioContext is suspended (player closed the browser tab mid-run) or if the master gain is muted. No ambient loop or music track exists for Spirit Grove — the contemplative silence is preserved during the omen-reading phase; audio only fires on selection.

### Style and Mood
Consistent with the broader parchment-and-wood RPG aesthetic. The omen texts are written in evocative, low-fantasy prose. The overall mood is calm and literary. The subtle correct-button scale lift and progress tracker animation add tactile feedback without disrupting the quiet tone.

---

## 8. Current Player Experience

### What Works Well
- **Audio feedback** now makes selections feel physically real — the correct chime is satisfying, the wrong pulse is gentle but present.
- **Very low friction:** tap a button, hear a sound, read a line of explanation, continue. Sessions take 20–40 seconds of active engagement.
- **Explanation after each round** transforms wrong answers from frustrating to informative. The player always learns why the correct answer is right before moving on.
- **Per-round result recap** at the end gives a clean review of the full session — especially useful for hard rounds where the player may not have followed the reasoning.
- **Correct answer always revealed:** even on wrong picks, the correct button highlights green. This is the most educationally sound design choice in the trial and is now paired with an explanation text.
- **Answer position shuffled each session:** position-memorization is no longer possible, forcing the player to read each round fresh.
- **Difficulty ramp:** sessions now start with one easy round and end with two hard rounds, giving a satisfying sense of progression within a single run.
- **Skip-to-continue:** experienced players can tap through the feedback pause without waiting. The timer does not block flow for confident players.
- **Keyboard support:** number keys 1–4 make desktop play natural and fast.
- **Participation bonus:** the 25% reward floor means a zero score still earns something, reinforcing the daily habit loop.

### What Feels Weak or Awkward
- **Difficulty tier is invisible to the player.** Rounds don't display any signal that round 3 is harder than round 1. A player who struggles on a hard round has no framing for why it was more difficult.
- **No ambient audio.** Correct/wrong cues play on selection, but the rest of the round is silent. Other trials with real-time mechanics have tension drones or ambient loops; Spirit Grove reads and sounds like a different genre of game.
- **Hard rounds can feel unfair on first encounter.** Two or three choices are genuinely plausible. Without prior exposure to a round's omen, the "right" answer can feel arbitrary even with clue text, especially when the distinction requires cultural or symbolic knowledge the player may not have.
- **Explanation visible only after selection.** Players can't consult the explanation before choosing. This is appropriate for a challenge, but means first-time hard rounds are essentially guesses for players who lack the relevant reference frame.
- **No replay for learning.** The daily gate prevents trying again. A player who misses a hard round and reads the explanation has no immediate opportunity to test their understanding.

### Pacing
At five rounds with a 700 ms feedback pause and explanation text, sessions take roughly 25–45 seconds of active play time. This is appropriate for a daily ritual. The ramp from easy to hard gives the session a natural shape. The skip-tap option keeps experienced players from being held back by the explanation they already read.

### Difficulty Fairness
The new difficulty structure is more honest than the previous flat pool. Easy rounds are genuinely easy; medium rounds reward attention; hard rounds are intentionally challenging and require close reading. The 2-star tier (2–3/5) is now a meaningful "competent but not perfect" zone, and 3-star requires actually getting the hard rounds right.

---

## 9. Known Issues and Weak Points

### Fixed Since Original Analysis
The following issues identified in the original analysis have been resolved:
- ✓ **2-star tier unreachable** — fixed by raising round count to 5
- ✓ **Only 6 rounds** — pool expanded to 15; memorization no longer viable for weeks
- ✓ **Fixed choice order** — choices are now shuffled per session
- ✓ **No audio** — `groveCorrect` / `groveWrong` cues added
- ✓ **No explanation of correct answers** — explanation field on all 15 rounds, shown after each selection
- ✓ **`setTimeout` cleanup missing** — `timerRef` + unmount `useEffect` cleanup added
- ✓ **Biased shuffle** — replaced with Fisher-Yates
- ✓ **Magic number 900** — extracted to `ROUND_TRANSITION_MS = 700`
- ✓ **No content validation guard** — dev-mode module-level check added
- ✓ **No keyboard navigation** — keys 1–4 supported
- ✓ **No aria labels** — `aria-label`, `aria-pressed`, `role="group"` added

### Remaining Design Issues
- **Difficulty is invisible to the player.** The `difficulty` field drives round selection and affects how challenging a round is, but nothing in the UI signals which rounds are easy, medium, or hard. A player who fails a hard round doesn't know it was a hard round.
- **No ambient audio.** Cues fire on selection, but there is no loop or ambient sound during omen reading. This remains quieter than other trials.
- **Hard rounds can feel arbitrary on first play.** The symbolic and cultural references in hard round omens (e.g., west = endings, shadow direction, smoke without fire) may be opaque to players unfamiliar with those conventions. The explanation helps, but only arrives after the wrong guess.

### Remaining Technical Issues
- **No unit tests.** `src/engine/trials/__tests__/trials.test.ts` contains no Spirit Grove-specific tests. The `prepareRounds` logic, tier selection, display-order shuffle, and score-to-stars mapping for 5 rounds have no automated coverage.
- **`choose` dependency array includes `results` and `correctCount`.** Because `results` is an array (new reference each render after `setResults`), and `correctCount` changes each round, `choose` is recreated every render during active play. This is functionally correct but slightly wasteful. Alternatives (functional updaters + refs) would eliminate the recreations at the cost of more complexity.
- **`displayOrder` and `round.correctIndex` are not listed in `choose`'s `useCallback` deps.** They are derived from `prepared[roundIndex]`, and `prepared` and `roundIndex` are both included, so the closure captures the correct values when recreated — but the dependency relationship is implicit and not obvious to a future reader.

### Minor Issues
- The `'Tap to continue →'` text in the feedback strip is always the same regardless of whether `round.explanation` exists. (The conditional logic shows/hides the explanation span correctly, but the prompt text is unconditional.)

---

## 10. Remaining Improvement Opportunities

### Content
- **More hard rounds.** The current 5 hard rounds cover a range of symbolic registers, but the pool is still small enough that repeat players will see each hard round frequently. Adding 5–10 more hard rounds (targeting highly ambiguous omens with genuinely competing choices) is the single highest-content-value addition remaining.
- **Explanation quality review.** Some explanations distinguish the correct answer from one distractor but don't address all plausible distractors. Tightening the hardest rounds' explanations to address the two most-likely wrong picks would improve the educational value.

### Mechanics
- **Signal difficulty to the player.** Even a subtle indicator — a dot pattern, a slightly different omen box border, or a post-round label ("This was a hard omen") — would help players understand why some rounds are tougher and frame the learning appropriately.
- **WI stat influence on clue visibility.** At low Wisdom stat levels, hide clues on hard rounds; at high levels, show additional context or the explanation pre-emptively. This would create a mechanical reason to invest in Wisdom beyond abstract XP accumulation.

### Polish
- **Ambient audio.** A soft forest ambient loop (wind, birdsong) that starts when `playing` stage begins and fades on result would give the trial a distinct sonic identity and close the gap with other trials that use the drone system.

### Code Quality
- **Unit tests** for `prepareRounds` (always returns 5 rounds, correct tier distribution, no duplicates), `fisherYatesShuffle` (basic coverage), and `scoreToStars` at the new 5-round boundary values (0.4, 0.6, 0.8).
- **Explicit `displayOrder` and `round.correctIndex` in `choose` deps** (or a comment explaining why they're implicit through `roundIndex`) for future readability.

### Integration
- **Daily gate timezone note.** `toISODate()` in `src/engine/date.ts` uses the player's local timezone intentionally (matching the habit-completion convention across the rest of the game). This is documented in the source but not surfaced to the player. No change needed, but it is worth knowing the behavior is local-time-based.

---

## 11. Questions and Unknowns

1. **Should the difficulty tier be visible to the player?** Showing "hard omen" framing would set expectations but might also feel condescending on easy rounds. A post-round label ("This was a hard omen — well read!") might thread this needle.
2. **Are the hard round explanations sufficient?** Hard rounds have 2–3 plausible distractors, but most explanations only address the sharpest one. Are players coming away understanding the others are wrong, or just understanding that the correct answer is right?
3. **Should the ambient silence be a feature or a gap?** The omen-reading phase is currently silent. This could be read as intentional contemplative space or as missing audio. The answer affects whether ambient audio is a priority or optional polish.
4. **Does the WI stat influence plan fit the game's design direction?** Making clue visibility depend on `statLevels.WI` is the most impactful remaining design integration. It requires deciding whether trials should feel skill-gated (harder with low stats) or stat-reward-only (stats affect reward, not difficulty). Currently all trials are reward-only.
5. **Are the hard round symbolic conventions too culturally specific?** "West = endings," "seven circuits = completion," and smoke-without-fire imagery draw on specific folklore traditions. Players outside those traditions face effectively random choices on those rounds. Whether this is acceptable or whether omens should be more self-contained is an open design question.
6. **Is 5 rounds the right count long-term?** Five is a clear improvement over three — all star tiers work, sessions have shape, rewards are more granular. But if the pool grows to 30+ rounds, reconsidering the count is reasonable. The `SPIRIT_GROVE_ROUND_COUNT` constant makes this a one-line change.
