# Arena Minigame Analysis

*Based on the codebase as of June 2026. This is the second analysis; the first lives at `docs/arena-minigame-analysis.md`.*

---

## 1. Basic Summary

The Arena is a real-time boss duel on a square Chebyshev grid. The player fights a level-scaled boss in a single open room, using their character's full combat stats — melee, ranged bolts, spells, and consumable items — all driven in real time rather than through menus.

The central mechanic is telegraphed attacks: every boss blow lights up the affected tiles before the hit resolves, so dodging means physically stepping off those cells before the damage fires. The player must also manage stamina (for attacks) and MP (for spells) while kiting a pathfinding boss and an optional wave of minions.

Within the larger game the Arena fills the role of high-stakes, high-reward gating. It costs 3 energy to enter (earned by logging real-life habits), unlocks at level 3, and rewards gold, items, and stat XP proportional to both the boss tier and how much damage the player dealt before dying or retreating. The boss tier is pinned to the player's current level, so the Arena scales continuously with progression.

---

## 2. Core Game Loop

### Starting a run

The player visits the Arena tab (`ArenaView.tsx`) and presses "Enter the Arena." The store action `beginArena()` (`useGameStore.ts:2405`) gates on `character.level >= 3` and `character.energy >= 3`, then:

1. Calls `rollArenaSetup(tier, rng)` (`arena.ts:333`) to randomly pick board radius (3/4/5), obstacle density (light/medium/heavy), and starting minion count. Higher tiers skew toward larger boards and heavier obstacles.
2. Looks up the boss via `bossForLevel(level)` (`bosses.ts`).
3. Calls `createArena(fighter, boss, opts)` (`arena.ts:435`) which builds the initial `ArenaState` snapshot from the character's derived combat stats, places obstacles and starting minions, sets all clocks, and gives the boss a 1200 ms opening grace period before it can act.
4. Deducts 3 energy and stores the `ArenaState` in `gameState.arena`.
5. `ArenaOverlay.tsx` renders over the tab because `arena !== null`.

### During a fight

The `useArenaLoop` hook (`useArenaLoop.ts`) runs a `requestAnimationFrame` loop with three independent clocks:

- **Movement**: every 150 ms it reads held WASD/arrow keys (or held D-pad dirs) and calls `store.arenaMove(dir)`.
- **Attack**: Space/Enter presses are queued and fire at most every 200 ms via `store.arenaAct(now)`.
- **Tick**: every 90 ms it calls `store.arenaTick(now)`, which advances all enemy AI, projectiles, telegraphs, status effects, and resource regeneration.

The player:
- Moves around the board, stepping off telegraphed tiles.
- Attacks with melee (adjacent enemies), ranged bolts (travel across the board), and spells (direct damage, traps, utility).
- Manages stamina (drains on attacks, regenerates at 3/s) and MP (drains on spells, regenerates at 1.8/s).
- Avoids contact with minions that pathfind toward the player each tick.

### Challenge and difficulty

Difficulty comes from four interacting systems:

- **Boss patterns**: the boss chooses `slam` (1-cell radius around the player), `line` (column from boss toward player), `nova` (2-cell radius around the boss), or `volley` (4 random tiles near the player) based on the distance to the player. Pattern choice is probabilistic; close range biases toward nova/slam; long range toward line/volley.
- **Speed factor**: set by `arenaSpeedFactor(setting, level)` (`arena.ts:348`). On auto it ramps from 0.85× at level 3 to a cap of 1.2× at level ~23. All boss/minion timers are divided by `s.speed`, so a higher factor makes the boss act faster.
- **Minions**: large boards (radius 5) start with 2 minions and periodically spawn more every 12 s. They pathfind via BFS flow-field and deal contact damage.
- **Tier scaling**: boss base HP, attack, and defense increase per level. Named bosses at tiers 5 and 20 have manually tuned stats.

### Ending a run

Three outcomes exist:

| Outcome | Status | Reward |
|---|---|---|
| Win | `'won'` | Full gold + items from `boss.rewards` |
| Death | `'ended'` | `ARENA_DEATH_KEEP = 0.5` × `(gold × damageProgress)` |
| Retreat | `'banking'` | `1.0` × `(gold × damageProgress)` — no HP loss penalty |

`damageProgress()` (`arena.ts:555`) measures how far through all phases the player got. A retreat always beats death in gold because the 0.5 death penalty is not applied.

