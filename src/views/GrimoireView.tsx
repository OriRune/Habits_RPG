import { ChevronLeft, Sparkles } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { getSpell, SCHOOL_STAT, type SpellDef, type SpellSchool } from '@/engine/spells';
import { getStat } from '@/engine/stats';
import { Sprite } from '@/components/ui/Sprite';
import { spellCrest } from '@/lib/sprites';

const SCHOOL_ORDER: SpellSchool[] = ['damage', 'support', 'illusion'];
const SCHOOL_LABEL: Record<SpellSchool, string> = {
  damage: 'Offensive',
  support: 'Support',
  illusion: 'Illusion',
};

/** Plain-language summary of a spell's status effect. */
function statusLine(s: NonNullable<SpellDef['status']>): string {
  switch (s.key) {
    case 'burn':
      return `Burn — ${s.magnitude} damage per turn for ${s.turns} turns`;
    case 'blind':
      return `Blind — the foe may miss its attacks for ${s.turns} turns`;
    case 'weaken':
      return `Weaken — foe's attack reduced ${Math.round(s.magnitude * 100)}% for ${s.turns} turns`;
    case 'bless':
      return `Bless — incoming damage reduced by ${s.magnitude} for ${s.turns} turns`;
  }
}

function effectLine(spell: SpellDef): string | null {
  if (spell.school === 'damage' && spell.power > 0) return `Magic damage (base ${spell.power})`;
  if (spell.school === 'support' && spell.power > 0) return `Restores ${spell.power} HP`;
  return null;
}

function SpellEntry({ spell }: { spell: SpellDef }) {
  const stat = getStat(SCHOOL_STAT[spell.school]);
  const effect = effectLine(spell);
  return (
    <div className="flex gap-3 rounded-md border border-gold-deep/25 bg-parchment-100/50 p-3">
      <Sprite spriteKey={`spell:${spell.key}`} look={spellCrest(spell.name, spell.school)} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display text-sm font-bold text-ink">{spell.name}</span>
          <span
            className="shrink-0 rounded border border-stat-AG/50 bg-stat-AG/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-stat-AG"
            title="Mana cost"
          >
            {spell.mpCost} MP
          </span>
        </div>
        <div className="mt-0.5 text-[11px] uppercase tracking-wider text-ink-light">
          Scales with {stat.name}
        </div>
        <p className="mt-1 text-xs text-ink-muted">{spell.description}</p>
        {effect && <div className="mt-1 text-xs font-medium text-ink">{effect}</div>}
        {spell.status && (
          <div className="mt-0.5 text-xs italic text-gold-deep">{statusLine(spell.status)}</div>
        )}
      </div>
    </div>
  );
}

/** Full-screen "aged parchment scroll" of the character's known spells, grouped by school. */
export function GrimoireView({ onClose }: { onClose: () => void }) {
  const knownSpells = useGameStore((s) => s.knownSpells);
  const spells = knownSpells.map(getSpell).filter((s): s is SpellDef => s !== undefined);

  return (
    <div className="texture-wood fixed inset-0 z-50 overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-gold-deep bg-wood-800/95 px-4 py-3 backdrop-blur">
        <button onClick={onClose} className="text-parchment-200 hover:text-gold-bright" aria-label="Back">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="flex items-center gap-2 font-display text-lg font-bold text-gold-bright">
          <Sparkles className="h-5 w-5" /> Grimoire
        </h1>
        <span className="ml-auto font-display text-xs text-parchment-300">
          {spells.length} {spells.length === 1 ? 'spell' : 'spells'} known
        </span>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* A scroll that grows as spells are learned: a rod, the parchment, a rod. */}
        <div className="mx-1 h-3.5 rounded-full bg-gradient-to-b from-wood-600 to-wood-900 shadow-wood" />
        <div className="texture-parchment space-y-6 border-x-2 border-gold-deep/40 px-5 py-7 shadow-gold">
          {SCHOOL_ORDER.map((school) => {
            const group = spells
              .filter((s) => s.school === school)
              .sort((a, b) => a.mpCost - b.mpCost);
            if (group.length === 0) return null;
            const stat = getStat(SCHOOL_STAT[school]);
            return (
              <section key={school} className="space-y-2">
                <div className="flex items-center gap-2 border-b border-gold-deep/30 pb-1">
                  <span className="font-display text-sm font-bold uppercase tracking-wider text-gold-deep">
                    {SCHOOL_LABEL[school]}
                  </span>
                  <span className="text-[11px] text-ink-light">· {stat.name}</span>
                </div>
                <div className="space-y-2">
                  {group.map((spell) => (
                    <SpellEntry key={spell.key} spell={spell} />
                  ))}
                </div>
              </section>
            );
          })}
          {spells.length === 0 && (
            <p className="py-6 text-center text-sm italic text-ink-muted">
              The pages are blank. Learn spells from spellbooks found in dungeons and the shop.
            </p>
          )}
        </div>
        <div className="mx-1 h-3.5 rounded-full bg-gradient-to-b from-wood-600 to-wood-900 shadow-wood" />
      </div>
    </div>
  );
}
