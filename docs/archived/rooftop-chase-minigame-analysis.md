# Rooftop Chase — Minigame Analysis (Updated)

> **Purpose of this document:** Understand the current state of the Rooftop Chase minigame — its mechanics, design strengths and weaknesses, and how it compares to games with similar loops — to inform a plan for improving it.
>
> **Revision note (June 2026):** This document has been updated through Phase 5 of the improvement plan. Phases 1–5 are complete. Resolved items are flagged **[RESOLVED]**; new systems added in the improvement plan are flagged **[NEW]**. Constants and phase descriptions reflect the current engine.

---

## 1. Overview

| Property | Value |
|---|---|
| **Type** | Side-scrolling endless runner |
| **Setting** | Medieval town rooftops |
| **Stat trained** | Agility (AG) — speed, evasion, reaction |
| **Duration target** | 1–3 minutes (confirmed: perfect run ≈ 92 s) |
| **Energy cost** | None (free daily trial) |
| **Gate** | Once per calendar day (best score tracked) |
| **Engine file** | `src/engine/trials/rooftopChase.ts` |
| **Hook** | `src/hooks/useChaseLoop.ts` |
| **UI component** | `src/components/trials/games/RooftopChase.tsx` |

The Rooftop Chase is the Agility trial. A side-scroller where the player leaps between buildings of a medieval town while a beast chaser closes from behind. The Phase 0 overhaul migrated all game logic to a pure reducer (`ChaseState` / `initChase` / `stepChase`) with a dedicated RAF-clock hook — the component is now a pure renderer.

---

## 2. The Gameplay Loop

**[UPDATED]** Phase boundaries have changed significantly from the prior analysis. The old analysis used `CHASE_TARGET_DISTANCE = 200` and `BASE_SPEED = 6`; both have been retuned. A perfect run now takes ≈ 92 seconds.

Speed follows: `speed(d) = min(MAX_SPEED, BASE_SPEED + SPEED_RAMP × d)` = `min(10, 4 + 0.010 × d)`.

Time to reach distance `d` is: `t(d) = 100 × ln(1 + d/400)` (integrating the ramp).

### Phase 1 — Opening Grace (0–22 wu, 0–5 s)
Hero spawns on a 22 wu wide grace platform with no obstacles. Speed is **4 wu/sec**. Chaser has not appeared. Lead is pinned at 50 wu. This is the free tutorial window — players learn jump and slide with zero consequence.

### Phase 2 — Pre-Chase Escalation (22–120 wu, 5–26 s)
The hero clears the grace platform and begins jumping across buildings. Speed climbs from **4.2 → 5.2 wu/sec**. The chaser has not yet appeared (it spawns at 120 wu). Gaps early in this range are naturally tight (~4.7 wu) because the course generator clamps them to the hero's clearable arc at that scroll speed. Gaps open up to ~6 wu by 120 wu.

### Phase 3 — Chase Begins (120–300 wu, 26–51 s)
**[UPDATED]** The chaser spawns at **120 wu** (the prior analysis said 45 wu — this was from an old constant). Lead begins draining at **4.5 wu/sec**. Speed climbs from 5.2 → 7 wu/sec. Gaps have grown to 6–8 wu. The first dash becomes available immediately and covers one stumble worth of lead (12 → +16 net). The player must now juggle reading obstacles and tracking the lead bar.

### Phase 4 — High Stakes (300–600 wu, 51–92 s)
Speed climbs from 7 → **10 wu/sec**, reaching the cap exactly at the target distance. Gaps scale from 8 up to **11.7 wu** (85% of maximum clearable arc). Reactions dominate over planning. Every stumble costs 2.67 seconds of lead buffer; dashes are the primary recovery tool.

