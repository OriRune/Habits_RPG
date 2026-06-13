import { getStat, type StatId } from '@/engine/stats';

interface StatBarProps {
  stat: StatId;
  xp: number;
  /** Max XP across stats, used to scale the bar fill. */
  maxXp: number;
}

export function StatBar({ stat, xp, maxXp }: StatBarProps) {
  const meta = getStat(stat);
  const pct = maxXp > 0 ? Math.max(4, Math.round((xp / maxXp) * 100)) : 4;
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 shrink-0 font-display text-xs font-semibold text-ink-muted">{meta.short}</div>
      <div className="h-3.5 flex-1 overflow-hidden rounded-full border border-gold-deep/50 bg-wood-900">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(180deg, ${meta.color}, rgba(0,0,0,0.35) 220%)`,
          }}
        />
      </div>
      <div className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">{xp}</div>
    </div>
  );
}
