import { Modal } from '@/components/ui/Modal';
import { useGameStore } from '@/store/useGameStore';
import { selectBalanceReport } from '@/store/selectors';
import { EARNING_SOURCES } from '@/engine/balance';

const SOURCE_LABELS: Record<string, string> = {
  habit: 'Habits',
  mine: 'Deep Mine',
  forest: 'Wild Forest',
  arena: 'Arena',
  tactics: 'Tactics',
  dungeon: 'Dungeon',
  trial: 'Skill Trials',
  challenge: 'Challenges',
  boss: 'Boss Battles',
};

function Bar({ pct, color = '#c9a83c' }: { pct: number; color?: string }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-wood-900">
      <div className="h-full rounded-full" style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, background: color }} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded bg-wood-900/60 px-2 py-1.5 text-center">
      <div className="text-base font-bold text-gold-deep">{value}</div>
      <div className="mt-0.5 text-[10px] text-ink-muted">{label}</div>
    </div>
  );
}

interface Props {
  onClose: () => void;
}

/** Developer-only balance report. Opened from Settings → Developer panel. */
export function BalanceReportModal({ onClose }: Props) {
  const report = useGameStore(selectBalanceReport);

  const hasData = report.totalXp > 0 || report.totalGold > 0;

  return (
    <Modal title="Balance Report" onClose={onClose}>
      <p className="mb-3 text-[11px] text-ink-muted">
        Tracking started at save v25 — figures are cumulative since then.
      </p>

      {!hasData && (
        <p className="py-6 text-center text-sm text-ink-muted">
          No data yet. Complete some habits and minigame runs to populate the report.
        </p>
      )}

      {hasData && (
        <>
          {/* Headline tiles */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Total XP" value={report.totalXp} />
            <Tile label="Total Gold" value={report.totalGold} />
            <Tile label="Habit XP share" value={`${report.habitXpShare}%`} />
            <Tile label="Minigame XP share" value={`${report.minigameXpShare}%`} />
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Avg XP/habit" value={report.avgXpPerHabit} />
            <Tile label="Avg XP/run" value={report.avgXpPerMinigameRun} />
            <Tile label="Energy earned" value={report.energyEarned} />
            <Tile label="Gold/Energy" value={report.avgGoldPerEnergy} />
          </div>

          {/* XP by source */}
          <div className="mb-4">
            <div className="mb-1 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              XP by source
            </div>
            <div className="space-y-1.5">
              {EARNING_SOURCES.filter((src) => {
                const row = report.rows.find((r) => r.source === src);
                return row && row.xp > 0;
              }).map((src) => {
                const row = report.rows.find((r) => r.source === src)!;
                return (
                  <div key={src} className="flex items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 text-ink-muted">{SOURCE_LABELS[src]}</span>
                    <Bar pct={row.xpPct} />
                    <span className="w-10 shrink-0 text-right text-ink">{row.xp}</span>
                    <span className="w-8 shrink-0 text-right text-ink-muted">{row.xpPct}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Gold by source */}
          {report.totalGold > 0 && (
            <div className="mb-4">
              <div className="mb-1 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                Gold by source
              </div>
              <div className="space-y-1.5">
                {EARNING_SOURCES.filter((src) => {
                  const row = report.rows.find((r) => r.source === src);
                  return row && row.gold > 0;
                }).map((src) => {
                  const row = report.rows.find((r) => r.source === src)!;
                  return (
                    <div key={src} className="flex items-center gap-2 text-xs">
                      <span className="w-20 shrink-0 text-ink-muted">{SOURCE_LABELS[src]}</span>
                      <Bar pct={row.goldPct} color="#a07850" />
                      <span className="w-10 shrink-0 text-right text-ink">{row.gold}</span>
                      <span className="w-8 shrink-0 text-right text-ink-muted">{row.goldPct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Averages table */}
          <div className="mb-2">
            <div className="mb-1 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Averages per event
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-ink-muted">
                    <th className="pb-1 text-left">Source</th>
                    <th className="pb-1 text-right">Events</th>
                    <th className="pb-1 text-right">Avg XP</th>
                    <th className="pb-1 text-right">Avg Gold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-wood-900/40">
                  {report.rows
                    .filter((r) => r.count > 0)
                    .map((r) => (
                      <tr key={r.source}>
                        <td className="py-0.5 text-ink-muted">{SOURCE_LABELS[r.source]}</td>
                        <td className="py-0.5 text-right text-ink">{r.count}</td>
                        <td className="py-0.5 text-right text-ink">{r.avgXp}</td>
                        <td className="py-0.5 text-right text-ink">{r.avgGold}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
