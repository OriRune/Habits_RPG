# Sprites Needed Report

This report documents all sprite art assets needed for the HabitsRPG application. Currently, the game uses generated placeholder art (SVG crests), but the system is ready to swap in real sprites via the `SPRITE_REGISTRY` (in `src/lib/sprites.ts`) and `SCENE_REGISTRY` (in `src/lib/scenes.ts`).

## System Overview

Sprites are swapped in by registering URLs in the registry. To add art:

1. Add the image to `src/assets/sprites/`
2. Import it in `src/lib/sprites.ts` 
3. Register it in `SPRITE_REGISTRY` with the key (e.g., `'weapon:worn_sword': importedImage`)

Scenes follow the same pattern with `SCENE_REGISTRY` in `src/lib/scenes.ts`.

---

## Sprite Categories

### **1. Weapons** (3 total)
Used in character equipment UI, paper doll, inventory, and crafting screens.

| Key | Name | Purpose | Resolution | Aspect Ratio |
|-----|------|---------|-----------|--------------|
| `weapon:worn_sword` | Worn Sword | Melee starter weapon, scales with Strength | 128×128 | 1:1 (square) |
| `weapon:iron_mace` | Iron Mace | Heavy melee weapon, shop item | 128×128 | 1:1 (square) |
| `weapon:short_bow` | Short Bow | Ranged starter weapon, scales with Dexterity | 128×128 | 1:1 (square) |

### **2. Gear** (9 total)
Armor, trinkets, and tools displayed in inventory and paper doll slots.

| Key | Name | Slot | Purpose | Resolution | Aspect Ratio |
|-----|------|------|---------|-----------|--------------|
| `gear:leather_vest` | Leather Vest | armor | Basic physical defense | 128×128 | 1:1 (square) |
| `gear:bronze_plate` | Bronze Plate | armor | Mid-tier armor with Ward | 128×128 | 1:1 (square) |
| `gear:adventurers_bedroll` | Adventurer's Bedroll | armor | HP bonus utility armor | 128×128 | 1:1 (square) |
| `gear:iron_kettle_bell` | Iron Kettle Bell | trinket | Strength training item | 128×128 | 1:1 (square) |
| `gear:sage_ring` | Sage Ring | trinket | Wisdom and Ward bonus | 128×128 | 1:1 (square) |
| `gear:scholars_lantern` | Scholar's Lantern | trinket | Knowledge bonus, Study XP | 128×128 | 1:1 (square) |
| `gear:bards_cloak` | Bard's Cloak | trinket | Charisma and charm bonus | 128×128 | 1:1 (square) |
| `gear:runners_boots` | Runner's Boots | tool | Agility bonus, Fitness XP | 128×128 | 1:1 (square) |
| `gear:lockpick_gloves` | Lockpick Gloves | tool | Dexterity for traps/treasure | 128×128 | 1:1 (square) |

### **3. Items** (11 total)
Consumable items: potions, elixirs, and spellbooks shown in inventory and shop.

| Key | Name | Kind | Purpose | Resolution | Aspect Ratio |
|-----|------|------|---------|-----------|--------------|
| `item:healing_potion` | Healing Potion | potion | Restore 40 HP in battle, shop | 128×128 | 1:1 (square) |
| `item:focus_potion` | Focus Potion | potion | +5 Knowledge buff, battle, shop | 128×128 | 1:1 (square) |
| `item:courage_draught` | Courage Draught | potion | +5 Charisma buff, battle, shop | 128×128 | 1:1 (square) |
| `item:swiftness_tonic` | Swiftness Tonic | potion | +5 Agility buff, battle, shop | 128×128 | 1:1 (square) |
| `item:streak_freeze` | Streak Freeze | utility | Protect missed habit streak, shop | 128×128 | 1:1 (square) |
| `item:recovery_elixir` | Recovery Elixir | utility | Restore momentum after missed day, shop | 128×128 | 1:1 (square) |
| `item:spellbook_firebolt` | Tome: Firebolt | spellbook | Learn Firebolt spell, shop | 128×128 | 1:1 (square) |
| `item:spellbook_bless` | Tome: Bless | spellbook | Learn Bless spell, shop | 128×128 | 1:1 (square) |
| `item:spellbook_dazzle` | Tome: Dazzle | spellbook | Learn Dazzle spell, shop | 128×128 | 1:1 (square) |
| `item:spellbook_hex` | Tome: Hex | spellbook | Learn Hex spell, shop | 128×128 | 1:1 (square) |

### **4. Spells** (6 total)
Combat magic abilities displayed in battle UI and grimoire.

