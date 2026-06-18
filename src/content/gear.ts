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
    description: 'Nimble fingers for traps and treasure. +5 Dexterity — widens sweet-spot zones in the Lockpicking trial.',
  },

  // -------------------------------------------------------------------------
  // Pickaxes — earned / purchased, used automatically when mining rock in the
  // Deep Mine (also function as melee weapons against monsters).
  // -------------------------------------------------------------------------
  stone_pickaxe: {
    key: 'stone_pickaxe',
    name: 'Stone Toolkit',
    slot: 'tool',
    mining: { power: 1 },
    chopping: { power: 1 },
    statBonuses: { ST: 1 },
    description: 'A crude pick and hand-axe. Chips 1 durability per swing in the mine or forest. +1 Strength.',
  },
  iron_pickaxe: {
    key: 'iron_pickaxe',
    name: 'Iron Toolkit',
    slot: 'tool',
    mining: { power: 2 },
    chopping: { power: 2 },
    statBonuses: { ST: 3 },
    description: 'Forged iron head and hatchet. Breaks 2-durability rock or tree in a single swing. +3 Strength.',
    price: 200,
  },
  mithril_pickaxe: {
    key: 'mithril_pickaxe',
    name: 'Mithril Toolkit',
    slot: 'tool',
    mining: { power: 3 },
    chopping: { power: 3 },
    statBonuses: { ST: 5 },
    description: 'Legendary lightness and edge. Shatters even the hardest rock or ancient tree in one blow. +5 Strength.',
  },
};
