# Royal Court — Minigame Analysis (Updated)

> Reflects the state of the minigame after the v1.1 patch, v1.2 polish pass, and the
> Charisma-check (v1.3) implementation. The original analysis is archived in git history.

---

## 1. Basic Summary

Royal Court is the **Charisma (CH)** Skill Trial — one of eight daily minigames in the Skills tab (`src/views/TrialsView.tsx`). The player navigates a series of social encounters at a medieval court, choosing dialogue responses to earn favour with Queen Elowen. It is a text-driven, choice-based game with no real-time input, but it now integrates a **D&D-style dice mechanic**: certain responses are Charisma gambits resolved by a d20 + CH modifier roll against a difficulty class.

It fits into the larger game as a free daily CH XP source. Like all trials it awards Charisma XP and gold scaled to the player's level and score. It can be attempted once per calendar day and unlocks at Level 3 alongside the rest of the Skills tab. The player's **CH stat level now has a direct mechanical effect** inside this trial — higher CH produces a larger d20 modifier that makes gambit responses more reliable.

---

## 2. Core Game Loop

### Start
The player taps the "Royal Court" card in the Skills tab. `TrialModal` (`src/components/trials/TrialModal.tsx`) opens at the `'intro'` stage showing the description, any previous best score and star rating, and a Charisma stat callout (e.g. "Charisma Lv.3 — adds +3 to all 🎲 Charisma gambit rolls."). Clicking "Begin Trial" calls `sfxResume()` (unlocking the AudioContext) and advances to `'playing'`.

On mount, `pickExchanges` (`RoyalCourt.tsx:50–57`) shuffles the pool of 14 exchanges via Fisher-Yates and slices the first 4:

```typescript
function pickExchanges(exchanges: CourtExchange[]): CourtExchange[] {
  const arr = [...exchanges];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, ROYAL_COURT_EXCHANGE_COUNT); // 4
}
```

### Each Exchange — Safe Path
1. The NPC's name (with emoji icon), and their dialogue line appear in a parchment-styled box.
2. Three or four response buttons appear. `favorDelta` values are invisible.
3. The player clicks a safe response. The chosen button highlights immediately (emerald, rose, or gold depending on outcome); other buttons dim to 40% opacity.
4. The appropriate sfx fires (`courtFavor` for positive, `courtDisfavor` for negative).
5. After `ADVANCE_DELAY_MS` (700 ms), a 180 ms CSS opacity fade-out (`TRANSITION_MS`) plays, the next exchange swaps in, and the UI fades back in.

### Each Exchange — Gambit Path
Gambit choices are rendered with an amber border and a `🎲 DC N` badge. When the player picks one:
1. `sfx.play('courtRoll')` fires (die-clatter noise burst).
2. A result-line area below the choices enters "rolling" state, cycling random numbers (1–20) every 60 ms for `ROLL_ANIM_MS` (650 ms) to simulate a tumbling die.
3. `rollD20()` generates the actual roll; `resolveCourtCheck(roll, chLevel, dc)` applies the natural-20 / natural-1 / threshold rules.
4. The face settles on the true result, the result line renders (e.g. `🎲 12 + 3 = 15 vs DC 13 — ✓ Success!`), and the appropriate sfx fires.
5. Favour changes by `choice.favorDelta` on success or `choice.check.failDelta` on failure.
6. After `ADVANCE_DELAY_MS` the fade transition plays and the next exchange begins.

### End
After the 4th exchange, `onFinish(score01, choiceHistory)` is called with:
- `score01 = Math.min(1, Math.max(0, newFavor / maxFavor))`
- `choiceHistory` — an array of `CourtChoiceRecord` objects, one per exchange, each recording the NPC name, chosen response text, actual delta applied, and (for gambits) the full dice result.

`TrialModal` calls `completeTrial(trialId, score01)` **immediately in `handleFinish`** (before the player does anything on the result screen), then transitions to `'result'`. The result screen shows stars, score %, the reward breakdown, and a per-exchange "Exchange Recap" card. The player clicks "Continue" then "Return to Trials."

