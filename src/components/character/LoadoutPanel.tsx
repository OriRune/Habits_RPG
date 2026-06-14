import { useState } from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { getWeapon } from '@/engine/weapons';
import { getGear, aggregateGear, type GearSlot } from '@/engine/gear';
import { getStat, type StatId } from '@/engine/stats';
import { COMBAT_STAT_META, combatLevel, mitigation } from '@/engine/combatStats';
import { Panel } from '@/components/ui/Panel';
import { Sprite } from '@/components/ui/Sprite';
import { weaponCrest, gearCrest } from '@/lib/sprites';
import { SectionTitle } from '@/components/ui/Divider';
import { GrimoireView } from '@/views/GrimoireView';

function CombatStatBar({ label, xp, color }: { label: string; xp: number; color: string }) {
  const lvl = combatLevel(xp);
  // Progress toward the next level (statPoints is floor(sqrt(xp))).
  const cur = lvl * lvl;
  const next = (lvl + 1) * (lvl + 1);
  const pct = Math.max(6, Math.round(((xp - cur) / (next - cur)) * 100));
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 shrink-0 font-display text-xs font-semibold text-ink-muted">{label}</div>
      <div className="h-3 flex-1 overflow-hidden rounded-full border border-gold-deep/50 bg-wood-900">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="w-14 shrink-0 text-right text-xs text-ink">
        Lv {lvl} <span className="text-ink-light">(-{mitigation(xp)})</span>
      </div>
    </div>
  );
}

/** Equipped weapon, combat-trained stats, and known spells. */
export function LoadoutPanel() {
  const equippedWeapon = useGameStore((s) => s.equippedWeapon);
  const knownSpells = useGameStore((s) => s.knownSpells);
  const combatStats = useGameStore((s) => s.combatStats);
  const equipment = useGameStore((s) => s.equipment);
  const weapon = getWeapon(equippedWeapon);
  const [grimoireOpen, setGrimoireOpen] = useState(false);

  const slots: GearSlot[] = ['armor', 'trinket', 'tool'];
  const agg = aggregateGear(slots.map((sl) => (equipment[sl] ? getGear(equipment[sl]!) : undefined)));
  const bonusParts: string[] = [];
  for (const [s, n] of Object.entries(agg.statBonuses)) bonusParts.push(`+${n} ${getStat(s as StatId).short}`);
  if (agg.defense) bonusParts.push(`+${agg.defense} Def`);
  if (agg.ward) bonusParts.push(`+${agg.ward} Ward`);
  for (const xb of agg.xpBonuses) bonusParts.push(`+${xb.pct}% ${xb.tag ?? (xb.stat ? getStat(xb.stat).short : '')} XP`);

  return (
    <Panel tone="parchment" className="space-y-4 p-4">
      <SectionTitle>Loadout</SectionTitle>

      <div className="flex items-center gap-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
        <Sprite spriteKey={`weapon:${equippedWeapon}`} look={weaponCrest(weapon.name, weapon.attackStat)} size="sm" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink">{weapon.name}</div>
          <div className="text-xs text-ink-muted">
            Attack scales with {weapon.attackStat === 'DX' ? 'Dexterity' : 'Strength'} · +{weapon.bonus}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="font-display text-[11px] uppercase tracking-wider text-ink-muted">Equipment</div>
        {slots.map((sl) => {
          const def = equipment[sl] ? getGear(equipment[sl]!) : undefined;
          return (
            <div key={sl} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                {def ? (
                  <Sprite spriteKey={`gear:${equipment[sl]}`} look={gearCrest(def.name, def.slot)} size="xs" />
                ) : (
                  <span className="h-6 w-6 shrink-0 rounded-md border border-dashed border-ink-light/40" />
                )}
                <span className="capitalize text-ink-muted">{sl}</span>
              </span>
              <span className={def ? 'text-ink' : 'text-ink-light'}>{def?.name ?? '—'}</span>
            </div>
          );
        })}
        {bonusParts.length > 0 && (
          <div className="rounded bg-parchment-300/50 px-2 py-1 text-[11px] text-ink">
            Bonuses: {bonusParts.join(' · ')}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="font-display text-[11px] uppercase tracking-wider text-ink-muted">Combat Stats (trained in dungeons)</div>
        <CombatStatBar label={COMBAT_STAT_META.defense.name} xp={combatStats.defenseXp} color={COMBAT_STAT_META.defense.color} />
        <CombatStatBar label={COMBAT_STAT_META.ward.name} xp={combatStats.wardXp} color={COMBAT_STAT_META.ward.color} />
      </div>

      <button
        onClick={() => setGrimoireOpen(true)}
        className="flex w-full items-center gap-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3 text-left transition-colors hover:border-gold-deep/60 hover:bg-parchment-300/50"
      >
        <Sparkles className="h-5 w-5 shrink-0 text-gold-deep" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink">Grimoire</div>
          <div className="text-xs text-ink-muted">
            {knownSpells.length} {knownSpells.length === 1 ? 'spell' : 'spells'} known — open your spellbook
          </div>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-ink-light" />
      </button>

      {grimoireOpen && <GrimoireView onClose={() => setGrimoireOpen(false)} />}
    </Panel>
  );
}
