# Arena Minigame — Design Analysis

> **Purpose:** Understand the arena's current state, mechanics, and gameplay quality as a foundation for planning improvements.

---

## 1. What It Is

The Arena is a **real-time boss duel on a square grid** with 8-directional movement. It is the most mechanically complex of HabitsRPG's three minigames (alongside the Deep Mine and Wild Forest). Where those two are real-time crawlers focused on resource gathering and exploration, the Arena is pure combat — the player's full stat loadout (weapon, spells, items) applied against a single boss that may spawn minions and fight across multiple HP phases.

The fight is played on a **square Chebyshev grid** of radius 3–5 (yielding **(2r+1)² tiles: 49 / 81 / 121** for radii 3/4/5), rendered tilted 45° to look like a diamond. Distance is king-move (Chebyshev), so diagonals cost 1 step. Randomly placed obstacle clusters provide light cover. The player starts at the top pole, the boss at the bottom.

**Entry gate:** Level 3, costs 3 energy (earned from completing habits).

---

## 2. Gameplay Loop

```
Enter Arena
  │
  ├── Board is generated (radius, obstacle density, starting minions scale with tier)
  │
  ├── ACTIVE PHASE ─────────────────────────────────────────────────────────────────
  │    │
  │    ├── Player moves (WASD/arrows, 8-dir D-pad on touch)
  │    ├── Player attacks
  │    │    ├── Melee: step adjacent, press attack — hits nearest enemy
  │    │    ├── Ranged: fires projectile along facing direction
  │    │    └── Context (arenaAct): auto-picks melee if adjacent, else ranged
  │    ├── Player casts spells (MP-gated)
  │    │    ├── Damage: sparks, firebolt
  │    │    ├── Support: mend (heal), bless (reduce incoming dmg)
  │    │    ├── Illusion: dazzle (blind), hex (weaken)
  │    │    ├── Traps: fire/ice/poison runes placed on adjacent tile
  │    │    ├── Ring of fire: 3.5s damage aura around player
  │    │    └── Teleport: blink 3-5 cells away
  │    ├── Player uses items (inventory of battle consumables)
  │    │
  │    ├── BOSS AI (every ~300-950ms scaled by speed factor)
  │    │    ├── Pathfinds toward player via BFS flow-field
  │    │    └── Telegraphs an attack (slam/line/nova/volley)
  │    │         └── Marked tiles light up; player has 760-950ms to step off
  │    │
  │    ├── MINIONS (on radius ≥ 4 boards)
  │    │    ├── Pathfind toward player via BFS
  │    │    └── Deal contact damage when adjacent
  │    │
  │    └── STATUS TICKS (burn, poison, ring of fire, rune triggers)
  │
  ├── PHASE TRANSITION (when boss HP hits 0 mid-fight)
  │    └── Stats/school/flavor change; fight continues
  │
  └── OUTCOME
       ├── Win  → full gold + item rewards
       ├── Retreat (banking) → partial reward based on damage dealt
       └── Death → 50% of partial reward (gold only, no items)
```

### Core tension

The fight is built around one central loop: **telegraph → dodge → punish**. The boss always signals where its next hit will land (red tiles = physical, purple = magic). The player repositions to avoid the marked cells, then attacks during the boss's recovery window (650ms after firing). Stamina gates how often you can attack; mana gates spells. Both regen passively.

---

## 3. Stats Used

### Player combat stats (derived at arena entry, frozen for the run)

| Stat | Arena Role |
|---|---|
| **ST** (Strength) | Melee weapon damage (`meleePower`). Sword/mace archetype. |
| **DX** (Dexterity) | Ranged weapon damage (`rangedPower`). Bow archetype. |
| **EN** (Endurance) | Max stamina pool. Higher EN → attack more before tiring. |
| **WI** (Wisdom) | Damage spell power (`damageSpell`). Scales fire spells, runes, ring. |
| **KN** (Knowledge) | Healing spell power (`supportSpell`). Mend potency. |
| **CH** (Charisma) | Illusion spell power (`illusionPower`). Blind/weaken magnitude. |
| **HP** | Max HP. Derived from overall character level + gear. |
| **AG** (Agility) | Dodge chance. Higher AG → random chance to completely avoid a hit. |

### Boss stats (per phase)

- **HP, attack, defense, ward** — scale with tier (level) and named boss definitions
- **weakTo / resistTo** — stat IDs; matching the player's attack source deals ×1.25 / ×0.8
- **attackSchool** — physical (mitigated by player defense) or magic (mitigated by player ward)

