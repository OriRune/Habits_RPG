# Rooftop Chase — Minigame Analysis

> **Purpose of this document:** Understand the current state of the Rooftop Chase minigame — its mechanics, design strengths and weaknesses, and how it compares to games with similar loops — to inform a plan for improving it.

---

## 1. Overview

| Property | Value |
|---|---|
| **Type** | Side-scrolling endless runner |
| **Setting** | Medieval town rooftops |
| **Stat trained** | Agility (AG) — speed, evasion, reaction |
| **Duration target** | 1–3 minutes |
| **Energy cost** | None (free daily trial) |
| **Gate** | Once per calendar day (best score tracked) |
| **Engine file** | `src/engine/trials/rooftopChase.ts` |
| **UI component** | `src/components/trials/games/RooftopChase.tsx` |

The Rooftop Chase is one of eight Skill Trials. Unlike the dungeon minigames (Mine, Forest, Arena), Trials cost no energy and offer a lighter 1–3 minute session. The Chase is the Agility trial: a side-scroller where the player leaps between buildings of a medieval town while a beast chaser closes from behind.

---

## 2. The Gameplay Loop

A full run proceeds in five phases:

### Phase 1 — Opening (0–45 wu)
The hero spawns on a wide grace platform (22 wu, no obstacles). The camera locks the hero at a fixed screen-X and scrolls the world rightward. Speed starts at **6 wu/sec**. The chaser has not appeared yet; lead is pinned at the maximum of **50 wu**. This phase is a free tutorial — players learn the controls without pressure.

### Phase 2 — Warm-Up (45–~111 wu)
At 45 wu the chaser spawns. Lead begins draining at **4.5 wu/sec**. Speed is climbing but is still comfortable (~6.8–8 wu/sec). Players can afford to plan jumps ahead and use the dash once before its cooldown expires.

### Phase 3 — Escalation (~111–167 wu)
Speed crosses ~8 wu/sec and keeps rising toward the 22 wu/sec cap. Obstacles require faster reactions. Gaps are wider (the course generator caps them at 85% of the clearable arc at that distance, so they scale with speed). A stumble at this stage can be decisive — losing 12 lead when the chaser is already closing at 4.5/sec takes roughly 2.7 seconds to recover from a single dash.

### Phase 4 — Max Speed (~167–200 wu)
Speed reaches the cap of **22 wu/sec** around the 89% mark of the target distance. From here the course continues at a flat speed. Obstacles arrive faster than at any prior point; reactions dominate over planning.

### Phase 5 — End Condition
The run ends when any of the following occur:
- **Lead hits 0** (hero is caught by the chaser)
- **Hero falls into a gap** (below the next roof's elevation)
- **Hero reaches 200 wu** (perfect score)

Score = `distance / 200`, clamped to 0–1. Stars: ≥0.75 = 3★ (150+ wu), ≥0.40 = 2★ (80+ wu), <0.40 = 1★.

---

## 3. Controls & Mechanics

### 3.1 Movement

| Input | Action | Notes |
|---|---|---|
| Space / ↑ | Jump | Applies `JUMP_VELOCITY` (22 wu/sec) upward |
| Space / ↑ (airborne) | Double-jump | Applies `DOUBLE_JUMP_VELOCITY` (18 wu/sec); max 2 jumps total |
| ↓ / S (grounded) | Slide | Crouches hero for 450 ms; ground-only |
| Shift / D | Dash | Speed burst: +40% for 380 ms; 2600 ms cooldown |

### 3.2 Obstacles

| Obstacle | Frequency | How to clear | What happens on failure |
|---|---|---|---|
| **Hazard** (spikes) | 40% of props | Be airborne (any jump works) | Stumble: −12 lead, 480 ms stagger |
| **Mook** (guard) | 35% of props | Jump over, or stomp head while descending | Stumble if grounded; stomp bounces hero upward |
| **Lowbar** (banner) | 25% of props | Slide | Running into it or jumping into it causes stumble |

### 3.3 Lead Economy

Lead is the core resource. It represents distance between the hero and the chaser. The chaser closes at a flat 4.5 wu/sec once active.

| Event | Lead change |
|---|---|
| Chaser closing (per sec) | −4.5 |
| Stumble | −12 |
| Stomp a mook | +4 |
| Dash | +16 |

A stumble costs ~2.67 seconds of buffer at the chaser's closing rate. A dash more than covers that (+16 lead ≈ +3.56 sec buffer). A stomp gives back only ~0.89 sec of buffer.

### 3.4 Stomp Mechanic

Stomping requires: descending (`vy < 0`), airborne, and hero's feet within `STOMP_WINDOW` (2.5 wu above the mook's top). On success: hero bounces upward at 14 wu/sec and their jump counter resets to 0, allowing an immediate double-jump. The lead gain is +4 wu.

