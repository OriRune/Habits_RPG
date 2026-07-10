import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Swords, ScrollText, Gem, Skull, Flame, Sparkles, Coins, Tent, Check, Shield } from 'lucide-react';
import type { RoomKind } from '@/engine/dungeon';
import { merchantOffers } from '@/engine/dungeon';
import type { FloorMap as FloorMapData, DangerClass, RewardClass } from '@/engine/dungeonMap';
import { routeDanger, routeOutlook, classifyDanger, rewardClassForDanger } from '@/engine/dungeonMap';
import { Panel } from '@/components/ui/Panel';
import { BiomeMapFrame } from '@/components/dungeon/BiomeMapFrame';
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

// Danger chips differentiate by icon + text, not color alone (accessibility).
const DANGER_CHIP: Record<DangerClass, { Icon: typeof Shield; label: string; className: string }> = {
  low: { Icon: Shield, label: 'Low', className: 'border-stat-HP/60 text-stat-HP' },
  medium: { Icon: Swords, label: 'Med', className: 'border-gold-deep/60 text-gold-deep' },
  high: { Icon: Skull, label: 'High', className: 'border-ember/60 text-ember' },
};

const LOOT_LABEL: Record<RewardClass, string> = { lean: 'Lean', standard: 'Standard', rich: 'Rich' };

