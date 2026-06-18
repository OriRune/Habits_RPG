# Wild Forest Minigame Analysis

*Updated after Phase 1–5 improvements. Reflects current codebase state.*

---

## 1. Basic Summary

Wild Forest is a real-time top-down grid crawler minigame. The player navigates a procedurally generated maze-forest, harvesting resource nodes, hunting or avoiding beasts, and descending through progressively deeper "band" stages. It costs **2 energy** to enter (the cheapest minigame in the game) and is the primary source of crafting materials (leather, cloth, herbs, crystals, amber resin) and a significant source of gold.

Within the larger game, Wild Forest feeds the crafting economy and is the main use-case for the Agility (AG) and Endurance (EN) stats — AG controls dash cooldown and movement speed, EN controls stamina pool. The entrance screen now surfaces both stat values and their effect so players understand the connection before entering. The minigame sits alongside the Deep Mine as a second real-time dungeon crawl mode that shares a large body of infrastructure (`src/engine/crawl.ts`).

---

## 2. Core Game Loop

### Start
The player opens the Forest from the `ForestView` entrance screen, which shows current energy, deepest stage reached, best score, band-specific material drops, and the player's AG and EN stat levels. Pressing "Enter the Forest" deducts 2 energy and calls `beginForest()` in the store, which generates the first stage map and launches `ForestRunOverlay`.

### Repeating loop
Each tick of `useForestLoop` (driven by `requestAnimationFrame`):

1. **Move** — WASD/arrow input is consumed from a queue at a rate scaled to the player's AG stat (150 ms/step baseline, down to ~100 ms at high AG).
2. **Act** — Space or Enter triggers a context-sensitive action: melee attack on adjacent beasts, ranged shot at nearby targets, harvest a resource node, or chop a tree. A 240 ms cooldown gates act spam. The HUD now shows a live hint indicating what the next Act will do.
3. **Dash** — Shift dash moves two tiles instantly, grants i-frame immunity, and fires in the **currently held direction key** (not the last-pressed direction). Falls back to `player.facing` when no direction is held. Cooldown is AG-scaled (800–2000 ms).
4. **Spells** — 1–4 cast spells (rune traps, ring of fire, teleport, etc.) that cost MP and produce immediate effects.
5. **Beast tick** — Every 120 ms the store's `forestTick()` advances beast pathfinding, contact damage, DoTs, and status effects.

### Challenge escalation
- Each subsequent stage uses a larger map (base 33×33, +4 cells per band tier).
- New beast species appear at depth gates: **Gray Wolf** at Stage 2, **Alpha Boar** at Stage 3 (a tougher Boar variant added to bridge the pre-guardian difficulty), **Forest Bear** at Stage 5, **Shadow Lynx** in Deepwood, **Grove Wraith** in Ancient Heart.
- Stages 4 and 8 each have a mandatory guardian fight (Grove Sentinel, Ancient Guardian) that must be killed to advance. On descent into a guardian stage, a screen shake + audio cue (`arenaBossPhase`) + "⚔ A guardian prowls this depth" banner announces the threat.

### End conditions
- **Death** — HP reaches zero. The player keeps 50% of accumulated haul (`FOREST_DEATH_KEEP = 0.5`). A death summary overlay shows the split and the run score.
- **Banking** — The player manually retreats via "Bank & leave". Keeps 100% of haul. Banking summary shows the full haul and run score.
- **Guardian defeat** — Each guardian kill grants a boon choice (3 cards animated in with a staggered deal). The run resumes after the player picks.

### Rewards
- **Materials**: leather, game_meat, pelt, flower_petals, cloth, crystals, amber_resin — from nodes and beast kills.
- **Gold**: scattered node/shrine yields and beast bounties.
- **Score**: `+10 × stage` per kill, `+100 × stage` on each advance. Shown on both banking and death summaries.
- **Persistent records**: `deepestForestStage` and `bestForestScore` are saved to the store.

---

## 3. Player Controls and Interaction

### Keyboard
| Key | Action |
|-----|--------|
| W / A / S / D (or arrow keys) | Move in the four cardinal directions |
| Space / Enter | Act (attack, harvest, chop) — hold ~480 ms for charged swing |
| Shift | Dash in currently held direction (or facing if nothing held) |
| 1 / 2 / 3 / 4 | Cast equipped spells |

### Touch (mobile)
`ForestControls.tsx` renders a D-pad (3×3 grid) for movement, a large "Act" button with a scissors icon, a "Dash" oval, and — when the player has any spells equipped — a spell button row below the D-pad. Each spell button shows the key binding [1]–[4], the spell name, and MP cost. Buttons gray out when MP is insufficient. All controls use pointer events for continuous hold recognition.

