// 2.5D isometric projection for the Homestead's SQUARE grid. Pure presentation math
// (no React/engine/store imports) — the square-grid sibling of src/components/tactics/iso.ts,
// which proved the SVG-polygon extrusion approach for the hex board. We project a (row, col)
// grid to a classic 2:1 diamond layout: +col goes down-right, +row goes down-left. Buildings
// extrude upward from each cell's ground diamond (see townArt.tsx); painter order (sortKey)
// gives correct occlusion because footprints never overlap.

/** Diamond width in viewBox units. */
export const TOWN_TILE_W = 64;
/** Vertical squash — 0.5 gives the classic 2:1 isometric diamond. */
export const TOWN_VSQUASH = 0.5;
/** Diamond height (2:1 of the width). */
export const TOWN_TILE_H = TOWN_TILE_W * TOWN_VSQUASH;

export interface Pt {
  x: number;
  y: number;
}

export interface IsoBounds {
  width: number;
  height: number;
  /** Offset added to every projected point so the whole grid sits inside [0, width]×[0, height]. */
  offsetX: number;
  offsetY: number;
}

/** Ground centre of cell (r, c). +col → down-right, +row → down-left. */
export function base(r: number, c: number): Pt {
  return { x: (c - r) * (TOWN_TILE_W / 2), y: (c + r) * (TOWN_TILE_H / 2) };
}

/**
 * Outline of a w×h footprint anchored at (0,0)'s cell — the four extreme corners of the
 * rhombus, relative to `base(r, c)` of the anchor (top-left) cell, in N/E/S/W order:
 *   N = north corner of the anchor cell        (topmost)
 *   E = east corner of the far-right column     (rightmost)
 *   S = south corner of the far corner cell      (bottommost)
 *   W = west corner of the far-bottom row        (leftmost)
 * For w=h=1 this is the single-cell diamond: (0,−H/2), (W/2,0), (0,H/2), (−W/2,0).
 */
export function diamondCorners(w = 1, h = 1): Pt[] {
  const HW = TOWN_TILE_W / 2;
  const HH = TOWN_TILE_H / 2;
  return [
    { x: 0, y: -HH },                          // N
    { x: w * HW, y: (w - 1) * HH },            // E
    { x: (w - h) * HW, y: (w + h - 1) * HH },  // S
    { x: -h * HW, y: (h - 1) * HH },           // W
  ];
}

/** Inverse projection: which cell (rounded) does a point in base-origin space fall in. */
export function cellFromPoint(x: number, y: number): { r: number; c: number } {
  const u = x / TOWN_TILE_W;
  const v = y / TOWN_TILE_H;
  return { r: Math.round(v - u), c: Math.round(u + v) };
}

/**
 * Painter-order key: cells further from the camera (larger r+c) paint later. The footprint's
 * far corner is (r+h-1, c+w-1), so the depth is (r+h-1)+(c+w-1); ties break by r. Multi-tile
 * footprints sort by their far edge, so a 2×2 at (0,0) paints before a 1×1 at (2,0).
 */
export function sortKey(r: number, c: number, w: number, h: number): number {
  const depth = (r + h - 1) + (c + w - 1);
  return depth * 100 + r; // r < 100 for every reachable grid — safe tie-break packing
}

/**
 * Bounding box for a rows×cols grid, with `headroom` extra units reserved at the top for the
 * tallest building extrusion. Mirrors tactics/iso.ts::isoBounds — every projected point plus the
 * per-cell diamond extent sits inside [0, width]×[0, height] once offsetX/offsetY are added.
 */
export function isoBounds(rows: number, cols: number, headroom: number): IsoBounds {
  const HW = TOWN_TILE_W / 2;
  const HH = TOWN_TILE_H / 2;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const b = base(r, c);
      minX = Math.min(minX, b.x - HW);
      maxX = Math.max(maxX, b.x + HW);
      minY = Math.min(minY, b.y - HH - headroom);
      maxY = Math.max(maxY, b.y + HH);
    }
  }
  const pad = 8;
  return {
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
    offsetX: -minX + pad,
    offsetY: -minY + pad,
  };
}
