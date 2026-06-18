// ============================================================================
//  SPELLS — edit this file to add, change, or remove spells.
// ============================================================================
//
//  HOW TO EDIT
//  -----------
//  • Each entry is `key: { ...fields }`. The `key` (left of the colon) and the
//    inner `key:` field must match and be unique.
//  • To ADD a spell: copy any block, give it a new unique key, tweak the fields.
//  • To CHANGE a spell: edit its numbers/text freely.
//  • To DELETE a spell: remove its block. If it's listed in STARTER_SPELLS below,
//    or dropped by a spellbook item / loot table, remove those references too
//    (the build will warn you about dangling references).
//
//  FIELDS
//  ------
//  name        Display name.
//  school      How the spell behaves + which stat powers it:
//                'damage'  → magic damage,  scales with Wisdom,   reduced by foe Ward
//                'support' → heal / buff,   scales with Knowledge (set power>0 to heal)
//                'illusion'→ debuff the foe, scales with Charisma
//  mpCost      Mana spent to cast.
//  power       Base magnitude: damage (damage), HP healed (support), unused for pure
//              status spells (set 0).
//  status?     Optional effect applied. key ∈ 'burn'|'blind'|'weaken'|'bless'|'freeze'|'poison'.
//                burn   = damage-over-time on the foe (magnitude = dmg/turn)
//                blind  = foe may miss / hit weakly
//                weaken = foe's attack reduced (magnitude = fraction, e.g. 0.4)
//                bless  = your incoming damage reduced (magnitude = flat) — on YOU
//                freeze = target cannot act for its duration (turn-based: boss skips turn)
//                poison = damage-over-time (weaker, longer-lasting than burn)
//              `turns` = how many rounds it lasts.
//  mechanic?   Special arena mechanic (absent = standard behaviour):
//                'rune-fire' / 'rune-ice' / 'rune-poison' → places a trap rune on an adjacent tile
//                'ring-of-fire' → fire ring around the player hurts adjacent enemies
//                'teleport'     → blink to a random open tile 3–5 squares away
//              In turn-based combat: runes deal delayed damage (1–3 turns), ring-of-fire scorches
//              the foe for several turns, and teleport grants a short defensive bless ward.
//  description Flavor text shown in the UI.
//
//  NOTE: adding a brand-new `school` or `status` *behaviour* needs an engine edit
//  in src/engine/combat.ts. Editing values / adding spells of existing kinds does not.
// ============================================================================
import type { SpellDef } from '@/engine/spells';

export const SPELLS: Record<string, SpellDef> = {
  // Starters — every character begins with these (see STARTER_SPELLS).
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
    description: "A sapping curse that weakens the foe's blows (Charisma).",
  },

  // --- Tactics positional abilities (only available in Hex Tactics skirmishes) ---
  push: {
    key: 'push',
    name: 'Force Push',
    school: 'illusion',
    mpCost: 8,
    power: 0,
    mechanic: 'push',
    description: 'Hurl an enemy 2 tiles away. They take bonus damage if they crash into a wall or land on a hazard (Charisma).',
  },
  blink: {
    key: 'blink',
    name: 'Blink',
    school: 'support',
    mpCost: 5,
    power: 0,
    mechanic: 'blink',
    description: 'Teleport to any open tile within 2 squares, ignoring terrain height (Knowledge). Consumes your remaining movement.',
  },
  cleave: {
    key: 'cleave',
    name: 'Cleave',
    school: 'support',
    mpCost: 7,
    power: 8,
    mechanic: 'cleave',
    description: 'A sweeping blow that strikes every enemy adjacent to you (Strength).',
  },

  // --- Rune spells — place a trap on an adjacent tile; triggered by any unit stepping on it ---
  fire_rune: {
    key: 'fire_rune',
    name: 'Fire Rune',
    school: 'damage',
    mpCost: 7,
    power: 14,
    mechanic: 'rune-fire',
    description: 'Inscribe a fire rune on an adjacent tile. Any creature that steps on it takes fire damage and is set ablaze (Wisdom).',
  },
  ice_rune: {
    key: 'ice_rune',
    name: 'Ice Rune',
    school: 'damage',
    mpCost: 7,
    power: 8,
    mechanic: 'rune-ice',
    description: 'Set a frost rune on an adjacent tile. Any creature that steps on it is frozen in place (Wisdom).',
  },
  poison_rune: {
    key: 'poison_rune',
    name: 'Poison Rune',
    school: 'damage',
    mpCost: 6,
    power: 6,
    mechanic: 'rune-poison',
    description: 'Mark an adjacent tile with a poison rune. Any creature that steps on it suffers lingering poison (Wisdom).',
  },

  // --- Active arena spells ---
  ring_of_fire: {
    key: 'ring_of_fire',
    name: 'Ring of Fire',
    school: 'damage',
    mpCost: 10,
    power: 6,
    mechanic: 'ring-of-fire',
    description: 'Surround yourself with a ring of flames for a few seconds. Enemies adjacent to you take repeated fire damage (Wisdom). In melee combat, scorches the foe for several turns.',
  },
  chaotic_blink: {
    key: 'chaotic_blink',
    name: 'Chaotic Blink',
    school: 'support',
    mpCost: 5,
    power: 0,
    mechanic: 'teleport',
    description: 'Teleport to a random open tile 3–5 squares away. Unpredictable but great for escaping. In melee combat, grants evasive cover.',
  },
};

/** Spells every new character knows. Keys must exist in SPELLS above. */
export const STARTER_SPELLS = ['sparks', 'mend'];

/** Signature spells offered on the character-creation screen (one pick, added to STARTER_SPELLS). */
export const SIGNATURE_SPELL_CHOICES = ['firebolt', 'bless', 'dazzle', 'hex'];
