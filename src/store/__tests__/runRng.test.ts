// Tests for src/store/runRng.ts — module-scope RNG accessors and reset helper.
import { describe, it, expect, beforeEach } from 'vitest';
import { mulberry32 } from '@/engine/rng';
import {
  getMineRng,
  getMineBaseSeed,
  setMineRun,
  acceptMineWorldT,
  getForestRng,
  getForestBaseSeed,
  setForestRun,
  acceptForestWorldT,
  resetRunRng,
} from '../runRng';

beforeEach(() => {
  resetRunRng();
});

describe('mine RNG', () => {
  it('defaults to Math.random before any setMineRun call', () => {
    expect(getMineRng()).toBe(Math.random);
    expect(getMineBaseSeed()).toBeUndefined();
  });

  it('setMineRun stores an seeded RNG and seed', () => {
    const seed = 12345;
    const rng = mulberry32(seed);
    setMineRun(rng, seed);
    expect(getMineRng()).toBe(rng);
    expect(getMineBaseSeed()).toBe(seed);
  });

  it('setMineRun with no seed leaves baseSeed undefined', () => {
    const rng = mulberry32(1);
    setMineRun(rng);
    expect(getMineRng()).toBe(rng);
    expect(getMineBaseSeed()).toBeUndefined();
  });
});

describe('forest RNG', () => {
  it('defaults to Math.random before any setForestRun call', () => {
    expect(getForestRng()).toBe(Math.random);
    expect(getForestBaseSeed()).toBeUndefined();
  });

  it('setForestRun stores a seeded RNG and seed', () => {
    const seed = 99999;
    const rng = mulberry32(seed);
    setForestRun(rng, seed);
    expect(getForestRng()).toBe(rng);
    expect(getForestBaseSeed()).toBe(seed);
  });
});

describe('resetRunRng', () => {
  it('restores mine globals to defaults after setMineRun', () => {
    setMineRun(mulberry32(1), 1);
    resetRunRng();
    expect(getMineRng()).toBe(Math.random);
    expect(getMineBaseSeed()).toBeUndefined();
  });

  it('restores forest globals to defaults after setForestRun', () => {
    setForestRun(mulberry32(2), 2);
    resetRunRng();
    expect(getForestRng()).toBe(Math.random);
    expect(getForestBaseSeed()).toBeUndefined();
  });

  it('restores both mine and forest in one call', () => {
    setMineRun(mulberry32(10), 10);
    setForestRun(mulberry32(20), 20);
    resetRunRng();
    expect(getMineRng()).toBe(Math.random);
    expect(getForestRng()).toBe(Math.random);
    expect(getMineBaseSeed()).toBeUndefined();
    expect(getForestBaseSeed()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// acceptMineWorldT / acceptForestWorldT — world-slice staleness guards
// ---------------------------------------------------------------------------

describe('acceptMineWorldT', () => {
  it('accepts the first t (high-water mark starts at -Infinity)', () => {
    expect(acceptMineWorldT(100)).toBe(true);
  });

  it('accepts a strictly increasing t', () => {
    acceptMineWorldT(100);
    expect(acceptMineWorldT(101)).toBe(true);
  });

  it('drops an equal t (not strictly greater)', () => {
    acceptMineWorldT(100);
    expect(acceptMineWorldT(100)).toBe(false);
  });

  it('drops a lower t (out-of-order/stale)', () => {
    acceptMineWorldT(200);
    expect(acceptMineWorldT(50)).toBe(false);
  });

  it('treats undefined t as accept (back-compat: slice carries no timestamp)', () => {
    acceptMineWorldT(500);
    expect(acceptMineWorldT(undefined)).toBe(true);
    // undefined does not advance the high-water mark; a lower real t is still dropped
    expect(acceptMineWorldT(400)).toBe(false);
  });

  it('setMineRun resets the high-water mark (reconnect/new host)', () => {
    acceptMineWorldT(9000);
    expect(acceptMineWorldT(1)).toBe(false); // would be dropped before reset

    setMineRun(Math.random);
    // After reset a lower t is accepted again
    expect(acceptMineWorldT(1)).toBe(true);
  });

  it('resetRunRng resets the high-water mark', () => {
    acceptMineWorldT(9000);
    resetRunRng();
    expect(acceptMineWorldT(1)).toBe(true);
  });
});

describe('acceptForestWorldT', () => {
  it('accepts the first t', () => {
    expect(acceptForestWorldT(100)).toBe(true);
  });

  it('accepts a strictly increasing t', () => {
    acceptForestWorldT(100);
    expect(acceptForestWorldT(200)).toBe(true);
  });

  it('drops an equal t', () => {
    acceptForestWorldT(100);
    expect(acceptForestWorldT(100)).toBe(false);
  });

  it('drops a lower t', () => {
    acceptForestWorldT(300);
    expect(acceptForestWorldT(150)).toBe(false);
  });

  it('treats undefined t as accept', () => {
    acceptForestWorldT(500);
    expect(acceptForestWorldT(undefined)).toBe(true);
  });

  it('setForestRun resets the high-water mark', () => {
    acceptForestWorldT(9000);
    setForestRun(Math.random);
    expect(acceptForestWorldT(1)).toBe(true);
  });

  it('resetRunRng resets the high-water mark', () => {
    acceptForestWorldT(9000);
    resetRunRng();
    expect(acceptForestWorldT(1)).toBe(true);
  });
});
