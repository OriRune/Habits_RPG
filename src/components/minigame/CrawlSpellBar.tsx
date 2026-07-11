// Shared spell ability bar for the crawl minigames (Mine & Forest).
// Prop-heavy by design — the two overlays diverge in several real ways (ARCH-15),
// each preserved as a prop rather than unified away:
//   - hideWhenInactive: mine hides the whole bar off 'active'; forest keeps it up
//     and only disables the buttons.
//   - accent: mine blue (transition-colors) vs forest violet (transition-opacity,
//     with an extra opacity-60 on disabled).
//   - tooltip: mine "name — description"; forest "name (n MP) — key [i]".
//   - layout: mine 2-line (name / [i] mp); forest 3-line ([i] / name / mp).
//   - maxWidth: a CSS length — both overlays pass their computed HUD-column cap so
//     the bar tracks the board's rendered width (sizing plan Phase 1).

import { getSpell, type SpellDef } from '@/engine/spells';
import { cn } from '@/lib/cn';

const ACCENT = {
  blue: {
    transition: 'transition-colors',
    textSize: 'text-[11px]',
    gap: 'gap-0.5',
    canCast: 'border-blue-400/50 bg-blue-900/40 text-blue-300 hover:bg-blue-800/50',
    disabled: 'border-parchment-300/20 bg-wood-900/40 text-parchment-300/40',
    mp: 'text-blue-300/70',
    idx: 'text-parchment-300/50',
  },
  violet: {
    transition: 'transition-opacity',
    textSize: 'text-[10px]',
    gap: '',
    canCast: 'border-violet-500/60 bg-violet-900/30 text-violet-200 hover:bg-violet-800/40',
    disabled: 'border-wood-700 bg-wood-900/50 text-parchment-300/40 opacity-60',
    mp: 'text-violet-400',
    idx: 'text-parchment-300/50',
  },
} as const;

export function CrawlSpellBar({
  knownSpells,
  mp,
  status,
  onCast,
  accent,
  hideWhenInactive,
  tooltip,
  layout,
  maxWidth,
}: {
  knownSpells: string[];
  mp: number;
  status: string;
  onCast: (key: string) => void;
  accent: 'blue' | 'violet';
  hideWhenInactive: boolean;
  tooltip: (spell: SpellDef, i: number) => string;
  layout: 'two-line' | 'three-line';
  maxWidth: string;
}) {
  if (knownSpells.length === 0) return null;
  if (hideWhenInactive && status !== 'active') return null;
  const a = ACCENT[accent];
  return (
    <div className="flex w-full items-center gap-2" style={{ maxWidth }}>
      <span className="font-display text-[10px] uppercase tracking-wider text-parchment-300/60">Spells</span>
      {knownSpells.slice(0, 4).map((key, i) => {
        const spell = getSpell(key);
        if (!spell) return null;
        const canCast = mp >= spell.mpCost;
        return (
          <button
            key={key}
            onClick={() => onCast(key)}
            title={tooltip(spell, i)}
            disabled={!canCast || status !== 'active'}
            className={cn(
              'flex flex-col items-center rounded border px-2 py-1 font-display',
              a.gap, a.textSize, a.transition,
              canCast ? a.canCast : a.disabled,
            )}
          >
            {layout === 'two-line' ? (
              <>
                <span className="text-[13px]">{spell.name}</span>
                <span className={cn('text-[10px]', a.mp)}>[{i + 1}] {spell.mpCost}mp</span>
              </>
            ) : (
              <>
                <span className={cn('text-[9px]', a.idx)}>[{i + 1}]</span>
                <span className="truncate max-w-[60px]">{spell.name}</span>
                <span className={cn('text-[9px]', a.mp)}>{spell.mpCost}mp</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
