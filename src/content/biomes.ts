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
//  • `phases[n].moveset` — the boss's move pool for that phase. Each move is picked
//                  randomly (by weight) and telegraphed to the player before their turn.
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
      baseHp: 110,
      attack: 9,
      defense: 3,
      weakTo: ['ST', 'WI'],
      resistTo: ['DX'],
      phases: [
        {
          hp: 110, attack: 9, defense: 3,
          weakTo: ['ST'], resistTo: ['DX'], attackSchool: 'physical',
          moveset: [
            { kind: 'attack', weight: 3, label: 'swings with massive bone fists', icon: '⚔️' },
            { kind: 'heavy',  weight: 2, mult: 2.0, label: 'raises both arms for a bone-shattering crush', icon: '💥' },
            { kind: 'guard',  weight: 1, bonus: 4,  label: 'locks its bones into a defensive formation', icon: '🛡️' },
          ],
        },
        {
          hp: 90,
          attack: 12,
          defense: 2,
          ward: 3,
          weakTo: ['WI'],
          attackSchool: 'magic',
          transitionMsg: 'The Bone Tyrant shatters — and reforms in a vortex of cursed flame!',
          moveset: [
            { kind: 'drain',   weight: 2, drainRatio: 0.3, label: 'sears flesh and drinks the pain', icon: '🩸' },
            { kind: 'inflict', weight: 2, inflictKey: 'burn', inflictTurns: 3, inflictMag: 5, label: 'wraps you in cursed flame', icon: '🔥' },
            { kind: 'heavy',   weight: 1, mult: 1.7, label: 'crashes in with a flaming backhand', icon: '💥' },
          ],
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
      baseHp: 130,
      attack: 11,
      defense: 4,
      weakTo: ['WI'],
      resistTo: ['ST'],
      phases: [
        {
          hp: 130, attack: 11, defense: 4,
          weakTo: ['WI'], resistTo: ['ST'], attackSchool: 'physical',
          moveset: [
            { kind: 'attack',  weight: 2, label: 'sweeps with a massive root', icon: '⚔️' },
            { kind: 'guard',   weight: 2, bonus: 5,  label: 'raises a wall of tangled bark', icon: '🛡️' },
            { kind: 'inflict', weight: 2, inflictKey: 'poison', inflictTurns: 3, inflictMag: 4, label: 'drives venomous thorns into you', icon: '☠️' },
          ],
        },
        {
          hp: 110,
          attack: 14,
          defense: 2,
          weakTo: ['DX', 'WI'],
          attackSchool: 'physical',
          transitionMsg: 'Bark splits and the Ancient lashes out with a thousand whipping vines!',
          moveset: [
            { kind: 'multi',  weight: 3, hits: 3, label: 'lashes with a whirlwind of vines', icon: '🗡️' },
            { kind: 'heavy',  weight: 2, mult: 1.8, label: 'brings down a titanic branch', icon: '💥' },
            { kind: 'enrage', weight: 1, bonus: 4,  label: 'channels the fury of the grove', icon: '🔥' },
          ],
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
      baseHp: 115,
      attack: 12,
      defense: 4,
      ward: 3,
      weakTo: ['ST'],
      resistTo: ['WI'],
      phases: [
        {
          hp: 115, attack: 12, defense: 4, ward: 3,
          weakTo: ['ST'], resistTo: ['WI'], attackSchool: 'physical',
          moveset: [
            { kind: 'attack',  weight: 3, label: 'strikes with an armored frost-fist', icon: '⚔️' },
            { kind: 'guard',   weight: 2, bonus: 6, label: 'raises its frost shield', icon: '🛡️' },
            { kind: 'inflict', weight: 1, inflictKey: 'freeze', inflictTurns: 1, inflictMag: 1, label: 'exhales a blast of freezing air', icon: '❄️' },
          ],
        },
        {
          hp: 95,
          attack: 15,
          defense: 2,
          ward: 5,
          weakTo: ['ST', 'DX'],
          attackSchool: 'magic',
          transitionMsg: 'The Warden sheds its armor and unleashes a blizzard of shards!',
          moveset: [
            { kind: 'heavy',   weight: 2, mult: 2.0, label: 'unleashes a concentrated shardstorm', icon: '💥' },
            { kind: 'multi',   weight: 2, hits: 3,   label: 'peppers you with ice shards', icon: '🗡️' },
            { kind: 'inflict', weight: 2, inflictKey: 'weaken', inflictTurns: 3, inflictMag: 0.3, label: 'saps your strength with bitter cold', icon: '⬇️' },
          ],
        },
        {
          hp: 85,
          attack: 17,
          defense: 1,
          weakTo: ['ST', 'WI'],
          attackSchool: 'magic',
          transitionMsg: 'Cracked and desperate, the Warden makes its final, furious stand!',
          moveset: [
            { kind: 'heavy',   weight: 3, mult: 2.2, label: 'strikes with desperate fury', icon: '💥' },
            { kind: 'drain',   weight: 2, drainRatio: 0.35, label: 'tears life force from your warmth', icon: '🩸' },
            { kind: 'enrage',  weight: 1, bonus: 3,  label: 'roars with its last reserves of power', icon: '🔥' },
          ],
        },
      ],
      rewards: { gold: 0, items: [] },
    },
  },
};

/** Descent order — region N (0-based) covers depths N*5+1 .. N*5+5, boss on the 5th. */
export const BIOME_ORDER = ['catacombs', 'ruins', 'frozen'];
