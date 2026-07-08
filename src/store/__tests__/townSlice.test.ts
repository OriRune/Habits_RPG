/**
 * The Homestead slice (plan3 10.1 / M1) — queue-time escrow (gold + materials), the
 * unlimitedGold asymmetry (gold free, materials still charged — same as craft), the deed
 * prestige gate, and the cancel refund (materials back, gold stays sunk). Clones the
 * setState-seeding shape of forgeQuality.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../useGameStore';

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
