# Arena Minigame Analysis

*Updated June 2026 to reflect all improvements through Phase D. The earlier analysis has been archived at `docs/archived/arena-minigame-analysis.md`.*

---

## 1. Basic Summary

The Arena is a real-time boss duel on a square Chebyshev grid. The player fights a level-scaled boss in a single open room, using their character's full combat stats — melee, ranged bolts, spells, and consumable items — all driven in real time rather than through menus.

The central mechanic is telegraphed attacks: every boss blow lights up the affected tiles before the hit resolves, so dodging means physically stepping off those cells before the damage fires. The player must also manage stamina (for attacks) and MP (for spells) while kiting a pathfinding boss and an optional wave of minions.

Within the larger game the Arena fills the role of high-stakes, high-reward gating. It costs 3 energy to enter (earned by logging real-life habits), unlocks at level 3, and rewards gold, items, and stat XP proportional to both the boss tier and how much damage the player dealt before dying or retreating. The boss tier is pinned to the player's current level, so the Arena scales continuously with progression.

---

## 2. Core Game Loop

### Starting a run

The player visits the Arena tab (`ArenaView.tsx`) and presses "Enter the Arena." The store action `beginArena()` (`useGameStore.ts`) gates on `character.level >= 3` and `character.energy >= 3`, then:

1. Calls `rollArenaSetup(tier, rng)` (`arena.ts:347`) to randomly pick board radius (3/4/5), obstacle density (light/medium/heavy), and starting minion count. Higher tiers skew toward larger boards and heavier obstacles. Radius-4 boards start with 1 minion; radius-5 boards start with 2.
2. Looks up the boss via `bossForLevel(level)` (`bosses.ts`), which returns a named boss for the specific tier or a procedurally generated one.
3. Calls `createArena(fighter, boss, opts)` (`arena.ts:487`) which builds the initial `ArenaState` snapshot from the character's derived combat stats, places obstacles via `chooseObstacles()`, sets all clocks, and gives the boss a 1200 ms opening grace period before it can act.
4. Deducts 3 energy and stores the `ArenaState` in `gameState.arena`.
5. `ArenaOverlay.tsx` renders over the tab because `arena !== null`.

### During a fight

The `useArenaLoop` hook (`useArenaLoop.ts`) runs a `requestAnimationFrame` loop with three independent clocks:

- **Movement**: every 150 ms it reads held WASD/arrow keys (or held D-pad dirs) and calls `store.arenaMove(dir)`.
- **Attack**: Space/Enter presses are queued and fire at most every 200 ms via `store.arenaAct(now)`. Number keys 1–9 quick-fire spells and items directly without the queue (see Section 3).
- **Tick**: every 90 ms it calls `store.arenaTick(now)`, which advances all enemy AI, projectiles, telegraphs, status effects, and resource regeneration.

The player:
- Moves around the board, stepping off telegraphed tiles.
- Attacks with melee (adjacent enemies), ranged bolts (travel across the board), and spells (direct damage, traps, utility).
- Manages stamina (drains on attacks, regenerates at 3/s) and MP (drains on spells, regenerates at 1.8/s).
- Avoids minions that pathfind toward the player each tick; archer-variant minions kite at range and fire projectiles.

### Challenge and difficulty

Difficulty comes from four interacting systems:

- **Boss patterns**: the boss chooses `slam` (1-cell radius around the player), `line` (column from boss toward player), `nova` (2-cell radius around the boss), or `volley` (4 random tiles near the player) based on the distance to the player. Pattern choice is probabilistic; close range biases toward nova/slam; long range toward line/volley.
- **Speed factor**: set by `arenaSpeedFactor(setting, level)` (`arena.ts:362`). On auto it ramps from 0.85× at level 3 to a cap of 1.2× at level ~23. All boss/minion timers are divided by `s.speed`.
- **Minions**: large boards spawn 2 minions at run start and periodically summon more every 12 s. Minion variant (bat or archer) is set per phase and can change between phases.
- **Phase scripting**: named bosses have authored `BossPhase[]` arrays with per-phase `recoverMs` (attack cadence), `spawnOnEntry` (extra minions on phase transition), and `minionVariant` fields that drive distinct fight arcs.

### Ending a run

Three outcomes exist:

| Outcome | Status | Reward |
|---|---|---|
| Win | `'won'` | Full gold + items from `boss.rewards` |
| Death | `'ended'` | `ARENA_DEATH_KEEP = 0.5` × `(gold × damageProgress)` |
| Retreat | `'banking'` | `1.0` × `(gold × damageProgress)` — no HP loss penalty |

`damageProgress()` (`arena.ts:612`) measures how far through all phases the player got. A retreat always beats death in gold because the 0.5 death penalty is not applied.

When the player clicks the outcome button, `endArena()` calls `commitArena()` which:
1. Distributes stat XP proportional to `statUsage` tallies recorded during the run.
2. Applies gold and item rewards via `applyReward()`.
3. Calls `checkLevelUp()`.
4. Clears `gameState.arena` to `null`, collapsing the overlay.

The outcome modal also displays a `RunSummary` component (see Section 3) before the player dismisses it.

---

## 3. Player Controls and Interaction

### Keyboard

| Key | Action |
|---|---|
| W / ↑ | Move up |
| S / ↓ | Move down |
| A / ← | Move left |
| D / → | Move right |
| W+A, W+D, S+A, S+D | Diagonal movement (8 directions total) |
| Opposing keys | Cancel each other |
| Space / Enter | Context attack (melee if adjacent, otherwise ranged) — queued, fires at most every 200 ms |
| 1–9 | Quick-fire: spells 1–N in `knownSpells` order, then items by inventory order |

Input is managed by `useArenaLoop.ts`. Key state is tracked in `heldAxes` (a `Set<Axis>`) via `keydown`/`keyup` listeners. Movement fires on a 150 ms polling interval, not on each keypress. Number keys fire immediately using `store.arenaCast` or `store.arenaUseItem` without going through the act queue.

### Mouse / pointer on the board

Clicking the board (`ArenaOverlay.tsx`) computes the direction from the player's cell center to the click point and fires whichever action is bound to the left or right slot:

