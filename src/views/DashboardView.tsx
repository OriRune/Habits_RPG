import { useState } from 'react';
import { Plus, Swords, AlertTriangle } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { selectDueToday, selectHabitLoadWarning, isHabitDoneToday } from '@/store/selectors';
import { HabitCard } from '@/components/habits/HabitCard';
import { HabitForm } from '@/components/habits/HabitForm';
import { HeroBanner } from '@/components/character/HeroBanner';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';

export function DashboardView() {
  const due = useGameStore(selectDueToday);
  const warning = useGameStore(selectHabitLoadWarning);
  const pendingLevelUp = useGameStore((s) => s.pendingLevelUp);
  const startBattle = useGameStore((s) => s.startBattle);
  const [showForm, setShowForm] = useState(false);

  const pending = due.filter((h) => !isHabitDoneToday(h));
  const done = due.filter((h) => isHabitDoneToday(h));

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
        <div className="mb-3 flex items-center gap-3">
          <SectionTitle className="flex-1">Quest Log · Today</SectionTitle>
          <Button onClick={() => setShowForm(true)} className="flex items-center gap-1 px-3 py-1.5">
            <Plus className="h-4 w-4" /> Habit
          </Button>
        </div>

        {due.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-light/50 p-8 text-center text-sm text-ink-muted">
            No quests yet. Inscribe your first habit to begin shaping your hero.
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((h) => (
              <HabitCard key={h.id} habit={h} />
            ))}
            {done.length > 0 && (
              <>
                <div className="pt-3 font-display text-[11px] uppercase tracking-[0.18em] text-ink-light">
                  Completed ({done.length})
                </div>
                {done.map((h) => (
                  <HabitCard key={h.id} habit={h} />
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