When the player clicks the outcome button, `endArena()` calls `commitArena()` (`useGameStore.ts:777`) which:
1. Distributes stat XP proportional to `statUsage` tallies recorded during the run (actions used → stats exercised → XP earned in those stats).
2. Applies gold and item rewards via `applyReward()`.
3. Calls `checkLevelUp()`.
4. Clears `gameState.arena` to `null`, collapsing the overlay.

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
| Space / Enter | Context attack (melee if adjacent, otherwise ranged) |

Input is managed by `useArenaLoop.ts`. Key state is tracked in `heldAxes` (a `Set<Axis>`) via `keydown`/`keyup` listeners. Movement fires on a 150 ms polling interval, not on each keypress.

### Mouse / pointer on the board

Clicking the board (`ArenaOverlay.tsx:201`) computes the direction from the player's cell center to the click point and fires whichever action is bound to the left or right slot:

- **Left-click** fires the left-bound slot action in that direction.
- **Right-click** fires the right-bound slot action in that direction.

Clicks very close to the player's own cell (within 40% of cell size) are ignored to avoid misfires.

For rune spells, the exact click position is also converted to a grid cell (`pixelToCell`) and passed as the placement target.

### Ability bar

Below the board (`ArenaOverlay.tsx:431`) is a row of `AbilityButton` components — one per action type (Melee, Shoot, each known spell, each inventory item):

- **Left-click** an ability button: fires it immediately and binds it to the left board-click slot (shown with a cyan "L" badge).
- **Right-click** an ability button: binds it to the right board-click slot (shown with an amber "R" badge) without firing.
- Spell buttons dim (disabled) when MP is insufficient.
- Item buttons show a "×N" quantity badge.

Slot bindings are local React state (`leftSlot`, `rightSlot`) and reset on each run.

### Touch / D-pad

`ArenaControls.tsx` renders a 3×3 grid of directional buttons (↖ ↑ ↗ ← · → ↙ ↓ ↘) plus a large circular "Attack" button. Each direction button uses pointer events (`onPointerDown`/`onPointerUp`/`onPointerLeave`/`onPointerCancel`) to call `controls.press(dir)` and `controls.release(dir)`. The attack button calls `controls.act()`.

### HUD elements

- **Boss HP bar**: full-width at the top, with a phase dot indicator for multi-phase bosses. Bar color: ember-bright red.
- **Boss name + tier**: displayed above the bar.
- **Player gauges**: HP (green), MP (indigo), Stamina (amber), each shown as a small icon + bar + `N/Max` readout.
- **Status badges**: emoji icons (🛡️ 🔥 🔻 💫 ❄️ ☠️) floating above the boss and player for active status effects.
- **Damage floaters**: animated numbers rising from the damaged unit's position. Gold = boss damage, red = player damage taken, green = healing.
- **Telegraph glyph**: a small emoji (💥 ➡️ ✸ ⁂) rendered on the first tile of each active telegraph for quick pattern recognition.
- **Facing highlight**: the cell in the player's current facing direction gets a golden outline on the floor tile.

### Feedback signals

- **Hit vignette**: a full-screen red edge flash (`arena-hit` CSS animation, 0.45 s) on any player damage received.
- **Cast ring**: an expanding violet circle on the player when MP drops by ≥2 (`arena-cast` animation, 0.4 s).
- **Telegraph brightening**: danger tiles use `arena-telegraph` animation that runs from 16% to 82% opacity over the full windup window.
- **Projectile glyph**: cyan glowing dot tracks across the board per step (every 60 ms).
- **Frozen units**: player and minions become 🧊 with reduced opacity when frozen.

### Outcome modal

When `arena.status` is `'won'`, `'ended'`, or `'banking'`, an overlay fades in on top of the board with an icon (🏆 💀 🚪), a title, a description of the reward split, and a "Claim Reward" / "Leave the Arena" button.

---

## 4. Mechanics and Systems

### Board and grid

The board is a square Chebyshev grid (diagonals count as distance 1). Radius 3/4/5 means a `(2r+1)×(2r+1)` cell square — 49, 81, or 121 cells total. All positions are `{x, y}` integers, center at `{0,0}`.

Player starts at `{0, +radius}` (bottom center); boss starts at `{0, -radius}` (top center).

Grid utilities live in `src/engine/grid.ts`: `board(r)` returns all in-bounds cells, `step(cell, dir)` moves one cell, `distance(a, b)` is Chebyshev distance, `line(start, dir, n)` generates a ray, `neighbors(h)` returns 8 adjacent cells, `range(h, r)` returns all cells within Chebyshev radius `r`.

### Obstacles

