// @vitest-environment jsdom
// Component smoke (Homestead M3) — TownCanvas renders a TownState prop into an isometric SVG.
// We seed a small town (a completed Keep, a queued build, a decor prop) and assert it renders
// without crashing, paints more polygons than the ground grid alone, and shows a progress ring
// for the queued project. Also verifies a fresh (empty) town renders, and exercises the tap
// gesture path (pointerdown/up → inverse projection → building/decor/cell dispatch) — in jsdom
// getBoundingClientRect() is all-zeros, so vbPerPx() falls back to 1 and client coords map 1:1
// to viewBox units, making tap targets computable from iso.base() + the grid's offset.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { TownCanvas } from '@/components/town/TownCanvas';
import { freshTown, gridSizeFor, type TownState, type TownBuilding, type TownDecor } from '@/engine/town';
import { TOWN_BUILDING_KEYS } from '@/content/townBuildings';
import { TOWN_DECOR_KEYS } from '@/content/townDecor';
import { base, isoBounds, TOWN_TILE_W } from '@/components/town/iso';

afterEach(cleanup);

/** Client coords of cell (r,c)'s centre under jsdom's identity layout (vbPerPx = 1). */
function tapPoint(r: number, c: number): { clientX: number; clientY: number } {
  const grid = gridSizeFor(3);
  const bounds = isoBounds(grid.rows, grid.cols, TOWN_TILE_W * 2.2); // HEADROOM mirror
  const p = base(r, c);
  return { clientX: p.x + bounds.offsetX, clientY: p.y + bounds.offsetY };
}

function tap(svg: SVGSVGElement, r: number, c: number) {
  const at = tapPoint(r, c);
  fireEvent.pointerDown(svg, { pointerId: 1, isPrimary: true, ...at });
  fireEvent.pointerUp(svg, { pointerId: 1, isPrimary: true, ...at });
}

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

  // TOWN-01: queued scaffolds must draw on the transposed footprint when rot=1.
  it('a rotated queued build draws its scaffold on the transposed footprint', () => {
    const mk = (rot: 0 | 1): TownState => ({
      ...freshTown(),
      queue: [{ id: 'p1', kind: 'build', key: 'training_yard', r: 5, c: 6, rot, laborNeed: 15, laborApplied: 0 }],
    });
    const flat = render(<TownCanvas town={mk(0)} />).container.innerHTML;
    cleanup();
    const rotated = render(<TownCanvas town={mk(1)} />).container.innerHTML;
    // Scaffold ground diamond corner runs (N E S W local coords): 2×3 vs transposed 3×2.
    expect(flat).toContain('0,-16 64,16 -32,64 -96,32');
    expect(rotated).toContain('0,-16 96,32 32,64 -64,16');
    expect(rotated).not.toContain('0,-16 64,16 -32,64 -96,32');
  });

  it('renders a fresh (empty) town without crashing', () => {
    const { container } = render(<TownCanvas town={freshTown()} />);
    expect(container.querySelector('svg')).not.toBeNull();
    // Still paints the full ground grid.
    expect(container.querySelectorAll('polygon').length).toBeGreaterThanOrEqual(GROUND_CELLS);
  });

  // TOWN-10: the tap gesture path — inverse projection + hit-test dispatch order
  // (building → decor → cell) and the rotated-footprint hit-test (TOWN-01).
  describe('tap gestures', () => {
    const tapTown: TownState = {
      ...freshTown(),
      buildings: [{ id: 'y1', key: 'training_yard', r: 5, c: 6, tier: 1, rot: 1 }], // 2×3 rotated → rows 5–6, cols 6–8
      decor: [{ key: 'well', r: 10, c: 10, v: 0 }],
    };

    it('dispatches building, decor, and cell taps by footprint (incl. rotated art cells)', () => {
      const hits: string[] = [];
      const { container } = render(
        <TownCanvas
          town={tapTown}
          onBuildingTap={(id) => hits.push(`b:${id}`)}
          onDecorTap={(r, c) => hits.push(`d:${r},${c}`)}
          onCellTap={(r, c) => hits.push(`c:${r},${c}`)}
        />,
      );
      const svg = container.querySelector('svg') as SVGSVGElement;
      tap(svg, 5, 8);   // rotated yard's transposed footprint cell → building tap
      tap(svg, 7, 6);   // the unrotated tail — free grass → cell tap
      tap(svg, 10, 10); // decor anchor → decor tap
      expect(hits).toEqual(['b:y1', 'c:7,6', 'd:10,10']);
    });

    it('a drag (movement > 8px) never fires a tap', () => {
      const hits: string[] = [];
      const { container } = render(
        <TownCanvas town={tapTown} onCellTap={(r, c) => hits.push(`c:${r},${c}`)} />,
      );
      const svg = container.querySelector('svg') as SVGSVGElement;
      const at = tapPoint(3, 3);
      fireEvent.pointerDown(svg, { pointerId: 1, isPrimary: true, ...at });
      fireEvent.pointerMove(svg, { pointerId: 1, isPrimary: true, clientX: at.clientX + 30, clientY: at.clientY });
      fireEvent.pointerUp(svg, { pointerId: 1, isPrimary: true, clientX: at.clientX + 30, clientY: at.clientY });
      expect(hits).toEqual([]);
    });

    it('during placement (ghost active) a building tap moves the ghost instead of opening the card', () => {
      const hits: string[] = [];
      const { container } = render(
        <TownCanvas
          town={tapTown}
          ghost={{ r: 3, c: 3, w: 1, h: 1, ok: true }}
          onBuildingTap={(id) => hits.push(`b:${id}`)}
          onCellTap={(r, c) => hits.push(`c:${r},${c}`)}
        />,
      );
      const svg = container.querySelector('svg') as SVGSVGElement;
      tap(svg, 5, 6); // on the building — but a ghost is active
      expect(hits).toEqual(['c:5,6']);
    });

    it('wheel zoom rescales the world transform anchored at the pointer', () => {
      const { container } = render(<TownCanvas town={freshTown()} />);
      const svg = container.querySelector('svg') as SVGSVGElement;
      const world = svg.querySelector(':scope > g') as SVGGElement;
      expect(world.getAttribute('transform')).toContain('scale(1)');
      fireEvent.wheel(svg, { deltaY: -100, clientX: 100, clientY: 100 });
      expect(world.getAttribute('transform')).toContain('scale(1.1)');
      fireEvent.wheel(svg, { deltaY: 100, clientX: 100, clientY: 100 });
      expect(world.getAttribute('transform')).toContain('scale(1)');
    });
  });
});