- **Left-click** fires the left-bound slot action in that direction.
- **Right-click** fires the right-bound slot action in that direction.

Clicks very close to the player's own cell (within 40% of cell size) are ignored to avoid misfires.

For rune spells, the exact click position is also converted to a grid cell (`pixelToCell`) and passed as the placement target.

The board also listens to `onPointerMove` to track the hover cell, which drives the rune placement preview (see Section 4).

### Ability bar

Below the board is a row of `AbilityButton` components — one per action type (Melee, Shoot, each known spell, each inventory item):

- **Left-click** an ability button: fires it immediately and binds it to the left board-click slot (shown with a cyan "L" badge).
- **Right-click** an ability button: binds it to the right board-click slot (shown with an amber "R" badge) without firing.
- Spell buttons dim (disabled) when MP is insufficient.
- Item buttons show a "×N" quantity badge.

Slot bindings are **persisted across runs** via `settings.arenaBindLeft` / `settings.arenaBindRight` in the Zustand store. They default to `'melee'`/`'ranged'` on first use and survive page refresh and run boundaries.

A hint line below the ability bar reads: "L-click to fire & bind left · R-click to bind right · then click the board to aim · keys 1–N quick-fire."

### Touch / D-pad

`ArenaControls.tsx` renders a 3×3 grid of directional buttons plus a large "Attack" button. Each direction button uses pointer events to call `controls.press(dir)` and `controls.release(dir)`. The attack button calls `controls.act()`.

### HUD elements

- **Boss HP bar**: full-width at the top with a phase dot indicator for multi-phase bosses. Bar color: ember-bright red.
- **Boss name + tier + minion count**: displayed above the bar. When minions are present, the HUD shows `{variant glyph}×{count}` using the current phase's minion variant (bat = 🦇, archer = 🐺). This updates when the phase changes and the variant changes.
- **Weakness / resistance badges**: directly below the boss HP bar when `weakTo` or `resistTo` are non-empty. Weakness displays as a green pill `⚡ Weak: STAT`; resistance as a red pill `🛡 Resists: STAT`. These are per-phase — they update on each phase transition.
- **Player gauges**: HP (green), MP (indigo), Stamina (amber), each shown as a small icon + bar + `N/Max` readout.
- **Status badges**: emoji icons (🛡️ 🔥 🔻 💫 ❄️ ☠️) floating above the boss and player for active status effects.
- **Damage floaters**: animated numbers (and "Dodge!" text) rising from the damaged unit's position. Gold = boss damage, red = player damage taken, green = healing, cyan = dodge, `💨` = minion death poof.
- **Facing highlight**: the cell in the player's current facing direction gets a golden outline on the floor tile.
- **Rune placement preview**: when a rune spell is the active left or right slot, hovering the board shows a translucent highlight at the clamped target cell (`previewRuneTarget()`), with a matching color border for the rune type.
- **Retreat + Mute toggle**: visible during an active run. The mute button (Volume2 / VolumeX icon) toggles `settings.soundEnabled`, which immediately ramps the master SFX gain to 0 or back to normal.

### Feedback signals

- **Hit vignette**: a full-screen red edge flash (`arena-hit` CSS animation, 0.45 s) on any player damage received.
- **Cast ring**: an expanding violet circle on the player when MP drops by ≥2 (`arena-cast` animation, 0.4 s).
- **Boss phase animation**: on phase transition, the boss sprite plays `arena-boss-phase` (0.55 s swell + hue-rotate), triggered via `key={phaseIndex}` remount on the inner sprite div.
- **Boss death animation**: on win, the boss sprite plays `arena-boss-die` (0.65 s flash → scale-up → collapse to opacity 0), triggered via `key='dead'` remount.
- **Telegraph outlines + label**: danger tiles show `arena-telegraph` animation (brightens 16%→82% over the windup window) plus a short text label (`SLAM` / `LINE` / `NOVA` / `VOL`) on the first tile. No emoji glyphs.
- **Projectile glyph**: cyan glowing dot (player bolts) or cyan dot (minion bolts — same appearance) tracks across the board per step.
- **Minion death poof**: a `💨` floater appears at the minion's last known cell when its ID disappears from the minions array between render ticks, accompanied by a `hit` SFX.
- **Frozen units**: player and minions become 🧊 with reduced opacity when frozen.

### Sound effects

Sound is managed by `src/lib/sfx.ts`, a zero-asset Web Audio synthesizer. All cues are generated from oscillators and filtered noise. The master gain ramps smoothly on mute/unmute.

Arena-specific call sites in `ArenaOverlay.tsx`:

| Event | SFX cue |
|---|---|
| Board click / ability fire | `sfx.resume()` (satisfies autoplay policy) |
| Melee swing | `swing` |
| Ranged bolt fired | `arrowFly` |
| Spell cast | `cast` |
| Boss or minion takes damage | `hit` |
| Player takes damage | `playerHurt` |
| Successful dodge | `arenaDodge` (quick sidestep whoosh) |
| Boss phase transition | `arenaBossPhase` (deep roar swell) |
| Minion death | `hit` |
| Run won | `victory` |
| Run ended (death) | `defeat` |

`sfx.play()` silently no-ops when the context is suspended (autoplay blocked) or when the master mute is active.

### Outcome modal and run summary

When `arena.status` is `'won'`, `'ended'`, or `'banking'`, an overlay fades in on top of the board with an icon (🏆 💀 🚪), a title, a reward description, and a `RunSummary` component followed by a "Claim Reward" / "Leave the Arena" button.

`RunSummary` reads directly from `ArenaState` before it is cleared by `endArena()` and displays:

- Total damage dealt (`arena.damageDealt`)
- Total player actions (`sum of statUsage values`)
- Dodge count (`statUsage.AG`, omitted if 0)
- Focus stat (the non-AG `statUsage` entry with the highest count)
- Elapsed time in mm:ss (derived from `arena.startedAtMs` and `arena.lastTickMs`)

---

## 4. Mechanics and Systems

### Board and grid

The board is a square Chebyshev grid (diagonals count as distance 1). Radius 3/4/5 means a `(2r+1)×(2r+1)` cell square — 49, 81, or 121 cells total. All positions are `{x, y}` integers, center at `{0,0}`.