Randomly placed at arena creation via `genObstacles()` (`arena.ts:359`). Obstacles block movement (player and enemies) and absorb projectiles. The player's starting area and the boss's starting area plus their immediate neighbors are excluded from obstacle placement. Density fractions: light=6%, medium=16%, heavy=30% of board cells.

No authored layouts exist — layouts are always random.

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

Stamina regenerates at 3 per second. Melee and ranged attacks drain the weapon's `staminaCost` (or `BASE_ATTACK_STA = 2` if the weapon's `attackStat` doesn't match). When stamina is below cost, the attack fires but deals reduced damage (the `full` flag in `attackRoll` is false). Stamina is not consumed by spells.

### MP

MP regenerates at 1.8 per second (raised from 1.2 — comment in `arena.ts:50`). Spells have independent MP costs (6–10). Spells cannot fire if `mp < spell.mpCost`. MP and attack cooldowns are independent (`cooldownUntilMs` vs `spellCooldownUntilMs`), so spells and attacks can interleave.

### Cooldowns

| Action type | Cooldown |
|---|---|
| Melee / ranged | `ATTACK_CD_MS = 320 ms` |
| Spells | `SPELL_CD_MS = 520 ms` (independent of attack CD) |
| Items | `ITEM_CD_MS = 700 ms` |

There is also a `IFRAME_MS = 550 ms` invincibility window after the player is hit, preventing multi-tick damage from the same source.

### Telegraph system

When the boss is ready to act, `bossThink()` (`arena.ts:1046`) picks a pattern and pushes a `Telegraph` object to `state.telegraphs`. Each telegraph has:

- `tiles`: the cells that will be damaged.
- `firesAtMs`: when it resolves.
- `startedAtMs`: when it was created (used to drive CSS animation duration).
- `raw`: pre-computed raw damage with variance.
- `school`: `'physical'` or `'magic'` (determines color: red vs purple on the board).

`resolveTelegraphs()` (`arena.ts:873`) runs each tick and fires any telegraph whose `firesAtMs <= now`. If the player is on any hit tile, `strikePlayer()` is called.

| Pattern | Windup | Damage mult | Coverage |
|---|---|---|---|
| `slam` | 800 ms | 1.30× | All cells within 1 of the player |
| `line` | 760 ms | 1.05× | Column from boss toward player (stops at obstacles/wall) |
| `nova` | 950 ms | 1.15× | All cells within 2 of the boss (excluding boss cell) |
| `volley` | 860 ms | 0.85× | Player cell + 3 random cells within 2 of the player |

Blind status (`dazzle` spell) gives a 40% chance the boss skips its action entirely.

### Damage resolution

`attackRoll()` and `spellDamageRoll()` from `engine/combat.ts` are shared with the turn-based battle system, so numbers are consistent across the game. Weakness/resistance arrays from the boss definition apply 1.3×/0.7× multipliers. Defense and ward reduce flat damage after weakness/resistance.

Dodge (`strikePlayer()`, `arena.ts:837`): if `rng() < s.dodge`, the hit is entirely negated and `lastDodgedAtMs` is set (for a "Dodge!" floater, though no floater is currently rendered for it — the timestamp is stored but not used visually). Each successful dodge increments `statUsage.AG`.

### Rune spells

Fire, ice, and poison runes are placed on adjacent tiles. `clampRuneTarget()` (`arena.ts:699`) clamps the desired placement to an adjacent, in-bounds, unobstructed cell, falling back to any adjacent valid cell. Runes expire after 12 s if not triggered.

When any unit (player, boss, or minion) steps onto a rune tile, `triggerRunes()` (`arena.ts:883`) fires:

| Rune | Hit effect | Secondary effect |
|---|---|---|
| Fire | Wisdom-scaled magic damage | Burns boss for 2 turns |
| Ice | Wisdom-scaled magic damage | Freezes boss/minion for 3 s |
| Poison | Wisdom-scaled magic damage | Poisons target for 3 turns |

The player can also trigger their own runes, so placement matters.

### Ring of fire

`ring_of_fire` spell (10 MP) activates a 3.5 s aura. Each tick, `tickRingOfFire()` (`arena.ts:931`) deals damage to every enemy (boss + minions) within Chebyshev distance 1 every 600 ms (per-enemy cooldown). The ring deals a flat `max(2, power + damageSpell × 0.5)` damage.

The board shows glowing orange highlight on all 8 cells adjacent to the player. A pulsing orange circle animates around the player sprite.

### Minion system

Minions spawn adjacent to the boss on summon. Up to `MINION_CAP = 4` minions exist simultaneously. Radius-5 boards spawn minions on every phase transition and every 12 s during the fight. Radius-4 boards spawn 1 at phase transitions only. Radius-3 boards spawn none.

