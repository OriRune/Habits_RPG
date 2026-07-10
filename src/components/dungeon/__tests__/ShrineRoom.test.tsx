// @vitest-environment jsdom
// Shrine result panel (dungeon-delve-plan-2026-07.md item 2.5 / DUN-20): a failed prayer's
// curse is named — with its exact effect — before the player can continue.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useGameStore, type DungeonRun } from '@/store/useGameStore';
import { type DungeonRoom } from '@/engine/dungeon';
import { type FloorMap } from '@/engine/dungeonMap';
import { getRelic } from '@/engine/relics';
import { resetRunRng } from '@/store/runRng';
import { ShrineRoom } from '../ShrineRoom';

function linearMap(rooms: DungeonRoom[]): FloorMap {
  const nodes: FloorMap['nodes'] = {};
  const layers: string[][] = [];
  rooms.forEach((room, i) => {
    const id = `n${i}_0`;
    nodes[id] = { id, layer: i, room, to: i < rooms.length - 1 ? [`n${i + 1}_0`] : [] };
    layers.push([id]);
  });
  return { nodes, layers };
}

function shrineRun(over: Partial<DungeonRun> = {}): DungeonRun {
  const map = linearMap([{ type: 'shrine' }, { type: 'combat' }]);
  return {
    depth: 1,
    biomeKey: 'catacombs',
    map,
    nodeId: 'n0_0',
    choices: [],
    path: ['n0_0'],
    hp: 100,
    maxHp: 100,
    mp: 30,
    maxMp: 30,
    sta: 10,
    maxSta: 10,
    bankedReward: {},
    floorReward: {},
    encounter: null,
    roomLoot: null,
    battle: null,
    atCheckpoint: false,
    status: 'active',
    cleared: false,
    relics: [],
    pendingBoon: null,
    merchant: null,
    ...over,
  };
}

const get = () => useGameStore.getState();

beforeEach(() => {
  window.matchMedia ??= vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  get().resetGame();
  resetRunRng();
});

afterEach(cleanup);

describe('shrine result panel (plan 2.5 / DUN-20)', () => {
  it('a curse result names the curse and its exact effect', () => {
    const curse = getRelic('brittle_bones')!;
    useGameStore.setState({
      dungeon: shrineRun({
        relics: ['brittle_bones'],
        shrineResult: { outcome: 'cursed', curseKey: 'brittle_bones' },
      }),
    });
    const { container } = render(<ShrineRoom />);
    expect(container.textContent).toContain('A curse');
    expect(container.textContent).toContain(curse.name);
    expect(container.textContent).toContain(curse.description);
    // The gamble buttons are gone — Continue is the only way forward.
    expect(container.textContent).not.toContain('Pray for a blessing');
    expect(container.textContent).toContain('Continue');
  });

  it('a blessing result shows before any boon modal could', () => {
    useGameStore.setState({
      dungeon: shrineRun({ shrineResult: { outcome: 'blessed', boonTier: 1 } }),
    });
    const { container } = render(<ShrineRoom />);
    expect(container.textContent).toContain('A blessing');
    expect(get().dungeon!.pendingBoon).toBeNull();
  });

  it('Continue resolves the room through the store', () => {
    useGameStore.setState({
      dungeon: shrineRun({ shrineResult: { outcome: 'blessed', boonTier: 1 } }),
    });
    const { getByText } = render(<ShrineRoom />);
    fireEvent.click(getByText(/Continue/));
    const run = get().dungeon!;
    expect(run.shrineResult).toBeNull();
    expect(run.nodeId).toBeNull();
    expect(run.choices).toEqual(['n1_0']);
    expect(run.pendingBoon).not.toBeNull(); // the deferred boon lands after the panel
  });

  it('without a result, the gamble choices render as before', () => {
    useGameStore.setState({ dungeon: shrineRun() });
    const { container } = render(<ShrineRoom />);
    expect(container.textContent).toContain('Pray for a blessing');
    expect(container.textContent).toContain('Offer your blood');
  });
});