### HUD elements (`ForestRunOverlay.tsx`)
- **Depth / band name** — stage number and band tier (Thicket / Deepwood / Ancient Heart).
- **Guardian / boon badges** — active guardian tag (⚔) and boon icons with names as tooltips.
- **HP / Stamina / MP gauges** — live bars with label.
- **Charge bar** — a thin amber strip that fills over the ~480 ms Space-hold window. Updated imperatively each rAF frame via a direct DOM ref (`chargeBarRef`) — no React re-renders at 60 fps.
- **Act context hint** — a small colored label below the gauges: "⚔ attack" (red), "✿ harvest" (green), "✦ activate shrine" (gold), "▼ push deeper" (emerald), "🪓 chop" (amber). Computed each render via `pendingActKind(forest)` from `src/engine/forest.ts`.
- **Haul chips** — running total of materials and gold accumulated in the current run.
- **Spell hotbar** — below the haul strip; shows spell icons, key bindings [1]–[4], and MP costs. Hidden when the player has no spells.
- **Fog of war** — tiles are dark until explored; explored-but-not-visible tiles are dimmed.
- **Torch glow** — radial gradient centered on the player (3–4 tile radius, expanded by Lantern boon).
- **Beast telegraphs** — red ring with glow appears 360 ms before contact damage lands.

### Overlay panels
- **Boon choice panel** — pauses the run; 3 cards animate in with a staggered 75 ms deal (`boon-deal-in` keyframe). Player must pick one.
- **Banking summary** — shows full haul and run score; confirms departure.
- **Death summary** — shows split haul (50% kept / 50% lost) and run score.

### Feedback
- **Visual**: damage floaters (red/amber numbers), loot floaters, harvest pop (green circle), dash ring, screen shake on hit/dash. Shrine tiles are now color-coded: gold border for Cache, green for Blessing, red for Disturbed Den. The treeline exit tile pulses with `forest-shaft-pulse` and has a bright emerald border glow. Guardians show an amber 5 px HP bar from full health; regular beasts show a 3 px red bar only once damaged.
- **Audio**: `sfx.swing`, `sfx.hit`, `sfx.playerHurt`, `sfx.enemyDeath`, `sfx.cast`, `sfx.arrowFly`. Adaptive tension drone (`sfx.startDrone` / `sfx.stopDrone` / `sfx.setDroneIntensity`) is now wired to the run — starts on overlay mount, stops on unmount, and intensity updates from nearby awake predator count and windup state. Guardian arrival plays `sfx.arenaBossPhase`.

### Entrance screen (`ForestView.tsx`)
Shows energy cost, deepest stage, best score, current band material drops (with crafting tier context), AG and EN stat levels with descriptions ("speed & dash", "stamina pool"), and a milestone hint that now mentions Alpha Boar at Stage 3 and crystal/amber resin crafting gates.

---

## 4. Mechanics and Systems

### Movement
Grid-based, cardinal only. One tile per move interval (150 ms baseline, reduced by AG). Stamina drains per step (formula shared with mining: `dungeonStamina()` = `50 + EN`). Stamina regenerates at 1 tick per 1200 ms when stationary.

### Dash (`tryDash()` in `forest.ts`)
Moves 2 tiles in the chosen direction instantly; grants i-frame immunity for the dash duration. **Direction resolution** (changed): uses the currently held direction key — checked as `lastDir.current && held.current.has(lastDir.current)` or the first item in `held.current` — and falls back to `run.player.facing` only if no key is held. This decouples escape dashes from the last movement direction. Cooldown: `dashCooldown()` from `crawl.ts` (800–2000 ms, AG-scaled). Quick Dash boon reduces further.

### Attack / Act (`act()` in `forest.ts`)
Context-sensitive, priority determined by `pendingActKind()`:
1. Treeline (advance) → stage transition
2. Adjacent beast → melee or ranged attack
3. Standing on shrine → shrine activation
4. Faced node tile → harvest
5. Faced tree tile → chop

The HUD now exposes this resolution to the player before they press Space.

### Charged swing
Hold Space ~480 ms (2 × `ACT_INTERVAL_MS = 240 ms`). A visible amber charge bar in the HUD fills in real time via an imperative rAF loop reading `controls.chargeProgressRef.current`. The hook exposes this ref without triggering React re-renders. Multiplier: `CHARGE_DAMAGE_MULT = 1.75`. Staggers the target beast. Overcharge boon reduces required hold count from 2 to 1.

