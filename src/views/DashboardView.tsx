import { useState } from 'react';
import { Plus, Swords, AlertTriangle } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { selectDueToday, selectHabitLoadWarning, isHabitDoneToday } from '@/store/selectors';
import { HabitCard } from '@/components/habits/HabitCard';
import { HabitForm } from '@/components/habits/HabitForm';

export function DashboardView() {
  const due = useGameStore(selectDueToday);
  const warning = useGameStore(selectHabitLoadWarning);
  const pendingLevelUp = useGameStore((s) => s.pendingLevelUp);
  const startBattle = useGameStore((s) => s.startBattle);
  const [showForm, setShowForm] = useState(false);

  const pending = due.filter((h) => !isHabitDoneToday(h));
  const done = due.filter((h) => isHabitDoneToday(h));

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      {pendingLevelUp && (
        <button
          onClick={startBattle}
          className="mb-4 flex w-full items-center gap-3 rounded-xl border border-amber-600/50 bg-amber-500/10 p-4 text-left hover:bg-amber-500/20"
        >
          <Swords className="h-6 w-6 text-amber-400" />
          <div>
            <div className="text-sm font-semibold text-amber-200">Level-Up Trial available!</div>
            <div className="text-xs text-amber-300/80">
              Defeat the guardian to reach Level {pendingLevelUp}.
            </div>
          </div>
        </button>
      )}

      {warning && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-yellow-700/40 bg-yellow-500/5 p-3 text-xs text-yellow-300/90">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{warning}</span>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-base font-semibold text-gray-200">Today</h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" /> Habit
        </button>
      </div>

      {due.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-sm text-gray-500">
          No habits yet. Add your first habit to start building your character.
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((h) => (
            <HabitCard key={h.id} habit={h} />
          ))}
          {done.length > 0 && (
            <>
              <div className="pt-3 text-xs font-medium uppercase tracking-wide text-gray-600">
                Completed ({done.length})
              </div>
              {done.map((h) => (
                <HabitCard key={h.id} habit={h} />
              ))}
            </>
          )}
        </div>
      )}

      {showForm && <HabitForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
