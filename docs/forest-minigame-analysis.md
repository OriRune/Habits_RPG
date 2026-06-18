# Wild Forest Minigame Analysis

## 1. Basic Summary

Wild Forest is a real-time top-down grid crawler minigame. The player navigates a procedurally generated maze-forest, harvesting resource nodes, hunting or avoiding beasts, and descending through progressively deeper "band" stages. It costs **2 energy** to enter (the cheapest minigame in the game) and is the primary source of crafting materials (leather, cloth, herbs, crystals, amber resin) and a significant source of gold.

Within the larger game, Wild Forest feeds the crafting economy and is the main use-case for the Agility (AG) and Endurance (EN) stats — AG controls dash cooldown and movement speed, EN controls stamina pool. The minigame sits alongside the Deep Mine as a second "real-time dungeon crawl" mode that shares a large body of infrastructure.

---

## 2. Core Game Loop

### Start
The player opens the Forest from the `ForestView` entrance screen, which shows their current energy, deepest stage reached, and best score. Pressing "Enter the Forest" deducts 2 energy and calls `beginForest()` in the store, which generates the first stage map and launches `ForestRunOverlay`.

### Repeating loop
Each tick of `useForestLoop` (driven by `requestAnimationFrame`):

1. **Move** — WASD/arrow input is consumed from a queue at a rate scaled to the player's AG stat (150 ms/step baseline, down to ~100 ms at high AG).
2. **Act** — Space or Enter triggers a context-sensitive action: melee attack on adjacent beasts, range shot at nearby targets, harvest a resource node, or chop a tree. A 240 ms cooldown gates act spam.
3. **Dash** — Shift dash moves two tiles instantly, grants i-frame immunity, and has an AG-scaled cooldown (800–2000 ms).
4. **Spells** — 1–4 cast spells (rune traps, ring of fire, teleport, etc.) that cost MP and produce immediate effects.
5. **Beast tick** — Every 120 ms the store's `forestTick()` advances beast pathfinding, contact damage, DoTs, and status effects.

### Challenge escalation
- Each subsequent stage uses a larger map (base 33×33, +4 cells per band tier).
- New beast species appear at depth gates (Gray Wolf at Depth 2, Shadow Lynx at Depth 5, Grove Wraith at Depth 8).
- Stage 4 and Stage 8 each have a mandatory guardian fight (Grove Sentinel, Ancient Guardian) that must be killed to advance.
- Guardians deal heavy contact damage with a 360 ms telegraph windup.

### End conditions
- **Death** — HP reaches zero. The player keeps 50% of accumulated haul (`FOREST_DEATH_KEEP = 0.5`). Shown a death summary overlay.
- **Banking** — The player manually retreats via a "Leave Forest" action. Keeps 100% of haul. Shown a banking summary.
- **Guardian defeat** — Each guardian kill grants a boon choice (3 cards), which pauses the run until the player picks one, then resumes with the next band.

### Rewards
- **Materials**: leather, game_meat, pelt, flower_petals, cloth, crystals, amber_resin — from nodes and beast kills.
- **Gold**: scattered node/shrine yields and beast bounties.
- **Persistent records**: `deepestForestStage` and `bestForestScore` are saved to the store.
- Completion calls no `completeTrial` because Wild Forest is a repeatable run, not a daily trial.

---

## 3. Player Controls and Interaction

### Keyboard
| Key | Action |
|-----|--------|
| W / A / S / D (or arrow keys) | Move in the four cardinal directions |
| Space / Enter | Act (attack, harvest, chop) — hold ~480 ms for charged swing |
| Shift | Dash in current facing direction |
| 1 / 2 / 3 / 4 | Cast equipped spells |

### Touch (mobile)
`ForestControls.tsx` renders a D-pad (3×3 grid) for movement, a large "Act" button with a scissors icon, and a smaller "Dash" oval with a zap icon. Controls use pointer events for continuous hold recognition.

