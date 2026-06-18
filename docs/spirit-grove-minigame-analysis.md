# Spirit Grove — Minigame Analysis

## 1. Basic Summary

Spirit Grove is the **Wisdom (WI) Skill Trial** — one of eight daily minigames in the HabitsRPG Skill Trials system. The player reads a short mystical "omen" (a one-sentence nature vignette) and selects which of four named blessings the omen is describing. Three rounds are played per session, drawn randomly from a pool of six.

It fits into the larger game as a **daily habit-reinforcement loop**: completing a trial earns Wisdom XP and gold, contributing to character leveling. Trials are gated once per calendar day, making them a light daily ritual rather than a grindable system. Spirit Grove is unlocked alongside all other trials at character level 3 (`TRIALS_UNLOCK_LEVEL = 3`).

Thematically, Spirit Grove is the quietest, most contemplative trial — no timers, no real-time inputs, no fail state. It is a pure comprehension/intuition puzzle dressed in low-fantasy nature lore.

---

## 2. Core Game Loop

### Start
The player opens the Skills tab and taps the Spirit Grove card (`🌿 Spirit Grove`). The `TrialModal` renders over the full screen with an **intro stage**: a parchment card showing the trial description, a note about the daily free attempt, and a "Begin Trial" button. Tapping "Begin Trial" calls `sfxResume()` (to unlock the browser AudioContext) and transitions to the `playing` stage.

On component mount, `pickRounds()` selects 3 rounds from the 6-round pool via a Fisher-Yates-style shuffle (`[...rounds].sort(() => Math.random() - 0.5)`). These 3 rounds are memoized for the full session — they do not change while the modal is open.

### Each Round
1. The player sees a **Round X of Y** header and a running **○ ✓ ✗** progress tracker.
2. Below the header is a parchment box labeled **"Omen"** containing one sentence of nature description (e.g., *"The bark of the elder tree has split, and sap weeps upward like tears."*).
3. Below the omen are **four choice buttons**, each showing a blessing name in bold and an optional italic clue in smaller text (e.g., *"Seals wounds and cracks."*).
4. The player taps one button. All buttons are immediately disabled. The selected button turns **emerald green** (correct) or **rose red** (wrong), and the correct answer always highlights green regardless of which was chosen.
5. After **900 ms**, the component automatically advances to the next round (or to the result view if this was the final round).

### End
After round 3, `done` is set to `true` and `onFinish(correctCount / rounds.length)` is called. The `TrialModal` transitions to the **result stage**, which shows the emoji result, a star rating, a percentage score, and a reward breakdown. A **"Claim Reward"** button calls `completeTrial(trialId, score)` in the store. After claiming, the button swaps to **"Return to Trials"**.

### Outcomes
- **Score**: `correctCount / 3` → 0.0, 0.33, 0.67, or 1.0
- **Stars**: 0–33% = 1 star, 33–74% = 2 stars (never reached at 3-round granularity), 75%+ = 3 stars
- **Rewards**: WI XP + gold, both scaling with character level and score
- **No fail state**: The player always completes all 3 rounds regardless of answers

---

## 3. Player Controls and Interaction

### Input Controls
- **Mouse click / touch tap** on choice buttons — the only input required
- No keyboard navigation, no gamepad support, no hotkeys

### UI Elements
| Element | Description |
|---|---|
| Round counter | `"Round X of Y"` in `font-display`, top-left |
| Progress tracker | `"○ ✓ ✗"` symbols for each round, top-right |
| Omen box | Parchment-styled card with italic omen text |
| Choice buttons | 4 full-width buttons with label + clue |
| Result view | Emoji, narrative message, `"X / Y omens read correctly"` |
| TrialModal header | Trial name, stat label, close button |
| TrialModal result | Star rating, score %, reward table, Claim/Return buttons |

### Feedback Given to the Player
- **Immediate on click**: Correct button turns emerald, wrong button turns rose — within the same render cycle
- **Correct button always revealed**: Even on a wrong guess, the correct answer highlights green, so the player learns the right answer before moving on
- **900 ms pause**: A brief pause lets the player absorb the feedback before auto-advancing
- **Progress tracker**: Updates to show ✓ or ✗ after each round
- **Result emoji**: `🌿✨` (perfect), `🌿` (2/3), `🍂` (0–1/3) on the final screen
- **Narrative line**: One of three context-sensitive messages ("The grove spirits bless you with full favour", etc.)
- **Star rating + percentage** in the TrialModal result stage
- **Reward preview**: Gold and WI XP amounts shown before claiming, so the player knows what they earned

