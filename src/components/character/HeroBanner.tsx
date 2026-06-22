import { CheckSquare, Coins, Zap } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { selectLevelProgress, selectTopStats, selectDailySummary } from '@/store/selectors';
import { MOOD_META } from '@/engine/mood';
import { MAX_LEVEL } from '@/engine/progression';
import { avatarCrest } from '@/lib/sprites';
import { Panel } from '@/components/ui/Panel';
import { Frame } from '@/components/ui/Frame';
import { Sprite } from '@/components/ui/Sprite';

/** Landing-page hero card: the character's avatar (stand-in crest) + identity + progress. */
export function HeroBanner() {
  const character = useGameStore((s) => s.character);
  const progress = useGameStore(selectLevelProgress);
  const topStat = useGameStore(selectTopStats)[0];
  const summary = useGameStore(selectDailySummary);
  const mood = MOOD_META[character.mood];

  const name = character.name || 'Adventurer';
  const title = character.classId ?? 'Adventurer';
  const crest = avatarCrest(character.classId, topStat);
  const spriteKey = `avatar:${character.classId ?? 'adventurer'}`;

  return (
    <Panel tone="wood" className="flex items-center gap-4 p-4">
      <Frame tone="parchment" className="shrink-0">
        <Sprite spriteKey={spriteKey} look={crest} size="xl" alt={`${title} avatar`} />
      </Frame>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h1 className="truncate font-display text-2xl font-bold text-gold-bright">{name}</h1>
          <span className="font-display text-sm text-on-wood-mid">
            Lv {character.level}
            {character.level >= MAX_LEVEL && <span className="ml-1 text-gold-bright">MAX</span>}
          </span>
        </div>
        <div className="font-display text-sm italic text-on-wood-hi">the {title}</div>

        <div className="mt-0.5 flex items-center gap-2 text-sm text-on-wood-mid">
          <span title={mood.note}>{mood.emoji}</span>
          <span className="italic">{mood.label}</span>
          {summary.scheduledToday > 0 && (
            <span className="ml-auto flex items-center gap-1 font-display text-xs text-on-wood-mid">
              <CheckSquare className="h-3.5 w-3.5 shrink-0" />
              {summary.completedToday}/{summary.scheduledToday} today
            </span>
          )}
        </div>

        {/* XP to next level */}
        <div className="mt-3">
          <div className="mb-1 flex justify-between font-display text-[11px] uppercase tracking-wider text-on-wood-mid">
            <span>Experience</span>
            <span className="tabular-nums">
              {progress.intoLevel} / {progress.neededForNext}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full border border-gold-deep/60 bg-wood-900">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold-bright shadow-glow transition-all"
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>
        </div>

        {/* Currencies */}
        <div className="mt-3 flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-gold-bright">
            <Coins className="h-4 w-4" />
            <span className="tabular-nums">{character.gold}</span>
          </span>
          <span className="flex items-center gap-1.5 text-stat-AG">
            <Zap className="h-4 w-4" />
            <span className="tabular-nums">{character.energy}</span>
            <span className="text-on-wood-mid">energy</span>
          </span>
        </div>
      </div>
    </Panel>
  );
}
