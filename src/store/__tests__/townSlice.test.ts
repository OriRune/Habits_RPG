/**
 * The Homestead slice (plan3 10.1 / M1) — queue-time escrow (gold + materials), the
 * unlimitedGold asymmetry (gold free, materials still charged — same as craft), the deed
 * prestige gate, and the cancel refund (materials back, gold stays sunk). Clones the
 * setState-seeding shape of forgeQuality.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../useGameStore';
import { prestigeOf, gridSizeFor } from '@/engine/town';

const get = () => useGameStore.getState();

beforeEach(() => {
  get().resetGame();
  useGameStore.setState({
    materials: { stone: 99, wood: 99, iron_bar: 99, gemstone: 99 },
    character: { ...get().character, gold: 9999 },
  });
});

describe('townQueueBuild', () => {
  it('charges gold + materials and escrows a project', () => {
    const cost = { gold: 150, stone: 4, wood: 4 }; // Watchtower tier I
    get().townQueueBuild('watchtower', 3, 3);
    expect(get().town.queue).toHaveLength(1);
    expect(get().character.gold).toBe(9999 - cost.gold);
    expect(get().materials.stone).toBe(99 - cost.stone);
    expect(get().materials.wood).toBe(99 - cost.wood);
  });

  it('is a no-op when gold is insufficient', () => {
    useGameStore.setState({ character: { ...get().character, gold: 10 } });
    get().townQueueBuild('watchtower', 3, 3);
    expect(get().town.queue).toHaveLength(0);
    expect(get().character.gold).toBe(10);
    expect(get().materials.stone).toBe(99); // untouched
  });

  it('is a no-op when materials are insufficient', () => {
    useGameStore.setState({ materials: { stone: 0, wood: 0 } });
    get().townQueueBuild('watchtower', 3, 3);
    expect(get().town.queue).toHaveLength(0);
    expect(get().character.gold).toBe(9999); // untouched
  });

  it('unlimitedGold bypasses gold but still charges materials', () => {
    useGameStore.setState({
      settings: { ...get().settings, unlimitedGold: true },
      character: { ...get().character, gold: 0 },
    });
    get().townQueueBuild('watchtower', 3, 3);
    expect(get().town.queue).toHaveLength(1);
    expect(get().character.gold).toBe(0);      // gold free
    expect(get().materials.stone).toBe(99 - 4); // materials still charged
  });
});

describe('townBuyDeed', () => {
  it('is gated on the prestige requirement', () => {
    // Fresh town has prestige 0 < TOWN_DEED_PRESTIGE[0] (100 after the M6 retune) → no-op
    // even with plenty of gold.
    get().townBuyDeed();
    expect(get().town.deeds).toBe(0);
    expect(get().character.gold).toBe(9999);
  });

  it('charges pure gold once the prestige gate is met', () => {
    // Seed enough prestige for the M6 deed-1 gate (100): Keep tier III = 25 + 40 + 70 = 135 ≥ 100.
    useGameStore.setState({
      town: { ...get().town, buildings: [{ id: 'k', key: 'keep', r: 0, c: 0, tier: 3 }] },
    });
    get().townBuyDeed();
    expect(get().town.deeds).toBe(1);
    expect(get().character.gold).toBe(9999 - 500); // TOWN_DEED_COSTS[0]
  });

  // TOWN-17: the gate reads BUILDING prestige — zero-labor decor spam can't buy land.
  it('ignores decor prestige at the deed gate', () => {
    // 34 statues = 102 total prestige (over the 100 gate) but 0 building prestige.
    useGameStore.setState({
      town: {
        ...get().town,
        decor: Array.from({ length: 34 }, (_, i) => ({ key: 'statue', r: 0, c: i, v: 0 })),
      },
    });
    get().townBuyDeed();
    expect(get().town.deeds).toBe(0);
    expect(get().character.gold).toBe(9999);
  });

  // TOWN-06: past the three land districts, land-free charters keep the sink open.
  it('sells escalating charters past deed 3, each granting prestige but no land', () => {
    useGameStore.setState({
      character: { ...get().character, gold: 50000 },
      town: {
        ...get().town,
        deeds: 3,
        // Building prestige 465 ≥ the charter-1 gate (440).
        buildings: [
          { id: 'k', key: 'keep', r: 0, c: 0, tier: 4 },        // 255
          { id: 'w', key: 'watchtower', r: 4, c: 0, tier: 3 },  // 50
          { id: 'b', key: 'bathhouse', r: 6, c: 0, tier: 3 },   // 80
          { id: 't', key: 'trading_post', r: 9, c: 0, tier: 3 },// 80
        ],
      },
    });
    const prestigeBefore = prestigeOf(get().town);
    get().townBuyDeed();
    expect(get().town.deeds).toBe(4);
    expect(get().character.gold).toBe(50000 - 8000); // deedCost(3)
    expect(prestigeOf(get().town)).toBe(prestigeBefore + 40); // TOWN_CHARTER_PRESTIGE
    expect(gridSizeFor(get().town.deeds)).toEqual({ rows: 24, cols: 24 }); // no land
    // The next charter is gated higher (560) — 465 building prestige no longer qualifies.
    get().townBuyDeed();
    expect(get().town.deeds).toBe(4);
  });
});

describe('townDemolish', () => {
  it('is a no-op while a queued upgrade targets the building (TOWN-02)', () => {
    // Build a completed watchtower directly, then queue its upgrade.
    useGameStore.setState({
      town: { ...get().town, buildings: [{ id: 'w', key: 'watchtower', r: 0, c: 0, tier: 1 }] },
    });
    get().townQueueUpgrade('w');
    expect(get().town.queue).toHaveLength(1);
    const materialsBefore = { ...get().materials };

    get().townDemolish('w');

    expect(get().town.buildings).toHaveLength(1);      // building intact
    expect(get().town.queue).toHaveLength(1);          // project intact
    expect(get().materials).toEqual(materialsBefore);  // no phantom refund
  });

  it('refunds 50% cumulative materials once no project targets it', () => {
    useGameStore.setState({
      town: { ...get().town, buildings: [{ id: 'w', key: 'watchtower', r: 0, c: 0, tier: 1 }] },
    });
    get().townDemolish('w');
    expect(get().town.buildings).toHaveLength(0);
    expect(get().materials.stone).toBe(99 + 2); // floor(4 * 0.5)
    expect(get().materials.wood).toBe(99 + 2);
  });
});

describe('townRemoveDecor', () => {
  it('removes the prop anchored at (r, c) and refunds 50% of its materials (floored)', () => {
    useGameStore.setState({
      town: { ...get().town, decor: [{ key: 'well', r: 5, c: 5, v: 0 }] }, // well: 3 stone
    });
    get().townRemoveDecor(5, 5);
    expect(get().town.decor).toHaveLength(0);
    expect(get().materials.stone).toBe(99 + 1); // floor(3 * 0.5)
  });

  it('is a no-op on an empty cell', () => {
    const before = { ...get().materials };
    get().townRemoveDecor(3, 3);
    expect(get().materials).toEqual(before);
  });
});

describe('townCancelProject', () => {
  it('refunds materials but not gold', () => {
    get().townQueueBuild('watchtower', 3, 3);
    const goldAfterBuild = get().character.gold; // 9999 - 150
    const projectId = get().town.queue[0].id;
    get().townCancelProject(projectId);
    expect(get().town.queue).toHaveLength(0);
    expect(get().materials.stone).toBe(99); // 100% material refund
    expect(get().materials.wood).toBe(99);
    expect(get().character.gold).toBe(goldAfterBuild); // gold stays sunk
  });
});
