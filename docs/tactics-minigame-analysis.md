# Hex Tactics Minigame — Analysis & Improvement Brief

## 1. Overview

Hex Tactics is a turn-based tactical skirmish added to HabitsRPG as the Agility-stat showcase minigame. The player takes their single hero into a procedurally generated hex battlefield against 2–8 AI enemies. Unlike the real-time crawlers (Mine, Forest) and the reflex-driven Arena, Hex Tactics is fully deliberate: every move is a considered decision made without a clock.

It unlocks at Level 4 and costs 3 energy per match. Wins scale gold rewards with tier; both outcomes grant AG/DX/EN stat XP.

---

## 2. Gameplay Loop

### 2.1 Entry

1. Player opens the Tactics tab, sees their current AG stat translated into concrete move/climb stats.
2. They choose board size (Small 37 tiles, Medium 61, Large 127).
3. Pay 3 energy → `generateSkirmish` builds the board.

### 2.2 Board Generation

- A flat-top axial hex grid of radius 3/4/6 is generated.
- **Elevation plateaus** are placed: 1–3 plateaus per board, each with a height (1–3) that decays outward over 1–2 hex spread. This creates hills and ridges.
- **Terrain rolling**: Each tile (except player spawn) gets a random type:
  - 70% `floor` (normal)
  - 12% `cover` (+3 flat defense while occupied)
  - 8% `slow` (movement costs 2 instead of 1)
  - 6% `hazard` (4 damage at end of occupant's turn)
  - 4% `blocked` (wall, impassable, elevation 3)
- An occlusion clamp prevents any tile from rising more than 2 above the tile directly behind it (keeps the isometric view readable).
- BFS connectivity is verified; up to 12 generation attempts are made; walls are dropped on late attempts to guarantee a connected board.
- Player always spawns at `{q: 0, r: radius}` (bottom center) on flat floor elevation 0. Enemies spawn on the far side.

### 2.3 Turn Structure

Each round is two phases:

**Player phase:**
- Move up to `moveTilesFor(AG)` tiles (2 base + floor(AG/4), max 6). Slow terrain costs 2. Climbing is limited per step by `climbFor(AG)` (1 + floor(AG/8), max 3). Descents are free.
- Perform **one action**: melee attack, ranged attack, or cast a spell.
- End turn.

**Enemy phase (automatic):**
- Each living enemy that isn't frozen either: attacks if the player is in range, or pathfinds toward the player using Dijkstra (respecting climb limits, terrain costs, and occupancy), then attacks if in range after moving.
- Burn/poison/hazard damage ticks on both sides at the end of their respective turns.

**Win condition:** All enemies reach 0 HP.  
**Loss condition:** Player reaches 0 HP.

### 2.4 Actions

**Melee attack** — adjacent targets only (distance 1). Damage uses `meleePower` stat.

**Ranged attack** — requires line-of-sight. Range = `weapon.range` + `heightRangeBonus(dz)` (up to +2 tiles from high ground). Damage uses `rangedPower`.

**Spells** (filtered to damage/support/illusion schools; mechanic spells like runes and blink are excluded):
- **Damage spells** (firebolt, sparks): Range = 4 + height bonus. Damage reduced by target ward + cover.
- **Support spells** (mend, bless): Self-cast. Heal = `spell.power + supportSpell × 1.5`.
- **Illusion spells** (dazzle for blind, hex for weaken): Range = 4 + height bonus. Status duration boosted by floor(illusionPower/8).

### 2.5 Height System

This is the mechanical spine of the minigame:

| dz (attacker − target) | Damage multiplier |
|---|---|
| +3 | 1.36× |
| +2 | 1.24× |
| +1 | 1.12× |
| 0 | 1.00× |
| −1 | 0.88× |
| −2 | 0.76× |
| −3 | 0.64× |

High ground also grants +1 ranged/spell range per level, capped at +2 tiles.

### 2.6 Match End & Rewards

- **Win**: Gold = `40 × (1 + tier × 0.15)`. Healing potions at tier ≥ 8. AG/DX/EN each get `4 + tier` XP.
- **Loss**: AG/DX/EN each get `(4 + tier) × 0.4` XP.
- `deepestTacticsTier` is updated, giving a persistent high-score to chase.

---

## 3. Stats Used

### 3.1 Primary: Agility (AG)

AG is the defining stat of this minigame and is otherwise less-used than combat stats in other modes. It governs:

- **Movement range**: 2 + floor(AG/4), capped at 6 tiles. At AG=0 you move 2; at AG=16 you reach the 6-tile cap.
- **Climb limit**: 1 + floor(AG/8), capped at 3. Controls access to high-ground tiles.
- **Dodge**: The dodge chance derived from AG affects enemy miss rates, but this is inherited from the general combat system rather than being Tactics-specific.

### 3.2 Combat Stats (Character-derived)

All player combat power is a frozen snapshot of the character's fighter stats:

| Stat | Source | Role in Tactics |
|---|---|---|
| `meleePower` | ST, weapon | Melee attack damage |
| `rangedPower` | DX, weapon | Ranged attack damage |
| `damageSpell` | WI | Damage spell power |
| `supportSpell` | WI/CH | Heal amount |
| `illusionPower` | CH | Illusion spell effectiveness/duration |
| `defense` | EN, armor | Damage mitigation vs. physical |
| `ward` | WI, armor | Damage mitigation vs. magic |
| `dodge` | AG | Enemy miss chance |

### 3.3 Stats NOT Directly Used

- **KN (Knowledge)** and **HP stat levels**: Not directly relevant to Tactics mechanics.
- **CH (Charisma)**: Only matters through its contribution to `illusionPower` and `supportSpell`.

---

## 4. The Enemy Roster

12 templates, drawn randomly per match:

| Enemy | HP | Attack | Type | Notable |
|---|---|---|---|---|
| Skeleton Warrior | 34 | 7 | Physical | Weak: ST/WI; Resist: DX |
| Wailing Wisp | 26 | 7 | Magic | Weak: DX; Resist: WI |
| Crypt Ghoul | 38 | 8 | Physical | Weak: WI/CH; Resist: ST |
| Cave Goblin | 26 | 6 | Physical | Weak: ST |
| Giant Spider | 30 | 7 | Physical | Weak: DX/WI; inflicts poison |
| Dire Wolf | 36 | 9 | Physical | Weak: DX; Resist: CH |
| Thornling | 32 | 6 | Physical | Weak: WI; Resist: ST |
| Stone Sentry | 46 | 8 | Physical | Weak: WI; Resist: ST/DX |
| Frost Revenant | 32 | 9 | Magic | Weak: ST; Resist: WI |
| Ice Elemental | 40 | 9 | Magic | Weak: ST/DX; Resist: WI |

All stats scale by `1 + (tier-1) × 0.07` for HP and attack. Defense/ward gain floor(tier/8) each.

---

## 5. How Well It Works as a Game

### 5.1 Strengths

**The height system is genuinely interesting.** The ±12%/level multiplier with range bonuses creates real spatial reasoning: claiming a plateau before enemies do is immediately rewarding. Players who position well deal noticeably more damage and can shoot farther. This is the system's best idea and it would be worth the entire minigame if it were fully exploited.

**Terrain variety creates varied boards.** The random placement of cover, slow terrain, hazards, and walls means no two matches feel identical. A hazard cluster in the center changes pathing completely. Cover near the player spawn gives a natural defensive anchor.

**Agility finally has a primary showcase.** Every other minigame uses combat stats directly; AG's contribution to dodge is passive and invisible. Here, a player who has invested in AG-linked habits (flexibility, agility-tagged habits) visibly moves further per turn — the stat investment has a clear payoff.

**The shared combat math keeps numbers consistent.** Because Tactics uses `attackRoll` / `spellDamageRoll` from `combat.ts`, damage numbers feel familiar to players who have done the Arena or dungeon encounters. There's no learning a second number language.

**Clean separation of concerns.** The engine is pure functions returning new state; RNG is injectable; the overlay is a thin renderer. This is a well-architected foundation for expansion.

### 5.2 Weaknesses

**The AI is too simple and predictable.** Enemy AI is: if in range, attack; else move closer, attack if now in range. This is the most basic possible tactical AI. Enemies have no:
- Ability to use terrain (they ignore cover, hazards, and high ground entirely when making movement decisions)
- Target selection logic beyond "the player" (there's only one target, but the point stands)
- Threat assessment (they don't back off when low HP, don't bunch up or spread, don't kite)
- Special behaviors tied to their type (the Wisp doesn't try to stay at range; the Goblin doesn't try to flank)

The result: matches devolve into "hold a hill, let enemies walk into your attacks." The AI never challenges the position you've established.

**Only one unit.** The player controls a single hero. Most tactical RPGs (FFT, Fire Emblem, XCOM) derive their decision depth from managing multiple units with different roles — healers, tanks, ranged specialists — and from managing tradeoffs between them. With one unit, there are no:
- Unit synergies or combined arms decisions
- Sacrifice plays or cover mechanics (who do I move to protect?)
- Action economy tradeoffs between characters

The single-hero format is a legitimate design choice (Slay the Spire, Into the Breach) but requires much richer solo mechanics to compensate.

**Spell variety is thin.** Players have access to at most 5 non-mechanic spells: sparks, mend, firebolt, bless, dazzle, hex. The damage spells are straightforward, and the illusion spells (blind/weaken) are strong but their effects resolve without much player decision-making beyond "cast it on the dangerous enemy." There are no area-of-effect spells, no terrain manipulation spells, no summons, and no positioning abilities (pushback, blink to a tile).

**The height system is underexplored on offense.** Enemies have `climb: 1` hardcoded (no AG-based climbing for enemies), meaning they're slow to ascend. This is asymmetrically exploitable: the player can run to a high plateau and enemies will simply fail to reach them efficiently. The high-ground advantage that should create interesting tension instead becomes a reliable dominant strategy.

**No enemy abilities or special attacks.** Enemies deal flat physical or magic damage. They don't use the terrain system differently from each other, don't have cooldown abilities, don't have multi-tile attacks, and have no unique behavior hooks. The roster has flavor (Spider inflicts poison) but the poison status is applied on hit without any telegraph or counterplay.

**Turn resolution is opaque without good feedback.** The battle log exists but is text-only. The animation system (`effects` queue) handles visual feedback, but there's no clear UI for:
- Showing the player their projected damage before committing (hover-to-preview)
- Indicating enemy attack range so the player knows which tiles are dangerous
- Showing the current high-ground bonus on a selected attack

**Limited resource pressure.** MP and Stamina are resources, but in a typical 2–5 enemy skirmish they rarely become critical constraints. A player can usually melee/attack their way through without spell pressure, which makes the spell school choices feel academic rather than consequential.

**Enemy count scaling is coarse.** The formula `2 + floor(tier/5) + sizeBonus` means enemy count changes slowly. At Tier 1–4, you always face 2 enemies. At Tier 5–9, 3 enemies. The jump from 2 to 3 feels significant, but the challenge between jumps is purely stat inflation (the 7% hp/attack scale per tier).

---

## 6. Comparison to Reference Games

### 6.1 Final Fantasy Tactics (FFT)

FFT is the gold standard for single-player turn-based tactics with RPG character growth. Key comparisons:

| Dimension | FFT | Hex Tactics |
|---|---|---|
| Unit count | 5 player + 5 enemy (typical) | 1 player + 2–8 enemy |
| Map design | Handcrafted, thematic | Procedurally generated |
| Terrain use | Elevation, water, slopes; units jump/float | Elevation, terrain types; height bonus is central |
| AI | Varied per job; mages try to line up AoE; knights advance | Uniform advance-and-attack |
| Skill depth | Per-class ability trees; 20+ spells per school; status + counter | 6 spells, 2 attack modes |
| Resource mgmt | MP, CT (charge time), HP, JP (job points) | HP, MP, Stamina |
| Decision horizon | 3–5 turns ahead (CT system means you see who acts next) | 1–2 turns ahead |
| Failure mode | Rich (positioning mistakes compound) | Forgiving (player rarely stuck) |

The single biggest FFT idea that Hex Tactics could adopt is **enemy variety creating distinct threat profiles**. In FFT, a Wizard demands different positioning than a Knight. In Hex Tactics, all enemies use the same "walk forward and hit" loop.

### 6.2 Fire Emblem (modern entries)

Fire Emblem's contribution is the **threat-range visualization**: every tile an enemy can reach and attack is highlighted before the player moves. This single UI feature fundamentally changes how tactical decisions feel — you're navigating a danger map, not guessing where enemies can reach.

Fire Emblem also popularized the **weapon triangle** and **terrain bonus** systems, both of which Hex Tactics has partial analogues to (weak/resist affinities and terrain defense) but doesn't make visually prominent.

### 6.3 Into the Breach

Into the Breach is the best single-player tactics design for a "small board, few units" format — the closest conceptual match to what Hex Tactics is attempting. Its key insights:

- **Full information**: All enemy intents are shown before the player acts. You always know what each enemy will do next turn.
- **Every action prevents damage or deals damage**: The puzzle isn't "how do I kill enemies" but "how do I prevent the city from taking damage." This gives every move a clear evaluation criterion.
- **Positional abilities matter more than raw damage**: Push, pull, freeze, and occupancy all matter because they prevent the enemy's telegraphed action.

Hex Tactics has none of this. Enemy movement is reactive, not telegraphed; attacks aren't announced in advance; and there's no secondary objective (just kill everything). Into the Breach's design is very hard to replicate without rebuilding around the "enemy intent is visible" concept.

### 6.4 XCOM 2

XCOM's key contribution relevant here: **cover is a binary, visible system with explicit hit percentages**. You always know if a tile is full cover (40% defense) or half cover (20%), and the hit chance is shown before you commit. Contrast with Hex Tactics where cover grants flat mitigation (3 defense), but the player has no pre-attack preview of the adjusted damage roll.

XCOM also uses **overwatching** (reaction shots on enemy movement) to make enemy turns feel interactive rather than passive. During the enemy phase in Hex Tactics, the player simply watches.

### 6.5 Wildermyth (partial parallel)

Wildermyth's procedural skirmish maps are the closest structural parallel: small, generated boards, a small party, enemies that appear from spawn points. Its key addition is **environmental interaction** — fire spreads, walls can be jumped, and specific abilities interact with specific terrain. This gives the terrain more dynamic weight than Hex Tactics's static system.

---

## 7. Summary Assessment

Hex Tactics is a **well-built foundation with thin gameplay depth**. The hex grid, height system, terrain variety, and procedural generation create genuine spatial variety. The architecture is clean and extensible. But the current content layer — single hero, simple AI, limited spells, no positional abilities, no damage preview, no enemy telegraphing — leaves most of that spatial variety unexploited.

In its current state, the optimal play pattern is:
1. Move to the highest tile in range on turn 1.
2. Attack the closest enemy each turn.
3. Heal if HP drops below ~50%.
4. Win when enemies die.

The height system is the only mechanical tension. Everything else is incidental.

The match length and 3-energy cost suggest this should feel like a meaningful tactical puzzle (equivalent to a dungeon run). Right now it feels closer to a simplified Arena with a top-down board — the "turns" create deliberateness but not depth.

---

## 8. Priority Improvement Areas

These are ordered by likely impact-to-effort ratio, not implementation complexity:

### High Impact

1. **Enemy threat range visualization** — Show which tiles each enemy can move-and-attack from before the player acts. This single change transforms tactical decisions from guesswork to planning. (Reference: Fire Emblem's danger zone overlay)

2. **Damage/healing preview on hover** — When the player hovers/selects a target, show the expected damage range (min–max), the height multiplier being applied, and cover contribution. Makes the height system legible rather than invisible.

3. **Enemy intent telegraphing** — Show an arrow or indicator for where each enemy intends to move and which tile they're targeting. Even a simplified "this enemy will advance toward you" arrow changes the player's decision-making horizon from 1 turn to 2.

4. **Enemy differentiated behavior** — Give each enemy type a movement/attack personality:
   - Wisp: Prefers to stay at range ≥ 2; retreats if player closes
   - Dire Wolf: Pursues aggressively regardless of terrain cost
   - Stone Sentry: Doesn't advance; holds position and forces player to engage
   - Cave Goblin: Flanks (tries to approach from a different direction than other enemies)
   - Giant Spider: Seeks hazard tiles; tries to herd player toward them

### Medium Impact

5. **Positional spells** — Add spells that manipulate position: a push/pull effect, a short blink (1–2 tiles), a root (freeze in place). These create decisions where high-ground advantage becomes something to engineer rather than just walk into.

6. **AoE abilities** — Even one splash attack (a melee cleave, or a firebolt that hits a small radius) creates multi-target positioning questions. "Do I stand adjacent to two enemies and risk a cleave, or spread them out first?"

7. **Enemy high-ground seeking** — Some enemies (Wisp, Ice Elemental) should prefer elevated tiles and use height bonuses against the player. Currently enemies ignore elevation in their pathfinding goal (they just minimize player distance, not maximize their own elevation). This makes the high-ground system one-sided.

8. **Secondary objective or time pressure** — Even a simple twist like "a fragile ally tile you must defend" or "an escape portal that opens after 5 turns" creates stakes beyond raw survival and forces the player off a static defensive hill position.

### Lower Impact / Future Scope

9. **Multi-unit player party** — Adding a second unit (a summon, a conjured ally, a pet) would open combined-arms decisions without the complexity of a full FFT-style party. Even a single expendable conjured creature changes the action economy.

10. **Unlockable enemy abilities** — Higher-tier enemies gain one named ability (e.g., Stone Sentry can do a single-tile "shield slam" that pushes, Frost Revenant can freeze for 1 turn). This gives the roster flavor that's mechanically distinct rather than purely numerical.

11. **Persistent campaign layer** — The current tier system tracks deepest tier but each match is fully independent. A light campaign layer (e.g., carry 50% of HP/MP between skirmishes in a 3-match streak for bonus rewards) would give individual matches stakes beyond a single score.
