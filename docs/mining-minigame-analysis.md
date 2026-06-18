# Deep Mine — Minigame Analysis

## 1. Basic Summary

The Deep Mine is a real-time, top-down dungeon crawler minigame. The player navigates a procedurally generated cave, swings a pickaxe at ore veins to collect crafting materials and gold, fights monsters using weapons and spells, and descends through increasingly hostile floors. It costs 2 energy to enter (earned by completing real-life habits in the main game) and rewards the player with a "haul" of materials and gold that feeds the character economy when banked on exit.

The minigame sits alongside the Wild Forest as one of the two large-world dungeon crawlers. Both share the same grid-crawl infrastructure (`src/engine/crawl.ts`). The mine is the Strength/Endurance-flavored crawler, built around physical resource extraction and contact-damage attrition rather than ranged hunting.

---

## 2. Core Game Loop

### Entry
- The player opens the mine from `MiningView.tsx` (the lobby screen).
- The lobby shows deepest floor reached and best run score, plus energy cost (2).
- Pressing "Begin Mining" calls `store.beginMining()`, which snapshots the character's combat stats, auto-grants a `stone_pickaxe` tool, seeds a `mulberry32` RNG, and calls `generateMine(floor=1, snapshot, rng)`.

### Active play (repeated)
1. **Move** — Player navigates the cave using WASD/arrow keys (or on-screen D-pad). Movement steps one cell per ~150 ms (Agility-scaled). Facing updates even when a cell is blocked.
2. **Strike** — Pressing Space/Mine button swings at the faced cell every ~240 ms. Auto-context: if a monster occupies the faced cell, the equipped weapon fires; if it's a rock or ore tile, the pickaxe chisels at it. Each strike costs 1 stamina.
3. **Charge** — Holding the strike button through 2 full swing intervals builds a charged strike (1.75× damage/mining power). A charged hit on a monster also staggers it (500 ms freeze).
4. **Dash** — Shift/Dash button teleports the player 1–2 cells forward, granting a brief i-frame. Cooldown starts at 2000 ms and shrinks with Agility.
5. **Spells** — Keys 1–4 cast from the character's known spell loadout (runes, ring-of-fire, teleport, damage/support/illusion spells).
6. **Explore** — Navigating the cave reveals ore clusters, boon caches, and the shaft tile. Walking onto a boon cache (`kind: 'boon'`) triggers a 3-card boon-choice pause.

### Difficulty progression
- Floor number drives map size (33×33 on floor 1 → up to 57×57 by floor 15), rock durability (1–3 swings), ore tier, monster count (2 + floor×0.6, max 10), monster HP and speed, and a biome band shift that replaces the ore/monster pool.
- Two band-gate guardian bosses appear at fixed floors: Stone Golem (floor 7) and Magma Colossus (floor 15). These are placed deterministically and always trigger a boon-choice overlay on death.
- Monsters use BFS pathfinding toward the player every 120 ms tick. Speed varies per monster type (400–950 ms per step).

### Descent
- When the player reaches the shaft tile (always at the BFS-farthest walkable cell from the entrance), they can press the Descend button (or stand on it).
- `store.mineDescend()` carries HP, 25% refilled stamina and mana, the full haul, score, and active boons forward into a newly generated floor.

### Ending a run
- **Banking**: Player presses "Leave" → `store.beginBanking()` pauses the run with a "haul secured" overlay, then `store.endMining()` adds loot to the character inventory and records `deepestMineFloor`/`bestMineScore`.
- **Death**: HP reaches 0 → `status: 'ended'` → death overlay. Player keeps 50% of the haul (`MINE_DEATH_KEEP = 0.5`) but the rest is lost. `endMining()` applies the partial haul.
- **Score** is accumulated as: `+10 × floor` per kill, `+100 × nextFloor` per descent, `+500` per guardian kill. Best score persists in the store.

---

## 3. Player Controls and Interaction

### Input
| Action | Keyboard | On-screen |
|---|---|---|
| Move | WASD / Arrow keys | D-pad (MineControls.tsx) |
| Strike / Mine | Space | Mine button |
| Dash | Shift | Dash button |
| Spell 1–4 | Keys 1, 2, 3, 4 | Spell bar buttons (1–4) |
| Descend | Descend button (UI) | Same |
| Leave / Bank | Leave button (UI) | Same |

