// 2.5D isometric projection for the Hex Tactics board. Pure presentation math (no engine state):
// we reuse the engine's flat-top axial→pixel layout, then tilt the camera down by squashing the
// vertical axis and lift each tile by its elevation so tiles render as extruded hex columns.
import { axialToPixel, hexBoard, type Hex } from '@/engine/hex';

/** Vertical squash that fakes a downward camera tilt (1 = flat top-down, smaller = more tilt). */
export const ISO_VSQUASH = 0.62;
/**
 * Column height per elevation level, as a fraction of tile size. Kept below the on-screen row step
 * (size·√3·ISO_VSQUASH ≈ size·1.07) so that, with the engine's OCCLUSION_RISE=2 cap, a front column
 * never rises far enough to hide the top of the tile behind it (2 · 0.47 = 0.94 < 1.07).
 */
export const COL_RATIO = 0.47;
/** Screen pixels of column height per elevation level at a given tile size. */
export function colHeight(size: number): number {
  return size * COL_RATIO;
}

export interface Pt {
  x: number;
  y: number;
}

/** Ground (base) screen position of a hex's centre, before any elevation lift. */
export function base(h: Hex, size: number): Pt {
  const p = axialToPixel(h, size);
  return { x: p.x, y: p.y * ISO_VSQUASH };
}

/** Centre of a tile's top face — its base lifted up by the column height. */
export function topCenter(h: Hex, size: number, elevation: number): Pt {
  const b = base(h, size);
  return { x: b.x, y: b.y - elevation * colHeight(size) };
}

/**
 * Corners of a flat-top hexagon centred at the origin, squashed by ISO_VSQUASH. Order:
 * right, upper-right, upper-left, left, lower-left, lower-right — matching axialToPixel so the
 * grid tessellates. Bottom three (left → lower-left → lower-right → right) are the column's
 * front silhouette that gets extruded downward.
 */
export function hexCorners(size: number): Pt[] {
  const h = (Math.sqrt(3) / 2) * size * ISO_VSQUASH;
  return [
    { x: size, y: 0 },        // right
    { x: size / 2, y: -h },   // upper-right
    { x: -size / 2, y: -h },  // upper-left
    { x: -size, y: 0 },       // left
    { x: -size / 2, y: h },   // lower-left
    { x: size / 2, y: h },    // lower-right
  ];
}

/** Pixel size of a hexagon's bounding box at this `size` (width, squashed height). */
export function hexExtent(size: number): { w: number; h: number } {
  return { w: 2 * size, h: Math.sqrt(3) * size * ISO_VSQUASH };
}

export interface IsoBounds {
  width: number;
  height: number;
  /** Offset added to every projected point so the whole board sits inside [0, width]×[0, height]. */
  offsetX: number;
  offsetY: number;
}

/**
 * Bounding box for a board of the given radius, accounting for the column-height headroom at the
 * top (tallest possible column) and the hex extent / a small lip at the bottom.
 */
export function isoBounds(radius: number, size: number, maxElevation: number): IsoBounds {
  const ext = hexExtent(size);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const hex of hexBoard(radius)) {
    const b = base(hex, size);
    // A tile may rise up to maxElevation; its base is the lowest it can sit.
    minX = Math.min(minX, b.x - ext.w / 2);
    maxX = Math.max(maxX, b.x + ext.w / 2);
    minY = Math.min(minY, b.y - ext.h / 2 - maxElevation * colHeight(size));
    maxY = Math.max(maxY, b.y + ext.h / 2);
  }
  const pad = 4;
  return {
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
    offsetX: -minX + pad,
    offsetY: -minY + pad,
  };
}
