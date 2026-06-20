# Dungeon Delve Minigame Analysis

*Last updated: 2026-06-20. Reflects the state after improvement Phases 1–4 plus the follow-up round: Run Buffs HUD, Event Variety, and Battle VFX.*

---

## 1. Basic Summary

Dungeon Delve is a turn-based roguelike minigame accessed from the Explore tab. The player spends 3 Energy to begin an **Endless Descent**: a sequence of floors, each structured as a small branching map of rooms. Completing all rooms on a floor unlocks a **Checkpoint** where the player chooses to safely exit with their banked loot, or push deeper for harder content and richer rewards. Every fifth floor a biome boss guards the descent into a new region. The run ends either by banking, by fleeing combat, or by death mid-floor (losing 75% of that floor's gold and all of its items).

Within the larger game, Dungeon Delve is the primary Energy sink, the main source of gold and crafting materials, and the way combat stats are trained. It gates on Level 3 and has progressive milestone unlocks (Merchants at floor 5, Elites at floor 8, Tier 3 relics at floor 10), giving it a long content ladder to climb. The character's deepest floor record is now surfaced on the Character screen's Records panel alongside the other minigame records. A lightweight run history (last 10 runs, shown on the entrance screen) makes past performance visible without leaving the dungeon tab.

---

## 2. Core Game Loop

### How a run starts

- Player opens Explore → Dungeon Delve.
- Gate: character level ≥ 3 (`DUNGEON_UNLOCK_LEVEL`) and energy ≥ 3 (`DUNGEON_ENERGY_COST`, `src/engine/dungeon.ts:11`).
- Store deducts 3 energy and calls `startDungeon()` (`src/store/useGameStore.ts`).
- Player HP/MP/Sta are set to full from `fighterFor()` (includes equipped gear + class bonuses).
- Floor 1 map is generated; the player sees the first path choice.

### What the player repeatedly does

On each floor:

1. **Choose a path** — the floor map shows the branching DAG of rooms with visible edge lines connecting nodes between layers; the player taps a highlighted (gold-glowing) node.
2. **Resolve the room** — room type determines the interaction (see Section 4). Combat requires play; other rooms present choices or auto-resolve.
3. **Advance** — after resolving, the room's outgoing edges become the new path choices. The player proceeds through 3 layers (typically 5–8 rooms total visible, 2–3 selected).
4. **Reach the checkpoint** — after the final (terminal) layer, the player is presented with the checkpoint decision.

Each room entry triggers a brief 0.18 s ease-out fade-in animation on the room content panel, signaling the state change visually.

### Checkpoint decision (repeated each floor)

- **Rest (−0 boon, +40% max HP)** then descend.
- **Press On (boon offer, keep wounds)** then descend.
- **Bank & Leave** — end the run safely, keeping all banked loot.

After descending, depth increments, a new biome map is generated if a region boundary was crossed, and the cycle repeats.

### How challenge is introduced

- HP carries between rooms and between floors (attrition). MP and Sta reset at each checkpoint.
- Enemy stats scale with depth via the biome's base values plus a multiplier (`1 + (depth−1) × 0.1 + (level−1) × 0.06` for bosses, `src/engine/biomes.ts`).
- Treasure room probability rises with depth (`0.4 + depth × 0.05`, `src/engine/dungeon.ts:87`) — deeper floors are both harder and more rewarding.
- Merchant, Elite, and Tier 3 relic rooms are locked behind the deepest floor record.
- Merchant prices scale linearly with depth.

### How the run ends

| Condition | Outcome |
|-----------|---------|
| Player clicks Bank & Leave at a checkpoint | `cleared = true`; all banked loot collected |
| Player flees combat | `cleared = false`; banked loot kept; floor loot kept fully (keepFactor = 1) |
| Player dies (combat or encounter HP drain) | `cleared = false`; banked loot kept; 25% of floor loot kept (the rest is forfeit) |

The entrance screen and checkpoint footnote both explicitly state the flee-vs-death distinction: *"Dying on the next floor forfeits 75% of its gold and all its items — fleeing always keeps everything."*

After any end state, the player sees a summary screen and clicks **Collect & Leave** to apply rewards. Each completed run is pushed to the `dungeonHistory` array (kept to last 10).

### Rewards

- Gold, crafting materials, items (spellbooks, potions), weapons, gear — all accumulated into `bankedReward`.
- No character XP from loot collection.
- Stat XP is granted during play: +10 XP to a stat on a successful encounter check, and combat wins train attack/HP stat XP.
- `deepestFloor` is updated on each successful `dungeonDescend()` call and persists across runs. It resets to 0 on character wipe.

---

## 3. Player Controls and Interaction

### Input

All interaction is click/tap. There is no keyboard navigation, no real-time component, and no held-key mechanics. The dungeon is entirely menu-driven.

### UI elements during a run

**HUD panel** (shown between rooms, hidden during active combat):
- Three resource bars — HP (green), MP (blue), Sta (amber) — each showing `value/max` numerically.
- Inline reward summary: "Banked: Xg · Y mat" and "This floor: …" in the same panel.
- RelicTray: a compact row of small sprite icons showing held boons/curses for the run, with title-tooltip on hover.
- **RunBuffs** (`src/components/dungeon/RunBuffs.tsx`): directly below the relic tray, a per-relic stat readout grouped into **BLESSINGS** and **CURSES**. Each relic row shows its crest icon, name, and signed effect tokens (e.g. "+3 ST", "DEF +4", "−15 HP"). Stat tokens are tinted by their stat color (`getStat(stat).color`). Empty groups are omitted. Shown in both the main HUD and the checkpoint panel.

**FloorMap** (`src/components/dungeon/FloorMap.tsx`): A layered grid of room node buttons, with an SVG overlay drawn behind the nodes that renders connection lines between them. Active connections (visited → choosable) render as solid gold lines; other connections render as dashed, dimmed lines. Choosable rooms glow gold; visited rooms show a checkmark badge; unreachable rooms are dimmed and disabled. A `Layer X of Y` label in the header shows floor progress. Room types are distinguished by Lucide icon and color. A hint text reads "Tap a glowing room to enter it."

**BattleScene** (`src/components/combat/BattleScene.tsx`): Shared combat component reused from the top-level boss battles. Renders a GBC/Pokémon-style framed battlefield: foe sprite upper-right on a raised shadow-platform, player sprite lower-left; foe info card (name, HP, statuses, telegraphed intent) upper-left; player info card (class, HP, MP, STA) lower-right. HP bars animate width transitions (400 ms ease) and shift green → amber → red at 50%/20% thresholds. CSS keyframe animations (`battle-lunge-foe/player`, `battle-hit`, `battle-floater`, `battle-spell`, `battle-faint-foe/player`) are triggered by a diff `useEffect` that classifies each turn (player melee → lunge + foe shake + floating "−N" damage number; foe attacks → foe lunge + player shake + floater; spell cast → projectile sprite instead of lunge). Sprites idle-bob continuously (`battle-idle`, staggered delays). All motion animations use Tailwind's `motion-safe:` variant so they degrade gracefully when `prefers-reduced-motion: reduce` is set. Boss death triggers `battle-faint-foe`; player defeat triggers `battle-faint-player`.

**EncounterRoom** (inline in `src/views/DungeonView.tsx`): Shows a `SceneArt` banner, then a separately labeled outcome callout (color-coded: red border for fail, gold border for success, neutral for no check) above the next narrative node's text and choices. Each choice button includes a stat badge showing the relevant stat level and success odds (`STAT X · ~Y%`). The outcome callout has a small header label ("Outcome — success", "Outcome — failure", "Outcome") so it is visually distinct from the prompt text that follows. Gated choices (those with `requires` conditions not met by the current run state) are rendered as disabled buttons with a small lock hint ("Need 30 HP", "Floor 6+ only"); choices that will grant a boon or curse show a badge (✦ Boon, ✦ Boon on success, ⚠ Curse on fail).

**ShrineRoom** (`src/components/dungeon/ShrineRoom.tsx`): Three buttons — Pray (shows `~X%` success odds based on best WI/CH), Offer (costs 25% max HP, disabled if HP too low), Leave.

**MerchantRoom** (`src/components/dungeon/MerchantRoom.tsx`): Lists up to 3 offers with costs; unaffordable offers are disabled. Shows player's current gold. A "Move on →" button leaves without buying.

**RestRoom** (`src/components/dungeon/RestRoom.tsx`): When HP < max, shows "Rest and recover (+N HP)" and "Attune to the deep (a minor boon)" buttons. When HP is already full, the "Rest" option is replaced by an informational panel reading *"Fully healed — attune to the deep instead."* so the player is never silently forced toward the boon option.

**BoonChoice** (`src/components/dungeon/BoonChoice.tsx`): Non-dismissable modal with 1–3 relic cards. Each card shows a sprite icon, name, tier badge, and description. Appears over any room UI when `pendingBoon` is set.

**Checkpoint screen**: HP bar, RelicTray, banked reward summary, and three buttons (Rest/Press On/Bank). The `--biome-tint` CSS variable is set on the checkpoint container, so the `SceneArt` checkpoint banner carries the current biome's palette tint.

**Run-end screen**: Success or failure headline, a description of how far the player got (including whether death or retreat), banked spoils list, and a Collect & Leave button.

### Entrance screen

The entrance screen shows the scene banner, a rules summary, energy cost, a "Deepest descent" row with `deepestFloor` and the next milestone hint, and a **Recent Runs** panel (when any runs exist). The Recent Runs panel lists up to 5 of the last 10 completed runs, each showing outcome (Banked in green, Fled in muted grey, Fallen in ember), floor reached, and ISO date. Run history is stored as `dungeonHistory: DungeonRunSummary[]` in the store and populated by `collectDungeon()`.

### Player feedback

- Stat check odds are computed and displayed before a choice is made.
- Encounter outcomes (success/fail text) are shown in dedicated colored callout panels with labeled headers, visually separated from the next choice prompt.
- Boss floors are flagged on the checkpoint "Press On" button: "Press On (Boss!) — take a boon".
- Milestone hint on the entrance screen tells the player exactly what floor unlocks the next feature.
- Recent Runs panel on the entrance screen shows the last 5 run outcomes with floor and date.
- The flee-vs-death loot distinction is stated explicitly in both the entrance description and the checkpoint footnote.
- Each room entry fades in (0.18 s ease-out) to signal the transition.
- When HP is full at a rest room, the player sees a message instead of a disabled button.

---

## 4. Mechanics and Systems

### Floor map structure

Each floor is a small **layered DAG** generated by `generateFloorMap()` (`src/engine/dungeonMap.ts:66`).

- Normal floor: 3 layers with widths 2–3, 2–3, 1–2 nodes respectively.
- Boss floor (depth % 5 === 0): 2 layers — 2 lead-in nodes → 1 boss node.
- Edges wire consecutively between layers; a 45% chance per node adds a second edge to an adjacent next-layer node.
- At least one combat room is guaranteed per normal floor.
- Terminal nodes (last layer) have empty `to[]` arrays and lead to the checkpoint.

Room type is selected by weighted random from `normalKindWeights()` (`src/engine/dungeonMap.ts:47`):

| Room type | Base weight | Gate |
|-----------|------------|------|
| combat | 5 | always |
| encounter | 3.5 | always |
| treasure | 2 | always |
| shrine | 1.6 | always |
| rest | 1.4 | always |
| merchant | 1.3 | deepest ≥ 5 |
| elite | 1.6 | deepest ≥ 8 |

### Room types and resolution

**Combat / Elite / Boss**: Calls `createBattle()` and passes to the shared combat engine. HP/MP/Sta are carried into the battle via `battle.startingHp/Mp/Sta`. After resolution, run resources are updated from `battle.playerHp/Mp/Sta`. Elite wins grant a bonus boon offer in addition to floor loot. Boss fights can have multiple phases (indicated by PhasePips). Boss biome phases have full movesets (weighted attack, heavy, guard, drain, inflict, enrage, multi) defined in `src/content/biomes.ts`.

**Encounter**: A branching text event. Choices may have a stat check (`checkChance(power, difficulty)` = `min(0.95, max(0.15, 0.3 + (power − difficulty) × 0.07))`). The minimum was raised from 0.05 → 0.15 to prevent fresh characters (stat level ~1) from near-auto-failing early Catacomb events. Success/failure routes to different subsequent nodes. Resource deltas (HP/MP/Sta/gold/materials) and their numerical magnitudes are always displayed in a colored outcome badge (e.g. "−8 HP", "+30 gold") so the player sees the exact cost/gain of every outcome. Choices may additionally carry `hpOnFail`, `mpOnFail`, or `staOnFail` penalties.

Encounter choices now support three additional mechanics:

- **Gated choices** (`requires?: { minHp?, minMp?, minSta?, minDepth?, hasRelic? }`): a choice is only available when the run's current resources meet the requirement. The pure predicate `choiceAvailable(choice, ctx)` (exported from `encounters.ts`) is checked by the UI (disables the button + shows a hint) and defensively in the engine. Examples: a wounded-only passage, a depth-gated shortcut, a relic-required door.
- **Boon grants** (`boon?: number` / `boonOnSuccess?: number`): the engine signals `step.grantBoonTier`; the slice calls `offerBoon(run, tier)`, which activates the global `<BoonChoice/>` modal — the same flow as shrines and elite wins. Zero new UI required.
- **Curse grants** (`curseOnFail?: boolean`): the engine signals `step.grantCurse`; the slice calls `rollCurse()` and appends to `run.relics`, mirroring the shrine-fail path (including `maxHp` recomputation via `fighterFor`).

Encounters are drawn from the current biome's encounter pool. There are 28 unique encounter definitions (18 original + 10 new). The Ruins and Frozen pools were expanded from 5 to 10:

| Biome | Pool size | Encounters |
|-------|-----------|-----------|
| Catacombs | 10 | sealed_door, gatekeeper, bone_pit, ossuary_hoard, whispering_crypt, ancient_cache, dust_and_echoes, crumbling_fresco, bone_chimes, fallen_pilgrim |
| Ruins | 10 | collapsing_bridge, wild_grove, gatekeeper, toppled_idol, spiders_larder, **ruined_scriptorium, vine_temple, overgrown_arsenal, riverside_shrine, fungal_network** |
| Frozen | 10 | frozen_chasm, starving_dark, sealed_door, buried_caravan, aurora_pool, **ice_sculptor, whiteout, frozen_titan, cold_archive, glacial_hermit** |

New encounters include gamble events (large reward on success, steep HP loss on fail), boon-granting successes (`boonOnSuccess`), curse-on-fail paths, and depth-gated locked branches (`requires: { minDepth: 6 }`).

**Treasure**: Loot is generated on room entry via `resolveTreasure(depth, rng)` (`src/engine/dungeon.ts:110`). Gold: `60 + depth×10 + rand(0..40)`. Always 1–2 crafting materials + crystals. 50% spellbook drop. Weapon drop chance scales with depth. No player action required; "Continue" advances immediately.

**Shrine**: Three choices: Pray (WI/CH vs. difficulty 6 → boon or curse), Offer (−25% max HP, guaranteed boon, disabled if HP ≤ cost), Leave (no effect).

**Merchant**: Three fixed offers per visit, priced by depth: heal (+40% HP, cost `18 + depth×4`), healing potion (cost `24 + depth×5`), random relic boon (cost `45 + depth×9`). Bought with character gold (persists out of the run).

**Rest**: Heal (+40% max HP) or Fortify (tier-1 boon via `rollBoons(3, relics, 1, rng)`). The rest option is hidden (replaced by an informational message) when HP is already full.

### HP attrition

HP is the run's primary attrition currency. It carries between every room and every floor. MP and Sta reset to full at each checkpoint (the "Rest" option at checkpoint also recovers 40% max HP). Discrete drops (items, weapons, gear) are all-or-nothing on death — only gold and materials are partially kept (25%).

### Relics (run-only modifiers)

Relics are collected as boons (positive) or curses (negative, from failed shrine checks). Defined in `src/content/relics.ts`. Each relic carries `statBonuses`, `defense`, `ward`, and/or `maxHp` effects. The catalog currently has 28 entries: 23 boons across three tiers, and 5 curses.

| Tier | Count | Examples |
|------|-------|---------|
| 1 (common) | 10 | Single stat +3, padded_jerkin (+2 Def), runed_band (+2 Ward), vital_charm (+15 HP) |
| 2 (uncommon) | 8 | Dual-stat combos, aegis_charm (+3 Def +3 Ward), windrunner_sash (+4 AG +2 EN) |
| 3 (rare) | 5 | dragon_scale (+4 Def +4 Ward +20 HP), worldroot_heart (+5 EN +3 WI +20 HP) |
| Curses | 5 | −3 EN, −3 AG, −15 HP, −3 ST, −3 KN |

Relics are aggregated via `aggregateRelics()` and folded into `fighterFor()` — the same stat-aggregation pipeline used for equipped gear. Acquiring a `maxHp` relic instantly recalculates max HP and grants the difference as current HP.

Boon tiers gate on deepest floor reached: Tier 1 always; Tier 2 from depth 4; Tier 3 from depth 10.

### Biomes

`biomeForDepth(depth)` cycles through `BIOME_ORDER` with one region per 5 floors. Each biome has an enemy pool, an encounter pool, a boss definition, and a `tint` hex color. Defined in `src/engine/biomes.ts`; catalog data in `src/content/biomes.ts`.

| Biome | Tint | Enemy pool | Boss |
|-------|------|-----------|------|
| The Catacombs | `#4a3a55` (deep purple) | skeleton, wisp, ghoul | The Bone Tyrant (2-phase) |
| The Overgrown Ruins | `#2f5a3a` (forest green) | goblin, giant_spider, dire_wolf, thornling | The Vinewood Ancient (2-phase) |
| The Frozen Caverns | `#33586b` (ice blue) | stone_sentry, frost_revenant, ice_elemental | The Frost Warden (3-phase) |

The biome `tint` is applied visually: both the checkpoint container and the active-run container set `--biome-tint: biome.tint` as a CSS custom property, which `SceneArt` reads via a 22%-opacity overlay on every scene banner within that subtree. This gives each region a distinct ambient palette.

### Win and loss conditions

- **Win**: No single "win" state. The run ends safely when the player banks.
- **Loss**: Death mid-floor (HP ≤ 0 in combat or encounter). Forfeits 75% of the current floor's gold and materials; drops all discrete items from that floor.
- **Escape**: Fleeing combat ends the run immediately, keeping 100% of all loot gathered so far.
- `deepestFloor` is updated on each successful `dungeonDescend()` call and persists across runs. It resets correctly to 0 on `resetGame()` (character wipe).

### Stat XP and progression

| Event | XP granted |
|-------|-----------|
| Successful encounter stat check | +10 to the checked stat |
| Combat win | Attack stat + HP stat XP (60%/40% split of `combatXpForWin(bossMaxHp)`) |

No XP is granted on loot collection. Dungeon does not interact with the level-up boss gate.

### Run history

Each completed run (when the player clicks "Collect & Leave") appends a `DungeonRunSummary` to `dungeonHistory` in the store. The summary captures `depth` (floor reached), `cleared` (true if banked), `defeated` (true if combat death), and `date` (ISO date string). The array is capped at 10 entries (oldest evicted). It persists to localStorage and resets to `[]` on character wipe.

### Randomization and determinism

All generation functions (`generateFloorMap`, `resolveTreasure`, `rollBoons`, etc.) accept an injected `RNG` parameter, making them deterministic for a given seed. In production, `Math.random` is passed. This enables unit testing with fixed seeds.

---

## 5. Technical Implementation

### File map

| File | Role |
|------|------|
| `src/engine/dungeon.ts` | Core types (`RoomKind`, `DungeonRoom`), room metadata, floor/loot generation, reward merge/scale utilities. `DUNGEON_ENERGY_COST = 3`, `FLOOR_LOSS_KEEP = 0.25`. `encounterRoomFor()` exported here for use by `dungeonMap.ts`. |
| `src/engine/dungeonMap.ts` | Layered DAG floor map generator. `MapNode`, `FloorMap` types. `generateFloorMap()`. |
| `src/engine/dungeonTypes.ts` | Extracted `DungeonRun` interface — standalone types file so engine tests can import it without pulling in the Zustand store. |
| `src/engine/biomes.ts` | Biome definitions and `biomeForDepth()`, `bossFor()`, `isBossDepth()`. |
| `src/engine/encounters.ts` | `EncounterDef`/`EncounterNode`/`EncounterChoice` types, `chooseEncounter()` stat-check resolution, `checkChance()`, `choiceAvailable()`, `ChoiceGateCtx`. Choices support `requires`, `boon`, `boonOnSuccess`, `curseOnFail`; steps support `grantBoonTier`, `grantCurse`. |
| `src/engine/relics.ts` | `RelicDef` type, `rollBoons()`, `rollCurse()`, `aggregateRelics()`, `boonMaxTier()`. |
| `src/engine/combat.ts` | Shared combat engine used for all dungeon battles. `BattleState.lastAction` (new structured field) is written by `playerAction` on every turn to enable reliable spell VFX detection. |
| `src/store/useGameStore.ts` | ~15 dungeon store actions. `DungeonRun` imported from `src/engine/dungeonTypes.ts`. `deepestFloor` and `dungeonHistory` are the two persistent dungeon records. Exports `DungeonRunSummary` type. |
| `src/views/ExploreView.tsx` | Hosts `DungeonErrorBoundary` (class component) wrapping `<DungeonView />`. Any render crash in the dungeon shows a "Back to Explore" recovery screen instead of blanking the app. |
| `src/views/DungeonView.tsx` | Top-level dungeon view. Renders all dungeon states (entrance, run, checkpoint, end). Entrance shows "Deepest descent" row and "Recent Runs" panel from `dungeonHistory`. Sets `--biome-tint` CSS variable on checkpoint and active-run containers. Wraps room content in a `key={nodeId}` div for fade-in animation. Hosts `EncounterRoom`, `PhasePips`, `RewardLine`, `RewardInline`, `RunGauge` inline sub-components. |
| `src/views/CharacterView.tsx` | Character screen. Records panel now includes a "Dungeon Delve / Floor N" row alongside mine, forest, arena, and tactics records. Reads `deepestFloor` from the store. |
| `src/components/dungeon/FloorMap.tsx` | Layered node grid for path selection. Renders connection lines between nodes via a `useLayoutEffect`-driven SVG overlay (active edges gold solid; inactive edges gold dashed). Shows `Layer X of Y` progress label. |
| `src/components/dungeon/BoonChoice.tsx` | Non-dismissable modal for 1-of-3 relic selection. |
| `src/components/dungeon/RelicTray.tsx` | Compact relic icon row shown in HUD. |
| `src/components/dungeon/RunBuffs.tsx` | Per-relic stat readout (Blessings / Curses) shown in HUD and checkpoint, below RelicTray. |
| `src/components/dungeon/ShrineRoom.tsx` | Shrine interaction UI. |
| `src/components/dungeon/MerchantRoom.tsx` | Merchant shop UI. |
| `src/components/dungeon/RestRoom.tsx` | Campfire rest/attune UI. Replaces the "Rest" button with an informational message when HP is full. |
| `src/components/combat/BattleScene.tsx` | Shared combat component (not dungeon-specific). |
| `src/components/ui/SceneArt.tsx` | Scene art component. Wraps the `<img>` in a `<div>` with an overlay `<div>` that reads `var(--biome-tint, transparent)` at 22% opacity. |
| `src/lib/scenes.ts` | Scene art config — all room types (including `room:shrine`, `room:merchant`, `room:elite`) are registered with glyphs, tint colors, and captions. No fallback `❓` for any active room type. |
| `src/content/biomes.ts` | `BIOMES` catalog and `BIOME_ORDER`. All three pools are now 10 encounter keys. |
| `src/content/relics.ts` | `RELICS` catalog — 28 entries (23 boons across 3 tiers, 5 curses). |
| `src/content/encounters.ts` | `ENCOUNTERS` catalog — 28 unique encounter definitions (18 original + 10 new for Ruins/Frozen). Uses `requires`, `boon/boonOnSuccess/curseOnFail` fields; `EncounterRunState` carries `lastDeltas` for surfacing exact penalty/reward numbers. |
| `src/engine/__tests__/dungeon.test.ts` | Unit tests for floor generation, treasure scaling, reward utilities. |
| `src/engine/__tests__/dungeonMap.test.ts` | Unit tests for map structure, reachability, boss funnels, determinism. |
| `src/engine/__tests__/content.test.ts` | Validates that every biome encounter/enemy key resolves, every relic has required fields, and every scene key used by the dungeon is registered. |
| `src/store/__tests__/store.integration.test.ts` | Integration tests including persist version assertion. Currently at version 22. |

### Key functions

| Function | Location | What it does |
|----------|----------|--------------|
| `startDungeon()` | store | Gate check, energy deduction, fresh run initialization. |
| `dungeonChoosePath(nodeId)` | store | Sets the current node and calls `enterRoom()`. |
| `enterRoom(run, state)` | store (helper) | Populates room payload: spawns battle, starts encounter, generates loot, etc. |
| `dungeonAdvance()` | store | Resolves the just-completed room; calls `resolveCurrentNode()`. |
| `resolveCurrentNode(run, hp, mp, sta)` | store (helper) | Wires next path choices or sets `atCheckpoint = true`; partial MP regen (+15%). |
| `dungeonDescend(mode)` | store | Increments depth, regenerates floor map, resets MP/Sta, handles rest/pressOn. |
| `collectDungeon()` | store | Applies `bankedReward` to inventory; appends `DungeonRunSummary` to `dungeonHistory`; clears `dungeon: null`. |
| `finishRun(run, cleared, hp, keepFactor)` | store (helper) | Scales floor loot by factor, merges into banked, sets `status: 'ended'`. |
| `generateFloorMap(depth, biome, rng, opts)` | `dungeonMap.ts:66` | Builds the layered DAG for one floor. |
| `resolveTreasure(depth, rng)` | `dungeon.ts:110` | Generates gold + material + optional item/weapon reward for a treasure room. |
| `merchantOffers(depth)` | `dungeon.ts:101` | Returns the 3 fixed merchant offer objects for this depth. |
| `encounterRoomFor(biome, rng)` | `dungeon.ts:57` | Selects a random encounter key from the biome's pool; called by `dungeonMap.ts`. |
| `chooseEncounter(state, def, choiceIdx, statLevels, bonuses, rng)` | `encounters.ts` | Rolls stat check, branches narrative, applies deltas, returns new encounter state. |
| `rollBoons(count, owned, maxTier, rng)` | `relics.ts` | Draws up to `count` distinct non-owned boons of tier ≤ maxTier. |
| `aggregateRelics(defs)` | `relics.ts` | Sums relic stat/defense/ward/maxHp bonuses for `fighterFor()`. |
| `fighterFor(state, extraBuffs?)` | store / combat engine | Combines character stats + gear + relics into a combat-ready fighter. |

### State management

`DungeonRun` is defined in `src/engine/dungeonTypes.ts` and imported into the store. It is the single run object on `useGameStore`, either `null` (no active run) or a complete snapshot of the run state. Key fields:

- `depth`, `biomeKey` — current position.
- `map`, `nodeId`, `choices`, `path` — floor map navigation state.
- `hp/maxHp`, `mp/maxMp`, `sta/maxSta` — run resources.
- `bankedReward`, `floorReward` — loot buckets.
- `encounter`, `battle`, `roomLoot`, `merchant` — active room payload (only one is non-null at a time).
- `atCheckpoint`, `status`, `cleared` — run lifecycle flags.
- `relics`, `pendingBoon` — relic state.

`DungeonRunSummary` (`{ depth, cleared, defeated, date }`) is defined and exported from the store. It is not part of `DungeonRun` — it is only created by `collectDungeon()` and stored in `dungeonHistory`.

### Error resilience

`DungeonErrorBoundary` (class component in `src/views/ExploreView.tsx`) wraps `<DungeonView />`. If any render inside DungeonView throws — including from stale localStorage state with a missing encounter node or invalid map reference — the boundary catches it, logs to console, and shows a "Back to Explore" recovery screen. The outer app is never unmounted.

Two additional defensive null checks are in place:
- `EncounterRoom` (`DungeonView.tsx`): if `def.nodes[enc.nodeId]` is undefined, falls through to the "The passage is quiet / Continue Deeper" fallback.
- `FloorMap.tsx:128`: if `map.nodes[id]` is undefined for a layer entry, `return null` (skips the broken node without crashing).

### Save/load and migration

State persists via Zustand `persist` (localStorage) at **version 22**. New fields added in v22:

- `dungeonHistory: DungeonRunSummary[]` — backfills to `[]` in the migrate function; was `??` guarded in `dungeonHistory` subscriptions during the transition window.
- `deepestFloor: 0` — now included in `resetGame()`, fixing a bug where character wipes preserved the record and left merchant/elite/T3 rooms unlocked on the new run from the first floor.

`withCharacterDefaults` backfills missing character fields when loading old saves.

### Data flow summary

```
User tap → DungeonView dispatch → store action
  → pure engine function (dungeon.ts / encounters.ts / relics.ts)
  → new DungeonRun object written to store
  → React re-render picks up new state
```

No two-way data bindings or callbacks between the engine and the UI. The UI reads store state; the store drives engine calls.

---

## 6. Software, Libraries, and Tools Used

| Concern | Technology |
|---------|-----------|
| Framework | React 18 (functional components, hooks; error boundary uses class component) |
| Language | TypeScript |
| Build tool | Vite |
| State management | Zustand with `persist` middleware (version 22) |
| Styling | Tailwind CSS (utility classes; custom design tokens via `tailwind.config.js`) |
| Icons | Lucide React (all room type icons, resource bar icons) |
| Rendering | DOM/CSS (no canvas, no WebGL) |
| Animation | CSS `animate-fade-in` (0.18 s ease-out, defined in `tailwind.config.js` `keyframes`). Applied on room content wrapper via `key` prop churn. CSS `transition-all` on resource bar widths. No animation library. |
| Biome theming | CSS custom property `--biome-tint` set on dungeon containers; consumed by `SceneArt` overlay. |
| Physics/collision | None (menu-driven; no spatial simulation) |
| Audio | None |
| UI primitives | Custom `Panel`, `Button`, `Sprite`, `SceneArt`, `Modal` components in `src/components/ui/` |
| Art pipeline | Procedural SVG placeholders via `src/lib/placeholderArt.ts` and `src/lib/sprites.ts`; swap seam in `src/lib/scenes.ts` (`SCENE_REGISTRY` / `resolveSceneImage()`) for future real assets. Biome tint overlay added via CSS variable. |
| Persistence | `localStorage` via Zustand persist |
| Testing | Vitest (900+ tests; dungeon-specific coverage in `dungeon.test.ts`, `dungeonMap.test.ts`, `content.test.ts`) |

---

## 7. Assets and Presentation

### Scene art

Room backgrounds are rendered by `SceneArt` (`src/components/ui/SceneArt.tsx`). The component wraps its `<img>` in a `<div>` and overlays a second `<div>` with `backgroundColor: var(--biome-tint, transparent)` at 22% opacity. When the dungeon container sets `--biome-tint`, this overlay tints the scene banner with the current biome's palette. Outside the dungeon (or on screens that don't set the variable), the overlay is fully transparent and has no visible effect.