### Overlays and Menus
- The `TrialModal` (`src/components/trials/TrialModal.tsx`) wraps Spirit Grove in a fixed full-screen overlay with `z-50`. It handles intro, playing, and result stages externally — `SpiritGrove` only manages the in-round state.

---

## 4. Mechanics and Systems

### Scoring
Score is a normalized float: `correctCount / rounds.length` (always 3).
Possible values: `0.0`, `0.333…`, `0.667…`, `1.0`.

**Star thresholds** (`scoreToStars` in `src/engine/trials/trials.ts:106`):
- ≥ 0.75 → 3 stars (requires 3/3)
- ≥ 0.40 → 2 stars (requires 2/3, since 0.667 ≥ 0.40)
- < 0.40 → 1 star (0/3 or 1/3)

In practice, 2/3 and 3/3 both award 3 stars. There is no functional 2-star outcome at the current round count.

### Movement
None. Spirit Grove has no spatial movement or navigation.

### Choices and Correct Answers
Each round has exactly 4 choices. One is correct (`correctIndex`). Choices are always presented in the same fixed order — there is no per-round shuffle of the answer positions.

### Timers
No countdown timer exists inside SpiritGrove. The only timing element is the **900 ms `setTimeout`** after a selection, used as a feedback pause before advancing.

### Randomization
Round selection is randomized per session via `pickRounds()`. The 3 rounds drawn are locked in for the entire session via `useMemo`. The order of choices within each round is fixed (not shuffled).

### Progression
- **Within a session**: Linear, round-by-round
- **Daily**: Once per calendar day. The trial cannot be replayed for rewards on the same UTC day unless the `settings.repeatMinigames` dev flag is enabled.
- **Best score**: `bestTrialScore['spirit_grove']` persists the all-time best score across sessions

### Win / Loss Conditions
- **Win**: Not applicable — the player always completes all 3 rounds
- **Loss**: Not applicable — there is no fail state or early exit
- **Score granularity**: 0, 1, 2, or 3 correct answers determine reward magnitude

### Reward Scaling (`trialReward` in `src/engine/trials/trials.ts:124`)
```
multiplier = 0.25 + 0.75 * score01   // floor at 25% for participation
statXp     = round((20 + 8 * level) * multiplier)
gold       = round((15 + 5 * level) * multiplier)
```
At level 5, perfect score: 60 WI XP + 40 gold. At level 5, zero score: 15 WI XP + 10 gold.

### Larger-Game Integration
- Character `level` scales the reward magnitude but does not affect difficulty
- Earned WI XP feeds into `character.statXp.WI`, which contributes to total XP driving level-ups
- Level-up flow: auto-levels below level 5; queues a `pendingLevelUp` boss gate at level 5+
- Wisdom stat level (`character.statLevels.WI`) is not referenced inside Spirit Grove at all — there is no difficulty scaling based on the player's current WI stat level

---

## 5. Technical Implementation

### Files

| File | Role |
|---|---|
| `src/components/trials/games/SpiritGrove.tsx` | Main game component: all in-round state and rendering |
| `src/components/trials/TrialModal.tsx` | Modal wrapper: intro/playing/result stages, reward claim |
| `src/engine/trials/trials.ts` | Trial registry, `scoreToStars`, `trialReward`, `getTrial` |
| `src/content/trials.ts` | `SPIRIT_GROVE_ROUNDS` data, `SPIRIT_GROVE_ROUND_COUNT`, interfaces |
| `src/store/useGameStore.ts` | `completeTrial` action; `trialsClearedOn`, `bestTrialScore` state |

### Key Functions

**`pickRounds(rounds)` — `SpiritGrove.tsx:14`**
Shuffles the 6-round pool and returns the first 3. Called once via `useMemo`.

**`choose(choiceIdx)` — `SpiritGrove.tsx:30`**
The core interaction handler. Guards against double-selection and post-completion clicks. Records the choice, updates `correctCount` and `roundsCompleted`, then schedules a 900 ms `setTimeout` to advance the round or finalize the game.

