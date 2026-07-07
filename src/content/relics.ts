// ============================================================================
//  RELICS — edit this file to add, change, or remove dungeon boons & curses.
// ============================================================================
//
//  HOW TO EDIT
//  -----------
//  • Each entry is `key: { ...fields }`. The `key` (left of the colon) and the inner
//    `key:` field must match and be unique.
//  • effect: any of statBonuses (per-stat points), defense, ward, maxHp. Negative values
//    are allowed (used by curses).
//  • tier: 1 common · 2 uncommon · 3 rare. Higher-tier boons only appear once you've
//    descended deep enough (see DUNGEON milestone gates).
//  • curse: true marks a relic that is only granted by shrine failures — never offered
//    as a boon choice.
// ============================================================================
import type { RelicDef } from '@/engine/relics';

export const RELICS: Record<string, RelicDef> = {
  // --- Tier 1: single-stat boons -------------------------------------------
  ember_sigil: { key: 'ember_sigil', name: 'Ember Sigil', tier: 1, description: '+3 Strength for this run.', effect: { statBonuses: { ST: 3 } } },
  keen_lens: { key: 'keen_lens', name: 'Keen Lens', tier: 1, description: '+3 Dexterity for this run.', effect: { statBonuses: { DX: 3 } } },
  swift_anklet: { key: 'swift_anklet', name: 'Swift Anklet', tier: 1, description: '+3 Agility for this run.', effect: { statBonuses: { AG: 3 } } },
  oak_token: { key: 'oak_token', name: 'Oak Token', tier: 1, description: '+3 Endurance for this run.', effect: { statBonuses: { EN: 3 } } },
  sage_bead: { key: 'sage_bead', name: 'Sage Bead', tier: 1, description: '+3 Wisdom for this run.', effect: { statBonuses: { WI: 3 } } },
  silver_tongue: { key: 'silver_tongue', name: 'Silver Tongue', tier: 1, description: '+3 Charisma for this run.', effect: { statBonuses: { CH: 3 } } },
  owl_charm: { key: 'owl_charm', name: 'Owl Charm', tier: 1, description: '+3 Knowledge for this run.', effect: { statBonuses: { KN: 3 } } },
  vital_charm: { key: 'vital_charm', name: 'Vital Charm', tier: 1, description: '+15 max HP for this run.', effect: { maxHp: 15 } },
  padded_jerkin: { key: 'padded_jerkin', name: 'Padded Jerkin', tier: 1, description: '+2 Defense for this run.', effect: { defense: 2 } },
  runed_band: { key: 'runed_band', name: 'Runed Band', tier: 1, description: '+2 Ward for this run.', effect: { ward: 2 } },

  bone_ward: { key: 'bone_ward', name: 'Bone Ward', tier: 1, description: '+4 Endurance for this run.', effect: { statBonuses: { EN: 4 } } },
  frost_mantle: { key: 'frost_mantle', name: 'Frost Mantle', tier: 1, description: '+15 max HP and +2 Ward.', effect: { maxHp: 15, ward: 2 } },

  // --- Tier 2: dual / mitigation boons --------------------------------------
  stone_heart: { key: 'stone_heart', name: 'Stone Heart', tier: 2, description: '+20 max HP and +2 Defense.', effect: { maxHp: 20, defense: 2 } },
  warding_rune: { key: 'warding_rune', name: 'Warding Rune', tier: 2, description: '+3 Ward and +2 Wisdom.', effect: { ward: 3, statBonuses: { WI: 2 } } },
  bulwark_crest: { key: 'bulwark_crest', name: 'Bulwark Crest', tier: 2, description: '+3 Defense and +2 Endurance.', effect: { defense: 3, statBonuses: { EN: 2 } } },
  twin_fang: { key: 'twin_fang', name: 'Twin Fang', tier: 2, description: '+4 Strength and +2 Dexterity.', effect: { statBonuses: { ST: 4, DX: 2 } } },
  arcane_prism: { key: 'arcane_prism', name: 'Arcane Prism', tier: 2, description: '+4 Knowledge and +2 Wisdom.', effect: { statBonuses: { KN: 4, WI: 2 } } },
  aegis_charm: { key: 'aegis_charm', name: 'Aegis Charm', tier: 2, description: '+3 Defense and +3 Ward.', effect: { defense: 3, ward: 3 } },
  windrunner_sash: { key: 'windrunner_sash', name: 'Windrunner Sash', tier: 2, description: '+4 Agility and +2 Endurance.', effect: { statBonuses: { AG: 4, EN: 2 } } },
  gilded_mask: { key: 'gilded_mask', name: 'Gilded Mask', tier: 2, description: '+4 Charisma and +2 Knowledge.', effect: { statBonuses: { CH: 4, KN: 2 } } },

  shadow_mantle: { key: 'shadow_mantle', name: 'Shadow Mantle', tier: 2, description: '+3 Agility and +15 max HP.', effect: { statBonuses: { AG: 3 }, maxHp: 15 } },
  verdant_sigil: { key: 'verdant_sigil', name: 'Verdant Sigil', tier: 2, description: '+3 Strength and +3 Endurance.', effect: { statBonuses: { ST: 3, EN: 3 } } },
  twin_sage: { key: 'twin_sage', name: 'Twin Sage', tier: 2, description: '+4 Wisdom and +2 Charisma.', effect: { statBonuses: { WI: 4, CH: 2 } } },
  // Triggered relics
  bloodied_fang: { key: 'bloodied_fang', name: 'Bloodied Fang', tier: 2, description: 'Restore 12% max HP after each combat win.', effect: {}, trigger: { type: 'onCombatWin', healPct: 0.12 } },
  desperate_ward: { key: 'desperate_ward', name: 'Desperate Ward', tier: 2, description: 'While below 35% HP: +6 Defense.', effect: {}, trigger: { type: 'lowHp', threshold: 0.35, defense: 6 } },
  shrine_stone: { key: 'shrine_stone', name: 'Shrine Stone', tier: 2, description: 'Each successful shrine visit: +1 Wisdom, +1 Charisma (stacks).', effect: {}, trigger: { type: 'onShrine', statBonuses: { WI: 1, CH: 1 } } },

  // --- Tier 3: rare power boons ---------------------------------------------
  titan_grip: { key: 'titan_grip', name: 'Titan Grip', tier: 3, description: '+6 Strength and +25 max HP.', effect: { statBonuses: { ST: 6 }, maxHp: 25 } },
  archsage_codex: { key: 'archsage_codex', name: "Archsage's Codex", tier: 3, description: '+6 Knowledge and +3 Ward.', effect: { statBonuses: { KN: 6 }, ward: 3 } },
  phoenix_feather: { key: 'phoenix_feather', name: 'Phoenix Feather', tier: 3, description: '+30 max HP, +3 Defense, +3 Ward.', effect: { maxHp: 30, defense: 3, ward: 3 } },
  worldroot_heart: { key: 'worldroot_heart', name: 'Worldroot Heart', tier: 3, description: '+5 Endurance, +3 Wisdom, and +20 max HP.', effect: { statBonuses: { EN: 5, WI: 3 }, maxHp: 20 } },
  dragon_scale: { key: 'dragon_scale', name: 'Dragon Scale', tier: 3, description: '+4 Defense, +4 Ward, and +20 max HP.', effect: { defense: 4, ward: 4, maxHp: 20 } },

  soulbound_crown: { key: 'soulbound_crown', name: 'Soulbound Crown', tier: 3, description: '+5 Charisma and +4 Wisdom.', effect: { statBonuses: { CH: 5, WI: 4 } } },
  frostbitten_edge: { key: 'frostbitten_edge', name: 'Frostbitten Edge', tier: 3, description: '+5 Strength and +4 Agility.', effect: { statBonuses: { ST: 5, AG: 4 } } },

  // --- Curses: only from failed shrine gambles -------------------------------
  cracked_idol: { key: 'cracked_idol', name: 'Cracked Idol', tier: 1, curse: true, description: 'Curse: −3 Endurance for this run.', effect: { statBonuses: { EN: -3 } } },
  leaden_weight: { key: 'leaden_weight', name: 'Leaden Weight', tier: 1, curse: true, description: 'Curse: −3 Agility for this run.', effect: { statBonuses: { AG: -3 } } },
  brittle_bones: { key: 'brittle_bones', name: 'Brittle Bones', tier: 1, curse: true, description: 'Curse: −15 max HP for this run.', effect: { maxHp: -15 } },
  dull_blade: { key: 'dull_blade', name: 'Dull Blade', tier: 1, curse: true, description: 'Curse: −3 Strength for this run.', effect: { statBonuses: { ST: -3 } } },
  clouded_mind: { key: 'clouded_mind', name: 'Clouded Mind', tier: 1, curse: true, description: 'Curse: −3 Knowledge for this run.', effect: { statBonuses: { KN: -3 } } },
};
