import { useGameStore } from '@/store/useGameStore';
import { getStat, type StatId } from '@/engine/stats';
import { MOOD_META } from '@/engine/mood';
import { addDays, parseISODate } from '@/engine/date';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SceneArt } from '@/components/ui/SceneArt';

function fmt(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** End-of-week recap (brief §2). Auto-pops on the first app open of a new week. */
export function WeeklyReportModal() {
  const report = useGameStore((s) => s.pendingReport);
  const dismiss = useGameStore((s) => s.dismissWeeklyReport);
  if (!report) return null;

  const mood = MOOD_META[report.mood];
  const statRows = (Object.entries(report.xpByStat) as [StatId, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <Modal title="Weekly Report" dismissable={false}>
      <SceneArt
        sceneKey="weekly:report"
        caption={`${fmt(report.weekKey)} – ${fmt(addDays(report.weekKey, 6))}`}
        size="md"
        className="mb-4"
      />

      {report.completions === 0 ? (
        <p className="mb-4 text-sm text-ink-muted">
          A quiet week — no completions logged. A fresh slate awaits. Ease back in when you're ready.
        </p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-2">
            <Stat label="Completions" value={report.completions} />
            <Stat label="XP earned" value={report.xpTotal} />
            <Stat label="Trials won" value={report.challengesWon} />
          </div>

          {statRows.length > 0 && (
            <div className="mb-4">
              <div className="mb-1 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                XP by stat
              </div>
              <div className="space-y-1.5">
                {statRows.map(([id, v]) => {
                  const meta = getStat(id);
                  const pct = Math.round((v / (statRows[0][1] || 1)) * 100);
                  return (
                    <div key={id} className="flex items-center gap-2 text-xs">
                      <span className="w-9 shrink-0 font-display text-ink-muted">{meta.short}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-wood-900">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: meta.color }} />
                      </div>
                      <span className="w-10 shrink-0 text-right text-ink">{v}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {report.bestStreak && report.bestStreak.days > 1 && (
            <p className="mb-3 text-sm text-ink">
              🔥 Best run: <span className="font-semibold">{report.bestStreak.habitName}</span> ·{' '}
              {report.bestStreak.days} days
            </p>
          )}
        </>
      )}

      <div className="mb-4 flex items-center gap-2 rounded-md border border-gold-deep/30 bg-parchment-100/60 p-2.5 text-sm text-ink">
        <span className="text-lg">{mood.emoji}</span>
        <span>
          <span className="font-display font-semibold">{mood.label}.</span> {mood.note}
        </span>
      </div>

      <Button onClick={dismiss} className="w-full py-2.5">
        Begin a New Week
      </Button>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-gold-deep/30 bg-parchment-100/60 p-2 text-center">
      <div className="font-display text-xl font-bold text-ink">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</div>
    </div>
  );
}
