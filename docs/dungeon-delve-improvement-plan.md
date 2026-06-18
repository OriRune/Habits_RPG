# Dungeon Delve — Improvement Plan

> Based on the analysis in `docs/dungeon-delve-minigame-analysis.md`.
> Each item states what changes, why it matters, and which files/systems are involved.
> Items are organized by theme and sequenced in Section 7 for implementation.

---

## 1. Highest-Priority Improvements

These are low-effort / high-impact fixes that remove the most obvious "unfinished"
signals in the current build.

### 1.1 Register the missing scene keys

**What:** Add `room:shrine`, `room:merchant`, and `room:elite` to `SCENES` in
`src/lib/scenes.ts` with intentional glyph, tint, and caption.

**Why:** All three room types call `<SceneArt sceneKey="…" />` but the keys are not
registered. Both rooms currently render a `❓` box — this is a visible bug, not a
placeholder. Suggested values:

| Key | Glyph | Color | Caption |
|-----|-------|-------|---------|
| `room:shrine` | ✨ | `#6b3fa0` (purple) | A shrine in the dark |
| `room:merchant` | 🪙 | `#8a6a1a` (amber gold) | A wandering merchant |
| `room:elite` | 🔥 | `#b23b2e` (ember) | A powerful guardian |

**Files:** `src/lib/scenes.ts` only.

---

### 1.2 Draw edges on the FloorMap

**What:** Render the `node.to[]` connections between layers so the branching
structure is visible to the player.

**Why:** The layered DAG is the core of floor navigation, but the edges are never
drawn. Nodes appear as a flat grid; players cannot see which rooms connect where.
Routing decisions are invisible. The data already exists in `map.nodes[id].to` — it
just needs rendering.

**Approach:** Position each node button with a measured bounding rect (or use a CSS
`grid` layout with known row/column indices) and draw SVG lines behind the node grid
from each node's center to each child's center. A simple `<svg>` overlay with
`position: absolute` behind the layer rows is sufficient — no new library needed.

**Files:** `src/components/dungeon/FloorMap.tsx`.

---

### 1.3 Communicate the flee-vs-death loot rule

**What:** Update all copy that describes what happens when a run ends to distinguish
fleeing from dying:

- **Fleeing** combat ends the run but keeps **100%** of everything gathered.
- **Dying** (HP → 0) forfeits 75% of the current floor's gold/materials and **all**
  discrete items (spellbooks, weapons, gear) from that floor.

**Why:** The current entrance copy says "fall mid-floor and you lose most of that
floor's haul" — this is misleading for flee (which loses nothing) and silent on
the item-loss rule. Players should understand the stakes before entering.

**Files:** `src/views/DungeonView.tsx` (entrance blurb, run-end headline/description
variants), the flee button or post-combat copy in `BattleScene`/`BattleView`.

---

### 1.4 Delete dead `generateFloor()`

**What:** Remove the `generateFloor()` function from `src/engine/dungeon.ts` (and
its export). Also verify the `encounterRoomFor()` wrapper: it exists solely to
expose a private function to `dungeonMap.ts`; either inline it or make it a proper
public API.

**Why:** `generateFloor()` is a legacy linear floor builder from before the layered
DAG system. The store uses `generateFloorMap()` exclusively. The dead export looks
live, confuses readers, and will mislead future contributors. Similarly,
`encounterRoomFor()` is a thin indirection that adds noise without adding API value.

**Files:** `src/engine/dungeon.ts`, `src/engine/dungeonMap.ts`. Run
`npm run typecheck` and `npm run test` after deletion.

---

## 2. Gameplay and Mechanics Improvements

### 2.1 Expand encounter and relic content pools

**What:** Add more entries to `src/content/encounters.ts` and `src/content/relics.ts`.
Target: at least 3–4 additional encounters per biome and 5–8 new boons spread across
tiers 1–3. The 4 curse entries are probably sufficient.

**Why:** The current pools are modest (~20 encounter defs across 3 biomes, ~15 boons).
Deep runs — the game's most engaging state — will start repeating content by floor 8.
Repetition is the primary fun-decay risk on long runs. Both files are pure data; the
engine already handles arbitrary pool sizes without code changes.

**Files:** `src/content/encounters.ts`, `src/content/relics.ts`.

---

### 2.2 Add triggered/conditional relic effects

**What:** Extend the relic system to support a small set of triggered or conditional
effects beyond the current flat stat/defense/ward/maxHp modifiers. Examples:

