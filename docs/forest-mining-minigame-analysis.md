# Forest & Mining Minigame Analysis

*Prepared as a design foundation for the next-level improvement plan.*

> **Phase history note.** Commit `619acb6` ("Phase 1: dash/dodge, charged swings, and stat-scaled crawler actions") landed significant new mechanics in both the Deep Mine and the Wild Forest. Commit `cfedc4b` ("Hex Tactics Phase 2: spell mechanics, guard, threat telegraph, Rooftop Chase overhaul") targeted **Hex Tactics** (`hexBattle.ts`) and the Rooftop Chase trial — it does **not** add guard/block or new telegraphs to either crawler. This document reflects the post-Phase-1 state; everything below has been verified against current source.

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

The Deep Mine and Wild Forest are HabitsRPG's two real-time grid-crawler minigames. They share an engine (`src/engine/crawl.ts`) and a nearly identical control scheme: move on a tick, act on a tick (mine/fight/gather), battle procedurally generated enemies, gather resources, push deeper, and bank on exit.

**Phase 1 substantially raised the skill ceiling.** Both crawlers now have a dash (Shift — skips two cells, grants i-frames, AG-scaled cooldown), a charged/heavy swing (hold Space ~480 ms — ×1.75 damage + stagger), AG-scaled movement speed, and ST-scaled mining/chop speed. All eight character stats now have a mechanical effect. These additions give players genuine moment-to-moment decisions: time the dash to dodge a windup hit, hold for a charged swing to stagger a dangerous monster, build around AG for mobility or ST for raw throughput.

**The technical skeleton is genuinely strong.** Deterministic seeded generation, a clean BFS flow-field AI, a host-authoritative co-op layer with per-player bodies and shared world, and a well-separated engine/hook/store/view architecture all give these games a solid foundation.

**The gameplay surface still has meaningful gaps.** Despite Phase 1 improvements, the loot economy produces gold and materials (economy fuel) but no run-defining upgrades or build choices — every run is mechanically identical to the last at the same depth. The Mine has no death penalty. Both games lack a win condition, a score, or a mastery curve beyond "go deeper." Phase 1 opened a skill ceiling; the next phase needs to widen the strategy layer.

The Wild Forest remains the more interesting game: sleeping-beast ambush, prey-vs-predator AI duality, death-forfeits-half-haul stakes, maze + fog, and shrines all combine to give individual runs texture. The Mine still feels more like a resource collection chore with combat obstacles.

---

## 2. Shared Crawl Core

**File:** `src/engine/crawl.ts`

All grid geometry, pathfinding, timing constants, and Phase 1 mechanics shared between the two minigames live here.

### 2.1 Camera Window

```
VIEW = 11   // crawl.ts:42 — both games show an 11×11 viewport
```

`cameraWindow(player, rows, cols)` centers the viewport on the player, half = `floor(VIEW/2) = 5`, clamped to grid bounds (`crawl.ts:48–57`). Effective visible area: 11×11 = 121 cells, 5 cells in each cardinal direction.

### 2.2 Stamina Formula

```
dungeonStamina(enLevel) = 50 + enLevel   // crawl.ts:67–69
```

This overrides the base `maxSta = 12 + EN` from `combat.ts:52` with a crawler-specific pool. At EN=0 you have 50 stamina; at EN=10 you have 60.

### 2.3 BFS Flow-Field Pathfinding (Enemy AI)

| Function | Purpose |
|----------|---------|
| `floodField(target, rows, cols, passable)` | Single-source BFS from one player; returns distance map (`crawl.ts:81`) |
| `floodFieldMulti(targets[], …)` | Multi-source BFS — each cell maps to nearest player; co-op targeting (`crawl.ts:114`) |
| `flowStep(from, field, blocked)` | Step toward smallest-distance neighbor not in `blocked` (`crawl.ts:150`) |

Enemies share the same field but each consults `blocked` (other monsters + players) to avoid stacking. Monster AI is cheap but emergent: enemies funnel through chokepoints naturally.

### 2.4 Status Effects

All statuses are real-time, ms-gated. Active statuses: `burn | poison | freeze | bless | weaken | blind`.

```
DOT_TICK_MS        = 1500   // crawl.ts:201 — burn/poison tick interval
FREEZE_DURATION_MS = 3000   // crawl.ts:203
```

`applyStatus` upserts (extending expiry and raising magnitude, never stacking multiple instances — `crawl.ts:206`).

### 2.5 Regen Intervals

```
STA_REGEN_MS     = 1200   // crawl.ts:263 — +1 stamina per tick
MP_REGEN_MS      = 2000   // crawl.ts:265 — +1 mana per tick
RING_HIT_CD_MS   =  600   // crawl.ts:267 — ring-of-fire hit interval
RING_DURATION_MS = 8000   // crawl.ts:269
```

### 2.6 Phase 1: Dash, Charged Swing, and Stat-Scaled Timing

All Phase 1 constants are exported from `crawl.ts` so both crawlers share identical behavior:

```
DASH_BASE_CD_MS    = 2000   // crawl.ts:296 — base dash cooldown at AG=0
CHARGE_SWING_COUNT =    2   // crawl.ts:298 — hold Space this many intervals to charge
CHARGE_DAMAGE_MULT = 1.75   // crawl.ts:300 — damage multiplier for charged swing
STAGGER_MS         =  500   // crawl.ts:302 — freeze duration applied on charged hit
```

**AG-scaled functions:**
```
dashCooldown(agLevel)  = max(800, 2000 − agLevel×40)   // crawl.ts:308–310
moveInterval(agLevel)  = max(100, 150 − agLevel×2)      // crawl.ts:316–318
```

At AG=0 the dash cooldown is 2 s and movement is 150 ms/cell. At AG=25 (stat cap) the cooldown floors at 800 ms and movement reaches 100 ms/cell. Both values are baked into run state at entry and do not change mid-run.

### 2.7 Damage Modifiers

From `src/engine/combat.ts`:
- `weakTo` stat: ×1.25 damage taken (`crawl.ts:328–335`)
- `resistTo` stat: ×0.6 damage taken
- Exhausted (insufficient stamina): ×0.5 damage dealt (`combat.ts:267–269`)

