# Royal Court — Improvement Plan

Based on `docs/royal-court-minigame-analysis.md`.

---

## 1. Highest-Priority Improvements

These address the issues most likely to make the trial feel stale or confusing right now.

### 1.1 Expand the exchange pool

**What:** Add 8–12 more exchanges to `ROYAL_COURT_EXCHANGES` in `src/content/trials.ts`. Keep 4 per session.

**Why:** With 6 total exchanges and 4 selected per run, a player exhausts the unique content space within 2–3 days of daily play. Repetition is the fastest way to kill the "read the room" illusion. 14+ exchanges means roughly 1,001 unique 4-exchange combinations before repeats feel deliberate — enough to last months.

**Files:** `src/content/trials.ts` (data only, no logic changes needed).

**Notes:** Aim for variety in NPC archetype and scenario type — add one or two encounters that are adversarial, one that tests humility vs. confidence, one with a trick phrasing. Keep max delta of the best choice at 3 for each exchange to preserve consistent `maxFavor` math.

---

### 1.2 Delay delta reveal until the post-run recap

**What:** Remove the inline `(+3 favour ✓)` / `(-1 favour ✗)` label that appears on the selected button immediately after a click. Instead, surface that information on the result screen as a per-exchange breakdown.

**Why:** The current feedback loop is: read text → make social judgment → instantly see the mechanical grade. Once a player spots the pattern, they stop reading and start looking for the "+3" cue on muscle memory. Hiding the delta until the run ends keeps the social-reading loop intact for much longer. The result recap still teaches — it just doesn't interrupt the roleplay mid-scene.

**Files:**
- `src/components/trials/games/RoyalCourt.tsx` — remove the `isSelected && (...)` delta span (lines 108–113). Store a `choiceHistory` array of `{ exchangeIndex, choiceIdx, favorDelta }` in local state.
- `src/components/trials/TrialModal.tsx` — pass `choiceHistory` through `onFinish` or as a separate callback; render the per-exchange table on the result screen.

**Scope:** Small component change + one new result UI section.

---

### 1.3 Fix the biased shuffle

**What:** Replace `sort(() => Math.random() - 0.5)` in `pickExchanges` with a Fisher-Yates shuffle.

**Why:** The current sort-based shuffle systematically over-represents certain orderings. Over many sessions this makes some exchange combinations appear noticeably more often than others, which a daily player will feel even if they can't articulate why.

**Files:** `src/components/trials/games/RoyalCourt.tsx:14–17`.

**Change:**
```typescript
function pickExchanges(exchanges: typeof ROYAL_COURT_EXCHANGES) {
  const arr = [...exchanges];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, ROYAL_COURT_EXCHANGE_COUNT);
}
```

**Scope:** 5-line change, zero risk.

---

## 2. Gameplay and Mechanics Improvements

### 2.1 Add a per-exchange recap to the result screen

**What:** After the trial ends, show a small table on the result card listing each encounter: NPC name, the player's chosen response text, and the favour delta (with colour coding).

**Why:** Currently the result screen only shows the final score %. A player who scores 58% has no way to know which exchange cost them points. The recap turns the result screen into a learning moment without breaking immersion during play (see §1.2).

**Files:** `src/components/trials/TrialModal.tsx` (result stage), `src/components/trials/games/RoyalCourt.tsx` (accumulate `choiceHistory`).

---

### 2.2 Introduce weighted exchanges

**What:** Give the Queen Elowen encounter (and possibly one other pivotal NPC) a higher max delta — e.g., +4 or +5 on the best choice — so it is worth more to the final score than a gatekeeper NPC.

**Why:** All exchanges currently have an identical ceiling of +3, which makes every encounter feel equal weight. If the Queen's opinion matters more than the jester's, that should be reflected mechanically. This also opens narrative room to write more consequential exchanges without over-rewarding trivial ones.

**Files:** `src/content/trials.ts` (adjust `favorDelta` values). The score math in `RoyalCourt.tsx` already handles variable `maxFavor` via `Math.max(...e.choices.map(c => c.favorDelta))` — no logic change needed.

