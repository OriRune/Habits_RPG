# Last Stand — Minigame Analysis

> **Purpose of this document:** A developer-facing overview of the Last Stand minigame as it exists after all implemented improvements. All facts are drawn from the current source files. Section 11 flags anything that required inference or that is not yet fully confirmed.

---

## 1. Basic Summary

Last Stand is a reflex-based trial in the Skill Trials system. The player watches incoming attacks that telegraph their direction (Left, Center, or Right) and presses the matching key or button to block them. It is one of eight daily Skill Trials, each mapped to one of the game's eight stats. Last Stand is the trial for the **HP stat**.

The game is scored on **reaction speed**, not just block count. Blocking an attack the instant it appears earns a higher speed factor than blocking it at the last moment. The resulting score (0–1) is converted to a star rating (1–3 ★) and translated into HP stat XP and gold. Daily gating means the reward can only be claimed once per calendar day.

---

## 2. Core Game Loop

### Start

The player opens the Skills tab, selects the Last Stand trial card, reads an intro screen that describes the rules, and presses **Begin Trial**. The game component mounts and immediately enters a `'countdown'` phase.

### Countdown

A 3 → 2 → 1 countdown is displayed (one second per beat) before the RAF loop starts. The 3 s countdown ensures the player is oriented before the first attack appears. The timer bar does not run during countdown.

### During Play

A fixed set of 16 attacks is pre-generated at component mount using a seeded LCG RNG (`seededRng(Date.now())`). Each attack carries a direction, a scheduled landing time, and a wave index. Attacks appear on screen `SPAWN_AHEAD_MS` (1400 ms) before they land. As the attack approaches, a per-column timer bar fills from empty to full and the sword emoji scales from 0.6× to 1.0×. The three block buttons glow when an attack is in their block window.

The player presses the matching directional button (keyboard or pointer) to block. A block is accepted from the moment the attack appears (`elapsed ≥ landMs − SPAWN_AHEAD_MS`) through one frame past landing (`elapsed ≤ landMs + BLOCK_GRACE_MS = 16 ms`). This is the full visible lifetime of the attack.

If no block arrives, the RAF loop resolves the attack as a hit after the one-frame grace expires. Each hit deals `DAMAGE_PER_HIT` (14) HP and triggers a damage flash. The attack display shows 🛡️ and a "Perfect! / Good / Late" label on a block, or 💥 on a hit, each fading after ~400–600 ms.

The 16 attacks are spread across 8 waves of 2 per wave. Within each wave the two attacks always target **different** directions (guaranteed by re-rolling until unique). Wave offset spacing is 1200 ms (`WAVE_INTERVAL_MS / ATTACKS_PER_WAVE`). The first attack lands at 1400 ms and the last at ~19 400 ms; a full run takes about 19–20 seconds.

### End

The loop exits on whichever comes first:
- **All 16 attacks resolved** (by block or hit) — win/survive. This is detected unconditionally each frame, which correctly handles the "all blocked" case where no new hits ever trigger.
- **HP drops to 0** — early exit; any attacks still pending remain unresolved.

An appropriate SFX plays (`'win'` or `'defeat'`) and the score is computed. The result screen (owned by `TrialModal`) then shows the star rating, score, and reward breakdown.

### Rewards

- **Score:** Mean reaction-speed factor across all *resolved* attacks (see §4 Scoring). Range 0–1.
- **Stars:** ≥ 0.75 → 3★ · ≥ 0.40 → 2★ · < 0.40 → 1★ (`scoreToStars` in `trials.ts`)
- **Stat XP:** `round((20 + 8 × level) × (0.25 + 0.75 × score))`
- **Gold:** `round((15 + 5 × level) × (0.25 + 0.75 × score))`
- A 25% participation floor ensures some reward even on a 0 score.
- `completeTrial` stamps the daily gate and updates the personal best.

---

## 3. Player Controls and Interaction

### Input Controls

| Action | Keyboard | On-screen button |
|---|---|---|
| Block Left | `ArrowLeft` or `A` | "← Left" button |
| Block Center | `Space` or `S` | "▲ Center" button |
| Block Right | `ArrowRight` or `D` | "→ Right" button |

All keyboard events call `e.preventDefault()` to suppress browser scrolling. The keyboard handler is attached to `window` with a `keydown` listener. Mouse/touch uses the three `<Button>` components.

### UI Elements