### Combat (`stepBeasts()` in `forest.ts`)
- **Predators** path toward the player via BFS flow field (`flowStep()`).
- **Prey** flee away.
- **Contact damage** uses a 360 ms windup telegraph (red ring with glow). I-frame (dash) blocks it.
- **Status effects**: burn (DoT 1.5 s ticks), poison, freeze (3 s), bless (+4 defense), weaken, blind.
- **Runes**: fire/ice/poison traps trigger on beast contact.
- **Ring of fire**: 8 s aura, 600 ms hit cooldown.

### Beast roster and difficulty ramp
| Stage range | New threats |
|-------------|-------------|
| 1–2 | Forest Deer (prey), Wild Rabbit (prey), Wild Boar |
| 2+ | Gray Wolf (faster, more damage than Boar) |
| 3+ | **Alpha Boar** — 22 HP, 8 touch damage, 480 ms cadence (added to bridge Stage 3 → Stage 4 guardian) |
| 3+ | Forest Spider |
| 4 | Grove Sentinel (guardian, 40 HP) |
| 5+ | Forest Bear (30 HP, defense 2) |
| 4–7 | Shadow Lynx (Deepwood band) |
| 7+ | Dire Wolf |
| 8 | Ancient Guardian (55 HP, defense 5) |
| 8+ | Grove Wraith (Ancient Heart band) |

### Map generation (`generateForest()` in `forest.ts`)
Recursive-backtracker maze. Base 33×33 at Stage 1, grows +4 cells per band tier (max 57×57). Alpha Boar has no band restriction (`stageMin: 3`) so it appears across all bands from Stage 3 onward.

### Guardians
Placed once per run on their exact stage (`FOREST_GUARDIAN_STAGES: { 4: 'grove_sentinel', 8: 'ancient_guardian' }`). Not in the random spawn pool. Show a 5 px amber HP bar from full health (previously hidden until damaged). On descent into a guardian stage, the overlay fires `sfx.play('arenaBossPhase')`, calls `shake(8, 450)`, and shows a "⚔ A guardian prowls this depth" amber banner using the `boon-deal-in` + `forest-guardian-alert` animations.

### Boon system
Guardian kills pause the run and show 3 card choices from `content/boons.ts`. Cards animate in with `animation: boon-deal-in 0.22s ease-out ${i * 75}ms both`. Active boons are stored in `ForestState.activeBoons: string[]`.

### Shrine events (`forestShrine()`)
Three outcomes: gold + material (Cache, gold glow), temporary bless buff (Blessing, green glow), or Disturbed Den (spawns Forest Bear, red glow). Shrine tiles are now color-coded by kind using `SHRINE_KIND_BORDER` and `SHRINE_KIND_GLOW` lookup tables in the overlay. The different glyphs (📦 ✨ 🕳) combined with the color coding make outcome types readable before activation.

### Fog of war
Each cell tracks `seen` and `visible` flags. Sight radius 3 base (4 in clearings), +1–2 with Lantern boon.

### Loot and economy
- **Nodes**: herbs, cloth, gold, crystals (Stage 4+), amber_resin (Stage 8+).
- **Beasts**: leather default, game_meat (deer), pelt (rabbit), custom per-beast.
- **Guardians**: guaranteed treasure (gold + next-band preview materials).
- **Death split**: `splitHaul()` keeps 50% of all materials and gold.

### Score (`ForestState.score`)
Formula is `+10 × stage per kill` and `+100 × stage per stage advance`, documented in a comment on the field. Now displayed on banking and death summary overlays.

### Win / loss
No hard "win" — run continues until death or voluntary banking. `deepestForestStage` updates whenever the player sets a new record.

### Larger-game stats that affect the minigame
| Stat | Effect |
|------|--------|
| AG (Agility) | Move speed, dash cooldown |
| EN (Endurance) | Stamina pool size |
| ST (Strength) | Melee damage |
| DX (Dexterity) | Ranged damage |
| WI (Wisdom) | Spell damage and beast weaknesses |
| HP (Hit Points) | Starting HP pool |
| Defense (gear) | Damage reduction |

---

## 5. Technical Implementation

### Key files

