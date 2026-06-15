import { useMemo, useState } from 'react';
import { Plus, Swords, AlertTriangle, BarChart3, RotateCcw } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { makeSelectDashboardHabits, selectHabitLoadWarning } from '@/store/selectors';
import { isCompletedOn, effectiveStatus } from '@/engine/habits';
import { toISODate, parseISODate } from '@/engine/date';
import { HabitCard } from '@/components/habits/HabitCard';
import { HabitForm } from '@/components/habits/HabitForm';
import { DatePicker } from '@/components/habits/DatePicker';
import { HeroBanner } from '@/components/character/HeroBanner';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';

export function DashboardView({ onOpenHistory }: { onOpenHistory: () => void }) {
  const today = toISODate();
  const [viewDate, setViewDate] = useState(today);
  const isToday = viewDate === today;

  const allHabits = useGameStore((s) => s.habits);
  const dashboard = useGameStore(useMemo(() => makeSelectDashboardHabits(viewDate), [viewDate]));
  const warning = useGameStore(selectHabitLoadWarning);
  const pendingLevelUp = useGameStore((s) => s.pendingLevelUp);
  const startBattle = useGameStore((s) => s.startBattle);
  const [showForm, setShowForm] = useState(false);

  const suspended = dashboard.filter((h) => effectiveStatus(h, viewDate) === 'suspended');
  const active = dashboard.filter((h) => effectiveStatus(h, viewDate) !== 'suspended');
  const pending = active.filter((h) => !isCompletedOn(h, viewDate));
  const done = active.filter((h) => isCompletedOn(h, viewDate));

  // Earliest pickable day = the first habit's creation date (fall back to today).
  const minISO = allHabits.reduce<string>(
    (min, h) => (h.createdISO < min ? h.createdISO : min),
    today,
  );
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

      {pendingLevelUp && (
        <Panel tone="wood" className="flex items-center gap-3 p-4">
          <Swords className="h-7 w-7 shrink-0 text-ember-bright" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-base font-bold text-gold-bright">A Challenger Appears!</div>
            <div className="text-sm text-parchment-300">
              Win the Level-Up Trial to ascend to Level {pendingLevelUp}.
            </div>
          </div>
          <Button variant="danger" onClick={startBattle} className="shrink-0">
            Enter Trial
          </Button>
        </Panel>
      )}

      {warning && (
        <div className="flex items-start gap-2 rounded-md border border-gold-deep/50 bg-wood-700/60 p-3 text-sm text-gold-bright/90">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{warning}</span>
        </div>
      )}

      <Panel tone="parchment" className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <SectionTitle className="flex-1">{title}</SectionTitle>
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
            onClick={onOpenHistory}
            className="flex items-center gap-1 px-2.5 py-1.5"
            aria-label="History"
          >
            <BarChart3 className="h-4 w-4" />
          </Button>
          <Button onClick={() => setShowForm(true)} className="flex items-center gap-1 px-3 py-1.5">
            <Plus className="h-4 w-4" /> Habit
          </Button>
        </div>

        {dashboard.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-light/50 p-8 text-center text-sm text-ink-muted">
            {isToday
              ? 'No quests yet. Inscribe your first habit to begin shaping your hero.'
              : 'No quests were scheduled on this day.'}
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((h) => (
              <HabitCard key={h.id} habit={h} viewDate={viewDate} />
            ))}
            {done.length > 0 && (
              <>
                <div className="pt-3 font-display text-[11px] uppercase tracking-[0.18em] text-ink-light">
                  Completed ({done.length})
                </div>
                {done.map((h) => (
                  <HabitCard key={h.id} habit={h} viewDate={viewDate} />
                ))}
              </>
            )}
            {suspended.length > 0 && (
              <>
                <div className="pt-3 font-display text-[11px] uppercase tracking-[0.18em] text-ink-light">
                  Suspended ({suspended.length})
                </div>
                {suspended.map((h) => (
                  <HabitCard key={h.id} habit={h} viewDate={viewDate} />
                ))}
              </>
            )}
          </div>
        )}
      </Panel>

      {showForm && <HabitForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
