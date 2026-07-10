// Biome expedition starts + Phase 3 measurement (dungeon-delve-plan-2026-07.md items
// 3.1, 3.2, decision D6): deep starts are gated on slain bosses, keep the same energy
// contract shifted to the start floor, never set depth records, and every run records
// the fields the economy readout aggregates.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGameStore, type DungeonRun } from '../useGameStore';
import { type BattleState } from '@/engine/combat';
import { type DungeonRoom, DUNGEON_ENERGY_COST, DUNGEON_DESCENT_COST } from '@/engine/dungeon';
import { type FloorMap } from '@/engine/dungeonMap';
import { toISODate, _resetNow } from '@/engine/date';
import { selectDungeonEconomy } from '../selectors';
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
  useGameStore.setState({ character: { ...get().character, level: 3, energy: 10 } });
});

afterEach(() => {
  _resetNow();
});

describe('startDungeon with a start floor (plan 3.2 / D6)', () => {
  it('refuses a deep start that is not unlocked', () => {
    get().startDungeon(6);
    expect(get().dungeon).toBeNull();
    // Reaching the boss floor is not beating it.
    useGameStore.setState({ deepestFloor: 5 });
    get().startDungeon(6);
    expect(get().dungeon).toBeNull();
  });

  it('starts at floor 6 once boss 5 is slain, with one starter boon pick', () => {
    useGameStore.setState({ dungeonBossesSlain: [5] });
    get().startDungeon(6);
    const run = get().dungeon!;
    expect(run.depth).toBe(6);
    expect(run.startDepth).toBe(6);
    expect(run.biomeKey).toBe('ruins'); // the second biome starts at floor 6
    expect(run.pendingBoon).not.toBeNull(); // the D6 starter package: one pick
    expect(run.energySpent).toBe(DUNGEON_ENERGY_COST); // same entry price as floor 1
    expect(get().character.energy).toBe(10 - DUNGEON_ENERGY_COST);
  });

  it('grants legacy credit from deepestFloor (pre-tracking saves)', () => {
    useGameStore.setState({ deepestFloor: 7, dungeonBossesSlain: [] });
    get().startDungeon(6);
    expect(get().dungeon?.depth).toBe(6);
  });

  it('a floor-1 start ships without the starter boon', () => {
    get().startDungeon(1);
    const run = get().dungeon!;
    expect(run.startDepth).toBe(1);
    expect(run.pendingBoon).toBeNull();
  });
});

describe('the energy contract shifts to the start floor (D1 × D6)', () => {
  const atCheckpoint = (depth: number, startDepth: number, energy: number) => {
    useGameStore.setState({
      character: { ...get().character, energy },
      dungeon: makeRun({ atCheckpoint: true, depth, startDepth, energySpent: DUNGEON_ENERGY_COST }),
    });
  };

  it('covers the first three floors of a floor-6 start (7 and 8 are free)', () => {
    atCheckpoint(6, 6, 0);
    get().dungeonDescend('pressOn');
    expect(get().dungeon!.depth).toBe(7); // free at zero energy
    atCheckpoint(7, 6, 0);
    get().dungeonDescend('pressOn');
    expect(get().dungeon!.depth).toBe(8);
    expect(get().energyLog[toISODate()]?.spent ?? 0).toBe(0);
  });

  it('charges the fourth floor of the expedition (9 on a floor-6 start)', () => {
    atCheckpoint(8, 6, 0);
    const before = get().dungeon!;
    get().dungeonDescend('pressOn');
    expect(get().dungeon).toBe(before); // zero energy → no-op

    atCheckpoint(8, 6, 1);
    get().dungeonDescend('pressOn');
    expect(get().dungeon!.depth).toBe(9);
    expect(get().character.energy).toBe(0);
    expect(get().dungeon!.energySpent).toBe(DUNGEON_ENERGY_COST + DUNGEON_DESCENT_COST);
  });

  it('deep starts never set the depth record; floor-1 runs still do', () => {
    useGameStore.setState({ deepestFloor: 11 });
    atCheckpoint(11, 11, 5);
    get().dungeonDescend('pressOn');
    expect(get().dungeon!.depth).toBe(12);
    expect(get().deepestFloor).toBe(11); // a floor-11 hop is not a descent record

    useGameStore.setState({ deepestFloor: 3 });
    atCheckpoint(3, 1, 5);
    get().dungeonDescend('pressOn');
    expect(get().deepestFloor).toBe(4);
  });
});

