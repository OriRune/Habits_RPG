# Hex Tactics Minigame — Developer Analysis

> Generated 2026-06-18 from source at commit a27168c (feature/multiplayer branch).

---

## 1. Basic Summary

Hex Tactics is a turn-based, single-player tactical skirmish played on a procedurally generated isometric hex board. The player controls a single hero unit and defeats a roster of AI enemies to win.

It lives inside the **Battle** hub (`src/views/BattleView.tsx`), alongside the real-time Arena minigame. Access requires character level ≥ 4 and costs 3 energy per match. Wins award gold, stat XP (AG/DX/EN), and occasionally healing potions; the player's personal record is tracked as `deepestTacticsTier`.

Thematically it is the "thinking" counterpart to the Arena's reflexes test — it rewards positioning, terrain reading, and resource management rather than reaction speed.

---

## 2. Core Game Loop

### Start
1. Player opens Battle → Hex Tactics tab.
2. **Pre-match screen** (`TacticsView.tsx`): pick board size (Small/Medium/Large), select up to 3 spells from known spells for the loadout.
3. Click **Begin** → store calls `beginTactics(loadout)`, which deducts energy and calls `generateSkirmish()`.
4. `TacticsOverlay` mounts and the match begins on the player's first turn.

### Player Turn
- **Move**: select a reachable (cyan) tile and click. Movement is free (does not consume the action resource).
- **Act**: one action per turn — Strike/Shoot, cast a Spell, or Hold (Overwatch). Some spells cost MP; the attack costs Stamina.
- **End Turn**: player clicks End or exhausts available choices.

### Enemy Phase
After the player ends their turn:
1. Each status effect ticks (burn/poison DoT, freeze/blind decay).
2. Hazard tiles deal 4 damage to any unit standing on them.
3. Each living enemy executes its AI turn: move toward best position, then attack if in range.
4. Player status effects decay and player resources partially restore.
5. Threat hexes and intent telegraphs are recomputed for the new player turn.

### Difficulty Scaling
- `tier` (= `deepestTacticsTier + 1`) increases enemy count, HP, and attack values.
- Board size affects enemy spread but not their power directly.
- Procedurally generated elevation and terrain vary each run.
- A secondary objective (beacon/swift/unscathed) is rolled with ~65% probability and increases tactical pressure without changing the core win condition.

### End Conditions
- **Win**: `status === 'won'` when all enemies are dead.
- **Lose**: `status === 'lost'` when player HP reaches 0.
- Either triggers `endTactics()` → `commitTactics()` in the store.

### Rewards
From `tacticsReward()` in `src/engine/hexBattle.ts`:
- **Gold**: `40 × (1 + tier × 0.15)`, roughly 40–100 g depending on tier.
- **Healing potion**: dropped at tier ≥ 8.
- **Stat XP**: `(4 + tier)` points each to AG, DX, EN. Win gives full, loss gives 40%.
- **Secondary objective bonus**: +60% gold and a guaranteed healing potion if the objective was completed on a win.
- `deepestTacticsTier` advances if the player wins at or above their current record tier.

---

## 3. Player Controls and Interaction

### Input
All interaction is **mouse-only** — click to select, click to target. No keyboard shortcuts exist within the match itself. Board scrolling/panning is absent; the board is always fully visible and centered.

### Action Bar
Located below the board in `TacticsOverlay.tsx`. Contains:
- **Move** — selects move mode; reachable tiles highlight cyan.
- **Strike / Shoot** — selects the weapon attack; targetable enemies highlight amber.
- **Spell buttons** — one per loadout spell (labeled with name and MP cost); clicking selects target mode.
- **Hold ⌖** — arms Overwatch reaction stance.
- **End Turn** — passes to enemy phase.
- **Retreat** — exits the match immediately (treated as a loss for reward purposes).

