// Material types + helpers. The editable material DATA lives in
// src/content/materials.ts. Earned from dungeons/challenges; (later) spent on crafting.
import { MATERIALS } from '@/content/materials';

export interface MaterialDef {
  key: string;
  name: string;
  /** Glyph + tint for the heraldic-crest stand-in until real art exists. */
  glyph: string;
  color: string;
}

// Re-export the editable catalog so existing imports (`@/engine/materials`) keep working.
export { MATERIALS } from '@/content/materials';

export const MATERIAL_KEYS = Object.keys(MATERIALS);

export function getMaterial(key: string): MaterialDef | undefined {
  return MATERIALS[key];
}
