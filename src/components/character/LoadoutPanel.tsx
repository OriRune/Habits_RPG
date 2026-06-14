import { Sword, Sparkles } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { getWeapon } from '@/engine/weapons';
import { getSpell, SCHOOL_STAT, type SpellSchool } from '@/engine/spells';
import { getStat } from '@/engine/stats';
import { COMBAT_STAT_META, combatLevel, mitigation } from '@/engine/combatStats';
import { Panel } from '@/components/ui/Panel';
import { SectionTitle } from '@/components/ui/Divider';

const SCHOOL_LABEL: Record<SpellSchool, string> = {
  damage: 'Damage',
  support: 'Support',
  illusion: 'Illusion',
};

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
  const weapon = getWeapon(equippedWeapon);

  return (
    <Panel tone="parchment" className="space-y-4 p-4">
      <SectionTitle>Loadout</SectionTitle>

      <div className="flex items-center gap-2 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
        <Sword className="h-5 w-5 text-ink-muted" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink">{weapon.name}</div>
          <div className="text-xs text-ink-muted">
            Attack scales with {weapon.attackStat === 'DX' ? 'Dexterity' : 'Strength'} · +{weapon.bonus}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="font-display text-[11px] uppercase tracking-wider text-ink-muted">Combat Stats (trained in dungeons)</div>
        <CombatStatBar label={COMBAT_STAT_META.defense.name} xp={combatStats.defenseXp} color={COMBAT_STAT_META.defense.color} />
        <CombatStatBar label={COMBAT_STAT_META.ward.name} xp={combatStats.wardXp} color={COMBAT_STAT_META.ward.color} />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 font-display text-[11px] uppercase tracking-wider text-ink-muted">
          <Sparkles className="h-3.5 w-3.5" /> Grimoire
        </div>
        <div className="flex flex-wrap gap-2">
          {knownSpells.map((key) => {
            const spell = getSpell(key);
            if (!spell) return null;
            const color = getStat(SCHOOL_STAT[spell.school]).color;
            return (
              <span
                key={key}
                className="rounded-md border px-2 py-1 text-xs"
                style={{ borderColor: `${color}80`, color }}
                title={`${SCHOOL_LABEL[spell.school]} · ${spell.mpCost} MP`}
              >
                {spell.name}
              </span>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