Player starts at `{0, +radius}` (bottom center); boss starts at `{0, -radius}` (top center).

Grid utilities live in `src/engine/grid.ts`: `board(r)` returns all in-bounds cells, `step(cell, dir)` moves one cell, `distance(a, b)` is Chebyshev distance, `line(start, dir, n)` generates a ray, `neighbors(h)` returns 8 adjacent cells, `range(h, r)` returns all cells within Chebyshev radius `r`, `stepToward(a, b)` returns the best single-step direction from `a` toward `b`.

### Obstacles

Placed at arena creation via `chooseObstacles()` (`arena.ts:400`). This function selects an authored layout approximately 30% of the time; otherwise falls back to `genObstacles()` (random placement).

**Authored layouts** (`AUTHORED_LAYOUTS` table, `arena.ts:378`): 6 hand-designed configurations across the three board radii, two per radius:

| Radius | Layout name | Description |
|---|---|---|
| 3 | Sentinel Posts | 4 symmetric pillars in a diamond, open center |
| 3 | Gauntlet | Side walls with approach cover near each spawn |
| 4 | Barrier Wings | Two vertical walls creating three clear lanes |
| 4 | Corner Islands | Cover clusters in far corners, open midfield |
| 5 | The Cross | Horizontal and vertical obstacle cross with edge routes |
| 5 | Dual Pillars | Two tall walls at x=±3, wide center and edge lanes |

All authored layouts are manually verified to have a clear BFS path between the player and boss starting cells.

**Random layouts** (`genObstacles()`): random placement at density fractions light=6% / medium=16% / heavy=30%. Player and boss start areas plus their immediate neighbors are excluded from placement.

### Player stats (derived at entry)

`createArena()` snapshots all combat-relevant stats from the `Fighter` object at entry time. Changes to the character's base stats during a run (e.g., from buff items) update only `ArenaState` fields, not the persistent character.

| State field | Derived from |
|---|---|
| `meleePower` | ST-scaled attack |
| `rangedPower` | DX-scaled attack |
| `damageSpell` | WI-scaled damage |
| `supportSpell` | KN-scaled healing |
| `illusionPower` | CH-scaled debuff strength |
| `defense` | Physical damage reduction |
| `ward` | Magic damage reduction |
| `dodge` | AG-scaled evasion chance (max 0.40) |
| `hp/maxHp`, `mp/maxMp`, `sta/maxSta` | Character maximums |

### Stamina

Regenerates at 3 per second. Melee and ranged attacks drain the weapon's `staminaCost` (or `BASE_ATTACK_STA = 2` if the weapon's `attackStat` doesn't match). When stamina is below cost, the attack fires but deals reduced damage (the `full` flag in `attackRoll` is false). Stamina is not consumed by spells.

### MP

MP regenerates at 1.8 per second (raised from 1.2 — see comment at `arena.ts:50`). Spells have independent MP costs (6–10). Spells cannot fire if `mp < spell.mpCost`. MP and attack cooldowns are independent (`cooldownUntilMs` vs `spellCooldownUntilMs`), so spells and attacks can interleave freely.

### Cooldowns

| Action type | Cooldown |
|---|---|
| Melee / ranged | `ATTACK_CD_MS = 320 ms` |
| Spells | `SPELL_CD_MS = 520 ms` (independent of attack CD) |
| Items | `ITEM_CD_MS = 700 ms` |

There is also a `IFRAME_MS = 550 ms` invincibility window after the player is hit, preventing multi-tick damage from the same source.

### Telegraph system

When the boss is ready to act, `bossThink()` (`arena.ts`) picks a pattern and pushes a `Telegraph` object to `state.telegraphs`. Each telegraph has:

- `tiles`: the cells that will be damaged.
- `firesAtMs`: when it resolves.
- `startedAtMs`: when it was created (used to drive CSS animation duration).
- `raw`: pre-computed raw damage with variance.
- `school`: `'physical'` or `'magic'` (determines color: red vs purple on the board).

`resolveTelegraphs()` runs each tick and fires any telegraph whose `firesAtMs <= now`.

| Pattern | Windup | Damage mult | Coverage |
|---|---|---|---|
| `slam` | 800 ms | 1.30× | All cells within 1 of the player |
| `line` | 760 ms | 1.05× | Column from boss toward player (stops at obstacles/wall) |
| `nova` | 950 ms | 1.15× | All cells within 2 of the boss (excluding boss cell) |
| `volley` | 860 ms | 0.85× | Player cell + 3 random cells within 2 of the player |

The boss attack recovery between telegraphs is `s.bossRecoverMs`, which defaults to `BOSS_RECOVER_MS = 650 ms` but can be overridden per phase by `BossPhase.recoverMs` — used by the named bosses to accelerate their cadence in later phases.

Blind status (`dazzle` spell) gives a 40% chance the boss skips its action entirely.

### Damage resolution

`attackRoll()` and `spellDamageRoll()` from `engine/combat.ts` are shared with the turn-based battle system. Weakness/resistance arrays from the boss definition apply 1.3×/0.7× multipliers. Defense and ward reduce flat damage after weakness/resistance. The HUD surfaces `weakTo` and `resistTo` per phase, so players can act on this information.

Dodge (`strikePlayer()`): if `rng() < s.dodge`, the hit is entirely negated and `lastDodgedAtMs` is set. The overlay's state-change effect detects a change in `lastDodgedAtMs` and spawns a "Dodge!" floater (cyan text) at the player's position plus plays the `arenaDodge` SFX cue.

### Rune spells

Fire, ice, and poison runes are placed on adjacent tiles. `clampRuneTarget()` (`arena.ts:699`) clamps the desired placement to an adjacent, in-bounds, unobstructed cell, falling back to any adjacent valid cell. `previewRuneTarget()` is the read-only equivalent used by the overlay's hover preview. Runes expire after 12 s if not triggered.

When any unit (player, boss, or minion) steps onto a rune tile, `triggerRunes()` fires:

| Rune | Hit effect | Secondary effect |
|---|---|---|
| Fire | Wisdom-scaled magic damage | Burns boss for 2 turns |
| Ice | Wisdom-scaled magic damage | Freezes boss/minion for 3 s |
| Poison | Wisdom-scaled magic damage | Poisons target for 3 turns |

The player can also trigger their own runes, so placement matters.

### Ring of fire

`ring_of_fire` spell (10 MP) activates a 3.5 s aura. Each tick, `tickRingOfFire()` deals damage to every enemy (boss + minions) within Chebyshev distance 1 every 600 ms (per-enemy cooldown). The board shows glowing orange highlight on all 8 cells adjacent to the player.

### Minion system

Minions spawn adjacent to the boss on summon, up to `MINION_CAP = 4` simultaneously. Spawn timing varies by radius and phase:

- Radius-5 boards spawn minions at run start and every phase transition, plus a periodic summon every 12 s.
- Radius-4 boards spawn 1 at phase transitions only.
- Radius-3 boards spawn none on their own, but named bosses can still spawn via `spawnOnEntry`.

On phase transition, `resolveBossDown()` (`arena.ts:618`) spawns the standard phase complement plus any `spawnOnEntry` extra minions from `BossPhase`. Minion stats (`minionHp`, `minionAttack`) rescale to the new phase. The `minionVariant` also updates to `BossPhase.minionVariant`, changing the type of minion summoned for the rest of that phase.

Minion HP is 18% of the phase boss HP; attack is 35% of the phase boss attack.

### Minion variants

Two variants are implemented (`MinionVariant = 'bat' | 'archer'`, defined in `bosses.ts`, re-exported from `arena.ts`):

**Bat** (default, glyph 🦇):
- Closes in toward the player using the BFS flow field.
- Deals contact melee damage (every 900 ms scaled by speed) when adjacent.

**Archer** (glyph 🐺):
- Kites: closes to within distance 3, then holds position. If the player gets adjacent (distance ≤ 1), backs away by stepping to any non-blocked cell that increases distance to the player.
- Fires a `source: 'minion'` projectile toward the player when within distance 4 (every 900 ms scaled by speed).
- Minion projectiles call `strikePlayer()` on contact with the player cell, bypassing obstacle collision checks that would stop a player-fired bolt.

Both variants:
- Apply poison DoT if poisoned.
- Skip all action when frozen.
- Display their variant glyph in the overlay (live on-board sprite and HUD count); frozen units show 🧊 regardless of variant.

`stepMinions()` (`arena.ts:1033`) handles both variants in a single loop.

### BFS flow-field pathfinding

`floodField(target, radius, obstacles)` (`arena.ts:270`) runs BFS outward from the player's current cell across all non-obstacle, in-bounds cells, producing a `Map<cellKey, distance>`. This runs once per tick and is shared by the boss and all bat-variant minions.

`flowStep(from, field, radius, blocked)` picks the adjacent cell with the smallest distance-to-player. If no neighboring cell has a shorter distance, it returns `null` (already adjacent or stuck). The `blocked` set prevents collisions between units.

Archer-variant minions use `DIRS` + `step()` directly for their retreat logic rather than `flowStep`, since they need to move away from the player rather than toward.

### Phase system

`BossDef` supports a `phases?: BossPhase[]` array. If provided, the boss transitions through each phase as HP reaches 0. `resolveBossDown()` advances the phase index, resets HP to the new phase max, resets the boss position, clears telegraphs and enemy statuses, clears projectiles, spawns the phase's minion complement (standard + `spawnOnEntry` extra), and gives the boss a 1200 ms opening grace period.

`BossPhase` now includes Arena-specific scripting fields:

| Field | Type | Effect |
|---|---|---|
| `recoverMs?` | number | Override the post-attack recovery delay; lower = faster attack cadence |
| `spawnOnEntry?` | number | Extra minions spawned on top of the board-size default |
| `minionVariant?` | `'bat' \| 'archer'` | Which variant is summoned during this phase |

These are applied by `applyArenaPhase()` (`arena.ts:442`) on phase transition, alongside the existing HP/attack/defense/school/weakness updates.

### Boss pool

`NAMED_BOSSES` (`bosses.ts`) now contains 7 entries at level tiers 5, 8, 12, 15, 20, 25, and 30. All have an explicit `glyph` field on `BossDef`; `createArena()` copies it to `ArenaState.bossGlyph`. The overlay reads `arena.bossGlyph` directly — there is no longer any substring-matching `bossGlyph()` helper.

| Level | Boss | Glyph | Phases | Notable scripting |
|---|---|---|---|---|
| 5 | The Procrastination Slime | 🫧 | 2 | Phase 2: magic school, recoverMs 500 |
| 8 | Drill Sergeant Rex | 🪖 | 1 | Weak CH/AG, resists ST |
| 12 | The Comfort Blob | 🛋️ | 1 | Defense 4, weak AG, resists ST/EN |
| 15 | The Anxiety Wraith | 👻 | 1 | Magic school, ward 3, weak WI/KN |
| 20 | The Burnout Golem | 🗿 | 2 | Phase 2: magic, recoverMs 480 |
| 25 | The Mirror Demon | 🪞 | 2 | Phase 2: magic, ward 5, recoverMs 520 |
| 30 | The Clockwork Tyrant | ⚙️ | 2 | Phase 2: magic, recoverMs 420, spawnOnEntry 2 |

Procedural bosses (all other levels) are `Trial Guardian (Lv N)` with `weakTo: []`, no phases, and the `👹` fallback glyph.

### Status effects

`ArenaStatusEffect` objects live in `playerStatuses` and `enemyStatuses` arrays. Effects are identified by `StatusKey`:

| Key | Effect |
|---|---|
| `bless` | Reduces incoming damage by `magnitude` |
| `burn` | DoT ticking every 1100 ms for `magnitude` damage |
| `weaken` | Reduces outgoing damage by `magnitude` fraction |
| `blind` | 40% chance boss misses its telegraph window |
| `freeze` | Boss/minion cannot move or act |
| `poison` | DoT ticking every 1100 ms for `magnitude` damage |

Effects stack by taking the max of current vs new magnitude and extending expiry.

### Stat usage XP

Each player action increments `statUsage` counters:

| Action | Stats incremented |
|---|---|
| Melee swing | `ST`, `EN` |
| Ranged bolt | `DX`, `EN` |
| Damage/rune/ring spells | `WI` |
| Support/teleport spells | `KN` |
| Illusion spells | `CH` |
| Successful dodge | `AG` |

`commitArena()` distributes XP proportionally. Budget is `(4 + tier) × (0.4 + 0.6 × damageProgress)`. The `statUsage` map is also read by `RunSummary` before `endArena()` discards it. `damageDealt` is tracked separately as a running total in `ArenaState` and reset to 0 at run start.

### Speed setting

Four settings in `ArenaSpeed`: `'slow'` (0.85×), `'normal'` (1.0×), `'fast'` (1.2×), `'auto'`. Auto ramps from 0.85× at level 3 to 1.2× at level ~23. The factor divides all enemy action timers (`bossNextActionMs`, `bossNextMoveMs`, minion move/hit CDs, summon CD). `bossRecoverMs` is also divided by `s.speed` inside `bossThink()`.

### Win/loss conditions

- **Win**: boss HP reaches 0 in the final phase → `status = 'won'`.
- **Death**: player HP reaches 0 → `status = 'ended'`.
- **Retreat**: player presses Retreat button → `beginArenaBanking()` sets `status = 'banking'`.

All three states freeze the clock (the tick guard in `arenaTick` returns early if status is not `'active'`).

### Invincibility mode

A dev setting (`settings.invincible`) disables all player damage and auto-refills HP/MP/STA each tick. Does not gate rewards.

---

## 5. Technical Implementation

### File map

| File | Purpose |
|---|---|
| `src/engine/arena.ts` | Pure functional engine: all rules, state types, exported action functions, `arenaTick` |
| `src/engine/bosses.ts` | `BossDef` type, `MinionVariant` type, `NAMED_BOSSES` record (7 entries), `bossForLevel()` |
| `src/engine/spells.ts` | Spell definitions, `getSpell()`, `SCHOOL_STAT` map |
| `src/engine/items.ts` | Item definitions, `getItem()` |
| `src/engine/grid.ts` | `Cell`, `Dir`, `DIRS`, `board()`, `step()`, `distance()`, `line()`, `neighbors()`, `range()`, `inBoard()`, `stepToward()`, `cellToPixel()`, `boardPixelSize()` |
| `src/engine/combat.ts` | Shared damage math: `attackRoll()`, `spellDamageRoll()`, `spellHealAmount()`, `variance()` |
| `src/hooks/useArenaLoop.ts` | `requestAnimationFrame` loop, keyboard/touch input (including 1–9 quick-fire), returns `ArenaControlsApi` |
| `src/views/ArenaView.tsx` | Entrance screen (tab content when no run is active) |
| `src/components/arena/ArenaOverlay.tsx` | Full-screen live fight UI, board rendering, HUD, rune preview, outcome modal, `RunSummary` |
| `src/components/arena/ArenaControls.tsx` | Touch D-pad and attack button |
| `src/store/useGameStore.ts` | Zustand store, all arena actions, `commitArena()` |
| `src/lib/sfx.ts` | Zero-asset Web Audio SFX synthesizer; `arenaDodge` and `arenaBossPhase` cues added |
| `src/engine/__tests__/arena.test.ts` | ~650 lines of Vitest specs (46 tests) |
| `src/index.css` | CSS keyframe animations: `arena-telegraph`, `arena-hit`, `arena-cast`, `arena-boss-die`, `arena-boss-phase`, `loot-float` |

### Key functions

| Function | Location | Role |
|---|---|---|
| `createArena(fighter, boss, opts)` | `arena.ts:487` | Build initial `ArenaState` |
| `rollArenaSetup(tier, rng)` | `arena.ts:347` | Randomize radius, density, minion count |
| `chooseObstacles(radius, density, rng, ...)` | `arena.ts:400` | Select authored layout (30%) or generate random |
| `applyArenaPhase(s, phase)` | `arena.ts:442` | Apply phase stats + recoverMs + minionVariant to state |
| `resolveBossDown(s, now, rng)` | `arena.ts:618` | Advance phase (+ spawnOnEntry) or set `status = 'won'` |
| `arenaMove(state, dir)` | `arena.ts:666` | Move player, check freeze and bounds |
| `arenaMelee(state, now, rng, dir?)` | `arena.ts:678` | Swing at adjacent enemy, apply attack roll |
| `arenaRanged(state, now, rng, dir?)` | `arena.ts:709` | Fire a player projectile in the facing direction |
| `arenaAct(state, now, rng, dir?)` | `arena.ts` | Context: melee if adjacent, else ranged |
| `arenaCast(state, spellKey, now, rng, opts?)` | `arena.ts` | Cast any known spell by key |
| `arenaUseItem(state, itemKey, now)` | `arena.ts` | Use a battle-context consumable |
| `arenaTick(state, now, rng)` | `arena.ts` | Advance all clocks |
| `bossThink(s, now, field, rng)` | `arena.ts` | Boss AI: uses `s.bossRecoverMs` for recovery delay |
| `stepMinions(s, now, field, rng)` | `arena.ts:1033` | Bat (melee) and archer (kiting + projectile) behavior |
| `stepProjectiles(s, now, rng)` | `arena.ts` | Advances all projectiles; routes `source:'minion'` to `strikePlayer` |
| `resolveTelegraphs(s, now, rng)` | `arena.ts` | Fire resolved telegraphs, apply player damage |
| `triggerRunes(s, now, rng)` | `arena.ts` | Check rune collisions for all units |
| `tickRingOfFire(s, now, rng)` | `arena.ts` | Damage adjacent enemies from ring aura |
| `floodField(target, radius, obstacles)` | `arena.ts:270` | BFS flow field from player for pathfinding |
| `flowStep(from, field, radius, blocked)` | `arena.ts:293` | Pick best next step from flow field |
| `damageProgress(s)` | `arena.ts:612` | Fraction of boss total HP worn down |
| `previewRuneTarget(s, desired)` | `arena.ts` | Read-only clamp used by hover preview in overlay |
| `commitArena(state, run)` | `useGameStore.ts` | Distribute XP, apply reward, close run |
| `arenaSpeedFactor(setting, level)` | `arena.ts:362` | Compute speed multiplier |

