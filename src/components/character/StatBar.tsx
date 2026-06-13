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
      <div className="w-10 shrink-0 text-xs font-semibold text-gray-400">{meta.short}</div>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-800">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: meta.color }}
        />
      </div>
      <div className="w-12 shrink-0 text-right text-xs tabular-nums text-gray-300">{xp}</div>
    </div>
  );
}
