import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Plus,
  Swords,
  BarChart3,
  RotateCcw,
  Flame,
  Zap,
  TrendingUp,
  Star,
  Heart,
  Sparkles,
  X,
} from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import {
  makeSelectDashboardHabits,
  selectDailySummary,
  selectRecoveryState,
  selectAccountHealth,
  selectEnergySummary,
} from '@/store/selectors';
import { isCompletedOn, effectiveStatus } from '@/engine/habits';
import { missedRecentScheduledDay } from '@/engine/habitHealth';
import { toISODate, parseISODate, addDays, daysBetween, BACKDATE_WINDOW_DAYS } from '@/engine/date';
import { type ActiveChallenge, isExpired } from '@/engine/challenges';
import { WelcomeCard } from '@/components/onboarding/WelcomeCard';
import { ReminderCard } from '@/components/onboarding/ReminderCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { HabitCard } from '@/components/habits/HabitCard';
import { HabitForm } from '@/components/habits/HabitForm';
import { RecoveryModal } from '@/components/habits/RecoveryModal';
import { DatePicker } from '@/components/habits/DatePicker';
import { HeroBanner } from '@/components/character/HeroBanner';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';
import { cn } from '@/lib/cn';

export function DashboardView({
  onOpenHistory,
  onPlanWeek,
}: {
  /** Open the Chronicle overlay. Pass a habitId to scroll directly to that habit's card. */
  onOpenHistory: (habitId?: string) => void;
  onPlanWeek: () => void;
}) {
  const today = toISODate();
  const [viewDate, setViewDate] = useState(today);
  const isToday = viewDate === today;

  const allHabits = useGameStore((s) => s.habits);
  const dashboard = useGameStore(useMemo(() => makeSelectDashboardHabits(viewDate), [viewDate]));
  const pendingLevelUp = useGameStore((s) => s.pendingLevelUp);
  const startBattle = useGameStore((s) => s.startBattle);
  const created = useGameStore((s) => s.created);
  const hasSeenWelcome = useGameStore((s) => s.hasSeenWelcome);
  const dailyReminderEnabled = useGameStore((s) => s.settings.dailyReminderEnabled);
  const reminderCardDismissed = useGameStore((s) => s.reminderCardDismissed);
  const summary = useGameStore(selectDailySummary);
  const recovery = useGameStore(selectRecoveryState);
  const accountWarnings = useGameStore(selectAccountHealth);
  const challenges = useGameStore((s) => s.challenges);
  // Pick the first active, non-expired challenge for the callout strip.
  const activeChallenge = isToday
    ? (challenges.find((c) => c.status === 'active' && !isExpired(c, today)) ?? null)
    : null;

  const [showForm, setShowForm] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  // Session-level flag: hide the struggling banner after the user acts on it or dismisses it.
  const [recoveryDismissed, setRecoveryDismissed] = useState(false);
  const [dismissedCodes, setDismissedCodes] = useState<Set<string>>(() => new Set());

  const visibleAccountWarnings = accountWarnings.filter((w) => !dismissedCodes.has(w.code));

  const suspended = dashboard.filter((h) => effectiveStatus(h, viewDate) === 'suspended');
  const active = dashboard.filter((h) => effectiveStatus(h, viewDate) !== 'suspended');

  // Focus habits first, then other pending, then done
  const pendingFocus = active.filter((h) => !isCompletedOn(h, viewDate) && h.focus);
  const pendingOther = active.filter((h) => !isCompletedOn(h, viewDate) && !h.focus);
  const done = active.filter((h) => isCompletedOn(h, viewDate));

  // Offer the daily reminder once, after a real missed day, only if it's still off.
  const offerReminder = useMemo(
    () =>
      !dailyReminderEnabled &&
      !reminderCardDismissed &&
      missedRecentScheduledDay(allHabits, today),
    [dailyReminderEnabled, reminderCardDismissed, allHabits, today],
  );

  // Normal backdating window
  const earliestCreated = allHabits.reduce<string>(
    (min, h) => (h.createdISO < min ? h.createdISO : min),
    today,
  );
  const windowFloor = addDays(today, -(BACKDATE_WINDOW_DAYS - 1));
  const minISO = windowFloor > earliestCreated ? windowFloor : earliestCreated;
  const hasActivity = (iso: string) => allHabits.some((h) => isCompletedOn(h, iso));
  const title = isToday
    ? 'Quest Log · Today'
    : `Quest Log · ${parseISODate(viewDate).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })}`;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <HeroBanner />

      {/* Active challenge callout — compact strip below the hero banner */}
      {activeChallenge && <ActiveChallengeCallout challenge={activeChallenge} today={today} />}

      {pendingLevelUp && (
        <Panel tone="wood" className="flex items-center gap-3 p-4">
          <Swords className="h-7 w-7 shrink-0 text-ember-bright" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-base font-bold text-gold-bright">A Challenger Appears!</div>
            <div className="text-sm text-on-wood-hi">
              Win the Level-Up Trial to ascend to Level {pendingLevelUp}.
            </div>
          </div>
          <Button variant="danger" onClick={startBattle} className="shrink-0">
            Enter Trial
          </Button>
        </Panel>
      )}

      {/* Account-level health warnings — dismissible, only shown today */}
      {isToday && visibleAccountWarnings.length > 0 && (
        <Panel tone="parchment" className="divide-y divide-gold-deep/20 overflow-hidden p-0">
          {visibleAccountWarnings.map((w) => (
            <div key={w.code} className="flex items-start gap-2.5 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="flex-1 text-sm text-ink leading-snug">{w.message}</p>
              <button
                onClick={() => setDismissedCodes((prev) => new Set([...prev, w.code]))}
                className="mt-0.5 shrink-0 text-ink-light/60 hover:text-ink-muted transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </Panel>
      )}

      {/* Welcome card — shown once after character creation, dismissed and persisted */}
      {isToday && created && !hasSeenWelcome && <WelcomeCard />}

      {/* One-time daily-reminder offer — after a missed day, if reminders are still off */}
      {isToday && hasSeenWelcome && offerReminder && <ReminderCard />}

      {/* Dashboard command center — only shown when viewing today */}
      {isToday && (
        <DailySummaryStrip
          summary={summary}
          onOpenRecovery={() => setShowRecovery(true)}
          hideRecovery={recoveryDismissed}
          onDismissRecovery={() => setRecoveryDismissed(true)}
        />
      )}

      {/* Quest Log panel */}
      <Panel tone="parchment" className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex-1">
            <SectionTitle>{title}</SectionTitle>
            {isToday && (
              <p className="mt-0.5 font-display text-[11px] text-ink-muted">Your daily habits</p>
            )}
          </div>
          {!isToday && (
            <Button
              variant="secondary"
              onClick={() => setViewDate(today)}
              className="flex items-center gap-1 px-2.5 py-1.5"
            >
              <RotateCcw className="h-4 w-4" /> Today
            </Button>
          )}
          <DatePicker
            value={viewDate}
            onChange={setViewDate}
            minISO={minISO}
            maxISO={today}
            hasActivity={hasActivity}
          />
          <Button
            variant="secondary"
            onClick={() => onOpenHistory()}
            className="flex items-center gap-1 px-2.5 py-1.5"
            aria-label="History"
          >
            <BarChart3 className="h-4 w-4" />
          </Button>
          {isToday && (
            <Button
              variant="secondary"
              onClick={onPlanWeek}
              className="flex items-center gap-1 px-2.5 py-1.5"
              aria-label="Plan week"
            >
              <CalendarDays className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={() => setShowForm(true)} className="flex items-center gap-1 px-3 py-1.5">
            <Plus className="h-4 w-4" /> Habit
          </Button>
        </div>

        {dashboard.length === 0 ? (
          <EmptyState
            message={
              isToday
                ? 'No quests yet. Inscribe your first habit to begin shaping your hero.'
                : 'No quests were scheduled on this day.'
            }
            action={
              isToday
                ? { label: '+ Add your first habit', onClick: () => setShowForm(true) }
                : undefined
            }
          />
        ) : (
          <div className="space-y-2">
            {/* Focus habits first */}
            {pendingFocus.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 pt-1 pb-0.5 font-display text-[11px] uppercase tracking-[0.18em] text-gold-deep">
                  <Star className="h-3 w-3 fill-gold-deep" /> Focus Habits
                </div>
                {pendingFocus.map((h) => (
                  <HabitCard key={h.id} habit={h} viewDate={viewDate} onViewHistory={onOpenHistory} />
                ))}
                {pendingOther.length > 0 && (
                  <div className="pt-1 font-display text-[11px] uppercase tracking-[0.18em] text-ink-light">
                    Other Habits
                  </div>
                )}
              </>
            )}
            {pendingOther.map((h) => (
              <HabitCard key={h.id} habit={h} viewDate={viewDate} onViewHistory={onOpenHistory} />
            ))}
            {done.length > 0 && (
              <>
                <div className="pt-3 font-display text-[11px] uppercase tracking-[0.18em] text-ink-light">
                  Completed ({done.length})
                </div>
                {done.map((h) => (
                  <HabitCard key={h.id} habit={h} viewDate={viewDate} onViewHistory={onOpenHistory} />
                ))}
              </>
            )}
            {suspended.length > 0 && (
              <>
                <div className="pt-3 font-display text-[11px] uppercase tracking-[0.18em] text-ink-light">
                  Suspended ({suspended.length})
                </div>
                {suspended.map((h) => (
                  <HabitCard key={h.id} habit={h} viewDate={viewDate} onViewHistory={onOpenHistory} />
                ))}
              </>
            )}
          </div>
        )}
      </Panel>

      {/* "I'm struggling" recovery entry point — only shown when not already in recovery */}
      {isToday && !recovery.struggling && allHabits.some((h) => h.status === 'active') && (
        <button
          onClick={() => setShowRecovery(true)}
          className="mx-auto flex items-center gap-1.5 text-xs text-ink-muted/60 hover:text-ink-muted transition-colors"
        >
          <Heart className="h-3 w-3" /> Having a rough week?
        </button>
      )}

      {showForm && <HabitForm onClose={() => setShowForm(false)} />}
      {showRecovery && (
        <RecoveryModal
          habits={allHabits}
          onClose={() => setShowRecovery(false)}
          onConfirm={() => setRecoveryDismissed(true)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily Summary Strip
// ---------------------------------------------------------------------------

import type { DailySummary } from '@/store/selectors';

function DailySummaryStrip({
  summary,
  onOpenRecovery,
  hideRecovery,
  onDismissRecovery,
}: {
  summary: DailySummary;
  onOpenRecovery: () => void;
  hideRecovery: boolean;
  onDismissRecovery: () => void;
}) {
  const weeklyPct = Math.round(summary.weeklyCompletionRate * 100);
  const topStreak = summary.topStreaks[0];
  const energySummary = useGameStore(selectEnergySummary);

  // Suppress the struggling action once the user has acted on it or dismissed it.
  const action =
    hideRecovery && summary.recommendedAction?.kind === 'struggling'
      ? null
      : summary.recommendedAction;

  const hasEnergyData = energySummary.weekEarned > 0 || energySummary.weekSpent > 0;

  return (
    <div className="space-y-2">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <StatChip
          icon={<Zap className="h-4 w-4 text-gold-bright" />}
          label="Energy today"
          value={`+${summary.energyEarnedToday}`}
          sub={`${summary.completedToday}/${summary.scheduledToday} habits`}
        />
        <StatChip
          icon={<TrendingUp className="h-4 w-4 text-stat-KN" />}
          label="This week"
          value={`${weeklyPct}%`}
          sub="completion rate"
        />
        <StatChip
          icon={<Flame className="h-4 w-4 text-ember" />}
          label="Best streak"
          value={topStreak ? `${topStreak.streak}` : '—'}
          sub={topStreak ? topStreak.habitName : 'no streaks yet'}
        />
      </div>

      {/* Energy flow strip */}
      {hasEnergyData && (
        <div className="flex items-center gap-1.5 rounded bg-wood-900/40 px-3 py-1.5 text-xs text-ink-muted">
          <Zap className="h-3 w-3 shrink-0 text-amber-400" />
          <span>
            Today{' '}
            <span className="text-amber-400">+{energySummary.todayEarned}</span>
            {' / '}
            <span className="text-ember">−{energySummary.todaySpent}</span>
            {energySummary.todayNet !== 0 && (
              <span className={energySummary.todayNet > 0 ? 'text-green-400' : 'text-red-400'}>
                {' '}({energySummary.todayNet > 0 ? '+' : ''}{energySummary.todayNet})
              </span>
            )}
          </span>
          <span className="mx-1 text-ink-muted/50">·</span>
          <span>
            This week{' '}
            <span className="text-amber-400">+{energySummary.weekEarned}</span>
            {' / '}
            <span className="text-ember">−{energySummary.weekSpent}</span>
          </span>
        </div>
      )}

      {/* Recommended action */}
      {action && (
        <RecommendedActionCard
          action={action}
          onOpenRecovery={onOpenRecovery}
          onDismissRecovery={onDismissRecovery}
        />
      )}
    </div>
  );
}

function StatChip({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-md border border-gold-deep/20 bg-parchment-100/50 px-2 py-2 text-center">
      <div className="mb-0.5">{icon}</div>
      <div className="font-display text-base font-bold text-ink tabular-nums leading-none">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium text-ink-muted leading-tight">{label}</div>
      <div className="mt-0.5 text-[9px] text-ink-light leading-tight truncate w-full">{sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active Challenge Callout
// ---------------------------------------------------------------------------

import { Trophy } from 'lucide-react';

function ActiveChallengeCallout({
  challenge,
  today,
}: {
  challenge: ActiveChallenge;
  today: string;
}) {
  const daysLeft = Math.max(0, challenge.def.durationDays - daysBetween(today, challenge.startISO));
  const pct = challenge.def.goal > 0
    ? Math.min(100, Math.round((challenge.progress / challenge.def.goal) * 100))
    : 0;

  return (
    <Panel tone="parchment" className="px-4 py-3">
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 shrink-0 text-gold-deep" />
        <span className="min-w-0 flex-1 truncate font-display text-sm font-bold text-ink">
          {challenge.def.name}
        </span>
        <span className="shrink-0 font-display text-xs text-ink-muted">
          {daysLeft}d left
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full border border-gold-deep/40 bg-wood-900/20">
        <div
          className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold-bright transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 font-display text-[11px] tabular-nums text-ink-muted">
        {challenge.progress} / {challenge.def.goal} · {pct}%
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

import type { RecommendedAction } from '@/engine/dashboard';

function RecommendedActionCard({
  action,
  onOpenRecovery,
  onDismissRecovery,
}: {
  action: RecommendedAction;
  onOpenRecovery: () => void;
  onDismissRecovery: () => void;
}) {
  const isRecovery = action.kind === 'struggling';
  const isAllDone = action.kind === 'all_done';

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm',
        isRecovery
          ? 'border-ember/40 bg-ember/10 text-ink'
          : isAllDone
            ? 'border-gold-deep/40 bg-gold/10 text-ink'
            : 'border-gold-deep/30 bg-parchment-100/50 text-ink',
      )}
    >
      <span className="mt-0.5 shrink-0">
        {isRecovery ? (
          <Heart className="h-4 w-4 text-ember-bright" />
        ) : isAllDone ? (
          <Sparkles className="h-4 w-4 text-gold-bright" />
        ) : (
          <Star className="h-4 w-4 text-gold-deep" />
        )}
      </span>
      <p className="flex-1">{action.message}</p>
      {isRecovery && (
        <>
          <Button
            variant="secondary"
            onClick={onOpenRecovery}
            className="shrink-0 px-2.5 py-1 text-xs"
          >
            Simplify
          </Button>
          <button
            onClick={onDismissRecovery}
            className="mt-0.5 shrink-0 text-ink-light/60 hover:text-ink-muted transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