| Key | Name | School | Purpose | Resolution | Aspect Ratio |
|-----|------|--------|---------|-----------|--------------|
| `spell:sparks` | Sparks | damage | Starter damage spell (Wisdom-based) | 128×128 | 1:1 (square) |
| `spell:mend` | Mend | support | Starter healing spell (Knowledge-based) | 128×128 | 1:1 (square) |
| `spell:firebolt` | Firebolt | damage | Advanced damage with burn (Wisdom-based) | 128×128 | 1:1 (square) |
| `spell:bless` | Bless | support | Defense buff / ward (Knowledge-based) | 128×128 | 1:1 (square) |
| `spell:dazzle` | Dazzle | illusion | Blinds foe debuff (Charisma-based) | 128×128 | 1:1 (square) |
| `spell:hex` | Hex | illusion | Weakens foe (Charisma-based) | 128×128 | 1:1 (square) |

### **5. Relics** (14 total)
Dungeon boons and curses acquired during runs, displayed in boon-choice modals and relic tray.

| Key | Name | Tier | Type | Purpose | Resolution | Aspect Ratio |
|-----|------|------|------|---------|-----------|--------------|
| `relic:ember_sigil` | Ember Sigil | 1 | boon | +3 Strength for run | 128×128 | 1:1 (square) |
| `relic:keen_lens` | Keen Lens | 1 | boon | +3 Dexterity for run | 128×128 | 1:1 (square) |
| `relic:swift_anklet` | Swift Anklet | 1 | boon | +3 Agility for run | 128×128 | 1:1 (square) |
| `relic:oak_token` | Oak Token | 1 | boon | +3 Endurance for run | 128×128 | 1:1 (square) |
| `relic:sage_bead` | Sage Bead | 1 | boon | +3 Wisdom for run | 128×128 | 1:1 (square) |
| `relic:silver_tongue` | Silver Tongue | 1 | boon | +3 Charisma for run | 128×128 | 1:1 (square) |
| `relic:owl_charm` | Owl Charm | 1 | boon | +3 Knowledge for run | 128×128 | 1:1 (square) |
| `relic:vital_charm` | Vital Charm | 1 | boon | +15 max HP for run | 128×128 | 1:1 (square) |
| `relic:stone_heart` | Stone Heart | 2 | boon | +20 HP, +2 Defense | 128×128 | 1:1 (square) |
| `relic:warding_rune` | Warding Rune | 2 | boon | +3 Ward, +2 Wisdom | 128×128 | 1:1 (square) |
| `relic:bulwark_crest` | Bulwark Crest | 2 | boon | +3 Defense, +2 Endurance | 128×128 | 1:1 (square) |
| `relic:twin_fang` | Twin Fang | 2 | boon | +4 Strength, +2 Dexterity | 128×128 | 1:1 (square) |
| `relic:arcane_prism` | Arcane Prism | 2 | boon | +4 Knowledge, +2 Wisdom | 128×128 | 1:1 (square) |
| `relic:titan_grip` | Titan Grip | 3 | boon | +6 Strength, +25 HP | 128×128 | 1:1 (square) |
| `relic:archsage_codex` | Archsage's Codex | 3 | boon | +6 Knowledge, +3 Ward | 128×128 | 1:1 (square) |
| `relic:phoenix_feather` | Phoenix Feather | 3 | boon | +30 HP, +3 Defense, +3 Ward | 128×128 | 1:1 (square) |
| `relic:cracked_idol` | Cracked Idol | 1 | curse | −3 Endurance (curse) | 128×128 | 1:1 (square) |
| `relic:leaden_weight` | Leaden Weight | 1 | curse | −3 Agility (curse) | 128×128 | 1:1 (square) |
| `relic:brittle_bones` | Brittle Bones | 1 | curse | −15 max HP (curse) | 128×128 | 1:1 (square) |

### **6. Classes** (64 total)
Character class avatars displayed during class selection and in hero banner. One sprite per class from the 8×8 class chart.

| Primary Stat | Secondary Stats (8 classes each) |
|---|---|
| Dexterity (DX) | Duelist, Illusionist, Pirate, Trapper, Magician, Rogue, Artist, Craftsman |
| Agility (AG) | Thief, Acrobat, Ninja, Skirmisher, Windwalker, Daredevil, Saboteur, Escape Artist |
| Strength (ST) | Knight, Warrior, Strongman, Barbarian, Paladin, Samurai, Martial Artist, Juggernaut |
| Endurance (EN) | Ranger, Trailblazer, Vanguard, Sentinel, Wilder, Spy, Scout, Mountain Man |
| Wisdom (WI) | Healer, Mystic, Monk, Druid, Sage, Shaman, Seer, Battle Monk |
| Charisma (CH) | Bard, Performer, General, Field Marshal, Philosopher, Lord, Pyromancer, Ardent |
| Knowledge (KN) | Sorcerer, Warlock, Battle Mage, Field Mage, Wizard, Mage, Scholar, Alchemist |
| Hit Points (HP) | Guardian, Wardancer, Soldier, Fortress, Crusader, Warlord, Cleric, Tank |

