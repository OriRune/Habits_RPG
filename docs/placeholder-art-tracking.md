# Placeholder Art Tracking

> **Purpose:** inventory of every sprite/image slot in the game, noting which have real PNGs and
> which still show a generated SVG placeholder. Ordered by replacement priority.
> Updated: 2026-06-22 (Phase 8 — Onboarding & UX Polish).

---

## How the drop-in seam works

Two auto-registration seams make adding art zero-code:

| Seam | Source glob | Key format |
|---|---|---|
| **Sprites** (`src/lib/sprites.ts`) | `src/assets/sprites/**/*.png` | `<prefix>:<basename>` |
| **Minigame art** (`src/lib/minigameArt.ts`) | `src/assets/minigame/**/*.png` | folder/basename (auto-registered) |
| **Scene banners** (`src/lib/scenes.ts:53`) | Manual — populate `SCENE_REGISTRY` | `room:combat` etc. |

For sprites the `FOLDER_PREFIX` map drives the prefix:

```
weapons/    → weapon:<basename>
gear/       → gear:<basename>
potions/    → item:<basename>   (spellbook.png is shared by SPELLBOOK_KEYS, see below)
materials/  → material:<basename>
relics/     → relic:<basename>
bosses/     → boss:<basename>   ← folder does NOT exist yet
avatars/    → avatar:<basename> ← folder does NOT exist yet
```

Drop a PNG in the right folder and it lights up with zero code edits.
Seam tests are in `src/lib/__tests__/spriteRegistry.test.ts`, `placeholderArt.test.ts`,
`minigameArt.test.ts` — run with `npm test`.

**Spellbook exception:** `potions/spellbook.png` is fanned out to four fixed keys
(`item:spellbook_firebolt`, `item:spellbook_bless`, `item:spellbook_dazzle`, `item:spellbook_hex`)
by a one-off block in `sprites.ts:167`. Five newer spellbooks (`spellbook_fire_rune`,
`spellbook_ice_rune`, `spellbook_poison_rune`, `spellbook_ring_of_fire`,
`spellbook_chaotic_blink`) are **not** in `SPELLBOOK_KEYS` and render as placeholders. To cover
them, add their keys to the `SPELLBOOK_KEYS` array in `sprites.ts:145` (or give each its own PNG).

---

## Priority 1 — Avatars (player + boss)

These appear on the **Character screen** (`HeroBanner.tsx:21`),
**Battle overlay** (`BattleScene.tsx:652`), and in party presence displays.
Currently every avatar is a generated glyph-crest SVG.

### Player avatars — `src/assets/sprites/avatars/<classId>.png`

The key is `avatar:<classId>` (or `avatar:adventurer` as the default before a class is earned).
52 possible values (all unique class names from `engine/classes.ts`):

```
adventurer (default)
Acrobat, Alchemist, Archmage, Ardent, Artist, Barbarian, Bard, Champion,
Cleric, Craftsman, Crusader, Daredevil, Druid, Duelist, Fortress, General,
Guardian, Healer, Illusionist, Ironwall, Juggernaut, Knight, Lord, Maestro,
Mage, Magician, Monk, Mystic, Ninja, Paladin, Performer, Phantom, Philosopher,
Pirate, Pyromancer, Ranger, Rogue, Saboteur, Sage, Saint, Sentinel,
Shadowblade, Shaman, Skirmisher, Soldier, Sorcerer, Spy, Strongman, Tank,
Thief, Trailblazer, Trapper, Vanguard, Wardancer, Warlock, Warlord, Warrior,
Wilder, Windwalker, Wizard
```

**Status: ❌ none** — `src/assets/sprites/avatars/` folder does not exist.

### Boss avatars — `src/assets/sprites/bosses/<bossId>.png`

The key is `boss:<bossId>` (depth suffix stripped at runtime:
`bossId.replace(/_d\d+(_elite)?$/, '')`).

| Boss ID | Name | Biome |
|---|---|---|
| `bone_tyrant` | The Bone Tyrant | The Catacombs |
| `vinewood_ancient` | The Vinewood Ancient | The Overgrown Ruins |
| `frost_warden` | The Frost Warden | The Frozen Caverns |

