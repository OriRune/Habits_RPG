# Armory Break — Improvement Plan

Based on `docs/armory-break-minigame-analysis.md`.

---

## 1. Highest-Priority Improvements

### 1.1 Fix the core mechanic — add a real skill ceiling

**What:** The needle clamps at `power = 1.0` and `armoryAccuracy(1.0) = 1.0`, meaning any player who holds for ~1.2 s and then releases at their leisure scores perfectly. There is no skill expression. This must be fixed before any other polish is worth doing.

**Why it matters:** Without it, the trial is a participation button, not a Strength challenge. Every other improvement listed below is undermined if the core mechanic has no ceiling.

**Recommended fix — move the zone off the cap:**
Change the sweet zone so it sits in the middle of the meter, not at the top. The needle continues rising past the zone if the player holds too long. Releasing above the zone gives zero, just like releasing below it.

Changes required:

1. **`src/engine/trials/armoryBreak.ts`** — adjust constants and add an overshoot check:

```ts
export const SWEET_ZONE_START = 0.60;   // was implicitly 0.75 (top of cap)
export const SWEET_ZONE_WIDTH = 0.20;   // zone: 0.60 – 0.80
export const SWEET_ZONE_END   = SWEET_ZONE_START + SWEET_ZONE_WIDTH; // 0.80

export function armoryAccuracy(releasePos: number): number {
  if (releasePos < SWEET_ZONE_START) return 0;
  if (releasePos > SWEET_ZONE_END)   return 0;               // NEW: overshoot = miss
  // Peak accuracy at centre of zone
  const centre = SWEET_ZONE_START + SWEET_ZONE_WIDTH / 2;
  return 1 - Math.abs(releasePos - centre) / (SWEET_ZONE_WIDTH / 2);
}
```

This scores the centre of the zone as 1.0 and falls off to 0 at both edges — more realistic than the linear ramp that currently only rewards releasing later.

2. **`src/components/trials/MashMeter.tsx`** — update the zone overlay to use `SWEET_ZONE_START` and `SWEET_ZONE_WIDTH` as before (no layout change needed, just the constants change). The golden fill will now sit visually in the middle of the meter where the needle must land.

3. **`src/components/trials/games/ArmoryBreak.tsx`** — the needle already rises past 1.0-clamp and can stay above the zone. No physics change needed; the clamp keeps the needle at 1.0 instead of bouncing — that's fine because releasing at 1.0 now returns 0 (above the zone).

4. **Update unit tests** in `src/engine/trials/__tests__/trials.test.ts` — the existing tests for `armoryAccuracy` will fail because the semantics changed. Rewrite them to cover: below zone = 0, above zone = 0, at centre = 1, at zone edges ≈ 0.

**Alternative — oscillating needle (higher polish, more work):**
Instead of clamping at 1.0, have the needle reverse direction when it hits the cap and sweep back down. This turns the trial into a "catch the swinging needle" game. It requires a direction flag in the rAF loop and a larger rework of the accuracy function. Worth considering after the simpler fix above is validated.

---

### 1.2 Per-lock difficulty progression

**What:** All three locks currently use the same `RISE_SPEED` and zone constants. Lock 3 is identical to Lock 1. Introduce a per-lock speed increase and (optionally) a narrower zone on later locks.

**Why it matters:** Without progression, the three-lock structure feels like padding — one action done three times. A rising challenge gives the structure meaning.

**How:** Replace the flat constants in `ArmoryBreak.tsx` with a per-lock config array:

```ts
// In ArmoryBreak.tsx
const LOCK_CONFIG = [
  { riseSpeed: 0.70, zoneWidth: SWEET_ZONE_WIDTH },          // Lock 1 — forgiving
  { riseSpeed: 1.00, zoneWidth: SWEET_ZONE_WIDTH },          // Lock 2 — standard
  { riseSpeed: 1.40, zoneWidth: SWEET_ZONE_WIDTH * 0.75 },   // Lock 3 — fast, narrower
] as const;
```

Pass `LOCK_CONFIG[currentLock].zoneWidth` as a prop to `MashMeter` so the golden overlay shrinks on Lock 3 (see section 5.1 for the MashMeter decoupling this requires). Use `LOCK_CONFIG[currentLock].riseSpeed` in the rAF loop.

**Files:** `src/components/trials/games/ArmoryBreak.tsx`, `src/components/trials/MashMeter.tsx`, `src/engine/trials/armoryBreak.ts` (export `SWEET_ZONE_WIDTH` so it can be used as the base).

---

