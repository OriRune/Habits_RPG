import { describe, it, expect } from 'vitest';
import {
  board,
  boardPixelSize,
  cellEquals,
  cellToPixel,
  distance,
  inBoard,
  line,
  neighbors,
  range,
  step,
  stepToward,
  type Cell,
} from './grid';

const O: Cell = { x: 0, y: 0 };

describe('square grid geometry', () => {
  it('has eight distinct neighbours, all distance 1 (Chebyshev)', () => {
    const ns = neighbors(O);
    expect(ns).toHaveLength(8);
    expect(new Set(ns.map((c) => `${c.x},${c.y}`)).size).toBe(8);
    for (const n of ns) expect(distance(O, n)).toBe(1);
  });

  it('Chebyshev distance treats diagonals as one step', () => {
    expect(distance(O, O)).toBe(0);
    expect(distance(O, { x: 3, y: 0 })).toBe(3);
    expect(distance(O, { x: 3, y: 3 })).toBe(3); // pure diagonal
    expect(distance(O, { x: 3, y: 1 })).toBe(3);
  });

  it('cardinal and diagonal direction vectors point the right way', () => {
    expect(step(O, 'up')).toEqual({ x: 0, y: -1 });
    expect(step(O, 'left')).toEqual({ x: -1, y: 0 });
    expect(step(O, 'right')).toEqual({ x: 1, y: 0 });
    expect(step(O, 'upLeft')).toEqual({ x: -1, y: -1 });
    expect(step(O, 'downRight')).toEqual({ x: 1, y: 1 });
  });

  it('line walks `len` cells from the origin along a direction', () => {
    const l = line(O, 'right', 3);
    expect(l).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
    const diag = line(O, 'downRight', 2);
    expect(diag).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  });

  it('range(center, radius) is a (2r+1)^2 block within Chebyshev radius', () => {
    expect(range(O, 0)).toHaveLength(1);
    expect(range(O, 1)).toHaveLength(9);
    expect(range(O, 2)).toHaveLength(25);
    for (const c of range(O, 2)) expect(distance(O, c)).toBeLessThanOrEqual(2);
  });

  it('board / inBoard agree on a (2R+1)^2 square', () => {
    const radius = 3;
    const cells = board(radius);
    expect(cells).toHaveLength(49); // 7x7
    for (const c of cells) expect(inBoard(c, radius)).toBe(true);
    expect(inBoard({ x: radius + 1, y: 0 }, radius)).toBe(false);
    expect(inBoard({ x: 0, y: radius + 1 }, radius)).toBe(false);
  });

  it('cellToPixel and boardPixelSize scale by cell size', () => {
    expect(cellToPixel({ x: 2, y: -1 }, 10)).toEqual({ x: 20, y: -10 });
    expect(boardPixelSize(3, 10)).toEqual({ width: 70, height: 70 });
  });

  it('stepToward reduces distance to the target (diagonally when useful)', () => {
    const from: Cell = { x: -3, y: -2 };
    const to: Cell = { x: 2, y: 2 };
    const before = distance(from, to);
    const next = step(from, stepToward(from, to));
    expect(distance(next, to)).toBe(before - 1);
    // A pure diagonal target is approached diagonally.
    expect(stepToward(O, { x: 4, y: 4 })).toBe('downRight');
  });

  it('cellEquals distinguishes cells', () => {
    expect(cellEquals(O, { x: 0, y: 0 })).toBe(true);
    expect(cellEquals(O, { x: 1, y: 0 })).toBe(false);
  });
});
