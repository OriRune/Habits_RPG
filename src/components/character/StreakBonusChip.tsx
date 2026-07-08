import { Flame } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { selectHabitBonusInfo } from '@/store/selectors';
import { cn } from '@/lib/cn';

/**
 * Small readout of the habit-streak minigame-gold multiplier
 * ("Streak bonus ×1.15 — 3 of 4 habits on streak"). Rendered beside the energy
 * counter and on every run-banking summary so players can see the one mechanic
 * that rewards keeping streaks. Renders nothing at the base 1.0 tier — there is
 * no bonus to advertise, and the counts would read as noise.
 */
export function StreakBonusChip({ className }: { className?: string }) {
  const { bonus, trackedCount, healthyCount } = useGameStore(selectHabitBonusInfo);
  if (bonus === 1) return null;
  return (
    <span className={cn('flex items-center gap-1.5 text-amber-300', className)}>
      <Flame className="h-4 w-4 shrink-0" />
      <span className="tabular-nums font-semibold">×{bonus.toFixed(2)}</span>
      <span className="opacity-80">
        Streak bonus — {healthyCount} of {trackedCount} habits on streak
      </span>
    </span>
  );
}