### Challenge
The core challenge is inferring the correct social response purely from text — `favorDelta` is hidden during play and only revealed in the post-run recap. Gambit responses add a second layer: the player weighs the higher success payoff against the risk of a failed roll, and their CH investment determines how often they can rely on gambits.

### Outcomes
- Score 0–1 produces CH XP and gold via `trialReward`.
- `trialsClearedOn['royal_court']` is stamped with today's ISO date.
- `bestTrialScore['royal_court']` is updated to the max of old best and current score.

---

## 3. Player Controls and Interaction

**Input:** Mouse / tap only — click one of the response buttons per exchange. No keyboard navigation, no timing input.

**UI elements during play:**

| Element | Description |
|---------|-------------|
| Court Favour bar | Progress bar showing `Math.round(favorPct)%`. Animates with `transition-all duration-500`. Colour shifts: rose (< 40%) → amber (≥ 40%) → emerald (≥ 75%). |
| Modifier badge | Displayed in the favour bar header when `modifier !== 0`: `🎲 +N` in amber. |
| Exchange counter | "Exchange N of 4" above the NPC box. |
| NPC dialogue box | Parchment card with emoji icon + NPC name in bold, dialogue in italics. |
| Safe choice buttons | Parchment border / gold hover; no badge. |
| Gambit choice buttons | Amber border, `🎲 DC N` badge at right edge. |
| Die-roll result line | Appears below the choices for gambit exchanges. Shows cycling face while rolling, then the full roll math and outcome. |
| End card | Emoji glyph (👑✨ / 👑 / 🎭) + narrative outcome text + final favour %. |

**Modal chrome (TrialModal):**
- Header: trial glyph + name + "Charisma Trial" label.
- Close button (✕): triggers an inline "Abandon run? Yes / No" confirmation while `stage === 'playing'`; closes immediately otherwise.
- Intro screen: description text, Charisma stat callout, divider, previous best score (stars + %) if any, "Begin Trial" button.
- Result screen: star rating, score %, reward breakdown (CH XP + gold), optional Exchange Recap, "Continue" → "Return to Trials" buttons.

**Feedback:**
- Sound: `courtFavor` (positive), `courtDisfavor` (negative), `courtComplete` (session end), `courtRoll` (gambit initiated). All four fire inside `RoyalCourt.tsx`; the AudioContext is unlocked by `sfxResume()` on "Begin Trial".
- Visual: button colour change, die-roll animation, favour bar colour shift, result line.
- No delta label is shown on buttons during play. Deltas appear only in the Exchange Recap on the result screen.

---

## 4. Mechanics and Systems

### Exchanges and Favour
The pool contains **14 exchanges** in `src/content/trials.ts` (`ROYAL_COURT_EXCHANGES`). Four are selected per session by `pickExchanges`. Each exchange has 4 response choices with hidden `favorDelta` values.

The running favour score is floored at 0:
```typescript
const newFavor = Math.max(0, favor + delta);
```

### Gambit Choices
**7 of the 14 exchanges** include one gambit response. Gambits carry an optional `check` field:
```typescript
check?: {
  dc: number;        // difficulty class from COURT_DC
  failDelta: number; // favour applied on a failed roll (0 or negative)
}
```
`favorDelta` on a gambit choice is the **success** payoff; `check.failDelta` is the fail penalty.

With 7 gambits in 14 exchanges and 4 selected per session, a run statistically surfaces **~2 gambit choices** on average, though variance is high.

**Gambit roster** (success payoff / fail penalty / DC):

| Exchange | Gambit choice | DC | Success | Fail |
|---|---|---|---|---|
| Court Herald | "I was told to show up." | medium (13) | +4 | −3 |
| Lord Aldric | "I don't answer to you." | hard (16) | +4 | −3 |
| Court Jester | "My arrival alone should suffice as entertainment." | medium (13) | +4 | −2 |
| Ambassador Kessir | Accept the cup without hesitation | easy (10) | +4 | −2 |
| Lady Voss | "That sounds very much like an offer." | medium (13) | +3 | −2 |
| Captain Rhovas | "Question the accuser's motivations." | medium (13) | +4 | −2 |
| Royal Physician | "I was not informed my schedule required accounting." | hard (16) | +3 | −3 |