### State management

All arena state lives in one `ArenaState` object inside the Zustand store at `gameState.arena`. Every action function clones the state via `clone(s)` (`arena.ts:593`) — a shallow clone with deep copies of all mutable array fields — and returns the new state. The store writes the result back with `set()`.

Notable new fields on `ArenaState`:
- `bossGlyph: string` — sourced from `BossDef.glyph`, falls back to `'👹'`
- `minionVariant: MinionVariant` — the active variant for newly spawned minions
- `bossRecoverMs: number` — per-phase override for the boss's post-attack recovery window
- `damageDealt: number` — running total of all damage dealt, used by `RunSummary`

The overlay subscribes to `useGameStore((s) => s.arena)` and re-renders on every state change. Local overlay state (`floats`, `hitAt`, `castAt`, `hoverCell`) is not persisted. Slot bindings are now stored in the persisted `settings` object.

### Double-fire fix

The previous `controls.act(dir)` implementation both set `actQueued.current = true` and immediately called `arenaAct(now, dir)`, causing a phantom second attack on the next loop iteration. This is fixed in `useArenaLoop.ts:156–163`: when `dir` is provided, `act(dir)` calls `arenaAct` immediately and does NOT queue; when no dir is provided, it queues normally. The `ArenaControlsApi` comment documents this explicitly.

### Data flow

```
real time (rAF, 90 ms) ──► useArenaLoop ──► store.arenaTick(now)
                                         └──► store.arenaMove(dir)
                                         └──► store.arenaAct/melee/ranged/cast/useItem
                                         └──► store.arenaCast (1–9 keys, direct)
                                                         │
                                                         ▼
                                              engine function (pure)
                                              returns new ArenaState
                                                         │
                                                         ▼
                                              Zustand set() ──► ArenaOverlay re-render
```

### Save/load

`ArenaState` is part of the persisted Zustand store (localStorage). In-progress fights survive page refresh. Migration versions clear `arena: null` during schema upgrades. `deepestArenaTier` is a persistent high-score value. `settings.arenaBindLeft` and `settings.arenaBindRight` persist slot bindings between sessions.

---

## 6. Software, Libraries, and Tools Used

| Concern | Technology |
|---|---|
| Framework | React 18 (functional components, hooks) |
| Language | TypeScript |
| Build/dev server | Vite |
| State management | Zustand with `persist` middleware (localStorage) |
| Styling | Tailwind CSS v3 + custom utility classes |
| Animation | CSS `@keyframes` in `src/index.css`; CSS transitions on HP bar and sprite positions |
| Game loop | `requestAnimationFrame` (inside `useArenaLoop`) |
| Rendering | DOM/CSS — no canvas, no WebGL |
| Sprite/unit art | Emoji glyphs (🧝 🫧 🗿 👹 🦇 🐺 🪨 etc.) |
| Icons | Lucide React (`Heart`, `Zap`, `Sparkles`, `Swords`, `Volume2`, `VolumeX`, etc.) |
| Grid math | Custom `src/engine/grid.ts` |
| Combat math | Custom `src/engine/combat.ts` |
| Pathfinding | Custom BFS in `arena.ts` |
| Audio | Custom Web Audio synthesis (`src/lib/sfx.ts`); zero asset files |
| Testing | Vitest (46 tests in `arena.test.ts`) |
| Physics | None — all movement is discrete cell steps |

---

## 7. Assets and Presentation

### Visual style

The Arena shares the game's "aged tavern parchment" aesthetic — dark wood textures, parchment backgrounds, gold/ember accent colors. The board is rendered as a grid of square `<div>` elements with slightly varying dark teal floor tints generated deterministically per cell (`floorTint()`).

### Unit art

All entities are emoji rendered at scaled `font-size`:

| Entity | Normal | Frozen | Dead/Won |
|---|---|---|---|
| Player | 🧝 | 🧊 | 💀 |
| Boss (slime) | 🫧 | — | 💥 (then animated out) |
| Boss (golem) | 🗿 | — | 💥 (then animated out) |
| Boss (generic) | 👹 | — | 💥 (then animated out) |
| Minion (bat) | 🦇 | 🧊 | `💨` floater |
| Minion (archer) | 🐺 | 🧊 | `💨` floater |

Boss glyph is now read directly from `arena.bossGlyph`, which is set from `BossDef.glyph` at arena creation. The `bossGlyph()` substring-matching helper no longer exists. Any boss definition without an explicit `glyph` field falls back to `'👹'` in `createArena()`. The minion glyph is driven by `MINION_GLYPH[m.variant]` in the overlay, with `'🦇'` as the fallback.

Obstacles are emoji chosen deterministically from `['🪨', '🌲', '🪵']` via a hash of cell coordinates (`obstacleGlyph()`).

### Spell/rune art

Rune traps show their emoji (🔥 ❄️ ☠️) inside a translucent colored cell that pulses using the `arena-telegraph` animation. Ring of fire shows glowing orange tint on adjacent cells plus a pulsing orange circle around the player.

The rune placement preview (when hovering with a rune spell active) renders a translucent cell of the correct rune color plus a matching colored border outline at the clamped target position.

### Animations

| Animation | Trigger | Duration |
|---|---|---|
| `arena-hit` | Player takes damage | 0.45 s, red vignette flash |
| `arena-cast` | MP decreases by ≥2 | 0.4 s, expanding violet ring on player |
| `arena-cast` (ring of fire) | Ring active | 1 s loop, orange circle |
| `arena-telegraph` | Any active telegraph tile | Scales to windup window, brightens 16%→82% |
| `arena-boss-die` | Boss HP reaches 0 in final phase | 0.65 s, flash white → scale up → collapse to 0 opacity |
| `arena-boss-phase` | Boss phase transition | 0.55 s, swell + hue-rotate → return to normal |
| `loot-float` | Any HP/MP/dodge/minion-death delta | 0.85 s, number/text rises and fades |
| Sprite CSS transition | Unit position changes | 120 ms linear |