| Element | Description |
|---|---|
| HP bar | Horizontal bar at the top; color-coded green (> 60%), amber (30–60%), red (< 30%). Label reads "❤️ HP". |
| Damage flash | When HP is lost: the HP percentage text turns red, a "−14" damage number fades in beneath the bar, and a semi-transparent red border flashes around the game panel edge. |
| Attack display | Three columns (left / center / right). Each shows a ⚔️ sword emoji (scaling 0.6× → 1.0× as attack approaches), a thin timer bar that fills left-to-right (green → amber → red as urgency increases), and a directional arrow emoji label. |
| Feedback flash | On block: sword swaps to 🛡️ with green drop-shadow glow; column shows a "Perfect! / Good / Late" label in emerald / gold / amber, lasting ~600 ms. On hit: sword swaps to 💥 with red drop-shadow glow. |
| Block buttons | Three `<Button>` elements below the display. When an attack's block window is open, the matching button pulses with a gold ring highlight (`ring-2 ring-gold-bright/80`) and scales up 5%. Disabled after game end. |
| Blocked counter | Text below the buttons: "Blocked: X / 16" during play; "X / 16 attacks blocked" after finish. The denominator is always 16 (total scheduled attacks). |
| Keyboard hint | Static footer listing key bindings. |
| Countdown overlay | 3 → 2 → 1 displayed full-screen in the game panel before the run begins. |

### Player Feedback Summary

| Event | Visual | Audio |
|---|---|---|
| Block lands | 🛡️ glow, green flash, rating label, button highlight | `'lastStandBlock'` |
| Attack hits | 💥 glow, red flash, damage number, panel border flash, HP bar shrinks | `'playerHurt'` |
| Survive | End screen via TrialModal | `'win'` |
| Die | End screen via TrialModal | `'defeat'` |

---

## 4. Mechanics and Systems

### Attack Generation (`generateAttacks`)

```
TOTAL_WAVES        = 8
ATTACKS_PER_WAVE   = 2
WAVE_INTERVAL_MS   = 2400
SPAWN_AHEAD_MS     = 1400   (when the sword first appears)
BLOCK_GRACE_MS     = 16     (one-frame grace after landing)
```

Landing times (ms from run start):
- Wave 0: 1400 ms, 2600 ms
- Wave 1: 3800 ms, 5000 ms
- …
- Wave 7: 18 200 ms, 19 400 ms

Direction is chosen from `['left', 'center', 'right']` using the seeded RNG. The two attacks within each wave are **always** assigned different directions (the second is re-rolled until it differs from the first). This guarantees every wave presents a genuine two-lane challenge.

### Blocking Logic (`block` function)

When the player inputs a direction, the function finds the earliest unresolved attack in that direction whose block window is open:

```ts
el >= a.landMs - SPAWN_AHEAD_MS && el <= a.landMs + BLOCK_GRACE_MS
```

The window opens the instant the attack appears on screen and closes one frame after landing. There is no dead zone between spawn and window open — input is always accepted during the full visible lifetime of an attack. The blocked attack is stamped with `result: 'blocked'` and `blockedAtMs: el` (ms from run start at time of block), then written back to both `attacksCopy.current` and `attacks` state.

### Reaction Speed and Scoring

**`reactionSpeed(landMs, blockMs)`** — pure function in `lastStand.ts`:

```ts
const margin = landMs - blockMs;
return Math.max(0, Math.min(1, margin / SPAWN_AHEAD_MS));
```

A block at spawn → speed 1.0. A block at landing → speed 0.0. Linear between.

**`reactionRating(speed)`** — maps speed to a display label:

| Threshold | Rating |
|---|---|
| `speed >= REACTION_PERFECT` (0.66) | `'perfect'` → "Perfect!" (green) |
| `speed >= REACTION_GOOD` (0.33) | `'good'` → "Good" (gold) |
| below | `'late'` → "Late" (amber) |

**`lastStandScore(blockSpeeds, resolved)`** — final score:

```ts
// blockSpeeds: reactionSpeed value for each blocked attack.
// Misses contribute 0 via the denominator without a corresponding numerator entry.
if (resolved === 0) return 0;
const sum = blockSpeeds.reduce((a, b) => a + b, 0);
return Math.min(1, sum / resolved);
```