| File | Role |
|------|------|
| `src/engine/forest.ts` | Pure game logic (~1625 lines): map gen, movement, combat, spells, loot, advance |
| `src/engine/crawl.ts` | Shared infrastructure (~403 lines): BFS pathfinding, runes, status effects, camera math |
| `src/content/forest.ts` | Balance config (~250 lines): node types, beast stats (incl. alpha_boar), shrine events, band gates |
| `src/content/boons.ts` | Boon definitions |
| `src/store/useGameStore.ts` | Store actions for forest (lines ~2100–2366): begin/end/tick/co-op |
| `src/hooks/useForestLoop.ts` | Real-time rAF control loop (~255 lines): input, charge detection, co-op routing |
| `src/components/forest/ForestRunOverlay.tsx` | Full rendering and VFX system (~1200 lines) |
| `src/components/forest/ForestControls.tsx` | Touch D-pad + act + dash + spell buttons (~110 lines) |
| `src/views/ForestView.tsx` | Entrance screen (~95 lines) |
| `src/lib/minigameArt.ts` | Sprite registry: forest tree/floor/node variants |
| `src/lib/sfx.ts` | Web Audio synthesis for all SFX |
| `src/lib/sprites.ts` | Sprite and crest lookup system |
| `src/index.css` | CSS keyframes including `boon-deal-in`, `forest-guardian-alert` |

### Important functions

**`generateForest(stage, rng, character)` — `forest.ts`**
Entry point for map creation. Generates maze, places clearings, scatters nodes/beasts by band, places guardian if stage matches `FOREST_GUARDIAN_STAGES`, adds shrines and boon caches.

**`pendingActKind(state)` — `forest.ts`** *(new)*
Pure helper; returns `'advance' | 'attack' | 'shrine' | 'harvest' | 'chop' | 'none'` based on current player position and adjacent tiles/beasts. Used by the overlay's HUD act-hint and the `ACT_HINTS` label table. Type alias `PendingActKind` is also exported.

**`tryDash(state, dr, dc, character, nowMs)` — `forest.ts`**
Two-tile dash with i-frame. Direction is now supplied by the hook based on held keys, not the last-pressed direction.

**`act(state, character, nowMs)` — `forest.ts`**
Context-sensitive action; priority is beast → node → tree. `pendingActKind()` exposes this priority to the UI without duplicating the logic.

**`stepBeasts(state, character, nowMs)` — `forest.ts`**
Main combat tick; advances all beast positions, processes contact damage, DoT ticks, rune triggers.

**`splitHaul(haul, keepFraction)` — `forest.ts`**
Returns two haul objects for the death penalty split (50% kept).

**`floodField(grid, sources, maxDist)` — `crawl.ts`**
BFS distance map; drives beast pathfinding via `flowStep()`.

**`forestTick(nowMs)` — `useGameStore.ts`**
Calls `stepBeasts()`, writes result back to `state.forest`. Called every 120 ms by the loop.

**`beginForest()` — `useGameStore.ts`**
Deducts 2 energy, generates Stage 1, sets `state.forest`.

**`endForest(outcome)` — `useGameStore.ts`**
Commits haul to inventory, updates `deepestForestStage` and `bestForestScore`, clears `state.forest`.

### New / changed in this update

**`useForestLoop.ts`** — `chargeProgressRef: { readonly current: number }` is now part of the `ForestControlsApi` interface and is updated each rAF frame inside the existing loop:
```ts
chargeProgressRef.current =
  spaceDownAt.current !== null && !chargeConsumed.current
    ? Math.min(1, (now - spaceDownAt.current) / (effectiveChargeCount * ACT_INTERVAL_MS))
    : 0;
```
Dash direction resolution changed from `lastDir.current ?? run.player.facing` to a held-key check:
```ts
const heldDir =
  lastDir.current && held.current.has(lastDir.current) ? lastDir.current
  : held.current.size > 0 ? [...held.current][0]
  : null;
const dir = heldDir ?? run.player.facing;
```

**`ForestRunOverlay.tsx`** — New module-level constants:
```ts
const SHRINE_KIND_BORDER: Record<ShrineEventKind, string>  // per-kind box-shadow
const SHRINE_KIND_GLOW:   Record<ShrineEventKind, string>  // per-kind glyph filter
const ACT_HINTS: Partial<Record<PendingActKind, { text: string; color: string }>>
```
New refs: `chargeBarRef`, `prevGuardianStageRef`.
New state: `guardianAlert: number` (timestamp).
New effects (5 total added):
1. Drone start/stop on mount/unmount (`sfx.startDrone`, `sfx.stopDrone`).
2. Drone intensity update from nearby beast state (runs every render; sets 0 when not active).
3. Charge bar imperative DOM update via rAF (reads `controls.chargeProgressRef.current`, writes `chargeBarRef.current.style`).
4. Guardian arrival alert on `forest.stage` change.
5. Stage-change wipe (pre-existing, unchanged).

**`ForestControls.tsx`** — Added `useGameStore` and `getSpell` imports. Added spell button row (conditionally rendered when `forest.knownSpells.length > 0`).

**`ForestView.tsx`** — Added `bandMaterials()` helper returning band name + material list. Updated `milestoneHint()` to mention Alpha Boar at Stage 3 and tie milestones to crafting tiers. Added AG/EN stat display row with plain-language effects.

