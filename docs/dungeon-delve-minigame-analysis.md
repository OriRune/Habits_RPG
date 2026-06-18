# Dungeon Delve Minigame Analysis

## 1. Basic Summary

Dungeon Delve is a turn-based roguelike minigame accessed from the Dungeon tab. The player spends 3 Energy to begin an **Endless Descent**: a sequence of floors, each structured as a small branching map of rooms. Completing all rooms on a floor unlocks a **Checkpoint** where the player chooses to safely exit with their banked loot, or push deeper for harder content and richer rewards. Every fifth floor a biome boss guards the descent into a new region. The run ends either by banking, by fleeing combat, or by death mid-floor (losing most of that floor's haul).

Within the larger game, Dungeon Delve is the primary Energy sink, the main source of gold and crafting materials, and the way combat stats are trained. It gates on Level 3 and has progressive milestone unlocks (Merchants at floor 5, Elites at floor 8, Tier 3 relics at floor 10), giving it a long content ladder to climb.

---

## 2. Core Game Loop

### How a run starts

- Player opens the Dungeon tab and clicks **Enter the Dungeon**.
- Gate: character level ≥ 3 (`DUNGEON_UNLOCK_LEVEL`) and energy ≥ 3 (`DUNGEON_ENERGY_COST`, `src/engine/dungeon.ts:11`).
- Store deducts 3 energy and calls `startDungeon()` (`src/store/useGameStore.ts:~1528`).
- Player HP/MP/Sta are set to full from `fighterFor()` (includes equipped gear + class bonuses).
- Floor 1 map is generated; the player sees the first path choice.

### What the player repeatedly does

On each floor:

1. **Choose a path** — the floor map shows 2–3 entry nodes; the player taps one to enter that room.
2. **Resolve the room** — room type determines the interaction (see Section 4). Combat requires play; other rooms present choices or auto-resolve.
3. **Advance** — after resolving, the room's outgoing edges become the new path choices. The player proceeds through 3 layers (typically 5–8 rooms total are visible, 2–3 selected).
4. **Reach the checkpoint** — after the final (terminal) layer, the player is presented with the checkpoint decision.

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
| Player flees combat | `cleared = false`; banked loot kept; floor loot kept fully |
| Player dies (combat or encounter HP drain) | `cleared = false`; banked loot kept; 25% of floor loot kept (the rest is forfeit) |

After any end state, the player sees a summary screen and clicks **Collect & Leave** to apply rewards.

### Rewards

- Gold, crafting materials, items (spellbooks, potions), weapons, gear — all accumulated into `bankedReward`.
- No character XP from loot collection.
- Stat XP is granted during play: +10 XP to a stat on a successful encounter check, and combat wins train attack/HP stat XP.
- `deepestFloor` is updated on descend, unlocking milestone content.

---

## 3. Player Controls and Interaction

### Input

All interaction is click/tap. There is no keyboard navigation, no real-time component, and no held-key mechanics. The dungeon is entirely menu-driven.

### UI elements during a run

**HUD panel** (shown between rooms, hidden during active combat):
- Three resource bars — HP (green), MP (blue), Sta (amber) — each showing `value/max` numerically.
- Inline reward summary: "Banked: Xg · Y mat" and "This floor: …" in the same panel.
- RelicTray: a compact row of small sprite icons showing held boons/curses for the run, with title-tooltip on hover.

**FloorMap** (`src/components/dungeon/FloorMap.tsx`): A layered grid of room node buttons. Choosable rooms glow gold; visited rooms show a checkmark badge; unreachable rooms are dimmed and disabled. Room types are distinguished by Lucide icon and color (e.g., Swords/ember = combat, ScrollText/blue = encounter, Gem/gold = treasure, Skull/ember = boss, Flame/ember = elite, Sparkles/purple = shrine, Coins/gold = merchant, Tent/green = rest). A hint text reads "Tap a glowing room to enter it."

**BattleScene** (`src/components/combat/BattleScene.tsx`): Shared combat component reused from the top-level boss battles. Shows enemy art, health bars, action buttons, and allows fleeing.

**EncounterRoom** (inline in `src/views/DungeonView.tsx:352`): Shows the encounter title and current narrative node text. Each choice button includes a stat badge showing the relevant stat level and success odds (`STAT X · ~Y%`). Last outcome is displayed in a colored callout (green = success, red = fail, neutral = no check).

**ShrineRoom** (`src/components/dungeon/ShrineRoom.tsx`): Three buttons — Pray (shows `~X%` success odds based on best WI/CH), Offer (costs 25% max HP, disabled if HP too low), Leave.

**MerchantRoom** (`src/components/dungeon/MerchantRoom.tsx`): Lists up to 3 offers with costs; unaffordable offers are disabled. Shows player's current gold. A "Move on →" button leaves without buying.

**RestRoom** (`src/components/dungeon/RestRoom.tsx`): Two buttons — Rest and recover (+40% HP, disabled if already full), Attune to the deep (tier-1 boon).

**BoonChoice** (`src/components/dungeon/BoonChoice.tsx`): Non-dismissable modal with 1–3 relic cards. Each card shows a sprite icon, name, tier badge, and description. Appears over any room UI when `pendingBoon` is set.

**Checkpoint screen**: HP bar, RelicTray, banked reward summary, and three buttons (Rest/Press On/Bank).

**Run-end screen**: Success or failure headline, a description of how far the player got, banked spoils list, and a Collect & Leave button.

### Player feedback

- Stat check odds are computed and displayed before a choice is made.
- Encounter outcomes (success/fail text) are shown in colored callouts.
- Boss floors are flagged on the checkpoint "Press On" button: "Press On (Boss!) — take a boon".
- Milestone hint on the entrance screen tells the player exactly what floor unlocks the next feature.
- Flee outcomes (survived vs. fell) produce distinct end-screen headlines and flavor text.

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

**Combat / Elite / Boss**: Calls `createBattle()` and passes to the shared combat engine. HP/MP/Sta are carried into the battle via `battle.startingHp/Mp/Sta`. After resolution, run resources are updated from `battle.playerHp/Mp/Sta`. Elite wins grant a bonus boon offer in addition to floor loot. Boss fights can have multiple phases (indicated by PhasePips).

**Encounter**: A branching text event. Choices may have a stat check (`checkChance(power, difficulty)` = `min(0.95, max(0.05, 0.3 + (power − difficulty) × 0.07))`). Success/failure routes to different subsequent nodes. Resource deltas (HP/MP/Sta) and gold/materials are applied per node. Encounters are drawn from the current biome's pool and defined in `src/engine/encounters.ts`.

**Treasure**: Loot is generated on room entry via `resolveTreasure(depth, rng)` (`src/engine/dungeon.ts:110`). Gold: `60 + depth×10 + rand(0..40)`. Always 1–2 crafting materials + crystals. 50% spellbook drop. Weapon drop chance scales with depth (`0.15 + depth×0.015`, max 40%). No player action required; "Continue" advances immediately.

**Shrine**: Three choices: Pray (WI/CH vs. difficulty 6 → boon or curse), Offer (−25% max HP, guaranteed boon, disabled if HP ≤ cost), Leave (no effect).

**Merchant**: Three fixed offers per visit, priced by depth: heal (+40% HP, cost `18 + depth×4`), healing potion (cost `24 + depth×5`), random relic boon (cost `45 + depth×9`). Bought with character gold (persists out of the run).

**Rest**: Heal (+40% max HP, disabled if full) or Fortify (tier-1 boon via `rollBoons(3, relics, 1, rng)`).

### HP attrition

HP is the run's primary attrition currency. It carries between every room and every floor. MP and Sta reset to full at each checkpoint (the "Rest" option at checkpoint also recovers 40% max HP). Discrete drops (items, weapons, gear) are all-or-nothing on death — only gold and materials are partially kept (25%).

### Relics (run-only modifiers)

Relics are collected as boons (positive) or curses (negative, from failed shrine checks). Defined in `src/engine/relics.ts`. Each relic carries `statBonuses`, `defense`, `ward`, and/or `maxHp` effects. They are aggregated via `aggregateRelics()` and folded into `fighterFor()` — the same stat-aggregation pipeline used for equipped gear — so relics behave exactly like temporary gear during the run. Acquiring a `maxHp` relic instantly recalculates max HP and grants the difference as current HP.

Boon tiers gate on deepest reached: Tier 1 always; Tier 2 from depth 4; Tier 3 from depth 10.

### Biomes

`biomeForDepth(depth)` cycles through `BIOME_ORDER` with one region per 5 floors. Each biome has an enemy pool, an encounter pool, a boss definition, and a tint color for scene illustrations. Defined in `src/engine/biomes.ts`.

### Win and loss conditions

- **Win**: No single "win" state. The run ends safely when the player banks.
- **Loss**: Death mid-floor (HP ≤ 0 in combat or encounter). Forfeits 75% of the current floor's gold and materials; drops all discrete items from that floor.
- **Escape**: Fleeing combat ends the run immediately, keeping 100% of all loot gathered so far.
- `deepestFloor` is updated on each successful `dungeonDescend()` call and persists across runs.

### Stat XP and progression

| Event | XP granted |
|-------|-----------|
| Successful encounter stat check | +10 to the checked stat |
| Combat win | Attack stat + HP stat XP (60%/40% split of `combatXpForWin(bossMaxHp)`) |

No XP is granted on loot collection. Dungeon does not interact with the level-up boss gate.

### Randomization and determinism

All generation functions (`generateFloorMap`, `resolveTreasure`, `rollBoons`, etc.) accept an injected `RNG` parameter, making them deterministic for a given seed. In production, `Math.random` is passed. This enables unit testing with fixed seeds and potential future replay features.

---

## 5. Technical Implementation

### File map

| File | Role |
|------|------|
| `src/engine/dungeon.ts` | Core types (`RoomKind`, `DungeonRoom`), room metadata, floor/loot generation, reward merge/scale utilities. `DUNGEON_ENERGY_COST = 3`, `FLOOR_LOSS_KEEP = 0.25`. |
| `src/engine/dungeonMap.ts` | Layered DAG floor map generator. `MapNode`, `FloorMap` types. `generateFloorMap()`. |
| `src/engine/biomes.ts` | Biome definitions and `biomeForDepth()`, `bossFor()`, `isBossDepth()`. |
| `src/engine/encounters.ts` | `EncounterDef`/`EncounterNode`/`EncounterChoice` types, `chooseEncounter()` stat-check resolution, `checkChance()`. |
| `src/engine/relics.ts` | `RelicDef` type, `rollBoons()`, `rollCurse()`, `aggregateRelics()`, `boonMaxTier()`. |
| `src/engine/combat.ts` | Shared combat engine used for all dungeon battles. |
| `src/store/useGameStore.ts` | ~15 dungeon store actions; `DungeonRun` interface (~lines 215–255); `deepestFloor` persistent record. |
| `src/views/DungeonView.tsx` | Top-level tab view. Renders all dungeon states (entrance, run, checkpoint, end). Hosts the `EncounterRoom` sub-component inline. |
| `src/components/dungeon/FloorMap.tsx` | Layered node grid for path selection. |
| `src/components/dungeon/BoonChoice.tsx` | Non-dismissable modal for 1-of-3 relic selection. |
| `src/components/dungeon/RelicTray.tsx` | Compact relic icon row shown in HUD. |
| `src/components/dungeon/ShrineRoom.tsx` | Shrine interaction UI. |
| `src/components/dungeon/MerchantRoom.tsx` | Merchant shop UI. |
| `src/components/dungeon/RestRoom.tsx` | Campfire rest/attune UI. |
| `src/components/combat/BattleScene.tsx` | Shared combat component (not dungeon-specific). |
| `src/lib/scenes.ts` | Scene art config (glyph + color placeholders for each room type). |
| `src/content/biomes.ts` | `BIOMES` catalog and `BIOME_ORDER` array. |
| `src/content/relics.ts` | `RELICS` catalog (all boon and curse definitions). |
| `src/content/encounters.ts` | `ENCOUNTERS` catalog (all branching event definitions). |
| `src/engine/__tests__/dungeon.test.ts` | Unit tests for floor generation, treasure scaling, reward utilities. |
| `src/engine/__tests__/dungeonMap.test.ts` | Unit tests for map structure, reachability, boss funnels, determinism. |

### Key functions

| Function | Location | What it does |
|----------|----------|--------------|
| `startDungeon()` | store | Gate check, energy deduction, fresh run initialization. |
| `dungeonChoosePath(nodeId)` | store | Sets the current node and calls `enterRoom()`. |
| `enterRoom(run, state)` | store (helper ~line 887) | Populates room payload: spawns battle, starts encounter, generates loot, etc. |
| `dungeonAdvance()` | store (~line 1628) | Resolves the just-completed room; calls `resolveCurrentNode()`. |
| `resolveCurrentNode(run, hp, mp, sta)` | store (helper ~line 279) | Wires next path choices or sets `atCheckpoint = true`; partial MP regen (+15%). |
| `dungeonDescend(mode)` | store (~line 1697) | Increments depth, regenerates floor map, resets MP/Sta, handles rest/pressOn. |
| `collectDungeon()` | store (~line 1732) | Applies `bankedReward` to inventory; clears `dungeon: null`. |
| `finishRun(run, cleared, hp, keepFactor)` | store (helper ~line 916) | Scales floor loot by factor, merges into banked, sets `status: 'ended'`. |
| `generateFloorMap(depth, biome, rng, opts)` | `dungeonMap.ts:66` | Builds the layered DAG for one floor. |
| `generateFloor(depth, biome, rng)` | `dungeon.ts:81` | Legacy linear floor builder (superseded by map system but still present). |
| `resolveTreasure(depth, rng)` | `dungeon.ts:110` | Generates gold + material + optional item/weapon reward for a treasure room. |
| `merchantOffers(depth)` | `dungeon.ts:101` | Returns the 3 fixed merchant offer objects for this depth. |
| `chooseEncounter(state, def, choiceIdx, statLevels, bonuses, rng)` | `encounters.ts` | Rolls stat check, branches narrative, applies deltas, returns new encounter state. |
| `rollBoons(count, owned, maxTier, rng)` | `relics.ts` | Draws up to `count` distinct non-owned boons of tier ≤ maxTier. |
| `aggregateRelics(defs)` | `relics.ts` | Sums relic stat/defense/ward/maxHp bonuses for `fighterFor()`. |
| `fighterFor(state, extraBuffs?)` | store (or combat engine) | Combines character stats + gear + relics into a combat-ready fighter. |

### State management

`DungeonRun` is the single run object on `useGameStore`. It is either `null` (no active run) or a complete snapshot of the run state. All mutations replace the object (Zustand immutable pattern). Key fields:

- `depth`, `biomeKey` — current position.
- `map`, `nodeId`, `choices`, `path` — floor map navigation state.
- `hp/maxHp`, `mp/maxMp`, `sta/maxSta` — run resources.
- `bankedReward`, `floorReward` — loot buckets.
- `encounter`, `battle`, `roomLoot`, `merchant` — active room payload (only one is non-null at a time).
- `atCheckpoint`, `status`, `cleared` — run lifecycle flags.
- `relics`, `pendingBoon` — relic state.

### Save/load and migration

State persists via Zustand `persist` (localStorage). Dungeon state has been cleared on multiple schema-breaking changes (runs at v5, v8, v9, v10 in the migration chain). Fresh saves initialize `dungeon: null` and `deepestFloor: 0`.

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
| Framework | React 18 (functional components, hooks) |
| Language | TypeScript |
| Build tool | Vite |
| State management | Zustand with `persist` middleware |
| Styling | Tailwind CSS (utility classes; custom design tokens via config) |
| Icons | Lucide React (all room type icons, resource bar icons) |
| Rendering | DOM/CSS (no canvas, no WebGL) |
| Animation | CSS transitions (`transition-colors`, `transition-all`). No animation library. |
| Physics/collision | None (menu-driven; no spatial simulation) |
| Audio | None |
| UI primitives | Custom `Panel`, `Button`, `Sprite`, `SceneArt`, `Modal` components in `src/components/ui/` |
| Art pipeline | Procedural SVG placeholders via `src/lib/placeholderArt.ts` and `src/lib/sprites.ts`; swap seam in `src/lib/scenes.ts` and `src/lib/sprites.ts` for future real assets |
| Persistence | `localStorage` via Zustand persist |
| Testing | Vitest |

---

## 7. Assets and Presentation

### Scene art

Room backgrounds are rendered by the `SceneArt` component using `src/lib/scenes.ts`. Every scene key maps to a `SceneLook` with an emoji glyph, a hex background color, and a caption string. The `scenePlaceholderImage()` function generates an SVG "framed image box" using `framedSvg()` from `src/lib/placeholderArt.ts`.

Scene keys used by the dungeon:

| Key | Glyph | Color |
|-----|-------|-------|
| `dungeon:entrance` | 🚪 | Dark brown |
| `dungeon:checkpoint` | 🏕️ | Forest green |
| `dungeon:cleared` | 👑 | Gold |
| `dungeon:retreat` | 🏳️ | Gray |
| `room:encounter` | 📜 | Tan |
| `room:treasure` | 💰 | Amber gold |
| `room:rest` | 🏕️ | Forest green |

**Notably absent from `scenes.ts`**: `room:merchant` and `room:shrine` — both components call `<SceneArt sceneKey="room:merchant/shrine" />` but neither key is registered, so they fall back to `FALLBACK` (`❓`, dark brown).

There is a defined swap seam (`SCENE_REGISTRY` in `scenes.ts`, `resolveSceneImage()`) so that real illustration assets can replace placeholders by key without changing component code.

### Sprites

Relics use `Sprite` with procedurally generated crest art (`relicCrest()` from `src/lib/sprites.ts`). Room type icons in FloorMap are Lucide vector icons (not sprites).

### Animations

- CSS `transition-colors` on FloorMap node buttons (hover state).
- CSS `transition-all` on resource bars (smooth width change).
- No entrance/exit animations for rooms. No screen transitions. No combat animations specific to the dungeon (BattleScene handles its own).

### Sound

None. No sound effects or music anywhere in the dungeon.

### Overall style

Fantasy RPG aesthetic. Color palette: parchment backgrounds, dark wood panels, gold accents, ember/red for danger, green for health, blue for magic. Font display class for headings. The visual language is established and consistent across the dungeon UI, but the lack of real illustration art means the rooms feel anonymous and interchangeable.

---

## 8. Current Player Experience

### What works well

- **Strategic checkpoint decision**: The Bank vs. Descend choice with explicit HP cost information creates genuine tension. The split between safe banked loot and risky floor loot is clearly communicated.
- **Visible stat odds**: Encounter choice buttons show the exact success probability for stat checks. This is transparent and respects the player's time.
- **Attrition model**: HP carrying between rooms and floors creates a sense of accumulated risk that builds across a run.
- **Relic builds**: The boon system adds meaningful run-to-run variation. Acquiring a max HP relic mid-run immediately recalculates the cap and heals the difference, which feels satisfying.
- **Milestone progression**: The deepestFloor gates for merchants, elites, and tier-3 relics give early runs a sense of discovery.
- **FloorMap clarity**: Room type icons are immediately legible. The glow/dim/checkmark state system clearly communicates what's available.
- **Fallback on missing encounter content**: The `EncounterRoom` has a graceful fallback ("The passage is quiet.") to prevent soft-locks if an encounter key is missing.

### What feels rough or unfinished

- **All room backgrounds are placeholders**: Every room type uses an emoji-in-a-box SVG. The dungeon has no visual identity of its own — a shrine looks functionally identical to a merchant.
- **Two scene keys are unregistered**: `room:shrine` and `room:merchant` fall back to `❓` + dark brown. This is a gap, not a placeholder — those rooms have no intentional art config at all.
- **No audio**: No sound effects for entering a room, resolving a combat, picking up treasure, or acquiring a relic. The experience is silent.
- **FloorMap has no connection lines**: The nodes are laid out in rows but there are no drawn edges between them. The branching structure of the DAG is invisible — the player cannot see which nodes connect to which in the next layer.
- **No room transition animations**: Entering a room is an instant state swap. There is no visual signal that something changed (no fade, no slide).
- **Encounter narrative momentum is weak**: The encounter component always re-reads the current node, so the player sees the full narrative tree from the current node on every render. The experience is text-box clicking, not storytelling pacing.
- **Rest room disabled state**: If HP is already full, the "Rest and recover" button is simply disabled with no alternative text. The player is implicitly forced to take the boon, with no explanation.
- **Merchant and rest rooms feel thin**: Each has only 2–3 options. Especially the rest room, which is a binary choice rendered as two small buttons.
- **Pacing of boon modal**: The `BoonChoice` modal is non-dismissable and can appear over any room UI. It interrupts flow at unintuitive moments (e.g., mid-checkpoint).

---

## 9. Known Issues or Weak Points

### Visual gaps

- `room:shrine` and `room:merchant` are not registered in `src/lib/scenes.ts`. Both rooms call `<SceneArt>` with those keys and get a fallback `❓` glyph. Likely an oversight from when those room types were added.
- All scene art is placeholder SVG. The `SCENE_REGISTRY` swap seam exists but is empty.

### FloorMap

- No edge lines drawn between nodes. The branching is visually invisible to the player.
- Node buttons are small (16px wide fixed) and may be difficult to tap on mobile.
- The visited checkmark badge overlaps slightly outside the button bounds (absolute positioned `-right-1 -top-1`).

### Encounter system

- `generateFloor()` in `dungeon.ts:81` is a legacy linear floor builder from before the map system. It is no longer called by the store (which uses `generateFloorMap()` exclusively), but it still exists. This is dead code and a source of confusion.
- Encounter stat check outcomes show `enc.lastText` above the choices for the *next* node, which means the outcome of the prior choice is shown alongside new choices. This can be disorienting if the player scrolls down quickly.

### Resource economy

- Merchant prices scale linearly with depth, but there is no analysis of whether gold accumulation keeps pace. A player who reaches floor 10 without picking up much gold may find all three merchant offers unaffordable.
- Discrete loot drops (items, weapons, gear) from treasure rooms are all lost on death — including any spellbooks or weapons picked up in that floor's treasure room. This is correct by design (`scaleReward` comment: "Discrete drops are all-or-nothing: lost when you fall") but may feel punishing and is not communicated to the player before they enter.

### Technical debt

- The `DungeonRun` interface is defined inline in `useGameStore.ts` rather than as an exported type from a dedicated file. This makes it harder to import from engine tests.
- `generateFloor()` (legacy, `dungeon.ts:81`) is dead code but still exported.
- The `encounterRoomFor()` export in `dungeon.ts:46` is a thin wrapper around a private `encounterRoom()` function, solely to expose it for `dungeonMap.ts`. The indirection adds noise.

### Missing features (implied by design)

- No in-run statistics panel (rooms cleared this run, total damage dealt/taken, floors descended).
- No run history or best-run records beyond `deepestFloor`.
- No seed display or replay capability, despite the deterministic RNG architecture.
- Biome tint color from `BiomeDef` is defined but appears unused in the dungeon UI (scene art uses hardcoded colors from `scenes.ts`, not biome tint).

---

## 10. Improvement Opportunities

### Controls and UX

- Draw edge lines between FloorMap nodes so the branching structure is legible.
- Add room transition animations (fade or slide) between the path choice and the room interior.
- Make the BoonChoice modal appear at natural pause points (after a room resolves) rather than interrupting mid-render.
- Surface the "discrete items are lost on death" rule somewhere before the player first experiences it.
- Add a "view relic details" tap/expand on the RelicTray rather than tooltip-only.

### Feedback and clarity

- Register `room:shrine` and `room:merchant` in `scenes.ts` with intentional placeholder art.
- Show encounter outcome text in a dedicated "result" panel separate from the next node's text.
- Give the disabled "Rest (full HP)" button a message like "You are fully healed — attune instead."
- Show total floor rooms remaining, or at minimum how many layers are left, on the FloorMap.

### Mechanics and depth

- Reveal FloorMap edge connections (which nodes lead where) so the player can make informed routing decisions.
- Allow the player to see merchant prices before entering the room (e.g., a room tooltip on the map node).
- Consider partial item retention on death (e.g., 1 in 3 items kept) rather than complete loss.
- More diverse relic effects — currently relics are all stat/defense/ward/maxHp modifiers. Procedural or triggered effects (e.g., "on low HP, gain +2 AG") would add more build variety.
- Encounter content pool size — if the biome's encounter list is short, the player will see repeated events on long runs.

### Visuals and audio

- Commission or generate room illustrations to replace placeholder SVG art.
- Add sound effects for room entry, combat win, relic acquisition, and banking loot.
- Add idle or ambient music per biome.
- Use the biome `tint` color in scene art (currently unused in dungeon UI).

### Code quality

- Delete the dead `generateFloor()` function from `dungeon.ts`.
- Export `DungeonRun` as a named type from a dedicated file (e.g., `src/engine/dungeonTypes.ts`) so engine tests can reference it directly.
- Inline `encounterRoomFor()` into `dungeonMap.ts` or make it a proper public API, removing the thin wrapper indirection.

### Integration with the larger game

- Show the `deepestFloor` record and milestone progress on the character or progress screen, not only on the dungeon entrance panel.
- Consider tying dungeon depth records to a visible achievement or narrative unlock.
- Run history (floors reached, loot collected, deaths) would make the dungeon feel like a meaningful part of the character's story.

---

## 11. Questions and Unknowns

1. **Is `generateFloor()` intentionally kept for future use?** It is not called anywhere in the store and appears to be superseded by `generateFloorMap()`. If it's truly dead code it should be deleted; if it's a fallback, it should be documented.

2. **Why are `room:shrine` and `room:merchant` absent from `scenes.ts`?** These room types were presumably added after the initial scene registry was written. Clarify whether this was intentional (placeholder art pending) or an oversight.

3. **What is the full content of `src/content/encounters.ts`?** The size and variety of the encounter pool is critical to how repetitive long runs feel. If the pool is small, the player will see repeated events. The analysis could not inspect this file's content count.

4. **What is the full content of `src/content/relics.ts`?** The number and variety of relics determines build diversity. The analysis confirms the structure but not the catalog size.

5. **Is the biome tint color (`BiomeDef.tint`) intended to be used in the dungeon UI?** It is defined and used elsewhere (possibly in a scene or overlay), but the dungeon view currently uses hardcoded colors from `scenes.ts`. Clarify the intended use.

6. **What is the intended scope of the encounter XP reward?** Currently a successful stat check grants +10 XP to that stat. This is a flat value with no depth scaling. Is this intentional, or should it scale with floor depth?

7. **Is there a gold-to-depth balance document?** Merchant prices scale linearly (`18 + depth×4` for a heal at the cheapest), but there is no visible analysis of whether gold accumulation from combat and treasure keeps pace. The economy may be unbalanced at depth 10+.

8. **What prevents the Shrine curse pool from being empty?** `rollCurse()` returns `undefined` if no curses exist. `dungeonShrine('pray')` handles this gracefully (no curse applied on a failed pray if pool is empty). Is this a deliberate design escape hatch or a gap in the content data?

9. **Is flee intended to keep 100% of all loot, including floor loot?** The current behavior (`finishRun(run, false, b.playerHp, 1)`) passes `keepFactor = 1`, preserving everything gathered. This may be intentionally generous to make fleeing viable, or it may be unexamined. The entrance screen copy says "fall mid-floor and you lose most of that floor's haul" without distinguishing flee from death.

10. **Should `deepestFloor` unlock gates (merchants, elites, tier-3 relics) reset if the player starts a new character?** Currently `deepestFloor` is a character-level persistent record. If a player wipes their character data, these gates would reset correctly. But if the Zustand migration clears dungeon state without resetting `deepestFloor`, a player could see gated content before they've "earned" it on a fresh run.