**Per-key themed motifs.** Each scene key now dispatches to a distinct procedural SVG composition via `sceneMotif(key)` in `src/lib/placeholderArt.ts` rather than the generic landscape placeholder. Every room type shows a recognizably different visual:

| Key | Motif |
|-----|-------|
| `dungeon:entrance` | Arched stone doorway with a glowing eye |
| `dungeon:checkpoint` | Tent peak + small campfire |
| `dungeon:cleared` | Crown silhouette with gem tips |
| `dungeon:retreat` | Flag on a pole |
| `room:combat` | Crossed blades |
| `room:boss` | Crossed blades + skull crown |
| `room:elite` | Crossed blades + flame crest |
| `room:encounter` | Open scroll + quill |
| `room:treasure` | Chest body + lid + stacked coin ellipses |
| `room:rest` | Campfire with log base + floating embers |
| `room:shrine` | Stepped altar + crystal triangle + light rays |
| `room:merchant` | Balance scales with pans |
| `room:elite` | Crossed blades + flame crest |
| `outcome:success` | 8-ray starburst + sparkles |
| `outcome:fail` | Cracked red X with radiating fissures |
| `outcome:partial` | Half-filled circle (quarter-pie) |
| `combat:victory` | Trophy cup |
| `combat:defeat` | Skull with eye sockets |
| `biome:catacombs` | Bone arch silhouettes + glowing eye-socket hints + scattered bones |
| `biome:ruins` | Broken columns with vine draped between them + cobblestone ground hint |
| `biome:frozen` | Ice spike cluster + faint aurora band + crystal sparkles |

