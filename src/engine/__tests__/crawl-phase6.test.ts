import { describe, it, expect } from 'vitest';

/**
 * Phase 6 — pure-logic unit tests.
 *
 * shakeOffset is the only extractable pure helper introduced in Phase 6.  All
 * other juice (floaters, flashes, wipes) lives in the rendering layer and is
 * verified manually.
 */
import { shakeOffset } from '@/engine/crawl';

describe('shakeOffset', () => {
  it('returns zero when mag is 0', () => {
    const r = shakeOffset(0, 0, 300, 0.5, 0.5);
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
  });

  it('returns zero when elapsed equals dur', () => {
    const r = shakeOffset(8, 300, 300, 1, 1);
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
  });

  it('returns zero when elapsed exceeds dur', () => {
    const r = shakeOffset(8, 500, 300, 1, 1);
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
  });

  it('returns zero when dur is 0', () => {
    const r = shakeOffset(8, 0, 0, 1, 1);
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
  });

  it('returns max amplitude at elapsed=0 with rands biased to 1', () => {
    // randX=1 → sx = (1*2-1)*amp = amp; randY=1 → sy = amp*0.6
    const r = shakeOffset(8, 0, 300, 1, 1);
    expect(r.sx).toBeCloseTo(8);
    expect(r.sy).toBeCloseTo(4.8);
  });

  it('Y amplitude is exactly 0.6× X amplitude for the same rand bias', () => {
    const r = shakeOffset(10, 0, 400, 1, 1);
    expect(r.sy).toBeCloseTo(r.sx * 0.6);
  });

  it('amplitude is strictly less than max in mid-flight', () => {
    // At elapsed=150 (halfway through dur=300): k=0.5, amp=10*0.25=2.5
    const r = shakeOffset(10, 150, 300, 1, 1);
    expect(Math.abs(r.sx)).toBeCloseTo(2.5);
  });

  it('sx can be negative when randX < 0.5', () => {
    // randX=0 → (0*2-1)*amp = -amp
    const r = shakeOffset(8, 0, 300, 0, 0.5);
    expect(r.sx).toBeCloseTo(-8);
  });

  it('decays to zero as elapsed approaches dur (quadratic ease-out)', () => {
    const near = shakeOffset(8, 290, 300, 1, 1);
    // k = 1 - 290/300 ≈ 0.0333; amp = 8 * k^2 ≈ 8 * 0.00111 ≈ 0.0089
    expect(Math.abs(near.sx)).toBeLessThan(0.1);
    expect(Math.abs(near.sy)).toBeLessThan(0.1);
  });
});