**`content/forest.ts`** — Added `alpha_boar` beast definition (Stage 3+, 22 HP, 8 damage, 480 ms cadence, weak to ST).

**`index.css`** — Added two keyframe animations:
```css
@keyframes boon-deal-in { from { opacity:0; transform: translateY(10px) scale(0.92) } to { opacity:1; transform: none } }
@keyframes forest-guardian-alert { 0%{opacity:0} 12%{opacity:1} 65%{opacity:1} 100%{opacity:0} }
```

### State management
`ForestState` (defined in `forest.ts`) is a plain object held in `useGameStore.forest`. The `score: number` field was already present; it is now surfaced in summaries. No new fields were added to `ForestState`.

### Data flow
```
useForestLoop (rAF)
  → reads keyboard/pointer input, updates chargeProgressRef each frame
  → dispatches store actions (forestMove, forestAct, forestTick, forestCast...)
    → store calls pure engine functions (tryMove, act, stepBeasts, pendingActKind...)
      → returns new ForestState
    → store writes new state
  ← ForestRunOverlay reads new state via Zustand selectors → re-renders
  ← chargeBarRef DOM update loop reads chargeProgressRef → imperative style writes (no re-render)
```

### Co-op integration
Unchanged from before. Host runs authoritative beast simulation; guest runs client-side tick. Tile harvests broadcast as `type: 'tile'`; guest melee as `type: 'attack'`. Per-stage seeds are deterministic (`mulberry32(floorSeed(baseSeed, stage))`).

### Save / load behavior
All `ForestState` is persisted via Zustand `persist` middleware. No new fields were added, so no migration is needed. `withCharacterDefaults` backfills missing fields on old saves.

### Configuration constants

| Constant | Location | Value |
|----------|----------|-------|
| `FOREST_ENERGY_COST` | `forest.ts` | 2 |
| `FOREST_DEATH_KEEP` | `forest.ts` | 0.5 |
| `FOREST_WINDUP_MS` | `forest.ts` | 360 |
| Base map size | `forest.ts` | 33×33 |
| `ACT_INTERVAL_MS` | `useForestLoop.ts` | 240 |
| `CHARGE_SWING_COUNT` | `crawl.ts` (via import) | 2 |
| `VIEW` (viewport) | `crawl.ts` | 11×11 |
| `STA_REGEN_MS` | `crawl.ts` | 1200 |
| `CHARGE_DAMAGE_MULT` | `crawl.ts` | 1.75 |
| Score per kill | `ForestState.score` comment | `+10 × stage` |
| Score per advance | `ForestState.score` comment | `+100 × stage` |

---

## 6. Software, Libraries, and Tools Used

Unchanged from previous analysis:

- **Language**: TypeScript (strict mode)
- **Framework**: React 18
- **Build tool**: Vite
- **State management**: Zustand with `persist` middleware (localStorage)
- **Styling**: Tailwind CSS
- **Rendering**: HTML/CSS (absolutely positioned `<div>` tiles). No canvas, no WebGL.
- **Animation**: CSS transitions + `requestAnimationFrame` via `useSmoothCamera`. Charge bar uses a dedicated imperative rAF loop to avoid 60 fps React re-renders.
- **Audio**: Web Audio API, synthesized in `src/lib/sfx.ts`. All SFX are procedural. Adaptive drone now actively wired to beast threat level.
- **Physics / collision**: Custom BFS in `crawl.ts`.
- **Pathfinding**: BFS flood-fill (`floodField`, `floodFieldMulti`, `flowStep`).
- **RNG**: `mulberry32` seeded PRNG.
- **Sprite assets**: Auto-discovered PNG files via Vite `import.meta.glob`.
- **Testing**: Vitest. Forest engine tests: `src/engine/__tests__/forest.test.ts` (47 tests, all passing).

---

## 7. Assets and Presentation

### Visual style
DOM-based rendering with styled `<div>` elements. Oversized tree sprites (1.45–2.0×) bottom-anchored for depth. The overall mood is a damp, twilight forest.

### Tiles
- **Floor**: grass (2 variants) in clearings, dirt (2 variants) on trails, selected deterministically by cell hash.
- **Thicket / walls**: 16 tree sprite variants.
- **Nodes**: flower_bush, cotton_plant, toadstool, cave_crystal_1 sprites.
- **Shrines**: glyph (📦 ✨ 🕳) with kind-specific glow color and border: gold (Cache), green (Blessing), red (Disturbed Den).
- **Treeline** (exit): pulsing Trees icon with bright emerald glow and emerald border; `forest-shaft-pulse 2s` animation.
- **Runes**: ✦ glyph colored orange/cyan/green with CSS glow.

