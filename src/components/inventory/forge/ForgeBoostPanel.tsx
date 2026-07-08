// Pre-run Fuel & Flux panel (§6) + the metal's temperament card — everything the smith
// reviews before lighting the fire. Extracted from ForgeMinigame so the orchestrator
// stays lean; all state lives in the parent.
import { TEMPERAMENTS, type ForgeTemperamentId } from '@/engine/crafting/forge';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';

/** One Fuel & Flux slot: toggle button, disabled + dimmed when the player can't pay. */
function BoostSlot({
  label,
  desc,
  count,
  need,
  selected,
  onToggle,
}: {
  label: string;
  desc: string;
  count: number;
  need: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const affordable = count >= need;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!affordable}
      aria-pressed={selected}
      className={
        'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left ' +
        (selected
          ? 'border-gold-bright bg-gold-bright/20'
          : 'border-gold-deep/30 bg-parchment-100/60') +
        (affordable ? '' : ' cursor-not-allowed opacity-40')
      }
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="text-[11px] text-ink-muted">{desc}</div>
      </div>
      <span className={'shrink-0 text-[11px] ' + (affordable ? 'text-ink-muted' : 'text-ember')}>
        have {count}/{need}
      </span>
    </button>
  );
}

/** Temperament glyphs — flavour only; the label + blurb carry the information. */
const TEMPERAMENT_GLYPH: Record<ForgeTemperamentId, string> = {
  stubborn: '🧱',
  fickle: '💎',
  supple: '🪢',
};

export function ForgeBoostPanel({
  temperament,
  woodHave,
  stoneHave,
  gemHave,
  fuel,
  flux,
  onFuel,
  onFlux,
  onStart,
}: {
  temperament: ForgeTemperamentId;
  woodHave: number;
  stoneHave: number;
  gemHave: number;
  fuel: 'wood' | 'stone' | null;
  flux: boolean;
  onFuel: (fuel: 'wood' | 'stone') => void;
  onFlux: () => void;
  onStart: () => void;
}) {
  const t = TEMPERAMENTS[temperament];
  return (
    <Panel tone="parchment" className="p-5">
      {/* The metal's personality — how THIS recipe will play (§ temperaments). */}
      <div className="mb-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 px-3 py-2">
        <div className="text-sm font-semibold text-ink">
          {TEMPERAMENT_GLYPH[temperament]} {t.label} material
        </div>
        <div className="text-[11px] text-ink-muted">{t.blurb}</div>
      </div>

      <div className="mb-3 text-center">
        <div className="font-display text-sm font-bold text-ink">Fuel &amp; Flux</div>
        <p className="text-[11px] text-ink-muted">
          Optional — spend spare materials to make the forge more forgiving. Consumed only if
          you finish the piece.
        </p>
      </div>
      <div className="space-y-2">
        {/* One fuel max (mutually exclusive), one flux max. */}
        <BoostSlot
          label="Seasoned Wood"
          desc="2× Wood → slower heat decay"
          count={woodHave}
          need={2}
          selected={fuel === 'wood'}
          onToggle={() => onFuel('wood')}
        />
        <BoostSlot
          label="Firebrick"
          desc="2× Stone → less re-stoke fatigue"
          count={stoneHave}
          need={2}
          selected={fuel === 'stone'}
          onToggle={() => onFuel('stone')}
        />
        <BoostSlot
          label="Gemstone Flux"
          desc="1× Gemstone → both zones ×1.25 wider"
          count={gemHave}
          need={1}
          selected={flux}
          onToggle={onFlux}
        />
      </div>
      <Button onClick={onStart} className="mt-4 w-full py-3">
        {fuel || flux ? 'Continue' : 'Just forge'}
      </Button>
    </Panel>
  );
}
