// Gear types + helpers (armor/trinket/tool slots, alongside the weapon slot). The editable
// gear DATA lives in src/content/gear.ts. Bonuses reach combat, dungeon stat-checks, and
// habit XP — see aggregateGear / gearXpMultiplier.
import type { StatId } from './stats';
import type { Habit } from './habits';
import { GEAR } from '@/content/gear';

export type GearSlot = 'armor' | 'trinket' | 'tool';

export interface GearDef {
  key: string;
  name: string;
  slot: GearSlot;
  /** Flat stat-point bonuses; apply in combat and dungeon stat-checks. */
  statBonuses?: Partial<Record<StatId, number>>;
  /** Armor: flat physical / magical damage mitigation. */
  defense?: number;
  ward?: number;
  /** Habit-XP perk: +pct% XP on habits matching the tag and/or stat. */
  xpBonus?: { tag?: string; stat?: StatId; pct: number };
  description: string;
  /** Shop price in gold; undefined = craft/loot only. */
  price?: number;
}

// Re-export the editable catalog so importers use `@/engine/gear`.
export { GEAR } from '@/content/gear';

export function getGear(key: string): GearDef | undefined {
  return GEAR[key];
}

export interface GearBonuses {
  statBonuses: Partial<Record<StatId, number>>;
  defense: number;
  ward: number;
  xpBonuses: NonNullable<GearDef['xpBonus']>[];
}

/** Sum the bonuses of a set of equipped gear pieces. */
export function aggregateGear(defs: (GearDef | undefined)[]): GearBonuses {
  const out: GearBonuses = { statBonuses: {}, defense: 0, ward: 0, xpBonuses: [] };
  for (const d of defs) {
    if (!d) continue;
    if (d.statBonuses) {
      for (const [stat, n] of Object.entries(d.statBonuses)) {
        out.statBonuses[stat as StatId] = (out.statBonuses[stat as StatId] ?? 0) + (n ?? 0);
      }
    }
    out.defense += d.defense ?? 0;
    out.ward += d.ward ?? 0;
    if (d.xpBonus) out.xpBonuses.push(d.xpBonus);
  }
  return out;
}

/** Multiplier applied to a habit's XP from matching gear perks (1 + Σ matching pct/100). */
export function gearXpMultiplier(defs: (GearDef | undefined)[], habit: Habit): number {
  let pct = 0;
  for (const d of defs) {
    const b = d?.xpBonus;
    if (!b) continue;
    const tagMatch = b.tag !== undefined && b.tag === habit.tag;
    const statMatch = b.stat !== undefined && b.stat === habit.stat;
    if (tagMatch || statMatch) pct += b.pct;
  }
  return 1 + pct / 100;
}