**`scoreToStars(score01)` — `engine/trials/trials.ts:106`**
Converts 0..1 float to 1|2|3 star rating. Thresholds at 0.75 and 0.40.

**`trialReward(stat, score01, level)` — `engine/trials/trials.ts:124`**
Returns a `Reward` object with `gold` and `statXp` computed from the level-scaling formula.

**`completeTrial(trialId, score01)` — `useGameStore.ts` (store action)**
Enforces the daily gate. Stamps `trialsClearedOn[trialId]` with today's ISO date. Updates `bestTrialScore`. Calls `applyReward` and `checkLevelUp`.

### State Management

All SpiritGrove state is **local React state** (`useState`) inside `SpiritGrove.tsx`:

| Variable | Type | Meaning |
|---|---|---|
| `rounds` | `SpiritGroveRound[]` | The 3 selected rounds (memoized) |
| `roundIndex` | `number` | Current round (0–2) |
| `selected` | `number \| null` | Index of the player's current choice |
| `correctCount` | `number` | Running correct-answer count |
| `roundsCompleted` | `{ correct, chosen }[]` | Per-round history for the progress tracker |
| `done` | `boolean` | True after all rounds complete |

No mid-session state is persisted. Closing and reopening the modal resets everything. The `TrialModal` holds `stage` ('intro' | 'playing' | 'result'), `score`, and `claimed` as its own local state.

### Data Flow
```
content/trials.ts                → SPIRIT_GROVE_ROUNDS (static data array)
SpiritGrove.tsx (useMemo)        → pickRounds() → local rounds[]
Player click                     → choose(idx) → local state updates
choose() final round             → onFinish(score01)
TrialModal.handleFinish          → setScore, setStage('result')
TrialModal "Claim Reward"        → completeTrial(trialId, score01)
useGameStore.completeTrial       → applyReward, checkLevelUp, persist to localStorage
```

### Save / Load Behavior
- **Persisted**: `trialsClearedOn['spirit_grove']` (ISO date string) and `bestTrialScore['spirit_grove']` (float 0..1) via Zustand's `persist` middleware to `localStorage`
- **Not persisted**: All in-session game state. Mid-run progress is lost if the modal is closed.

### Configuration
- `SPIRIT_GROVE_ROUND_COUNT = 3` — `src/content/trials.ts:100`
- `TRIALS_UNLOCK_LEVEL = 3` — `src/engine/trials/trials.ts:101`
- Reward formula constants are inline in `trialReward()` (not extracted to named constants)
- `settings.repeatMinigames` — dev flag in the store that bypasses the daily gate

---

## 6. Software, Libraries, and Tools Used

| Layer | Technology |
|---|---|
| Framework | React 18 (functional components, hooks) |
| Language | TypeScript |
| Build tool | Vite |
| State management | Zustand with `persist` middleware (localStorage) |
| Styling | Tailwind CSS with custom design tokens (`parchment`, `gold-deep`, `ink`, `wood`) |
| Rendering | DOM/CSS — no canvas, no WebGL |
| Animation | CSS `transition-colors` on buttons; no animation library |
| Physics | None |
| Collision | None |
| Audio | `src/lib/sfx.ts` `resume()` is called on "Begin Trial" to unlock AudioContext — but no Spirit Grove-specific sound effects are played |
| UI components | Custom `<Button>` component (`src/components/ui/Button.tsx`) |
| Asset pipeline | No external assets; all visuals are emoji, Tailwind classes, and CSS |

---

## 7. Assets and Presentation

### Visuals
Spirit Grove uses **no custom sprites, images, or canvas rendering**. The entire visual presentation is built from:
- **Tailwind utility classes** with custom design tokens
- **Emoji**: `🌿` (hub card icon, result modal), `✨`, `🍂` (result feedback)
- **Unicode symbols**: `○ ✓ ✗` for the progress tracker
- **CSS border/background styling** for the parchment card and choice buttons

### Color Language
| State | Color |
|---|---|
| Correct answer | Emerald (`border-emerald-500 bg-emerald-50 text-emerald-800`) |
| Wrong answer | Rose (`border-rose-400 bg-rose-50 text-rose-800`) |
| Unchosen after pick | Muted parchment (`opacity-50`) |
| Default / hover | Gold border (`border-gold-deep/40`) brightening on hover |
| Omen box | Parchment (`bg-parchment-100/70 border-gold-deep/30`) |

