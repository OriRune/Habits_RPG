import { useGameStore } from '@/store/useGameStore';
import { runStatBonuses } from '@/store/shared';
import { checkChance } from '@/engine/encounters';
import { getRelic } from '@/engine/relics';
import { relicCrest } from '@/lib/sprites';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';
import { SceneArt } from '@/components/ui/SceneArt';

/** A shrine: gamble for a boon, pay HP for a guaranteed one, or walk away. */
export function ShrineRoom() {
  const hp = useGameStore((s) => s.dungeon?.hp ?? 0);
  const maxHp = useGameStore((s) => s.dungeon?.maxHp ?? 1);
  const wi = useGameStore((s) => s.character.statLevels.WI);
  const result = useGameStore((s) => s.dungeon?.shrineResult ?? null);
  const shrine = useGameStore((s) => s.dungeonShrine);
  const shrineContinue = useGameStore((s) => s.dungeonShrineContinue);

  // Prayer outcome (plan 2.5 / DUN-20): the result panel names what happened — on failure,
  // the exact curse — before the player is dropped back into the path choice.
  if (result) {
    const curse = result.curseKey ? getRelic(result.curseKey) : null;
    return (
      <Panel tone="parchment" className="space-y-3 p-5">
        <SceneArt
          sceneKey={result.outcome === 'blessed' ? 'outcome:success' : 'outcome:fail'}
          caption={result.outcome === 'blessed' ? 'The shrine answers' : 'The shrine turns on you'}
        />
        {result.outcome === 'blessed' ? (
          <div>
            <div className="font-display text-base font-bold text-ink">A blessing</div>
            <p className="mt-1 text-sm text-ink-muted">
              Warm light gathers around you. Choose a boon as you step away from the altar.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="font-display text-base font-bold text-ember">A curse</div>
            {curse ? (
              <div className="flex items-center gap-3 rounded-md border border-ember/40 bg-ember/5 p-3">
                <Sprite spriteKey={`relic:${curse.key}`} look={relicCrest(curse.name, curse.tier)} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="font-display text-sm font-bold text-ink">{curse.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{curse.description}</span>
                </span>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">A cold weight settles on you.</p>
            )}
            <p className="text-xs text-ink-muted">
              Curses last the rest of the run and stack with any you already carry.
            </p>
          </div>
        )}
        <Button onClick={shrineContinue} className="w-full py-2.5">
          Continue →
        </Button>
      </Panel>
    );
  }

  // BAL-07: shrine is a pure Wisdom check (was max(WI,CH)).
  // MINI-27: relic/gear/runBuff WI counts, matching the resolver — read imperatively (a fresh
  // object from a plain selector would loop under useSyncExternalStore; run changes re-render us).
  const power = wi + (runStatBonuses(useGameStore.getState()).WI ?? 0);
  const odds = Math.round(checkChance(power, 6) * 100);
  const tithe = Math.round(maxHp * 0.25);

  return (
    <Panel tone="parchment" className="space-y-3 p-5">
      <SceneArt sceneKey="room:shrine" caption="A Shrine in the Dark" />
      <div>
        <div className="font-display text-base font-bold text-ink">Shrine</div>
        <p className="mt-1 text-sm text-ink-muted">
          An old altar hums with power. It may bless the worthy — or curse the rash.
        </p>
      </div>
      <div className="space-y-2">
        <Button variant="secondary" onClick={() => shrine('pray')} className="w-full justify-between px-3 py-2 text-left text-sm">
          <span>Pray for a blessing</span>
          <span className="text-[11px] tabular-nums text-ink-muted">~{odds}% · fail = curse</span>
        </Button>
        <Button
          variant="secondary"
          onClick={() => shrine('offer')}
          disabled={hp <= tithe}
          className="w-full justify-between px-3 py-2 text-left text-sm"
        >
          <span>Offer your blood — a guaranteed boon</span>
          <span className="text-[11px] tabular-nums text-ember">−{tithe} HP</span>
        </Button>
        <Button onClick={() => shrine('leave')} className="w-full py-2.5">
          Leave the shrine →
        </Button>
      </div>
    </Panel>
  );
}
