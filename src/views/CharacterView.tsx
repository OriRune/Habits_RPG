import { useGameStore } from '@/store/useGameStore';
import { STATS } from '@/engine/stats';
import { CLASS_CHART, ADVANCED_CLASSES } from '@/engine/classes';
import { classCrest } from '@/lib/sprites';
import { StatBar } from '@/components/character/StatBar';
import { HeroBanner } from '@/components/character/HeroBanner';
import { LoadoutPanel } from '@/components/character/LoadoutPanel';
import { Panel } from '@/components/ui/Panel';
import { Sprite } from '@/components/ui/Sprite';
import { SectionTitle } from '@/components/ui/Divider';

// All discoverable classes (unique names from the chart) for the Codex.
const ALL_CLASSES = Array.from(
  new Set(Object.values(CLASS_CHART).flatMap((row) => Object.values(row))),
).sort();

export function CharacterView() {
  const character = useGameStore((s) => s.character);
  const codex = useGameStore((s) => s.codex);
  const resetGame = useGameStore((s) => s.resetGame);

  const maxXp = Math.max(1, ...STATS.map((s) => character.statXp[s.id]));

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <HeroBanner />

      <LoadoutPanel />

      {/* Attributes */}
      <Panel tone="parchment" className="p-4">
        <SectionTitle className="mb-3">Attributes</SectionTitle>
        <div className="space-y-2.5">
          {STATS.map((s) => (
            <StatBar key={s.id} stat={s.id} xp={character.statXp[s.id]} maxXp={maxXp} />
          ))}
        </div>
      </Panel>

      {/* Class Codex */}
      <Panel tone="parchment" className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle className="flex-1">Class Codex</SectionTitle>
          <span className="ml-3 shrink-0 font-display text-xs text-ink-muted">
            {codex.length} / {ALL_CLASSES.length}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {ALL_CLASSES.map((name) => {
            const found = codex.includes(name);
            const adv = ADVANCED_CLASSES[name];
            return (
              <div key={name} className="flex flex-col items-center gap-1.5 text-center">
                <Sprite spriteKey={`class:${name}`} look={classCrest(name)} size="md" shrouded={!found} label={found ? name : undefined} />
                <div className={`text-xs font-semibold ${found ? 'text-ink' : 'text-ink-light'}`}>
                  {found ? name : '???'}
                </div>
                {found && adv && <div className="text-[10px] text-gold-deep">→ {adv}</div>}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="text-center">
        <button
          onClick={() => {
            if (confirm('Reset all progress? This cannot be undone.')) resetGame();
          }}
          className="font-display text-xs uppercase tracking-wider text-ink-light/70 hover:text-ember"
        >
          Reset game
        </button>
      </div>
    </div>
  );
}
