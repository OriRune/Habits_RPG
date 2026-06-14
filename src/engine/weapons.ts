// Weapons (minimal equipment for the combat overhaul). A weapon decides which stat the
// Attack action draws on (melee → Strength, ranged → Dexterity) plus a flat bonus and a
// stamina cost. Full armor/trinket equipment + crafting remain deferred.
import type { StatId } from './stats';

export interface WeaponDef {
  key: string;
  name: string;
  /** Stat the Attack action scales with. */
  attackStat: Extract<StatId, 'ST' | 'DX'>;
  /** Flat damage bonus. */
  bonus: number;
  /** Stamina spent per Attack. */
  staminaCost: number;
  description: string;
  /** Shop price in gold; undefined = not directly purchasable. */
  price?: number;
}

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
    price: 120,
  },
  short_bow: {
    key: 'short_bow',
    name: 'Short Bow',
    attackStat: 'DX',
    bonus: 4,
    staminaCost: 2,
    description: 'Strike from range. Scales with Dexterity.',
    price: 120,
  },
};

export const STARTER_WEAPON = 'worn_sword';

export function getWeapon(key: string): WeaponDef {
  return WEAPONS[key] ?? WEAPONS[STARTER_WEAPON];
}