## 2. Gameplay and Mechanics Improvements

### 2.1 Tune reward balance after difficulty increases

**What:** Once locks 2 and 3 are genuinely harder, reassess whether the current reward formula feels proportionate. At level 1 with a perfect score: `round((20 + 8) * 1.0) = 28 ST XP`. At level 10: `round((20 + 80) * 1.0) = 100 ST XP`. The floor at score 0: 25% of that. These numbers are shared across all eight trials.

**Why it matters:** If the mechanic is now genuinely harder, players may struggle to hit 3 stars without it feeling unfair. Consider whether the star thresholds (≥ 0.75 for 3 stars) need adjustment given the new centre-peak accuracy curve, where hitting the exact centre of the zone is required for 1.0.

**Files:** `src/engine/trials/trials.ts` (`scoreToStars`, `trialReward`). No code change may be needed — just verify the numbers feel right after playtesting 2.1.

### 2.2 Add a brief inter-lock pause

**What:** After a lock cracks, the next meter immediately becomes active. There is no visual beat between locks. Add a ~400 ms pause before the next lock activates, during which the newly-frozen meter can display its feedback.

**Why it matters:** The current instant transition gives the player no time to read the result of the lock they just cracked before they need to start charging the next one.

**How:** After updating `accuracies` and before `setCurrentLock(next.length)`, set a `transitioning` boolean state for ~400 ms (use a `setTimeout` stored in a ref, cancelled on unmount). Disable the charge button and pause the rAF loop during this window.

**Files:** `src/components/trials/games/ArmoryBreak.tsx`.

---

## 3. Controls, UI, and Player Feedback Improvements

### 3.1 Fix accidental release on pointer drift

**What:** `onPointerLeave` on the charge button calls `handleRelease`, so dragging the mouse slightly off the button mid-hold fires a premature release. On desktop this is a real usability problem.

**Why it matters:** The player intended to hold; the button betrayed them. This is especially frustrating on Lock 3 of a good run.

**How:** Use the Pointer Capture API. In `handlePress`, call `(e.currentTarget as Element).setPointerCapture(e.pointerId)` so the button continues receiving pointer events even after the pointer leaves its bounds. Remove the `onPointerLeave` handler entirely — `onPointerUp` will fire reliably on release regardless of position.

```tsx
<button
  onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePress(); }}
  onPointerUp={handleRelease}
  // onPointerLeave removed
>
```

**Files:** `src/components/trials/games/ArmoryBreak.tsx`.

### 3.2 Add a visual "button held" state

**What:** When the player holds the button, there is no visual change to it beyond the meter moving. Add an `active:scale-95` press state (already there) and additionally darken/depress the button while `held === true` via a conditional class.

**Why it matters:** The button gives no confirmation that it has registered the hold. First-time players may be unsure whether their press landed.

**How:** Apply a `held ? 'ring-2 ring-gold-bright brightness-75' : ''` conditional class to the button using the `cn()` utility.

**Files:** `src/components/trials/games/ArmoryBreak.tsx`.

### 3.3 Show live score hint during play

**What:** The status line currently reads "Lock N of 3 • Zone starts at 75% power." Replace or supplement this with a running accuracy display after each lock: e.g., "Lock 2 of 3 • Best so far: Great, Missed."

**Why it matters:** Players who have just cracked two locks with no feedback summary don't know how they're doing heading into Lock 3.

**Files:** `src/components/trials/games/ArmoryBreak.tsx` — compute display text from `accuracies` (already in state).

### 3.4 Handle the "close before Claim" edge case

**What:** If the player closes `TrialModal` after completing the trial but before clicking "Claim Reward," the result is lost silently. The `trialsClearedOn` gate is NOT stamped (that only happens in `completeTrial`), so the player can replay — but they lose the reward and may not understand why.

**Options:**
- **Auto-claim on close:** Call `completeTrial` when transitioning to the result stage (not on Claim button), and use Claim only to dismiss. Lowest friction.
- **Confirmation dialog:** Show "Are you sure? Your reward will be lost" before closing from the result stage.

The auto-claim approach is simpler and matches player expectation ("I finished, I earned it"). The Claim button becomes a cosmetic "Continue" button.

**Files:** `src/components/trials/TrialModal.tsx` — move `completeTrial` call from `handleClaim` to `handleFinish`.

---

## 4. Visual and Audio Polish

### 4.1 Add sound design

**What:** Wire up sounds at three moments: (a) a rising charge tone while holding, (b) a crack/clang on successful lock (Great/OK), and (c) a miss thud. Optionally a short fanfare when all three locks are done.

