// Account-level summary for the Chronicle — consistency score, 12-week trend.
import { type Habit } from '@/engine/habits';
import { consistencyScore } from '@/engine/tracking';
import { effectiveStatus } from '@/engine/habits';
import { toISODate } from '@/engine/date';
import { useGameStore } from '@/store/useGameStore';
import { selectConsistencyTrend } from '@/store/selectors';
import { Panel } from '@/components/ui/Panel';
import { SectionTitle } from '@/components/ui/Divider';

function TrendBar({ pct, weekStart }: { pct: number; weekStart: string }) {
  return (
    <div
      className="flex-1 rounded-t-sm bg-gradient-to-t from-gold-deep to-gold-bright"
      style={{ height: `${Math.max(pct > 0 ? 4 : 0, pct)}%` }}
      title={`${weekStart.slice(5)}: ${pct}%`}
    />
  );
}

export function AccountSummary({ habits }: { habits: Habit[] }) {
  const today = toISODate();
  const activeCount = habits.filter((h) => effectiveStatus(h, today) === 'active').length;
  const score = consistencyScore(habits, today);
  const trend = useGameStore(selectConsistencyTrend);

  return (
    <Panel tone="parchment" className="p-4">
      <SectionTitle className="mb-3">Your Chronicle</SectionTitle>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <StatChip label="Active habits" value={String(activeCount)} />
        <StatChip label="30-day consistency" value={`${score}%`} />
      </div>

      {/* 12-week trend sparkline */}
      {trend.length > 0 && (
        <div>
          <p className="mb-1 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            12-week completion trend
          </p>
          <div className="flex h-16 items-end gap-px border-b border-l border-ink-light/30 pl-1">
            {trend.map((w) => (
              <TrendBar key={w.weekStart} pct={w.pct} weekStart={w.weekStart} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-ink-light">
            <span>{trend[0].weekStart.slice(5)}</span>
            <span>today</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gold-deep/20 bg-parchment-100/60 px-2 py-1.5 text-center">
      <div className="font-display text-lg font-bold text-ink">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</div>
    </div>
  );
}