### Charisma Check Resolution (`src/engine/trials/royalCourt.ts`)

```typescript
// COURT_DC constants
easy: 10,  medium: 13,  hard: 16

// Modifier (1:1 with CH stat level)
courtCheckModifier(chLevel: number): number → chLevel

// Resolution — full D&D swing
resolveCourtCheck(roll, chLevel, dc):
  natural 20 → always SUCCESS  (natural: 'crit')
  natural  1 → always FAIL     (natural: 'fumble')
  otherwise  → success = (roll + modifier) >= dc
```

This is a pure engine module with no React or store imports, following the same pattern as `src/engine/trials/longMarch.ts`.

### maxFavor and Scoring
`maxFavor` is computed dynamically each session:
```typescript
const maxFavor = exchanges.reduce(
  (sum, e) => sum + Math.max(...e.choices.map(c => c.favorDelta)), 0
);
```
Because gambit choices carry the **success** delta in `favorDelta`, the formula holds: a perfect run (all best choices, all gambits passed) equals `maxFavor`. Since multiple exchanges have a best choice of +4 (including every gambit), `maxFavor` now varies by session (typically 14–16 for 4 exchanges, depending on which appear).

**Score:**
```
score01 = Math.min(1, Math.max(0, newFavor / maxFavor))
```

### Star Rating (`scoreToStars` in `src/engine/trials/trials.ts`)
| Stars | Threshold |
|-------|-----------|
| ★★★   | score ≥ 0.75 |
| ★★    | score ≥ 0.40 |
| ★     | score < 0.40 |

Star thresholds are still fixed (not level-scaled).

### Reward Scaling (`trialReward` in `src/engine/trials/trials.ts`)
```
multiplier = 0.25 + 0.75 × score01
CH XP      = round((20 + 8 × level) × multiplier)
Gold       = round((15 + 5 × level) × multiplier)
```

The 0.25 participation floor is unchanged. A CH 0 player who fails every gambit still earns ~25% of the full reward.

### Daily Gate
Unchanged: `trialsClearedOn: Record<TrialId, string>` (ISO date string). `completeTrial` is now called immediately when `onFinish` fires (not deferred to "Claim Reward"). This means the daily gate closes and the reward is applied as soon as the last exchange resolves — the result screen is purely informational.

### Win / Loss
Still no fail state. The trial always completes after 4 exchanges. Poor gambit rolls hurt the score but cannot end the session early.

---

## 5. Technical Implementation

### Main files

| File | Role |
|------|------|
| `src/components/trials/games/RoyalCourt.tsx` | The playable component (~322 lines) |
| `src/engine/trials/royalCourt.ts` | Pure check-resolution engine: `COURT_DC`, `courtCheckModifier`, `resolveCourtCheck`, `rollD20` |
| `src/engine/__tests__/royalCourt.test.ts` | 11 unit tests for the check engine |
| `src/content/trials.ts` | Exchange data (`ROYAL_COURT_EXCHANGES`, `ROYAL_COURT_EXCHANGE_COUNT`, `CourtExchange` interface) |
| `src/engine/trials/trials.ts` | Trial registry, `trialReward`, `scoreToStars`, `getTrial`, `TRIALS_UNLOCK_LEVEL` |
| `src/components/trials/TrialModal.tsx` | Modal shell — intro / playing / result stages (~314 lines) |
| `src/views/TrialsView.tsx` | Hub card grid, daily-gate check, opens the modal |
| `src/store/useGameStore.ts` | `completeTrial` action: date-stamp, best-score update, `applyReward`, `checkLevelUp` |
| `src/lib/sfx.ts` | `courtFavor`, `courtDisfavor`, `courtComplete`, `courtRoll` SFX cues |

