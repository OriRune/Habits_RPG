// Shrine result step (dungeon-delve-plan-2026-07.md item 2.5 / DUN-20): a prayer's outcome
// pauses on a result panel — the rolled curse is named before the player is back at the
// path choice — and dungeonShrineContinue resolves the room (offering the blessing's boon).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore, type DungeonRun } from '../useGameStore';
import { type DungeonRoom } from '@/engine/dungeon';
import { type FloorMap } from '@/engine/dungeonMap';
import { getRelic } from '@/engine/relics';
import { resetRunRng } from '../runRng';

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
  get().resetGame();
  resetRunRng();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shrine result step (plan 2.5 / DUN-20)', () => {
  it('a failed prayer surfaces the rolled curse before the path choice', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // miss the WI check
    useGameStore.setState({ dungeon: shrineRun() });
    get().dungeonShrine('pray');
    const run = get().dungeon!;
    // The curse itself is already applied…
    expect(run.relics).toHaveLength(1);
    // …and the result panel names it while the room stays unresolved.
    expect(run.shrineResult?.outcome).toBe('cursed');
    expect(run.shrineResult?.curseKey).toBe(run.relics[0]);
    expect(getRelic(run.shrineResult!.curseKey!)?.curse).toBe(true);
    expect(run.nodeId).toBe('n0_0'); // still in the shrine — no silent fall-through
    expect(run.choices).toEqual([]);
  });

  it('continue after a curse resolves the room with no boon', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    useGameStore.setState({ dungeon: shrineRun() });
    get().dungeonShrine('pray');
    vi.restoreAllMocks();
    get().dungeonShrineContinue();
    const run = get().dungeon!;
    expect(run.shrineResult).toBeNull();
    expect(run.nodeId).toBeNull();
    expect(run.choices).toEqual(['n1_0']);
    expect(run.pendingBoon).toBeNull();
    expect(run.roomsCleared).toBe(1);
  });

  it('a successful prayer defers its boon to the continue step', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // ace the WI check
    useGameStore.setState({ dungeon: shrineRun() });
    get().dungeonShrine('pray');
    const paused = get().dungeon!;
    expect(paused.shrineResult?.outcome).toBe('blessed');
    expect(paused.shrineResult?.boonTier).toBeGreaterThanOrEqual(1);
    expect(paused.pendingBoon).toBeNull(); // the boon modal must not cover the result panel
    expect(paused.nodeId).toBe('n0_0');
    vi.restoreAllMocks();
    get().dungeonShrineContinue();
    const run = get().dungeon!;
    expect(run.shrineResult).toBeNull();
    expect(run.pendingBoon).not.toBeNull();
    expect(run.choices).toEqual(['n1_0']);
  });

  it('offer and leave resolve immediately — no result step for deterministic choices', () => {
    useGameStore.setState({ dungeon: shrineRun() });
    get().dungeonShrine('offer');
    let run = get().dungeon!;
    expect(run.shrineResult ?? null).toBeNull();
    expect(run.nodeId).toBeNull();
    expect(run.pendingBoon).not.toBeNull();

    useGameStore.setState({ dungeon: shrineRun() });
    get().dungeonShrine('leave');
    run = get().dungeon!;
    expect(run.shrineResult ?? null).toBeNull();
    expect(run.nodeId).toBeNull();
  });

  it('dungeonShrineContinue is a no-op without a pending result', () => {
    const run = shrineRun();
    useGameStore.setState({ dungeon: run });
    get().dungeonShrineContinue();
    expect(get().dungeon).toBe(run);
  });
});
