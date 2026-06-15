// Sprite stand-in system. Until real art exists, every game entity renders as a
// heraldic Crest (glyph + tint). `resolveSpriteImage` is the single seam to swap in
// real sprite images later — register a URL there and `Sprite` uses it automatically.
import { getStat, type StatId } from '@/engine/stats';
import { CLASS_CHART } from '@/engine/classes';
import { getMaterial } from '@/engine/materials';
import { SCHOOL_STAT, type SpellSchool } from '@/engine/spells';
import { framedSvg } from '@/lib/placeholderArt';

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

/** Gear crest: initial tinted by slot (armor steel, trinket gold, tool leather-brown). */
export function gearCrest(name: string, slot?: string): CrestLook {
  const color = slot === 'armor' ? '#7a8590' : slot === 'tool' ? '#8a5a2b' : GOLD;
  return { glyph: firstLetter(name), color };
}

/** Weapon crest: initial tinted by its attack stat (Strength ember, Dexterity gold). */
export function weaponCrest(name: string, attackStat?: StatId): CrestLook {
  return { glyph: firstLetter(name), color: attackStat === 'ST' ? EMBER : GOLD };
}

/** Spell crest: initial tinted by the spell school's stat color. */
export function spellCrest(name: string, school: SpellSchool): CrestLook {
  return { glyph: firstLetter(name), color: getStat(SCHOOL_STAT[school]).color };
}

/** Relic crest: initial tinted by tier (bronze / steel-blue / royal purple), curses ember. */
export function relicCrest(name: string, tier?: number, curse?: boolean): CrestLook {
  if (curse) return { glyph: firstLetter(name), color: EMBER };
  const color = tier === 3 ? '#7c5cbf' : tier === 2 ? '#5b7da6' : '#b08a3e';
  return { glyph: firstLetter(name), color };
}

/** Stat emblem: the stat's short name on its signature color (habit cards, equipment). */
export function statCrest(stat: StatId): CrestLook {
  const meta = getStat(stat);
  return { glyph: meta.short, color: meta.color };
}

/** Challenge-kind emblem: a short tag tinted per kind. */
const KIND_LOOK: Record<string, CrestLook> = {
  count: { glyph: 'CNT', color: GOLD },
  quantity: { glyph: 'QTY', color: '#3b82f6' },
  streak: { glyph: 'STK', color: EMBER },
  recovery: { glyph: 'RCV', color: '#5e8a2e' },
  class: { glyph: 'CLS', color: '#a78bfa' },
  rival: { glyph: 'RIV', color: '#ec4899' },
};
export function challengeKindCrest(kind: string): CrestLook {
  return KIND_LOOK[kind] ?? { glyph: '★', color: GOLD };
}

/** The app's wordmark placeholder. */
export function brandLook(): CrestLook {
  return { glyph: 'HR', color: GOLD };
}

/** A generated "framed image box" placeholder for any crest. The real-art swap seam below. */
export function placeholderImage(look: CrestLook, label?: string): string {
  return framedSvg({ glyph: look.glyph, color: look.color, label });
}

// --- The swap seam -------------------------------------------------------------
// Map a stable sprite key -> real image URL once art exists, e.g.:
//   import slime from '@/assets/sprites/procrastination_slime.png';
//   const REGISTRY = { 'boss:procrastination_slime': slime };
const SPRITE_REGISTRY: Record<string, string> = {};

export function resolveSpriteImage(key: string): string | undefined {
  return SPRITE_REGISTRY[key];
}