### Typography
- Headings and labels: `font-display` (the project's fantasy/display font, likely Cinzel or similar)
- Body text: default body font
- Omen text: italic (`text-sm italic text-ink`)
- Clue text: `text-xs opacity-60` — subdued, clearly secondary

### Audio
No sound effects or music specific to Spirit Grove. The `sfxResume()` call in `TrialModal` on "Begin Trial" unlocks the browser AudioContext for other trials that do use audio, but Spirit Grove itself plays no sounds.

### Style and Mood
The presentation is consistent with the broader parchment-and-wood RPG aesthetic of the game. The omen text is written in evocative, low-fantasy prose. The effect is calm and literary — appropriate for a Wisdom trial. The lack of animation or audio keeps the minigame visually quiet, which fits its contemplative nature but also makes it feel less alive than the more kinetic trials.

---

## 8. Current Player Experience

### What Works Well
- **Very low friction**: Tap a button, see feedback, move on. No learning curve whatsoever.
- **Theme coherence**: The omen + blessing framing feels genuinely in-world and consistent with the fantasy RPG setting.
- **Answer reveal on wrong guess**: The correct button highlights even when the player picks wrong. This makes failure feel educational rather than punishing, and is especially good for a "Wisdom" trial.
- **Progress tracker**: The `○ ✓ ✗` header gives a clear sense of how far through the trial you are.
- **Participation bonus**: The 25% reward floor means a player who guesses randomly still earns something, reinforcing the daily habit loop.
- **Speed**: A complete run takes roughly 5–10 seconds of active decision time. This is ideal for a daily mobile-oriented ritual.

### What Feels Weak or Awkward
- **No real challenge**: The clues make most answers fairly obvious after reading once. There is no pressure (no timer, no lives, no penalty), making it feel more like trivia than a test of Wisdom.
- **Shallow replayability**: With only 6 rounds in the pool and 3 drawn per session, the player will exhaust the content quickly (within a week of daily play they will have seen every round multiple times and memorized the answers).
- **Star system is broken at 3 rounds**: The 2-star band (0.40–0.74) can never actually be hit with a 3-round format — 2/3 = 0.667 ≥ 0.40 → 3 stars, 1/3 = 0.333 < 0.40 → 1 star. The middle star tier is unreachable, which makes the rating feel slightly misleading.
- **No wrong-answer explanation**: After revealing the correct choice, the game gives no context about *why* it's correct. Players may feel the correct answers are arbitrary without that context.
- **No audio**: Every other trial that has real-time input has at least button sounds or ambient audio. Spirit Grove's silence makes it feel notably less polished by comparison.
- **900 ms transition feels slightly long** when you already know the answer from memory. There is no way to skip it.

### Pacing
The overall pacing is fast. Three rounds at roughly 2–3 seconds of reading each, plus 900 ms per feedback pause, puts a full run at approximately 10–12 seconds from first omen to "Claim Reward". This is appropriate for a daily ritual but leaves no room for tension or investment.

### Difficulty Fairness
The current difficulty is very low. The clue text gives enough context that even a first-time player who hasn't seen a round before can make an educated guess. There is no escalating difficulty between round 1 and round 3. Long-term players who have memorized all 6 rounds will always score 3/3.

---

## 9. Known Issues and Weak Points

### Design Issues
- **Only 6 rounds** in the pool (`SPIRIT_GROVE_ROUNDS` in `src/content/trials.ts:36`). After ~2 weeks of daily play, the player will have the answers memorized and the trial becomes a 10-second formality.
- **2-star tier is unreachable** at 3 rounds. The `scoreToStars` thresholds were likely designed for a higher round count. See `engine/trials/trials.ts:106`.
- **Answer order is never shuffled**: `round.choices` are always presented in the same fixed order. A player who has seen a round before knows both the omen and the button position, making selection nearly automatic.
- **No difficulty curve**: Round 1 and Round 3 are equally easy. No scaffolding or ramp exists.
- **No explanation of the correct answer**: Players learn the answer but not why, limiting the "Wisdom" framing from feeling earned.

### Technical Issues / Code Concerns
- `correctIndex` in the content data is not validated against `choices.length`. A malformed entry with `correctIndex >= 4` would result in no button ever matching, silently producing a zero score.
- The 900 ms timeout ID is not cleaned up. If the component unmounts before the timeout fires (e.g., the user closes the modal mid-round), the callback will attempt to call `setRoundIndex` on an unmounted component. In React 18 strict mode this is a no-op warning rather than a crash, but it is still unclean.
- The shuffle in `pickRounds` uses `Array.sort(() => Math.random() - 0.5)`, which is not a statistically uniform shuffle (known bias in V8's sort implementation). For a 6-element pool it is functionally fine but not technically correct.

### Missing Features
- No sound effects or ambient audio for Spirit Grove.
- No keyboard navigation or accessibility labels on choice buttons.
- No "replay" or "try again" flow — the player must close and reopen the modal (which is gated by the daily lock anyway, but still).

---

## 10. Improvement Opportunities

### Content
- Expand `SPIRIT_GROVE_ROUNDS` from 6 to 15–20 rounds to meaningfully reduce answer memorization
- Add 1–2 harder rounds where the omen is more ambiguous and multiple choices seem plausible
- Consider tiered round difficulty (easy → medium → hard draw per session) to introduce a ramp

### Mechanics
- **Shuffle choice order** per presentation so that position-memorization is not possible
- **Add an optional timer** (e.g., 15–20 seconds) as an opt-in difficulty mode, creating genuine pressure
- **Wrong-answer explanation**: After revealing the correct choice, show a one-line rationale. This deepens the "reading the spirits" fantasy and makes the education aspect feel intentional.
- **Fix star thresholds**: Either adjust `scoreToStars` to use `>= 0.60` for 2 stars (making 2/3 a 2-star result), or increase `SPIRIT_GROVE_ROUND_COUNT` to 5 to create more granularity.

### Presentation
- Add ambient sound (gentle forest ambience or a subtle chime on selection)
- Add a brief CSS animation on choice reveal (a soft glow or shimmer on the correct button)
- Animate the progress tracker update (○ → ✓/✗ with a small transition)

### Code Quality
- Clean up the `setTimeout` with a `useEffect` return that calls `clearTimeout`
- Extract the 900 ms delay to a named constant (`ROUND_TRANSITION_MS`)
- Add a data validation guard in `pickRounds` or content loading that asserts `correctIndex < choices.length`
- Replace the biased sort-shuffle with a proper Fisher-Yates implementation

### Integration
- Surface `bestTrialScore['spirit_grove']` on the hub card as a small record indicator (other trials may do this — verify consistency)
- Consider whether the player's WI stat level should affect anything (e.g., clue text visibility, number of choices, timer duration) to make the trial feel more connected to character progression

---

## 11. Questions and Unknowns

1. **Is the 900 ms transition delay intentional or a placeholder?** Other trials should be checked for consistency. Is there a shared constant for this?
2. **Are clue texts intended to be visible always, or should harder rounds omit them?** Currently all choices have clues (`clue?` is optional in the interface but all current rounds use it). Whether hiding clues is a planned difficulty lever is unclear.
3. **Was `SPIRIT_GROVE_ROUND_COUNT = 5` ever considered?** 5 rounds would enable all three star tiers (0/5 = 0%, 1/5 = 20%, 2/5 = 40%, 3/5 = 60%, 4/5 = 80%, 5/5 = 100%). The current `scoreToStars` thresholds map cleanly to a 5-round format.
4. **Is there a plan to add more round content?** The comment at `content/trials.ts:1` says "edit this file to tune Spirit Grove" — it's clearly designed to be extended, but no roadmap is present.
5. **Why does Spirit Grove have no audio when other trials do?** Is this a deliberate design choice (silence = contemplation) or an unfinished feature?
6. **Does the daily gate use UTC or local time?** Verify that `toISODate()` uses UTC midnight, since local-time midnight could let players reset early depending on timezone.
7. **Are the omen/blessing pairings internally documented anywhere?** The `content/trials.ts` file is the only source. If a content author needs to add rounds, there's no documented ruleset for what makes an omen/blessing pair "correct."
8. **Is `SpiritGrove` tested?** The `src/engine/__tests__/` directory covers engine logic. Whether `SpiritGrove.tsx` or the trial content has any unit test coverage is unknown.