### HUD (Top)
- **Turn indicator** — "Your Turn" / "Enemy Turn" banner.
- **Player gauges** — three mini bars: HP (red), MP (blue), Stamina (orange), each with numeric value.
- **Status badges** — emoji row of active statuses (e.g., 🔥 burn, ❄️ freeze).
- **Threat zone toggle** (Shield icon) — overlay red tint on all tiles any enemy can reach-and-attack-from.
- **Intent arrows toggle** (Eye icon) — show predicted enemy movement and attack arrows for next enemy phase.
- **Archetype legend** — colored dots labeling charger/kiter/holder/flanker with tooltip.

### Context Area (Below Action Bar)
Displays contextually: hover preview (damage estimate) when cursor is over a valid target, move hints when in move mode, or the last 4 lines of the battle log otherwise.

### Hover Preview (`PreviewBadge`)
When the player hovers over a targetable tile while an attack or spell is selected:
- Shows min–max damage bracket.
- Shows height advantage % modifier.
- Shows cover/guard mitigation.
- Shows weak/resist flag (⬆/⬇).
- Flags **LETHAL** in red if minimum damage would kill.

### Feedback
- Floating damage numbers rise from struck units (red = player took damage, amber = enemy took damage, green = heal).
- Battle log (`log[]`) tracks the last ~8 lines; 4 are shown in the UI.
- Unit HP bars update immediately.
- Intent arrows telegraph where each enemy plans to move and who they plan to attack before the player ends their turn.

---

## 4. Mechanics and Systems

### Movement
- Budget: `moveTilesFor(ag) = Math.min(6, 2 + floor(ag/4))`. At AG 0: 2 tiles; at AG 16: 6 tiles.
- Climb cap: `climbFor(ag) = Math.min(3, 1 + floor(ag/8))`. Limits how many elevation levels the player can ascend per move step.
- `computeReachable()` (`hexBattle.ts`) runs a Dijkstra BFS over the hex graph. Slow tiles cost 2 movement; blocked/wall tiles are impassable; occupied tiles are skippable but not stoppable.
- Movement does not consume the action — the player may move then act, or act then move, or move only.

### Elevation
- `MAX_ELEVATION = 3`. Tiles have integer heights 0–3.
- Height advantage on attack: `heightDamageMult(dz) = 1 + 0.12×dz`, clamped [0.64, 1.36]. +36% damage at full high ground, −36% shooting upward.
- Ranged height bonus: `heightRangeBonus(dz) = dz`, clamped [0–2]. Extra tiles of effective range from high ground.
- Enemies scale the same formulas.

### Terrain
| Type | Effect |
|------|--------|
| `floor` | Normal |
| `cover` | +3 flat defense while standing |
| `slow` | Costs 2 movement to enter |
| `hazard` | 4 damage at end of any turn spent on it |
| `blocked` | Impassable wall |

### Line of Sight
`hasLineOfSight(state, a, b)` traces `hexLineBetween(a, b)` and blocks if any intermediate hex is a wall, has elevation too much higher than both endpoints, or is occupied by a unit (enemy or player).

### Combat Resolution
**Weapon attack** (`playerAttack`):
1. Compute base damage from character snapshot (`meleePower` or `rangedPower`).
2. Apply height multiplier.
3. Apply cover defense (−3 if target is on cover tile).
4. Apply target guard bonus (enemies can spend a move to guard, +guardBonus).
5. Apply weak/resist multipliers from `enemy.weakTo` / `enemy.resistTo`.
6. Roll variance: ±20% random spread via RNG.
7. Clamp to minimum 1.

**Spell cast** (`playerCastSpell`):
- School `damage`: base `spell.power + damageSpell` stat, reduced by enemy `ward`.
- School `support` with `power > 0`: heals player for `power + supportSpell`.
- School `illusion`: applies status to enemy (no direct HP damage unless burn/poison ticks later).
- Positional mechanics: `blink` teleports player; `push` hurls enemy 2 tiles with crash damage; `cleave` hits all adjacent enemies.

### Status Effects
Six statuses, stored as `{key, turns, magnitude}` stacks:

| Status | Effect |
|--------|--------|
| `burn` | DoT each enemy turn — magnitude damage/turn |
| `poison` | DoT, weaker but longer |
| `weaken` | Enemy attack × (1 − magnitude); magnitude=0.4 = −40% |
| `blind` | 40% chance to miss entirely |
| `freeze` | Skip turn |
| `bless` | Flat incoming damage reduction (applied to player, not enemy) |

