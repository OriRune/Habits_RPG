# Armory Break — Minigame Analysis

*Updated after implementation of improvement plan. Reflects current codebase state.*

---

## 1. Basic Summary

Armory Break is a timing-based Skill Trial in HabitsRPG. It represents the **Strength (ST)** stat and is one of eight daily minigames accessible from the Trials hub once the player reaches level 3 (`TRIALS_UNLOCK_LEVEL`).

The core premise: the player holds a button to charge a power needle upward on a vertical meter, then releases when the needle is inside a golden zone in the **middle** of the meter. The needle passes through the zone and continues to the top — holding too long is a miss, same as releasing too early. They repeat this for three locks of rising difficulty. The final score is the average accuracy across all three locks, scaled to a 0–1 value that drives ST XP and gold rewards.

Within the larger game, Armory Break fills the daily habit loop: completing it grants stat XP toward Strength and a gold payout, both scaling with score and character level. It is gated to one attempt per calendar day (unless the `repeatMinigames` dev setting is on) and slots neatly beside the seven other stat-specific trials in `TrialsView`.

---

## 2. Core Game Loop

**Starting the trial:**
The player opens the Trials hub (`TrialsView`), clicks the Armory Break card, and reads a brief description in the `TrialModal` intro stage. They tap "Begin Trial" (which also unlocks the browser's AudioContext via `sfxResume()`) to start.

**Repeated action (per lock):**
For each of three locks, the player:
1. Presses and holds the "⚒️ Hold to Charge" button (or Space/Enter) — the power needle rises from 0 at the lock's configured `riseSpeed` (see Section 4). An `armoryCharge` sound plays at press time.
2. Releases inside the golden zone (60–80% of the meter) — `armoryAccuracy(power)` is computed at the moment of release. A crack or miss sound plays immediately.
3. The meter freezes to a color-coded state (emerald/amber/rose) with a 150ms color transition. If more locks remain, a 400ms pause follows before the next lock activates — giving the player a beat to read the result.

**The zone constraint:**
Releasing **below** 60% scores 0. Releasing **above** 80% also scores 0 (overshoot penalty). Maximum accuracy (1.0) is earned at the zone centre (70%). This is the fundamental mechanical difference from the original design: holding to the cap is no longer a winning strategy.

**Difficulty ramp:**
Each lock uses a different `riseSpeed` from `LOCK_CONFIG`. Lock 1 rises slowly (forgiving). Lock 2 is standard. Lock 3 rises fastest and its zone is 25% narrower, requiring tighter precision and faster reaction.

**Ending:**
After the third release, the button is replaced by an "⚒️ All Locks Cracked!" message. After a 600ms beat, `armoryScore(accuracies)` is computed and passed to `onFinish()`. The reward is **applied immediately** at this point — `TrialModal.handleFinish` calls `completeTrial(trialId, score01)` before transitioning to the result stage. No "Claim" action is required.

**Rewards and outcomes:**
```
statXp = round((20 + 8 * level) * (0.25 + 0.75 * score01))
gold   = round((15 + 5 * level) * (0.25 + 0.75 * score01))
```
A 0.25 participation floor ensures even a zero score yields roughly 25% of the maximum reward. The result screen shows stars, score percentage, and a "✨ New personal best!" badge when the run beats the previous record.

---

## 3. Player Controls and Interaction

**Input controls:**
- **Keyboard:** `Space` or `Enter` — hold to charge, release to lock in the reading. Registered via `window.addEventListener('keydown'/'keyup')` in `ArmoryBreak.tsx`. `e.repeat` is suppressed so holding the key does not re-fire `handlePress`.
- **Mouse / touch:** `onPointerDown` and `onPointerUp` on the charge button. Pointer capture (`setPointerCapture(e.pointerId)`) is acquired on pointer-down, so the button continues receiving events even if the pointer drifts off its bounds while held. There is no `onPointerLeave` handler — accidental drift no longer causes early release.

**UI elements (active play):**
- Three `MashMeter` components side by side, one per lock. The active lock's meter moves; completed locks are frozen in color.
- A gold-styled "⚒️ Hold to Charge" button below the meters, which visually darkens to an amber gradient with a gold ring and scale-95 press state while held, giving clear confirmation the press registered.
- The button dims to 40% opacity and is `disabled` during the 400ms inter-lock transition, preventing input during the pause.
- A status line below the button: shows "Lock 1 of 3 • Release in the golden zone" on the first lock; after each lock, switches to "Lock N of 3 • So far: Great, Missed, OK" — a running summary of results.
- Instructions above the meters: "**Hold** to charge. **Release** when the needle enters the golden zone."

**UI elements (completion):**
- "⚒️ All Locks Cracked!" replaces the button when the trial ends, displayed during the 600ms pre-result pause.
- On the `TrialModal` result screen: score %, stars, reward breakdown, optional "✨ New personal best!" line, a "Continue" button (reward already applied), then "Return to Trials."

**Player feedback during play:**
- **During charge:** the fill shifts from `parchment-400/60` to `gold-bright/60` and the needle line turns gold when entering the zone. The zone overlay shifts from 30% to 60% opacity and pulses (`animate-pulse`) while the needle is inside.
- **On release:** the active meter's fill freezes with a `transition-colors duration-150` ease. Color: emerald (`bg-emerald-500/70`) for accuracy ≥ 0.7 ("✓ Great"), amber (`bg-amber-400/70`) for ≥ 0.35 ("✓ OK"), rose (`bg-rose-500/70`) for < 0.35 ("✗ Missed"). The zone overlay is hidden on locked meters — the result color is the only visual on a frozen meter.
- **Sound:** `armoryCharge` (rising noise + sawtooth, ~0.9 s) on press; `armoryLockCrack` (metal snap) on a Good/OK release; `armoryLockMiss` (dull thud) on a miss; `armoryFinish` (4-note ascending fanfare) when all three locks are cracked.

---

## 4. Mechanics and Systems

### Scoring

`armoryAccuracy(releasePos: number): number` — defined in `src/engine/trials/armoryBreak.ts:17`:
```ts
if (releasePos < SWEET_ZONE_START) return 0;        // undercharge
if (releasePos > SWEET_ZONE_END)   return 0;        // overshoot
const centre = SWEET_ZONE_START + SWEET_ZONE_WIDTH / 2;
return 1 - Math.abs(releasePos - centre) / (SWEET_ZONE_WIDTH / 2);
```
- Zone: 0.60–0.80 (`SWEET_ZONE_START = 0.60`, `SWEET_ZONE_END = 0.80`, `SWEET_ZONE_WIDTH = 0.20`).
- Peak accuracy (1.0) at zone centre (0.70). Falls symmetrically to 0 at both zone edges.
- Releasing above 0.80 is treated identically to releasing below 0.60 — a miss.

`armoryScore(accuracies: number[]): number` (`armoryBreak.ts:25`):
- Sums all recorded accuracies and divides by `ARMORY_LOCKS` (3) — not by the number of non-zero hits.
- A player who hits one lock perfectly and misses two scores `1/3 ≈ 0.33`, not `1.0`.

**Star thresholds** (shared across all trials via `scoreToStars` in `trials.ts`):
| Stars | Score threshold |
|-------|----------------|
| ★★★   | ≥ 0.75 |
| ★★    | ≥ 0.40 |
| ★     | < 0.40 |

Getting 3 stars requires average accuracy ≥ 0.75 across all three locks, meaning consistently releasing within ~0.025 of the zone centre on most locks.

### Power Meter Physics

Managed by a `requestAnimationFrame` loop in `ArmoryBreak.tsx`. The rise speed is **per-lock** via `LOCK_CONFIG`:

```ts
// ArmoryBreak.tsx
const LOCK_CONFIG = [
  { riseSpeed: 0.70, zoneWidth: SWEET_ZONE_WIDTH },         // lock 1: 0→1 in ~1.43 s
  { riseSpeed: 1.00, zoneWidth: SWEET_ZONE_WIDTH },         // lock 2: 0→1 in ~1.00 s
  { riseSpeed: 1.40, zoneWidth: SWEET_ZONE_WIDTH * 0.75 }, // lock 3: 0→1 in ~0.71 s
] as const;

const FALL_SPEED = 0.5; // 1→0 in ~2.0 s when released, all locks
```

The rAF loop restarts with the correct `riseSpeed` each time `currentLock` changes (via a `useEffect` dependency on `[done, currentLock]`). Time to reach the **zone bottom** (60%) is approximately 0.86 s / 0.60 s / 0.43 s for locks 1–3.

The needle clamps at `1.0`. Holding past the zone top (0.80) scores 0 on release — overshoot is a miss, so the clamp has no exploitable benefit.

### Per-Lock Difficulty Progression

Lock 3's zone width is narrowed to `SWEET_ZONE_WIDTH * 0.75 = 0.15`, placing the zone at 60–75% of the meter (vs. 60–80% on locks 1 and 2). `MashMeter` receives this per-lock `zoneWidth` as a prop, so the golden overlay visually narrows on the third meter — the player can see the tighter target before they start that lock.

### Inter-Lock Pause

After each non-final lock, `handleRelease` sets `transitioning = true`, resets `power` to 0, and schedules a `setTimeout(400ms)` via `timerRef`. During this window:
- The rAF loop runs but the needle is at 0 and held is false — it idles at 0.
- The charge button is disabled and dimmed.
- The just-locked meter shows its result color; the next meter shows an empty bar with the zone overlay.
- After 400ms: `setCurrentLock(next.length)` and `setTransitioning(false)` trigger the rAF loop to restart at the new lock's speed.

### Timers

- **Inter-lock pause:** 400ms `setTimeout` via `timerRef`.
- **Finish delay:** 600ms `setTimeout` before `onFinish()` is called, giving the completion message time to display.
- Both timers are cancelled on component unmount via a `useEffect` cleanup.

### Randomization

None. Every attempt uses the same needle speeds, zone boundaries, and lock count. Outcomes are entirely determined by player timing. Each lock is fully deterministic: knowing Lock 3's speed (1.40 u/s) and target (60–75%) is sufficient to predict exactly when to release.

### Win / Loss Conditions

There is no failure state. The trial always ends after three releases and always grants at least the participation-floor reward. A player who misses all three locks scores 0 and receives ~25% of the maximum payout.

### Larger-Game Systems That Affect the Trial

- **Character level:** The reward formula scales with `character.level`, so higher-level characters earn more XP and gold per run.
- **`repeatMinigames` dev flag:** Bypasses the once-per-day gate.
- **`bestTrialScore`:** The store persists the best score per trial. Compared against the new score in `TrialModal.handleFinish` (before `completeTrial` updates it) to produce the "new best" flag.

---

## 5. Technical Implementation

### File Map

| File | Role |
|------|------|
| `src/engine/trials/armoryBreak.ts` | Pure engine: constants (`SWEET_ZONE_START`, `SWEET_ZONE_END`, `SWEET_ZONE_WIDTH`, `ARMORY_LOCKS`), `armoryAccuracy`, `armoryScore` |
| `src/components/trials/games/ArmoryBreak.tsx` | React component: animation loop, per-lock difficulty config, input handling, renders meters and button |
| `src/components/trials/MashMeter.tsx` | Reusable vertical meter component with configurable zone props |
| `src/components/trials/TrialModal.tsx` | Modal shell: intro → playing → result stages; auto-claims on `handleFinish` |
| `src/engine/trials/trials.ts` | Trial registry, `trialReward`, `scoreToStars`, `TRIALS_UNLOCK_LEVEL = 3` |
| `src/store/useGameStore.ts` | `completeTrial` action (daily gate, persist score, apply reward) |
| `src/views/TrialsView.tsx` | Hub grid showing all 8 trial cards with best score % next to stars |
| `src/lib/sfx.ts` | Sound synthesis: `armoryCharge`, `armoryLockCrack`, `armoryLockMiss`, `armoryFinish` |
| `src/engine/trials/__tests__/trials.test.ts` | Unit tests: `armoryAccuracy` (centre, edges, below, overshoot) and `armoryScore` |

### Key Functions

**`armoryAccuracy(releasePos)`** (`armoryBreak.ts:17`): Stateless pure function. Centre-peak curve — 1.0 at 0.70, 0 at both zone edges and outside the zone. Called once per lock on release.

**`armoryScore(accuracies)`** (`armoryBreak.ts:25`): Sums the array and divides by `ARMORY_LOCKS` (3). Called once on trial completion.

**`handleRelease`** (`ArmoryBreak.tsx:48`): `useCallback([done, onFinish])`. Reads `powerRef.current` and `accuraciesRef.current` (both refs, not stale state) to compute accuracy and build the next accuracies array. Plays lock sound, handles either the inter-lock pause or the final completion path (with `FINISH_DELAY_MS` timeout before `onFinish`).

**`handlePress`** (`ArmoryBreak.tsx:75`): `useCallback([done])`. Checks `transitioningRef.current` (ref, not state) to guard against input during the inter-lock pause. Sets held state and plays `armoryCharge`.

**rAF loop** (`ArmoryBreak.tsx:88`): `useEffect([done, currentLock])`. Restarts with the correct `riseSpeed` each time a new lock activates. Reads `heldRef.current` each frame to avoid stale closure. Updates both `power` state and `powerRef.current`.

**`handleFinish`** (`TrialModal.tsx:78`): Reads `prevBest` from the store before calling `completeTrial`, computes `isNewBest`, then transitions to the result stage. The reward is applied at this point — there is no separate claim step.

**`completeTrial`** (`useGameStore.ts`): Zustand action. Guards against duplicate clears using ISO date comparison. Calls `applyReward(next, reward)` and `checkLevelUp(next)`.

### State Management

All trial component state lives in `ArmoryBreak.tsx` local React state (`useState`). Nothing is persisted to the store mid-trial.

Refs shadow state values throughout:
| Ref | Shadows | Purpose |
|-----|---------|---------|
| `powerRef` | `power` | rAF loop reads current value without stale closure |
| `heldRef` | `held` | rAF loop reads held status |
| `accuraciesRef` | `accuracies` | `handleRelease` reads current array without closure dependency |
| `transitioningRef` | `transitioning` | `handlePress`/`handleRelease` guard without adding to `useCallback` deps |
| `lastTs` | — | Delta-time tracking for rAF; reset to `null` on lock transition |
| `rafRef` | — | cancelAnimationFrame handle |
| `timerRef` | — | setTimeout handle; cleared on unmount |

### Data Flow

```
User input (key/pointer)
  → handlePress: setHeld(true), sfxPlay('armoryCharge')
  → handleRelease: armoryAccuracy(powerRef.current) → acc
      → sfxPlay('armoryLockCrack' | 'armoryLockMiss')
      → [if last lock] setDone(true), sfxPlay('armoryFinish')
          → setTimeout(600ms) → onFinish(armoryScore(next))
              → TrialModal.handleFinish(score):
                  completeTrial(trialId, score) → store: applyReward → checkLevelUp
                  setIsNewBest(score > prevBest)
                  setStage('result')
      → [otherwise] setTransitioning(true), setTimeout(400ms) → setCurrentLock(next)
```

### Save / Load Behavior

The trial result is committed to localStorage the moment `onFinish` is called (via `completeTrial` in `TrialModal.handleFinish`). Closing the modal before this point (during play) loses the result, but closing after trial completion does not — the reward is already applied when the result screen appears.

### Configuration Constants

**`src/engine/trials/armoryBreak.ts`:**
```ts
ARMORY_LOCKS     = 3
SWEET_ZONE_WIDTH = 0.20   // active zone width (default; Lock 3 uses 0.15)
SWEET_ZONE_START = 0.60   // zone lower bound
SWEET_ZONE_END   = 0.80   // zone upper bound; releasing above this = miss
```

**`src/components/trials/games/ArmoryBreak.tsx`:**
```ts
LOCK_CONFIG = [
  { riseSpeed: 0.70, zoneWidth: 0.20 }, // lock 1
  { riseSpeed: 1.00, zoneWidth: 0.20 }, // lock 2
  { riseSpeed: 1.40, zoneWidth: 0.15 }, // lock 3
]
FALL_SPEED         = 0.5   // power/second while released
INTER_LOCK_PAUSE_MS = 400  // ms pause between locks
FINISH_DELAY_MS     = 600  // ms "All Locks Cracked!" beat before result screen
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
| Animation | Native `requestAnimationFrame` with delta-time physics; Tailwind `animate-pulse` for zone glow; `transition-colors duration-150` for lock-crack color ease |
| Audio | `src/lib/sfx.ts` — synthesised Web Audio API cues, zero asset files |
| Testing | Vitest |
| Asset pipeline | Inline emoji / Tailwind-generated elements (no external image assets) |

---

## 7. Assets and Presentation

**Visuals:**
- Three meters are pure CSS: a rounded container (`rounded-full`), a golden zone overlay (semi-transparent `bg-gold-bright/30` or `bg-gold-bright/60` + pulsing when active), a fill bar, and a needle line (`h-0.5`). The zone overlay is hidden on locked meters.
- No sprite images. All color comes from Tailwind tokens.
- The charge button is a gold gradient (`from-gold-bright to-gold-deep`) at rest, shifting to amber (`from-amber-600 to-amber-800`) with a gold ring and slight scale-down while held.
- Locked meters transition their fill color over 150ms (`transition-colors duration-150`) rather than snapping — the color change eases in on lock.

**Active animations:**
- Power bar and needle updated every rAF frame (~60 fps). Fill height has no CSS transition (explicitly `transition-none`) so it tracks the needle in real time without lag.
- Zone overlay pulses (`animate-pulse`) when the needle is inside the zone, providing a kinetic "release now" cue.
- Locked fill colors ease in over 150ms on the frame of locking.
- The button morphs visually (color + ring + scale) the moment the pointer or key is held.

**Completion:**
- "⚒️ All Locks Cracked!" text replaces the button and persists for 600ms before the result screen.

**Sound effects (all synthesised, no audio files):**
| Cue | Trigger | Character |
|-----|---------|-----------|
| `armoryCharge` | Button press | Rising noise sweep + sawtooth drone (~0.9 s) |
| `armoryLockCrack` | Release with acc ≥ 0.35 | Square wave punch + noise burst + sine decay |
| `armoryLockMiss` | Release with acc < 0.35 | Triangle thud + lowpass noise |
| `armoryFinish` | All 3 locks cracked | 4-note ascending fanfare (sine, staggered 70ms) |

**Music:** No trial-specific music.

**Overall style and mood:** Functional and clean, with enough tactile feedback (audio, held button state, pulsing zone, color transitions) to feel responsive. The ⚒️ emoji and name evoke physical strength but there is no environmental art or background context to reinforce the "armory" setting.

---

## 8. Current Player Experience

**What works well:**
- The core concept is now genuinely skillful. The zone is visible in the meter's middle, the needle visibly passes through it, and releasing late is punished — players must actively judge the right moment.
- Per-lock difficulty gives the three-lock structure meaning: Lock 1 teaches the mechanic at a forgiving pace; Lock 3 demands focused reaction.
- The pulsing zone overlay provides a clear kinetic cue ("it's here, release now").
- Sound design gives every interaction a physical weight: the charge hum builds tension; the crack/miss sounds provide instant clear feedback; the fanfare gives a satisfying close.
- The button's held state (amber + ring + shrink) confirms that the press registered — no more first-play uncertainty.
- The live status line ("So far: Great, Missed") gives the player running context heading into the next lock, especially useful before Lock 3.
- The 400ms inter-lock pause prevents the next lock from activating before the player has read the previous result.
- Auto-claim means the reward is never silently lost — it is applied the moment the third lock is cracked.
- The 600ms "All Locks Cracked!" beat provides a natural emotional resolution before the result screen.
- Keyboard support (Space/Enter) plus pointer capture covers PC and mobile without input bugs.

**What remains confusing or awkward:**
- The description says "aim for the centre of the zone for maximum accuracy" — this is accurate but abstract. A player on their first attempt may not immediately understand that overshooting is a miss until they experience it.
- No visual indication of Lock 3's narrower zone (the golden bar is slightly shorter) — subtle rather than obviously communicated as "this one is harder."
- Closing the modal during active play still discards the run without a confirmation prompt.

**What still feels unfinished:**
- No environmental art or thematic context. The trial could belong to any Strength-themed activity — the "armory" conceit is entirely in the name and emoji.
- No run-to-run variation. Every attempt at a given lock is mechanically identical. Experienced players will memorize exact timing windows.
- No indication of per-lock accuracy during the transition pause — the status line updates after the lock, but no numerical accuracy is shown (just Great/OK/Missed).

**Pacing:**
At full efficiency (releasing precisely at zone centre each time), all three locks take approximately 0.86 + 0.60 + 0.43 = ~1.9 seconds of hold time, plus two 400ms inter-lock pauses and one 600ms finish delay — roughly 4.5 seconds total from first press to result screen. This is brief but no longer trivially exploitable: a fast player who rushes Lock 3 will likely overshoot.

**Difficulty:**
The trial now has a real skill ceiling. Lock 3 (riseSpeed 1.40, zone 60–75%) gives a reaction window of approximately 107ms to release within the zone — achievable but demanding consistent attention. 3-star average accuracy (≥ 0.75) requires hitting consistently close to zone centre on all three locks.

---

## 9. Known Issues or Weak Points

**No per-run randomization:**
Every attempt is identical. A player who learns the Lock 3 timing window (approximately 0.43 s from zero, +107ms release window) can reproduce the same result mechanically. There is no variability to sustain long-term engagement.

**The "close during play" edge case:**
Closing `TrialModal` while the trial is in progress discards the run without confirmation. The reward is only safe once `onFinish` fires (after the third lock), at which point `completeTrial` has already been called. During play, nothing has been committed.

**Zone narrowing on Lock 3 is not clearly communicated:**
The meter's golden overlay is visually shorter on Lock 3, but the difference (20% vs. 15% bar height, i.e., roughly 4px on a 144px tall meter) is subtle. Players may not consciously register the change until a miss reveals it.

**No distinction between undershoot and overshoot in feedback:**
Both score 0 and display "✗ Missed." A player who over-holds on every Lock 3 attempt has no feedback telling them to release earlier vs. later. The label alone cannot disambiguate direction of error.

**Locked meter fill height is abstract:**
For a locked meter, the fill height is set to `lockedAccuracy` (0–1). An OK hit (acc=0.5) shows amber fill reaching 50% of the meter, which doesn't spatially correspond to where the needle was when released (it was inside the 60–80% zone). The display is a quality indicator, not a position replay.

**`MashMeter` still imports from `armoryBreak.ts` for defaults:**
`zoneStart` and `zoneWidth` are now props, but the defaults are imported from `armoryBreak.ts`. If `MashMeter` is ever reused for a trial with different zone semantics, the caller must explicitly pass props or the defaults will be wrong.

**No randomization within a session:**
`ARMORY_LOCKS = 3` is a named constant and could vary, but there is no per-run configuration. Three locks is always three locks.

**Three locks may feel short on mobile:**
The meters are `w-10 h-36` with `gap-6` between them. On very narrow screens (≤ 320px), the three-meter layout may be tight. The overall layout has not been explicitly tested at narrow breakpoints.

---

## 10. Improvement Opportunities

The following items were identified in the improvement plan but not yet implemented:

**Reward balance review (Plan 2.1):**
With the harder mechanic (overshoot penalty, Lock 3 narrowed zone), verify whether ≥ 0.75 for 3 stars is appropriately calibrated. A skilled player hitting near-centre on all three locks can still score > 0.75, but a first-time player may score 0 on Lock 3 overshoot. Playtesting a sample of users at various levels would validate whether the 3-star threshold (or XP values) should be adjusted for this trial specifically.

**Run-to-run variation (Plan section 10):**
Introduce seeded randomness — e.g., vary `riseSpeed` ±10% per lock per day, or add a brief visual distractor flash. This would make each daily run feel distinct even after the player has internalized the lock timings.

**Undershoot vs. overshoot feedback (new):**
The "✗ Missed" label does not tell the player which direction they missed. A directional label ("↑ Too late" / "↓ Too early") or a visual marker on the meter showing the approximate release position would help players correct their timing.

**Environmental art and thematic coherence:**
The gameplay feels generic — nothing visually places the player in an armory. A simple background element (a lock mechanism illustration, a stylized vault door, even a color scheme shift) would reinforce the Strength-trial identity.

**Confirmation on close during play:**
Add a "Leave trial? Your progress will be lost" dialog if the player taps ✕ while `stage === 'playing'`, matching the UX care applied to result auto-claim.

**Narrower-zone visual emphasis on Lock 3:**
Explicitly signal the difficulty increase on Lock 3 — e.g., a "⚠ Tighter zone" label below the third meter before it activates, or a distinct border color on the meter container.

---

## 11. Questions and Unknowns

**Reward balance after difficulty increase:**
The reward formula is shared across all eight trials and has not been re-evaluated since the mechanic change. Whether the current numbers feel proportionate after making Lock 3 genuinely harder is an open question that requires playtesting at multiple character levels.

**Mobile feel with the held-button visual:**
The amber gradient + ring + scale-95 while held uses `transition-all duration-75`. On low-end Android devices, this transition (though short) could add perceived latency between press and needle movement. It has not been benchmarked on real mobile hardware.

**Lock 3 reaction window feasibility across ages/devices:**
Lock 3's ~107ms release window is achievable for most players but may be frustrating on high-latency displays or touch devices with input lag. The 400ms fall-back time (if the player misses and the needle falls back below the zone) gives a second window on the way down — but `armoryAccuracy` doesn't distinguish falling vs. rising needle position. Whether players naturally discover the fall-back window is unknown.

**`ARMORY_LOCKS = 3` variability:**
The constant is named, suggesting it might be intended to vary (e.g., a harder tier with 4 locks). No mechanism exists today to change it.

**`MashMeter` reuse potential:**
The component now accepts `zoneStart` and `zoneWidth` props, making it genuinely reusable. Whether any planned future trial would use this component — or whether Armory Break remains its only consumer — is not documented.

**Three-star calibration:**
To earn 3 stars, a player needs average accuracy ≥ 0.75. This requires releasing within `(SWEET_ZONE_WIDTH/2) * (1 - 0.75) = 0.025` of zone centre on average across all three locks. On Lock 3, where the zone is narrower (width 0.15), the half-width is 0.075 and the ≥ 0.75 accuracy window is ±0.01875 around centre. This is a narrow tolerance that may make 3-star Lock 3 hits rare. Whether this is the intended distribution is untested.