**Why it matters:** The trial is themed around physical force — "Armory Break," hammer glyph — and is completely silent. Audio is the highest-impact polish change per effort.

**How:** Check `src/lib/sfx.ts` for the existing audio infrastructure used by other parts of the game. Wire sound calls into `handlePress` (start charge sound), `handleRelease` (play crack or miss based on accuracy), and the completion branch.

**Files:** `src/components/trials/games/ArmoryBreak.tsx`, `src/lib/sfx.ts` (may need new sound entries).

### 4.2 Animate lock crack

**What:** When a lock is cracked, the `MashMeter` instantly snaps to its frozen color. Add a brief visual event: a one-frame flash, a scale bounce, or a short CSS keyframe that pulses the meter.

**Why it matters:** The snap is abrupt. Even a 150 ms flash communicates "something happened here" and makes a Great hit feel satisfying.

**How:** In `MashMeter.tsx`, when `locked` transitions from false to true (detect via `useEffect` or a `key` on the component), apply a CSS animation class (`animate-ping` for one frame, or a custom `@keyframes` defined in Tailwind config). Alternatively, keep it simple: add a `transition-colors duration-150` on the fill div so the color change eases in instead of snapping.

**Files:** `src/components/trials/MashMeter.tsx`.

### 4.3 Needle "in-zone" glow

**What:** When the needle enters the golden zone, make the zone overlay pulse or brighten to clearly signal "you're in the window — release now."

**Why it matters:** Players need to know the exact moment the zone is active, especially with the new mid-meter zone (improvement 1.1) where the visual target is no longer at the top. A pulsing glow gives a kinetic cue.

**How:** When `inZone` is true in `MashMeter`, apply `animate-pulse` to the sweet-zone overlay div instead of the static `bg-gold-bright/30`.

**Files:** `src/components/trials/MashMeter.tsx`.

### 4.4 Completion state

**What:** When all three locks are done and the button disappears, the screen is static for a brief moment before `TrialModal` takes over. Add a "All Locks Cracked!" text or a brief celebration on the `done` state.

**Why it matters:** The gap between trial end and result screen feels inert.

**How:** In `ArmoryBreak.tsx`, when `done === true`, render a brief centered message (e.g., "⚒️ Cracked!") below the meters before `onFinish` is called. Since `onFinish` is called immediately in the current code, insert the brief inter-lock pause pattern from improvement 2.2 here as well — call `onFinish` after a 600 ms delay, using that window to show the message.

**Files:** `src/components/trials/games/ArmoryBreak.tsx`.

---

## 5. Technical / Code Improvements

### 5.1 Decouple `MashMeter` from `armoryBreak.ts`

**What:** `MashMeter.tsx` imports `SWEET_ZONE_START` and `SWEET_ZONE_WIDTH` directly from `armoryBreak.ts`. This couples a component named generically to a single trial's constants.

**Why it matters:** Per-lock difficulty (improvement 1.2) already requires passing a variable zone width per lock. This decoupling is a prerequisite for that change and makes `MashMeter` genuinely reusable.

**How:** Add `zoneStart` and `zoneWidth` props with defaults matching the current constants:

```ts
interface MashMeterProps {
  power: number;
  locked?: boolean;
  lockedAccuracy?: number;
  label?: string;
  zoneStart?: number;   // default: SWEET_ZONE_START
  zoneWidth?: number;   // default: SWEET_ZONE_WIDTH
}
```

`ArmoryBreak.tsx` passes the per-lock values; existing callers with no props get the same behavior as before.

**Files:** `src/components/trials/MashMeter.tsx`, `src/components/trials/games/ArmoryBreak.tsx`.

### 5.2 Stabilize `handleRelease` with an accuracies ref

**What:** `handleRelease` closes over `accuracies` state. `useCallback` re-creates it whenever `accuracies` changes, which triggers the keyboard `useEffect` to re-register listeners each lock. This is currently safe but creates unnecessary churn and subtle dependency chains.

**How:** Mirror `accuracies` to a ref (`accuraciesRef`) the same way `power` and `held` are mirrored:

```ts
const accuraciesRef = useRef<number[]>([]);
// keep in sync:
accuraciesRef.current = accuracies;
```

`handleRelease` reads `accuraciesRef.current` instead of `accuracies`. It can then be wrapped in `useCallback(fn, [done, onFinish])` with no `accuracies` dependency, making the keyboard effect register once rather than per lock.

**Files:** `src/components/trials/games/ArmoryBreak.tsx`.

