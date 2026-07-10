// @vitest-environment jsdom
// Phase 0 copy-truth tests (dungeon-delve-plan-2026-07.md items 0.4, 0.8): the reward
// policy shown to the player must render from the engine constants, and each end reason
// must present distinctly. Client-rendered (RTL) — static markup would only ever show
// zustand's pre-hydration server snapshot, not the state the tests set.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useGameStore, type DungeonRun } from '@/store/useGameStore';
import { DUNGEON_RETENTION } from '@/engine/dungeonRun';
import { type DungeonRoom } from '@/engine/dungeon';
import { type FloorMap } from '@/engine/dungeonMap';
import { resetRunRng } from '@/store/runRng';
import { DungeonView } from '../DungeonView';

const FLEE_PCT = `${Math.round(DUNGEON_RETENTION.fled * 100)}%`;
const FALL_PCT = `${Math.round(DUNGEON_RETENTION.defeated * 100)}%`;

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

function makeRun(over: Partial<DungeonRun> = {}): DungeonRun {
  const map = linearMap([{ type: 'combat' }]);
  return {
    depth: 3,
    biomeKey: 'catacombs',
    map,
    nodeId: null,
    choices: [],
    path: [],
    hp: 100,
    maxHp: 100,
    mp: 30,
    maxMp: 30,
    sta: 10,
    maxSta: 10,
    bankedReward: { gold: 50 },
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
const renderHtml = () => render(<DungeonView />).container.innerHTML;

beforeEach(() => {
  window.matchMedia ??= vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  get().resetGame();
  resetRunRng();
  useGameStore.setState({
    character: { ...get().character, level: 3 },
    settings: { ...get().settings, soundEnabled: false }, // keep useDungeonAudio inert (no jsdom AudioContext)
  });
});

afterEach(cleanup);

describe('entrance', () => {
  it('states the exact retention policy from the engine constants', () => {
    const html = renderHtml();
    expect(html).toContain(FLEE_PCT);
    expect(html).toContain(FALL_PCT);
    expect(html).not.toContain('keeps everything');
  });

  it('honors unlimitedEnergy at zero energy (DUN-06)', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 0 },
      settings: { ...get().settings, unlimitedEnergy: true },
    });
    const html = renderHtml();
    expect(html).toContain('Enter the Dungeon');
    expect(html).not.toContain('Need 3 energy');
  });

  it('still gates entry on energy without the dev flag', () => {
    useGameStore.setState({ character: { ...get().character, energy: 0 } });
    expect(renderHtml()).toContain('Need 3 energy');
  });
});

describe('run summary by end reason (DUN-03)', () => {
  it('a banked run celebrates', () => {
    useGameStore.setState({ dungeon: makeRun({ status: 'ended', cleared: true, endReason: 'banked' }) });
    const html = renderHtml();
    expect(html).toContain('Spoils Banked!');
    expect(html).toContain('dungeon:cleared');
  });

  it('a fled run is an escape, not a fall', () => {
    useGameStore.setState({ dungeon: makeRun({ status: 'ended', endReason: 'fled', hp: 30 }) });
    const html = renderHtml();
    expect(html).toContain('You Escape');
    expect(html).not.toContain('You Fall');
    expect(html).toContain('dungeon:retreat');
    expect(html).toContain(FLEE_PCT);
  });

  it('a defeat says what was kept, with distinct art', () => {
    useGameStore.setState({ dungeon: makeRun({ status: 'ended', endReason: 'defeated', hp: 0 }) });
    const html = renderHtml();
    expect(html).toContain('You Fall...');
    expect(html).toContain('combat:defeat');
    expect(html).toContain(FALL_PCT);
  });

  it('derives the heading for a pre-endReason save (fled fallback)', () => {
    useGameStore.setState({ dungeon: makeRun({ status: 'ended', hp: 30 }) }); // no endReason
    expect(renderHtml()).toContain('You Escape');
  });
});

describe('checkpoint (DUN-17)', () => {
  it('shows the clamped actual heal, not the nominal 40%', () => {
    useGameStore.setState({ dungeon: makeRun({ atCheckpoint: true, hp: 90, maxHp: 100 }) });
    const html = renderHtml();
    expect(html).toContain('Rest (+10 HP)'); // min(40, 100-90)
    expect(html).toContain(FLEE_PCT);
    expect(html).toContain(FALL_PCT);
  });
});
