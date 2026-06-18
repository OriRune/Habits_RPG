# Royal Court — Minigame Analysis

## 1. Basic Summary

Royal Court is the **Charisma (CH)** Skill Trial — one of eight daily minigames in the Skills tab (`src/views/TrialsView.tsx`). The player navigates a series of social encounters at a medieval court, choosing dialogue responses to earn favour with Queen Elowen. It is a fully text-driven, choice-based game with no real-time input — the closest thing to a "visual novel" in the trial suite.

It fits into the larger game as a free daily CH XP source. Like all trials it awards Charisma XP and gold scaled to the player's level and score, contributes to the level-up progression pipeline, and can be attempted once per calendar day. It unlocks at Level 3 alongside the rest of the Skills tab.

---

## 2. Core Game Loop

### Start
The player taps the "Royal Court" card in the Skills tab (`src/views/TrialsView.tsx`). `TrialModal` (`src/components/trials/TrialModal.tsx`) opens in the `'intro'` stage, displaying the trial description and a "Begin Trial" button. Clicking that button advances to the `'playing'` stage and mounts the `RoyalCourt` component (`src/components/trials/games/RoyalCourt.tsx`).

On mount, `pickExchanges` shuffles the pool of 6 exchanges and slices the first 4:

```typescript
function pickExchanges(exchanges) {
  const shuffled = [...exchanges].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, ROYAL_COURT_EXCHANGE_COUNT); // 4
}
```

### Each Exchange
1. An NPC name and dialogue line are shown in a parchment-styled box.
2. Four response buttons appear below. `favorDelta` values are invisible to the player.
3. The player clicks a response. The chosen button immediately highlights (green for positive, red for negative, gold for neutral), and its `favorDelta` label is revealed inline (e.g. `+3 favour ✓`). All other buttons dim.
4. After a 900 ms `setTimeout`, the UI advances to the next exchange (or ends if this was the last).

### End
After the 4th exchange, `onFinish(score01)` is called with `score01 = Math.min(1, newFavor / maxFavor)`. `TrialModal` transitions to the `'result'` stage, showing stars, score %, and the computed reward. The player clicks "Claim Reward" to call `completeTrial(trialId, score)` in the store and then "Return to Trials" to close.

### Challenge
There is no timer. The only challenge is inferring the "correct" social response from plain text — the `favorDelta` is hidden until after the choice is locked in.

### Outcomes
- Score of 0–1 passed to `trialReward`; CH XP and gold awarded.
- `trialsClearedOn['royal_court']` is stamped with today's ISO date (blocks replay until tomorrow unless `settings.repeatMinigames` is on).
- `bestTrialScore['royal_court']` is updated to the max of old best and current score.

---

## 3. Player Controls and Interaction

**Input:** Mouse/tap only — click one of four response buttons per exchange. There is no keyboard navigation and no timing element.

**UI elements:**
- **Court Favour bar** — a gold progress bar at the top showing current favour as a percentage (`Math.round(favorPct)%`). Animates with `transition-all duration-500`.
- **Exchange counter** — "Exchange N of 4" text above the NPC dialogue box.
- **NPC dialogue box** — rounded parchment card with the NPC name in bold and their line in italics.
- **Response buttons** — four full-width buttons styled as parchment cards; hover state highlights in gold.
- **Post-choice feedback** — the selected button reveals its delta label; unselected buttons go to 40% opacity.
- **Result screen** — emoji (👑✨ / 👑 / 🎭), a narrative outcome line, and "Final favour: XX%".

**Modal chrome (TrialModal):**
- Header: trial glyph + name + "Charisma Trial" in pink (`stat.color`).
- Close button (✕) available at all stages; closing before claiming forfeits the reward.
- Intro parchment card with full rules text + "Begin Trial" button.
- Result card with star rating, score %, gold and XP reward breakdown, "Claim Reward" / "Return to Trials" buttons.

**Feedback to player:**
- Visual: button colour change (emerald / rose / gold) + delta label revealed immediately on click.
- Favour bar updates and animates with each exchange.
- No sound effects inside `RoyalCourt.tsx`; `sfxResume()` is called from `TrialModal` on "Begin Trial" to satisfy browser autoplay policy but no sounds are triggered during play.
- Result emoji and narrative text give a qualitative read on performance.

---

## 4. Mechanics and Systems

### Exchanges and Favour
Six exchanges are defined in `src/content/trials.ts` (`ROYAL_COURT_EXCHANGES`). Four are selected per session by `pickExchanges`. Each has exactly four responses, each with a hidden `favorDelta` (range: –3 to +3).

The running favour score is floored at 0:

```typescript
const newFavor = Math.max(0, favor + choice.favorDelta);
```