### Phase 5 — End Condition
The run ends when any of the following occur:
- **Lead hits 0** (hero is caught by the chaser)
- **Hero falls into a gap** (below the next roof's elevation — instant)
- **Hero reaches 600 wu** (perfect score)

Score = `distance / 600`, clamped to 0–1.
Stars: ≥ 0.75 = 3★ (450+ wu), ≥ 0.40 = 2★ (240+ wu), < 0.40 = 1★.

---

## 3. Controls & Mechanics

### 3.1 Movement

| Input | Action | Notes |
|---|---|---|
| Space / ↑ | Jump | `JUMP_VELOCITY` = 22 wu/sec upward |
| Space / ↑ (airborne) | Double-jump | `DOUBLE_JUMP_VELOCITY` = 18 wu/sec; max 2 jumps total |
| ↓ / S (grounded) | Slide | Crouches hero for 450 ms; ground-only; cancelled on leaving ground |
| Shift / D | Dash | Speed burst: +40% for 380 ms; 2600 ms cooldown |

### 3.2 Obstacles

| Obstacle | Frequency | How to clear | Failure |
|---|---|---|---|
| **Hazard** (spikes) | 40% of props | Be airborne | Stumble: −12 lead, 480 ms stagger |
| **Mook** (guard) | 35% of props | Jump over, or stomp head while descending | Stumble if grounded; stomp bounces hero upward |
| **Lowbar** (banner) | 25% of props | Slide | Running or jumping into it causes stumble |

### 3.3 Lead Economy **[UPDATED — Phase 3 rebalance]**

| Event | Lead change |
|---|---|
| Chaser closing (per sec, once active) | −4.5 |
| Stumble | −12 |
| Stomp a mook | **+9** *(was +4)* |
| Chain-stomp bonus (2nd+ consecutive stomp without landing) | **+2 extra per stomp in chain** |
| Clean slide (lowbar cleared while actively sliding) | **+1** |
| Dash | +16 |

Stomp now rivals a dash at +9 (was +4). Chain stomps reward skilled aerial play: first stomp = +9, second = +11, third = +13, etc. The first clean slide is purely cosmetic reward (+1), keeping lowbars accessible.

A stumble costs 2.67 seconds of buffer. A dash covers that and nets +4.3 wu. A **stomp** now covers 2 seconds of buffer (+9) — it is now a genuine strategic choice rather than a bonus.

Over a full 65-second chaser window (120–600 wu), the chaser drains `4.5 × 65 ≈ 293` lead. The player can execute roughly 25 dashes, yielding `25 × 16 = 400` lead from dashes alone — a surplus of ~107 lead at perfect execution. Stomps can materially supplement recovery, especially chained.

### 3.4 Stomp Mechanic **[UPDATED — Phase 3]**

Requires: descending (`vy < 0`), airborne, hero's feet at `heroY ≤ roofY + OBSTACLE_HEIGHT + STOMP_WINDOW` (i.e., within 2.5 wu above mook top = 6.5 wu above roof surface). On success: hero bounces at 14 wu/sec and jump counter resets to 0. Lead gain: **+9** (was +4).

**Chain-stomp:** `stompChain` counter in `ChaseState` increments on each stomp and resets on landing. The chain bonus = `stompChain × STOMP_CHAIN_BONUS (+2)` is applied additively. First stomp = +9 (chain was 0), second stomp without landing = +11, third = +13, etc.

The stomp window covers most of the descending arc from apex to ground, making it forgiving on timing while requiring aerial positioning. The chain reward incentivises staying airborne between mooks.

### 3.5 Course Generation **[UPDATED — Phase 5]**

Buildings are pre-generated once at run start using a seeded RNG:

- **30 buildings** total (was 50 — trimmed to match actual reachable range)
- **3 elevation levels**: 0, 2.5, 5 wu; steps of ±1 level between buildings
- **Gap widths**: 4–12 wu desired, clamped to `maxClearableGap(cursor) × 0.85` (or × 0.70 for upward jumps)
- **Building widths**: 10–28 wu (avg ≈ 19 wu)
- **Props**: 65% chance of one prop per roof, placed 3+ wu from each edge
  - 40% hazard, 35% mook, 25% lowbar

A 30-building course extends roughly 780 wu — a perfect run (600 wu) reaches building #23–24 with a 6-building safety margin. The previous 50-building count generated ≈ 1,200 wu, with buildings 25–50 never reached in any run.

---

## 4. Stat & Reward System

The Rooftop Chase is the **Agility (AG)** trial. Rewards scale with player level and score:

```
statXp = round((20 + 8 × level) × (0.25 + 0.75 × score))
gold   = round((15 + 5 × level) × (0.25 + 0.75 × score))
```

The 0.25 floor means every attempt earns at least 25% of the max reward. Best score is persisted; the daily gate prevents farming.

---

## 5. Physics Reference

**[UPDATED]** All speed figures use the current constants (`BASE_SPEED = 4`, `MAX_SPEED = 10`, `SPEED_RAMP = 0.010`, `CHASE_TARGET_DISTANCE = 600`).

| Constant | Value | Implication |
|---|---|---|
| Gravity | 32 wu/sec² | Jump is snappy, not floaty |
| Jump velocity | 22 wu/sec | Apex ≈ 7.6 wu; air time ≈ 1.375 sec |
| Double-jump velocity | 18 wu/sec | Weaker second jump; useful for mid-air correction |
| Speed at start | 4 wu/sec | Max clearable gap ≈ **4.68 wu** |
| Speed at chaser spawn | 5.2 wu/sec | Max clearable gap ≈ **6.08 wu** |
| Speed at midpoint | 7 wu/sec | Max clearable gap ≈ **8.19 wu** |
| Speed at cap | 10 wu/sec | Max clearable gap ≈ **11.69 wu** |
| Max gap in generator (desired) | 12 wu | Exceeds cap at low speeds; effective max scales 4.7–11.7 wu |

The gap range the player sees in practice is 4.7–11.7 wu (not the full 4–12 desired), because the cap clamps early gaps to be easily clearable. This is good: the course gets meaningfully harder from start to finish.

---

## 6. What Works Well

### Architecture is now clean (Phase 0 overhaul complete)
All sim state lives in `ChaseState` (a plain serializable struct). `stepChase` is a pure reducer: `(state, input, dtSec) → newState`. One-frame event flags (`justLanded`, `justStomped`, `justDashed`, etc.) are clear, testable, and already hooked up to visual effects (dust puffs, stomp flash, dash lines). The hook (`useChaseLoop`) owns only timing; the engine owns rules.

### Speed ramp is now properly calibrated **[UPDATED — was a critical bug]**
The prior analysis identified that `MAX_SPEED` was never reached during a run. This has been fixed: `BASE_SPEED=4`, `SPEED_RAMP=0.010`, `MAX_SPEED=10` — the cap is reached exactly at `CHASE_TARGET_DISTANCE=600`. The 1–3 minute target is met (≈ 92 s for a perfect clean run).

### Lead-as-resource is a genuine design idea
Every action is weighed against the lead number. This is cleaner than "3 lives" — it creates continuous, gradated stakes from the moment the chaser spawns.

### The sprint arc is well-paced
Starting at 4 wu/sec and ending at 10 wu/sec doubles the scroll speed. Gap sizes scale with it (4.7 → 11.7 wu). The course naturally ramps without any hand-crafted sections.

### Double-jump reset on stomp is satisfying
Resetting jumps on a successful stomp rewards risky aerial plays and is legible immediately.

### Short session fits the product
The 1–3 minute target is right for a daily habit-companion game.

---

## 7. Design Problems

### 7.1 The chaser has no real world position — **[RESOLVED — Phase 2]**

The renderer formerly computed chaser screen X as `HERO_X_PX - 50 - (1 - leadFrac) * 28` (28 px total travel, always at ground-floor Y). The chaser was cosmetic.

**Fixed:** `ChaseState` now carries `chaserX`, `chaserY`, `chaserAirborne`. The pure helper `chaserWorldPos(heroFootX, lead, buildings)` maps lead → world gap via `(lead / LEAD_MAX) * CHASER_MAX_GAP` (16 wu), then snaps Y to the roof under the chaser via `buildingAt`. Over gaps, the chaser traces a parabolic arc: `prevRoofY + (nextRoofY - prevRoofY) * t + sin(π * t) * arcHeight` — the beast visibly leaps gaps. In the renderer, chaser screen position is `(state.chaserX - distance) * PX_PER_WU + HERO_X_PX` and `bottom: BELOW_ROOF_PX + state.chaserY * PX_PER_WU`. `ChaserSprite` receives an `airborne` prop that pauses the run animation and tilts the beast forward mid-leap. At full lead the chaser is off-screen left (≈ −40 px); it enters the frame as lead drops below ~30.

### 7.2 Stomp is undervalued relative to dash — **[RESOLVED — Phase 3]**

`STOMP_LEAD_GAIN` raised from 4 → **9**. Chain-stomp system added (`stompChain` in `ChaseState`): consecutive stomps without landing add +2 each. A stomp is now a genuine strategic choice (see §3.3). Dash remains unchanged, preserving the accessible "safe recovery" path.

### 7.3 Lowbars are too easy

**Still open.** A single key press well before contact is sufficient. Timing the slide is optional. Lowbars reward noticing them, not reacting to them.

Per the accessibility direction chosen for this improvement plan, **the timing-window idea was intentionally left out**. Lowbars remain forgiving. A tiny +1 "clean slide" reward (`SLIDE_LEAD_GAIN = 1`) was added so actively sliding feels marginally better than coasting through.

**Impact:** Low-medium. Doesn't break the game.

### 7.4 Speed cap miscalibration — **[RESOLVED — Phase 0]**

Retuned: `BASE_SPEED=4`, `SPEED_RAMP=0.010`, `MAX_SPEED=10`, `CHASE_TARGET_DISTANCE=600`. Speed cap reached exactly at target distance. Perfect run ≈ 92 s.

### 7.5 Chaser closing rate has no drama spikes — **[RESOLVED — Phase 4]**

**Fixed:** Every `SURGE_INTERVAL_WU = 40` wu, the beast executes a visual surge: a `surgeMs` countdown drives `surgeOffset = sin(π × surgeFrac) × SURGE_VISUAL_OFFSET` that is subtracted from the lead passed to `chaserWorldPos`, making the beast lunge on-screen without touching `state.lead`. Net lead drain across the surge window is **zero** (theatrical, not punishing). During a surge:
- A red vignette pulses inward (box-shadow on the play area).
- A "surge" SFX fires (3-voice deep bass swell).
- The drone intensity spikes via `spikeDrone()`.

**Near-miss feedback:** when `lead < NEAR_MISS_LEAD_THRESHOLD (12)` and the player dashes or stomps, `justNearMiss` fires → a "CLOSE CALL! ⚡" banner appears for 700 ms + a metallic sting SFX.

### 7.6 Inconsistent leniency on failure types

**Still open.** Prop collision = 480 ms stagger + lead drain. Gap fall = instant death. Genre-standard asymmetry.

**Impact:** Low.

### 7.7 Building count vs. target distance mismatch — **[RESOLVED — Phase 5]**

`BUILDING_COUNT` reduced from 50 to **30**. A perfect run reaches building ~24; 30 provides a 6-building safety margin with no wasted generation.

### 7.8 No audio — **[RESOLVED — Phase 1]** **[NEW]**

The entire project had zero audio. Fixed via `src/lib/sfx.ts` — a lightweight Web Audio synthesis module (zero asset files):

- **9 named SFX cues**: `jump`, `doubleJump`, `land`, `stomp`, `dash`, `stumble`, `fall`, `growl`, `surge`, `nearMiss`, `win`. Each is a synthesised oscillator+noise recipe (< 30 lines each).
- **Adaptive tension drone**: two detuned sawtooth oscillators (55 / 58.5 Hz) → lowpass filter → gain. `setDroneIntensity(x01)` maps 0–1 danger to rising gain and filter cutoff. `spikeDrone()` for instant burst on surges.
- **Hook `useChaseAudio`**: wires all one-frame flags to SFX cues via prevRef edge-detection; drives drone intensity each frame.
- **Settings integration**: `soundEnabled` in `GameSettings` (persisted); toggle in `SettingsView` General section; inline mute button in the play area; `sfx.resume()` called from Begin Trial button (satisfies browser autoplay policy).

---

## 8. Comparison to Reference Games

### 8.1 Endless Runner Genre (Canabalt, Alto's Adventure, Temple Run)

The Rooftop Chase shares its skeleton with these games — a side-scrolling runner where distance is the primary skill metric. Its lead-as-resource system adds a second dimension that pure endless runners lack.

Where this game still falls short:
- **Canabalt** features a relentless *visible* pursuer — watching it close on screen is terrifying. Rooftop Chase's pursuer is cosmetic (§7.1).
- **Alto's Adventure** has a trick system rewarding stylish play with combo multipliers. Rooftop Chase's stomp is conceptually similar but lacks multiplier incentive.
- **Temple Run** has directional swiping for spatial variety. Rooftop Chase's jump/slide/dash vocabulary is appropriate for scale but is a subset.

### 8.2 Celeste (precision platformer)

Closest mechanical relative. Both games use double-jump, dash, a "get hit → lose something" loop, and speed as skill expression. Both reset the jump counter on stomp (Celeste resets dash on Crystal Heart — same pattern). The key divergence: Celeste uses hand-crafted levels for precise difficulty curves; Rooftop Chase uses procedural generation for variety. For a 1–3 min daily trial, the procedural approach is correct — novelty over mastery.

### 8.3 Mirror's Edge (parkour under pursuit)

Thematic match. Both involve rooftop parkour while being chased, with momentum as a core theme. Mirror's Edge rewards *preserving* momentum — slowing down is punished. Rooftop Chase's speed is autonomous (the camera scrolls regardless), so the player doesn't control momentum directly. This simplification is appropriate for the scope; it explains why the game can feel thin to players from the action-parkour genre.

### 8.4 Canabalt (single-button endless runner)

Worth studying specifically: Canabalt's sole mechanic is "jump when to jump." Its emotional power comes entirely from the visible, approaching doom and the sound design. Rooftop Chase has three inputs, a lead bar, and three obstacle types — *more* mechanics — but less emotional urgency because the chaser is cosmetic. The lesson: mechanic count doesn't create tension; a visible, credible threat does.

---

## 9. Overall Assessment

**Phases 0–5 are complete.** The Rooftop Chase has been transformed from a technically clean but emotionally thin runner into a proper chase game.

### What was resolved

| Issue | Fix |
|---|---|
| Architecture debt | Phase 0: pure reducer, RAF hook, testable engine |
| Speed ramp miscalibrated | Phase 0: `BASE_SPEED=4`, `MAX_SPEED=10`, cap at 600 wu |
| No audio at all | Phase 1: `src/lib/sfx.ts` — synthesised SFX + adaptive drone |
| Chaser cosmetic-only | Phase 2: `chaserX/Y/chaserAirborne` in `ChaseState`; beast leaps gaps and tracks elevation |
| Stomp undervalued (+4 vs +16) | Phase 3: stomp raised to +9; chain-stomp bonus +2/stomp |
| Flat chaser pressure | Phase 4: surge drama every 40 wu (visual+audio, zero net drain) |
| No tension feedback | Phase 4: "CLOSE CALL!" near-miss feedback banner + metallic sting |
| Building waste (50 buildings) | Phase 5: trimmed to 30 |
| No end state for caught | Phase 5: "CAUGHT! 🐺" overlay when lead hits 0 |
| Lead bar uninformative | Phase 5: beast icon rides bar edge, danger glow, label pulses |

### What remains open

- **Lowbar too easy** (§7.3): Intentionally left forgiving per the accessible-difficulty direction. Timing window would increase skill floor; left for a future opt-in difficulty setting.
- **Star thresholds**: 3★ = 450 wu (75%) is demanding. Consider reviewing after more playtests.
- **Inconsistent leniency** (§7.6): Gap fall = instant death; stumble = stagger. Genre-standard; no current plan to change.

---

## 10. Remaining Directions (Future Work)

| Priority | Issue | Possible direction |
|---|---|---|
| **Low** | Lowbar timing | Optional "challenge mode" flag; require slide within 0.4 s of contact for a +3 bonus instead of +1. Off by default. |
| **Low** | Star thresholds | Review 3★ = 450 wu (75%). Consider 60% (360 wu) given chaser pressure. |
| **Low** | Reusable audio | `src/lib/sfx.ts` is built to serve all 8 Skill Trials. Wire up `useChaseAudio`-style hooks for the Arena, Mine, and Forest trials when those get audio passes. |
| **Future** | Caught animation | The "CAUGHT! 🐺" overlay works but the beast has no pounce animation. A brief sprite-swap + slam SFX would complete the moment. |