Each tick, `stepMinions()` (`arena.ts:954`):
1. Applies poison DoT if active.
2. Skips all action if frozen (`frozenUntilMs > now`).
3. Moves one step toward the player via the BFS flow field if not adjacent (every 520 ms scaled by speed).
4. Deals contact damage if adjacent (every 900 ms scaled by speed).

Minion HP is 18% of the boss's phase HP; attack is 35% of the boss's phase attack. On phase transitions, minion stats rescale to the new phase.

### BFS flow-field pathfinding

`floodField(target, radius, obstacles)` (`arena.ts:256`) runs BFS outward from the player's current cell across all non-obstacle, in-bounds cells, producing a `Map<cellKey, distance>`. This runs once per tick and is shared by the boss and all minions.

`flowStep(from, field, radius, blocked)` (`arena.ts:279`) picks the adjacent cell with the smallest distance-to-player. If no neighboring cell has a shorter distance than the current position, it returns `null` (already adjacent or stuck). The `blocked` set prevents collisions between units.

### Phase system

`BossDef` supports a `phases?: BossPhase[]` array. If provided, the boss transitions through each phase as HP reaches 0. `resolveBossDown()` (`arena.ts:561`) advances the phase index, resets HP to the new phase max, resets the boss position, clears telegraphs and enemy statuses, and spawns the phase's minion complement.

If only one phase is defined (most procedural bosses), the boss dies on HP reaching 0.

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

Effects stack by taking the max of current vs new magnitude and extending expiry. `tickStatuses()` (`arena.ts:980`) processes DoT and prunes expired effects.

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

`commitArena()` distributes XP proportionally: `statXp[stat] = max(1, round((usage[stat] / totalUsage) * budget))`. Budget is `(4 + tier) × (0.4 + 0.6 × damageProgress)`. A pure melee run earns ST+EN XP; a spell-heavy run earns WI/KN/CH XP.

### Speed setting

Four settings in `ArenaSpeed`: `'slow'` (0.85×), `'normal'` (1.0×), `'fast'` (1.2×), `'auto'`. Auto ramps from 0.85× at level 3 to 1.2× at level ~23 via `arenaSpeedFactor()`. The factor divides all enemy action timers (`bossNextActionMs`, `bossNextMoveMs`, minion move/hit CDs, summon CD). Lower factor = slower enemies = easier.

### Win/loss conditions

- **Win**: boss HP reaches 0 in the final phase → `status = 'won'`.
- **Death**: player HP reaches 0 → `status = 'ended'`.
- **Retreat**: player presses Retreat button → `beginArenaBanking()` sets `status = 'banking'`.

All three states freeze the clock (the tick guard in `arenaTick` returns early if status is not `'active'`).

### Invincibility mode

A dev setting (`settings.invincible`) disables all player damage and auto-refills HP/MP/STA each tick. Used for testing. Does not gate rewards.

---

## 5. Technical Implementation

### File map

| File | Purpose |
|---|---|
| `src/engine/arena.ts` | Pure functional engine: all rules, state types, exported action functions, `arenaTick` |
| `src/engine/bosses.ts` | `BossDef` type, `NAMED_BOSSES` record, `bossForLevel()` |
| `src/engine/spells.ts` | Spell definitions, `getSpell()`, `SCHOOL_STAT` map |
| `src/engine/items.ts` | Item definitions, `getItem()` |
| `src/engine/grid.ts` | `Cell`, `Dir`, `board()`, `step()`, `distance()`, `line()`, `neighbors()`, `range()`, `inBoard()`, `stepToward()`, `cellToPixel()`, `boardPixelSize()` |
| `src/engine/combat.ts` | Shared damage math: `attackRoll()`, `spellDamageRoll()`, `spellHealAmount()`, `variance()` |
| `src/hooks/useArenaLoop.ts` | `requestAnimationFrame` loop, keyboard/touch input, returns `ArenaControlsApi` |
| `src/views/ArenaView.tsx` | Entrance screen (tab content when no run is active) |
| `src/components/arena/ArenaOverlay.tsx` | Full-screen live fight UI, board rendering, HUD, outcome modal |
| `src/components/arena/ArenaControls.tsx` | Touch D-pad and attack button |
| `src/store/useGameStore.ts` | Zustand store, all arena actions (`beginArena`, `arenaMove`, `arenaAct`, `arenaMelee`, `arenaRanged`, `arenaCast`, `arenaUseItem`, `arenaTick`, `beginArenaBanking`, `endArena`), `commitArena()` |
| `src/engine/__tests__/arena.test.ts` | ~650 lines of Vitest specs |
| `src/index.css` | CSS keyframe animations: `arena-telegraph`, `arena-hit`, `arena-cast`, `loot-float` |

