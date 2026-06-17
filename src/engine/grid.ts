// Square-grid geometry for the Arena minigame (and any future square-board game). Pure math,
// no state — fully unit-tested in grid.test.ts. This is the square-grid sibling of hex.ts: an
// 8-neighbour grid using Chebyshev distance, so all eight surrounding cells count as adjacent.
//
// Coordinates are {x, y} with x = column (right positive) and y = row (down positive). The board
// is a (2R+1)×(2R+1) square centred on the origin. Keyboard maps W/A/S/D (or arrows) to the four
// cardinals; holding two adjacent keys yields a diagonal.

export interface Cell {
  x: number;
  y: number;
}

export type Dir =
  | 'up' | 'down' | 'left' | 'right'
  | 'upLeft' | 'upRight' | 'downLeft' | 'downRight';

export const DIRS: Dir[] = ['up', 'upRight', 'right', 'downRight', 'down', 'downLeft', 'left', 'upLeft'];

export const DIR_VECTORS: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  upLeft: { x: -1, y: -1 },
  upRight: { x: 1, y: -1 },
  downLeft: { x: -1, y: 1 },
  downRight: { x: 1, y: 1 },
};

export function cellAdd(a: Cell, b: Cell): Cell {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function cellEquals(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Step one cell from `origin` in `dir`. */
export function step(origin: Cell, dir: Dir): Cell {
  return cellAdd(origin, DIR_VECTORS[dir]);
}

/** Chebyshev distance — the number of king-moves between two cells (diagonals count as 1). */
export function distance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** The eight cells adjacent to `c`. */
export function neighbors(c: Cell): Cell[] {
  return DIRS.map((d) => step(c, d));
}

/** `len` cells starting one step from `origin` along `dir` (the path a bolt or line attack covers). */
export function line(origin: Cell, dir: Dir, len: number): Cell[] {
  const out: Cell[] = [];
  let cur = origin;
  for (let i = 0; i < len; i++) {
    cur = step(cur, dir);
    out.push(cur);
  }
  return out;
}

/** Every cell within Chebyshev `radius` of `center` (inclusive) — a (2r+1)² block. */
export function range(center: Cell, radius: number): Cell[] {
  const out: Cell[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      out.push({ x: center.x + dx, y: center.y + dy });
    }
  }
  return out;
}

/** All cells of a square board of the given radius, centred on the origin. */
export function board(radius: number): Cell[] {
  return range({ x: 0, y: 0 }, radius);
}

/** Whether a cell lies within a square board of the given radius. */
export function inBoard(c: Cell, radius: number): boolean {
  return Math.abs(c.x) <= radius && Math.abs(c.y) <= radius;
}

/** Convert a cell to a pixel top-left for a `size`-px square cell. The origin cell sits at (0, 0). */
export function cellToPixel(c: Cell, size: number): { x: number; y: number } {
  return { x: c.x * size, y: c.y * size };
}

/** Pixel size of a square board, so the overlay can size and centre it. */
export function boardPixelSize(radius: number, size: number): { width: number; height: number } {
  const span = (2 * radius + 1) * size;
  return { width: span, height: span };
}

/** Pick the direction (diagonals allowed) that most reduces the Chebyshev distance toward `to`. */
export function stepToward(from: Cell, to: Cell): Dir {
  let best: Dir = DIRS[0];
  let bestDist = Infinity;
  for (const dir of DIRS) {
    const d = distance(step(from, dir), to);
    if (d < bestDist) {
      bestDist = d;
      best = dir;
    }
  }
  return best;
}