Touch controls are defined in `src/components/mining/MineControls.tsx` and appear when a mobile/touch context is detected.

### UI elements (MineRunOverlay.tsx)
- **HUD bar**: Floor + band name, HP gauge, Stamina gauge, MP gauge, haul tally (gold + material counts).
- **Spell bar**: Four ability slots showing equipped spell icons and MP cost; disabled if not enough MP.
- **Facing indicator**: The cell the player faces is highlighted with a gold border.
- **Descend/Leave buttons**: Appear in the bottom bar; Descend is only visible when standing on the shaft.
- **Boon choice panel**: Pauses play when a guardian dies or a boon cache is walked over; shows 3 cards with icon, name, and description.
- **Banking overlay**: "Haul secured" screen shown when Leave is pressed before `endMining` fires.
- **Death overlay**: "Fallen in the Deep" screen with haul summary and exit option.

### Feedback
- **Loot floaters**: Gold and material text rises from broken ore/killed monsters (`loot-float` animation).
- **Damage/heal numbers**: Color-coded floating numbers for combat hits and heals.
- **Destruction pops**: A gold burst animation (`mine-pop`) flashes when a rock or ore breaks.
- **Hit flash**: Player avatar flashes red on taking contact damage (`crawler-hit` animation).
- **Descent wipe**: A color-wash transition plays when descending (`crawl-wipe` animation).
- **Ambient atmosphere**: Falling dust motes and crystal sparkles reinforce depth and cave mood.

---

## 4. Mechanics and Systems

### Movement
- **Grid-based, 4-directional**. Player and all monsters occupy exactly one tile at a time.
- Move rate: `moveInterval(agLevel) = max(100, 150 - agLevel * 2)` ms. A level-0 character moves every 150 ms; a high-Agility character can reach 100 ms.
- Facing updates every input; the cell stepped into is only changed if it is walkable and unoccupied by a monster.
- Walkable tile kinds: `floor`, `entrance`, `shaft`, `boon`. `rock`, `ore`, and `bedrock` block movement.

### Dash
- Moves 2 cells in the current direction (falls back to 1 if the 2-cell destination is blocked). No-ops if neither destination is free.
- Cooldown: `dashCooldown(agLevel) = max(800, 2000 - agLevel * 40)` ms.
- Grants an i-frame: `lastHitAtMs` is set to now, blocking contact damage for `MINE_IFRAME_MS = 800` ms.

### Strike / Mining
- **Auto-context**: monster in faced cell → weapon attack; rock/ore → pickaxe.
- Mining power: `pickaxePower + floor(meleePower / 8)`. Charged: multiplied by 1.75 (rounded up).
- **Rock durability**: 1 swing (floors 1–2), 2 swings (floors 3–6), 3 swings (floors 7+). Breaking a rock drops 1–3 stone and has a 20% bonus ore drop.
- **Ore durability**: 1–5 swings depending on ore type. Breaking yields the ore's defined material/gold range. A single broken ore also restores +1 stamina; energy gems restore +11.
- **Stamina cost**: 1 per swing (rock or ore); weapon's `staminaCost` for monster attacks (fallback 2).
- **Weapon attack**: Calls `attackRoll(power, bonus, attackStat, weakTo, resistTo, fullSta, defense, rng)` from `src/engine/combat.ts`. Damage is boosted 25% against weak stats, reduced 40% against resist stats.

### Charged strike
- Triggered after holding the strike button through `CHARGE_SWING_COUNT = 2` swing intervals (reducible to 1 with the Overcharge boon).
- Applies `CHARGE_DAMAGE_MULT = 1.75` to both weapon damage and mining power.
- Staggers hit monsters for `STAGGER_MS = 500` ms (they skip movement ticks during this window).