### HUD elements (`ForestRunOverlay.tsx`)
- **Depth / band name** — shows current stage and band tier (Thicket / Deepwood / Ancient Heart).
- **Guardian / boon badges** — indicate which milestones have been cleared.
- **HP / Stamina / MP gauges** — live bars with label.
- **Haul chips** — running total of materials and gold picked up in the current run.
- **Fog of war** — tiles are dark until explored; explored-but-not-visible tiles are dimmed.
- **Torch glow** — radial gradient centered on the player (3–4 tile radius, expanded by Lantern boon).
- **Beast telegraphs** — red ring with glow appears 360 ms before contact damage lands.
- **Charge indicator** — implicit: holding Space lets you feel the slight delay before the charged hit fires.

### Overlay panels
- **Boon choice panel** — pauses the run; shows 3 randomized cards (name, description, icon). Player must pick one.
- **Banking summary** — shows full haul and confirms departure.
- **Death summary** — shows split haul (50% kept / 50% lost).

### Feedback
- Visual: damage floaters (red numbers), loot floaters (gold/material icons), harvest pop (green circle), dash ring, screen shake on hit.
- Audio: `sfx.swing`, `sfx.hit`, `sfx.playerHurt`, `sfx.enemyDeath`, `sfx.cast`, ranged shot tracer with arrow streak.

---

## 4. Mechanics and Systems

### Movement
Grid-based, cardinal only. One tile per move interval (150 ms baseline, reduced by AG up to ~33%). Diagonals are not supported. Stamina drains on each step (formula shared with mining: `dungeonStamina()` = `50 + EN`). Stamina regenerates at 1 tick per 1200 ms when stationary.

### Dash (`tryDash()` in `forest.ts`)
Moves 2 tiles in the facing direction instantly. Grants i-frame immunity for the dash duration. Cooldown formula from `crawl.ts::dashCooldown()`: scales from 2000 ms (low AG) to 800 ms (high AG). A boon (Overcharge) can further reduce it.

### Attack / Act (`act()` in `forest.ts`)
Context-sensitive based on the tile adjacent to the player:
- **Beast adjacent** → melee attack. Damage uses `attackRoll()` from `combat.ts`.
- **Beast in range** → ranged shot (if weapon supports it). Damage uses `spellDamageRoll()`.
- **Node tile** → harvest. Yields configurable materials; stamina is refunded for nodes that are springs (stamina refill variant).
- **Chokkable tree corner** → chop. Multiple hits required; drops wood.

### Charged swing
Holding Space for ~480 ms (2 × `ACT_INTERVAL_MS` of 240 ms) triggers a charged hit on the next `forestActCharged()` call. Multiplier is `CHARGE_DAMAGE_MULT = 1.75`. Staggers the target beast.

### Combat (`stepBeasts()` in `forest.ts`)
- **Predators** path toward the player via BFS flow field (`flowStep()`).
- **Prey** flee away from the player via inverted BFS.
- **Contact damage** uses a 360 ms windup telegraph. During i-frame (dash) it is blocked.
- **Status effects** (from `crawl.ts`): burn (DoT 1.5 s ticks), poison (DoT), freeze (movement halt 3 s), bless (+4 defense), weaken, blind.
- **Runes** placed on tiles trigger on beast contact: fire rune → burn, ice rune → freeze, poison rune → poison.
- **Ring of fire** — 8 s aura, 600 ms hit cooldown, damages all adjacent beasts.

### Spells (`castSpell()` in `forest.ts`)
Four spell schools. Costs MP. Examples: rune placement (drop trap on current tile), ring of fire (AoE aura), teleport (blink to random safe tile), healing (restore HP). Schools have beast-specific weaknesses/resistances (e.g. Dire Wolf resists DX, weak to WI).