The maximum possible favour equals the sum of the best choice across the 4 selected exchanges. Since every exchange has a max delta of exactly 3, `maxFavor` is always **12**.

### Scoring
```
score01 = Math.min(1, newFavor / maxFavor)  // always 0..1
```

### Star Rating (`scoreToStars` in `src/engine/trials/trials.ts`)
| Stars | Threshold |
|-------|-----------|
| ★★★   | score ≥ 0.75 (favour ≥ 75%, i.e. ≥ 9/12) |
| ★★    | score ≥ 0.40 (favour ≥ 40%, i.e. ≥ 5/12) |
| ★     | score < 0.40 |

### Reward Scaling (`trialReward` in `src/engine/trials/trials.ts`)
```
multiplier = 0.25 + 0.75 × score01     // range: 0.25..1.0
CH XP      = round((20 + 8 × level) × multiplier)
Gold       = round((15 + 5 × level) × multiplier)
```

Participation floor at `score = 0` (25% reward) means even a failed run gives something. Example values:

| Level | Score | CH XP | Gold |
|-------|-------|-------|------|
| 1     | 0.0   | 7     | 5    |
| 1     | 0.75  | 22    | 15   |
| 1     | 1.0   | 28    | 20   |
| 5     | 0.75  | 39    | 26   |
| 10    | 0.75  | 71    | 48   |
| 10    | 1.0   | 100   | 65   |

### Daily Gate
State key: `trialsClearedOn: Record<TrialId, string>` (ISO date string, `''` = never cleared). Cleared once per calendar day. Replay unlocked via `settings.repeatMinigames` (dev toggle). `bestTrialScore` persists the all-time high score for the hub star display.

### Randomization
Exchange selection only — the order of choices within an exchange is fixed. `pickExchanges` uses `sort(() => Math.random() - 0.5)`, which is a biased shuffle (not Fisher-Yates), but functional enough for a small pool.

### Win / Loss
There is no fail state. The trial always completes after 4 exchanges and a score is always produced.

### Larger-game stats affecting the minigame
None. No player stat, gear, or buff modifies choice outcomes or favour values. The player's `character.level` only affects the reward payout, not the trial difficulty or scoring.

---

## 5. Technical Implementation

### Main files

| File | Role |
|------|------|
| `src/components/trials/games/RoyalCourt.tsx` | The playable component |
| `src/content/trials.ts` | Exchange and choice data (`ROYAL_COURT_EXCHANGES`, `ROYAL_COURT_EXCHANGE_COUNT`) |
| `src/engine/trials/trials.ts` | Trial registry, `trialReward`, `scoreToStars`, `getTrial`, `TRIALS_UNLOCK_LEVEL` |
| `src/components/trials/TrialModal.tsx` | Modal shell — intro / playing / result stages |
| `src/views/TrialsView.tsx` | Hub card grid, daily-gate check, opens the modal |
| `src/store/useGameStore.ts` | `completeTrial` action (state write, reward apply, level check) |

### Key functions

**`RoyalCourt` (component, `RoyalCourt.tsx:19`)**
Top-level component. Holds all local state (`exchangeIndex`, `favor`, `selected`, `done`). Calls `onFinish(score01)` when the last exchange resolves.

**`pickExchanges` (`RoyalCourt.tsx:14`)**
Shuffles and slices the exchange pool. Memoized with `useMemo` so it runs once per mount.

**`choose` (`RoyalCourt.tsx:34`)**
Handles a button click: guards against double-clicks, applies delta, sets selected state, schedules `setTimeout(900)` to advance or end.

**`trialReward` (`trials.ts:124`)**
Pure function: `(stat, score01, level) → { gold, statXp }`. Used by both TrialModal (for preview) and `completeTrial` (for the actual write).

**`scoreToStars` (`trials.ts:106`)**
Pure function: `(score01) → 1|2|3`.

**`completeTrial` (`useGameStore.ts` ~line 1834)**
Store action: date-stamps `trialsClearedOn`, updates `bestTrialScore`, calls `applyReward` (adds CH XP + gold to character), then `checkLevelUp`.

### State management
All game state is local React `useState` inside `RoyalCourt`. Nothing is written to the Zustand store until the player clicks "Claim Reward" in `TrialModal`. If the player closes the modal before claiming, the run is discarded.

### Data flow

```
TrialsView (hub card click)
  → TrialModal (mounts, stage = 'intro')
      → "Begin Trial" → stage = 'playing'
          → RoyalCourt (mounts)
              → pickExchanges() → 4 exchanges selected
              → player makes 4 choices → favor accumulates
              → onFinish(score01)
          → TrialModal: stage = 'result'
              → scoreToStars(score), trialReward(stat, score, level) displayed
              → "Claim Reward" → completeTrial(trialId, score)
                  → applyReward → character.statXp['CH'] +=, gold +=
                  → checkLevelUp
                  → trialsClearedOn['royal_court'] = today
                  → bestTrialScore['royal_court'] = max(old, score)
```

