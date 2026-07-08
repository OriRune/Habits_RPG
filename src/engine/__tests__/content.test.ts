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

  // ARCH-17: the encounter graph must be internally consistent — a dangling transition
  // target would strand a run on an undefined node. Assert every start/go/goSuccess/goFail
  // resolves to a real node, and that stat checks always define BOTH branches.
  it('every transition target resolves and stat-checks define both branches', () => {
    const broken: string[] = [];
    let transitionsChecked = 0;
    for (const [key, def] of Object.entries(ENCOUNTERS)) {
      // (1) the start node must exist
      if (!def.nodes[def.start]) broken.push(`${key}: start node "${def.start}" missing`);
      for (const [nodeId, node] of Object.entries(def.nodes)) {
        for (const choice of node.choices ?? []) {
          // (2) every transition target must resolve to a node in this encounter
          for (const field of ['go', 'goSuccess', 'goFail'] as const) {
            const target = choice[field];
            if (target === undefined) continue;
            transitionsChecked++;
            if (!def.nodes[target]) {
              broken.push(`${key}.${nodeId}: choice "${choice.label}" ${field} → "${target}" (no such node)`);
            }
          }
          // (3) a stat check needs BOTH success and fail branches (goSuccess ⇔ goFail)
          const hasSuccess = choice.goSuccess !== undefined;
          const hasFail = choice.goFail !== undefined;
          if (hasSuccess !== hasFail) {
            broken.push(`${key}.${nodeId}: choice "${choice.label}" has goSuccess XOR goFail (a stat check needs both)`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
    // Non-vacuity guard: the catalog is richly branched — make sure we actually walked it.
    expect(transitionsChecked).toBeGreaterThan(50);
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
