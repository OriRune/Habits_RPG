// ============================================================================
//  WEAPONS — edit this file to add, change, or remove weapons.
// ============================================================================
//
//  HOW TO EDIT
//  -----------
//  • Each entry is `key: { ...fields }` (key + inner `key:` must match, be unique).
//    Copy a block to add; edit to change; delete to remove. Weapons with a `price`
//    appear in the shop.
//
//  FIELDS
//  ------
//  name         Display name.
//  attackStat   Which stat the Attack action scales with: 'ST' (Strength, melee) or
//               'DX' (Dexterity, ranged). These are the only two valid values.
//  bonus        Flat damage added on top.
//  staminaCost  Stamina each Attack costs (Endurance refills the pool).
//  price?       Gold cost in the shop. Omit for loot-only.
//  description  Flavor text.
//
//  STARTER_WEAPON below is what every new character equips — its key MUST exist here.
// ============================================================================
import type { WeaponDef } from '@/engine/weapons';

export const WEAPONS: Record<string, WeaponDef> = {
  worn_sword: {
    key: 'worn_sword',
    name: 'Worn Sword',
    attackStat: 'ST',
    bonus: 3,
    staminaCost: 2,
    description: 'A chipped but reliable blade. Scales with Strength.',
  },
  iron_mace: {
    key: 'iron_mace',
    name: 'Iron Mace',
    attackStat: 'ST',
    bonus: 6,
    staminaCost: 3,
    description: 'Heavy and brutal. Bigger hits, more stamina. Scales with Strength.',
    // BAL-15 (item 4.10): a modest convenience premium over crafting (3 iron_bar + 20g), not the
    // old ~100g decoy that punished players who hadn't found the Forge. Craft stays the value play.
    price: 55,
  },
  short_bow: {
    key: 'short_bow',
    name: 'Short Bow',
    attackStat: 'DX',
    bonus: 4,
    // BAL-26 (item 4.10): staminaCost 2→1 gives the Short Bow a real niche — the cheap, stamina-
    // efficient early bow — so hunting_bow (bonus 5 / range 5) is a clear upgrade, not a strict
    // dominator on every axis. Short Bow is the accessible stepping stone into ranged play.
    staminaCost: 1,
    ranged: true,
    range: 3,
    description: 'Loose an arrow along the line you face (range 3). Light, efficient draw. Scales with Dexterity.',
    // BAL-15 (item 4.10): convenience premium over crafting (2 leather + 1 cloth_roll + 20g).
    price: 55,
  },
  hunting_bow: {
    key: 'hunting_bow',
    name: 'Hunting Bow',
    attackStat: 'DX',
    bonus: 5,
    staminaCost: 1,
    ranged: true,
    range: 5,
    description: 'Strike fleeing prey from afar (range 5). Light draw, low stamina cost. Scales with Dexterity.',
    price: 170,
  },
};

/** The weapon every new character starts equipped with. Must exist in WEAPONS. */
export const STARTER_WEAPON = 'worn_sword';

/** Weapons offered on the character-creation screen (melee / ranged / heavy). Keys must exist above. */
export const STARTER_WEAPON_CHOICES = ['worn_sword', 'short_bow', 'iron_mace'];
