// Tests for src/store/runRng.ts — module-scope RNG accessors and reset helper.
import { describe, it, expect, beforeEach } from 'vitest';
import { mulberry32 } from '@/engine/rng';
import {
  getMineRng,
  getMineBaseSeed,
  setMineRun,
  getForestRng,
  getForestBaseSeed,
  setForestRun,
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