### 3.5 Course Generation

Buildings are pre-generated once at run start using a seeded RNG:

- **50 buildings** total
- **3 elevation levels**: 0, 2.5, 5 wu; steps of ±1 level between buildings
- **Gap widths**: 4–12 wu desired, clamped to `maxClearableGap(distance) * 0.85` (or 70% for upward jumps)
- **Building widths**: 10–28 wu
- **Props**: 65% chance of one prop per roof, placed 3+ wu from each edge
  - 40% hazard, 35% mook, 25% lowbar

---

## 4. Stat & Reward System

The Rooftop Chase is the **Agility (AG)** trial. Rewards scale with player level and score:

```
statXp = round((20 + 8 × level) × (0.25 + 0.75 × score))
gold   = round((15 + 5 × level) × (0.25 + 0.75 × score))
```

The 0.25 floor means every attempt earns at least 25% of the max reward — a participation bonus that encourages re-trying. Best score is persisted to `bestTrialScore`, and the daily gate prevents farming the trial for repeated full rewards.

---

## 5. Physics Reference

| Constant | Value | Implication |
|---|---|---|
| Gravity | 32 wu/sec² | Jump feels snappy, not floaty |
| Jump velocity | 22 wu/sec | Apex ~7.6 wu; air time ~1.375 sec |
| Double-jump velocity | 18 wu/sec | Weaker second jump; useful for mid-air correction |
| Speed at start | 6 wu/sec | Max clearable gap ~8.6 wu |
| Speed at cap | 22 wu/sec | Max clearable gap ~25.8 wu |
| Max gap in generator | 12 wu (desired) | Well within jump range at all speeds |

At base speed, a full jump clears ~8.25 wu. At max speed, the same jump covers ~30 wu. The generator's gap cap (85% of this) means gaps scale from ~7.3 wu to ~22 wu over the course — the game becomes meaningfully harder as speed ramps.

---

## 6. What Works Well

### Lead-as-resource is a genuine design idea
Most endless runners give you a score (distance) and a health (lives/shields). Rooftop Chase replaces both with a single lead number. Every action is weighted against how it moves that number. This is cleaner than a typical "3 lives" runner because it creates continuous stakes from the moment the chaser spawns.

### Speed escalation creates natural tension
The ramp from 6 to 22 wu/sec is smooth and the course generation accounts for it. Early runs feel accessible; later runs feel genuinely urgent. For a 1–3 minute game, the ramp is well-paced.

### Double-jump is forgiving without being trivial
Resetting jumps on a successful stomp is borrowed from Celeste and Super Mario — it rewards risky plays with more airborne recovery options. The mechanic is legible and satisfying.

### Pure-engine architecture
The entire game logic lives in `rooftopChase.ts` with no React or store imports. This makes it fully unit-testable and easy to reason about. Constants are all exported at the top of the file, making tuning approachable.

### Short sessions fit the product
The 1–3 minute target is exactly right for a daily habit-companion game. Players can attempt the trial during a break and still feel the full arc of pressure and escalation.

---

## 7. Design Problems

### 7.1 The chaser has no real world position *(cosmetic-only)*