### Map generation (`generateForest()` in `forest.ts`)
Recursive-backtracker maze on a grid that grows from 33×33 (Stages 1–3) to 57×57 (Stage 8+, scaled +4 cells per band). Clearings are carved inside the maze. Nodes, beasts, shrines, and boon caches are scattered by weighted random placement. Band-gated content (Deepwood nodes, Ancient beasts) only appears at the appropriate depth.

### Progression / stages (`advance()` in `forest.ts`)
Calling `forestAdvance()` (player walks over the exit tile) transitions to the next stage. Stamina and MP are partially refilled. The stage number, active boons, and haul carry over. The map is freshly generated using a deterministic per-stage seed (important for co-op parity).

### Boon system
Guardian kills pause the run and trigger a boon choice of 3 randomly selected options from `content/boons.ts`. Boons include:
- Forager (gather yield ×1.5)
- Lantern (sight radius +1)
- Iron Arm (melee damage ×1.3)
- Stone Skin (+5 defense)
- Overcharge (reduce charge count from 2 to 1)
- Movement and dash speed bonuses

Active boons are stored in `ForestState.activeBoons: string[]` and applied as multipliers in the engine functions.

### Shrines (`forestShrine()`)
Three outcomes: gold + material cache, temporary bless buff (+4 defense), or a Disturbed Den event (spawns a nearby guardian beast).

### Fog of war
Each cell tracks `seen` and `visible` flags. The player has a sight radius of 3 (4 in clearings), expandable to +1 via Lantern boon. Unseen tiles render as black; seen-not-visible tiles render dimmed.

### Loot and economy
- **Node loot**: determined by node type and band tier in `content/forest.ts`.
- **Beast loot**: per-beast drop table with gold bounty + material.
- **Guardians**: guaranteed treasure (gold + next-band preview materials).
- **Death split**: `splitHaul()` keeps 50% of all accumulated materials and gold, rounded down.

### Win / loss
There is no hard "win" state — the run continues until death or voluntary banking. The persistent record `deepestForestStage` is updated whenever the player surpasses their previous best.

### Larger-game stats that affect the minigame
| Stat | Effect |
|------|--------|
| AG (Agility) | Move speed, dash cooldown |
| EN (Endurance) | Stamina pool size |
| ST (Strength) | Melee damage (via `meleePower`) |
| DX (Dexterity) | Ranged damage (via `rangedPower`) |
| WI (Wisdom) | Spell damage and some weaknesses |
| HP (Hit Points) | Starting HP pool |
| Defense (gear) | Damage reduction from contact and spell hits |

---

## 5. Technical Implementation

### Key files

| File | Role |
|------|------|
| `src/engine/forest.ts` | Pure game logic (~1614 lines): map gen, movement, combat, spells, loot, advance |
| `src/engine/crawl.ts` | Shared infrastructure (~403 lines): BFS pathfinding, runes, status effects, camera math |
| `src/content/forest.ts` | Balance config (~244 lines): node types, beast stats, shrine events, band gates |
| `src/content/boons.ts` | Boon definitions (referenced by forest.ts) |
| `src/store/useGameStore.ts` | Store actions for forest (lines ~2100–2366): begin/end/tick/co-op |
| `src/hooks/useForestLoop.ts` | Real-time rAF control loop (~247 lines): input, charge detection, co-op routing |
| `src/components/forest/ForestRunOverlay.tsx` | Full rendering and VFX system (~1146 lines) |
| `src/components/forest/ForestControls.tsx` | Touch D-pad (~76 lines) |
| `src/views/ForestView.tsx` | Entrance screen (~77 lines) |
| `src/lib/minigameArt.ts` | Sprite registry: forest tree/floor/node variants (~104 lines) |
| `src/lib/sfx.ts` | Web Audio synthesis for all SFX (~200+ lines) |
| `src/lib/sprites.ts` | Sprite and crest lookup system |

### Important functions

**`generateForest(stage, rng, character)` — `forest.ts`**
Entry point for map creation. Runs recursive-backtracker maze, places clearings, scatters nodes and beasts by band, places guardian if stage matches gate, adds shrines and boon cache tiles.

