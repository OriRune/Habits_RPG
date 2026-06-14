import { describe, it, expect } from 'vitest';
import { framedSvg } from '../placeholderArt';
import { placeholderImage, resolveSpriteImage, statCrest, weaponCrest } from '../sprites';
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

describe('swap seams remain intact', () => {
  it('return undefined for unregistered keys (real art still overrides placeholders)', () => {
    expect(resolveSpriteImage('boss:nonexistent')).toBeUndefined();
    expect(resolveSceneImage('scene:nonexistent')).toBeUndefined();
  });
});