### Key functions

**`RoyalCourt` (component, `RoyalCourt.tsx:62`)**
Top-level component. Props: `{ onFinish, chLevel }`. Holds all local state. Computes `modifier = courtCheckModifier(chLevel)` on each render.

**`pickExchanges` (`RoyalCourt.tsx:50`)**
Fisher-Yates shuffle; slices first 4. Memoized with `useMemo` so it runs once per mount.

**`choose` (`RoyalCourt.tsx:79`)**
Branches on `choice.check`:
- **Safe path:** applies `favorDelta`, plays sfx, schedules `ADVANCE_DELAY_MS` timer, then runs the fade-transition or calls `onFinish`.
- **Gambit path:** plays `courtRoll`, starts a `setInterval` cycling `rollDisplay` every 60 ms, clears after `ROLL_ANIM_MS`, calls `resolveCourtCheck`, applies success/fail delta, plays sfx, then schedules `ADVANCE_DELAY_MS` + fade or `onFinish`.

**`resolveCourtCheck` (`src/engine/trials/royalCourt.ts:47`)**
Pure resolver. Accepts `(roll, chLevel, dc)`, returns `CourtCheckResult { roll, modifier, total, success, natural }`.

**`rollD20` (`src/engine/trials/royalCourt.ts:74`)**
`Math.floor(Math.random() * 20) + 1`. Isolated for testability — tests pass explicit roll values to `resolveCourtCheck` directly.

**`trialReward` (`trials.ts:124`)**
Unchanged. Pure function: `(stat, score01, level) → { gold, statXp }`.

**`completeTrial` (`useGameStore.ts`)**
Called from `handleFinish` in `TrialModal` at the moment the last exchange resolves. No longer tied to the "Claim Reward" button.

### Key types

**`CourtExchange` (`src/content/trials.ts:31`)**
```typescript
interface CourtExchange {
  npc: string;
  icon?: string;           // emoji shown beside NPC name
  dialogue: string;
  choices: {
    label: string;
    favorDelta: number;    // safe: direct delta. gambit: success payoff.
    check?: {
      dc: number;
      failDelta: number;
    };
  }[];
}
```

**`CourtChoiceRecord` (`RoyalCourt.tsx:19`)**
```typescript
interface CourtChoiceRecord {
  npc: string;
  label: string;
  favorDelta: number;      // actual delta applied (success or fail)
  check?: {               // present only for gambit choices
    dc: number;
    roll: number;
    modifier: number;
    total: number;
    success: boolean;
    natural: 'crit' | 'fumble' | null;
  };
}
```

### State management
All game state is local React `useState` inside `RoyalCourt`. Key state: `exchangeIndex`, `favor`, `selected`, `done`, `transitioning`, `choiceHistory`, `rolling`, `rollDisplay`, `checkResult`. The `rollIntervalRef` (`useRef`) holds the interval ID so the die animation can be cancelled on resolution. `completeTrial` is called from `TrialModal.handleFinish` immediately when `onFinish` fires.

### Data flow

```
TrialsView (hub card click)
  → TrialModal (mounts, stage = 'intro')
      → "Begin Trial" → sfxResume() → stage = 'playing'
          → RoyalCourt(chLevel) mounts
              → pickExchanges() → 4 of 14 exchanges (Fisher-Yates)
              → player makes 4 choices (safe or gambit)
                  → gambit: courtRoll sfx → die animation → resolveCourtCheck
                  → safe: direct delta apply → favour/disfavour sfx
              → onFinish(score01, choiceHistory)
          → TrialModal.handleFinish:
              → completeTrial(trialId, score01)
                  → applyReward → character.statXp['CH'] +=, gold +=
                  → checkLevelUp
                  → trialsClearedOn['royal_court'] = today
                  → bestTrialScore['royal_court'] = max(old, score)
              → stage = 'result'
                  → stars, reward breakdown, Exchange Recap displayed
                  → "Continue" → "Return to Trials" → onClose
```