**`tryMove(state, dr, dc, character, nowMs)` — `forest.ts`**
Attempts a cardinal move. Checks wall collision, stamina drain, step-on effects (boon cache pickup is handled at the store level, not here).

**`tryDash(state, dr, dc, character, nowMs)` — `forest.ts`**
Two-tile dash with i-frame. Updates `lastDashMs` for cooldown gating.

**`act(state, character, nowMs)` — `forest.ts`**
Context-sensitive action: resolves adjacent beast, adjacent node, or adjacent tree and dispatches to the appropriate handler. Returns an updated `ForestState`.

**`stepBeasts(state, character, nowMs)` — `forest.ts`**
Main combat tick. Updates all beast positions, applies contact damage (with windup check), processes DoT ticks, handles rune triggers, advances ring-of-fire hits.

**`castSpell(state, spellKey, character, rng, nowMs)` — `forest.ts`**
Resolves spell cost and effect. Places runes, applies AoE damage, or teleports player.

**`advance(state, character, rng)` — `forest.ts`**
Transitions to the next stage: increments `stage`, regenerates the map with a new seed, partially refills stamina/MP, carries over boons and haul.

**`splitHaul(haul)` — `forest.ts`**
Returns two haul objects, each containing 50% of all materials and gold (used on death).

**`floodField(grid, sources, maxDist)` — `crawl.ts`**
BFS from one or more sources to produce a distance map used by beast pathfinding and `flowStep()`.

**`flowStep(pos, field, rng)` — `crawl.ts`**
Steps a beast one tile toward lower distance values in a flood field, with randomized tie-breaking.

**`forestTick(nowMs)` — `useGameStore.ts`**
Store action that calls `stepBeasts()` and writes the result back to `state.forest`. Called every 120 ms by the control loop.

**`beginForest()` — `useGameStore.ts`**
Deducts 2 energy, assembles the character snapshot, generates Stage 1, sets `state.forest`.

**`endForest(outcome)` — `useGameStore.ts`**
Commits the haul to `character.inventory`, updates `deepestForestStage` and `bestForestScore`, clears `state.forest`.

### State management
`ForestState` (defined in `forest.ts`) is a plain object held in `useGameStore.forest`. It includes:
- `map: ForestTile[][]` — full grid
- `playerPos: {r, c}` — player grid position
- `facing: Direction`
- `beasts: ForestBeast[]`
- `haul: Record<MaterialId, number>` — accumulated loot
- `stage: number`, `hp: number`, `sta: number`, `mp: number`
- `activeBoons: string[]`
- `runes: CrawlRune[]`, `ringOfFire: CrawlRingOfFire | null`
- `statusEffects: CrawlStatusEffect[]`
- `pendingBoonChoices: string[] | null` — set after guardian kill, cleared on choice

The overlay reads directly from `useGameStore` via selectors; the control loop writes via store actions only.

### Data flow
```
useForestLoop (rAF)
  → reads keyboard/pointer input
  → dispatches store actions (forestMove, forestAct, forestTick, forestCast...)
    → store calls pure engine functions (tryMove, act, stepBeasts...)
      → returns new ForestState
    → store writes new state
  ← ForestRunOverlay reads new state via Zustand selectors → re-renders
```

### Co-op integration
The minigame has full multiplayer support routed through the co-op session layer:
- **Host** runs authoritative beast simulation (`forestTick` with co-op player list for multi-source BFS).
- **Guest** runs local-only tick (regen, contact damage) via `coopForestClientTick`.
- **Tile changes** (node harvests) broadcast as `type: 'tile'` intents and applied via `coopApplyForestTile`.
- **Melee attacks** from guests are sent as `type: 'attack'` intents to the host for damage resolution via `coopApplyForestAttack`.
- **Stage seeds** are deterministic (`mulberry32(floorSeed(baseSeed, stage))`), ensuring both players generate identical maps on advance.

