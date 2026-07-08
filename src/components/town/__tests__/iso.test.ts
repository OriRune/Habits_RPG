import { describe, it, expect } from 'vitest';
import {
  base,
  cellFromPoint,
  diamondCorners,
  isoBounds,
  sortKey,
  TOWN_TILE_W,
  TOWN_TILE_H,
} from '@/components/town/iso';

describe('town iso projection', () => {
  it('base → cellFromPoint round-trips over a grid', () => {
    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < 12; c++) {
        const p = base(r, c);
        expect(cellFromPoint(p.x, p.y)).toEqual({ r, c });
      }
    }
  });

  it('single-cell diamond is a 2:1 rhombus around the origin', () => {
    const [N, E, S, W] = diamondCorners(1, 1);
    expect(N).toEqual({ x: 0, y: -TOWN_TILE_H / 2 });
    expect(E).toEqual({ x: TOWN_TILE_W / 2, y: 0 });
    expect(S).toEqual({ x: 0, y: TOWN_TILE_H / 2 });
    expect(W).toEqual({ x: -TOWN_TILE_W / 2, y: 0 });
  });

  it('multi-tile footprint corners span the whole footprint', () => {
    // A 2×2 footprint anchored at (0,0): far (south) corner must reach cell (1,1)'s south.
    const [, , S] = diamondCorners(2, 2);
    const cell11 = base(1, 1);
    expect(S).toEqual({ x: cell11.x, y: cell11.y + TOWN_TILE_H / 2 });
  });
});

describe('sortKey painter order', () => {
  it('a 2×2 at (0,0) paints before a 1×1 at (2,0)', () => {
    expect(sortKey(0, 0, 2, 2)).toBeLessThan(sortKey(2, 0, 1, 1));
  });

  it('nearer cells (smaller r+c) paint before farther ones', () => {
    expect(sortKey(0, 0, 1, 1)).toBeLessThan(sortKey(1, 1, 1, 1));
    expect(sortKey(3, 2, 1, 1)).toBeLessThan(sortKey(4, 4, 1, 1));
  });

  it('breaks depth ties by row so an equal-depth tall footprint stays behind', () => {
    // Depth of a 1×3 at (0,0) far corner = (0)+(2) = 2; a 1×1 at (0,2) = (0)+(2) = 2.
    expect(sortKey(0, 0, 1, 3)).toBe(sortKey(0, 2, 1, 1));
    // But (2,0) 1×1 shares depth 2 with the 1×3 and must sort after it (larger r).
    expect(sortKey(0, 0, 1, 3)).toBeLessThan(sortKey(2, 0, 1, 1));
  });
});

describe('isoBounds', () => {
  it('contains every cell diamond corner once offset is applied', () => {
    const rows = 10;
    const cols = 10;
    const b = isoBounds(rows, cols, 40);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ctr = base(r, c);
        for (const corner of diamondCorners(1, 1)) {
          const x = ctr.x + corner.x + b.offsetX;
          const y = ctr.y + corner.y + b.offsetY;
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(b.width);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(b.height);
        }
      }
    }
  });

  it('reserves headroom above the grid for tall extrusions', () => {
    const withRoom = isoBounds(6, 6, 100);
    const noRoom = isoBounds(6, 6, 0);
    expect(withRoom.height).toBe(noRoom.height + 100);
    expect(withRoom.offsetY).toBe(noRoom.offsetY + 100);
  });
});
