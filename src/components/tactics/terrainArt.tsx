// Hex Tactics terrain art — the static, textured board layer.
//
// Follows the townArt.tsx pattern: one shared <defs> component, small pure prop composers,
// and deterministic per-tile variation (cellHash) so the board never flickers between renders.
// Everything here is presentation-only; the engine's Tile is read, never written.
//
// Layer contract (see TacticsOverlay): this file renders the EXPENSIVE nodes — extruded walls,
// textured top faces, terrain props — inside a React.memo boundary keyed on [tiles, size,
// offsets], so hover/selection re-renders never touch it. The overlay keeps a thin dynamic
// layer (transparent hit polygons, highlight strokes, threat tint) stacked above.
import { memo, type ReactNode } from 'react';
import type { Tile } from '@/engine/hexBattle';
import { hexKey } from '@/engine/hex';
import { base, topCenter, hexCorners, colHeight, type Pt } from './iso';
import { cellHash } from '@/lib/minigameArt';

// --- Shared color math (moved from TacticsOverlay so both layers agree on tile colors) ----------

/**
 * Tile top-face color: hue says terrain, lightness says elevation. Height is the mode's core
 * mechanic, so higher tiles read distinctly warmer/lighter — not just a deeper extrusion.
 * The warm shift (R grows fastest) keeps high ground feeling like sunlit ground.
 */
export function terrainRGB(t: Tile): [number, number, number] {
  const z = t.elevation;
  switch (t.terrain) {
    case 'blocked': return [60 + z * 12, 56 + z * 11, 64 + z * 9];
    case 'cover':   return [96 + z * 16, 72 + z * 14, 44 + z * 9];
    case 'slow':    return [52 + z * 14, 78 + z * 16, 48 + z * 8];
    case 'hazard':  return [120 + z * 14, 48 + z * 12, 36 + z * 8];
    default:        return [48 + z * 19, 58 + z * 17, 70 + z * 10];
  }
}
export const rgbStr = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
export const darken = (c: [number, number, number], f: number): string =>
  `rgb(${Math.round(c[0] * f)},${Math.round(c[1] * f)},${Math.round(c[2] * f)})`;
const lighten = (c: [number, number, number], add: number): string =>
  `rgb(${Math.min(255, c[0] + add)},${Math.min(255, c[1] + add)},${Math.min(255, c[2] + add)})`;
export const ptsAt = (corners: Pt[], cx: number, cy: number) =>
  corners.map((p) => `${cx + p.x},${cy + p.y}`).join(' ');

// --- Shared defs ---------------------------------------------------------------------------------

/**
 * Gradient definitions referenced by every tile — rendered ONCE at the top of the board <svg>.
 * objectBoundingBox units so one def maps onto each polygon's own bbox.
 */
