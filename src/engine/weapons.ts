// Weapon types + helpers. The editable weapon DATA lives in src/content/weapons.ts.
// A weapon decides which stat the Attack action draws on (melee → Strength, ranged →
// Dexterity) plus a flat bonus and a stamina cost.
import type { StatId } from './stats';
import { STARTER_WEAPON, WEAPONS } from '@/content/weapons';

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

// Re-export the editable catalog so existing imports (`@/engine/weapons`) keep working.
export { WEAPONS, STARTER_WEAPON, STARTER_WEAPON_CHOICES } from '@/content/weapons';

export function getWeapon(key: string): WeaponDef {
  return WEAPONS[key] ?? WEAPONS[STARTER_WEAPON];
}
