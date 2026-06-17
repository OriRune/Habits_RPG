import { describe, it, expect } from 'vitest';
import {
  axialToPixel,
  DIR_VECTORS,
  hexBoard,
  hexDistance,
  hexEquals,
  hexKey,
  hexLine,
  hexLineBetween,
  hexNeighbors,
  hexRange,
  hexStep,
  inBoard,
  stepToward,
  type Hex,
} from './hex';

const O: Hex = { q: 0, r: 0 };

describe('hex geometry', () => {
  it('distance is 0 to self and 1 to each neighbour', () => {
    expect(hexDistance(O, O)).toBe(0);
    for (const n of hexNeighbors(O)) {
      expect(hexDistance(O, n)).toBe(1);
    }
  });

  it('has six distinct neighbours', () => {
    const ns = hexNeighbors(O);
    expect(ns).toHaveLength(6);
    const uniq = new Set(ns.map((h) => `${h.q},${h.r}`));
    expect(uniq.size).toBe(6);
  });

  it('direction vectors match pixel geometry (up is straight up, down is straight down)', () => {
    const up = axialToPixel(hexStep(O, 'up'), 10);
    const down = axialToPixel(hexStep(O, 'down'), 10);
    expect(up.x).toBeCloseTo(0); // straight up: no horizontal shift
    expect(up.y).toBeLessThan(0);
    expect(down.x).toBeCloseTo(0);
    expect(down.y).toBeGreaterThan(0);
    // upRight is to the right and above the origin; downLeft mirrors it.
    const upRight = axialToPixel(hexStep(O, 'upRight'), 10);
    expect(upRight.x).toBeGreaterThan(0);
    expect(upRight.y).toBeLessThan(0);
  });

  it('hexLine walks `len` hexes from the origin along a direction', () => {
    const line = hexLine(O, 'up', 3);
    expect(line).toHaveLength(3);
    expect(line[0]).toEqual(DIR_VECTORS.up);
    expect(hexDistance(O, line[2])).toBe(3);
    // Each step is adjacent to the previous one.
    expect(hexDistance(line[0], line[1])).toBe(1);
    expect(hexDistance(line[1], line[2])).toBe(1);
  });

  it('hexRange(center, radius) contains the right count and respects distance', () => {
    expect(hexRange(O, 0)).toHaveLength(1);
    expect(hexRange(O, 1)).toHaveLength(7); // center + 6 neighbours
    expect(hexRange(O, 2)).toHaveLength(19);
    for (const h of hexRange(O, 2)) {
      expect(hexDistance(O, h)).toBeLessThanOrEqual(2);
    }
  });

  it('hexBoard / inBoard agree', () => {
    const radius = 3;
    const board = hexBoard(radius);
    expect(board).toHaveLength(37); // 1 + 3*r*(r+1) for r=3
    for (const h of board) expect(inBoard(h, radius)).toBe(true);
    expect(inBoard({ q: radius + 1, r: 0 }, radius)).toBe(false);
  });

  it('stepToward reduces distance to the target', () => {
    const from: Hex = { q: -3, r: 1 };
    const to: Hex = { q: 2, r: -1 };
    const before = hexDistance(from, to);
    const next = hexStep(from, stepToward(from, to));
    expect(hexDistance(next, to)).toBe(before - 1);
  });

  it('hexEquals distinguishes hexes', () => {
    expect(hexEquals(O, { q: 0, r: 0 })).toBe(true);
    expect(hexEquals(O, { q: 1, r: 0 })).toBe(false);
  });

  it('hexKey is a stable, unique string per hex', () => {
    expect(hexKey({ q: 1, r: -2 })).toBe('1,-2');
    expect(hexKey(O)).not.toBe(hexKey({ q: 0, r: 1 }));
  });

  it('hexLineBetween connects two points with adjacent steps', () => {
    const a: Hex = { q: -2, r: 1 };
    const b: Hex = { q: 2, r: -1 };
    const line = hexLineBetween(a, b);
    expect(line).toHaveLength(hexDistance(a, b) + 1);
    expect(line[0]).toEqual(a);
    expect(line[line.length - 1]).toEqual(b);
    // Every consecutive pair is exactly one hex apart.
    for (let i = 1; i < line.length; i++) {
      expect(hexDistance(line[i - 1], line[i])).toBe(1);
    }
  });

  it('hexLineBetween of a point to itself is just that point', () => {
    expect(hexLineBetween(O, O)).toEqual([O]);
  });
});
