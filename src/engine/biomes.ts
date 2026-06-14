// Dungeon biomes (regions). A biome themes the enemy pool, encounter set, boss, and
// scene tint. As you descend, the biome changes every 5 floors and the 5th floor of
// each region is its multi-phase boss. Editable DATA lives in src/content/biomes.ts.
import type { BossDef } from './bosses';
import { BIOMES, BIOME_ORDER } from '@/content/biomes';

export interface BiomeDef {
  key: string;
  name: string;
  /** Scene background tint (hex). */
  tint: string;
  blurb: string;
  /** Enemy template ids (engine/enemies.ts) this biome draws combat foes from. */
  enemies: string[];
  /** Encounter keys (engine/encounters.ts) this biome draws text events from. */
  encounters: string[];
  /** This region's boss (fought on its boss floor), scaled by depth via bossFor. */
  boss: BossDef;
}

// Re-export the editable catalog so importers use `@/engine/biomes`.
export { BIOMES, BIOME_ORDER } from '@/content/biomes';

export function getBiome(key: string): BiomeDef {
  return BIOMES[key] ?? BIOMES[BIOME_ORDER[0]];
}

/** Boss floors land every 5th descent (5, 10, 15…). */
export function isBossDepth(depth: number): boolean {
  return depth % 5 === 0;
}

/** Region index for a depth — a new biome every 5 floors. */
export function biomeForDepth(depth: number): BiomeDef {
  const region = Math.floor((depth - 1) / 5);
  return BIOMES[BIOME_ORDER[region % BIOME_ORDER.length]];
}

/** The biome's boss scaled for the run's depth + player level (mirrors enemyFor). */
export function bossFor(biome: BiomeDef, depth: number, level: number): BossDef {
  const scale = 1 + (depth - 1) * 0.1 + (level - 1) * 0.06;
  const base = biome.boss;
  const phases = (base.phases ?? []).map((p) => ({
    ...p,
    hp: Math.round(p.hp * scale),
    attack: Math.round(p.attack * scale),
  }));
  return {
    ...base,
    id: `${base.id}_d${depth}`,
    baseHp: Math.round(base.baseHp * scale),
    attack: Math.round(base.attack * scale),
    phases,
  };
}
