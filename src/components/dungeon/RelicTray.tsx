import { useState } from 'react';
import { getRelic, type RelicDef } from '@/engine/relics';
import { Sprite } from '@/components/ui/Sprite';
import { Modal } from '@/components/ui/Modal';
import { relicCrest } from '@/lib/sprites';

const TIER_LABEL: Record<number, string> = { 1: 'Common', 2: 'Uncommon', 3: 'Rare' };

/** Inline detail card shown inside the modal for one relic (stacked duplicates show ×N). */
function RelicDetail({ relic, count = 1 }: { relic: RelicDef; count?: number }) {
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
          <span className="font-display text-sm font-bold text-ink">
            {relic.name}
            {count > 1 ? <span className="ml-1 text-ink-muted">×{count}</span> : null}
          </span>
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

/** How many relic icons the tray shows before collapsing into "+N" (plan 4.4 / DUN-19). */
export const RELIC_TRAY_MAX = 8;

/** Compact row of the relics held this run, shown in the dungeon HUD. Caps at
 *  RELIC_TRAY_MAX icons + a "+N" chip so a long run can't crowd out the HUD.
 *  Tapping any relic (or the chip) opens a modal listing all relics with full detail. */
export function RelicTray({ relics }: { relics: string[] }) {
  const [open, setOpen] = useState(false);
  if (relics.length === 0) return null;

  const defs = relics.map((k) => getRelic(k)).filter(Boolean) as RelicDef[];
  const visible = defs.slice(0, RELIC_TRAY_MAX);
  const overflow = defs.length - visible.length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-gold-deep/20 pt-1.5">
        <span className="font-display text-[10px] uppercase tracking-wider text-parchment-300/80">Relics</span>
        {visible.map((relic, i) => (
          <button
            key={`${relic.key}:${i}`}
            onClick={() => setOpen(true)}
            title={`${relic.name} — tap to see all relics`}
            className="rounded focus-visible:ring-1 focus-visible:ring-gold-deep"
          >
            <Sprite spriteKey={`relic:${relic.key}`} look={relicCrest(relic.name, relic.tier, relic.curse)} size="sm" />
          </button>
        ))}
        {overflow > 0 && (
          <button
            onClick={() => setOpen(true)}
            aria-label={`${overflow} more relic${overflow > 1 ? 's' : ''} — see all`}
            className="rounded-md border border-gold-deep/40 px-1.5 py-0.5 font-display text-[11px] font-bold text-gold-bright focus-visible:ring-1 focus-visible:ring-gold-deep"
          >
            +{overflow}
          </button>
        )}
      </div>

      {open && (
        <Modal title={`Relics (${defs.length})`} onClose={() => setOpen(false)}>
          <div className="space-y-4">
            {/* Curses stack by design — collapse duplicates into one ×N row (also keeps keys unique). */}
            {[...new Map(defs.map((r) => [r.key, r])).values()].map((relic) => (
              <RelicDetail
                key={relic.key}
                relic={relic}
                count={defs.filter((d) => d.key === relic.key).length}
              />
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