Decay by 1 turn each tick. Ticking and decay handled by `applyDoTAndDecay()`.

### Overwatch (Hold ⌖)
Sets `player.overwatch = true`. On the next enemy that moves within range and LoS, the player fires a free attack (uses `playerAttack` via `holdOverwatch`). Consumed on reaction. The reaction fires during the enemy phase before that enemy can act.

### Enemy AI
Four archetypes with distinct `scoreMoveTile` logic:
- **charger** — minimize hex distance to player; bonus for elevation; hazard penalty.
- **kiter** — maintain preferred range band; penalize being too close; always seek best elevation.
- **holder** — penalty for moving far from current position; effectively guards a zone.
- **flanker** — approach from a different angular direction than the charger, using dot-product spread scoring.

Enemy move budget and climb cap follow the same formulas as the player. `enemyAct()` calls `bestMoveFor()`, then resolves the appropriate moveset entry (normal attack, heavy, multi-hit, drain, inflict status, guard stance).

### Threat and Intent System
- `computeEnemyThreat()`: All hexes any enemy can reach-and-attack-from in one turn. Used for the danger zone overlay.
- `planEnemyIntents()`: Dry-runs the AI for each enemy and captures their predicted destination and target. Rendered as direction arrows on the board.
Both are recomputed at the start of every player turn.

### Secondary Objectives
Generated with ~65% probability per match by `rollObjective()`. Three types:

| Objective | Condition | Tracked by |
|-----------|-----------|------------|
| `beacon` | Hold the marked center tile enemy-free for 5 consecutive turns | `beaconStreak` counter |
| `swift` | Defeat all enemies within turn budget | `turnCount` vs budget |
| `flawless` | Win without HP dropping below 50% | `lowestHpFraction` tracked each turn |

Reward if completed on a win: +60% gold, guaranteed healing potion.

### Scoring / Progression
There is no in-match score. Progress is tracked via:
- `deepestTacticsTier` — highest tier cleared (saved to store, shown on entry screen).
- Stat XP applied to AG/DX/EN on match end.
- Gold added to character wallet.

### Win/Loss
`checkOutcome()` runs after every action and after the enemy phase. It sets `state.status` to `'won'` or `'lost'` and does nothing else — reward application happens in `commitTactics()` in the store.

---

## 5. Technical Implementation

### File Map

| File | Role | Approx. Size |
|------|------|-------------|
| `src/engine/hex.ts` | Pure hex geometry (coordinates, distance, LoS line) | 163 lines |
| `src/engine/hexBattle.ts` | Battle engine: state machine, AI, generation, rewards | ~1 520 lines |
| `src/components/tactics/iso.ts` | Isometric projection math | 93 lines |
| `src/components/tactics/TacticsOverlay.tsx` | Full in-match UI (SVG board + React HUD) | ~880 lines |
| `src/views/TacticsView.tsx` | Pre-match entry screen (loadout, board size) | 210 lines |
| `src/views/BattleView.tsx` | Hub shell that holds Arena + Tactics tabs | 141 lines |
| `src/hooks/useTacticsAudio.ts` | Effect-driven audio hook | 114 lines |
| `src/store/useGameStore.ts` | Store actions: `beginTactics`, `tacticsMove`, etc.; `commitTactics` | ~60 relevant lines |
| `src/content/spells.ts` | `SpellDef` table including tactics-only positional spells | 186 lines |
| `src/content/weapons.ts` | `WeaponDef` table; player weapon carried into skirmish | 71 lines |
| `src/engine/hex.test.ts` | Geometry unit tests | 163 lines |
| `src/engine/__tests__/hexBattle.test.ts` | Battle engine tests | ~700 lines |
| `src/components/tactics/__tests__/iso.test.ts` | Projection math tests | 58 lines |

### Key Functions

