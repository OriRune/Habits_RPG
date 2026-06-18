# Forest & Mining Minigame Analysis

*Prepared as a design foundation for the next-level improvement plan.*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Shared Crawl Core](#2-shared-crawl-core)
3. [Deep Mine — Complete Mechanics](#3-deep-mine--complete-mechanics)
4. [Wild Forest — Complete Mechanics](#4-wild-forest--complete-mechanics)
5. [Stats Analysis — All 8 Stats Across Both Games](#5-stats-analysis--all-8-stats-across-both-games)
6. [Co-op / Multiplayer Layer](#6-co-op--multiplayer-layer)
7. [Design Analysis — How Well They Work as Games](#7-design-analysis--how-well-they-work-as-games)
8. [Comparisons to Known Games](#8-comparisons-to-known-games)
9. [Opportunities — Forward Pointers for Improvement](#9-opportunities--forward-pointers-for-improvement)

---

## 1. Executive Summary

The Deep Mine and Wild Forest are HabitsRPG's two real-time grid-crawler minigames. They share an engine (`src/engine/crawl.ts`) and a nearly identical control scheme: move on a tick (150 ms/step), act on a tick (240 ms/swing), fight procedurally generated enemies, gather resources, push deeper, and bank on exit.

**The technical skeleton is genuinely strong.** Deterministic seeded generation, a clean BFS flow-field AI, a host-authoritative co-op layer with per-player bodies and shared world, and a well-separated engine/hook/store/view architecture all give these games a solid foundation. They play without stutter, are instantly understandable, and are already co-op–capable.

**The gameplay surface is thin.** Moment-to-moment combat is a single repeated action with no combos, dashes, or positioning decisions. Six of the eight character stats have either no effect or a marginal spellcasting effect that most players never engage with. The loot economy produces gold and materials (economy fuel) but no run-defining upgrades or build choices. The Mine has no death penalty, removing push-your-luck tension almost entirely. Both games lack a win condition, a score, or a mastery curve — they are resource-collection treadmills with escalating numbers but flat skill expression.

The Wild Forest is the more interesting of the two, primarily because of its sleeping-beast ambush system, prey-vs-predator AI duality, death-forfeits-half-haul stakes, and the maze + fog combination. The Mine is technically simpler and feels more like a chore than a game.

Both are ripe for deep improvement without architectural surgery — the shared engine, stat system, and co-op transport are reusable exactly as-is.

---

## 2. Shared Crawl Core

**File:** `src/engine/crawl.ts`

All grid geometry, pathfinding, and timing constants shared between the two minigames live here.

### 2.1 Camera Window

```
VIEW = 11   // crawl.ts:42 — both games show an 11×11 viewport
```

`cameraWindow(player, rows, cols)` centers the viewport on the player, clamped to grid bounds (`crawl.ts:48–57`). Effective visible area: 11×11 = 121 cells, or roughly 6 cells in each cardinal direction.

### 2.2 Stamina Formula

```
dungeonStamina(enLevel) = 50 + enLevel   // crawl.ts:67–69
```

Deliberately larger than the Arena/battle pool (`12 + EN`). At EN=0 you have 50 stamina; at EN=10 you have 60. The large base means EN upgrades are low-leverage early.

### 2.3 BFS Flow-Field Pathfinding (Enemy AI)

Three cooperative functions:

| Function | Purpose |
|----------|---------|
| `floodField(target, rows, cols, passable)` | Single-source BFS from one player; returns distance map (`crawl.ts:81`) |
| `floodFieldMulti(targets[], …)` | Multi-source BFS — each cell maps to nearest player. Co-op targeting (`crawl.ts:114`) |
| `flowStep(from, field, blocked)` | Given a distance map, step toward smallest neighbor not in `blocked` (`crawl.ts:150`) |

Enemies are not baked into the field — they share the same field but each consults `blocked` (other monsters + players) to avoid stacking. Enemy AI is therefore cheap but emergent: monsters funnel through chokepoints naturally.

### 2.4 Status Effects

All statuses are real-time, ms-gated:

```
DOT_TICK_MS       = 1500   // crawl.ts:201 — burn/poison tick interval
FREEZE_DURATION_MS = 3000  // crawl.ts:203
```

`applyStatus` upserts (extending expiry and raising magnitude, never stacking multiple instances — `crawl.ts:206`). Active statuses: `burn | poison | freeze | bless | weaken | blind`.

### 2.5 Regen Intervals

```
STA_REGEN_MS  = 1200   // crawl.ts:263 — +1 stamina per tick
MP_REGEN_MS   = 2000   // crawl.ts:265 — +1 mana per tick
RING_HIT_CD_MS =  600  // crawl.ts:267 — ring-of-fire hit interval
RING_DURATION_MS = 8000 // crawl.ts:269
```

### 2.6 Damage Modifiers

From `src/engine/combat.ts`:
- `weakTo` stat: ×1.25 damage taken (`combat.ts:267`)
- `resistTo` stat: ×0.6 damage taken (`combat.ts:268`)
- Exhausted (insufficient stamina): ×0.5 damage dealt (`combat.ts:269`)

Base damage roll: `base = power + weaponBonus`, then `variance = base × (0.85 + rng × 0.3)` = ±15% (`combat.ts:244–252`), then weak/resist/exhausted modifiers, then `max(1, round(dmg) - defense)`.

---

## 3. Deep Mine — Complete Mechanics

**Core files:**
- `src/engine/mining.ts` — pure game rules
- `src/hooks/useMiningLoop.ts` — rAF timing
- `src/components/mining/MineRunOverlay.tsx` — rendering/HUD
- `src/views/MiningView.tsx` — entry screen
- `src/content/mining.ts` — tunable data tables

### 3.1 Entry and Session Setup

**Energy cost:** `MINE_ENERGY_COST = 2` (`mining.ts:68`). Blocked unless `energy >= 2` or `settings.unlimitedEnergy`. Energy is deducted at run start in `beginMining` (`useGameStore.ts:1887`).

**Free tool:** If the player owns no mining/chopping tool, `stone_pickaxe` is granted and auto-equipped to the `tool` slot (`useGameStore.ts:1837–1846`).

**Snapshot:** Combat stats are snapshotted once at entry via `deriveCombatant` (`combat.ts:42–63`). No mid-run stat changes from the character sheet affect an active run.

### 3.2 Controls

| Action | Key(s) | Tick rate |
|--------|---------|-----------|
| Move | Arrows / WASD | `MOVE_INTERVAL_MS = 150 ms` |
| Mine/Attack | Space / Enter | `SWING_INTERVAL_MS = 240 ms` |
| Cast spell | 1–4 | `SPELL_CD_MS = 500 ms` |
| Touch (D-pad) | On-screen | Same cadences |

Most-recently-pressed direction wins when multiple keys are held (`useMiningLoop.ts:124–132`). Held Space/Enter queues a swing but respects the 240 ms minimum.

**Monster clock:** `MONSTER_TICK_MS = 120 ms` (`useMiningLoop.ts:21`), shared by all monster AI steps.

### 3.3 Procedural Generation

`generateMine` (`mining.ts:277`) — a drunk-walker cavern generator:

**Size scales with depth:**
```
MINE_BASE_ROWS/COLS  = 33   // mining.ts:54–55
MINE_SCALE_PER_BAND  =  4   // mining.ts:58
MINE_SCALE_BAND      =  4   // mining.ts:59 — floors per size step
MINE_MAX_ROWS/COLS   = 57   // mining.ts:60–61
band = floor((floor - 1) / 4)
size = min(57, 33 + band * 4)
```

**Carving (drunk walkers):** All cells start as `bedrock`. Ten walkers carve ~45% of the interior (`targetFloor = round(interior × 0.45)`). Each walker starts from an already-open cell, ensuring connectivity (`mining.ts:305–335`).

**Shaft placement:** BFS from entrance finds the farthest reachable cell and places the descent shaft there — always a deep trek (`mining.ts:373–397`).

**Scaling by floor:**

| Element | Floor 1–2 | Floor 3–6 | Floor 7+ |
|---------|-----------|-----------|----------|
| Rock durability | 1 | 2 | 3 |
| Ore clusters | `4 + floor(f/2)` | same | same |
| Monster count | `min(10, 2 + floor(f×0.6))` | same | same |

**Energy gems:** One per `ENERGY_GEM_INTERVAL = 80` open cells (`mining.ts:77, 448–461`). Restore 11 stamina on gather.

### 3.4 Ore Table

From `src/content/mining.ts:59–88`:

| Ore | Floor min | Weight | Durability | Drops |
|-----|-----------|--------|------------|-------|
| Loose Rubble | 1 | 3 | 1 | gold 1–4 |
| Bronze Vein | 1 | 3 | 2 | bronze_bar 1–2 |
| Iron Vein | 3 | 2.5 | 3 | iron_bar 1–2 |
| Gold Vein | 4 | 1.5 | 3 | gold 8–20 |
| Crystal Node | 6 | 1.2 | 4 | crystals 1–2 |
| Gemstone Node | 10 | 0.8 | 5 | gemstone 1 |
| Energy Gem | 1 | 0 (placed, not random) | 1 | +11 stamina |

**Breaking plain rock** (`mining.ts:667–676`): always yields `stone` = `randInt(maxDur, min(3, maxDur+1))`; 20% chance of a bonus ore drop.

**Mining speed:** `durability -= pickPower` per swing, where `pickPower` = the equipped tool's `mining.power` (gear stat, not a character stat). Default `stone_pickaxe` has `power: 1`.

### 3.5 Monster Roster

From `src/content/mining.ts:90–116`:

| Monster | Floor min | HP | Touch dmg | Move (ms) | Defense | Weak to | Resists |
|---------|-----------|----|-----------|-----------|---------|---------|---------| 
| Cave Slug | 1 | 8 | 4 | 950 | — | ST | — |
| Rock Biter | 3 | 18 | 7 | 700 | 2 | DX | — |
| Cave Spider | 4 | 14 | 8 | 400 | — | DX, WI | — |
| Deep Lurker | 6 | 28 | 10 | 520 | 1 | WI | ST |
| Stone Golem | 10 | 50 | 15 | 850 | 6 | ST | DX |

**AI:** BFS flow-field chase toward the nearest player. Stops adjacent and deals contact damage once per `MINE_IFRAME_MS = 800 ms` (`mining.ts:75`): `dealt = max(1, touchDamage - defense - blessMagnitude)`.

**Kill loot** (`mining.ts:583–597`): `quantity = max(1, round(swingsToKill / avgDur) + killsThisFloor + 1)` — consecutive kills on the same floor escalate drop quantity.

### 3.6 Combat

**Context-sensitive swing** (`strike`, `mining.ts:614`): facing a monster → weapon attack; facing rock/ore → mining.

**Weapon attack:** `power = weapon.attackStat === 'DX' ? rangedPower : meleePower`. Costs `weapon.staminaCost ?? MELEE_STA_FALLBACK (2)`. Needs at least 1 stamina to swing; below cost threshold → ×0.5 damage (exhausted).

**Mining:** costs `STRIKE_STA_COST = 1` per swing (`mining.ts:71`). No stamina = no dig. Breaking an empty ore vein refills +1 stamina; energy gems restore 11.

**Spells:** `castSpell` (`mining.ts:691`). Needs `mp >= spell.mpCost` and 500 ms global cooldown. Schools: **damage** (WI, hits nearest monster), **support** (KN, heals or applies bless), **illusion** (CH, debuffs nearest monster). Special spells: `rune-fire/ice/poison` (floor trap, 30s), `ring-of-fire` (8s AoE ring, hits adjacent monsters every 600 ms), `teleport` (3–6 Manhattan cells away).

### 3.7 Stamina & Mana Pools

```
maxSta = dungeonStamina(EN) = 50 + EN       // crawl.ts:67
maxMp  = 8 + KN × 3                         // combat.ts:51
maxHp  = 50 + HP × 7 + charLevel × 3        // combat.ts:50
```

Passive regen: +1 sta every 1200 ms, +1 mp every 2000 ms.

**Descend** (`mining.ts:549`): refills `+25% of maxSta` and `+25% of maxMp`. Haul and HP carry forward.

### 3.8 Win / Lose / Banking

- **No win condition.** Endless descent with `deepestMineFloor` as the persistence record.
- **Death** (HP ≤ 0): run ends, haul is still retrieved. **No loot penalty on death.**
- **Bank & Leave:** voluntary exit commits full haul + stat trickle.

**Stat trickle on banking** (`useGameStore.ts:664–665`):
```
trickle = 4 + 3 × deepest
statXp += { ST: trickle, EN: trickle }
```

**Milestone gates** (shown in `MiningView.tsx:9–15`): Floor 3 = Iron, Floor 4 = Gold, Floor 6 = Crystals, Floor 10 = Gemstone.

---

## 4. Wild Forest — Complete Mechanics

**Core files:**
- `src/engine/forest.ts` — pure game rules
- `src/hooks/useForestLoop.ts` — rAF timing
- `src/components/forest/ForestRunOverlay.tsx` — rendering/HUD
- `src/views/ForestView.tsx` — entry screen
- `src/content/forest.ts` — tunable data tables

### 4.1 Entry and Session Setup

**Energy cost:** `FOREST_ENERGY_COST = 2` (`forest.ts:67`). Same gate as the mine.

**Free tool:** If no chopping/mining tool is owned, `stone_pickaxe` is granted and equipped (`useGameStore.ts:2017–2024`).

**Death penalty:** `FOREST_DEATH_KEEP = 0.5` (`forest.ts:69`). On death, half of every gold and material stack in the haul is lost (floored per stack).

### 4.2 Controls

Identical cadences to the mine:

| Action | Key(s) | Tick rate |
|--------|---------|-----------|
| Move | Arrows / WASD | 150 ms |
| Act (attack / gather / chop / shrine) | Space / Enter | 240 ms |
| Cast spell | 1–4 | 500 ms |

**Act priority in the loop** (`useForestLoop.ts:99–122`): host push-deeper > co-op guest melee intent > activate shrine > gather / slash / chop.

**Beast clock:** `BEAST_TICK_MS = 120 ms`, same as the mine monster clock.

### 4.3 Procedural Generation

`generateForest` (`forest.ts:378–650`) — recursive-backtracker maze (vs. the mine's drunk-walker cavern):

**Same size scaling as the mine:**
```
FOREST_BASE_ROWS/COLS = 33   // forest.ts:53–54
FOREST_SCALE_PER_BAND =  4   // forest.ts:57
FOREST_SCALE_BAND     =  4   // forest.ts:58
FOREST_MAX_ROWS/COLS  = 57   // forest.ts:55–56
```

**Maze carving:** All cells start as `thicket`. A DFS-based recursive backtracker carves corridors from odd-lattice cells via Fisher–Yates shuffled direction order (`carve`, `forest.ts:400–418`). The result is a perfect maze (no loops) of narrow trails — very different feel from the mine's open caverns.

**Fog of war:** Fresh `seen` grid, `SIGHT_RADIUS = 3` (`forest.ts:74`) normally, `CLEARING_SIGHT_RADIUS = 4` (`forest.ts:75`) when standing in a clearing. Visibility is circular via `reveal` (`forest.ts:254–276`).

**Entrance / treeline:** `entrance` at top, `treeline` at bottom — the exit is always fixed (vs. mine's BFS-farthest shaft placement).

**Layout elements by stage:**

| Element | Count formula | Notes |
|---------|---------------|-------|
| Springs | `max(1, min(3, floor(trailCount/90)))` | On dead-ends; stage ≥ 4 = ancient_spring |
| Resource nodes | `min(deadEnds-di, 12 + 2×stage)` | Weighted by stage |
| Clearings (loot rooms) | `min(2 + floor(stage/2), corridors)` | 3×3 pocket, 40% shrine chance |
| Choppable trees | `min(wallCells, 14 + 3×stage)` | Routing-safe placement |
| Wandering beasts | `min(16, 5 + stage)` | Spawn `asleep: true` |

**Tree durability:** stages 1–2 = 1, stages 3–6 = 2, stage 7+ = 3.

### 4.4 Resource Nodes

From `src/content/forest.ts:68–93`:

| Node | Stage min | Weight | Yields |
|------|-----------|--------|--------|
| Wild Forage | 1 | 3 | gold 1–5 |
| Flower Bush | 1 | 3 | herbs 1–2 |
| Flax & Cotton | 1 | 3 | cloth_roll 1–2 |
| Buried Crystals | 4 | 1 | crystals 1 |
| Cool Spring | 1 | placed | stamina 12–16 |
| Ancient Spring | 4 | placed | stamina 20–25 |

**Gathering** is instantaneous and free (no stamina cost). **Chopping trees** costs `CHOP_STA_COST = 1` per swing and yields `wood` on break.

The forest is the game's primary source of **herbs, cloth, leather, game_meat, and pelt** — materials used in crafting recipes.

### 4.5 Beast Roster

From `src/content/forest.ts:95–138`:

| Beast | Stage min | HP | Touch dmg | Move (ms) | Aggro | Bounty | Flees | Weak / Resists |
|-------|-----------|----|-----------|-----------| ------|--------|-------|----------------|
| Forest Deer | 1 | 8 | 0 | 150 | 4 | 2–6 | ✓ | DX |
| Wild Rabbit | 1 | 5 | 0 | 130 | 3 | 1–3 | ✓ | DX |
| Wild Boar | 1 | 10 | 4 | 620 | 3 | 1–4 | — | ST |
| Gray Wolf | 2 | 14 | 6 | 400 | 4 | 3–8 | — | DX |
| Forest Spider | 3 | 12 | 5 | 350 | 3 | 2–6 | — | DX, WI |
| Forest Bear | 5 | 30 | 14 | 520 | 3 | 9–18 | — | def 2, ST |
| Dire Wolf | 7 | 22 | 10 | 320 | 5 | 10–20 | — | WI, resists DX |
| Ancient Guardian | 10 | 55 | 18 | 600 | 2 | 20–35 | — | def 5, resists DX, ST |

**Two distinct AI modes:**
- **Predators** (boar, wolf, spider, bear, dire wolf, ancient guardian): BFS flow-field chase, deal contact damage.
- **Prey** (deer, rabbit): `flees: true`, no contact damage, flee to the *farthest* reachable cell from the nearest player (`fleeStep`, `forest.ts:349–368`). Drop premium loot (game_meat, pelt).

### 4.6 Combat & the Ambush System

**Sleeping beasts:** All wandering beasts spawn `asleep: true`. The wake pass (`forest.ts:1117–1129`) wakes a beast when the player enters its `aggroRadius` (Manhattan distance). This is the **ambush** — you trigger fights by approaching, not by selecting attack.

**Windup telegraph** (`forest.ts:1173–1221`): when a predator becomes adjacent, it sets `windupUntilMs = now + FOREST_WINDUP_MS (360 ms)`. Only after that delay — if still adjacent — does it deal contact damage. Moving away during the windup resets it.

```
FOREST_WINDUP_MS   =  360 ms   // forest.ts:84
FOREST_IFRAME_MS   =  800 ms   // forest.ts:72
```

**Player attack (`act`, `forest.ts:713–792`):**
- **Ranged:** scans the faced direction up to `weapon.range` cells; hits the first beast; walls/trees/nodes block line of sight. Costs `ARROW_STA_COST = 1`.
- **Melee:** `staCost = weapon.staminaCost ?? SLASH_STA_COST (2)`. `power = weapon.attackStat === 'DX' ? rangedPower : meleePower`.

### 4.7 Shrines

From `src/content/forest.ts:161–177`:

| Shrine | Weight | Effect |
|--------|--------|--------|
| Hunter's Cache | 3 | gold 10–25 + game_meat 1–3 |
| Forest Blessing | 2 | `bless` status, magnitude 4, 8 turns (~12 s) |
| Disturbed Den | 2 | Spawns an awake forest_bear adjacent (trap!) |
| Den of the Wild (stage 5+) | +1 | Extended ambush variant |

Bless enables `defense` to mitigate incoming contact damage (`forest.ts:1207`).

### 4.8 Advance, Banking, and Death

**Advance (push deeper):** Only when standing on the `treeline` cell. Carries HP and haul forward; refills `+25% maxSta` and `+25% maxMp` (`forest.ts:675–676`). Generates a richer next stage.

**Bank & Leave:** Commits full haul and fires `commitForest`.

**Death:** Commits `splitHaul(run.haul, 0.5)` via `commitForestDeath` (`useGameStore.ts:693–710`). You keep half, lose half. The DX/EN stat trickle is still paid in full.

**Stat trickle on banking** (`useGameStore.ts:682–684`):
```
trickle = 4 + 3 × deepest
statXp += { DX: trickle, EN: trickle }
```

---

## 5. Stats Analysis — All 8 Stats Across Both Games

Both games snapshot stat levels into a `Combatant` via `deriveCombatant` (`combat.ts:42–63`) at run start. The derived values:

```
meleePower   = ST                          // combat.ts:53
rangedPower  = DX                          // combat.ts:54
dodge        = min(0.40, AG × 0.02)        // combat.ts:55  ← never consumed in crawlers
flee         = min(0.90, 0.40 + AG × 0.03) // combat.ts:56  ← never consumed in crawlers
maxSta       = 50 + EN                     // crawl.ts:67
maxHp        = 50 + HP × 7 + charLevel × 3 // combat.ts:50
damageSpell  = WI                          // combat.ts:57
supportSpell = KN                          // combat.ts:58
illusionPower = CH                         // combat.ts:59
maxMp        = 8 + KN × 3                 // combat.ts:51
```

### Full Stat Table

| Stat | Derived values | Mine effect | Forest effect | Dead weight? |
|------|---------------|-------------|---------------|--------------|
| **ST** (Strength) | `meleePower = ST` | Melee weapon damage (non-DX weapons). Cave Slug and Stone Golem weak to ST. Kill loot quantity scales with ST (faster kills = more). ST XP trickle on banking. | Melee damage with ST weapons. Boar, Bear, Ancient Guardian weak to ST. | No |
| **DX** (Dexterity) | `rangedPower = DX` | Damage when weapon's `attackStat === 'DX'`. Rock Biter and Cave Spider weak to DX. Stone Golem resists DX. | Damage with DX weapons. Ranged attack power. Most beasts weak to DX (deer, rabbit, wolf, spider). Dire Wolf and Ancient Guardian resist DX. DX XP trickle on forest banking. | No |
| **AG** (Agility) | `dodge`, `flee` | **None.** Dodge/flee are computed but never read. Movement speed is fixed at 150 ms/cell regardless of AG. | **None.** Same — no dodge rolls, no flee mechanic, fixed movement speed. | **Yes — AG is entirely dead weight in both games.** |
| **EN** (Endurance) | `maxSta = 50 + EN` | Stamina pool — more swings before exhaustion. EN XP trickle on banking. | Same. Larger pool = more chops/slashes before exhaustion. EN XP trickle on banking. | No, but low leverage (EN=10 gives only 10 extra swings) |
| **WI** (Wisdom) | `damageSpell = WI` | Scales damage-spell output: `power + WI×1.2`. Cave Spider and Deep Lurker weak to WI (spell res applies). | Same. Spider and Dire Wolf weak to WI. Only matters if player has damage spells. | Conditional — irrelevant without spells |
| **KN** (Knowledge) | `maxMp = 8 + KN×3`; `supportSpell = KN` | MP pool size AND heal potency: `power + KN×1.5`. Both roles matter if player uses spells. | Same — doubly important: more spells castable, and heals are stronger. | Conditional — irrelevant without spells |
| **CH** (Charisma) | `illusionPower = CH` | Extends illusion debuff duration: `floor(CH/8)` extra ticks. Marginal. | Same marginal extension of freeze/poison debuffs. | Nearly — only matters with illusion spells, effect small |
| **HP** | `maxHp = 50 + HP×7 + charLevel×3` | Raw survivability. HP=10 gives 120 HP vs base 50. | Same. High HP allows absorbing windup hits; HP is the primary survival stat for non-spell builds. | No — straightforward and impactful |

### Key Finding: AG Is Wasted

Agility is the stat earned by the **Agility habits** — real-world tasks the player completes. Yet AG has no mechanical expression in either crawler. A player who has logged dozens of agility habits gets literally zero benefit in these two minigames. This is both a design problem (habits don't translate to gameplay) and a missed creative opportunity.

### Key Finding: Move Speed Is Unmoored from Stats

Movement is a flat 150 ms/cell for both player and most beasts (except prey, e.g. deer at 130 ms). There is no stat, gear, or upgrade that changes this. This is unusual for a game with a Dexterity/Agility distinction.

### Key Finding: Mining Speed Is Gear-Only

Mining speed = `pickPower` (from the equipped tool). A `stone_pickaxe` has `power: 1`; better tools have `power: 2` or `3`. There is no stat that affects how fast you dig. A high-Strength character digs at the same pace as a Wisdom-focused mage.

---

## 6. Co-op / Multiplayer Layer

The multiplayer implementation (branch `feature/multiplayer`) is architecturally clean and worth preserving as-is.

### 6.1 Transport

- **Supabase Realtime Broadcast** over channel `coop:{sessionId}`, `COOP_BROADCAST_HZ = 10` (100 ms per frame) (`coop/protocol.ts:94`).
- Session row in `coop_sessions` Supabase table: `{ id, party_id, game, seed, host_id, status }`.
- Remote players time out after `COOP_PLAYER_TIMEOUT_MS = 5000 ms` (`protocol.ts:97`).

### 6.2 Authority Split

| Authority | Who | What |
|-----------|-----|-------|
| Host | Canonical world | Monster simulation, kill/loot resolution, world-slice broadcast |
| Each player | Own body | Position, HP/sta/mp, haul, spell casts |
| Shared (deterministic) | Map | Regenerated from `mulberry32(seed)` + `floorSeed(base, floor)` — byte-identical on all clients |
| Peer-to-peer | Tile changes | Digs/gathers propagate via `TileSlice` — no host gate needed |

### 6.3 Wire Messages

| Message | Direction | Contents |
|---------|-----------|----------|
| `WorldSlice` | Host → all | Floor, status, monster positions/HP/asleep |
| `PlayerSlice` | Each → all | Position, facing, HP, maxHp, floor |
| `AttackIntent` | Guest → host | Monster ID + damage — host resolves kill/loot |
| `TileSlice` | Peer → all | `{floor, r, c, tile}` — shared digs |
| `ByeIntent` | Leaving player → all | Clean departure notification |

### 6.4 Key Properties

- **Shared world, separate hauls.** Each player banks their own loot independently (trust-client). A node dug by Player A disappears for Player B.
- **Co-op uses `floodFieldMulti`** so monsters target the nearest of all players — genuine multi-player threat dynamics.
- **Smooth remote player rendering.** Remote players are interpolated in world-pixel space via the same rAF "mover" ref system used for monsters (`MineRunOverlay.tsx:528–558`).
- **Guest melee routing.** Guests cannot locally kill monsters — they send `AttackIntent` and the host resolves kills exactly once, preventing loot duplication.

### 6.5 Assessment

The co-op layer is one of the genuine strengths of these minigames. It's technically sound (deterministic seeds, low bandwidth at 10 Hz, graceful timeouts), semantically correct (single source of truth for kills), and has smooth visual interpolation. A future improvement plan should build on this, not replace it.

---

## 7. Design Analysis — How Well They Work as Games

### 7.1 What Works

**Clean, readable entry point.** Both games are instantly understandable: move with arrows, press Space to act, go deeper, don't die. The controls require no tutorial.

**Procedural generation keeps content fresh.** New layouts on every run. Drunk-walker caverns (mine) and recursive-backtracker mazes (forest) feel distinctly different from each other — the mine is open and exploratory; the forest is a tight labyrinth.

**Flow-field AI is emergent and cheap.** Monsters funnel naturally through cave architecture, create chokepoints, and crowd-route without expensive pathfinding. They *feel* smarter than they are.

**The Forest's ambush system is the best idea in either game.** Sleeping beasts that wake on approach, combined with a short windup telegraph before striking, creates genuine moment-to-moment tension: do I push into this dark corridor knowing something might be lurking? The telegraph gives skilled players an escape window. Prey animals that flee are a charming contrast — you chase the deer while the wolf chases you.

**Death stakes in the forest are meaningful.** Losing half your haul on death creates a real push-your-luck decision: do I push to the next stage or bank now? This is the most interesting strategic decision in either game.

**Co-op is a genuine differentiator.** Playing these with a friend in shared chaos — monsters routing to the nearest of you, fighting over escape corridors, shared node depletion — elevates both games significantly.

**Depth-scaled rewards.** Richer ore tiers at deeper floors, escalating monster difficulty, and the `4 + 3 × deepest` stat trickle all give players a real reason to push further.

---

### 7.2 What Doesn't Work

#### Moment-to-Moment Combat Is a Single Repeated Action

Both games reduce to: `move → face enemy → hold Space`. There are no combos, no block/parry, no dodge rolls, no dashes, no positioning-based attacks (flanking, backstabs, area denial). The player's attack input is binary — swing or don't swing.

The mine is worse here: unlike the forest, the player faces the *same* attack input for both mining and combat (the same Space key, the same 240 ms cadence). There's no texture between "I'm mining" and "I'm fighting."

The forest's windup telegraph hints at positioning depth (move away to cancel the windup), but the payoff is minimal: the only response is to step back one cell. There's no attack pattern to read, no special moves to respond to.

#### The Mine Has No Death Penalty

The forest risks half your haul on death. The mine risks nothing — you bank your full haul regardless of whether you fell or chose to leave. This removes the mine's only potential source of tension. There is no reason to ever voluntarily leave before dying. Death is a free bank.

#### Six of Eight Stats Are Marginal or Dead

AG is completely unused. WI/CH/KN only matter if you have spells (which requires separate progression, and many players run melee builds that never engage the spell system). EN provides a stamina pool that rarely runs dry mid-run due to passive regen and energy gems. The active, moment-to-moment choices reduce to: am I ST-built or DX-built?

#### Mining Speed and Movement Speed Are Not Stat-Driven

Two of the most intuitive things a player might expect to scale with their character do not. A high-Strength warrior mines at the same speed as a Knowledge mage. An Agility-focused character moves at 150 ms/cell, same as a tank. This breaks the fantasy of stat specialization.

#### The Loot Is Economy Fuel, Not Character Definition

Mining yields gold and crafting materials. The forest adds herbs and leather. These feed the crafting economy — useful, but none of it changes how you *play* during a run. No run-specific upgrades, no build choices, no artifacts that make a particular run feel distinct. Every run is mechanically identical to the last at the same depth, just with different map layout.

Compare: in Hades, each run you pick up boons that fundamentally change your attack. In Spelunky, the items you find change how you approach every screen. In Deep Mine, you go to floor 5 today the same way you went to floor 5 last week.

#### No Win Condition, Score, or Mastery Curve

Both games are endless treadmills. `deepestMineFloor` and `deepestForestStage` are the only persistence records. There is no score, no speed record, no objective beyond "go as deep as you can." Players have no way to measure improvement or set goals within a single run.

This matters especially because these are *habit-tracking* games — the whole point is to measure real-world progress via in-game systems. The minigames don't reinforce that philosophy internally: there's no run metric that says "you played better today than yesterday."

#### Fog and Clearings Are Underused in the Forest

Fog of war with `SIGHT_RADIUS = 3` is a small viewport. Clearings expand it to 4 tiles. But the fog does little mechanical work beyond hiding beast positions. It doesn't create meaningful information-asymmetry decisions, doesn't interact with stealth or sound, and doesn't change as stages progress. It's ambiance more than mechanic.

#### Minimal Feedback and Juice

The overlays render tile grids with emoji-style art and colored text values. Hit numbers appear, but there's no screen shake, no impact hold frame, no progressive camera effects as you descend deeper. The games *function* but don't *feel* kinetic. This is harder to judge from code alone, but the absence of audio events and impact frames in the overlay code suggests this is thin.

---

### 7.3 Risk / Reward & Pacing

| Dimension | Mine | Forest |
|-----------|------|--------|
| Death penalty | None (full haul kept) | Half haul lost |
| Push-your-luck tension | Low | Moderate |
| Escalation feel | Clear (ore tiers gate depth) | Clear (beast difficulty + fog) |
| Regen / resource | Energy gems common; passive regen generous | Springs provide bursts; passive regen same |
| Boss / climax | None (Stone Golem at floor 10+, but no boss structure) | None (Ancient Guardian at stage 10+, same) |
| Pacing of a run | Flat — same loop on every floor | Slight variation from shrines and clearing rooms |

The biggest asymmetry is the death penalty. The mine's penalty-free death makes risk feel meaningless. The forest's half-haul penalty makes every run feel like a tightrope walk from stage 4 onward — particularly in co-op where group deaths are more likely.

---

## 8. Comparisons to Known Games

### 8.1 Deep Mine

#### Most Similar: SteamWorld Dig / Motherload (Dig-Deeper Loop)

The mine's core loop — dig downward through procedural terrain, collect ore, go back up to bank — is the direct descendant of **Motherload** (2004) and its modern descendant **SteamWorld Dig** (2013).

**What HabitsRPG does:** procedural one-way descent with banked resources, ore tiers gated by depth.
**What SteamWorld Dig adds that HabitsRPG lacks:** upgrade-gated traversal (you need a steam upgrade to reach new biomes), town as a social hub, specific ability unlocks (drill, steam jump, lantern) that *change* how you dig. Each SteamWorld Dig run has progression milestones that unlock new *verbs*, not just numbers. The mine only scales numbers.

#### Dome Keeper — The Return Loop

**Dome Keeper** (2022) structures the dig around a surfacing timer: dig, collect ore, return to your dome before the next wave. The forced return creates rhythm and stakes.

The mine has no "return" requirement — you bank whenever you feel like it, or die and bank anyway. There's no external pressure rhythm. Adding even a soft timer (a cave-in hazard, a gas build-up) would create this missing beat.

#### Spelunky — Emergent Hazard Play

**Spelunky** (2012) shares procedural descent and discrete-room layouts, but its design philosophy is *emergent interaction* between its systems: enemies, traps, items, and terrain interact in ways the player can exploit or be destroyed by. A boomerang can stun an enemy into a spike trap. A shopkeeper can become an enemy.

The mine's systems don't interact. Monsters can't be lured into rocks. Mining debris doesn't land on enemies. Runes sit inertly on floors. The mine's elements are additive, not combinatorial.

#### Minecraft / Terraria — Ore Tiers and Depth Gating

The bronze → iron → gold → crystal → gemstone ore progression is the classic RPG ore tier ladder also used by Minecraft and Terraria. HabitsRPG borrows this cleanly. The difference is that in Terraria, better ores enable you to craft equipment that changes what you can do. In HabitsRPG, ores are crafting materials that feed an off-screen economy — they don't change the mine itself.

---

### 8.2 Wild Forest

#### Most Similar: Don't Starve — Foraging + Ambush Predators

**Don't Starve** (2013) is the clearest design ancestor of the Wild Forest: a top-down foraging environment where resources spawn in fixed nodes, predators roam and become dangerous if you wander close, and gathering feels like navigating a dangerous ecology.

**What HabitsRPG does:** foraging nodes, beast encounters on approach, prey-vs-predator duality, stage-based escalation.
**What Don't Starve adds:** genuine resource depletion and regrowth cycles (systems thinking); hunger and sanity as parallel pressure systems that demand different foraging activities; distinct biomes with unique resources that require strategic routing; seasonal progression that changes the rules of the world.

The forest's stage escalation (more beasts, bigger maps) is linear difficulty scaling. Don't Starve's seasonal model creates qualitative changes in what you need to do — summer requires different play than winter. The forest could learn from this.

#### Brogue / Pixel Dungeon — Fog of War Roguelikes

**Brogue** (2009) and **Pixel Dungeon** (2012) are grid roguelikes with fog of war and narrow corridors. The forest's maze + sight-radius-3 fog is closest to this family.

**What HabitsRPG does:** fog of war, maze corridors, ambush on approach.
**What Brogue adds:** fog interacts with stealth (enemies have detection ranges, you can use sound/light tactically). Information is a resource. **The forest's fog is passive** — it hides things but doesn't create an information game. Beasts wake when you enter a Manhattan radius regardless of your facing or whether you're in a dark corner.

#### Zelda Overworld — Real-Time Grid Combat with Telegraphs

Classic **Zelda** (A Link to the Past) combat is the reference for the forest's control scheme: face a direction, swing, enemies telegraph before striking. The windup system in the forest is a direct nod to Zelda's enemy tells.

**What HabitsRPG does:** facing-based attack, contact damage with telegraph, locked movement cadence.
**What Zelda adds:** shield/block mechanic that rewards timing; knockback positioning; special items that open different attack vectors (hookshot, bombs). The forest only has the slash — there's no defensive action.

#### Crypt of the NecroDancer / Pokémon Mystery Dungeon — Grid-Step Real-Time

**Crypt of the NecroDancer** (2015) and **Pokémon Mystery Dungeon** both execute grid-based real-time action. NecroDancer adds rhythm as a constraint that rewards mastery; PMD adds tactical depth via turn-based floors.

**What HabitsRPG does:** fixed movement cadence, monster clock, grid-snapped positions.
**What NecroDancer adds:** mastery expression via beat-precise movement — a skilled player can chain combos, set up kills, and control enemy patterns. The forest's flat movement cadence (150 ms, fixed) provides no such mastery ceiling. Every player moves the same way at the same speed with the same attack.

#### Hades (Run-and-Bank) — Pick-Ups That Change the Run

**Hades** (2020) is structurally closest to both games' meta loop: enter, fight, collect, die-or-bank, repeat. What Hades does that neither crawl does: boons and items collected *during the run* modify your verbs. Every run plays differently.

The forest and mine have no in-run character modification. No found gear, no mid-run upgrades, no consumables. You enter with your snapshot and leave with the same snapshot. The runs are structurally identical beyond map layout.

---

### 8.3 Comparison Table

| Game | Sharing | What HabitsRPG Lacks vs. That Title |
|------|---------|--------------------------------------|
| SteamWorld Dig | Dig-for-ore loop | Upgrade-gated traversal, ability unlocks, hub world |
| Dome Keeper | Collect + return loop | Return timer / external pressure rhythm |
| Spelunky | Procedural descent | Emergent system interactions |
| Motherload | Ore tiers + banking | n/a (Motherload is the simpler ancestor) |
| Don't Starve | Foraging + ambush predators | Resource depletion/regrowth, multiple pressure systems, biome variety |
| Brogue | Fog of war maze roguelike | Stealth/detection information game, status interactions |
| Zelda LTTP | Telegraph + real-time grid combat | Shield/block, knockback, item-based attack variety |
| Crypt of the NecroDancer | Grid-step real-time | Mastery expression, combo potential |
| Pokémon Mystery Dungeon | Grid crawl with enemy clock | Turn-based tactical depth, team composition |
| Hades | Run-and-bank | In-run boons/build choices, verb modification |
| Terraria / Minecraft | Ore tiers, crafting economy | Ore unlocks new gameplay verbs (not just materials) |

---

## 9. Opportunities — Forward Pointers for Improvement

*These are findings from the current-state analysis, not a committed plan. A separate design document will prioritize and scope improvements.*

### Highest Leverage

1. **Give AG a real mechanical role.** Options: stat-scaling move speed (`MOVE_INTERVAL_MS ÷ AG` modifier), a dodge step (press Shift + direction to dash one cell with i-frame), or evasion vs. telegraphed attacks. AG habits should pay off in the crawlers.

2. **Stat-scale mining speed.** ST (or a tool-level formula) should reduce the per-swing durability delta. A high-ST character should feel meaningfully faster at clearing rock. This also makes the mine play differently for different builds.

3. **Add a death penalty to the mine.** A small percentage haul loss (even 10–20%) is enough to create push-your-luck tension. The mine currently has none.

4. **In-run pickups that change the run.** Consumables found in loot rooms (a speed potion, a shield rune, a pickaxe upgrade); or rare "vein echoes" that double ore drops for one floor. The run must feel different from the last.

5. **Add mastery expression to combat.** A direction-timed dash/evade on approach; a charged swing (hold Space 2+ ticks for a stagger); an attack that benefits from flanking angle. One or two verbs would open a skill ceiling.

### Medium Leverage

6. **Deepen the forest's fog.** Beast detection ranges (beasts "hear" you before they see you); directional awareness (facing a corridor before entering it); darkness as a terrain modifier. Turn fog from ambiance into an information game.

7. **Score / run metrics.** A depth-stage score, kill count, resource efficiency rating — something that lets players measure improvement run-over-run. Aligns with the habit-tracking philosophy.

8. **Environmental hazards that interact.** Mine: cave-in zones that collapse after N swings near them; underground rivers that slow movement; gas pockets that combo with fire runes. Forest: underbrush that slows movement; mud near springs; rain that cancels fire runes.

9. **Boss encounters at depth gates.** Instead of Stone Golem/Ancient Guardian as regular monsters, place them as floor guardians at the depth milestones (Floor 10, Stage 10) with unique patterns. Clearing them unlocks the next ore/material tier and gives a clear "chapter" structure.

10. **Biome variety.** The mine could shift texture at depth bands (cave → deep cave → magma layer). The forest could have biome types per stage (thicket → meadow clearing → ancient grove). Visual + mechanical differentiation.

### Lower Leverage / Polish

11. **CH meaningful beyond illusion spells.** Charisma in an RPG often affects NPC relations — could CH affect shrine outcomes or beast aggro radius?

12. **Per-run loot drop that feeds build identity.** A rare "amulet" or "charm" that appears in one clearing per run, grants a temporary passive for the rest of that run only. No persistent effect, but creates a moment of decision.

13. **Juice and feedback.** Screen shake on heavy hits; progressive camera zoom as you descend deeper; ambient sound cues for approaching beasts before they're visible.

---

*End of analysis. Cited file paths: `src/engine/mining.ts`, `src/engine/forest.ts`, `src/engine/crawl.ts`, `src/engine/combat.ts`, `src/hooks/useMiningLoop.ts`, `src/hooks/useForestLoop.ts`, `src/content/mining.ts`, `src/content/forest.ts`, `src/store/useGameStore.ts`, `coop/protocol.ts`.*