Arena bosses use the same `boss:` prefix; check `engine/arena.ts` for their IDs.

**Status: ❌ none** — `src/assets/sprites/bosses/` folder does not exist.

---

## Priority 2 — Scene banners (dungeon illustrations)

Used as wide "framed" scene art in `DungeonView` event panels and the dungeon run overlay.
Currently all render via `scenePlaceholderImage()` (the `framedSvg` glyph generator).

To add real art: populate `SCENE_REGISTRY` in `src/lib/scenes.ts:53` with
`{ 'room:combat': '/path/or/import', ... }`. No glob auto-registration exists yet — this requires
a code edit in `scenes.ts`.

24 scene keys defined:

| Category | Keys |
|---|---|
| Room types | `room:combat`, `room:trap`, `room:puzzle`, `room:negotiation`, `room:survival`, `room:treasure`, `room:rest`, `room:boss`, `room:encounter`, `room:shrine`, `room:merchant`, `room:elite` |
| Dungeon | `dungeon:entrance`, `dungeon:checkpoint`, `dungeon:cleared`, `dungeon:retreat` |
| Biomes | `biome:catacombs`, `biome:ruins`, `biome:frozen` |
| Outcomes | `outcome:success`, `outcome:partial`, `outcome:fail` |
| Combat | `combat:victory`, `combat:defeat` |
| Weekly | `weekly:report` |

**Status: ❌ none** — `SCENE_REGISTRY` is empty.

---

## Priority 3 — Items & potions

Folder: `src/assets/sprites/potions/` → prefix `item:`.

| Key | PNG | Status |
|---|---|---|
| `item:healing_potion` | `healing_potion.png` | ✅ |
| `item:focus_potion` | `focus_potion.png` | ✅ |
| `item:courage_draught` | `courage_draught.png` | ✅ |
| `item:swiftness_tonic` | `swiftness_tonic.png` | ✅ |
| `item:streak_freeze` | `streak_freeze.png` | ✅ |
| `item:recovery_elixir` | `recovery_elixir.png` | ✅ |
| `item:spellbook_firebolt` | shared `spellbook.png` | ✅ (via SPELLBOOK_KEYS) |
| `item:spellbook_bless` | shared `spellbook.png` | ✅ (via SPELLBOOK_KEYS) |
| `item:spellbook_dazzle` | shared `spellbook.png` | ✅ (via SPELLBOOK_KEYS) |
| `item:spellbook_hex` | shared `spellbook.png` | ✅ (via SPELLBOOK_KEYS) |
| `item:spellbook_fire_rune` | — | ❌ not in SPELLBOOK_KEYS |
| `item:spellbook_ice_rune` | — | ❌ not in SPELLBOOK_KEYS |
| `item:spellbook_poison_rune` | — | ❌ not in SPELLBOOK_KEYS |
| `item:spellbook_ring_of_fire` | — | ❌ not in SPELLBOOK_KEYS |
| `item:spellbook_chaotic_blink` | — | ❌ not in SPELLBOOK_KEYS |

**Fix for the 5 missing spellbooks:** add their keys to `SPELLBOOK_KEYS` in `sprites.ts:145`
(shares the existing `spellbook.png`) or add individual PNGs.

---

## Priority 4 — Materials

Folder: `src/assets/sprites/materials/` → prefix `material:`.

| Key | PNG | Status |
|---|---|---|
| `material:leather` | `leather.png` | ✅ |
| `material:iron_bar` | `iron_bar.png` | ✅ |
| `material:cloth_roll` | `cloth_roll.png` | ✅ |
| `material:bronze_bar` | `bronze_bar.png` | ✅ |
| `material:crystals` | `crystals.png` | ✅ |
| `material:gemstone` | `gemstone.png` | ✅ |
| `material:herbs` | — | ❌ |
| `material:stone` | — | ❌ |
| `material:wood` | — | ❌ |
| `material:game_meat` | — | ❌ |
| `material:pelt` | — | ❌ |
| `material:frost_quartz` | — | ❌ |
| `material:obsidian` | — | ❌ |
| `material:amber_resin` | — | ❌ |