**Outcome art in EncounterRoom.** The `SceneArt` banner at the top of each encounter flips dynamically after a choice resolves: `room:encounter` (scroll) while the player is choosing → `outcome:success` / `outcome:fail` / `outcome:partial` after resolution. This makes every encounter outcome immediately readable at a glance without reading the text.

All scene keys remain registered in `src/lib/scenes.ts`. There is a defined swap seam (`SCENE_REGISTRY` in `scenes.ts`, `resolveSceneImage()`) so real illustration assets can replace any key without component changes.

### Sprites

Relics use `Sprite` with procedurally generated crest art (`relicCrest()` from `src/lib/sprites.ts`). Room type icons in FloorMap are Lucide vector icons.

### Animations

- **Room transition**: 0.18 s ease-out fade-in on the room content wrapper, triggered by React key churn when `dungeon.nodeId` changes (`src/views/DungeonView.tsx`).
- **FloorMap edges**: SVG lines drawn via `useLayoutEffect`; active edges render as solid gold, inactive as dashed/dimmed.
- **Resource bars**: CSS `transition-all` for smooth width changes on MP/STA gauges.
- **HP bars (GBC)**: CSS `transition: width 400ms ease, background-color 400ms ease` on both battler HP bars; fill color shifts green→amber→red at 50%/20% thresholds.
- **Battle VFX** (`battle-*` keyframes in `src/index.css`):
  - `battle-idle` — both battlers bob gently (staggered, `motion-safe:` gated).
  - `battle-lunge-player` / `battle-lunge-foe` — diagonal lunge toward the foe/player on melee attacks.
  - `battle-hit` — struck target flashes bright + shakes laterally (brightness filter + translateX sequence).
  - `battle-floater` — `−N` damage number rises and fades over the struck battler (green `+N` for heals).
  - `battle-spell-sparks` — electric snap burst (⚡ Sparks, Chaotic Blink).
  - `battle-spell-firebolt` — expanding blaze that rises (🔥 Firebolt, Ring of Fire).
  - `battle-spell-mend` — healing glow that rises off the target on player (✨ Mend).
  - `battle-spell-bless` — ward shimmer pulsing outward (🛡 Bless, Teleport).
  - `battle-spell-dazzle` — starburst that flares and vanishes (💫 Dazzle).
  - `battle-spell-hex` — sinking violet curse (🔮 Hex).
  - `battle-spell-rune` — inscribed glyph that pulses then sinks (🔥/❄️/☠️ Rune spells).
  - Spell detection now uses `battle.lastAction` (a structured field on `BattleState` written by `playerAction` in `combat.ts`) instead of a log-string regex. Each spell action records `{ kind, spellKey, school, mechanic, target, amount }`. Support spells (`target: 'self'`) render their VFX on the player quadrant; damage/illusion spells render on the foe quadrant.
  - `battle-faint-foe` — foe flashes → shrinks → sinks → fades on defeat.
  - `battle-faint-player` — player tilts and sinks on defeat.
  - All motion effects respect `prefers-reduced-motion: reduce` via a CSS `[class*="battle-"] { animation: none !important }` media query guard. The `battle-spell-vfx` marker class on the VFX element is picked up by this selector.
