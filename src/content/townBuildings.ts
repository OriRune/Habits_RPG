// ============================================================================
//  TOWN BUILDINGS — edit this file to tune the Homestead building roster.
// ============================================================================
//
//  Fuels "The Homestead" town-builder (src/engine/town.ts). Each entry is
//  `key: { ...fields }` (key + inner `key:` must match, be unique). Copy a block
//  to add, edit to change, delete to remove. Buildings charge gold + materials at
//  queue time (escrow) and complete via habit-earned labor. Completed tiers grant
//  light, non-resource perks (see TownPerkId) and prestige (gates deeds + Chapel).
//
//  This is pure data — the engine (src/engine/town.ts) reads this catalog the same
//  allowed direction that engine/mining.ts reads src/content/mining.ts.
//
//  TIERS (tiers[])
//  ---------------
//  tiers[0]      Build cost (raises the building to tier 1).
//  tiers[i]      Upgrade cost (raises the building from tier i to tier i+1).
//  gold          Charged at queue time (bypassed by the unlimitedGold dev switch).
//  materials     Charged at queue time (never bypassed).
//  labor         Habit-earned labor needed to complete the tier (Mason's Guild
//                discounts this AT QUEUE TIME — snapshotted onto the project).
// ============================================================================
import { type Difficulty } from '@/engine/xp';

export type TownPerkId =
  | 'sight'        // Watchtower: +1 crawler sight radius (mine + forest)
  | 'stamina'      // Bathhouse: +10 crawler max stamina
  | 'haggle'       // Trading Post: 15% dungeon-merchant discount
  | 'practice'     // Training Yard: replay cleared trials (no energy, no reward)
  | 'granary'      // Granary: +2 max energy cap
  | 'mason'        // Mason's Guild: −10% labor cost on new projects
  | 'forge_focus'; // Smithy: +0.03 Forge sweet-zone width (consumed by the Forge)

export interface TownTierCost {
  gold: number;
  materials: Record<string, number>;
  labor: number;
}

export interface TownBuildingDef {
  key: string;
  name: string;
  flavor: string;
  w: number;
  h: number;                     // footprint in cells
  maxTier: number;
  tiers: TownTierCost[];         // tiers[0] = build cost; tiers[i] = upgrade to tier i+1
  perk?: TownPerkId;             // active once tier 1 completes; flat across tiers
  prestige: number[];            // prestige granted per completed tier
  unlock?: { deed?: number; prestige?: number };
  artKey: string;
  rotatable?: boolean;
  unique: boolean;               // all v1 buildings are unique; decor is not
}

export const TOWN_DEED_COSTS = [500, 1500, 4000];   // pure gold — the BAL-05 targets (frozen)
// M6 balance (plan3 10.6): prestige is the pacing lever (labor-capped ≈10/day for an active
// player; tier-I prestige ≈1 per labor). The M1 starting gate [40,120,260] put deed 1 at ~4
// days (<1 week — too fast per the BAL-05 pacing target). Retuned so deed 1 lands ~week 2
// (gate 100 ≈ a Keep + ~6 tier-I buildings), deed 2 ~week 4, deed 3 ~week 6-7. See report.
export const TOWN_DEED_PRESTIGE = [100, 200, 320];  // prestige gate per deed
export const TOWN_LABOR_DAILY_CAP = 24;             // BAL-22 guard
export const TOWN_LABOR_BANK_CAP = 200;
export const TOWN_LABOR_RATE: Record<Difficulty, number> = { easy: 1, normal: 2, hard: 4, epic: 6 };
export const TOWN_DECOR_CAP = 60;
export const TOWN_DECOR_PER_TYPE_CAP = 10;

/** The Keep is the mandatory-first, undemolishable building; its tier III grants +1 queue slot. */
export const KEEP_KEY = 'keep';

