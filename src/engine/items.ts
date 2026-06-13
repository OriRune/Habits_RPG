// Item & potion catalog (design brief Section 10).
import type { StatId } from './stats';

export type ItemKind = 'potion' | 'utility' | 'trinket';

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
};

export function getItem(key: string): ItemDef | undefined {
  return ITEMS[key];
}