describe('boss measurement (plan 3.1)', () => {
  const bossBattle = (status: 'won' | 'lost'): BattleState =>
    ({
      status,
      playerHp: status === 'won' ? 50 : 0,
      playerMp: 10,
      playerSta: 5,
      bossMaxHp: 200,
      attackSchool: 'physical',
      bossId: 'bone_king_d5',
    }) as BattleState;

  it('a boss win records the slain depth and the run tallies', () => {
    useGameStore.setState({
      dungeon: makeRun({ rooms: [{ type: 'boss' }], depth: 5, battle: bossBattle('won') }),
    });
    get().dungeonAdvance();
    const run = get().dungeon!;
    expect(run.bossesFought).toBe(1);
    expect(run.bossesSlain).toBe(1);
    expect(get().dungeonBossesSlain).toEqual([5]);
    // A second win at the same depth stays deduplicated.
    useGameStore.setState({
      dungeon: makeRun({ rooms: [{ type: 'boss' }], depth: 5, battle: bossBattle('won') }),
    });
    get().dungeonAdvance();
    expect(get().dungeonBossesSlain).toEqual([5]);
  });

  it('a boss loss counts the attempt, not the kill, through to the summary', () => {
    useGameStore.setState({
      dungeon: makeRun({ rooms: [{ type: 'boss' }], depth: 5, battle: bossBattle('lost') }),
    });
    get().dungeonAdvance();
    expect(get().dungeonBossesSlain).toEqual([]);
    get().collectDungeon();
    const entry = get().dungeonHistory[0];
    expect(entry.bossesFought).toBe(1);
    expect(entry.bossesSlain).toBe(0);
    expect(entry.startDepth).toBe(1);
    expect(entry.level).toBe(3);
  });

  it('the economy readout aggregates the boss win rate and median duration', () => {
    useGameStore.setState({
      dungeonHistory: [
        { depth: 5, cleared: false, defeated: true, date: toISODate(), roomsCleared: 4, relicCount: 0, goldBanked: 10, energySpent: 3, durationMs: 4 * 60_000, xpGranted: 20, bossesFought: 1, bossesSlain: 0 },
        { depth: 6, cleared: true, defeated: false, date: toISODate(), roomsCleared: 6, relicCount: 2, goldBanked: 90, energySpent: 4, durationMs: 8 * 60_000, xpGranted: 40, bossesFought: 1, bossesSlain: 1 },
        { depth: 3, cleared: true, defeated: false, date: toISODate(), roomsCleared: 3, relicCount: 1, goldBanked: 40, energySpent: 3, durationMs: 6 * 60_000, xpGranted: 15, bossesFought: 0, bossesSlain: 0 },
      ],
    });
    const eco = selectDungeonEconomy(get())!;
    expect(eco.bossWinRate01).toBeCloseTo(0.5);
    expect(eco.medianDurationMs).toBe(6 * 60_000);
  });

  it('reports the dungeon share of all XP for the DUN-12 check (plan 3.5)', () => {
    const earnings = get().earnings!;
    useGameStore.setState({
      earnings: { ...earnings, xp: { ...earnings.xp, habit: 300, dungeon: 100 } },
      dungeonHistory: [
        { depth: 2, cleared: true, defeated: false, date: toISODate(), roomsCleared: 3, relicCount: 0, goldBanked: 10, energySpent: 3, durationMs: 60_000 },
      ],
    });
    const eco = selectDungeonEconomy(get())!;
    expect(eco.dungeonXpShare01).toBeCloseTo(0.25);
    expect(eco.bossWinRate01).toBeNull(); // no boss fought yet — never fabricated
  });
});
