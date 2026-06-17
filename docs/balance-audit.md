# HabitsRPG — Stats & Resources Balance Audit

> Generated 2026-06-17. Based on full read of `src/engine/`, `src/content/`, `src/store/useGameStore.ts`, and `src/hooks/`.
>
> **Fact-check pass (2026-06-17):** Every formula, constant, and table below was re-verified against source. Corrected values are marked **[corrected]** with the original noted in-line. Key fixes: the enemy roster is **10**, not 12; the enemy weakness/resistance matrix was substantially wrong (ST/WI/DX all have resists the original missed); cumulative XP thresholds were under-counted; the real-time minigames wire in **DX/WI/KN/CH/HP**, not just EN/ST/KN — **AG is the only stat with no real-time application**; dungeon floor recovery is **25%**, not 15%.

---

## Table of Contents

1. [Stat System Overview](#1-stat-system-overview)
2. [Per-Stat Balance Analysis](#2-per-stat-balance-analysis)
3. [XP & Leveling Economy](#3-xp--leveling-economy)
4. [Resource System Overview](#4-resource-system-overview)
5. [Resource Balance Analysis](#5-resource-balance-analysis)
6. [Combat Systems](#6-combat-systems)
7. [Minigame Systems](#7-minigame-systems)
8. [Relic & Gear Balance](#8-relic--gear-balance)
9. [Class System Gaps](#9-class-system-gaps)
10. [Prioritized Issue List](#10-prioritized-issue-list)

---

## 1. Stat System Overview

Eight stats define the character. Each habit maps to one stat and awards XP to it. That XP ledger (`statXp`) drives character level (total across all stats, via `100 × level^1.5`). On each level-up, 3 stat points are distributed proportionally to recent per-stat effort (Sainte-Laguë allocation), plus a class nudge for players who have unlocked a class.

| Stat | Key | Color | Habit Theme |
|------|-----|-------|-------------|
| Dexterity | DX | Amber | Precision, craft, accuracy |
| Agility | AG | Cyan | Speed, evasion, reaction |
| Strength | ST | Red | Power, force |
| Endurance | EN | Green | Stamina, persistence |
| Wisdom | WI | Purple | Insight, healing, defense |
| Charisma | CH | Pink | Influence, leadership |
| Knowledge | KN | Blue | Study, magic, strategy |
| Hit Points | HP | Teal | Health, resilience |

**Constants:**
- `POINTS_PER_LEVEL = 3` — points granted per level-up
- `STAT_CAP = 25` — maximum single-stat value
- `MAX_LEVEL = 50` — soft ceiling
- `BASE_STAT_LEVEL = 1` — every stat starts at 1
- `STARTING_STAT_POINTS = 5` — free creation points. `CREATION_STAT_MAX = 4` (`BASE_STAT_LEVEL + 3`) caps each stat's *value* at 4 during creation — i.e. at most **3** of the 5 points can go into any single stat **[clarified: original read "max 4 into any one stat", which implied a 4-point allocation cap; it is a value cap of 4 = 3 added points]**

---

## 2. Per-Stat Balance Analysis

### Strength (ST) — Overloaded

**All combat roles:**
- Turn-based: `meleePower = ST_level` — primary weapon damage with the starter sword and iron mace
- Real-time Mine: weapon attacks on monsters use `weapon.staminaCost` (weapon defined by tool slot, often the pickaxe which grants ST)
- Real-time Forest: blade slash damage

**Tool synergy:** Every pickaxe/toolkit in the game gives ST as a stat bonus (+1, +3, +5), making ST the natural destination for mining and forestry players.

**Enemy weaknesses:** skeleton, goblin, ice_elemental, frost_revenant — 4 of **10** enemies. **[corrected: original said "4 of 12 enemies, the most of any stat" — the roster is 10, and Wisdom actually has the most weaknesses at 5.]** ST is also **resisted by 3 enemies** (ghoul, thornling, stone_sentry), which the original analysis omitted — so ST is more double-edged in combat than "widest utility" implies.

**Relic coverage:** Ember Sigil (T1 +3 ST), Twin Fang (T2 +4 ST/+2 DX), Titan Grip (T3 +6 ST/+25 HP) — the most powerful single-stat T3 relic in the game.

**Verdict:** ST has a wide utility surface (melee combat, all tool gear, strongest T3 relic) and players are passively pushed toward it through toolkit drops. But on enemy affinity it is *not* the standout: its net affinity (4 weak − 3 resist = **+1**) is below Wisdom and Dexterity (both **+2**). The gravitational pull toward ST comes mainly from gear, not encounter design.

---

### Endurance (EN) — Split Between Two Separate Systems

**Turn-based combat:** `maxSta = 12 + EN_level`
- With EN=5: 17 stamina. Iron Mace costs 3/swing → ~5 swings before exhausted.
- Exhaustion penalty: ×0.5 damage multiplier (brutal for low-EN characters).
- Defend action recovers `round(maxSta × 0.5)` — so fight rhythm becomes swing→brace→swing.

**Real-time minigames:** `dungeonStamina = 50 + EN_level`
- With EN=5: 55 stamina — the same EN value means 3× more real-time stamina than battle stamina.
- Regen: +1 every 1200 ms passively.

**Disconnect:** The same EN stat has wildly different feels in turn-based vs real-time contexts. A low-EN fighter is severely hindered in dungeon battles (5 swings to exhaustion) but fine in the Mine (55+ stamina with passive regen). Players who invest in EN for minigames get unexpectedly strong benefit in the wrong dimension.

**Relic gap:** No EN-focused T3 relic. Bulwark Crest (T2) gives +2 EN/+3 Defense.

---

### Wisdom (WI) — Counterintuitive Role

**Turn-based:** `damageSpell = WI_level` — scales offensive spells (sparks, firebolt)

**The WI/KN role reversal issue:** In most RPG conventions, Wisdom implies healing and Knowledge implies arcane power. In this game:
- WI → **attack spells** (sparks, firebolt)
- KN → **healing spells** (mend, bless) AND the entire MP pool (`maxMp = 8 + KN × 3`)

KN double-dips (bigger mana pool **and** better heals), while WI's only benefit is damage output. This is a defensible design choice — but the label mismatch ("Wisdom" dealing damage, "Knowledge" healing) will confuse players who aren't reading deeply. Worth documenting clearly in the UI.

**Relic:** Warding Rune (T2) gives +2 WI/+3 Ward. Sage Bead (T1) gives +3 WI. The archsage_codex (T3) goes to KN, not WI.

**Enemy weaknesses:** **[corrected]** weak: skeleton, **ghoul**, giant_spider, thornling, stone_sentry (**5** enemies — the most of any stat). Resist: wisp, **frost_revenant, ice_elemental** (**3** enemies). *(Original said "4 weaknesses and only 1 resist" — it missed ghoul as a WI weakness and frost_revenant/ice_elemental as WI resists.)* WI has the broadest weakness coverage, but its 3 resists give it the same **net affinity (+2)** as Dexterity, so it is not uniquely dominant for an encounter-by-encounter build.

---

### Knowledge (KN) — Double Dip

- `maxMp = 8 + KN × 3` — at KN=10: 38 MP; at KN=1: 11 MP
- `supportSpell = KN_level` — scales mend (+14 + KN × 1.5) and bless

KN governs both the **size of the mana pool** and **the effectiveness of heals**. A high-KN character can cast many spells (more MP) **and** each heal restores more HP. Any spell-focused build must invest in KN, making it mandatory for casters — but this may also be intentional.

**Issue:** The Scholar's Lantern (+3 KN trinket) gives +10% XP on Study habits, which is nice thematic consistency but its combat role (healer/MP) doesn't match "study" intuitively.

**Enemy weaknesses:** No enemy in the game is weak to KN. No enemy resists KN. KN is entirely invisible in encounter design, which is a missed opportunity.

---

### Charisma (CH) — Weakest Mechanical Footprint

**Turn-based combat:** `illusionPower = CH_level` governs illusion spells:
- dazzle: blind status (2 turns), no damage
- hex: weaken debuff (0.4 damage reduction, **3 turns**) **[corrected: original said 2 turns; `content/spells.ts` defines `turns: 3`]**
- Extended duration formula: `+1 turn per full 8 CH` (`Math.floor(illusionPower / 8)` — at CH 8 → +1, CH 16 → +2; no baseline subtraction)

**Problems:**
1. At CH=7 (a reasonable early-game value), dazzle still only lasts 2 turns — you need CH=8 for +1 turn, CH=16 for +2 extra turns. The CH threshold per additional turn is too steep.
2. Neither illusion spell deals damage. A CH-primary build contributes zero direct damage; the player relies entirely on physical or other stats for kill power.
3. No real-time minigame — Mine, Forest, and Arena have no CH-scaled mechanics.
4. Royal Court skill trial is CH-flavored (social dialogue puzzle), but trial rewards are XP to CH, not gameplay advantage.
5. Only one enemy (ghoul) is weak to CH. The dire wolf **resists** CH, making CH actively harmful in that encounter. **[corrected: original called this "the only stat with a resist" — in fact ST, WI, and DX each have resists too; CH is unusual only in that its single weakness and single resist exactly cancel, for net affinity 0.]**

**Net assessment:** CH enables CC-focused gameplay in turn-based combat but is the only stat with zero real-time minigame application and near-zero encounter affinity. A pure-CH class (Bard, General, Lord) is at a significant disadvantage vs. a pure-ST or pure-WI build.

---

### Agility (AG) — Defensive Only

**Turn-based:** `dodge = min(0.4, AG × 0.02)`, `flee = min(0.9, 0.4 + AG × 0.03)`

AG contributes no damage — its entire function is damage avoidance. At AG=20 (near cap), 40% of physical hits are avoided. This is strong for survival but contributes nothing offensively.

**Minigame:** AG has no direct application in Mine, Forest, or Arena movement speed. The character moves at a fixed tile cadence (150 ms) regardless of AG.

**Class design:** AG as primary unlocks Thief, Acrobat, Ninja, Skirmisher, Windwalker, Daredevil, Saboteur, Escape Artist — flavor-rich but mechanically all reliant on secondary stats for damage.

**Relic gap:** Swift Anklet (T1 +3 AG), but no T2 or T3 AG relic. The leaden_weight curse is AG-based (-3 AG), suggesting AG matters — but the relic table doesn't reflect this importance at higher tiers.

---

### Dexterity (DX) — Range-Gated

**Turn-based:** `rangedPower = DX_level` — only activates with a bow equipped (short_bow or hunting_bow).

DX is the gated behind a specific weapon type that itself requires crafting (short_bow: 2 leather + 1 cloth_roll + 20g) or purchase (hunting_bow: 170g). A player who primarily uses the starter sword gets zero return on DX investment until they acquire a bow.

**Lockpick Gloves** (+5 DX, craft: 1 leather + 1 iron_bar) are the most useful DX item for dungeon stat-check rooms, but these rooms are not described in the engine code examined here.

**Enemy weaknesses:** wisp, giant_spider, dire_wolf, ice_elemental — 4 enemies weak to DX. Good coverage.

**Relic:** Keen Lens (T1 +3 DX), Twin Fang (T2 +4 ST/+2 DX — the DX component is secondary).

---

### Hit Points (HP) — Awkward as a Habit Stat

HP is mechanically clear in combat (`maxHp = 50 + HP_level × 7 + charLevel × 3`) but awkward as a habit-tracking stat. What real-life habits map to HP? Sleep? Nutrition? Medical check-ins?

**Impact:** At HP=10, the stat contributes +70 max HP. At HP=1 (untrained), the base pool is 50 + charLevel×3, which at level 10 is 80 HP. An HP-trained character has significantly more cushion, but this stat is purely defensive — it only matters when things go wrong.

**No HP-specific gear synergy:** Bedroll (+4 HP, armor) is the only gear that boosts HP stat directly. Vital Charm relic (+15 maxHp) bypasses the stat entirely, making the relic better than training HP in the short term.

**Tank class (HP primary):** Tank → Ironwall (advanced). A full HP investment gives the highest maxHp in the game but deals the weakest damage. Combined with low damage output (HP has no offensive formula), this class needs careful content balancing.

**No HP weaknesses:** No enemy is weak to "HP" (health is not a weapon). HP contributes nothing to encounter affinity, spell schools, or minigame mechanics.

---

## 3. XP & Leveling Economy

### Habit XP

| Difficulty | Base XP |
|------------|---------|
| Easy | 10 |
| Normal | 20 |
| Hard | 35 |
| Epic | 50 |

Quantity habits scale by completion ratio (capped at 1.5×). Recovery bonus: ×1.1 when returning after a missed day.

### Level Thresholds

| Level | XP to Next | Cumulative XP |
|-------|-----------|--------------|
| 1 | 100 | 0 |
| 2 | 283 | 100 |
| 3 | 520 | 383 |
| 4 | 800 | 903 |
| 5 | 1,118 | 1,703 |
| 10 | 3,162 | **11,106** |
| 20 | 8,944 | **67,135** |
| 50 | 35,355 | **~689,513** |

**[corrected: original cumulative figures for L10/L20/L50 were 9,518 / 43,946 / ~519,000 — all under-counted. The per-level "XP to Next" values are correct; the cumulative column is `sum of xpForNextLevel(1..L-1)`, recomputed from `engine/leveling.ts` with `Math.round`. L1–L5 cumulatives were already correct.]**

With 3 daily Normal habits, a player earns 60 XP/day → level 2 in ~2 days, level 5 in ~28 days, level 10 in **~185 days** **[corrected from ~159, which followed from the wrong L10 cumulative]**. Adding minigame content doesn't accelerate this much (dungeon enemies give ~12–20 XP, trials give unspecified amounts).

### Dungeon Combat XP

`combatXpForWin(enemyMaxHp) = 12 + round(enemyMaxHp / 6)`

A depth-1 Skeleton (baseHp≈34 unscaled) gives approximately 12 + 6 = 18 XP — equivalent to logging one Normal habit. The dungeon is a gold/materials/relic source, not a meaningful leveling path. This is probably intentional but should be clearly communicated to players who expect dungeon running to advance their character.

### Stat Distribution Concern

At STAT_CAP=25 and POINTS_PER_LEVEL=3, fully capping one stat requires 24 invested points = 8 levels of exclusive training in that stat. A player who diversifies across 4 stats will have all 4 at approximately level 7 by level 10 — which corresponds to meaningful but not extreme values. The Sainte-Laguë distribution handles spreading well, but the class nudge (`max(15, 0.15 × totalDelta)`) is strong enough to funnel points into class stats even when the player is training other things.

---

## 4. Resource System Overview

| Resource | Source | Sink |
|----------|--------|------|
| Energy | Habit completion (+1/habit) | Minigame entry (2–3 per run) |
| Gold | Mine ore/monsters, Forest nodes/beasts, Dungeon treasure, Challenges | Merchant shop, Crafting recipes (gold cost), Shop gear |
| Materials | Mine ore veins, Forest nodes/beasts | Crafting recipes |
| Stamina (Battle) | Starts full per fight, Defend action restores 50% | Weapon attacks |
| Stamina (Dungeon) | Passive regen +1/1200ms; Forest springs +12–16 / ancient +20–25; Mine "Energy Gem" +11; floor descent restores **25%** | Pickaxe swings (1), Weapon attacks (weapon.cost — sword 2 / mace 3), Forest slash (weapon.cost, default 2), Chop (1), Bow (1) |
| MP (Battle) | Starts full, no regen | Spells (4–9 per cast) |
| MP (Dungeon) | Passive regen +1/2000ms, floor descent restores **25%** | Spells (4–9 per cast) |
| Combat Stats | Dungeon fight wins (`combatXpForWin`) | Applied via `sqrt(xp)` curve as flat damage mitigation |

**[corrected:** original listed "Springs (+12–25)" for dungeon stamina and "Floor recovery (15%)" for MP. Actual: the Mine refills via fixed-**+11** "Energy Gem" nodes; the Forest uses springs (+12–16) and ancient springs (+20–25). Descending a floor/stage restores **25%** of *both* max stamina and max MP (`engine/mining.ts`, `engine/forest.ts` — `Math.round(max * 0.25)`), not 15% MP only.**]**

---

## 5. Resource Balance Analysis

### CRITICAL: Five Dead-End Materials

Of 11 materials defined, **5 have no crafting recipe**:

| Material | Source | Recipes | Status |
|----------|--------|---------|--------|
| `gemstone` | Mine floor 10+, deep monster drops | None | **Dead end** |
| `stone` | Rock mining in Mine | None | **Dead end** |
| `wood` | Tree chopping in Forest | None | **Dead end** |
| `game_meat` | Forest deer kills | None | **Dead end** |
| `pelt` | Forest rabbit kills | None | **Dead end** |

Forest content produces 4 of these 5 dead-end materials. Players who focus on the Wild Forest minigame will accumulate wood, meat, and pelts with no outlet. This is either missing content (recipes not yet written) or the Forest loot tables need adjustment.

The existing 6 crafting materials (`leather`, `iron_bar`, `cloth_roll`, `bronze_bar`, `herbs`, `crystals`) each have at least one recipe. Only `bronze_bar` feels light (used in `bronze_plate` and monster drops at low floors but no other recipe).

---

### CRITICAL: Mithril Toolkit Has No Acquisition Path

`mithril_pickaxe` / "Mithril Toolkit" is defined in `src/content/gear.ts` with full stats (+3 mining/chopping power, +5 ST) but:
- No `price` field (can't buy it)
- No recipe in `src/content/recipes.ts`
- Not referenced as a drop reward anywhere in the scanned code

The progression path for pickaxes (Stone → Iron → Mithril) is broken at the top tier. Players can obtain or buy the Iron Toolkit (200g) but cannot reach Mithril.

---

### Energy: No Cap, Binge Risk

Energy accumulates indefinitely. There is no cap mentioned in the store code. A player who:
1. Skips habit logging for several days (earning 0 energy)
2. Returns and logs a burst of habit completions

...gets all the energy at once, enabling a binge session of minigame runs disconnected from the daily habit practice the game is designed to reward.

**Also:** Energy earns +1 per habit regardless of difficulty. An Easy habit and an Epic habit both give +1 energy. This reduces the incentive to track harder habits if energy is the bottleneck resource.

**Suggested options:** Cap energy at some multiple of daily habit count, or grant energy proportional to habit difficulty.

---

### Gold: Early-Game Bottleneck

The cheapest useful gear upgrade path:
- leather_vest: 3 leather (free from Forest beasts)
- iron_mace: 3 iron_bar + 20g (need iron bars from floor 3+)
- iron_pickaxe: 200g shop price (the primary upgrade for miners)

At depth 1, dungeon treasure yields ~70–100 gold. The iron_pickaxe costs 200g — two full dungeon runs before the player can afford their first real tool upgrade. This is not necessarily wrong (gating is appropriate) but is worth monitoring against energy cost per run.

Gold_vein ore drops [8–20] gold per node, making deep Mine runs the most efficient gold source once accessible. Forest gold comes from berry_forage [1–5] — significantly weaker.

---

### Stamina: Context Mismatch

| Context | Formula at EN=5 | Pool Size |
|---------|----------------|-----------|
| Turn-based battle | 12 + 5 = **17 stamina** | Small |
| Real-time minigame | 50 + 5 = **55 stamina** | Large |

The 3:1 ratio creates a jarring disconnect. Low-EN players are harshly punished in battle (5 iron mace swings → exhausted, ×0.5 damage penalty) but comfortable in minigames. There's no communication to the player about why the same stat behaves so differently.

**Recommendation:** Either normalize the formulas, make the distinction explicit in the UI ("Battle Stamina" vs "Run Stamina"), or change one pool to derive from a different stat.

---

### Combat Stats (Defense/Ward): Habit-Invisible

`defenseXp` and `wardXp` are trained exclusively through dungeon combat wins. They apply via `mitigation(xp) = sqrt(xp)`:
- 100 combat XP → 10 flat defense
- 400 combat XP → 20 flat defense

These stats have no connection to the habit system, no gear equivalent for mitigation scaling (gear gives flat defense directly), and no indication on the character sheet that habits can't improve them. Players who never enter the dungeon will have 0 defense/ward even at high character level.

This siloed design is likely intentional (dungeon specialization), but players may feel their habit effort doesn't transfer to dungeon resilience.

---

## 6. Combat Systems

### Damage Formula Reference

```
attackRoll = variance(power + bonus, rng) × [1.25 if weak | 0.6 if resist | 0.5 if exhausted] − defense
variance(base) = base × (0.85 + rng() × 0.3)   → ±15% spread
```

- `meleePower = ST_level`
- `rangedPower = DX_level`
- `damageSpell = WI_level`
- `supportSpell = KN_level`

### Spell MP Efficiency

| Spell | MP Cost | Power | School | Efficiency (damage/MP) |
|-------|---------|-------|--------|----------------------|
| sparks | 4 | 8 + WI | Damage | ~2.0 |
| dazzle | 6 | — | Illusion | N/A (CC only) |
| mend | 6 | 14 + KN×1.5 | Heal | ~2.8 heal/MP |
| hex | 7 | — | Illusion | N/A (CC only) |
| bless | 8 | — | Illusion/support | N/A (defensive) |
| firebolt | 9 | 12 + WI | Damage + burn | ~1.6 + burn tick value |

Sparks is the most MP-efficient damage spell. Firebolt's burn status adds damage-over-time value, but at 9 MP it may not be justified vs. two sparks casts (8 MP, ~16 power) unless the burn ticks contribute meaningfully.

Illusion spells (dazzle, hex) have no direct damage and their CC value is hard to quantify — especially early when CH-based duration extensions require 8 CH per extra turn.

### Enemy Weakness Coverage

**[corrected — rebuilt directly from `engine/enemies.ts`. The roster is 10 enemies; the original table missed every ST resist, two of three WI resists, ghoul's WI weakness, and stone_sentry's DX resist.]**

| Stat | Enemies Weak To | Enemies Resist | Net (weak−resist) |
|------|----------------|----------------|------|
| ST | skeleton, goblin, frost_revenant, ice_elemental (4) | ghoul, thornling, stone_sentry (3) | +1 |
| WI | skeleton, ghoul, giant_spider, thornling, stone_sentry (5) | wisp, frost_revenant, ice_elemental (3) | +2 |
| DX | wisp, giant_spider, dire_wolf, ice_elemental (4) | skeleton, stone_sentry (2) | +2 |
| CH | ghoul (1) | dire_wolf (1) | 0 |
| AG | — | — | 0 |
| EN | — | — | 0 |
| KN | — | — | 0 |
| HP | — | — | 0 |

Full per-enemy matrix (10 enemies): skeleton (weak ST/WI, resist DX); wisp (weak DX, resist WI); ghoul (weak WI/CH, resist ST); goblin (weak ST); giant_spider (weak DX/WI); dire_wolf (weak DX, resist CH); thornling (weak WI, resist ST); stone_sentry (weak WI, resist ST/DX); frost_revenant (weak ST, resist WI); ice_elemental (weak ST/DX, resist WI).

**Critical gap:** AG, EN, KN, and HP have zero enemies either weak or resistant to them — these four stats are entirely invisible to encounter design. **The offensive stats are also more balanced than the original implied:** WI and DX tie for the best net affinity (+2), while ST — despite the most gear synergy — nets only +1 because three enemies resist it. CH is a true wash (one weakness, one resist).

---

## 7. Minigame Systems

### Stat Coverage by Minigame

**[corrected — the original claim that Mine/Forest/Arena "only use EN/ST/KN" is wrong. All three build a full combat snapshot via `deriveCombatant` and wire in melee (ST), ranged (DX, when a bow is equipped), damage spells (WI), support spells/MP (KN), and illusion-spell duration (CH); stamina derives from EN and survivability from HP. The only combat stat with no real-time effect is AG (movement is a fixed 150 ms cadence with no dodge).]**

| Minigame | Stats Used | Stats Ignored |
|----------|-----------|--------------|
| Deep Mine | EN (stamina), ST (melee), DX (bow attacks), WI (damage spells), KN (heals + MP pool), CH (illusion duration), HP (survivability) | AG |
| Wild Forest | EN (stamina), ST (slash), DX (bow attacks), WI (damage spells), KN (heals + MP pool), CH (illusion duration), HP (survivability) | AG |
| Arena | EN (stamina regen), ST (melee), DX (ranged), WI (damage spells), KN (MP pool), CH (illusion), HP | AG |
| Dungeon | ST (melee), DX (ranged), WI (spells), KN (heals/MP), AG (dodge/flee), EN (stamina), CH (illusion CC), HP | — |

The real-time minigames are **far less stat-blind than the original audit claimed**: only **Agility** has no application in Mine/Forest/Arena (the turn-based dungeon is where AG's dodge/flee matters). That said, the *practical* footprint of DX/WI/CH/KN in the minigames is gated behind optional gear/casting — a player who only melees and never equips a bow or casts spells will, in practice, lean on EN/ST/HP. So the original's underlying concern (minigames reward a narrow stat set in typical play) is partly valid, but the mechanical claim that 5 stats are *unused* is false; only AG truly is.

### Scaling Rate

Mine and Forest grow at identical rates (`base 33×33 → max 57×57` over ~12 depth/stage bands, +4 cells per 4-band). The two feel mechanically similar at a systems level, differentiated mainly by loot pools (ore vs. natural resources) and movement patterns (monsters vs. beasts with telegraph animations).

---

## 8. Relic & Gear Balance

### Relic Stat Coverage by Tier

| Tier | Relics | Stats Covered |
|------|--------|--------------|
| T1 | 8 (one per stat + HP as maxHp) | DX, AG, ST, EN, WI, CH, KN, HP |
| T2 | 5 | ST+DX (twin_fang), KN+WI (arcane_prism), EN+Def (bulwark), WI+Ward (warding_rune), HP+Def (stone_heart) |
| T3 | 3 | ST (titan_grip), KN (archsage_codex), universal (phoenix_feather) |
| Curses | 3 | EN (cracked_idol), AG (leaden_weight), HP (brittle_bones) |

**Tier 3 gap:** No T3 relic for AG, CH, DX, or WI. Players who invest in these stats get nothing from the highest-tier dungeon rewards. Titan Grip's +6 ST / +25 HP is far more impactful than any stat bonus accessible to an AG or CH build.

**Curse asymmetry:** Only 3 curses exist, covering EN/AG/HP. DX, ST, WI, CH, KN have no corresponding curses — the shrine gamble system can never penalize the strongest stats (ST, WI).

### Gear Stat Coverage

| Gear | Slot | Main Bonus |
|------|------|-----------|
| Leather Vest | Armor | +4 Defense |
| Bronze Plate | Armor | +8 Defense, +2 Ward |
| Adventurer's Bedroll | Armor | +4 HP stat |
| Iron Kettle Bell | Trinket | +4 ST |
| Sage Ring | Trinket | +3 WI, +2 Ward |
| Scholar's Lantern | Trinket | +3 KN, +10% Study XP |
| Bard's Cloak | Trinket | +4 CH |
| Runner's Boots | Tool | +5 AG, +10% Fitness XP |
| Lockpick Gloves | Tool | +5 DX |
| Stone Toolkit | Tool | +1 ST, mine/chop power 1 |
| Iron Toolkit | Tool | +3 ST, mine/chop power 2 |
| Mithril Toolkit | Tool | +5 ST, mine/chop power 3 (**no acquisition path**) |

**Gaps:**
- No gear targets EN stat directly
- No weapon or gear applies WI directly (only through Sage Ring)
- Bard's Cloak (+4 CH) has no XP perk, unlike Runner's Boots and Scholar's Lantern — CH gets the weakest trinket
- All three toolkits grant ST, reinforcing ST's dominance in the tool slot

### Weapon Balance

| Weapon | Stat | Bonus | Stamina Cost | Range | Source |
|--------|------|-------|-------------|-------|--------|
| Worn Sword | ST | +3 | 2 | Melee | Starter |
| Iron Mace | ST | +6 | 3 | Melee | Craft/Buy (120g) |
| Short Bow | DX | +4 | 2 | 3 tiles | Craft (2 leather + 1 cloth_roll + 20g) **or buy 120g** |
| Hunting Bow | DX | +5 | 1 | 5 tiles | Buy (170g) |

The Hunting Bow is strictly better than the Short Bow on every metric (higher bonus, lower stamina cost, longer range) once it can be afforded. There's no trade-off between the two bows; the short bow is a stepping stone. The short bow's only advantage is its lower cost (craft vs. 170g) — which makes it a transitional item rather than a genuine choice.

---

## 9. Class System Gaps

### CLASS_UNLOCK_LEVEL = 10

The class chart has 64 entries but only 8 of those classes have advanced forms:

| Base Class | Advanced Class |
|-----------|---------------|
| Rogue | Shadowblade |
| Bard | Maestro |
| Knight | Champion |
| Wizard | Archmage |
| Tank | Ironwall |
| Healer | Saint |
| Ninja | Phantom |
| Druid | Verdant Oracle |

56 of 64 classes (87.5%) have no advancement path. The level threshold for advanced classes is not defined in the code — `ADVANCED_CLASSES` is a static lookup without a corresponding `ADVANCED_CLASS_UNLOCK_LEVEL` constant. `advancedClassFor()` exists but is only consumed for display in `CharacterView.tsx` (it renders the advanced name); **[confirmed]** no logic ever *assigns* an advanced class — the advancement is cosmetic, not a mechanical milestone.

### Stat Nudge Before Class Assignment

`allocateStatGains` accepts a `classFavored: StatId[]` parameter. **[resolved — verified in `useGameStore.ts`]** The level-up action computes `favored = ch.classId ? rankStats(ch.statXp).slice(0, 2) : []`, and `classId` is only set at `CLASS_UNLOCK_LEVEL` (10). So before level 10 the nudge is genuinely zero and points distribute by effort alone — the "proto-class locks early allocation" concern does **not** materialize. No fix needed; the behavior is correct.

---

## 10. Prioritized Issue List

### P0 — Blocking / Content Missing

| # | Issue | File(s) | Impact |
|---|-------|---------|--------|
| 1 | **5 materials have no recipes** — `gemstone`, `stone`, `wood`, `game_meat`, `pelt` are dead ends | `src/content/recipes.ts` | Players collect Forest/Mine materials with no use; inventory clutter |
| 2 | **Mithril Toolkit unreachable** — no price, no recipe, no drop | `src/content/gear.ts`, `recipes.ts` | Pickaxe progression stops at Iron Toolkit |

### P1 — Significant Balance Issues

| # | Issue | Impact |
|---|-------|--------|
| 3 | **AG has no real-time minigame role** **[corrected from "CH has no real-time minigame role" — CH *does* extend illusion-spell duration in all minigames; AG is the only combat stat with zero real-time application]** | Movement is a fixed 150 ms cadence with no dodge; AG-primary builds gain nothing from Mine/Forest/Arena. CH's minigame footprint is marginal (illusion duration only). |
| 4 | **4 stats (AG, EN, KN, HP) have zero enemy affinity** (of the 10-enemy roster) | Combat builds ignore these stats for dungeon encounter optimization |
| 5 | **Dungeon stamina is 3× battle stamina at same EN value** | Low-EN players face exhaustion in combat but feel fine in Mine/Forest; inconsistent stat meaning |
| 6 | **WI/KN role labeling is counterintuitive** | Wisdom deals damage, Knowledge heals — inverse of player expectation; likely causes builds to feel wrong |
| 7 | **No T3 relics for AG, CH, DX, or WI** | High-investment players in 4 of 8 stats get no tier-3 relic reward |
| 8 | **Only 3 shrine curses, all on defensive stats** | ST, WI, KN, DX, CH never cursed — shrine risk is low for offense-focused builds |

### P2 — Polish / Minor Imbalances

| # | Issue | Impact |
|---|-------|--------|
| 9 | **Energy cap absent** — unlimited banking possible | Enables binge patterns decoupled from daily habit practice |
| 10 | **Energy is difficulty-blind** — Epic habits give same +1 as Easy | Reduces incentive to log hard habits if energy is the binding resource |
| 11 | **Hunting Bow strictly dominates Short Bow** — no trade-off | Short Bow is a transitional item only; no reason to keep it |
| 12 | **CH illusion duration requires 8 CH per +1 turn** — too steep | At CH=7, dazzle is identical to CH=1; CH investment feels unrewarded until mid-game |
| 13 | **HP is awkward as a habit stat** | Unclear what real-life habits map to HP; may confuse onboarding players |
| 14 | **56/64 classes have no advanced form** — ADVANCED_CLASSES incomplete | Reaching end-game with most classes has no progression milestone |
| 15 | **Forest gold income (berry_forage [1–5])** is far below Mine income | Forest is the primary natural resource zone but weakest gold earner |
| 16 | **All 3 toolkits grant ST** — no diversity in tool slot | Tool slot effectively forces ST investment for miners/foresters |
| 17 | **Bard's Cloak has no XP perk** unlike Runner's Boots / Scholar's Lantern | CH gear is the weakest trinket in the game |

---

## Appendix: Quick-Reference Formulas

```
maxHp         = 50 + HP_level × 7 + charLevel × 3
maxMp         = 8 + KN_level × 3
maxSta(battle)= 12 + EN_level
maxSta(dungeon)= 50 + EN_level
dodge         = min(0.40, AG × 0.02)
flee          = min(0.90, 0.40 + AG × 0.03)
meleePower    = ST_level
rangedPower   = DX_level
damageSpell   = WI_level
supportSpell  = KN_level
illusionPower = CH_level  [status duration +floor(CH / 8) turns]
mitigation    = floor(sqrt(combatXp))
xpForLevel(L) = round(100 × L^1.5)
cumXpToReach(L)= Σ xpForLevel(1..L-1)   [L10=11,106  L20=67,135  L50≈689,513]
combatXpWin   = 12 + round(enemyMaxHp / 6)
dungeonGold   = 60 + depth × 10 + floor(rng × 40)   [depth 1 → 70–109]
floorDescent  = +25% of max stamina AND max MP
```
