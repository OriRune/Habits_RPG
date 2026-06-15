import { getRelic } from '@/engine/relics';
import { Sprite } from '@/components/ui/Sprite';
import { relicCrest } from '@/lib/sprites';

/** Compact row of the relics held this run, shown in the dungeon HUD. */
export function RelicTray({ relics }: { relics: string[] }) {
  if (relics.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-gold-deep/20 pt-1.5">
      <span className="font-display text-[10px] uppercase tracking-wider text-parchment-300/80">Relics</span>
      {relics.map((key, i) => {
        const relic = getRelic(key);
        if (!relic) return null;
        return (
          <span key={`${key}:${i}`} title={`${relic.name} — ${relic.description}`}>
            <Sprite spriteKey={`relic:${key}`} look={relicCrest(relic.name, relic.tier, relic.curse)} size="xs" />
          </span>
        );
      })}
    </div>
  );
}
