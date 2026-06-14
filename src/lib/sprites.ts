// Sprite stand-in system. Until real art exists, every game entity renders as a
// heraldic Crest (glyph + tint). `resolveSpriteImage` is the single seam to swap in
// real sprite images later — register a URL there and `Sprite` uses it automatically.
import { getStat, type StatId } from '@/engine/stats';
import { CLASS_CHART } from '@/engine/classes';
import { getMaterial } from '@/engine/materials';

/** Reverse map: class name -> its primary stat (the chart row it sits in). */
const CLASS_TO_STAT: Record<string, StatId> = (() => {
  const map: Record<string, StatId> = {};
  for (const primary of Object.keys(CLASS_CHART) as StatId[]) {
    for (const className of Object.values(CLASS_CHART[primary])) {
      map[className] = primary;
    }
  }
  return map;
})();

export interface CrestLook {
  glyph: string;
  color: string;
}

const GOLD = '#c9a227';
const EMBER = '#9c3a25';

/** A class's crest: its initial, tinted by its primary stat color. */
export function classCrest(className: string): CrestLook {
  const stat = CLASS_TO_STAT[className];
  return {
    glyph: className.charAt(0).toUpperCase(),
    color: stat ? getStat(stat).color : GOLD,
  };
}

/** The player's avatar crest. Pre-class "Adventurer" is tinted by their best stat. */
export function avatarCrest(classId: string | null, topStat: StatId): CrestLook {
  if (classId) return classCrest(classId);
  return { glyph: 'A', color: getStat(topStat).color };
}

function firstLetter(name: string): string {
  const cleaned = name.replace(/^The\s+/i, '').trim();
  return (cleaned.charAt(0) || '?').toUpperCase();
}

/** Boss crest: initial of its name on an ember field. */
export function bossCrest(name: string): CrestLook {
  return { glyph: firstLetter(name), color: EMBER };
}

/** Item crest: initial tinted by item kind. */
export function itemCrest(name: string, kind?: string): CrestLook {
  const color = kind === 'potion' ? '#5b3f6b' : kind === 'utility' ? '#35506b' : GOLD;
  return { glyph: firstLetter(name), color };
}

/** Material crest from the materials catalog. */
export function materialCrest(key: string): CrestLook {
  const m = getMaterial(key);
  return m ? { glyph: m.glyph, color: m.color } : { glyph: '?', color: GOLD };
}

// --- The swap seam -------------------------------------------------------------
// Map a stable sprite key -> real image URL once art exists, e.g.:
//   import slime from '@/assets/sprites/procrastination_slime.png';
//   const REGISTRY = { 'boss:procrastination_slime': slime };
const SPRITE_REGISTRY: Record<string, string> = {};

export function resolveSpriteImage(key: string): string | undefined {
  return SPRITE_REGISTRY[key];
}