Base damage roll: `base = power + weaponBonus`; variance = `base × (0.85 + rng × 0.3)` = ±15% (`combat.ts:244–246`); then weak/resist/exhausted modifiers; then `max(1, round(dmg) − defense)`.

---

## 3. Deep Mine — Complete Mechanics

**Core files:**
- `src/engine/mining.ts` — pure game rules
- `src/hooks/useMiningLoop.ts` — rAF timing
- `src/components/mining/MineRunOverlay.tsx` — rendering/HUD
- `src/views/MiningView.tsx` — entry screen
- `src/content/mining.ts` — tunable data tables

### 3.1 Entry and Session Setup

**Energy cost:** `MINE_ENERGY_COST = 2` (`mining.ts:73`). Blocked unless `energy >= 2` or `settings.unlimitedEnergy`. Energy is deducted at run start in `beginMining` (`useGameStore.ts:1915`).

**Free tool:** If the player owns no mining tool, `stone_pickaxe` is granted and equipped to the tool slot (`useGameStore.ts:1858–1870`).

**Snapshot:** Combat stats are snapshotted once at entry via `deriveCombatant` (`combat.ts:48–62`). `agLevel` (for dash/move) is also snapshotted: `agLevel = statLevels.AG + gearAG` (`useGameStore.ts:1886–1888`). No mid-run stat changes affect an active run.

### 3.2 Controls

| Action | Key(s) | Timing |
|--------|---------|--------|
| Move | Arrows / WASD | `run.moveIntervalMs` (AG-scaled, fallback 150 ms) |
| Mine / Attack (normal) | Space / Enter | `SWING_INTERVAL_MS = 240 ms` (`useMiningLoop.ts:20`) |
| Mine / Attack (charged) | Hold Space ≥ 480 ms | `CHARGE_SWING_COUNT × 240 ms` |
| Dash | Shift | AG-scaled cooldown; consumes `dashCooldownMs` |
| Cast spell | 1–4 | `SPELL_CD_MS = 500 ms` global cooldown |
| Touch (D-pad) | On-screen | Same cadences |

Most-recently-pressed direction wins when multiple keys are held. **Monster clock:** `MONSTER_TICK_MS = 120 ms` (`useMiningLoop.ts:22`).

### 3.3 Dash

`tryDash(state, dir, nowMs)` (`mining.ts:606–634`): cooldown-gated by `run.dashCooldownMs`. Attempts a 2-cell skip in `dir`; falls back to 1 cell if the 2nd is blocked. On success, sets `lastHitAtMs = nowMs` — granting a full i-frame window.

The dash is the primary defensive tool in the mine. Against telegraphed monster contact damage (which is not yet telegraphed in the mine — see §3.6), it serves as an escape from adjacent monsters and as a traversal accelerator.

### 3.4 Charged Swing

Holding Space for `CHARGE_SWING_COUNT × SWING_INTERVAL_MS` (480 ms) fires `mineStrikeCharged()` (`useMiningLoop.ts:130–155`). In `strike(state, rng, nowMs, charged=true)` (`mining.ts:672–753`):
- Weapon attack: power × `CHARGE_DAMAGE_MULT (1.75)` + applies `frozenUntilMs = nowMs + STAGGER_MS (500)` on the hit monster (`mining.ts:704`).
- Mining swing: `effectivePick = ceil((basePick + stBonus) × 1.75)`, potentially cracking multi-durability rocks in a single hit (`mining.ts:715–722`).

### 3.5 Procedural Generation

`generateMine` (`mining.ts:293`) — drunk-walker cavern generator:

**Size scales with depth:**
```
MINE_BASE_ROWS/COLS = 33   // mining.ts:59–60
MINE_SCALE_PER_BAND =  4   // mining.ts:64–65
MINE_SCALE_BAND     =  4   // mining.ts:66 — floors per size step
MINE_MAX_ROWS/COLS  = 57   // mining.ts:61–62
band = floor((floor − 1) / 4)
size = min(57, 33 + band × 4)
```

**Carving (drunk walkers):** 10 walkers carve ~45% of the interior; `stepsPerWalker = ceil(targetFloor × 1.3 / 10)` (`mining.ts:322–351`). Each walker opens its cell and one random adjacent cell per step, ensuring connectivity.

**Shaft placement:** BFS from entrance finds the farthest reachable cell and places the descent shaft there (`mining.ts:389–410`).

**Scaling by floor:**

| Element | Formula |
|---------|---------|
| Rock durability | floor ≤ 2 → 1; floor ≤ 6 → 2; else 3 |
| Rock clusters | `5 + floor(f/2)` per floor, size 2–3 cells (`mining.ts:416–435`) |
| Ore clusters | `min(openFloor, 4 + floor(f/2))`, vein size 1–4 (`mining.ts:438–454`) |
| Monster count | `min(10, 2 + floor(f×0.6))` (`mining.ts:479–508`) |
| Energy gems | `max(1, floor(remainingFloor / 80))` (`mining.ts:464–477`) |

### 3.6 Ore Table

From `src/content/mining.ts`:

| Ore | Floor min | Weight | Durability | Drops |
|-----|-----------|--------|------------|-------|
| Loose Rubble | 1 | 3 | 1 | gold 1–4 |
| Bronze Vein | 1 | 3 | 2 | bronze_bar 1–2 |
| Iron Vein | 3 | 2.5 | 3 | iron_bar 1–2 |
| Gold Vein | 4 | 1.5 | 3 | gold 8–20 |
| Crystal Node | 6 | 1.2 | 4 | crystals 1–2 |
| Gemstone Node | 10 | 0.8 | 5 | gemstone 1 |
| Energy Gem | 1 | placed | 1 | +11 stamina |

**Breaking plain rock** (`mining.ts:734–744`): yields `stone = randInt(maxDur, min(3, maxDur+1))`; 20% chance of a bonus ore drop. Breaking an exhausted ore vein restores +1 stamina.

