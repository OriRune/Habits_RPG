import { Swords, ScrollText, Gem, Skull, Flame, Sparkles, Coins, Tent, Check } from 'lucide-react';
import type { RoomKind } from '@/engine/dungeon';
import type { FloorMap as FloorMapData } from '@/engine/dungeonMap';
import { Panel } from '@/components/ui/Panel';
import { cn } from '@/lib/cn';

const ROOM_ICON: Record<RoomKind, { Icon: typeof Swords; label: string; color: string }> = {
  combat: { Icon: Swords, label: 'Fight', color: 'text-ember' },
  encounter: { Icon: ScrollText, label: 'Event', color: 'text-stat-KN' },
  treasure: { Icon: Gem, label: 'Treasure', color: 'text-gold-bright' },
  boss: { Icon: Skull, label: 'Boss', color: 'text-ember' },
  elite: { Icon: Flame, label: 'Elite', color: 'text-ember' },
  shrine: { Icon: Sparkles, label: 'Shrine', color: 'text-stat-CH' },
  merchant: { Icon: Coins, label: 'Merchant', color: 'text-gold-bright' },
  rest: { Icon: Tent, label: 'Rest', color: 'text-stat-HP' },
};

/** The branching floor map: pick one of the highlighted next rooms to descend. */
export function FloorMap({
  map,
  choices,
  path,
  onChoose,
}: {
  map: FloorMapData;
  choices: string[];
  path: string[];
  onChoose: (nodeId: string) => void;
}) {
  const visited = new Set(path);
  return (
    <Panel tone="parchment" className="space-y-3 p-4">
      <div className="text-center font-display text-sm font-bold text-ink">Choose your path</div>
      <div className="space-y-2">
        {map.layers.map((layer, li) => (
          <div key={li} className="flex items-center justify-center gap-2.5">
            {layer.map((id) => {
              const node = map.nodes[id];
              const meta = ROOM_ICON[node.room.type];
              const isChoice = choices.includes(id);
              const isVisited = visited.has(id);
              const { Icon } = meta;
              return (
                <button
                  key={id}
                  disabled={!isChoice}
                  onClick={() => onChoose(id)}
                  className={cn(
                    'relative flex w-16 flex-col items-center gap-0.5 rounded-md border p-1.5 transition-colors',
                    isChoice
                      ? 'border-gold-bright bg-gold/15 shadow-glow hover:bg-gold/25'
                      : isVisited
                        ? 'border-gold-deep/40 bg-parchment-300/40'
                        : 'border-ink-light/20 opacity-40',
                  )}
                >
                  <Icon className={cn('h-5 w-5', isChoice || isVisited ? meta.color : 'text-ink-light')} />
                  <span className="text-[10px] text-ink-muted">{meta.label}</span>
                  {isVisited && (
                    <Check className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-parchment-100 text-stat-HP" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-center text-[11px] text-ink-light">Tap a glowing room to enter it.</p>
    </Panel>
  );
}