- *On combat win, restore 5% max HP.*
- *Below 30% HP, gain +2 AG.*
- *After a shrine visit, +1 to all stats for the rest of the run.*

**Why:** Flat stat bonuses are safe and functional, but they don't create the
"build story" that makes roguelite relic systems compelling. Triggered effects
interact with play decisions in ways that modifiers can't.

**Files:** `src/engine/relics.ts` (extend `RelicDef` with an optional `trigger`
field), wherever `aggregateRelics()` feeds `fighterFor()`, and the combat/encounter
resolution paths that must fire the triggers. This is the largest mechanics change
in the plan — scope it as its own step with tests.

---

### 2.3 Partial item retention on death (balance decision)

**What:** Decide and communicate the death-loot rule. Two viable options:
1. **Keep current rule** (all items lost) + add loud pre-entry copy (covered in 1.3).
2. **Soften** to e.g. 1-in-3 discrete items survive death.

**Why:** Losing a floor's weapon or spellbook with no warning is the sharpest pain
point in the loss path. Option 1 is fine if the rule is clearly stated. Option 2
reduces frustration but weakens the attrition tension. Decide via playtest, then
adjust `scaleReward()` in `dungeon.ts` and `finishRun()` in `useGameStore.ts`.

**Files:** `src/engine/dungeon.ts` (`scaleReward`), `src/store/useGameStore.ts`
(`finishRun`).

---

### 2.4 Surface merchant prices on the floor map

**What:** Let players preview merchant offers/costs before entering the room — a
tooltip or small expand on the merchant node in the FloorMap, or a secondary callout
when the node is focused.

**Why:** Routing through a merchant is a meaningful trade-off (uses a room slot, costs
current gold). Blind entry into a shop the player can't afford wastes the room. The
`merchantOffers(depth)` function in `dungeon.ts` is pure and callable for preview.

**Files:** `src/components/dungeon/FloorMap.tsx`, `src/engine/dungeon.ts`
(`merchantOffers` already exported — no engine change needed).

---

### 2.5 Economy pass: verify gold income vs. merchant pricing

**What:** Check that gold earned from combat and treasure rooms keeps pace with linear
merchant pricing (`18 + depth×4` for a basic heal; `45 + depth×9` for a relic) at
depth 10+. Add a unit test that asserts the expected gold/floor band.

**Why:** If the player arrives at a merchant at floor 10 with typical gold and can't
afford any of the three offers, merchants become decorative. The concern is that
merchant costs scale linearly but treasure gold may not scale fast enough.

**Files:** `src/engine/dungeon.ts` (constants), `src/engine/__tests__/dungeon.test.ts`
(new test band).

---

## 3. Controls, UI, and Player Feedback Improvements

### 3.1 Separate encounter outcome from next-node text

**What:** In the `EncounterRoom` component, render the prior choice's outcome
(`enc.lastText`) in a visually distinct "result" panel, clearly separated from the
new choices for the current node.

**Why:** Currently `enc.lastText` appears above the next set of choices as a single
block. The outcome of the last choice and the prompt for the next choice read as one
continuous text. This is disorienting, especially when scrolling quickly.

**Files:** `EncounterRoom` (inline in `src/views/DungeonView.tsx`).

---

### 3.2 Fix the disabled Rest button dead-end