- **Per-biome battle backgrounds** (`BattleScene.tsx`): the `biomeKey` prop (optional, forwarded from `DungeonView`) replaces the hardcoded brown gradient with a tint-derived gradient for each region (catacombs → purple-dark; ruins → forest-green-dark; frozen → ice-blue-dark). A faint procedural SVG motif layer (`scenePlaceholderImage` at 10% opacity, using the biome's existing `sceneMotif` case) adds silhouetted bone arches / vine-draped columns / ice spike clusters as a background texture. `BattleOverlay` (Level-Up Trials) passes no `biomeKey`, keeping the neutral default gradient.
- `sceneMotif` in `src/lib/placeholderArt.ts` now handles `biome:catacombs`, `biome:ruins`, and `biome:frozen` — bone arch silhouettes, broken columns with vines, and ice spike cluster respectively.

### Sound

None. No sound effects or music anywhere in the dungeon.

### Overall style

Fantasy RPG aesthetic. Color palette: parchment backgrounds, dark wood panels, gold accents, ember/red for danger, green for health, blue for magic. Each biome bleeds its palette into scene art via the tint overlay (purple for Catacombs, green for Ruins, blue-grey for Frozen). All room types have intentional placeholder art with matching glyphs and tints.

---

## 8. Current Player Experience

### What works well

- **Strategic checkpoint decision**: The Bank vs. Descend choice with explicit HP cost information creates genuine tension. The flee-vs-death loot rule is now clearly stated in both the entrance description and the checkpoint footnote.
- **Visible stat odds**: Encounter choice buttons show the exact success probability for stat checks before the player commits.
- **Attrition model**: HP carrying between rooms and floors creates accumulated risk. Discrete loot loss on death (vs. full retention on flee) creates a meaningful strategic pressure to know when to retreat.
- **Relic builds**: 28 relics across three tiers (23 boons, 5 curses) give each run meaningful variation. The Tier 3 pool includes high-synergy combos like `dragon_scale` and `worldroot_heart`. Acquiring a `maxHp` relic immediately heals the difference.
- **Readable floor map**: Room type icons, gold glow on choosable nodes, checkmarks on visited rooms, and SVG edge lines between nodes all give the branching structure a clear visual language. The `Layer X of Y` label shows progress without interrupting the flow.
- **Biome atmosphere**: The `--biome-tint` overlay tints every scene banner with the current region's palette. Catacombs reads purple, Ruins reads green, Frozen Caverns reads blue-grey — without any real illustration assets.
- **Room transitions**: The 0.18 s fade-in on each room entry provides a clear, unobtrusive state change signal.
- **Encounter pacing**: The last outcome is shown in a labeled, color-coded callout that is visually distinct from the next choice prompt, so the narrative reads as: *what just happened → what you face now*.
- **All room types have distinct art**: Each room type now shows its own themed procedural SVG motif (treasure → chest + coins, combat → crossed blades, shrine → altar + crystal, etc.) rather than a generic glyph-in-a-box. Outcome art also switches the encounter banner dynamically after each choice resolves (starburst on success, cracked X on failure, half-circle on neutral).
- **Explicit outcome deltas**: Every encounter outcome now shows numbered resource badges (e.g. "−8 HP", "+30 gold") so the player always knows exactly what a check cost or gained.
- **Early-game fairness**: `checkChance` minimum raised to 15% and 5 new low-difficulty Catacombs events added, so level-3 characters have a meaningful chance to succeed and see varied content rather than near-auto-failing everything.
- **GBC-style combat**: BattleScene rebuilt with a framed battlefield (foe upper-right, player lower-left), animated HP bars that drain with a color-coded CSS transition, diagonal lunge animations, hit-flash shake, damage floaters, and faint animations on defeat. Combat now reads as a spatial confrontation rather than a flat list.
- **Encounter content depth**: 28 unique encounter definitions; all three biome pools at 10 events, reducing repetition. New events include gambles, boon-granting shrines, depth-gated locked paths, and curse-on-fail traps.
- **Persistent buff readout**: The HUD shows each held relic's stat effects as signed per-stat tokens ("+3 ST", "DEF +4", "−15 HP"), grouped into Blessings and Curses below the relic icon tray. The player never has to tab away to understand how their current relics are affecting their stats.
- **Per-spell VFX**: Casting Sparks shows an electric snap, Firebolt an expanding blaze, Mend a green healing glow on the player, Dazzle a spinning starburst, Hex a sinking violet mote, and rune spells a pulsing glyph. Spell detection uses `battle.lastAction` (structured field on `BattleState`) instead of the previous brittle log-string regex — every spell now reliably triggers its VFX.
- **Per-biome battle backgrounds**: Dungeon battles show a biome-themed gradient (purple for Catacombs, dark green for Ruins, ice blue for Frozen) with a faint procedural silhouette overlay — bone arches, vine-draped columns, or ice spikes. Level-Up Trial battles keep the neutral default.
- **Milestone progression**: The `deepestFloor` gates for merchants, elites, and tier-3 relics give early runs a sense of discovery. The next milestone is always visible on the entrance screen.
- **Run history**: The entrance screen shows up to 5 recent runs (outcome, floor, date) so the player can track their progress between sessions without leaving the dungeon tab.
- **Cross-tab record**: `deepestFloor` is now visible on the Character screen's Records panel alongside mine, forest, arena, and tactics records — a player can see their dungeon progression without opening the Explore tab.
- **Error recovery**: An error boundary catches any render crash inside DungeonView and offers a "Back to Explore" escape instead of blanking the entire application.

### What remains rough or unfinished

- **All scene art is procedural SVG**: Every room type uses a placeholder glyph-in-a-box. The biome tint overlay differentiates regions, but room interiors are still visually anonymous.
- **No audio**: The dungeon is entirely silent — no sound effects for room entry, combat resolution, relic acquisition, or banking.
- **RelicTray tooltip-only**: Relic details are accessible only via title-tooltip on hover, which doesn't work on touch devices. No tap-to-expand behavior.
- **BoonChoice modal timing**: The non-dismissable modal can appear over any room UI mid-render, which can feel disruptive.
- **No in-run damage stats**: There is no running total of damage dealt or taken. The run-end screen shows only final banked spoils.

---

## 9. Known Issues and Weak Points

### Visual gaps

- All scene art is procedural SVG (per-type themed motifs, not generic). The `SCENE_REGISTRY` swap seam is defined but empty — no real illustration assets exist yet. Dropping a PNG under the matching key in `SCENE_REGISTRY` replaces the procedural art automatically.
- The biome tint overlay appears on scene banners only, not on panel backgrounds or the overall page. The atmosphere effect is correct but subtle.
- BattleScene battler sprites are procedural crests (colored square + letter). `src/assets/sprites/bosses/<bossId>.png` and `avatars/<classId>.png` swap-seams are registered in `FOLDER_PREFIX`; dropping a PNG there lights it up with zero code changes.

### FloorMap

- Node buttons are small (fixed width ~4rem) and may be difficult to tap precisely on mobile, particularly when 3 nodes appear in a single layer.
- The visited checkmark badge is absolutely positioned slightly outside the button bounds (`-right-1 -top-1`), which can clip against adjacent nodes.

### Encounter system

- The `encounterRoomFor()` function in `dungeon.ts:57` is a thin wrapper solely to expose a private picker function to `dungeonMap.ts`. It is a legitimate API but adds a layer of indirection that could be simplified (flagged in the improvement plan; not yet resolved).

### Resource economy

- Merchant prices scale linearly with depth (`18 + depth×4` for heal, up to `45 + depth×9` for a relic) but there is no verified analysis of whether gold accumulation keeps pace at depth 10+.
- Discrete loot drops (items, weapons, gear) from treasure rooms are all lost on death. This rule is now communicated, but the penalty may still feel disproportionate for a spellbook picked up three rooms before dying.

### Technical debt

- `encounterRoomFor()` thin-wrapper indirection (see above). The private `encounterRoom()` that it wraps also lives in `dungeon.ts:46–63`. Minor but creates a confusing two-function pattern for one operation.

### Missing features (design gaps)

- No in-run damage statistics.
- No seed display or replay capability, despite the deterministic RNG architecture.
- Merchant prices not visible on the FloorMap node before entering the room.

---

## 10. Remaining Improvement Opportunities

The items below are drawn from the Improvement Plan and have **not** been implemented in Steps 1–6.

### Controls and UX

- Make RelicTray tappable for relic detail on touch devices (currently tooltip-only).
- Time the BoonChoice modal to appear only after a room fully resolves, not mid-checkpoint render.
- Show merchant prices on the FloorMap node before the player commits to entering that room.

### Mechanics and depth

- **Triggered/conditional relic effects** (Step 7): extend `RelicDef` with a trigger field (e.g., "on low HP", "on combat win") and wire it into combat resolution. This is the single highest-impact remaining mechanics change — requires combat-path tests.
- Partial item retention on death as an optional balance lever (e.g., 1-in-N items kept instead of all lost).
- Economy balance pass: verify gold accumulation vs. merchant pricing at depth 10+; add a unit test asserting expected gold-per-floor band.

### Feedback and clarity

- In-run damage stats panel (damage dealt/taken this run, total rooms cleared across all floors).
- Show total rooms remaining on the current floor (not just layer X of Y — count remaining selectable paths).

### Visual and audio polish

- Audio: SFX for room entry, combat victory, relic acquisition, treasure pickup, and banking; optional per-biome ambient loop.
- Real room illustrations: populate `SCENE_REGISTRY` in `scenes.ts` to replace per-key procedural SVG banners. Swap-seam is in place — drop PNGs by key, zero component changes.
- Real battler sprites: drop PNGs into `src/assets/sprites/bosses/<bossId>.png` and `avatars/<classId>.png`. Swap-seam registered in `FOLDER_PREFIX` in `src/lib/sprites.ts`.

### Code quality

- Resolve the `encounterRoomFor()` indirection: either inline the private `encounterRoom()` into `dungeonMap.ts` directly or promote it as a proper public API.

---

## 11. Questions and Unknowns

1. **Is `encounterRoomFor()` indirection intentional?** The export exists solely to give `dungeonMap.ts` access to a private picker. This is minor but creates a two-step pattern for one operation. Worth simplifying in a future code hygiene pass.

2. **What is the intended scope of the encounter XP reward?** Currently a successful stat check grants +10 XP to that stat — a flat value with no depth scaling. Whether this should scale with floor depth (deeper = harder = more XP) is unresolved.

3. **Is there a gold-to-depth balance document?** Merchant prices scale linearly, but gold accumulation from combat and treasure has not been formally verified to keep pace. This may be worth a unit test at depth 10+.

4. **What prevents the shrine curse pool from being empty?** `rollCurse()` returns `undefined` if no curses exist in the catalog. `dungeonShrine('pray')` handles this gracefully. With 5 curses now in `RELICS`, the pool is non-empty in practice, but the empty-pool escape is worth documenting as intentional behavior.

5. **Is flee intended to always keep 100% of loot?** The current behavior passes `keepFactor = 1` to `finishRun`, preserving everything gathered. This is now explicitly communicated to the player and appears intentional — fleeing is positioned as the safe alternative to risking death.

6. **What is the intended final feel of biome tint?** The current 22%-opacity CSS overlay is subtle. If real illustration assets arrive, a per-biome filter or overlay may need to be adjusted or removed to avoid fighting the art's own color.

7. **Should the run history show more context?** Currently `DungeonRunSummary` captures only depth, outcome, and date. Adding total gold banked or relics held at end-of-run would make the history more useful for self-coaching, at the cost of a larger persisted payload.