### Key functions

| Function | Location | Role |
|---|---|---|
| `createArena(fighter, boss, opts)` | `arena.ts:435` | Build initial `ArenaState` |
| `rollArenaSetup(tier, rng)` | `arena.ts:333` | Randomize radius, density, minion count |
| `arenaMove(state, dir)` | `arena.ts:607` | Move player, check freeze and bounds |
| `arenaMelee(state, now, rng, dir?)` | `arena.ts:619` | Swing at adjacent enemy, apply attack roll |
| `arenaRanged(state, now, rng, dir?)` | `arena.ts:650` | Fire a projectile in the facing direction |
| `arenaAct(state, now, rng, dir?)` | `arena.ts:677` | Context: melee if adjacent, else ranged |
| `arenaCast(state, spellKey, now, rng, opts?)` | `arena.ts:712` | Cast any known spell by key |
| `arenaUseItem(state, itemKey, now)` | `arena.ts:808` | Use a battle-context consumable |
| `arenaTick(state, now, rng)` | `arena.ts:1079` | Advance all clocks (projectiles → telegraphs → minions → runes → ring → statuses → boss AI) |
| `bossThink(s, now, field, rng)` | `arena.ts:1046` | Boss AI: choose pattern, push telegraph |
| `stepMinions(s, now, field, rng)` | `arena.ts:954` | BFS move + contact attack for each minion |
| `resolveTelegraphs(s, now, rng)` | `arena.ts:873` | Fire resolved telegraphs, apply player damage |
| `triggerRunes(s, now, rng)` | `arena.ts:883` | Check rune collisions for all units |
| `tickRingOfFire(s, now, rng)` | `arena.ts:931` | Damage adjacent enemies from ring aura |
| `floodField(target, radius, obstacles)` | `arena.ts:256` | BFS flow field from player for pathfinding |
| `flowStep(from, field, radius, blocked)` | `arena.ts:279` | Pick best next step from flow field |
| `resolveBossDown(s, now, rng)` | `arena.ts:561` | Advance phase or set `status = 'won'` |
| `damageProgress(s)` | `arena.ts:555` | Fraction of boss total HP worn down |
| `arenaReward(s)` | `arena.ts:1114` | Compute gold/item reward for outcome |
| `commitArena(state, run)` | `useGameStore.ts:777` | Distribute XP, apply reward, close run |
| `arenaSpeedFactor(setting, level)` | `arena.ts:348` | Compute speed multiplier |

### State management

All arena state lives in one `ArenaState` object inside the Zustand store at `gameState.arena`. Every action function clones the state via `clone(s)` (`arena.ts:536`) — a shallow clone with deep copies of all mutable array fields — and returns the new state. The store writes the result back with `set()`. The loop hook reads state via `useGameStore.getState()` (not reactive subscriptions) to avoid re-renders mid-tick.

The overlay subscribes to `useGameStore((s) => s.arena)` and re-renders on every state change. React state inside the overlay (`floats`, `hitAt`, `castAt`, `leftSlot`, `rightSlot`) is purely local and not persisted.

### Data flow

```
real time (rAF, 90 ms) ──► useArenaLoop ──► store.arenaTick(now)
                                         └──► store.arenaMove(dir)
                                         └──► store.arenaAct/melee/ranged/cast/useItem
                                                         │
                                                         ▼
                                              engine function (pure)
                                              returns new ArenaState
                                                         │
                                                         ▼
                                              Zustand set() ──► ArenaOverlay re-render
```

### Save/load

`ArenaState` is part of the persisted Zustand store (localStorage). In-progress fights survive page refresh because `arena` is not nulled on save. However, all migration versions (e.g., `v14` in `useGameStore.ts:2613`) clear `arena: null` during schema upgrades, so fights do not survive a version bump. `deepestArenaTier` is a persistent high-score value.

### Configuration constants

All tuning values are `const` declarations at the top of `arena.ts` (lines 38–87). There is no external config file. Boss definitions are in `src/engine/bosses.ts`; spell definitions in `src/content/spells.ts`; item definitions in `src/engine/items.ts`.

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
| Sprite/unit art | Emoji glyphs (🧝 🫧 🗿 👹 🦇 🪨 etc.) |
| Icons | Lucide React (`Heart`, `Zap`, `Sparkles`, `Swords`, etc.) |
| Grid math | Custom `src/engine/grid.ts` |
| Combat math | Custom `src/engine/combat.ts` |
| Pathfinding | Custom BFS in `arena.ts` |
| Testing | Vitest |
| Physics | None — all movement is discrete cell steps |
| Audio | None |