### XP rewards (on win)

- **Strength, Dexterity, Endurance** each gain 4 + tier × (0.4 + 0.6 × progress) XP

Only these three stats are rewarded. Wisdom, Knowledge, Charisma, and Agility are used in the fight but gain nothing from it — a meaningful tension point (see §6).

---

## 4. Technical Design

### Architecture

The arena follows the same pure-functional pattern as the rest of the engine. `src/engine/arena.ts` (~1,100 lines) exports:
- `createArena()` — initializes state from fighter + boss + options
- `arenaMove/arenaMelee/arenaRanged/arenaCast/arenaUseItem` — discrete player actions
- `arenaTick(state, now, rng)` — advances the world clock by ~90ms per call

The `useArenaLoop` hook fires `arenaTick` on a `requestAnimationFrame` clock. The Zustand store owns `ArenaState | null`. This is clean and testable — 504 lines of tests cover movement, combat, AI paths, rewards, and all special mechanics.

### Board representation

Tiles are `Cell = { x: number; y: number }` on a **square Chebyshev grid** of the given radius. `distance = max(|dx|, |dy|)` (king-moves), so diagonals count as 1. The full grid is `(2r+1)²` cells — **49 / 81 / 121 tiles** for radius 3 / 4 / 5. The visual is rendered as a rotated CSS grid (square tilted 45° to look like a diamond).

### BFS pathfinding

Both the boss and minions use a real BFS flood-fill from the player's position each tick, then take the step with the lowest distance value. This correctly routes around L-shaped walls that trip up greedy-step AI. It's computed per-tick which at radius 5 is 121 cells — negligible cost.

### Telegraph system

Each boss attack creates a `Telegraph` object with:
- `tiles`: the cells that will be hit
- `firesAtMs`: when damage resolves (760–950ms after creation)
- `school`: determines indicator color in the UI

The player sees the lit tiles and has roughly 0.75–1s to step off them. After firing, the boss enters 650ms recovery — the primary counterattack window.

---

## 5. Content Depth

### Bosses

Only **two named bosses** are defined (levels 5 and 20). All other tiers use a generic `Trial Guardian (Lv N)` with linearly scaled stats and no special phases, movesets, or flavor. The boss system *supports* multi-phase fights (`BossPhase[]`), weak/resist mechanics, and typed movesets (heavy, multi-hit, drain, enrage, inflict) — but none of this is wired into arena bosses currently. Those moveset fields are used exclusively by the turn-based battle system.

### Spells

Ten spells total. Two are starters (sparks, mend). Four are signature choices at character creation. Four more are loot/shop items. The spread covers damage, healing, debuffs, traps, and utility (teleport, ring) — a reasonable kit. But spell acquisition in the arena context is static: you bring what you found in the dungeon; there's no arena-specific progression.

### Weapons

Four weapons (worn sword, iron mace, short bow, hunting bow). The DX/ST split is the primary archetype choice. No weapon has arena-specific properties.

---

## 6. What Works Well

### Telegraph-and-dodge is the right core loop

The single best design decision in the arena is making every boss attack visible before it lands. This transforms the combat from "stand still and trade hits" to a genuine positioning puzzle. Skilled play — staying close enough to punish, far enough to dodge — is rewarding and readable.

### Stamina creates trade-off rhythm

The stamina system (BASE_ATTACK_STA = 2 per attack, regen 3/sec) creates a natural ebb and flow. A player who attacks recklessly drains sta and swings weakly; pacing attacks lets you use them at full power (reduced variance). This is more interesting than a simple cooldown.

### Multi-phase potential (even if underused)

The infrastructure for genuinely dramatic boss fights is there. The phase system can change HP totals, attack stats, schools, weaknesses, minion loads, and add flavor text transitions. A boss that switches from physical to magic attacks mid-fight, or suddenly spawns a wave of minions at 50% HP, would create memorable moments.

### Pure functional engine enables confidence

Having 504 tests and a fully deterministic (injected RNG) engine means changes can be verified without running the game. This is valuable for iterating on mechanics.

### BFS pathfinding over greedy step

Enemies routing correctly around L-walls makes obstacle placement genuinely matter. A wall isn't just cosmetic — it can create a chokepoint the player can exploit.

---

## 7. What Doesn't Work Well

