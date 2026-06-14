// Spells (combat overhaul). Spells cost MP and belong to a school that scales with a
// different stat: damage → Wisdom, support → Knowledge, illusion → Charisma.
import type { StatId } from './stats';

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

export const SPELLS: Record<string, SpellDef> = {
  // Starters — every character begins with these.
  sparks: {
    key: 'sparks',
    name: 'Sparks',
    school: 'damage',
    mpCost: 4,
    power: 8,
    description: 'A crackle of arcane energy. Light magic damage (Wisdom).',
  },
  mend: {
    key: 'mend',
    name: 'Mend',
    school: 'support',
    mpCost: 6,
    power: 14,
    description: 'Knit your wounds. Restores HP (Knowledge).',
  },
  // Obtainable via spellbooks (loot / shop).
  firebolt: {
    key: 'firebolt',
    name: 'Firebolt',
    school: 'damage',
    mpCost: 9,
    power: 12,
    status: { key: 'burn', turns: 3, magnitude: 5 },
    description: 'A searing bolt that sets the foe ablaze (Wisdom).',
  },
  bless: {
    key: 'bless',
    name: 'Bless',
    school: 'support',
    mpCost: 8,
    power: 0,
    status: { key: 'bless', turns: 3, magnitude: 6 },
    description: 'A holy ward that bolsters your defenses (Knowledge).',
  },
  dazzle: {
    key: 'dazzle',
    name: 'Dazzle',
    school: 'illusion',
    mpCost: 6,
    power: 0,
    status: { key: 'blind', turns: 2, magnitude: 1 },
    description: 'A blinding mirage; the foe flails (Charisma).',
  },
  hex: {
    key: 'hex',
    name: 'Hex',
    school: 'illusion',
    mpCost: 7,
    power: 0,
    status: { key: 'weaken', turns: 3, magnitude: 0.4 },
    description: 'A sapping curse that weakens the foe\'s blows (Charisma).',
  },
};

export const STARTER_SPELLS = ['sparks', 'mend'];

export function getSpell(key: string): SpellDef | undefined {
  return SPELLS[key];
}