> **Note:** `copper_bar.png` and `gold_bar.png` exist in `materials/` but have no matching
> material key in `content/materials.ts` — they register in the SPRITE_REGISTRY but nothing
> references `material:copper_bar` or `material:gold_bar`. Orphaned assets; safe to keep or rename.

---

## Priority 5 — Weapons

Folder: `src/assets/sprites/weapons/` → prefix `weapon:`.

| Key | PNG | Status |
|---|---|---|
| `weapon:worn_sword` | `worn_sword.png` | ✅ |
| `weapon:iron_mace` | `iron_mace.png` | ✅ |
| `weapon:short_bow` | `short_bow.png` | ✅ |
| `weapon:hunting_bow` | — | ❌ |

---

## Priority 6 — Gear

Folder: `src/assets/sprites/gear/` → prefix `gear:`.

| Key | PNG | Status |
|---|---|---|
| `gear:leather_vest` | `leather_vest.png` | ✅ |
| `gear:bronze_plate` | `bronze_plate.png` | ✅ |
| `gear:adventurers_bedroll` | `adventurers_bedroll.png` | ✅ |
| `gear:iron_kettle_bell` | `iron_kettle_bell.png` | ✅ |
| `gear:sage_ring` | `sage_ring.png` | ✅ |
| `gear:scholars_lantern` | `scholars_lantern.png` | ✅ |
| `gear:bards_cloak` | `bards_cloak.png` | ✅ |
| `gear:runners_boots` | `runners_boots.png` | ✅ |
| `gear:lockpick_gloves` | `lockpick_gloves.png` | ✅ |
| `gear:stone_pickaxe` | — | ❌ (mine tool) |
| `gear:iron_pickaxe` | — | ❌ (mine tool) |
| `gear:mithril_pickaxe` | — | ❌ (mine tool) |

---

## Priority 7 — Relics

Folder: `src/assets/sprites/relics/` → prefix `relic:`.

| Key | PNG | Status |
|---|---|---|
| `relic:ember_sigil` | `ember_sigil.png` | ✅ |
| `relic:keen_lens` | `keen_lens.png` | ✅ |
| `relic:swift_anklet` | `swift_anklet.png` | ✅ |
| `relic:oak_token` | `oak_token.png` | ✅ |
| `relic:sage_bead` | `sage_bead.png` | ✅ |
| `relic:silver_tongue` | `silver_tongue.png` | ✅ |
| `relic:owl_charm` | `owl_charm.png` | ✅ |
| `relic:vital_charm` | `vital_charm.png` | ✅ |
| `relic:stone_heart` | `stone_heart.png` | ✅ |
| `relic:warding_rune` | `warding_rune.png` | ✅ |
| `relic:bulwark_crest` | `bulwark_crest.png` | ✅ |
| `relic:twin_fang` | `twin_fang.png` | ✅ |
| `relic:arcane_prism` | `arcane_prism.png` | ✅ |
| `relic:titan_grip` | `titan_grip.png` | ✅ |
| `relic:archsage_codex` | `archsage_codex.png` | ✅ |
| `relic:phoenix_feather` | `phoenix_feather.png` | ✅ |
| `relic:cracked_idol` | `cracked_idol.png` | ✅ |
| `relic:leaden_weight` | `leaden_weight.png` | ✅ |
| `relic:brittle_bones` | `brittle_bones.png` | ✅ |
| `relic:padded_jerkin` | `padded_jerkin.png` | ✅ generated |
| `relic:runed_band` | `runed_band.png` | ✅ generated |
| `relic:aegis_charm` | `aegis_charm.png` | ✅ generated |
| `relic:windrunner_sash` | `windrunner_sash.png` | ✅ generated |
| `relic:gilded_mask` | `gilded_mask.png` | ✅ generated |
| `relic:worldroot_heart` | `worldroot_heart.png` | ✅ generated |
| `relic:dragon_scale` | `dragon_scale.png` | ✅ generated |
| `relic:dull_blade` | `dull_blade.png` | ✅ generated (curse relic) |
| `relic:clouded_mind` | `clouded_mind.png` | ✅ generated (curse relic) |
| `relic:bone_ward` | `bone_ward.png` | ✅ generated |
| `relic:frost_mantle` | `frost_mantle.png` | ✅ generated |
| `relic:shadow_mantle` | `shadow_mantle.png` | ✅ generated |
| `relic:verdant_sigil` | `verdant_sigil.png` | ✅ generated |
| `relic:twin_sage` | `twin_sage.png` | ✅ generated |
| `relic:bloodied_fang` | `bloodied_fang.png` | ✅ generated |
| `relic:desperate_ward` | `desperate_ward.png` | ✅ generated |
| `relic:shrine_stone` | `shrine_stone.png` | ✅ generated |
| `relic:soulbound_crown` | `soulbound_crown.png` | ✅ generated |
| `relic:frostbitten_edge` | `frostbitten_edge.png` | ✅ generated |

