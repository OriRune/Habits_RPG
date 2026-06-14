// Crafting types + helpers. Recipes consume materials (+ optional gold) to produce gear,
// weapons, or items. The editable recipe DATA lives in src/content/recipes.ts.
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
  description?: string;
}

export { RECIPES } from '@/content/recipes';

export function getRecipe(key: string): RecipeDef | undefined {
  return RECIPES[key];
}

/** Whether the player can afford a recipe (enough of every material + gold). */
export function canCraft(recipe: RecipeDef, materials: Record<string, number>, gold: number): boolean {
  if ((recipe.gold ?? 0) > gold) return false;
  for (const [key, qty] of Object.entries(recipe.materials)) {
    if ((materials[key] ?? 0) < qty) return false;
  }
  return true;
}