`chaserXPx` (the chaser's on-screen left edge) is computed directly from the **lead bar** (`HERO_X_PX - 50 - (1 - leadFrac) * 28`) rather than from a real world-space position. The beast hovers near the left screen edge as an indicator, not as an entity closing actual ground on the hero. There is no `chaserX` in the game state.

This breaks the game's central premise. A player watching the chaser never sees it gaining — it just shimmers at the edge of screen. The drama of "it's getting closer!" comes only from watching an abstract HUD bar drain. The chaser is a lead meter with legs.

**Impact:** High. The cosmetic chaser is the single biggest reason the game doesn't *feel* like a chase. Fixing it (Phase 1 of the overhaul) means giving the chaser real world coordinates, so the player can see it leap rooftops, close the gap on a stumble, and fall back when dashed away from.

### 7.2 Stomp is undervalued relative to dash

The stomp is the minigame's highest-skill interaction — it requires a precise aerial descent and timing — but it only returns **+4 lead**. A dash returns **+16 lead** passively and safely with no positioning requirement. Rational players will dash whenever available and treat stomping as a bonus rather than a strategy.

The math: over the cooldown window (2.6 sec), the chaser closes 11.7 wu. A dash covers that loss and gains 4.3 wu extra. A stomp gains back only 0.89 sec of buffer and resets jumps (useful, but not lead-critical). The two mechanics don't feel like tradeoffs — they're just ranked.

**Impact:** Medium. Stomp remains fun when it happens, but it's never the *right* choice over a ready dash.

### 7.3 Lowbars are too easy

Lowbars require a single key press that triggers a 450 ms slide window — no timing beyond "press before contact." They're the least interesting obstacle type and form 25% of the prop pool. A player who recognizes a lowbar ahead simply presses ↓ in advance and passes through without stopping. There's no moment of skill expression.

Compare: hazards reward reading elevation (are you airborne?), mooks reward descending timing (stomp window). Lowbars reward… noticing them before running into them.

**Impact:** Low-medium. Doesn't break the game, but flattens the obstacle variety.

### 7.4 Speed cap hits before the finish

The speed cap (22 wu/sec) is reached at roughly **distance 889 wu** — wait, let me recalculate: `MAX_SPEED = BASE_SPEED + SPEED_RAMP * d → 22 = 6 + 0.018 * d → d = 16/0.018 ≈ 889 wu`. Since the target distance is only 200 wu, the speed cap is **never actually reached during a run**. At 200 wu, speed is only `6 + 0.018 * 200 = 9.6 wu/sec`.

This means the speed ramp is far gentler than it appears from the constants. The advertised "6 → 22 wu/sec" range is aspirational; a full-distance run only ever sees 6–9.6 wu/sec. The game doesn't meaningfully escalate in the late-game — it just gently gets faster.

**Impact:** High. This is a significant design gap — the late game lacks the urgency the constants suggest. The speed ramp needs recalibration or the target distance needs to be where the ramp has done meaningful work.

### 7.5 Chaser closing rate has no drama spikes

The chaser closes at a flat 4.5 wu/sec with no variation. There are no surges, no breathing room phases, no moments where the player feels the beast "almost got them." The tension is entirely additive — it builds through accumulated stumbles and missed dashes, not through the chaser itself being dramatic.

**Impact:** Medium. The chaser is a pressure mechanic but not a dramatic actor.

### 7.6 Inconsistent leniency on failure types

A stumble on a prop gives a 480 ms stagger — the player keeps running and can recover. Falling into a gap is instant game-over with no recovery. This is asymmetric leniency: the more recoverable-feeling failure (trip on a spike) is treated generously; the more dramatic failure (falling off a roof) is punished absolutely.

This is arguably genre-correct (falling is always fatal in platformers), but it can feel jarring when a stumble is forgiven but a slightly mistimed jump ends the run immediately.

**Impact:** Low. Genre-standard, but worth reconsidering if recovery mechanics are added.

---

## 8. Comparison to Reference Games

### 8.1 Endless Runner Genre (Canabalt, Alto's Adventure, Temple Run)

The Rooftop Chase shares its skeleton with these games — a side-scrolling runner where distance is the primary skill metric. Its meaningful addition is the lead-as-resource system, which adds a second dimension that pure endless runners lack. In Canabalt, your only feedback is "did I make it or not." Here, you can watch the lead bar and make strategic decisions.

Where this game falls short compared to the genre leaders:
- **Canabalt** features a relentless visible pursuer — watching it close on screen is terrifying. Rooftop Chase's pursuer is cosmetic (see §7.1).
- **Alto's Adventure** has a trick system that rewards stylish play with combo multipliers. Rooftop Chase's stomp is conceptually similar but lacks the multiplier incentive.
- **Temple Run** has directional swiping that creates spatial variety. Rooftop Chase is jump/slide/dash only, which is fine for short sessions but limits input variety.

### 8.2 Final Fantasy Tactics (resource management framing)

FFT isn't a direct parallel, but the resource-management lens applies. In FFT, you manage MP, CT (charge time), and positioning. Committing to a spell or ability creates a tradeoff against future turns. Rooftop Chase has an analogous structure: the dash is a high-return action with a cooldown (your "MP"), stomp is a high-skill action with positional requirements, and stumbling locks you out of jumping for 480 ms (your "stagger" CT).

The difference: FFT rewards careful planning because you can read the board fully. Rooftop Chase's procedural obstacles reward reflexes over plans. For a 1-3 min game this is correct, but it means the strategic depth is shallower than it could be — the player never gets to "solve" a section, only react to it.

### 8.3 Celeste (precision platformer)

Celeste is the closest mechanical relative. Both games use:
- Double-jump
- Dash (Celeste's dash resets on enemy stomps — Rooftop Chase does the equivalent)
- "Get hit → lose something" loop
- Speed as an expression of skill

The key divergence: Celeste builds mastery through hand-crafted levels with precise difficulty curves. Procedural generation in Rooftop Chase trades precision for variety. Celeste's approach creates "aha" moments; Rooftop Chase's creates "lucky/unlucky" moments. For a 1-3 min daily trial this is the right tradeoff — you want novelty, not mastery of a fixed course.

### 8.4 Mirror's Edge (parkour under pursuit)

Mirror's Edge is the thematic match. Both involve rooftop parkour while being chased, with an emphasis on momentum and reading ahead. Mirror's Edge rewards *preserving* momentum — slowing down is a punishment. Rooftop Chase's speed is autonomous (the camera scrolls regardless), so momentum isn't a player variable.

Mirror's Edge also has a much richer obstacle vocabulary (wall-runs, ziplines, vaults). Rooftop Chase keeps it to three obstacle types, which is appropriate for the game's scale, but explains why it feels thin to someone coming from the action-parkour genre.

---

## 9. Overall Assessment

Rooftop Chase works as a 1–3 minute Agility trial. The lead-as-resource framing is its strongest design idea, and the pure-engine architecture makes it easy to tune. For a daily habit companion, it hits the right duration and accessibility marks.

The critical issues to address before it reaches its potential:

1. **The chaser is cosmetic.** The beast has no real world position — it's a lead-bar animation. The player never sees it leap a rooftop or close ground. Giving it real coordinates (Phase 1 of the overhaul) is the highest-leverage single change.

2. **Speed ramp is miscalibrated.** At 200 wu, the game only reaches 9.6 wu/sec — a fraction of the stated cap. The run is over in ~26 seconds at full play, nowhere near the 1–3 minute target. The target distance and speed ramp need recalibration together.

3. **Stomp vs. dash balance.** Stomp is the skill expression of the game — aerial timing, mook awareness, trajectory — and it returns 4 lead. Dash is passive and safe and returns 16. Until stomp is worth using over a ready dash, it remains a novelty rather than a strategy.

4. **Chaser lacks drama.** A flat closing rate creates steady pressure but no memorable moments. Surge windows or dynamic acceleration would make the chaser feel alive and create the "uh oh" moments that make chase sequences memorable.

---

## 10. Suggested Directions for Improvement

These are options to evaluate when planning the next iteration — not prescriptions:

| Issue | Possible direction |
|---|---|
| Cosmetic chaser | Give the chaser a world-x position; render it jumping rooftops and gaining on the hero |
| Speed ramp miscalibrated | Raise `CHASE_TARGET_DISTANCE` to ~600 wu and retune `BASE_SPEED`/`SPEED_RAMP` so the cap is reached near the end of a 90s run |
| Stomp undervalued | Increase `STOMP_LEAD_GAIN` to 8–10, or add chain-stomp multiplier for consecutive stomps |
| Lowbar too simple | Add a "timed lowbar" variant requiring slide press *just before* the obstacle (not pre-held) |
| Flat chaser | Add surge windows every ~25 wu where the chaser gains +3 wu extra burst, requiring a dash or stomp to recover |
| Score granularity | Adjust star thresholds for more feedback at intermediate performance levels |
| Fall harshness | Optional: add one "near miss" grace frame or coyote-time forgiveness on gap edges |