export function TacticsArtDefs() {
  return (
    <defs>
      {/* Soft top-left light / bottom-right shade over each top face — turns flat fills into
          gently dished stone without per-tile gradient defs. */}
      <linearGradient id="tx-sheen" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.10" />
        <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="1" stopColor="#000000" stopOpacity="0.14" />
      </linearGradient>
      {/* Ember pool at the heart of hazard tiles. */}
      <radialGradient id="tx-ember" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#fbbf24" stopOpacity="0.85" />
        <stop offset="0.55" stopColor="#f97316" stopOpacity="0.5" />
        <stop offset="1" stopColor="#7c2d12" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

// --- Terrain prop composers ------------------------------------------------------------------
// Each returns decoration for one tile, centred on `c` (the tile's top-face centre), sized by
// the tile radius `s`, with all randomness derived from cellHash(q, r) so re-renders are
// pixel-identical. Fixed low-alpha detail colors read correctly over any elevation lightness.

/** Speckles + occasional hairline crack on plain floor — most tiles stay clean. */
function floorProps(tile: Tile, c: Pt, s: number): ReactNode {
  const h = cellHash(tile.hex.q, tile.hex.r);
  const h2 = cellHash(tile.hex.r + 31, tile.hex.q - 17);
  const nodes: ReactNode[] = [];
  if (h < 0.45) {
    nodes.push(
      <circle key="sp1" cx={c.x + (h - 0.22) * s * 1.3} cy={c.y + (h2 - 0.5) * s * 0.5} r={s * 0.05} fill="rgba(0,0,0,0.20)" />,
      <circle key="sp2" cx={c.x + (h2 - 0.55) * s * 1.1} cy={c.y + (h - 0.2) * s * 0.45} r={s * 0.035} fill="rgba(0,0,0,0.16)" />,
    );
  }
  if (h > 0.86) {
    // Hairline, asymmetric — a crack must never read as a UI arrow.
    const x0 = c.x - s * 0.38, y0 = c.y + (h2 - 0.5) * s * 0.3;
    nodes.push(
      <path
        key="crack"
        d={`M ${x0} ${y0} l ${s * 0.22} ${s * 0.09} l ${s * 0.18} ${-s * 0.03} l ${s * 0.24} ${s * 0.07}`}
        fill="none" stroke="rgba(0,0,0,0.14)" strokeWidth={s * 0.028} strokeLinecap="round"
      />,
    );
  }
  return nodes.length > 0 ? <>{nodes}</> : null;
}

/** Low stone barricade — a stacked wall + flanking stone reads as "defensible" without an icon.
 *  Hash flips which side the loose stone sits on. */
function coverProps(tile: Tile, c: Pt, s: number): ReactNode {
  const h = cellHash(tile.hex.q, tile.hex.r);
  const flip = h < 0.5 ? 1 : -1;
  const slab = (dx: number, dy: number, w: number, ht: number, front: string, topF: string, key: string): ReactNode => {
    const x = c.x + dx, y = c.y + dy;
    const skew = w * 0.12 * flip;
    return (
      <g key={key}>
        {/* front face */}
        <path d={`M ${x - w / 2} ${y} l ${w} 0 l 0 ${-ht} l ${-w} 0 Z`} fill={front} stroke="rgba(0,0,0,0.4)" strokeWidth={0.75} />
        {/* lit top (skewed for the iso look) */}
        <path d={`M ${x - w / 2} ${y - ht} l ${skew} ${-ht * 0.45} l ${w} 0 l ${-skew} ${ht * 0.45} Z`} fill={topF} stroke="rgba(0,0,0,0.35)" strokeWidth={0.75} />
      </g>
    );
  };
  return (
    <g>
      {slab(0, s * 0.26, s * 0.95, s * 0.26, '#4e3a20', '#7d5f3a', 'base')}
      {slab(s * 0.02 * flip, 0, s * 0.7, s * 0.22, '#5a4426', '#8a6a42', 'top')}
      {/* loose stone at the wall's foot */}
      <ellipse cx={c.x + s * 0.46 * flip} cy={c.y + s * 0.3} rx={s * 0.13} ry={s * 0.09} fill="#6b5233" stroke="rgba(0,0,0,0.35)" strokeWidth={0.75} />
    </g>
  );
}

/** 2–3 grass tufts, hash-jittered; each carries tx-sway for the living-board pass. */
function slowProps(tile: Tile, c: Pt, s: number): ReactNode {
  const h = cellHash(tile.hex.q, tile.hex.r);
  const h2 = cellHash(tile.hex.r + 7, tile.hex.q + 13);
  const tuft = (x: number, y: number, ht: number, dark: boolean, key: string): ReactNode => (
    <g
      key={key}
      className="tx-sway"
      style={{ transformBox: 'fill-box', transformOrigin: '50% 100%', animationDelay: `${((x + y) % 3).toFixed(2)}s` }}
    >
      <path
        d={`M ${x} ${y} q ${-ht * 0.45} ${-ht * 0.6} ${-ht * 0.35} ${-ht}`}
        fill="none" stroke={dark ? '#3f6a2e' : '#5c8f3f'} strokeWidth={s * 0.07} strokeLinecap="round"
      />
      <path
        d={`M ${x} ${y} q 0 ${-ht * 0.7} ${ht * 0.08} ${-ht * 1.1}`}
        fill="none" stroke={dark ? '#4e7d3a' : '#6fa14c'} strokeWidth={s * 0.07} strokeLinecap="round"
      />
      <path
        d={`M ${x} ${y} q ${ht * 0.4} ${-ht * 0.55} ${ht * 0.32} ${-ht * 0.9}`}
        fill="none" stroke={dark ? '#3f6a2e' : '#5c8f3f'} strokeWidth={s * 0.06} strokeLinecap="round"
      />
    </g>
  );
  return (
    <g>
      {tuft(c.x - s * 0.32 + h * s * 0.2, c.y + s * 0.24, s * 0.42, false, 't1')}
      {tuft(c.x + s * 0.26 - h2 * s * 0.2, c.y + s * 0.1, s * 0.34, true, 't2')}
      {h > 0.4 && tuft(c.x + (h2 - 0.5) * s * 0.5, c.y + s * 0.34, s * 0.28, h2 < 0.5, 't3')}
    </g>
  );
}

/** Teardrop flame path pointing up from (cx, cy). */
function flamePath(cx: number, cy: number, ht: number): string {
  return (
    `M ${cx} ${cy}` +
    ` C ${cx - ht * 0.5} ${cy - ht * 0.25}, ${cx - ht * 0.18} ${cy - ht * 0.75}, ${cx} ${cy - ht}` +
    ` C ${cx + ht * 0.18} ${cy - ht * 0.75}, ${cx + ht * 0.5} ${cy - ht * 0.25}, ${cx} ${cy} Z`
  );
}

/** Ember pool + flame licks. The group flickers in the living-board pass. */
function hazardProps(tile: Tile, c: Pt, s: number, corners: Pt[]): ReactNode {
  const h = cellHash(tile.hex.q, tile.hex.r);
  const inset = corners.map((p) => `${c.x + p.x * 0.62},${c.y + p.y * 0.62}`).join(' ');
  return (
    <g data-prop="hazard-glow" className="tx-flicker" style={{ transformBox: 'fill-box', transformOrigin: '50% 80%', animationDelay: `${(h * 1.7).toFixed(2)}s` }}>
      <polygon points={inset} fill="url(#tx-ember)" />
      <path d={flamePath(c.x - s * 0.16, c.y + s * 0.14, s * (0.34 + h * 0.12))} fill="#fb923c" opacity={0.92} />
      <path d={flamePath(c.x + s * 0.15, c.y + s * 0.18, s * 0.26)} fill="#fbbf24" opacity={0.9} />
      <path d={flamePath(c.x + s * 0.01, c.y + s * 0.16, s * 0.16)} fill="#fde68a" opacity={0.95} />
    </g>
  );
}

/** Faceted crag on wall tiles — dark/lit facets + ridge highlight; hash picks a silhouette. */
function blockedProps(tile: Tile, c: Pt, s: number, rgb: [number, number, number]): ReactNode {
  const h = cellHash(tile.hex.q, tile.hex.r);
  const dark = darken(rgb, 0.68);
  const lit = lighten(rgb, 26);
  // Two silhouettes: a single peak vs a split double-peak.
  if (h < 0.5) {
    const apex = { x: c.x - s * 0.05, y: c.y - s * 0.62 };
    return (
      <g>
        <path d={`M ${c.x - s * 0.55} ${c.y + s * 0.28} L ${apex.x} ${apex.y} L ${c.x + s * 0.05} ${c.y + s * 0.32} Z`} fill={dark} stroke="rgba(0,0,0,0.4)" strokeWidth={0.75} />
        <path d={`M ${apex.x} ${apex.y} L ${c.x + s * 0.55} ${c.y + s * 0.2} L ${c.x + s * 0.05} ${c.y + s * 0.32} Z`} fill={lit} stroke="rgba(0,0,0,0.35)" strokeWidth={0.75} />
        <path d={`M ${apex.x} ${apex.y} L ${c.x + s * 0.05} ${c.y + s * 0.32}`} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={s * 0.045} />
      </g>
    );
  }
  return (
    <g>
      <path d={`M ${c.x - s * 0.6} ${c.y + s * 0.26} L ${c.x - s * 0.28} ${c.y - s * 0.5} L ${c.x - s * 0.02} ${c.y + s * 0.3} Z`} fill={dark} stroke="rgba(0,0,0,0.4)" strokeWidth={0.75} />
      <path d={`M ${c.x - s * 0.28} ${c.y - s * 0.5} L ${c.x - s * 0.02} ${c.y + s * 0.3} L ${c.x - s * 0.08} ${c.y - s * 0.42} Z`} fill={lit} opacity={0.8} />
      <path d={`M ${c.x - s * 0.05} ${c.y + s * 0.28} L ${c.x + s * 0.24} ${c.y - s * 0.34} L ${c.x + s * 0.58} ${c.y + s * 0.22} Z`} fill={lit} stroke="rgba(0,0,0,0.35)" strokeWidth={0.75} />
      <path d={`M ${c.x - s * 0.05} ${c.y + s * 0.28} L ${c.x + s * 0.24} ${c.y - s * 0.34}`} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={s * 0.04} />
    </g>
  );
}

function terrainProps(tile: Tile, c: Pt, s: number, corners: Pt[], rgb: [number, number, number]): ReactNode {
  switch (tile.terrain) {
    case 'cover': return coverProps(tile, c, s);
    case 'slow': return slowProps(tile, c, s);
    case 'hazard': return hazardProps(tile, c, s, corners);
    case 'blocked': return blockedProps(tile, c, s, rgb);
    default: return floorProps(tile, c, s);
  }
}

// --- Per-tile static art ---------------------------------------------------------------------

function TileArt({ tile, size, corners }: { tile: Tile; size: number; corners: Pt[] }) {
  const c = topCenter(tile.hex, size, tile.elevation);
  const rgb = terrainRGB(tile);
  const E = tile.elevation * colHeight(size);
  const pts = ptsAt(corners, c.x, c.y);

  const wall = (a: number, b: number, fill: string) => {
    const pa = corners[a];
    const pb = corners[b];
    const quad = [
      `${c.x + pa.x},${c.y + pa.y}`,
      `${c.x + pb.x},${c.y + pb.y}`,
      `${c.x + pb.x},${c.y + pb.y + E}`,
      `${c.x + pa.x},${c.y + pa.y + E}`,
    ].join(' ');
    return <polygon key={`w${a}`} points={quad} fill={fill} />;
  };

  // Front silhouette (corners 3→4→5→0) — used by the sunlit lip and the wall-base shade line.
  const frontPath = (dy: number) =>
    `M ${c.x + corners[3].x} ${c.y + corners[3].y + dy}` +
    ` L ${c.x + corners[4].x} ${c.y + corners[4].y + dy}` +
    ` L ${c.x + corners[5].x} ${c.y + corners[5].y + dy}` +
    ` L ${c.x + corners[0].x} ${c.y + corners[0].y + dy}`;

  return (
    <g>
      {E > 0 && (
        <>
          {wall(3, 4, darken(rgb, 0.55))}
          {wall(4, 5, darken(rgb, 0.42))}
          {wall(5, 0, darken(rgb, 0.72))}
          {/* grounding shade where the column meets the floor */}
          <path d={frontPath(E)} fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth={1.5} />
        </>
      )}
      <polygon points={pts} fill={rgbStr(rgb)} stroke="rgba(0,0,0,0.4)" strokeWidth={1} />
      {/* dished-stone sheen over the flat fill */}
      <polygon points={pts} fill="url(#tx-sheen)" />
      {/* sunlit lip along the front edges of raised ground — height reads as lit geometry */}
      {E > 0 && <path d={frontPath(0)} fill="none" stroke="rgba(255,226,170,0.28)" strokeWidth={1.25} />}
      {terrainProps(tile, c, size, corners, rgb)}
    </g>
  );
}

// --- The memo boundary -----------------------------------------------------------------------

/**
 * All static board art, depth-sorted (same order as the overlay's dynamic layer so walls occlude
 * consistently). Re-renders only when the match's tiles object, the tile size, or the board
 * offsets change — hover/selection/threat updates never touch these ~900 nodes.
 */
export const StaticTerrainLayer = memo(function StaticTerrainLayer({
  tiles, size, offsetX, offsetY,
}: { tiles: Record<string, Tile>; size: number; offsetX: number; offsetY: number }) {
  const corners = hexCorners(size);
  const sorted = Object.values(tiles)
    .slice()
    .sort((a, b) => base(a.hex, size).y - base(b.hex, size).y || a.hex.q - b.hex.q);
  return (
    <g transform={`translate(${offsetX},${offsetY})`} pointerEvents="none">
      {sorted.map((tile) => (
        <TileArt key={hexKey(tile.hex)} tile={tile} size={size} corners={corners} />
      ))}
    </g>
  );
});