### Save/load
Persisted via Zustand's `localStorage` middleware. `trialsClearedOn` and `bestTrialScore` are part of the standard store state. `withCharacterDefaults` backfills any missing fields when loading old saves.

### Configuration constants
- `ROYAL_COURT_EXCHANGE_COUNT = 4` (`src/content/trials.ts:174`)
- `TRIALS_UNLOCK_LEVEL = 3` (`src/engine/trials/trials.ts:101`)
- Reward formula: `statXp = (20 + 8*level) * (0.25 + 0.75*score)`, `gold = (15 + 5*level) * (0.25 + 0.75*score)` (shared across all trials)

---

## 6. Software, Libraries, and Tools Used

| Concern | Technology |
|---------|------------|
| Framework | React 18 with functional components and hooks |
| Language | TypeScript |
| Bundler | Vite |
| State management | Zustand (`persist` middleware → `localStorage`) |
| UI / styling | Tailwind CSS with custom design tokens (`bg-parchment-*`, `text-gold-*`, `text-ink-*`) |
| Rendering | Standard DOM/HTML — no canvas, no WebGL |
| Animations | CSS transitions (`transition-all duration-500` on favour bar) |
| Physics/collision | None |
| Audio | `@/lib/sfx` — `sfxResume()` called on "Begin Trial" to unlock AudioContext, but no sounds fire during the trial itself |
| Asset pipeline | Vite standard |
| Timers | Browser `setTimeout` (900 ms advancement delay) |
| Third-party libraries | None specific to this trial |

---

## 7. Assets and Presentation

**Visual style:** Parchment-and-gold medieval aesthetic, consistent with the rest of the trial suite. No bespoke art assets — the entire presentation is CSS-driven.

**Colour palette:**
- Background: `bg-parchment-*` tones (cream/tan)
- Borders/accents: `border-gold-deep/30` and `border-gold-bright`
- Favour bar fill: `bg-gold-bright/70`
- Positive choice: `border-emerald-500 bg-emerald-50 text-emerald-800`
- Negative choice: `border-rose-400 bg-rose-50 text-rose-800`
- Neutral/unselected: `border-gold-deep/40 bg-parchment-200/60`
- Dimmed (unchosen): `opacity-40`

**Glyphs and emoji:**
- Trial card / header icon: 👑
- Result screen: 👑✨ (75%+), 👑 (40%+), 🎭 (<40%)

**No character portraits, NPC art, or background images.** The NPC is identified only by a bold text label (e.g. "Lord Aldric (rival courtier)").

**Sound:** No audio fires inside the trial. Only `sfxResume()` is called to pre-warm the AudioContext.

**Music:** None specific to this trial.

**Overall mood:** Understated and readable. The parchment/gold palette fits the setting, but the absence of visual art makes each encounter feel more like a text prompt than a courtly scene.

---

## 8. Current Player Experience

**What works well:**
- The parchment visual theme is coherent and pleasant.
- The favour bar gives clear running feedback.
- Colour-coded button feedback (green / red) after a choice lands clearly.
- The 0.25 participation floor means the trial never feels punishing to attempt.
- It's the lowest-friction trial — no timing, no failure state, no stamina to manage.

**What is confusing or awkward:**
- `favorDelta` is hidden before the choice but revealed immediately after. This creates a slight whiplash: the player must roleplay "blind," then immediately sees the mechanical truth. It undercuts the social-reading challenge — a player quickly learns the labels and stops reading the text.
- The 900 ms pause between exchanges has no animation or transition to signal it. The UI just locks for a moment, which can feel like a brief lag.
- "Neutral" response feedback shows `(neutral)` as a label, which is flat and anticlimactic for a choice that intentionally had no effect.
- The ✕ close button forfeits the run silently. There is no warning that closing before "Claim Reward" discards the reward.

