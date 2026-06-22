import { useState } from 'react';
import { getRelic, type RelicDef } from '@/engine/relics';
import { Sprite } from '@/components/ui/Sprite';
import { Modal } from '@/components/ui/Modal';
import { relicCrest } from '@/lib/sprites';

const TIER_LABEL: Record<number, string> = { 1: 'Common', 2: 'Uncommon', 3: 'Rare' };

/** Inline detail card shown inside the modal for one relic. */
function RelicDetail({ relic }: { relic: RelicDef }) {
  const isCurse = relic.curse === true;
  return (
    <div className="flex items-start gap-3">
      <Sprite
        spriteKey={`relic:${relic.key}`}
        look={relicCrest(relic.name, relic.tier, isCurse)}
        size="md"
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-bold text-ink">{relic.name}</span>
          <span
            className={`rounded px-1.5 py-0.5 font-display text-[10px] uppercase tracking-wider ${
              isCurse
                ? 'bg-ember/20 text-ember'
                : relic.tier === 3
                  ? 'bg-gold/20 text-gold-deep'
                  : relic.tier === 2
                    ? 'bg-stat-KN/20 text-stat-KN'
                    : 'bg-parchment-300/40 text-ink-muted'
            }`}
          >
            {isCurse ? 'Curse' : TIER_LABEL[relic.tier]}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-ink-muted">{relic.description}</p>
      </div>
    </div>
  );
}

/** Compact row of the relics held this run, shown in the dungeon HUD.
 *  Tapping any relic opens a modal listing all held relics with full detail. */
export function RelicTray({ relics }: { relics: string[] }) {
  const [open, setOpen] = useState(false);
  if (relics.length === 0) return null;

  const defs = relics.map((k) => getRelic(k)).filter(Boolean) as RelicDef[];

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-gold-deep/20 pt-1.5">
        <span className="font-display text-[10px] uppercase tracking-wider text-parchment-300/80">Relics</span>
        {defs.map((relic, i) => (
          <button
            key={`${relic.key}:${i}`}
            onClick={() => setOpen(true)}
            title={`${relic.name} — tap to see all relics`}
            className="rounded focus-visible:ring-1 focus-visible:ring-gold-deep"
          >
            <Sprite spriteKey={`relic:${relic.key}`} look={relicCrest(relic.name, relic.tier, relic.curse)} size="sm" />
          </button>
        ))}
      </div>

      {open && (
        <Modal title={`Relics (${defs.length})`} onClose={() => setOpen(false)}>
          <div className="space-y-4">
            {defs.map((relic) => (
              <RelicDetail key={relic.key} relic={relic} />
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