### Monsters
- **Spawning**: Random floor cells at Manhattan distance > 4 from the entrance. Count = `min(10, 2 + floor × 0.6)`. Guardians are placed separately at cells distant from both entrance and shaft.
- **Movement**: BFS flow-field (`floodFieldMulti`) toward the nearest player, computed once per tick. Monsters respect each other's occupied cells. They stop when adjacent to the player.
- **Contact damage**: When a monster is adjacent and the i-frame window has expired, the player takes `max(1, touchDamage - defense - blessBonus - boonDefenseBonus)` HP.
- **I-frames**: `MINE_IFRAME_MS = 800` ms after each hit or dash.
- **Status effects**: Monsters can be frozen (skip movement ticks), poisoned (DoT per 1500 ms tick), or burned (same DoT system).
- **Resistances/weaknesses**: Defined per monster via `weakTo`/`resistTo`. Each multiplies attack damage by 1.25 or 0.6 respectively.
- **DoT deaths**: Monsters that reach 0 HP from DoT are processed in `killMonster` during the monster tick, granting loot and score.

### Spells
Four mechanic types are supported, drawn from the character's `knownSpells`:
- **Rune placement** (`rune-fire`, `rune-ice`, `rune-poison`): Places a trap on the faced floor tile. Triggers on any unit contact. Fire runes apply burn DoT; ice runes freeze; poison runes apply poison DoT. Expires after 30 seconds.
- **Ring of fire**: Passive aura. For 8 seconds, any adjacent monster takes `ringOfFire.dmg` every 600 ms.
- **Teleport**: Moves the player to a random walkable cell 3–6 Manhattan tiles away.
- **Damage spells** (school `damage`): Auto-target nearest monster. Can apply burn, freeze, or poison depending on spell definition.
- **Support spells** (school `support`): Heal player HP; optionally apply `bless` status (reduces contact damage taken).
- **Illusion spells**: Apply `freeze` or `poison` debuff to nearest monster, scaled by `illusionPower`.
- Spell CD: 500 ms between any casts; MP cost per spell; passive MP regen: +1 every 2000 ms.

### Boon system
Boons are permanent run-wide modifiers accumulated during a run, stored as `activeBoons: string[]` on `MineState`.

Mine-eligible boons (from `src/content/boons.ts`):
| Key | Effect |
|---|---|
| `swift_step` | Move 25% faster (divides `moveIntervalMs` by 1.25) |
| `iron_arm` | +30% weapon damage (multiplies melee/ranged power by 1.3) |
| `stone_skin` | −3 contact damage per hit |
| `vein_sense` | Double ore yield |
| `quick_dash` | Dash cooldown reduced by 30% |
| `overcharge` | Charged swing needs 1 fewer hold-interval |
| `vitality` | +20 max HP; healed immediately on pickup |

Boon sources:
- **Boon cache tiles** (kind `boon`): ~33% chance per non-guardian floor. Walking onto the tile triggers the 3-card choice panel. The run status becomes `'choosing'`, pausing all action.
- **Guardian kills**: Always trigger the 3-card choice after the Stone Golem (floor 7) and Magma Colossus (floor 15).

Duplicate boons are excluded from the roll pool. With 7 total mine-eligible boons, a player who completes both guardian fights can hold at most 2 guaranteed boons plus any cache finds.

### Biome bands
| Band | Floors | Palette | New ores | New monsters |
|---|---|---|---|---|
| Rocky Caverns | 1–6 | Warm amber | Rubble, Bronze, Iron, Gold, Crystal | Cave Slug, Rock Biter, Deep Lurker, Cave Spider |
| Frozen Depths | 7–14 | Ice blue | Frost Quartz | Ice Crawler (plus Stone Golem guardian) |
| Magma Core | 15+ | Volcanic orange | Obsidian Vein, Magma Geode | Magma Hound (plus Magma Colossus guardian) |

The palette is applied as CSS color values to tile rendering in `MineRunOverlay.tsx` using `bandForFloor()`.

### Win/loss conditions
- **No hard win**: The mine is designed as an endless depth-progression. The player decides when to bank.
- **Loss (death)**: HP reaches 0. `status` becomes `'ended'`. 50% of haul is lost.
- **Optimal play goal**: Reach as deep as possible, kill both guardians for guaranteed boon choices, collect the haul, and exit alive.

### Stat scaling
At run entry, `beginMining` snapshots the character's derived power values from `useGameStore`:
- `meleePower` (ST-based) — weapon and pickaxe damage
- `rangedPower` (DX-based) — ranged weapon fallback
- `damageSpell` / `supportSpell` / `illusionPower` (WI/KN/CH-based) — spell scaling
- `defense` — flat damage reduction
- `ward` — magical damage reduction
- `maxHp`, `maxSta`, `maxMp` — resource pools
- `agLevel` — governs movement speed and dash cooldown

