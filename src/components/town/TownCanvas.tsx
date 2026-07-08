// ============================================================================
//  TOWN CANVAS — the Homestead's isometric SVG renderer.
// ============================================================================
//
//  One <svg viewBox> sized by isoBounds(gridSizeFor(deeds max)); a wrapping
//  <g ref> whose transform is written DIRECTLY inside pointer handlers (no rAF,
//  no per-move setState — the Mine's ref-DOM idiom) and committed to React state
//  only on gesture end. Four layers: ground (memoized diamonds), highlight
//  (the placement ghost footprint), objects (buildings / decor / queued
//  scaffolds, painter-sorted), and fx (completion sparkle + deed unfold, skipped
//  under prefers-reduced-motion).
//
//  Hit-testing: the pan gesture takes a pointer capture on the <svg>, so per-cell
//  onPointerUp never fires while a gesture is live. Taps are therefore resolved at
//  the svg level — a clean tap (gesture moved ≤ 8px) is inverse-projected through
//  the live view transform to a grid cell (cellFromPoint). A tap on a building's
//  footprint opens its card (unless a ghost is active); any other tap moves the
//  active placement ghost.
//
//  Forward-compat: this renderer reads ONLY the town payload passed as props —
//  never character/gear slices — so a future party-visit can reuse it verbatim.
// ============================================================================
import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent, type WheelEvent } from 'react';
import { type TownState, gridSizeFor, inUnlockedLand } from '@/engine/town';
import { TOWN_BUILDINGS } from '@/content/townBuildings';
import { TOWN_DECOR } from '@/content/townDecor';
import { base, diamondCorners, cellFromPoint, isoBounds, sortKey, TOWN_TILE_W, TOWN_TILE_H, type Pt } from './iso';
import { TownArtDefs, buildingArt, decorArt, cobblePath, scaffold } from './townArt';

/** Headroom above the grid for the tallest building extrusion (keep + banner). */
const HEADROOM = TOWN_TILE_W * 2.2;
const SCALE_MIN = 0.5;
const SCALE_MAX = 2.0;
/** The absolute grid is the deed-3 square; locked districts render desaturated inside it. */
const MAX_GRID = gridSizeFor(3);

/** A placement ghost footprint anchored at (r,c), tinted emerald (valid) or ember (invalid). */
export interface TownGhost {
  r: number;
  c: number;
  w: number;
  h: number;
  ok: boolean;
}

interface TownCanvasProps {
  town: TownState;
  /** A clean tap (gesture moved ≤ 8px) on a ground cell — moves the active placement ghost. */
  onCellTap?: (r: number, c: number) => void;
  /** A clean tap on a completed building's footprint (only when no ghost is active). */
  onBuildingTap?: (buildingId: string) => void;
  /** The live placement ghost, rendered in the highlight layer. */
  ghost?: TownGhost | null;
}