---

## 7. Assets and Presentation

### Visual style

The Arena shares the game's "aged tavern parchment" aesthetic — dark wood textures (`texture-wood` CSS class), parchment backgrounds, gold/ember accent colors. The board is rendered as a grid of square `<div>` elements with slightly varying dark teal floor tints generated deterministically per cell (`floorTint()`, `arena.ts` overlay). The overall look is minimalist but thematically consistent.

### Unit art

All entities are emoji rendered at scaled `font-size`:

| Entity | Normal | Frozen | Dead |
|---|---|---|---|
| Player | 🧝 | 🧊 | 💀 |
| Boss (slime) | 🫧 | — | 💥 |
| Boss (golem) | 🗿 | — | 💥 |
| Boss (generic) | 👹 | — | 💥 |
| Minion | 🦇 | 🧊 | (removed) |

Boss glyph is selected by substring match on `bossId` (`bossGlyph()` in `ArenaOverlay.tsx:32`). Any boss ID not matching 'slime' or 'golem' gets 👹.

Obstacles are emoji chosen deterministically from `['🪨', '🌲', '🪵']` via a hash of cell coordinates (`obstacleGlyph()`).

### Spell/rune art

Rune traps show their emoji (🔥 ❄️ ☠️) inside a translucent colored cell that pulses using the `arena-telegraph` animation. Ring of fire shows glowing orange tint on adjacent cells plus a pulsing orange circle around the player.

### Animations

| Animation | Trigger | Duration |
|---|---|---|
| `arena-hit` | Player takes damage | 0.45 s, red vignette flash |
| `arena-cast` | MP decreases by ≥2 | 0.4 s, expanding violet ring on player |
| `arena-cast` (ring of fire) | Ring active | 1 s loop, orange circle |
| `arena-telegraph` | Any active telegraph tile | Scales to windup window, brightens 16%→82% |
| `loot-float` | Any HP/MP delta | 0.85 s, number rises and fades |
| Sprite CSS transition | Unit position changes | 120 ms linear |

Projectiles are cyan glowing dots (`bg-cyan-300` + `box-shadow`), moving across the board as the projectile array updates.

### Audio

None. There are no sound effects or music in the Arena or anywhere in the game.

### UI art

Lucide React SVG icons for the HUD gauges (Heart, Sparkles, Zap) and ability bar buttons. Button styling uses the game's shared `Button` component. The outcome modal uses Trophy / Skull / LogOut icons.

---

## 8. Current Player Experience

### What works well

**Telegraph-and-dodge is a clear, compelling core loop.** The brightening tile animation gives enough visual warning that dodging feels learnable and fair. The 760–950 ms windup windows are long enough for a player to react with keyboard movement.

**Stamina rhythm creates texture in attacks.** Running low on stamina causes noticeably weaker hits, which adds a pacing cadence to melee/ranged play without needing complex UI feedback.

**Retreat option.** The ability to bank partial rewards before dying makes the Arena feel less punishing. Players can rationally decide to exit when low, rather than hoping to clutch a win.

**Board scales nicely with radius.** Cell size shrinks (34→30→26 px) automatically, keeping the full board visible at every size. Larger boards feel genuinely more complex due to obstacles and extra minions.

**Attack + spell cooldowns are independent.** Spells don't compete with basic attacks, which means a mage-style player (high WI) can cast between melee swings smoothly.

**Tests are comprehensive.** 650 lines of unit tests (`arena.test.ts`) cover nearly every subsystem. The pure functional engine pattern makes all mechanics independently testable.

### What is confusing or awkward

**Slot binding system is non-intuitive.** The left/right slot mechanic (click a button to bind it for board-click targeting) is the correct idea but requires multiple interactions before players understand it. The 9-pixel hint text at the bottom is easy to miss. New players will not realize they can right-click to bind the right slot.

**No "Dodge!" feedback.** `lastDodgedAtMs` is tracked and available but no visual indicator is rendered when a dodge succeeds. The player may not realize their AG stat is doing anything.

**Rune placement targeting is unclear.** Clicking the board places a rune if a rune spell is bound to that slot. There's no preview of where the rune will land before clicking. Players have to learn by doing.

**Boss glyph system is minimal.** Two named bosses get distinct emojis (🫧 🗿), everything else is 👹. A level 15 "Trial Guardian" and a level 20 "Burnout Golem" look identical if neither matches the substring check.

