// ============================================================================
//  GEAR — edit this file to add, change, or remove equippable gear.
//  (Weapons live separately in content/weapons.ts; this is armor/trinket/tool.)
// ============================================================================
//
//  HOW TO EDIT
//  -----------
//  • Each entry is `key: { ...fields }` (key + inner `key:` must match, be unique).
//    Copy a block to add; edit to change; delete to remove. Gear is obtained by
//    crafting (content/recipes.ts) or shop (set a `price`).
//
//  FIELDS
//  ------
//  name         Display name.
//  slot         'armor' | 'trinket' | 'tool'  (one equipped per slot).
//  statBonuses  Flat stat-point bonuses, e.g. { ST: 4 }. Apply in combat AND dungeon
//               stat-check rooms (a +DEX tool helps trap/treasure rooms automatically).
//  defense      Armor: flat physical damage reduction.
//  ward         Armor/trinket: flat magical damage reduction.
//  xpBonus      Habit-XP perk: { tag?, stat?, pct }. Grants +pct% XP on habits whose
//               tag or stat matches (e.g. { tag: 'Study', pct: 10 }).
//  price        Optional gold cost to buy in the shop (omit for craft/loot only).
//  description  Flavor text.
// ============================================================================
import type { GearDef } from '@/engine/gear';

export const GEAR: Record<string, GearDef> = {
  leather_vest: {
    key: 'leather_vest',
    name: 'Leather Vest',
    slot: 'armor',
    defense: 4,
    description: 'Sturdy hide that turns aside blows. +4 Defense.',
  },
  bronze_plate: {
    key: 'bronze_plate',
    name: 'Bronze Plate',
    slot: 'armor',
    defense: 8,
    ward: 2,
    description: 'Heavy bronze armor. +8 Defense, +2 Ward.',
  },
  adventurers_bedroll: {
    key: 'adventurers_bedroll',
    name: "Adventurer's Bedroll",
    slot: 'armor',
    statBonuses: { HP: 4 },
    description: 'Rest easy and rise hardier. +4 Hit Points.',
  },
  iron_kettle_bell: {
    key: 'iron_kettle_bell',
    name: 'Iron Kettle Bell',
    slot: 'trinket',
    statBonuses: { ST: 4 },
    description: 'Train as you carry it. +4 Strength.',
  },
  sage_ring: {
    key: 'sage_ring',
    name: 'Sage Ring',
    slot: 'trinket',
    statBonuses: { WI: 3 },
    ward: 2,
    description: 'A band of quiet wisdom. +3 Wisdom, +2 Ward.',
  },
  scholars_lantern: {
    key: 'scholars_lantern',
    name: "Scholar's Lantern",
    slot: 'trinket',
    statBonuses: { KN: 3 },
    xpBonus: { tag: 'Study', pct: 10 },
    description: '+3 Knowledge and +10% XP on Study habits.',
  },
  bards_cloak: {
    key: 'bards_cloak',
    name: "Bard's Cloak",
    slot: 'trinket',
    statBonuses: { CH: 4 },
    description: 'Cut a charming figure. +4 Charisma.',
  },
  runners_boots: {
    key: 'runners_boots',
    name: "Runner's Boots",
    slot: 'tool',
    statBonuses: { AG: 5 },
    xpBonus: { tag: 'Fitness', pct: 10 },
    description: '+5 Agility and +10% XP on Fitness habits.',
  },
  lockpick_gloves: {
    key: 'lockpick_gloves',
    name: 'Lockpick Gloves',
    slot: 'tool',
    statBonuses: { DX: 5 },
    description: 'Nimble fingers for traps and treasure. +5 Dexterity.',
  },
};