function ptsStr(points: Pt[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

function hashVariant(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 4;
}

// ---------------------------------------------------------------------------
// Ground layer — static during pan/zoom, so memoize on `deeds`.
// ---------------------------------------------------------------------------

const GroundLayer = memo(function GroundLayer({ deeds }: { deeds: number }) {
  const cells: ReactNode[] = [];
  for (let r = 0; r < MAX_GRID.rows; r++) {
    for (let c = 0; c < MAX_GRID.cols; c++) {
      const b = base(r, c);
      const corners = diamondCorners(1, 1).map((p) => ({ x: b.x + p.x, y: b.y + p.y }));
      const unlocked = inUnlockedLand(deeds, r, c);
      // Two-step lightness checker; locked land desaturated behind the deed boundary.
      const fill = unlocked
        ? ((r + c) % 2 === 0 ? '#4b7a52' : '#3f6b4a')
        : ((r + c) % 2 === 0 ? '#3c423c' : '#343a34');
      cells.push(
        <polygon
          key={`g-${r}-${c}`}
          points={ptsStr(corners)}
          fill={fill}
          stroke="rgba(0,0,0,0.22)"
          strokeWidth={0.5}
        />,
      );
    }
  }
  // Dashed boundary around the currently unlocked square.
  const { rows, cols } = gridSizeFor(deeds);
  const outline = diamondCorners(cols, rows);
  cells.push(
    <polygon
      key="deed-boundary"
      points={ptsStr(outline)}
      fill="none"
      stroke="rgb(var(--c-gold-bright))"
      strokeOpacity={0.7}
      strokeWidth={1.5}
      strokeDasharray="6 5"
      style={{ pointerEvents: 'none' }}
    />,
  );
  return <g style={{ pointerEvents: 'none' }}>{cells}</g>;
});

// ---------------------------------------------------------------------------
// Progress ring for queued projects (build scaffold + upgrade-in-place).
// ---------------------------------------------------------------------------

function ProgressRing({ frac }: { frac: number }): ReactNode {
  const R = 13;
  const C = 2 * Math.PI * R;
  const shown = Math.max(0, Math.min(1, frac));
  return (
    <g>
      <circle r={R} fill="rgba(0,0,0,0.28)" stroke="rgba(0,0,0,0.4)" strokeWidth={3} />
      <circle
        r={R}
        fill="none"
        stroke="rgb(var(--c-gold-bright))"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={`${C * shown} ${C}`}
        transform="rotate(-90)"
      />
    </g>
  );
}

/** Centre offset of a w×h footprint's ring, above the ground plane. */
function ringOffset(w: number, h: number): Pt {
  return {
    x: ((w - h) * TOWN_TILE_W) / 4,
    y: ((w + h - 2) * TOWN_TILE_H) / 4 - 26,
  };
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export function TownCanvas({ town, onCellTap, onBuildingTap, ghost }: TownCanvasProps) {
  const bounds = useMemo(() => isoBounds(MAX_GRID.rows, MAX_GRID.cols, HEADROOM), []);

  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const pointers = useRef(new Map<number, Pt>());
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const movedRef = useRef(0);
  const viewRef = useRef({ x: 0, y: 0, scale: 1 });
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });

  // Stable tap callbacks (read via ref so the objects memo need not depend on them).
  const cellTapRef = useRef(onCellTap);
  cellTapRef.current = onCellTap;
  const buildingTapRef = useRef(onBuildingTap);
  buildingTapRef.current = onBuildingTap;
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;

  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const clampScale = (s: number) => Math.max(SCALE_MIN, Math.min(SCALE_MAX, s));

  const applyTransform = () => {
    const g = worldRef.current;
    if (g) {
      const v = viewRef.current;
      g.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.scale})`);
    }
  };

  /** viewBox units per client pixel — pointer deltas are in client space. */
  const vbPerPx = () => {
    const svg = svgRef.current;
    if (!svg) return 1;
    const rect = svg.getBoundingClientRect();
    return rect.width ? bounds.width / rect.width : 1;
  };

  const zoomAnchored = (nextScale: number, vx: number, vy: number) => {
    const v = viewRef.current;
    const wx = (vx - v.x) / v.scale;
    const wy = (vy - v.y) / v.scale;
    v.scale = nextScale;
    v.x = vx - nextScale * wx;
    v.y = vy - nextScale * wy;
    applyTransform();
  };

  /** Which building (if any) owns the footprint cell (r,c). */
  const buildingAt = (r: number, c: number): string | undefined => {
    for (const b of town.buildings) {
      const def = TOWN_BUILDINGS[b.key];
      if (!def) continue;
      if (r >= b.r && r < b.r + def.h && c >= b.c && c < b.c + def.w) return b.id;
    }
    return undefined;
  };

  /** Inverse-project a client point through the live view transform to a grid cell. */
  const cellAt = (clientX: number, clientY: number): { r: number; c: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const k = vbPerPx();
    const vbx = (clientX - rect.left) * k;
    const vby = (clientY - rect.top) * k;
    const v = viewRef.current;
    const wx = (vbx - v.x) / v.scale - bounds.offsetX;
    const wy = (vby - v.y) / v.scale - bounds.offsetY;
    const { r, c } = cellFromPoint(wx, wy);
    if (r < 0 || c < 0 || r >= MAX_GRID.rows || c >= MAX_GRID.cols) return null;
    return { r, c };
  };

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedRef.current = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: viewRef.current.scale };
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    const k = vbPerPx();
    if (pointers.current.size >= 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchRef.current.dist > 0) {
        const svg = svgRef.current;
        const rect = svg ? svg.getBoundingClientRect() : { left: 0, top: 0 };
        const mx = ((a.x + b.x) / 2 - rect.left) * k;
        const my = ((a.y + b.y) / 2 - rect.top) * k;
        zoomAnchored(clampScale(pinchRef.current.scale * (dist / pinchRef.current.dist)), mx, my);
      }
      movedRef.current += 12;
    } else if (pointers.current.size === 1) {
      viewRef.current.x += (cur.x - prev.x) * k;
      viewRef.current.y += (cur.y - prev.y) * k;
      movedRef.current += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
      applyTransform();
    }
  };

  const endPointer = (e: PointerEvent) => {
    const tap = movedRef.current <= 8 && pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) {
      setView({ ...viewRef.current });
      if (tap) {
        const cell = cellAt(e.clientX, e.clientY);
        if (cell) {
          // A building tap opens its card, but only when no ghost is being placed —
          // during placement every tap moves the ghost.
          if (!ghostRef.current) {
            const bid = buildingAt(cell.r, cell.c);
            if (bid) { buildingTapRef.current?.(bid); return; }
          }
          cellTapRef.current?.(cell.r, cell.c);
        }
      }
    }
  };

  const onWheel = (e: WheelEvent) => {
    const svg = svgRef.current;
    const rect = svg ? svg.getBoundingClientRect() : { left: 0, top: 0 };
    const k = vbPerPx();
    const vx = (e.clientX - rect.left) * k;
    const vy = (e.clientY - rect.top) * k;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAnchored(clampScale(viewRef.current.scale * factor), vx, vy);
    setView({ ...viewRef.current });
  };

  // ---- fx: completion sparkle on tier-up, deed unfold shimmer ----
  const prevTiers = useRef<Map<string, number> | null>(null);
  const [sparkles, setSparkles] = useState<{ key: number; x: number; y: number }[]>([]);
  useEffect(() => {
    const cur = new Map(town.buildings.map((b) => [b.id, b.tier]));
    const prev = prevTiers.current;
    prevTiers.current = cur;
    if (prev === null || reducedMotion) return; // skip the first mount (no sparkle storm)
    const born: { key: number; x: number; y: number }[] = [];
    for (const b of town.buildings) {
      const p = prev.get(b.id);
      if (p === undefined || b.tier > p) {
        const def = TOWN_BUILDINGS[b.key];
        const off = ringOffset(def?.w ?? 1, def?.h ?? 1);
        const pt = base(b.r, b.c);
        born.push({ key: Math.random(), x: pt.x + off.x, y: pt.y + off.y });
      }
    }
    if (born.length === 0) return;
    setSparkles((s) => [...s, ...born]);
    const bornKeys = new Set(born.map((b) => b.key));
    const t = setTimeout(() => setSparkles((s) => s.filter((x) => !bornKeys.has(x.key))), 1000);
    return () => clearTimeout(t);
  }, [town.buildings, reducedMotion]);

  const prevDeeds = useRef(town.deeds);
  const [unfold, setUnfold] = useState<{ deeds: number; key: number } | null>(null);
  useEffect(() => {
    if (town.deeds > prevDeeds.current && !reducedMotion) {
      setUnfold({ deeds: town.deeds, key: Date.now() });
      const t = setTimeout(() => setUnfold(null), 1200);
      prevDeeds.current = town.deeds;
      return () => clearTimeout(t);
    }
    prevDeeds.current = town.deeds;
  }, [town.deeds, reducedMotion]);

  // ---- Objects layer: buildings, decor, and queued projects, painter-sorted ----
  const objects = useMemo(() => {
    const items: { key: string; sort: number; node: ReactNode }[] = [];
    // Upgrade rings are keyed by target building id so the ring paints over the building.
    const upgradeRing = new Map<string, number>();
    for (const proj of town.queue) {
      if (proj.kind === 'upgrade' && proj.buildingId) {
        upgradeRing.set(proj.buildingId, proj.laborApplied / Math.max(1, proj.laborNeed));
      }
    }

    for (const b of town.buildings) {
      const def = TOWN_BUILDINGS[b.key];
      if (!def) continue;
      const p = base(b.r, b.c);
      const mirror = b.rot === 1 ? ' scale(-1,1)' : '';
      const ring = upgradeRing.get(b.id);
      const off = ring !== undefined ? ringOffset(def.w, def.h) : null;
      items.push({
        key: `b-${b.id}`,
        sort: sortKey(b.r, b.c, def.w, def.h),
        node: (
          <g key={`b-${b.id}`}>
            <g transform={`translate(${p.x} ${p.y})${mirror}`}>
              {buildingArt(def.artKey, def.w, def.h, b.tier, hashVariant(b.id))}
            </g>
            {off && (
              <g transform={`translate(${p.x + off.x} ${p.y + off.y})`}>
                <ProgressRing frac={ring!} />
              </g>
            )}
          </g>
        ),
      });
    }

    // Cobble paths auto-connect: collect all path cells so each tile can stub toward its
    // orthogonal path neighbours (adjacency computed here, in plain code, from the decor list).
    const pathCells = new Set<string>();
    for (const d of town.decor) {
      if (TOWN_DECOR[d.key]?.artKey === 'cobble_path') pathCells.add(`${d.r},${d.c}`);
    }

    for (let i = 0; i < town.decor.length; i++) {
      const d = town.decor[i];
      const def = TOWN_DECOR[d.key];
      if (!def) continue;
      const p = base(d.r, d.c);
      const art = def.artKey === 'cobble_path'
        ? cobblePath({
            n: pathCells.has(`${d.r - 1},${d.c}`),
            e: pathCells.has(`${d.r},${d.c + 1}`),
            s: pathCells.has(`${d.r + 1},${d.c}`),
            w: pathCells.has(`${d.r},${d.c - 1}`),
          })
        : decorArt(def.artKey, d.v ?? 0);
      items.push({
        key: `d-${i}`,
        sort: sortKey(d.r, d.c, def.w, def.h),
        node: (
          <g key={`d-${i}`} transform={`translate(${p.x} ${p.y})`}>
            {art}
          </g>
        ),
      });
    }

    for (const proj of town.queue) {
      if (proj.kind !== 'build' || proj.r === undefined || proj.c === undefined) continue;
      const def = TOWN_BUILDINGS[proj.key];
      if (!def) continue;
      const p = base(proj.r, proj.c);
      const off = ringOffset(def.w, def.h);
      const frac = proj.laborApplied / Math.max(1, proj.laborNeed);
      items.push({
        key: `p-${proj.id}`,
        sort: sortKey(proj.r, proj.c, def.w, def.h),
        node: (
          <g key={`p-${proj.id}`} transform={`translate(${p.x} ${p.y})`}>
            {scaffold(def.w, def.h)}
            <g transform={`translate(${off.x} ${off.y})`}>
              <ProgressRing frac={frac} />
            </g>
          </g>
        ),
      });
    }

    items.sort((a, b) => a.sort - b.sort);
    return items.map((it) => it.node);
  }, [town.buildings, town.decor, town.queue]);

  // ---- Highlight layer: the placement ghost footprint ----
  const ghostNode = useMemo(() => {
    if (!ghost) return null;
    const p = base(ghost.r, ghost.c);
    const corners = diamondCorners(ghost.w, ghost.h).map((pt) => ({ x: p.x + pt.x, y: p.y + pt.y }));
    const fill = ghost.ok ? 'rgba(64,196,128,0.42)' : 'rgb(var(--c-ember))';
    const stroke = ghost.ok ? 'rgb(64,196,128)' : 'rgb(var(--c-ember-bright))';
    return (
      <polygon
        points={ptsStr(corners)}
        fill={fill}
        fillOpacity={ghost.ok ? 1 : 0.4}
        stroke={stroke}
        strokeWidth={2}
        style={{ pointerEvents: 'none' }}
      />
    );
  }, [ghost]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${bounds.width} ${bounds.height}`}
      className="w-full select-none"
      style={{ touchAction: 'none', maxHeight: '70vh' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onWheel={onWheel}
    >
      <TownArtDefs />
      <g
        ref={worldRef}
        transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}
      >
        <g transform={`translate(${bounds.offsetX} ${bounds.offsetY})`}>
          {/* (a) ground */}
          <GroundLayer deeds={town.deeds} />
          {/* (b) highlight — the placement ghost */}
          <g className="town-highlight">{ghostNode}</g>
          {/* (c) objects */}
          <g className="town-objects">{objects}</g>
          {/* (d) fx — skipped under reduced motion */}
          {!reducedMotion && (
            <g className="town-fx" style={{ pointerEvents: 'none' }}>
              {unfold && (() => {
                const { rows, cols } = gridSizeFor(unfold.deeds);
                return (
                  <polygon
                    key={unfold.key}
                    points={ptsStr(diamondCorners(cols, rows))}
                    fill="rgb(var(--c-gold-bright))"
                    stroke="rgb(var(--c-gold-bright))"
                    strokeWidth={2}
                    style={{ animation: 'town-unfold 1.1s ease-out forwards', transformOrigin: 'center' }}
                  />
                );
              })()}
              {sparkles.map((s) => (
                <g key={s.key} transform={`translate(${s.x} ${s.y})`} style={{ animation: 'town-sparkle-burst 1s ease-out forwards' }}>
                  <circle cx={0} cy={-6} r={2.5} fill="rgb(var(--c-gold-bright))" />
                  <circle cx={-8} cy={2} r={2} fill="rgb(var(--c-gold-bright))" />
                  <circle cx={9} cy={-1} r={2} fill="rgb(var(--c-gold-bright))" />
                  <circle cx={2} cy={8} r={1.8} fill="rgb(var(--c-gold-bright))" />
                </g>
              ))}
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}
