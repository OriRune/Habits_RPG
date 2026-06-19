# Hex Tactics Minigame — Analysis & Improvement Brief
*(Updated 2026-06-18 — all facts verified against current source)*

---

## 1. Overview

Hex Tactics is a turn-based tactical skirmish added to HabitsRPG as the Agility-stat showcase minigame. The player takes their single hero into a procedurally generated hex battlefield against 2–8 AI enemies. Unlike the real-time crawlers (Mine, Forest) and the reflex-driven Arena, Hex Tactics is fully deliberate: every move is a considered decision made without a clock.

It unlocks at Level 4 (`TACTICS_UNLOCK_LEVEL`) and costs 3 energy per match (`TACTICS_ENERGY_COST`). The **tier** fed to the generator equals the player's current level, clamped to `[4, 50]` — so a brand-new player starts at tier 4, not tier 1. Both outcomes grant AG/DX/EN stat XP; wins also pay scaled gold.

**This document supersedes the previous analysis.** Since that document was written, a significant Phase 2 overhaul was partially completed before an interruption. The following sections reflect verified current behavior.

---

## 2. Gameplay Loop

### 2.1 Entry

1. Player opens the Tactics tab, sees their current AG stat translated into concrete move/climb stats.
2. They choose board size (Small 37 tiles, Medium 61, Large 127).
3. Pay 3 energy → `generateSkirmish` builds the board.

### 2.2 Board Generation

