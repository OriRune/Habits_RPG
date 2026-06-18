import { useLayoutEffect, useRef, useState } from 'react';
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

interface EdgeLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  active: boolean; // connects a visited node to a choosable one
}

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

  // Derive current layer index from which layer contains a choosable node.
  // Layer 0 = first layer (not yet started). After visiting layer N, choices come from layer N+1.
  const totalLayers = map.layers.length;
  const currentLayerIndex = map.layers.findIndex((layer) => layer.some((id) => choices.includes(id)));
  const layerLabel =
    currentLayerIndex < 0
      ? `Layer ${totalLayers} of ${totalLayers}` // at final layer (terminal)
      : `Layer ${currentLayerIndex + 1} of ${totalLayers}`;

  // Refs for edge-line rendering
  const gridRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [edges, setEdges] = useState<EdgeLine[]>([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  const setNodeRef = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  };

  // Recompute edge positions after every render (map changes between floors)
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cRect = grid.getBoundingClientRect();
    if (cRect.width === 0) return;

    setSvgSize({ w: cRect.width, h: cRect.height });

    const newEdges: EdgeLine[] = [];
    for (const [id, node] of Object.entries(map.nodes)) {
      const fromEl = nodeRefs.current.get(id);
      if (!fromEl || node.to.length === 0) continue;
      const fRect = fromEl.getBoundingClientRect();
      const fx = fRect.left + fRect.width / 2 - cRect.left;
      const fy = fRect.bottom - cRect.top;

      for (const toId of node.to) {
        const toEl = nodeRefs.current.get(toId);
        if (!toEl) continue;
        const tRect = toEl.getBoundingClientRect();
        const tx = tRect.left + tRect.width / 2 - cRect.left;
        const ty = tRect.top - cRect.top;
        // Edge is "active" when the source is visited and target is choosable
        const active = visited.has(id) && choices.includes(toId);
        newEdges.push({ x1: fx, y1: fy, x2: tx, y2: ty, active });
      }
    }
    setEdges(newEdges);
  }); // intentionally no deps — reruns on every render to stay in sync

  return (
    <Panel tone="parchment" className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="font-display text-sm font-bold text-ink">Choose your path</div>
        <div className="font-display text-[11px] text-ink-muted">{layerLabel}</div>
      </div>
      {/* Relative wrapper so the SVG edge overlay can be absolute-positioned */}
      <div className="relative" ref={gridRef}>
        {/* SVG edge overlay — rendered behind the buttons */}
        {svgSize.w > 0 && (
          <svg
            className="pointer-events-none absolute inset-0"
            width={svgSize.w}
            height={svgSize.h}
            aria-hidden="true"
          >
            {edges.map((e, i) => (
              <line
                key={i}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke={e.active ? 'rgba(201,162,39,0.60)' : 'rgba(201,162,39,0.20)'}
                strokeWidth={e.active ? 2 : 1.5}
                strokeLinecap="round"
                strokeDasharray={e.active ? undefined : '3 3'}
              />
            ))}
          </svg>
        )}
        {/* Layer rows */}
        <div className="space-y-2">
          {map.layers.map((layer, li) => (
            <div key={li} className="flex items-center justify-center gap-2.5">
              {layer.map((id) => {
                const node = map.nodes[id];
                if (!node) return null;
                const meta = ROOM_ICON[node.room.type];
                const isChoice = choices.includes(id);
                const isVisited = visited.has(id);
                const { Icon } = meta;
                return (
                  <button
                    key={id}
                    ref={setNodeRef(id)}
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
      </div>
      <p className="text-center text-[11px] text-ink-light">Tap a glowing room to enter it.</p>
    </Panel>
  );
}
