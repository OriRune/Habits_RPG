// ============================================================================
//  MATERIALS — edit this file to add, change, or remove crafting materials.
// ============================================================================
//
//  Materials drop from dungeons/challenges and (later) feed crafting. Each entry is
//  `key: { ...fields }` (key + inner `key:` must match, be unique). Copy a block to
//  add; edit to change; delete to remove.
//
//  FIELDS
//  ------
//  name    Display name.
//  glyph   A single letter/character shown on the placeholder crest.
//  color   Hex tint for the crest (e.g. '#8a5a2b').
// ============================================================================
import type { MaterialDef } from '@/engine/materials';

export const MATERIALS: Record<string, MaterialDef> = {
  leather: { key: 'leather', name: 'Leather', glyph: 'L', color: '#8a5a2b' },
  cloth: { key: 'cloth', name: 'Cloth', glyph: 'C', color: '#b8487f' },
  iron: { key: 'iron', name: 'Iron', glyph: 'I', color: '#7a8590' },
  herb: { key: 'herb', name: 'Herb', glyph: 'H', color: '#5e8a2e' },
  essence: { key: 'essence', name: 'Essence', glyph: 'E', color: '#6a4fb0' },
};
