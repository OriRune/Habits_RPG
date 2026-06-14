// Crafting materials (design brief §15 economy). Earned from dungeons/challenges,
// spent later by the Crafting milestone. Pure data.

export interface MaterialDef {
  key: string;
  name: string;
  /** Glyph + tint for the heraldic-crest stand-in until real art exists. */
  glyph: string;
  color: string;
}

export const MATERIALS: Record<string, MaterialDef> = {
  leather: { key: 'leather', name: 'Leather', glyph: 'L', color: '#8a5a2b' },
  cloth: { key: 'cloth', name: 'Cloth', glyph: 'C', color: '#b8487f' },
  iron: { key: 'iron', name: 'Iron', glyph: 'I', color: '#7a8590' },
  herb: { key: 'herb', name: 'Herb', glyph: 'H', color: '#5e8a2e' },
  essence: { key: 'essence', name: 'Essence', glyph: 'E', color: '#6a4fb0' },
};

export const MATERIAL_KEYS = Object.keys(MATERIALS);

export function getMaterial(key: string): MaterialDef | undefined {
  return MATERIALS[key];
}
