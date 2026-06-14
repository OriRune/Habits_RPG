// ============================================================================
//  RECIPES — edit this file to add, change, or remove crafting recipes.
// ============================================================================
//
//  HOW TO EDIT
//  -----------
//  • Each entry is `key: { ...fields }` (key + inner `key:` must match, be unique).
//    Copy a block to add; edit to change; delete to remove.
//
//  FIELDS
//  ------
//  name      Display name of the recipe.
//  result    What it produces: { kind: 'gear'|'weapon'|'item', key }.
//              - gear   key must exist in content/gear.ts
//              - weapon key must exist in content/weapons.ts
//              - item   key must exist in content/items.ts
//  materials Map of material id → quantity. Material ids (content/materials.ts):
//              leather, iron_bar, cloth_roll, bronze_bar, herbs, crystals.
//  gold      Optional gold cost on top of materials.
//  description Optional note.
// ============================================================================
import type { RecipeDef } from '@/engine/crafting';

export const RECIPES: Record<string, RecipeDef> = {
  leather_vest: {
    key: 'leather_vest',
    name: 'Leather Vest',
    result: { kind: 'gear', key: 'leather_vest' },
    materials: { leather: 3 },
  },
  bronze_plate: {
    key: 'bronze_plate',
    name: 'Bronze Plate',
    result: { kind: 'gear', key: 'bronze_plate' },
    materials: { bronze_bar: 2, iron_bar: 1 },
    gold: 40,
  },
  adventurers_bedroll: {
    key: 'adventurers_bedroll',
    name: "Adventurer's Bedroll",
    result: { kind: 'gear', key: 'adventurers_bedroll' },
    materials: { cloth_roll: 2, herbs: 1 },
  },
  iron_kettle_bell: {
    key: 'iron_kettle_bell',
    name: 'Iron Kettle Bell',
    result: { kind: 'gear', key: 'iron_kettle_bell' },
    materials: { iron_bar: 2 },
  },
  sage_ring: {
    key: 'sage_ring',
    name: 'Sage Ring',
    result: { kind: 'gear', key: 'sage_ring' },
    materials: { crystals: 1, herbs: 1 },
    gold: 30,
  },
  scholars_lantern: {
    key: 'scholars_lantern',
    name: "Scholar's Lantern",
    result: { kind: 'gear', key: 'scholars_lantern' },
    materials: { iron_bar: 1, crystals: 1 },
    gold: 30,
  },
  bards_cloak: {
    key: 'bards_cloak',
    name: "Bard's Cloak",
    result: { kind: 'gear', key: 'bards_cloak' },
    materials: { cloth_roll: 2 },
  },
  runners_boots: {
    key: 'runners_boots',
    name: "Runner's Boots",
    result: { kind: 'gear', key: 'runners_boots' },
    materials: { leather: 2, cloth_roll: 1 },
  },
  lockpick_gloves: {
    key: 'lockpick_gloves',
    name: 'Lockpick Gloves',
    result: { kind: 'gear', key: 'lockpick_gloves' },
    materials: { leather: 1, iron_bar: 1 },
  },
  // Weapon recipes (weapon keys live in content/weapons.ts).
  iron_mace: {
    key: 'iron_mace',
    name: 'Iron Mace',
    result: { kind: 'weapon', key: 'iron_mace' },
    materials: { iron_bar: 3 },
    gold: 20,
  },
  short_bow: {
    key: 'short_bow',
    name: 'Short Bow',
    result: { kind: 'weapon', key: 'short_bow' },
    materials: { leather: 2, cloth_roll: 1 },
    gold: 20,
  },
};