---

### 2.3 Tighten star thresholds at higher levels (optional)

**What:** Pass player level into the trial and adjust star thresholds dynamically (e.g., 3★ requires 85% at level 10+ vs. 75% at level 3).

**Why:** The current thresholds (75% / 40%) are fixed regardless of character progression. A level-15 Charisma-focused character should find a 75% run merely adequate. This gives long-term players a reason to keep improving their score rather than farming 3★ on autopilot.

**Files:** `src/engine/trials/trials.ts` (`scoreToStars` — add optional `level` param), `src/components/trials/TrialModal.tsx` (pass level down), `src/components/trials/games/RoyalCourt.tsx` (no change needed — scoring happens outside the component).

---

### 2.4 Expand session length at higher levels (optional, later)

**What:** At level 8+, increase `ROYAL_COURT_EXCHANGE_COUNT` from 4 to 5 or 6 exchanges per session.

**Why:** A longer session is a natural "harder" mode without changing any individual exchange. It also allows for better narrative arc (intro → obstacle → advisor → queen feels more complete at 5 exchanges than 4).

**Files:** `src/content/trials.ts` (expose a function instead of a raw constant), `src/components/trials/games/RoyalCourt.tsx` (accept the count as a prop or read from a helper).

---

## 3. Controls, UI, and Player Feedback Improvements

### 3.1 Add a transition animation between exchanges

**What:** Replace the 900 ms silent lock-and-wait with a visible transition — a brief fade-out / fade-in of the dialogue box, or a slide. The buttons should disable immediately (already done), but the 900 ms should feel intentional rather than laggy.

**Why:** The gap currently feels like a stall. A 200–300 ms CSS fade-out before advancing, followed by a 150 ms fade-in, would use the same total delay but feel fluid. This is the most noticeable rough edge during play.

**Files:** `src/components/trials/games/RoyalCourt.tsx` — add a local `transitioning` state; apply Tailwind `transition-opacity` / `opacity-0` class during the transition window, then swap content.

---

### 3.2 Improve the "neutral" response label

**What:** Replace `(neutral)` with a more flavourful outcome label when a choice has `favorDelta === 0`, e.g. `(no impression made)` or a blank expression emoji (😐).

**Why:** "Neutral" is a mechanical term, not a social one. It breaks the fiction. A short flavour phrase maintains the tone while still communicating the outcome.

**Files:** `src/components/trials/games/RoyalCourt.tsx:110` (the ternary that renders the label).

---

### 3.3 Add a close-modal confirmation

**What:** If the player clicks ✕ while `stage === 'playing'`, show a one-line confirmation: "Leave the court? Your progress will be lost." with Cancel / Leave buttons.

**Why:** The current modal closes silently and discards the run. Players who accidentally mis-tap the close button lose their attempt with no recourse. This is especially painful if `repeatMinigames` is off.

**Files:** `src/components/trials/TrialModal.tsx` — intercept `onClose` when stage is `'playing'`; add a small inline confirm state.

---

### 3.4 Show best score on the intro screen

**What:** On the `'intro'` stage of `TrialModal`, display the player's current best score and star rating for this trial below the description text.

**Why:** Players use best-score context to set a goal for the current attempt. The hub card already shows stars; surfacing the actual score (e.g. "Your best: 83% ★★★") inside the modal before they commit gives them a clear target.

**Files:** `src/components/trials/TrialModal.tsx` — read `bestTrialScore[trialId]` from the store and render on the intro card.

---

## 4. Visual and Audio Polish

### 4.1 Add sound effects

**What:** Three sfx events:
- A soft positive chime when `favorDelta > 0` is resolved.
- A muted thud or chord drop when `favorDelta < 0` is resolved.
- A short fanfare or bell on trial completion (called before `onFinish`).

**Why:** The favour bar and colour feedback communicate the outcome visually, but sound doubles that emotional beat with almost zero effort. The sfx infrastructure (`src/lib/sfx`) already exists and `sfxResume()` is already called at trial start.

