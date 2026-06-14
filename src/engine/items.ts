// Item types + helpers. The editable item DATA lives in src/content/items.ts —
// edit that file to add/change/remove items.
import type { StatId } from './stats';
import { ITEMS } from '@/content/items';

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

// Re-export the editable catalog so existing imports (`@/engine/items`) keep working.
export { ITEMS } from '@/content/items';

export function getItem(key: string): ItemDef | undefined {
  return ITEMS[key];
}