/** "Low", or "Low–High" when the routes through a node diverge in danger class. */
function rangeLabel<T extends string>(lo: T, hi: T, labels: Record<T, string>): string {
  return lo === hi ? labels[lo] : `${labels[lo]}–${labels[hi]}`;
}

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
  depth,
  biomeKey,
  merchantDiscount01 = 0,
  onChoose,
}: {
  map: FloorMapData;
  choices: string[];
  path: string[];
  /** Current floor depth — used to price merchant previews. */
  depth: number;
  /** Current biome — drives the decorative map frame (plan 4.2). */
  biomeKey?: string;
  /** Homestead Trading Post discount — must match what the merchant room itself charges. */
  merchantDiscount01?: number;
  onChoose: (nodeId: string) => void;
}) {
  const visited = new Set(path);
  // Route context (plan 2.3): danger already realized this floor, and where the player stands.
  const realizedDanger = routeDanger(map, path);
  const hereId = path.length > 0 ? path[path.length - 1] : null;
  const [focusId, setFocusId] = useState<string | null>(null);

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
  const [, setResizeTick] = useState(0);

  const setNodeRef = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  };

  // Keyboard route selection (plan 4.5): arrows cycle the choosable rooms; Enter/Space
  // activate natively. Wraps at the ends so every choice is one keystroke away.
  const moveFocus = (fromId: string, dir: 1 | -1) => {
    const idx = choices.indexOf(fromId);
    if (idx < 0 || choices.length < 2) return;
    const next = choices[(idx + dir + choices.length) % choices.length];
    nodeRefs.current.get(next)?.focus();
  };
  const onChoiceKeyDown = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(id, 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(id, -1);
    }
  };

  // DUN-08: container resizes (orientation change, font swap, panel reflow) re-trigger the
  // measurement effect below via a state bump; window resize is the fallback for browsers
  // where the container box doesn't change but the viewport does.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const kick = () => setResizeTick((n) => n + 1);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(kick) : null;
    ro?.observe(grid);
    window.addEventListener('resize', kick);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', kick);
    };
  }, []);

  // Recompute edge positions after every render (map changes between floors).
  // Uses functional setState so identical values return the same reference → no
  // extra re-render → the "setState → re-render → setState" loop terminates.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cRect = grid.getBoundingClientRect();
    if (cRect.width === 0) return;

    const w = cRect.width;
    const h = cRect.height;
    setSvgSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));

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

    setEdges(prev => {
      if (prev.length !== newEdges.length) return newEdges;
      for (let i = 0; i < prev.length; i++) {
        const p = prev[i], n = newEdges[i];
        // 0.5-px tolerance handles sub-pixel float jitter from getBoundingClientRect
        if (
          Math.abs(p.x1 - n.x1) > 0.5 || Math.abs(p.y1 - n.y1) > 0.5 ||
          Math.abs(p.x2 - n.x2) > 0.5 || Math.abs(p.y2 - n.y2) > 0.5 ||
          p.active !== n.active
        ) return newEdges;
      }
      return prev; // stable reference → React bails out of re-render
    });
  }); // intentionally no deps — reruns on every render to stay in sync with layout

  return (
    <Panel tone="parchment" className="relative overflow-hidden p-4">
      {biomeKey && <BiomeMapFrame biomeKey={biomeKey} />}
      {/* Positioned wrapper so the interactive content paints above the frame layer. */}
      <div className="relative space-y-3">
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
        <div className="space-y-2" role="group" aria-label={`Floor map — ${layerLabel}`}>
          {map.layers.map((layer, li) => (
            <div key={li} className="flex items-center justify-center gap-2.5">
              {layer.map((id) => {
                const node = map.nodes[id];
                if (!node) return null;
                const meta = ROOM_ICON[node.room.type];
                const isChoice = choices.includes(id);
                const isVisited = visited.has(id);
                const isHere = id === hereId;
                const { Icon } = meta;
                // Danger chip: the range of route classes through this node, counting
                // the danger already realized on the path (plan 2.3).
                const outlook = isChoice ? routeOutlook(map, id) : null;
                const chip = outlook
                  ? {
                      lo: classifyDanger(realizedDanger + outlook.minDanger),
                      hi: classifyDanger(realizedDanger + outlook.maxDanger),
                    }
                  : null;
                const ChipIcon = chip ? DANGER_CHIP[chip.hi].Icon : null;
                return (
                  <button
                    key={id}
                    ref={setNodeRef(id)}
                    disabled={!isChoice}
                    onClick={() => onChoose(id)}
                    onMouseEnter={isChoice ? () => setFocusId(id) : undefined}
                    onMouseLeave={isChoice ? () => setFocusId((cur) => (cur === id ? null : cur)) : undefined}
                    onFocus={isChoice ? () => setFocusId(id) : undefined}
                    onBlur={isChoice ? () => setFocusId((cur) => (cur === id ? null : cur)) : undefined}
                    onKeyDown={isChoice ? onChoiceKeyDown(id) : undefined}
                    aria-label={`${meta.label} room — ${
                      isChoice ? 'available choice' : isVisited ? 'already visited' : 'out of reach'
                    }${isHere ? ' — you are here' : ''}${
                      chip ? ` — danger ${rangeLabel(chip.lo, chip.hi, { low: 'low', medium: 'medium', high: 'high' })}` : ''
                    }`}
                    className={cn(
                      'relative flex w-16 flex-col items-center gap-0.5 rounded-md border p-1.5 transition-colors',
                      isChoice
                        ? 'border-gold-bright bg-gold/15 shadow-glow hover:bg-gold/25'
                        : isVisited
                          ? 'border-gold-deep/40 bg-parchment-300/40'
                          : 'border-ink-light/20 opacity-40',
                      isHere && 'ring-2 ring-gold-bright/80',
                    )}
                  >
                    <Icon className={cn('h-5 w-5', isChoice || isVisited ? meta.color : 'text-ink-light')} />
                    <span className="text-[10px] text-ink-muted">{meta.label}</span>
                    {chip && ChipIcon && (
                      <span
                        className={cn(
                          'flex items-center gap-0.5 rounded-sm border px-1 text-[9px] font-bold uppercase tracking-wide',
                          DANGER_CHIP[chip.hi].className,
                        )}
                      >
                        <ChipIcon className="h-2.5 w-2.5" />
                        {rangeLabel(chip.lo, chip.hi, {
                          low: DANGER_CHIP.low.label,
                          medium: DANGER_CHIP.medium.label,
                          high: DANGER_CHIP.high.label,
                        })}
                      </span>
                    )}
                    {isVisited && !isHere && (
                      <Check className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-parchment-100 text-stat-HP" />
                    )}
                    {isHere && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-sm border border-gold-bright bg-wood-900 px-1 font-display text-[8px] font-bold uppercase tracking-wider text-gold-bright">
                        You
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {/* Route detail card — shown while hovering/focusing a choosable room (plan 2.3) */}
      {focusId && choices.includes(focusId) && (() => {
        const outlook = routeOutlook(map, focusId);
        const node = map.nodes[focusId];
        if (!outlook || !node) return null;
        const lo = realizedDanger + outlook.minDanger;
        const hi = realizedDanger + outlook.maxDanger;
        const dangerText = rangeLabel(classifyDanger(lo), classifyDanger(hi), {
          low: 'Low', medium: 'Medium', high: 'High',
        });
        const lootText = rangeLabel(rewardClassForDanger(lo), rewardClassForDanger(hi), LOOT_LABEL);
        return (
          <div className="rounded-md border border-gold-deep/40 bg-parchment-100/60 p-2.5 text-[11px]">
            <div className="mb-0.5 font-display font-bold text-ink">
              Through the {ROOM_ICON[node.room.type].label.toLowerCase()} room
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-ink-muted">
              <span>
                {outlook.minRooms === outlook.maxRooms
                  ? outlook.minRooms
                  : `${outlook.minRooms}–${outlook.maxRooms}`}{' '}
                room{outlook.maxRooms > 1 ? 's' : ''} to the checkpoint
              </span>
              <span>Danger: {dangerText}</span>
              <span>Loot outlook: {lootText}</span>
            </div>
          </div>
        );
      })()}
      {/* Merchant price preview — shown when a merchant is among the current choices */}
      {choices.some((id) => map.nodes[id]?.room.type === 'merchant') && (() => {
        const offers = merchantOffers(depth, merchantDiscount01);
        return (
          <div className="rounded-md border border-gold-deep/40 bg-parchment-100/60 p-2.5 text-[11px]">
            <div className="mb-1 font-display font-bold text-gold-deep">Merchant wares this floor</div>
            <ul className="space-y-0.5">
              {offers.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <span className="text-ink">{o.label}</span>
                  <span className="shrink-0 font-display font-bold text-gold-deep">{o.cost}g</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
      <p className="text-center text-[11px] text-ink-light">
        Tap a glowing room to enter it — your choice opens the paths it connects to. Riskier
        paths carry richer loot.
      </p>
      </div>
    </Panel>
  );
}