Stats do not change mid-run (the snapshot is fixed). Only boons can improve combat effectiveness during a run.

### Scoring
- `+10 × floor` per monster killed
- `+100 × nextFloor` per descent (e.g., descending to floor 3 = +300)
- `+500` per guardian kill (stacks with the kill score)
- `bestMineScore` in the store tracks the all-time high.

---

## 5. Technical Implementation

### Key files

| File | Role |
|---|---|
| `src/engine/mining.ts` | Pure rules engine — map gen, movement, strike, spells, monsters, boons, descent |
| `src/engine/crawl.ts` | Shared BFS, camera, stamina formula, timing constants, status effects, runes |
| `src/engine/crawlBiomes.ts` | Band definitions and `bandForFloor()` lookup |
| `src/content/mining.ts` | Ore and monster data tables (`MINE_ORES`, `MINE_MONSTERS`, `MINE_GUARDIAN_FLOORS`) |
| `src/content/boons.ts` | Boon definitions, effect reducers, `rollBoonChoices` |
| `src/hooks/useMiningLoop.ts` | `requestAnimationFrame` input loop — fires store actions on timing thresholds |
| `src/views/MiningView.tsx` | Lobby screen (entry point, floor/score display) |
| `src/components/mining/MineRunOverlay.tsx` | Full run renderer (~955 lines) — camera, tiles, VFX, HUD, overlays |
| `src/components/mining/MineControls.tsx` | Touch D-pad + Mine/Dash buttons |
| `src/store/useGameStore.ts` | Zustand store — owns `mining: MineState | null`, all mine actions |
| `src/lib/minigameArt.ts` | Sprite registry — `mineRockSprite`, `mineFloorTile`, `mineOreSprite` |
| `src/engine/__tests__/mining.test.ts` | Vitest unit tests |

### Important functions

**`generateMine(floor, snapshot, rng)`** (`mining.ts:335`)
Ten-step procedural generation: all-bedrock fill → multi-walker drunk-walk carve (~45% open) → BFS reachability filter → shaft placement (farthest BFS cell) → rock clusters → ore clusters → energy gems → monsters → optional guardian → optional boon cache.

**`tryMove(state, dir)`** (`mining.ts:698`)
Facings update unconditionally; position only updates if the target cell is walkable and unoccupied.

**`tryDash(state, dir, nowMs)`** (`mining.ts:715`)
Prefers 2-cell dash; falls back to 1. Sets `lastDashMs` and `lastHitAtMs` for cooldown + i-frame.

**`strike(state, rng, nowMs, charged)`** (`mining.ts:794`)
Auto-dispatches to monster attack or tile mining based on what occupies the faced cell. Handles charged multiplier, stamina cost, `killMonster` on zero HP, and ore yield via `oreYield`.

**`killMonster(state, mon, rng)`** (`mining.ts:749`)
Drops loot, increments `killsThisFloor` and `score`, and — if the monster is a guardian — pauses the run with `status: 'choosing'` and calls `rollBoonChoices`.

**`stepMonsters(state, nowMs, rng, coPlayers)`** (`mining.ts:1126`)
Main tick function: stamina/MP regen → DoT ticks → BFS flow field → move each monster → contact damage + i-frame → ring-of-fire pulses → rune triggers → prune statuses.

**`castSpell(state, spellKey, nowMs, rng)`** (`mining.ts:898`)
Dispatches by `spell.mechanic` / `spell.school` to one of: rune placement, ring-of-fire, teleport, damage-to-nearest, heal, or illusion-debuff.

**`descend(state, rng)`** (`mining.ts:678`)
Generates the next floor from `mineSnapshot(state)`, carrying HP/sta/mp/haul/boons forward. Stamina and MP are partially refilled (+25% of max).

**`applyBoonChoice(state, key)`** (`mining.ts:1339`)
Appends the chosen boon key to `activeBoons`, clears `pendingBoonChoice`, restores `status: 'active'`, and immediately recomputes `moveIntervalMs`/`dashCooldownMs` so speed boons apply on the current floor.

