import { Coins, Zap, Star } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { selectLevelProgress } from '@/store/selectors';
import { MOOD_META } from '@/engine/mood';

export function Header() {
  const character = useGameStore((s) => s.character);
  const progress = useGameStore(selectLevelProgress);
  const mood = MOOD_META[character.mood];

  return (
    <header className="sticky top-0 z-10 border-b border-gray-800 bg-[#0b0f1a]/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-300">
            <Star className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span>Level {character.level}</span>
              <span className="text-gray-500">·</span>
              <span className="text-gray-300">{character.classId ?? 'Adventurer'}</span>
            </div>
            <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-indigo-500"
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <span title={mood.note} className="text-lg" aria-label={mood.label}>
            {mood.emoji}
          </span>
          <span className="flex items-center gap-1 text-amber-300">
            <Coins className="h-4 w-4" />
            <span className="tabular-nums">{character.gold}</span>
          </span>
          <span className="flex items-center gap-1 text-cyan-300">
            <Zap className="h-4 w-4" />
            <span className="tabular-nums">{character.energy}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