### Save / load behavior
`state.forest` is persisted as part of the Zustand `persist` middleware (localStorage). If the app is closed mid-run, the run resumes on reload. `deepestForestStage` and `bestForestScore` are always persisted. The `withCharacterDefaults` migration backfills any missing fields on old saves.

### Configuration constants (spread across files)
| Constant | Location | Value |
|----------|----------|-------|
| `FOREST_ENERGY_COST` | `forest.ts` | 2 |
| `FOREST_DEATH_KEEP` | `forest.ts` | 0.5 |
| `FOREST_WINDUP_MS` | `forest.ts` | 360 |
| Base map size | `forest.ts` | 33×33 |
| Map growth per band | `forest.ts` | +4 cells |
| `ACT_INTERVAL_MS` | `useForestLoop.ts` | 240 |
| `CHARGE_SWING_COUNT` | `useForestLoop.ts` | 2 |
| `VIEW` (viewport) | `crawl.ts` | 11×11 |
| `STA_REGEN_MS` | `crawl.ts` | 1200 |
| `MP_REGEN_MS` | `crawl.ts` | 2000 |
| `CHARGE_DAMAGE_MULT` | `crawl.ts` | 1.75 |
| `dashCooldown()` range | `crawl.ts` | 800–2000 ms |

---

## 6. Software, Libraries, and Tools Used

- **Language**: TypeScript (strict mode)
- **Framework**: React 18 (hooks-based, no class components)
- **Build tool**: Vite
- **State management**: Zustand with `persist` middleware (localStorage)
- **Styling**: Tailwind CSS (utility classes in JSX)
- **Rendering**: HTML/CSS (absolutely positioned `<div>` tiles). No canvas, no WebGL. The entire 11×11 viewport is DOM elements with Tailwind utility classes and inline style transforms.
- **Animation**: CSS transitions for tile/beast movement; `requestAnimationFrame` driven by `useSmoothCamera` for world-translate interpolation and per-mover sub-tile smoothing.
- **Camera / smooth scroll**: `useSmoothCamera` hook (likely `src/hooks/useSmoothCamera.ts`) — rAF-driven world translation so the viewport scrolls smoothly between grid steps.
- **Audio**: Web Audio API synthesized entirely in `src/lib/sfx.ts`. No audio file assets — all SFX are procedural oscillators + noise with envelopes. Lazy `AudioContext` init on first interaction.
- **Physics / collision**: Custom BFS in `crawl.ts`. No physics library.
- **Pathfinding**: BFS flood-fill (`floodField`, `floodFieldMulti`, `flowStep`) — no A*, no navmesh.
- **RNG**: `mulberry32` (seeded PRNG from `src/lib/rng.ts` or similar).
- **Sprite assets**: Auto-discovered PNG files from `src/assets/sprites/` via Vite glob import (`import.meta.glob`). 16 forest tree variants, floor/node tiles.
- **Testing**: Vitest (unit tests in `src/engine/__tests__/forest.test.ts`).

---

## 7. Assets and Presentation

### Visual style
The minigame renders entirely in the DOM with styled `<div>` elements. Trees are oversized sprites (1.45–2.0× tile size) bottom-anchored to sit on the floor plane, randomly horizontally flipped for variety. The overall mood aims for a damp, twilight forest — dark thicket tiles contrasted with lighter clearings, with layered atmospheric effects.

### Tiles
- **Floor**: grass (2 variants) in clearings, dirt (2 variants) on trails, selected deterministically by cell hash.
- **Thicket / walls**: 16 tree sprite variants (oak, pine, maple in green/red/yellow, foreboding/dead variants).
- **Nodes**: flower_bush, cotton_plant, toadstool, cave_crystal_1 sprites.
- **Shrines**: glyph icon on a distinct tile.
- **Runes**: ✦ character colored orange (fire), cyan (ice), green (poison) with a CSS glow.