**`src/engine/hex.ts`**
- `hexDistance(a, b)` — axial cube distance.
- `hexNeighbors(h)` — 6-connected adjacency list.
- `hexLineBetween(a, b)` — straight-line hex sequence used by LoS.
- `hexRange(center, r)` / `hexBoard(r)` — circle of tiles within radius r.
- `axialToPixel(h, size)` — flat-top screen position (pre-squash).
- `stepToward(from, to)` — single step reducing distance (used by simple enemy pathfinding fallback).

**`src/engine/hexBattle.ts`**
- `generateSkirmish(fighter, ag, tier, knownSpells, opts)` — produces a full `HexBattleState` including board, units, threat, intent, and optional objective.
- `computeReachable(s, from, budget, climb)` — Dijkstra returning all reachable hexes within move budget.
- `hasLineOfSight(s, a, b)` — wall/ridge/unit LoS check.
- `computeTargetable(s, action)` — valid target hexes for selected action.
- `playerAttack(s, target, rng)` / `playerCastSpell(s, spellKey, target, rng)` — damage resolution.
- `holdOverwatch(s, rng)` — arm reaction stance; fires if an enemy moves within range.
- `endPlayerTurn(s, rng)` — orchestrates enemy phase + status ticking + resource restore.
- `previewPlayerAttack(s, target)` / `previewSpell(s, key, target)` — deterministic preview (no RNG).
- `bestMoveFor(s, enemy)` — archetype-based AI move selection.
- `planEnemyIntents(s)` / `computeEnemyThreat(s)` — non-mutating prediction pass.
- `checkOutcome(s)` — sets `status` won/lost.
- `tacticsReward(s)` — returns `Reward` object for gold/items/XP.

**`src/components/tactics/iso.ts`**
- `base(h, size)` — screen position of tile ground center.
- `topCenter(h, size, elevation)` — screen position of tile top face (for unit placement).
- `hexCorners(size)` — 6-corner polygon for tile drawing (vertically squashed).
- `isoBounds(radius, size, maxElevation)` — bounding box + offset for SVG viewBox.

**`src/store/useGameStore.ts`**
- `beginTactics(loadout?)` — entry point; calls `generateSkirmish`, deducts energy, sets `state.tactics`.
- `tacticsSelect(action)` — caches selected action to highlight reachable/targetable hexes.
- `tacticsMove(to)` / `tacticsAttack(target)` / `tacticsCast(key, target)` / `tacticsHold()` — delegate to engine, write new state.
- `tacticsEndTurn()` — calls `endPlayerTurn`, writes result.
- `endTactics()` — calls `commitTactics`, clears `state.tactics`.
- `commitTactics(state, run)` — applies reward, updates `deepestTacticsTier`, triggers level-up check.

### State Management

The full match state lives in a single `HexBattleState` object (`src/engine/hexBattle.ts`):

```
tiles: Record<hexKey, Tile>       — board geometry (elevation, terrain)
player: PlayerUnit                — HP/MP/Sta, statuses, combat snapshot, overwatch flag
enemies: EnemyUnit[]              — living + dead enemies (dead kept for animation)
turn: 'player' | 'enemy'
selected: SelectedAction | null   — current action mode for highlighting
reachable: Hex[]                  — cached move targets (recomputed on select)
targetable: Hex[]                 — cached attack targets (recomputed on select)
effects: TacticalEffect[]         — animation queue (floaters, arrows, melee, spell FX)
log: string[]                     — battle log lines
status: 'active' | 'won' | 'lost'
tier: number
knownSpells: string[]
weapon: WeaponDef
seq: number                       — monotonic ID for effects
threatHexes: Hex[]
intentPlan: EnemyIntent[]
objective: TacticsObjective | null
turnCount: number
```

All engine functions are pure: they receive the current state, return a new state object. The Zustand store writes the returned state back. No engine function imports from React or the store.

### Effect/Animation System

`TacticsOverlay.tsx` renders `effects[]` as absolutely-positioned DOM elements layered over the SVG board. Each effect has a `startedAtMs` and `durationMs`. The overlay tracks `maxEnd` (the highest end time across all effects) to delay cascaded animations. CSS keyframe names map to effect types:

