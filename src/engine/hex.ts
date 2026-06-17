// Flat-top hexagon geometry for the Arena minigame. Pure math, no state — fully unit-tested
// in hex.test.ts. Uses axial coordinates (q, r); the orientation only matters when we convert
// to pixels (axialToPixel) and when we label the six directions for the keyboard/D-pad.
//
// Flat-top layout (a true Up and Down neighbour, which keyboards like):
//
//        up
//   upLeft  upRight
//        ( )
//  downLeft downRight
//       down
//
// Keyboard mapping the loop uses: W/S = up/down, Q/E = upLeft/upRight, A/D = downLeft/downRight.

export interface Hex {
  q: number;
  r: number;
}

export type HexDir = 'up' | 'down' | 'upLeft' | 'upRight' | 'downLeft' | 'downRight';

export const HEX_DIRS: HexDir[] = ['up', 'upRight', 'downRight', 'down', 'downLeft', 'upLeft'];

/** Axial offset for each direction under the flat-top layout (derived from axialToPixel). */
export const DIR_VECTORS: Record<HexDir, Hex> = {
  up: { q: 0, r: -1 },
  down: { q: 0, r: 1 },
  upRight: { q: 1, r: -1 },
  downRight: { q: 1, r: 0 },
  upLeft: { q: -1, r: 0 },
  downLeft: { q: -1, r: 1 },
};

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Step one hex from `origin` in `dir`. */
export function hexStep(origin: Hex, dir: HexDir): Hex {
  return hexAdd(origin, DIR_VECTORS[dir]);
}

/** Axial (cube) distance — the number of steps between two hexes. */
export function hexDistance(a: Hex, b: Hex): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/** The six hexes adjacent to `h`. */
export function hexNeighbors(h: Hex): Hex[] {
  return HEX_DIRS.map((d) => hexStep(h, d));
}

/** `len` hexes starting one step from `origin` along `dir` (the path a bolt or line attack covers). */
export function hexLine(origin: Hex, dir: HexDir, len: number): Hex[] {
  const out: Hex[] = [];
  let cur = origin;
  for (let i = 0; i < len; i++) {
    cur = hexStep(cur, dir);
    out.push(cur);
  }
  return out;
}

/** Every hex within `radius` of `center` (inclusive) — used for AoE/nova telegraphs. */
export function hexRange(center: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
}

/** All hexes of a hexagonal board of the given radius, centred on the origin. */
export function hexBoard(radius: number): Hex[] {
  return hexRange({ q: 0, r: 0 }, radius);
}

/** Whether a hex lies within a hexagonal board of the given radius. */
export function inBoard(h: Hex, radius: number): boolean {
  return Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r)) <= radius;
}

/**
 * Convert an axial hex to a pixel centre for a flat-top layout, where `size` is the hex radius
 * (centre to corner). The origin hex sits at (0, 0); the renderer offsets the whole board.
 */
export function axialToPixel(h: Hex, size: number): { x: number; y: number } {
  return {
    x: size * 1.5 * h.q,
    y: size * Math.sqrt(3) * (h.r + h.q / 2),
  };
}

/** Pixel bounding box of a flat-top board, so the overlay can size and centre it. */
export function boardPixelSize(radius: number, size: number): { width: number; height: number } {
  // Flat-top hex: width 2*size, height sqrt(3)*size. Columns step 1.5*size apart.
  const width = size * 1.5 * (2 * radius) + size * 2;
  const height = size * Math.sqrt(3) * (2 * radius) + size * Math.sqrt(3);
  return { width, height };
}

/** Pick the direction whose vector best reduces the distance from `from` toward `to` (boss chase). */
export function stepToward(from: Hex, to: Hex): HexDir {
  let best: HexDir = HEX_DIRS[0];
  let bestDist = Infinity;
  for (const dir of HEX_DIRS) {
    const d = hexDistance(hexStep(from, dir), to);
    if (d < bestDist) {
      bestDist = d;
      best = dir;
    }
  }
  return best;
}