> **Important context:** This project also ships **Hex Tactics**, a turn-based isometric positioning minigame that sits directly next to the Arena under the "Battle" tab. The Arena's weaknesses should be addressed by leaning *into* real-time reflex, not toward turn-based positioning (that's Tactics' lane). Any improvements that make the Arena feel like a deliberate positioning puzzle would duplicate an existing minigame.

### Random obstacle layouts have no tactical identity

Obstacles are `N random non-conflicting tiles` — no authored shapes, no tactical signatures, no theme. The boss's BFS pathfinding correctly routes around them, but from the *player's* perspective the obstacles are incidental decoration. You can't learn a map, plan around a chokepoint, or feel clever for exploiting a narrow corridor, because none of those structures are intentionally authored.

Note: the raw board size (81 tiles at radius 4, 121 at radius 5) is actually generous. This is **not** a raw tile-count problem — it's a *meaningful tile* problem. A 9×9 grid of randomly scattered rocks feels small because none of the tiles have an identity the player can memorize and exploit.

### The boss has no personality

Every non-named boss is `Trial Guardian (Lv N)` with four generic attack patterns. The attack selection logic (`chooseKind`) is purely distance-based — no telegraphed intent, no learning, no pattern variation between boss "personalities." The `EnemyMove` moveset system (which drives the turn-based dungeon bosses with telegraphed intents) is not connected to the arena at all.

**Comparison:** Hades builds each boss around 3–4 thematic attacks that escalate in complexity over subsequent runs. Even simple indie games like Nuclear Throne give each boss a distinct attack rhythm. Here, every arena fight feels identical mechanically — the only variation is the boss's name and HP total.

### Spell usage has limited tactical depth

The arena's interaction model defaults to melee or ranged attacking; spells are a bolt-on. In the original implementation, mana regen was slow (1.2/sec), spells were expensive (4–10 MP), and **spells and attacks shared a single cooldown** (`cooldownUntilMs`), meaning casting a spell blocked the next attack and vice-versa. The result: casting was strictly worse than attacking for sustained DPS. *(Phase 0 split these into independent cooldowns and raised MP regen to 1.8/sec — the underlying content problem remains.)*

Rune placement requires the boss to step on your trap — against a boss that pathfinds toward you, this is difficult to control. The ring of fire (3.5s duration) is situationally very strong. But most bosses have `weakTo: []`, so there's rarely a stat-based reason to choose spells over weapons.

### Stats are unbalanced contributors

AG (dodge) is the only defensive stat that applies directly in the arena, but its magnitude is invisible to the player — they can't see their dodge chance or feel it working. The WI/KN/CH trio powers spells but, as noted, spells are secondary to attacking. EN contributes max stamina, which matters, but the regen rate means you're rarely stamina-starved.

In the original, XP rewarded only Strength, Dexterity, and Endurance — actively discouraging caster builds even though spells work there. *(Phase 0 replaced this with usage-based XP: melee→ST, ranged→DX, damage spells→WI, support→KN, illusion→CH, dodges→AG, stamina actions→EN.)*

### No progression between arena runs

Each run is completely isolated. There are no meta-currencies, no unlockable boss modifiers, no challenge modes, no sense of mastery accumulation beyond the `deepestArenaTier` integer. Compare this to the Mine (which tracks depth and materials found) or the Forest (which has biome variety and exploration). The arena offers "fight a boss, get gold" — once you've done it a few times, there's nothing pulling you back.

### The minion system is underdeveloped

Minions have the same basic stats regardless of the boss. They pathfind correctly and deal contact damage, but have no behavior variety — no ranged minions, no minions that trigger effects, no minions with special attacks. They're a DPS tax rather than a threat that requires a different response.

---

## 8. Comparison to Reference Games

### Final Fantasy Tactics (Square Enix, 1997)

**Similarities:** Grid-based positioning, character stats drive combat math, facing direction matters.

**Differences:** FFT is turn-based; the arena is real-time. FFT has 5+ player units; the arena has 1. Note that this project already has a **turn-based positioning minigame (Hex Tactics)** — so tactical FFT-style positioning is already covered. The Arena's borrowable ideas are narrower.

**What to borrow (narrowly):** FFT's terrain is *designed*, not random — each tile serves a tactical purpose. Even small maps feel spacious because the layout has intent. The arena would benefit from authored obstacle layouts (curated patterns), not to become more tactical, but so the real-time telegraph-dodge has consistent spatial grammar the player can learn across runs.

