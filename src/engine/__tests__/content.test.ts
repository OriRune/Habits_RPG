import { describe, it, expect } from 'vitest';
import { BIOMES, BIOME_ORDER } from '@/engine/biomes';
import { ENCOUNTERS, getEncounter } from '@/engine/encounters';
import { ENEMIES } from '@/engine/enemies';
import { RELICS } from '@/engine/relics';
import { getScene } from '@/lib/scenes';

// ── Biome content integrity ──────────────────────────────────────────────────

describe('biome encounter keys', () => {
  it('every encounter key referenced in a biome exists in ENCOUNTERS', () => {
    const missing: string[] = [];
    for (const key of BIOME_ORDER) {
      const biome = BIOMES[key];
      for (const encKey of biome.encounters) {
        if (!getEncounter(encKey)) missing.push(`${key}.encounters: "${encKey}"`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('biome enemy keys', () => {
  it('every enemy key referenced in a biome exists in ENEMIES', () => {
    const missing: string[] = [];
    for (const key of BIOME_ORDER) {
      const biome = BIOMES[key];
      for (const enemyKey of biome.enemies) {
        if (!(enemyKey in ENEMIES)) missing.push(`${key}.enemies: "${enemyKey}"`);
      }
    }
    expect(missing).toEqual([]);
  });
});

// ── Encounter content integrity ──────────────────────────────────────────────

describe('encounter definitions', () => {
  it('every encounter has at least one node and a title', () => {
    const broken: string[] = [];
    for (const [key, def] of Object.entries(ENCOUNTERS)) {
      if (!def.title) broken.push(`${key}: missing title`);
      if (!def.nodes || Object.keys(def.nodes).length === 0) broken.push(`${key}: no nodes`);
    }
    expect(broken).toEqual([]);
  });
});

// ── Relic content integrity ──────────────────────────────────────────────────

describe('relic definitions', () => {
  it('every relic has key, name, tier, and description', () => {
    const broken: string[] = [];
    for (const [key, relic] of Object.entries(RELICS)) {
      if (!relic.name) broken.push(`${key}: missing name`);
      if (!relic.description) broken.push(`${key}: missing description`);
      if (![1, 2, 3].includes(relic.tier)) broken.push(`${key}: invalid tier ${relic.tier}`);
      if (relic.key !== key) broken.push(`${key}: key mismatch (relic.key="${relic.key}")`);
    }
    expect(broken).toEqual([]);
  });
});

// ── Scene key integrity ──────────────────────────────────────────────────────

describe('dungeon scene keys', () => {
  it('all dungeon room + state scene keys are registered (not falling back to ❓)', () => {
    const required = [
      'room:combat',
      'room:encounter',
      'room:treasure',
      'room:rest',
      'room:boss',
      'room:shrine',
      'room:merchant',
      'room:elite',
      'dungeon:entrance',
      'dungeon:checkpoint',
      'dungeon:cleared',
      'dungeon:retreat',
    ];
    const missing = required.filter((key) => getScene(key).glyph === '❓');
    expect(missing).toEqual([]);
  });
});
