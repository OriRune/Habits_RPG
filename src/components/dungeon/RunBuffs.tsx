// Persistent buff/curse readout for the dungeon run HUD. Lists each held relic with its
// exact stat effect, grouped into Blessings (positive) and Curses (negative). Mirrors
// RelicTray's compact styling — slots in directly below the relic icons.
import { getRelic, type RelicEffect } from '@/engine/relics';
import { getStat, type StatId } from '@/engine/stats';
import { Sprite } from '@/components/ui/Sprite';
import { relicCrest } from '@/lib/sprites';

/** Format a relic effect into short signed tokens: "+3 STR", "DEF +4", "+15 HP". */
function effectTokens(effect: RelicEffect): { label: string; color: string }[] {
  const tokens: { label: string; color: string }[] = [];

  for (const [stat, n] of Object.entries(effect.statBonuses ?? {})) {
    if (!n) continue;
    const meta = getStat(stat as StatId);
    tokens.push({
      label: `${n > 0 ? '+' : ''}${n} ${meta.short}`,
      color: meta.color,
    });
  }
  if (effect.defense) {
    tokens.push({ label: `DEF ${effect.defense > 0 ? '+' : ''}${effect.defense}`, color: '#7a8590' });
  }
  if (effect.ward) {
    tokens.push({ label: `WARD ${effect.ward > 0 ? '+' : ''}${effect.ward}`, color: '#a78bfa' });
  }
  if (effect.maxHp) {
    tokens.push({ label: `${effect.maxHp > 0 ? '+' : ''}${effect.maxHp} HP`, color: '#10b981' });
  }
  return tokens;
}

export function RunBuffs({ relics }: { relics: string[] }) {
  if (relics.length === 0) return null;

  const defs = relics.map((key) => getRelic(key)).filter(Boolean) as NonNullable<ReturnType<typeof getRelic>>[];
  const blessings = defs.filter((r) => !r.curse);
  const curses = defs.filter((r) => r.curse);
  if (blessings.length === 0 && curses.length === 0) return null;

  return (
    <div className="space-y-1.5 border-t border-gold-deep/20 pt-1.5 text-[11px]">
      {blessings.length > 0 && (
        <RelicGroup label="Blessings" defs={blessings} />
      )}
      {curses.length > 0 && (
        <RelicGroup label="Curses" defs={curses} />
      )}
    </div>
  );
}

function RelicGroup({
  label,
  defs,
}: {
  label: string;
  defs: NonNullable<ReturnType<typeof getRelic>>[];
}) {
  return (
    <div>
      <div className="mb-0.5 font-display uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="space-y-0.5">
        {defs.map((relic, i) => {
          const tokens = effectTokens(relic.effect);
          return (
            <div key={`${relic.key}:${i}`} className="flex items-center gap-1.5">
              <Sprite
                spriteKey={`relic:${relic.key}`}
                look={relicCrest(relic.name, relic.tier, relic.curse)}
                size="sm"
              />
              <span className="flex-1 text-ink-muted">{relic.name}</span>
              <span className="flex items-center gap-1">
                {tokens.map((t, j) => (
                  <span
                    key={j}
                    className="font-display tabular-nums"
                    style={{ color: t.color }}
                  >
                    {t.label}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
