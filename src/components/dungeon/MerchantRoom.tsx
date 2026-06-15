import { Coins } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SceneArt } from '@/components/ui/SceneArt';

/** A wandering merchant: spend your gold on a heal, a potion, or a relic. */
export function MerchantRoom() {
  const offers = useGameStore((s) => s.dungeon?.merchant ?? []);
  const gold = useGameStore((s) => s.character.gold);
  const unlimited = useGameStore((s) => s.settings.unlimitedGold);
  const buy = useGameStore((s) => s.dungeonBuy);
  const leave = useGameStore((s) => s.dungeonLeaveRoom);

  return (
    <Panel tone="parchment" className="space-y-3 p-5">
      <SceneArt sceneKey="room:merchant" caption="A Wandering Merchant" />
      <div className="flex items-center justify-between">
        <div className="font-display text-base font-bold text-ink">Merchant</div>
        <span className="flex items-center gap-1.5 text-sm text-gold-deep">
          <Coins className="h-4 w-4" /> {unlimited ? '∞' : gold}
        </span>
      </div>
      <div className="space-y-2">
        {offers.map((o) => {
          const afford = unlimited || gold >= o.cost;
          return (
            <Button
              key={o.id}
              variant="secondary"
              onClick={() => buy(o.id)}
              disabled={!afford}
              className="w-full justify-between px-3 py-2 text-left text-sm"
            >
              <span>{o.label}</span>
              <span className="flex items-center gap-1 text-[11px] tabular-nums text-gold-deep">
                <Coins className="h-3 w-3" /> {o.cost}
              </span>
            </Button>
          );
        })}
        {offers.length === 0 && <p className="text-sm italic text-ink-muted">The merchant's wares are gone.</p>}
        <Button onClick={leave} className="w-full py-2.5">
          Move on →
        </Button>
      </div>
    </Panel>
  );
}