### Beasts
Each beast type has an emoji glyph (🐻 🦌 🐺 🕷 etc.) rendered centered on the tile. Damaged beasts show an HP bar. Frozen beasts display a blue ring. Beasts in windup show a red telegraph ring with glow. Sleeping beasts render at 70% opacity.

### Player
Rendered as a `CrawlerAvatar` sprite (the shared component for mine and forest) with direction and motion state variants.

### Visual effects (all CSS/DOM)
- **Damage floaters**: red/amber numbers rising and fading over 0.85 s.
- **Loot floaters**: gold coin or material icon rising and fading over 0.9 s.
- **Harvest pop**: green expanding circle burst over 0.55 s.
- **Dash ring**: green expanding ring over 0.4 s.
- **Screen shake**: amplitude varies by event (player hit vs. dash).
- **Ranged shot tracer**: brief arrow streak along the shot path, fading over 0.18 s.

### Ambient atmosphere
- **Ground mist**: CSS gradient covering the bottom 28% of the viewport.
- **Lateral shadows**: 12% darkening on each side.
- **God rays**: 3 rotating light-shaft beams on a slow 8–15 s cycle.
- **Pollen motes**: 6 glowing floating particles with staggered 8–14 s float cycles.
- **Torch glow**: radial gradient from the player position that moves with them.

### Audio
All procedural via Web Audio:
- `sfx.swing` — melee swing
- `sfx.hit` — successful hit on beast
- `sfx.playerHurt` — contact damage received
- `sfx.enemyDeath` — beast kill
- `sfx.cast` — spell cast
- `sfx.arrowFly` — ranged shot
- `sfx.blink` — teleport spell
- `sfx.heal` — healing effect
- An adaptive tension drone (`startDrone`/`setDroneIntensity`) that changes pitch/intensity based on nearby threat.

No music tracks; the drone + SFX layer is the only audio.

---

## 8. Current Player Experience

### What works well
- **Depth and band gates feel like real milestones.** The guardian fights at Stages 4 and 8 create pacing beats, and the boon choice after each kill is satisfying.
- **Charged swing has a nice risk/reward.** Holding Space for the multiplier is readable and rewarding.
- **The atmospheric layering is strong.** God rays, pollen motes, mist, torch glow, and fog of war all work together to create a consistent mood.
- **Loot floaters give instant feedback** on harvesting that makes gathering feel tactile.
- **Fog of war + limited sight** makes the forest feel genuinely dangerous rather than a transparent grid.
- **The AG / EN stats have clear, felt impact.** Investing in Agility visibly speeds up the run.

### What feels awkward or confusing
- **Charge timing is implicit.** There is no visible charge bar or animation — players must mentally count the ~480 ms hold duration. First-time players will often release too early or too late without knowing why damage varied.
- **Context-sensitive Act can mismatch.** If a beast and a node are both adjacent, the priority rules in `act()` determine which is targeted, but the player has no UI indicator of what will happen before they press the key.
- **Exit tile is not visually obvious.** There is no clear landmark for the stage exit — players may wander hunting it.
- **Dash direction is tied to facing.** A player who has their back to a wall cannot dash away from an incoming beast without first moving to reface, which can feel unfair given the tight windup window.
- **Death split (50%) can feel punishing on long runs.** Losing half a haul after 8+ stages of gathering is a harsh cliff with no incremental safety valve.
- **No explicit spell UI.** The 1–4 keybinds are not shown anywhere in the HUD. New players will not discover spells without external explanation.
- **Shrine RNG can feel hostile.** The Disturbed Den outcome (spawns a guardian beast with no warning) is the same UI interaction as a helpful cache — the negative outcome is a surprise with no readable tell.

