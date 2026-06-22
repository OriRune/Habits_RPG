// Relics — run-only modifiers earned inside a dungeon (boons from floor clears, shrines, and
// elites; curses from shrine failures). They stack as you descend and apply to dungeon fights
// exactly like equipped gear (see fighterFor), then vanish when the run ends. Pure + testable;
// the editable catalog lives in src/content/relics.ts.
import type { StatId } from './stats';
import type { RNG } from './combat';
import { RELICS } from '@/content/relics';

export type RelicTier = 1 | 2 | 3;

export interface RelicEffect {
  /** Flat stat-point bonuses (negative on curses) — folded into combat like gear. */
  statBonuses?: Partial<Record<StatId, number>>;
  /** Flat physical / magical mitigation. */
  defense?: number;
  ward?: number;
  /** Flat bonus to the dungeon fighter's max HP. */
  maxHp?: number;
}

/**
 * Event-driven relic trigger — evaluated by the dungeon store at the relevant event seam.
 * At most one trigger per relic (keep it readable).
 *
 *  `onCombatWin`  — called after any won fight; heals `healPct × maxHp`.
 *  `lowHp`        — evaluated inside `fighterFor` each time a fighter is built;
 *                   the bonus is active while `hp / maxHp < threshold`.
 *  `onShrine`     — called when a shrine interaction succeeds (pray wins or offer);
 *                   the statBonuses accumulate into `DungeonRun.runBuff` (stacks).
 */
export type RelicTrigger =
  | { type: 'onCombatWin'; healPct: number }
  | { type: 'lowHp'; threshold: number; statBonuses?: Partial<Record<StatId, number>>; defense?: number }
  | { type: 'onShrine'; statBonuses: Partial<Record<StatId, number>> };

export interface RelicDef {
  key: string;
  name: string;
  description: string;
  tier: RelicTier;
  effect: RelicEffect;
  /** Curses are granted by shrine failures, never offered as a boon. */
  curse?: boolean;
  /** Optional event trigger — fires once at the relevant game event. */
  trigger?: RelicTrigger;
}

// Re-export the editable catalog so importers use `@/engine/relics`.
export { RELICS } from '@/content/relics';

export function getRelic(key: string): RelicDef | undefined {
  return RELICS[key];
}

export interface RelicBonuses {
  statBonuses: Partial<Record<StatId, number>>;
  defense: number;
  ward: number;
  maxHp: number;
}

/** Sum the effects of a set of held relics (mirrors aggregateGear). */
export function aggregateRelics(defs: (RelicDef | undefined)[]): RelicBonuses {
  const out: RelicBonuses = { statBonuses: {}, defense: 0, ward: 0, maxHp: 0 };
  for (const d of defs) {
    if (!d) continue;
    if (d.effect.statBonuses) {
      for (const [stat, n] of Object.entries(d.effect.statBonuses)) {
        out.statBonuses[stat as StatId] = (out.statBonuses[stat as StatId] ?? 0) + (n ?? 0);
      }
    }
    out.defense += d.effect.defense ?? 0;
    out.ward += d.effect.ward ?? 0;
    out.maxHp += d.effect.maxHp ?? 0;
  }
  return out;
}

/**
 * Offer `count` distinct boon choices: positive relics of tier ≤ maxTier that the player
 * doesn't already hold. Returns fewer if the pool runs dry. Deterministic via injected RNG.
 */
export function rollBoons(count: number, owned: string[], maxTier: number, rng: RNG = Math.random): string[] {
  const pool = Object.values(RELICS)
    .filter((r) => !r.curse && r.tier <= maxTier && !owned.includes(r.key))
    .map((r) => r.key);
  // Fisher–Yates partial shuffle.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** Pick a single random curse (shrine failures). */
export function rollCurse(rng: RNG = Math.random): string | undefined {
  const curses = Object.values(RELICS).filter((r) => r.curse).map((r) => r.key);
  return curses.length ? curses[Math.floor(rng() * curses.length)] : undefined;
}
