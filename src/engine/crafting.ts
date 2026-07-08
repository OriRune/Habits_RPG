// Crafting types + helpers. Recipes consume materials (+ optional gold) to produce gear,
// weapons, or items. The editable recipe DATA lives in src/content/recipes.ts.
// Quality tiers (the Forge minigame's output) also live here — see
// docs/forge-minigame-development-plan.md §2.
import type { StatId } from './stats';
import type { GearDef } from './gear';
import type { WeaponDef } from './weapons';
import { RECIPES } from '@/content/recipes';

export interface RecipeDef {
  key: string;
  name: string;
  /** What the recipe yields. */
  result: { kind: 'gear' | 'weapon' | 'item'; key: string };
  /** Material costs, keyed by material id (see content/materials.ts). */
  materials: Record<string, number>;
  /** Optional gold cost. */
  gold?: number;
  /**
   * Re-forge anchor material (a material id): the single material consumed by a Re-forge
   * (§5), on top of the gold sink. Defaults to the recipe's first-listed material when
   * absent — see reforgeAnchorOf.
   */
  reforgeAnchor?: string;
  description?: string;
}

export { RECIPES } from '@/content/recipes';

export function getRecipe(key: string): RecipeDef | undefined {
  return RECIPES[key];
}

/**
 * Re-forge anchor material id: the explicit `reforgeAnchor`, else the recipe's first-listed
 * material (object key order is insertion order, so this is deterministic).
 */
export function reforgeAnchorOf(recipe: RecipeDef): string {
  return recipe.reforgeAnchor ?? Object.keys(recipe.materials)[0];
}

/**
 * Re-forge gold cost (§5): a gold-heavy, material-light repeatable sink — max(100, 2× the
 * recipe's gold). The 100g floor keeps goldless recipes a real sink.
 */
export function reforgeCost(recipe: RecipeDef): number {
  return Math.max(100, 2 * (recipe.gold ?? 0));
}

/** Whether the player can afford a recipe (enough of every material + gold). */
export function canCraft(recipe: RecipeDef, materials: Record<string, number>, gold: number): boolean {
  if ((recipe.gold ?? 0) > gold) return false;
  for (const [key, qty] of Object.entries(recipe.materials)) {
    if ((materials[key] ?? 0) < qty) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Metal temperaments (Forge minigame variety)
// ---------------------------------------------------------------------------

import type { ForgeTemperamentId } from './crafting/forge';

/** Material families → forging personality. Checked in priority order (fickle first):
 *  a recipe with any crystalline material forges fickle even if it also uses iron. */
const FICKLE_MATERIALS = ['crystals', 'frost_quartz', 'obsidian'];
const STUBBORN_MATERIALS = ['iron_bar', 'bronze_bar'];

/**
 * A recipe's metal temperament (see TEMPERAMENTS in crafting/forge.ts): crystalline
 * materials → fickle, metal bars → stubborn, everything else (leather/cloth/herbs/
 * resin) → supple. Lives here rather than forge.ts so the reducer stays content-free.
 */
export function recipeTemperament(recipe: RecipeDef): ForgeTemperamentId {
  const keys = Object.keys(recipe.materials);
  if (keys.some((k) => FICKLE_MATERIALS.includes(k))) return 'fickle';
  if (keys.some((k) => STUBBORN_MATERIALS.includes(k))) return 'stubborn';
  return 'supple';
}

// ---------------------------------------------------------------------------
// Quality tiers (Forge minigame output)
// ---------------------------------------------------------------------------

export type CraftTier = 0 | 1 | 2 | 3;
// Literal-typed (not `: CraftTier`) so switch statements over a tier narrow exhaustively.
export const CRUDE = 0;
export const NORMAL = 1;
export const FINE = 2;
export const MASTERWORK = 3;

export interface CraftTierDef {
  name: string;
  /** Stat multiplier; integer floors in scaleTierStat keep small items distinct per tier. */
  mult: number;
  color: string;
  glyph: string;
}

export const CRAFT_TIERS: Record<CraftTier, CraftTierDef> = {
  0: { name: 'Crude', mult: 0.85, color: '#8b6914', glyph: '🟤' },
  1: { name: 'Normal', mult: 1.0, color: '#c9a227', glyph: '⬜' },
  2: { name: 'Fine', mult: 1.15, color: '#7dd3fc', glyph: '🔵' },
  3: { name: 'Masterwork', mult: 1.3, color: '#a78bfa', glyph: '💜' },
};

/** Forge score → quality tier. 0.40/0.75 deliberately match scoreToStars (trials.ts). */
export function scoreToTier(score01: number): CraftTier {
  if (score01 >= 0.75) return MASTERWORK;
  if (score01 >= 0.4) return FINE;
  if (score01 >= 0.2) return NORMAL;
  return CRUDE;
}

/** Coerce a persisted quality value (or absent key) into a valid tier. Absent ⇒ Normal. */
export function asCraftTier(n: number | undefined): CraftTier {
  if (n === undefined || !Number.isFinite(n)) return NORMAL;
  return Math.min(MASTERWORK, Math.max(CRUDE, Math.round(n))) as CraftTier;
}

export function tierLabel(tier: number | undefined): string {
  return CRAFT_TIERS[asCraftTier(tier)].name;
}

/**
 * Scale one item stat by tier, guaranteeing visibly distinct integers per tier: naive
 * rounding collapses tiers on small bases (a +3 trinket rounds to 3 at ×0.85/×1.0/×1.15),
 * which would put a "Fine" badge on Crude-identical stats. Floors: Crude always base−1
 * (min 1), Fine at least base+1, Masterwork at least base+2.
 */
export function scaleTierStat(base: number, tier: CraftTier): number {
  if (base <= 0) return base; // zero/absent stats stay untouched
  const raw = Math.round(base * CRAFT_TIERS[tier].mult);
  switch (tier) {
    case CRUDE:
      return Math.min(raw, Math.max(1, base - 1));
    case NORMAL:
      return base;
    case FINE:
      return Math.max(raw, base + 1);
    case MASTERWORK:
      return Math.max(raw, base + 2);
  }
}

/** Quality-scaled copy of a gear def: defense/ward/statBonuses scale; the categorical/
 *  functional fields (xpBonus, mining/chopping power, slot, price) stay untouched. */
export function scaleGearDef(def: GearDef, tier: CraftTier): GearDef {
  if (tier === NORMAL) return def;
  const out: GearDef = { ...def };
  if (def.defense !== undefined) out.defense = scaleTierStat(def.defense, tier);
  if (def.ward !== undefined) out.ward = scaleTierStat(def.ward, tier);
  if (def.statBonuses) {
    const scaled: Partial<Record<StatId, number>> = {};
    for (const [stat, n] of Object.entries(def.statBonuses)) {
      scaled[stat as StatId] = scaleTierStat(n ?? 0, tier);
    }
    out.statBonuses = scaled;
  }
  return out;
}

/** Quality-scaled copy of a weapon def: only `bonus` scales (attackStat/staminaCost/
 *  ranged/range are functional properties quality shouldn't alter). */
export function scaleWeaponDef(def: WeaponDef, tier: CraftTier): WeaponDef {
  if (tier === NORMAL) return def;
  return { ...def, bonus: scaleTierStat(def.bonus, tier) };
}
