// ============================================================================
//  BIOMES — edit this file to add, change, or reorder dungeon regions.
// ============================================================================
//
//  HOW TO EDIT
//  -----------
//  • Each entry is `key: { ...fields }`. BIOME_ORDER decides the descent sequence
//    (a new region every 5 floors; the 5th floor of each is its boss).
//  • `enemies`   — ids from engine/enemies.ts (ENEMIES). Combat foes are drawn here.
//  • `encounters`— keys from content/encounters.ts. Text events are drawn here.
//  • `boss`      — a BossDef with `phases` for a multi-phase fight. HP/attack are
//                  scaled by depth at spawn (see bossFor), so author baseline values.
// ============================================================================
import type { BiomeDef } from '@/engine/biomes';

export const BIOMES: Record<string, BiomeDef> = {
  catacombs: {
    key: 'catacombs',
    name: 'The Catacombs',
    tint: '#4a3a55',
    blurb: 'Bone-lined halls where the restless dead keep their vigil.',
    enemies: ['skeleton', 'wisp', 'ghoul'],
    encounters: ['sealed_door', 'gatekeeper', 'bone_pit'],
    boss: {
      id: 'bone_tyrant',
      name: 'The Bone Tyrant',
      flavor: 'A crowned colossus of fused skeletons that refuses to stay dead.',
      baseHp: 220,
      attack: 16,
      defense: 4,
      weakTo: ['ST', 'WI'],
      resistTo: ['DX'],
      phases: [
        { hp: 220, attack: 16, defense: 4, weakTo: ['ST'], resistTo: ['DX'], attackSchool: 'physical' },
        {
          hp: 180,
          attack: 22,
          defense: 2,
          ward: 4,
          weakTo: ['WI'],
          attackSchool: 'magic',
          transitionMsg: 'The Bone Tyrant shatters — and reforms in a vortex of cursed flame!',
        },
      ],
      rewards: { gold: 0, items: [] },
    },
  },

  ruins: {
    key: 'ruins',
    name: 'The Overgrown Ruins',
    tint: '#2f5a3a',
    blurb: 'Toppled stone swallowed by root and bramble, prowled by wild things.',
    enemies: ['goblin', 'giant_spider', 'dire_wolf', 'thornling'],
    encounters: ['collapsing_bridge', 'wild_grove', 'gatekeeper'],
    boss: {
      id: 'vinewood_ancient',
      name: 'The Vinewood Ancient',
      flavor: 'A grove-god of thorn and timber, ancient and furious.',
      baseHp: 240,
      attack: 17,
      defense: 5,
      weakTo: ['WI'],
      resistTo: ['ST'],
      phases: [
        { hp: 240, attack: 17, defense: 5, weakTo: ['WI'], resistTo: ['ST'], attackSchool: 'physical' },
        {
          hp: 200,
          attack: 21,
          defense: 3,
          weakTo: ['DX', 'WI'],
          attackSchool: 'physical',
          transitionMsg: 'Bark splits and the Ancient lashes out with a thousand whipping vines!',
        },
      ],
      rewards: { gold: 0, items: [] },
    },
  },

  frozen: {
    key: 'frozen',
    name: 'The Frozen Caverns',
    tint: '#33586b',
    blurb: 'A blue-lit labyrinth of ice where elementals churn the cold.',
    enemies: ['stone_sentry', 'frost_revenant', 'ice_elemental'],
    encounters: ['frozen_chasm', 'starving_dark', 'sealed_door'],
    boss: {
      id: 'frost_warden',
      name: 'The Frost Warden',
      flavor: 'A towering rime-knight that guards the deep cold in three forms.',
      baseHp: 200,
      attack: 18,
      defense: 4,
      ward: 3,
      weakTo: ['ST'],
      resistTo: ['WI'],
      phases: [
        { hp: 200, attack: 18, defense: 4, ward: 3, weakTo: ['ST'], resistTo: ['WI'], attackSchool: 'physical' },
        {
          hp: 170,
          attack: 22,
          defense: 2,
          ward: 6,
          weakTo: ['ST', 'DX'],
          attackSchool: 'magic',
          transitionMsg: 'The Warden sheds its armor and unleashes a blizzard of shards!',
        },
        {
          hp: 150,
          attack: 26,
          defense: 1,
          weakTo: ['ST', 'WI'],
          attackSchool: 'magic',
          transitionMsg: 'Cracked and desperate, the Warden makes its final, furious stand!',
        },
      ],
      rewards: { gold: 0, items: [] },
    },
  },
};

/** Descent order — region N (0-based) covers depths N*5+1 .. N*5+5, boss on the 5th. */
export const BIOME_ORDER = ['catacombs', 'ruins', 'frozen'];
