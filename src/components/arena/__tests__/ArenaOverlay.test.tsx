// @vitest-environment jsdom
// Component smoke for the Arena viewport-fit refactor — the overlay reads a live ArenaState
// from the store. In jsdom there is no ResizeObserver, so the measured viewport stays 0×0 and
// the board must render at the pre-measure fallback size sizeFor(radius). The pure pixel-math
// helpers (pixelToCell / pixelDir / fitSizeArena / centerFor) are exercised directly to pin
// down that they stay pure in `size` — the invariant the size-threading refactor relies on.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  ArenaOverlay,
  sizeFor,
  fitSizeArena,
  boardFor,
  centerFor,
  pixelToCell,
  pixelDir,
} from '@/components/arena/ArenaOverlay';
import { createArena, ARENA_RADIUS } from '@/engine/arena';
import { boardPixelSize, type Cell } from '@/engine/grid';
import { useGameStore } from '@/store/useGameStore';
import type { Fighter, Combatant } from '@/engine/combat';
import type { BossDef } from '@/engine/bosses';
import type { WeaponDef } from '@/engine/weapons';

// --- Fixtures (mirror the engine arena test's shapes) ------------------------------------------
const SWORD: WeaponDef = {
  key: 'test_sword', name: 'Test Sword', attackStat: 'ST', bonus: 5, staminaCost: 2, description: '',
};
function makeFighter(): Fighter {
  const c: Combatant = {
    maxHp: 100, maxMp: 20, maxSta: 10, meleePower: 10, rangedPower: 8, dodge: 0, flee: 0,
    damageSpell: 5, supportSpell: 5, illusionPower: 0, defense: 0, ward: 0,
  };
  return { c, weapon: SWORD };
}
function makeBoss(): BossDef {
  return {
    id: 'test', name: 'Test Boss', flavor: '', baseHp: 50, attack: 10, defense: 0,
    weakTo: [], resistTo: [], rewards: { gold: 100, items: [] },
  };
}

function seedArena() {
  const arena = createArena(makeFighter(), makeBoss(), {
    knownSpells: ['sparks', 'mend'],
    inventory: { healing_potion: 1 },
    tier: 5,
    startMs: 0,
    rng: () => 0.5,
  });
  useGameStore.setState((s) => ({
    arena,
    settings: { ...s.settings, soundEnabled: false },
  }));
  return arena;
}

beforeEach(() => {
  useGameStore.setState({ arena: null });
});

afterEach(() => {
  cleanup();
  useGameStore.setState({ arena: null });
});

describe('ArenaOverlay (viewport fit)', () => {
  it('renders an active run and sizes the board from the fallback sizeFor(radius) in jsdom', () => {
    const arena = seedArena();
    const { container, getByText } = render(<ArenaOverlay />);
    expect(container.firstChild).toBeTruthy();
    // HUD is wired to the seeded run.
    expect(getByText('Test Boss')).toBeTruthy();
    expect(getByText(/tier 5/i)).toBeTruthy();

    // jsdom has no ResizeObserver → vp stays 0×0 → the board uses the pre-measure fallback.
    const size = sizeFor(arena.radius);
    const expected = boardPixelSize(arena.radius, size); // (2R+1)·size square
    const board = container.querySelector<HTMLDivElement>('div.relative.shrink-0.overflow-visible');
    expect(board).toBeTruthy();
    expect(board!.style.width).toBe(`${expected.width}px`);
    expect(board!.style.height).toBe(`${expected.height}px`);
    // Sanity: the default radius still maps to the proven 30px baseline.
    expect(arena.radius).toBe(ARENA_RADIUS);
    expect(size).toBe(30);
  });

  it('pixelToCell round-trips a cell center at two different sizes', () => {
    const R = 4;
    const cells: Cell[] = [{ x: 0, y: 0 }, { x: 2, y: -3 }, { x: -R, y: R }];
    for (const size of [26, 52]) {
      const b = boardFor(R, size);
      for (const cell of cells) {
        const c = centerFor(cell, R, size);
        expect(pixelToCell(c.x, c.y, b.width, b.height, size)).toEqual(cell);
      }
    }
  });

  it('pixelDir maps pixel deltas to the nearest of 8 directions (pure, size-independent)', () => {
    expect(pixelDir(10, 0)).toBe('right');
    expect(pixelDir(-10, 0)).toBe('left');
    expect(pixelDir(0, -10)).toBe('up');
    expect(pixelDir(0, 10)).toBe('down');
    expect(pixelDir(10, 10)).toBe('downRight');
    expect(pixelDir(-10, -10)).toBe('upLeft');
  });

  it('fitSizeArena scales with available space and clamps to [sizeFor(radius), 64]', () => {
    const R = 4;
    const span = 2 * R + 1; // 9 cells across
    // Roomy desktop viewport: exact fit is floor(min(avail)/span).
    expect(fitSizeArena(R, 900, 540)).toBe(Math.floor(540 / span)); // 60 — inside the clamp
    // Huge monitor: capped at 64 so emoji don't balloon.
    expect(fitSizeArena(R, 4000, 4000)).toBe(64);
    // Cramped viewport: never below the proven-fits-mobile baseline.
    expect(fitSizeArena(R, 200, 200)).toBe(sizeFor(R));
    // Tighter boards keep their own floors too.
    expect(fitSizeArena(5, 100, 100)).toBe(sizeFor(5));
  });
});
