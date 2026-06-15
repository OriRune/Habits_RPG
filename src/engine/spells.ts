// Spell types + helpers (combat logic). The editable spell DATA lives in
// src/content/spells.ts — edit that file to add/change/remove spells.
import type { StatId } from './stats';
import { SPELLS } from '@/content/spells';

export type SpellSchool = 'damage' | 'support' | 'illusion';

/** The habit stat each spell school draws on. */
export const SCHOOL_STAT: Record<SpellSchool, StatId> = {
  damage: 'WI',
  support: 'KN',
  illusion: 'CH',
};

export type StatusKey = 'burn' | 'blind' | 'weaken' | 'bless';

export interface SpellDef {
  key: string;
  name: string;
  school: SpellSchool;
  mpCost: number;
  /** Base magnitude (damage, heal, or status potency seed). */
  power: number;
  /** Status the spell inflicts (illusion/damage) or grants (support). */
  status?: { key: StatusKey; turns: number; magnitude: number };
  description: string;
}

// Re-export the editable catalog so existing imports (`@/engine/spells`) keep working.
export { SPELLS, STARTER_SPELLS, SIGNATURE_SPELL_CHOICES } from '@/content/spells';

export function getSpell(key: string): SpellDef | undefined {
  return SPELLS[key];
}