Both `arena-boss-die` and `arena-boss-phase` are triggered by remounting the inner boss sprite `<div>` via `key={won ? 'dead' : arena.phaseIndex}`. React discards the old element and mounts a fresh one, restarting the CSS keyframe from 0 without needing JavaScript timers.

All boss animations are guarded in the `prefers-reduced-motion: reduce` media query (animation-duration forced to 1 ms).

Projectiles are cyan glowing dots (`bg-cyan-300` + `box-shadow`), moving across the board as the projectile array updates. Minion projectiles and player projectiles use the same visual.

### Audio

`src/lib/sfx.ts` provides all Arena sounds through synthesized Web Audio. There are no audio asset files. The module is a singleton; the `AudioContext` is created lazily on first use and requires `sfx.resume()` from a user gesture. All arena SFX call sites in `ArenaOverlay.tsx` include `void sfx.resume()` before `sfx.play()` to satisfy autoplay policy. The master gain smoothly ramps on mute/unmute to avoid clicks.

The adaptive tension drone from `sfx.ts` (`startDrone`/`stopDrone`/`setDroneIntensity`) is not currently used in the Arena (it was introduced for Rooftop Chase).

---

## 8. Current Player Experience

### What works well

**Telegraph-and-dodge is a clear, compelling core loop.** The brightening tile animation gives enough visual warning that dodging feels learnable and fair. Pattern labels (SLAM / LINE / NOVA / VOL) are now printed on the first danger tile, making the incoming attack legible even to new players.

**Stamina rhythm creates texture in attacks.** Running low on stamina causes noticeably weaker hits, adding pacing cadence to melee/ranged play without complex UI feedback.

**Retreat option.** The ability to bank partial rewards before dying makes the Arena feel less punishing.

**Sound gives the fight weight.** Melee swings, arrow whooshes, spell casts, player pain, and boss roars on phase transitions all land correctly. The `arenaDodge` whoosh gives tactile confirmation when the AG stat saves the player. `victory` and `defeat` stings frame the outcome cleanly.

**"Dodge!" floater closes the AG loop.** The AG stat's contribution to survivability is now visible: a cyan "Dodge!" text floats up from the player on each successful evasion, reinforcing the investment.

**Weakness/resistance HUD removes guesswork.** The green/red stat badges below the boss HP bar tell the player exactly which attacks to favor. This makes the "right attack" decision real rather than hidden.

**Slot bindings persist across runs.** Players no longer lose their preferred melee/spell binding when a run ends. The setting survives page refresh.

**Number keys let spells compete with attacks.** Keys 1–N quick-fire spells and items without clicking the ability bar, making spell usage viable during live movement.

**Boss pool is meaningfully varied.** Seven named bosses at levels 5, 8, 12, 15, 20, 25, and 30 each have distinct glyphs, stat profiles, weaknesses, and phase behaviors. Fights at those tiers feel authored rather than generic.

**Phase scripting creates fight arcs.** Multiple named bosses switch attack school mid-fight (from physical to magic), forcing the player to adapt. The Clockwork Tyrant phase 2 spawns two extra archer minions on entry, creating a chaotic pressure moment. Per-phase `recoverMs` means later phases feel faster and more dangerous.

**Authored layouts give memorable rooms.** Six hand-designed obstacle configurations mix into the random map pool (~30% of runs), giving some fights recognizable geometry (three-lane walls, symmetric pillars, central cross).

**Minion variants add positional decisions.** Archer minions force the player to either close and disrupt them or take ranged chip damage. The different glyph (🐺) immediately signals a different threat type. The HUD minion count shows the active variant glyph, so the player knows what they are dealing with from the boss bar.

**Rune placement preview removes guesswork.** Hovering the board with a rune spell active shows exactly where the rune will land (accounting for `clampRuneTarget`), eliminating the "where did it go?" confusion.

**Run summary makes outcomes meaningful.** The outcome screen now shows damage dealt, total actions, dodge count, focus stat, and elapsed time. Players can track what their build is doing run-over-run.

**Board scales nicely with radius.** Cell size shrinks (34→30→26 px) automatically. Larger boards feel genuinely more complex with obstacles and minion pressure.

**Tests are comprehensive.** 46 unit tests in `arena.test.ts` cover nearly every subsystem. The pure functional engine pattern makes all mechanics independently testable.

### What is still awkward

**Slot binding system discoverability.** Even though bindings persist and the hint line was updated, right-clicking to bind the right slot is not obvious from the ability bar's visual design. New players are likely to miss it.

**MP regeneration vs spell cost.** At 1.8 MP/s, Ring of Fire (10 MP) costs ~5.6 s of regeneration. Spell-heavy builds can still feel MP-starved in fast fights, especially in speed 1.2× runs.

**Archer projectiles are visually identical to player bolts.** Both are cyan glowing dots. A player hit by a minion bolt with no visible source is likely to be confused the first time.

**Procedural bosses are still thin.** Levels not covered by a named boss get `Trial Guardian (Lv N)` with `weakTo: []`, no phases, and 👹. The named bosses cover tiers 5, 8, 12, 15, 20, 25, 30 — tiers 1–4, 6–7, 9–11, 13–14, 16–19, 21–24, 26–29 are all generic.

**No scripted behaviors for procedural bosses.** Pattern selection is purely distance + RNG for all non-named bosses. There is no enrage at low HP for generic fights, no mid-fight personality shift.

**No pre-run loadout selection.** The player enters with all known spells and equipped weapon — there is no equivalent of Tactics' pre-run loadout screen for Arena.

### Pacing

Named boss fights have real arcs now: phase 2 of the Slime speeds up and switches to magic; the Tyrant opens a wave of extra archers. Generic fights (most of the level range) still plateau after phase 1 because there is only one phase and no authored behavior change at low HP.

### Difficulty curve

The authored layouts have reduced the extreme variance from the pure-random map pool, but a radius-5 heavy-density fight is still significantly harder than a radius-3 light-density fight at the same tier. Per-level authored layouts would reduce this further.

---

## 9. Known Issues and Weak Points

**Design issues:**