> **Every relic in `content/relics.ts` now has art (38/38).** The 19 "generated" sprites
> are rendered by `scripts/relic-sprites/gen.mjs` from hand-authored SVG in
> `scripts/relic-sprites/art.mjs` (rasterized at 32px native, nearest-neighbor ×4 to
> 128px to match the pixel style). Edit the SVG and re-run the script to revise one.
> Coverage is pinned by `src/lib/__tests__/spriteRegistry.test.ts`.

---

## Priority 8 — Minigame tiles & objects (already well covered)

### Cave / Forest objects — `src/assets/minigame/cave_forest/`

27 PNGs. All auto-registered by `minigameArt.ts`.

| Category | Files |
|---|---|
| Boulders | `boulder_1`, `boulder_2_jagged`, `boulder_3_brown` |
| Crystals | `cave_crystal_1`, `cave_crystal_2` |
| Ore nodes | `copper_ore_1`, `copper_ore_2`, `iron_ore_1`, `iron_ore_2` |
| Plants | `cotton_plant`, `flower_bush_1`, `toadstool` |
| Trees (dead) | `dead_oak`, `dead_pine` |
| Trees (foreboding) | `foreboding_oak_1`, `foreboding_pine_1/_2/_3` |
| Trees (living) | `green_maple_1`, `oak_1/_2/_3`, `pine_1/_2/_3/_4`, `red_maple_1`, `yellow_maple_1` |

### Tiles — `src/assets/minigame/tiles/`

11 PNGs. All auto-registered.

| Category | Files |
|---|---|
| Cave | `tile_cave_floor_1`, `tile_cave_floor_2` |
| Dirt | `tile_dirt_1`, `tile_dirt_2` |
| Grass | `tile_grass_1`, `tile_grass_2` |
| Paths | `dirt_path_north_south`, `dirt_path_east_west`, `dirt_path_crossroads`, `dirt_path_top_to_left`, `dirt_path_top_to_right`, `dirt_path_bottom_to_left`, `dirt_path_bottom_to_right` |

**Minigame enemies:** arena/dungeon enemies use the `boss:` sprite path (same seam as dungeon
bosses). No dedicated enemy-art folder exists. Enemy placeholder crests are generated by
`bossCrest()` in `sprites.ts`.

---

## Summary

| Category | Real PNGs | Total slots | Coverage |
|---|---|---|---|
| Player avatars | 0 | 53 (52 classes + adventurer) | 0% |
| Boss avatars | 0 | 3+ | 0% |
| Scene banners | 0 | 24 | 0% |
| Potions/items | 10 of 15 | 15 | 67% |
| Materials | 6 of 14 | 14 | 43% |
| Weapons | 3 of 4 | 4 | 75% |
| Gear | 9 of 12 | 12 | 75% |
| Relics | 38 of 38 | 38 | 100% |
| Minigame objects | 27 | 27 | 100% |
| Minigame tiles | 11 | 11 | 100% |

**Quick wins** (minimal art, large visible impact):
1. Add `src/assets/sprites/bosses/bone_tyrant.png`, `vinewood_ancient.png`, `frost_warden.png`
   — three boss sprites cover every dungeon boss encounter.
2. Add `src/assets/sprites/avatars/adventurer.png` — one PNG covers all pre-class characters and
   the default battle combatant portrait.
3. Fix the five missing spellbooks — zero new PNGs needed, just extend `SPELLBOOK_KEYS` in
   `src/lib/sprites.ts:145`.
