// ============================================================================
//  ITEMS — edit this file to add, change, or remove items (potions, tomes, etc).
// ============================================================================
//
//  HOW TO EDIT
//  -----------
//  • Each entry is `key: { ...fields }`. The `key` and the inner `key:` must match
//    and be unique. Copy a block to add an item; edit fields to change; delete a
//    block to remove. Items with a `price` automatically appear in the shop.
//
//  FIELDS
//  ------
//  name        Display name.
//  kind        'potion' | 'utility' | 'trinket' | 'spellbook'  (label/grouping only).
//  context     Where it's used:  'battle' (in a fight)  |  'overworld' (out of combat).
//  effect      What it does (combine any that apply):
//                healHp: number            → restore HP (battle)
//                buff: { ST?, DX?, ... }   → temporary stat bonus for one battle
//                streakFreeze: true        → protect one missed habit (overworld)
//                recovery: true            → restore momentum after a missed day
//                learnsSpell: '<spellKey>' → spellbook: teaches that spell (overworld).
//                                            The key MUST exist in content/spells.ts.
//  price?      Gold cost in the shop. Omit to make it non-purchasable (loot only).
//  description Flavor / what it does, shown in the UI.
//
//  NOTE: adding a brand-new effect *field* needs an engine edit (combat.ts for battle
//  effects, store for overworld). Editing values / adding items of existing kinds doesn't.
// ============================================================================
import type { ItemDef } from '@/engine/items';

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
  // Spellbooks teach a spell (effect.learnsSpell). The spell key must exist in
  // content/spells.ts.
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
  spellbook_fire_rune: {
    key: 'spellbook_fire_rune',
    name: 'Tome: Fire Rune',
    kind: 'spellbook',
    context: 'overworld',
    description: 'Learn Fire Rune — inscribe an explosive trap on an adjacent tile.',
    effect: { learnsSpell: 'fire_rune' },
    price: 180,
  },
  spellbook_ice_rune: {
    key: 'spellbook_ice_rune',
    name: 'Tome: Ice Rune',
    kind: 'spellbook',
    context: 'overworld',
    description: 'Learn Ice Rune — set a freezing trap on an adjacent tile.',
    effect: { learnsSpell: 'ice_rune' },
    price: 180,
  },
  spellbook_poison_rune: {
    key: 'spellbook_poison_rune',
    name: 'Tome: Poison Rune',
    kind: 'spellbook',
    context: 'overworld',
    description: 'Learn Poison Rune — mark a tile with a venomous trap.',
    effect: { learnsSpell: 'poison_rune' },
    price: 160,
  },
  spellbook_ring_of_fire: {
    key: 'spellbook_ring_of_fire',
    name: 'Tome: Ring of Fire',
    kind: 'spellbook',
    context: 'overworld',
    description: 'Learn Ring of Fire — surround yourself with burning flames for a few seconds.',
    effect: { learnsSpell: 'ring_of_fire' },
    price: 220,
  },
  spellbook_chaotic_blink: {
    key: 'spellbook_chaotic_blink',
    name: 'Tome: Chaotic Blink',
    kind: 'spellbook',
    context: 'overworld',
    description: 'Learn Chaotic Blink — teleport unpredictably 3–5 tiles away.',
    effect: { learnsSpell: 'chaotic_blink' },
    price: 140,
  },
};