### Beasts
Emoji glyph centered on tile. Damaged regular beasts show a 3 px red HP bar. **Guardians** show a 5 px amber HP bar from full health (always visible when awake). Frozen beasts show a blue ring; winding-up beasts show a red telegraph ring.

### Player
`CrawlerAvatar` component with direction and motion variants.

### Visual effects (all CSS/DOM)
- **Damage floaters**: red/amber numbers rising and fading (0.85 s).
- **Loot floaters**: gold/material icon, 0.9 s.
- **Harvest pop**: green expanding circle, 0.55 s.
- **Dash ring**: green expanding ring, 0.4 s.
- **Screen shake**: amplitude varies by event.
- **Ranged shot tracer**: 0.18 s arrow streak.
- **Boon deal animation**: `boon-deal-in` — cards slide up + scale in, staggered 75 ms.
- **Guardian arrival**: red/amber overlay flash using `forest-guardian-alert` (1.8 s fade-in-hold-fade), + amber text banner using `boon-deal-in`.

### Ambient atmosphere
- Ground mist (bottom 28%), lateral shadows (12% each side), 3 rotating god-ray shafts (8–15 s), 7 pollen/firefly motes (8–14 s). Band-tinted tile colours shift toward violet (Deepwood) and amber (Ancient Heart) via `BAND_TINTS`.

### Audio
All procedural via Web Audio:
- `sfx.swing`, `sfx.hit`, `sfx.playerHurt`, `sfx.enemyDeath`, `sfx.cast`, `sfx.arrowFly`, `sfx.blink`, `sfx.heal`.
- `sfx.arenaBossPhase` — plays on guardian stage entry.
- Adaptive drone: `sfx.startDrone` on run start; `sfx.setDroneIntensity` driven by visible awake predator count + windup state (formula: `min(1, nearby × 0.28 + windupActive ? 0.45 : 0)`); `sfx.stopDrone` on run end.

---

## 8. Current Player Experience

### What works well
- **Charge mechanic is now discoverable.** The amber charge bar fills visibly while holding Space. Players can see exactly when the charged hit will fire.
- **Shrines feel fair.** Color-coded borders (gold / green / red) make Disturbed Den identifiable before activation. The red glow reads as danger without requiring the player to memorize glyph meanings.
- **Exit tile is unmistakable.** The treeline now pulses and glows; on large late-stage maps it's visible from the edge of the fog circle.
- **Guardian HP bar adds weight to the fight.** The amber 5 px bar visible from full health signals "this is a boss encounter" immediately.
- **Act context hint removes guesswork.** The "⚔ attack" / "✿ harvest" / "🪓 chop" hint removes the prior frustration of the context-sensitive Act button producing unexpected results.
- **Dash is escape-capable.** Holding a direction while pressing Shift now reliably dashes that direction regardless of where the player was previously walking.
- **Score is concrete.** Players can now see a numeric score on summary screens and understand they're being measured on stage depth × kills.
- **Guardian arrival feels significant.** The screen shake + boss audio cue + amber banner create a brief ceremony that matches the gameplay weight of the encounter.
- **Boon choice feels earned.** The staggered card deal animation slows the moment down appropriately after a guardian kill.
- **Drone tension is real.** The adaptive drone now measurably shifts when predators are nearby, especially during windup.
- **Depth and band gates feel like real milestones.** Still true and now better signposted in the entrance screen.
- **The atmospheric layering is strong.** God rays, pollen motes, mist, torch glow, and fog of war all work together.
- **AG / EN stats have clear, felt impact**, and now the entrance screen explains this in plain language.

### What still feels awkward or confusing
- **Shrine negative outcome has no confirmation.** The Disturbed Den now has a red glow, but players can still accidentally activate it by walking onto the tile and pressing Space without reading the color. A "den stirs beneath your feet — proceed?" prompt would eliminate all ambiguity.
- **Death split (50%) is a harsh cliff.** Losing half a haul after 8+ stages with no intermediate safety valve is still the main frustration point on long runs. A mid-run haul caching option was not implemented.
- **Ranged shot tracer is brief.** The 0.18 s tracer still barely registers consciously; there's no impact effect on the target tile when the shot lands.
- **Boon choice has no numeric preview.** Cards show descriptive text ("Double gather yield") but not the player's current stat value or the before/after delta.
- **No mini-map or positional overview.** On 57×57 maps (Stage 8+) the pulsing treeline helps, but players navigating complex maze layouts can still spend time getting oriented.