| Effect type | CSS animation | Glyph |
|-------------|---------------|-------|
| `floater` | `tactics-floater` | damage number |
| `melee` | `tactics-melee` | ⚔️ |
| `arrow` | `tactics-arrow` | ➡️ |
| `spell:sparks` | `tactics-sparks` | ⚡ |
| `spell:firebolt` | `tactics-firebolt` | 🔥 |
| `spell:mend` | `tactics-mend` | ✚ |
| `spell:blink` | `tactics-cast` | 🌀 |
| `spell:push` | `tactics-cast` | 💨 |
| `spell:cleave` | `tactics-cast` | ⚡ |

Effect IDs are monotonically increasing (`seq`). `useTacticsAudio` only processes effects with `id > prevEffectSeq` to avoid re-triggering sounds on re-render.

### Data Flow

```
TacticsView (entry screen)
  → beginTactics(loadout)   [store action]
    → generateSkirmish()    [engine]
    → state.tactics = HexBattleState

TacticsOverlay (live match)
  → user clicks tile        [React event]
    → tacticsMove/Attack/Cast  [store action]
      → movePlayer/playerAttack/playerCastSpell  [engine, pure]
      → state.tactics = newState

  → End Turn button
    → tacticsEndTurn()      [store action]
      → endPlayerTurn()     [engine]
      → state.tactics = newState (enemy phase applied)

  → checkOutcome detects win/loss
    → endTactics()          [store action]
      → commitTactics()     [store]
        → applyReward()
        → checkLevelUp()
        → state.tactics = null (overlay unmounts)
```

### Save/Load

There is no mid-match save. `HexBattleState` is **not** persisted to localStorage — if the page is reloaded during a match, the match is lost. Only `deepestTacticsTier` and character resources (gold, XP, items) are persisted via the main Zustand store with `persist` middleware.

### Configuration / Constants

All tuning constants live at the top of `src/engine/hexBattle.ts`:

```typescript
TACTICS_ENERGY_COST = 3
TACTICS_UNLOCK_LEVEL = 4
TACTICS_BOARD_RADIUS = 3   // small
COVER_DEFENSE = 3
HAZARD_DMG = 4
SPELL_RANGE = 4
MAX_ELEVATION = 3
OCCLUSION_RISE = 2
EFFECT_STAGGER_MS = 450
```

Board size options are defined in `TacticsView.tsx` as `SIZE_OPTIONS`:

```typescript
small:  { label: 'Small',  radius: 3, tileCount: 37 }
medium: { label: 'Medium', radius: 4, tileCount: 61 }
large:  { label: 'Large',  radius: 6, tileCount: 127 }
```

---

## 6. Software, Libraries, and Tools Used

| Concern | Solution |
|---------|----------|
| **Language** | TypeScript 5 |
| **Framework** | React 18 with functional components and hooks |
| **Build tool** | Vite |
| **State management** | Zustand with `persist` middleware (localStorage) |
| **Styling** | Tailwind CSS + `cn()` utility (`src/lib/cn.ts`) |
| **Rendering** | SVG for board geometry + absolutely-positioned DOM nodes for unit sprites and effect overlays |
| **Isometric projection** | Custom math in `src/components/tactics/iso.ts` (flat-top axial + vertical squash) |
| **Animation** | CSS keyframe animations triggered by React state; no canvas or WebGL |
| **Physics / collision** | None — pure discrete hex grid; no continuous simulation |
| **Audio** | Custom `useTacticsAudio` hook using the shared `playSound()` helper; no third-party audio library visible in this minigame |
| **AI** | Custom rule-based scoring in `hexBattle.ts` (`scoreMoveTile`, archetypes) |
| **RNG** | Seeded PRNG passed as a `rng()` callback into all randomized engine functions; tests inject deterministic seeds |
| **Testing** | Vitest |
| **Icons** | `lucide-react` (Grid3x3 icon on the hub card) |
| **Type utilities** | Internal `SpellDef`, `WeaponDef`, `HexBattleState` types; no external schema library |

---

## 7. Assets and Presentation

### Visual Style
The board is rendered as a **2.5D isometric hex grid** entirely in SVG. There are no bitmap sprites. Units are represented by emoji glyphs scaled and positioned on top of SVG tile polygons.

