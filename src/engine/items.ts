// Item & potion catalog (design brief Section 10).
import type { StatId } from './stats';

export type ItemKind = 'potion' | 'utility' | 'trinket' | 'spellbook';

/** Where an item can be used. */
export type ItemContext = 'battle' | 'overworld';

export interface ItemEffect {
  /** Restore this much HP (battle). */
  healHp?: number;
  /** Temporary stat buff (battle), stat -> flat bonus. */
  buff?: Partial<Record<StatId, number>>;
  /** Protects one missed habit (overworld). */
  streakFreeze?: boolean;
  /** Restores momentum after a missed day (overworld) — clears the broken-streak penalty. */
  recovery?: boolean;
  /** Spellbook: learn this spell on use (overworld). */
  learnsSpell?: string;
}

export interface ItemDef {
  key: string;
  name: string;
  kind: ItemKind;
  context: ItemContext;
  description: string;
  effect: ItemEffect;
  /** Shop price in gold; undefined = not directly purchasable. */
  price?: number;
}

export const ITEMS: Record<string, ItemDef> = {
  healing_potion: {
    key: 'healing_potion',
    name: 'Healing Potion',
    kind: 'potion',
    context: 'battle',
    description: 'Restore 40 HP in battle.',
    effect: { healHp: 40 },
    price: 50,
  },
  focus_potion: {
    key: 'focus_potion',
    name: 'Focus Potion',
    kind: 'potion',
    context: 'battle',
    description: 'Bonus Knowledge for one battle.',
    effect: { buff: { KN: 5 } },
    price: 60,
  },
  courage_draught: {
    key: 'courage_draught',
    name: 'Courage Draught',
    kind: 'potion',
    context: 'battle',
    description: 'Bonus Charisma for one battle.',
    effect: { buff: { CH: 5 } },
    price: 60,
  },
  swiftness_tonic: {
    key: 'swiftness_tonic',
    name: 'Swiftness Tonic',
    kind: 'potion',
    context: 'battle',
    description: 'Bonus Agility for one battle.',
    effect: { buff: { AG: 5 } },
    price: 60,
  },
  streak_freeze: {
    key: 'streak_freeze',
    name: 'Streak Freeze',
    kind: 'utility',
    context: 'overworld',
    description: 'Protects one missed habit so your streak survives.',
    effect: { streakFreeze: true },
    price: 80,
  },
  recovery_elixir: {
    key: 'recovery_elixir',
    name: 'Recovery Elixir',
    kind: 'utility',
    context: 'overworld',
    description: 'Restores lost momentum after a missed day.',
    effect: { recovery: true },
    price: 70,
  },
  spellbook_firebolt: {
    key: 'spellbook_firebolt',
    name: 'Tome: Firebolt',
    kind: 'spellbook',
    context: 'overworld',
    description: 'Learn Firebolt — a damage spell that burns (Wisdom).',
    effect: { learnsSpell: 'firebolt' },
    price: 150,
  },
  spellbook_bless: {
    key: 'spellbook_bless',
    name: 'Tome: Bless',
    kind: 'spellbook',
    context: 'overworld',
    description: 'Learn Bless — a support ward that bolsters defense (Knowledge).',
    effect: { learnsSpell: 'bless' },
    price: 150,
  },
  spellbook_dazzle: {
    key: 'spellbook_dazzle',
    name: 'Tome: Dazzle',
    kind: 'spellbook',
    context: 'overworld',
    description: 'Learn Dazzle — an illusion that blinds the foe (Charisma).',
    effect: { learnsSpell: 'dazzle' },
    price: 150,
  },
  spellbook_hex: {
    key: 'spellbook_hex',
    name: 'Tome: Hex',
    kind: 'spellbook',
    context: 'overworld',
    description: 'Learn Hex — an illusion that weakens the foe (Charisma).',
    effect: { learnsSpell: 'hex' },
    price: 150,
  },
};

export function getItem(key: string): ItemDef | undefined {
  return ITEMS[key];
}