### Hades (Supergiant, 2020)

**Similarities:** Real-time action in an enclosed arena, boss fights with multiple attacks, stat scaling.

**Differences:** Hades has fluid 360° movement; the arena has grid-snapped 8-dir movement. Hades' bosses have named attacks with distinct animations and escalating complexity. Hades' meta-progression (Heat system, boons) creates mastery arc across runs.

**What to borrow:** Named boss attacks with a recognizable "personality." A boss that starts with two attacks and unlocks a third at 50% HP is more memorable than a boss that randomly selects from four identical patterns. Also: the concept of a run feeling distinct because of what you brought (boons/spells) that synergize in new ways.

### The Binding of Isaac (Edmund McMillen, 2011)

**Similarities:** Grid room, dodge-the-projectile gameplay, positioned obstacles.

**Differences:** Isaac uses free movement in a larger room, not tile-grid snapping. Isaac's difficulty comes from bullet density; the arena's from telegraph windows. Isaac has extremely deep item synergy.

**What to borrow:** Obstacle rooms in Isaac are hand-authored patterns that repeat as recognizable "rooms." The arena would benefit from a set of 10–20 authored board layouts instead of random generation.

### Dark Souls / Elden Ring (FromSoftware)

**Similarities:** Telegraph-and-dodge is the literal core of both. Boss phases. Stamina management.

**Differences:** Souls games have continuous physics-based movement and animation commitment. Recovery windows on bosses are precisely timed and learned through repetition.

**What to borrow:** The *boss as a puzzle* framing. In Dark Souls, you fail repeatedly until you read the attack patterns, then succeed. The arena's random pattern selection prevents this learning arc — a boss that always does `nova → line → slam → volley` in order (with some variation after phase 2) would be learnable and satisfying to master.

### Undertale (Toby Fox, 2015)

**Similarities:** Boss fight with named, personality-driven enemies. HP phases. Unique attack patterns per boss.

**Differences:** Undertale is pure bullet-hell in a dynamic arena that resizes. Bosses have extensive dialog and personality.

**What to borrow:** Each arena boss should feel *different*. A slime boss that splits tiles and fills the board slowly. A golem boss that spawns wall-obstacles mid-fight. A mage boss that uses magic attacks only, rewarding WI/ward investment. The existing `NAMED_BOSSES` table (Procrastination Slime, Burnout Golem) already names these — they just don't have mechanically distinct behavior.

---

## 9. Summary: Current State

The arena is a **strong technical foundation with thin content and cramped scale**. The telegraph-dodge loop is genuinely good game design. The pure-functional engine, BFS pathfinding, and shared combat math are professionally executed. But the experience of playing it is limited by:

1. **Board too small** — positioning is the core mechanic but there's no room for it
2. **Bosses are generic** — named bosses exist in data but use no unique mechanics
3. **Spells are secondary** — the cooldown/cost math makes casting inferior to attacking
4. **No run-to-run progression** — nothing to optimize toward between sessions
5. **Random maps have no tactical identity** — can't learn or plan

The arena has the bones of a great minigame. It needs space, personality, and reasons to care about it beyond a gold payout.

---

## 10. Opportunities for Improvement (High-Level)

These are starting points for a planning session, not a finalized design:

| Area | Direction |
|---|---|
| **Board scale** | Larger default radius (5–6), or multiple "arena types" with distinct shapes (corridor, arena pit, ruined keep) |
| **Boss identity** | Give each named boss 3–4 unique attack patterns by wiring `EnemyMove` movesets into arena telegraphs |
| **Spell balance** | Reduce spell cooldown, or give spells the same CD as attacks but make them clearly stronger against bosses with `weakTo` spell schools |
| **Stat rewards** | Distribute XP across all 8 stats based on which were actually used (spells cast → WI/KN, dodges → AG) |
| **Authored layouts** | 8–12 hand-crafted board layouts (obstacle patterns) with a named tactical identity — "The Pit," "The Corridor," "The Four Pillars" |
| **Boss phases with transitions** | Phase changes should alter the arena (spawn obstacles, change board size, add minion wave) not just change HP/attack |
| **Minion variety** | Ranged minions, shielded minions, explosive-on-death minions — each requiring a different player response |
| **Run meta-layer** | A lightweight modifier system: enter with a debuff for a bonus reward, choose a challenge on entry, unlock arena-specific blessings |
