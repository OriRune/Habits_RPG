// @vitest-environment jsdom
// StaticTerrainLayer renders the heavy board art deterministically (cellHash-driven detail),
// so the memo boundary never causes visible churn and every terrain kind draws its prop art.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { StaticTerrainLayer, TacticsArtDefs } from '@/components/tactics/terrainArt';
import type { Tile } from '@/engine/hexBattle';
import { hexKey } from '@/engine/hex';

afterEach(cleanup);

function tile(q: number, r: number, terrain: Tile['terrain'], elevation = 0): [string, Tile] {
  const t: Tile = { hex: { q, r }, terrain, elevation };
  return [hexKey(t.hex), t];
}

// One of each terrain + one elevated floor tile.
const TILES: Record<string, Tile> = Object.fromEntries([
  tile(0, 0, 'floor'),
  tile(1, 0, 'cover'),
  tile(0, 1, 'slow'),
  tile(-1, 0, 'hazard'),
  tile(0, -1, 'blocked', 3),
  tile(1, -1, 'floor', 2),
]);

function renderLayer() {
  return render(
    <svg>
      <TacticsArtDefs />
      <StaticTerrainLayer tiles={TILES} size={24} offsetX={100} offsetY={100} />
    </svg>,
  );
}

describe('StaticTerrainLayer', () => {
  it('renders deterministically — two renders produce identical markup', () => {
    const a = renderLayer();
    const first = a.container.innerHTML;
    a.unmount();
    const b = renderLayer();
    expect(b.container.innerHTML).toBe(first);
  });

  it('draws the hazard ember glow prop and the sway-tagged grass tufts', () => {
    const { container } = renderLayer();
    expect(container.querySelector('[data-prop="hazard-glow"]')).toBeTruthy();
    expect(container.querySelectorAll('.tx-sway').length).toBeGreaterThan(0);
  });

  it('contains no emoji terrain icons — terrain is drawn, not typed', () => {
    const { container } = renderLayer();
    for (const glyph of ['🛡️', '🌿', '🔥', '🪨']) {
      expect(container.innerHTML.includes(glyph)).toBe(false);
    }
  });

  it('extrudes walls only for elevated tiles', () => {
    const { container } = renderLayer();
    // 6 tiles → 6 top faces + 6 sheens + 1 hazard ember pool; the two elevated tiles
    // add 3 wall quads each.
    const polygons = container.querySelectorAll('polygon');
    expect(polygons.length).toBe(6 * 2 + 1 + 2 * 3);
  });

  it('references the shared defs (sheen on every tile, ember on hazard)', () => {
    const { container } = renderLayer();
    expect(container.querySelectorAll('polygon[fill="url(#tx-sheen)"]').length).toBe(6);
    expect(container.querySelectorAll('polygon[fill="url(#tx-ember)"]').length).toBe(1);
  });
});