### What feels polished
- Beast telegraph ring (360 ms windup with visual glow) is well-tuned — readable but tight.
- Screen shake and damage numbers are restrained and not overwhelming.
- Tile art variant selection (deterministic by cell hash) prevents visual repetition without random reshuffling on re-renders.
- The smooth camera interpolation makes movement feel fluid despite the grid step system.

### What feels unfinished
- Touch controls exist (`ForestControls.tsx`) but spell casting (1–4) has no touch UI equivalent — spells are keyboard-only.
- The ranged shot tracer (0.18 s) is very brief and easy to miss.
- The adaptive tension drone exists in `sfx.ts` but it is unclear whether `setDroneIntensity` is actively wired to nearby beast proximity in the overlay.
- Boon descriptions in the choice panel exist but there is no visual preview of numeric effect on the player's current stats.
- The `bestForestScore` score metric is tracked but not clearly explained in the UI — it is unclear what "score" means in this context.

### Pacing
- Early stages (1–3) are slow: light beast density, short paths to exits, low threat. The run picks up significantly at Stage 4 with the first guardian fight.
- Deepwood (4–7) is where the game feels most alive: Shadow Lynx adds fast aggression, boon system is active.
- Ancient Heart (8+) is the endgame loop — players who reach it are comfortable with the systems.
- The gap between Stages 1–3 and Stage 4+ is steep. Players who die before Stage 4 may find the early game boring; those who reach Stage 4 unprepared may find the guardian overwhelming.

---

## 9. Known Issues or Weak Points

1. **No charge feedback UI.** Players cannot see charge progress — there is no bar, glow, or sound cue until the hit fires. (`useForestLoop.ts` tracks `chargeCount` but does not expose it to the overlay.)

2. **Act priority opaque to player.** `act()` in `forest.ts` has internal priority logic (beast > node > tree) but nothing in the HUD communicates which action will fire.

3. **Spell bindings not shown in UI.** Keys 1–4 are the spell slots but no in-game element surfaces this information.

4. **Touch spells missing.** `ForestControls.tsx` has D-pad + act + dash, but no spell buttons. Mobile players cannot cast spells.

5. **Shrine outcome surprise.** All shrine interactions have the same activation UI, but Disturbed Den spawns a hostile guardian beast on the player's position — this is not telegraphed and can cause instant death with no counterplay.

6. **Dash is direction-locked to facing.** Cannot dash backward or sideways relative to facing direction without spending a move tick to reface.

7. **No mini-map or exit indicator.** Players on large late-game maps (57×57) spend significant time hunting the exit tile after clearing the guardian.

8. **Death penalty cliff.** Losing 50% haul on death with no checkpoints creates a single failure point on long runs. No incremental banking mechanic exists mid-run.

9. **Score metric undefined in UI.** `bestForestScore` is tracked but the formula and display are unclear to the player.

10. **Adaptive drone wiring uncertain.** `setDroneIntensity` exists in `sfx.ts` but it is not verified whether the overlay actively updates drone intensity based on beast proximity or threat level.

11. **Large files with mixed concerns.** `ForestRunOverlay.tsx` at ~1146 lines handles rendering, VFX management, overlay panels, and HUD in a single component — difficult to maintain and test.

12. **No test coverage for the overlay or control loop.** Tests exist for `forest.ts` pure functions, but `useForestLoop.ts` and `ForestRunOverlay.tsx` have no test coverage.

13. **Co-op desync risk on shrine events.** Shrine events have RNG outcomes. It is unclear whether shrine activation is host-authoritative or can desync between players.

---

## 10. Improvement Opportunities

### Controls and input
- Add a visible charge bar or animation cue (glow on the player sprite, pulsing ring) that fills over the 480 ms hold window.
- Allow directional dash (dash in any cardinal direction regardless of facing, using the direction input held at dash time).
- Add spell buttons to the touch control layout (`ForestControls.tsx`).
- Show a context tooltip above the Act button indicating what the next act will do (Attack / Harvest / Chop).