The denominator is `resolved` (attacks that actually reached a conclusion, blocked or hit), not 16. A player who dies after resolving only 8 attacks is scored on those 8, so early death no longer penalises unplayed attacks. Missing an attack contributes 0 to the numerator but 1 to the denominator — misses still hurt, but only in proportion to what the player actually faced.

**Score examples:**

| Play | blockSpeeds | resolved | Score |
|---|---|---|---|
| All 16 blocked instantly | [1.0 × 16] | 16 | 1.00 (3★) |
| All 16 blocked at mid-window | [0.5 × 16] | 16 | 0.50 (2★) |
| 12 blocked at speed 1.0, 4 missed | [1.0 × 12] | 16 | 0.75 (3★) |
| All 16 blocked at last instant | [~0.01 × 16] | 16 | ~0.01 (1★) |
| Died after 8: 6 blocked fast, 2 hit | [1.0 × 6] | 8 | 0.75 (3★) |

### Difficulty Data (`BLOCK_WINDOW_BY_WAVE`)

The engine module defines a per-wave block window array `[750, 720, 690, 660, 620, 580, 540, 500]` (ms) and the helper `blockWindowForWave(wave)`. These are covered by unit tests but are **not currently used by the component's input logic** — after the block-window dead-zone fix, input acceptance was widened to the full spawn period (`SPAWN_AHEAD_MS`). The data remains in the engine for potential future use (e.g., stat-level scaling from §6.1 of the improvement plan).

Effective difficulty ramp in the current build comes from the scoring model: reacting early earns a high speed factor regardless of wave; reacting late earns a low one. The visual timer bar makes this concrete — players can see how much time they used.

### Damage

Each `'hit'` result deals **14 HP**. Starting HP is 100. Maximum hits before death: 7 (7 × 14 = 98; 8 × 14 = 112 > 100). To reach 3★ via block count alone requires blocking ≥ 12 of 16, well inside the death threshold. With the speed-dominant scoring, 3★ requires consistent early reactions even on a perfect-block run.

### Win / Loss Conditions

The RAF loop checks for end conditions each frame:

1. **Death** (inside `if (changed)`): if `newHp <= 0`, set phase `'done'`, call `finish(next, true)`, cancel RAF.
2. **All resolved** (unconditional): if `next.every(a => a.result !== null)`, set phase `'done'`, call `finish(next, false)`, cancel RAF.

The unconditional check is required to catch the "all blocked" case where `changed` is never set to `true` (no attack ever auto-resolves as a hit), which was a previous termination bug.

### Integration with the Larger Game

- **Daily gate:** `trialsClearedOn['last_stand']` is checked against today's ISO date. `settings.repeatMinigames` dev flag bypasses this.
- **Stat:** `HP`. Score flows into `trialReward('HP', score, level)` → `{ gold, statXp: { HP: n } }`.
- **Best score:** `bestTrialScore['last_stand']` is updated to the max of stored and new. Used on the hub card to display stars.
- **Level-up:** `checkLevelUp` is called after `applyReward`; the trial can trigger a level-up.

---

## 5. Technical Implementation

### Files

| File | Role |
|---|---|
| `src/engine/trials/lastStand.ts` | Pure engine: constants, `Attack` interface, `seededRng`, `generateAttacks`, `reactionSpeed`, `reactionRating`, `lastStandScore`, `blockWindowForWave` |
| `src/components/trials/games/LastStand.tsx` | React component: phase state machine, RAF loop, input handler, render |
| `src/components/trials/TrialModal.tsx` | Shell hosting all eight trials; handles intro / result stages and reward claim |
| `src/engine/trials/trials.ts` | Trial registry: `TRIALS`, `scoreToStars`, `trialReward`, gate helpers |
| `src/store/useGameStore.ts` | `completeTrial` action; `trialsClearedOn` and `bestTrialScore` state |
| `src/engine/trials/__tests__/trials.test.ts` | 160 tests covering `trialReward`, `scoreToStars`, all eight trial engines including Last Stand |

### Key Engine Exports (`lastStand.ts`)