**No explanation of stat weaknesses.** The boss has `weakTo` and `resistTo` stat arrays, but the HUD does not surface them. Players have no way to know which attack type deals bonus damage.

**Telegraph glyphs are cryptic.** The small emoji icons (✸ ⁂ etc.) on telegraphs don't clearly communicate the pattern to a new player.

**MP regeneration vs cost.** At 1.8 MP/s, recovering 10 MP for Ring of Fire takes ~5.6 s. During a fast-paced fight, spells feel very rationed even at high WI. Players may simply not use their spells because they always feel scarce.

### What feels polished

The hit vignette, damage floaters, and cast ring provide a solid baseline of combat feedback. Sprite transitions at 120 ms linear keep unit movement smooth. The boss HP bar phases dots are a clean multi-phase indicator.

### What feels unfinished

- No audio at all — the game is silent.
- Boss glyphs and obstacle glyphs rely entirely on emoji, which renders inconsistently across platforms.
- Minion HP bars only appear when damaged (fine), but there's no minion count indicator in the HUD.
- The ArenaView entrance screen shows the upcoming boss but not the player's combat stats or spell loadout — the player enters blind.
- No kill counter or per-run statistics on the outcome screen beyond gold.

### Pacing

Phase 1 of any fight feels appropriately tense. If the boss has multiple phases, the transition is jarring (boss teleports to start position, telegraphs clear, minions respawn) but readable. Very long fights can feel repetitive because the boss has only four attack patterns and no scripted behaviors.

### Difficulty curve

The auto-speed curve is reasonable at low levels. The random board setup means two runs at the same tier can feel very different — a small board with light obstacles is notably easier than a large board with heavy obstacles and starting minions, even at the same boss tier. There is no authored difficulty progression within a fight; the boss does not get more aggressive as its HP drops (beyond phase transitions).

---

## 9. Known Issues or Weak Points

**Design issues:**

1. **Boss pool is thin.** Only two named bosses exist (at tiers 5 and 20). Everything else is `Trial Guardian (Lv N)` with the same glyph and generic flavor text. The boss encounter feels identical across 90% of runs.
2. **No boss scripted behaviors.** Pattern selection is purely distance + RNG. Bosses have no personality, no phase-change specials, no ability to change attack school mid-fight, no enrage.
3. **Random obstacle maps.** Each run is a different layout, which prevents learning the arena. There are no authored rooms with interesting geometry (choke points, pillars, corridors).
4. **Minions are passive.** Minions only pathfind and deal contact damage. They have no ranged attack, no special on death, no visual variety beyond the bat emoji.
5. **Weakness system is invisible.** `weakTo` / `resistTo` stat arrays exist on the boss but are never surfaced in the UI. Players optimizing for weaknesses have no information to act on.
6. **No dodge feedback.** `lastDodgedAtMs` is set but unused in the UI. The AG stat's contribution to survivability is invisible.
7. **No audio.** Every hit, spell, and death is silent.

**Technical issues:**

8. **Slot binding state resets per run.** `leftSlot` and `rightSlot` are local component state — they default to `'melee'`/`'ranged'` every run. Players who prefer a different binding must rebind each time.
9. **Boss glyph logic is fragile.** `bossGlyph()` does substring matching on `bossId`. Adding a boss with an ID that doesn't contain 'slime' or 'golem' always falls through to 👹. There's no compile-time guarantee.
10. **`lastDodgedAtMs` never used in ArenaOverlay.** The field is computed and stored but no component reads it for feedback. This is dead state.
11. **No structured stats on the outcome screen.** Players see gold earned but nothing about damage dealt, spells cast, or dodges made. The `statUsage` map has this data but it's discarded after XP distribution.
12. **`arenaAct` direction bug.** In `useArenaLoop.ts:142`, `controls.act(dir)` both queues the act (`actQueued.current = true`) and immediately fires `arenaAct(now, dir)`. On the next loop iteration, `actQueued` fires again without a direction. This effectively double-fires the action when `dir` is provided via the act API. The controls pad's attack button uses `controls.act()` (no dir), so it's fine there. The `ArenaControlsApi.act` with a dir parameter may not be used from the overlay, but the bug exists.

---

## 10. Improvement Opportunities

**Controls and UX:**
- Persistent slot bindings across runs (save `leftSlot`/`rightSlot` to localStorage or settings).
- "Dodge!" floater text when AG dodge triggers.
- Rune placement preview: show the target cell highlighted before the click commits.
- Keyboard shortcuts for spells (e.g., 1–5) to reduce reliance on ability bar clicks during live combat.
- Weakness indicator on the HUD (e.g., a small "Weak: DX" label on the boss HP bar).

