import { ChevronLeft } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { effectiveStatus } from '@/engine/habits';
import { toISODate } from '@/engine/date';
import { HabitHistoryCard } from '@/components/history/HabitHistoryCard';

const ORDER = { active: 0, suspended: 1, retired: 2 } as const;

/** Full-screen overlay: every habit's heatmap, stats, and (quantity) graph. */
export function HistoryView({ onClose }: { onClose: () => void }) {
  const habits = useGameStore((s) => s.habits);
  const today = toISODate();

  const sorted = [...habits].sort(
    (a, b) => ORDER[effectiveStatus(a, today)] - ORDER[effectiveStatus(b, today)],
  );

  return (
    <div className="texture-wood fixed inset-0 z-50 overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-gold-deep bg-wood-800/95 px-4 py-3 backdrop-blur">
        <button onClick={onClose} className="text-parchment-200 hover:text-gold-bright" aria-label="Back">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="font-display text-lg font-bold text-gold-bright">Chronicle</h1>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {sorted.length === 0 ? (
          <div className="rounded-md border border-dashed border-gold-deep/40 p-8 text-center text-sm text-parchment-300/70">
            No habits yet — your chronicle fills in as you complete them.
          </div>
        ) : (
          sorted.map((h) => <HabitHistoryCard key={h.id} habit={h} />)
        )}
      </div>
    </div>
  );
}
