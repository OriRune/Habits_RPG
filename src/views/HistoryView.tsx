import { useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { effectiveStatus } from '@/engine/habits';
import { toISODate } from '@/engine/date';
import { HabitHistoryCard } from '@/components/history/HabitHistoryCard';
import { AccountSummary } from '@/components/history/AccountSummary';
import { DayOfWeekChart } from '@/components/history/DayOfWeekChart';
import { EmptyState } from '@/components/ui/EmptyState';

const ORDER = { active: 0, suspended: 1, retired: 2 } as const;

/** Full-screen overlay: every habit's heatmap, stats, and (quantity) graph. */
export function HistoryView({
  onClose,
  focusHabitId,
}: {
  onClose: () => void;
  /** If provided, scrolls to this habit's card after mount. */
  focusHabitId?: string | null;
}) {
  const habits = useGameStore((s) => s.habits);
  const today = toISODate();

  const sorted = [...habits].sort(
    (a, b) => ORDER[effectiveStatus(a, today)] - ORDER[effectiveStatus(b, today)],
  );

  // Scroll the focused habit into view after the overlay has rendered.
  useEffect(() => {
    if (!focusHabitId) return;
    requestAnimationFrame(() => {
      document
        .getElementById(`habit-history-${focusHabitId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [focusHabitId]);

  return (
    <div className="texture-wood fixed inset-0 z-50 overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-gold-deep bg-wood-800/95 px-4 py-3 backdrop-blur">
        <button onClick={onClose} className="text-parchment-200 hover:text-gold-bright" aria-label="Back">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="font-display text-lg font-bold text-gold-bright">Chronicle</h1>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {/* Account-level summary — consistency trend and day-of-week chart */}
        {habits.length > 0 && (
          <>
            <AccountSummary habits={habits} />
            <DayOfWeekChart habits={habits} />
          </>
        )}

        {sorted.length === 0 ? (
          <EmptyState message="No habits yet — your chronicle fills in as you complete them." />
        ) : (
          sorted.map((h) => (
            <div key={h.id} id={`habit-history-${h.id}`}>
              <HabitHistoryCard habit={h} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