export const TOWN_BUILDINGS: Record<string, TownBuildingDef> = {
  keep: {
    key: 'keep', name: 'The Keep', flavor: 'The heart of the homestead. Tier III unlocks a second build slot.',
    w: 3, h: 3, maxTier: 4, artKey: 'keep', unique: true,
    prestige: [25, 40, 70, 120],
    tiers: [
      { gold: 100,  materials: { stone: 5,  wood: 5 },                             labor: 20 },
      { gold: 600,  materials: { stone: 10, wood: 8,  iron_bar: 3 },               labor: 45 },
      { gold: 2000, materials: { stone: 18, wood: 14, gemstone: 4 },               labor: 80 },
      { gold: 5000, materials: { stone: 28, wood: 20, obsidian: 4, amber_resin: 3 }, labor: 120 },
    ],
  },
  watchtower: {
    key: 'watchtower', name: 'Watchtower', flavor: 'A high perch. Sharpens your eye in the mine and forest.',
    w: 1, h: 1, maxTier: 3, artKey: 'watchtower', unique: true, perk: 'sight',
    prestige: [10, 15, 25],
    tiers: [
      { gold: 150,  materials: { stone: 4,  wood: 4 },                labor: 15 },
      { gold: 500,  materials: { stone: 8,  wood: 6,  iron_bar: 2 },  labor: 30 },
      { gold: 1400, materials: { stone: 12, wood: 8,  frost_quartz: 2 }, labor: 55 },
    ],
  },
  bathhouse: {
    key: 'bathhouse', name: 'Bathhouse', flavor: 'Warm springs restore the body. Deepens your stamina reserves.',
    w: 2, h: 2, maxTier: 3, artKey: 'bathhouse', unique: true, perk: 'stamina',
    prestige: [15, 25, 40],
    tiers: [
      { gold: 200,  materials: { stone: 6,  wood: 6 },                labor: 15 },
      { gold: 650,  materials: { stone: 10, wood: 8,  iron_bar: 3 },  labor: 30 },
      { gold: 1800, materials: { stone: 16, wood: 12, frost_quartz: 3 }, labor: 55 },
    ],
  },
  trading_post: {
    key: 'trading_post', name: 'Trading Post', flavor: 'Merchants owe you favors. Sharpens your haggling in the dungeon.',
    w: 2, h: 2, maxTier: 3, artKey: 'trading_post', unique: true, perk: 'haggle',
    prestige: [15, 25, 40],
    tiers: [
      { gold: 200,  materials: { stone: 6,  wood: 6 },                labor: 15 },
      { gold: 650,  materials: { stone: 10, wood: 8,  gemstone: 3 },  labor: 30 },
      { gold: 1800, materials: { stone: 16, wood: 12, amber_resin: 3 }, labor: 55 },
    ],
  },
  training_yard: {
    key: 'training_yard', name: 'Training Yard', flavor: 'Drill grounds. Replay cleared trials to hone your form.',
    w: 2, h: 3, maxTier: 3, artKey: 'training_yard', unique: true, perk: 'practice', rotatable: true,
    prestige: [15, 25, 40],
    tiers: [
      { gold: 200,  materials: { stone: 6,  wood: 6 },                labor: 15 },
      { gold: 650,  materials: { stone: 10, wood: 8,  iron_bar: 3 },  labor: 30 },
      { gold: 1800, materials: { stone: 16, wood: 12, obsidian: 3 },  labor: 55 },
    ],
  },
  granary: {
    key: 'granary', name: 'Granary', flavor: 'Stored provisions. Raises your maximum energy cap.',
    w: 2, h: 2, maxTier: 3, artKey: 'granary', unique: true, perk: 'granary',
    prestige: [15, 25, 40],
    tiers: [
      { gold: 200,  materials: { stone: 6,  wood: 6 },                labor: 15 },
      { gold: 650,  materials: { stone: 10, wood: 8,  iron_bar: 3 },  labor: 30 },
      { gold: 1800, materials: { stone: 16, wood: 12, gemstone: 3 },  labor: 55 },
    ],
  },
  masons_guild: {
    key: 'masons_guild', name: "Mason's Guild", flavor: 'Skilled builders. New projects cost 10% less labor.',
    w: 2, h: 2, maxTier: 3, artKey: 'masons_guild', unique: true, perk: 'mason',
    prestige: [15, 25, 40],
    tiers: [
      { gold: 200,  materials: { stone: 6,  wood: 6 },                labor: 15 },
      { gold: 650,  materials: { stone: 10, wood: 8,  iron_bar: 3 },  labor: 30 },
      { gold: 1800, materials: { stone: 16, wood: 12, gemstone: 3 },  labor: 55 },
    ],
  },
  smithy: {
    key: 'smithy', name: 'Smithy', flavor: 'A hot forge stands ready. Widens the Forge sweet zone.',
    w: 2, h: 2, maxTier: 3, artKey: 'smithy', unique: true, perk: 'forge_focus',
    prestige: [15, 25, 40],
    tiers: [
      { gold: 200,  materials: { stone: 6,  wood: 6 },                labor: 15 },
      { gold: 650,  materials: { stone: 10, wood: 8,  iron_bar: 3 },  labor: 30 },
      { gold: 1800, materials: { stone: 16, wood: 12, obsidian: 3 },  labor: 55 },
    ],
  },
  chapel: {
    key: 'chapel', name: 'Chapel', flavor: 'A quiet sanctuary — pure prestige. Requires standing in the town.',
    w: 2, h: 2, maxTier: 3, artKey: 'chapel', unique: true, unlock: { prestige: 80 },
    prestige: [15, 25, 40],
    tiers: [
      { gold: 200,  materials: { stone: 6,  wood: 6 },                labor: 15 },
      { gold: 650,  materials: { stone: 10, wood: 8,  gemstone: 3 },  labor: 30 },
      { gold: 1800, materials: { stone: 16, wood: 12, amber_resin: 3 }, labor: 55 },
    ],
  },
  manor: {
    key: 'manor', name: 'Manor', flavor: 'A grand residence — pure prestige. Requires a second district.',
    w: 2, h: 3, maxTier: 3, artKey: 'manor', unique: true, unlock: { deed: 2 }, rotatable: true,
    prestige: [15, 25, 40],
    tiers: [
      { gold: 200,  materials: { stone: 6,  wood: 6 },                labor: 15 },
      { gold: 650,  materials: { stone: 10, wood: 8,  gemstone: 3 },  labor: 30 },
      { gold: 1800, materials: { stone: 16, wood: 12, amber_resin: 3 }, labor: 55 },
    ],
  },
};

export const TOWN_BUILDING_KEYS = Object.keys(TOWN_BUILDINGS);