| Export | Type | Description |
|---|---|---|
| `TOTAL_WAVES` | `8` | Wave count |
| `ATTACKS_PER_WAVE` | `2` | Attacks per wave |
| `WAVE_INTERVAL_MS` | `2400` | ms between wave starts |
| `SPAWN_AHEAD_MS` | `1400` | ms before landing when attack appears |
| `DAMAGE_PER_HIT` | `14` | HP lost per missed attack |
| `STARTING_HP` | `100` | Starting HP |
| `BLOCK_GRACE_MS` | `16` | One-frame grace window after landing |
| `BLOCK_WINDOW_BY_WAVE` | `number[]` | Per-wave block window data (not used for input gating in current component) |
| `REACTION_PERFECT` | `0.66` | Speed threshold for "Perfect!" rating |
| `REACTION_GOOD` | `0.33` | Speed threshold for "Good" rating |
| `type ReactionRating` | `'perfect' \| 'good' \| 'late'` | Rating label type |
| `seededRng(seed)` | `() => number` | Seeded LCG; pass `Date.now()` in production |
| `generateAttacks(rng)` | `Attack[]` | Full 16-attack schedule with unique-direction-per-wave guarantee |
| `reactionSpeed(landMs, blockMs)` | `number` | Speed factor 0..1 for a blocked attack |
| `reactionRating(speed)` | `ReactionRating` | Maps speed to display label |
| `blockWindowForWave(wave)` | `number` | Per-wave block window (used in tests) |
| `lastStandScore(blockSpeeds, resolved)` | `number` | Final score 0..1 |

### Key Component Functions (`LastStand.tsx`)

**`block(dir)`** (`useCallback`) — accepts input if phase is `'running'`; finds the earliest unresolved attack in the given direction with an open block window; stamps it `result: 'blocked'` and `blockedAtMs: el`; computes and flashes the reaction rating; plays `'lastStandBlock'` SFX. Reads from refs (`elapsedRef`, `attacksCopy`) to avoid stale closures.

**`finish(finalAttacks, died)`** (`useCallback`) — builds `blockSpeeds[]` from `blockedAtMs` values, counts `resolved`, calls `onFinish(lastStandScore(blockSpeeds, resolved))`, plays win/defeat SFX.

**RAF loop** (`useEffect`, only runs when `phase === 'running'`) — each frame: advances `elapsedRef`; auto-resolves expired attacks as hits; applies HP damage with feedback effects; checks death (inside `if (changed)`) and all-resolved (unconditional). Cancels itself on unmount or phase change.

**`triggerFeedback(dir, type)`** (`useCallback`) — sets `feedback[dir]` to `'blocked'` or `'hit'`; clears after 400 ms.

**`triggerDamageFlash()`** (`useCallback`) — sets `damageFlash` true; clears after 350 ms.

### State Management

The component uses a dual ref/state pattern: `useState` for render-driven values (`attacks`, `hp`, `elapsed`, `phase`, `countdown`, `feedback`, `ratingFeedback`, `damageFlash`) and `useRef` for values the RAF loop reads without triggering re-renders (`attacksCopy`, `hpRef`, `elapsedRef`, `startMs`, `rafRef`, `phaseRef`). The ref copies are kept in sync manually after every mutation — a latent maintenance risk if a future change updates one and forgets the other. (Consolidating to a single source of truth was noted in the improvement plan as a deferred refactor.)

Pending timers are tracked in `pendingTimers.current` and all cleared on component unmount to prevent state-update-after-unmount warnings.

### Data Flow

```
Date.now() → seededRng() → generateAttacks() → attacks state + attacksCopy ref

RAF tick → elapsed → incoming[] (derived) → timer bar progress in render
         → expire check → attacks + hp updated → triggerFeedback / triggerDamageFlash
         → allDone or death → finish() → onFinish(score01) → TrialModal.handleFinish
                                                            → stage = 'result'
                                                            → store.completeTrial() on claim

block(dir) → blockedAtMs stamp → reactionSpeed / reactionRating
           → ratingFeedback flash → attacks updated → attacksCopy updated
```

### Save / Load

No mid-game save. The store persists `trialsClearedOn` and `bestTrialScore` to `localStorage` via Zustand `persist`. Closing the tab mid-game abandons progress silently.

### Configuration

All timing constants and game parameters live in `src/engine/trials/lastStand.ts` as named exports. The trial registry entry (stat, name, blurb, glyph) lives in `src/engine/trials/trials.ts`.

---

## 6. Software, Libraries, and Tools Used

