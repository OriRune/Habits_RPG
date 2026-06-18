# Armory Break — Minigame Analysis

## 1. Basic Summary

Armory Break is a timing-based Skill Trial in HabitsRPG. It represents the **Strength (ST)** stat and is one of eight daily minigames accessible from the Trials hub once the player reaches level 3.

The core premise: the player holds a button to charge a power needle upward on a vertical meter, then releases at the right moment to land in a golden "sweet zone" near the top. They repeat this for three locks in sequence. The final score is the average accuracy across all three locks, scaled to a 0–1 value that drives ST XP and gold rewards.

Within the larger game, Armory Break fills the daily habit loop: completing it grants stat XP toward Strength and a gold payout, both scaling with score and character level. It is gated to one attempt per calendar day (unless the `repeatMinigames` dev setting is on) and slots neatly beside the seven other stat-specific trials in the `TrialsView`.

---

## 2. Core Game Loop

**Starting the trial:**
The player opens the Trials hub (`TrialsView`), clicks the Armory Break card, and reads a brief description in the `TrialModal` intro stage. They tap "Begin Trial" (which also unlocks the browser's AudioContext) to start.

**Repeated action:**
For each of three locks, the player:
1. Holds the "Hold to Charge" button (or Space/Enter) — the power needle rises from 0 → 1 at `RISE_SPEED = 0.85` per second (full charge in ~1.2 s).
2. Releases the button — `armoryAccuracy(power)` is computed at the exact moment of release.
3. If the needle was inside the golden zone (≥ 75% power), a non-zero accuracy is recorded and the meter freezes in a color-coded state. If below the zone, it registers zero and turns red.

**Difficulty:**
All three locks share identical constants — same speed, same zone, same width. There is no internal difficulty ramp. The only challenge is reacting at the right moment before the needle rises to its cap.

**Ending:**
After the third release, `armoryScore(accuracies)` is computed and passed to `onFinish()`. `TrialModal` transitions to its result stage, showing score percentage, 1–3 stars, and the gold + ST XP breakdown.

**Rewards and outcomes:**
```
statXp = round((20 + 8 * level) * (0.25 + 0.75 * score01))
gold   = round((15 + 5 * level) * (0.25 + 0.75 * score01))
```
A 0.25 participation floor ensures even a zero score yields roughly 25% of the maximum reward. `completeTrial` in the store stamps today's ISO date and records the best score seen so far.

---

## 3. Player Controls and Interaction

**Input controls:**
- **Keyboard:** `Space` or `Enter` — hold to charge, release to lock in the reading. Registered via `window.addEventListener('keydown'/'keyup')`. `e.repeat` is suppressed so holding the key does not re-fire `handlePress`.
- **Mouse / touch:** `onPointerDown` / `onPointerUp` / `onPointerLeave` on the charge button. `onPointerLeave` acts as an implicit release if the pointer drifts off the button while held.

**UI elements:**
- Three `MashMeter` components side by side, one per lock. The active lock's meter moves; completed locks are frozen.
- A gold-styled "⚒️ Hold to Charge" button below the meters, hidden once all three locks are done.
- A small status line: "Lock N of 3 • Zone starts at 75% power."
- Instructions above: "**Hold** to charge. **Release** when the power bar is in the golden zone."

**Player feedback:**
- **During charge:** the needle rises in real time; the fill color shifts from `parchment-400/60` to `gold-bright/60` when entering the zone, and the needle line turns gold.
- **On release:** the locked meter's fill freezes to one of three colors: emerald (≥ 0.7 accuracy / "✓ Great"), amber (≥ 0.35 / "✓ OK"), or rose (< 0.35 / "✗ Missed"). A text label appears below the meter.
- **On completion:** the button disappears and `TrialModal` takes over to show the star rating and reward.

There are no sound effects during gameplay.

---

## 4. Mechanics and Systems

### Scoring

`armoryAccuracy(releasePos: number): number` — defined in `src/engine/trials/armoryBreak.ts`:
- Returns `0` if `releasePos < SWEET_ZONE_START` (0.75).
- Returns a linear ramp `(releasePos - 0.75) / 0.25` within the zone, yielding 0 at 0.75 and 1.0 at 1.0.

`armoryScore(accuracies: number[]): number`:
- Sums all recorded accuracies and divides by `ARMORY_LOCKS` (3) — not by the number of non-zero hits.
- A player who hits one lock perfectly and misses two scores `1/3 ≈ 0.33`, not `1.0`.

**Star thresholds** (shared across all trials via `scoreToStars`):
| Stars | Score |
|-------|-------|
| ★★★   | ≥ 0.75 |
| ★★    | ≥ 0.40 |
| ★     | < 0.40 |

### Power Meter Physics

Managed by a `requestAnimationFrame` loop in `ArmoryBreak.tsx`:
```
while held:    power = min(1, power + 0.85 * dt)   // ~1.18 s to full charge
while released: power = max(0, power - 0.5  * dt)   // ~2.0 s to drain
```
The needle clamps at `1.0` and stays there until released. This is the critical detail: **holding past full charge does not penalize the player** — releasing from `1.0` gives the maximum possible accuracy of 1.0.

### Timers

No explicit timer. The trial is as long as the player takes, though in practice three locks take 3–5 seconds total.

### Randomization

None. Every attempt uses the same needle speed, zone boundaries, and lock count. Outcomes are entirely determined by player timing.

### Difficulty progression

None within the trial. All three locks are mechanically identical.

### Win / loss conditions

There is no failure state. The trial always ends after three releases and always grants at least the participation-floor reward. A player can score 0 on all three locks and still receive ~25% of the maximum payout.

### Larger-game systems that affect the trial

- **Character level:** The reward formula scales with `character.level`, so higher-level characters earn more XP and gold per run.
- **`repeatMinigames` dev flag:** Bypasses the once-per-day gate.
- **`bestTrialScore`:** The store persists the best score ever seen per trial for star display on the hub card, but it has no gameplay effect (rewards are based on the current run's score).

---

## 5. Technical Implementation

### File map

| File | Role |
|------|------|
| `src/engine/trials/armoryBreak.ts` | Pure engine: constants, `armoryAccuracy`, `armoryScore` |
| `src/components/trials/games/ArmoryBreak.tsx` | React component: animation loop, input handling, renders meters and button |
| `src/components/trials/MashMeter.tsx` | Reusable vertical meter component |
| `src/components/trials/TrialModal.tsx` | Modal shell: intro → playing → result stages |
| `src/engine/trials/trials.ts` | Trial registry, `trialReward`, `scoreToStars`, `TRIALS_UNLOCK_LEVEL = 3` |
| `src/store/useGameStore.ts` | `completeTrial` action (daily gate, persist score, apply reward) |
| `src/views/TrialsView.tsx` | Hub grid showing all 8 trial cards |
| `src/engine/trials/__tests__/trials.test.ts` | Unit tests for `armoryAccuracy` and `armoryScore` |

### Key functions

**`armoryAccuracy(releasePos)`** (`armoryBreak.ts:15`): Stateless pure function. Maps a 0–1 release position to a 0–1 accuracy. Called once per lock on release.

**`armoryScore(accuracies)`** (`armoryBreak.ts:22`): Sums the array and divides by `ARMORY_LOCKS` (constant 3). Called once on trial completion.

**`handleRelease`** (`ArmoryBreak.tsx:28`): `useCallback` that reads `powerRef.current` (not stale state), computes accuracy, appends to `accuracies`, and either advances to the next lock or calls `onFinish`.

**`handlePress`** (`ArmoryBreak.tsx:45`): Sets `held = true` and `heldRef.current = true`.

**rAF loop** (`ArmoryBreak.tsx:51–66`): A `useEffect` that runs a `requestAnimationFrame` loop for the duration of the trial. Reads `heldRef.current` (ref, not state) to avoid stale closure. Updates `power` state and `powerRef.current` each frame. Cancelled on `done`.

**`completeTrial`** (`useGameStore.ts:1834`): Zustand action. Guards against duplicate clears using ISO date. Calls `applyReward(next, reward)` and `checkLevelUp(next)`.

### State management

- All trial component state lives in `ArmoryBreak.tsx` local React state (`useState`). Nothing is persisted to the store mid-trial.
- Refs (`powerRef`, `heldRef`, `lastTs`, `rafRef`) shadow state values to give the rAF loop safe, synchronous access without stale closures.
- Post-trial persistence is handled entirely by `completeTrial` in the Zustand store: `trialsClearedOn[trialId]`, `bestTrialScore[trialId]`, character XP, and gold.

### Data flow

```
User input (key/pointer)
  → handlePress / handleRelease
    → rAF loop reads heldRef → updates powerRef + setPower
    → on release: armoryAccuracy(powerRef.current) → accuracies[]
      → after 3rd lock: armoryScore(accuracies) → onFinish(score01)
        → TrialModal.handleFinish → stage = 'result'
          → user clicks Claim Reward → completeTrial(trialId, score01)
            → store: applyReward → checkLevelUp
```

### Save / load behavior

No mid-trial save. The trial result is committed to localStorage only when the player explicitly clicks "Claim Reward," which calls `completeTrial`. Closing the modal before claiming loses the result.

### Configuration constants

All in `src/engine/trials/armoryBreak.ts`:
```ts
ARMORY_LOCKS      = 3
SWEET_ZONE_WIDTH  = 0.25  // zone spans top 25% of meter
SWEET_ZONE_START  = 0.75  // zone begins at 75%
```

Speed constants in `ArmoryBreak.tsx`:
```ts
RISE_SPEED = 0.85  // power units per second while held
FALL_SPEED = 0.5   // power units per second while released
```

---

## 6. Software, Libraries, and Tools Used

| Category | Technology |
|----------|------------|
| Framework | React 18 |
| Language | TypeScript |
| Build tool | Vite |
| State management | Zustand with `persist` middleware (localStorage) |
| Styling | Tailwind CSS (custom design tokens: `gold-bright`, `parchment-*`, `wood-*`, `ink-*`) |
| Animation | Native `requestAnimationFrame` with delta-time physics |
| Physics / collision | None |
| Audio | None active during gameplay; `sfxResume()` called on Begin to unlock AudioContext |
| Testing | Vitest |
| Asset pipeline | Inline SVG / emoji / Tailwind-generated elements (no external image assets) |

---

## 7. Assets and Presentation

**Visuals:**
- The three meters are pure CSS: a rounded rectangle (`rounded-full`), a golden zone overlay (semi-transparent `bg-gold-bright/30` with border), a fill bar, and a needle line (a `h-0.5` div).
- No sprite images. All color comes from Tailwind tokens.
- The charge button is a gold gradient (`from-gold-bright to-gold-deep`) with a border and drop shadow.
- Locked meters turn emerald, amber, or rose based on the accuracy tier.

**Animations:**
- The power bar and needle are updated every rAF frame (~60 fps). There is no CSS transition on the fill (explicitly `transition-none`).
- No entry or exit animations on locking a meter; it snaps instantly to its frozen color.
- No completion animation when all three locks are cracked.

**Sound effects:** None during gameplay. `sfxResume()` only ensures the AudioContext is ready.

**Music:** No trial-specific music.

**Overall style and mood:** Minimalist, functional. The gold/parchment palette fits the RPG theme. The ⚒️ emoji and "Armory Break" name evoke a physical strength theme, though the experience is a clean mobile-friendly button press with no "armory" visual context.

---

## 8. Current Player Experience

**What works:**
- The core concept is immediately legible. "Hold and release" is a universal gesture.
- The golden zone is visually obvious from first glance.
- Three-color feedback (green/amber/red) communicates result quality at a glance without requiring a numeric score.
- The participation reward floor removes frustration — failing all three locks still earns something.
- Keyboard support (Space/Enter) plus pointer events covers PC and mobile naturally.
- The short duration (~4–5 seconds) makes it feel like a quick daily ritual rather than a chore.

**What is confusing or awkward:**
- The on-screen prompt says "release when the power bar is in the golden zone," implying the player must release at a precise moment. In reality, the needle rises to 1.0 and clamps there, so simply holding long enough and then releasing at leisure yields a perfect score. Players who discover this will feel the mechanic has no real depth.
- `onPointerLeave` fires a release if the cursor drifts off the button during a hold — this can cause an accidental early release on desktop.
- There is no visual indication that the button has registered the press ("is being held") beyond the meter moving, which may not be obvious on first attempt.
- After all three locks are done, the button disappears but the screen does nothing until the parent `TrialModal` catches up — the gap is tiny but slightly abrupt.

**What feels polished:**
- The color-coded frozen meters give a satisfying summary at the end.
- The `TrialModal` result screen with stars and reward breakdown is clean.

**What feels unfinished:**
- No sound design whatsoever during gameplay.
- No animation or visual event when a lock cracks.
- All three locks are identical — the trial reads as a single action repeated three times, not a sequence that builds.

**Pacing:**
- Each lock takes ~1.2 s at full charge, making the entire trial trivially short. Three perfect locks take under five seconds including transition time. This is on the edge of feeling too brief to be engaging.

**Difficulty:**
- Currently, the trial has effectively zero skill ceiling: once a player learns that holding to the cap always gives maximum accuracy, the trial becomes a formality. It is designed as if the needle would overshoot or oscillate, but it does not.

---

## 9. Known Issues or Weak Points

**Critical design flaw — no overshoot penalty:**
The sweet zone occupies the top 25% of the meter (0.75–1.0), and the needle caps at 1.0. Releasing at 1.0 gives a perfect score of 1.0. The intended tension — "don't hold too long or you'll miss the zone" — is absent because the needle never passes through the zone; it stops inside it. Any player who holds for ~1.2 s and releases gets a perfect score every attempt.

**No difficulty progression between locks:**
`RISE_SPEED`, `FALL_SPEED`, and `SWEET_ZONE_WIDTH` are constants applied equally to all three locks. Lock 3 is mechanically identical to Lock 1.

**No audio feedback:**
No sound plays on hold start, needle entering the zone, lock crack, or trial completion. For a "power strike" trial tied to Strength, the silence is noticeable.

**No visual celebration on lock crack:**
The meter snaps instantly to its frozen color. There is no brief animation, particle, or shake to reinforce the action.

**`onPointerLeave` as implicit release:**
Dragging the pointer off the button mid-hold fires `handleRelease`, which can cause an unintended early release on desktop. This is a common pointer-event pitfall.

**Stale closure risk in `handleRelease`:**
`handleRelease` closes over `accuracies` (state, not a ref), meaning a stale copy could be read if the callback is somehow invoked between renders. In practice, `useCallback` re-creates it whenever `accuracies` or `done` changes, and the keyboard listeners are re-registered each time. This is probably safe, but it adds subtle complexity compared to using a ref for `accuracies`.

**No per-run randomization:**
Every attempt feels identical. Experienced players will find no replay interest.

**Result lost on modal close before Claim:**
If the player closes `TrialModal` after finishing but before clicking "Claim Reward," the result is discarded. There is no confirmation prompt.

**`MashMeter` hardcodes `armoryBreak.ts` constants:**
`MashMeter.tsx` imports `SWEET_ZONE_START` and `SWEET_ZONE_WIDTH` directly from `armoryBreak.ts`. This couples a generic-looking component to a single trial's constants, making it unsuitable for reuse in other contexts without modification.

---

## 10. Improvement Opportunities

**Mechanic depth:**
- Add an overshoot zone: if the needle passes through the sweet zone and the player holds too long (say, past 1.0 on a slightly extended scale, or via a separate "danger zone"), reward precision over brute-force holding. Alternatively, have the needle oscillate (rise to 1, fall back, repeat) so the player must catch it mid-swing.
- Introduce per-lock difficulty: increase `RISE_SPEED` or decrease `SWEET_ZONE_WIDTH` for each successive lock, so Lock 3 is noticeably harder.

**Audio:**
- Add a rising hum or charge sound while holding.
- Add a crack or clang on lock success, a clunk on miss.
- Add a completion fanfare before the result screen.

**Visual feedback:**
- Brief screen shake or meter flash when a lock cracks.
- A particle burst or brief glow on "Great" hits.
- Animate the button state (depress / highlight) on press.
- Add a brief "transition" between locks so the shift doesn't feel instant.

**Controls:**
- Fix the `onPointerLeave` accidental-release issue — use `setPointerCapture` so the button retains input focus while held, even if the pointer drifts.

**Thematic coherence:**
- The gameplay (tapping a meter) doesn't visually match the "Armory Break" name. Simple background art (a lock, a heavy door, a steel beam) or a sound design pass would close that gap.

**Replay value:**
- Introduce seeded randomness: vary `RISE_SPEED` ±10% or add a brief distraction flash to give each run a slightly different feel.

**Code cleanup:**
- Extract `accuracies` to a ref alongside `powerRef` to simplify the `handleRelease` dependency chain.
- Make `MashMeter` accept zone constants as props rather than importing them from `armoryBreak.ts`, so the component is genuinely reusable.

**Integration:**
- Surface best-score feedback more prominently on the hub card (e.g., show the actual percentage alongside stars).

---

## 11. Questions and Unknowns

**Was overshoot ever intended?**
The mechanic reads as though the needle should sweep past the zone if held too long, but the code clamps at 1.0. It is unclear whether this is a conscious design decision (simpler = better for a daily casual minigame) or an unimplemented planned feature.

**Is `MashMeter` intended for future reuse?**
The component is named generically but is coupled to `armoryBreak.ts` constants. A future trial that needs a similar mechanic would require refactoring it.

**Audio pipeline:**
`sfxResume()` is called on trial start, but no sounds are played during Armory Break specifically. It is unclear whether there is an existing SFX system that could be wired in (e.g., in `src/lib/sfx.ts`) or whether audio would need to be built from scratch for this trial.

**`onPointerLeave` intent:**
It is unclear whether the accidental-release behavior on pointer drift is intentional (a "don't move" challenge element) or an oversight.

**Reward balance:**
The reward formula (`20 + 8 * level` base XP) is shared across all eight trials. It is unknown whether this formula has been validated as balanced for Strength specifically, or whether some trials should give more/less XP given their relative difficulty.

**Three locks vs. variable count:**
`ARMORY_LOCKS = 3` is a named constant, suggesting it might have been considered variable. There is no mechanism today to change it per-run or via difficulty settings.

**Mobile feel:**
The trial has pointer event support, but it has not been noted whether the button size and meter layout have been tested on narrow phone screens. The meters are `w-10 h-36` with `gap-6` between them — three in a row could be tight on small viewports.
