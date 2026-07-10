// @vitest-environment jsdom
// Route UI (dungeon-delve-plan-2026-07.md item 2.3 / DUN-16): danger chips, the current-node
// marker, and the hover/focus detail card, all derived from the engine's route analysis.
// Client-rendered (RTL) — the repo's established pattern for component tests.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { type DungeonRoom } from '@/engine/dungeon';
import { type FloorMap as FloorMapData } from '@/engine/dungeonMap';
import { FloorMap } from '../FloorMap';

function linearMap(rooms: DungeonRoom[]): FloorMapData {
  const nodes: FloorMapData['nodes'] = {};
  const layers: string[][] = [];
  rooms.forEach((room, i) => {
    const id = `n${i}_0`;
    nodes[id] = { id, layer: i, room, to: i < rooms.length - 1 ? [`n${i + 1}_0`] : [] };
    layers.push([id]);
  });
  return { nodes, layers };
}

afterEach(cleanup);

describe('danger chips (plan 2.3)', () => {
  it('classifies the next room by total route danger, counting the realized path', () => {
    // A combat already survived (danger 1) + a treasure choice (0) → Medium.
    const map = linearMap([{ type: 'combat' }, { type: 'treasure' }]);
    const { container } = render(
      <FloorMap map={map} choices={['n1_0']} path={['n0_0']} depth={2} onChoose={() => {}} />,
    );
    expect(container.innerHTML).toContain('Med');
  });

  it('shows Low on an untouched safe route and High past an elite', () => {
    const safe = linearMap([{ type: 'rest' }, { type: 'shrine' }]);
    const a = render(
      <FloorMap map={safe} choices={['n0_0']} path={[]} depth={2} onChoose={() => {}} />,
    );
    expect(a.container.innerHTML).toContain('Low');
    cleanup();

    const risky = linearMap([{ type: 'elite' }, { type: 'rest' }]);
    const b = render(
      <FloorMap map={risky} choices={['n0_0']} path={[]} depth={9} onChoose={() => {}} />,
    );
    expect(b.container.innerHTML).toContain('High');
  });

  it('does not put chips on non-choosable rooms', () => {
    const map = linearMap([{ type: 'combat' }, { type: 'treasure' }]);
    const { container } = render(
      <FloorMap map={map} choices={[]} path={['n0_0', 'n1_0']} depth={2} onChoose={() => {}} />,
    );
    expect(container.innerHTML).not.toContain('Med');
    expect(container.innerHTML).not.toContain('Low');
  });
});

describe('current-node marker (plan 2.3)', () => {
  it('marks the most recently entered room with a You badge', () => {
    const map = linearMap([{ type: 'combat' }, { type: 'treasure' }]);
    const { container, getByText } = render(
      <FloorMap map={map} choices={['n1_0']} path={['n0_0']} depth={2} onChoose={() => {}} />,
    );
    expect(getByText('You')).toBeTruthy();
    // The badge sits on the visited combat node, whose aria-label says so.
    const marked = container.querySelector('button[aria-label*="you are here"]');
    expect(marked?.textContent).toContain('Fight');
  });

  it('shows no marker at the floor start (nothing entered yet)', () => {
    const map = linearMap([{ type: 'combat' }]);
    const { queryByText } = render(
      <FloorMap map={map} choices={['n0_0']} path={[]} depth={2} onChoose={() => {}} />,
    );
    expect(queryByText('You')).toBeNull();
  });
});

describe('route detail card (plan 2.3)', () => {
  it('appears on focus with rooms remaining, danger, and loot outlook', () => {
    const map = linearMap([{ type: 'combat' }, { type: 'treasure' }, { type: 'combat' }]);
    const { container, getByText } = render(
      <FloorMap map={map} choices={['n1_0']} path={['n0_0']} depth={2} onChoose={() => {}} />,
    );
    const choice = container.querySelector('button[aria-label^="Treasure"]')!;
    fireEvent.focus(choice);
    // 2 rooms left (treasure + final combat); total danger 1 realized + 1 ahead → High/Rich.
    expect(getByText(/2 rooms to the checkpoint/)).toBeTruthy();
    expect(getByText(/Danger: High/)).toBeTruthy();
    expect(getByText(/Loot outlook: Rich/)).toBeTruthy();
    fireEvent.blur(choice);
    expect(container.textContent).not.toContain('to the checkpoint');
  });
});
