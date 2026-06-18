import { getStat, type StatId } from '@/engine/stats';
import { STAT_CAP } from '@/engine/progression';

interface StatBarProps {
  stat: StatId;
  /** The stat's current value (1–STAT_CAP), granted on level-up. */
  level: number;
  /** Lifetime XP invested in this stat — steers where future level-up points go. */
  xp: number;
  /** Optional extra context shown after the stat's base description in the hover tooltip. */
  hint?: string;
}

export function StatBar({ stat, level, xp, hint }: StatBarProps) {
  const meta = getStat(stat);
  const pct = Math.max(4, Math.round((level / STAT_CAP) * 100));
  const tooltip = hint ? `${meta.represents} — ${hint}` : meta.represents;
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 shrink-0 font-display text-xs font-semibold text-ink-muted" title={tooltip}>{meta.short}</div>
      <div className="h-3.5 flex-1 overflow-hidden rounded-full border border-gold-deep/50 bg-wood-900">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(180deg, ${meta.color}, rgba(0,0,0,0.35) 220%)`,
          }}
        />
      </div>
      <div className="w-[4.5rem] shrink-0 text-right tabular-nums text-ink" title={`${xp} XP invested`}>
        <span className="text-xs font-semibold">Lv {level}</span>
        <span className="ml-1 text-[10px] text-ink-light">{xp}xp</span>
      </div>
    </div>
  );
}