### State management
All mutable state lives in the Zustand store (`useGameStore.ts`). The `mining` field holds the entire `MineState | null`. Every action (`mineMove`, `mineStrike`, `mineTick`, etc.) calls a pure engine function and writes the returned new state back to the store. The `useMiningLoop` hook only decides *when* to call which store action; it owns no game state itself.

### Real-time loop (`useMiningLoop.ts`)
A single `requestAnimationFrame` callback tracks three independent timers:
- Movement: fires `mineMove` or `mineDash` when the held-key timer exceeds `moveIntervalMs`.
- Strike/charge: fires `mineStrike` or `mineStrikeCharged` on the 240 ms swing interval; charge is counted in swing intervals.
- Monster tick: fires `mineTick` every 120 ms.

The hook is purely imperative — no state, no effects, no context. Co-op role detection (`isHost`) determines whether `mineTick` or `coopClientTick` is called.

### Map generation seeding
`beginMining` uses `mulberry32(Date.now())` as the RNG seed. Each floor uses `mulberry32(floorSeed(baseSeed, floor))` so floors are deterministically reproducible given the same base seed. This is used for co-op parity (both clients generate the same map).

### Persistence
- `mining: MineState | null` is in the persisted Zustand store (localStorage). A mid-run save is implicitly preserved on page refresh.
- `deepestMineFloor` and `bestMineScore` are top-level store fields that survive between sessions.
- Run state is cleared (set to `null`) after `endMining()` resolves.

### Co-op architecture
The host runs `stepMonsters` (authoritative). Guests run `coopClientStep` (local HP/regen/contact only). Tile sync: `coopApplyRemoteTile` for mined cells. Monster positions: `coopApplyRemoteSlice`. Remote attacks: `coopDamageMonster` → `damageMonsterById` on the host. Floor descent is host-only.

### Configuration constants (spread across files)
| Constant | Value | Location |
|---|---|---|
| `MINE_ENERGY_COST` | 2 | `mining.ts` |
| `MINE_DEATH_KEEP` | 0.5 (50%) | `mining.ts` |
| `MINE_IFRAME_MS` | 800 ms | `mining.ts` |
| `ENERGY_GEM_INTERVAL` | 80 cells | `mining.ts` |
| `SPELL_CD_MS` | 500 ms | `mining.ts` |
| `CHARGE_DAMAGE_MULT` | 1.75 | `crawl.ts` |
| `CHARGE_SWING_COUNT` | 2 | `crawl.ts` |
| `DASH_BASE_CD_MS` | 2000 ms | `crawl.ts` |
| `STAGGER_MS` | 500 ms | `crawl.ts` |
| `STA_REGEN_MS` | 1200 ms | `crawl.ts` |
| `MP_REGEN_MS` | 2000 ms | `crawl.ts` |
| `RING_DURATION_MS` | 8000 ms | `crawl.ts` |
| `GUARDIAN_SCORE_BONUS` | 500 | `mining.ts` |
| `MINE_BASE_ROWS/COLS` | 33×33 | `mining.ts` |
| `MINE_MAX_ROWS/COLS` | 57×57 | `mining.ts` |

---

## 6. Software, Libraries, and Tools Used

- **Language**: TypeScript (strict mode, Vite bundler)
- **Framework**: React 18 — all UI components are functional React components
- **State management**: Zustand with `persist` middleware (localStorage serialization)
- **Build / dev server**: Vite
- **Rendering**: Pure DOM / CSS. There is no canvas or WebGL. Tiles are `<div>` elements with CSS background-color, box-shadow, and gradient styling. Sprites fall back to CSS glyphs when PNG assets are absent.
- **Animations**: CSS keyframe animations (`@keyframes` in `src/index.css`), applied via Tailwind utility class strings computed in the component.
- **Styling**: Tailwind CSS for layout and utility classes; `cn.ts` (`clsx`+`tailwind-merge`) for conditional class composition.
- **Physics/collision**: None. All collision is grid-based and rule-checked in pure TypeScript functions.
- **Audio**: `src/lib/sfx.ts` — Web Audio API wrapper. Sound effects are played from the store actions and hooks. No background music for the mine (not confirmed from current files).
- **Asset pipeline**: Vite asset imports. Sprites referenced by key via `src/lib/minigameArt.ts`; actual PNG files TBD.
- **Testing**: Vitest (`src/engine/__tests__/mining.test.ts`)
- **Third-party libraries**: No game-specific third-party libraries. Standard npm ecosystem (React, Zustand, Tailwind, Vite, Vitest).

