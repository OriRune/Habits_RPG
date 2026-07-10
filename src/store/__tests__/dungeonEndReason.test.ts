// Phase 0 dungeon-trust tests: end reasons, retention, curse safety, room counters.
// (dungeon-delve-plan-2026-07.md items 0.2, 0.5, 0.6, 0.7.)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGameStore, type DungeonRun } from '../useGameStore';
import { type BattleState } from '@/engine/combat';
import { type DungeonRoom } from '@/engine/dungeon';
import { type FloorMap } from '@/engine/dungeonMap';
import { fighterFor } from '../shared';
import { resetRunRng } from '../runRng';

/** One room per layer, linked in sequence (same shape as store.integration.test.ts). */
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

function makeRun(over: Partial<DungeonRun> & { rooms?: DungeonRoom[] }): DungeonRun {
  const { rooms, ...rest } = over;
  const map = rest.map ?? linearMap(rooms ?? [{ type: 'combat' }]);
  const firstId = map.layers[0][0];
  return {
    depth: 1,
    biomeKey: 'catacombs',
    map,
    nodeId: firstId,
    choices: [],
    path: [firstId],
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
    ...rest,
  };
}

const get = () => useGameStore.getState();

beforeEach(() => {
  get().resetGame();
  resetRunRng();
  vi.restoreAllMocks();
});

describe('endReason stamping (DUN-03)', () => {
  it("combat flee ends the run as 'fled'", () => {
    useGameStore.setState({
      dungeon: makeRun({ battle: { status: 'fled', playerHp: 25 } as BattleState }),
    });
    get().dungeonAdvance();
    expect(get().dungeon!.endReason).toBe('fled');
    expect(get().dungeon!.cleared).toBe(false);
  });

  it("combat loss ends the run as 'defeated'", () => {
    useGameStore.setState({
      dungeon: makeRun({ battle: { status: 'lost', playerHp: 0 } as BattleState }),
    });
    get().dungeonAdvance();
    expect(get().dungeon!.endReason).toBe('defeated');
  });

  it("banking at a checkpoint ends the run as 'banked'", () => {
    useGameStore.setState({ dungeon: makeRun({ atCheckpoint: true }) });
    get().dungeonBank();
    expect(get().dungeon!.endReason).toBe('banked');
    expect(get().dungeon!.cleared).toBe(true);
  });

  it('collectDungeon copies the reason into the history summary', () => {
    useGameStore.setState({
      dungeon: makeRun({ status: 'ended', cleared: false, endReason: 'fled', hp: 30 }),
    });
    get().collectDungeon();
    const entry = get().dungeonHistory[0];
    expect(entry.endReason).toBe('fled');
    expect(entry.defeated).toBe(false);
  });

  it('collectDungeon derives the reason for a pre-endReason suspended run', () => {
    useGameStore.setState({
      dungeon: makeRun({ status: 'ended', cleared: false, hp: 0 }), // old save: no endReason
    });
    get().collectDungeon();
    expect(get().dungeonHistory[0].endReason).toBe('defeated');
    expect(get().dungeonHistory[0].defeated).toBe(true);
  });
});

describe('roomsEntered vs roomsCleared (DUN-05)', () => {
  it('entering counts roomsEntered; only resolution counts roomsCleared', () => {
    const run = makeRun({ rooms: [{ type: 'treasure' }, { type: 'combat' }] });
    useGameStore.setState({ dungeon: { ...run, nodeId: null, choices: ['n0_0'], path: [] } });
    get().dungeonChoosePath('n0_0');
    expect(get().dungeon!.roomsEntered).toBe(1);
    expect(get().dungeon!.roomsCleared ?? 0).toBe(0); // entered, not yet resolved

    get().dungeonAdvance(); // treasure resolves on advance
    expect(get().dungeon!.roomsCleared).toBe(1);
  });

  it('a room the player flees in counts as entered but not cleared', () => {
    const run = makeRun({
      roomsEntered: 3,
      roomsCleared: 2,
      battle: { status: 'fled', playerHp: 25 } as BattleState,
    });
    useGameStore.setState({ dungeon: run });
    get().dungeonAdvance();
    expect(get().dungeon!.roomsEntered).toBe(3);
    expect(get().dungeon!.roomsCleared).toBe(2); // flee resolves via finishRun, no increment
  });

  it('seeds roomsEntered from roomsCleared on an old mid-flight save', () => {
    const run = makeRun({ rooms: [{ type: 'treasure' }, { type: 'combat' }], roomsCleared: 4 });
    useGameStore.setState({ dungeon: { ...run, nodeId: null, choices: ['n0_0'], path: [] } });
    get().dungeonChoosePath('n0_0');
    expect(get().dungeon!.roomsEntered).toBe(5);
  });
});

describe('curse safety (DUN-18 / DUN-22)', () => {
  it('stacked brittle_bones can never sink derived max HP below 1', () => {
    useGameStore.setState({
      dungeon: makeRun({ relics: Array(50).fill('brittle_bones') }),
    });
    const { c } = fighterFor(get());
    expect(c.maxHp).toBeGreaterThanOrEqual(1);
    expect(c.flee).toBeGreaterThanOrEqual(0.05);
  });

  it('a shrine curse weakens but never kills: hp/maxHp floor at 1', () => {
    // Force the WI check to fail (first random) and pick whatever curse comes up (second).
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    useGameStore.setState({
      dungeon: makeRun({
        rooms: [{ type: 'shrine' }, { type: 'combat' }],
        hp: 2,
        maxHp: 100,
        relics: Array(49).fill('brittle_bones'), // next curse bottoms out the pool
      }),
    });
    get().dungeonShrine('pray');
    const run = get().dungeon!;
    expect(run.status).toBe('active'); // the curse did not end the run
    expect(run.maxHp).toBeGreaterThanOrEqual(1);
    expect(run.hp).toBeGreaterThanOrEqual(1);
  });
});

describe('encounter-death XP consistency (DUN-21)', () => {
  it('a lethal successful check still banks its stat XP', async () => {
    // No current encounter content damages on success, so synthesize one: mock the
    // encounter engine so the checked choice succeeds and deals lethal damage.
    vi.resetModules();
    vi.doMock('@/engine/encounters', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/engine/encounters')>();
      return {
        ...actual,
        getEncounter: () => ({
          key: 'test_enc',
          title: 'Test',
          start: 'n0',
          nodes: { n0: { text: 't', choices: [{ label: 'risk it', stat: 'WI' as const }] } },
        }),
        chooseEncounter: () => ({
          state: { nodeId: 'n0', done: true, lastOutcome: 'success' as const },
          step: { reward: {}, hpDelta: -999, mpDelta: 0, staDelta: 0 },
        }),
      };
    });
    const { useGameStore: store } = await import('../useGameStore');
    const s = store.getState();
    s.resetGame();
    const xpBefore = store.getState().character.statXp.WI;
    store.setState({
      dungeon: makeRun({
        rooms: [{ type: 'encounter', key: 'test_enc' } as DungeonRoom, { type: 'combat' }],
        encounter: { nodeId: 'n0', done: false } as DungeonRun['encounter'],
        hp: 10,
      }),
    });
    store.getState().dungeonEncounterChoose(0);
    const run = store.getState().dungeon!;
    expect(run.status).toBe('ended');
    expect(run.endReason).toBe('defeated');
    // The XP earned by the fatal-but-successful check is applied, not discarded.
    expect(store.getState().character.statXp.WI).toBeGreaterThan(xpBefore);
    expect(run.earnedXp ?? 0).toBeGreaterThan(0);
    vi.doUnmock('@/engine/encounters');
    vi.resetModules();
  });
});