### 5.3 Cancel `setTimeout` refs on unmount

**What:** If improvement 2.2 (inter-lock pause) uses `setTimeout`, that timer ref must be cleaned up in a `useEffect` return to avoid a state update on an unmounted component.

**How:** Store the timer ID in a `useRef<ReturnType<typeof setTimeout> | null>` and cancel it in the cleanup function. (This is standard practice — note it here as a reminder when implementing 2.2.)

**Files:** `src/components/trials/games/ArmoryBreak.tsx`.

### 5.4 Update unit tests after mechanic changes

**What:** After implementing improvement 1.1, the existing `armoryAccuracy` tests will fail because the function now returns 0 for overshoot. The tests should be updated to cover:
- Below zone → 0
- At zone centre → 1
- At zone edges → 0 (or near 0)
- Above zone (overshoot) → 0
- `armoryScore` behavior is unchanged — tests still valid

**Files:** `src/engine/trials/__tests__/trials.test.ts` (armoryBreak describe block, lines ~517–550).

---

## 6. Integration with the Larger Game

### 6.1 Surface best score more usefully on the hub card

**What:** `TrialsView` shows a star count (0–3) derived from `bestTrialScore`, but the raw percentage is not visible. Players have no way to know if their 2-star score was 41% or 74%.

**Why it matters:** Players who want to improve their score need the number to know how close they are to the next tier.

**How:** In `TrialsView`, below the star display, show the best score percentage: `{Math.round(bestTrialScore[trial.id] * 100)}%` in a small muted font. This is read from existing store state with no new logic.

**Files:** `src/views/TrialsView.tsx`.

### 6.2 Consider a "personal best" banner in the result screen

**What:** When `completeTrial` stores `Math.max(existing, new)`, the player achieved a new personal best if `score01 > bestTrialScore[trialId]` (pre-update). Surface this on the `TrialModal` result screen: "New Best! ★★★" instead of just "Trial Complete."

**How:** In `TrialModal`, read `bestTrialScore[trialId]` before calling `completeTrial`, compare to the new score after, and conditionally render a "New Best!" badge. This is purely display logic in `TrialModal.tsx`.

**Files:** `src/components/trials/TrialModal.tsx`.

---

## 7. Suggested Implementation Order

Work in this sequence to keep each step testable and independently releasable:

| Step | Improvement | Files Touched | Effort |
|------|-------------|---------------|--------|
| 1 | **Fix the core mechanic** (1.1) — move zone off cap, add overshoot = 0 | `armoryBreak.ts`, `MashMeter.tsx`, `trials.test.ts` | Small |
| 2 | **Fix pointer capture** (3.1) — remove `onPointerLeave`, add `setPointerCapture` | `ArmoryBreak.tsx` | Tiny |
| 3 | **Stabilize handleRelease ref** (5.2) | `ArmoryBreak.tsx` | Tiny |
| 4 | **Decouple MashMeter** (5.1) — add zone props | `MashMeter.tsx`, `ArmoryBreak.tsx` | Small |
| 5 | **Per-lock difficulty** (1.2) — LOCK_CONFIG array | `ArmoryBreak.tsx` | Small |
| 6 | **Inter-lock pause** (2.2) — 400 ms transition window | `ArmoryBreak.tsx` | Small |
| 7 | **Button held state** (3.2) + **live score hint** (3.3) | `ArmoryBreak.tsx` | Tiny |
| 8 | **Animate lock crack** (4.2) + **in-zone glow** (4.3) | `MashMeter.tsx` | Small |
| 9 | **Completion state** (4.4) — brief "Cracked!" beat | `ArmoryBreak.tsx` | Small |
| 10 | **Audio** (4.1) — charge, crack, miss, fanfare sounds | `ArmoryBreak.tsx`, `sfx.ts` | Medium |
| 11 | **Auto-claim on finish** (3.4) | `TrialModal.tsx` | Small |
| 12 | **Surface best score** (6.1) + **PB banner** (6.2) | `TrialsView.tsx`, `TrialModal.tsx` | Tiny |
| 13 | **Reward balance tuning** (2.1) — adjust stars/XP if needed | `trials.ts` | Tiny |

**Do steps 1–3 together** — they are all small, non-visual, and fix the two most significant correctness problems (mechanic ceiling, pointer capture, stale closure). Playtest after step 5 before continuing with polish.

**Audio (step 10) can be pulled earlier** if sound design assets are already available — it has no code dependencies on the other steps.

**Steps 11–13 are independent of each other** and can be done in any order or batched into a single PR.