---

## 7. Assets and Presentation

### Tile rendering
All tiles are rendered as styled `<div>` elements in `MineRunOverlay.tsx`. Each tile type has a distinct visual treatment:
- **Floor**: Dark stone texture using CSS gradients; ~20% of cells have procedural crack, pebble, or speck decals derived from `(row × 17 + col × 31) % N` hash values.
- **Rock/bedrock**: Grayscale layered gradients with jagged edge shadows; band-tinted via `CrawlPalette.rock` RGB values.
- **Ore veins**: Color-coded CSS glow (`box-shadow`) per ore type; twinkle animation (`mine-sparkle`) on crystal/gem nodes.
- **Shaft**: Downward accent glow using `CrawlPalette.accent`.
- **Boon cache**: Gold `✦` glyph with ambient glow.
- **Runes**: `✦` symbols with per-kind color (fire = red, ice = cyan, poison = green).

### Sprite system
`src/lib/minigameArt.ts` maps tile/entity keys to art basenames:
- `mineRockSprite(r, c)` → one of `['boulder_1', 'boulder_2_jagged', 'boulder_3_brown']` (stable per-cell hash)
- `mineFloorTile(r, c)` → one of `['tile_cave_floor_1', 'tile_cave_floor_2']`
- `mineOreSprite(oreKey)` → e.g., `'iron_ore_1'`, `'cave_crystal_1'`, `'copper_ore_1'`

These feed an `<img>` overlay via the `image-pixel` CSS class (pixelated rendering) with a CSS fallback when the file is absent.

### VFX
- `mine-pop` (0.55 s): Destruction burst on rock/ore break (scale 0.9→2.1, fade out)
- `loot-float` (1.4 s): Rising text for gold/material pickups
- `mine-dust-fall` (6–11 s): Ambient falling dust particles
- `mine-sparkle` (4.5–7 s): Crystal vein twinkle
- `mine-torch-flicker` (3.2 s): Vignette light pulse simulating torch light
- `crawler-hit` (0.22 s): Red brightness flash on the player avatar when hit
- `crawl-wipe` (0.5 s): Full-viewport color wash on floor descent

### Atmosphere and mood
The overall style is dark roguelike dungeon — damp stone, flickering torch light, glowing ore veins. The visual polish is higher than placeholder (full animated vignette, dust motes, sparkles, hit flashes) but relies entirely on CSS/DOM rather than sprite art for most tiles.

---

## 8. Current Player Experience

### What works well
- **Pace feels active**: The 150 ms movement rate and 240 ms swing rate create a brisk, responsive feel. Mining through an ore cluster feels productive.
- **Auto-context strike is clever**: Not having to switch modes between mining and combat keeps flow high. Facing a monster automatically switches to weapon mode.
- **Charged swing adds a skill expression moment**: Holding for the charged hit against a tough monster (or a durability-3 rock) rewards patience with a satisfying one-shot.
- **Boon system creates run variety**: Even the small set of 7 boons creates noticeably different run archetypes (speed run, tank, ore farmer, etc.).
- **Layered visual atmosphere**: The torch vignette flicker, dust motes, ore sparkles, and band-specific ambient tints combine into a cohesive underground mood without any dedicated game-art sprites.
- **Progressive depth tension**: The mine gets visibly larger, faster, and harder as floors increase, which reads clearly even without explicit tutorials.

### What feels awkward or incomplete
- **No fog of war**: The full 11×11 viewport is always visible. Monster positions are always known, which removes discovery tension and makes pathfinding avoidance trivial once you're used to the monster speeds.
- **Spell targeting is fully automatic**: Spells snap to the nearest monster with no player input on direction or priority. This makes the spell system feel like a buff/debuff tool rather than an aiming mini-game, especially since rune placement is the only positional spell.
- **Boon cache pickup is silent**: Walking through a boon cache tile immediately triggers the choice panel with no lead-up — no glow animation, audio, or interstitial hint that something is about to happen.
- **No floor map or minimap**: The cave layout is large (up to 57×57) and fully opaque past the viewport. First-time players have no way to orient toward the shaft. Exploration is pure trial and error.
- **Haul tally is compact**: The HUD shows gold + material counts but does not show how much has been banked from prior runs, so it's hard to feel the incremental progress.
- **Death 50% loss feels steep without context**: There is no UI confirmation before the player dies that spells out how much they are about to lose. The death overlay shows the final haul but there's no "you lost X" comparison.