| Concern | Technology |
|---|---|
| Framework | React 18 (hooks: `useState`, `useEffect`, `useRef`, `useCallback`) |
| Language | TypeScript |
| Build / bundler | Vite |
| Styling | Tailwind CSS v3 (utility classes; custom tokens: `text-ink-muted`, `bg-parchment-300/50`, `text-gold-bright`) |
| State management | Zustand with `persist` middleware |
| Rendering | DOM / HTML — no canvas, no WebGL |
| Animation loop | `requestAnimationFrame` (browser native) |
| CSS transitions | Width transition on HP bar; `scale()` + `filter: drop-shadow` on sword emoji; `opacity` transitions on damage flash, rating labels, and panel border flash |
| Physics | None — purely timed events |
| Audio | `src/lib/sfx.ts` — `sfxPlay('lastStandBlock')`, `sfxPlay('playerHurt')`, `sfxPlay('win')`, `sfxPlay('defeat')` |
| RNG | Seeded LCG via `seededRng(Date.now())` (same algorithm used across all trial engine files) |
| Test runner | Vitest (160 tests in `trials.test.ts`) |
| UI primitives | `<Button>` from `src/components/ui/Button` |

---

## 7. Assets and Presentation

Last Stand uses no image assets, sprite sheets, canvas art, or external audio files. The visual presentation is emoji and Tailwind-styled HTML.

- **Incoming attack indicator:** ⚔️ emoji, scale-animated from 0.6× to 1.0× as attack approaches.
- **Block confirmation:** 🛡️ emoji with `drop-shadow(0 0 6px #34d399)` green glow filter.
- **Hit confirmation:** 💥 emoji with `drop-shadow(0 0 6px #f87171)` red glow filter.
- **Reaction rating label:** "Perfect!" / "Good" / "Late" text in emerald / gold / amber, fades in and out per column.
- **Timer bar:** Per-column thin bar (`h-1.5`) filling from empty to full; color shifts green → amber → red at 45% and 75% progress.
- **HP bar:** Width-animated `<div>` shifting through three color classes.
- **Damage number:** "−14" text fading in / out beneath the HP bar on hit.
- **Panel edge flash:** Semi-transparent `border-rose-500` absolutely positioned over the game panel; opacity transition on damage.
- **Active button highlight:** `ring-2 ring-gold-bright/80 bg-gold-deep/20 scale-105` on buttons whose block window is open.
- **Trial icon / glyph:** 🛡️ (shown in the TrialModal header and result screen).

**Mood:** Functional with clear visual feedback for every game event. Emoji-based rather than illustrated, but each event (block, hit, near-miss) now has a distinct visual signature. No particle effects, canvas art, or musical beat.

---

## 8. Current Player Experience

### What Works

- **Clear concept:** Three-direction blocking is immediately legible. New players can understand the goal from the layout alone.
- **Feedback is now present and distinct.** Every game event — block, hit, damage, perfect reaction — has its own visual and audio response. Blocks feel satisfying; hits feel consequential.
- **Reaction speed is the skill axis.** Players who internalize timing and block early are rewarded with higher scores. Players who block "just in time" consistently will see "Late" labels and lower star ratings even on a perfect-block run, giving a clear target for improvement.
- **No dead zone.** Input is accepted from the moment an attack appears, so the timer bar and block window are always in sync. There are no frames where the bar is moving but input is silently rejected.
- **Countdown before attack.** The 3-2-1 countdown means the player is never surprised by the first wave.
- **Fair death scoring.** Dying early is scored on `resolved` attacks, not all 16, so a player who blocked everything they faced but died still gets credit for what they did.
- **Keyboard controls are well-chosen.** WASD / arrows map naturally to left/center/right.
- **Short session.** ~19 seconds is fast; the trial never overstays its welcome.
- **Direction variety per wave.** Every wave always presents two different directions, ensuring each wave is a genuine two-button challenge.

### What Still Feels Weak

- **Flat attack pacing.** All 8 waves are identically timed. There is no tempo increase, no final burst, no rest beat. The visual sense of escalation comes only from the scoring pressure (you need faster reactions to maintain your score), not from the wave design itself.
- **BLOCK_WINDOW_BY_WAVE is defined but not active.** The difficulty-ramp data exists in the engine and is tested, but the component accepts input for the full 1400 ms spawn period regardless of wave. This means the data does no gameplay work in the current build.
- **Dual state/ref bookkeeping is still present.** `attacks` state and `attacksCopy.current` ref are kept in sync by hand. This is a latent correctness risk if a future edit forgets to update both.
- **No mid-run save.** Closing the tab abandons progress silently, with no warning.

