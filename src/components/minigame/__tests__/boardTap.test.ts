import { describe, it, expect } from 'vitest';
import { clientToTile, createTapTracker, TAP_SLOP_PX } from '../boardTap';

/** Element stub exposing only getBoundingClientRect (all other rect fields defaulted). */
function fakeEl(rect: Partial<DOMRect> = {}): HTMLElement {
  const full = {
    x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  return { getBoundingClientRect: () => full } as unknown as HTMLElement;
}

const spec = (frame: HTMLElement | null, world: HTMLElement | null) => ({
  frame,
  world,
  boardW: 572, // 11 tiles × 52px
  cell: 52,
  baseR0: 4,
  baseC0: 6,
});

describe('clientToTile', () => {
  it('returns null when the DOM refs are not ready', () => {
    expect(clientToTile(10, 10, spec(null, fakeEl()))).toBe(null);
    expect(clientToTile(10, 10, spec(fakeEl(), null))).toBe(null);
  });

  it('maps 1:1 with the jsdom zero-rect fallback (scale defaults to 1)', () => {
    const s = spec(fakeEl(), fakeEl());
    expect(clientToTile(0, 0, s)).toEqual({ r: 4, c: 6 });
    expect(clientToTile(51, 51, s)).toEqual({ r: 4, c: 6 }); // still inside tile 0
    expect(clientToTile(103, 52, s)).toEqual({ r: 5, c: 7 }); // one tile down-right
  });

  it('subtracts the world rect origin (camera translate is folded into the rect)', () => {
    const s = spec(fakeEl({ width: 572 }), fakeEl({ left: -104, top: -52 }));
    // Client (0,0) sits 104px right / 52px below the world origin → tile (+1, +2).
    expect(clientToTile(0, 0, s)).toEqual({ r: 5, c: 8 });
  });

  it('divides by the measured scale — down (phones) and up (desktop)', () => {
    const world = fakeEl({ left: 20, top: 10 });
    const down = spec(fakeEl({ width: 286 }), world); // 0.5× — one tile is 26 screen px
    expect(clientToTile(20 + 26, 10 + 26, down)).toEqual({ r: 5, c: 7 });
    const up = spec(fakeEl({ width: 858 }), world); // 1.5× — one tile is 78 screen px
    expect(clientToTile(20 + 78, 10 + 78, up)).toEqual({ r: 5, c: 7 });
    expect(clientToTile(20 + 77, 10 + 77, up)).toEqual({ r: 4, c: 6 }); // just inside tile 0
  });
});

describe('createTapTracker', () => {
  const pt = (pointerId: number, clientX: number, clientY: number) => ({ pointerId, clientX, clientY });

  it('returns the up-point for a clean tap and null for a drag', () => {
    const t = createTapTracker();
    t.down(pt(1, 100, 100));
    expect(t.up(pt(1, 100 + TAP_SLOP_PX, 100))).toEqual({ x: 100 + TAP_SLOP_PX, y: 100 });
    t.down(pt(1, 100, 100));
    expect(t.up(pt(1, 100 + TAP_SLOP_PX + 1, 100))).toBe(null);
  });

  it('ignores an up without a down, mismatched pointer ids, and cancelled gestures', () => {
    const t = createTapTracker();
    expect(t.up(pt(1, 0, 0))).toBe(null);
    t.down(pt(1, 0, 0));
    expect(t.up(pt(2, 0, 0))).toBe(null);
    t.down(pt(1, 0, 0));
    t.cancel();
    expect(t.up(pt(1, 0, 0))).toBe(null);
  });

  it('a second pointer going down cancels the gesture (pinch never taps)', () => {
    const t = createTapTracker();
    t.down(pt(1, 0, 0));
    t.down(pt(2, 5, 5));
    expect(t.up(pt(1, 0, 0))).toBe(null);
    expect(t.up(pt(2, 5, 5))).toBe(null);
  });
});