### Pacing
- Early floors (1–3) feel comfortable — rock durability 1, slow Cave Slugs, lots of open space. Good onboarding even without explicit tutorial.
- Mid floors (4–6) introduce faster enemies (Cave Spider at 400 ms cadence) and 2-swing rocks; this is where the dash becomes important.
- Floor 7 (Stone Golem, defense 6, 50 HP) is a noticeable spike. With a basic weapon and no boons, the Golem is a grind. Its weakness is ST, which the mine's Strength-flavored player should have, but this isn't communicated to the player.
- Floor 15 (Magma Colossus, 70 HP, 20 touch damage) may not be reachable for many players in practice because the run-wide resource budget (no healing other than spells and partial descent refill) is severely tested by floor 7–14 attrition.

---

## 9. Known Issues or Weak Points

1. **No fog of war**: The full viewport is always lit. Monster positions are fully visible at all times. This eliminates surprise encounters and much of the tension of a dungeon crawler.

2. **Single-use descent (no retreat)**: The shaft only goes down; there is no way to return to a previous floor. Combined with no mid-run healing beyond the +25% descent refill and rare support spells, the resource budget tightens irreversibly after floor 7.

3. **Boon cache pickup is non-interactive**: The `'boon'` tile triggers a pause immediately on step-through. There is no choice to decline, delay, or even a clear visual signal before the player walks onto it. A player mid-combat can accidentally trigger the choice overlay at the worst moment.

4. **Auto-targeting spells lack strategic depth**: All damage spells and illusion debuffs target `nearestMonster()` unconditionally. There is no way to prioritize a guardian, a frozen monster, or a specific threat. This removes tactical decision-making from spell use.

5. **Monster loot drop formula is opaque**: The kill-bounty calculation (`Math.round(swingsToKill / avgNodeDurability + killsThisFloor)`) is meaningful but invisible. Players have no feedback for why some kills drop more than others.

6. **No pickaxe upgrade path**: The `stone_pickaxe` is always auto-granted at run entry. There's no mechanic for bringing a better pickaxe or upgrading it mid-run, even though the gear system supports a `tool` slot. Higher-tier pickaxes presumably exist in the inventory system but the mine does not surface or use them.

7. **MineRunOverlay.tsx is ~955 lines**: The entire rendering, HUD, VFX, spell bar, touch controls, and overlay logic are co-located in a single large file. This is functional but makes iteration or debugging specific visual elements difficult.

8. **Guardian weakness not communicated**: Stone Golem is weak to ST; Magma Colossus to WI. There is no in-run bestiary, tooltip, or visual cue for this on the guardian encounter itself.

9. **Co-op is host-authoritative but trust-client on HP**: Each guest simulates its own HP locally. This is pragmatic but creates a gap between the host's world (which tracks monster positions authoritatively) and each client's self-reported health.

10. **No in-run tutorial or first-run hints**: `MiningView.tsx` shows milestone hints based on `deepestMineFloor`, but only on the lobby screen. There is no in-run guidance for new players encountering the shaft, boon cache, or charge mechanic for the first time.

11. **Score does not account for haul value**: The score formula is kill + descent based. A player who mines every ore vein without fighting gets no score credit. This misrepresents the quality of a "resource farmer" run.

12. **Energy gem placement is a separate generation pass**: Energy gems are placed in step 7 of `generateMine` from the remaining floor pool *after* ore and rock clusters are placed. Because step 7 iterates the full grid again (not `openFloor`), it can slightly overcount eligible cells. Low impact but slightly inconsistent with the rest of the algorithm.

---

## 10. Improvement Opportunities

**Gameplay depth**
- Introduce fog of war with a torch-radius visibility mechanic. This would immediately add exploration tension and make the Lantern boon (currently forest-only) relevant to the mine.
- Add manual spell targeting — e.g., targeting the faced cell or direction — to give spells strategic use beyond "blast nearest."
- Add a retreat staircase / rope mechanic to allow returning to higher floors, giving resource management a more interesting shape.
- Surface the pickaxe upgrade path: let the player equip better tools that affect mining speed and power, making gear progression feel impactful in the mine.

