import { describe, it, expect } from 'vitest';
import { base, topCenter, hexCorners, isoBounds, ISO_VSQUASH, colHeight } from '../iso';
import { axialToPixel, type Hex } from '@/engine/hex';

const O: Hex = { q: 0, r: 0 };

describe('iso projection', () => {
  it('squashes the vertical axis but leaves x untouched', () => {
    const h: Hex = { q: 1, r: 1 };
    const raw = axialToPixel(h, 20);
    const b = base(h, 20);
    expect(b.x).toBeCloseTo(raw.x);
    expect(b.y).toBeCloseTo(raw.y * ISO_VSQUASH);
  });

  it('lifts a tile by its elevation — higher tiles sit above (smaller y) their base', () => {
    const flat = topCenter(O, 20, 0);
    const high = topCenter(O, 20, 3);
    expect(flat.y).toBeCloseTo(base(O, 20).y);
    expect(high.y).toBeCloseTo(flat.y - 3 * colHeight(20));
    expect(high.y).toBeLessThan(flat.y); // visually higher
  });

  it('column height stays below the on-screen row step so a +2 front tile cannot hide the one behind', () => {
    const size = 20;
    const rowStep = size * Math.sqrt(3) * ISO_VSQUASH; // screen gap to the tile behind
    expect(2 * colHeight(size)).toBeLessThan(rowStep);
  });

  it('column height scales linearly with elevation', () => {
    const e1 = base(O, 20).y - topCenter(O, 20, 1).y;
    const e2 = base(O, 20).y - topCenter(O, 20, 2).y;
    expect(e2).toBeCloseTo(e1 * 2);
  });

  it('hexCorners returns six squashed corners with the bottom three below centre', () => {
    const c = hexCorners(20);
    expect(c).toHaveLength(6);
    // left/right corners are on the centre line; bottom corners are below (positive y, squashed).
    expect(c[0]).toEqual({ x: 20, y: 0 });
    expect(c[4].y).toBeGreaterThan(0);
    expect(c[4].y).toBeCloseTo((Math.sqrt(3) / 2) * 20 * ISO_VSQUASH);
  });

  it('isoBounds leaves headroom for the tallest column and keeps the board on-canvas', () => {
    const b = isoBounds(3, 20, 3);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
    // Every projected base point, plus full column lift, must fall within [0,width]×[0,height].
    for (const hex of [{ q: 0, r: 0 }, { q: 3, r: 0 }, { q: -3, r: 3 }] as Hex[]) {
      const top = topCenter(hex, 20, 3);
      expect(top.x + b.offsetX).toBeGreaterThanOrEqual(0);
      expect(top.y + b.offsetY).toBeGreaterThanOrEqual(0);
      expect(top.x + b.offsetX).toBeLessThanOrEqual(b.width);
    }
  });
});