**Mining speed (Phase 1):** `stBonus = floor(meleePower / 8)` — one extra pick power per 8 ST levels. `effectivePick = basePick + stBonus` (`mining.ts:715–716`). A `stone_pickaxe` (`power: 1`) gives ST=8 → effectivePick 2 (same as next-tier tool). High-ST characters clear rock meaningfully faster than low-ST characters with identical gear.

### 3.7 Monster Roster

From `src/content/mining.ts`:

| Monster | Floor min | HP | Touch dmg | Move (ms) | Defense | Weak to | Resists |
|---------|-----------|----|-----------|-----------|---------|---------|---------| 
| Cave Slug | 1 | 8 | 4 | 950 | — | ST | — |
| Rock Biter | 3 | 18 | 7 | 700 | 2 | DX | — |
| Cave Spider | 4 | 14 | 8 | 400 | — | DX, WI | — |
| Deep Lurker | 6 | 28 | 10 | 520 | 1 | WI | ST |
| Stone Golem | 10 | 50 | 15 | 850 | 6 | ST | DX |

**AI:** BFS flow-field chase toward the nearest player. Deals contact damage once per `MINE_IFRAME_MS = 800 ms` (`mining.ts:80`) when adjacent: `dealt = max(1, touchDamage − defense − blessMagnitude)`.

**Note:** The mine has no windup telegraph before monster contact — monsters deal damage immediately on adjacency (subject only to the i-frame gate). The forest's windup system (§4.6) does not exist here. Players use the **dash** to escape adjacency rather than reading a telegraph.

**Kill loot:** computed by `killMonster` / `monsterLootPool` (`mining.ts:640–654`). The `bounty` field in the monster definition appears vestigial and is not consumed by this path.

### 3.8 Combat

**Context-sensitive swing** (`strike`, `mining.ts:672`): facing a monster → weapon attack; facing rock/ore → mining.

**Weapon attack:** `power = weapon.attackStat === 'DX' ? rangedPower : meleePower`. Costs `weapon.staminaCost ?? MELEE_STA_FALLBACK (2)`. Needs ≥1 stamina to swing; below cost threshold → ×0.5 damage (exhausted). Charged hit: ×1.75 + staggers target (`frozenUntilMs`).

**Mining:** costs `STRIKE_STA_COST = 1` per swing (`mining.ts:75`). No stamina = no dig.

**Spells:** `castSpell` (`mining.ts:759`). Gated by `mp >= mpCost` and global `SPELL_CD_MS = 500 ms` (`mining.ts:84`). See §3.10 for spell details.

### 3.9 Stamina & Mana Pools

```
maxSta = dungeonStamina(EN) = 50 + EN      // crawl.ts:67
maxMp  = 8 + KN × 3                        // combat.ts:51
maxHp  = 50 + HP × 7 + charLevel × 3       // combat.ts:50
```

Passive regen: +1 sta every 1200 ms, +1 mp every 2000 ms.

**Descend** (`mining.ts:571–582`): generates next floor, refills `+25%` sta and `+25%` mp. Haul and HP carry forward.

### 3.10 Spells in the Mine

Spells are drawn from `src/content/spells.ts` (15 spells total; `src/engine/spells.ts` is a types/helpers re-export). Schools: **damage** (WI-scaled), **support** (KN-scaled), **illusion** (CH-scaled). Mechanics active in the mine: `rune-fire / rune-ice / rune-poison` (floor traps, 30 s); `ring-of-fire` (8 s AoE ring, hits adjacent monsters every 600 ms, `dmg = max(2, power + damageSpell×0.5)`); `teleport` (3–6 Manhattan cells, i.e. `chaotic_blink`); damage (hits nearest monster); support (heals / applies bless). Three mechanics — `push`, `blink`, `cleave` — are Hex-Tactics-only and do not fire in the crawlers.

### 3.11 Win / Lose / Banking

- **No win condition.** Endless descent; `deepestMineFloor` is the persistence record.
- **Death** (HP ≤ 0): run ends; `commitMining` banks the **full haul**. **No loot penalty on death in the mine.**
- **Bank & Leave:** voluntary exit via `commitMining`; same outcome as death for the haul.

**Stat trickle on banking** (`useGameStore.ts:674–675`):
```
trickle = 4 + 3 × deepest
statXp += { ST: trickle, EN: trickle }
```

**Milestone gates** (`MiningView.tsx:9–15`): Floor 3 = Iron, Floor 4 = Gold, Floor 6 = Crystals, Floor 10 = Gemstone.

---

## 4. Wild Forest — Complete Mechanics

**Core files:**
- `src/engine/forest.ts` — pure game rules
- `src/hooks/useForestLoop.ts` — rAF timing
- `src/components/forest/ForestRunOverlay.tsx` — rendering/HUD
- `src/views/ForestView.tsx` — entry screen
- `src/content/forest.ts` — tunable data tables

### 4.1 Entry and Session Setup

**Energy cost:** `FOREST_ENERGY_COST = 2` (`forest.ts:72`). Same gate as the mine.

**Free tool:** If no chopping or mining tool is owned, `stone_pickaxe` is granted and equipped (`useGameStore.ts:2062–2071`).

**Death penalty:** `FOREST_DEATH_KEEP = 0.5` (`forest.ts:74`). On death, half of every gold and material stack in the haul is lost.

**AG snapshot:** `agLevel = statLevels.AG + gearAG` baked into `dashCooldownMs` / `moveIntervalMs` at entry (`useGameStore.ts:2084–2086`).

### 4.2 Controls

| Action | Key(s) | Timing |
|--------|---------|--------|
| Move | Arrows / WASD | `run.moveIntervalMs` (AG-scaled, fallback 150 ms) |
| Act (attack / chop / gather / shrine) | Space / Enter | `ACT_INTERVAL_MS = 240 ms` (`useForestLoop.ts:19`) |
| Act (charged) | Hold Space ≥ 480 ms | `CHARGE_SWING_COUNT × 240 ms` |
| Dash | Shift | AG-scaled cooldown |
| Cast spell | 1–4 | `SPELL_CD_MS = 500 ms` |

**Act priority in the loop** (`useForestLoop.ts:158–185`): host push-deeper → co-op guest melee intent → activate shrine → gather / slash / chop.