### Timing constants (`RoyalCourt.tsx:13–15`)
| Constant | Value | Purpose |
|----------|-------|---------|
| `ADVANCE_DELAY_MS` | 700 ms | Pause between choice lock and scene transition |
| `TRANSITION_MS` | 180 ms | CSS opacity fade-out / fade-in between exchanges |
| `ROLL_ANIM_MS` | 650 ms | Die-face cycling animation duration |

Total time from clicking a gambit to seeing the next exchange: 650 + 700 + 180 = ~1.53 s.

### Configuration constants
- `ROYAL_COURT_EXCHANGE_COUNT = 4` (`src/content/trials.ts`)
- `COURT_DC = { easy: 10, medium: 13, hard: 16 }` (`src/engine/trials/royalCourt.ts`)
- `TRIALS_UNLOCK_LEVEL = 3` (`src/engine/trials/trials.ts`)

### Tests
`src/engine/__tests__/royalCourt.test.ts` — 11 tests covering: natural-20 crit, natural-1 fumble, threshold boundary (total === dc passes; total === dc-1 fails), modifier applied, modifier monotonically non-decreasing, `COURT_DC` ordering. The check resolver is fully deterministic given a fixed roll value, so tests do not touch `rollD20`.

---

## 6. Software, Libraries, and Tools Used

| Concern | Technology |
|---------|------------|
| Framework | React 18 with functional components and hooks (`useState`, `useMemo`, `useRef`, `useCallback`) |
| Language | TypeScript |
| Bundler | Vite |
| State management | Zustand (`persist` middleware → `localStorage`) |
| UI / styling | Tailwind CSS with custom tokens (`bg-parchment-*`, `text-gold-*`, `text-ink-*`, `text-amber-*`, `text-emerald-*`, `text-rose-*`) |
| Rendering | Standard DOM/HTML — no canvas, no WebGL |
| Animations | CSS transitions: `transition-all duration-500` (favour bar), inline `opacity` transition (exchange fade), `setInterval` loop (die animation) |
| Audio | `src/lib/sfx.ts` — four Royal Court cues using Web Audio API oscillators and filtered noise |
| Timers | `setTimeout` (advancement delays) + `setInterval` (die-face animation, cleared on resolve) |
| RNG | `Math.random()` — `rollD20` isolated in the engine module; `pickExchanges` Fisher-Yates in component |
| Third-party libraries | None specific to this trial |

---

## 7. Assets and Presentation

**Visual style:** Parchment-and-gold medieval aesthetic, consistent with the rest of the trial suite. No bespoke art assets — presentation is entirely CSS and emoji-driven.

**Colour palette:**
- Parchment background: `bg-parchment-*` tones
- NPC box: `border-gold-deep/30 bg-parchment-100/70`
- Safe choice (idle): `border-gold-deep/40 bg-parchment-100/70` | hover: `border-gold-bright bg-gold-bright/10`
- Gambit choice (idle): `border-amber-500/50 bg-amber-50/40` | hover: `border-amber-500 bg-amber-50/70`
- Selected positive: `border-emerald-500 bg-emerald-50 text-emerald-800`
- Selected negative: `border-rose-400 bg-rose-50 text-rose-800`
- Dimmed (unchosen): `opacity-40`
- Favour bar: `bg-rose-400/60` (< 40%) → `bg-amber-400/70` (≥ 40%) → `bg-emerald-500/70` (≥ 75%)
- Die result line: amber while rolling, emerald on success, rose on fail

**NPC icons:**
All 14 exchanges have an emoji icon beside the NPC name: 📯 ⚔️ 📜 👑 🎭 💰 💌 📖 🌍 🍽️ 🕯️ 🛡️ 🪶 ⚕️

**Glyph and result emojis:**
- Trial card / header: 👑
- Result screen: 👑✨ (75%+), 👑 (40%+), 🎭 (< 40%)