**Bosses and content:**
- Expand `NAMED_BOSSES` with more distinct entries — at minimum one per 5 levels.
- Boss scripted behaviors: a phase-change roar that spawns extra minions, an enrage at 25% HP, a phase that switches `attackSchool` from physical to magic.
- Boss-specific glyphs and art beyond the three current emoji.
- Telegraph glyphs replaced with more readable indicators (colored arrows, AOE outlines).

**Board and environment:**
- A small set of authored arena layouts to mix with random generation — gives memorable "rooms."
- Obstacle types with different properties (e.g., a pillar that blocks line attacks but not nova).
- Board hazard tiles (lava patches, slippery ice) that add environmental variety.

**Minions:**
- Variant minion types per boss (e.g., ranged minions that stay at distance, armored minions that resist melee).
- Minion death visual (currently they disappear instantly).
- HUD minion count indicator.

**Feedback and polish:**
- Sound effects: hit sounds, spell sounds, boss roar on phase transition.
- Boss death animation beyond the instant emoji swap to 💥.
- Player sprite variety or directional facing glyph.
- Outcome screen: show damage dealt, spells cast, dodges performed, time elapsed.

**Difficulty:**
- Per-boss authored difficulty: a boss that starts slow and accelerates, a boss that telegraphs less time at low HP.
- Dynamic obstacle density that accounts for player level rather than being purely random.
- Optional hard mode with smaller iframe window or no invincibility frames.

**Code:**
- Fix the `controls.act(dir)` double-fire in `useArenaLoop.ts:141-142`.
- Replace `bossGlyph()` string matching with a `glyph` field on `BossDef`.
- Add a "Dodge!" floater using `lastDodgedAtMs` in `ArenaOverlay.tsx`.
- Surface `statUsage` on the outcome modal for post-run summary.

**Integration with larger game:**
- Pre-run spell loadout selection (Tactics has this; Arena does not — it uses all known spells).
- Gear/weapon choice at run entry rather than always using the equipped weapon.
- Arena-specific achievements or titles beyond `deepestArenaTier`.

---

## 11. Questions and Unknowns

1. **Is `deepestArenaTier` meaningful as a progression metric?** It only increments on wins, and wins require full boss defeat. Given the difficulty at higher tiers, many players may never see their tier advance past the lowest. Is a "best damage fraction" or "highest tier reached" (including death/retreat) a better measure?

2. **What is the intended endgame for the Arena?** The boss scales to `MAX_LEVEL` via `bossForLevel()`, but there are only two named bosses. At level 20+ every fight is a generic Trial Guardian with the golem named boss intervening once. Is the Arena supposed to have authored content at every major level, or is it intentionally procedural?

3. **Why does `arenaAct()` fire both a context attack and a melee bolt when called with a `dir` parameter?** (`useArenaLoop.ts:141-142`). Is this intentional behavior or an overlooked bug? It's not triggered from the current overlay UI but it's in the public API.

4. **Should the player's equipped gear (beyond weapon) affect Arena combat?** Currently only the weapon feeds into the snapshot. Armor, accessories, and passive items from the inventory do not. Is that intentional or a gap?

5. **What happens when a player levels up to tier 5 mid-run?** `beginArena()` snapshots the boss at `character.level` at entry. The boss tier does not change mid-fight. But `pendingLevelUp` could be queued during the fight. Does the level-up boss battle conflict with the Arena run state? Both use `gameState.arena`, so this may need investigation.

6. **Is the rune placement clicking behavior reliable across zoom levels and different screen DPIs?** The `pixelToCell` and `centerFor` functions rely on bounding rect math. No test covers click → cell conversion at non-1× device pixel ratios.

7. **What is the intended role of `resistTo` on bosses?** It's present in `ArenaState` and factored into `spellDamageRoll`/`attackRoll`, but no procedural boss definition in `bossForLevel()` sets `resistTo`. Only hand-authored bosses could use it. Is this a planned feature or dead code?

8. **Why is MP regeneration commented as "raised from 1.2"?** (`arena.ts:50`). Was there a balancing issue? If spells still feel too MP-scarce at 1.8/s, should the regeneration be even higher, or should spell costs be reduced?

9. **Should ring-of-fire be castable on a 520 ms spell CD or should it have a longer CD given its 3.5 s duration?** A player can technically cast ring of fire and then immediately cast another spell. Is this intentional?

10. **Is there a plan to add audio?** The game is entirely silent. Was audio deferred intentionally, or is it a known gap without a plan?