### What feels polished
- Beast telegraph ring (360 ms) is well-tuned.
- Screen shake and damage numbers are restrained.
- Tile art variant selection (deterministic by cell hash) prevents visual repetition.
- Smooth camera interpolation makes grid movement feel fluid.
- Charge bar updates imperatively at 60 fps with zero React overhead.

### What feels unfinished
- The Disturbed Den has a visual tell (red glow) but no activation gate — the danger is legible but not preventable.
- `bestForestScore` is now shown on summaries but is not yet surfaced live during the run or compared to the personal best on summaries.
- The ranged shot system still needs an impact effect.
- ForestRunOverlay.tsx is now ~1200 lines — the component split described in the improvement plan was not implemented.

### Pacing
- Stages 1–3 now have more texture: Forest Spider arrives at Stage 3 alongside the new Alpha Boar, which sets up the combat vocabulary players need for the Stage 4 guardian fight.
- Stage 4 still delivers the largest single difficulty step (Grove Sentinel is a genuine boss), but the guardian arrival announcement helps players recognise what they're walking into.
- Deepwood (4–7) and Ancient Heart (8+) loops remain the most engaging states of the run.

---

## 9. Known Issues or Weak Points

The following issues from the original analysis have been **resolved**:

| Issue | Resolution |
|-------|-----------|
| No charge feedback UI | Amber charge bar in HUD, updated via imperative rAF loop |
| Shrine outcome surprise (no visual tell) | Shrine tiles now color-coded by kind (gold / green / red) |
| Exit tile not visually obvious | Treeline now pulses with `forest-shaft-pulse` and bright emerald border glow |
| Spell bindings not shown (touch) | Spell button row added to `ForestControls.tsx` |
| Dash direction-locked to facing | Dash now fires in currently held direction |
| Guardian HP bar only on damage | Guardians now show amber 5 px bar from full health |
| Score metric undefined in UI | Score shown on banking and death summaries |
| Adaptive drone not wired | Drone wired to beast proximity; wires correctly on mount/unmount |
| Stage 1–3 ramp flat before guardian | Alpha Boar added at Stage 3 |
| Act priority opaque | Act context hint shown in HUD via `pendingActKind()` |

**Remaining issues:**

1. **No activation gate for Disturbed Den.** Visual tell (red border) is present, but there is no confirmation prompt. A careless player can still trigger a guardian beast spawn by pressing Space on a red-glowing shrine.

2. **Death penalty cliff with no mid-run safety.** The 50% haul loss on death has no intermediate banking mechanism. Players who die late in a long run lose half of significant gathering with no recourse.

3. **Ranged shot underfeels.** Tracer is 0.18 s (brief); no impact effect on target tile. Ranged combat lacks the punch of melee.

4. **Boon cards lack numeric preview.** Cards show descriptive text but not the delta on the player's current stats ("melee +30%" is abstract without knowing the current value).

5. **`bestForestScore` not compared on summary.** The score is shown on summaries, but there is no "New best!" indicator or comparison to the stored `bestForestScore`.

6. **No mini-map or positional overview** for late-stage maps.

7. **`ForestRunOverlay.tsx` is ~1200 lines.** Mixes board rendering, VFX state, HUD, overlay panels, ambient effects, drone wiring, and guardian alert in a single component — difficult to maintain.

8. **No test coverage for `useForestLoop.ts`.** The hook contains the most complex timing logic in the minigame (charge detection, co-op host/guest branching, rAF scheduling) with no unit tests.

9. **Co-op shrine authoritativeness unverified.** Shrine outcome RNG may be computed locally on each client, which could desync the Disturbed Den beast spawn between host and guest.

10. **Large file concern in `ForestControls.tsx`** — now has a `useGameStore` subscription, which is reasonable but adds a dependency. Spell data could alternatively be passed as props from the overlay.

---

## 10. Improvement Opportunities

The following items from the original improvement plan were **implemented** and are no longer opportunities:
- Charge attack visual feedback ✓
- Shrine type visual differentiation ✓
- Exit tile pulsing/glow ✓
- Touch spell buttons ✓
- Act context indicator ✓
- Free-direction dash ✓
- Guardian HP bar from full health ✓
- Score display on summaries ✓
- Boon card deal animation ✓
- Adaptive drone wiring ✓
- Guardian entry announcement ✓
- Material-to-crafting hints at entry ✓
- AG/EN stat display at entry ✓
- Alpha Boar Stage 3 ramp ✓

**Remaining opportunities:**

### Controls and input
- Add Shift+direction shorthand (press Shift and a direction simultaneously) so players can dash without pre-holding a key — makes the intent even more explicit than the current hold-then-shift approach.
- Add a "confirm" step for Disturbed Den shrine activation (the red glow is a tell, but a one-step prompt would remove the last possible surprise).

