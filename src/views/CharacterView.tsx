import { useGameStore } from '@/store/useGameStore';
import { selectLevelProgress } from '@/store/selectors';
import { STATS } from '@/engine/stats';
import { CLASS_CHART, ADVANCED_CLASSES } from '@/engine/classes';
import { MOOD_META } from '@/engine/mood';
import { StatBar } from '@/components/character/StatBar';

// All discoverable classes (unique names from the chart) for the Codex.
const ALL_CLASSES = Array.from(
  new Set(Object.values(CLASS_CHART).flatMap((row) => Object.values(row))),
).sort();

export function CharacterView() {
  const character = useGameStore((s) => s.character);
  const codex = useGameStore((s) => s.codex);
  const progress = useGameStore(selectLevelProgress);
  const resetGame = useGameStore((s) => s.resetGame);
  const mood = MOOD_META[character.mood];

  const maxXp = Math.max(1, ...STATS.map((s) => character.statXp[s.id]));

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      {/* Identity card */}
      <div className="rounded-2xl border border-gray-800 bg-[#11151f] p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">{mood.emoji} {mood.label}</div>
            <div className="mt-1 text-2xl font-bold">{character.classId ?? 'Adventurer'}</div>
            <div className="text-sm text-gray-400">Level {character.level}</div>
          </div>
          <div className="text-right text-xs text-gray-500">
            <div>{progress.intoLevel} / {progress.neededForNext} XP</div>
            <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-gray-800">
              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">{mood.note}</p>
      </div>

      {/* Stats */}
      <h2 className="mb-3 mt-6 text-sm font-semibold text-gray-300">Stats</h2>
      <div className="space-y-2.5 rounded-2xl border border-gray-800 bg-[#11151f] p-4">
        {STATS.map((s) => (
          <StatBar key={s.id} stat={s.id} xp={character.statXp[s.id]} maxXp={maxXp} />
        ))}
      </div>

      {/* Class Codex */}
      <h2 className="mb-3 mt-6 flex items-center justify-between text-sm font-semibold text-gray-300">
        <span>Class Codex</span>
        <span className="text-xs font-normal text-gray-500">
          {codex.length} / {ALL_CLASSES.length} discovered
        </span>
      </h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {ALL_CLASSES.map((name) => {
          const found = codex.includes(name);
          const adv = ADVANCED_CLASSES[name];
          return (
            <div
              key={name}
              className={`rounded-lg border p-2 text-center text-xs ${
                found ? 'border-indigo-700/50 bg-indigo-500/5 text-indigo-200' : 'border-gray-800 bg-gray-900/40 text-gray-600'
              }`}
            >
              <div className="font-medium">{found ? name : '???'}</div>
              {found && adv && <div className="mt-0.5 text-[10px] text-amber-400/80">→ {adv}</div>}
            </div>
          );
        })}
      </div>

      <div className="mt-8 text-center">
        <button
          onClick={() => {
            if (confirm('Reset all progress? This cannot be undone.')) resetGame();
          }}
          className="text-xs text-gray-600 hover:text-red-400"
        >
          Reset game
        </button>
      </div>
    </div>
  );
}