**Sound (all Web Audio API, zero asset files):**
| Cue | Description | Trigger |
|-----|-------------|---------|
| `courtFavor` | Ascending sine chime (C5→G5, C6→G6) | Positive delta applied |
| `courtDisfavor` | Descending triangle + lowpass noise | Negative delta applied |
| `courtComplete` | Regal 4-note arpeggio + sustained fade | Session end, before `onFinish` |
| `courtRoll` | Three filtered noise bursts (die clatter) | Gambit choice selected |

---

## 8. Current Player Experience

**What works well:**
- The parchment / gold / amber / emerald palette is coherent. The amber gambit buttons visually distinguish "risk" from "safe" without showing the outcome.
- The favour bar gives clear running feedback; its colour tells the player their star tier without calculation.
- The dice animation (cycling face → final number) is immediate and legible. The result line `🎲 12 + 3 = 15 vs DC 13 — ✓ Success!` gives the player full transparency without breaking pacing.
- Deltas hidden during play and revealed only in the Exchange Recap preserves the roleplay loop.
- SFX land cleanly against the Web Audio silence: the chime / clatter / arpeggio trio is already a readable vocabulary.
- The "Abandon run?" inline confirmation prevents accidental forfeit.
- The best-score display on the intro screen gives a personal target before each attempt.
- With 14 exchanges drawn to 4, the combination space is ≈1,001 — enough variety to sustain months of daily play before obvious repetition.

**What is still rough or incomplete:**
- Gambit buttons show `🎲 DC N` but give no preview of what "bold" means narratively. A first-time player may not connect "DC 13" to their CH stat without reading the intro callout carefully.
- The first 650 ms of a gambit (die animation) shows a cycling number in the result-line area, but the chosen button's feedback colour (emerald / rose) doesn't appear until after the roll resolves. There is a brief period where the button is selected but has no colour — this could read as a bug.
- No character art, portraits, or background images. The court is still entirely text + emoji; visually sparse compared to the action trials.
- Star thresholds are fixed and do not scale with player level. A CH-invested level-15 character can still 3★ with the same 75% threshold as a level-3 character.
- Session length is fixed at 4 exchanges regardless of character level. A longer session (5–6 at high level) would add natural difficulty scaling.
- CH stat level has no effect on the broader game beyond gambit rolls in this trial. Its only loop is: do Royal Court → earn CH XP → raise CH level → pass more gambits in Royal Court.

**Pacing:**
- A safe-choice run: ~1.5–2 minutes. A gambit-heavy run: 2–3 minutes. The pacing is calm and suits the daily habit-tracking context. The dice animation adds a welcome moment of suspense without bloat.

---

## 9. Known Issues and Remaining Weak Points

1. **Button colour delay on gambit selection.** When the player clicks a gambit choice, `setSelected(choiceIdx)` is called immediately, but because the colour logic reads from `checkResult` (not yet populated), the button has no green/red highlight during the 650 ms animation. The result-line area does show rolling state, but the button feedback is absent until the roll resolves. This can read as a momentary bug. (`RoyalCourt.tsx:186–204`)

2. **No difficulty scaling by level.** Star thresholds (`scoreToStars`), session length (`ROYAL_COURT_EXCHANGE_COUNT`), and which exchanges appear are all level-invariant. A veteran player has no higher ceiling to reach. (`src/engine/trials/trials.ts:106`)

3. **No art.** No NPC portraits, silhouettes, or background scene. The emoji icons are lightweight anchors but give no spatial or visual identity to the court. Planned as a post-depth item in the improvement plan.

4. **CH stat has no broader game effect.** CH level currently influences only this trial's gambit rolls. It has no observable effect elsewhere in the game. The consequence: players who don't do Royal Court have little incentive to invest in CH, and the trial's reward loop is circular.

5. **Gambit DC callout could be stronger.** The `🎲 DC N` badge tells the player the target, but no UI element directly shows the player's modifier on the button (only in the favour bar header). A player who hasn't noticed the `+N` in the header doesn't know how their CH level affects the roll odds for a specific check.

