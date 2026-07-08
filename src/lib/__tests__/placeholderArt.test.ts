import { describe, it, expect } from 'vitest';
import { framedSvg, ITEM_ART_FAMILIES } from '../placeholderArt';
import {
  gearCrest, itemCrest, materialCrest, placeholderImage, resolveSpriteImage, statCrest, weaponCrest,
} from '../sprites';
import { scenePlaceholderImage, getScene, resolveSceneImage } from '../scenes';

function decode(uri: string): string {
  return decodeURIComponent(uri.replace(/^data:image\/svg\+xml,/, ''));
}

describe('framedSvg', () => {
  it('returns an svg data-URI', () => {
    const uri = framedSvg({ glyph: 'A', color: '#123456' });
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decode(uri)).toContain('<svg');
  });

  it('embeds the glyph, color, and label', () => {
    const svg = decode(framedSvg({ glyph: 'Z', color: '#abcdef', label: 'Test Item' }));
    expect(svg).toContain('>Z<');
    expect(svg).toContain('#abcdef');
    expect(svg).toContain('TEST ITEM'); // label is uppercased
  });

  it('escapes XML-unsafe characters in the glyph', () => {
    const svg = decode(framedSvg({ glyph: '<&>', color: '#000000' }));
    expect(svg).toContain('&lt;&amp;&gt;');
    expect(svg).not.toContain('<&>');
  });

  it('is deterministic', () => {
    const a = framedSvg({ glyph: 'A', color: '#111111', label: 'x' });
    const b = framedSvg({ glyph: 'A', color: '#111111', label: 'x' });
    expect(a).toBe(b);
  });

  it('wide scenes render the caption text', () => {
    const svg = decode(framedSvg({ glyph: '☠️', color: '#222222', label: 'A boss bars the way', wide: true }));
    expect(svg).toContain('viewBox="0 0 320 120"');
    expect(svg).toContain('A boss bars the way');
  });
});

describe('placeholder helpers', () => {
  it('placeholderImage tints by the crest color', () => {
    const uri = placeholderImage(weaponCrest('Iron Mace', 'ST'));
    expect(decode(uri)).toContain('#9c3a25'); // ST → ember
  });

  it('statCrest uses the stat short + color', () => {
    const uri = placeholderImage(statCrest('KN'), 'Knowledge');
    const svg = decode(uri);
    expect(svg).toContain('>KNO<');
    expect(svg).toContain('KNOWLEDGE');
  });

  it('scenePlaceholderImage builds a wide banner from a scene look', () => {
    const svg = decode(scenePlaceholderImage(getScene('room:treasure')));
    expect(svg).toContain('viewBox="0 0 320 120"');
    expect(svg).toContain('A glittering hoard');
  });
});

describe('item silhouettes', () => {
  it('every mapped key renders its silhouette family', () => {
    expect(Object.keys(ITEM_ART_FAMILIES).length).toBeGreaterThan(10);
    for (const [key, family] of Object.entries(ITEM_ART_FAMILIES)) {
      const svg = decode(framedSvg({ glyph: 'X', color: '#123456', entityKey: key, label: key }));
      expect(svg, key).toContain(`data-item="${family}"`);
    }
  });

  it('crest builders forward mapped catalog keys as art (names → keys)', () => {
    expect(gearCrest('Mithril Toolkit', 'tool').art).toBe('mithril_pickaxe');
    expect(gearCrest('Stone Toolkit', 'tool').art).toBe('stone_pickaxe');
    expect(gearCrest('Obsidian Plate', 'armor').art).toBe('obsidian_plate');
    expect(gearCrest('Amber Charm', 'trinket').art).toBe('resin_trinket');
    expect(weaponCrest('Hunting Bow', 'DX').art).toBe('hunting_bow');
    expect(materialCrest('frost_quartz').art).toBe('frost_quartz');
    expect(materialCrest('amber_resin').art).toBe('amber_resin');
  });

  it('mapped crests render the silhouette instead of the letter glyph, keeping the label band', () => {
    const svg = decode(placeholderImage(gearCrest('Mithril Toolkit', 'tool'), 'Mithril Toolkit'));
    expect(svg).toContain('data-item="pickaxe"');
    expect(svg).not.toContain('>M</text>');
    expect(svg).toContain('MITHRIL TOOLKIT');
  });

  it('unmapped keys still fall back to the letter tile', () => {
    expect(gearCrest('Leather Vest', 'armor').art).toBeUndefined();
    expect(materialCrest('iron_bar').art).toBeUndefined();
    const svg = decode(placeholderImage(itemCrest('Healing Potion', 'potion'), 'Healing Potion'));
    expect(svg).not.toContain('data-item=');
    expect(svg).toContain('>H<');
  });

  it('monster entity keys still route to the monster silhouettes', () => {
    const svg = decode(framedSvg({ glyph: 'S', color: '#111111', entityKey: 'skeleton' }));
    expect(svg).not.toContain('data-item=');
  });

  it('is deterministic', () => {
    const a = framedSvg({ glyph: 'X', color: '#123456', entityKey: 'obsidian', label: 'Obsidian' });
    const b = framedSvg({ glyph: 'X', color: '#123456', entityKey: 'obsidian', label: 'Obsidian' });
    expect(a).toBe(b);
  });
});

describe('swap seams remain intact', () => {
  it('return undefined for unregistered keys (real art still overrides placeholders)', () => {
    expect(resolveSpriteImage('boss:nonexistent')).toBeUndefined();
    expect(resolveSceneImage('scene:nonexistent')).toBeUndefined();
  });
});