### Board Rendering
- Tile polygons: flat-top hexagons with vertical squash (`ISO_VSQUASH = 0.62`).
- Elevated tiles draw darkened side-face rectangles below the top polygon to convey height.
- Terrain type drives tile fill color (floor = slate, cover = green tint, slow = yellow tint, hazard = orange/red, blocked = dark).
- Elevation indicator (▲ + number) appears on tiles in move or target mode.
- Threat zone: semi-transparent red overlay on `threatHexes`.
- Intent arrows: SVG lines with arrowheads from predicted enemy start → end positions.
- Archetype rings: colored hex outlines on enemy tiles (charger=red, kiter=blue, holder=orange, flanker=purple).
- Beacon objective tile: pulsing ring animation on the marked hex.

### Unit Sprites
- Player: 🧝 emoji.
- Enemies: currently always shows the **first moveset icon** (usually ⚔️) — all enemies visually identical unless an archetype ring differentiates them.
- HP bar: thin bar below each unit sprite, colored by faction.
- Status badges: small emoji row above the unit.
- Intent badge: small icon above unit indicating planned action.

### Damage Numbers
Floating DOM nodes animated with `tactics-floater` keyframe. Color coding:
- `#f87171` (red) — damage to player
- `#fbbf24` (amber) — damage to enemy
- `#34d399` (green) — healing
- `#c084fc` (purple) — status applied

### Audio
Triggered by `useTacticsAudio.ts`. Sound cues:
- `'swing'` — melee hit
- `'arrowFly'` — ranged hit
- `'push'` / `'blink'` — positional spells
- `'cast'` / `'heal'` — other spells
- `'playerHurt'` — player takes damage
- `'enemyDeath'` — enemy killed
- `'turnEnd'` — turn boundary
- `'victory'` / `'defeat'` — match end

A background drone runs for the duration of the match, with intensity scaled by HP danger and enemy pressure.

### Overall Mood
Lean and functional — readable at a glance rather than visually spectacular. The emoji-based unit representation keeps cognitive load low and gives the game a light-hearted tone. The isometric SVG board is clean and geometrically clear but has minimal visual polish (no shading gradients, no particle effects, no idle animations on units).

---

## 8. Current Player Experience

### What Works Well
- **Threat + Intent toggles** are genuinely useful tactical information — showing exactly where enemies will move and who they target before committing to End Turn makes the game feel fair.
- **Hover preview** (damage range with height/cover/weakness context) removes guesswork and rewards positional play.
- **Elevation system** is mechanically distinct and creates interesting move decisions without being hard to understand.
- **Loadout picker** at match entry gives meaningful pre-match agency.
- **Positional spells** (Push, Blink, Cleave) are well-designed: each solves a distinct problem (escape, repositioning, AoE).
- **Archetype rings** communicate enemy behavior at a glance once the player learns the legend.
- **Board generation** produces varied layouts with working connectivity — no unwinnable-due-to-geography runs.
- **Secondary objectives** add optional challenge without blocking the core win.

### What Is Confusing or Awkward
- **Enemy sprites are visually identical** — every enemy shows ⚔️, so in multi-enemy fights you can't distinguish a charger from a flanker without reading the archetype ring or consulting the legend.
- **Intent arrows stack above the player hex** rather than above the attacking enemy — it's not immediately obvious which enemy is threatening you.
- **No visual distinction between "no move made" and "move not possible"** — cyan tiles disappear after moving but the action bar doesn't clearly show whether you still have an action or if you already used it.
- **Spell loadout rules are partially opaque** — Push/Blink/Cleave are "always granted" but displayed as locked in the entry screen, which reads as "unavailable."
- **No mid-match spell reference** — the player must remember what each loaded spell does once the match begins.

### What Feels Polished
- The animation system (staggered floaters, effect cascade delay) gives actions weight.
- The battle log is brief but informative.
- Board size choice lets players manage time-per-match.
- Audio drone + discrete sound cues provide clear feedback without being annoying.