**Feedback and communication**
- Add a bestiary popup or small tooltip on first encounter with a new monster type, showing weaknesses.
- Replace the passive boon-cache step-through with an explicit interaction (press a button to open the chest). This prevents accidental boon choices mid-combat and adds a satisfying "open treasure" moment.
- Show a "haul loss on death" warning that displays how much gold/materials would be lost before the player leaves the death overlay.
- Add a mini-map or a simple directional indicator pointing toward the shaft.

**Difficulty curve**
- Smooth the floor 7 spike: the Stone Golem's 50 HP / defense 6 is a significant wall. Consider a floor 6 "mini-boss" or a brief grace period between the Rocky band endpoint and the Frozen Depths monster pool.
- Add a healing item that can be found in the mine (rare chest, not energy gem) to give the resource economy more room.

**Scoring**
- Include ore yield value in the score calculation so resource-focused runs register differently from combat-focused ones.

**Visual/audio**
- Add biome-specific ambient audio (dripping water, wind, lava crackling) for each band.
- Animate the boon cache tile with a pulsing glow before it is collected.
- Add a distinct visual state to the shaft tile (not just the accent glow) so first-time players can identify it as the floor exit.

**Code**
- Split `MineRunOverlay.tsx` into sub-components: tile renderer, HUD bar, overlay panels (boon choice, death, banking), and VFX layer.
- The `energy_gem` ore entry sets `weight: 0`, relying on a separate generation step. This is implicit; documenting why (it uses a different density formula) or extracting it as a named constant would help future contributors.

---

## 11. Questions and Unknowns

1. **Does the pickaxe slot use player-equipped tools?** `beginMining` auto-grants a `stone_pickaxe` unconditionally. Is this intentional (the mine always gives you one) or a placeholder? If higher-tier pickaxes exist in the inventory, is there a plan to let the player bring them into the mine?

2. **What triggers sound effects and when?** The analysis found `src/lib/sfx.ts` but did not trace every SFX call site inside the mine actions and overlay. It is unclear which events currently have audio (swing, hit, descent, boon pickup, death) and which are silent.

3. **Is fog of war planned or consciously excluded?** The forest crawler has a `sightBonus` boon slot (`lantern`) which implies fog of war exists or is planned for it. The mine has no fog-related fields in `MineState` or rendering logic in `MineRunOverlay`. Is this a deliberate design choice for the mine?

4. **What happens to boon caches if the player skips them?** The boon tile stays on the map. If the player descends without walking over it, the boon is lost. Is this intentional, and is it communicated to the player?

5. **How does the store handle an in-progress mining run on page load?** `mining: MineState | null` is persisted. If the page closes mid-run, the active run state is preserved. Does `useMiningLoop` handle restoring an active run on mount, or does it require the player to manually resume?

6. **Are there plans for more guardian floors beyond floor 15?** The `MINE_GUARDIAN_FLOORS` map has only floors 7 and 15. The Magma Core band is open-ended (`depthMax: Infinity`). Is there a planned floor 23 or similar, or does the mine currently soft-cap meaningful progression at floor 15?

7. **How is the haul persisted to the character economy?** `endMining()` calls something that adds the haul to character inventory, but the exact merge path into the character's material stocks was not fully traced. Is there a cap or filter on what materials the mine can output?

8. **What stat drives `pickaxePower` on the snapshot?** In `strike()`, mining power is `pickaxePower + floor(meleePower / 8)`. But `pickaxePower` itself on the snapshot comes from the character. What character stat or item property determines the base `pickaxePower` value?

9. **Is the `overcharge` boon fully integrated into the loop hook?** `boonChargeReduce` is exported from `boons.ts` and the boon definition exists. It needs to be consumed in `useMiningLoop.ts` where `CHARGE_SWING_COUNT` is compared. This should be verified as wired up correctly.

10. **Are the CSS sprite imports (`image-pixel`) actually loading PNG assets?** `minigameArt.ts` maps keys to art basenames, but there is no confirmation that corresponding PNG files exist in the asset pipeline. The overlay presumably renders the CSS fallback (glyph + gradient) in the current build.
