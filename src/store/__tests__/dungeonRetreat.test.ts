// General retreat (dungeon-delve-plan-2026-07.md item 2.4, decisions D5 + DUN-10):
// a guaranteed exit from any non-battle state, with the same 'fled' retention as a
// combat flee, matching previewRetainedReward exactly.
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore, type DungeonRun } from '../useGameStore';
import { type BattleState } from '@/engine/combat';
import { type DungeonRoom } from '@/engine/dungeon';
import { type FloorMap } from '@/engine/dungeonMap';
import { previewRetainedReward } from '@/engine/dungeonRun';
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
    hp: 60,
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

const FLOOR_LOOT = { gold: 101, materials: { leather: 1 }, items: ['healing_potion'] };

describe('dungeonRetreat (plan 2.4 / DUN-10)', () => {
  it('retreats from a path choice with the exact fled retention', () => {
    const run = makeRun({
      rooms: [{ type: 'rest' }, { type: 'combat' }],
      nodeId: null,
      choices: ['n1_0'],
      bankedReward: { gold: 40 },
      floorReward: FLOOR_LOOT,
    });
    const { kept, lost } = previewRetainedReward(run, 'fled');
    useGameStore.setState({ dungeon: run });
    get().dungeonRetreat();
    const ended = get().dungeon!;
    expect(ended.status).toBe('ended');
    expect(ended.endReason).toBe('fled');
    expect(ended.cleared).toBe(false);
    expect(ended.hp).toBe(60); // retreat never costs HP — it is not a failed flee
    // The banked total is banked-before + the preview's kept share, to the unit.
    expect(ended.bankedReward.gold).toBe(40 + (kept.gold ?? 0));
    expect(ended.lostReward).toEqual(lost);
    expect(ended.floorReward).toEqual({});
  });

  it.each<[string, Partial<DungeonRun> & { rooms?: DungeonRoom[] }]>([
    ['treasure room', { rooms: [{ type: 'treasure' }, { type: 'combat' }], roomLoot: { gold: 10 } }],
    ['shrine', { rooms: [{ type: 'shrine' }, { type: 'combat' }] }],
    ['shrine result panel', {
      rooms: [{ type: 'shrine' }, { type: 'combat' }],
      shrineResult: { outcome: 'cursed', curseKey: 'brittle_bones' },
    }],
    ['merchant', {
      rooms: [{ type: 'merchant' }, { type: 'combat' }],
      merchant: [{ id: 'heal', label: 'Heal', cost: 20, kind: 'heal' }],
    }],
    ['rest site', { rooms: [{ type: 'rest' }, { type: 'combat' }] }],
    ['mid-encounter', { rooms: [{ type: 'encounter', key: 'sealed_door' }, { type: 'combat' }] }],
    ['checkpoint', { atCheckpoint: true, nodeId: null }],
  ])('is legal in a %s (no battle seeded)', (_label, over) => {
    useGameStore.setState({ dungeon: makeRun({ ...over, floorReward: { gold: 50 } }) });
    get().dungeonRetreat();
    expect(get().dungeon!.status).toBe('ended');
    expect(get().dungeon!.endReason).toBe('fled');
  });

  it('keeps everything when retreating at a checkpoint (floor loot already banked)', () => {
    useGameStore.setState({
      dungeon: makeRun({ atCheckpoint: true, nodeId: null, bankedReward: { gold: 80 }, floorReward: {} }),
    });
    get().dungeonRetreat();
    expect(get().dungeon!.bankedReward.gold).toBe(80);
  });

  it('is a no-op while a battle is seeded — active or awaiting its resolve click', () => {
    for (const status of ['active', 'won', 'lost'] as const) {
      const run = makeRun({
        rooms: [{ type: 'combat' }],
        battle: { status, playerHp: 50 } as BattleState,
      });
      useGameStore.setState({ dungeon: run });
      get().dungeonRetreat();
      expect(get().dungeon).toBe(run); // unchanged reference — nothing happened
    }
  });

  it('is a no-op on an ended run and without a run', () => {
    const run = makeRun({ status: 'ended' });
    useGameStore.setState({ dungeon: run });
    get().dungeonRetreat();
    expect(get().dungeon).toBe(run);

    useGameStore.setState({ dungeon: null });
    get().dungeonRetreat();
    expect(get().dungeon).toBeNull();
  });
});
