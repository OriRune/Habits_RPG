// Phase 1 energy-contract + accounting tests (dungeon-delve-plan-2026-07.md items 1.1, 1.3):
// a zero-energy character cannot enter a paid floor by any path, and recorded spend equals
// actual deductions. DUN-02.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGameStore, type DungeonRun } from '../useGameStore';
import { type BattleState } from '@/engine/combat';
import { type DungeonRoom, DUNGEON_ENERGY_COST } from '@/engine/dungeon';
import { type FloorMap } from '@/engine/dungeonMap';
import { toISODate, _setNow, _resetNow } from '@/engine/date';
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
  _resetNow();
});

describe('descent energy contract (DUN-02 / plan 1.1)', () => {
  const atCheckpoint = (depth: number, energy: number) => {
    useGameStore.setState({
      character: { ...get().character, energy },
      dungeon: makeRun({ atCheckpoint: true, depth, energySpent: DUNGEON_ENERGY_COST }),
    });
  };

  it.each(['rest', 'pressOn'] as const)(
    'a zero-energy descent past the free floors is a no-op (%s)',
    (mode) => {
      atCheckpoint(3, 0);
      const before = get().dungeon!;
      get().dungeonDescend(mode);
      expect(get().dungeon).toBe(before); // unchanged state object — nothing happened
      expect(get().dungeon!.depth).toBe(3);
      expect(get().energyLog[toISODate()]?.spent ?? 0).toBe(0);
    },
  );

  it('a funded descent deducts exactly what it records', () => {
    atCheckpoint(3, 1);
    get().dungeonDescend('pressOn');
    const run = get().dungeon!;
    expect(run.depth).toBe(4);
    expect(get().character.energy).toBe(0);
    expect(run.energySpent).toBe(DUNGEON_ENERGY_COST + 1);
    expect(get().energyLog[toISODate()]?.spent).toBe(1);
  });

  it('descents within the covered floors stay free and unrecorded', () => {
    atCheckpoint(1, 0); // zero energy, but floor 1 → 2 is covered by entry
    get().dungeonDescend('pressOn');
    const run = get().dungeon!;
    expect(run.depth).toBe(2);
    expect(run.energySpent).toBe(DUNGEON_ENERGY_COST); // unchanged
    expect(get().energyLog[toISODate()]?.spent ?? 0).toBe(0);
  });

  it('unlimitedEnergy bypasses the charge and the record', () => {
    useGameStore.setState({ settings: { ...get().settings, unlimitedEnergy: true } });
    atCheckpoint(3, 0);
    get().dungeonDescend('rest');
    expect(get().dungeon!.depth).toBe(4);
    expect(get().dungeon!.energySpent).toBe(DUNGEON_ENERGY_COST); // nothing added
    expect(get().energyLog[toISODate()]?.spent ?? 0).toBe(0);
  });
});

describe('run accounting (plan 1.3)', () => {
  it('startDungeon stamps startedAt and the entry cost', () => {
    _setNow(() => new Date('2026-07-10T12:00:00Z'));
    useGameStore.setState({
      character: { ...get().character, level: 3, energy: 5 },
    });
    get().startDungeon();
    const run = get().dungeon!;
    expect(run.startedAt).toBe(new Date('2026-07-10T12:00:00Z').getTime());
    expect(run.energySpent).toBe(DUNGEON_ENERGY_COST);
  });

  it('a free (unlimitedEnergy) entry records zero spend', () => {
    useGameStore.setState({
      character: { ...get().character, level: 3, energy: 0 },
      settings: { ...get().settings, unlimitedEnergy: true },
    });
    get().startDungeon();
    expect(get().dungeon!.energySpent).toBe(0);
  });

  it('merchant purchases accumulate merchantGoldSpent (real spend only)', () => {
    useGameStore.setState({
      character: { ...get().character, gold: 100 },
      dungeon: makeRun({
        rooms: [{ type: 'merchant' }, { type: 'combat' }],
        merchant: [
          { id: 'heal', label: 'Heal', cost: 20, kind: 'heal' },
          { id: 'potion', label: 'Potion', cost: 30, kind: 'potion', potionKey: 'healing_potion' },
        ],
      }),
    });
    get().dungeonBuy('heal');
    get().dungeonBuy('potion');
    expect(get().dungeon!.merchantGoldSpent).toBe(50);
    expect(get().character.gold).toBe(50);

    // Creative-mode purchases are not real spend.
    useGameStore.setState({
      settings: { ...get().settings, unlimitedGold: true },
      dungeon: makeRun({
        rooms: [{ type: 'merchant' }, { type: 'combat' }],
        merchant: [{ id: 'heal', label: 'Heal', cost: 20, kind: 'heal' }],
      }),
    });
    get().dungeonBuy('heal');
    expect(get().dungeon!.merchantGoldSpent).toBe(0);
  });

  it('the collected summary reports what actually happened', () => {
    _setNow(() => new Date('2026-07-10T12:00:00Z'));
    // A defeat with floor loot on the table: finishRun stamps lostReward.
    useGameStore.setState({
      dungeon: makeRun({
        depth: 4,
        floorReward: { gold: 100, materials: { leather: 1 }, items: ['healing_potion'] },
        battle: { status: 'lost', playerHp: 0 } as BattleState,
        startedAt: new Date('2026-07-10T11:48:00Z').getTime(),
        energySpent: 4,
        earnedXp: 37,
        merchantGoldSpent: 20,
      }),
    });
    get().dungeonAdvance(); // resolves the loss → finishRun('defeated')
    get().collectDungeon();
    const entry = get().dungeonHistory[0];
    expect(entry.endReason).toBe('defeated');
    expect(entry.energySpent).toBe(4);
    expect(entry.xpGranted).toBe(37);
    expect(entry.merchantGoldSpent).toBe(20);
    expect(entry.goldLost).toBe(75); // kept floor(100 × 0.25) = 25
    expect(entry.materialsLost).toBe(1); // 1 leather floored to zero kept
    expect(entry.durationMs).toBe(12 * 60_000);
  });
});
