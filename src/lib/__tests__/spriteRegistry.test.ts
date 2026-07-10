import { describe, it, expect } from 'vitest';
import { ITEMS } from '@/engine/items';
import { RELICS } from '@/content/relics';
import { resolveSpriteImage } from '../sprites';

describe('SPRITE_REGISTRY', () => {
  it('registers gear, weapon, item, material, and relic art under their keys', () => {
    expect(resolveSpriteImage('gear:leather_vest')).toBeTruthy();
    expect(resolveSpriteImage('weapon:worn_sword')).toBeTruthy();
    expect(resolveSpriteImage('item:healing_potion')).toBeTruthy();
    expect(resolveSpriteImage('material:iron_bar')).toBeTruthy();
    expect(resolveSpriteImage('relic:ember_sigil')).toBeTruthy();
  });

  it('maps the renamed stray file to silver_tongue', () => {
    expect(resolveSpriteImage('relic:silver_tongue')).toBeTruthy();
  });

  it('uses the one generic spellbook sprite for every tome', () => {
    const firebolt = resolveSpriteImage('item:spellbook_firebolt');
    expect(firebolt).toBeTruthy();
    expect(resolveSpriteImage('item:spellbook_hex')).toBe(firebolt);
    expect(resolveSpriteImage('item:spellbook_bless')).toBe(firebolt);
    expect(resolveSpriteImage('item:spellbook_dazzle')).toBe(firebolt);
    // No bare `item:spellbook` key is emitted.
    expect(resolveSpriteImage('item:spellbook')).toBeUndefined();
  });

  it('registers the tome sprite for every spellbook item in the table', () => {
    const firebolt = resolveSpriteImage('item:spellbook_firebolt');
    const spellbooks = Object.values(ITEMS).filter((i) => i.kind === 'spellbook');
    expect(spellbooks.length).toBeGreaterThan(4);
    for (const book of spellbooks) {
      expect(resolveSpriteImage(`item:${book.key}`)).toBe(firebolt);
    }
  });

  it('has real art for every relic in the catalog (plan 4.1 / DUN-14)', () => {
    for (const relic of Object.values(RELICS)) {
      expect(resolveSpriteImage(`relic:${relic.key}`), relic.key).toBeTruthy();
    }
  });

  it('leaves entities without art unregistered (placeholder fallback)', () => {
    expect(resolveSpriteImage('material:herbs')).toBeUndefined();
    expect(resolveSpriteImage('spell:sparks')).toBeUndefined();
  });
});