### What Feels Unfinished
- Enemy visual variety is missing entirely.
- The archetype legend requires learning; no tooltip on individual enemy units explains their behavior.
- No visible "you already acted this turn" indicator — the action bar grays out acted buttons but doesn't announce this prominently.
- Large board size feels underused; enemy count doesn't scale with radius, so large boards just add empty walking distance.
- Objectives feel tacked on — the banner appears but the incentive (+60% gold) isn't prominently communicated before the match starts.

### Pacing
- Small board matches run quickly (5–10 player turns) and feel tightly structured.
- Large board matches drag because movement per turn is short relative to board size.
- The enemy phase is instant (no per-enemy animation delay visible to the player), which makes it hard to follow when 3+ enemies move and attack simultaneously.

### Difficulty
- Early tiers are straightforward; the tier-scaling formula is generous (gold grows faster than enemy power scales).
- Terrain and secondary objectives add meaningful pressure even at low tiers.
- Player death feels fair — the threat zone preview is accurate.

---

## 9. Known Issues and Weak Points

### Confirmed Issues (from code comments and test gaps)

1. **Enemy icon is always the first moveset icon** (`TacticsOverlay.tsx` unit sprite logic). All enemies show ⚔️. Each enemy template should have a dedicated display icon.

2. **Push, Blink, Cleave are locked behind loot** despite being described as "always granted." In `TacticsView.tsx` they are displayed as locked badges correctly, and `generateSkirmish` adds them to `knownSpells` unconditionally — but the entry screen UI implies they are locked to players who haven't seen the code comment explaining this.

3. **Intent arrows are positioned above the player hex** (the player is always the `target` of intent). The attacking enemy is not highlighted, making it ambiguous which enemy is planning to strike.

4. **No mid-match save** — closing the tab during a match loses the run silently, with no warning or checkpoint.

5. **Large board under-populated** — enemy count doesn't scale with board radius, so Large maps have large empty zones and turn the game into a walking simulator before contact.

6. **Flanker archetype effectiveness degrades with small enemy rosters** — the archetype relies on at least one other enemy approaching from a different angle. With 1–2 enemies, flanker and charger behave identically.

7. **Resource regeneration is unconstrained** — MP and Stamina restore fully between matches (store level), and partial restoration occurs at end of each enemy phase. MP pressure within a match is minimal for low-cost spells.

### Technical Debt

8. **`hexBattle.ts` is ~1 520 lines** — AI, board generation, combat resolution, spell handling, and turn management all in one file. The file is coherent but large; any future feature addition risks merge conflicts and readability issues.

9. **No UI tests for `TacticsOverlay.tsx`** — the largest UI component in the minigame (880 lines) has zero test coverage. Regressions in rendering or interaction would not be caught automatically.

10. **`effectSeq` tracking in `useTacticsAudio.ts`** uses a ref updated in an effect; if effects arrive in batches between renders, ordering edge cases could cause missed or double-fired sound cues.

11. **Terrain icon rendering** in the SVG is purely color-coded, not icon-coded — there are no `🛡️` or `🌿` glyphs on the tile itself to reinforce terrain type during play.

---

## 10. Improvement Opportunities

### Controls and UX
- Add a "you have acted" visual indicator on the action bar (e.g., dim the whole attack section after use, not just the button).
- Show mid-match spell tooltips on hover over the action buttons.
- Make the objective reward (+60% gold, guaranteed potion) visible on the pre-match screen to motivate attempting it.
- Show which enemy issued an intent arrow (highlight the source enemy when the intent arrow is hovered or toggled).
- Warn the player before Retreat that they'll receive partial rewards.

### Enemy Variety
- Give each enemy template a unique display icon in `TacticsOverlay.tsx` instead of using `moveset[0].icon`.
- Add elite variants at higher tiers (e.g., shielded charger with guard bonus, invisible flanker).
- Consider archetype-specific passive icons on the unit sprite (not just the ring outline) to communicate behavior without requiring legend lookup.