**What feels polished:**
- The favour bar animates smoothly.
- The intro description in `TrialModal` correctly describes the mechanic: "The favour meter rises and falls with your choices — read the room and earn the queen's respect."
- The three outcome texts (queen's backing / modest nod / dignity at least) are well-written flavour.

**What feels unfinished:**
- No NPC art, portraits, or background. The scene is entirely text.
- No sound effects at all during play.
- Only 6 exchanges exist. With 4 selected per session, repeat content appears within 2–3 days of play.
- No difficulty scaling — the content and score targets are identical at level 1 and level 20.
- All exchange maxima are exactly 3, making `maxFavor` a fixed 12 every session with no variance.

**Pacing:**
- Very fast and calm — 4 exchanges, each resolved with one click. A full run takes under 2 minutes.
- For a daily habit-tracking context, the pace is appropriate. But as a skill challenge it lacks depth.

---

## 9. Known Issues or Weak Points

1. **Biased shuffle:** `pickExchanges` uses `sort(() => Math.random() - 0.5)`, which is statistically biased. Certain exchange orderings are over-represented. Fisher-Yates would be correct. (`RoyalCourt.tsx:15`)

2. **Delta revealed immediately:** The `favorDelta` is shown inline on the chosen button right after clicking (`RoyalCourt.tsx:108-113`). This breaks the roleplay loop — the player learns the mechanical truth faster than they can build social intuition. There's no option to hide it.

3. **Tiny content pool:** 6 total exchanges → 4 per session. Combinations repeat rapidly. A dedicated player exhausts the unique exchange space within 3 daily runs.

4. **No difficulty scaling:** The trial is identical at level 1 and level 20. Nothing about the content, favored choices, or score thresholds changes with player progression.

5. **No audio:** `sfxResume()` is called but no sound effects or music are triggered during gameplay. (`TrialModal.tsx:121`, `RoyalCourt.tsx` has no sfx calls)

6. **No art:** No NPC portraits, no background scene, no animation. Compared to the action trials (RooftopChase, LongMarch), the presentation is sparse.

7. **Silent forfeit on close:** Closing the modal before "Claim Reward" discards the run with no warning.

8. **Fixed advancement delay:** The 900 ms `setTimeout` is hardcoded with no visual indicator (spinner, countdown, fade) to explain the pause. (`RoyalCourt.tsx:41-50`)

9. **All exchanges max at 3:** Because every exchange has exactly one +3 choice, `maxFavor` is always 12. This means the score calculation has no exchange-to-exchange weighting — a harder scenario isn't worth more.

10. **No per-exchange scoring recap:** The result screen only shows the final score %. There is no summary of how each exchange went, making it hard to learn from mistakes.

---

## 10. Improvement Opportunities

- **Expand the exchange pool.** Adding 8–12 more exchanges would meaningfully reduce repetition and extend the daily freshness window.
- **Difficulty tiers or level scaling.** Introduce harder exchanges that unlock at higher levels, or adjust star thresholds based on player level.
- **Hide the delta permanently** (or show it on a separate result recap). Let the player experience the full social reading loop before seeing any mechanical feedback. Move delta reveals to a post-run exchange summary.
- **Fisher-Yates shuffle.** Replace `sort(() => Math.random() - 0.5)` with a proper shuffle in `pickExchanges`.
- **Add a transition / animation** between exchanges (short fade or slide) to replace the 900 ms silent lock.
- **Sound design.** At minimum: a soft chime or fanfare on high-favour choices, a muted clunk on negative ones, and a success sting on completion.
- **NPC portraits or scene illustration.** Even simple static silhouettes would ground the court setting visually.
- **Close-modal confirmation.** A "Are you sure? You'll lose your progress" dialog before the modal dismisses.
- **Per-exchange recap on result screen.** Show a small table of "Exchange N — choice text — ±X favour" so the player can learn which responses they missed.
- **Weighted exchanges.** Give some exchanges a higher max delta (e.g. 4 or 5 for the Queen herself) so the selection composition matters more strategically.
- **Optional choice descriptions.** A small tooltip or sub-label that adds context without giving away the delta — more flavour, less pure blind guess.

---

## 11. Questions and Unknowns

1. **Is the delta-reveal intentional design?** The current behaviour reveals `favorDelta` immediately after selection (`+3 favour ✓`). Was this meant to be educational feedback, or is it a leftover from development? Hiding it post-run is a meaningful design change.

2. **Is the 900 ms delay tuned or arbitrary?** No comment in the code explains why 900 ms. Is it matching an intended animation that was never implemented?

3. **Why are all exchange maxima exactly 3?** It looks like a content-authoring convention, but it's never enforced in code. Was variable exchange weighting ever considered?

4. **Content authoring process.** `src/content/trials.ts` is designed to be hand-edited (see the file-header comment). Is there a plan for a content pipeline, or are exchanges expected to stay hand-authored indefinitely?

5. **CH stat gameplay impact.** The `CLAUDE.md` notes that `statLevels` are the combat values allocated at level-up. Does Charisma have any in-combat effect currently, or is it purely cosmetic/RPG flavour? If CH has no combat role, the daily trial incentive beyond "XP for levelling" is unclear.

6. **`settings.repeatMinigames` scope.** This flag allows replaying the trial on the same calendar day. Is it dev-only, or is it exposed to players? The current `TrialsView` gating only checks `!repeatMinigames && clearedToday`, so it works either way, but the UX implications differ.

7. **Best-score persistence.** `bestTrialScore` is used for the star display on the hub card. Is there any plan to show a score history or trend, or is only the single best score retained by design?
