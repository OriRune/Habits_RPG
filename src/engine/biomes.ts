// Dungeon biomes (regions). A biome themes the enemy pool, encounter set, boss, and
// scene tint. As you descend, the biome changes every 5 floors and the 5th floor of
// each region is its multi-phase boss. Editable DATA lives in src/content/biomes.ts.
import type { BossDef } from './bosses';
import { BIOMES, BIOME_ORDER, CYCLE_MUTATORS, type BiomeMutator } from '@/content/biomes';

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
export { BIOMES, BIOME_ORDER, CYCLE_MUTATORS, type BiomeMutator } from '@/content/biomes';

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

/**
 * The cycle mutator in force at a depth (plan 3.4 / DUN-15), or null on the first pass.
 * A full cycle is every biome once (BIOME_ORDER.length × 5 floors); cycle N (1-based)
 * applies CYCLE_MUTATORS[N-1], clamped to the last mutator for very deep runs.
 */
export function cycleMutator(depth: number): BiomeMutator | null {
  const cycleLen = BIOME_ORDER.length * 5;
  const cycle = Math.floor((depth - 1) / cycleLen);
  if (cycle <= 0) return null;
  return CYCLE_MUTATORS[Math.min(cycle, CYCLE_MUTATORS.length) - 1];
}

/** The biome's boss scaled for the run's depth + player level (mirrors enemyFor). */
export function bossFor(biome: BiomeDef, depth: number, level: number): BossDef {
  const mutator = cycleMutator(depth);
  const scale = 1 + (depth - 1) * 0.1 + (level - 1) * 0.06;
  const hpScale = scale * (mutator?.enemyHp ?? 1);
  const atkScale = scale * (mutator?.enemyAttack ?? 1);
  const base = biome.boss;
  const phases = (base.phases ?? []).map((p) => ({
    ...p,
    hp: Math.round(p.hp * hpScale),
    attack: Math.round(p.attack * atkScale),
  }));
  return {
    ...base,
    id: `${base.id}_d${depth}`,
    baseHp: Math.round(base.baseHp * hpScale),
    attack: Math.round(base.attack * atkScale),
    phases,
  };
}
