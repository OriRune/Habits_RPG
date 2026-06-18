// Dungeon event illustrations. Every event has a placeholder scene now; real art swaps
// in later via `resolveSceneImage` (same seam pattern as resolveSpriteImage in sprites.ts).
import { framedSvg } from '@/lib/placeholderArt';

export interface SceneLook {
  glyph: string;
  /** Background tint (hex). */
  color: string;
  caption: string;
}

const SCENES: Record<string, SceneLook> = {
  // Rooms
  'room:combat': { glyph: '⚔️', color: '#b23b2e', caption: 'A foe blocks the way' },
  'room:trap': { glyph: '🗡️', color: '#b8860b', caption: 'Blades and tripwires' },
  'room:puzzle': { glyph: '🧩', color: '#2f5fa6', caption: 'An ancient riddle' },
  'room:negotiation': { glyph: '🗣️', color: '#b8487f', caption: 'A wary guardian' },
  'room:survival': { glyph: '🔥', color: '#5e8a2e', caption: 'Harsh conditions' },
  'room:treasure': { glyph: '💰', color: '#c9a227', caption: 'A glittering hoard' },
  'room:rest': { glyph: '🏕️', color: '#2e8a5e', caption: 'A quiet alcove' },
  'room:boss': { glyph: '☠️', color: '#8a2f6a', caption: 'A boss bars the way' },
  'room:encounter': { glyph: '📜', color: '#7a5a2e', caption: 'A choice to make' },
  'room:shrine': { glyph: '✨', color: '#6b3fa0', caption: 'A shrine in the dark' },
  'room:merchant': { glyph: '🪙', color: '#8a6a1a', caption: 'A wandering merchant' },
  'room:elite': { glyph: '🔥', color: '#b23b2e', caption: 'A powerful guardian' },
  'dungeon:entrance': { glyph: '🚪', color: '#4a3320', caption: 'The dungeon mouth' },
  'dungeon:checkpoint': { glyph: '🏕️', color: '#2e8a5e', caption: 'A safe respite' },
  // Biomes (regions)
  'biome:catacombs': { glyph: '💀', color: '#4a3a55', caption: 'The Catacombs' },
  'biome:ruins': { glyph: '🌿', color: '#2f5a3a', caption: 'Overgrown Ruins' },
  'biome:frozen': { glyph: '❄️', color: '#33586b', caption: 'Frozen Caverns' },
  // Outcomes
  'outcome:success': { glyph: '✨', color: '#c9a227', caption: 'Success!' },
  'outcome:partial': { glyph: '😬', color: '#b8860b', caption: 'A near miss' },
  'outcome:fail': { glyph: '💥', color: '#9c3a25', caption: 'It goes badly' },
  // Combat resolution
  'combat:victory': { glyph: '🏆', color: '#c9a227', caption: 'Victory!' },
  'combat:defeat': { glyph: '💀', color: '#4a4a4a', caption: 'Defeated' },
  // Run end
  'dungeon:cleared': { glyph: '👑', color: '#c9a227', caption: 'Dungeon cleared' },
  'dungeon:retreat': { glyph: '🏳️', color: '#6b6b6b', caption: 'You retreat' },
  // Weekly loop
  'weekly:report': { glyph: '📖', color: '#7a5a2e', caption: 'The week in review' },
};

const FALLBACK: SceneLook = { glyph: '❓', color: '#4a3320', caption: '' };

export function getScene(key: string): SceneLook {
  return SCENES[key] ?? FALLBACK;
}

// --- swap seam: register real images here later, keyed identically ----------------
const SCENE_REGISTRY: Record<string, string> = {};

export function resolveSceneImage(key: string): string | undefined {
  return SCENE_REGISTRY[key];
}

/** Generated wide "framed image box" placeholder for a scene banner. */
export function scenePlaceholderImage(look: SceneLook, caption?: string): string {
  return framedSvg({ glyph: look.glyph, color: look.color, label: caption ?? look.caption, wide: true });
}