- A flat-top axial hex grid of radius 3/4/6 is generated.
- **Elevation plateaus**: `1 + floor(radius/3) + (rand < 0.5 ? 1 : 0)` plateaus per board. In practice: **2–3 plateaus** on Small and Medium, **3–4** on Large. Each plateau has a height (1–3) and a spread of 1–2 hexes. The claim in the previous analysis that boards have "1–3 plateaus" was slightly off.
- **Terrain rolling**: Each tile (except player spawn) gets a random type:
  - 70% `floor` (normal)
  - 12% `cover` (+3 flat defense while occupied)
  - 8% `slow` (movement costs 2 instead of 1)
  - 6% `hazard` (4 damage at end of occupant's turn)
  - 4% `blocked` (wall, impassable, elevation 3); walls are dropped entirely on generation attempts 6–11 to guarantee connectivity
- An occlusion clamp (`OCCLUSION_RISE = 2`) prevents any tile from rising more than 2 above the tile directly behind it in the iso projection. Back-edge tiles keep full height.
- BFS connectivity is verified; up to 12 generation attempts are made.
- Player always spawns at `{q: 0, r: radius}` (bottom center) on flat floor elevation 0. Enemy spawns are chosen from standable tiles (`elevation ≤ 1`, terrain ≠ `blocked`) at distance ≥ `radius` from the player spawn.

### 2.3 Turn Structure

Each round is two phases:

**Player phase:**
- Move up to `moveTilesFor(AG)` tiles (2 + floor(AG/4), max 6). Slow terrain costs 2. Climbing per step is limited by `climbFor(AG)` (1 + floor(AG/8), max 3). Descents are free.
- Perform **one action**: melee attack, ranged attack, or cast a spell.
- End turn.

**Enemy phase (automatic):**
- Each living enemy that isn't frozen either attacks (if in range) or moves toward optimal position using the archetype AI, then attacks if now in range. Details in §4.
- Burn/poison/hazard ticks occur: player's at the start of the enemy phase, enemies' at the end.

**Win condition:** All enemies reach 0 HP.  
**Loss condition:** Player reaches 0 HP.

### 2.4 Actions

**Melee attack** — adjacent targets only (distance 1). Damage uses `meleePower`.

**Ranged attack** — requires line of sight. Range = `weapon.range` + `heightRangeBonus(dz)` (up to +2 tiles from high ground).

**Spells**: The game has 9 known spells. Tactics filters to those whose mechanic is absent (standard behavior), `blink`, `push`, or `cleave`. Arena-only mechanics (runes, ring-of-fire, teleport/chaotic-blink) are excluded.

| Spell | School | MP | Effect |
|---|---|---|---|
| Sparks | damage | 4 | Arcane damage (starter) |
| Firebolt | damage | 9 | Fire damage + burn DoT (starter if chosen) |
| Mend | support | 6 | Heal HP (starter) |
| Bless | support | 8 | +6 flat damage reduction for 3 turns |
| Dazzle | illusion | 6 | Blind foe (40% miss chance) for 2 turns |
| Hex | illusion | 7 | Weaken foe (−40% attack) for 3 turns |
| Force Push | illusion | 8 | Hurl enemy 2 tiles; bonus dmg on wall/hazard landing |
| Blink | support | 5 | Teleport to any open tile within 2 squares; consumes remaining movement |
| Cleave | support | 7 | Strike every adjacent enemy with meleePower |

**Critical note**: Force Push, Blink, and Cleave are available in Tactics **only if the player has those spellbooks in their inventory**. A player who hasn't found these items won't see them on the action bar. This is currently the biggest accessibility gap in Tactics — the most tactically interesting abilities are gatekept behind loot.

### 2.5 Height System

The mechanical spine of the minigame, unchanged:

| dz (attacker − target) | Damage multiplier |
|---|---|
| +3 | 1.36× |
| +2 | 1.24× |
| +1 | 1.12× |
| 0 | 1.00× |
| −1 | 0.88× |
| −2 | 0.76× |
| −3 | 0.64× |

High ground also grants +1 ranged/spell range per level, capped at +2.

### 2.6 Match End & Rewards

- **Win**: `gold = round(40 × (1 + tier × 0.15))`. At tier 4 (minimum): 64 gold. At tier 10: 100 gold. Healing potions at tier ≥ 8. AG/DX/EN each get `4 + tier` XP.
- **Loss**: AG/DX/EN each get `(4 + tier) × 0.4` XP (rounded).
- `deepestTacticsTier` records the highest tier won.

---

## 3. Stats Used

### 3.1 Primary: Agility (AG)

- **Movement range**: 2 + floor(AG/4), capped at 6 tiles.
- **Climb limit**: 1 + floor(AG/8), capped at 3 per step.
- **Dodge**: Enemy attacks check `rng() < player.dodge` before resolving.

### 3.2 Combat Snapshot (Character-derived)

| Field | Source | Role |
|---|---|---|
| `meleePower` | ST, weapon | Melee attack and Cleave damage |
| `rangedPower` | DX, weapon | Ranged attack damage |
| `damageSpell` | WI | Damage spell scaling |
| `supportSpell` | KN | Heal amount (Mend) |
| `illusionPower` | CH | Illusion spell duration bonus |
| `defense` | EN, armor | Physical damage mitigation |
| `ward` | WI, armor | Magic damage mitigation |
| `dodge` | AG | Enemy miss chance |

### 3.3 Stats NOT Directly Used

KN contributes to `supportSpell` (heal scaling), so it IS meaningful if the player uses Mend. HP stat levels don't govern Tactics-specific mechanics.

---

## 4. The Enemy Roster

**10 templates** (the previous analysis said 12 — that was an overcount). All enemies share a moveset drawn from `bosses.ts:EnemyMove` types: `attack`, `heavy`, `multi`, `guard`, `inflict`, `drain`.

| Enemy | HP | Atk | School | Archetype (AI) | Moveset highlights |
|---|---|---|---|---|---|
| Skeleton Warrior | 34 | 7 | Physical | **flanker** | attack, heavy ×1.8, guard +3 |
| Wailing Wisp | 26 | 7 | Magic | **kiter** | attack, inflict blind, inflict weaken |
| Crypt Ghoul | 38 | 8 | Physical | **charger** | attack, drain ×0.4, inflict weaken |
| Cave Goblin | 26 | 6 | Physical | **charger** | attack, multi ×2 |
| Giant Spider | 30 | 7 | Physical | **flanker** | attack, inflict poison, multi ×2 |
| Dire Wolf | 36 | 9 | Physical | **charger** | attack, multi ×3, heavy ×1.7 |
| Thornling | 32 | 6 | Physical | **holder** | attack, guard +4, inflict poison |
| Stone Sentry | 46 | 8 | Physical | **holder** | attack, guard +5, heavy ×2.0 |
| Frost Revenant | 32 | 9 | Magic | **kiter** | attack, inflict freeze, inflict weaken |
| Ice Elemental | 40 | 9 | Magic | **charger** | attack, heavy ×1.8, inflict weaken |

**Stat scaling**: HP and attack scale by `1 + (tier−1) × 0.07`. Defense and ward each gain `floor(tier/8)`. At tier 4 (minimum): scale = 1.21×.

**Range**: Magic-school enemies (wisp, frost revenant, ice elemental) have `range = 3`; physical enemies have `range = 1`. Their effective range extends with height advantage.

**Climb**: Beast/elemental archetypes start at climb 2; others at climb 1. Both scale up by `floor(tier/10)`, capped at MAX_ELEVATION (3). So high-tier beasts and elementals become genuine climbers.

**moveTiles**: `3 + max(0, radius−4)`. On Small (r=3): 3. On Large (r=6): 5.

### 4.1 AI Archetypes (New)

Each template maps to one of four behavior archetypes that score candidate movement tiles differently:

| Archetype | Enemies | Behavior |
|---|---|---|
| **charger** | dire_wolf, goblin, ghoul, ice_elemental | Minimize distance to player; value elevation gain |
| **kiter** | wisp, frost_revenant | Maintain preferred range (`enemy.range`); penalize being ≤ 1 tile from player; always reassess position even when in range |
| **holder** | stone_sentry, thornling | Minimize own movement; stay close to current position; only advance if not already threatening |
| **flanker** | skeleton, giant_spider | Approach from a different angle than other enemies; use a dot-product flank score to diverge from ally approach vectors |

**Terrain awareness in AI**:
- All archetypes score hazard tiles at −1000 (avoid them)
- All archetypes get a +1 bonus for cover tiles
- Chargers get +1.5 per elevation gain; kiters +3; holders +1; flankers +1

---

## 5. What Has Been Implemented Since the Previous Analysis

The previous analysis listed these as needed improvements. Here is the verified status of each:

### 5.1 Fully Implemented ✅

**Enemy threat range visualization** — `computeEnemyThreat()` calculates every tile any enemy can move-to-and-attack-from. These tiles are rendered as a red tint overlay (`rgba(239,68,68,0.18)` fill + red stroke). Toggle with the Shield icon button. This is the single highest-impact improvement and it is done.

**Damage/healing preview on hover** — `previewPlayerAttack()` and `previewSpell()` return exact min/max brackets (±15% variance), the height multiplier %, cover bonus, guard bonus, weak/resist flag, and a lethal indicator. The `PreviewBadge` component renders this in the action bar caption. Works for attacks, damage spells, heal spells.

**Enemy intent telegraphing** — `planEnemyIntents()` runs a dry-run of enemy movement decisions (using the same `bestMoveFor` AI) before the player acts. Results stored in `intentPlan`. The UI renders:
- Orange dashed arrows showing each enemy's intended movement
- Attack icons over the player's hex for enemies that will be able to attack
- Frozen indicators (❄️) for frozen enemies
- Toggle with the Eye icon button.

**Enemy differentiated behavior** — The four archetypes (charger, kiter, holder, flanker) are implemented and each scores candidate tiles via a distinct `scoreMoveTile` formula. Kiters actively retreat when the player is too close.

**Enemy high-ground seeking** — All archetypes include a positive weight on `elevGain` in their scoring. Kiters value it most (+3/level), making Frost Revenants and Wisps genuinely compete for elevated positions.

**Enemy terrain awareness** — Hazard avoidance (−1000) and cover bonus (+1) are baked into every archetype's scoring.

**Positional spells: Push, Blink, Cleave** — All three are now Tactics-eligible mechanics. Push hurls an enemy 2 tiles with wall-crash/hazard bonus damage. Blink teleports within 2 squares ignoring height. Cleave hits all adjacent enemies. All have engine implementations and UI support.

**Enemy special attacks** — The `moveset`-driven `enemyAttack` function handles `guard` (raises `guardBonus` for the next hit's preview), `heavy` (multiplied damage), `multi` (multiple hits), `drain` (life steal), and `inflict` (status effects). The guard bonus appears in `previewPlayerAttack` so the player can see it.

**Status effect system** — All 6 statuses (burn, blind, weaken, bless, freeze, poison) work in Tactics with correct DoT ticking, decay, and `applyDoTAndDecay` logic.

### 5.2 Partially Implemented ⚠️

**Flanking behavior** — The flanker archetype (skeleton, giant_spider) uses a dot-product calculation to reward approach angles diverging from other allies. This is geometrically correct but relies on there being multiple enemies alive; with 2 enemies (early tiers), the flanking incentive is weak and the two enemies may still converge.

**Enemy spell repertoire** — Enemies can `inflict` status effects (freeze, blind, weaken, poison) via their moveset, but this is a single `inflictKey`/`inflictTurns`/`inflictMag` parameter per move — there's no separate targeting or range phase. The effect is mechanically present but narratively thin.

---

## 6. How Well It Works as a Game (Current State)

### 6.1 Strengths

**The threat + intent system transforms tactical decisions.** Knowing which tiles are dangerous and where each enemy plans to move shifts the game from reactive to predictive. A player can now clearly see "if I stand here, three enemies can reach me" and plan accordingly. This is the biggest positive change since the last analysis.

**The archetype AI creates meaningfully different threat profiles.** Kiters (wisps, frost revenants) create sustained-fire pressure from range and force the player to advance rather than hold indefinitely. Holders (stone sentry, thornling) create a stationary threat the player must approach. Flankers push the player to watch multiple approach vectors. Chargers remain aggressive and are best countered with obstacles.

**The height system is now fully leveraged.** Because kiters seek elevation, the player can no longer simply claim the highest tile and farm. High ground is contested terrain, and the scoring function means enemies will actively try to deny it. The dominant strategy of "run to a hill and hold" is significantly weakened.

**Enemy moveset variety adds real unpredictability.** A Stone Sentry that spends 60% of its actions guarding (+5 defense) demands that the player use spells (which hit ward, not defense). A Crypt Ghoul that drains creates a resource-trading mini-puzzle. A Frost Revenant that can freeze the player for a turn is genuinely threatening on a small board.

**The damage preview is excellent.** Hover-to-preview shows exactly what you'll deal (with height %, cover, guard, weak/resist, lethal flag). This is better than most commercial tactical games in its explicitness.

### 6.2 Remaining Weaknesses

**Push, Blink, and Cleave are gated behind loot.** These three spells are the most interesting Tactics-specific mechanics, but they're only available if the player has found the corresponding spellbooks. New players or players who haven't prioritized spell drops will never see them on the action bar. The solution is straightforward: guarantee all three are available for every Tactics session regardless of inventory, with a small MP cost.

**Single hero — still no combined-arms decisions.** The roster has enough variety to create interesting matchups, but with only one unit, there's no "who do I protect" or "which ability do I save for whom" decisions. Most of the gains from archetype AI are mitigated by the fact that all enemies target the same unit.

**No secondary objective.** Every match ends the same way: kill everything. There's no escort quest, no tile you must defend, no portal that opens after N turns. The strategic variety that archetypes create is still funneled into one outcome. A single optional modifier ("keep this beacon tile unoccupied for 5 turns for bonus XP") would dramatically raise replayability.

**MP/Stamina pressure is still low at typical tiers.** With `mend` as a free heal and stamina regenerating between sessions, resource management rarely becomes decisive. Spells feel optional rather than necessary.

**Spell availability is front-loaded.** Characters unlock at most 6 standard spells (2 starters + 1 signature + 3 found spellbooks). There are no in-Tactics choices, no spell loadout decisions, and no way for a high-level character to feel meaningfully different from a low-level one in spell variety.

**Enemy count scaling is still coarse.** Formula: `clamp(2 + floor(tier/5) + sizeBonus, 2, 8)`. On Small board: 2 enemies at tier 4–9, 3 at tier 10–14, etc. The jump feels significant; the stretch within each bracket is stat inflation only. At tier 4 (starting tier), new players always face exactly 2 enemies — a low-stakes introduction, but the board can still feel sparse.

**Unit icon system is unfinished.** Each enemy uses `tmpl.moveset[0].icon` as its sprite (e.g., wisp shows ⚔️, ghoul shows ⚔️). The intent badge above units then shows an action icon from the moveset. The result: most enemies look identical (⚔️) on the board. This is a significant visual readability problem — the player can't distinguish a Wisp from a Dire Wolf at a glance.

**Intent arrow placement.** When multiple enemies will attack, their intent icons are stacked above the player's hex at slightly offset positions (`intent.enemyId % 3 - 1) * size * 0.7`). On a small board this produces a readable cluster, but it reads as "player is going to be attacked" rather than "this specific enemy is targeting you." Moving intent icons to appear above the *enemy's* hex (where they originate) would be more intuitive.

---

## 7. Comparison to Reference Games (Status Update)

### 7.1 Final Fantasy Tactics

The uniform-AI problem is largely solved. Enemy archetypes now create the distinct threat profiles FFT is famous for. The remaining gap is skill depth — FFT's 20+ spells per school vs. Tactics' 6 standard spells. This is the next area to invest in.

### 7.2 Fire Emblem

The danger zone (threat overlay) is implemented and is on par with Fire Emblem's "danger zone" visualization. The key remaining gap vs. FE is **weapon triangle / type visibility** — Tactics has weak/resist affinities but they're not visually communicated on the board (no icon showing "this enemy is weak to WI" while browsing the field).

### 7.3 Into the Breach

Still the largest gap. Into the Breach's model relies on **full, committed enemy intent** — you see exactly what each enemy will do, not a prediction. Tactics shows a prediction (using the same AI logic), which is very close in spirit but the intent can be wrong if board state changes (e.g., if you kill an enemy early in your turn, the surviving enemies' predicted moves may shift). The bigger gap is the **secondary objective**: ItB's city tiles give every position decision a second axis of evaluation. Without that, Tactics has no position that's "good even if it doesn't kill anything."

### 7.4 XCOM 2

Cover and hit-chance explicitness are now matched or exceeded — the `PreviewBadge` shows exact ranges (not just percentages) plus height multiplier, cover, guard bonus, and lethal flag. The remaining XCOM mechanic worth borrowing is **overwatch** (reaction shots on enemy movement): having the player's action "interrupt" the enemy turn would make the enemy phase feel participatory rather than passive.

### 7.5 Wildermyth

Wildermyth remains the closest structural parallel. Its environmental interaction (fire spreads, destructible objects) gives terrain dynamic weight over a match. Tactics' terrain is static — a hazard tile stays a hazard, slow tiles stay slow. Even one dynamic element (a fire-rune that burns an adjacent tile when triggered, or a pushed enemy starting a chain knock) would move the needle here.

---

## 8. Summary Assessment

Hex Tactics is no longer a "well-built foundation with thin gameplay" — it is now a genuinely functional tactical skirmish with meaningful spatial decisions, differentiated AI, and good information transparency (threat zones, intent arrows, damage previews). A player who engages with it encounters real decisions: terrain is meaningful, enemies have distinct personalities, and the height system is contested rather than one-sided.

The **optimal play pattern has meaningfully changed**. The old "run to the hill, hold it, win" dominant strategy is disrupted by kiter enemies seeking elevation and the intent telegraph revealing clustered danger zones. The new dominant pattern is more like: *"identify which enemies are which archetype, break up the flank attempt, deal with the kiter from range before it claims elevation, use Push or Blink to deny ideal positions."*

The remaining gaps are:
1. **Tactical spell accessibility** — Push/Blink/Cleave should always be available in Tactics
2. **Secondary objective** — one optional modifier per match to break the "kill everything" sameness
3. **Visual readability** — distinct unit sprites (not emoji weapon icons)
4. **Overwatch / active enemy phase** — a way for the player to interact during the enemy turn

---

## 9. Priority Improvement Areas

Ordered by impact-to-effort ratio.

### Tier 1: High Impact, Low–Medium Effort

**1. Always-available positional spells**
Grant Blink, Push, and Cleave for free in every Tactics session — not as inventory items, but as built-in Tactics abilities with their own UI row. They're already implemented; this is a UI and store change, not an engine change. These mechanics are the entire point of the positional system and currently locked behind loot.

**2. Distinct enemy sprites / icons**
Replace `tmpl.moveset[0].icon` as the unit glyph with a distinct per-template sprite emoji or character. The player should be able to see "that's a Wisp and that's a Stone Sentry" from across the board. Suggested glyphs: 💀 skeleton, 👻 wisp, 🧟 ghoul, 👺 goblin, 🕷️ spider, 🐺 wolf, 🌿 thornling, 🪨 stone sentry, 💀❄️ frost revenant, 🧊 ice elemental. This is a one-line change per template in `enemies.ts` (add an `icon` field) and a one-word change in `generateSkirmish`.

**3. Archetype badge on enemy hover / intent**
Show the enemy archetype (or a color-coded threat label) when hovering or in the intent display. "Kiter — stays at range, seeks elevation" communicates in 4 words what the player needs to know. This is UI-only.

**4. Weak/resist affinity visible on board**
Show a small ⬆ (weak) or ⬇ (resist) glyph beneath each enemy sprite when the player has an attack action selected and the enemy has an affinity against the player's current weapon stat. This mirrors FE's weapon-triangle visibility.

### Tier 2: High Impact, Medium Effort

**5. Secondary objective modifier (optional)**
One random modifier per skirmish from a small pool:
  - *Defend the Beacon*: A designated center tile must never be occupied by an enemy at end of your turn for 5 consecutive turns (bonus gold/XP).
  - *Timed Advance*: Board starts with an "enemy reinforcement" counter (N turns); kill all enemies before it expires for bonus.
  - *Survival Run*: Enemies are endless (spawn from far edge); score = turns survived; matchends after X turns.
These don't require engine rewrites — just a flag in `HexBattleState` and a `checkObjective` pass in `endPlayerTurn`.

**6. Overwatch action**
Replace or augment "End Turn" with a "Hold" option that spends the player's action to set an overwatch flag. When any enemy moves through a tile within ranged/spell range during the enemy phase, the player's overwatch fires automatically. This makes the enemy phase interactive and rewards pre-positioning. Engine scope: one new `player.overwatch` boolean, a check in `enemyAct` before the enemy moves.

**7. Spell loadout at entry**
Before starting a Tactics match, let the player choose 2–3 spells from their known spells to bring. This adds an anticipation-of-enemies meta-game layer (do I bring Dazzle for the Wisp or Mend for sustain?) without adding complexity to the match itself.

### Tier 3: Medium Impact, Higher Effort

**8. Dynamic terrain: fire spread**
When a unit lands on or is pushed into a Hazard tile, the hazard spreads one tile in a random cardinal direction (only to floor tiles). Burned tiles stay hazardous for 2 turns. This turns a static map element into a dynamic threat that changes over the match.

**9. Enemy elite versions at higher tiers**
At tier 8+, some enemies spawn as "Elite" variants (the `enemyFor` function in `enemies.ts` already supports `elite: true` — just not plumbed into Tactics yet). Elite version: +45% HP/attack, +1 defense/ward, and a new move added to the pool. Gives high-tier matches something new to recognize and adjust to.

**10. Multi-unit: summonable ally**
At a Wisdom threshold (WI ≥ 12?), the Cleave spell gets promoted to a "Conjure" variant that summons a short-lived clone (2 turns, fraction of player stats) on any adjacent tile. This adds combined-arms decisions without a second controllable unit — the clone uses a simple "attack nearest enemy" AI. Engine scope: add a `summons` array to `HexBattleState`, run it in the enemy phase as an extra pass.

---

## Appendix: Changed Facts Since Previous Analysis

| Claim in previous analysis | Current status |
|---|---|
| "Mechanic spells like runes and blink are excluded" | **Wrong.** Blink, Push, Cleave ARE available in Tactics. Only rune/ring-of-fire/chaotic-blink are excluded. |
| "12 enemy templates" | **Wrong.** There are 10 templates. |
| "1–3 plateaus per board" | **Off.** Formula yields 2–3 on Small/Medium, 3–4 on Large. |
| "Enemy AI: if in range attack, else move closer" | **Outdated.** Four archetypes (charger/kiter/holder/flanker) with terrain-aware scoring. |
| "Enemies have no ability to use terrain" | **Outdated.** Hazard avoidance and cover/elevation seeking are in the scoring function. |
| "Enemies have `climb: 1` hardcoded" | **Outdated.** Beast/elemental start at climb 2; all scale with tier. |
| "No enemy abilities or special attacks" | **Outdated.** Moveset with guard/heavy/multi/drain/inflict per enemy. |
| "No threat visualization, no damage preview, no intent telegraphing" | **All three are implemented.** |
| "Tier 1–4 always 2 enemies" | **Misleading.** Tier starts at 4 (clamped to player level). Tier 4–9 = 2 enemies on Small. |
| "Gold = 40 × (1 + tier × 0.15)" | Still correct. At minimum tier 4: 64 gold. |
