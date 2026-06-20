import { useGameStore } from '@/store/useGameStore';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SceneArt } from '@/components/ui/SceneArt';

/** A campfire: recover some HP, or attune for a small boon. */
export function RestRoom() {
  const hp = useGameStore((s) => s.dungeon?.hp ?? 0);
  const maxHp = useGameStore((s) => s.dungeon?.maxHp ?? 1);
  const rest = useGameStore((s) => s.dungeonRest);
  const heal = Math.round(maxHp * 0.4);

  return (
    <Panel tone="parchment" className="space-y-3 p-5">
      <SceneArt sceneKey="room:rest" caption="A Safe Hollow" />
      <div>
        <div className="font-display text-base font-bold text-ink">Campfire</div>
        <p className="mt-1 text-sm text-ink-muted">A moment's safety. Tend your wounds, or attune to the deep.</p>
      </div>
      <div className="space-y-2">
        {hp >= maxHp ? (
          <div className="rounded-md border border-gold-deep/20 bg-parchment-100/50 px-3 py-2 text-sm text-ink-muted">
            Fully healed — attune to the deep instead.
          </div>
        ) : (
          <Button
            variant="secondary"
            onClick={() => rest('heal')}
            className="w-full justify-between px-3 py-2 text-left text-sm"
          >
            <span>Rest and recover</span>
            <span className="text-[11px] tabular-nums text-stat-HP">+{heal} HP</span>
          </Button>
        )}
        <Button variant="secondary" onClick={() => rest('fortify')} className="w-full justify-between px-3 py-2 text-left text-sm">
          <span>Attune to the deep — add a boon</span>
          <span className="text-[11px] text-gold-deep">stacks with relics</span>
        </Button>
      </div>
    </Panel>
  );
}