### Pacing

The 3-second countdown is dead time, intentionally so. After the first wave (1.4 s elapsed) the run is active and steady. No crescendo, no rest beat between waves.

### Difficulty Fairness

The block window is the full 1400 ms spawn period — generous by rhythm-game standards. Novices can focus on survival (block anything before landing). Experts aim for early reactions to drive up the speed factor. The 3★ threshold at 0.75 mean speed requires consistent above-midpoint reaction times across all resolved attacks — achievable but not trivial.

---

## 9. Known Issues and Remaining Gaps

### Design

1. **No pacing ramp.** 8 waves feel identical in tempo. The scoring model creates latent difficulty but there is no felt escalation — late waves don't feel harder than early ones at the mechanical level.
2. **`BLOCK_WINDOW_BY_WAVE` is dormant.** Defined and tested in the engine, but the component's input logic uses `SPAWN_AHEAD_MS` as the open time, so the per-wave window data has no effect. If the intent was to tighten the input window on later waves, that behavior was removed when fixing the dead-zone bug and has not been re-introduced.
3. **No choreographed wave design.** Beyond the unique-direction-per-wave guarantee, wave sequences are fully random. There is no deliberate arrangement of "hard" or "easy" waves, no call-and-response rhythm, no designed combo sequences.

### Technical

4. **Dual state/ref pattern.** `attacks` (useState) and `attacksCopy.current` (useRef) must be kept in sync manually. A single divergence would cause rendering or logic errors. Deferred from the improvement plan's Pass 4.4 consolidation step.
5. **No mid-run save.** Tab close abandons progress without a warning or partial credit.
6. **`BLOCK_WINDOW_BY_WAVE` is technically dead code** in the component. Its only live consumers are `blockWindowForWave` in `lastStand.ts` (which the component no longer imports) and the engine tests. If stat-level scaling is never added, it should eventually either be put to use or removed.

---

## 10. Remaining Improvement Opportunities

These items were either out of scope for the completed passes or explicitly deferred.

### Integration (Improvement Plan §6)

- **Scale block window with HP stat level (§6.1):** The engine already exposes `BLOCK_WINDOW_BY_WAVE` and `blockWindowForWave`. An `effectiveBlockWindow(hpLevel)` function could tighten the input window for lower-level characters or widen it for high-level ones, creating a mechanical link between the HP stat and the trial that exercises it. This would also activate the dormant `BLOCK_WINDOW_BY_WAVE` data. Requires design sign-off on the scaling formula.
- **Verify hub card best-score display (§6.2):** `bestTrialScore['last_stand']` is stored and updated correctly in the store. Whether the hub card for Last Stand renders it as stars has not been confirmed from source.
- **Daily gate UX (§6.3):** When the trial is already cleared today, the intro screen may still open without making the locked state immediately clear.

### Polish and Visual

- **Lane layout redesign (§4.4 of improvement plan):** Replace the current floating emoji columns with bounded lane tracks (attacks travel down a track toward a block zone). This is the largest remaining visual change and was deferred as lowest priority. The current layout is functional but not as spatially intuitive as a classic rhythm-game design.

### Code Quality

- **Consolidate dual state/ref pattern (§5.4 of improvement plan):** Replace parallel `attacks` / `attacksCopy.current` with a single authoritative source to eliminate the manual sync requirement.

---

## 11. Questions and Unknowns

1. **Should `BLOCK_WINDOW_BY_WAVE` be re-activated?** The difficulty-ramp data was added as part of Pass 5 but was rendered dormant when the block-window dead-zone bug was fixed by widening the input window to `SPAWN_AHEAD_MS`. Three options exist: (a) leave it dormant and rely on scoring pressure for difficulty; (b) re-introduce it as a visual-only cue (e.g., the timer bar changes color earlier on later waves without gating input); (c) re-activate it as an input gate but only in a stat-scaling context (§6.1) where the player has consented to tighter windows. No decision has been made.

2. **Does the hub card render `bestTrialScore['last_stand']` as stars?** The store correctly tracks this value and updates it after each run, but the hub card render was not confirmed during any of the improvement passes.

3. **Is the daily-gate UX clearly surfaced?** When a trial is already cleared, `completeTrial` is a no-op and no reward is issued, but what the player sees when they open a cleared trial intro was not confirmed. This may be handled by `TrialModal` already, or it may silently allow the trial to run without rewarding.