**Beast clock:** `BEAST_TICK_MS = 120 ms`, same as the mine monster clock.

### 4.3 Procedural Generation

`generateForest` (`forest.ts:394`) — recursive-backtracker maze:

**Same size scaling as the mine:**
```
FOREST_BASE_ROWS/COLS = 33   // forest.ts:58–59
FOREST_SCALE_PER_BAND =  4   // forest.ts:63
FOREST_SCALE_BAND     =  4   // forest.ts:65
FOREST_MAX_ROWS/COLS  = 57   // forest.ts:60–61
band = floor((stage − 1) / 4);  dims = min(57, 33 + band×4)  (forced odd)
```

**Maze carving:** All cells start as `thicket`. A DFS recursive backtracker carves corridors from odd-lattice cells via Fisher–Yates shuffled direction order (`forest.ts:403–434`). The result is a perfect maze (no loops) of narrow trails.

**Thicket is permanent.** Maze walls (`thicket`) cannot be chopped. Choppable objects are separate degree-1 tree placements (§4.4). The old durability field on thicket tiles is legacy and has no effect (`forest.ts:101`).

**Entrance / treeline:** `entrance` at top row center; `treeline` at bottom row — the exit is fixed (vs. mine's BFS-farthest shaft).

**Layout elements by stage:**

| Element | Count formula | Notes |
|---------|---------------|-------|
| Springs | `max(1, min(3, floor(trailCount/90)))` | On dead-ends; first spring at stage ≥4 is `ancient_spring` (`forest.ts:472–478`) |
| Resource nodes | `min(deadEnds-di, 12 + 2×stage)` | Weighted by stage (`forest.ts:481`) |
| Clearings (loot rooms) | `min(2 + floor(stage/2), corridors)` | 3×3 pocket carved; each has 2–4 nodes, 1–3 beasts, 1–2 corner trees, 40% shrine chance (`forest.ts:499–582`) |
| Choppable trees | `min(wallCells, 14 + 3×stage)` | Routing-safe thicket-adjacent placement (`forest.ts:598`) |
| Wandering beasts | `min(16, 5 + stage)` | Spawn `asleep: true` (`forest.ts:608–614`) |

**Tree durability:** stage ≤2 = 1, stage ≤6 = 2, stage 7+ = 3 (`forest.ts:498`).

### 4.4 Resource Nodes

From `src/content/forest.ts`:

| Node | Stage min | Weight | Yields |
|------|-----------|--------|--------|
| berry_forage | 1 | 3 | gold 1–5 |
| flower_bush | 1 | 3 | herbs 1–2 |
| flax_plant | 1 | 3 | cloth_roll 1–2 |
| crystal_find | 4 | 1 | crystals 1 |
| spring | 1 | placed | stamina 12–16 |
| ancient_spring | 4 | placed | stamina 20–25 |

**Gathering** is instantaneous and free (no stamina cost). **Chopping trees** costs `CHOP_STA_COST = 1` per swing (`forest.ts:85`) and yields `wood` on break.

**Chop speed (Phase 1):** `stBonus = floor(meleePower / 8)`, `effectiveChop = baseChop + stBonus` (`forest.ts:865–869`). Charged chop: `ceil((baseChop + stBonus) × 1.75)`. A high-ST character clears trees significantly faster.

The forest is the game's primary source of herbs, cloth, leather, game_meat, and pelt — all crafting recipe ingredients.

### 4.5 Beast Roster

From `src/content/forest.ts`:

| Beast | Stage min | HP | Touch dmg | Move (ms) | Aggro | Bounty | Flees | Weak / Resist / Def |
|-------|-----------|----|-----------|-----------| ------|--------|-------|---------------------|
| forest_deer | 1 | 8 | 0 | 150 | 4 | 2–6 | ✓ | weak DX |
| wild_rabbit | 1 | 5 | 0 | 130 | 3 | 1–3 | ✓ | weak DX |
| wild_boar | 1 | 10 | 4 | 620 | 3 | 1–4 | — | weak ST |
| gray_wolf | 2 | 14 | 6 | 400 | 4 | 3–8 | — | weak DX |
| forest_spider | 3 | 12 | 5 | 350 | 3 | 2–6 | — | weak DX, WI |
| forest_bear | 5 | 30 | 14 | 520 | 3 | 9–18 | — | def 2; weak ST |
| dire_wolf | 7 | 22 | 10 | 320 | 5 | 10–20 | — | weak WI; resist DX |
| ancient_guardian | 10 | 55 | 18 | 600 | 2 | 20–35 | — | def 5; weak ST; resist DX |

Prey (deer, rabbit): `flees: true`, no contact damage, drop premium loot (game_meat, pelt). Predators: BFS flow-field chase, contact damage with windup telegraph.

### 4.6 Combat, Dash, and the Ambush System

**Sleeping beasts:** All wandering beasts spawn `asleep: true`. The wake pass wakes a beast when a player enters its `aggroRadius` (Manhattan distance) (`forest.ts:1186–1198`). This is the **ambush** — you trigger fights by approach.

**Windup telegraph** (`forest.ts:1242–1290`): when a predator becomes adjacent, it sets `windupUntilMs = now + FOREST_WINDUP_MS (360 ms)`. Only after that delay — if still adjacent — does it deal contact damage (i-frame-gated at `FOREST_IFRAME_MS = 800 ms`). Moving away during the windup resets it. `dealt = max(1, touchDamage − blessedDefense − ward)`.

**Dash as the defensive counter** (`tryDash`, `forest.ts:730–757`): the 360 ms windup window is exactly the skill-expression slot the dash was designed for. A player who reads the beast's adjacency, dashes away in the windup window, then returns for a charged counterattack is playing optimally. The dash grants `lastHitAtMs = nowMs` i-frames; CD is AG-scaled.

**Player attack (`act`, `forest.ts:773`):**
- **Ranged:** scans the faced direction up to `weapon.range` cells; hits the first beast; walls/trees/nodes block. Costs `ARROW_STA_COST = 1` (`forest.ts:87`). Line-of-sight is checked.
- **Melee (normal):** `staCost = weapon.staminaCost ?? SLASH_STA_COST (2)`; `power = rangedPower` if `attackStat==='DX'` else `meleePower`.
- **Melee (charged):** ×`CHARGE_DAMAGE_MULT (1.75)` + applies `frozenUntilMs = nowMs + STAGGER_MS (500 ms)` on the target (`forest.ts:832, 854`).

**Prey AI:** `fleeStep` (`forest.ts:365–384`) maximizes BFS distance from the nearest player. Prey never wind up or deal contact damage.

### 4.7 Fog of War

`reveal()` (`forest.ts:280–292`) updates the `seen` grid each move. Visibility test: `dr² + dc² ≤ (radius + 0.5)²` (circular disc, `forest.ts:270–272`). `sightRadiusFor`: 4 in a clearing, 3 elsewhere (`forest.ts:263–267`).

`SIGHT_RADIUS = 3` (`forest.ts:79`), `CLEARING_SIGHT_RADIUS = 4` (`forest.ts:80`).

### 4.8 Shrines

From `src/content/forest.ts`:

| Shrine | Weight | Effect |
|--------|--------|--------|
| hunters_cache | 3 | gold 10–25 + game_meat 1–3 |
| forest_blessing | 2 | `bless` status, magnitude 4, 8 turns |
| disturbed_den | 2 (+1 at stage ≥5) | Spawns an awake `forest_bear` adjacent (trap!) |

Bless enables `defense` to mitigate incoming contact damage. The disturbed-den weight increases at stage 5+ (`forest.ts:1385–1396`).

### 4.9 Advance, Banking, and Death

**Advance (push deeper):** Standing on the `treeline` cell. Carries HP and haul forward; refills `+25%` sta and `+25%` mp (`forest.ts:694–707`).

**Bank & Leave:** `commitForest` via `beginForestBanking` (`useGameStore.ts:2154–2159`).

**Death:** `commitForestDeath` — commits `splitHaul(run.haul, 0.5)` (`useGameStore.ts:703–720`). Half haul kept, half lost.

**Stat trickle on banking** (`useGameStore.ts:693–694`):
```
trickle = 4 + 3 × deepest
statXp += { DX: trickle, EN: trickle }
```

---

## 5. Stats Analysis — All 8 Stats Across Both Games

Both games snapshot stat levels into a `Combatant` via `deriveCombatant` (`combat.ts:48–62`) at run start. **All eight stats now have mechanical effect** in the crawlers following Phase 1 additions.

```
maxHp        = 50 + HP×7 + charLevel×3    // combat.ts:50
maxMp        = 8 + KN×3                   // combat.ts:51
maxSta (crawl) = 50 + EN                  // crawl.ts:67 (overrides combat.ts:52's 12+EN)
meleePower   = ST                          // combat.ts:53
rangedPower  = DX                          // combat.ts:54
dodge        = min(0.40, AG×0.02)          // combat.ts:55  ← consumed in turn-based & Arena
flee         = min(0.90, 0.40 + AG×0.03)  // combat.ts:56  ← consumed in turn-based & Arena
damageSpell  = WI                          // combat.ts:57
supportSpell = KN                          // combat.ts:58
illusionPower = CH                         // combat.ts:59
```

In the crawlers specifically, `dodge` and `flee` are **not** rolled on contact damage. Dash i-frames are the crawl-native dodge mechanic; `dodge`/`flee` are consumed in turn-based combat and the Arena.

### Full Stat Table

| Stat | Mine effect | Forest effect | Notes |
|------|-------------|---------------|-------|
| **ST** | `meleePower = ST` → weapon damage (melee). Mining speed: `+1 effectivePick per 8 ST`. Cave Slug, Stone Golem weak to ST. ST XP trickle on banking. | Melee damage + chop speed (`+1 effectiveChop per 8 ST`). Boar, Bear, Ancient Guardian weak to ST. | Directly impactful for melee/mining builds |
| **DX** | Damage with DX-type weapons. Rock Biter, Cave Spider weak to DX. Stone Golem resists DX. | Ranged attack power. Deer, Rabbit, Gray Wolf, Forest Spider weak to DX. Dire Wolf, Ancient Guardian resist DX. DX XP trickle on banking. | Primary stat for ranged/DX builds |
| **AG** | Move cadence: `max(100, 150 − AG×2)` ms/cell. Dash cooldown: `max(800, 2000 − AG×40)` ms. | Same AG scaling for move + dash. | **Phase 1 addition.** AG=10 → 130 ms moves and 1600 ms dash CD; AG=25 → 100 ms and 800 ms. Meaningful mobility advantage. |
| **EN** | `maxSta = 50 + EN`. More swings/digs before exhaustion. EN XP trickle on banking. | Same — more slashes/chops before exhaustion. | Low leverage early (EN=10 = +10 over base 50), but large base means stamina rarely runs dry mid-run |
| **WI** | Scales damage-spell output: `power + WI×1.2`. Cave Spider, Deep Lurker weak to WI. | Spider, Dire Wolf weak to WI. Same spell scaling. | Conditional — only matters with damage spells in loadout |
| **KN** | `maxMp = 8 + KN×3`. Support spell heal: `power + KN×1.5`. | Same — both MP pool and heal potency. | Conditional — doubly important with support spells; irrelevant without |
| **CH** | Illusion spell status duration: `+floor(CH/8)` extra ticks (`combat.ts:398`). | Same marginal duration extension. | Nearly dead weight — very small effect unless heavily investing in illusion spells |
| **HP** | `maxHp = 50 + HP×7 + charLevel×3`. HP=10 → 120 HP vs base 50. | Same. High HP absorbs windup hits. | Straightforward and impactful for all builds |

### Key Finding: AG Is Now Load-Bearing

Phase 1 closed the biggest hole in the stat system. Agility now drives two tangible, always-active effects: movement speed (100–150 ms/cell range) and dash cooldown (800–2000 ms range). An AG=25 character has 33% faster movement and dashes 2.5× more frequently than AG=0. These are not marginal — they define a distinct "mobility" playstyle.

### Key Finding: Stat Specialization Now Creates Distinct Builds

- **ST melee build:** high meleePower + stat-scaled mine/chop speed. Clears rocks in fewer swings; charges through clumps.
- **DX ranged build:** kites and sniped in the forest; most beasts are weak to DX.
- **AG mobility build:** fastest movement + most dashes; can reliably window-dodge every windup in the forest.
- **Spell builds (WI/KN/CH):** require spell acquisition outside the crawler; strong in groups.

### Remaining Gap: CH Is Thin

Charisma's effect — adding `floor(CH/8)` extra ticks to illusion spell durations — is nearly imperceptible in practice. CH=8 adds 1 extra tick; CH=25 adds 3. There is no CH effect outside of illusion spells. A high-Charisma player who doesn't run illusion spells gets nothing from their habits in these games.

### Remaining Gap: EN Has a Low-Leverage Pool

`maxSta = 50 + EN` means EN=10 gives 60 stamina — only 20% more than the base 50. Passive regen (+1 per 1200 ms) and energy gems (mines) / springs (forest) keep most players topped up. The endurance stat rarely becomes a meaningful constraint. A player with EN=0 and a player with EN=10 have nearly identical run experiences.

---

## 6. Co-op / Multiplayer Layer

**Files:** `src/net/coop/protocol.ts` (wire format + constants) and `src/net/coop/session.ts` (lobby/discovery).

### 6.1 Transport

- **Supabase Realtime Broadcast** over channel `coop:{sessionId}` (`protocol.ts:89–91`).
- Session row in `coop_sessions` Supabase table: `{ id, party_id, game, seed, host_id, status: 'lobby'|'active'|'ended' }` (`session.ts:15–22`).
- `COOP_BROADCAST_HZ = 10`, `COOP_BROADCAST_MS = 100` (`protocol.ts:94–95`).
- `COOP_PLAYER_TIMEOUT_MS = 5000` (`protocol.ts:97`).
- `CoopGame = 'mine' | 'forest'` — single protocol serves both crawlers.

### 6.2 Authority Split

| Authority | Who | What |
|-----------|-----|-------|
| Host | Canonical world | Monster simulation, kill/loot resolution, `WorldSlice` broadcast |
| Each player | Own body | Position, HP/sta/mp, haul, spell casts |
| Shared (deterministic) | Map | Regenerated from `mulberry32(seed)` — byte-identical on all clients |
| Peer-to-peer | Tile changes | Digs/gathers propagate via `TileSlice` — no host gate |

### 6.3 Wire Messages

| Message | Direction | Contents |
|---------|-----------|----------|
| `WorldSlice` | Host → all | `floor, status, monsters: MonsterSlice[]` |
| `MonsterSlice` | embedded | `id, key, r, c, hp, readyAtMs, asleep?` |
| `PlayerSlice` | Each → all | `userId, username, r, c, facing, hp, maxHp, floor` |
| `AttackIntent` | Guest → host | `userId, monsterId, dmg` — host resolves kill/loot |
| `TileSlice` | Peer → all | `userId, floor, r, c, tile` |
| `ByeIntent` | Leaving → all | `userId, username` |

### 6.4 Key Properties

- **Shared world, separate hauls.** Each player banks their own loot independently. A node dug by Player A disappears for Player B.
- **Co-op uses `floodFieldMulti`** so monsters target the nearest of all players — genuine multi-player threat dynamics.
- **Smooth remote rendering.** Remote players are interpolated in world-pixel space via rAF.
- **Guest melee routing.** Guests send `AttackIntent`; host resolves kills exactly once, preventing loot duplication.

### 6.5 Assessment

The co-op layer is technically sound: deterministic seeds, 10 Hz broadcast, graceful 5 s timeouts, clean authority split. It is one of the genuine strengths of both games and should be built on rather than replaced.

---

## 7. Design Analysis — How Well They Work as Games

### 7.1 What Works

**Clean, readable entry point.** Both games are instantly understandable: move with arrows, Space to act, go deeper, don't die. No tutorial required.

**Procedural generation keeps content fresh.** Drunk-walker caverns (mine) and recursive-backtracker mazes (forest) feel distinctly different: the mine is open and exploratory; the forest is a tight labyrinth. New layouts every run.

**Flow-field AI is emergent and cheap.** Monsters funnel naturally through architecture, create chokepoints, and crowd-route without expensive pathfinding.

**The Forest's ambush system is the best idea in either game.** Sleeping beasts that wake on approach, combined with a short windup telegraph before striking, creates genuine moment-to-moment tension. The telegraph gives skilled players an escape window — and now, a dash to exploit that window. Prey animals that flee are a charming contrast.

**Phase 1 added a real skill ceiling.** The dash-on-windup interaction in the forest is genuinely satisfying: see the beast go adjacent, dash out of the 360 ms window, turn around for a charged counterattack, and the stagger locks the beast while you land a second hit. This three-step sequence requires reading the situation, making a positional decision, and timing a hold — exactly the kind of skill expression that distinguishes expert from novice play.

**Death stakes in the forest are meaningful.** Losing half your haul on death creates a real push-your-luck decision: push to the next stage or bank now?

**Co-op is a genuine differentiator.** Monsters routing to the nearest of you, fighting over corridors, shared depletion — this elevates both games.

**Depth-scaled rewards.** Richer ore tiers at deeper floors, escalating monster difficulty, and the `4 + 3 × deepest` stat trickle give players real reasons to push further.

---

### 7.2 What Doesn't Work

#### The Mine Has No Death Penalty

The forest risks half your haul on death. The mine risks nothing — `commitMining` banks the full haul regardless of how the run ended. This removes the mine's only potential source of tension. There is no reason to ever voluntarily leave before dying. Death is a free bank.

#### The Loot Is Economy Fuel, Not Character Definition

Mining yields gold and crafting materials. The forest adds herbs and leather. These feed the crafting economy — useful, but none of it changes how you *play during a run*. No run-specific upgrades, no build choices, no artifacts that make one run feel distinct from another. Every run is mechanically identical to the last at the same depth, just with a different map layout.

In Hades, each run you pick boons that fundamentally change your attack. In Spelunky, found items change how you approach every screen. In these crawlers, you enter with your snapshot and leave with the same snapshot + loot.

#### No Win Condition, Score, or Mastery Curve

Both games are endless treadmills. `deepestMineFloor` and `deepestForestStage` are the only persistence records. There is no score, no speed record, no objective beyond "go deeper." Players have no way to measure improvement or set goals within a single run.

This matters especially for a habit-tracking RPG — the whole philosophy is measuring real-world progress via in-game systems. The minigames don't reinforce this internally: there's no run metric that says "you played better today than yesterday."

#### Fog and Clearings Are Underused in the Forest

`SIGHT_RADIUS = 3` is narrow. Clearings expand it to 4. But the fog does little mechanical work beyond hiding beast positions. It doesn't create meaningful information-asymmetry decisions: beasts wake on Manhattan distance regardless of your facing, line of sight, or whether you're sneaking through a dark corridor. The fog is ambiance rather than mechanic.

#### CH Is Nearly a Dead Stat

Charisma's only effect — extending illusion spell durations by `floor(CH/8)` ticks — is so marginal it barely registers. CH=8 adds 1 tick; CH=25 adds 3. Without illusion spells in the loadout, CH contributes zero. A player who has logged dozens of Charisma habits gets virtually no benefit in either crawler.

#### No Boss Structure

Stone Golem (mine, floor 10+) and Ancient Guardian (forest, stage 10+) are the toughest regular monsters. But they spawn as part of the normal wandering enemy population — there's no boss fight structure, no arena, no escalating pattern to read. The deepest floors feel like earlier floors with harder numbers. There is no "chapter end" moment.

#### Minimal Feedback and Juice

The overlays render well-structured tile grids, but there's no screen shake, no impact hold frame, no progressive camera effects as you descend. Charged swings and dash i-frames are mechanically significant but may feel indistinguishable from normal swings to a player who hasn't read the code. The absence of distinct audio or visual feedback for charged hits, successful dodges, and stagger events means the skill ceiling isn't *felt* as clearly as it could be.

---

### 7.3 Risk / Reward & Pacing

| Dimension | Mine | Forest |
|-----------|------|--------|
| Death penalty | None (full haul kept) | Half haul lost |
| Push-your-luck tension | Low | Moderate |
| Escalation feel | Clear (ore tiers gate depth) | Clear (beast difficulty + fog) |
| Skill expression (Phase 1) | Dash escape, charged mining for speed | Dash-on-telegraph, charged counterattack, AG builds |
| Regen / resource | Energy gems; passive regen generous | Springs provide bursts; passive regen same |
| Boss / climax | None | None |
| Pacing of a run | Flat — same loop every floor | Slight variation from shrines and clearings |

---

## 8. Comparisons to Known Games

### 8.1 Deep Mine

#### Most Similar: SteamWorld Dig / Motherload

The mine's core loop — dig downward, collect ore, bank — is the direct descendant of **Motherload** (2004) and **SteamWorld Dig** (2013). **What HabitsRPG does:** procedural one-way descent with ore tiers gated by depth. **What SteamWorld Dig adds that the mine lacks:** upgrade-gated traversal (you need a steam upgrade to reach new biomes), ability unlocks (drill, steam jump, lantern) that change how you dig — new *verbs*, not just numbers.

#### Dome Keeper — The Return Loop

**Dome Keeper** (2022) structures the dig around a surfacing timer. The forced return creates rhythm and stakes. The mine has no "return" requirement and no external pressure rhythm. Adding even a soft timer (gas build-up, cave-in warning) would create this missing beat.

#### Spelunky — Emergent Hazard Play

**Spelunky's** design philosophy is *emergent interaction* between systems: enemies, traps, items, and terrain interact in ways the player can exploit. A boomerang can stun an enemy into a spike trap. The mine's systems don't interact — monsters can't be lured into cave-ins, runes sit inertly on floors. The elements are additive, not combinatorial.

#### Hades — Run-and-Bank with Build Choices

**Hades** (2020) is structurally closest to both games' meta loop: enter, fight, collect, die-or-bank, repeat. What Hades does that neither crawler does: boons and items collected *during the run* modify your verbs. Every run plays differently. The crawlers' runs are structurally identical beyond map layout.

---

### 8.2 Wild Forest

#### Most Similar: Don't Starve — Foraging + Ambush Predators

**Don't Starve's** design ancestry is clear: top-down foraging, predators dangerous on approach, prey-vs-predator duality. **What Don't Starve adds:** genuine resource depletion and regrowth cycles (systems thinking); hunger and sanity as parallel pressure systems; distinct biomes with unique resources; seasonal progression that changes the rules of the world qualitatively. The forest's stage escalation is linear difficulty scaling, not a qualitative rule change.

#### Brogue / Pixel Dungeon — Fog of War Roguelikes

**Brogue** makes fog an information game: enemies have detection ranges, you can use sound/light tactically, stealth is a meaningful resource. **The forest's fog is passive** — it hides beast positions but doesn't create an information game. Beasts wake on Manhattan proximity regardless of facing or stealth.

#### Zelda LTTP — Telegraph + Real-Time Grid Combat

Classic **Zelda** combat is the clear reference for the forest's control scheme: facing-based attack, contact damage with telegraph, locked movement cadence. Phase 1 brought the forest closer by adding a dash that makes the telegraph a skill-expression moment. **What Zelda adds that the forest still lacks:** shield/block to reward defensive timing; knockback positioning; item-based attack variety (hookshot, bombs).

#### Crypt of the NecroDancer — Grid-Step Real-Time with Mastery

**NecroDancer** uses beat-precise movement as a mastery expression layer: skilled players chain combos and control enemy patterns. Phase 1's dash + charged swing bring the forest closer to this model — there is now a sequence of moves that separates expert play. The gap has narrowed, but the forest still lacks combo chaining (a second hit that extends from the first stagger, for example).

### 8.3 Comparison Table

| Game | Shared with HabitsRPG | Gap remaining |
|------|----------------------|--------------|
| SteamWorld Dig | Dig-for-ore loop | Upgrade-gated traversal, ability unlocks |
| Dome Keeper | Collect + bank loop | Return timer / external pressure rhythm |
| Spelunky | Procedural descent | Emergent system interactions |
| Don't Starve | Foraging + ambush predators | Resource depletion/regrowth, multiple pressure systems |
| Brogue | Fog of war maze roguelike | Stealth/detection information game |
| Zelda LTTP | Telegraph + grid combat (now with dash) | Shield/block, knockback, item variety |
| Crypt of the NecroDancer | Grid-step with skill expression (closer post-Phase 1) | Combo chaining, mastery ceiling |
| Hades | Run-and-bank | In-run build choices, verb modification |
| Terraria | Ore tiers, crafting economy | Ores unlock new gameplay verbs |

---

## 9. Opportunities — Forward Pointers for Improvement

*Phase 1 is done. This section re-tiers all previous opportunities, marks completed items, and identifies what's next.*

### Phase 1 — Completed

These were the highest-leverage items from the previous analysis. All confirmed done in the current codebase:

- ~~AG dead weight~~ → **Done.** AG now scales dash cooldown and move speed in both crawlers.
- ~~Mining speed gear-only~~ → **Done.** ST-scaled via `stBonus = floor(meleePower / 8)`.
- ~~Move speed unmoored from stats~~ → **Done.** `moveInterval(AG) = max(100, 150 − AG×2)`.
- ~~Single repeated attack action~~ → **Done (partial).** Dash + charged swing add meaningful verbs; the forest telegraph + dash-dodge interaction creates a skill-expression loop.

---

### Still-Open: Highest Leverage

**1. Add a death penalty to the mine.**
The forest's half-haul penalty is its primary source of tension. The mine has zero penalty — death is a free bank. Even 15–20% haul loss on death would create push-your-luck decisions and make each floor feel meaningful. This is the single highest-leverage design change remaining.

**2. In-run pickups that change the run.**
Both games produce loot (economy fuel) but never in-run modifiers. Options: rare consumables in clearing loot rooms (speed rune for 30 s, a charged-swing count booster, a mana crystal); a "vein echo" artifact that doubles ore drops for one floor; a beast charm that pacifies one nearby predator. One or two per run, non-persistent. The run must feel different from the last.

**3. Score and run metrics.**
A floor-weighted kill count, a resource-efficiency score, a personal-best depth-and-time metric — something that lets players measure improvement run-over-run. Aligns directly with the habit-tracking philosophy: the minigame should reinforce the idea that you got better today than yesterday.

**4. Boss encounters at depth gates.**
Stone Golem (mine floor 10) and Ancient Guardian (forest stage 10) appear as ordinary wandering monsters with no structure. Placing them as room guardians — fixed location, unique entry fanfare, distinct attack pattern — with a kill required to unlock the next ore/material tier would give each 10-floor band a climax and a goal. A player can now say "my goal this session is to reach floor 10 and slay the Golem."

**5. Make CH mechanical in the crawlers.**
Charisma has almost no effect. Options: CH affects shrine outcomes (higher CH → better roll on disturbed_den, turning trap shrines into risky-but-rewarding bets); CH reduces wandering beast aggro radii (lower chance of waking sleeping beasts); CH adds a charm mechanic (pacify one prey beast for 10 s to safely gather nearby). Any of these tie Charisma habits to genuine in-game payoff.

---

### Still-Open: Medium Leverage

**6. Deepen the forest's fog.**
Beast detection ranges (beasts "hear" you before they see you — hear range > aggro radius); directional awareness (beasts only wake if they're in front of you); rain/darkness stages that shrink sight radius further and make springs harder to find. Turn fog from ambiance into an information game.

**7. Environmental hazards that interact with existing systems.**
Mine: cave-in zones that collapse after N swings nearby; gas pockets that combo with fire runes; underground rivers that slow movement. Forest: underbrush that slows movement; mud near springs; rain that cancels fire runes. These make the map itself an active participant rather than a backdrop.

**8. Biome variety.**
The mine could shift texture at depth bands (cave → deep cave → magma layer) with unique rock types, new color palettes, and biome-specific monsters. The forest could have biome types per stage (thicket → meadow clearing → ancient grove) with qualitatively different layouts and resources. Visual and mechanical differentiation.

**9. Combo chaining from stagger.**
The charged swing staggers (`frozenUntilMs = nowMs + 500`). Right now the stagger is a damage window. A natural extension: a stagger-chained attack that costs extra stamina but deals a third hit — the beginning of a combo system. Even a simple 2→3-hit chain would give the forest's skill ceiling a meaningful ceiling.

---

### Still-Open: Lower Leverage / Polish

**10. Juice and feedback.**
Screen shake on heavy hits; a distinct color flash or animation frame for dash i-frame activation; a held-pose indicator for charged swings; progressive camera behavior as you descend deeper (slight zoom out at floor/stage 5+). These don't change mechanics but make skill expression *felt*.

**11. Per-run loot drop that feeds build identity.**
A rare "charm" that appears in one clearing per run, grants a temporary passive for that run only (no persistent effect). Examples: "Beast Ward" (all predators have −2 touch damage this run); "Miner's Eye" (ore cluster locations revealed on minimap). Creates a moment of decision; makes runs memorable.

**12. Expanded spell economy.**
Spells currently require separate progression outside the crawlers. In-run spell economy: a rare spell-scroll consumable that grants one use of a spell you don't know; a mana font node (like energy gems) that restores MP. This makes spell-build more accessible and makes WI/KN/CH relevant to a wider share of players.

---

*End of analysis. Verified source files: `src/engine/crawl.ts`, `src/engine/mining.ts`, `src/engine/forest.ts`, `src/engine/combat.ts`, `src/engine/spells.ts`, `src/content/spells.ts`, `src/content/mining.ts`, `src/content/forest.ts`, `src/hooks/useMiningLoop.ts`, `src/hooks/useForestLoop.ts`, `src/store/useGameStore.ts`, `src/net/coop/protocol.ts`, `src/net/coop/session.ts`.*
