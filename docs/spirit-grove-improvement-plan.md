# Spirit Grove — Improvement Plan

Based on `docs/spirit-grove-minigame-analysis.md`.

---

## 1. Highest-Priority Improvements

These are bugs or design flaws that undermine the minigame's core loop today.

---

### 1.1 Fix the broken star system

**What:** The 2-star tier is mathematically unreachable. At 3 rounds, scores are 0.0 / 0.33 / 0.67 / 1.0. The `scoreToStars` thresholds are `>= 0.75` → 3 stars and `>= 0.40` → 2 stars, so 2/3 (0.67) always gives 3 stars and 1/3 (0.33) always gives 1 star. The 2-star outcome cannot happen.

**Why it matters:** The star UI shows three stars but only two are ever lit in distinct ways. Players who notice will distrust the rating system.

**Fix option A — Adjust round count to 5.**
`SPIRIT_GROVE_ROUND_COUNT = 5` gives scores 0, 0.2, 0.4, 0.6, 0.8, 1.0. With existing thresholds: ≥ 0.75 → 3 stars, ≥ 0.40 → 2 stars, else 1 star. All three tiers are now reachable (3/5 = 0.6 → 2 stars; 4/5 = 0.8 → 3 stars). The pool of 6 rounds is large enough for 5 to be drawn.

**Fix option B — Adjust the threshold for Spirit Grove.**
Lower the 2-star threshold to `>= 0.55` so that 2/3 (0.67) stays at 3 stars but 1/3 (0.33) becomes a clear 1-star. This doesn't fully fix the problem since the tier is still vacuous, but it costs nothing.

**Recommendation:** Option A. 5 rounds also increases content variety per session and makes the reward feel more proportional to effort.

