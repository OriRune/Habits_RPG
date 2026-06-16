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
  iron_bar: { key: 'iron_bar', name: 'Iron Bar', glyph: 'I', color: '#7a8590' },
  cloth_roll: { key: 'cloth_roll', name: 'Roll of Cloth', glyph: 'R', color: '#b8487f' },
  bronze_bar: { key: 'bronze_bar', name: 'Bronze Bar', glyph: 'B', color: '#a06a3a' },
  herbs: { key: 'herbs', name: 'Herbs', glyph: 'H', color: '#5e8a2e' },
  crystals: { key: 'crystals', name: 'Crystals', glyph: '◆', color: '#6a4fb0' },
  gemstone: { key: 'gemstone', name: 'Gemstone', glyph: '◆', color: '#b8487f' },
  stone: { key: 'stone', name: 'Stone', glyph: 'S', color: '#8a8a8a' },
  wood: { key: 'wood', name: 'Wood', glyph: 'W', color: '#7a5a30' },
};
