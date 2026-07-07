import { useGameStore } from '@/store/useGameStore';
import { runStatBonuses } from '@/store/shared';
import { checkChance } from '@/engine/encounters';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SceneArt } from '@/components/ui/SceneArt';

/** A shrine: gamble for a boon, pay HP for a guaranteed one, or walk away. */
export function ShrineRoom() {
  const hp = useGameStore((s) => s.dungeon?.hp ?? 0);
  const maxHp = useGameStore((s) => s.dungeon?.maxHp ?? 1);
  const wi = useGameStore((s) => s.character.statLevels.WI);
  const shrine = useGameStore((s) => s.dungeonShrine);

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