**Sprite Keys Format:** `class:{classname_in_lowercase}` (e.g., `class:duelist`, `class:wizard`)  
**Resolution:** 128×128 | **Aspect Ratio:** 1:1 (square)

### **7. Avatar Variants** (2 total)
Player character avatar before class selection and fallback variants.

| Key | Name | Purpose | Resolution | Aspect Ratio |
|-----|------|---------|-----------|--------------|
| `avatar:adventurer` | Adventurer Avatar | Unclassed character appearance | 128×128 | 1:1 (square) |

**Note:** Additional avatar variants can be added for each class as `avatar:{classname_in_lowercase}` if differentiated avatars are desired beyond class crests.

### **8. Enemies** (9 total)
Dungeon combat foes displayed during combat encounters. These scale dynamically with depth and player level.

| Key | Name | Biome | Purpose | Resolution | Aspect Ratio |
|-----|------|-------|---------|-----------|--------------|
| `enemy:skeleton` | Skeleton Warrior | Catacombs | Undead melee foe | 192×192 | 1:1 (square) |
| `enemy:wisp` | Wailing Wisp | Catacombs | Magic-based spirit | 192×192 | 1:1 (square) |
| `enemy:ghoul` | Crypt Ghoul | Catacombs | Undead melee threat | 192×192 | 1:1 (square) |
| `enemy:goblin` | Cave Goblin | Overgrown Ruins | Beast/humanoid | 192×192 | 1:1 (square) |
| `enemy:giant_spider` | Giant Spider | Overgrown Ruins | Beast creature | 192×192 | 1:1 (square) |
| `enemy:dire_wolf` | Dire Wolf | Overgrown Ruins | Large predator | 192×192 | 1:1 (square) |
| `enemy:thornling` | Thornling | Overgrown Ruins | Plant creature | 192×192 | 1:1 (square) |
| `enemy:stone_sentry` | Stone Sentry | Frozen Caverns | Elemental guardian | 192×192 | 1:1 (square) |
| `enemy:frost_revenant` | Frost Revenant | Frozen Caverns | Magical elemental | 192×192 | 1:1 (square) |
| `enemy:ice_elemental` | Ice Elemental | Frozen Caverns | Pure elemental magic | 192×192 | 1:1 (square) |

### **9. Materials** (7 total)
Crafting materials gathered from dungeons and challenges, displayed in inventory and crafting UI.

| Key | Name | Purpose | Resolution | Aspect Ratio |
|-----|------|---------|-----------|--------------|
| `material:leather` | Leather | Armor crafting | 96×96 | 1:1 (square) |
| `material:iron_bar` | Iron Bar | Metal crafting | 96×96 | 1:1 (square) |
| `material:cloth_roll` | Roll of Cloth | Textile crafting | 96×96 | 1:1 (square) |
| `material:bronze_bar` | Bronze Bar | Metal crafting | 96×96 | 1:1 (square) |
| `material:herbs` | Herbs | Potion crafting | 96×96 | 1:1 (square) |
| `material:crystals` | Crystals | Magical crafting | 96×96 | 1:1 (square) |
| `material:gemstone` | Gemstone | High-tier crafting | 96×96 | 1:1 (square) |

---

## Scene Assets

Scenes are wide banner illustrations displayed in dungeon events. Currently generating placeholders; real art swaps in via `SCENE_REGISTRY`.

### **Scene Categories** (21 total)

#### Room Events (8 scenes)
| Key | Caption | Purpose | Resolution | Aspect Ratio |
|-----|---------|---------|-----------|--------------|
| `room:combat` | A foe blocks the way | Standard combat encounter | 320×120 | 8:3 (wide) |
| `room:trap` | Blades and tripwires | Hazard/trap challenge room | 320×120 | 8:3 (wide) |
| `room:puzzle` | An ancient riddle | Intellectual challenge | 320×120 | 8:3 (wide) |
| `room:negotiation` | A wary guardian | Social/diplomacy check | 320×120 | 8:3 (wide) |
| `room:survival` | Harsh conditions | Environmental challenge | 320×120 | 8:3 (wide) |
| `room:treasure` | A glittering hoard | Loot/reward room | 320×120 | 8:3 (wide) |
| `room:rest` | A quiet alcove | Recovery/healing room | 320×120 | 8:3 (wide) |
| `room:boss` | A boss bars the way | Boss encounter | 320×120 | 8:3 (wide) |
| `room:encounter` | A choice to make | Story/branching event | 320×120 | 8:3 (wide) |

#### Dungeon Progression (2 scenes)
| Key | Caption | Purpose | Resolution | Aspect Ratio |
|-----|---------|---------|-----------|--------------|
| `dungeon:entrance` | The dungeon mouth | Entry point illustration | 320×120 | 8:3 (wide) |
| `dungeon:checkpoint` | A safe respite | Mid-run checkpoint/milestone | 320×120 | 8:3 (wide) |