### Clarity and feedback
- Surface the 1–4 spell bindings in the HUD as a small hotbar showing spell icons and MP costs.
- Add a visual distinction for shrine outcomes before activation (e.g., skull icon for Disturbed Den, gold bag for Cache, star for Blessing).
- Clarify what `bestForestScore` measures and display the formula somewhere in the UI.
- Show the exit tile with a distinctive visual (glowing archway, distinct tile sprite, or edge highlight).

### Mechanics
- Add a mid-run banking option (e.g., "mark a cache" or "send haul ahead") to create incremental safety valves without removing death risk entirely.
- Add bidirectional/free-direction dash decoupled from facing.
- Introduce subtle boon preview on the choice panel (e.g., "Iron Arm: your melee damage is currently X, will become Y").
- Tune the Stage 1–3 ramp to better bridge into the Stage 4 guardian fight — possibly introduce a mini-boss at Stage 2 or earlier beast variety.

### Difficulty curve
- Give the Deepwood and Ancient bands a more gradual introduction at the transition stage rather than the abrupt spike at Stage 4.
- Consider a difficulty slider or optional "hard mode" for experienced players who find early stages trivial.

### Visuals and audio
- Wire `setDroneIntensity` to live beast proximity so the ambient drone reacts to threat level.
- Add a ranged shot impact effect on the target tile (brief flash) to make ranged combat feel more impactful.
- Add a distinct ambient track or evolving drone for each band tier (Thicket → Deepwood → Ancient Heart).
- Animate the boon choice card selection with a brief deal-animation.

### Code quality
- Split `ForestRunOverlay.tsx` into sub-components: `ForestBoard`, `ForestHUD`, `ForestBoonPanel`, `ForestVFX`.
- Move VFX state (`damageFloats`, `lootFloats`, `harvestPops`) to a dedicated hook.
- Add integration tests for `useForestLoop.ts` input handling.
- Ensure shrine co-op RNG is host-authoritative.

### Integration with larger game
- Tie forest material drops more explicitly to crafting unlocks so players understand why they're gathering specific materials.
- Consider adding a Forest-specific daily trial or score challenge that feeds into the Skill Trials system.

---

## 11. Questions and Unknowns

1. **What formula drives `bestForestScore`?** The store updates it in `endForest()` but the scoring formula is not immediately visible in the engine — is it based on stages reached, haul value, kills, or a combination?

2. **Is `setDroneIntensity` actively called from the overlay?** The `sfx.ts` function exists, but it is unclear from the overlay code whether it is wired to dynamically update based on nearby beast count or HP.

3. **How does shrine co-op work?** Shrine activation involves an RNG roll for the outcome. Is this roll resolved by the host and broadcast, or is it computed locally on each client — which could desync?

4. **Is there a hard depth cap?** The map grows by 4 cells per band, and Stage 8+ starts the Ancient Heart loop. Is there a maximum stage number, or does the run continue indefinitely until death/banking?

5. **What determines the boon pool offered?** `rollBoonChoices` from `content/boons.ts` selects 3 boons, but is the pool filtered by boons already active? Can the same boon appear twice in separate guardian kills, and does it stack?

6. **How is the exit tile placed?** `generateForest()` places an exit, but the specific placement logic (always at max distance from spawn? random?) is not documented and affects late-game navigation difficulty.

7. **Are there weapon-type restrictions in the forest?** The `act()` function references both melee and ranged paths, but whether a player's equipped weapon determines which fires (or if both are always available) is not explicit from the summary.

8. **What happens to `pendingBoonChoices` if the app is closed during choice?** The boon panel pause state is persisted in `ForestState`. Does the choice panel correctly re-appear on reload?

9. **Is there a damage cap or enemy HP scale?** As stages increase beyond 8, do beast HP values scale, or are they fixed by species type in `content/forest.ts`?

10. **How does the `bestForestScore` compare across players in co-op?** Is it updated for both host and guest independently, or does the session have a shared score?
