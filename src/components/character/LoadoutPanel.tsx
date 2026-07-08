import { useState } from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { COMBAT_STAT_META, combatLevel, mitigation } from '@/engine/combatStats';
import { Panel } from '@/components/ui/Panel';
import { SectionTitle } from '@/components/ui/Divider';
import { GrimoireView } from '@/views/GrimoireView';
import { PaperDoll } from './PaperDoll';

function CombatStatBar({ label, xp, color }: { label: string; xp: number; color: string }) {
  const lvl = combatLevel(xp);
  // Progress toward the next level (statPoints is floor(sqrt(xp))).
  const cur = lvl * lvl;
  const next = (lvl + 1) * (lvl + 1);
  const pct = Math.max(6, Math.round(((xp - cur) / (next - cur)) * 100));
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 shrink-0 font-display text-xs font-semibold text-ink-muted">{label}</div>
      {/* Recessed parchment track (matches StatBar) — dark tracks jar on parchment. */}
      <div className="h-3 flex-1 overflow-hidden rounded-full border border-gold-deep/40 bg-parchment-400/70 shadow-[inset_0_1px_3px_rgba(90,64,30,0.35)]">
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
  const knownSpells = useGameStore((s) => s.knownSpells);
  const combatStats = useGameStore((s) => s.combatStats);
  const [grimoireOpen, setGrimoireOpen] = useState(false);

  return (
    <Panel tone="parchment" className="space-y-4 p-4">
      <SectionTitle>Loadout</SectionTitle>

      <PaperDoll />

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