### Mechanics
- Scale enemy count or density with board radius so Large maps feel as full as Small.
- Add a stealth-or-reveal mechanic to make the flanker archetype distinctly different from charger at low roster sizes.
- Consider a second action per turn (move + act freely, but limit actions to 1) — this matches the current design intent but clarifying it visually would help.
- Add environmental interactivity: destructible cover, spreading fire from burn DoT, terrain alteration spells.

### Difficulty Curve
- Add a difficulty selector or modify the tier system to give new players a gentler ramp.
- Balance Large board pacing by either reducing travel distance (smaller unit scale) or increasing move budget on larger boards.

### Visuals and Audio
- Per-tile terrain glyphs in the SVG (🛡️ on cover, 🌿 on slow, 🔥 on hazard, 🪨 on wall).
- Idle animation or pulsing glow on alive enemy units to make them feel present.
- Per-enemy-action animation delay in the enemy phase so multi-enemy turns are readable.
- Audio stings for secondary objective progress/completion.

### Code Quality
- Split `hexBattle.ts` into sub-modules: `hexBattle/ai.ts`, `hexBattle/combat.ts`, `hexBattle/generation.ts`, `hexBattle/turns.ts`.
- Add integration tests for `TacticsOverlay` interactions (select-move-attack-endTurn round trip).
- Consider extracting the effect rendering from `TacticsOverlay` into a dedicated `TacticsEffectLayer` component.

### Larger Game Integration
- Surface `deepestTacticsTier` on the main dashboard or character screen as a trophy metric.
- Consider a persistent "tactics unlocks" progression path: tile types, spell slots, or objective types that expand as tier climbs.

---

## 11. Questions and Unknowns

1. **Are rune spells (`fire_rune`, `ice_rune`, `poison_rune`) intended to work in Tactics?** They are defined in `spells.ts` with `mechanic: 'rune-fire'` etc., but `playerCastSpell()` in `hexBattle.ts` has no handler for these mechanics. They exist only in the Arena engine. If Tactics is meant to support them, the handler is missing.

2. **What happens if the player casts a support/illusion spell with no valid target?** The `computeTargetable` result would be empty, and the action button should be disabled, but the code path for "spell selected, no valid targets visible" needs verification.

3. **Is Overwatch fire accurate with the current LoS check?** The reaction fires during the enemy move phase. It's unclear whether LoS is rechecked at the enemy's destination or at the origin tile, which could affect whether shots through newly-vacated tiles are legal.

4. **How is `tier` computed exactly at match entry?** The store calls `generateSkirmish(fighter, ag, tier, ...)` — what value is passed for `tier`? Is it `deepestTacticsTier`, `deepestTacticsTier + 1`, or something else? The reward notes "highest tier won" but the challenge scaling at entry needs a concrete reference.

5. **Is the `objective` bonus applied on loss?** `tacticsReward()` checks `won` for the trickle XP but the code path for objective completion on a losing run should be confirmed (logically it shouldn't pay out, but it's worth verifying `checkOutcome` ordering).

6. **What is the stamina regeneration rate during a match?** The store's `endPlayerTurn` likely restores some Sta, but the exact amount is not documented in a named constant — it may be buried in the state initialization or the end-of-turn restore block.

7. **Are `fire_rune` / `ice_rune` / `poison_rune` intended to appear in the loadout picker in Tactics?** They are listed in `SPELLS` without a `tacticsSafe` guard. If a player owns these spellbooks, they'd appear in the loadout picker and would silently do nothing when cast.

8. **Is there any anti-softlock measure?** If all enemies are unreachable (e.g., walled off by a generation bug that passes the connectivity check), can the player retreat without penalty? The Retreat button exists but it counts as a loss.

9. **How does the `knownSpells` filter in `generateSkirmish` interact with `STARTER_SPELLS`?** New characters only know `sparks` and `mend` plus their signature spell. If a new character enters Tactics, their loadout is very thin. Is there a minimum guaranteed loadout beyond Push/Blink/Cleave?

10. **Is `OCCLUSION_RISE = 2` the only guard against hiding in unreachable back-corner tiles?** The generation code clamps elevation differences between adjacent tiles, but does the connectivity check also verify that the player can actually reach all enemies or just that the board is geometrically connected?
