// Route pricing in the store (dungeon-delve-plan-2026-07.md item 2.2, decision D2):
// treasure and combat-win gold are scaled by the danger *realized* on the floor's path —
// the engine simulation (dungeonRoutes.test.ts) tunes the curve; these tests pin the
// application sites (enterRoom + dungeonAdvance).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore, type DungeonRun } from '../useGameStore';
import { type BattleState } from '@/engine/combat';
import { type DungeonRoom, combatRoomGold } from '@/engine/dungeon';
import { type FloorMap, dangerRewardFactor } from '@/engine/dungeonMap';
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Math.random pinned to 0.999: resolveTreasure rolls max bonus gold (+39), no item or
// weapon drops — so the unscaled treasure base at depth 1 is 60 + 10 + 39 = 109.
const TREASURE_BASE = 109;

describe('treasure gold is priced by realized danger (D2)', () => {
  it('a treasure grabbed before any fight pays the lean factor', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    useGameStore.setState({
      dungeon: makeRun({
        rooms: [{ type: 'treasure' }, { type: 'combat' }],
        nodeId: null,
        path: [],
        choices: ['n0_0'],
      }),
    });
    get().dungeonChoosePath('n0_0');
    expect(get().dungeon!.roomLoot!.gold).toBe(Math.round(TREASURE_BASE * dangerRewardFactor(0)));
  });

  it('the same treasure after a survived fight pays the danger factor', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    useGameStore.setState({
      dungeon: makeRun({
        rooms: [{ type: 'combat' }, { type: 'treasure' }],
        nodeId: null,
        path: ['n0_0'], // the combat is already resolved on this path
        choices: ['n1_0'],
      }),
    });
    get().dungeonChoosePath('n1_0');
    expect(get().dungeon!.roomLoot!.gold).toBe(Math.round(TREASURE_BASE * dangerRewardFactor(1)));
  });
});

describe('combat-win gold is priced by realized danger (D2)', () => {
  const wonBattle = (): BattleState =>
    ({
      status: 'won',
      playerHp: 50,
      playerMp: 10,
      playerSta: 5,
      bossMaxHp: 40,
      attackSchool: 'physical',
    }) as BattleState;

  it('back-to-back fights pay progressively more', () => {
    // First combat: the path's only danger room → factor(1).
    useGameStore.setState({
      dungeon: makeRun({ rooms: [{ type: 'combat' }, { type: 'combat' }], battle: wonBattle() }),
    });
    get().dungeonAdvance();
    expect(get().dungeon!.floorReward.gold).toBe(
      Math.round(combatRoomGold(1) * dangerRewardFactor(1)),
    );

    // Second combat on the same path → factor(2) — the danger streak pays out.
    useGameStore.setState({
      dungeon: {
        ...get().dungeon!,
        nodeId: 'n1_0',
        path: ['n0_0', 'n1_0'],
        choices: [],
        battle: wonBattle(),
      },
    });
    get().dungeonAdvance();
    // n1_0 is the floor's last room, so its (higher-priced) gold banks at the checkpoint.
    const run = get().dungeon!;
    expect(run.atCheckpoint).toBe(true);
    expect(run.bankedReward.gold).toBe(
      Math.round(combatRoomGold(1) * dangerRewardFactor(1)) +
        Math.round(combatRoomGold(1) * dangerRewardFactor(2)),
    );
  });
});