1. **Procedural boss gap.** Named bosses cover only 7 specific levels. The majority of level tiers produce generic Trial Guardians with identical behavior, no weaknesses, and the 👹 fallback glyph. The game still feels thin across most of the level range.
2. **No scripted behaviors for generic bosses.** `bossThink()` uses only the four distance-based patterns. Non-named bosses have no enrage at low HP, no attack school change, no scripted phase.
3. **Archer projectiles share the player bolt visual.** Minion-fired `source:'minion'` projectiles look identical to player bolts (cyan dot). Players hit by them with no context are likely confused.
4. **MP economy still tight at high speed.** At 1.8 MP/s and 1.2× speed, spells feel scarce enough that some players will default to melee/ranged exclusively.
5. **No pre-run loadout.** Players can't configure spell or item selection before entering; the Arena auto-includes all known spells and the equipped weapon.

**Technical issues:**

6. **Click→cell DPI robustness.** `pixelToCell` and `centerFor` rely on `getBoundingClientRect`. No test covers the conversion at non-1× device pixel ratios or page zoom. Rune placement clicks could theoretically misfire on HiDPI displays.
7. **`deepestArenaTier` only counts wins.** It advances only on a full boss defeat. A player who consistently retreats at 80% boss HP would show tier 0 as a progress metric despite meaningful engagement.
8. **Gear beyond weapon not reflected.** `createArena()` snapshots only the weapon into the `Fighter`. Armor, accessories, and passive items do not feed `defense`/`ward`/etc. This may be intentional but is not documented.
9. **Level-up vs arena state collision uninvestigated.** A `pendingLevelUp` can be queued during an Arena run. Both use `gameState.arena`-adjacent state. Whether the level-up boss battle (`startBattle`) can conflict with an active Arena run remains unverified.

---

## 10. Remaining Improvement Opportunities

**Controls and UX:**
- Better visual discoverability for right-click slot binding — the L/R badge system is correct but the mechanic is still undiscoverable without the hint text.
- Pre-run loadout selection (Tactics already has this — mirror it for Arena in `ArenaView.tsx`).
- Player sprite directional facing glyph (currently the floor facing-highlight is the only directional indicator on the player).

**Bosses and content:**
- Expand named bosses to cover more of the level range; currently 7 / ~28 non-trivial tiers are authored.
- Scripted behaviors for procedural bosses: a simple per-boss enrage at <25% HP (lower `bossNextActionMs`) would add a universal low-HP pressure moment without per-level authoring.
- The Clockwork Tyrant and Mirror Demon at levels 30/25 are the ceiling; a final boss at a higher tier (e.g., 35+) with a full three-phase arc could mark a genuine "endgame" run.
- Generic boss `weakTo` / `resistTo` from `bossForLevel()` — even random stat weaknesses per run would make the weakness HUD useful for more than named encounters.

**Minion variants:**
- Visual differentiation for minion projectiles (e.g., orange/red dot) so players can distinguish archer bolts from their own ranged bolts.
- A third minion variant (e.g., armored/shielded bat that resists melee and must be hit with spells or ranged) could extend the positional vocabulary.

**Feedback and polish:**
- Rune expiry warning: a pulsing highlight or visual countdown when a placed rune is about to expire (`rune.expiresAtMs - now < 2000`).
- Boss dialogue / phase-transition message display: `BossPhase.transitionMsg` is set on several named bosses but is not currently rendered anywhere in the overlay.
- Outcome screen: show boss name and tier (already on the modal background but not in the reward description text).

**Difficulty:**
- Dynamic obstacle density could account for player level rather than being purely roll-based, narrowing the easy/hard variance at the same tier.
- Optional hard mode: smaller iframe window, faster minion respawn, or an extra boss phase.

**Code:**
- Add visual differentiation for `source:'minion'` projectiles in `ArenaOverlay.tsx` (currently shares the cyan bolt appearance).
- Render `BossPhase.transitionMsg` in the outcome area or as a floating toast on phase transition.
- Investigate level-up vs Arena state collision (`pendingLevelUp` + active arena run).
- Add `pixelToCell` unit test at non-1× DPI (HiDPI rune placement robustness).

**Integration:**
- `deepestArenaTier` as a progress metric: consider tracking a secondary "highest damage fraction" including retreats/deaths for a more encouraging signal.
- Pre-run spell/item loadout selection (mirroring Tactics' approach).
- Gear beyond weapon affecting the Arena snapshot — decide and document intentionality.

---

## 11. Questions and Unknowns

1. **What is the intended endgame for the Arena?** Named bosses now cover 7 level tiers; the cap is level 30. Is there a planned final tier, or is the Arena intentionally open-ended?

2. **Should procedural bosses have authored weaknesses?** `bossForLevel()` returns `weakTo: []` for all generic bosses. The weakness HUD and the weakness multiplier system are both live, but they only benefit runs against the 7 named bosses.

3. **Should `BossPhase.transitionMsg` be rendered?** It is set on 6 of the 7 named boss phase-2 definitions but has no UI surface. Is it intended for a future flavor toast, or should it be wired in now?

4. **Is the rune placement click reliable across zoom levels and different screen DPIs?** `pixelToCell` and `centerFor` rely on bounding rect math. No test covers click→cell at non-1× device pixel ratios.

5. **What happens when `pendingLevelUp` is queued during an Arena run?** Both the level-up boss battle and the Arena run use `gameState.arena`. Whether the two can collide remains unverified.

6. **Should gear beyond weapon affect the Arena snapshot?** Currently only the weapon feeds the snapshot. Is this intentional, and if so, should it be documented?

7. **Is MP regeneration balanced at 1.8/s?** At 1.2× speed, Ring of Fire's full 10 MP costs ~4.7 s of regeneration. Is this the intended scarcity level, or should per-cost or per-speed adjustments be made?

8. **Is `deepestArenaTier` meaningful as a progression metric?** It only advances on full wins. A player who retreats successfully at 90% boss HP never advances their tier. Is a "highest damage fraction" or "highest tier reached including retreats" a better measure?

9. **Should archer minion bolts have a distinct visual?** Currently they are rendered identically to player ranged bolts (cyan dot). Is this intentional for symmetry, or should they be distinguished by color or glyph?