**Files:** `src/content/trials.ts` (`SPIRIT_GROVE_ROUND_COUNT`), `src/engine/trials/trials.ts` (`scoreToStars` — shared, verify other trials don't regress).

---

### 1.2 Expand the round pool

**What:** There are only 6 rounds in `SPIRIT_GROVE_ROUNDS`. A player who plays daily memorizes every answer within one to two weeks, eliminating any challenge or decision-making.

**Why it matters:** Once memorized, the trial is a 10-second formality. The daily ritual loses all meaning. This is the single most impactful content gap in the minigame.

**Fix:** Add rounds to the pool — aim for at least 15, ideally 20. Each round needs an `omen`, 4 `choices` (with `clue`), and a `correctIndex`. Keep the same interface; this is purely a content edit with no code changes.

Write new rounds that vary the symbolic register: some should use fauna (animals), some flora (plants), some weather, some celestial signs. Aim for a range of difficulty — some omens should be nearly self-evident, others genuinely ambiguous between two choices.

**Files:** `src/content/trials.ts` (`SPIRIT_GROVE_ROUNDS` array).

---

### 1.3 Fix the `setTimeout` memory leak

**What:** `choose()` calls `setTimeout` but the component never cancels it. If the player closes the modal mid-round (the TrialModal has an `✕` close button), the timeout fires on an unmounted component.

**Why it matters:** In React 18 strict mode this produces a warning and represents a class of stale-closure bug. It is low risk today but will produce subtle state corruption if the cleanup path ever changes.

**Fix:** Move the timer into a `useRef` + `useEffect` pair that clears the timeout on unmount.

```typescript
const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// In choose():
timerRef.current = setTimeout(() => { ... }, ROUND_TRANSITION_MS);

// Cleanup:
useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
```

Also extract the magic number to a named constant: `const ROUND_TRANSITION_MS = 900;`

**Files:** `src/components/trials/games/SpiritGrove.tsx`.

---

## 2. Gameplay and Mechanics Improvements

---

### 2.1 Shuffle choice order on display

**What:** The `choices[]` array is always presented in the same fixed order as it appears in the content file. A player who has seen a round before knows both the correct answer and its button position without reading anything.

**Fix:** When rendering choices, shuffle their display order per round presentation. Store the shuffled order in a ref or state alongside the round data. Map the player's `choiceIdx` click back through the shuffle to compare against `round.correctIndex`.

The cleanest approach is to enrich the output of `pickRounds` to include a `displayOrder: number[]` for each round (a shuffled index array), then use that for rendering and for mapping selection back to the canonical index.

**Files:** `src/components/trials/games/SpiritGrove.tsx` (`pickRounds` function and render logic).

---

### 2.2 Show a brief explanation after each round

**What:** When the correct answer is revealed, the player sees which choice is right but not why. This makes some rounds feel arbitrary, especially for new players.

**Fix:** Add an optional `explanation` field to `SpiritGroveRound` (make it optional so existing rounds don't break). When the round transitions, briefly show the explanation text below the choice buttons during the 900 ms (or extended to ~1200 ms) feedback pause.

```typescript
export interface SpiritGroveRound {
  omen: string;
  choices: { label: string; clue?: string }[];
  correctIndex: number;
  explanation?: string; // e.g. "Weeping sap and a split trunk are signs of damage, not growth."
}
```

This turns a correct answer into a moment of learning and a wrong answer into a moment of understanding rather than just failure. It also deepens the "Wisdom" framing of the trial.

**Files:** `src/content/trials.ts` (interface + round data), `src/components/trials/games/SpiritGrove.tsx` (render the explanation during the feedback pause).

---

### 2.3 Introduce difficulty variation across rounds

**What:** All rounds are equally easy; there is no escalation within a session.

**Fix:** Tag each round with a `difficulty: 'easy' | 'medium' | 'hard'` field in the content data. When selecting rounds, guarantee the draw includes at least one of each tier (or weight toward harder rounds if the player's best score is already 100%). Hard rounds should be genuinely ambiguous — two choices whose clues both plausibly fit the omen, requiring closer reading of the omen's specific phrasing.

This does not need to affect scoring or rewards — the same formula applies — but it makes the session feel like it has a shape (easier start, harder finish) and gives skilled players something to work toward.

**Files:** `src/content/trials.ts` (add `difficulty` field, write harder rounds), `src/components/trials/games/SpiritGrove.tsx` (`pickRounds` — add tier-aware selection logic).

---

## 3. Controls, UI, and Player Feedback Improvements

---

### 3.1 Add keyboard navigation

**What:** The four choice buttons have no keyboard support. Players using a keyboard must click with the mouse.

**Fix:** Assign keyboard shortcuts to each button — `1`, `2`, `3`, `4` or `A`, `B`, `C`, `D`. Show the key label as a small badge on each button. Add a `keydown` handler via `useEffect` that calls `choose(idx)` for the matching key. Disable the handler once `selected !== null`.

This is a low-effort accessibility improvement that also makes the trial feel faster and more game-like for desktop players.

**Files:** `src/components/trials/games/SpiritGrove.tsx`.

---

### 3.2 Add `aria` labels to choice buttons

**What:** Choice buttons have no accessible labels beyond their visible text. Screen readers cannot distinguish them from generic buttons.

**Fix:** Add `aria-label` to each button combining the choice label and clue (e.g., `"Blessing of Mending — Seals wounds and cracks"`). Add `aria-pressed` to indicate the selected state. Mark disabled buttons with `aria-disabled`.

**Files:** `src/components/trials/games/SpiritGrove.tsx`.

---

### 3.3 Reduce transition delay for repeat players (or make it skippable)

**What:** The 900 ms feedback pause exists to let players absorb the result. For players who have memorized answers, this pause is just dead time on every click.

**Fix (option A):** Reduce to 600 ms. This is still enough to register the green/red feedback visually but cuts per-session waiting time noticeably.

**Fix (option B):** Allow a click anywhere during the feedback pause to skip ahead immediately (cancel the timeout and advance). Most games with a "wait for feedback" mechanic allow clicking through it.

Both options are small changes; option B is more respectful of the player's time.

**Files:** `src/components/trials/games/SpiritGrove.tsx` (the `setTimeout` duration and, for option B, a click handler on the container).

---

### 3.4 Show correct-answer context in the result view

**What:** The final result screen shows only an emoji, a narrative line, and a correct-count. It does not recap which rounds the player got wrong or why.

**Fix:** In the `done` state, iterate over `roundsCompleted` and show a compact summary: for each round, display the omen (truncated if long), the player's choice, and the correct choice. This gives players meaningful closure and is especially useful for the new `explanation` field (see 2.2).

**Files:** `src/components/trials/games/SpiritGrove.tsx` (result view rendering).

---

## 4. Visual and Audio Polish

---

### 4.1 Add ambient audio

**What:** Spirit Grove plays no sound at all. Other trials use audio. The silence feels like a missing asset rather than a design choice.

**Fix:** Add a soft forest ambient loop that starts when the `playing` stage begins and fades out on result. Optionally add a subtle chime or nature sound on correct selection and a muted low tone on wrong selection. These do not need to be dramatic — the contemplative tone of the trial should be preserved.

Check how other trials implement audio via `src/lib/sfx.ts` and follow the same pattern.

**Files:** `src/lib/sfx.ts` (add sound definitions if needed), `src/components/trials/games/SpiritGrove.tsx` (trigger sounds on `choose()` and on mount/unmount for ambient).

---

### 4.2 Animate the correct-answer reveal

**What:** The color transition on the correct button is a bare CSS `transition-colors`. There is no motion or visual punctuation to make the reveal feel satisfying.

**Fix:** Add a brief CSS scale pulse (`scale-105` → `scale-100`) on the correct button when it highlights, and optionally a gentle shake on the wrong button. These are achievable with a Tailwind `animate-` class or a short inline style transition. Keep it subtle — this is a calm trial, not an action game.

**Files:** `src/components/trials/games/SpiritGrove.tsx` (button className logic).

---

### 4.3 Animate the progress tracker

**What:** The `○ ✓ ✗` string in the header updates instantly. A small animation here would make the round completion feel more like a beat.

**Fix:** Track each symbol in an array and apply a brief CSS scale-in animation to the newly revealed symbol. A `transition-transform` with a very short duration (150 ms) is enough.

**Files:** `src/components/trials/games/SpiritGrove.tsx` (replace the join-string with a mapped element array, add transition class).

---

## 5. Technical / Code Improvements

---

### 5.1 Extract the magic `900` to a named constant

**What:** `900` appears inline in `SpiritGrove.tsx`. This is opaque and would require a comment to explain what it represents.

**Fix:** `const ROUND_TRANSITION_MS = 900;` at the top of the file (or exported from a shared trials constants file if other trials need similar values).

**Files:** `src/components/trials/games/SpiritGrove.tsx`.

---

### 5.2 Replace the biased shuffle with Fisher-Yates

**What:** `pickRounds` uses `[...rounds].sort(() => Math.random() - 0.5)`. This is a known non-uniform shuffle — not all permutations are equally probable in V8's sort. For a 6-element array this is functionally fine, but it is technically incorrect and should not be used as a template for future code.

**Fix:**

```typescript
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

If a shared utility for this already exists in `src/lib/`, use it. If not, add it there so other minigames can reuse it.

**Files:** `src/components/trials/games/SpiritGrove.tsx` (or `src/lib/` for a shared util).

---

### 5.3 Add a content validation guard

**What:** `round.correctIndex` is not validated against `choices.length`. A malformed round (e.g., `correctIndex: 4` in a 4-element array) would silently score as 0 with no error.

**Fix:** Add an assertion in development mode (or a thrown error in `pickRounds`) that verifies `correctIndex < choices.length` for every round. Since this is pure content data it is easy to get wrong.

```typescript
if (import.meta.env.DEV) {
  for (const r of SPIRIT_GROVE_ROUNDS) {
    if (r.correctIndex >= r.choices.length) {
      throw new Error(`Spirit Grove: correctIndex ${r.correctIndex} out of range in round "${r.omen.slice(0, 30)}…"`);
    }
  }
}
```

**Files:** `src/content/trials.ts` or `src/components/trials/games/SpiritGrove.tsx` (dev-only startup check).

---

### 5.4 Add unit tests for the round-picking logic and scoring

**What:** There are no tests for Spirit Grove's game logic. The `pickRounds` function, score calculation, and the relationship between `SPIRIT_GROVE_ROUND_COUNT` and the pool size have no coverage.

**Fix:** Add a test file at `src/engine/__tests__/trials.test.ts` (or extend an existing one) covering:
- `pickRounds` always returns exactly `SPIRIT_GROVE_ROUND_COUNT` rounds
- `pickRounds` does not return duplicates
- `scoreToStars` maps boundary values correctly (especially the 3-round edge cases)
- `trialReward` returns values within expected ranges at level 1 and level 10

**Files:** `src/engine/__tests__/trials.test.ts` (new file).

---

## 6. Integration with the Larger Game

---

### 6.1 Surface the best-score record on the hub card

**What:** `bestTrialScore['spirit_grove']` is stored in the Zustand store but is not visibly surfaced anywhere. Players cannot see their personal record without completing the trial and checking the result screen.

**Fix:** Display the best score (as a star count or percentage) on the Spirit Grove hub card in the Skills tab. Check how other trial cards display this data and follow the same pattern for consistency. A small `★ 3` or `Best: 100%` line below the blurb is sufficient.

**Files:** Wherever the Skills tab/hub card components live (likely `src/views/SkillsView.tsx` or `src/components/trials/TrialCard.tsx`).

---

### 6.2 Consider a WI stat influence on clue availability

**What:** The player's Wisdom stat level (`character.statLevels.WI`) has no bearing on Spirit Grove whatsoever. This is a missed opportunity to make character progression feel meaningful inside the trial.

**Fix (lightweight):** At low WI (e.g., < 5), hide the `clue` text on hard-difficulty rounds. At high WI (e.g., ≥ 10), show all clues plus the new `explanation` text immediately (before the player clicks). This creates a reason to invest in Wisdom beyond abstract XP accumulation.

This is optional and should be considered carefully — it adds a design dependency between content data and stat levels — but it would make Spirit Grove the most "Wisdom-flavored" trial in the system.

**Files:** `src/components/trials/games/SpiritGrove.tsx` (read `statLevels.WI` from the store), `src/content/trials.ts` (difficulty tagging from 2.3 is a prerequisite).

---

### 6.3 Verify `toISODate` uses UTC midnight

**What:** The daily gate compares `trialsClearedOn['spirit_grove']` against `toISODate()`. If `toISODate` uses local time rather than UTC, players in different timezones may get different reset times, and a player in a UTC+N timezone could reset at 8pm their local time.

**Fix:** Locate `toISODate` in the store utilities and confirm it returns the UTC date string (`new Date().toISOString().slice(0, 10)`). If it uses local time, decide which behavior is intended and document it. This is a correctness check, not necessarily a bug.

**Files:** `src/store/useGameStore.ts` or wherever `toISODate` is defined.

---

## 7. Suggested Implementation Order

Work in phases from highest-impact / lowest-risk to lowest-impact / most-speculative.

### Phase 1 — Fix correctness issues (low risk, high impact)
1. **Fix the `setTimeout` cleanup** (5.1 + 1.3): A few lines; fix the leak and extract the constant at the same time.
2. **Fix the shuffle**: Replace the biased sort with Fisher-Yates (5.2).
3. **Add the dev-mode content guard** (5.3): Prevents silent scoring bugs as the content pool grows.
4. **Verify `toISODate` behavior** (6.3): Read and confirm, one-line fix if needed.

### Phase 2 — Fix the broken star system (structural, low risk)
5. **Raise `SPIRIT_GROVE_ROUND_COUNT` to 5** (1.1): One constant change. Verify TrialModal result UI still renders correctly with 5 rounds instead of 3. Run the game and play through to check.

### Phase 3 — Expand content (content work, no code changes)
6. **Write 9–14 new rounds** (1.2) to bring the pool to 15–20. Add `difficulty` tags (2.3) and `explanation` strings (2.2) to all rounds, including the existing 6.

### Phase 4 — Mechanics improvements (moderate effort)
7. **Shuffle choice display order** (2.1): Requires touching the `pickRounds` output shape and the render loop — careful to map click index back to canonical index correctly.
8. **Show round explanations** (2.2): Add the render block during the feedback pause (prerequisite: content data from Phase 3).
9. **Add keyboard shortcuts** (3.1): `useEffect` + `keydown` handler — straightforward.
10. **Add result round recap** (3.4): Extend the `done` view to show per-round breakdown.

### Phase 5 — Polish (low risk, time-permitting)
11. **Animate correct-answer reveal** (4.2) and **progress tracker** (4.3).
12. **Add ambient audio** (4.1): Dependent on available assets and sfx system design.
13. **Make feedback pause skippable** (3.3): Small click-through behavior.
14. **Add aria labels** (3.2).

### Phase 6 — Integration and deeper systems (speculative, implement last)
15. **Surface best score on hub card** (6.1): Requires knowing the hub card component structure.
16. **WI stat influence on clue visibility** (6.2): Only if the WI-affects-gameplay direction is confirmed as a design goal.

### Phase 7 — Tests
17. **Add unit tests** (5.4): After the round count, shuffle, and score logic are stable.

---

## Summary of Files Likely Modified

| File | Changes |
|---|---|
| `src/content/trials.ts` | Add rounds, add `difficulty` and `explanation` fields to interface and data |
| `src/components/trials/games/SpiritGrove.tsx` | Timeout cleanup, shuffle fix, keyboard nav, aria, feedback animations, recap view |
| `src/engine/trials/trials.ts` | Verify `scoreToStars` still works correctly after round count change |
| `src/lib/sfx.ts` | Add sound definitions for Spirit Grove audio |
| Skills tab hub card component | Surface `bestTrialScore` display |
| `src/engine/__tests__/trials.test.ts` | New test file for trial logic |
