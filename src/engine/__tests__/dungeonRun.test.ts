import { describe, it, expect } from 'vitest';
import {
  DUNGEON_RETENTION,
  previewRetainedReward,
  runEndReason,
  finishRun,
  resolveCurrentNode,
} from '../dungeonRun';
import { type DungeonRun } from '../dungeonTypes';
import { type FloorMap } from '../dungeonMap';
import { deriveCombatant, clampCombatant } from '../combat';
import { emptyCombatStats } from '../combatStats';
import { STAT_IDS, type StatId } from '../stats';

/** A single-room map: one combat node with no outgoing edges (terminal). */
function tinyMap(): FloorMap {
  return {
    nodes: { n0: { id: 'n0', layer: 0, room: { type: 'combat' }, to: [] } },
    layers: [['n0']],
  };
}

function makeRun(over: Partial<DungeonRun> = {}): DungeonRun {
  const map = tinyMap();
  return {
    depth: 1,
    biomeKey: 'catacombs',
    map,
    nodeId: 'n0',
    choices: [],
    path: ['n0'],
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

describe('DUNGEON_RETENTION', () => {
  it('keeps more on a flee than on a defeat, and both are partial', () => {
    expect(DUNGEON_RETENTION.fled).toBeGreaterThan(DUNGEON_RETENTION.defeated);
    expect(DUNGEON_RETENTION.fled).toBeLessThan(1);
    expect(DUNGEON_RETENTION.defeated).toBeGreaterThan(0);
  });
});

describe('previewRetainedReward', () => {
  const floorReward = {
    gold: 101,
    materials: { iron_bar: 3, leather: 1 },
    items: ['healing_potion'],
    weapons: ['iron_sword'],
    gear: ['leather_cap'],
  };

  it.each(['fled', 'defeated'] as const)(
    'preview.kept exactly matches what finishRun banks (%s)',
    (reason) => {
      const run = makeRun({ floorReward, bankedReward: {} });
      const { kept } = previewRetainedReward(run, reason);
      const ended = finishRun(run, reason, reason === 'fled' ? 40 : 0);
      expect(ended.bankedReward.gold ?? 0).toBe(kept.gold ?? 0);
      expect(ended.bankedReward.materials ?? {}).toEqual(kept.materials ?? {});
      expect(ended.bankedReward.items ?? []).toEqual([]);
      expect(ended.bankedReward.weapons ?? []).toEqual([]);
      expect(ended.bankedReward.gear ?? []).toEqual([]);
    },
  );

  it('kept + lost accounts for every unit of the floor reward', () => {
    const { kept, lost } = previewRetainedReward(makeRun({ floorReward }), 'fled');
    expect((kept.gold ?? 0) + (lost.gold ?? 0)).toBe(101);
    for (const [k, v] of Object.entries(floorReward.materials)) {
      expect((kept.materials?.[k] ?? 0) + (lost.materials?.[k] ?? 0)).toBe(v);
    }
    // Discrete drops are all-or-nothing: every one shows in the lost column.
    expect(lost.items).toEqual(['healing_potion']);
    expect(lost.weapons).toEqual(['iron_sword']);
    expect(lost.gear).toEqual(['leather_cap']);
    expect(kept.items).toEqual([]);
  });

  it('shows small material stacks flooring to zero (1 leather at 25% → 0 kept, 1 lost)', () => {
    const { kept, lost } = previewRetainedReward(
      makeRun({ floorReward: { gold: 0, materials: { leather: 1 } } }),
      'defeated',
    );
    expect(kept.materials?.leather ?? 0).toBe(0);
    expect(lost.materials?.leather).toBe(1);
  });
});

describe('runEndReason', () => {
  it('prefers the explicit endReason when present', () => {
    expect(runEndReason({ endReason: 'fled', cleared: false, hp: 0 })).toBe('fled');
  });

  it('derives a fallback for pre-endReason saves', () => {
    expect(runEndReason({ cleared: true, hp: 50 })).toBe('banked');
    expect(runEndReason({ cleared: false, hp: 0 })).toBe('defeated');
    expect(runEndReason({ cleared: false, hp: 12 })).toBe('fled');
  });
});

describe('finishRun', () => {
  it('stamps the end reason and never marks an early end as cleared', () => {
    const fled = finishRun(makeRun({ floorReward: { gold: 10 } }), 'fled', 25);
    expect(fled.status).toBe('ended');
    expect(fled.cleared).toBe(false);
    expect(fled.endReason).toBe('fled');
    expect(fled.hp).toBe(25);

    const dead = finishRun(makeRun(), 'defeated', 0);
    expect(dead.endReason).toBe('defeated');
  });
});

describe('resolveCurrentNode roomsCleared', () => {
  it('increments roomsCleared when a room resolves', () => {
    const next = resolveCurrentNode(makeRun({ roomsCleared: 2 }), 100, 30, 10);
    expect(next.roomsCleared).toBe(3);
  });

  it('does not increment when no room is being resolved (nodeId null)', () => {
    const next = resolveCurrentNode(makeRun({ nodeId: null, roomsCleared: 2 }), 100, 30, 10);
    expect(next.roomsCleared).toBe(2);
  });
});

describe('clampCombatant', () => {
  const zeroLevels = Object.fromEntries(STAT_IDS.map((s) => [s, 1])) as Record<StatId, number>;

  it('floors every derived value under heavy negative buffs', () => {
    const debuffs = Object.fromEntries(STAT_IDS.map((s) => [s, -999])) as Partial<Record<StatId, number>>;
    const c = deriveCombatant(zeroLevels, 1, emptyCombatStats(), debuffs);
    expect(c.maxHp).toBeGreaterThanOrEqual(1);
    expect(c.maxMp).toBeGreaterThanOrEqual(0);
    expect(c.maxSta).toBeGreaterThanOrEqual(0);
    expect(c.meleePower).toBeGreaterThanOrEqual(0);
    expect(c.rangedPower).toBeGreaterThanOrEqual(0);
    expect(c.damageSpell).toBeGreaterThanOrEqual(0);
    expect(c.flee).toBeGreaterThanOrEqual(0.05);
    expect(c.dodge).toBeGreaterThanOrEqual(0);
  });

  it('re-floors after post-derivation adjustments (the fighterFor relic path)', () => {
    const c = deriveCombatant(zeroLevels, 1, emptyCombatStats());
    c.maxHp += -10_000; // stacked brittle_bones far beyond the pool
    clampCombatant(c);
    expect(c.maxHp).toBe(1);
  });

  it('leaves a normal fighter untouched', () => {
    const base = deriveCombatant(zeroLevels, 5, emptyCombatStats());
    const clamped = clampCombatant({ ...base });
    expect(clamped).toEqual(base);
  });
});
