import { useGameStore } from '@/store/useGameStore';
import { getRelic } from '@/engine/relics';
import { Modal } from '@/components/ui/Modal';
import { Sprite } from '@/components/ui/Sprite';
import { relicCrest } from '@/lib/sprites';

/** Forced 1-of-3 boon pick, shown when a floor clear / shrine / elite offers relics. */
export function BoonChoice() {
  const pending = useGameStore((s) => s.dungeon?.pendingBoon ?? null);
  const chooseBoon = useGameStore((s) => s.chooseBoon);
  if (!pending || pending.length === 0) return null;

  return (
    <Modal title="Choose a Boon" dismissable={false}>
      <p className="mb-3 text-sm text-ink-muted">
        A power lingers here — claim one to carry for the rest of this run.
      </p>
      <div className="space-y-2">
        {pending.map((key) => {
          const relic = getRelic(key);
          if (!relic) return null;
          return (
            <button
              key={key}
              onClick={() => chooseBoon(key)}
              className="flex w-full items-center gap-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3 text-left transition-colors hover:border-gold-deep/70 hover:bg-parchment-300/50"
            >
              <Sprite spriteKey={`relic:${key}`} look={relicCrest(relic.name, relic.tier)} size="md" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-display text-sm font-bold text-ink">{relic.name}</span>
                  <span className="rounded-sm border border-gold-deep/40 px-1 text-[10px] uppercase tracking-wider text-gold-deep">
                    Tier {relic.tier}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">{relic.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
