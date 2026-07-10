// One aggregated bonus line for the dungeon run HUD (plan 4.4 / DUN-19): the net
// stat totals across every held relic (curses subtract), plus one short chip per
// triggered relic so an empty-effect relic never renders as an empty token. The
// full per-relic breakdown, trigger descriptions, and ×N stacks live in the
// RelicTray modal.
import { getRelic, type RelicDef, type RelicEffect, type RelicTrigger } from '@/engine/relics';
import { getStat, type StatId } from '@/engine/stats';

/** Format an effect into short signed tokens: "+3 STR", "DEF +4", "+15 HP". */
function effectTokens(effect: RelicEffect): { label: string; color: string }[] {
  const tokens: { label: string; color: string }[] = [];

  for (const [stat, n] of Object.entries(effect.statBonuses ?? {})) {
    if (!n) continue;
    const meta = getStat(stat as StatId);
    tokens.push({
      label: `${n > 0 ? '+' : ''}${n} ${meta.short}`,
      color: meta.color,
    });
  }
  if (effect.defense) {
    tokens.push({ label: `DEF ${effect.defense > 0 ? '+' : ''}${effect.defense}`, color: '#7a8590' });
  }
  if (effect.ward) {
    tokens.push({ label: `WARD ${effect.ward > 0 ? '+' : ''}${effect.ward}`, color: '#a78bfa' });
  }
  if (effect.maxHp) {
    tokens.push({ label: `${effect.maxHp > 0 ? '+' : ''}${effect.maxHp} HP`, color: '#10b981' });
  }
  return tokens;
}

/** Net static effect across all held relics — duplicates and curses included. */
function aggregateEffect(defs: RelicDef[]): RelicEffect {
  const statBonuses: Partial<Record<StatId, number>> = {};
  let defense = 0;
  let ward = 0;
  let maxHp = 0;
  for (const relic of defs) {
    for (const [stat, n] of Object.entries(relic.effect.statBonuses ?? {})) {
      statBonuses[stat as StatId] = (statBonuses[stat as StatId] ?? 0) + (n ?? 0);
    }
    defense += relic.effect.defense ?? 0;
    ward += relic.effect.ward ?? 0;
    maxHp += relic.effect.maxHp ?? 0;
  }
  return { statBonuses, defense, ward, maxHp };
}

/** A short chip per trigger, e.g. "+12% HP after wins" — never an empty token. */
function triggerChip(trigger: RelicTrigger): string {
  if (trigger.type === 'onCombatWin') {
    return `+${Math.round(trigger.healPct * 100)}% HP after wins`;
  }
  if (trigger.type === 'lowHp') {
    const parts: string[] = [];
    if (trigger.defense) parts.push(`+${trigger.defense} DEF`);
    for (const [stat, n] of Object.entries(trigger.statBonuses ?? {})) {
      if (n) parts.push(`+${n} ${getStat(stat as StatId).short}`);
    }
    return `${parts.join(' ')} below ${Math.round(trigger.threshold * 100)}% HP`;
  }
  const gains = Object.entries(trigger.statBonuses)
    .filter(([, n]) => n)
    .map(([stat, n]) => `+${n} ${getStat(stat as StatId).short}`);
  return `${gains.join(' ')} per shrine`;
}

export function RunBuffs({ relics }: { relics: string[] }) {
  if (relics.length === 0) return null;

  const defs = relics.map((key) => getRelic(key)).filter(Boolean) as RelicDef[];
  const tokens = effectTokens(aggregateEffect(defs));
  const chips = defs.filter((r) => r.trigger).map((r) => triggerChip(r.trigger!));
  const curseCount = defs.filter((r) => r.curse).length;
  if (tokens.length === 0 && chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-gold-deep/20 pt-1.5 text-[11px]">
      <span className="font-display text-[10px] uppercase tracking-wider text-on-wood-mid">
        Run total
      </span>
      {tokens.map((t, i) => (
        <span key={i} className="font-display tabular-nums" style={{ color: t.color }}>
          {t.label}
        </span>
      ))}
      {chips.map((chip, i) => (
        <span
          key={`t-${i}`}
          className="rounded border border-gold-deep/40 bg-wood-900/60 px-1 py-px text-[10px] text-on-wood-hi"
        >
          {chip}
        </span>
      ))}
      {curseCount > 0 && (
        <span className="text-[10px] text-ember">
          incl. {curseCount} curse{curseCount > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