#### Biome/Region Themes (3 scenes)
| Key | Caption | Purpose | Resolution | Aspect Ratio |
|-----|---------|---------|-----------|--------------|
| `biome:catacombs` | The Catacombs | Undead/dungeon biome | 320×120 | 8:3 (wide) |
| `biome:ruins` | Overgrown Ruins | Beast/nature biome | 320×120 | 8:3 (wide) |
| `biome:frozen` | Frozen Caverns | Elemental/ice biome | 320×120 | 8:3 (wide) |

#### Outcome/Resolution (3 scenes)
| Key | Caption | Purpose | Resolution | Aspect Ratio |
|-----|---------|---------|-----------|--------------|
| `outcome:success` | Success! | Successful challenge completion | 320×120 | 8:3 (wide) |
| `outcome:partial` | A near miss | Partially successful attempt | 320×120 | 8:3 (wide) |
| `outcome:fail` | It goes badly | Failed challenge | 320×120 | 8:3 (wide) |

#### Combat Resolution (2 scenes)
| Key | Caption | Purpose | Resolution | Aspect Ratio |
|-----|---------|---------|-----------|--------------|
| `combat:victory` | Victory! | Battle won | 320×120 | 8:3 (wide) |
| `combat:defeat` | Defeated | Battle lost / character death | 320×120 | 8:3 (wide) |

#### Dungeon Completion (2 scenes)
| Key | Caption | Purpose | Resolution | Aspect Ratio |
|-----|---------|---------|-----------|--------------|
| `dungeon:cleared` | Dungeon cleared | Full run completed successfully | 320×120 | 8:3 (wide) |
| `dungeon:retreat` | You retreat | Voluntary exit from dungeon | 320×120 | 8:3 (wide) |

#### Weekly Summary (1 scene)
| Key | Caption | Purpose | Resolution | Aspect Ratio |
|-----|---------|---------|-----------|--------------|
| `weekly:report` | The week in review | Weekly progress summary | 320×120 | 8:3 (wide) |

---

## Summary Statistics

| Category | Count | Dimensions | Notes |
|---|---|---|---|
| **Weapons** | 3 | 128×128 | Scales with Strength/Dexterity |
| **Gear** | 9 | 128×128 | 3 armor, 4 trinkets, 2 tools |
| **Items** | 11 | 128×128 | Potions, utilities, spellbooks |
| **Spells** | 6 | 128×128 | Combat magic abilities |
| **Relics** | 19 | 128×128 | 16 boons + 3 curses (Tiers 1-3) |
| **Classes** | 64 | 128×128 | 8×8 stat-based class grid |
| **Avatars** | 1+ | 128×128 | Base + optional class variants |
| **Enemies** | 10 | 192×192 | Scaled by depth/level |
| **Materials** | 7 | 96×96 | Crafting resource icons |
| **Scenes** | 21 | 320×120 | Wide banner format |
| **TOTAL** | **151+** | Various | Ready for real art |

---

## Integration Notes

1. **Square Sprites (1:1):** Used with `.clip-shield` CSS class for shield-shaped frame effect
2. **Wide Scenes (8:3):** Displayed as full-width banner art in dungeon encounters
3. **Placeholder System:** All sprites currently render as SVG crests with:
   - Colored background (glyph color from crest)
   - Single letter or icon (configurable)
   - Optional label in lower banner
   - "IMAGE" watermark on scenes

4. **Swap Mechanism:**
   - Edit `src/lib/sprites.ts` → `SPRITE_REGISTRY` for entity sprites
   - Edit `src/lib/scenes.ts` → `SCENE_REGISTRY` for scene art
   - No component changes needed; swap is automatic

5. **Size Guidance:**
   - **Smaller items (sm/xs):** 96-128px (relics in tray, backpack items)
   - **Standard (md):** 128-192px (inventory, boon choice, primary UI)
   - **Large (lg/xl):** 192-256px+ (full-screen hero banner, battle center)

---

## File Structure Reference

```
src/
├── assets/sprites/          (new: place PNGs/SVGs here)
├── lib/
│   ├── sprites.ts           (SPRITE_REGISTRY swap point)
│   └── scenes.ts            (SCENE_REGISTRY swap point)
├── components/
│   ├── ui/
│   │   ├── Sprite.tsx       (sprite renderer — no changes needed)
│   │   └── SceneArt.tsx     (scene renderer — no changes needed)
│   └── [components using Sprite/SceneArt throughout]
└── content/
    ├── weapons.ts
    ├── gear.ts
    ├── items.ts
    ├── spells.ts
    ├── relics.ts
    └── materials.ts
```

---

**Generated:** 2026-06-15  
**Status:** All sprite keys documented. Awaiting real art assets.