**Files:** `src/components/trials/games/RoyalCourt.tsx` — import and call sfx helpers in `choose()`. `src/lib/sfx.ts` — ensure the needed sounds are registered (or add them).

---

### 4.2 Add NPC silhouettes or scene illustration

**What:** Add a simple static silhouette or icon beside each NPC's dialogue box — one per NPC archetype (herald, courtier, advisor, queen, jester, treasurer). These can be SVG silhouettes, emoji-based composites, or small sprite sheets.

**Why:** The court setting is entirely text right now. Even a minimal visual anchor per NPC (a crown silhouette for the queen, a fool's hat for the jester) makes each encounter feel distinct and builds spatial memory for the characters.

**Files:** `src/content/trials.ts` — add an optional `icon` field to `CourtExchange`. `src/components/trials/games/RoyalCourt.tsx` — render the icon next to the NPC label.

---

### 4.3 Favour bar colour shift at thresholds

**What:** Change the favour bar fill colour as it crosses the star thresholds: gold (0–39%), amber (40–74%), emerald (75%+), mirroring the star rating tiers.

**Why:** The current bar is always `bg-gold-bright/70` regardless of score. Colour-shifting the bar gives a persistent visual status — the player glances up and knows where they stand in star terms without doing mental math.

**Files:** `src/components/trials/games/RoyalCourt.tsx:63–65` — derive bar colour from `favorPct` using a simple conditional Tailwind class.

---

## 5. Technical / Code Improvements

### 5.1 Extract the 900 ms delay to a named constant

**What:** Replace the magic number `900` in the `setTimeout` call with a named constant at the top of the file, e.g. `const ADVANCE_DELAY_MS = 900`.

**Why:** The delay is referenced in one place now, but if it is adjusted (as it likely will be once animation is added — see §3.1), a named constant makes the intent clear and the change safe.

**Files:** `src/components/trials/games/RoyalCourt.tsx:41`.

---

### 5.2 Add `choiceHistory` to local state for recap support

**What:** Extend the component's local state with:
```typescript
const [choiceHistory, setChoiceHistory] = useState<
  { npc: string; label: string; favorDelta: number }[]
>([]);
```
Populate it inside `choose()`. Pass it to `onFinish` or store it in a ref for the result recap (§2.1).

**Why:** Currently the component discards per-exchange data as it advances. Adding `choiceHistory` is a prerequisite for the result recap and costs nothing in complexity.

**Files:** `src/components/trials/games/RoyalCourt.tsx`.

---

### 5.3 Type the `onFinish` signature to carry history

**What:** Once `choiceHistory` exists (§5.2), update the `RoyalCourtProps` interface:
```typescript
interface RoyalCourtProps {
  onFinish: (score01: number, history: ChoiceRecord[]) => void;
}
```

**Why:** Passing history through the callback keeps `RoyalCourt` stateless about the outer modal — it reports what happened and the modal decides how to display it. Cleaner than lifting state or using a shared ref.

**Files:** `src/components/trials/games/RoyalCourt.tsx`, `src/components/trials/TrialModal.tsx`.

---

### 5.4 Enforce a minimum positive delta per exchange in content

**What:** Add a brief comment block or JSDoc to `CourtExchange` in `src/content/trials.ts` specifying the authoring contract: every exchange must have at least one choice with `favorDelta >= 2` and no exchange should have all choices at 0 or negative.

**Why:** There is currently no guard against content authoring mistakes. A future exchange with all-negative choices would make the score math silently wrong (favour floor clamps at 0, but `maxFavor` computation could return 0 or a negative, causing division issues or a score of `Infinity`/`NaN`). A runtime assertion or zod schema would catch this in dev.

**Files:** `src/content/trials.ts` (comment/type annotation), optionally a dev-mode assertion in `RoyalCourt.tsx` that validates `maxFavor > 0`.

---

## 6. Integration with the Larger Game

### 6.1 Clarify or establish CH stat's in-game effect

**What:** Determine whether Charisma has any combat or gameplay effect beyond XP towards levelling. If it does, document it. If it doesn't, consider adding one — e.g., Charisma level raises the gold payout from defeated enemies by a small %, or unlocks additional merchant dialogue options.

**Why:** Per the analysis, `statLevels` are the actual combat values. It is currently unclear whether CH levels affect anything at all. If CH is purely cosmetic, the Royal Court trial's only hook is "XP to level up faster," which makes it feel weaker than skill-testing trials. Even a small passive CH bonus gives the player a tangible reason to care about improving their score.

**Files:** `src/engine/stats.ts`, `src/store/useGameStore.ts` (wherever combat/gold rewards are calculated), possibly `src/engine/challenges.ts`.

---

### 6.2 Reflect CH level in exchange difficulty or NPC attitudes

**What:** At higher CH levels, unlock a fifth choice per exchange with a uniquely high delta — a "silver-tongued" option that only an experienced courtier would know to attempt.

**Why:** This would make CH progression feel tangible within the trial itself. A player who has invested in Charisma gains access to responses that aren't available at level 1, creating a satisfying feedback loop between the habit tracker, levelling, and the minigame.

**Files:** `src/content/trials.ts` (add `requiresChLevel?: number` to individual choice objects), `src/components/trials/games/RoyalCourt.tsx` (filter choices by CH level before rendering), `src/store/useGameStore.ts` or `src/store/selectors.ts` (pass CH stat level into the trial).

---

## 7. Suggested Implementation Order

The table below orders items by impact-to-effort ratio. Tackle them top to bottom for the fastest visible improvement.

| Step | Item | Effort | Impact |
|------|------|--------|--------|
| 1 | Fix Fisher-Yates shuffle (§1.3) | 5 min | Low but correct |
| 2 | Extract `ADVANCE_DELAY_MS` constant (§5.1) | 5 min | Low, prerequisite for §3.1 |
| 3 | Fix "neutral" response label (§3.2) | 10 min | Small polish |
| 4 | Expand exchange pool to 14+ (§1.1) | 1–2 h | **High** — biggest longevity fix |
| 5 | Add `choiceHistory` local state (§5.2) | 20 min | Prerequisite for §1.2 and §2.1 |
| 6 | Delay delta reveal + post-run recap (§1.2 + §2.1) | 1–2 h | **High** — core gameplay improvement |
| 7 | Update `onFinish` signature (§5.3) | 15 min | Completes §5.2 cleanly |
| 8 | Add close-modal confirmation (§3.3) | 30 min | Prevents frustrating accidental exits |
| 9 | Add transition animation (§3.1) | 45 min | Noticeable feel improvement |
| 10 | Add favour bar colour shift (§4.3) | 20 min | Cheap visual polish |
| 11 | Show best score on intro screen (§3.4) | 20 min | Small UX improvement |
| 12 | Add sound effects (§4.1) | 1–2 h | Meaningful atmosphere improvement |
| 13 | Add NPC silhouettes/icons (§4.2) | 2–4 h | Visual identity |
| 14 | Content authoring guard / assertion (§5.4) | 30 min | Defensive code hygiene |
| 15 | Weighted exchanges (§2.2) | 30 min | Mechanical depth |
| 16 | Tighten star thresholds at level (§2.3) | 1 h | Long-term progression feel |
| 17 | Unlock CH choices by level (§6.2) | 2–3 h | Deep integration, larger scope |
| 18 | Clarify CH stat in-game effect (§6.1) | Design + code | Foundation for §6.2 |
| 19 | Extend session length at high level (§2.4) | 1 h | Optional depth layer |

**Natural milestones:**
- **Steps 1–7** together form a clean "v1.1 patch" — all low-risk, high-value, no design decisions needed.
- **Steps 8–13** form a "v1.2 polish pass" — mostly self-contained UI work.
- **Steps 14–17** form a "v1.3 depth pass" — requires a small content authoring session and stat system design decisions.
- **Steps 18–19** are post-depth, larger-scope work that depends on broader game design choices.