**What:** When HP is already full, replace the inert disabled "Rest and recover"
button with a light message explaining why ("Fully healed — attune to the deep
instead") and style the Attune button as the primary action.

**Why:** The current behavior silently forces the player toward the boon with no
explanation. A disabled button with no label gives no guidance.

**Files:** `src/components/dungeon/RestRoom.tsx`.

---

### 3.3 Show remaining floor progress

**What:** Display how many layers (or rooms) remain before the checkpoint — e.g.
"Layer 2 of 3" or a small pip row above the FloorMap.

**Why:** Checkpoints arrive without warning. Players can't anticipate how soon they
need to decide whether to push on or bank. Knowing "one more layer" changes both
resource management and boon-hunting decisions.

**Files:** `src/components/dungeon/FloorMap.tsx` (derive from `map.layers.length`
and `path` or `choices`), or as a header in `DungeonView.tsx`.

---

### 3.4 Make RelicTray tappable for details

**What:** Replace the title-only tooltip on RelicTray entries with a tap-to-expand
modal or popover showing the relic name, tier, description, and effect.

**Why:** Tooltips don't work on mobile/touch. Players can see they have a relic icon
but can't review its effect mid-run. Reuse the existing `Modal` component.

**Files:** `src/components/dungeon/RelicTray.tsx`.

---

### 3.5 Time the BoonChoice modal to natural pause points

**What:** Ensure `pendingBoon` is only set (and the non-dismissable modal therefore
only appears) after a room fully resolves — not mid-checkpoint render or overlapping
with other in-progress actions.

**Why:** The `BoonChoice` modal is non-dismissable and can currently appear over
any room UI in an unexpected moment, interrupting the flow.

**Files:** The store actions that set `pendingBoon` in `useGameStore.ts` (around the
elite win path, shrine fortify path, and Press On / rest 'fortify' branch). Audit
each `pendingBoon` assignment.

---

## 4. Visual and Audio Polish

### 4.1 Room transition animation

**What:** Add a short fade or slide when the view switches from path choice → room
interior and between rooms. A CSS opacity/transform transition on the room wrapper
div is sufficient; no new library needed.

**Why:** Instant state swaps give no signal that something changed. A brief animated
transition confirms the navigation event, reduces disorientation, and makes the flow
feel intentional.

**Files:** `src/views/DungeonView.tsx` (CSS `transition-opacity` or a small reusable
`<FadePanel>` wrapper component).

---

### 4.2 Use biome tint in scene art

**What:** Read `BiomeDef.tint` (defined but unused in the dungeon UI) and blend it as
a tint or border color into room scene backgrounds, so rooms in the Catacombs, Ruins,
and Frozen Caverns look visually distinct.

**Why:** This is a cheap way to give each biome a distinct visual identity before
real art exists. Biome tint is already defined in `src/content/biomes.ts` for every
biome — it just needs to be wired to scene rendering.

**Files:** `src/lib/scenes.ts` or `SceneArt` component, reading `biomeForDepth(depth)
.tint` from the current run state.

---

### 4.3 Audio (new system)

**What:** Introduce a minimal `src/lib/audio.ts` module wrapping HTML5 Audio (or
Howler if a library is acceptable). Add SFX for: room entry, combat victory, relic
acquisition, treasure pickup, and banking loot. Add an optional per-biome ambient
loop. Gate everything behind a mute/volume setting.

**Why:** The dungeon is entirely silent. No feedback confirms that anything happened.
This is the largest gap in perceived polish.

**Files:** New `src/lib/audio.ts`; fire from store actions or `useEffect` hooks in
`DungeonView.tsx`. New asset folder for audio files.

---

### 4.4 Real room illustrations

**What:** Populate `SCENE_REGISTRY` in `src/lib/scenes.ts` and call
`resolveSceneImage()` in `SceneArt` to swap in real illustration assets by key.
The swap seam already exists — no component code changes are required.

**Why:** Every room currently uses an emoji-in-a-box SVG placeholder. Rooms feel
interchangeable and the dungeon has no visual identity. Asset replacement is
incremental (one key at a time) and does not require code changes.

**Files:** `src/lib/scenes.ts` (`SCENE_REGISTRY`), new image assets.

---

## 5. Technical / Code Improvements

### 5.1 Extract `DungeonRun` to a dedicated type module

**What:** Move the `DungeonRun` interface (currently inline in `useGameStore.ts`) to
a dedicated file such as `src/engine/dungeonTypes.ts`, and import it from there.

**Why:** Engine unit tests cannot import `DungeonRun` directly from a React store.
Extracting the type lets `__tests__/dungeon.test.ts` and `__tests__/dungeonMap.test.ts`
reference it directly and reduces the store file's size.

**Files:** New `src/engine/dungeonTypes.ts`; update imports in `useGameStore.ts` and
any test files that mock run state.

---

### 5.2 Remove thin indirection in `dungeon.ts`

**What:** Inline or properly promote `encounterRoomFor()` — the thin wrapper that
only exists to expose a private function from `dungeon.ts` to `dungeonMap.ts`.

**Why:** The wrapper adds API surface for no reason; the private function and its
re-export diverge the same behavior into two names.

**Files:** `src/engine/dungeon.ts`, `src/engine/dungeonMap.ts`.

---

### 5.3 Add content-integrity tests

**What:** Write a Vitest test that asserts every key referenced in `BiomeDef`
(encounter ids, enemy keys, boss keys) resolves in the corresponding content
catalogs. Separately, assert every relic key used in a boon/curse roll exists in
`RELICS`.

**Why:** The missing `room:shrine` and `room:merchant` scene keys are the same class
of error — a content key that is used but never defined. A test prevents this class
of bug from re-entering silently.

**Files:** New test in `src/engine/__tests__/` (e.g. `content.test.ts`).

---

### 5.4 Add tests for economy band and new mechanics

**What:** Alongside any gold-constant tuning (Section 2.5) or triggered-relic
addition (Section 2.2), add corresponding unit tests: one for gold/floor at depth
bands 1, 5, and 10; one per trigger type exercising both fire and non-fire
conditions.

**Files:** `src/engine/__tests__/dungeon.test.ts`, new relic trigger test file.

---

## 6. Integration with the Larger Game

### 6.1 Surface `deepestFloor` and milestone progress outside the dungeon

**What:** Show the player's `deepestFloor` record and the next milestone gate
(Merchant @5, Elite @8, Tier-3 relics @10) on the character or progress screen, not
only on the dungeon entrance panel.

**Why:** Currently a player who hasn't opened the dungeon tab recently has no visible
reminder of their dungeon progress or what they're working toward. Milestone progress
should feel like a character achievement, not a hidden detail.

**Files:** Progress/character view component; `src/store/selectors.ts` (new selector
for next milestone).

---

### 6.2 In-run and historical run statistics

**What:** Track per-run stats: rooms cleared, floors descended, damage dealt/taken,
boons acquired, gold banked. Persist a lightweight run history (last N runs). Show
a stats panel on the run-end screen.

**Why:** Endless descent gains meaning from record-chasing. Knowing "my best was
floor 12; today I reached floor 9" is more motivating than a blank collect screen.
The current `deepestFloor` field is the only persistent metric.

**Files:** New fields on `DungeonRun` in `useGameStore.ts` (or `dungeonTypes.ts`),
a new small persisted history array in the store, a stats panel in `DungeonView.tsx`.

---

### 6.3 Confirm `deepestFloor` lifecycle on new character / migration

**What:** Audit the `withCharacterDefaults` and migration chain in `useGameStore.ts`
to confirm that `deepestFloor` resets correctly when a player starts a new character,
and that no Zustand schema migration leaves `deepestFloor` at a non-zero value on a
fresh start.

**Why:** If `deepestFloor` is carried forward incorrectly, a new-character player
could see merchants, elites, and tier-3 relics immediately — content gated behind
depth milestones they haven't earned.

**Files:** `useGameStore.ts` (migration chain, `withCharacterDefaults`). Add a test.

---

## 7. Suggested Implementation Order

Ordered to ship visible wins first and defer the heaviest systems to the end. Each
step is independently mergeable. Run `npm run typecheck` and `npm run test` after
each step.

| Step | Covers | Size |
|------|--------|------|
| **1** | §1: Register scene keys, draw FloorMap edges, fix flee/death copy, delete dead `generateFloor()` | Small |
| **2** | §3 items 1–3: Encounter outcome split, Rest dead-end message, floor progress indicator | Small |
| **3** | §5 items 1–2 + 3: Extract `DungeonRun` type, drop indirection, add content-integrity test | Refactor |
| **4** | §2 item 1: Expand encounter and relic content pools (pure data) | Medium |
| **5** | §4 items 1–2: Room transition animation, biome tint in scene art | Small/Medium |
| **6** | §6: `deepestFloor` surfacing, run stats, lifecycle test | Medium |
| **7** | §2 item 2: Triggered relic effects — the one real mechanics change, with tests | Large |
| **8** | §4 items 3–4: Audio system and real room illustrations (incremental) | Large |

---

## Verification Checklist

After each code step:

```
npm run typecheck
npm run test
# or single file:
npx vitest run src/engine/__tests__/dungeon.test.ts
```

Manual smoke (via `npm run dev`):

- [ ] Level ≥ 3, 3 energy; enter dungeon successfully.
- [ ] Shrine and merchant rooms show intentional placeholder art (not `❓`).
- [ ] Elite room shows `🔥` scene art.
- [ ] FloorMap shows lines connecting room nodes between layers.
- [ ] Encounter outcome and next-node choices read as separate panels.
- [ ] Rest room with full HP shows guidance message instead of disabled button.
- [ ] Flee ends run with 100% loot; run-end copy correctly describes this.
- [ ] Death retains 25% gold/materials; discrete items listed as lost.
- [ ] Biome tint colors distinguish Catacombs / Ruins / Frozen Caverns rooms.
- [ ] Room-to-room navigation shows a brief fade transition.
