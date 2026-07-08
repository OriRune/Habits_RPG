import { useState } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { getStat, type StatId } from '@/engine/stats';
import { MOOD_META } from '@/engine/mood';
import { addDays, parseISODate } from '@/engine/date';
import { buildEnergySummary } from '@/engine/balance';
import type { HabitActionCode } from '@/engine/habitHealth';
import { selectBalanceReport } from '@/store/selectors';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SceneArt } from '@/components/ui/SceneArt';
import { AlertTriangle, Lightbulb, Star, TrendingUp, Zap } from 'lucide-react';
import type { WeeklyReport } from '@/engine/weekly';

function fmt(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Action-button labels — mirrors HabitCard's insights map. */
const ACTION_LABELS: Record<HabitActionCode, string> = {
  lower_target: 'Lower target',
  change_frequency: 'Change frequency',
  change_difficulty: 'Change difficulty',
  edit: 'Edit habit',
  suspend: 'Suspend',
  retire: 'Retire',
  mark_focus: 'Mark as focus',
};

/** End-of-week recap (brief §2). Auto-pops on the first app open of a new week. */
export function WeeklyReportModal({
  onPlanWeek,
  onReviewHabit,
}: { onPlanWeek?: () => void; onReviewHabit?: () => void } = {}) {
  const report = useGameStore((s) => s.pendingReport) as WeeklyReport | null;
  const dismiss = useGameStore((s) => s.dismissWeeklyReport);
  const setHabitFocus = useGameStore((s) => s.setHabitFocus);
  const habitXpShare = useGameStore((s) => selectBalanceReport(s).habitXpShare);
  const energyLog = useGameStore((s) => s.energyLog);
  const [focusMarked, setFocusMarked] = useState(false);
  if (!report) return null;

  const mood = MOOD_META[report.mood];
  const focusResults = report.focusResults ?? [];
  // Energy net for the *closed* week — anchor on its last day so we read the right week bucket.
  const weekNet = buildEnergySummary(energyLog ?? {}, addDays(report.weekKey, 6)).weekNet;
  const statRows = (Object.entries(report.xpByStat) as [StatId, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  function handleBeginNewWeek() {
    onPlanWeek?.();
    dismiss();
  }

  // mark_focus is a genuine one-tap store action, applied in place. Every other code needs the
  // date-picker / edit form on the Habits tab, so we close the report and navigate there.
  function handleHealthAction(habitId: string, action: HabitActionCode) {
    if (action === 'mark_focus') {
      setHabitFocus(habitId, true);
      setFocusMarked(true);
      return;
    }
    onReviewHabit?.();
    dismiss();
  }

  return (
    <Modal title="Weekly Report" dismissable={false}>
      <SceneArt
        sceneKey="weekly:report"
        caption={`${fmt(report.weekKey)} – ${fmt(addDays(report.weekKey, 6))}`}
        size="md"
        className="mb-4"
      />

      {/* Focus habits — how the week's chosen focus went (first content block). */}
      {focusResults.length > 0 && (
        <div className="mb-4">
          <div className="mb-1 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Focus habits
          </div>
          <div className="space-y-1.5">
            {focusResults.map((f) => (
              <div key={f.habitName} className="flex items-center gap-2 text-sm">
                <Star className="h-3.5 w-3.5 shrink-0 fill-gold-bright text-gold-bright" />
                <span className="min-w-0 flex-1 truncate text-ink">{f.habitName}</span>
                <span className="shrink-0 text-ink-muted">
                  {f.scheduled > 0 ? `${f.completed}/${f.scheduled} days` : `${f.completed} logged`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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

          {/* Most-improved vs prior week */}
          {report.mostImproved && report.mostImproved.delta > 0 && (
            <p className="mb-2 flex items-center gap-1.5 text-sm text-ink">
              <TrendingUp className="h-3.5 w-3.5 shrink-0 text-stat-KN" />
              Most improved:{' '}
              <span className="font-semibold">{report.mostImproved.habitName}</span>
              <span className="text-ink-muted">+{report.mostImproved.delta} vs last week</span>
            </p>
          )}

          {/* Most-missed */}
          {report.mostMissed && report.mostMissed.missed > 0 && (
            <p className="mb-3 flex items-center gap-1.5 text-sm text-ink-muted">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              Needs attention:{' '}
              <span className="font-semibold text-ink">{report.mostMissed.habitName}</span>
              <span>— {report.mostMissed.missed} missed day{report.mostMissed.missed !== 1 ? 's' : ''}</span>
            </p>
          )}

          {/* Energy note */}
          <p className="mb-3 flex items-center gap-1.5 text-sm text-ink-muted">
            <Zap className="h-3.5 w-3.5 shrink-0 text-gold-bright" />
            Earned{' '}
            <span className="font-semibold text-gold-bright">{report.completions}</span>{' '}
            Energy from habit completions this week.
          </p>

          {/* Suggested adjustment + one wired action button (focus) */}
          {report.suggestedAdjustment && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-gold-deep/30 bg-parchment-100/60 p-2.5 text-sm text-ink">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" />
              <div className="min-w-0 space-y-2">
                <span>{report.suggestedAdjustment}</span>
                {report.healthAction && (
                  <div>
                    <Button
                      variant="secondary"
                      disabled={report.healthAction.action === 'mark_focus' && focusMarked}
                      onClick={() => handleHealthAction(report.healthAction!.habitId, report.healthAction!.action)}
                      className="px-2.5 py-1 text-xs"
                    >
                      {report.healthAction.action === 'mark_focus' && focusMarked
                        ? '✓ Marked as focus'
                        : ACTION_LABELS[report.healthAction.action]}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Identity balance tiles (dev-only per-source tables stay in BalanceReportModal). */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Stat label="Habit XP share" value={`${habitXpShare}%`} />
        <Stat label="Energy net" value={weekNet >= 0 ? `+${weekNet}` : `${weekNet}`} />
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-md border border-gold-deep/30 bg-parchment-100/60 p-2.5 text-sm text-ink">
        <span className="text-lg">{mood.emoji}</span>
        <span>
          <span className="font-display font-semibold">{mood.label}.</span> {mood.note}
        </span>
      </div>

      <Button onClick={handleBeginNewWeek} className="w-full py-2.5">
        Begin a New Week
      </Button>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-gold-deep/30 bg-parchment-100/60 p-2 text-center">
      <div className="font-display text-xl font-bold text-ink">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</div>
    </div>
  );
}
