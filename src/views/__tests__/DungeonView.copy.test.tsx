// @vitest-environment jsdom
// Phase 0 copy-truth tests (dungeon-delve-plan-2026-07.md items 0.4, 0.8): the reward
// policy shown to the player must render from the engine constants, and each end reason
// must present distinctly. Client-rendered (RTL) — static markup would only ever show
// zustand's pre-hydration server snapshot, not the state the tests set.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
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

describe('checkpoint energy contract (DUN-02 / plan 1.2)', () => {
  it('at zero energy past the free floors, descent is disabled but Bank & Leave is not', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 0 },
      dungeon: makeRun({ atCheckpoint: true, depth: 3 }),
    });
    const { container, getByText } = render(<DungeonView />);
    expect(getByText(/Out of energy — complete a habit/)).toBeTruthy();
    const buttons = [...container.querySelectorAll('button')];
    const descend = buttons.filter((b) => /Press On|Rest \(/.test(b.textContent ?? ''));
    expect(descend).toHaveLength(2);
    for (const b of descend) expect(b.disabled).toBe(true);
    const bank = buttons.find((b) => /Bank & Leave/.test(b.textContent ?? ''));
    expect(bank?.disabled).toBe(false);
  });

  it('shows the descent cost on both buttons when the next floor is paid', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 2 },
      dungeon: makeRun({ atCheckpoint: true, depth: 3 }),
    });
    const html = renderHtml();
    expect(html).toContain('1⚡');
    expect(html).toContain('you have 2');
  });

  it('keeps free-floor descents unlabeled and enabled at zero energy', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 0 },
      dungeon: makeRun({ atCheckpoint: true, depth: 1 }),
    });
    const { container } = render(<DungeonView />);
    const buttons = [...container.querySelectorAll('button')];
    const pressOn = buttons.find((b) => /Press On/.test(b.textContent ?? ''));
    expect(pressOn?.disabled).toBe(false);
    expect(pressOn?.textContent).not.toContain('⚡');
  });

  it('forecasts streak-adjusted banked gold', () => {
    useGameStore.setState({
      character: { ...get().character, habitBonus: 1.2 },
      dungeon: makeRun({ atCheckpoint: true, bankedReward: { gold: 100 } }),
    });
    const html = renderHtml();
    expect(html).toContain('Collects as 120g');
  });
});

describe('biome starts at the entrance (plan 3.2 / D6)', () => {
  it('offers no selector before any deep start is unlocked', () => {
    expect(renderHtml()).not.toContain('Start the expedition at');
  });

  it('lists unlocked start floors and shifts the cost copy to the selection', () => {
    useGameStore.setState({ deepestFloor: 7 });
    const { container, getByText } = render(<DungeonView />);
    expect(container.textContent).toContain('Start the expedition at');
    expect(container.textContent).toContain('Covers floors 1–3');
    fireEvent.click(getByText(/Floor 6 · /));
    expect(container.textContent).toContain('Covers floors 6–8');
    expect(container.textContent).toContain('Depth records only count from Floor 1');
  });
});

describe('start-relative checkpoint charging (D1 × D6)', () => {
  it('keeps the third floor of a deep start free and charges the fourth', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 0 },
      dungeon: makeRun({ atCheckpoint: true, depth: 7, startDepth: 6 }),
    });
    const { container } = render(<DungeonView />);
    const pressOn = [...container.querySelectorAll('button')].find((b) =>
      /Press On/.test(b.textContent ?? ''),
    )!;
    expect(pressOn.disabled).toBe(false); // depth 8 is still covered by the floor-6 entry
    cleanup();

    useGameStore.setState({
      character: { ...get().character, energy: 0 },
      dungeon: makeRun({ atCheckpoint: true, depth: 8, startDepth: 6 }),
    });
    const paid = render(<DungeonView />);
    const pressOn2 = [...paid.container.querySelectorAll('button')].find((b) =>
      /Press On/.test(b.textContent ?? ''),
    )!;
    expect(pressOn2.disabled).toBe(true); // depth 9 is the expedition's first paid floor
  });
});

describe('cycle mutators in the header (plan 3.4)', () => {
  it('names the mutator on floors 16+ and stays silent on the first pass', () => {
    useGameStore.setState({ dungeon: makeRun({ depth: 16, nodeId: null, choices: [] }) });
    expect(render(<DungeonView />).container.textContent).toContain('Sunless');
    cleanup();
    useGameStore.setState({ dungeon: makeRun({ depth: 3, nodeId: null, choices: [] }) });
    expect(render(<DungeonView />).container.textContent).not.toContain('Sunless');
  });
});

describe('retreat (plan 2.4 / DUN-10)', () => {
  // A mid-floor path-choice state: active run, not at a checkpoint, no battle.
  const midFloor = () =>
    makeRun({
      status: 'active',
      nodeId: null,
      choices: ['n0_0'],
      bankedReward: { gold: 50 },
      floorReward: { gold: 100 },
    });

  it('offers a retreat button in the run HUD with the engine retention share', () => {
    useGameStore.setState({ dungeon: midFloor() });
    const { getByText } = render(<DungeonView />);
    expect(getByText(new RegExp(`Retreat — end the run.*${FLEE_PCT}`))).toBeTruthy();
  });

  it('the confirmation shows the exact kept and lost split before ending the run', () => {
    useGameStore.setState({ dungeon: midFloor() });
    const { container, getByText } = render(<DungeonView />);
    fireEvent.click(getByText(/Retreat — end the run/));
    expect(getByText(/Retreating always succeeds/)).toBeTruthy();
    // Kept: 50 banked + floor(100 × 0.6) = 110 shown to the unit; 40 left behind.
    expect(container.textContent).toContain('110');
    expect(getByText('Left behind')).toBeTruthy();
    expect(container.textContent).toContain('40');
    expect(get().dungeon!.status).toBe('active'); // nothing happened yet

    const confirm = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Retreat',
    )!;
    fireEvent.click(confirm);
    expect(get().dungeon!.status).toBe('ended');
    expect(get().dungeon!.endReason).toBe('fled');
    expect(get().dungeon!.bankedReward.gold).toBe(110);
  });

  it('Keep exploring dismisses the dialog without ending the run', () => {
    useGameStore.setState({ dungeon: midFloor() });
    const { container, getByText } = render(<DungeonView />);
    fireEvent.click(getByText(/Retreat — end the run/));
    fireEvent.click(getByText('Keep exploring'));
    expect(container.textContent).not.toContain('Retreating always succeeds');
    expect(get().dungeon!.status).toBe('active');
  });
});
