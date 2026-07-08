// @vitest-environment jsdom
// Component smoke (Homestead M3) — TownCanvas renders a TownState prop into an isometric SVG.
// We seed a small town (a completed Keep, a queued build, a decor prop) and assert it renders
// without crashing, paints more polygons than the ground grid alone, and shows a progress ring
// for the queued project. Also verifies a fresh (empty) town renders.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TownCanvas } from '@/components/town/TownCanvas';
import { freshTown, type TownState, type TownBuilding, type TownDecor } from '@/engine/town';
import { TOWN_BUILDING_KEYS } from '@/content/townBuildings';
import { TOWN_DECOR_KEYS } from '@/content/townDecor';

afterEach(cleanup);

// 24×24 absolute grid → 576 ground diamonds.
const GROUND_CELLS = 24 * 24;

function seededTown(): TownState {
  return {
    v: 1,
    deeds: 0,
    buildings: [{ id: 'keep-1', key: 'keep', r: 2, c: 2, tier: 1 }],
    decor: [{ key: 'tree', r: 7, c: 7, v: 0 }],
    laborBank: 0,
    queue: [
      { id: 'proj-1', kind: 'build', key: 'watchtower', r: 1, c: 6, rot: 0, laborNeed: 15, laborApplied: 7 },
    ],
    laborISO: '',
    laborToday: 0,
  };
}

describe('TownCanvas', () => {
  it('renders a seeded town with objects and a progress ring', () => {
    const { container } = render(<TownCanvas town={seededTown()} />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();

    // Ground diamonds + the deed boundary + building/decor/scaffold shapes.
    const polygons = container.querySelectorAll('polygon');
    expect(polygons.length).toBeGreaterThan(GROUND_CELLS);

    // The queued project draws a progress ring (circles).
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThan(0);
  });

  // M6 art coverage: every per-building composer at every tier, every decor variant, and an
  // auto-connecting cobble path — a guard that no composer/decor branch throws at runtime.
  it('renders every building composer (all tiers), every decor variant, and a connected path', () => {
    const buildings: TownBuilding[] = [];
    let row = 0;
    for (const key of TOWN_BUILDING_KEYS) {
      const maxTier = key === 'keep' ? 4 : 3;
      for (let tier = 1; tier <= maxTier; tier++) {
        buildings.push({ id: `${key}-${tier}`, key, r: row, c: (tier - 1) * 4, tier });
      }
      row += 3;
    }
    const decor: TownDecor[] = TOWN_DECOR_KEYS.map((key, i) => ({ key, r: 20, c: i, v: i % 4 }));
    // A straight 3-cell cobble run so cobblePath emits connection stubs.
    decor.push({ key: 'cobble_path', r: 22, c: 0 }, { key: 'cobble_path', r: 22, c: 1 }, { key: 'cobble_path', r: 22, c: 2 });

    const town: TownState = { ...freshTown(), deeds: 3, buildings, decor };
    let container!: HTMLElement;
    expect(() => { container = render(<TownCanvas town={town} />).container; }).not.toThrow();
    // Procedural coordinate guard: a NaN in any point/d attr renders nothing (silent break).
    expect(container.querySelector('svg')!.outerHTML).not.toMatch(/NaN/);
  });

  it('renders a fresh (empty) town without crashing', () => {
    const { container } = render(<TownCanvas town={freshTown()} />);
    expect(container.querySelector('svg')).not.toBeNull();
    // Still paints the full ground grid.
    expect(container.querySelectorAll('polygon').length).toBeGreaterThanOrEqual(GROUND_CELLS);
  });
});