### Mechanics
- **Mid-run haul caching** — a "cache haul" action at shrines or clearings that commits the current haul at slightly reduced value, creating an incremental safety valve without removing death risk.
- **Boon choice numeric preview** — pass the character snapshot into the boon panel and show the before/after delta for each choice (e.g., "Melee: 18 → 23").
- **`bestForestScore` comparison on summaries** — show "New record!" or "Best: X" on the banking/death panel.
- **Ranged shot impact effect** — extend tracer to 0.35 s and add a brief impact flash on the target tile.

### Difficulty curve
- **Deepwood transition** — the jump from Stage 3 (Alpha Boar, Spider) to Stage 4 (Grove Sentinel) is still the steepest in the game. A Stage 3.5 patrol or Sentinel preview encounter could soften it further.

### Code quality
- **Split `ForestRunOverlay.tsx`** into sub-components: `ForestBoard`, `ForestHUD`, `ForestVFX`, `ForestBoonPanel`, `ForestSummaryPanel`.
- **Extract VFX state** (`dmgPops`, `lootPops`, `pops`, `vfxPops`) to a `useForestVFX()` hook.
- **Add `useForestLoop.ts` unit tests** for charge detection, dash direction resolution, and co-op branching.
- **Audit co-op shrine RNG** to ensure the Disturbed Den beast spawn is host-authoritative.
- **Move spell props from store subscription to prop drilling** in `ForestControls.tsx` to reduce the component's store coupling.

### Integration with larger game
- **Live score in HUD** — show the running score during the run (not just on summaries) so players can optimise for it.
- **`bestForestScore` comparison on summary** — show delta vs. personal best.
- **Forest-specific daily trial** — a forest-based daily challenge (e.g., "Reach Stage 5" or "Collect 20 herbs") plugged into the Skill Trials system, making the AG habit loop more direct.

---

## 11. Questions and Unknowns

**Resolved since original analysis:**

- **Score formula** — Confirmed as `+10 × stage per kill, +100 × stage per advance` (documented in the comment on `ForestState.score`).
- **Drone wiring** — Confirmed wired: `sfx.startDrone` on overlay mount, `sfx.setDroneIntensity` on every render with a live threat calculation, `sfx.stopDrone` on unmount.
- **Exit tile placement** — Now a non-issue visually (pulsing glow makes it findable), though the placement algorithm in `generateForest()` is still not documented.

**Still open:**

1. **Shrine co-op desync risk.** Is `forestShrine()` outcome RNG resolved host-side and broadcast, or computed locally on each client? A Disturbed Den desync (beast spawns on host but not guest, or vice versa) would be a correctness bug.

2. **Hard depth cap.** Is there a maximum stage number beyond Stage 8, or does the map size cap at 57×57 and the run continue indefinitely? The constants `FOREST_MAX_ROWS = 57` and `FOREST_MAX_COLS = 57` suggest a hard cap, but the stage counter and band system don't show a ceiling.

3. **Boon stacking.** `rollBoonChoices` excludes already-held boons from the pool (`!held.has(b.key)`), so duplicates are impossible. But if a boon is already active, can the same effect be applied by a different boon key that shares the effect reducer?

4. **Weapon-type restrictions in act().** Whether the player's equipped weapon determines which branch of `act()` fires (melee vs. ranged) or whether both are always available is not explicit in the available code surface. The `weapon.attackStat` field is checked in the co-op guest path (`run.weapon.attackStat === 'DX'`), suggesting this drives the melee/ranged split.

5. **`pendingBoonChoices` on app reload.** `forest.status === 'choosing'` and `pendingBoonChoice` are persisted. On reload mid-choice, the boon panel should re-appear correctly — but whether the staggered deal animation triggers correctly on a resumed state (vs. a fresh choice) has not been tested.

6. **Beast HP scaling beyond Stage 8.** Beast stats in `content/forest.ts` are fixed by species. As stage number grows beyond 8 within the Ancient Heart loop, beasts do not scale in HP or damage — only the map size grows and more Grove Wraiths can spawn. Whether this produces adequate difficulty for very high stage counts is untested.

7. **Co-op `bestForestScore` attribution.** Is the score updated for both host and guest independently on `endForest()`, or only for one player?

8. **Alpha Boar spawning density at high stages.** Since `alpha_boar` has no band restriction, it competes in the weighted spawn pool at Stage 8+. Its `stageMin: 3` and default weight mean it will appear alongside Grove Wraiths in the Ancient Heart — this may or may not be desirable and has not been tuned for that band.