6. **Content pool still hand-authored.** 14 exchanges is enough for now, but there is no tooling or schema validation for the authoring process. A misspelled key or a missing positive-delta choice would surface only at runtime via the dev assertion in `RoyalCourt.tsx:64`.

---

## 10. Remaining Improvement Opportunities

Items from the original improvement plan that were **not implemented** — roughly in their original priority order.

### Deferred — requires design decisions

**§2.3 — Tighten star thresholds at higher levels**
Pass `level` into `scoreToStars` as an optional param; raise the 3★ threshold (e.g. 85% at level 10+). Files: `src/engine/trials/trials.ts:106` (signature change), `src/components/trials/TrialModal.tsx` (pass level through). Requires deciding the threshold curve.

**§2.4 — Extend session length at high level**
Make `ROYAL_COURT_EXCHANGE_COUNT` dynamic based on character level (e.g. 5 exchanges at level 8+). Files: `src/content/trials.ts` (expose helper), `src/components/trials/games/RoyalCourt.tsx` (accept count prop). Requires deciding the unlock levels.

**§6.1 — Clarify or establish CH stat's in-game effect**
CH stat level currently only affects gambit rolls in this trial. Giving CH a passive combat or economy bonus (e.g. gold drop multiplier, merchant discount) would complete the loop: Royal Court → CH XP → CH level → passive benefit. Files: depends on scope — `src/engine/stats.ts`, `src/store/useGameStore.ts`.

**§6.2 — CH-level-gated choice unlocks**
Add a `requiresChLevel?: number` field to individual choice objects. High-CH players see an additional "silver-tongued" option not available at level 1. Files: `src/content/trials.ts` (add field), `src/components/trials/games/RoyalCourt.tsx` (filter choices before render), `src/components/trials/TrialModal.tsx` (pass `chLevel` already done). Requires writing the new high-CH choices for each affected exchange.

### Polish — smaller scope

**NPC silhouettes / portraits (§4.2 follow-up)**
Emoji icons (done) are a lightweight placeholder. Actual SVG silhouettes or small sprites per NPC archetype would give each encounter a visual identity. This is the largest remaining aesthetic gap.

**Button colour during gambit roll**
Fix the brief window where the selected gambit button has no colour feedback during the dice animation (see §9 item 1). One approach: show a distinct "rolling" state colour (amber) on the button itself as soon as it is selected, before the check resolves.

---

## 11. Questions and Unknowns — Status

| Question (original) | Status |
|---|---|
| Is the delta-reveal intentional? | **Resolved.** Deltas are now hidden during play; the Exchange Recap on the result screen is the intended learning feedback. |
| Is the 900 ms delay tuned or arbitrary? | **Resolved.** The delay is now `ADVANCE_DELAY_MS = 700 ms` (named constant). The roll animation (`ROLL_ANIM_MS = 650 ms`) and exchange fade (`TRANSITION_MS = 180 ms`) fill the perceived pause intentionally. |
| Why are all exchange maxima exactly 3? | **Resolved.** Variable maxima are now in use: gambit success payoffs reach +4, making gambit exchanges the high-value encounters and `maxFavor` variable per session. |
| Content authoring process — pipeline or hand-authored? | **Open.** Still hand-authored. The file-header comment in `src/content/trials.ts` now documents the gambit authoring contract (DC constants, `failDelta` semantics), but there is no schema validation beyond the dev-mode assertion. |
| CH stat gameplay impact? | **Partially resolved.** CH stat now adds a direct modifier to gambit rolls in this trial (`courtCheckModifier` in `src/engine/trials/royalCourt.ts`). CH's effect on the rest of the game (combat, economy) remains undefined — see §10. |
| `settings.repeatMinigames` scope — dev-only or player-facing? | **Open.** Still a dev toggle checked in `TrialsView.tsx:63`. |
| Best-score persistence — single score or history? | **Open.** Only the single best score is retained by design; `bestTrialScore: Record<TrialId, number>` in the store. |
